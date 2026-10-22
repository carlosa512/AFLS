/**
 * Offers to you (docs/TRADES.md, "Offers to you"). At each market moment a few AI front offices put
 * something on your desk, from the same deal search they use with each other:
 *
 * - a bid for one of your players a team has been watching (an enquiry first, while it's still asking around);
 * - a pitch for a player a seller is shopping that you need;
 * - a cap dump, when a squeezed team has a contract to move and you have room.
 *
 * An offer stays open until you next advance the calendar; simulating ahead lets offers lapse and
 * never accepts one for you. You accept (re-checked then, with the release a full roster needs),
 * decline (he won't come back for that player for a few weeks unless it's 10% better), or counter
 * (his patience runs one to three rounds, the last his final offer). You also set your players'
 * statuses, shop a player, and ask a GM his price. Verdicts are always the GM's own (`judge`).
 */
import { logTransaction, releasePlayer } from '../finance/cap';
import { isExpired } from '../finance/contract';
import { aiCutdown, cutChoice } from '../offseason/ai';
import { rosterLimit } from '../offseason/negotiation';
import { Rng } from '../rng';
import { activeRoster } from '../roster';
import type { DealKind, League, Physical, Player, Team, TradeExam, TradeMarket, TradeOffer, TradeSide } from '../types';
import { capRoom, rosterOf, spendable, tradeContext, type TradeContext } from './context';
import {
  DUMP_LIMIT,
  keepToFit,
  kindOf,
  MAX_PREMIUM,
  maxOver,
  packages,
  PER_BIDDER,
  picksOf,
  quickValue,
  TAGS,
} from './deals';
import { emptyMarket, executeTrade } from './execute';
import { evaluateTrade, floorShare, judge, marginFor, suggestSweetener } from './judge';
import { teamNeeds, tradeBlock, untouchables, wanted, type BlockEntry } from './plans';
import {
  freshlySigned,
  playerTradeBlocker,
  salaryToTake,
  tradeProblem,
  tradeWindow,
  type TradeProposal,
} from './rules';
import type { Moment } from './market';
import { lowerPrice, physicals, worstResult } from './physicals';
import { nudgeTrust, talkRefusal, talksOf } from './talks';
import { marketValue, POINTS_PER_K, salaryWeight } from './value';

type Listing = { team: Team; entry: BlockEntry };

/** Most offers a moment: two a week, four on deadline day, three an offseason step. */
const BUDGET: Record<Moment, number> = { week: 2, deadline: 4, leagueYear: 3, faDay: 3, camp: 3 };
/** The chance a front office with something to say picks up the phone this moment: the one knob, tuned by `npm run trades`. */
export const OFFER_RATE = 0.35;
/** Moments before a team offers for a player you turned down again, unless it's at least 10% better. */
const DECLINE_WAIT = 3;
const IMPROVED = 1.1;
/** An offer you let lapse: moments before that team tries the same players again. */
const IGNORED_WAIT = 2;
/** "Not for sale": moments before that team asks again. */
const NOT_FOR_SALE_WAIT = 6;
/** Resolved offers kept for the history. */
const KEEP_RESOLVED = 60;
/** A price more than this over what the league would pay is a silly ask: "can't make this work". */
const SILLY = 2;

/** How keen a front office thinks you are to move a player: on the block, or simply available. */
const LISTED = 0.9;
const AVAILABLE = 0.45;

const userTeam = (league: League) => league.teams[league.userTeamId];

/** Your players other teams can call about: under contract, tradeable, not Untouchable, not just signed. */
export function yourListings(ctx: TradeContext): Listing[] {
  const { league } = ctx;
  const user = userTeam(league);
  const status = league.market?.status ?? {};
  return rosterOf(ctx, user.id)
    .filter(
      (p) =>
        p.contract &&
        !isExpired(p.contract, league.season) &&
        status[p.id] !== 'untouchable' &&
        !playerTradeBlocker(league, p) &&
        !freshlySigned(league, p, user.id),
    )
    .map((p) => ({
      team: user,
      entry: {
        playerId: p.id,
        reason: status[p.id] === 'listed' ? ('listed' as const) : ('available' as const),
        keenness: status[p.id] === 'listed' ? LISTED : AVAILABLE,
      },
    }));
}

// ───────── building offers ─────────

/**
 * What an AI buyer opens with for one of your players: about what the league would pay on his own
 * read, 5% less once you've put him on the block (he knows you want to sell), more when other teams
 * are asking, never more than he'd pay; when no package reaches that, the best he would pay under it,
 * down to what a seller holds out for. Picks first; a player of his only when no pick package works.
 * A buyer short of room asks you to keep paying what he can't fit, and pays for it, as between AI
 * teams (`dealFor`). Sides: [his, yours].
 */
