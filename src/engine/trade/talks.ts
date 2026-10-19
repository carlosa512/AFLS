/**
 * Your dealings with each AI GM (docs/TRADES.md, "Offers to you"): how many proposals he'll hear from
 * you in a market moment, when talks are off, who he won't ask about for a while, and how far he
 * trusts you. Nothing here is ever shown as a number: screens say "We're done talking this week".
 */
import type { TradeMarket, TradeTalks } from '../types';

/** Proposals a GM hears from you in one market moment before he's done talking. */
export const ASKS = 4;
/** Trust drifts back toward 0 by this much a market moment (about 0.1 a month in season). */
const TRUST_DRIFT = 0.025;
/** The most trust moves his margin with you, either way. */
export const TRUST_MARGIN = 0.06;

const fresh = (moment: number): TradeTalks => ({ moment, asks: 0, trust: 0, cooldowns: {} });

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

/** Why a GM won't hear another proposal from you this moment, or null. */
export function talkRefusal(market: TradeMarket | undefined, teamId: number): string | null {
  const t = peekTalks(market, teamId);
  if ((t.offUntil !== undefined && t.offUntil >= (market?.moment ?? 0)) || t.asks >= ASKS) return "We're done talking this week.";
  return null;
}

export function nudgeTrust(market: TradeMarket, teamId: number, by: number): void {
  const t = talksOf(market, teamId);
  t.trust = Math.max(-1, Math.min(1, t.trust + by));
}

/** Each market moment trust drifts back toward neutral and spent cooldowns are cleared. */
export function settleTalks(market: TradeMarket): void {
  for (const t of Object.values(market.talks)) {
    t.trust = t.trust > 0 ? Math.max(0, t.trust - TRUST_DRIFT) : Math.min(0, t.trust + TRUST_DRIFT);
    for (const [id, c] of Object.entries(t.cooldowns)) if (c.until < market.moment) delete t.cooldowns[Number(id)];
  }
}
