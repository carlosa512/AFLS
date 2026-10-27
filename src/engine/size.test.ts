import { describe, expect, it } from 'vitest';
import { createLeague, generatePlayer, SAVE_VERSION } from './generate';
import { migrateLeague } from './migrate';
import { simulateGame } from './match/gameSim';
import { Rng } from './rng';
import { teamPlayers } from './roster';
import { buildLineup } from './match/lineup';
import { teamCoaches } from './coaching';
import { changePosition } from './training';
import {
  FLAT_BODY,
  isOutlier,
  massEdge,
  rollGem,
  rushSizeEdge,
  rollSize,
  SIZE,
  sizeEdge,
  sizeLimits,
  sizeZ,
} from './size';
import { POSITIONS, type Player, type Position } from './types';

const stats = (xs: number[]) => {
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const sd = Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length);
  return { mean, sd };
};

describe('rollSize', () => {
  it('costs exactly two draws', () => {
    const a = new Rng('x');
    const b = new Rng('x');
    rollSize(a, 'CB');
    b.next();
    b.next();
    expect(a.next()).toBe(b.next());
  });

  it('matches the table at every position', () => {
    const rng = new Rng('size');
    for (const pos of POSITIONS) {
      const rolls = Array.from({ length: 20_000 }, () => rollSize(rng, pos));
      const h = stats(rolls.map((r) => r.heightIn));
      const w = stats(rolls.map((r) => r.weightLb));
      const lim = sizeLimits(pos);
      expect(Math.abs(h.mean - SIZE[pos].h[0]), pos).toBeLessThan(0.2);
      expect(Math.abs(w.mean - SIZE[pos].w[0]), pos).toBeLessThan(2);
      expect(Math.abs(h.sd / SIZE[pos].h[1] - 1), pos).toBeLessThan(0.1);
      const hs = rolls.map((r) => r.heightIn);
      const ws = rolls.map((r) => r.weightLb);
      expect(Math.min(...hs), pos).toBeGreaterThanOrEqual(lim.h[0]);
      expect(Math.max(...hs), pos).toBeLessThanOrEqual(lim.h[1]);
      expect(Math.min(...ws), pos).toBeGreaterThanOrEqual(lim.w[0]);
      expect(Math.max(...ws), pos).toBeLessThanOrEqual(lim.w[1]);
    }
  });

  it('ties weight to height', () => {
    const rng = new Rng('corr');
    const rolls = Array.from({ length: 20_000 }, () => rollSize(rng, 'CB'));
    const h = stats(rolls.map((r) => r.heightIn));
    const w = stats(rolls.map((r) => r.weightLb));
    const cov = rolls.reduce((a, r) => a + (r.heightIn - h.mean) * (r.weightLb - w.mean), 0) / rolls.length;
    const r = cov / (h.sd * w.sd);
    expect(r).toBeGreaterThan(0.4);
    expect(r).toBeLessThan(0.6);
  });
});

describe('sizeZ and isOutlier', () => {
  it('is zero at the median', () => {
    expect(sizeZ({ position: 'CB', heightIn: 72, weightLb: 195 })).toEqual({ h: 0, w: 0 });
    expect(sizeZ({ position: 'CB', heightIn: 69.7, weightLb: 195 }).h).toBeCloseTo(-1, 5);
  });

  it('reads against another position when asked', () => {
    expect(sizeZ({ position: 'CB', heightIn: 72.5, weightLb: 210 }, 'S')).toEqual({ h: 0, w: 0 });
  });

  it('flags the tails only', () => {
    expect(isOutlier({ position: 'CB', heightIn: 68, weightLb: 190 })).toBe(true);
    expect(isOutlier({ position: 'CB', heightIn: 72, weightLb: 195 })).toBe(false);
  });
});

describe('generation', () => {
  const make = (pos: (typeof POSITIONS)[number], i: number) =>
    generatePlayer(new Rng(`size-gen:${pos}:${i}`), {
      id: 3_000_000 + i,
      position: pos,
      quality: 11,
      age: 22,
      teamId: null,
      jerseysUsed: new Set(),
    });
  const corners = Array.from({ length: 2_000 }, (_, i) => make('CB', i));

  it('rolls new players from the bell curve', () => {
    const short = corners.filter((p) => p.heightIn <= 69).length / corners.length;
    expect(short).toBeGreaterThan(0.11);
    expect(short).toBeLessThan(0.17);
    expect(Math.min(...corners.map((p) => p.heightIn))).toBeGreaterThanOrEqual(sizeLimits('CB').h[0]);
    // The old flat roll stopped at 5'9" and 6'2": the tails are what the curve adds.
    expect(corners.some((p) => p.heightIn < 69)).toBe(true);
    expect(corners.some((p) => p.heightIn > 74)).toBe(true);
  });

  it('clamps weight to the new curve on a position move', () => {
    const l = createLeague({ seed: 'size-move' });
    const ol = teamPlayers(l, 0).find((p) => p.position === 'OL')!;
    ol.weightLb = 380;
    changePosition(l, ol, 'DT');
    expect(ol.weightLb).toBe(sizeLimits('DT').w[1]);
  });
});