export function bidFor(ctx: TradeContext, buyer: Team, target: Player): TradeProposal | null {
  const { league } = ctx;
  const user = userTeam(league);
  const retain = keepToFit(league, target, spendable(ctx, buyer.id));
  if (retain === null) return null;
  const yours: TradeSide = {
    teamId: user.id,
    players: [target.id],
    picks: [],
    ...(retain ? { retain: { [target.id]: retain } } : {}),
  };
  const nothing: TradeProposal = { sides: [{ teamId: buyer.id, players: [], picks: [] }, yours] };
  const most = judge(ctx, buyer.id, nothing, { rosterCuts: true }).get / marginFor(buyer, user);
  const value = marketValue(ctx, buyer, target);
  if (value <= 0 || most <= 0) return null;
  // The salary you keep makes him that much cheaper to him: it's in his price, his most and your floor.
  const worth = value + POINTS_PER_K * retain;
  const bidders = (league.market?.interest ?? []).filter(
    (x) => x.playerId === target.id && x.teamId !== buyer.id,
  ).length;
  const listed = league.market?.status[target.id] === 'listed';
  const price = Math.min(most, worth * (1 + Math.min(MAX_PREMIUM, PER_BIDDER * bidders)) * (listed ? 0.95 : 1));
  const ceiling = maxOver(buyer.gm) * worth;
  // How low a bid under his price may go: what an AI seller would hold out for from you, 5% less once he's on the block.
  const floor = floorShare(league, user, target, true) * worth * (listed ? 0.95 : 1);
  const valued = packages(ctx, buyer, user)
    .map((side) => ({ side, value: quickValue(ctx, buyer, side) }))
    .filter((x) => x.value <= ceiling);
  const picksFirst = (a: { side: TradeSide }, b: { side: TradeSide }) =>
    Number(a.side.players.length > 0) - Number(b.side.players.length > 0);
  // The cheapest package at his price first; then the best he'd pay under it, down to the floor. Packages are read at
  // the going rate and `judge` prices them on his own chart, where a patient GM's picks, firsts in back-to-back
  // drafts and each first past his second cost more; and other bidders push his price up to his own most. So a
  // shopped star's price in firsts can be past every package he'd sign off on: he offers what he can, not nothing.
  const ranked = [
    ...valued
      .filter((x) => x.value >= price)
      .sort((a, b) => picksFirst(a, b) || a.value - b.value)
      .slice(0, 8),
    ...valued
      .filter((x) => x.value < price && x.value >= floor)
      .sort((a, b) => picksFirst(a, b) || b.value - a.value)
      .slice(0, 8),
  ];
  for (const { side } of ranked) {
    const proposal: TradeProposal = { sides: [side, yours] };
    if (judge(ctx, buyer.id, proposal, { rosterCuts: true }).accepts) return proposal;
  }
  return null;
}

/**
 * What a GM wants from your roster and picks for his player (*Ask for their price*, and his pitch):
 * the cheapest package he'd take from you, never one of your Untouchables, and nothing at all rather
 * than a silly ask. Sides: [yours, his].
 */
export function askFor(ctx: TradeContext, seller: Team, target: Player): TradeProposal | null {
  const { league } = ctx;
  const user = userTeam(league);
  // If you can't fit his salary, he keeps paying the difference (and asks more for it).
  const retain = keepToFit(league, target, capRoom(ctx, user.id));
  if (retain === null) return null;
  const his: TradeSide = {
    teamId: seller.id,
    players: [target.id],
    picks: [],
    ...(retain ? { retain: { [target.id]: retain } } : {}),
  };
  const need = judge(
    ctx,
    seller.id,
    { sides: [{ teamId: user.id, players: [], picks: [] }, his] },
    { vsUser: true },
  ).need;
  const worth = Math.max(marketValue(ctx, seller, target), 1);
  const ranked = packages(ctx, user, seller)
    .map((side) => ({ side, value: quickValue(ctx, seller, side) }))
    .filter((x) => x.value >= need * 0.9 && x.value <= SILLY * Math.max(worth, need))
    .sort((a, b) => Number(a.side.players.length > 0) - Number(b.side.players.length > 0) || a.value - b.value)
    .slice(0, 12);
  for (const { side } of ranked) {
    const proposal: TradeProposal = { sides: [side, his] };
    if (judge(ctx, seller.id, proposal, { vsUser: true, rosterCuts: true }).accepts) return proposal;
  }
  return null;
}

/**
 * A squeezed team's bad contract with a pick to take it on: the cheapest of its picks that covers
 * most of what the contract costs you (it can't see your books, so it pays what the league would).
 * Short deals and modest burdens only, as between AI teams. Sides: [his, yours].
 */
