/**
 * The fumbles check (spec: docs/superpowers/specs/2026-11-05-fumbles-on-contact-design.md, §5): contact fumbles on runs,
 * catches and scrambles by what's known before the snap, the forced share, lost per 100 and the spread between backs,
 * against nflverse 2021–25 (`scripts/research-fumbles.py`). Used by `npm run fumbles` (fast, AI games) and `npm run sim`,
 * from the engine's own decisions (`SimOptions.contactTap`).
 */
import type { ContactTap, Recovery, StripTap } from '../src/engine/match/gameSim';
import type { Group, LooseKind } from '../src/engine/match/looseBall';
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
/**
 * Backs with 150+ carries: how far their fumble rates truly differ, the sd of the rates less what luck alone gives at
 * their carries (the NFL's 0.0128 less 0.0052: five seasons a back, against a league's one, so luck is judged out on
 * both sides, not left in to fill a short spread).
 */
const SPREAD_NFL = Math.sqrt(0.0128 ** 2 - 0.0052 ** 2);
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
  /** Sacks by bucket and by the rusher's spot: sacks, fumbles, forced, lost. */
  strips: Record<StripBucket, Count & { lost: number }>;
  /** Fumbles by play: who got them, who on the defense, and the forcer. */
  loose: Record<LooseKind, Loose>;
  /** Defensive recoveries' returns by the recoverer's group. */
  returns: Record<Group, { n: number; yards: number; sq: number; long: number; td: number }>;
}

interface Loose {
  forced: number;
  forcedLost: number;
  own: number;
  ownLost: number;
  forcer: number;
  /** Recoveries not by the forcer, by group. */
  groups: Record<Group, number>;
}

export function newFumbleTally(): FumbleTally {
  const side = () => Object.fromEntries(Object.keys(FUMBLES_NFL.run).map((b) => [b, zero()])) as Record<Bucket, Count>;
  const loose = (): Loose => ({
    forced: 0,
    forcedLost: 0,
    own: 0,
    ownLost: 0,
    forcer: 0,
    groups: { DB: 0, LB: 0, DL: 0 },
  });
  const ret = () => ({ n: 0, yards: 0, sq: 0, long: 0, td: 0 });
  return {
    buckets: { run: side(), catch: side(), scramble: side() },
    backs: new Map(),
    strips: Object.fromEntries(Object.keys(STRIP_NFL).map((b) => [b, { ...zero(), lost: 0 }])) as FumbleTally['strips'],
    loose: { run: loose(), catch: loose(), scramble: loose(), sack: loose() },
    returns: { DB: ret(), LB: ret(), DL: ret() },
  };
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
  if (tap.recovery) tapLoose(t, tap.kind, !!tap.forced, tap.recovery);
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

/**
 * How far backs differ: the sd of their fumble rates over backs with 150+ carries less luck's (binomial at each back's
 * carries, as `research-fumbles.py` measures the NFL's), against the NFL's ±30%.
 */
export function carrierSpread(t: FumbleTally): Line[] {
  const backs = [...t.backs.values()].filter((c) => c.n >= SPREAD_MIN);
  const rates = backs.map((c) => c.fum / c.n);
  const m = rates.reduce((a, b) => a + b, 0) / Math.max(1, rates.length);
  const sd = Math.sqrt(rates.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, rates.length));
  const luck = Math.sqrt(backs.reduce((a, c) => a + (m * (1 - m)) / c.n, 0) / Math.max(1, backs.length));
  return [
    {
      label: 'spread between backs, fumbles per carry (sd less luck)',
      value: rates.length >= 10 ? Math.sqrt(Math.max(0, sd ** 2 - luck ** 2)) : NaN,
      range: [SPREAD_NFL * 0.7, SPREAD_NFL * 1.3],
      note: `NFL ${SPREAD_NFL.toFixed(4)}; ours sd ${sd.toFixed(4)}, luck ${luck.toFixed(4)} (${rates.length} backs with ${SPREAD_MIN}+ carries)`,
    },
  ];
}

// ───────── strip-sacks and the loose ball (spec: docs/superpowers/specs/2026-11-06-fumble-recoveries-design.md) ─────────

type StripBucket = Bucket | 'edge' | 'interior';

/** The NFL's strip-sacks and lost per 100 sacks (and n), by bucket and by the rusher's spot: an edge rusher or a DB
 * blitzing (n 3,960 + 519), a tackle or a linebacker (1,416 + 637). */
