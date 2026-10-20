import { describe, expect, it } from 'vitest';
import { LEGACY_COLORS, TEAM_SEEDS } from './data/teams';
import { createLeague, SAVE_VERSION } from './generate';
import { recordResult, simToEndOfSeason } from './league';
import { migrateLeague } from './migrate';
import { coachRecord, gmRecord } from './records';
import { editPlayerIdentity, identityProblem, teamPlayers } from './roster';
import type { Game, GameResult, League, StatLine } from './types';

const copy = <T>(x: T): T => JSON.parse(JSON.stringify(x));

describe('records', () => {
  const league = createLeague({ seed: 'records' });
  simToEndOfSeason(league);
  const summary = league.history[0];

  it('keeps every playoff team’s run, with an unbeaten champion', () => {
    const teams = Object.keys(summary.playoffs!).map(Number);
    expect(teams).toHaveLength(14);
    expect(summary.playoffs![summary.championId]).toMatchObject({ l: 0, round: 'FINAL' });
    expect(summary.playoffs![summary.runnerUpId]).toMatchObject({ l: 1, round: 'FINAL' });
  });

  it('credits the season to every coach on a staff, and the GM', () => {
    const gm = gmRecord(league);
    expect(gm.seasons).toHaveLength(1);
    expect(gm.regular).toEqual({ ...summary.records[league.userTeamId] });
    for (const c of Object.values(league.coaches)) {
      if (c.teamId === null) continue;
      const rec = coachRecord(league, c);
      expect(rec.seasons.map((s) => s.teamId)).toEqual([c.teamId]);
      expect(rec.regular).toEqual({ ...summary.records[c.teamId] });
    }
  });

  it('tags each season’s stats with the team they were earned for', () => {
    for (const p of Object.values(league.players)) {
      if (!p.stats[league.season]) continue;
      const teams = p.statTeams?.[league.season] ?? [];
      expect(teams.length).toBeGreaterThan(0);
      if (teams.length === 1) expect(p.splitStats?.[league.season]).toBeUndefined();
    }
  });

  it('upgrades a v8 save: stats by team and playoff runs rebuilt from the games on file, colours refreshed', () => {
    const old = copy(league);
    old.version = 8;
    for (const p of Object.values(old.players)) {
      delete p.statTeams;
      delete p.splitStats;
    }
    for (const h of old.history) delete h.playoffs;
    for (const c of Object.values(old.coaches)) delete c.career;
    old.teams.forEach((t) => (t.colors = [...LEGACY_COLORS[t.abbrev]]));
    old.teams[1].colors = ['#123456', '#654321']; // a mod's colours stay
    const up = migrateLeague(old)!;
    expect(up.version).toBe(SAVE_VERSION);
    expect(up.history).toEqual(league.history);
    for (const p of Object.values(up.players)) expect(p.statTeams ?? {}).toEqual(league.players[p.id].statTeams ?? {});
    expect(up.teams[0].colors).toEqual(TEAM_SEEDS[0].colors);
    expect(up.teams[1].colors).toEqual(['#123456', '#654321']);
    expect(migrateLeague(copy(up))).toEqual(up);
  });
});

describe('a season split between teams', () => {
  it('keeps each team’s share, adding up to the season line', () => {
    const league: League = createLeague({ seed: 'split' });
    const p = teamPlayers(league, 0)[0];
    let gameId = 9000;
    const play = (teamId: number, line: StatLine) => {
      const game = { id: gameId++, season: league.season, week: 1, homeId: 0, awayId: 1 } as Game;
      recordResult(league, game, {
        playerStats: { [p.id]: line },
        playerTeams: { [p.id]: teamId },
      } as unknown as GameResult);
    };
    play(0, { gp: 1, rushYds: 50, rushLong: 20 });
    play(0, { gp: 1, rushYds: 30, rushLong: 12 });
    play(5, { gp: 1, rushYds: 70, rushLong: 40 });
    expect(p.statTeams![league.season]).toEqual([0, 5]);
    expect(p.splitStats![league.season]).toEqual({
      0: { gp: 2, rushYds: 80, rushLong: 20 },
      5: { gp: 1, rushYds: 70, rushLong: 40 },
    });
    expect(p.stats[league.season]).toEqual({ gp: 3, rushYds: 150, rushLong: 40 });
  });
});

describe('editing names and numbers', () => {
  it('renames and renumbers, but teammates can’t share a number', () => {
    const league = createLeague({ seed: 'identity' });
    const [a, b] = teamPlayers(league, 0);
    expect(identityProblem(league, a, { firstName: 'Al', lastName: 'Bee', jersey: b.jersey })).toMatch(/belongs to/);
    expect(identityProblem(league, a, { firstName: ' ', lastName: 'Bee', jersey: 1 })).toMatch(/names/);
    expect(identityProblem(league, a, { firstName: 'Al', lastName: 'Bee', jersey: 100 })).toMatch(/0–99/);
    const free = [...Array(100).keys()].find((n) => !teamPlayers(league, 0).some((p) => p.jersey === n))!;
    editPlayerIdentity(league, a.id, { firstName: ' Al ', lastName: 'Bee', jersey: free });
    expect([a.firstName, a.lastName, a.jersey]).toEqual(['Al', 'Bee', free]);
  });
});