export function dumpToYou(ctx: TradeContext, sender: Team, player: Player): TradeProposal | null {
  const { league } = ctx;
  const user = userTeam(league);
  if (capRoom(ctx, user.id) < 1.1 * salaryToTake(league, player)) return null;
  const burden = -marketValue(ctx, sender, player);
  if (burden <= 0 || burden > DUMP_LIMIT) return null;
  const sweetener = picksOf(ctx, sender.id, user)
    .reverse()
    .find((pk) => quickValue(ctx, sender, { teamId: sender.id, players: [], picks: [pk.id] }) >= 0.8 * burden);
  if (!sweetener) return null;
  const proposal: TradeProposal = {
    sides: [
      { teamId: sender.id, players: [player.id], picks: [sweetener.id] },
      { teamId: user.id, players: [], picks: [] },
    ],
  };
  return judge(ctx, sender.id, proposal, { rosterCuts: true }).accepts &&
    !tradeProblem(league, proposal, { rosterCuts: true, ctx })
    ? proposal
    : null;
}

/** Can this team come to you about this player now? Not while talks are off or he's cooling off, unless its offer is clearly better. */
function mayCall(market: TradeMarket, teamId: number, playerIds: readonly number[], worth = 0): boolean {
  const t = market.talks[teamId];
  if (t?.offUntil !== undefined && t.offUntil >= market.moment) return false;
  return playerIds.every((id) => {
    const c = t?.cooldowns[id];
    return !c || c.until < market.moment || worth >= IMPROVED * c.worth;
  });
}

/** What the news would call it: the player the deal is about, from his team's side. */
function offerKind(ctx: TradeContext, [his, yours]: TradeOffer['sides']): DealKind {
  const { league } = ctx;
  if (yours.players.length) return kindOf(ctx, userTeam(league), league.players[yours.players[0]], his);
  if (his.players.length) return kindOf(ctx, league.teams[his.teamId], league.players[his.players[0]], yours);
  return 'user';
}

/** File an offer from `team` (sides [his, yours]), or null if it may not be made now. */
function file(
  ctx: TradeContext,
  market: TradeMarket,
  team: Team,
  reason: TradeOffer['reason'],
  proposal: TradeProposal | null,
  kind?: TradeOffer['kind'],
): TradeOffer | null {
  if (!proposal) return null;
  const { league } = ctx;
  const [his, yours] = proposal.sides;
  const worth = quickValue(ctx, team, his);
  if (!mayCall(market, team.id, [...yours.players, ...his.players], worth)) return null;
  const offer: TradeOffer = {
    id: market.nextOfferId++,
    teamId: team.id,
    sides: [his, yours],
    kind: kind ?? (reason === 'dump' ? 'dump' : offerKind(ctx, [his, yours])),
    reason,
    season: league.season,
    phase: league.phase,
    week: league.week,
    moment: market.moment,
    status: 'pending',
    // Patience runs one to three counters, by how stubborn he is.
    patience: 1 + Math.round(2 * team.gm.stubbornness),
    worth,
  };
  market.offers.push(offer);
  return offer;
}

/** A team at "asking around" about one of your players: is he available? */
function enquiry(ctx: TradeContext, market: TradeMarket, team: Team, player: Player): TradeOffer | null {
  // A team says it's interested only if it has a number in mind.
  if (!bidFor(ctx, team, player)) return null;
  const proposal: TradeProposal = {
    sides: [
      { teamId: team.id, players: [], picks: [] },
      { teamId: ctx.league.userTeamId, players: [player.id], picks: [] },
    ],
  };
  return file(ctx, market, team, 'enquiry', proposal, 'enquiry');
}

/**
 * This moment's calls to you: bids and enquiries from teams that have been watching your players,
 * pitches from sellers with a player you need, and (when the league year opens or in camp) dumps.
 * At most a few a moment, one per team, the most pressing first. Its own random stream, so the AI
 * market between other teams plays out the same whatever lands on your desk.
 */
