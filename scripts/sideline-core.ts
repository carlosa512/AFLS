/**
 * The sideline check (spec: docs/superpowers/specs/2026-11-04-out-of-bounds-choice-design.md, §6): out of bounds on
 * catches, runs and scrambles by bucket against the NFL's, the clock between snaps after a man goes out, and how far the
 * league's men differ. NFL numbers from `scripts/research-sideline.py` (nflverse play-by-play, regular seasons 2021–25).
 * Used by `npm run sideline` (fast, AI games) and `npm run sim`.
 */
import { asRan } from '../src/engine/field/stage';
import { bandMark, bandOf } from './band';
import { sidelineOdds, TYPICAL, type SidelineFacts, type SidelineKind } from '../src/engine/match/sideline';
import { playerOvr } from '../src/engine/positions';
import { activeQuirks } from '../src/engine/quirks';
import { teamPlayers } from '../src/engine/roster';
import { skill } from '../src/engine/attributes';
import { sizeZ } from '../src/engine/size';
import { poiseOf } from '../src/engine/traits';
import type { League, PlayLogEntry, Position } from '../src/engine/types';

/** One judged or reported number (parity-core's shape). */
export interface Line {
  label: string;
  value: number;
  range: [number, number];
  note: string;
  info?: boolean;
  /** A line that swings with the league (`band.ts`): outside `range` it warns, outside this it fails. */
  normal?: [number, number];
}

/** Print a line as the repo's checks do; returns whether it's in range (the caller counts misses). */
export function printLine(l: Line): boolean {
  const band = bandOf(l.value, l.range, l.normal);
  const ok = l.info || band === 'usual' || band === 'unusual';
  const shown = Number.isFinite(l.value) ? l.value.toFixed(2) : 'none';
  const range = l.info ? 'reported' : l.range.map((x) => x.toFixed(2)).join('–');
  const mark = l.info ? ' ' : band === 'usual' ? '✓' : band === 'unusual' ? '⚠' : '✗';
  const why = l.info ? '' : bandMark(l.value, l.range, l.normal);
  console.log(`${mark} ${l.label.padEnd(58)} ${shown.padStart(8)}   ${range.padEnd(13)} ${l.note}${why}`);
  return !!ok;
}

type Kind = 'catch' | 'run' | 'scramble';
/** The NFL's share out of bounds, pushed out and stepped out, in percent, by bucket. */
export const SIDELINE_NFL: Record<Kind, Record<string, [out: number, pushed: number, stepped: number]>> = {
  catch: {
    all: [22.4, 16.8, 5.7],
    'normal tempo': [21.8, 16.8, 5.0],
    hurrying: [25.9, 16.7, 9.2],
    'protecting a lead': [20.2, 15.7, 4.5],
    'to the sideline': [27.6, 20.6, 7.0],
    'to the middle': [3.7, 2.9, 0.9],
    'yards after the catch 0–2': [19.8, 11.9, 7.9],
    'yards after the catch 3–9': [21.2, 17.8, 3.4],
    'yards after the catch 10+': [31.9, 26.6, 5.4],
    '3rd/4th, short of the sticks': [10.3, 8.9, 1.4],
    '3rd/4th, past the sticks': [25.3, 18.2, 7.1],
  },
  run: {
    all: [5.6, 4.7, 1.0],
    outside: [11.1, 9.2, 1.9],
    inside: [0.7, 0.6, 0.1],
    'outside, normal tempo': [11.7, 9.7, 2.0],
    'outside, hurrying': [10.2, 7.8, 2.4],
    'outside, protecting a lead': [7.1, 6.2, 0.9],
    'outside, no gain or a loss': [4.9, 4.3, 0.6],
    'outside, 1–9 yards': [9.1, 7.5, 1.5],
    'outside, 10+ yards': [31.8, 26.0, 5.8],
    'outside, 20+ yards': [43.7, 38.0, 5.7],
    'inside, 10+ yards': [7.3, 6.0, 1.3],
  },
  scramble: {
    all: [35.9, 14.6, 21.3],
    'normal tempo': [35.5, 14.7, 20.8],
    hurrying: [40.9, 14.8, 26.1],
    'protecting a lead': [25.1, 12.3, 12.8],
    '1–9 yards': [34.5, 14.8, 19.8],
    '10+ yards': [40.0, 14.2, 25.7],
  },
};
/** Totals are judged tighter than buckets (spec §6). */
const TOTAL = 'all';
/** The real spread between players, sd ÷ average of each man's stepped-out share. */
/** Runs: backs only (quarterbacks' designed runs out), as the engine's side reads each club's top back. */
const SPREAD_NFL: Record<Kind, number> = { catch: 0.49, run: 0.65, scramble: 0.39 };
/** Game clock between snaps, a tackle in bounds less out of bounds, Q1–Q3 normal play (seconds). */
const CLOCK_GAP_NFL = { catch: 4.0, run: 2.6 };

