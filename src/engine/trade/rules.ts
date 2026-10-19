/**
 * Trade rules: the league's (windows, contracts, cap, rosters, physicals), which no amount of value
 * buys past, and the one GM policy every front office shares, kept out of sight: a player who just
 * signed isn't moved, and isn't taken from a team that just signed him.
 */
import { autoPostJune1, isOffseason, paidShare } from '../finance/cap';
import { capHit, deadMoney, isExpired } from '../finance/contract';
import { rosterLimit } from '../offseason/negotiation';
import { STARTERS } from '../positions';
import { Rng } from '../rng';
import type { League, Player, Position, TradeSide } from '../types';

export type { TradeSide };
import { capRoom, rosterOf, tradeContext, type TradeContext } from './context';

/**
 * Trades are allowed all offseason and through deadline day: the day after week 9's games (the NFL's
 * Tuesday after week 9), which lasts until week 10 is played.
 */
export const TRADE_DEADLINE_WEEK = 9;

export interface TradeProposal {
  /** sides[0] is the proposer (usually the user), sides[1] the AI partner. Each lists what that team sends. */
  sides: [TradeSide, TradeSide];
}

/** Deadline day: week 9's games are in, week 10's haven't started. */
export function isDeadlineDay(league: League): boolean {
  if (league.phase !== 'regular' || league.week !== TRADE_DEADLINE_WEEK + 1) return false;
  return !league.games.some((g) => g.season === league.season && g.week === league.week && g.result);
}

export function tradeWindow(league: League): string | null {
  if (league.phase === 'playoffs' || league.phase === 'complete') return 'Trades reopen when the new league year begins.';
  if (league.phase === 'regular' && league.week > TRADE_DEADLINE_WEEK && !isDeadlineDay(league)) return `The trade deadline (the day after week ${TRADE_DEADLINE_WEEK}) has passed.`;
  return null;
}

export const isTradeSeason = (league: League) => !tradeWindow(league) && (league.phase === 'regular' || isOffseason(league.phase));

/** Why a player can't be traded at all, by league rules: what every screen can show. */
export function playerTradeBlocker(league: League, p: Player): string | null {
  if (!p.contract || isExpired(p.contract, league.season)) return 'Not under contract.';
  if (p.ir) return 'On injured reserve.';
  // A trade waits on a physical, and a player who will miss weeks fails it.
  if (p.injury && p.injury.estimate[0] >= 2) return 'Injured: he would fail the physical.';
  return null;
}

// ───────── the hidden wait on new signings ─────────

/**
 * Weeks a GM waits before he moves a player he just signed, or takes one another team just signed.
 * Each GM's own, 4–8, rolled from the league seed and never shown anywhere: there's no week to time,
 * so signing a free agent to flip him can't be gamed.
 */
export function signingWait(league: League, teamId: number): number {
  const key = `${league.seed}:gm-cooldown:${teamId}`;
  let weeks = waits.get(key);
  if (weeks === undefined) waits.set(key, (weeks = 4 + Math.floor(new Rng(key).float(0, 5))));
  return weeks;
}
/** A pure function of the league seed and the team, so it's safe to remember across leagues and saves. */
const waits = new Map<string, number>();

/** Weeks since a player's deal was signed this league year (-1 for an offseason signing before the season), or null if it wasn't. */
function weeksSinceSigning(league: League, p: Player): number | null {
  const c = p.contract;
  // Rookie deals and tags aren't free-agent signings: they're tradable at once.
  if (!c || c.signedSeason !== league.season || c.signedWeek < 0 || c.kind === 'rookie' || c.kind === 'tag') return null;
  return league.phase === 'regular' ? league.week - 1 - c.signedWeek : -1;
}

/** Signed so recently that `teamId`'s GM won't deal him either way. */
export function freshlySigned(league: League, p: Player, teamId: number): boolean {
  const weeks = weeksSinceSigning(league, p);
  return weeks !== null && weeks < signingWait(league, teamId);
}

/** The judging GM's refusal over a fresh signing in the deal, in his words (no weeks, no numbers). */
export function freshSigningRefusal(league: League, teamId: number, proposal: TradeProposal): string | null {
  for (const side of proposal.sides) {
    for (const id of side.players) {
      const p = league.players[id];
      if (!freshlySigned(league, p, teamId)) continue;
      const name = `${p.firstName} ${p.lastName}`;
      if (side.teamId === teamId) return `${name} just signed with them, and they won't move him yet.`;
      return side.teamId === league.userTeamId ? `They won't take on ${name} so soon after he signed with you.` : `They won't take on ${name} so soon after he signed with the ${league.teams[side.teamId].name}.`;
    }
  }
  return null;
}