describe('sizeEdge', () => {
  const at = (position: Position, heightIn: number, weightLb: number, playsBig = false) =>
    ({
      position,
      heightIn,
      weightLb,
      ...(playsBig ? { playsBig: true } : {}),
      ratings: { speed: 10 },
    }) as unknown as Player;
  const median = (pos: Position) => at(pos, SIZE[pos].h[0], SIZE[pos].w[0]);

  it('is zero when both builds sit at their medians', () => {
    expect(sizeEdge(median('WR'), 'contested', median('CB'))).toBe(0);
    expect(sizeEdge(median('TE'), 'contested', median('S'))).toBe(0);
    expect(sizeEdge(median('RB'), 'contact', median('LB'))).toBe(0);
    expect(sizeEdge(median('WR'), 'press', median('CB'))).toBe(0);
    expect(sizeEdge(median('DT'), 'leverage', median('OL'))).toBe(0);
    expect(sizeEdge(median('EDGE'), 'edgeLength', median('OL'))).toBe(0);
    expect(sizeEdge(median('QB'), 'lanes')).toBe(0);
    expect(massEdge([median('OL'), median('OL')], [median('DT'), median('EDGE')])).toBe(0);
  });

  it('gives a tall receiver the jump ball over a small corner, capped at two points', () => {
    const wr = at('WR', 77, 215);
    const cb = at('CB', 69.5, 182);
    expect(sizeEdge(wr, 'contested', cb)).toBe(2);
    expect(sizeEdge(cb, 'contested', wr)).toBe(-2);
    const close = at('WR', 74, 200);
    expect(sizeEdge(close, 'contested', median('CB'))).toBeCloseTo(-sizeEdge(median('CB'), 'contested', close), 10);
  });

  it('halves a loss for a player who plays bigger than his size, and never adds a gain', () => {
    const wr = at('WR', 77, 215);
    expect(sizeEdge(at('CB', 69.5, 182, true), 'contested', wr)).toBe(-1);
    expect(sizeEdge(at('WR', 77, 215, true), 'contested', at('CB', 69.5, 182))).toBe(2);
    // The gem protects whichever side holds it: the receiver's gain over a gem corner is halved too.
    expect(sizeEdge(wr, 'contested', at('CB', 69.5, 182, true))).toBe(1);
    expect(sizeEdge(median('EDGE'), 'edgeLength', at('OL', 72, 300, true))).toBeCloseTo(
      sizeEdge(median('EDGE'), 'edgeLength', at('OL', 72, 300)) / 2,
      10,
    );
  });

  it('gives the short tackle trouble, the short tackle on a DT leverage, and a tall QB his lanes', () => {
    expect(sizeEdge(median('EDGE'), 'edgeLength', at('OL', 74, 313))).toBeGreaterThan(0);
    expect(sizeEdge(at('DT', 73, 300), 'leverage', at('OL', 78, 313))).toBeGreaterThan(0);
    expect(sizeEdge(at('QB', 71, 210), 'lanes')).toBeLessThan(0);
    expect(sizeEdge(at('QB', 77, 235), 'lanes')).toBeGreaterThan(0);
    expect(massEdge([at('OL', 77, 340)], [at('DT', 75, 290)])).toBeGreaterThan(0);
  });
});

describe('the rare gem', () => {
  const make = (pos: (typeof POSITIONS)[number], i: number) =>
    generatePlayer(new Rng(`size-gem:${pos}:${i}`), {
      id: 4_000_000 + i,
      position: pos,
      quality: 11,
      age: 22,
      teamId: null,
      jerseysUsed: new Set(),
    });
  const players = Array.from({ length: 4_000 }, (_, i) => make(POSITIONS[i % 10], i));

  it('makes about a quarter of the outliers play bigger than their size, and nobody else', () => {
    const outliers = players.filter((p) => isOutlier(p));
    const rate = outliers.filter((p) => p.playsBig).length / outliers.length;
    expect(rate).toBeGreaterThan(0.2);
    expect(rate).toBeLessThan(0.3);
    expect(players.filter((p) => p.playsBig && !isOutlier(p))).toEqual([]);
    expect(rollGem(players[0])).toBe(rollGem(players[0]));
  });

  it('rolls the gem for an older save from the same stream a new league uses', () => {
    const l = createLeague({ seed: 'size-v55' });
    const before = Object.values(l.players).map((p) => [p.id, p.playsBig ?? false]);
    for (const p of Object.values(l.players)) delete p.playsBig;
    l.version = 55;
    const m = migrateLeague(l)!;
    expect(m.version).toBe(SAVE_VERSION);
    expect(Object.values(m.players).map((p) => [p.id, p.playsBig ?? false])).toEqual(before);
  });
});