interface Count {
  n: number;
  out: number;
  pushed: number;
  stepped: number;
}
export interface SidelineTally {
  buckets: Record<Kind, Record<string, Count>>;
  /** Clock gaps after a catch or an outside run: [sum, n] in bounds and out. */
  gaps: Record<'catch' | 'run', { in: [number, number]; out: [number, number] }>;
}

export function newSidelineTally(): SidelineTally {
  const buckets = {} as SidelineTally['buckets'];
  for (const k of Object.keys(SIDELINE_NFL) as Kind[])
    buckets[k] = Object.fromEntries(
      Object.keys(SIDELINE_NFL[k]).map((b) => [b, { n: 0, out: 0, pushed: 0, stepped: 0 }]),
    );
  return {
    buckets,
    gaps: {
      catch: { in: [0, 0], out: [0, 0] },
      run: { in: [0, 0], out: [0, 0] },
    },
  };
}

/** The engine's own tempo rule (`coach.tempo`), rebuilt from a logged play (playing for a field goal left out). */
function tempoOf(e: PlayLogEntry, diff: number): 'hurry' | 'milk' | 'normal' {
  const { quarter: q, clock: c, yardLine: y } = e;
  if (
    (q >= 4 && diff < 0 && c <= 300) ||
    (q === 4 && diff === 0 && c <= 120 && y >= 35) ||
    (q >= 5 && diff === 0 && c <= 360) ||
    (q === 2 && c <= 120 && y >= 25)
  )
    return 'hurry';
  if ((q >= 4 && diff > 0 && c <= 420) || (q >= 3 && diff >= 17)) return 'milk';
  return 'normal';
}

const kindOf = (e: PlayLogEntry): Kind | null =>
  e.kind === 'pass' ? 'catch' : e.kind === 'run' ? 'run' : e.kind === 'scramble' ? 'scramble' : null;

/** Tally one game's logged plays. */
export function tallyGame(t: SidelineTally, plays: PlayLogEntry[], homeId: number): void {
  for (let i = 0; i < plays.length; i++) {
    const raw = plays[i];
    const e = asRan(raw);
    const kind = kindOf(e);
    if (!kind || raw.down <= 0 || /TOUCHDOWN|FUMBLE/.test(e.text)) continue;
    const diff = e.offense === homeId ? e.homeScore - e.awayScore : e.awayScore - e.homeScore;
    const tempo = tempoOf(e, diff);
    const out = /out of bounds/.test(e.text);
    const pushed = /, pushed out of bounds/.test(e.text);
    const stepped = /, steps out of bounds/.test(e.text);
    const m = /for (-?\d+) yard|for no gain/.exec(e.text);
    const gain = m ? (m[1] ? Number(m[1]) : 0) : 0;
    // In the offense's own yards: the catch spot and where he ended.
    const own = (x: number) => (e.offense === homeId ? x : 100 - x);
    const air = e.air !== undefined && e.from !== undefined ? own(e.air) - own(e.from) : 0;
    const yac = gain - air;
    const outside = kind === 'run' ? /left end|right end/.test(e.text) : Math.abs(e.lane ?? 0) >= 0.34;
    const add = (b: string) => {
      const c = t.buckets[kind][b];
      c.n++;
      if (out) c.out++;
      if (pushed) c.pushed++;
      if (stepped) c.stepped++;
    };
    const tempoName = { normal: 'normal tempo', hurry: 'hurrying', milk: 'protecting a lead' }[tempo];
    add('all');
    if (kind === 'catch') {
      add(tempoName);
      add(outside ? 'to the sideline' : 'to the middle');
      add(
        yac <= 2 ? 'yards after the catch 0–2' : yac < 10 ? 'yards after the catch 3–9' : 'yards after the catch 10+',
      );
      if (e.down >= 3) add(gain < e.distance ? '3rd/4th, short of the sticks' : '3rd/4th, past the sticks');
    } else if (kind === 'run') {
      if (outside) {
        add('outside');
        add(`outside, ${tempoName}`);
        add(gain <= 0 ? 'outside, no gain or a loss' : gain < 10 ? 'outside, 1–9 yards' : 'outside, 10+ yards');
        if (gain >= 20) add('outside, 20+ yards');
      } else {
        add('inside');
        if (gain >= 10) add('inside, 10+ yards');
      }
    } else {
      add(tempoName);
      if (gain >= 1) add(gain < 10 ? '1–9 yards' : '10+ yards');
    }
    // The clock to the next snap: Q1–Q3, normal play, the same offense snapping again with nothing stopping it between.
    const next = plays[i + 1];
    if (
      (kind === 'catch' || (kind === 'run' && outside)) &&
      e.quarter <= 3 &&
      tempo === 'normal' &&
      raw.kind !== 'penalty' &&
      next &&
      next.quarter === e.quarter &&
      next.offense === e.offense &&
      next.down > 0 &&
      next.kind !== 'penalty' &&
      !/Timeout|Two-minute/.test(next.text)
    ) {
      const g = t.gaps[kind][out ? 'out' : 'in'];
      g[0] += e.clock - next.clock;
      g[1]++;
    }
  }
}

