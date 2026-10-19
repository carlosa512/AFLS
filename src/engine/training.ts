/**
 * Position moves: coaches teaching a player a new position over time (docs/TRAINING.md §4). Nobody is
 * switched in one click, the user or an AI team. A plan starts in the offseason; a learning clock ticks
 * through the offseason program, training camp and the season's weeks; and the label changes only on
 * cut-down day, once he's ready, in `changePosition`, the one place in the game that writes
 * `player.position`. Until then he plays his old position.
 *
 * Learning writes no rating. A move changes his label, his ceiling (rebased so a move never makes a
 * prospect better than staying put) and, through the label, how yearly development spreads his growth.
 * His body keeps the aging clock of the position it grew up in (`bodyAs`, read by `developPlayer`), so a
 * move buys a position he can play, never a younger body. Pay follows the label from his next deal; a
 * tag or option uses the higher of the two positions for two years (`finance/market.ts`); a mover can't be
 * traded until the new league year (`trade/rules.ts`).
 *
 * The only randomness is each plan's hidden pace, on its own stream: league streams never move.
 */
import { agingFamily, declineOnset } from './aging';
import { coachingFor } from './coaching';
import { logTransaction } from './finance/cap';
import { isExpired } from './finance/contract';
import { leagueMarket, marketApy, resetLeagueMarket } from './finance/market';
import { KEEP_MIN } from './offseason/ai';
import { BODY, OVR_WEIGHTS, overall, playerOvr, STARTERS } from './positions';
import { fillBag, QUIRKS_FOR, type QuirkId } from './quirks';
import { clamp, Rng } from './rng';
import { activeRoster, isAvailable, syncDepthChart, teamPlayers } from './roster';
import { REGULAR_SEASON_WEEKS } from './season/schedule';
import { rosterOf, tradeContext, type TradeContext } from './trade/context';
import { teamNeeds, type Need } from './trade/plans';
import { workEthicOf } from './traits';
import type { Attribute, League, Learning, Player, Position, Team } from './types';
import { OFFSEASON_PHASES } from './types';

// ───────── the moves the coaches will teach ─────────

export interface Conversion {
  from: Position;
  to: Position;
  /** A: a natural move, usually ready the camp after it starts. B: real retraining, about a year longer. */
  tier: 'A' | 'B';
  /** Learning-weeks to be ready, at a typical pace (a year holds about 22: program 9, camp 4.5, season 9). */
  weeks: number;
  /** Ages a plan can start at: a speed position is for young legs, an aging move for veterans too. */
  ages: [number, number];
  /** Learned with live contact: spring work (no pads under the CBA) teaches it at half speed. */
  contact?: true;
}

/**
 * Six directed moves to start, from the gap and aging tables in docs/TRAINING.md §1: an aging corner
 * becomes a safety, an edge rusher a linebacker or an interior lineman, safeties and linebackers trade
 * places, a young safety moves to corner. Every other pair is refused. Weeks are tuning targets
 * (`npm run training`); the next pairs (LB→EDGE, TE→OL, RB→WR) wait on its economics probe.
 */
export const CONVERSIONS: readonly Conversion[] = [
  { from: 'CB', to: 'S', tier: 'A', weeks: 8, ages: [21, 36] },
  { from: 'S', to: 'LB', tier: 'A', weeks: 11, ages: [21, 32] },
  { from: 'LB', to: 'S', tier: 'A', weeks: 12, ages: [21, 34] },
  { from: 'EDGE', to: 'LB', tier: 'B', weeks: 22, ages: [21, 34] },
  { from: 'EDGE', to: 'DT', tier: 'B', weeks: 24, ages: [21, 34], contact: true },
  { from: 'S', to: 'CB', tier: 'B', weeks: 22, ages: [21, 25] },
];

export const conversionOf = (from: Position, to: Position): Conversion | undefined => CONVERSIONS.find((c) => c.from === from && c.to === to);
/** Positions the coaches could teach a player, whatever his age. */
export const targetsFor = (p: Pick<Player, 'position'>): Position[] => CONVERSIONS.filter((c) => c.from === p.position).map((c) => c.to);

