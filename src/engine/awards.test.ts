import { describe, expect, it } from 'vitest';
import {
  periodQbTerm,
  positionScore,
  qbBonus,
  qbTerm,
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
import { playWeek, simToEndOfRegularSeason } from './league';
import { migrateLeague } from './migrate';
import { advanceOffseason, beginOffseason } from './offseason';
import { ATTRIBUTES, type GameResult, type League } from './types';
import { qualifies, RATES } from './qualify';
import { passerRating } from './stats';

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
  });
});

describe('save migration to v7', () => {
  it('works out past seasons from the stats a save already has', async () => {
    const league = createLeague({ seed: 'awards-migrate' });
    // Two seasons, a week (or an offseason step) at a time with a yield between: played in one stretch they kept the
    // test worker from reporting for over a minute (an RPC timeout). The same calls simToEndOfSeason, simOffseason and
    // simToEndOfRegularSeason make, in the same order.
    const tick = () => new Promise((r) => setTimeout(r, 0));
    while (league.phase !== 'complete') {
      playWeek(league);
      await tick();
    }
    beginOffseason(league);
    for (let guard = 0; guard < 256 && (league.phase as League['phase']) !== 'regular'; guard++) {
      advanceOffseason(league, { autoUser: true });
      await tick();
    }
    while ((league.phase as League['phase']) === 'regular') {
      playWeek(league);
      await tick();
    }
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
  });

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
  });
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

describe('awards read the shared rate minimums (0.4.16)', () => {
  /** Clubs with `n` games played (results by hand). */
  function played(n: number): League {
    const l = createLeague({ seed: 'awards-rates' });
    const count = new Map<number, number>();
    for (const g of l.games) {
      if (g.playoffRound || g.season !== l.season) continue;
      const h = count.get(g.homeId) ?? 0;
      const a = count.get(g.awayId) ?? 0;
      if (h >= n || a >= n) continue;
      g.result = {} as GameResult;
      count.set(g.homeId, h + 1);
      count.set(g.awayId, a + 1);
    }
    return l;
  }
  const qbOf = (l: League) => Object.values(l.players).find((p) => p.position === 'QB' && p.teamId !== null)!;

  it('has no cliff at 200 attempts: a qualified passer at 199 counts his rating, an unqualified one is neutral', () => {
    const l = played(11);
    const p = qbOf(l);
    const line = { gp: 11, passAtt: 199, passCmp: 140, passYds: 1800, passTd: 16, passInt: 3 };
    expect(qbTerm(l, p, line, l.season)).toBeCloseTo((passerRating(line) - 92) * 1.2, 6);
    expect(qbTerm(l, p, { ...line, passAtt: 150, passCmp: 105 }, l.season)).toBe(0);
    expect(qbBonus(line, false)).toBe(0);
  });

  it("weighs a weekly quarterback's rating", () => {
    const good = { passAtt: 30, passCmp: 24, passYds: 330, passTd: 3 };
    const poor = { passAtt: 30, passCmp: 14, passYds: 150, passTd: 0, passInt: 2 };
    expect(periodQbTerm(good, 1)).toBeGreaterThan(periodQbTerm(poor, 1));
    expect(periodQbTerm({ passAtt: 10, passCmp: 10, passYds: 200 }, 1)).toBe(0);
  });

  it('asks kickers and punters for their volume per team game', () => {
    const l = played(0);
    const p = qbOf(l);
    const past = l.season - 3; // a full 17-game season
    const score = (pos: 'K' | 'P', line: Record<string, number>) =>
      positionScore(pos, line, (r) => qualifies(l, p, line, past, RATES[r]));
    expect(score('K', { fgAtt: 17, fgMade: 15, fgLong: 50 })).toBeGreaterThan(0);
    expect(score('K', { fgAtt: 16, fgMade: 15, fgLong: 50 })).toBe(0);
    expect(score('P', { punts: 34, puntYds: 1530 })).toBeGreaterThan(0);
    expect(score('P', { punts: 33, puntYds: 1485 })).toBe(0);
  });
});
