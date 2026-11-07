/**
 * The situations check (spec: docs/superpowers/specs/2026-11-07-a-plays-time-design.md, §7): a play's time by kind,
 * the half's last possession (the kneel by the clock and the timeouts, how drives that try from deep end), the
 * two-point try (how often, run or pass, how often good) and returns (the shape, touchdowns, the spread between
 * returners). `npm run situations` (fast, AI games) and `npm run sim` read the engine's own decisions
 * (`SimOptions.situationTap`). NFL numbers: nflverse 2021–25, regular seasons (`scripts/research-situations.py`).
 */
import type { SituationTap } from '../src/engine/match/gameSim';
import { share } from './fumbles-core';
import type { Line } from './sideline-core';

interface Moments {
  n: number;
  sum: number;
  sq: number;
}
const moments = (): Moments => ({ n: 0, sum: 0, sq: 0 });
const add = (m: Moments, x: number) => {
  m.n++;
  m.sum += x;
  m.sq += x * x;
};
const meanOf = (m: Moments) => (m.n ? m.sum / m.n : NaN);

/** A mean against the NFL's: judged within `tol` once that clears 3.5 standard errors and the NFL's n is 200+. */
function meanLine(label: string, m: Moments, real: number, nflN: number, tol: number): Line {
  const mean = meanOf(m);
  const sd = m.n > 1 ? Math.sqrt(Math.max(0, m.sq / m.n - mean * mean)) : tol;
  const few = tol < (3.5 * sd) / Math.sqrt(Math.max(1, m.n)) || nflN < 200;
  return {
    label,
    value: mean,
    range: [real - tol, real + tol],
    note: `NFL ${real} (${m.n})${few ? ', too few to judge' : ''}`,
    ...(few ? { info: true } : {}),
  };
}
const reported = (label: string, value: number, note: string): Line => ({
  label,
  value,
  range: [-Infinity, Infinity],
  note,
  info: true,
});

const YARDS = ['<5', '5-9', '10-19', '20-39', '40+'] as const;
const bucket = (y: number) => YARDS[y < 5 ? 0 : y < 10 ? 1 : y < 20 ? 2 : y < 40 ? 3 : 4];
const AIR = ['behind', '0-9', '10-19', '20+'] as const;
const airBucket = (a: number) => AIR[a < 0 ? 0 : a < 10 ? 1 : a < 20 ? 2 : 3];

/** Seconds and n (spec §1). Catches and runs in bounds timed on touchdowns; out of bounds in the late windows. */
const TIME_NFL: Record<string, [number, number]> = {
  'incomplete, behind air': [3.97, 4505],
  'incomplete, 0-9 air': [4.36, 11241],
  'incomplete, 10-19 air': [4.96, 7729],
  'incomplete, 20+ air': [5.73, 5876],
  'catch, <5': [4.15, 917],
  'catch, 5-9': [4.63, 837],
  'catch, 10-19': [5.34, 912],
  'catch, 20-39': [6.26, 736],
  'catch, 40+': [9.25, 442],
  'run, <5': [3.65, 1316],
  'run, 5-9': [4.77, 362],
  'run, 10-19': [5.81, 269],
  'run, 20-39': [7.05, 165],
  'run, 40+': [9.55, 146],
  'catch out, <5': [5.2, 475],
  'catch out, 5-9': [4.93, 975],
  'catch out, 10-19': [5.5, 820],
  'catch out, 20-39': [6.31, 325],
  'catch out, 40+': [8.1, 41],
  'run out, <5': [4.92, 85],
  'run out, 5-9': [5.78, 98],
  'run out, 10-19': [5.56, 63],
  'run out, 20-39': [6.85, 26],
  'punt returned': [10.91, 3256],
  'fair catch': [6.94, 2709],
  'kickoff returned': [5.74, 4950],
};

