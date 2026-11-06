/**
 * GM habits audit (`src/engine/gmHabits.ts`), two parts.
 *
 * 1. Churn: four leagues of ten seasons in child processes. Pooled over seasons 3-10: how many habits an AI general
 *    manager carries, how many come and go a year, that every habit shows up and none takes over, that nobody carries
 *    more than three, and that someone turns Gun-Shy.
 * 2. Effects (`--effects`): six common habits are replayed (a baseline league with habits off, then one league per
 *    habit pinned on for every AI club, one seed) and must write more of their own log entries than the baseline. The
 *    five rare ones (bridgeQb, tradeUpQb, youngQb, firstsForStars, gunShy) are judged on built scenes: the moment each
 *    lean acts, run with the habit on and with every habit off.
 *
 *   npm run gm-habits                              # churn
 *   npm run gm-habits -- --effects                 # also the effects, 3 seasons a league
 *   npm run gm-habits -- --effects --only=bpa,gunShy   # just these effects, no churn
 */
import { fork } from 'node:child_process';
import { ageShift } from '../src/engine/aging';
import { releasePlayer } from '../src/engine/finance/cap';
import { createLeague } from '../src/engine/generate';
import { aiGm, habitsForce, HABIT_IDS, type HabitId } from '../src/engine/gmHabits';
import { simToEndOfSeason } from '../src/engine/league';
import { advanceOffseason, beginOffseason } from '../src/engine/offseason';
import { aiFreeAgencyDay, aiOffer } from '../src/engine/offseason/ai';
import { OFFSEASON_ROSTER_MAX } from '../src/engine/offseason/negotiation';
import { picksAhead, simDraft } from '../src/engine/offseason/draft';
import { playerOvr } from '../src/engine/positions';
import { Rng } from '../src/engine/rng';
import { teamPlayers } from '../src/engine/roster';
import { tradeContext } from '../src/engine/trade/context';
import { draftTrades, tradeUpReason, WINDOW } from '../src/engine/trade/draft';
import { judge as judgeTrade } from '../src/engine/trade/judge';
import { untouchables } from '../src/engine/trade/plans';
import type { TradeProposal } from '../src/engine/trade/rules';
import type { League } from '../src/engine/types';
import type { HabitRun } from './gm-habits-league';

const args = process.argv.slice(2);
const effects = args.includes('--effects');
const only = args
  .find((a) => a.startsWith('--only='))
  ?.slice(7)
  .split(',');
if (only && !effects) {
  console.error('--only= needs --effects (it picks which effects to run).');
  process.exit(1);
}
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

/** The six habits whose moves are common enough to count in replayed leagues; the other five are judged on built scenes. */
const REPLAYED: HabitId[] = ['extendEarly', 'sellsEarly', 'hisGuys', 'swaps', 'bpa', 'tagsFirst'];
const SCENES = ['bridgeQb', 'tradeUpQb', 'youngQb', 'firstsForStars', 'gunShy'] as const;

// ───────── built scenes (ported from the unit tests in offseason/gmHabitsHooks.test.ts, trade/habits.test.ts and
// trade/draft.test.ts): the moment each rare lean acts, run with the habit on and with every habit off ─────────

const pin = (id: HabitId | null) => {
  habitsForce.all = id;
  habitsForce.off = id === null;
  habitsForce.pos = 'QB';
};
const unpin = () => {
  habitsForce.all = null;
  habitsForce.off = false;
  habitsForce.pos = 'QB';
};

let offseasonBase: string | undefined;
const offseasonLeague = (): League => {
  if (!offseasonBase) {
    unpin();
    const l = createLeague({ seed: 'gm-habits-hooks' });
    simToEndOfSeason(l);
    beginOffseason(l);
    offseasonBase = JSON.stringify(l);
  }
  return JSON.parse(offseasonBase);
};
let draftBase: string | undefined;
const draftDayLeague = (): League => {
  if (!draftBase) {
    pin(null);
    const l = createLeague({ seed: 'draft-trades-f' });
    simToEndOfSeason(l);
    beginOffseason(l);
    while (l.phase !== 'draft') advanceOffseason(l, { autoUser: true });
    draftBase = JSON.stringify(l);
    unpin();
  }
  return JSON.parse(draftBase);
};
let tradeBase: string | undefined;
const tradeLeague = (): League => {
  tradeBase ??= JSON.stringify(createLeague({ seed: 'trade-habits' }));
  return JSON.parse(tradeBase);
};

