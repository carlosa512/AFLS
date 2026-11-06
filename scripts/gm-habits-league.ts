/**
 * One league for the GM habits check (`scripts/gm-habits.ts`): play `seasons` seasons the way the offseason audit does
 * and report, after each new year, how many habits the AI general managers carry, how many came and went, who holds
 * each, what the log wrote and what AI clubs paid veteran quarterbacks. `GM_HABITS_FORCE` pins one habit on for every AI
 * club and `GM_HABITS_OFF` turns them all off, both set before the league is built so the starting habits read them.
 */
import { createLeague } from '../src/engine/generate';
import { ACTIVE_GRIP, habitsForce, HABIT_IDS, type HabitId } from '../src/engine/gmHabits';
import { simToEndOfSeason } from '../src/engine/league';
import { advanceOffseason, beginOffseason } from '../src/engine/offseason';

export interface HabitYear {
  /** Mean active habits per AI general manager. */
  active: number;
  /** Habits gained or lost per AI general manager since last year. */
  changes: number;
  /** Per habit, the share of AI general managers holding it at grip 2 or more. */
  share: Record<string, number>;
  maxActive: number;
  /** AI general managers holding a Gun-Shy habit of any grip. */
  gunShyFormed: number;
  /** Per habit, the log entries all AI general managers wrote this league year. */
  logCounts: Record<string, number>;
  /** The apy AI clubs gave veteran quarterbacks signed this offseason. */
  qbSpend: number;
}

export interface HabitRun {
  seed: string;
  years: HabitYear[];
}

const seed = process.env.GM_HABITS_SEED!;
const seasons = Number(process.env.GM_HABITS_SEASONS);
const force = process.env.GM_HABITS_FORCE as HabitId | undefined;
if (force) habitsForce.all = force;
if (process.env.GM_HABITS_OFF === '1') habitsForce.off = true;

const league = createLeague({ seed, personnel: true });
const aiGms = () =>
  league.teams.filter((t) => t.id !== league.userTeamId && t.gmId !== null).map((t) => league.gms[t.gmId!]);
const activeSet = (gm: { habits?: Record<string, { grip: number }> }) =>
  new Set(
    Object.entries(gm.habits ?? {})
      .filter(([, h]) => h.grip >= ACTIVE_GRIP)
      .map(([k]) => k),
  );

let before = new Map(aiGms().map((g) => [g.id, activeSet(g)]));
const years: HabitYear[] = [];
for (let s = 0; s < seasons; s++) {
  simToEndOfSeason(league);
  beginOffseason(league);
  while (league.phase !== 'regular') advanceOffseason(league, { autoUser: true });
  const gms = aiGms();
  const share: Record<string, number> = {};
  const logCounts: Record<string, number> = {};
  for (const id of HABIT_IDS) {
    share[id] = 0;
    logCounts[id] = 0;
  }
  let active = 0;
  let changes = 0;
  let maxActive = 0;
  let gunShyFormed = 0;
  for (const g of gms) {
    const now = activeSet(g);
    const was = before.get(g.id);
    // A man who came in this year has no "before": his first set is not a change.
    if (was) for (const k of new Set([...now, ...was])) if (now.has(k) !== was.has(k)) changes++;
    for (const k of now) share[k] = (share[k] ?? 0) + 1 / gms.length;
    active += now.size;
    maxActive = Math.max(maxActive, now.size);
    if (g.habits?.gunShy) gunShyFormed++;
    for (const m of g.habitLog ?? [])
      if (m.season === league.season) logCounts[m.habit] = (logCounts[m.habit] ?? 0) + 1;
  }
  let qbSpend = 0;
  for (const p of Object.values(league.players)) {
    const c = p.contract;
    if (p.position !== 'QB' || p.teamId === null || p.teamId === league.userTeamId || !c) continue;
    if (c.kind === 'veteran' && c.signedSeason === league.season) qbSpend += c.apy;
  }
  years.push({
    active: active / gms.length,
    changes: changes / gms.length,
    share,
    maxActive,
    gunShyFormed,
    logCounts,
    qbSpend,
  });
  before = new Map(gms.map((g) => [g.id, activeSet(g)]));
}
process.send!({ seed, years } satisfies HabitRun);
