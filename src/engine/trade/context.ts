/**
 * One trade decision pass's cache. A pass (one AI trade attempt, one verdict on the trade table) asks
 * for the same rosters, reads, slots and cap rooms hundreds of times, and nothing it reads changes
 * until a trade goes through. A context is thrown away with its pass, so a reloaded save decides the
 * same way; after a trade the market drops what that trade changed (`refreshAfterTrade`).
 */
import type { Coaching } from '../coaching';
import { capSheet } from '../finance/cap';
import { leagueMarket, minSalary, type Market } from '../finance/market';
import { ROSTER_MAX } from '../offseason/negotiation';
import { playerOvr } from '../positions';
import { perceive, type PlayerView } from '../scouting';
import type { TeamScheme } from '../schemes';
import type { TeamRecord } from '../season/standings';
import type { GmTraits, League, Player, Position } from '../types';
import type { BlockEntry, Need, Wanted } from './plans';
import type { PlayerRead } from './value';

export interface TradeContext {
  league: League;
  /** Every player on each team (injured reserve included), built in one pass over the league. */
  rosters: Map<number, Player[]>;
  /** Each front office's read of a player, computed once. */
  view: (teamId: number, p: Player) => PlayerView;
  viewsByTeam: Map<number, Map<number, PlayerView>>;
  /** The league's pay comps (contract surplus is measured against them). */
  market: Market;
  /**
   * Draft-order scores by team (lower picks earlier), filled on first use and kept for the whole pass:
   * one trade barely moves where 32 teams will pick (contender scores are kept per step the same way).
   */
  slotScores?: number[];
  /** Pick values by GM and pick (`pickValue`): they depend on the slot and the GM, not on who owns the pick. */
  pickValues?: Map<GmTraits, Map<number, number>>;
  /** Each pick at the league's going rate, by pick id. */
  goingRates?: Map<number, number>;
  /** Salary weights by team, filled on first use. */
  salaryWeights?: number[];
  /** Each front office's read of each player it has looked at (see `readPlayer`). */
  reads?: Map<number, PlayerRead>;
  /** Each front office's outlook for each player (`outlookFor`), keyed like `reads`. */
  outlooks?: Map<number, number>;
  /** How much each GM weighs the seasons ahead (`futureWeight`), by team. */
  futures?: Map<number, number>;
  /** The standings, each conference's seeds, the league's median starters, and each team's needs and block (`plans.ts`). */
  records?: Map<number, TeamRecord>;
  stanceScores?: Map<number, number>;
  seeds?: Map<number, number[]>;
  starterLine?: Record<Position, number>;
  needs?: Map<number, Need[]>;
  blocks?: Map<number, BlockEntry[]>;
  untouchables?: Map<number, Set<number>>;
  /** Each team's wish list from the current blocks (`wanted` over every listing), dropped when a trade changes them. */
  wanted?: Map<number, Wanted[]>;
  /** What each buyer could send each seller in a swap (`swapPieces`), by buyer × 64 + seller. */
  swapPieces?: Map<number, Player[]>;
  /** True overalls by player (`ovrOf`): they don't change in a pass, trades or not. */
  ovrs?: Map<number, number>;
  /** Cap space by team and league year (`capRoom`). */
  capRooms?: Map<number, number>;
  /** Each team's schemes and its coaching by position, read once per pass (`value.ts`). */
  schemes?: Map<number, TeamScheme>;
  coaching?: Map<number, Coaching>;
}

function rostersOf(league: League): Map<number, Player[]> {
  const rosters = new Map<number, Player[]>(league.teams.map((t) => [t.id, []]));
  for (const p of Object.values(league.players)) if (p.teamId !== null) rosters.get(p.teamId)?.push(p);
  return rosters;
}

