import { coachPlayerFit, positionCoachFor } from './coachQuirks';
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
 * No team moves anyone on a whim: a move needs a reason its front office acts on (`Motive`: a hole, next
 * year's hole, the coordinator's scheme, a young player's upside, reps for a blocked youngster, a fading
 * body, a clear upgrade),
 * weighed by its GM (`motiveWeight`), and the news says which.
 *
 * The only randomness is each plan's hidden pace, on its own stream: league streams never move.
 */
import { AGING, agingFamily, declineOnset } from './aging';
import { skill } from './attributes';
import { chairHolder, coachingFor, coachingForPlayer, teamCoaches, teamScheme } from './coaching';
import { logTransaction } from './finance/cap';
import { isExpired, yearsLeft } from './finance/contract';
import { leagueMarket, marketApy, resetLeagueMarket } from './finance/market';
import { KEEP_MIN } from './offseason/ai';
import { trueUp } from './development';
import { conversionOf, targetsFor, type Conversion } from './familiarity';
import { BODY, OVR_WEIGHTS, overall, playerOvr, STARTERS } from './positions';
import { fillBag, QUIRKS_FOR, type QuirkId } from './quirks';
import { fitContests, type TeamScheme } from './schemes';
import { clamp, Rng } from './rng';
import { activeRoster, isAvailable, syncDepthChart, teamPlayers } from './roster';
import { REGULAR_SEASON_WEEKS } from './season/schedule';
import { rosterOf, tradeContext, type TradeContext } from './trade/context';
import { learnMult, workEthicOf } from './traits';
import type { Attribute, Coach, League, Learning, MoveReason, Player, Position, Team } from './types';
import { OFFSEASON_PHASES, POSITIONS } from './types';

// ───────── the moves the coaches will teach (data in familiarity.ts) ─────────

export { CONVERSIONS, conversionOf, targetsFor, type Conversion } from './familiarity';

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
export const learners = (league: League, teamId: number): Player[] =>
  teamPlayers(league, teamId).filter((p) => activeLearning(p));

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
  return f >= 1
    ? 'Ready'
    : f >= 0.75
      ? 'Accomplished'
      : f >= 0.5
        ? 'Competent'
        : f >= 0.25
          ? 'Unconvincing'
          : 'Awkward';
}

// ───────── the learning clock ─────────

/**
 * How fast he learns, per learning-week: the new room's coaching, his age, his work ethic, his
 * versatility and his own hidden pace (1 when the coaches estimate, so an estimate never gives the pace away). 0.3–2.
 */