/** A club with a 23-year-old starter at quarterback and a 31+ free agent a touch better, no other club with room. */
function bridgeScene(delta = 0.4, k = 0) {
  const l = offseasonLeague();
  l.phase = 'freeAgency';
  const ais = l.teams.filter((t) => t.id !== l.userTeamId && aiGm(l, t));
  const t = ais[k % ais.length];
  const young = teamPlayers(l, t.id)
    .filter((p) => p.position === 'QB')
    .sort((a, b) => playerOvr(b) - playerOvr(a))[0];
  young.age = 23;
  const fa = Object.values(l.players).find((p) => p.position === 'QB' && p.teamId !== null && p.teamId !== t.id)!;
  releasePlayer(l, fa);
  fa.age = 31 + ageShift('QB');
  fa.ratings = { ...young.ratings };
  for (const key of Object.keys(fa.ratings) as (keyof typeof fa.ratings)[]) fa.ratings[key] += delta;
  for (const c of l.teams) {
    if (c.id === t.id || c.id === l.userTeamId) continue;
    c.deadMoney.push({ season: l.season, amount: 1e9, playerId: -1, note: 'scene' });
  }
  return { l, t, fa };
}

/** Whether the free agent signs with the scene's club, and for how many years. */
function faSigns(delta: number, id: HabitId | null, k = 0) {
  const { l, t, fa } = bridgeScene(delta, k);
  pin(id);
  aiFreeAgencyDay(l, new Rng('bridge'), { rosterMax: OFFSEASON_ROSTER_MAX });
  unpin();
  return { signed: fa.teamId === t.id, years: fa.contract?.length ?? 0 };
}

/** The first club (of the first few) where a bridge GM signs the veteran for one year; off, he must not. */
const bridgeScore = () => {
  for (let k = 0; k < 8; k++) {
    const on = faSigns(2, 'bridgeQb', k);
    if (!on.signed || on.years !== 1) continue;
    const off = faSigns(2, null, k);
    const bridged = off.signed && off.years === 1;
    return {
      moved: bridged ? 0 : 1,
      what: `club ${k}: 1-year deal on, ${off.signed ? `${off.years}-year` : 'no'} deal off`,
    };
  }
  return { moved: 0, what: 'no club bridged' };
};

const tradeUpScore = () => {
  const l = draftDayLeague();
  let found = 0;
  let lost = 0;
  for (let i = 0; i < 32; i++) {
    for (const pk of picksAhead(l, WINDOW)) {
      if (pk.ownerId === l.userTeamId) continue;
      const team = l.teams[pk.ownerId];
      pin(null);
      const off = tradeUpReason(tradeContext(l), team, pk);
      pin('tradeUpQb');
      const on = tradeUpReason(tradeContext(l), team, pk);
      unpin();
      if (off && !on) lost++;
      if (on && !off && on.target.position === 'QB') found++;
    }
    draftTrades.off = true;
    simDraft(l, new Rng(`qb-${i}`), { stopAtUser: false, limit: 1 });
    draftTrades.off = false;
  }
  return { moved: lost ? -1 : found, what: `${found} QB trade-ups on that are none off` };
};

const youngQbScore = () => {
  const l = tradeLeague();
  const team = l.teams[9];
  const qb = teamPlayers(l, 9).find((p) => p.position === 'QB')!;
  qb.age = 23;
  l.gms[team.gmId!].appointments = [{ teamId: team.id, start: { season: 1 } as never, interim: false, through: 0 }];
  qb.draft = { season: l.season - 1, round: 1, pick: 1, teamId: team.id };
  team.gm.loyalty = 0;
  pin(null);
  const off = untouchables(tradeContext(l), team).has(qb.id);
  pin('youngQb');
  const on = untouchables(tradeContext(l), team).has(qb.id);
  unpin();
  return { moved: Number(on) - Number(off), what: `young QB untouchable: ${on} on, ${off} off` };
};

