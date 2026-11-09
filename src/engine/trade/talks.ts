/**
 * Your dealings with each AI GM (docs/TRADES.md, "Offers to you"): how many proposals he'll hear from
 * you in a market moment, when talks are off, who he won't ask about for a while. Nothing here is ever shown as a number: screens say "We're done talking this week".
 */
import { aiGm } from '../gmHabits';
import { refusalLine } from '../gmTalk';
import { standingStep, standingWith } from '../gmMemory';
import type { League, TradeMarket, TradeTalks } from '../types';

/** Proposals a GM hears from you in one market moment at neutral standing before he's done talking. */
export const ASKS = 4;

const fresh = (moment: number): TradeTalks => ({ moment, asks: 0, cooldowns: {} });

/** Read your talks with a GM without touching the league (screens and verdicts call this on every render). */
export function peekTalks(market: TradeMarket | undefined, teamId: number): TradeTalks {
  const t = market?.talks[teamId];
  if (!t) return fresh(market?.moment ?? 0);
  return t.moment === market!.moment ? t : { ...t, moment: market!.moment, asks: 0 };
}

/** Your talks with a GM, stored, its proposal count reset when a new moment has started. */
export function talksOf(market: TradeMarket, teamId: number): TradeTalks {
  const t = (market.talks[teamId] ??= fresh(market.moment));
  if (t.moment !== market.moment) Object.assign(t, { moment: market.moment, asks: 0 });
  return t;
}

/** What he'll hear in a moment: a friendly GM one more, a sour one one fewer. */
export function asksFor(league: League, teamId: number): number {
  return ASKS + standingStep(standingWith(league, aiGm(league, league.teams[teamId])));
}

/** Why a GM won't hear another proposal from you this moment, or null. */
export function talkRefusal(league: League, teamId: number): string | null {
  const market = league.market;
  const t = peekTalks(market, teamId);
  if ((t.offUntil !== undefined && t.offUntil >= (market?.moment ?? 0)) || t.asks >= asksFor(league, teamId))
    return refusalLine(league, league.teams[teamId]);
  return null;
}

/** Each market moment spent cooldowns are cleared. */
export function settleTalks(market: TradeMarket): void {
  for (const t of Object.values(market.talks)) {
    for (const [id, c] of Object.entries(t.cooldowns)) if (c.until < market.moment) delete t.cooldowns[Number(id)];
  }
}