export function learnRate(league: League, p: Player, to: Position, pace = 1): number {
  const coach = coachingForPlayer(league, p, to).rate;
  const age = Math.max(0.6, 1 - 0.02 * Math.max(0, p.age - 24));
  const ethic = clamp(1 + 0.03 * (workEthicOf(p) - 10.5), 0.7, 1.3);
  // Mentoring (docs/TRAINING.md §8) multiplies in here later; until then it is 1.
  return clamp(coach * age * ethic * learnMult(p.traits) * pace, 0.3, 2);
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
  return (
    playerProblem(league, p, to) ??
    (p.teamId === null ? null : slotProblem(league, p.teamId, learners(league, p.teamId).length))
  );
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

/**
 * Start teaching him a new position, for a reason (`MoveReason`; the coaches' read supplies it when you
 * start one from his card). Throws if it can't start (`moveProblem`).
 */
export function startMove(league: League, playerId: number, to: Position, why?: MoveReason): void {
  const p = league.players[playerId];
  const problem = moveProblem(league, p, to);
  if (problem) throw new Error(problem);
  const pace = Math.round(new Rng(`${league.seed}:train:pace:${league.season}:${p.id}`).float(0.85, 1.15) * 100) / 100;
  p.learning = { to, done: 0, pace, since: league.season, teamId: p.teamId!, ...(why ? { why } : {}) };
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
  for (const [id, season] of Object.entries(team.training.passed!))
    if (season < league.season - 1) delete team.training.passed![Number(id)];
}

/** The user's one setting: let the coaches start their own suggestion (AI teams always do). */
export function setCoachesDecide(league: League, on: boolean): void {
  const team = league.teams[league.userTeamId];
  if (on) (team.training ??= {}).coachesDecide = true;
  else if (team.training) delete team.training.coachesDecide;
}

// ───────── cut-down day ─────────

/** The fewest a team keeps at a position after a move: your starters' count, an AI team's keep-minimum. */
const minimumAt = (league: League, teamId: number, pos: Position) =>
  teamId === league.userTeamId ? STARTERS[pos] : KEEP_MIN[pos];

/** Why a ready player waits instead of moving, or null: a move never leaves his old position short. */
export function holdReason(league: League, p: Player): string | null {
  if (p.teamId === null) return 'Not on a team.';
  const left = activeRoster(league, p.teamId).filter((x) => x.position === p.position && x.id !== p.id).length;
  return left < minimumAt(league, p.teamId, p.position) ? `It would leave you short at ${p.position}.` : null;
}

/** Cut-down day: every ready learner changes position, unless it would leave his old one short (he waits). */
export function completeMoves(league: League): void {
  // One at a time: two ready learners can't both leave the same room short.
  for (const p of Object.values(league.players))
    if (isReady(p) && !holdReason(league, p)) changePosition(league, p, p.learning!.to);
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
  const why = p.learning?.why;
  // The rest of this year's development lands as what he was: the new label starts clean next year.
  trueUp(league, p);
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
  // His new position is his own now: a "Play at…" there, or anywhere, ends with the move.
  if (team.playingAt) delete team.playingAt[p.id];
  for (const pos of POSITIONS) team.depthChart[pos] = team.depthChart[pos].filter((id) => id !== p.id);
  if (!team.autoDepth) {
    const list = team.depthChart[to].filter((id) => id !== p.id);
    const at = list.findIndex((id) => league.players[id] && playerOvr(league.players[id]) < playerOvr(p));
    list.splice(at < 0 ? list.length : at, 0, p.id);
    team.depthChart[to] = list;
  }
  syncDepthChart(league, team);
  logTransaction(
    league,
    'position',
    [team.id],
    `${team.abbrev} moved ${from} ${p.firstName} ${p.lastName} to ${to}${why ? `: ${reasonWords(why, to)}` : ''}`,
  );
}

// ───────── the coaches' read: is it worth it, and why ─────────

export type Verdict = 'worth' | 'ifNeeded' | 'not';

/**
 * A reason to teach him the new position, with how strongly it holds (0–1). Each comes from his own
 * front office's read of its roster and plans, never a whim:
 * - **hole**: the new position is short of starters right now;
 * - **nextYear**: a starter there is in his last year or near the end, and he'd be next in line;
 * - **scheme**: the coordinator's scheme wants exactly his skills there, more than at his own position;
 * - **upside**: a young player whose game already plays better there, with a place in its lineup;
 * - **reps**: a young player stuck behind starters who aren't going anywhere would start there, and grow with the snaps;
 * - **age**: his legs are going and the new job asks less of them, so the move extends his career;
 * - **upgrade**: he'd be clearly better than the starter there (a point or more), at no cost to his own room.
 */
export interface Motive {
  reason: MoveReason;
  strength: number;
}

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
  /** The strongest reason to do it, or null: without one the coaches won't call it worth it. */
  reason: MoveReason | null;
  /** Every reason that holds, strongest first. */
  motives: Motive[];
  /** When a scheme reason holds, the coordinator whose scheme it is (and whether he's new this year). */
  coordinator?: { coach: Coach; isNew: boolean };
  /** True when his body's decline favors the new job (the aging corner, the aging edge rusher). */
  aging: boolean;
  /** Why it can't start now, or null. */
  problem: string | null;
  /** How keen the planner is (engine use only: true ratings). */
  score: number;
}