/** Plans a team can run at once, yours and an AI team's alike; AI teams run one. */
export const MAX_LEARNERS = 2;
export const AI_LEARNERS = 1;
/** League years after a move before a player can start another plan. */
export const COOLDOWN = 3;
/** Learning-weeks in the offseason program (nine weeks of the CBA's spring) and in camp (three weeks, full-time). */
export const PROGRAM_WEEKS = 9;
export const CAMP_WEEKS = 4.5;
/** Learning-weeks a regular-season week gives: practice is the game plan, his new position gets a share. */
export const SEASON_WEEK = 0.5;
/** Share of the overall a move takes from him that his ceiling keeps (`rebasedPotential`). */
const KEEP = 0.5;

/** Scripts flip this to replay a league without AI moves (the twin-league audit). */
export const trainingConfig = { aiMoves: true };

// ───────── reading the state ─────────

/** His plan, if it is still live: a trade, a release or retirement ends it. */
export function activeLearning(p: Player): Learning | undefined {
  const l = p.learning;
  return l && !p.retired && p.teamId === l.teamId ? l : undefined;
}

/** Players a team is teaching a new position. */
export const learners = (league: League, teamId: number): Player[] => teamPlayers(league, teamId).filter((p) => activeLearning(p));

/** The position his body aged as before any move, for `DevContext.bodyAs` (undefined if he never moved). */
export const bodyAs = (p: Player): Position | undefined => p.moves?.[0]?.from;

/** The position he played in a season (a move on cut-down day counts for that season). */
export function positionIn(p: Player, season: number): Position {
  const moves = p.moves ?? [];
  let pos = moves[0]?.from ?? p.position;
  for (const m of moves) if (m.season <= season) pos = m.to;
  return pos;
}

/** Positions he has left behind, oldest first (for text written under an old label). */
export const formerPositions = (p: Player): Position[] => [...new Set((p.moves ?? []).map((m) => m.from))];

/** True once his clock has run to the move's weeks. */
export function isReady(p: Player): boolean {
  const l = activeLearning(p);
  const c = l && conversionOf(p.position, l.to);
  return !!c && l!.done >= c.weeks;
}

/** How far along he is, in Football Manager's words. Shown for your own players only. */
export type Familiarity = 'Awkward' | 'Unconvincing' | 'Competent' | 'Accomplished' | 'Ready';
export function familiarity(p: Player): Familiarity | null {
  const l = activeLearning(p);
  const c = l && conversionOf(p.position, l.to);
  if (!l || !c) return null;
  const f = l.done / c.weeks;
  return f >= 1 ? 'Ready' : f >= 0.75 ? 'Accomplished' : f >= 0.5 ? 'Competent' : f >= 0.25 ? 'Unconvincing' : 'Awkward';
}

// ───────── the learning clock ─────────

/**
 * How fast he learns, per learning-week: the new room's coaching, his age, his work ethic and his own
 * hidden pace (1 when the coaches estimate, so an estimate never gives the pace away). 0.3–2.
 */
export function learnRate(league: League, p: Player, to: Position, pace = 1): number {
  const coach = coachingFor(league, p.teamId, to).rate;
  const age = Math.max(0.6, 1 - 0.02 * Math.max(0, p.age - 24));
  const ethic = clamp(1 + 0.03 * (workEthicOf(p) - 10.5), 0.7, 1.3);
  // Mentoring (docs/TRAINING.md §8) multiplies in here later; until then it is 1.
  return clamp(coach * age * ethic * pace, 0.3, 2);
}

/** Learning-weeks a block gives this move (spring has no live contact). */
function blockWeeks(c: Conversion, block: 'program' | 'camp'): number {
  return block === 'program' ? PROGRAM_WEEKS * (c.contact ? 0.5 : 1) : CAMP_WEEKS;
}

