/**
 * Morale check (docs/superpowers/specs/2026-10-29-morale-core-design.md, "Checks"). Plays seasons league-wide and
 * checks the moods look like a real league's:
 *
 * 1. Bands: most players sit between Okay and Very good; Poor or worse is a minority; Abysmal and Superb are rare.
 * 2. Underpaid final-year starters (veterans paid under 0.7× their market) mostly read Poor or worse.
 * 3. A benching: the week it lands his mood drops by 1.5 or more; six steps later he is back within 1.5 of his target.
 * 4. Winning rooms (.650 or better) average at least a step happier than losing ones (.350 or worse).
 * 5. Nothing runs away: the league's mean at week 18 stays within ±1.0 of the first season's, and no level leaves
 *    −10…+10.
 * 6. Talks (G3): asks per club per season 4–30, every club counted alike (yours answered by the AI's rule, since nobody
 *    clicks), and 25–75% of the promises that resolve are kept.
 *
 *   npm run morale                        # 4 seasons, seed morale-check
 *   npm run morale -- --seasons 6 --seed x
 */
import { yearsLeft } from '../src/engine/finance/contract';
import { buildMarket, marketApy } from '../src/engine/finance/market';
import { aiReply, answerTalk } from '../src/engine/playerTalks';
import { createLeague } from '../src/engine/generate';
import { playWeek } from '../src/engine/league';
import {
  expectedRole,
  moraleClock,
  moraleContext,
  moraleFactors,
  moraleLevel,
  moraleStepOf,
  moraleTarget,
} from '../src/engine/morale';
import { advanceOffseason, beginOffseason } from '../src/engine/offseason';
import { computeRecords } from '../src/engine/season/standings';
import type { League, Phase, Player } from '../src/engine/types';

const arg = (name: string, fallback: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const SEASONS = Number(arg('seasons', '4'));
const SEED = arg('seed', 'morale-check');

let misses = 0;
const check = (label: string, value: number, [lo, hi]: [number, number], digits = 2) => {
  const ok = value >= lo && value <= hi;
  if (!ok) misses++;
  console.log(
    `${ok ? '✓' : '✗'} ${label.padEnd(54)} ${value.toFixed(digits).padStart(7)}   ${lo}–${hi}${ok ? '' : value < lo ? '  ▼ LOW' : '  ▲ HIGH'}`,
  );
};
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);

const league = createLeague({ seed: SEED });
const rostered = (l: League) => Object.values(l.players).filter((p) => p.teamId !== null && p.morale);

// 1, 2 and 5: samples at weeks 9 and 18.
const steps: number[] = [];
const underpaid: number[] = [];
const means: number[] = [];
const roomGap: number[] = [];
let outOfRange = 0;

function sample(atEnd: boolean) {
  const ctx = moraleContext(league);
  // Built, not read from `leagueMarket`: filling that cache would change the AI's pay reads, and so the league.
  const market = buildMarket(league);
  const levels = new Map<number, number[]>();
  for (const p of rostered(league)) {
    const level = moraleLevel(league, p);
    steps.push(moraleStepOf(level));
    (levels.get(p.teamId!) ?? levels.set(p.teamId!, []).get(p.teamId!)!).push(level);
    const c = p.contract;
    if (
      c &&
      p.experience >= 3 &&
      yearsLeft(c, league.season) <= 1 &&
      expectedRole(p, ctx) === 2 &&
      c.apy < 0.7 * marketApy(market, p)
    )
      underpaid.push(moraleStepOf(level) <= 3 ? 1 : 0);
  }
  if (!atEnd) return;
  means.push(mean([...levels.values()].flat()));
  const records = computeRecords(league);
  const share = (id: number) => {
    const r = records.get(id)!;
    return (r.w + r.t / 2) / Math.max(1, r.w + r.l + r.t);
  };
  const room = (id: number) => mean(levels.get(id) ?? []);
  const winners = league.teams.filter((t) => share(t.id) >= 0.65).map((t) => room(t.id));
  const losers = league.teams.filter((t) => share(t.id) <= 0.35).map((t) => room(t.id));
  if (winners.length && losers.length) roomGap.push(mean(winners) - mean(losers));
}

// 3: every benching followed for six steps from the step it lands.
interface Watch {
  p: Player;
  before: number;
  after?: number;
  steps: number;
  gap?: number;
}
const watching: Watch[] = [];
const done: Watch[] = [];
let before = new Map<number, number>();