export function offersMoment(
  ctx: TradeContext,
  market: TradeMarket,
  moment: Moment,
  aiListings: readonly Listing[],
): TradeOffer[] {
  const { league } = ctx;
  const user = userTeam(league);
  if (!user || tradeWindow(league)) return [];
  const rng = new Rng(`${league.seed}:offers:${league.season}:${league.phase}:${league.week}:${league.faDay}`);
  // A call about a player you've put on the block is always made: you've told the league he's available.
  const calls: { team: Team; score: number; sure?: boolean; rate?: number; make: () => TradeOffer | null }[] = [];
  for (const x of market.interest) {
    const p = league.players[x.playerId];
    if (!p || p.teamId !== user.id || market.status[p.id] === 'untouchable') continue;
    const team = league.teams[x.teamId];
    const listed = market.status[p.id] === 'listed';
    if (x.level >= 3 || (listed && x.level >= 2))
      calls.push({
        team,
        score: x.level + (listed ? 1 : 0),
        sure: listed,
        make: () => file(ctx, market, team, 'bid', bidFor(ctx, team, p)),
      });
    // Most teams that are only asking around never call: an enquiry now and then, not every week.
    else if (x.level === 2)
      calls.push({ team, score: 1, rate: OFFER_RATE / 2, make: () => enquiry(ctx, market, team, p) });
  }
  // Sellers pitch only what they're keen to move, and only where you have a real need.
  for (const w of wanted(
    ctx,
    user,
    aiListings.filter((l) => l.entry.keenness >= 0.75),
  )
    .filter((w) => w.score >= 0.5)
    .slice(0, 2)) {
    calls.push({
      team: w.team,
      score: 1 + w.score,
      make: () => file(ctx, market, w.team, 'pitch', flip(askFor(ctx, w.team, w.player))),
    });
  }
  if (moment === 'leagueYear') {
    for (const team of league.teams.filter((t) => t.id !== user.id && salaryWeight(ctx, t.id) >= 1.6)) {
      const entry = tradeBlock(ctx, team).find((e) => e.reason === 'overpaid');
      if (entry)
        calls.push({
          team,
          score: 1,
          make: () => file(ctx, market, team, 'dump', dumpToYou(ctx, team, league.players[entry.playerId])),
        });
    }
  }
  const made: TradeOffer[] = [];
  const called = new Set<number>();
  // Shuffled first, so calls of equal weight come in any order.
  for (const c of rng.shuffle(calls).sort((a, b) => b.score - a.score)) {
    if (made.length >= BUDGET[moment]) break;
    if (called.has(c.team.id) || (!c.sure && !rng.chance(c.rate ?? OFFER_RATE))) continue;
    const offer = c.make();
    if (!offer) continue;
    made.push(offer);
    called.add(c.team.id);
  }
  return made;
}

/** [yours, his] → [his, yours]. */
const flip = (p: TradeProposal | null): TradeProposal | null => (p ? { sides: [p.sides[1], p.sides[0]] } : null);

// ───────── the lifecycle ─────────

/**
 * Called when you advance the calendar (play a week, take an offseason step): whatever you didn't
 * answer lapses. Keeps the pending offers and the latest resolved ones; drops statuses of players
 * who've left your team.
 */
export function expireOffers(league: League): void {
  const market = league.market;
  if (!market) return;
  // A deal still waiting on your call after its physical lapses too.
  delete market.exam;
  for (const o of market.offers.filter((x) => x.status === 'pending')) {
    o.status = 'expired';
    // Same week the card's "Open until you play week N" promised: `expireOffers` runs before the week moves.
    o.outcome =
      league.phase === 'regular' ? `It lapsed when you played week ${league.week}.` : 'It lapsed when you moved on.';
    // You didn't bite: he doesn't call about the same players next week, unless you've since put him on the block.
    const t = talksOf(market, o.teamId);
    for (const pid of [...o.sides[0].players, ...o.sides[1].players])
      if (market.status[pid] !== 'listed') t.cooldowns[pid] ??= { until: market.moment + IGNORED_WAIT, worth: o.worth };
  }
  const resolved = market.offers.filter((o) => o.status !== 'pending');
  market.offers = [...market.offers.filter((o) => o.status === 'pending'), ...resolved.slice(-KEEP_RESOLVED)].sort(
    (a, b) => a.id - b.id,
  );
  for (const id of Object.keys(market.status).map(Number))
    if (league.players[id]?.teamId !== league.userTeamId) delete market.status[id];
}

/**
 * Before you see this week's desk, every offer still pending is judged again by its own team on the state
 * you'll accept in (call it after the week has moved): one it would now refuse, or an enquiry it has no
 * number for, is withdrawn. An offer withdrawn here never reaches the inbox, because `offerMail` files only
 * `'pending'` offers and `deliverMail` runs after `store.mutate`.
 */
export function recheckOffers(league: League): void {
  const pending = (league.market?.offers ?? []).filter((o) => o.status === 'pending');
  if (!pending.length) return;
  const ctx = tradeContext(league);
  for (const o of pending) {
    const ok =
      o.kind === 'enquiry'
        ? bidFor(ctx, league.teams[o.teamId], league.players[o.sides[1].players[0]]) !== null
        : judge(ctx, o.teamId, { sides: o.sides }, { rosterCuts: true }).accepts;
    if (ok) continue;
    o.status = 'withdrawn';
    o.outcome = 'They pulled it before it reached you.';
  }
}

export const openOffers = (league: League): TradeOffer[] =>
  tradeWindow(league) ? [] : (league.market?.offers ?? []).filter((o) => o.status === 'pending');