const CLOCKS = ['<=20', '21-40', '41-60'] as const;
const clockBucket = (c: number) => (c <= 20 ? CLOCKS[0] : c <= 40 ? CLOCKS[1] : c <= 60 ? CLOCKS[2] : null);
/** The kneel share at the drive's first snap (n 1,481 drives): by the clock, and by timeouts at 21–40 inside his 35. */
const KNEEL_NFL: Record<(typeof CLOCKS)[number], [number, number]> = {
  '<=20': [0.643, 577],
  '21-40': [0.089, 416],
  '41-60': [0.01, 292],
};
const KNEEL_TIMEOUTS: [number, number][] = [
  [0.175, 40],
  [0.147, 75],
  [0.119, 135],
  [0.038, 78],
];

/** Returns (kickoffs 2025, punts 2021–25): mean, sd, 20+, 40+, 60+, touchdowns, n; and the spread between returners. */
const RETURN_NFL = {
  kickoff: { mean: 25.95, over20: 0.8632, over40: 0.0419, over60: 0.0092, td: 0.0029, n: 2076, spread: 0.6 },
  punt: { mean: 9.45, over20: 0.0821, over40: 0.0191, over60: 0.0084, td: 0.008, n: 4504, spread: 1.15 },
} as const;

type Kick = keyof typeof RETURN_NFL;

export interface SituationTally {
  time: Record<string, Moments>;
  sack: Moments;
  scramble: Moments;
  half: Record<string, [kneel: number, n: number]>;
  deep: { n: number; points: number; td: number; turnover: number; half: number };
  tries: { all: [number, number]; early: [number, number]; late: [number, number] };
  lateNine: [number, number];
  earlyFive: [number, number];
  earlyByAppetite: { keen: [number, number]; wary: [number, number] };
  snaps: { run: [number, number]; pass: [number, number]; defTwo: number };
  ret: Record<Kick, { yards: Moments; over20: number; over40: number; over60: number; td: number }>;
  returners: Record<Kick, Map<number, Moments>>;
  coverage: Record<Kick, { strong: Moments; weak: Moments }>;
}

export function newSituationTally(): SituationTally {
  const ret = () => ({ yards: moments(), over20: 0, over40: 0, over60: 0, td: 0 });
  return {
    time: {},
    sack: moments(),
    scramble: moments(),
    half: {},
    deep: { n: 0, points: 0, td: 0, turnover: 0, half: 0 },
    tries: { all: [0, 0], early: [0, 0], late: [0, 0] },
    lateNine: [0, 0],
    earlyFive: [0, 0],
    earlyByAppetite: { keen: [0, 0], wary: [0, 0] },
    snaps: { run: [0, 0], pass: [0, 0], defTwo: 0 },
    ret: { kickoff: ret(), punt: ret() },
    returners: { kickoff: new Map(), punt: new Map() },
    coverage: { kickoff: { strong: moments(), weak: moments() }, punt: { strong: moments(), weak: moments() } },
  };
}

const count = (c: [number, number], yes: boolean) => {
  if (yes) c[0]++;
  c[1]++;
};

/** The time line's label for a tap, or null when the NFL has no measure for it. */
function timeLabel(t: Extract<SituationTap, { kind: 'time' }>): string | null {
  switch (t.play) {
    case 'incomplete':
      return `incomplete, ${airBucket(t.air ?? 0)} air`;
    case 'catch':
    case 'run':
      return `${t.play}${t.outOfBounds ? ' out' : ''}, ${bucket(t.yards)}`;
    case 'punt':
      return 'punt returned';
    case 'fairCatch':
      return 'fair catch';
    case 'kickoff':
      return 'kickoff returned';
    default:
      return null;
  }
}

