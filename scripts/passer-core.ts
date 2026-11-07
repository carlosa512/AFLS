/**
 * The passer check (spec: docs/superpowers/specs/2026-11-05-passer-under-pressure-design.md, §7): what a passer does
 * with his dropback (sacked, a scramble, a throwaway) by situation, pressured and clean, against the NFL's; where his
 * throwaways come from; intentional grounding; and how far the league's passers differ. NFL numbers from
 * `scripts/research-passer.py` (FTN charting, NGS pressure and nflverse play-by-play, regular seasons 2023–25). Used by
 * `npm run passer` (fast, AI games) and `npm run sim`, from the engine's own decisions (`SimOptions.dropbackTap`).
 */
import type { DropbackTap } from '../src/engine/match/gameSim';
import type { Line } from './sideline-core';

type Side = 'pressured' | 'clean';
type Bucket =
  | 'all'
  | 'early'
  | 'third short'
  | 'third mid'
  | 'third long'
  | 'fourth'
  | 'red zone'
  | 'backed up'
  | 'trailing late';

/** The NFL's shares of dropbacks: sacked, scrambled, thrown away (and n), by pressure and bucket. */
export const PASSER_NFL: Record<Side, Record<Bucket, [sack: number, run: number, away: number, n: number]>> = {
  pressured: {
    all: [0.2204, 0.0763, 0.0906, 18187],
    early: [0.196, 0.0744, 0.1051, 11594],
    'third short': [0.2403, 0.0917, 0.0769, 949],
    'third mid': [0.272, 0.0769, 0.0631, 3187],
    'third long': [0.2775, 0.0802, 0.0727, 1870],
    fourth: [0.2095, 0.0716, 0.0307, 587],
    'red zone': [0.1955, 0.0715, 0.1353, 2558],
    'backed up': [0.1579, 0.0842, 0.1132, 380],
    'trailing late': [0.2143, 0.066, 0.097, 1484],
  },
  clean: {
    all: [0, 0.0425, 0.0123, 42356],
    early: [0, 0.0388, 0.0132, 30733],
    'third short': [0, 0.0551, 0.0081, 2089],
    'third mid': [0, 0.0507, 0.0088, 5327],
    'third long': [0, 0.0535, 0.0107, 3180],
    fourth: [0, 0.0516, 0.0146, 1027],
    'red zone': [0, 0.0508, 0.0207, 5568],
    'backed up': [0, 0.0289, 0.0087, 1038],
    'trailing late': [0.0006, 0.0437, 0.0145, 3110],
  },
};
/** Throwaways from outside the pocket: all, pressured, clean. */
const OUTSIDE_NFL = { all: 0.604, pressured: 0.676, clean: 0.377 };
/** Intentional grounding: flags a game (declined and offsetting included, as the play text counts them), the share
 * under pressure, safeties a season. */
const GROUNDING_NFL = { perGame: 0.192, pressured: 0.884, safeties: 1.3 };
/** Passers with 250+ dropbacks in a season: sd of their scramble and throwaway shares of all dropbacks. */
const SPREAD_NFL = { run: 0.027, away: 0.0144 };
const SPREAD_MIN = 250;

interface Count {
  n: number;
  sack: number;
  run: number;
  away: number;
}
const zero = (): Count => ({ n: 0, sack: 0, run: 0, away: 0 });

export interface PasserTally {
  buckets: Record<Side, Record<Bucket, Count>>;
  /** Throwaways, and those from outside the pocket, by side. */
  away: Record<Side, [all: number, outside: number]>;
  grounded: { all: number; pressured: number };
  /** Each passer's dropbacks, scrambles and throwaways, keyed by league and id. */
  passers: Map<string, Count>;
}

export function newPasserTally(): PasserTally {
  const side = () => Object.fromEntries(Object.keys(PASSER_NFL.clean).map((b) => [b, zero()])) as Record<Bucket, Count>;
  return {
    buckets: { pressured: side(), clean: side() },
    away: { pressured: [0, 0], clean: [0, 0] },
    grounded: { all: 0, pressured: 0 },
    passers: new Map(),
  };
}

function bucketsOf(t: DropbackTap): Bucket[] {
  const out: Bucket[] = ['all'];
  if (t.down <= 2) out.push('early');
  else if (t.down === 3) out.push(t.toGo <= 3 ? 'third short' : t.toGo <= 9 ? 'third mid' : 'third long');
  else out.push('fourth');
  if (t.toGoal <= 20) out.push('red zone');
  if (t.toGoal >= 90) out.push('backed up');
  if (t.trailingLate) out.push('trailing late');
  return out;
}

/** One dropback, as the engine tapped it; `who` keys the passer across leagues. */
export function tapDropback(t: PasserTally, tap: DropbackTap, who: string): void {
  const side: Side = tap.pressured ? 'pressured' : 'clean';
  const add = (c: Count) => {
    c.n++;
    if (tap.call === 'sack') c.sack++;
    if (tap.call === 'run') c.run++;
    if (tap.call === 'away') c.away++;
  };
  for (const b of bucketsOf(tap)) add(t.buckets[side][b]);
  let p = t.passers.get(who);
  if (!p) t.passers.set(who, (p = zero()));
  add(p);
  if (tap.call === 'away') {
    t.away[side][0]++;
    if (tap.outside) t.away[side][1]++;
    if (tap.grounded) {
      t.grounded.all++;
      if (tap.pressured) t.grounded.pressured++;
    }
  }
}

