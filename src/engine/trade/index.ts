/**
 * Trades (docs/TRADES.md): one value scale (draft-chart points) for players and picks, judged by
 * each AI GM's own lens with one evaluator, under the NFL's rules and calendar.
 *
 * - `value.ts`: pick charts and slots, player value (talent × control × role × lens + contract), market value
 * - `rules.ts`: the window and deadline day, blockers, the hidden wait on new signings, cap and rosters
 * - `judge.ts`: the evaluator every deal goes through, the trade table's verdict, "what would make it work?"
 * - `execute.ts`: moving the assets and the money
 * - `plans.ts`: each front office's stance, needs, trade block and interest
 * - `deals.ts`: the deal search (picks, swaps, a player and a pick, cap dumps)
 * - `market.ts`: the AI market at the NFL's moments, its history and rumors
 * - `offers.ts`: offers to you and what you do with them: accept, decline, counter, statuses, shop, ask a price
 * - `talks.ts`: your dealings with each GM (proposals a moment, cooldowns, trust)
 * - `context.ts`: one decision pass's cache
 */
export { dealAdvice, staffTake, type Advice, type AdviceTone, type StaffTake } from './advice';
export { capRoom, rosterOf, tradeContext, type TradeContext } from './context';
export { askedAbout, deskState, type DeskHeadline, type DeskState } from './desk';
export { executeTrade } from './execute';
export {
  CENTREPIECE,
  evaluateTrade,
  heldPick,
  judge,
  marginFor,
  suggestSweetener,
  type JudgeOpts,
  type Judgement,
  STAR,
  type TradeVerdict,
} from './judge';
export { dealFor, dumpFor, keepToFit, TAGS, type Deal } from './deals';
export { emptyMarket } from './execute';
export { dealWatch, gmActivity, marketMoment, TRADE_VOLUME, weekMoment, type Moment } from './market';
export {
  acceptOffer,
  answerEnquiry,
  askPrice,
  counterOffer,
  declineOffer,
  expireOffers,
  OFFER_RATE,
  openOffers,
  proposeTrade,
  recheckOffers,
  replyOf,
  resolveExam,
  setTradeStatus,
  shopPlayer,
  type AcceptResult,
  type CounterResult,
} from './offers';
export { ASKS, peekTalks, talkRefusal } from './talks';
export { CONCERNS, examine, FAIL, findings, physicals, worstResult } from './physicals';
export {
  isBuyer,
  isSeller,
  reloading,
  scoutedNeeds,
  stanceFor,
  stanceOf,
  stanceScore,
  teamNeeds,
  tradeBlock,
  untouchable,
  untouchables,
  updateStances,
  wanted,
  type BlockEntry,
  type Need,
} from './plans';
export {
  freshlySigned,
  isDeadlineDay,
  maxRetain,
  retainedBy,
  isTradeSeason,
  playerTradeBlocker,
  salaryToTake,
  signingWait,
  TRADE_DEADLINE_WEEK,
  tradeCapImpact,
  tradeProblem,
  tradeWindow,
  type TradeProposal,
  type TradeSide,
} from './rules';
export {
  control,
  fitzgeraldSpielberger,
  goingRate,
  grossWorth,
  jimmyJohnson,
  marketValue,
  nextDraftSeason,
  pickChartValue,
  pickLabel,
  pickOverall,
  pickValue,
  playerSwing,
  playerValue,
  POINTS_PER_K,
  projectedSlot,
  salaryWeight,
  seasonShare,
} from './value';
