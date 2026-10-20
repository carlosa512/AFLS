import { describe, expect, it } from 'vitest';
import {
  ALL_LEAGUE_SLOTS,
  AWARD_KEYS,
  HONOR_SLOTS,
  honorBadges,
  MONTHS,
  pickAwards,
  pickPeriod,
  playerHonors,
  rookieSeason,
  seasonAwards,
  weeklyAwards,
} from './awards';
import { createLeague, SAVE_VERSION } from './generate';
import { playWeek, simToEndOfRegularSeason, simToEndOfSeason } from './league';
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
    for (const k of ['oroy', 'droy'] as const)
      expect(rookieSeason(league, league.players[awards.winners[k]!.playerId])).toBe(league.season);
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
    expect(playerHonors(league, awards.allLeague[1][0].playerId)).toContainEqual({
      season: league.season,
      label: 'All-League 2nd team',
    });
  });
});

describe('comeback player', () => {
  it('goes to a player who was good, lost a season, and is good again', () => {
    const league = createLeague({ seed: 'awards-comeback' });
    simToEndOfRegularSeason(league);
    const s = league.season;
    const back = league.players[league.teams[3].depthChart.RB[0]];
    const line = back.stats[s];
    line.gp = 16; // he may have missed time this season too: the award wants a regular
    line.rushYds = 1900;
    line.rushTd = 16;
    back.stats[s - 1] = { gp: 3, rushAtt: 20, rushYds: 70 };
    // Two years ago: the same season (catches included, so the peak doesn't hinge on how many he had this year).
    back.stats[s - 2] = { ...line, gp: 17, rushYds: 1800, rushTd: 14 };
    back.experience = 4;
    delete back.draft;
    expect(pickAwards(league, s).winners.comeback?.playerId).toBe(back.id);
  }, 30_000);
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

describe('players of the week and month', () => {
  const league = createLeague({ seed: 'awards-weekly' });
  for (let w = 0; w < 4; w++) playWeek(league);
  const honors = weeklyAwards(league, league.season)!;
  const offense = ['QB', 'RB', 'WR', 'TE'];

  it('name an offensive and a defensive player in each conference after every week', () => {
    expect(Object.keys(honors.weeks).map(Number)).toEqual([1, 2, 3, 4]);
    for (const [week, winners] of Object.entries(honors.weeks)) {
      expect(winners).toHaveLength(HONOR_SLOTS.length);
      winners.forEach((w, i) => {
        const { conference, side } = HONOR_SLOTS[i];
        const p = league.players[w!.playerId];
        expect(league.teams[w!.teamId!].conference).toBe(conference);
        expect(offense.includes(p.position)).toBe(side === 'offense');
        // He played that week, for that team.
        const game = league.games.find(
          (g) => g.season === league.season && g.week === Number(week) && g.result?.playerTeams[p.id] === w!.teamId,
        );
        expect(game).toBeDefined();
      });
    }
  });

  it('name players of the month when its last week is played', () => {
    expect(MONTHS[0].weeks).toEqual([1, 4]);
    expect(Object.keys(honors.months)).toEqual(['sep']);
    expect(honors.months.sep!.every((w) => w !== null)).toBe(true);
    playWeek(league);
    expect(Object.keys(weeklyAwards(league, league.season)!.months)).toEqual(['sep']);
  });

  it('come from the box scores, never from ratings', () => {
    const blind = copy(league);
    for (const p of Object.values(blind.players))
      for (const a of ATTRIBUTES) p.ratings[a] = 1 + ((p.id * 3 + a.length) % 20);
    expect(pickPeriod(blind, league.season, [1, 4])).toEqual(honors.months.sep);
    expect(pickPeriod(blind, league.season, [2, 2])).toEqual(honors.weeks[2]);
  });

  it('count on the player card', () => {
    const counts = new Map<number, number>();
    for (const winners of Object.values(honors.weeks))
      for (const w of winners) counts.set(w!.playerId, (counts.get(w!.playerId) ?? 0) + 1);
    const [id, n] = [...counts].sort((a, b) => b[1] - a[1])[0];
    expect(honorBadges(playerHonors(league, id)).find((b) => b.label === 'Player of the Week')?.seasons).toHaveLength(
      n,
    );
  });

  it('keep the save small: a season of winners is a few kilobytes', () => {
    const full = createLeague({ seed: 'awards-weekly-size' });
    simToEndOfRegularSeason(full);
    const entry = weeklyAwards(full, full.season)!;
    expect(Object.keys(entry.weeks)).toHaveLength(18);
    expect(Object.keys(entry.months)).toEqual(['sep', 'oct', 'nov', 'dec']);
    expect(JSON.stringify(full.weeklyAwards).length).toBeLessThan(4000);
  }, 30_000);
});

describe('save migration to v8', () => {
  it('starts an older save with no players of the week', () => {
    const league = createLeague({ seed: 'awards-v8' });
    playWeek(league);
    const old = copy(league) as League;
    old.version = 7;
    delete (old as Partial<League>).weeklyAwards;
    const up = migrateLeague(old)!;
    expect(up.version).toBe(SAVE_VERSION);
    expect(up.weeklyAwards).toEqual([]);
    // The next week is named as usual.
    playWeek(up);
    expect(Object.keys(weeklyAwards(up, up.season)!.weeks)).toEqual(['2']);
  });
});