export const STRIP_NFL: Record<StripBucket, [fumbles: number, lost: number, n: number]> = {
  all: [12.36, 6.3, 6552],
  early: [13.82, 7.15, 3718],
  'third short': [10.47, 5.23, 363],
  'third mid': [9.98, 4.95, 1433],
  'third long': [10.18, 4.85, 845],
  fourth: [15.03, 8.29, 193],
  'trailing late': [15.94, 7.81, 640],
  'leading late': [9.09, 4.13, 121],
  edge: [13.93, 7.17, 4479],
  interior: [8.18, 4.09, 2053],
};
/** The share of sack fumbles a defender forced (747 of 810). */
const SACK_FORCED_NFL = 0.922;
/** The defense's share of fumbles it forced and of the carrier's own, with n. */
const RECOVERED_NFL: Record<LooseKind, { forced: [number, number]; own: [number, number] }> = {
  run: { forced: [0.6, 485], own: [0.25, 548] },
  catch: { forced: [0.54, 583], own: [0.18, 79] },
  scramble: { forced: [0.48, 60], own: [0.25, 4] },
  sack: { forced: [0.52, 747], own: [0.35, 63] },
};
/** Who on the defense recovers, not counting the forcer (n), and the forcer's share of all its recoveries. */
const GROUP_NFL: Record<LooseKind, [db: number, lb: number, dl: number, n: number]> = {
  run: [0.38, 0.2, 0.43, 383],
  catch: [0.58, 0.18, 0.24, 288],
  scramble: [0.5, 0.11, 0.39, 28],
  sack: [0.13, 0.16, 0.72, 358],
};
const FORCER_NFL = 0.12;
/** Returns by the recoverer's group: mean yards, the share of 20+, touchdowns (n). */
const RETURN_NFL: Record<Group, [mean: number, long: number, td: number, n: number]> = {
  DB: [6.7, 0.12, 0.081, 420],
  LB: [4.2, 0.06, 0.06, 200],
  DL: [2.7, 0.05, 0.063, 573],
};
/** A share of fumbles (not of plays) sets a target from this many NFL fumbles. */
const SHARE_MIN = 200;

function tapLoose(t: FumbleTally, kind: LooseKind, forced: boolean, r: Recovery): void {
  const l = t.loose[kind];
  if (forced) {
    l.forced++;
    if (r.lost) l.forcedLost++;
  } else {
    l.own++;
    if (r.lost) l.ownLost++;
  }
  if (!r.lost || !r.group) return;
  if (r.forcerRecovered) l.forcer++;
  else l.groups[r.group]++;
  const g = t.returns[r.group];
  g.n++;
  g.yards += r.returnYds;
  g.sq += r.returnYds * r.returnYds;
  if (r.returnYds >= 20) g.long++;
  if (r.td) g.td++;
}

/** One sack, as the engine tapped it. */
export function tapStrip(t: FumbleTally, tap: StripTap): void {
  const buckets: StripBucket[] = [...bucketsOf(tap as unknown as ContactTap), tap.spot];
  for (const b of buckets) {
    const c = t.strips[b];
    c.n++;
    if (tap.fumbled) c.fum++;
    if (tap.forced) c.forced++;
    if (tap.recovery?.lost) c.lost++;
  }
  if (tap.fumbled && tap.recovery) tapLoose(t, 'sack', !!tap.forced, tap.recovery);
}

/** A rate per 100 judged as the contact buckets are: the tolerance must clear 3.5 standard errors, the NFL's n 500. */
function per100(label: string, num: number, n: number, real: number, nflN: number, all: boolean): Line {
  const tol = all ? Math.max(0.12 * real, 0.3) : Math.max(0.25 * real, 0.3);
  const se = 100 * Math.sqrt(((real / 100) * (1 - real / 100)) / Math.max(1, n));
  const few = tol < 3.5 * se || nflN < NFL_MIN;
  return {
    label,
    value: n ? (100 * num) / n : NaN,
    range: [Math.max(0, real - tol), real + tol],
    note: `NFL ${real.toFixed(2)} (n=${n})${few ? ', too few to judge' : ''}`,
    ...(few ? { info: true } : {}),
  };
}

