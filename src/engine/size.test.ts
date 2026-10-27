import { describe, expect, it } from 'vitest';
import { createLeague, generatePlayer, SAVE_VERSION } from './generate';
import { migrateLeague } from './migrate';
import { simulateGame } from './match/gameSim';
import { Rng } from './rng';
import { lineOrder, spotNotes, spotOrder, teamPlayers } from './roster';
import { buildNote } from './scouting';
import { heightMismatch } from './inbox';
import { boardScore } from './offseason/draft';
import { sizeBias } from './gmTraits';
import { changePosition, conversionRead } from './training';
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
import { ATTRIBUTES, POSITIONS, type Player, type Position, type Ratings } from './types';

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

describe('spot fit', () => {
  let n = 0;
  const player = (
    position: Position,
    heightIn: number,
    weightLb: number,
    set: Partial<Record<string, number>> = {},
  ) => {
    const ratings = Object.fromEntries(ATTRIBUTES.map((a) => [a, 12])) as Ratings;
    Object.assign(ratings, set);
    return { id: ++n, position, heightIn, weightLb, ratings, traits: {} } as unknown as Player;
  };

  it('puts the tall corners outside and the small one at nickel, behind them the bench as it was', () => {
    const [small, tall, mid, bench] = [
      player('CB', 69, 182),
      player('CB', 74, 200),
      player('CB', 72, 195),
      player('CB', 70, 185),
    ];
    expect(spotOrder([small, tall, mid, bench], 'CB').map((p) => p.id)).toEqual([tall.id, mid.id, small.id, bench.id]);
  });

  it('keeps an elite small corner outside', () => {
    const star = player('CB', 69, 182, { coverage: 19, agility: 18 });
    const [a, b] = [player('CB', 74, 200), player('CB', 73, 198)];
    expect(spotOrder([star, a, b], 'CB').slice(0, 2)).toContain(star);
  });

  it('puts the big receivers at X and Z and the small one in the slot', () => {
    const [small, big, mid] = [player('WR', 69, 180), player('WR', 76, 215), player('WR', 73, 200)];
    expect(spotOrder([small, big, mid], 'WR').map((p) => p.id)).toEqual([big.id, mid.id, small.id]);
  });

  it('only chooses X against Z for an offense with two receiver spots', () => {
    const [small, big, mid] = [player('WR', 69, 180), player('WR', 76, 215), player('WR', 73, 200)];
    expect(spotOrder([small, mid, big], 'WR', 2).map((p) => p.id)).toEqual([mid.id, small.id, big.id]);
  });

  it('copes with short rooms', () => {
    const one = [player('CB', 69, 182)];
    expect(spotOrder(one, 'CB')).toEqual(one);
    const two = [player('CB', 69, 182), player('CB', 74, 200)];
    expect(new Set(spotOrder(two, 'CB'))).toEqual(new Set(two));
    expect(spotOrder([], 'WR')).toEqual([]);
    const dt = [player('DT', 74, 290)];
    expect(spotOrder(dt, 'DT')).toEqual(dt);
  });

  it('sends the long lineman to tackle when protection is level', () => {
    const line = [
      player('OL', 79, 315),
      player('OL', 76, 315),
      player('OL', 76, 315),
      player('OL', 74, 315),
      player('OL', 76, 315),
    ];
    const order = lineOrder(line);
    expect([order[0], order[4]]).toContain(line[0]);
    expect([order[0], order[4]]).not.toContain(line[3]);
  });

  it('never changes who starts', () => {
    const corners = Array.from({ length: 6 }, (_, i) => player('CB', 68 + i, 185 + 3 * i, { coverage: 10 + i }));
    const sorted = spotOrder(corners, 'CB');
    expect(new Set(sorted.slice(0, 3))).toEqual(new Set(corners.slice(0, 3)));
    expect(sorted.slice(3)).toEqual(corners.slice(3));
  });
});

describe('a move for his build', () => {
  it("reads a linebacker's build on a backup safety as a reason, and a median safety's as none", () => {
    const l = createLeague({ seed: 'size-build-move' });
    const team = l.teams[0].id;
    const safeties = teamPlayers(l, team).filter((p) => p.position === 'S');
    const backup = safeties.find((p) => l.teams[0].depthChart.S.indexOf(p.id) >= 2) ?? safeties.at(-1)!;
    for (const a of ['tackling', 'runStop', 'awareness', 'coverage', 'speed', 'passRush'] as const)
      backup.ratings[a] = 18;
    // The safeties ahead of him stay ahead: a backup's move costs his old room nothing.
    for (const p of safeties.filter((x) => x !== backup))
      for (const a of ['coverage', 'awareness', 'tackling', 'speed', 'catching', 'runStop'] as const) p.ratings[a] = 20;
    backup.heightIn = 74;
    backup.weightLb = 242;
    expect(conversionRead(l, backup, 'LB').motives.map((m) => m.reason)).toContain('build');
    backup.heightIn = SIZE.S.h[0];
    backup.weightLb = SIZE.S.w[0];
    expect(conversionRead(l, backup, 'LB').motives.map((m) => m.reason)).not.toContain('build');
  });
});

