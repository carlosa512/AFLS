/**
 * The trade desk's state (docs/superpowers/specs/2026-10-28-office-trades-design.md): what needs you now and
 * the facts behind it. Read only from what your club can see: offers to you, your own statuses, the
 * calendar and the league's stance words. Never `market.interest`: what AI clubs watch is their business.
 */
import { isOffseason } from '../finance/cap';
import type { League, Player } from '../types';
import { rosterOf, type TradeContext } from './context';
import { openOffers } from './offers';
import { isBuyer, scoutedNeeds } from './plans';
import { isDeadlineDay, playerTradeBlocker, TRADE_DEADLINE_WEEK, tradeWindow } from './rules';

export type DeskHeadline = 'exam' | 'offers' | 'deadlineDay' | 'closed' | 'quiet';

export interface DeskState {
  headline: DeskHeadline;
  text: string;
  /** Waiting on you: the hero wears gold. */
  urgent: boolean;
  deadline: { value: string; note?: string };
  offers: number;
  listed: number;
  untouchable: number;
  /** Teams that asked for one of your players this league year. */
  asking: number;
}

/**
 * Which of your players each club has asked for this league year, by club: from its offers and enquiries to
 * you (any status), and only players still on your roster.
 */
export function askedAbout(league: League): Map<number, number[]> {
  const out = new Map<number, number[]>();
  for (const o of league.market?.offers ?? []) {
    if (o.season !== league.season) continue;
    const ids = o.sides[1].players.filter((id) => league.players[id]?.teamId === league.userTeamId);
    if (!ids.length) continue;
    const seen = out.get(o.teamId) ?? [];
    out.set(o.teamId, [...seen, ...ids.filter((id) => !seen.includes(id))]);
  }
  return out;
}

const weeks = (n: number) => `${n} week${n === 1 ? '' : 's'}`;

/** The deadline in words, for every part of the year. */
function deadlineWords(league: League): DeskState['deadline'] {
  if (league.phase === 'playoffs' || league.phase === 'complete') return { value: 'Reopens in the new league year' };
  if (league.phase !== 'regular' && isOffseason(league.phase))
    return { value: `Week ${TRADE_DEADLINE_WEEK}`, note: 'open all offseason' };
  if (league.week < TRADE_DEADLINE_WEEK)
    return { value: `Week ${TRADE_DEADLINE_WEEK} · ${weeks(TRADE_DEADLINE_WEEK - league.week)} away` };
  if (league.week === TRADE_DEADLINE_WEEK) return { value: 'This week' };
  return { value: isDeadlineDay(league) ? 'Today' : 'Passed' };
}

export function deskState(league: League): DeskState {
  const market = league.market;
  const user = league.userTeamId;
  const statuses = Object.entries(market?.status ?? {}).filter(([id]) => league.players[+id]?.teamId === user);
  const offers = openOffers(league).length;
  const base = {
    deadline: deadlineWords(league),
    offers,
    listed: statuses.filter(([, s]) => s === 'listed').length,
    untouchable: statuses.filter(([, s]) => s === 'untouchable').length,
    asking: askedAbout(league).size,
  };
  const flagged = market?.exam?.exams.find((e) => e.result !== 'passed');
  if (flagged) {
    const p = league.players[flagged.playerId];
    return {
      ...base,
      headline: 'exam',
      text: `A physical flagged ${p.firstName} ${p.lastName}: your call.`,
      urgent: true,
    };
  }
  if (offers)
    return {
      ...base,
      headline: 'offers',
      text: `${offers} offer${offers === 1 ? ' needs' : 's need'} an answer.`,
      urgent: true,
    };
  if (isDeadlineDay(league))
    return {
      ...base,
      headline: 'deadlineDay',
      text: 'Deadline day: the window shuts when you advance.',
      urgent: false,
    };
  const closed = tradeWindow(league);
  if (closed) return { ...base, headline: 'closed', text: closed, urgent: false };
  const buyers = league.teams.filter((t) => t.id !== user && isBuyer(t)).length;
  return { ...base, headline: 'quiet', text: `No calls waiting · ${buyers} teams are buying`, urgent: false };
}

/** This league year's players a team is said to be shopping, latest first, still on its roster. */
export function shoppingOf(league: League, teamId: number): Player[] {
  const ids = (league.market?.rumors ?? [])
    .filter((r) => r.kind === 'shopping' && r.season === league.season && r.teamIds[0] === teamId)
    .map((r) => r.playerId)
    .reverse();
  return [...new Set(ids)].map((id) => league.players[id]).filter((p) => p?.teamId === teamId);
}

/** How many players the picker's Fits chip lists. */
const FITS = 8;

/**
 * What the trade table's picker opens on, on your read only. Their side: the players they're said to be shopping,
 * then their best two at each of your needs. Your side: your best three at each of their needs. Never a player the
 * rules won't let move.
 */
export function pickerFits(league: League, ctx: TradeContext, partnerId: number, side: 'yours' | 'theirs'): Player[] {
  const user = league.userTeamId;
  const seen = (p: Player) => ctx.view(user, p).ovr;
  const from = side === 'theirs' ? partnerId : user;
  const wants = scoutedNeeds(ctx, user, league.teams[side === 'theirs' ? user : partnerId]).needs;
  const roster = rosterOf(ctx, from).filter((p) => !playerTradeBlocker(league, p));
  const out: Player[] =
    side === 'theirs' ? shoppingOf(league, partnerId).filter((p) => !playerTradeBlocker(league, p)) : [];
  for (const need of wants) {
    const best = roster
      .filter((p) => p.position === need.position)
      .sort((a, b) => seen(b) - seen(a))
      .slice(0, side === 'theirs' ? 2 : 3);
    for (const p of best) if (!out.includes(p)) out.push(p);
  }
  return out.slice(0, FITS);
}
