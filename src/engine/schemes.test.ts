import { describe, expect, it } from 'vitest';
import { teamScheme } from './coaching';
import { createLeague, SAVE_VERSION } from './generate';
import { defenseCall, passDepth, type Situation } from './match/coach';
import { simulateGame } from './match/gameSim';
import { buildLineup } from './match/lineup';
import { migrateLeague } from './migrate';
import { Rng } from './rng';
import { lineOrder } from './roster';
import { COVERAGE_IDS, FRONT_IDS, OFF_SCHEME_IDS, OFF_SCHEMES, spotsFor, type CoachScheme } from './schemes';
import { skill } from './attributes';
import type { League, StatLine } from './types';

const copy = <T>(x: T): T => JSON.parse(JSON.stringify(x));

/** Every coordinator of a side runs `scheme` (a fresh copy, so the coaching index is rebuilt). */
function withSchemes(base: League, offense: CoachScheme['offense'], front?: CoachScheme['front'], coverage?: CoachScheme['coverage']): League {
  const l = copy(base);
  for (const c of Object.values(l.coaches)) {
    if (c.role === 'offCoord' && offense) c.scheme = { offense };
    if (c.role === 'defCoord' && front) c.scheme = { front, coverage };
  }
  return l;
}

function season(l: League, games = 96) {
  const totals: StatLine = {};
  const byPos: Record<string, number> = {};
  for (const g of l.games.slice(0, games)) {
    const r = simulateGame(l, g);
    for (const [id, line] of Object.entries(r.playerStats)) {
      for (const [k, v] of Object.entries(line)) totals[k as keyof StatLine] = (totals[k as keyof StatLine] ?? 0) + v;
      const pos = l.players[Number(id)].position;
      byPos[`${pos}:targets`] = (byPos[`${pos}:targets`] ?? 0) + (line.targets ?? 0);
    }
  }
  return { totals, byPos };
}

describe('schemes', () => {
  const league = createLeague({ seed: 'schemes' });

  it('gives every coordinator a scheme from his own stream, and old saves the same ones', () => {
    for (const c of Object.values(league.coaches)) {
      if (c.role === 'offCoord') expect(OFF_SCHEME_IDS).toContain(c.scheme?.offense);
      else if (c.role === 'defCoord') {
        expect(FRONT_IDS).toContain(c.scheme?.front);
        expect(COVERAGE_IDS).toContain(c.scheme?.coverage);
      } else expect(c.scheme).toBeUndefined();
    }
    const old = copy(league);
    old.version = 9;
    for (const c of Object.values(old.coaches)) delete c.scheme;
    const up = migrateLeague(old)!;
    expect(up.version).toBe(SAVE_VERSION);
    expect(up.coaches).toEqual(league.coaches);
  });

  it('names the spots by personnel and front', () => {
    const power = teamScheme(withSchemes(league, 'power', 'threeFour', 'cover1'), 0);
    expect(spotsFor(power, 'TE')).toEqual(['Y', 'F']);
    expect(spotsFor(power, 'WR')).toHaveLength(2);
    expect(spotsFor(power, 'EDGE')).toEqual(['ROLB', 'LOLB']);
    const raid = teamScheme(withSchemes(league, 'airRaid', 'fourThree', 'cover2'), 0);
    expect(spotsFor(raid, 'WR')).toHaveLength(4);
    expect(spotsFor(raid, 'TE')).toHaveLength(0);
    expect(spotsFor(raid, 'OL')).toEqual(['LT', 'LG', 'C', 'RG', 'RT']);
  });

  it('weighs the rush and the run defense by the front', () => {
    const wide = buildLineup(withSchemes(league, undefined, 'wide9', 'cover3'), league.teams[0]);
    const twoGap = buildLineup(withSchemes(league, undefined, 'threeFour', 'cover3'), league.teams[0]);
    expect(wide.passRush).toBeGreaterThan(twoGap.passRush);
    expect(twoGap.runStop).toBeGreaterThan(wide.runStop);
    expect(twoGap.edgeContain).toBeGreaterThan(wide.edgeContain);
  });

  it('calls more blitzes in a fire zone and throws deeper in Air Coryell', () => {
    const s: Situation = { quarter: 1, clock: 600, down: 3, distance: 8, yardLine: 40, scoreDiff: 0, offTimeouts: 3, defTimeouts: 3, overtime: false, fgMakeProb: 0.5 };
    const count = (blitz: number) => {
      const rng = new Rng('blitz');
      let n = 0;
      for (let i = 0; i < 4000; i++) if (defenseCall({ ...s, blitz }, rng) === 'blitz') n++;
      return n;
    };
    expect(count(1.7)).toBeGreaterThan(count(1) * 1.4);
    const deep = (depthLean?: [number, number, number]) => {
      const rng = new Rng('depth');
      let n = 0;
      for (let i = 0; i < 4000; i++) if (passDepth({ ...s, down: 1, distance: 10, depthLean }, rng) === 'deep') n++;
      return n;
    };
    expect(deep(OFF_SCHEMES.vertical.depth)).toBeGreaterThan(deep() * 1.25);
  });

  it('puts the ball where the personnel is: two tight ends in Power, four wide in Air Raid', () => {
    const power = season(withSchemes(league, 'power'));
    const raid = season(withSchemes(league, 'airRaid'));
    const teShare = (r: ReturnType<typeof season>) => r.byPos['TE:targets'] / (r.byPos['TE:targets'] + r.byPos['WR:targets']);
    expect(teShare(power)).toBeGreaterThan(teShare(raid) + 0.15);
  }, 60_000);

  it('credits every sack to a rusher and most to a blocker, and replays the same', () => {
    const { totals } = season(league, 48);
    expect(totals.pressures).toBeGreaterThan(totals.sacks! * 3);
    expect(totals.qbHits).toBeGreaterThan(totals.sacks!);
    expect(totals.sacksAllowed).toBeLessThan(totals.sacks!);
    expect(totals.sacksAllowed).toBeGreaterThan(totals.sacks! * 0.5);
    expect(totals.pressuresAllowed).toBeLessThanOrEqual(totals.pressures!);
    // The credit has its own random stream: a game still replays exactly.
    const g = league.games[0];
    const strip = (r: ReturnType<typeof simulateGame>) => ({ ...r, playerStats: undefined });
    expect(strip(simulateGame(league, g))).toEqual(strip(simulateGame(league, g)));
  }, 60_000);

  it('lines up the best pass protectors at tackle', () => {
    const team = league.teams[0];
    const ol = team.depthChart.OL.map((id) => league.players[id]);
    const [lt, lg, c, rg, rt] = lineOrder(ol);
    for (const inside of [lg, c, rg]) {
      expect(skill(lt, 'passPro')).toBeGreaterThanOrEqual(skill(inside, 'passPro'));
      expect(skill(rt, 'passPro')).toBeGreaterThanOrEqual(skill(inside, 'passPro'));
    }
  });
});