// 6: talks, counted the step they happen.
const asks = new Map<string, number>();
let promisesMade = 0;
let kept = 0;
let broken = 0;
function talks(clock: number) {
  for (const p of rostered(league)) {
    const t = p.morale!.talk;
    const key = `${league.season}:${p.teamId}`;
    // An AI club answers the step he asks; yours is answered here by the same rule.
    if (t?.answered?.at === clock && t.answered.ask === clock) asks.set(key, (asks.get(key) ?? 0) + 1);
    else if (t?.ask?.at === clock) {
      asks.set(key, (asks.get(key) ?? 0) + 1);
      answerTalk(league, p.id, aiReply(league, p.teamId!, t.ask.cause));
    }
    if (p.morale!.talk?.answered?.at === clock && p.morale!.talk.answered.reply === 'promise') promisesMade++;
    for (const j of p.morale!.jolts ?? [])
      if (j.at === clock) {
        if (j.kind === 'kept') kept++;
        if (j.kind === 'broken') broken++;
      }
  }
}

function step(run: () => void) {
  before = new Map(rostered(league).map((p) => [p.id, moraleLevel(league, p)]));
  run();
  const clock = league.moraleAt ?? moraleClock(league);
  talks(clock);
  for (const p of Object.values(league.players)) {
    const m = p.morale;
    if (m && (Math.abs(m.level) > 10 || Math.abs(moraleLevel(league, p)) > 10)) outOfRange++;
  }
  const ctx = moraleContext(league);
  for (const w of watching) {
    w.steps++;
    if (w.steps === 6 && w.p.teamId !== null && w.p.morale)
      w.gap = Math.abs(moraleLevel(league, w.p) - moraleTarget(moraleFactors(league, w.p, ctx)));
  }
  done.push(...watching.filter((w) => w.steps >= 6));
  const still = watching.filter((w) => w.steps < 6);
  watching.length = 0;
  watching.push(...still);
  for (const p of rostered(league)) {
    const fresh = (p.morale!.jolts ?? []).some((j) => j.kind === 'benched' && j.at === clock);
    if (fresh && before.has(p.id))
      watching.push({ p, before: before.get(p.id)!, after: moraleLevel(league, p), steps: 0 });
  }
}

const t0 = Date.now();
for (let s = 0; s < SEASONS; s++) {
  while (league.phase === 'regular' || league.phase === 'playoffs') {
    const week = league.week;
    const regular = league.phase === 'regular';
    step(() => playWeek(league));
    if (regular && week === 9) sample(false);
    if (regular && week === 18) sample(true);
  }
  if (s === SEASONS - 1) break;
  step(() => beginOffseason(league));
  while ((league.phase as Phase) !== 'regular') step(() => advanceOffseason(league, { autoUser: true }));
}

const share = (f: (s: number) => boolean) => steps.filter(f).length / steps.length;
console.log(
  `Morale: ${SEASONS} season(s), seed ${SEED}, ${steps.length} samples, ${((Date.now() - t0) / 1000).toFixed(0)}s\n`,
);
check(
  'Okay through Very good (share of samples)',
  share((s) => s >= 4 && s <= 6),
  [0.6, 1],
);
check(
  'Poor or worse',
  share((s) => s <= 3),
  [0.1, 0.3],
);
check(
  'Abysmal',
  share((s) => s === 1),
  [0, 0.03],
);
check(
  'Superb',
  share((s) => s === 7),
  [0, 0.08],
);
check(`Underpaid final-year starters, Poor or worse (n=${underpaid.length})`, mean(underpaid), [0.6, 1]);
const drops = done.filter((w) => w.after !== undefined).map((w) => w.before - w.after!);
check(`Benched: drop the week it lands (n=${drops.length})`, mean(drops), [1.5, 20]);
const gaps = done.filter((w) => w.gap !== undefined).map((w) => w.gap!);
check(`Benched: six steps on, gap to his target (n=${gaps.length})`, mean(gaps), [0, 1.5]);
check('Winning rooms minus losing rooms (mean of seasons)', mean(roomGap), [1, 20]);
for (let i = 1; i < means.length; i++)
  check(`League mean at week 18, season ${i + 1} vs the first`, means[i] - means[0], [-1, 1]);
check('Levels outside −10…+10', outOfRange, [0, 0], 0);
check(`Talks: asks per club per season (${asks.size} club-seasons)`, mean([...asks.values()]), [4, 30]);
check(
  `Talks: promises kept, of those resolved (made ${promisesMade}, kept ${kept}, broken ${broken})`,
  kept / Math.max(1, kept + broken),
  [0.25, 0.75],
);

console.log(`\n${misses} number(s) outside target range`);
process.exit(misses ? 1 : 0);