/** Bank learning for every live plan; a plan whose player has moved on is cleared. */
function tick(league: League, weeks: (c: Conversion, p: Player) => number): void {
  for (const p of Object.values(league.players)) {
    if (!p.learning) continue;
    const l = activeLearning(p);
    const c = l && conversionOf(p.position, l.to);
    if (!l || !c) {
      delete p.learning;
      continue;
    }
    const w = weeks(c, p);
    if (w > 0) l.done = Math.round((l.done + w * learnRate(league, p, l.to, l.pace)) * 100) / 100;
  }
}

/** The offseason program (run as the draft closes) and camp (run on cut-down day, before any move). */
export function learnBlock(league: League, block: 'program' | 'camp'): void {
  // An injured player sits in meetings in the spring, but can't practice in camp.
  tick(league, (c, p) => (block === 'camp' && !isAvailable(p) ? 0 : blockWeeks(c, block)));
}

/** A regular-season week: every learner who practiced banks a little. */
export function trainingWeek(league: League): void {
  tick(league, (_, p) => (isAvailable(p) ? SEASON_WEEK : 0));
}

// ───────── starting and stopping ─────────

/** Why a plan can't start, in plain words, or null. */
export function moveProblem(league: League, p: Player, to: Position): string | null {
  return playerProblem(league, p, to) ?? (p.teamId === null ? null : slotProblem(league, p.teamId, learners(league, p.teamId).length));
}

/** A team's plans are full. */
function slotProblem(league: League, teamId: number, running: number): string | null {
  const cap = teamId === league.userTeamId ? MAX_LEARNERS : AI_LEARNERS;
  if (running < cap) return null;
  return cap === 1 ? 'Already teaching a player a new position.' : `Already teaching ${cap} players new positions.`;
}

/** Everything but the team's free slots. */
function playerProblem(league: League, p: Player, to: Position): string | null {
  const c = conversionOf(p.position, to);
  if (!c) return `The coaches won't teach a ${p.position} to play ${to}.`;
  if (p.retired || p.teamId === null) return 'Not on a team.';
  if (!OFFSEASON_PHASES.includes(league.phase)) return 'Position moves start in the offseason.';
  if (!p.contract || isExpired(p.contract, league.season)) return 'Not under contract.';
  if (activeLearning(p)) return `Already learning ${activeLearning(p)!.to}.`;
  const last = p.moves?.at(-1);
  if (last && league.season < last.season + COOLDOWN) return 'Changed position too recently.';
  if (p.age < c.ages[0]) return 'Too young for this move.';
  if (p.age > c.ages[1]) return to === 'CB' ? "Too old: he won't get the speed back." : 'Too old for this move.';
  return null;
}

/** Start teaching him a new position. Throws if it can't start (`moveProblem`). */
export function startMove(league: League, playerId: number, to: Position): void {
  const p = league.players[playerId];
  const problem = moveProblem(league, p, to);
  if (problem) throw new Error(problem);
  const pace = Math.round(new Rng(`${league.seed}:train:pace:${league.season}:${p.id}`).float(0.85, 1.15) * 100) / 100;
  p.learning = { to, done: 0, pace, since: league.season, teamId: p.teamId! };
}

/** Stop a plan. What he learned is lost: a restart is a new plan. */
export function stopMove(league: League, playerId: number): void {
  delete league.players[playerId].learning;
}

/** Turn down the coaches' suggestion for him: they won't bring it up again until the league year after next. */
export function passMove(league: League, playerId: number): void {
  const team = league.teams[league.userTeamId];
  ((team.training ??= {}).passed ??= {})[playerId] = league.season;
  // Keep only what still matters.
  for (const [id, season] of Object.entries(team.training.passed!)) if (season < league.season - 1) delete team.training.passed![Number(id)];
}

