/**
 * The AI trade market (docs/TRADES.md, "The market"). It runs at the NFL's moments: when the league
 * year opens, each free-agency day, in camp, after each week's games up to the deadline, and on
 * deadline day, the busiest of them. At each moment a few GMs pick up the phone, how many set by the
 * moment, each GM's appetite for dealing, how sure his team is of what it is, and how badly it needs
 * something:
 *
 * - buyers (contenders, bubble teams) go after the block players they've been watching;
 * - sellers (retoolers, rebuilders) shop their block to the teams that need each player;
 * - a team squeezed against the cap pays to move a bad contract when the league year opens.
 *
 * Every deal is judged by both GMs with `judge`; AI teams never trade with you here: what they want
 * from you comes as offers to your desk (`offers.ts`). The market draws from its own stream, like
 * injuries and weather.
 */
import { capSpace, logTransaction } from '../finance/cap';
import { departmentFor } from '../medical';
import { aiCutdown, capCut, cutChoice } from '../offseason/ai';
import { resetContenderCache, rosterLimit, ROSTER_MAX } from '../offseason/negotiation';
import { clamp, Rng } from '../rng';
import { activeRoster } from '../roster';
import type { League, Physical, Player, Rumor, Team, TradeMarket, TradeRecord } from '../types';
import { ovrOf, refreshAfterTrade, tradeContext, type TradeContext } from './context';
import { dealFor, dumpFor, lateSale, pickSwapFor, priceable, type Deal } from './deals';
import { emptyMarket, executeTrade } from './execute';
import { judge } from './judge';
import { offersMoment, yourListings } from './offers';
import { lowerPrice, physicals, worstResult } from './physicals';
import {
  interestIn,
  isBuyer,
  stanceOf,
  stanceScore,
  teamNeeds,
  tradeBlock,
  updateInterest,
  updateStances,
  wanted,
  type BlockEntry,
} from './plans';
import { playerTradeBlocker, tradeWindow, TRADE_DEADLINE_WEEK, type TradeProposal } from './rules';
import { settleTalks } from './talks';
import { marketValue, salaryWeight } from './value';

export type Moment = 'leagueYear' | 'faDay' | 'camp' | 'week' | 'deadline';

/** How busy each moment is against an ordinary early-season week (weeks 7–8 run at twice it). */
const MOMENT_ACTIVITY: Record<Moment, number> = { leagueYear: 2, faDay: 0.5, camp: 1.2, week: 0.35, deadline: 4.5 };

/** The one league-wide knob, tuned so the market lands on the NFL's volumes (`npm run trades`). */
export const TRADE_VOLUME = 0.28;

/** A GM's appetite for dealing, by archetype: deal-makers call, hard-liners sit tight. */
const ARCHETYPE_ACTIVITY: Record<string, number> = {
  'All-In': 0.85,
  'Pick Hoarder': 0.7,
  'Cap Magician': 0.6,
  'Can-Kicker': 0.6,
  Balanced: 0.5,
  'Draft and Develop': 0.4,
  'Hard-Liner': 0.25,
};

/** Each GM's own appetite: his archetype's, jittered per team from the league seed (not stored, like the owner's trigger). */
export function gmActivity(league: League, team: Team): number {
  return clamp(
    (ARCHETYPE_ACTIVITY[team.gm.archetype] ?? 0.5) + new Rng(`${league.seed}:gm-activity:${team.id}`).normal(0, 0.08),
    0.05,
    1,
  );
}

/** Most trades a team makes in a regular season (an All-In GM one more), and in a whole league year. */
const SEASON_CAP = 3;
const YEAR_CAP = 6;

/** Deals too small to count against a front office's limits: a pick swap, a late pick for a player it was cutting. */
export const MINOR = new Set<TradeRecord['kind']>(['futureSwap', 'cutdown', 'casualty', 'draft']);

function capped(league: League, market: TradeMarket, team: Team): boolean {
  const mine = market.history.filter(
    (r) => r.season === league.season && !MINOR.has(r.kind) && r.sides.some((s) => s.teamId === team.id),
  );
  const inSeason = mine.filter((r) => r.phase === 'regular').length;
  return (
    mine.length >= YEAR_CAP ||
    (league.phase === 'regular' && inSeason >= SEASON_CAP + (team.gm.archetype === 'All-In' ? 1 : 0))
  );
}

type Listing = { team: Team; entry: BlockEntry };