/** The offer that answers this one: a bid filed from an enquiry, or the counter to a counter. */
export const replyOf = (league: League, offer: TradeOffer): TradeOffer | undefined =>
  league.market?.offers.find((o) => o.replyTo === offer.id);

const offerById = (league: League, id: number) => league.market?.offers.find((o) => o.id === id);

/** Every player and pick in it is still where the offer found it. */
function stillThere(league: League, offer: TradeOffer): boolean {
  return offer.sides.every(
    (s) =>
      s.players.every((id) => league.players[id]?.teamId === s.teamId) &&
      s.picks.every((id) => league.draftPicks.find((p) => p.id === id)?.ownerId === s.teamId),
  );
}

export interface AcceptResult {
  ok: boolean;
  message: string;
  /** Your roster would be over the limit: who `aiCutdown` would let go, to start the release picker with. */
  release?: Player[];
  /** A physical flagged a player: the deal waits on your call (`resolveExam`). */
  exam?: boolean;
}

const tagFor = (offer: TradeOffer) => (offer.kind === 'enquiry' || offer.kind === 'user' ? 'trade' : TAGS[offer.kind]);

/**
 * Accept an offer, re-checked now: he must still want it and it must still be legal. If your roster
 * would be over the limit, nothing happens until you name who goes (`release`; we suggest who).
 */
export function acceptOffer(league: League, id: number, release: readonly number[] = []): AcceptResult {
  league.market ??= emptyMarket();
  const offer = offerById(league, id);
  if (!offer || offer.status !== 'pending' || offer.kind === 'enquiry')
    return { ok: false, message: 'That offer is no longer on the table.' };
  if (league.market.exam?.offerId === id)
    return { ok: false, exam: true, message: 'This deal is waiting on your call after the physical.' };
  const window = tradeWindow(league);
  if (window) {
    offer.status = 'expired';
    offer.outcome = window;
    return { ok: false, message: window };
  }
  const ai = league.teams[offer.teamId];
  if (!stillThere(league, offer)) {
    const message = `Something in it has moved since, so the ${ai.name} have taken the offer off the table.`;
    offer.status = 'withdrawn';
    offer.outcome = message;
    return { ok: false, message };
  }
  const ctx = tradeContext(league);
  const proposal: TradeProposal = { sides: offer.sides };
  const his = judge(ctx, ai.id, proposal, { rosterCuts: true });
  if (his.problem || his.refusal || !his.accepts) {
    const message = his.problem ?? `The ${ai.name} re-ran the numbers and pulled the offer.`;
    offer.status = 'withdrawn';
    offer.outcome = message;
    return { ok: false, message };
  }
  const user = userTeam(league);
  const incoming = offer.sides[0].players;
  const after = [
    ...activeRoster(league, user.id).filter((p) => !offer.sides[1].players.includes(p.id)),
    ...incoming.map((pid) => league.players[pid]),
  ];
  const over = after.length - rosterLimit(league);
  let cut: number[] = [];
  if (over > 0) {
    const yours = after.filter((p) => !incoming.includes(p.id));
    const chosen = release.map((pid) => league.players[pid]).filter((p) => p && yours.includes(p));
    if (chosen.length < over)
      return {
        ok: false,
        message: `You'd be ${over} over the roster limit: choose who to release.`,
        release: cutChoice(league, after, rosterLimit(league), yours),
      };
    cut = chosen.slice(0, over).map((p) => p.id);
  }
  return finish(league, proposal, { kind: offer.kind, tag: tagFor(offer) }, ai.id, { offerId: offer.id, release: cut });
}

// ───────── physicals on your deals ─────────

/**
 * An agreed deal of yours goes to the physicals. Their doctor examines your players first (it's
 * their money): a failure calls it off, concerns bring a lower offer you take or refuse. Then yours
 * examines theirs: a failure or concerns put the call to you (walk, ask for less, take him anyway).
 * Clean physicals make it official.
 */
