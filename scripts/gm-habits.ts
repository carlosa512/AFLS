/**
 * GM habits audit (`src/engine/gmHabits.ts`), two parts.
 *
 * 1. Churn: four leagues of ten seasons in child processes. Pooled over seasons 3-10: how many habits an AI general
 *    manager carries, how many come and go a year, that every habit shows up and none takes over, that nobody carries
 *    more than three, and that someone turns Gun-Shy.
 * 2. Effects (`--effects`): a baseline league with habits off, then one league per habit pinned on for every AI club
 *    (Gun-Shy at quarterback), all on one seed. Each habit must write more of its own log entries than the baseline
 *    (Gun-Shy: AI clubs pay veteran quarterbacks less).
 *
 *   npm run gm-habits                              # churn
 *   npm run gm-habits -- --effects                 # also the effects, 3 seasons a league
 *   npm run gm-habits -- --effects --only=bpa,gunShy
 */
import { fork } from 'node:child_process';
import { HABIT_IDS, type HabitId } from '../src/engine/gmHabits';
import type { HabitRun } from './gm-habits-league';

const args = process.argv.slice(2);
const effects = args.includes('--effects');
const only = args
  .find((a) => a.startsWith('--only='))
  ?.slice(7)
  .split(',');
const CHURN_SEEDS = ['habits-1', 'habits-2', 'habits-3', 'habits-4'];
const CHURN_SEASONS = 10;
const FX_SEED = 'habits-fx';
const FX_SEASONS = 3;
const flags: string[] = [];

function play(seed: string, seasons: number, env: Record<string, string> = {}): Promise<HabitRun> {
  return new Promise((resolve, reject) => {
    const child = fork(new URL('./gm-habits-league.ts', import.meta.url).pathname, [], {
      env: {
        ...process.env,
        GM_HABITS_SEED: seed,
        GM_HABITS_SEASONS: String(seasons),
        GM_HABITS_FORCE: '',
        GM_HABITS_OFF: '',
        ...env,
      },
    });
    let done = false;
    child.once('message', (run) => {
      done = true;
      resolve(run as HabitRun);
      child.kill();
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => done || reject(new Error(`league ${seed} exited (${signal ?? code})`)));
  });
}

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

function judge(label: string, value: number, lo: number, hi: number, digits = 2): void {
  const ok = Number.isFinite(value) && value >= lo && value <= hi;
  const range = hi === Infinity ? `≥${lo}` : `${lo}–${hi}`;
  console.log(`  ${label.padEnd(36)} ${value.toFixed(digits).padStart(7)}  (${range}) ${ok ? '' : '▼'}`);
  if (!ok) flags.push(label);
}

async function churn(): Promise<void> {
  const runs = await Promise.all(CHURN_SEEDS.map((s) => play(s, CHURN_SEASONS)));
  console.log(
    `\nGM habit churn: ${runs.length} leagues x ${CHURN_SEASONS} seasons, pooled over seasons 3-${CHURN_SEASONS}\n`,
  );
  const late = runs.flatMap((r) => r.years.slice(2));
  judge('active habits per GM', avg(late.map((y) => y.active)), 1, 2);
  judge('habits gained or lost per GM a year', avg(late.map((y) => y.changes)), 0.25, 0.9);
  judge('most habits one GM carries', Math.max(...late.map((y) => y.maxActive)), 0, 3, 0);
  judge('GMs turned Gun-Shy (4 leagues, end)', sum(runs.map((r) => r.years.at(-1)!.gunShyFormed)), 1, Infinity, 0);
  // Every habit is held by someone by season 5 (in the leagues pooled), and none takes over a league.
  for (const id of HABIT_IDS) {
    const seen = Math.max(...runs.flatMap((r) => r.years.slice(0, 5).map((y) => y.share[id] ?? 0)));
    const top = Math.max(...late.map((y) => y.share[id] ?? 0));
    judge(`${id} held by season 5 (share)`, seen, 1e-9, 1, 3);
    judge(`${id} most held (share)`, top, 0, 0.4, 3);
  }
}

async function fx(): Promise<void> {
  const ids = HABIT_IDS.filter((id) => !only || only.includes(id));
  console.log(`\nGM habit effects: each habit pinned on for every AI club, ${FX_SEASONS} seasons on one seed\n`);
  const [base, ...runs] = await Promise.all([
    play(FX_SEED, FX_SEASONS, { GM_HABITS_OFF: '1' }),
    ...ids.map((id) => play(FX_SEED, FX_SEASONS, { GM_HABITS_FORCE: id })),
  ]);
  const logs = (r: HabitRun, id: HabitId) => sum(r.years.map((y) => y.logCounts[id] ?? 0));
  const spend = (r: HabitRun) => sum(r.years.map((y) => y.qbSpend));
  const M = (k: number) => `$${(k / 1000).toFixed(0)}M`;
  ids.forEach((id, i) => {
    const r = runs[i];
    // `moved` is how far the habit pushed its stat the right way: more of its log entries, or less spent on quarterbacks.
    const moved = id === 'gunShy' ? spend(base) - spend(r) : logs(r, id) - logs(base, id);
    const what =
      id === 'gunShy'
        ? `QB spend ${M(spend(r))} vs ${M(spend(base))}`
        : `${logs(r, id)} log entries vs ${logs(base, id)}`;
    const mark = moved > 0 ? '▲ more' : moved < 0 ? '▼ WRONG WAY' : '— NO EFFECT';
    console.log(`  ${mark.padEnd(12)} ${id.padEnd(14)} ${what}`);
    if (moved <= 0) flags.push(id);
  });
}

await churn();
if (effects) await fx();
console.log(
  flags.length ? `\nNeeds attention: ${[...new Set(flags)].join(', ')}.` : '\nEvery habit moves its decision.',
);
process.exit(flags.length ? 1 : 0);