/** One GM's call: what he buys, sells or dumps, or nothing that both sides take. */
export function initiate(
  ctx: TradeContext,
  market: TradeMarket,
  team: Team,
  moment: Moment,
  listings: readonly Listing[],
  open: (t: Team) => boolean,
): Deal | null {
  const { league } = ctx;
  const ai = league.teams.filter((t) => t.id !== league.userTeamId && t.id !== team.id && open(t));
  // A squeezed team clears its bad contract before it shops.
  if (moment === 'leagueYear') {
    const dump = dumpCall(ctx, market, team, ai);
    if (dump) return dump;
  }
  if (isBuyer(team)) {
    // In an ordinary week a team asks around before it deals; at the deadline and in the offseason it moves at once.
    const threshold = moment === 'week' ? 2 : 1;
    // A call tries three players, so none of them is one nobody can price.
    const targets = wanted(ctx, team, listings, { memo: true }).filter(
      (w) => open(w.team) && interestIn(market, team.id, w.player.id) >= threshold && priceable(ctx, w.player),
    );
    for (const t of targets.slice(0, 3)) {
      const deal = dealFor(ctx, team, t.player);
      if (deal) return deal;
    }
  } else {
    // A seller calls the teams that would want each of his players: buyers, and retoolers for a young one.
    for (const entry of tradeBlock(ctx, team)
      .filter((e) => priceable(ctx, league.players[e.playerId]))
      .slice(0, 3)) {
      const player = league.players[entry.playerId];
      const buyers = ai
        .filter((b) => isBuyer(b) || (stanceOf(b) === 'retool' && player.age <= 25))
        .map((b) => ({ b, w: wanted(ctx, b, [{ team, entry }])[0] }))
        .filter((x) => x.w)
        // Teams that have been asking first, division rivals last.
        .sort(
          (x, y) =>
            Number(x.b.division === team.division) - Number(y.b.division === team.division) ||
            interestIn(market, y.b.id, player.id) - interestIn(market, x.b.id, player.id) ||
            y.w.score - x.w.score,
        )
        .slice(0, 3);
      for (const { b } of buyers) {
        const deal = dealFor(ctx, b, player);
        if (deal) return deal;
      }
    }
  }
  // Before the draft a GM who wants help now trades next year's pick for this year's.
  if (moment === 'leagueYear' || moment === 'faDay') {
    const swap = pickSwapFor(ctx, team, ai);
    if (swap) return swap;
  }
  return null;
}

/**
 * A team truly squeezed moves a bad contract when the league year opens, before the money's
 * guaranteed. After that the rest are cut, not traded, and in season it lives with them.
 * One a league year: a front office clears its worst contract, not its whole cap sheet.
 */
function dumpCall(ctx: TradeContext, market: TradeMarket, team: Team, among: readonly Team[]): Deal | null {
  const { league } = ctx;
  if (salaryWeight(ctx, team.id) < 1.6) return null;
  if (market.history.some((r) => r.kind === 'dump' && r.season === league.season && r.sides[0].teamId === team.id))
    return null;
  for (const entry of tradeBlock(ctx, team)
    .filter((e) => e.reason === 'overpaid')
    .slice(0, 2)) {
    const deal = dumpFor(ctx, team, league.players[entry.playerId], among);
    if (deal) return deal;
  }
  return null;
}

/** Trades a team makes in one moment: on deadline day a seller moves a second player. */
const perMoment = (moment: Moment) => (moment === 'deadline' ? 2 : 1);

/** A team the market can still deal with this moment: not the user's, not one done for the moment, not at its limit. */
function opener(league: League, market: TradeMarket, busy: ReadonlyMap<number, number>, moment: Moment) {
  return (t: Team) =>
    t.id !== league.userTeamId && (busy.get(t.id) ?? 0) < perMoment(moment) && !capped(league, market, t);
}

/** Run one market moment: stances, plans, interest, the calls, rumors. Returns the trades made. */
export function marketMoment(league: League, moment: Moment): TradeRecord[] {
  if (tradeWindow(league)) return [];
  const market = (league.market ??= emptyMarket());
  market.moment++;
  resetContenderCache(league);
  const rng = new Rng(`${league.seed}:market:${league.season}:${league.phase}:${league.week}:${league.faDay}`);
  const ai = league.teams.filter((t) => t.id !== league.userTeamId);
  const ctx = tradeContext(league);
  updateStances(ctx);
  const listingsOf = (c: TradeContext) => ai.flatMap((t) => tradeBlock(c, t).map((entry) => ({ team: t, entry })));
  let listings = listingsOf(ctx);
  settleTalks(market);
  updateInterest(ctx, market, ai, listings, yourListings(ctx));

  const made: TradeRecord[] = [];
  const busy = new Map<number, number>();
  const open = opener(league, market, busy, moment);
  const pace = MOMENT_ACTIVITY[moment] * (moment === 'week' && league.week >= 7 ? 2 : 1);
  // Deadline day is a day of calls: every GM gets a second round.
  const calls = Array.from({ length: perMoment(moment) }, () => rng.shuffle([...ai])).flat();
  for (const team of calls) {
    if (!open(team)) continue;
    const urgency = teamNeeds(ctx, team)[0]?.urgency ?? 0;
    const sure = Math.abs(stanceScore(ctx, team));
    const p = TRADE_VOLUME * pace * (0.4 + 0.9 * gmActivity(league, team)) * (0.6 + 0.8 * sure) * (0.5 + urgency);
    if (!rng.chance(Math.min(1, p))) continue;
    const deal = initiate(ctx, market, team, moment, listings, open);
    if (!deal) continue;
    const record = close(ctx, deal, busy);
    if (!record) continue;
    made.push(record);
    listings = listingsOf(ctx);
  }
  // Before the AI lets players go, it calls around about the best of them.
  if (moment === 'leagueYear' || moment === 'camp') {
    made.push(...beforeCuts(ctx, moment, rng.shuffle([...ai]), open, busy));
    listings = listingsOf(ctx);
  }
  // Then the calls to you, on what's left after the AI market's deals.
  offersMoment(ctx, market, moment, listings);
  writeRumors(ctx, market, listings);
  return made;
}

