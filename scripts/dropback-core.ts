/**
 * The dropback check (spec: docs/superpowers/specs/2026-11-07-dropback-endings-design.md, §8): a sack's loss (its shape,
 * by the down, in the pocket or after he'd left it, backed up), how often he'd left it, tacklers credited on scrambles in
 * bounds, and, reported only, the loss by the defense's call, the slide share by situation and each ending's reason.
 * `npm run dropback` (fast, AI games) and `npm run sim` read the engine's own decisions (`SimOptions.endingTap`).
 * NFL numbers: nflverse 2021–25, FTN 2022–25 (`scripts/research-dropback.py`).
 */
import type { EndingTap } from '../src/engine/match/gameSim';
import { share } from './fumbles-core';
import type { Line } from './sideline-core';

/** A mean against the NFL's: judged within `tol` yards once that clears 3.5 standard errors and the NFL's n is 200+. */
function meanLine(label: string, m: Moments, real: number, nflN: number, tol = 0.5): Line {
  const mean = m.n ? m.sum / m.n : NaN;
  const sd = m.n > 1 ? Math.sqrt(Math.max(0, m.sq / m.n - mean * mean)) : 3.66;
  const few = tol < (3.5 * sd) / Math.sqrt(Math.max(1, m.n)) || nflN < 200;
  return {
    label,
    value: mean,
    range: [real - tol, real + tol],
    note: `NFL ${real} (${m.n})${few ? ', too few to judge' : ''}`,
    ...(few ? { info: true } : {}),
  };
}
const info = (label: string, num: number, n: number, note: string): Line => ({
  label,
  value: n ? num / n : NaN,
  range: [0, 1],
  note: `${note} (${n})`,
  info: true,
});

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

export interface EndingTally {
  sacks: Moments;
  none: number;
  ten: number;
  fifteen: number;
  down: Record<number, Moments>;
  pocket: Moments;
  out: Moments;
  backed: Moments;
  call: Record<'passD' | 'base' | 'blitz', Moments>;
  scrambles: number;
  tackled: number;
  slid: number;
  slidBy: Record<'firstDown' | 'leadingLate' | 'trailingLate' | 'short34', [slid: number, n: number]>;
  reasons: Record<string, number>;
  outs: number;
  outWhy: Record<string, number>;
}

export function newEndingTally(): EndingTally {
  return {
    sacks: moments(),
    none: 0,
    ten: 0,
    fifteen: 0,
    down: { 1: moments(), 2: moments(), 3: moments(), 4: moments() },
    pocket: moments(),
    out: moments(),
    backed: moments(),
    call: { passD: moments(), base: moments(), blitz: moments() },
    scrambles: 0,
    tackled: 0,
    slid: 0,
    slidBy: { firstDown: [0, 0], leadingLate: [0, 0], trailingLate: [0, 0], short34: [0, 0] },
    reasons: {},
    outs: 0,
    outWhy: {},
  };
}

export function tapEnding(t: EndingTally, tap: EndingTap): void {
  if (tap.kind === 'sack') {
    const loss = tap.loss ?? 0;
    add(t.sacks, loss);
    if (loss <= 0) t.none++;
    if (loss >= 10) t.ten++;
    if (loss >= 15) t.fifteen++;
    add(t.down[Math.min(4, Math.max(1, tap.down))], loss);
    add(tap.escaped ? t.out : t.pocket, loss);
    if ((tap.yardLine ?? 100) <= 20) add(t.backed, loss);
    add(t.call[tap.call === 'passD' ? 'passD' : tap.call === 'blitz' ? 'blitz' : 'base'], loss);
    return;
  }
  if (tap.kind === 'out') {
    t.outs++;
    const k = tap.why ?? 'nothing said';
    t.outWhy[k] = (t.outWhy[k] ?? 0) + 1;
    return;
  }
  t.scrambles++;
  if (tap.tackled) t.tackled++;
  if (tap.slid) t.slid++;
  const by = (k: keyof EndingTally['slidBy'], on: boolean) => {
    if (!on) return;
    t.slidBy[k][1]++;
    if (tap.slid) t.slidBy[k][0]++;
  };
  by('firstDown', !!tap.firstDown);
  by('leadingLate', !!tap.leadingLate);
  by('trailingLate', !!tap.trailingLate);
  by('short34', tap.down >= 3 && !tap.firstDown);
  const r = tap.reason ?? 'tackled, nothing said';
  t.reasons[r] = (t.reasons[r] ?? 0) + 1;
}

export function judgeEndings(t: EndingTally): Line[] {
  const n = t.sacks.n;
  const lines: Line[] = [
    share('sacks: no loss', t.none, n, 0.067, 6552, 0.03),
    share('sacks: 10+ yards', t.ten, n, 0.192, 6552, 0.03),
    share('sacks: 15+ yards', t.fifteen, n, 0.02, 6552, 0.03),
    meanLine('sacks: mean loss', t.sacks, 6.66, 6552),
    meanLine('sacks: mean loss, 1st down', t.down[1], 6.1, 1842),
    meanLine('sacks: mean loss, 2nd down', t.down[2], 6.39, 1876),
    meanLine('sacks: mean loss, 3rd down', t.down[3], 7.16, 2641),
    meanLine('sacks: mean loss, 4th down', t.down[4], 7.83, 193),
    meanLine('sacks: mean loss, in the pocket', t.pocket, 7.0, 4100),
    meanLine('sacks: mean loss, after he left it', t.out, 5.26, 1208),
    share('sacks: after he left the pocket', t.out.n, n, 0.228, 5308, 0.06),
    meanLine('sacks: mean loss, backed up (own 20 in)', t.backed, 6.0, 418),
    // The call read as its rush (the mapping is approximate): reported beside the NFL's by rushers.
    { ...meanLine('sacks: mean loss, coverage call', t.call.passD, 5.68, 192), info: true },
    { ...meanLine('sacks: mean loss, base call', t.call.base, 6.41, 3341), info: true },
    { ...meanLine('sacks: mean loss, blitz', t.call.blitz, 7.05, 1774), info: true },
    share('scrambles in bounds: a tackler credited', t.tackled, t.scrambles, 0.932, 3307, 0.06),
    info('scrambles in bounds: slid', t.slid, t.scrambles, 'the owner: 0.40'),
    info('  slid, the first down in hand', ...t.slidBy.firstDown, 'reported'),
    info('  slid, leading late', ...t.slidBy.leadingLate, 'reported'),
    info('  slid, trailing late', ...t.slidBy.trailingLate, 'reported'),
    info('  slid, short of the sticks on 3rd/4th', ...t.slidBy.short34, 'reported'),
  ];
  for (const [k, v] of Object.entries(t.reasons).sort())
    lines.push(info(`  scramble ending: ${k}`, v, t.scrambles, 'reported'));
  for (const [k, v] of Object.entries(t.outWhy).sort()) lines.push(info(`out of bounds: ${k}`, v, t.outs, 'reported'));
  return lines;
}