/** What a missing starter counts as: a replacement-level body off the street. */
const REPLACEMENT = 6;
const DEFENSE: ReadonlySet<Position> = new Set(['DT', 'EDGE', 'LB', 'CB', 'S']);

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
    .filter(
      (x) =>
        x.position === pos && x.id !== without && !x.ir && !!x.contract && !isExpired(x.contract, ctx.league.season),
    )
    .sort((a, b) => playerOvr(b) - playerOvr(a));
}

/**
 * How well his game suits what the coordinator runs at a position: the skills the scheme leans on there
 * against his overall at it, −1 … 1 (three points either way is the most it counts), or null when the
 * scheme asks nothing special of that position. The same measure trade value uses (`trade/value.ts`).
 */
function fitAt(scheme: TeamScheme, p: Player, pos: Position): number | null {
  const contests = fitContests(scheme, pos);
  if (!contests.length) return null;
  const mean = contests.reduce((sum, c) => sum + skill(p, c), 0) / contests.length;
  return clamp((mean - overall(p.ratings, pos)) / 3, -1, 1);
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
  else
    before =
      Math.max(0, REGULAR_SEASON_WEEKS - (league.phase === 'regular' ? league.week - 1 : REGULAR_SEASON_WEEKS)) *
        SEASON_WEEK +
      blockWeeks(c, 'program') +
      CAMP_WEEKS;
  need -= before * rate;
  return need <= 1e-9 ? 0 : Math.ceil(need / (year * rate) - 1e-9);
}

/**
 * What his coaches think of teaching him a position: worth it (with the reason), only if you need him
 * there, or not worth it. A move is worth it only with a reason (`Motive`) whose cost his old room can
 * carry; being a little better at the new spot is not one. For a team's own players (exact ratings, as
 * every front office knows its own roster); screens show it in words, never the numbers behind it.
 */