/**
 * An agreed deal through its physicals (a failure calls it off, concerns reopen the price) and into
 * the books. Both teams have dealt this moment either way. Null if the physicals called it off.
 */
function close(ctx: TradeContext, deal: Deal, busy: Map<number, number>): TradeRecord | null {
  const { league } = ctx;
  const exams = physicals(league, deal.proposal);
  const proposal = afterPhysicals(ctx, deal.proposal, exams);
  for (const side of deal.proposal.sides) busy.set(side.teamId, (busy.get(side.teamId) ?? 0) + 1);
  if (!proposal) return null;
  dealWatch.onClose?.(ctx, deal, proposal);
  const record = executeTrade(league, proposal, { kind: deal.kind, tag: deal.tag, physicals: exams });
  // A team over the limit waives a backup, as `judge` priced in (`rosterCuts`).
  for (const side of proposal.sides) aiCutdown(league, league.teams[side.teamId], rosterLimit(league));
  // A trade changes the two teams' rosters, needs and blocks; everyone else's reads still hold.
  refreshAfterTrade(
    ctx,
    proposal.sides.map((x) => x.teamId),
    proposal.sides.flatMap((x) => x.players),
  );
  return record;
}

/**
 * A window on every AI deal as it closes, in the market's own pass and before anything moves: the
 * trades check reads both GMs' eyes here (`npm run trades`, "No cheese"). Nothing in the game sets it.
 */
export const dealWatch: { onClose?: (ctx: TradeContext, deal: Deal, proposal: TradeProposal) => void } = {};

// ───────── before the cuts ─────────

/** The players a team calls around about before the cut to 53: the best few it's letting go. */
const CUT_CALLS = 3;

/**
 * Before an AI front office lets a player go, it calls around: about its cap casualties when the
 * league year opens (before `aiCapCompliance` releases them in the re-sign window), and about the
 * best of its cuts in camp (before `aiCutdown` takes the roster to 53). A team that would keep him
 * gives a 6th or 7th; a cap casualty nobody wants goes as a dump when the guarantees a release would
 * leave on the books are worth more to his team than the pick it pays. One such deal a team.
 */
function beforeCuts(
  ctx: TradeContext,
  moment: 'leagueYear' | 'camp',
  order: readonly Team[],
  open: (t: Team) => boolean,
  busy: Map<number, number>,
): TradeRecord[] {
  const { league } = ctx;
  const made: TradeRecord[] = [];
  for (const team of order) {
    if (!open(team)) continue;
    const buyers = order.filter((t) => t.id !== team.id && open(t));
    let deal: Deal | null = null;
    if (moment === 'leagueYear') {
      const room = capSpace(league, team.id);
      const p = room < 0 ? capCut(league, team, room < -league.caps[league.season] * 0.04) : null;
      if (p && !playerTradeBlocker(league, p))
        deal = lateSale(ctx, team, p, buyers, 'casualty') ?? dumpFor(ctx, team, p, buyers, { releasing: true });
    } else {
      const cuts = cutChoice(league, activeRoster(league, team.id), ROSTER_MAX)
        .filter((p) => p.contract && !p.injury && !playerTradeBlocker(league, p))
        .sort((a, b) => ovrOf(ctx, b) - ovrOf(ctx, a))
        .slice(0, CUT_CALLS);
      // He has to make the buyer's own 53, or it would only be passing on the cut.
      const keeps = (p: Player) => (b: Team) =>
        !cutChoice(league, [...activeRoster(league, b.id), p], ROSTER_MAX).includes(p);
      for (const p of cuts) if ((deal = lateSale(ctx, team, p, buyers, 'cutdown', keeps(p)))) break;
    }
    const record = deal && close(ctx, deal, busy);
    if (record) made.push(record);
  }
  return made;
}

// ───────── physicals ─────────