/** The user's one setting: let the coaches start their own suggestion (AI teams always do). */
export function setCoachesDecide(league: League, on: boolean): void {
  const team = league.teams[league.userTeamId];
  if (on) (team.training ??= {}).coachesDecide = true;
  else if (team.training) delete team.training.coachesDecide;
}

// ───────── cut-down day ─────────

/** The fewest a team keeps at a position after a move: your starters' count, an AI team's keep-minimum. */
const minimumAt = (league: League, teamId: number, pos: Position) => (teamId === league.userTeamId ? STARTERS[pos] : KEEP_MIN[pos]);

/** Why a ready player waits instead of moving, or null: a move never leaves his old position short. */
export function holdReason(league: League, p: Player): string | null {
  if (p.teamId === null) return 'Not on a team.';
  const left = activeRoster(league, p.teamId).filter((x) => x.position === p.position && x.id !== p.id).length;
  return left < minimumAt(league, p.teamId, p.position) ? `It would leave you short at ${p.position}.` : null;
}

/** Cut-down day: every ready learner changes position, unless it would leave his old one short (he waits). */
export function completeMoves(league: League): void {
  // One at a time: two ready learners can't both leave the same room short.
  for (const p of Object.values(league.players)) if (isReady(p) && !holdReason(league, p)) changePosition(league, p, p.learning!.to);
}

/**
 * His ceiling at the new position: the headroom he had, plus half of what the new label costs him today,
 * never more than he had. A move puts a prospect where the roster needs him; it never makes him better.
 */
export function rebasedPotential(potential: number, ovrOld: number, ovrNew: number): number {
  const drop = ovrOld - ovrNew;
  const round = (x: number) => Math.round(x * 10) / 10;
  if (drop <= 0) return Math.max(potential, round(ovrNew));
  return Math.min(potential, round(ovrNew + Math.max(0, potential - ovrOld) + KEEP * drop));
}

/**
 * The one writer of `player.position`. Rebases his ceiling, drops habits the new position can't have and
 * refills his bag, brings his weight into the new range, files him by rating on a hand-sorted depth chart
 * (auto charts rebuild), and logs it, which also refreshes the caches keyed on the transaction log.
 */
export function changePosition(league: League, p: Player, to: Position): void {
  const from = p.position;
  p.potential = rebasedPotential(p.potential, playerOvr(p), overall(p.ratings, to));
  p.position = to;
  (p.moves ??= []).push({ season: league.season, from, to });
  delete p.learning;
  const pool = new Set<string>(QUIRKS_FOR[to]);
  for (const id of Object.keys(p.quirks ?? {}) as QuirkId[]) if (!pool.has(id)) delete p.quirks![id];
  if (p.quirks && !Object.keys(p.quirks).length) delete p.quirks;
  if (p.quirkBag) p.quirkBag = fillBag(p, coachingFor(league, p.teamId, to).rate);
  const [, , lo, hi] = BODY[to];
  p.weightLb = clamp(p.weightLb, lo, hi);
  resetLeagueMarket(league);
  if (p.teamId === null) return;
  const team = league.teams[p.teamId];
  team.depthChart[from] = team.depthChart[from].filter((id) => id !== p.id);
  if (!team.autoDepth) {
    const list = team.depthChart[to].filter((id) => id !== p.id);
    const at = list.findIndex((id) => league.players[id] && playerOvr(league.players[id]) < playerOvr(p));
    list.splice(at < 0 ? list.length : at, 0, p.id);
    team.depthChart[to] = list;
  }
  syncDepthChart(league, team);
  logTransaction(league, 'position', [team.id], `${team.abbrev} moved ${from} ${p.firstName} ${p.lastName} to ${to}`);
}

// ───────── the coaches' read ─────────

export type Verdict = 'worth' | 'ifNeeded' | 'not';
/** Why a team would make the move: a hole, a starter upgrade, next year's hole, or his body suiting the new job as he ages. */
export type MoveReason = Need['reason'] | 'age';