export function tapSituation(t: SituationTally, tap: SituationTap): void {
  switch (tap.kind) {
    case 'time': {
      if (tap.play === 'sack') return add(t.sack, tap.seconds);
      if (tap.play === 'scramble') return add(t.scramble, tap.seconds);
      const label = timeLabel(tap);
      if (label) add((t.time[label] ??= moments()), tap.seconds);
      return;
    }
    case 'half': {
      const b = clockBucket(tap.clock);
      if (b) count((t.half[b] ??= [0, 0]), tap.kneeled);
      if (b === '21-40' && tap.yardLine <= 35)
        count((t.half[`to${Math.min(3, tap.timeouts)}`] ??= [0, 0]), tap.kneeled);
      if (!tap.kneeled && tap.yardLine <= 35) {
        t.deep.n++;
        if (tap.points >= 3) t.deep.points++;
        if (tap.points >= 6) t.deep.td++;
        if (tap.turnover) t.deep.turnover++;
        if (tap.reachedHalf && tap.points === 0 && !tap.turnover) t.deep.half++;
      }
      return;
    }
    case 'try': {
      const late = tap.quarter >= 4;
      count(t.tries.all, tap.goes);
      count(late ? t.tries.late : t.tries.early, tap.goes);
      if (late && (tap.scoreDiff === -8 || tap.scoreDiff === -9)) count(t.lateNine, tap.goes);
      if (!late && Math.abs(tap.scoreDiff) === 5) count(t.earlyFive, tap.goes);
      if (!late && tap.appetite !== 0) count(t.earlyByAppetite[tap.appetite > 0 ? 'keen' : 'wary'], tap.goes);
      if (tap.goes) {
        count(tap.run ? t.snaps.run : t.snaps.pass, !!tap.good);
        if (tap.defTwo) t.snaps.defTwo++;
      }
      return;
    }
    case 'return': {
      const r = t.ret[tap.play];
      add(r.yards, tap.yards);
      if (tap.yards >= 20) r.over20++;
      if (tap.yards >= 40) r.over40++;
      if (tap.yards >= 60) r.over60++;
      if (tap.td) r.td++;
      const m = t.returners[tap.play];
      add(m.get(tap.returnerId) ?? (m.set(tap.returnerId, moments()), m.get(tap.returnerId)!), tap.yards);
      if (Math.abs(tap.coverage) >= 1) add(t.coverage[tap.play][tap.coverage > 0 ? 'strong' : 'weak'], tap.yards);
      return;
    }
  }
}

/** How far returners with 30+ returns differ beyond luck: the sd of their means less what chance alone gives. */
function returnerSpread(m: Map<number, Moments>): { spread: number; men: number } {
  const men = [...m.values()].filter((x) => x.n >= 30);
  if (men.length < 2) return { spread: NaN, men: men.length };
  const means = men.map(meanOf);
  const grand = means.reduce((a, b) => a + b, 0) / means.length;
  const sdMeans = Math.sqrt(means.reduce((a, b) => a + (b - grand) ** 2, 0) / (means.length - 1));
  const luck = Math.sqrt(men.reduce((a, x) => a + Math.max(0, x.sq / x.n - meanOf(x) ** 2) / x.n, 0) / men.length);
  return { spread: Math.sqrt(Math.max(0, sdMeans ** 2 - luck ** 2)), men: men.length };
}

