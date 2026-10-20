/**
 * The one evaluator. Every trade, whoever proposes it (you on the trade table, an AI GM in the
 * market), is judged by `judge` for each AI side, so there is no laxer path to exploit (FM24 shipped
 * one and stars went for under 1% of their value). League rules and the GM's own lines are checked
 * apart from value: no package buys past them, and tuning value can't reopen an exploit.
 *
 * - The AI wants a small win against you (its stubbornness); AI-to-AI, each side must merely not lose.
 * - A seller holds out for most of what the league would pay, whatever he thinks of the player
 *   himself, so starters don't go for seventh-round picks.
 * - Each first-round pick an AI sends past the second costs it more: a price, not a hard cap.
 * - A star only goes for a centrepiece: quantity never buys quality.
 */
import { capFor, deadMoneyIn } from '../finance/cap';
import { isExpired, remainingProration, yearsLeft } from '../finance/contract';
import { contenderScore, rosterLimit } from '../offseason/negotiation';
import { clamp } from '../rng';
import type { DraftPick, League, Player, Team } from '../types';
import { rosterOf, tradeContext, type TradeContext } from './context';
import { untouchables } from './plans';
import { peekTalks, talkRefusal, TRUST_MARGIN } from './talks';
import { freshSigningRefusal, guaranteesShed, playerTradeBlocker, retainedBy, tradeDeadMoney, tradeProblem, TRADE_DEADLINE_WEEK, type TradeProposal, type TradeSide } from './rules';
import { goingRate, marketValue, nextDraftSeason, nowWeight, pickOverall, pickValue, playerSwing, POINTS_PER_K, salaryWeight } from './value';

/** Each player a deal leaves past the roster limit costs about a sixth-round pick: someone has to be cut. */
const ROSTER_SPOT = 15;
/** A player the league values at about a mid first or more is a star... */
export const STAR = 1000;
/** ...and only goes for a first-round pick or an asset worth at least this share of him. */
const CENTREPIECE = 0.45;

export interface JudgeOpts {
  /** Judging the user's proposal: the GM wants a small win (his stubbornness), and at least 25 points. */
  vsUser?: boolean;
  /** Overrides the margin it wants over what it gives. */
  margin?: number;
  /** The team would waive a backup to make room. */
  rosterCuts?: boolean;
  /**
   * The players it sends are ones it would cut anyway (a cap casualty, the cut to 53): it weighs the
   * trade against the release, so anything coming back is a gain, and so is the guaranteed money a
   * release would have left on its books.
   */
  releasing?: boolean;
}

export interface Judgement {
  teamId: number;
  /** Value it receives and gives, in its own eyes (chart points). */
  get: number;
  give: number;
  /** What it needs back to say yes. */
  need: number;
  accepts: boolean;
  /** A league rule (cap, roster, window…) that no amount of value fixes. */
  problem: string | null;
  /** The GM's own line, in his words: a fresh signing, a star with no centrepiece coming back. */
  refusal: string | null;
}

const pickById = (league: League, id: number) => league.draftPicks.find((x) => x.id === id)!;

/**
 * What a non-contender holds out for on an expiring veteran in season, as a share of his market value:
 * most of it in week 1, less each week to deadline day. He's gone in the spring either way, so the
 * longer it waits the more it's choosing between a late pick and nothing.
 */
const RENTAL_FLOOR = { first: 0.65, deadline: 0.4 };
/** Between two AI teams it holds out for less: the floor guards against being fleeced, and another GM isn't fishing. */
const AI_RENTAL_FLOOR = { first: 0.5, deadline: 0.2 };

/** Share of a player's market value a team holds out for when it sends him. */
function floorShare(league: League, team: Team, p: Player, vsUser: boolean): number {
  const selling = league.phase === 'regular' && contenderScore(league, team.id) <= 0.4 && yearsLeft(p.contract!, league.season) <= 1;
  if (!selling) return 0.8;
  const floor = vsUser ? RENTAL_FLOOR : AI_RENTAL_FLOOR;
  const late = clamp((league.week - 1) / (TRADE_DEADLINE_WEEK - 1), 0, 1);
  return floor.first + (floor.deadline - floor.first) * late;
}