export interface ConversionRead {
  to: Position;
  verdict: Verdict;
  /** Where he'd slot at the new position today: in the lineup, or behind it. */
  role: 'starter' | 'backup';
  /** The starter he'd move ahead of, if any. */
  ahead?: Player;
  /** Players left at his old position if he moves (injured reserve aside). */
  left: number;
  /** Camps from now he should be ready by (0 = the coming one), at a typical pace: the coaches' estimate. */
  camps: number;
  /** His next deal, priced at the new position: higher, lower or about the same. */
  pay: 'higher' | 'lower' | 'same';
  reason: MoveReason | null;
  /** True when his body's decline favors the new job (the aging corner, the aging edge rusher). */
  aging: boolean;
  /** Why it can't start now, or null. */
  problem: string | null;
  /** Lineup gain the planner ranks moves by (engine use only: true ratings). */
  score: number;
}

/** Share of a position's overall that rides on physical tools. */
function physicalShare(pos: Position): number {
  const w = OVR_WEIGHTS[pos];
  let phys = 0;
  let total = 0;
  for (const [a, v] of Object.entries(w)) {
    total += v ?? 0;
    if (agingFamily(pos, a as Attribute) === 'physical') phys += v ?? 0;
  }
  return total ? phys / total : 0;
}

/** Players under contract at a position (injured reserve aside), best first, leaving one player out. */
function depthAt(ctx: TradeContext, teamId: number, pos: Position, without: number): Player[] {
  return rosterOf(ctx, teamId)
    .filter((x) => x.position === pos && x.id !== without && !x.ir && !!x.contract && !isExpired(x.contract, ctx.league.season))
    .sort((a, b) => playerOvr(b) - playerOvr(a));
}

/** Camps from now he should be ready by, at the coaches' (typical) pace. */
export function campsToReady(league: League, p: Player, to: Position): number {
  const c = conversionOf(p.position, to);
  if (!c) return Infinity;
  const l = activeLearning(p);
  const rate = learnRate(league, p, to);
  let need = c.weeks - (l && l.to === to ? l.done : 0);
  const year = blockWeeks(c, 'program') + CAMP_WEEKS + REGULAR_SEASON_WEEKS * SEASON_WEEK;
  // Learning before the coming cut-down day.
  let before: number;
  if (league.phase === 'preseason') before = CAMP_WEEKS;
  else if (OFFSEASON_PHASES.includes(league.phase)) before = blockWeeks(c, 'program') + CAMP_WEEKS;
  else before = Math.max(0, REGULAR_SEASON_WEEKS - (league.phase === 'regular' ? league.week - 1 : REGULAR_SEASON_WEEKS)) * SEASON_WEEK + blockWeeks(c, 'program') + CAMP_WEEKS;
  need -= before * rate;
  return need <= 1e-9 ? 0 : Math.ceil(need / (year * rate) - 1e-9);
}

/**
 * What his coaches think of teaching him a position: worth it, only if you need him there, or not worth it,
 * with why. For a team's own players (exact ratings, as every front office knows its own roster); screens
 * show it in words, never the numbers behind it.
 */