describe('rushSizeEdge', () => {
  const at = (position: Position, heightIn: number, weightLb = SIZE[position].w[0]) =>
    ({ position, heightIn, weightLb, ratings: { speed: 12 } }) as unknown as Player;
  const line = (h: number) => [at('OL', h), at('OL', 76.75), at('OL', 76.75), at('OL', 76.75), at('OL', h)];

  it('is zero for median units and grows against short tackles', () => {
    expect(rushSizeEdge(line(76.75), [at('EDGE', 76.5), at('EDGE', 76.5)], [at('DT', 75.5)])).toBe(0);
    expect(rushSizeEdge(line(74), [at('EDGE', 76.5), at('EDGE', 76.5)], [at('DT', 75.5)])).toBeGreaterThan(0);
  });

  it('copes with missing players without NaN', () => {
    expect(rushSizeEdge([], [], [])).toBe(0);
    expect(rushSizeEdge(line(74).slice(0, 2), [at('EDGE', 76.5)], [])).not.toBeNaN();
    expect(rushSizeEdge(line(74), [], [at('DT', 73), at('DT', 73), at('DT', 73)])).toBeGreaterThan(0);
  });

  it('plays a real game with a line two men short without a NaN', () => {
    const l = createLeague({ seed: 'size-short-line' });
    const team = l.teams[0];
    team.autoDepth = false;
    team.depthChart.OL = team.depthChart.OL.slice(0, 2);
    team.depthChart.DT = team.depthChart.DT.slice(0, 3);
    const game = l.games.find((g) => g.homeId === team.id || g.awayId === team.id)!;
    const r = simulateGame(l, game, { keepPlays: false });
    for (const side of [r.home, r.away])
      for (const v of [side.passYds, side.rushYds, side.sacked]) expect(Number.isFinite(v)).toBe(true);
  });
});

describe('an older save', () => {
  it("moves the flat builds onto each position's curve, keeping every player's rank", () => {
    const l = createLeague({ seed: 'size-v55-flat' });
    const rng = new Rng('flat');
    for (const p of Object.values(l.players)) {
      const [hMin, hMax, wMin, wMax] = FLAT_BODY[p.position];
      p.heightIn = rng.int(hMin, hMax);
      p.weightLb = rng.int(wMin, wMax);
    }
    const before = Object.values(l.players).map((p) => ({ id: p.id, pos: p.position, h: p.heightIn, w: p.weightLb }));
    l.version = 54;
    const m = migrateLeague(l)!;
    expect(m.version).toBe(SAVE_VERSION);
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    for (const pos of ['OL', 'EDGE', 'CB', 'WR'] as const) {
      const ps = Object.values(m.players).filter((p) => p.position === pos);
      expect(Math.abs(mean(ps.map((p) => p.heightIn)) - SIZE[pos].h[0]), pos).toBeLessThan(0.6);
      expect(Math.abs(mean(ps.map((p) => p.weightLb)) - SIZE[pos].w[0]), pos).toBeLessThan(5);
    }
    // A taller man before is never shorter after.
    for (const a of before.slice(0, 300))
      for (const b of before.slice(0, 300))
        if (a.pos === b.pos && a.h < b.h)
          expect(m.players[a.id].heightIn).toBeLessThanOrEqual(m.players[b.id].heightIn);
  });
});

describe('a four-wide offense down to two receivers', () => {
  it('builds its lineup without a slot receiver to read', () => {
    const l = createLeague({ seed: 'size-four-wide' });
    const team = l.teams[0];
    const oc = teamCoaches(l, team.id).find((c) => c.role === 'offCoord')!;
    oc.scheme = { ...oc.scheme, offense: 'airRaid' };
    // Everyone who could line up wide is out but two receivers: no slot to block on the run.
    const wrs = teamPlayers(l, team.id).filter((p) => p.position === 'WR');
    const out = new Set([
      ...wrs.slice(2).map((p) => p.id),
      ...teamPlayers(l, team.id)
        .filter((p) => p.position === 'TE' || p.position === 'RB' || p.position === 'CB' || p.position === 'S')
        .map((p) => p.id),
    ]);
    const lineup = buildLineup(l, team, out);
    expect(Number.isFinite(lineup.runBlock)).toBe(true);
  });
});