/** Picks at the league's going rate. */
const going = (ctx: TradeContext, ids: readonly number[]) => ids.reduce((s, id) => s + goingRate(ctx.league, pickById(ctx.league, id), ctx), 0);

/** Each first-round pick a team is without past its second costs it this much more (ZenGM's ×(1 + extra / 2.5)). */
const FIRST_STEP = 1 / 2.5;
/** On top, for a first that leaves it without one in back-to-back drafts. */
const BACK_TO_BACK = 0.3;

/**
 * A team's firsts in the drafts to come, in one pass (every verdict with a first runs it): the
 * drafts there are, how many it is already without (firsts sold in earlier deals), and the ones it
 * would still hold a first in after the deal (its own, used ones too, less what it sends, plus any
 * coming back).
 */
function firstsAround(league: League, teamId: number, sending: readonly number[], getting: readonly number[]) {
  const from = nextDraftSeason(league);
  const seasons = new Set<number>();
  const before = new Set<number>();
  const after = new Set<number>();
  for (const p of league.draftPicks) {
    if (p.season < from) continue;
    seasons.add(p.season);
    if (p.round !== 1) continue;
    if (p.ownerId === teamId) before.add(p.season);
    if ((p.ownerId === teamId && !sending.includes(p.id)) || getting.includes(p.id)) after.add(p.season);
  }
  return { without: seasons.size - before.size, empty: (s: number) => seasons.has(s) && !after.has(s) };
}

/**
 * A team's own outgoing picks. Firsts get dearer the more drafts a team is left without one, counting
 * the firsts it already sold: the third is dear whether it goes in one deal or three, and one that
 * leaves back-to-back drafts empty dearer still. A price, not a rule: a GM going all in pays about
 * half of it and does mortgage the future (the Rams went seven drafts without a first), a patient
 * one balks sooner. A first past next year's draft never counts for less than the league pays for
 * it: a GM who barely values the future would otherwise spend those as free money. Later rounds keep
 * his own discount: next year's pick for this year's, a late one before the cut, are real trades.
 */
function picksOut(ctx: TradeContext, team: Team, ids: readonly number[], getting: readonly number[]): number {
  const { league } = ctx;
  const next = nextDraftSeason(league);
  const picks = ids.map((id) => pickById(league, id)).map((p) => ({ value: Math.max(pickValue(league, p, team.gm, ctx), p.round === 1 && p.season > next ? goingRate(league, p, ctx) : 0), season: p.season, first: p.round === 1 }));
  if (!picks.some((p) => p.first)) return picks.reduce((s, p) => s + p.value, 0);
  picks.sort((a, b) => b.value - a.value);
  const around = firstsAround(league, team.id, ids, getting);
  const appetite = 1.5 - team.gm.winNow;
  let firsts = around.without;
  return picks.reduce((s, p) => {
    if (!p.first) return s + p.value;
    const gap = around.empty(p.season) && (around.empty(p.season - 1) || around.empty(p.season + 1));
    const extra = Math.max(0, ++firsts - 2) * FIRST_STEP + (gap ? BACK_TO_BACK : 0);
    return s + p.value * (1 + appetite * extra);
  }, 0);
}

/** A star leaves only for a first-round pick or a front-line asset. */
function centrepieceRefusal(ctx: TradeContext, team: Team, proposal: TradeProposal): string | null {
  const { league } = ctx;
  const mine = proposal.sides.find((s) => s.teamId === team.id)!;
  const theirs = proposal.sides.find((s) => s.teamId !== team.id)!;
  for (const id of mine.players) {
    const p = league.players[id];
    const worth = marketValue(ctx, team, p);
    if (worth < STAR) continue;
    const first = theirs.picks.some((pid) => pickById(league, pid).round === 1);
    const big =
      theirs.players.some((qid) => marketValue(ctx, team, league.players[qid]) >= CENTREPIECE * worth) ||
      theirs.picks.some((pid) => pickValue(league, pickById(league, pid), team.gm, ctx) >= CENTREPIECE * worth);
    if (!first && !big) return `They won't move ${p.firstName} ${p.lastName} without a first-round pick or a front-line player coming back.`;
  }
  return null;
}