/** A buyer with a strong physio, or one that badly needs the player, takes him with concerns at the old price. */
const BRAVE_PHYSIO = 14;
const BRAVE_NEED = 0.6;

/**
 * What happens to an AI deal after its physicals: the deal as agreed, a lower price after concerns,
 * or null when it's off (a failed physical, or concerns nobody would live with), told in the news.
 */
function afterPhysicals(ctx: TradeContext, proposal: TradeProposal, exams: readonly Physical[]): TradeProposal | null {
  const { league } = ctx;
  const result = worstResult(exams);
  if (result === 'passed' || result === 'rehab') return proposal;
  const flagged = exams.find((e) => e.result === result)!;
  const p = league.players[flagged.playerId];
  const sellerSide = proposal.sides.find((s) => s.players.includes(p.id))!;
  const buyer = league.teams[proposal.sides.find((s) => s !== sellerSide)!.teamId];
  const off = (why: string) => {
    logTransaction(
      league,
      'medical',
      proposal.sides.map((s) => s.teamId),
      `The ${buyer.name}' trade for ${p.position} ${p.firstName} ${p.lastName} is off ${why}.`,
    );
    return null;
  };
  if (result === 'failed') return off('after a failed physical');
  // Concerns: the buyer asks for a lower price (Duane Brown, 2017): a pick of his dropped, or a late one of the seller's back.
  const lower = lowerPrice(ctx, proposal, buyer.id);
  if (lower && judge(ctx, sellerSide.teamId, lower, { rosterCuts: true }).accepts) return lower;
  const urgent = teamNeeds(ctx, buyer).find((n) => n.position === p.position)?.urgency ?? 0;
  if (departmentFor(league, buyer.id).physio >= BRAVE_PHYSIO || urgent >= BRAVE_NEED) return proposal;
  return off('after the physical raised concerns');
}

// ───────── rumors ─────────

/** Rumors kept: the latest ones, enough for a season's talk. */
const KEEP_RUMORS = 80;
/** Only names worth talking about: about a mid-round pick's worth or more to the team that has him. */
const NOTABLE = 250;

const fullName = (league: League, id: number) =>
  `${league.players[id].position} ${league.players[id].firstName} ${league.players[id].lastName}`;
const teamName = (t: Team) => `${t.city} ${t.name}`;

/** Public talk from what front offices are really doing: who's shopping whom, who's been asking about whom. */
function writeRumors(ctx: TradeContext, market: TradeMarket, listings: readonly Listing[]): void {
  const { league } = ctx;
  const said = new Set(market.rumors.filter((r) => r.season === league.season).map((r) => r.id));
  const fresh: Rumor[] = [];
  const add = (r: Omit<Rumor, 'season' | 'phase' | 'week'>) => {
    if (said.has(r.id) || fresh.some((x) => x.id === r.id)) return;
    fresh.push({ ...r, season: league.season, phase: league.phase, week: league.week });
  };
  listings
    .filter((l) => l.entry.keenness >= 0.6 && league.players[l.entry.playerId]?.teamId === l.team.id)
    .map((l) => ({ ...l, worth: marketValue(ctx, l.team, league.players[l.entry.playerId]) }))
    .filter((l) => l.worth >= NOTABLE)
    .sort((a, b) => b.worth - a.worth)
    .slice(0, 2)
    .forEach((l) =>
      add({
        id: `shopping:${league.season}:${l.team.id}:${l.entry.playerId}`,
        kind: 'shopping',
        teamIds: [l.team.id],
        playerId: l.entry.playerId,
        text: `League sources say the ${teamName(l.team)} are shopping ${fullName(league, l.entry.playerId)}.`,
      }),
    );
  market.interest
    .filter((x) => x.level >= 2 && x.at === market.moment)
    .map((x) => ({ x, p: league.players[x.playerId] }))
    .filter(({ p }) => p?.teamId !== null && p.teamId !== league.userTeamId)
    .map(({ x, p }) => ({ x, p, worth: marketValue(ctx, league.teams[p.teamId!], p) }))
    .filter((y) => y.worth >= NOTABLE)
    .sort((a, b) => b.worth - a.worth)
    .slice(0, 2)
    .forEach(({ x, p }) =>
      add({
        id: `interest:${league.season}:${x.teamId}:${p.id}`,
        kind: 'interest',
        teamIds: [x.teamId, p.teamId!],
        playerId: p.id,
        text: `The ${teamName(league.teams[x.teamId])} have been asking the ${league.teams[p.teamId!].name} about ${fullName(league, p.id)}.`,
      }),
    );
  market.rumors = [...market.rumors, ...fresh].slice(-KEEP_RUMORS);
}

/** The market moment after a week's games: deadline day after week 9, an ordinary week before it. */
export const weekMoment = (league: League): Moment => (league.week === TRADE_DEADLINE_WEEK ? 'deadline' : 'week');