const starsScore = () => {
  const l = tradeLeague();
  const team = l.teams[9];
  team.stance = { ...(team.stance ?? ({} as never)), mode: 'contend' } as never;
  const firsts = l.draftPicks.filter((p) => p.ownerId === 9 && p.round === 1).map((p) => p.id);
  const proposal: TradeProposal = {
    sides: [
      { teamId: 0, players: [], picks: [] },
      { teamId: 9, players: [], picks: firsts },
    ],
  };
  pin(null);
  const off = judgeTrade(tradeContext(l), 9, proposal).give;
  pin('firstsForStars');
  const on = judgeTrade(tradeContext(l), 9, proposal).give;
  unpin();
  return { moved: off - on, what: `${firsts.length} firsts cost ${on.toFixed(1)} on, ${off.toFixed(1)} off` };
};

const gunShyScore = () => {
  const { l, t, fa } = bridgeScene();
  pin(null);
  const off = aiOffer(l, t, fa, new Rng('x'), 2).apy;
  pin('gunShy');
  const on = aiOffer(l, t, fa, new Rng('x'), 2).apy;
  unpin();
  // Somewhere along the free agent's range he clears the usual bar but not 1.3 times it.
  let bar = 0;
  for (let d = -6; d <= 0; d += 0.25) if (faSigns(d, null).signed && !faSigns(d, 'gunShy').signed) bar++;
  return {
    moved: on < off && bar > 0 ? 1 : on > off ? -1 : 0,
    what: `offer ${(on / off).toFixed(2)}x, ${bar} free agents clear the bar off but not on`,
  };
};

const SCENE_SCORES: Record<(typeof SCENES)[number], () => { moved: number; what: string }> = {
  bridgeQb: bridgeScore,
  tradeUpQb: tradeUpScore,
  youngQb: youngQbScore,
  firstsForStars: starsScore,
  gunShy: gunShyScore,
};

function verdict(id: string, moved: number, what: string): void {
  const mark = moved > 0 ? '▲ more' : moved < 0 ? '▼ WRONG WAY' : '— NO EFFECT';
  console.log(`  ${mark.padEnd(12)} ${id.padEnd(14)} ${what}`);
  if (moved <= 0) flags.push(id);
}

async function fx(): Promise<void> {
  const ids = REPLAYED.filter((id) => !only || only.includes(id));
  console.log(
    `\nGM habit effects: ${REPLAYED.length} habits replayed ${FX_SEASONS} seasons on one seed with each on for every AI club,\n` +
      `${SCENES.length} rare ones judged on built scenes\n`,
  );
  const leagues = Promise.all([
    play(FX_SEED, FX_SEASONS, { GM_HABITS_OFF: '1' }),
    ...ids.map((id) => play(FX_SEED, FX_SEASONS, { GM_HABITS_FORCE: id })),
  ]);
  // The scenes run here while the leagues play in their own processes.
  const scenes = SCENES.filter((id) => !only || only.includes(id)).map((id) => [id, SCENE_SCORES[id]()] as const);
  const [base, ...runs] = await leagues;
  const logs = (r: HabitRun, id: HabitId) => sum(r.years.map((y) => y.logCounts[id] ?? 0));
  ids.forEach((id, i) => {
    const more = logs(runs[i], id) - logs(base, id);
    verdict(id, more, `${logs(runs[i], id)} log entries vs ${logs(base, id)}`);
  });
  for (const [id, r] of scenes) verdict(id, r.moved, r.what);
}

if (!only) await churn();
if (effects) await fx();
console.log(
  flags.length ? `\nNeeds attention: ${[...new Set(flags)].join(', ')}.` : '\nEvery habit moves its decision.',
);
process.exit(flags.length ? 1 : 0);