/** No GM hands a division rival a star in the middle of a season. */
function rivalRefusal(ctx: TradeContext, team: Team, proposal: TradeProposal): string | null {
  const { league } = ctx;
  const mine = proposal.sides.find((s) => s.teamId === team.id)!;
  const theirs = proposal.sides.find((s) => s.teamId !== team.id)!;
  if (league.phase !== 'regular' || league.teams[theirs.teamId].division !== team.division) return null;
  const star = mine.players.map((id) => league.players[id]).find((p) => marketValue(ctx, team, p) >= STAR);
  return star ? `They won't hand a division rival ${star.firstName} ${star.lastName} in the middle of a season.` : null;
}

/**
 * The most dead money a GM will carry in a season: a quarter of the cap. The NFL's record is about a
 * third (Denver in 2024, after releasing Wilson), so a rebuilder clears its books over a few sales,
 * not all at once.
 */
const DEAD_LIMIT = 0.25;

/**
 * Bonus money from deals that have run out (their void years), booked as dead money when free agency
 * opens: in the re-sign window it's still on the expired contracts, but the GM knows it's coming.
 */
const voidsComing = (ctx: TradeContext, teamId: number) =>
  rosterOf(ctx, teamId).reduce((s, p) => s + (p.contract && isExpired(p.contract, ctx.league.season) ? remainingProration(p.contract, ctx.league.season) : 0), 0);

/** A GM won't sell players whose bonuses would bury his cap in dead money. */
function deadRefusal(ctx: TradeContext, team: Team, mine: TradeSide): string | null {
  if (!mine.players.length) return null;
  const { league } = ctx;
  const added = tradeDeadMoney(league, mine);
  added.thisYear += retainedBy(mine) + voidsComing(ctx, team.id);
  const over = (season: number, amount: number) => amount > 0 && deadMoneyIn(team, season) + amount > DEAD_LIMIT * capFor(league, season);
  return over(league.season, added.thisYear) || over(league.season + 1, added.nextYear) ? "They can't take on any more dead money this year." : null;
}

/**
 * What a team wants on top for its starting quarterback in the middle of a season: twice its usual
 * ask. It happens only for an offer too good to refuse (Palmer to Oakland in 2011, a first and a
 * second): the Stafford and Wilson trades were made in the offseason.
 */
const QB_PREMIUM = 1;

const startsAtQb = (league: League, team: Team, mine: TradeSide) => league.phase === 'regular' && mine.players.includes(team.depthChart.QB[0]);

/** A first-round pick projected this high in the next draft is kept through the season. */
const HOLD_SLOT = 10;

/**
 * In season no team gives up a first projected in the top ten: it waits to see who's there on draft
 * day, and can trade down then.
 */
export const heldPick = (ctx: TradeContext, pk: DraftPick) =>
  ctx.league.phase === 'regular' && pk.round === 1 && pk.season === nextDraftSeason(ctx.league) && pickOverall(ctx.league, pk, ctx) <= HOLD_SLOT;

function pickHoldRefusal(ctx: TradeContext, mine: TradeSide): string | null {
  const held = mine.picks.map((id) => pickById(ctx.league, id)).find((pk) => heldPick(ctx, pk));
  return held ? `They're keeping their ${held.season} first-round pick until draft day.` : null;
}

