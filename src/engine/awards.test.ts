import { describe, expect, it } from 'vitest';
import { ALL_LEAGUE_SLOTS, AWARD_KEYS, pickAwards, playerHonors, rookieSeason, seasonAwards } from './awards';
import { createLeague, SAVE_VERSION } from './generate';
import { simToEndOfRegularSeason, simToEndOfSeason } from './league';
import { migrateLeague } from './migrate';
import { simOffseason } from './offseason';
import { ATTRIBUTES, type League } from './types';

const copy = <T>(x: T): T => JSON.parse(JSON.stringify(x));

describe('season awards', () => {
  const league = createLeague({ seed: 'awards' });
  simToEndOfRegularSeason(league);
  const awards = seasonAwards(league, league.season)!;

  it('are voted when the regular season ends', () => {
    expect(league.phase).toBe('playoffs');
    expect(awards).toBeDefined();
    for (const k of ['mvp', 'opoy', 'dpoy', 'oroy', 'droy'] as const) expect(awards.winners[k]).toBeDefined();
    // A league's first season has no one coming back from anything.
    expect(awards.winners.comeback).toBeUndefined();
  });

  it('go to the right kind of player, with the club he played for', () => {
    const pos = (k: (typeof AWARD_KEYS)[number]) => league.players[awards.winners[k]!.playerId].position;
    expect(['QB', 'RB', 'WR', 'TE']).toContain(pos('opoy'));
    expect(['DT', 'EDGE', 'LB', 'CB', 'S']).toContain(pos('dpoy'));
    for (const k of ['oroy', 'droy'] as const) expect(rookieSeason(league, league.players[awards.winners[k]!.playerId])).toBe(league.season);
    const mvp = league.players[awards.winners.mvp!.playerId];
    const games = league.games.filter((g) => g.season === league.season && g.result?.playerTeams[mvp.id] !== undefined);
    expect(games.map((g) => g.result!.playerTeams[mvp.id])).toContain(awards.winners.mvp!.teamId);
    expect(mvp.stats[league.season].gp).toBeGreaterThanOrEqual(10);
  });

  it('name two full All-League teams by position, no one twice', () => {
    const slots = ALL_LEAGUE_SLOTS.flatMap(([pos, n]) => Array<string>(n).fill(pos));
    for (const squad of awards.allLeague) expect(squad.map((w) => league.players[w.playerId].position)).toEqual(slots);
    const ids = awards.allLeague.flat().map((w) => w.playerId);
    expect(new Set(ids).size).toBe(ids.length);
    const ol = awards.allLeague.flat().filter((w) => league.players[w.playerId].position === 'OL');
    for (const w of ol) expect(ol.filter((x) => x.teamId === w.teamId).length).toBeLessThanOrEqual(2);
  });

  it('come from the stat sheet and the standings, never from ratings', () => {
    const blind = copy(league);
    for (const p of Object.values(blind.players)) {
      for (const a of ATTRIBUTES) p.ratings[a] = 1 + ((p.id * 7 + a.length) % 20);
      p.potential = 20;
    }
    expect(pickAwards(blind, league.season)).toEqual(awards);
    expect(pickAwards(league, league.season)).toEqual(awards);
  });

  it('show on the winners as honors', () => {
    const honors = playerHonors(league, awards.winners.mvp!.playerId);
    expect(honors).toContainEqual({ season: league.season, label: 'MVP' });
    expect(playerHonors(league, awards.allLeague[1][0].playerId)).toContainEqual({ season: league.season, label: 'All-League 2nd team' });
  });
});

describe('comeback player', () => {
  it('goes to a player who was good, lost a season, and is good again', () => {
    const league = createLeague({ seed: 'awards-comeback' });
    simToEndOfRegularSeason(league);
    const s = league.season;
    const back = league.players[league.teams[3].depthChart.RB[0]];
    const line = back.stats[s];
    line.rushYds = 1900;
    line.rushTd = 16;
    back.stats[s - 1] = { gp: 3, rushAtt: 20, rushYds: 70 };
    back.stats[s - 2] = { gp: 17, rushAtt: 320, rushYds: 1800, rushTd: 14 };
    back.experience = 4;
    delete back.draft;
    expect(pickAwards(league, s).winners.comeback?.playerId).toBe(back.id);
  });
});

describe('save migration to v7', () => {
  it('works out past seasons from the stats a save already has', () => {
    const league = createLeague({ seed: 'awards-migrate' });
    simToEndOfSeason(league);
    simOffseason(league);
    simToEndOfRegularSeason(league);
    const first = league.season - 1;
    expect(league.awards.map((a) => a.season)).toEqual([first, league.season]);

    const old = copy(league) as League;
    old.version = 6;
    delete (old as Partial<League>).awards;
    const up = migrateLeague(old)!;
    expect(up.version).toBe(SAVE_VERSION);
    expect(up.awards.map((a) => a.season)).toEqual([first, league.season]);
    // The season still in the box scores is voted exactly as it was live.
    expect(seasonAwards(up, league.season)).toEqual(seasonAwards(league, league.season));
    // An older one keeps its winners' stat lines; only clubs may be unknown.
    expect(seasonAwards(up, first)!.winners.mvp).toBeDefined();
    expect(migrateLeague(copy(up))).toEqual(up);
  }, 60_000);

  it('votes nothing for a season still being played', () => {
    const league = createLeague({ seed: 'awards-migrate-early' });
    const old = copy(league) as League;
    old.version = 6;
    delete (old as Partial<League>).awards;
    expect(migrateLeague(old)!.awards).toEqual([]);
  });
});