describe('size in words', () => {
  const l = createLeague({ seed: 'size-words' });
  const mine = (pos: Position) => teamPlayers(l, l.userTeamId).find((p) => p.position === pos)!;

  it('says something only about an outlier build, and never a number', () => {
    const cb = mine('CB');
    cb.heightIn = SIZE.CB.h[0];
    cb.weightLb = SIZE.CB.w[0];
    expect(buildNote(l, l.userTeamId, cb)).toBeNull();
    cb.heightIn = 68;
    const note = buildNote(l, l.userTeamId, cb)!;
    expect(note).toMatch(/slot/);
    expect(note).not.toMatch(/\d/);
  });

  it("tells our own player's gem, plainly", () => {
    const cb = mine('CB');
    cb.heightIn = 68;
    cb.playsBig = true;
    expect(buildNote(l, l.userTeamId, cb)).toMatch(/plays bigger than his size/);
    delete cb.playsBig;
    expect(buildNote(l, l.userTeamId, cb)).not.toMatch(/plays bigger/);
  });

  it("flags a hand-sorted chart that plays a small corner outside, where auto-sort wouldn't", () => {
    const team = l.teams[l.userTeamId];
    team.autoDepth = false;
    const cbs = team.depthChart.CB.slice(0, 3).map((id) => l.players[id]);
    for (const p of cbs) {
      for (const a of ['coverage', 'agility', 'awareness', 'speed'] as const) p.ratings[a] = 12;
      p.heightIn = SIZE.CB.h[0];
      p.weightLb = SIZE.CB.w[0];
      delete p.injury;
    }
    const outside = cbs[0];
    outside.heightIn = 68;
    outside.weightLb = 178;
    expect(spotNotes(l, l.userTeamId).map((n) => n.playerId)).toContain(outside.id);
    // An elite small corner: the auto-sort keeps him outside too, so the coach says nothing.
    outside.ratings.coverage = 20;
    outside.ratings.agility = 19;
    expect(spotNotes(l, l.userTeamId).map((n) => n.playerId)).not.toContain(outside.id);
    team.autoDepth = true;
    expect(spotNotes(l, l.userTeamId)).toEqual([]);
  });

  it('marks an undersized prospect down on a measurables GM’s board, never on a tape GM’s', () => {
    const p = mine('CB');
    p.heightIn = 68;
    const board = { grade: 12, ceiling: 13 };
    const depth = Object.fromEntries(POSITIONS.map((x) => [x, [12, 12, 12, 12]])) as Record<Position, number[]>;
    const score = (bias: number) => boardScore(depth, p, board, new Rng('same'), 2, bias);
    expect(score(1)).toBeLessThan(score(0));
    p.heightIn = SIZE.CB.h[0];
    p.weightLb = SIZE.CB.w[0];
    expect(score(1)).toBe(score(0));
    expect(sizeBias('a', 7)).toBe(sizeBias('a', 7));
    expect(sizeBias('a', 7)).not.toBe(sizeBias('b', 7));
    expect(sizeBias('a', 7)).toBeGreaterThanOrEqual(0);
    expect(sizeBias('a', 7)).toBeLessThan(1);
  });
});

describe('the opposition report', () => {
  it('names the height their receiver has on our corner, only when it decides a jump ball', () => {
    const l = createLeague({ seed: 'size-opposition' });
    const opp = l.teams.find((t) => t.id !== l.userTeamId)!;
    const x = l.players[opp.depthChart.WR[0]];
    const cb = l.players[l.teams[l.userTeamId].depthChart.CB[0]];
    for (const p of [...opp.depthChart.WR, ...l.teams[l.userTeamId].depthChart.CB].map((id) => l.players[id])) {
      p.heightIn = SIZE[p.position].h[0];
      p.weightLb = SIZE[p.position].w[0];
    }
    expect(heightMismatch(l, opp)).toBeNull();
    x.heightIn = 77;
    cb.heightIn = 69;
    expect(heightMismatch(l, opp)).toBe(
      `Their X receiver ${x.firstName} ${x.lastName} has 8 inches on ${cb.firstName} ${cb.lastName}: a contested ball between them is his to win.`,
    );
  });
});