/** A share judged ±tol once there are enough on both sides to read it. */
export function share(label: string, num: number, n: number, real: number, nflN: number, tol: number): Line {
  const se = Math.sqrt((real * (1 - real)) / Math.max(1, n));
  const few = tol < 3.5 * se || nflN < SHARE_MIN;
  return {
    label,
    value: n ? num / n : NaN,
    range: [Math.max(0, real - tol), Math.min(1, real + tol)],
    note: `NFL ${real} (${n})${few ? ', too few to judge' : ''}`,
    ...(few ? { info: true } : {}),
  };
}

/** Strip-sacks and lost per 100 sacks by bucket and by the rusher's spot, and the forced share. */
export function judgeStrips(t: FumbleTally): Line[] {
  const lines: Line[] = [];
  for (const [b, [real, lost, nflN]] of Object.entries(STRIP_NFL) as [StripBucket, [number, number, number]][]) {
    const c = t.strips[b];
    lines.push(per100(`strip-sacks, ${b}: per 100 sacks`, c.fum, c.n, real, nflN, b === 'all'));
    if (b === 'all') lines.push(per100('strip-sacks, all: lost per 100 sacks', c.lost, c.n, lost, nflN, true));
  }
  const all = t.strips.all;
  lines.push(share('strip-sacks: forced share', all.forced, all.fum, SACK_FORCED_NFL, 810, 0.06));
  return lines;
}

const KINDS: Record<LooseKind, string> = { run: 'runs', catch: 'catches', scramble: 'scrambles', sack: 'sacks' };
const GROUP_NAMES: Record<Group, string> = { DB: 'the DBs', LB: 'the linebackers', DL: 'the line' };

/** Lost per 100 tackles, the defense's share of fumbles forced and own, who on the defense, and returns by group. */
export function judgeRecoveries(t: FumbleTally): Line[] {
  const lines: Line[] = [];
  for (const kind of ['run', 'catch', 'scramble'] as const) {
    const c = t.buckets[kind].all;
    const l = t.loose[kind];
    const [, lost, nflN] = FUMBLES_NFL[kind].all;
    lines.push(per100(`${KINDS[kind]}, all: lost per 100`, l.forcedLost + l.ownLost, c.n, lost, nflN, true));
  }
  let forcer = 0;
  let recovered = 0;
  for (const kind of ['run', 'catch', 'scramble', 'sack'] as const) {
    const l = t.loose[kind];
    const nfl = RECOVERED_NFL[kind];
    lines.push(
      share(`${KINDS[kind]}: defense recovers, forced`, l.forcedLost, l.forced, nfl.forced[0], nfl.forced[1], 0.08),
    );
    lines.push(share(`${KINDS[kind]}: defense recovers, his own`, l.ownLost, l.own, nfl.own[0], nfl.own[1], 0.08));
    const rest = l.groups.DB + l.groups.LB + l.groups.DL;
    const [db, lb, dl, n] = GROUP_NFL[kind];
    for (const [g, real] of [
      ['DB', db],
      ['LB', lb],
      ['DL', dl],
    ] as const)
      lines.push(share(`${KINDS[kind]}: recovered by ${GROUP_NAMES[g]}`, l.groups[g], rest, real, n, 0.08));
    forcer += l.forcer;
    recovered += rest + l.forcer;
  }
  lines.push(share('the forcer recovers it himself', forcer, recovered, FORCER_NFL, 1193, 0.05));
  for (const g of ['DB', 'LB', 'DL'] as const) {
    const r = t.returns[g];
    const [mean, long, td, n] = RETURN_NFL[g];
    // A return is mostly nothing with now and then the length of the field: its mean is judged, like every line here,
    // only once the tolerance clears 3.5 standard errors of it.
    const avg = r.n ? r.yards / r.n : NaN;
    const se = r.n > 1 ? Math.sqrt(Math.max(0, r.sq / r.n - avg * avg) / r.n) : Infinity;
    const tol = Math.max(0.25 * mean, 1);
    const few = r.n < 200 || tol < 3.5 * se;
    lines.push({
      label: `returns by ${GROUP_NAMES[g]}: mean yards`,
      value: avg,
      range: [mean - tol, mean + tol],
      note: `NFL ${mean} (${r.n})${few ? ', too few to judge' : ''}`,
      ...(few ? { info: true } : {}),
    });
    lines.push(share(`returns by ${GROUP_NAMES[g]}: 20+ yards`, r.long, r.n, long, n, 0.05));
    lines.push(share(`returns by ${GROUP_NAMES[g]}: touchdowns`, r.td, r.n, td, n, 0.04));
  }
  return lines;
}