const pct = (a: number, n: number) => (n ? (100 * a) / n : NaN);

/** One judged line per bucket (NFL ± max(3 points, 20%)), per kind total (± 1.5) and clock gap (± 1.5 s). */
export function judgeSideline(t: SidelineTally): Line[] {
  const lines: Line[] = [];
  const NAMES = { catch: 'catches', run: 'runs', scramble: 'scrambles' };
  for (const kind of Object.keys(SIDELINE_NFL) as Kind[])
    for (const [b, nfl] of Object.entries(SIDELINE_NFL[kind])) {
      const c = t.buckets[kind][b];
      // Before the engine names how a man went out, only the total share can be judged.
      const split = c.pushed + c.stepped > 0;
      const parts: [string, number, number][] = [['out', c.out, nfl[0]]];
      if (split) parts.push(['pushed', c.pushed, nfl[1]], ['stepped', c.stepped, nfl[2]]);
      for (const [what, k, real] of parts) {
        const tol = b === TOTAL ? 1.5 : Math.max(3, 0.2 * real);
        // Too few plays to judge: luck alone moves the share by more than the tolerance allows (3.5 standard errors: a judged line fails by luck about once in 2,000).
        const se = 100 * Math.sqrt(((real / 100) * (1 - real / 100)) / Math.max(1, c.n));
        lines.push({
          label: `${NAMES[kind]}, ${b}: ${what} %`,
          value: pct(k, c.n),
          range: [Math.max(0, real - tol), real + tol],
          note: `NFL ${real} (n=${c.n})${tol < 3.5 * se ? ', too few to judge' : ''}`,
          ...(tol < 3.5 * se ? { info: true } : {}),
        });
      }
    }
  for (const k of ['catch', 'run'] as const) {
    const g = t.gaps[k];
    const gap = g.in[0] / g.in[1] - g.out[0] / g.out[1];
    const real = CLOCK_GAP_NFL[k];
    lines.push({
      label: `clock after ${k === 'catch' ? 'a catch' : 'an outside run'}: in bounds less out (s)`,
      value: gap,
      range: [real - 1.5, real + 1.5],
      note: `NFL ${real} (n=${g.in[1]}/${g.out[1]})`,
    });
  }
  return lines;
}

/** A typical moment for one man: at the sideline, four yards in, nothing on the clock, a typical chaser. */
function facts(kind: SidelineKind, p: League['players'][number]): SidelineFacts {
  const quirks = new Set(activeQuirks(p));
  return {
    kind,
    wide: kind === 'scramble' ? 0.9 : 1,
    run: 4,
    free: false,
    clock: 'none',
    shortOfSticks: false,
    edge: TYPICAL.edge,
    carrier: {
      position: p.position,
      speed: skill(p, 'longSpeed'),
      build: sizeZ(p).w,
      energy: TYPICAL.energy,
      hurt: 0,
      poise: poiseOf(p),
      has: (q) => quirks.has(q),
    },
    chaser: { pursuit: TYPICAL.pursuit, tackling: TYPICAL.tackling, has: () => false },
  };
}

/** How far the league's men differ: each man's stepped-out share (pushed odds out) at a typical moment, sd ÷ mean,
 * against the NFL's real spread ± 30%. Every club's top three receivers and top tight end (catches), top two backs (runs; the NFL's 100-carry list holds backups too)
 * and starting quarterback (scrambles). */
export function spreadLines(league: League): Line[] {
  const groups: Record<Kind, number[]> = { catch: [], run: [], scramble: [] };
  const share = (kind: SidelineKind, p: League['players'][number]) => {
    const o = sidelineOdds(facts(kind, p));
    return (1 - o.pushed) * o.stepped;
  };
  for (const team of league.teams) {
    const ps = teamPlayers(league, team.id);
    const top = (pos: Position, n: number) =>
      ps
        .filter((p) => p.position === pos)
        .sort((a, b) => playerOvr(b) - playerOvr(a))
        .slice(0, n);
    for (const p of [...top('WR', 3), ...top('TE', 1)]) groups.catch.push(share('catch', p));
    for (const p of top('RB', 2)) groups.run.push(share('run', p));
    for (const p of top('QB', 1)) groups.scramble.push(share('scramble', p));
  }
  return (Object.keys(groups) as Kind[]).map((k) => {
    const xs = groups[k];
    const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
    const sd = Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / (xs.length - 1));
    const real = SPREAD_NFL[k];
    return {
      label: `spread between players, ${k === 'catch' ? 'catches' : k === 'run' ? 'runs' : 'scrambles'} (sd ÷ mean)`,
      value: sd / mean,
      range: [real * 0.7, real * 1.3] as [number, number],
      note: `NFL ${real} (${xs.length} men, mean ${(100 * mean).toFixed(1)}%)`,
    };
  });
}