/** The margin a GM wants over what he gives: a small win against the user, merely not losing to another AI. */
export function marginFor(team: Team, other: Team, vsUser = false, trust = 0): number {
  // Division rivals rarely deal with each other (Flacco in 2025 was only the third QB trade between them this century): they want a lot more.
  const rival = other.division === team.division ? 0.2 : 0;
  // With you, how far he trusts you moves it a little either way.
  return (vsUser ? 1.05 + team.gm.stubbornness * 0.15 - TRUST_MARGIN * trust : 1 + team.gm.stubbornness * 0.05) + rival;
}

/** `teamId`'s verdict on a proposal, in its own eyes. */
export function judge(ctx: TradeContext, teamId: number, proposal: TradeProposal, opts: JudgeOpts = {}): Judgement {
  const { league } = ctx;
  const team = league.teams[teamId];
  const mine = proposal.sides.find((s) => s.teamId === teamId)!;
  const theirs = proposal.sides.find((s) => s.teamId !== teamId)!;
  const problem = tradeProblem(league, proposal, { rosterCuts: opts.rosterCuts, ctx });
  const refusal = freshSigningRefusal(league, teamId, proposal) ?? centrepieceRefusal(ctx, team, proposal) ?? rivalRefusal(ctx, team, proposal) ?? (opts.releasing ? null : deadRefusal(ctx, team, mine)) ?? pickHoldRefusal(ctx, mine);

  const w = salaryWeight(ctx, teamId);
  const swing = playerSwing(ctx, team, mine.players, theirs.players);
  // Against a release he's gone either way: the trade saves the guarantees a cut would leave behind.
  const loss = opts.releasing ? -w * POINTS_PER_K * guaranteesShed(league, mine) : swing.loss;
  const gain = swing.gain;
  const pickIn = theirs.picks.reduce((s, id) => s + pickValue(league, pickById(league, id), team.gm, ctx), 0);
  const pickOut = picksOut(ctx, team, mine.picks, theirs.picks);
  // Each cut the deal forces costs a roster spot: only the ones it adds (in camp every roster is over 53 before the cut).
  const now = rosterOf(ctx, teamId).filter((p) => !p.ir).length;
  const over = (n: number) => Math.max(0, n - rosterLimit(league));
  const cuts = Math.max(0, over(now - mine.players.length + theirs.players.length) - over(now));
  // Salary kept by the sender: a cost to it, a saving to the buyer, weighed by cap room like this year's salary (`nowWeight`).
  const thisYear = nowWeight(ctx, teamId);
  const get = pickIn + gain - cuts * ROSTER_SPOT + thisYear * POINTS_PER_K * retainedBy(theirs);
  const give = pickOut + loss + thisYear * POINTS_PER_K * retainedBy(mine);
  const trust = opts.vsUser ? peekTalks(league.market, teamId).trust : 0;
  const margin = (opts.margin ?? marginFor(team, league.teams[theirs.teamId], opts.vsUser, trust)) + (startsAtQb(league, team, mine) ? QB_PREMIUM : 0);
  // The margin is a share of the stakes, so it asks for more back whether the stakes are positive or not.
  const lift = (x: number) => x + Math.abs(x) * (margin - 1);
  let base = give;
  let need = lift(give);
  if (mine.players.length && !opts.releasing) {
    // Whatever it thinks of a player itself, a seller holds out for most of what the league would pay,
    // and counts the picks against that at the going rate, not its own chart: what comes back must
    // clear the floor at the league's prices.
    // Salary it keeps paying makes the player that much cheaper to his new team: the league would
    // pay that much more for him, so it counts in full, whatever a rich team thinks a dollar is worth.
    const floor = mine.players.reduce((s, id) => {
      const p = league.players[id];
      const worth = marketValue(ctx, team, p);
      return s + (worth > 0 ? worth * floorShare(league, team, p, !!opts.vsUser || theirs.teamId === league.userTeamId) : worth);
    }, going(ctx, mine.picks) + POINTS_PER_K * retainedBy(mine));
    const rate = pickIn - going(ctx, theirs.picks);
    base = Math.max(base, floor + rate);
    need = Math.max(need, lift(floor) + rate);
  }
  if (opts.vsUser) need = Math.max(need, base + 25);
  return { teamId, get, give, need, accepts: !problem && !refusal && get >= need, problem, refusal };
}

