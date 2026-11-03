/**
 * Fits the open field's knobs (`src/engine/field/tuning.ts`) against parity once; they're constants after. A coordinate
 * search over a fixed sample of real moments on one seed each (the same seeds every trial, so trials compare cleanly),
 * scored by how far parity's rows sit from their ranges. Prints the knobs to paste.
 *
 *   npm run parity-fit [-- <rounds>]
 */
import { KNOBS } from '../src/engine/field/tuning';
import { harvest, type MomentRow } from './field-moments';
import { judge, loss, resolve } from './parity-core';

const ROUNDS = Number(process.argv[2] ?? 4);
const { rows, totals } = harvest('parity:fit', 120);
const pick = (kind: MomentRow['kind'], n: number) => rows.filter((r) => r.kind === kind).slice(0, n);
const sample = [...pick('run', 1500), ...pick('catch', 1500), ...pick('return', 1200)];
const rbShare = rows.filter((r) => r.kind === 'run' && r.rb).length / totals.rbCarries;

type Knob = keyof typeof KNOBS;
/** Each knob's trial steps: multiplicative, or additive for the ones that start at zero or count yards. */
const STEPS: Record<Knob, (v: number, scale: number) => number[]> = {
  react: (v, k) => [v * (1 - 0.3 * k), v * (1 + 0.3 * k)],
  angle: (v, k) => [v * (1 - 0.3 * k), v * (1 + 0.3 * k)],
  tackle: (v, k) => [v - 0.08 * k, v + 0.08 * k],
  move: (v, k) => [Math.max(0.02, v - 0.08 * k), v + 0.08 * k],
  afterContact: (v, k) => [v * (1 - 0.3 * k), v * (1 + 0.3 * k)],
  shed: (v, k) => [v * (1 - 0.3 * k), v * (1 + 0.3 * k)],
  hold: (v, k) => [v * (1 - 0.3 * k), v * (1 + 0.3 * k)],
  line: (v, k) => [v * (1 - 0.3 * k), v * (1 + 0.3 * k)],
  speed: (v, k) => [Math.max(0.01, v * (1 - 0.3 * k)), v * (1 + 0.3 * k)],
  skill: (v, k) => [Math.max(0.05, v * (1 - 0.3 * k)), v * (1 + 0.3 * k)],
  outLine: (v, k) => [Math.max(1, v - 1.5 * k), v + 1.5 * k],
  outGain: (v, k) => [Math.max(0.5, v - 1.5 * k), v + 1.5 * k],
  pad: (v, k) => [v - 0.8 * k, v + 0.8 * k],
};

function score(): number {
  const done = sample.map((r, i) => resolve(r, `fit:${i}`, 1));
  const lines = judge(done);
  // A back's missed tackles a touch, from the sample's runs and the league's share of carries that reach the open field.
  const backs = done.filter((r) => r.kind === 'run' && r.rb);
  const misses = (backs.reduce((n, r) => n + r.sp.misses, 0) / backs.length) * rbShare;
  lines.push({ label: "missed tackles a back's touch", value: misses, range: [0.12, 0.24], note: '' });
  return loss(lines);
}

let best = score();
console.log(`start: loss ${best.toFixed(2)}`, JSON.stringify(KNOBS));
for (let round = 0; round < ROUNDS + 2; round++) {
  const scale = round < ROUNDS ? 1 / (1 + round) : 0.25;
  for (const k of Object.keys(KNOBS) as Knob[]) {
    const was = KNOBS[k];
    for (const v of STEPS[k](was, scale)) {
      KNOBS[k] = v;
      const s = score();
      if (s < best) {
        best = s;
        console.log(`  ${k} ${was.toFixed(3)} → ${v.toFixed(3)}: loss ${s.toFixed(2)}`);
        break;
      }
      KNOBS[k] = was;
    }
  }
  console.log(`round ${round + 1}: loss ${best.toFixed(2)}`);
}
const shown = Object.entries(KNOBS)
  .map(([k, v]) => `  ${k}: ${Math.round(v * 1000) / 1000},`)
  .join('\n');
console.log(`\nexport const KNOBS = {\n${shown}\n};`);