function finish(
  league: League,
  proposal: TradeProposal,
  meta: { kind: DealKind; tag?: string },
  aiId: number,
  opts: { offerId?: number; release?: number[] } = {},
): AcceptResult {
  const market = (league.market ??= emptyMarket());
  const ai = league.teams[aiId];
  const exams = physicals(league, proposal);
  const yours = proposal.sides.find((s) => s.teamId === league.userTeamId)!;
  const theirs = exams.filter((e) => yours.players.includes(e.playerId));
  const mine = exams.filter((e) => !yours.players.includes(e.playerId));
  const flagged = (list: Physical[], result: Physical['result']) =>
    league.players[list.find((e) => e.result === result)!.playerId];
  const pending = (by: TradeExam['by'], reduced?: TradeProposal | null): TradeExam => {
    market.exam = {
      sides: proposal.sides,
      aiId,
      ...meta,
      exams,
      by,
      ...(reduced ? { reduced: reduced.sides } : {}),
      ...(opts.offerId !== undefined ? { offerId: opts.offerId } : {}),
      ...(opts.release?.length ? { release: opts.release } : {}),
    };
    return market.exam;
  };
  const theirCall = worstResult(theirs);
  if (theirCall === 'failed') {
    const p = flagged(theirs, 'failed');
    const offer = opts.offerId !== undefined ? offerById(league, opts.offerId) : undefined;
    const message = `${theirs.find((e) => e.result === 'failed')!.note} The ${ai.name} have called the deal off.`;
    if (offer) {
      offer.status = 'withdrawn';
      offer.outcome = message;
    }
    logTransaction(
      league,
      'medical',
      [ai.id, league.userTeamId],
      `The ${ai.name}' trade for ${p.position} ${p.firstName} ${p.lastName} is off after a failed physical.`,
    );
    return { ok: false, message };
  }
  if (theirCall === 'concerns') {
    const p = flagged(theirs, 'concerns');
    const reduced = lowerPrice(tradeContext(league), proposal, ai.id);
    pending('theirs', reduced);
    return {
      ok: false,
      exam: true,
      message: `The ${ai.name}' doctor has concerns about ${p.firstName} ${p.lastName}. ${reduced ? 'They come back with a lower offer.' : 'They want to talk price.'}`,
    };
  }
  const myCall = worstResult(mine);
  if (myCall === 'failed' || myCall === 'concerns') {
    const e = mine.find((x) => x.result === myCall)!;
    pending('yours');
    return { ok: false, exam: true, message: `${e.note} Your call: walk away, ask for less, or take him anyway.` };
  }
  return settle(league, proposal.sides, meta, aiId, exams, opts);
}

/** Make a deal of yours official: your releases, the trade, his cut to fit, a little trust. */
function settle(
  league: League,
  sides: TradeOffer['sides'],
  meta: { kind: DealKind; tag?: string },
  aiId: number,
  exams: Physical[],
  opts: { offerId?: number; release?: number[] } = {},
): AcceptResult {
  const market = (league.market ??= emptyMarket());
  const ai = league.teams[aiId];
  for (const id of opts.release ?? [])
    if (league.players[id]?.teamId === league.userTeamId) releasePlayer(league, league.players[id]);
  executeTrade(league, { sides }, { ...meta, physicals: exams });
  aiCutdown(league, ai, rosterLimit(league));
  const offer = opts.offerId !== undefined ? offerById(league, opts.offerId) : undefined;
  delete market.exam;
  nudgeTrust(market, ai.id, 0.03);
  const rehab = exams
    .filter((e) => e.result === 'rehab')
    .map((e) => ` ${e.note}`)
    .join('');
  const message = `Done: the trade with the ${ai.name} is official.${rehab}`;
  if (offer) {
    offer.status = 'accepted';
    offer.outcome = message;
  }
  return { ok: true, message };
}

/**
 * Your answer to a flagged physical. Your doctor's flag: `walk`, `lower` (he takes a notch less or
 * says no), or `anyway` (the risk is yours). Theirs: `reduced` (their lower offer) or `keep` him.
 */
export function resolveExam(league: League, choice: 'walk' | 'lower' | 'anyway' | 'reduced' | 'keep'): AcceptResult {
  const market = league.market;
  const exam = market?.exam;
  if (!market || !exam) return { ok: false, message: 'There is nothing waiting on a physical.' };
  const ai = league.teams[exam.aiId];
  const opts = { offerId: exam.offerId, release: exam.release };
  const off = (message: string) => {
    delete market.exam;
    const offer = exam.offerId !== undefined ? offerById(league, exam.offerId) : undefined;
    if (offer) {
      offer.status = 'declined';
      offer.outcome = message;
    }
    return { ok: false, message };
  };
  const proposal: TradeProposal = { sides: exam.sides };
  if (tradeWindow(league) || tradeProblem(league, proposal, { rosterCuts: true }))
    return off('The deal can no longer go through.');
  if (choice === 'walk' || choice === 'keep') return off(`The deal with the ${ai.name} is off.`);
  if (choice === 'anyway') return settle(league, exam.sides, exam, exam.aiId, exam.exams, opts);
  if (choice === 'reduced')
    return exam.reduced
      ? settle(league, exam.reduced, exam, exam.aiId, exam.exams, opts)
      : off(`The ${ai.name} have walked away.`);
  const ctx = tradeContext(league);
  const lower = lowerPrice(ctx, proposal, league.userTeamId);
  if (lower && judge(ctx, ai.id, lower, { rosterCuts: true }).accepts)
    return settle(league, lower.sides, exam, exam.aiId, exam.exams, opts);
  return { ok: false, message: `The ${ai.name} won't go lower. Walk away, or take him anyway.` };
}