export function judgeSituations(t: SituationTally): Line[] {
  const lines: Line[] = [];
  for (const [label, [real, nflN]] of Object.entries(TIME_NFL))
    lines.push(meanLine(`time: ${label}`, t.time[label] ?? moments(), real, nflN, 0.4));
  lines.push(reported('time: sack (not measured)', meanOf(t.sack), `today's 4–6 (${t.sack.n})`));
  lines.push(reported('time: scramble (not measured)', meanOf(t.scramble), `today's 5–8 (${t.scramble.n})`));

  for (const c of CLOCKS) {
    const [k, n] = t.half[c] ?? [0, 0];
    lines.push(share(`half: kneel, ${c} s`, k, n, ...KNEEL_NFL[c], 0.06));
  }
  KNEEL_TIMEOUTS.forEach(([real, nflN], to) => {
    const [k, n] = t.half[`to${to}`] ?? [0, 0];
    lines.push(share(`half: kneel, 21-40 s, ${to} timeouts`, k, n, real, nflN, 0.08));
  });
  const d = t.deep;
  lines.push(share('half: tried from deep, points', d.points, d.n, 0.211, 777, 0.06));
  lines.push(share('half: tried from deep, touchdown', d.td, d.n, 0.048, 777, 0.04));
  lines.push(share('half: tried from deep, turnover', d.turnover, d.n, 0.089, 777, 0.05));
  lines.push(share('half: tried from deep, ran out the half', d.half, d.n, 0.423, 777, 0.08));

  lines.push(share('two: share, all tries', ...t.tries.all, 0.098, 6779, 0.02));
  lines.push(share('two: share, quarters 1-3', ...t.tries.early, 0.046, 4792, 0.02));
  lines.push(share('two: share, the 4th and overtime', ...t.tries.late, 0.223, 1987, 0.05));
  lines.push(share('two: share, down 8 or 9 late', ...t.lateNine, 0.383, 112, 0.12));
  lines.push(share('two: share, up or down 5 early', ...t.earlyFive, 0.388, 137, 0.12));
  const snaps = t.snaps.run[1] + t.snaps.pass[1];
  lines.push(share('two: run share', t.snaps.run[1], snaps, 0.284, 663, 0.06));
  lines.push(share('two: good, runs', ...t.snaps.run, 0.564, 188, 0.08));
  lines.push(share('two: good, passes', ...t.snaps.pass, 0.44, 475, 0.06));
  lines.push(share('two: good, all', t.snaps.run[0] + t.snaps.pass[0], snaps, 0.475, 663, 0.05));
  lines.push(reported('two: defensive twos per try', t.snaps.defTwo / Math.max(1, snaps), `NFL 0.039 (${snaps})`));
  for (const k of ['keen', 'wary'] as const) {
    const [g, n] = t.earlyByAppetite[k];
    lines.push(reported(`two: share before the 4th, ${k} head coaches`, g / Math.max(1, n), `reported (${n})`));
  }

  for (const kind of ['kickoff', 'punt'] as const) {
    const nfl = RETURN_NFL[kind];
    const r = t.ret[kind];
    const n = r.yards.n;
    lines.push(meanLine(`returns: ${kind}, mean yards`, r.yards, nfl.mean, nfl.n, 1));
    lines.push(share(`returns: ${kind}, 20+`, r.over20, n, nfl.over20, nfl.n, kind === 'kickoff' ? 0.05 : 0.03));
    lines.push(share(`returns: ${kind}, 40+`, r.over40, n, nfl.over40, nfl.n, kind === 'kickoff' ? 0.02 : 0.012));
    lines.push(share(`returns: ${kind}, 60+`, r.over60, n, nfl.over60, nfl.n, 0.008));
    lines.push(share(`returns: ${kind}, touchdowns`, r.td, n, nfl.td, nfl.n, kind === 'kickoff' ? 0.004 : 0.006));
    const s = returnerSpread(t.returners[kind]);
    lines.push({
      label: `returns: ${kind}, spread between returners (yards)`,
      value: s.spread,
      range: [Math.max(0, nfl.spread - 0.6), nfl.spread + 0.6],
      note: `NFL ${nfl.spread} (${s.men} men)${s.men < 10 ? ', too few to judge' : ''}`,
      ...(s.men < 10 ? { info: true } : {}),
    });
    const cov = t.coverage[kind];
    lines.push(
      reported(
        `returns: ${kind}, strong coverage less weak (yards)`,
        meanOf(cov.weak) - meanOf(cov.strong),
        `reported (${cov.strong.n}/${cov.weak.n})`,
      ),
    );
  }
  return lines;
}
