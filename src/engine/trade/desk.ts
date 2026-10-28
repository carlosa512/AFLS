/**
 * The trade desk's state (docs/superpowers/specs/2026-10-28-office-trades-design.md): what needs you now and
 * the facts behind it. Read only from what your club can see: offers to you, your own statuses, the
 * calendar and the league's stance words. Never `market.interest`: what AI clubs watch is their business.
 */
import { isOffseason } from '../finance/cap';
import type { League } from '../types';
import { openOffers } from './offers';
import { isBuyer } from './plans';
import { isDeadlineDay, TRADE_DEADLINE_WEEK, tradeWindow } from './rules';

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