export function conversionRead(
  league: League,
  p: Player,
  to: Position,
  ctx: TradeContext = tradeContext(league),
): ConversionRead {
  const teamId = p.teamId ?? league.userTeamId;
  const season = league.season;
  const ovrNow = playerOvr(p);
  const ovrNew = overall(p.ratings, to);
  const diff = ovrNew - ovrNow;
  // The lineup at the new position without him, and what his old room looks like if he goes.
  const there = depthAt(ctx, teamId, to, p.id);
  const S = STARTERS[to];
  const weakest = there[S - 1];
  const role = there.length < S || ovrNew > playerOvr(weakest) ? 'starter' : 'backup';
  const gainTo = role === 'starter' ? ovrNew - (weakest ? playerOvr(weakest) : REPLACEMENT) : 0;
  const home = depthAt(ctx, teamId, p.position, p.id);
  const H = STARTERS[p.position];
  const starterHome = home.length < H || ovrNow > playerOvr(home[H - 1]);
  // Losing him costs his old lineup the gap to the next man up (nothing if he wasn't starting).
  const lossFrom = starterHome ? ovrNow - (home[H - 1] ? playerOvr(home[H - 1]) : REPLACEMENT) : 0;
  const net = gainTo - lossFrom;
  const motives: Motive[] = [];
  const add = (reason: MoveReason, strength: number, holds: boolean) => holds && motives.push({ reason, strength });

  // A hole now: worth a real drop in rating, not a hole dug in his own room.
  add('hole', 1, there.length < S && diff >= -1.5 && lossFrom <= 1);
  // Next year's hole: a starter there near the end (well past his prime, or past it with his deal running
  // out; an ordinary expiring deal gets re-signed), and he'd be next in line from a room that can spare him.
  const peak = AGING[to].peakEnd;
  const leaving = there
    .slice(0, S)
    .some((x) => x.age >= peak + 3 || (x.age > peak && yearsLeft(x.contract!, season) <= 1));
  const heir = role === 'starter' || ovrNew >= (there[S] ? playerOvr(there[S]) : 0);
  add('nextYear', 0.6, leaving && heir && diff >= -1 && lossFrom <= 0.3);
  // The coordinator's scheme wants his skills there more than at his own position.
  const scheme = teamScheme(league, teamId);
  const fitTo = fitAt(scheme, p, to);
  const fitFrom = fitAt(scheme, p, p.position) ?? 0;
  const chair = DEFENSE.has(to) ? 'defCoord' : 'offCoord';
  const coach = chairHolder(teamCoaches(league, teamId), { role: chair });
  const coordinator = coach ? { coach, isNew: coach.since === season } : undefined;
  if (fitTo !== null)
    add(
      'scheme',
      clamp(0.4 + (fitTo - fitFrom), 0.4, 0.9),
      fitTo >= 0.2 && fitTo - fitFrom >= 0.25 && role === 'starter' && diff >= -0.75 && net >= 0.3,
    );
  // Upside: a young player whose game already plays better at the new spot, and who'd be in its lineup.
  add('upside', 0.6, p.age <= 24 && diff >= 0 && role === 'starter' && lossFrom <= 0.3);
  // Reps: a young backup blocked by starters who are staying would start there.
  const blockers = home.slice(0, H).filter((x) => playerOvr(x) > ovrNow);
  const blocked =
    !starterHome &&
    blockers.length > 0 &&
    blockers.every((x) => yearsLeft(x.contract!, season) >= 2 && x.age < AGING[p.position].peakEnd);
  add('reps', 0.7, p.age <= 25 && blocked && role === 'starter' && diff >= -1);
  // Age: past his body's physical turn, moving to a job that leans less on legs: already as good there, or
  // about as good with his starting job at his own position gone.
  const aging =
    p.age >= declineOnset(bodyAs(p) ?? p.position, 'physical') &&
    physicalShare(to) < physicalShare(p.position) - 0.05 &&
    diff >= -0.3;
  add('age', 0.7, aging && role === 'starter' && (diff >= 0 || !starterHome) && net >= -0.3);
  // A clear upgrade, from a room that can spare him: the bigger the gap, the stronger.
  add('upgrade', clamp(0.3 + 0.2 * gainTo, 0.5, 0.9), role === 'starter' && gainTo >= 1 && lossFrom <= 0.2);
  // Preferences can rank existing supported motives, never manufacture a valid conversion.
  const teacher = positionCoachFor(teamCoaches(league, teamId), to);
  const fit = coachPlayerFit(teacher, p);
  for (const m of motives) if (m.reason === 'upside' || m.reason === 'reps') m.strength *= 1 + fit;
  motives.sort((a, b) => b.strength - a.strength);

  const left = home.length;
  const short = left < minimumAt(league, teamId, p.position);
  const reason = motives[0]?.reason ?? null;
  const verdict: Verdict = diff < -1.5 || short || (!reason && diff < -0.5) ? 'not' : reason ? 'worth' : 'ifNeeded';
  const market = leagueMarket(league);
  const payNow = marketApy(market, p);
  const payThen = marketApy(market, { ...p, position: to });
  const pay = payThen > payNow * 1.1 ? 'higher' : payThen < payNow * 0.9 ? 'lower' : 'same';
  const problem =
    playerProblem(league, p, to) ??
    slotProblem(league, teamId, rosterOf(ctx, teamId).filter((x) => activeLearning(x)).length);
  const score = (motives[0]?.strength ?? 0) + 0.1 * net;
  return {
    to,
    verdict,
    role,
    ahead: role === 'starter' ? weakest : undefined,
    left,
    camps: campsToReady(league, p, to),
    pay,
    reason,
    motives,
    coordinator: motives.some((m) => m.reason === 'scheme') ? coordinator : undefined,
    aging,
    problem,
    score,
  };
}

/** A reason as the news gives it ("KC moved LB John Smith to S: their safety room was short"). */
export function reasonWords(reason: MoveReason, to: Position): string {
  switch (reason) {
    case 'hole':
      return `they were short at ${to}`;
    case 'nextYear':
      return `to take over at ${to} next year`;
    case 'scheme':
      return `the coordinator's scheme wants him at ${to}`;
    case 'upside':
      return `his game fits ${to} better`;
    case 'reps':
      return 'to get him on the field';
    case 'age':
      return 'to extend his career';
    case 'upgrade':
      return `an upgrade at ${to}`;
  }
}