export function conversionRead(league: League, p: Player, to: Position, ctx: TradeContext = tradeContext(league)): ConversionRead {
  const teamId = p.teamId ?? league.userTeamId;
  const team = league.teams[teamId];
  const ovrNow = playerOvr(p);
  const ovrNew = overall(p.ratings, to);
  const diff = ovrNew - ovrNow;
  // The lineup at the new position without him, and what his old one looks like if he goes.
  const there = depthAt(ctx, teamId, to, p.id);
  const S = STARTERS[to];
  const weakest = there[S - 1];
  const role = there.length < S || ovrNew > playerOvr(weakest) ? 'starter' : 'backup';
  const gainTo = role === 'starter' ? ovrNew - (weakest ? playerOvr(weakest) : 6) : 0;
  const home = depthAt(ctx, teamId, p.position, p.id);
  const homeStarters = STARTERS[p.position];
  const starterHome = home.length < homeStarters || ovrNow > playerOvr(home[homeStarters - 1]);
  // Losing him costs his old lineup the gap to the next man up (nothing if he wasn't starting).
  const next = home[homeStarters - 1];
  const lossFrom = starterHome ? ovrNow - (next ? playerOvr(next) : 6) : 0;
  const score = gainTo - lossFrom;
  // Aging: past his body's physical turn, moving to a job that leans less on legs.
  const body = bodyAs(p) ?? p.position;
  const aging = p.age >= declineOnset(body, 'physical') && physicalShare(to) < physicalShare(p.position) - 0.05 && diff >= -0.5;
  const need = teamNeeds(ctx, team).find((n) => n.position === to);
  const reason: MoveReason | null = need && role === 'starter' ? need.reason : aging && role === 'starter' ? 'age' : null;
  const left = home.length;
  const short = left < minimumAt(league, teamId, p.position);
  let verdict: Verdict;
  if (diff < -1.5 || short) verdict = 'not';
  else if (reason && score >= 0.5 && (diff >= -1 || reason === 'hole')) verdict = 'worth';
  else if (aging && role === 'starter' && score >= 0) verdict = 'worth';
  else if (role === 'starter' || need) verdict = 'ifNeeded';
  else verdict = diff >= -0.5 ? 'ifNeeded' : 'not';
  const market = leagueMarket(league);
  const payNow = marketApy(market, p);
  const payThen = marketApy(market, { ...p, position: to });
  const pay = payThen > payNow * 1.1 ? 'higher' : payThen < payNow * 0.9 ? 'lower' : 'same';
  const problem = playerProblem(league, p, to) ?? slotProblem(league, teamId, rosterOf(ctx, teamId).filter((x) => activeLearning(x)).length);
  return { to, verdict, role, ahead: role === 'starter' ? weakest : undefined, left, camps: campsToReady(league, p, to), pay, reason, aging, problem, score };
}

// ───────── suggestions and the AI ─────────

export interface MoveSuggestion {
  player: Player;
  read: ConversionRead;
}

/**
 * The coaches' best suggestion for a team, or null: a move that is worth it, with a reason from the
 * front office's own forecast of its needs, that can start now. The user's team skips players it turned
 * down this year or last. The same function plans every AI team's moves.
 */
export function suggestMove(league: League, teamId: number, ctx: TradeContext = tradeContext(league)): MoveSuggestion | null {
  const passed = teamId === league.userTeamId ? (league.teams[teamId].training?.passed ?? {}) : {};
  const roster = rosterOf(ctx, teamId);
  if (slotProblem(league, teamId, roster.filter((p) => activeLearning(p)).length)) return null;
  let best: MoveSuggestion | null = null;
  for (const p of roster) {
    if ((passed[p.id] ?? -Infinity) >= league.season - 1) continue;
    for (const to of targetsFor(p)) {
      if (playerProblem(league, p, to)) continue;
      const read = conversionRead(league, p, to, ctx);
      if (read.verdict !== 'worth' || !read.reason) continue;
      if (!best || read.score > best.read.score || (read.score === best.read.score && p.id < best.player.id)) best = { player: p, read };
    }
  }
  return best;
}

/** Teams whose coaches start their own moves: every AI team, and yours if you've let them. */
const coachesStart = (league: League, team: Team) => team.id !== league.userTeamId || !!team.training?.coachesDecide;

/**
 * As the draft closes (before the spring program's learning): each team whose coaches start their own
 * moves begins its best suggestion, if it has one and a free slot. No team moves anyone without a reason
 * from its own forecast, and the user's team only when the user has let the coaches decide.
 */
export function planMoves(league: League): void {
  const ctx = tradeContext(league);
  for (const team of league.teams) {
    if (!coachesStart(league, team) || (team.id !== league.userTeamId && !trainingConfig.aiMoves)) continue;
    const s = suggestMove(league, team.id, ctx);
    if (s) startMove(league, s.player.id, s.read.to);
  }
}
