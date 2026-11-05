/**
 * The fumbles check (spec: docs/superpowers/specs/2026-11-05-fumbles-on-contact-design.md, §5): contact fumbles on runs,
 * catches and scrambles by what's known before the snap, the forced share, lost per 100 and the spread between backs,
 * against nflverse 2021–25 (`scripts/research-fumbles.py`). Used by `npm run fumbles` (fast, AI games) and `npm run sim`,
 * from the engine's own decisions (`SimOptions.contactTap`).
 */
import type { ContactTap } from '../src/engine/match/gameSim';
import type { ContactKind } from '../src/engine/match/fumbleOdds';
import type { Line } from './sideline-core';

type Bucket =
  | 'all'
  | 'early'
  | 'third short'
  | 'third mid'
  | 'third long'
  | 'fourth'
  | 'trailing late'
  | 'leading late';

/** The NFL's fumbles and lost per 100 tackles in bounds (and n), by kind and bucket. */
export const FUMBLES_NFL: Record<ContactKind, Record<Bucket, [fumbles: number, lost: number, n: number]>> = {
  run: {
    all: [1.46, 0.65, 60151],
    early: [1.34, 0.61, 52716],
    'third short': [1.7, 0.86, 4410],
    'third mid': [2.93, 0.64, 1094],
    'third long': [3.21, 0.8, 748],
    fourth: [3.8, 1.69, 1183],
    'trailing late': [2.16, 0.93, 1713],
    'leading late': [1.15, 0.47, 3827],
  },
  catch: {
    all: [1.31, 0.67, 42229],
    early: [1.35, 0.71, 31197],
    'third short': [0.75, 0.35, 1739],
    'third mid': [1.19, 0.49, 4875],
    'third long': [1.55, 0.8, 3624],
    fourth: [0.76, 0.25, 794],
    'trailing late': [1.73, 0.82, 3644],
    'leading late': [1.69, 1.52, 593],
  },
  scramble: {
    all: [1.75, 0.82, 3307],
    early: [1.51, 0.73, 2051],
    'third short': [0.52, 0, 192],
    'third mid': [2.77, 1.3, 614],
    'third long': [1.94, 0.55, 361],
    fourth: [2.25, 2.25, 89],
    'trailing late': [2.7, 1.54, 259],
    'leading late': [0, 0, 78],
  },
};
/** The share of fumbles a defender forced. */
const FORCED_NFL: Record<ContactKind, number> = { run: 0.499, catch: 0.949, scramble: 0.948 };
/** Backs with 150+ carries: the sd of their fumble rates (sampling included, as the NFL's carries it). */
const SPREAD_NFL = 0.0128;
const SPREAD_MIN = 150;
/** An NFL bucket smaller than this sets no target. */
const NFL_MIN = 500;

interface Count {
  n: number;
  fum: number;
  forced: number;
}
const zero = (): Count => ({ n: 0, fum: 0, forced: 0 });

export interface FumbleTally {
  buckets: Record<ContactKind, Record<Bucket, Count>>;
  /** Each back's carries and fumbles, keyed by league and id. */
  backs: Map<string, Count>;
}

export function newFumbleTally(): FumbleTally {
  const side = () => Object.fromEntries(Object.keys(FUMBLES_NFL.run).map((b) => [b, zero()])) as Record<Bucket, Count>;
  return { buckets: { run: side(), catch: side(), scramble: side() }, backs: new Map() };
}

function bucketsOf(t: ContactTap): Bucket[] {
  const out: Bucket[] = ['all'];
  if (t.down <= 2) out.push('early');
  else if (t.down === 3) out.push(t.toGo <= 3 ? 'third short' : t.toGo <= 9 ? 'third mid' : 'third long');
  else out.push('fourth');
  if (t.trailingLate) out.push('trailing late');
  if (t.leadingLate) out.push('leading late');
  return out;
}

/** One tackle in bounds, as the engine tapped it; `who` keys the carrier across leagues. */
export function tapContact(t: FumbleTally, tap: ContactTap, who: string): void {
  const add = (c: Count) => {
    c.n++;
    if (tap.fumbled) c.fum++;
    if (tap.forced) c.forced++;
  };
  for (const b of bucketsOf(tap)) add(t.buckets[tap.kind][b]);
  if (tap.kind === 'run') {
    let c = t.backs.get(who);
    if (!c) t.backs.set(who, (c = zero()));
    add(c);
  }
}

const NAMES: Record<ContactKind, string> = { run: 'runs', catch: 'catches', scramble: 'scrambles' };

/** Each bucket's fumbles per 100 (judged when its tolerance clears 3.5 standard errors), and each kind's forced share. */
export function judgeFumbles(t: FumbleTally): Line[] {
  const lines: Line[] = [];
  for (const kind of ['run', 'catch', 'scramble'] as const) {
    for (const [b, [real, , nflN]] of Object.entries(FUMBLES_NFL[kind]) as [Bucket, [number, number, number]][]) {
      const c = t.buckets[kind][b];
      const tol = b === 'all' ? Math.max(0.12 * real, 0.3) : Math.max(0.25 * real, 0.3);
      const se = 100 * Math.sqrt(((real / 100) * (1 - real / 100)) / Math.max(1, c.n));
      // Too few to judge: luck moves our share by more than the tolerance (3.5 standard errors), or the NFL's own
      // bucket is too small to set a target (under 500 touches: scrambles leading late, 0 in 78).
      const few = tol < 3.5 * se || nflN < NFL_MIN;
      lines.push({
        label: `${NAMES[kind]}, ${b}: fumbles per 100`,
        value: c.n ? (100 * c.fum) / c.n : NaN,
        range: [Math.max(0, real - tol), real + tol],
        note: `NFL ${real.toFixed(2)} (n=${c.n})${few ? ', too few to judge' : ''}`,
        ...(few ? { info: true } : {}),
      });
    }
    const all = t.buckets[kind].all;
    const real = FORCED_NFL[kind];
    // A share of a few hundred fumbles: judged ±0.08 only once there are enough to read it.
    const few = all.fum < 100;
    lines.push({
      label: `${NAMES[kind]}: forced share of fumbles`,
      value: all.fum ? all.forced / all.fum : NaN,
      range: [real - 0.08, Math.min(1, real + 0.08)],
      note: `NFL ${real} (${all.fum} fumbles)${few ? ', too few to judge' : ''}`,
      ...(few ? { info: true } : {}),
    });
  }
  return lines;
}

/** How far backs differ: the sd of their fumble rates over backs with 150+ carries, against the NFL's ±30%. */
export function carrierSpread(t: FumbleTally): Line[] {
  const rates = [...t.backs.values()].filter((c) => c.n >= SPREAD_MIN).map((c) => c.fum / c.n);
  const m = rates.reduce((a, b) => a + b, 0) / Math.max(1, rates.length);
  const sd = Math.sqrt(rates.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, rates.length));
  return [
    {
      label: 'spread between backs, fumbles per carry (sd)',
      value: rates.length >= 10 ? sd : NaN,
      range: [SPREAD_NFL * 0.7, SPREAD_NFL * 1.3],
      note: `NFL ${SPREAD_NFL} (${rates.length} backs with ${SPREAD_MIN}+ carries)`,
    },
  ];
}