// ───────── suggestions and the AI ─────────

export interface MoveSuggestion {
  player: Player;
  read: ConversionRead;
  /** The reason this front office acts on: the strongest after its GM's weighting, not always `read.reason`. */
  why: MoveReason;
}

/**
 * How much a front office cares about a reason, by its GM (`GmTraits`): every team fills a hole; a
 * planner looks ahead to next year and gets young backups on the field; a win-now GM keeps his veterans
 * useful and takes a clear upgrade; a coordinator new this year gets his way more often. The user's own
 * coaches weigh every reason fully: you decide.
 */
export function motiveWeight(league: League, team: Team, m: Motive, read: ConversionRead): number {
  if (team.id === league.userTeamId) return 1;
  const { winNow, loyalty } = team.gm;
  switch (m.reason) {
    case 'hole':
      return 1;
    case 'nextYear':
      return 0.6 + 0.4 * (1 - winNow);
    case 'scheme':
      // A coordinator new this year reshapes his room; an established one already has the players he wants.
      return read.coordinator?.isNew ? 1 : 0.6;
    case 'upside':
      return 0.5 + 0.5 * (1 - winNow);
    case 'reps':
      return 0.4 + 0.6 * (1 - winNow);
    case 'age':
      return 0.4 + 0.4 * winNow + 0.2 * loyalty;
    case 'upgrade':
      return 0.5 + 0.3 * winNow;
  }
}

/** How strongly a reason must hold, after the GM's weighting, before a team acts on it. */
export const MOTIVE_BAR = 0.5;

/**
 * The coaches' best suggestion for a team, or null: a move that is worth it for a reason this front
 * office acts on, that can start now. The user's team skips players it turned down this year or last.
 * The same function plans every AI team's moves.
 */
export function suggestMove(
  league: League,
  teamId: number,
  ctx: TradeContext = tradeContext(league),
): MoveSuggestion | null {
  const team = league.teams[teamId];
  const passed = teamId === league.userTeamId ? (team.training?.passed ?? {}) : {};
  const roster = rosterOf(ctx, teamId);
  if (slotProblem(league, teamId, roster.filter((p) => activeLearning(p)).length)) return null;
  let best: MoveSuggestion | null = null;
  let bestKeen = 0;
  for (const p of roster) {
    if ((passed[p.id] ?? -Infinity) >= league.season - 1) continue;
    for (const to of targetsFor(p)) {
      if (playerProblem(league, p, to)) continue;
      const read = conversionRead(league, p, to, ctx);
      if (read.verdict !== 'worth') continue;
      // The reason this front office would act on, if any clears the bar (the first, strongest, on a tie).
      const weighed = read.motives.map((m) => ({
        reason: m.reason,
        keen: m.strength * motiveWeight(league, team, m, read),
      }));
      const top = weighed.reduce((a, b) => (b.keen > a.keen ? b : a));
      if (top.keen < MOTIVE_BAR) continue;
      const k = top.keen + 0.01 * read.score;
      if (!best || k > bestKeen || (k === bestKeen && p.id < best.player.id)) {
        best = { player: p, read, why: top.reason };
        bestKeen = k;
      }
    }
  }
  return best;
}

/** Teams whose coaches start their own moves: every AI team, and yours if you've let them. */
const coachesStart = (league: League, team: Team) => team.id !== league.userTeamId || !!team.training?.coachesDecide;

/**
 * As the draft closes (before the spring program's learning): each team whose coaches start their own
 * moves begins its best suggestion, if it has one and a free slot. No team moves anyone without a reason
 * it acts on, and the user's team only when the user has let the coaches decide.
 */
export function planMoves(league: League): void {
  const ctx = tradeContext(league);
  for (const team of league.teams) {
    if (!coachesStart(league, team) || (team.id !== league.userTeamId && !trainingConfig.aiMoves)) continue;
    const s = suggestMove(league, team.id, ctx);
    if (s) startMove(league, s.player.id, s.read.to, s.why);
  }
}