/** Turn an offer down: that team won't come back for those players for a few weeks unless it's 10% better. */
export function declineOffer(league: League, id: number): void {
  const market = league.market;
  const offer = offerById(league, id);
  if (!market || !offer || offer.status !== 'pending') return;
  offer.status = 'declined';
  offer.outcome = 'You turned it down.';
  const t = talksOf(market, offer.teamId);
  for (const pid of [...offer.sides[0].players, ...offer.sides[1].players])
    t.cooldowns[pid] = { until: market.moment + DECLINE_WAIT, worth: offer.worth };
  nudgeTrust(market, offer.teamId, -0.02);
}

/**
 * Answer an enquiry: invite a bid now (the enquiry is answered, and the bid replies to it), or say he's
 * not for sale (that team stops asking for six weeks). `message` is the line the enquiry's card keeps.
 */
export function answerEnquiry(
  league: League,
  id: number,
  answer: 'offer' | 'notForSale',
): { offer: TradeOffer | null; message: string } {
  const market = league.market;
  const offer = offerById(league, id);
  if (!market || !offer || offer.status !== 'pending' || offer.kind !== 'enquiry')
    return { offer: null, message: 'That call has already been dealt with.' };
  const pid = offer.sides[1].players[0];
  if (answer === 'notForSale') {
    offer.status = 'declined';
    offer.outcome = "You told them he's not for sale.";
    talksOf(market, offer.teamId).cooldowns[pid] = {
      until: market.moment + NOT_FOR_SALE_WAIT,
      worth: Number.MAX_SAFE_INTEGER,
    };
    return { offer: null, message: offer.outcome };
  }
  offer.status = 'answered';
  const ctx = tradeContext(league);
  const team = league.teams[offer.teamId];
  const bid = file(ctx, market, team, 'bid', bidFor(ctx, team, league.players[pid]));
  if (bid) {
    bid.replyTo = offer.id;
    offer.outcome = `You asked for an offer: the ${team.name} came back with one.`;
  } else {
    offer.outcome = `You asked for an offer, but the ${team.name} couldn't make the numbers work.`;
  }
  return { offer: bid, message: offer.outcome };
}

export type CounterResult = {
  result: 'accepted' | 'countered' | 'walked' | 'refused';
  message: string;
  offer?: TradeOffer;
};

/**
 * Your counter to an offer, as the trade table builds it ([yours, his]). He takes it if it works for
 * him; otherwise he comes back with your version plus what would make it work, while his patience
 * lasts. A counter at his final offer ends talks for the moment.
 */
export function counterOffer(league: League, id: number, proposal: TradeProposal): CounterResult {
  const market = (league.market ??= emptyMarket());
  const offer = offerById(league, id);
  if (!offer || offer.status !== 'pending')
    return { result: 'refused', message: 'That offer is no longer on the table.' };
  const ai = league.teams[offer.teamId];
  const talk = talkRefusal(market, ai.id);
  if (talk) return { result: 'refused', message: talk };
  talksOf(market, ai.id).asks++;
  const verdict = evaluateTrade(league, proposal);
  if (verdict.problem && !verdict.policy) return { result: 'refused', message: verdict.problem };
  if (verdict.accepts) {
    const done = finish(
      league,
      proposal,
      { kind: offer.kind === 'enquiry' ? 'user' : offer.kind, tag: tagFor(offer) },
      ai.id,
      { offerId: offer.id },
    );
    return {
      result: done.ok ? 'accepted' : 'refused',
      message: done.ok ? `The ${ai.name} accepted your counter.` : done.message,
    };
  }
  const walkedAway = () => {
    offer.status = 'declined';
    offer.outcome = `You countered and the ${ai.name} walked away.`;
    return { result: 'walked' as const, message: `The ${ai.name} have walked away. Talks are off for now.` };
  };
  if (offer.final || offer.patience <= 0) {
    talksOf(market, ai.id).offUntil = market.moment;
    nudgeTrust(market, ai.id, -0.05);
    return walkedAway();
  }
  const ctx = tradeContext(league);
  const add = suggestSweetener(league, proposal);
  const [yours, his] = proposal.sides;
  const back: TradeProposal = add
    ? {
        sides: [
          his,
          {
            ...yours,
            players: add.kind === 'player' ? [...yours.players, add.id] : yours.players,
            picks: add.kind === 'pick' ? [...yours.picks, add.id] : yours.picks,
          },
        ],
      }
    : { sides: offer.sides };
  const patience = offer.patience - 1;
  const next = file(ctx, market, ai, 'counter', back, offer.kind);
  if (!next) return walkedAway();
  Object.assign(next, { patience, final: patience <= 0 || undefined, replyTo: offer.id });
  offer.status = 'answered';
  offer.outcome = "You countered: they've come back with an answer.";
  return {
    result: 'countered',
    message: next.final ? 'That is his final offer.' : 'He has come back with a counter.',
    offer: next,
  };
}