const pct = (k: number, n: number) => (n ? (100 * k) / n : NaN);

/** Each bucket's scramble and throwaway shares (and the sack share under pressure, reported: the pressure and sack
 * odds are today's, and the engine's pressure isn't NGS's), pressured and clean. */
export function judgePasser(t: PasserTally): Line[] {
  const lines: Line[] = [];
  for (const side of ['pressured', 'clean'] as const)
    for (const [b, nfl] of Object.entries(PASSER_NFL[side]) as [Bucket, (typeof PASSER_NFL)[Side][Bucket]][]) {
      const c = t.buckets[side][b];
      const parts: [string, number, number, boolean][] = [
        ['scramble', c.run, nfl[1], false],
        ['throwaway', c.away, nfl[2], false],
      ];
      if (side === 'pressured') parts.unshift(['sacked', c.sack, nfl[0], true]);
      for (const [what, k, share, info] of parts) {
        const real = 100 * share;
        // The whole side is held close; a bucket by a quarter of its share (half a point at least).
        const tol = b === 'all' ? Math.max(0.12 * real, 0.3) : Math.max(0.25 * real, 0.5);
        // Too few plays to judge: luck alone moves the share by more than the tolerance allows (3.5 standard errors).
        const se = 100 * Math.sqrt((share * (1 - share)) / Math.max(1, c.n));
        const few = tol < 3.5 * se;
        // A bucket's scramble share swings with the league (`band.ts`): how often passers take off depends on how mobile
        // a world's quarterback pool is (four 60-season worlds ran the pressured third-and-mid bucket 8.7 to 10.0, with
        // 0.4 of sampling error), so a world a point off the NFL warns and only one past 40% of the share fails (the
        // owner's call, Nov 7). The whole side keeps its tight range, so the engine's centre is still held.
        const normal: [number, number] | undefined =
          what === 'scramble' && b !== 'all' ? [Math.max(0, real * 0.6), real * 1.4] : undefined;
        lines.push({
          label: `${side}, ${b}: ${what} %`,
          value: pct(k, c.n),
          range: [Math.max(0, real - tol), real + tol],
          ...(normal ? { normal } : {}),
          note: `NFL ${real.toFixed(2)} (n=${c.n})${few ? ', too few to judge' : ''}`,
          ...(info || few ? { info: true } : {}),
        });
      }
    }
  return lines;
}

/** Where throwaways come from and how often they're flagged, per game played. */
export function groundingLines(t: PasserTally, games: number): Line[] {
  const [pa, po] = t.away.pressured;
  const [ca, co] = t.away.clean;
  const out = (k: number, n: number, real: number, label: string): Line => ({
    label: `throwaways from outside the pocket, ${label}`,
    value: n ? k / n : NaN,
    range: [real - 0.07, real + 0.07],
    note: `NFL ${real} (n=${n})`,
  });
  return [
    out(po + co, pa + ca, OUTSIDE_NFL.all, 'all'),
    out(po, pa, OUTSIDE_NFL.pressured, 'pressured'),
    out(co, ca, OUTSIDE_NFL.clean, 'clean'),
    {
      label: 'intentional grounding flags a game',
      value: t.grounded.all / Math.max(1, games),
      range: [GROUNDING_NFL.perGame * 0.75, GROUNDING_NFL.perGame * 1.25],
      note: `NFL ${GROUNDING_NFL.perGame} (${t.grounded.all} in ${games} games)`,
    },
    {
      label: 'intentional grounding: share under pressure',
      value: t.grounded.all ? t.grounded.pressured / t.grounded.all : NaN,
      range: [GROUNDING_NFL.pressured - 0.08, Math.min(1, GROUNDING_NFL.pressured + 0.08)],
      note: `NFL ${GROUNDING_NFL.pressured}`,
    },
  ];
}

/** How far passers differ: sd of each passer's scramble and throwaway shares of his dropbacks, over passers with 250+
 * (sampling noise included on both sides, as the NFL's seasons carry it), against the NFL's ± 30%. */
export function passerSpread(t: PasserTally): Line[] {
  const ps = [...t.passers.values()].filter((p) => p.n >= SPREAD_MIN);
  const sd = (xs: number[]) => {
    const m = xs.reduce((a, b) => a + b, 0) / xs.length;
    return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length);
  };
  return (['run', 'away'] as const).map((k) => ({
    label: `spread between passers, ${k === 'run' ? 'scrambles' : 'throwaways'} (sd of share)`,
    value: ps.length >= 10 ? sd(ps.map((p) => p[k] / p.n)) : NaN,
    range: [SPREAD_NFL[k] * 0.7, SPREAD_NFL[k] * 1.3] as [number, number],
    note: `NFL ${SPREAD_NFL[k]} (${ps.length} passers with ${SPREAD_MIN}+ dropbacks)`,
  }));
}
