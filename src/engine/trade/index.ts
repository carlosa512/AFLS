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
 * - `context.ts`: one decision pass's cache
 */
export { capRoom, rosterOf, tradeContext, type TradeContext } from './context';
export { executeTrade } from './execute';
export { evaluateTrade, judge, marginFor, suggestSweetener, type JudgeOpts, type Judgement, type TradeVerdict } from './judge';
export { dealFor, dumpFor, TAGS, type Deal } from './deals';
export { emptyMarket } from './execute';
export { gmActivity, marketMoment, TRADE_VOLUME, weekMoment, type Moment } from './market';
export { isBuyer, isSeller, stanceFor, stanceOf, stanceScore, teamNeeds, tradeBlock, untouchable, untouchables, updateStances, wanted, type BlockEntry, type Need } from './plans';
export {
  freshlySigned,
  isDeadlineDay,
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
  projectedSlot,
  salaryWeight,
  seasonShare,
} from './value';