// ───────── the trade table ─────────

export interface TradeVerdict {
  accepts: boolean;
  /** Value the AI side receives and gives, in its own eyes. */
  get: number;
  give: number;
  /** How much more the AI needs, in points (0 when it accepts). */
  shortfall: number;
  message: string;
  /** A rule problem (cap, roster, deadline…) or the GM's own line: no amount of value fixes either. */
  problem: string | null;
  /** `problem` is the GM's own line, not a league rule. */
  policy: boolean;
}

/**
 * The AI side's verdict (sides[1]). Against the user it wants a small win; pass `margin` to judge as
 * one AI judges another (`margin: 1`: merely not lose).
 */
export function evaluateTrade(league: League, proposal: TradeProposal, opts: { margin?: number; rosterCuts?: boolean; ctx?: TradeContext } = {}): TradeVerdict {
  const ctx = opts.ctx ?? tradeContext(league);
  const ai = league.teams[proposal.sides[1].teamId];
  const j = judge(ctx, ai.id, proposal, { vsUser: opts.margin === undefined, margin: opts.margin, rosterCuts: opts.rosterCuts });
  const shortfall = Math.max(0, j.need - j.get);
  const blocked = j.problem ?? j.refusal ?? (opts.margin === undefined ? talkRefusal(league.market, ai.id) : null);
  if (blocked) return { accepts: false, get: j.get, give: j.give, shortfall, message: blocked, problem: blocked, policy: !j.problem };
  if (j.accepts) return { accepts: true, get: j.get, give: j.give, shortfall: 0, message: `The ${ai.name} would accept.`, problem: null, policy: false };
  const scale = Math.max(Math.abs(j.need), 50);
  const message = shortfall < scale * 0.12 ? 'Close. Add a little more and they’ll do it.' : shortfall < scale * 0.4 ? 'Not enough value for them yet.' : 'They aren’t interested at that price.';
  return { accepts: false, get: j.get, give: j.give, shortfall, message, problem: null, policy: false };
}

/**
 * "What would make this work?": the proposer's asset whose addition gets it done for the least, as
 * the other GM values it, or the one that brings it closest if none does alone. Only additions that
 * keep the deal legal and that he'd take count.
 */
export function suggestSweetener(league: League, proposal: TradeProposal): { kind: 'player' | 'pick'; id: number } | null {
  const ctx = tradeContext(league);
  const verdict = evaluateTrade(league, proposal, { ctx });
  if (verdict.accepts || verdict.problem || verdict.shortfall <= 0) return null;
  const [mine, theirs] = proposal.sides;
  const options: { kind: 'player' | 'pick'; id: number }[] = [
    ...league.draftPicks.filter((p) => p.ownerId === mine.teamId && p.playerId === undefined && !mine.picks.includes(p.id)).map((p) => ({ kind: 'pick' as const, id: p.id })),
    ...rosterOf(ctx, mine.teamId)
      .filter((p) => !mine.players.includes(p.id) && !playerTradeBlocker(league, p) && !untouchables(ctx, league.teams[mine.teamId]).has(p.id))
      .map((p) => ({ kind: 'player' as const, id: p.id })),
  ];
  const tried = options.flatMap((o) => {
    const side = { ...mine, players: o.kind === 'player' ? [...mine.players, o.id] : mine.players, picks: o.kind === 'pick' ? [...mine.picks, o.id] : mine.picks };
    const j = judge(ctx, theirs.teamId, { sides: [side, theirs] }, { vsUser: true });
    const added = j.get - verdict.get;
    return j.problem || j.refusal || added <= 0 ? [] : [{ ...o, added, accepts: j.accepts }];
  });
  const works = tried.filter((t) => t.accepts).sort((a, b) => a.added - b.added)[0];
  const best = works ?? tried.sort((a, b) => b.added - a.added)[0];
  return best ? { kind: best.kind, id: best.id } : null;
}
