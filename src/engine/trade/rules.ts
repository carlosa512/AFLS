/**
 * Trade rules: the league's (windows, contracts, cap, rosters, physicals), which no amount of value
 * buys past, and the one GM policy every front office shares, kept out of sight: a player who just
 * signed isn't moved, and isn't taken from a team that just signed him.
 */
import { autoPostJune1, isOffseason, paidShare } from '../finance/cap';
import { minSalary } from '../finance/market';
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
  // A position change settles in for the year: convert-and-sell isn't a trade.
  if (p.moves?.at(-1)?.season === league.season) return 'Just changed position: no deals until the new league year.';
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
  // Until camp only the 51 biggest cap hits count (`capSheet`): sending one away lets the 52nd in.
  const top51 = league.phase === 'resign' || league.phase === 'freeAgency' || league.phase === 'draft';
  return proposal.sides.map((side, i) => {
    const other = proposal.sides[1 - i];
    const roster = rosterOf(ctx, side.teamId);
    const gone = new Set(side.players);
    // What it keeps paying is dead money on its books this season.
    let dead = retainedBy(side);
    let deadNow = retainedBy(side);
    for (const id of side.players) {
      const c = league.players[id].contract!;
      const split = deadMoney(c, league.season, { paid: paidShare(league, c), postJune1: post, trade: true });
      deadNow += split.thisYear;
      dead += split.thisYear + split.nextYear;
    }
    // The new team takes only the unpaid base salary; the bonus stays behind.
    const arriving = other.players.map((id) => salaryToTake(league, league.players[id], other.retain?.[id] ?? 0));
    const hit = (p: Player) => (p.contract ? capHit(p.contract, league.season) : 0);
    const counted = (hits: number[]) => (top51 ? hits.sort((a, b) => b - a).slice(0, 51) : hits).reduce((a, b) => a + b, 0);
    const before = counted(roster.map(hit));
    const after = counted([...roster.filter((p) => !gone.has(p.id)).map(hit), ...arriving]);
    return { teamId: side.teamId, space: capRoom(ctx, side.teamId) + before - after - deadNow, dead };
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

/** The guaranteed money a release of the side's players would leave on the books that trading them moves off (`judge`'s `releasing`). */
export function guaranteesShed(league: League, side: TradeSide): number {
  const post = autoPostJune1(league.phase);
  const traded = tradeDeadMoney(league, side);
  const released = side.players.reduce((s, id) => {
    const c = league.players[id].contract!;
    const split = deadMoney(c, league.season, { paid: paidShare(league, c), postJune1: post });
    return s + split.thisYear + split.nextYear;
  }, 0);
  return Math.max(0, released - traded.thisYear - traded.nextYear);
}

/** The base salary a team would take on with a player: what's left of this season's, less what the sender keeps paying. */
export function salaryToTake(league: League, p: Player, retained = 0): number {
  const c = p.contract;
  if (!c) return 0;
  return (c.years.find((y) => y.season === league.season)?.base ?? 0) * (1 - paidShare(league, c)) - retained;
}

/** The most of a player's salary his team can keep paying in a trade: what's left of this season's base, down to the minimum he's owed. */
export function maxRetain(league: League, p: Player): number {
  const c = p.contract;
  if (!c) return 0;
  const left = 1 - paidShare(league, c);
  return Math.max(0, Math.floor(salaryToTake(league, p) - minSalary(p.experience, league.caps[league.season]) * left));
}

/** What a side keeps paying in all. */
export const retainedBy = (side: TradeSide) => Object.values(side.retain ?? {}).reduce((a, b) => a + b, 0);

/**
 * Hard rule problems (either side), independent of value. An AI team over the roster limit waives a
 * backup to make room (`aiCutdown` runs after every trade); yours must fit unless `rosterCuts` (you
 * name who goes when you accept an offer).
 */
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
    for (const [id, amount] of Object.entries(side.retain ?? {})) {
      const p = league.players[Number(id)];
      if (!side.players.includes(Number(id)) || amount < 0) return 'Only a player you send can have salary kept.';
      if (amount > maxRetain(league, p)) return `${league.teams[side.teamId].name} can't keep paying more of ${p.firstName} ${p.lastName}'s salary than he's owed this season.`;
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
    if (size > rosterLimit(league) && !opts.rosterCuts && side.teamId === league.userTeamId) return `${team.name} would have too many players (${size}/${rosterLimit(league)}). Release someone first.`;
    if (league.phase === 'regular') {
      const after = roster.filter((p) => !side.players.includes(p.id)).concat(other.players.map((id) => league.players[id]));
      for (const pos of Object.keys(STARTERS) as Position[]) {
        if (after.filter((p) => p.position === pos).length < STARTERS[pos]) return `${team.name} can't be left without enough ${pos}s in season.`;
      }
    }
  }
  return null;
}