/** Views by reading team, so a trade can drop the two teams' reads and keep everyone else's. */
function viewsOf(league: League): { view: TradeContext['view']; byTeam: Map<number, Map<number, PlayerView>> } {
  const byTeam = new Map<number, Map<number, PlayerView>>();
  const view = (teamId: number, p: Player) => {
    let mine = byTeam.get(teamId);
    if (!mine) byTeam.set(teamId, (mine = new Map()));
    let v = mine.get(p.id);
    if (!v) mine.set(p.id, (v = perceive(league, teamId, p)));
    return v;
  };
  return { view, byTeam };
}

export function tradeContext(league: League): TradeContext {
  const { view, byTeam } = viewsOf(league);
  return { league, rosters: rostersOf(league), view, viewsByTeam: byTeam, market: leagueMarket(league) };
}

/**
 * After a trade, keep what it didn't change. Rosters are rebuilt; the two teams' reads, needs, blocks
 * and wish lists go (a player who joins a team is known exactly there, one who leaves no longer is),
 * as do the traded players' reads by anyone and every team's wish list (the blocks they're drawn from
 * changed). League-wide numbers hold for the pass: cap-room weights, the median starters, projected
 * draft slots and pick values. The two teams that traded don't deal again in the same moment, and a
 * trade moves the league's medians by a hair.
 * Every other team's reads of every other player still hold: nothing about them moved.
 */
export function refreshAfterTrade(ctx: TradeContext, teamIds: readonly number[], playerIds: readonly number[]): void {
  ctx.rosters = rostersOf(ctx.league);
  for (const key of [...(ctx.capRooms?.keys() ?? [])])
    if (teamIds.includes(Math.floor(key / 8))) ctx.capRooms!.delete(key);
  for (const id of teamIds) {
    ctx.viewsByTeam.delete(id);
    ctx.needs?.delete(id);
    ctx.blocks?.delete(id);
    ctx.untouchables?.delete(id);
  }
  const moved = new Set(playerIds);
  const teams = new Set(teamIds);
  for (const memo of [ctx.reads, ctx.outlooks]) {
    if (!memo) continue;
    for (const key of [...memo.keys()]) {
      const playerId = Math.floor(key / 128);
      const teamId = Math.floor((key % 128) / 2);
      if (moved.has(playerId) || teams.has(teamId)) memo.delete(key);
    }
  }
  delete ctx.wanted;
  delete ctx.swapPieces;
}

export const rosterOf = (ctx: TradeContext, teamId: number): Player[] => ctx.rosters.get(teamId) ?? [];

/**
 * What an AI front office will spend on a trade: its cap space, less, in the offseason, minimum deals
 * for every spot it still has to fill to 53. A team that spent that money on a trade in free agency
 * reached kickoff short-handed and over the cap.
 */
export function spendable(ctx: TradeContext, teamId: number): number {
  const { league } = ctx;
  if (league.phase === 'regular' || league.phase === 'playoffs') return capRoom(ctx, teamId);
  const open = Math.max(0, ROSTER_MAX - rosterOf(ctx, teamId).filter((p) => !p.ir).length);
  return capRoom(ctx, teamId) - open * minSalary(0, ctx.market.cap);
}

/** A player's true overall, worked out once per pass: rosters are ranked and lined up against it again and again. */
export function ovrOf(ctx: TradeContext, p: Player): number {
  let v = (ctx.ovrs ??= new Map()).get(p.id);
  if (v === undefined) ctx.ovrs.set(p.id, (v = playerOvr(p)));
  return v;
}

/** A team's cap space this league year or a later one, worked out once per pass (a trade drops the two teams'). */
export function capRoom(ctx: TradeContext, teamId: number, season = ctx.league.season): number {
  const key = teamId * 8 + (season - ctx.league.season);
  const memo = (ctx.capRooms ??= new Map()).get(key);
  if (memo !== undefined) return memo;
  const space = capSheet(ctx.league, teamId, season, rosterOf(ctx, teamId)).space;
  ctx.capRooms.set(key, space);
  return space;
}
