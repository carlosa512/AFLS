/** Public trade reporting from completed deals and the market's recorded rumors. */
import { computeRecords } from './season/standings';
import { POSITION_NAMES } from './positions';
import { perceive } from './scouting';
import { isDeadlineDay, TRADE_DEADLINE_WEEK } from './trade/rules';
import type { InboxMessage, League, TradeRecord, TradeSide } from './types';

type Draft = Omit<InboxMessage, 'read'>;
const person = (l: League, id: number) => `${l.players[id].firstName} ${l.players[id].lastName}`;
const team = (l: League, id: number) => `${l.teams[id].city} ${l.teams[id].name}`;
const list = (parts: string[]) =>
  parts.length < 2 ? parts.join('') : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`;
const round = (n: number) => ['', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh'][n] ?? `${n}th`;
function complete(l: League, r: TradeRecord): boolean {
  return r.sides.every(
    (s) =>
      l.teams[s.teamId] &&
      s.players.every((id) => !!l.players[id]) &&
      s.picks.every((id) => l.draftPicks.some((p) => p.id === id)),
  );
}
function assets(l: League, s: TradeSide): string {
  return (
    list([
      ...s.players.map(
        (id) =>
          `${l.players[id].position} ${person(l, id)}${s.retain?.[id] ? ` (${l.teams[s.teamId].name} retain $${(s.retain[id] * 1000).toLocaleString('en-US')} of this season's salary)` : ''}`,
      ),
      ...s.picks.map((id) => {
        const p = l.draftPicks.find((p) => p.id === id)!;
        return `${p.season} ${round(p.round)}-round pick${l.teams[p.originalTeamId] ? ` (${l.teams[p.originalTeamId].abbrev})` : ''}`;
      }),
    ]) || 'No assets'
  );
}
const earlyPicks = (l: League, r: TradeRecord) =>
  r.sides
    .flatMap((s) => s.picks)
    .map((id) => l.draftPicks.find((p) => p.id === id)!)
    .filter((p) => p.round <= 2);
/** The deal's best player on our scouts' read: the name a story or a note leads with. */
export function leadPlayer(l: League, r: TradeRecord): number {
  const rating = (id: number) => perceive(l, l.userTeamId, l.players[id]).ovr;
  return r.sides.flatMap((s) => s.players).sort((a, b) => rating(b) - rating(a) || a - b)[0];
}
const identity = (r: TradeRecord) =>
  r.sides
    .map(
      (s) =>
        `${s.teamId}-p${[...s.players].sort((a, b) => a - b).join('.')}-d${[...s.picks].sort((a, b) => a - b).join('.')}`,
    )
    .sort()
    .join('_');
/** What makes a trade story's id: the director checks it to know SNN already ran the deal. */
export const tradeIdentity = identity;

/** Non-overlapping editions: fortnightly normally, weekly for the final two trading weeks.
 * A separate deadline-day slot only covers new activity on that day, never week 9 again.
 */
export function tradeNewsWindow(l: League, week: number): { from: number; to: number; deadline: boolean } | null {
  if (week === TRADE_DEADLINE_WEEK + 1 && isDeadlineDay(l)) return { from: week, to: week, deadline: true };
  if (week < 2 || week > TRADE_DEADLINE_WEEK) return null;
  if (week === TRADE_DEADLINE_WEEK) return { from: week, to: week, deadline: false };
  if (week % 2) return null;
  return { from: week - 1, to: week, deadline: false };
}
export const tradeNewsSlot = (l: League, week: number) =>
  `press:${l.season}:${week === TRADE_DEADLINE_WEEK + 1 && isDeadlineDay(l) ? 'deadline' : week}:`;

function discussedNames(
  l: League,
  from: number,
  to: number,
  limit: number,
): NonNullable<InboxMessage['tradeReport']>['rumors'] {
  const division = l.teams[l.userTeamId].division;
  const rumors = (l.market?.rumors ?? []).filter((r) => {
    const p = l.players[r.playerId];
    const seller = r.kind === 'shopping' ? r.teamIds[0] : r.teamIds[1];
    return (
      r.season === l.season &&
      r.phase === 'regular' &&
      r.week >= from &&
      r.week <= to &&
      p &&
      !p.retired &&
      p.teamId === seller &&
      !r.teamIds.includes(l.userTeamId) &&
      !(l.market?.history ?? []).some(
        (t) => t.season === l.season && t.week >= r.week && t.sides.some((s) => s.players.includes(p.id)),
      )
    );
  });
  rumors.sort(
    (a, b) =>
      Number(b.teamIds.some((id) => l.teams[id].division === division)) -
        Number(a.teamIds.some((id) => l.teams[id].division === division)) ||
      perceive(l, l.userTeamId, l.players[b.playerId]).ovr - perceive(l, l.userTeamId, l.players[a.playerId]).ovr ||
      b.week - a.week,
  );
  return rumors
    .filter((r, i) => rumors.findIndex((x) => x.playerId === r.playerId) === i)
    .slice(0, limit)
    .map((r) => ({
      playerId: r.playerId,
      sourceId: r.id,
      name: person(l, r.playerId),
      position: l.players[r.playerId].position,
      clubId: r.kind === 'shopping' ? r.teamIds[0] : r.teamIds[1],
      status: r.kind === 'shopping' ? 'Being shopped' : `Interest from the ${team(l, r.teamIds[0])}`,
    }));
}

/** One significant completed league deal; personal confirmations continue to handle the user's trades. */
export function keyTradeNews(l: League, week: number): Draft[] {
  const window = tradeNewsWindow(l, week);
  if (!window) return [];
  const division = l.teams[l.userTeamId].division;
  const rating = (id: number) => perceive(l, l.userTeamId, l.players[id]).ovr;
  const lead = (r: TradeRecord) => leadPlayer(l, r);
  const candidates = (l.market?.history ?? []).filter(
    (r) =>
      r.season === l.season &&
      r.phase === 'regular' &&
      r.week >= window.from &&
      r.week <= window.to &&
      !r.sides.some((s) => s.teamId === l.userTeamId) &&
      complete(l, r) &&
      r.sides.some((s) => s.players.length) &&
      (r.kind === 'star' || earlyPicks(l, r).length > 0 || rating(lead(r)) >= 13),
  );
  candidates.sort(
    (a, b) =>
      rating(lead(b)) - rating(lead(a)) ||
      Number(b.sides.some((s) => l.teams[s.teamId].division === division)) -
        Number(a.sides.some((s) => l.teams[s.teamId].division === division)) ||
      Number(b.kind === 'star') - Number(a.kind === 'star') ||
      earlyPicks(l, b).length - earlyPicks(l, a).length,
  );
  const deal = candidates[0];
  if (!deal) return [];
  const playerId = lead(deal);
  const seller = deal.sides.find((s) => s.players.includes(playerId))!;
  const buyer = deal.sides.find((s) => s !== seller)!;
  const position =
    l.players[playerId].position === 'OL'
      ? 'offensive lineman'
      : POSITION_NAMES[l.players[playerId].position].toLowerCase();
  const pick = buyer.picks
    .map((id) => l.draftPicks.find((p) => p.id === id)!)
    .sort((a, b) => a.round - b.round || a.season - b.season)[0];
  const opening = `The ${team(l, buyer.teamId)} have acquired ${position} ${person(l, playerId)} from the ${team(l, seller.teamId)}${pick ? ', with draft capital heading the other way' : buyer.players.length ? ' in a player exchange' : ', with no players or draft picks going back'}.`;
  const price = pick
    ? `A ${pick.season} ${round(pick.round)}-round pick is part of the return to the ${l.teams[seller.teamId].name}.`
    : `The ${l.teams[seller.teamId].name} receive ${assets(l, buyer)} in return.`;
  const rec = computeRecords(l).get(buyer.teamId)!;
  const timing =
    week <= TRADE_DEADLINE_WEEK ? `, with the trade deadline coming after Week ${TRADE_DEADLINE_WEEK}` : '';
  const context =
    rec.w + rec.l + rec.t
      ? `The ${l.teams[buyer.teamId].name} are ${rec.w}–${rec.l}${rec.t ? `–${rec.t}` : ''}${timing}.`
      : '';
  // Why the seller let him go, when its record says it: a club at .500 or worse is selling.
  const sold = computeRecords(l).get(seller.teamId);
  const selling =
    sold && sold.w + sold.l + sold.t && sold.w + sold.t / 2 <= (sold.w + sold.l + sold.t) / 2
      ? ` The ${l.teams[seller.teamId].name}, ${sold.w}–${sold.l}${sold.t ? `–${sold.t}` : ''}, are selling.`
      : '';
  return [
    {
      id: `${tradeNewsSlot(l, week)}trade:${identity(deal)}`,
      season: l.season,
      phase: 'regular',
      week,
      from: 'SNN — Sports News Network',
      category: 'league',
      subject: `${l.teams[buyer.teamId].name} land ${person(l, playerId)} in deal with ${l.teams[seller.teamId].name}`,
      body: [
        opening + (deal.week !== week ? ` The deal was completed in Week ${deal.week}.` : ''),
        `${price}${context ? ` ${context}` : ''}${selling}`,
      ].join('\n\n'),
      tradeReport: {
        exchanges: deal.sides.map((s, i) => ({ teamId: deal.sides[1 - i].teamId, receives: assets(l, s) })),
        rumors: discussedNames(l, window.from, window.to, 3),
        period: window.deadline
          ? 'Deadline day'
          : window.from === window.to
            ? `Week ${week}`
            : `Weeks ${window.from}–${week}`,
      },
      actions: [
        { kind: 'player', playerId },
        { kind: 'team', teamId: buyer.teamId },
        { kind: 'team', teamId: seller.teamId },
        { kind: 'trades' },
      ],
    },
  ];
}

/** Rumors remain attributed interest, never an agreement or an invented offer. */
export function rumorNews(l: League, week: number): Draft[] {
  if (l.phase !== 'regular' || week > TRADE_DEADLINE_WEEK || l.week > TRADE_DEADLINE_WEEK + 1) return [];
  const window = tradeNewsWindow(l, week);
  if (!window) return [];
  const selected = discussedNames(l, window.from, window.to, 4);
  const first = selected[0];
  if (!first) return [];
  const source = l.market!.rumors.find((r) => r.id === first.sourceId)!;
  const opening = source.text;
  const closing = `For now, ${first.name} remains with the ${l.teams[first.clubId].name}. ${window.deadline ? 'It is deadline day.' : `The deadline after Week ${TRADE_DEADLINE_WEEK} is approaching.`}`;
  return [
    {
      id: `${tradeNewsSlot(l, week)}rumor:${source.id}`,
      season: l.season,
      phase: 'regular',
      week,
      from: 'SNN — Sports News Network',
      category: 'league',
      subject:
        source.kind === 'shopping'
          ? `${l.teams[first.clubId].name} shopping ${first.name}`
          : `${l.teams[source.teamIds[0]].name} ask about ${first.name}`,
      body: [opening, closing].join('\n\n'),
      tradeReport: {
        exchanges: [],
        rumors: selected,
        period: window.deadline
          ? 'Deadline day'
          : window.from === window.to
            ? `Week ${week}`
            : `Weeks ${window.from}–${week}`,
      },
      actions: [...selected.map((r) => ({ kind: 'player' as const, playerId: r.playerId })), { kind: 'trades' }],
    },
  ];
}
