/**
 * One trade decision pass's cache. A pass (one AI trade attempt, one verdict on the trade table) asks
 * for the same rosters, reads, slots and cap rooms hundreds of times, and nothing it reads changes
 * until a trade goes through. A context is thrown away with its pass, so a reloaded save decides the
 * same way; the market builds a new one after every trade.
 */
import { capSheet } from '../finance/cap';
import { leagueMarket, type Market } from '../finance/market';
import { viewCache, type PlayerView } from '../scouting';
import type { League, Player } from '../types';
import type { PlayerRead } from './value';

export interface TradeContext {
  league: League;
  /** Every player on each team (injured reserve included), built in one pass over the league. */
  rosters: Map<number, Player[]>;
  /** Each front office's read of a player, computed once. */
  view: (teamId: number, p: Player) => PlayerView;
  /** The league's pay comps (contract surplus is measured against them). */
  market: Market;
  /** Draft-order scores by team (lower picks earlier), filled on first use. */
  slotScores?: number[];
  /** Salary weights by team, filled on first use. */
  salaryWeights?: number[];
  /** Each front office's read of each player it has looked at (see `readPlayer`). */
  reads?: Map<number, PlayerRead>;
}

export function tradeContext(league: League): TradeContext {
  const rosters = new Map<number, Player[]>(league.teams.map((t) => [t.id, []]));
  for (const p of Object.values(league.players)) if (p.teamId !== null) rosters.get(p.teamId)?.push(p);
  return { league, rosters, view: viewCache(league), market: leagueMarket(league) };
}

export const rosterOf = (ctx: TradeContext, teamId: number): Player[] => ctx.rosters.get(teamId) ?? [];

export const capRoom = (ctx: TradeContext, teamId: number, season = ctx.league.season) => capSheet(ctx.league, teamId, season, rosterOf(ctx, teamId)).space;