// ───────── cap and rosters ─────────

/** Cap space and dead money each side would have after the trade. */
export function tradeCapImpact(league: League, proposal: TradeProposal, ctx: TradeContext = tradeContext(league)) {
  const post = autoPostJune1(league.phase);
  return proposal.sides.map((side, i) => {
    const other = proposal.sides[1 - i];
    let space = capRoom(ctx, side.teamId);
    let dead = 0;
    for (const id of side.players) {
      const c = league.players[id].contract!;
      const split = deadMoney(c, league.season, { paid: paidShare(league, c), postJune1: post, trade: true });
      space += capHit(c, league.season) - split.thisYear;
      dead += split.thisYear + split.nextYear;
    }
    for (const id of other.players) {
      // The new team takes only the unpaid base salary; the bonus stays behind.
      const c = league.players[id].contract!;
      const base = c.years.find((y) => y.season === league.season)?.base ?? 0;
      space -= base * (1 - paidShare(league, c));
    }
    return { teamId: side.teamId, space, dead };
  });
}

/** The dead money a team's outgoing players leave behind: the bonus still to be counted lands at once (after June 1, partly next year). */
export function tradeDeadMoney(league: League, side: TradeSide): { thisYear: number; nextYear: number } {
  const post = autoPostJune1(league.phase);
  let thisYear = 0;
  let nextYear = 0;
  for (const id of side.players) {
    const c = league.players[id].contract!;
    const split = deadMoney(c, league.season, { paid: paidShare(league, c), postJune1: post, trade: true });
    thisYear += split.thisYear;
    nextYear += split.nextYear;
  }
  return { thisYear, nextYear };
}

/** The base salary a team would take on with a player: what's left of this season's. */
export function salaryToTake(league: League, p: Player): number {
  const c = p.contract;
  if (!c) return 0;
  return (c.years.find((y) => y.season === league.season)?.base ?? 0) * (1 - paidShare(league, c));
}

/** Hard rule problems (either side), independent of value. `rosterCuts`: AI teams waive a backup to make room. */
export function tradeProblem(league: League, proposal: TradeProposal, opts: { rosterCuts?: boolean; ctx?: TradeContext } = {}): string | null {
  const window = tradeWindow(league);
  if (window) return window;
  const [a, b] = proposal.sides;
  if (!a.players.length && !a.picks.length && !b.players.length && !b.picks.length) return 'Add players or picks to trade.';
  for (const side of proposal.sides) {
    for (const id of side.players) {
      const p = league.players[id];
      if (p.teamId !== side.teamId) return `${p.firstName} ${p.lastName} isn't on that roster.`;
      const blocker = playerTradeBlocker(league, p);
      if (blocker) return `${p.firstName} ${p.lastName}: ${blocker}`;
    }
    for (const id of side.picks) {
      const pick = league.draftPicks.find((x) => x.id === id);
      if (!pick || pick.ownerId !== side.teamId || pick.playerId !== undefined) return 'That pick is no longer available.';
    }
  }
  const ctx = opts.ctx ?? tradeContext(league);
  const impact = tradeCapImpact(league, proposal, ctx);
  for (const [i, side] of proposal.sides.entries()) {
    const other = proposal.sides[1 - i];
    const team = league.teams[side.teamId];
    if (impact[i].space < 0) return `${team.name} would be over the cap after this trade.`;
    const roster = rosterOf(ctx, side.teamId);
    const size = roster.filter((p) => !p.ir).length - side.players.length + other.players.length;
    if (size > rosterLimit(league) && !opts.rosterCuts) return `${team.name} would have too many players (${size}/${rosterLimit(league)}). Release someone first.`;
    if (league.phase === 'regular') {
      const after = roster.filter((p) => !side.players.includes(p.id)).concat(other.players.map((id) => league.players[id]));
      for (const pos of Object.keys(STARTERS) as Position[]) {
        if (after.filter((p) => p.position === pos).length < STARTERS[pos]) return `${team.name} can't be left without enough ${pos}s in season.`;
      }
    }
  }
  return null;
}
