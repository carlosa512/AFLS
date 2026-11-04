/**
 * Fits the open field's knobs (`src/engine/field/tuning.ts`) against parity once; they're constants after. A coordinate
 * search scored on the moments `npm run parity` itself judges (its four leagues, two of its seeds each), with every
 * league and matchup row, the rebuilt league numbers and missed tackles included, so a better fit is a better parity
 * run. Each league's moments live in a worker process; a trial sends them the knobs and gathers what they resolve.
 * Prints the knobs to paste.
 *
 *   npm run parity-fit [-- <rounds>]
 */
import { fork, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { KNOBS } from '../src/engine/field/tuning';
import { harvest, type Totals } from './field-moments';
import { judge, loss, resolve, type Resolved } from './parity-core';

const LEAGUES = 4;
const GAMES = 75;
const FIT_SEEDS = 2;

type Knob = keyof typeof KNOBS;
interface Trial {
  rows: Resolved[];
  totals: Totals;
}

// ───────── a league's worker: harvest once, resolve its moments for each trial's knobs ─────────

if (process.argv[2] === 'worker') {
  const n = Number(process.argv[3]);
  const { rows, totals } = harvest(`parity:${n}`, GAMES);
  process.on('message', (knobs: Partial<typeof KNOBS>) => {
    Object.assign(KNOBS, knobs);
    // The same keys parity resolves them on: its first two seeds.
    const done = rows.map((r, i) => resolve(r, `parity:${n}:${i}`, FIT_SEEDS));
    process.send!({ rows: done, totals } satisfies Trial);
  });
  process.send!('ready');
} else await fit();

async function fit() {
  const ROUNDS = Number(process.argv[2] ?? 4);
  const self = fileURLToPath(import.meta.url);
  const workers: ChildProcess[] = [];
  await Promise.all(
    Array.from({ length: LEAGUES }, (_, n) => {
      const w = fork(self, ['worker', String(n)], { execArgv: process.execArgv });
      workers.push(w);
      return new Promise<void>((ready) => w.once('message', () => ready()));
    }),
  );
  const trial = () =>
    Promise.all(
      workers.map(
        (w) =>
          new Promise<Trial>((done) => {
            w.once('message', (m) => done(m as Trial));
            w.send({ ...KNOBS });
          }),
      ),
    );

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
    stretch: (v, k) => [Math.max(0, v - 1.5 * k), v + 1.5 * k],
    retTackle: (v, k) => [v - 0.06 * k, v + 0.06 * k],
    retHold: (v, k) => [Math.max(0, v * (1 - 0.3 * k)), v * (1 + 0.3 * k)],
    carrier: (v, k) => [Math.max(0.05, v * (1 - 0.3 * k)), v * (1 + 0.3 * k)],
    meet: (v, k) => [Math.max(0, v - 0.2 * k), v + 0.2 * k],
    padCatch: (v, k) => [v - 0.8 * k, v + 0.8 * k],
  };

  async function score(): Promise<number> {
    const parts = await trial();
    const rows = parts.flatMap((p) => p.rows);
    const totals = parts.reduce<Totals>(
      (t, p) => {
        for (const k of Object.keys(t) as (keyof Totals)[]) t[k] += p.totals[k];
        return t;
      },
      { games: 0, rushAtt: 0, rushYds: 0, rushTd: 0, rbCarries: 0, passAtt: 0, passYds: 0, passTd: 0 },
    );
    return loss(judge(rows, totals));
  }

  let best = await score();
  console.log(`start: loss ${best.toFixed(2)}`, JSON.stringify(KNOBS));
  for (let round = 0; round < ROUNDS + 2; round++) {
    const scale = round < ROUNDS ? 1 / (1 + round) : 0.25;
    for (const k of Object.keys(KNOBS) as Knob[]) {
      const was = KNOBS[k];
      for (const v of STEPS[k](was, scale)) {
        KNOBS[k] = v;
        const s = await score();
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
  for (const w of workers) w.kill();
}