/** A proposal of yours from the trade table ([yours, his]): he hears about four a moment, and turning you down costs a little trust. */
export function proposeTrade(league: League, proposal: TradeProposal): { accepted: boolean; message: string } {
  const market = (league.market ??= emptyMarket());
  const ai = league.teams[proposal.sides[1].teamId];
  const verdict = evaluateTrade(league, proposal);
  const talk = talkRefusal(market, ai.id);
  if (talk) return { accepted: false, message: talk };
  // A league rule (cap, roster, window) isn't an offer he heard: it costs no patience.
  if (verdict.problem && !verdict.policy) return { accepted: false, message: verdict.problem };
  talksOf(market, ai.id).asks++;
  if (!verdict.accepts) {
    nudgeTrust(market, ai.id, -0.01);
    return { accepted: false, message: verdict.message };
  }
  const done = finish(league, proposal, { kind: 'user' }, ai.id);
  return { accepted: done.ok, message: done.ok ? `The ${ai.name} accepted.` : done.message };
}

// ───────── your side ─────────

export function setTradeStatus(league: League, playerId: number, status: 'untouchable' | 'listed' | null): void {
  const market = (league.market ??= emptyMarket());
  if (league.players[playerId]?.teamId !== league.userTeamId) return;
  if (status) market.status[playerId] = status;
  else delete market.status[playerId];
  // Putting him on the block answers the bids for him you let lapse: those teams may call again (a listed player's
  // call is always made). The latest you turned down keeps its wait.
  if (status === 'listed') {
    const latest = new Map<number, TradeOffer>();
    for (const o of market.offers) if (o.sides[1].players.includes(playerId)) latest.set(o.teamId, o);
    for (const [teamId, o] of latest) if (o.status === 'expired') delete market.talks[teamId]?.cooldowns[playerId];
  }
}

/**
 * *Shop a player* (FM's "offer to clubs"): every team that needs him and can afford him answers now,
 * and the three best bids on your staff's read come back as offers. Once a player a moment; it puts
 * him on the block.
 */
export function shopPlayer(league: League, playerId: number): { offers: TradeOffer[]; message: string } {
  const market = (league.market ??= emptyMarket());
  const p = league.players[playerId];
  const window = tradeWindow(league);
  if (window) return { offers: [], message: window };
  if (!p || p.teamId !== league.userTeamId) return { offers: [], message: 'He isn’t on your roster.' };
  if (market.shopped[playerId] === market.moment)
    return { offers: [], message: `You've already shopped ${p.firstName} ${p.lastName} this week.` };
  market.status[playerId] = 'listed';
  market.shopped[playerId] = market.moment;
  const ctx = tradeContext(league);
  const user = userTeam(league);
  const bids = league.teams
    .filter(
      (t) =>
        t.id !== user.id && teamNeeds(ctx, t).some((n) => n.position === p.position) && !untouchables(ctx, t).has(p.id),
    )
    .map((t) => ({ t, proposal: bidFor(ctx, t, p) }))
    .filter((x): x is { t: Team; proposal: TradeProposal } => !!x.proposal)
    .map((x) => ({ ...x, value: quickValue(ctx, user, x.proposal.sides[0]) }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 3);
  const offers = bids.map((b) => file(ctx, market, b.t, 'shop', b.proposal)).filter((o): o is TradeOffer => !!o);
  const name = `${p.firstName} ${p.lastName}`;
  return {
    offers,
    message: offers.length
      ? `${offers.length} team${offers.length > 1 ? 's' : ''} came back with an offer for ${name}.`
      : `Nobody bit on ${name} this week.`,
  };
}

/** *Ask for their price* on an AI player: what his GM would want from you ([yours, his]), or a polite no. */
export function askPrice(league: League, playerId: number): { proposal: TradeProposal | null; message: string } {
  const p = league.players[playerId];
  const window = tradeWindow(league);
  if (window) return { proposal: null, message: window };
  if (!p || p.teamId === null || p.teamId === league.userTeamId)
    return { proposal: null, message: 'He isn’t on another team.' };
  const blocker = playerTradeBlocker(league, p);
  if (blocker) return { proposal: null, message: blocker };
  const ctx = tradeContext(league);
  const seller = league.teams[p.teamId];
  if (untouchables(ctx, seller).has(p.id))
    return { proposal: null, message: `The ${seller.name} won't discuss ${p.firstName} ${p.lastName}.` };
  const proposal = askFor(ctx, seller, p);
  return proposal
    ? { proposal, message: `Here's what the ${seller.name} would want.` }
    : { proposal: null, message: `The ${seller.name} can't make this work.` };
}
