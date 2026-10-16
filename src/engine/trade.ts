/**
 * Trades: one value scale (draft-chart points) for players and picks, judged by each AI GM's
 * own lens, with the doc's anti-exploit guardrails built in (see docs/research):
 *
 * - Picks: a blend of the Jimmy Johnson (steep) and Fitzgerald-Spielberger (flat) charts by
 *   GM style, future picks discounted per year and projected from team strength, never a flat
 *   "mid-round" guess (the bad-team future-first exploit).
 * - Players: talent × age × term, plus contract surplus (market value minus cap hit); an
 *   overpaid veteran can be worth less than nothing.
 * - The AI wants a small win, stays cap-compliant, won't trade players it just signed, sends at
 *   most two picks unless it lands a star, and discounts a third QB.
 * - The trading team keeps the bonus money as dead money; the new team takes the salary.
 */
import { autoPostJune1, capSpace, isOffseason, logTransaction, paidShare, weeksPaid } from './finance/cap';
import { capHit, deadMoney, isExpired, lastSeason, yearsLeft } from './finance/contract';
import { leagueMarket, marketApy } from './finance/market';
import { freeJersey } from './generate';
import { aiCutdown } from './offseason/ai';
import { contenderScore, resetContenderCache, rosterLimit } from './offseason/negotiation';
import { playerOvr, STARTERS } from './positions';
import { perceive } from './scouting';
import { clamp, type Rng } from './rng';
import { syncDepthChart, teamPlayers, teamRatings } from './roster';
import { computeRecords, winPct } from './season/standings';
import type { DraftPick, GmTraits, League, Player, Position, Team } from './types';

/** Trades are allowed through week 9 (the NFL deadline), and all offseason. */
export const TRADE_DEADLINE_WEEK = 9;
/** Players signed this league year can't be traded until week 7. */
export const TRADE_COOLDOWN_WEEKS = 6;
export const MAX_AI_PICKS = 2;

// ───────── pick value ─────────

const JJ: [number, number][] = [
  [1, 3000], [2, 2600], [3, 2200], [4, 1800], [5, 1700], [10, 1300], [16, 1000], [20, 850], [24, 740], [28, 660],
  [32, 590], [33, 580], [48, 420], [64, 270], [96, 116], [141, 36], [200, 11], [257, 2],
];
const FS: [number, number][] = [[1, 3000], [32, 1244], [33, 1228], [141, 492], [200, 315], [257, 200]];

/** Log-linear interpolation between chart anchors. */
function chart(anchors: [number, number][], pick: number): number {
  const p = clamp(pick, 1, 257);
  for (let i = 1; i < anchors.length; i++) {
    const [x1, y1] = anchors[i];
    const [x0, y0] = anchors[i - 1];
    if (p <= x1) {
      const t = (p - x0) / (x1 - x0);
      return Math.exp(Math.log(y0) + t * (Math.log(y1) - Math.log(y0)));
    }
  }
  return anchors[anchors.length - 1][1];
}

export const jimmyJohnson = (pick: number) => chart(JJ, pick);
export const fitzgeraldSpielberger = (pick: number) => chart(FS, pick);

/** A GM's value for a pick slot: old-school GMs lean on the steep chart, analytics GMs on the flat one. */
export function pickChartValue(overall: number, gm: Pick<GmTraits, 'pickChart'>): number {
  const w = gm.pickChart === 'johnson' ? 0.8 : 0.2;
  return w * jimmyJohnson(overall) + (1 - w) * fitzgeraldSpielberger(overall);
}

/** The next draft to be held: this league year's until it happens, then next year's. */
export function nextDraftSeason(league: League): number {
  const before = league.phase === 'resign' || league.phase === 'freeAgency' || league.phase === 'draft';
  return before ? league.season : league.season + 1;
}

/** Where a team's pick is expected to land in each round (1 = first), from record and roster strength. */
export function projectedSlot(league: League, teamId: number, draftSeason: number): number {
  const strength = new Map(league.teams.map((t) => [t.id, teamRatings(league, t).overall]));
  const records = computeRecords(league);
  const played = [...records.values()].some((r) => r.w + r.l + r.t > 0);
  const score = (id: number) => {
    const r = records.get(id)!;
    const s = (strength.get(id)! - 12.5) / 2;
    return played && league.phase === 'regular' ? 0.6 * (winPct(r.w, r.l, r.t) - 0.5) * 4 + 0.4 * s : s;
  };
  const rank = league.teams.filter((t) => score(t.id) < score(teamId)).length + 1;
  // Further-out drafts regress toward the middle: rosters change.
  const yearsOut = Math.max(0, draftSeason - nextDraftSeason(league));
  return Math.round(16.5 + (rank - 16.5) * 0.6 ** yearsOut);
}

export function pickOverall(league: League, pick: DraftPick): number {
  return pick.overall ?? (pick.round - 1) * 32 + projectedSlot(league, pick.originalTeamId, pick.season);
}

/** A pick's value to `gm`: chart value at its (projected) slot, discounted per year out. */
export function pickValue(league: League, pick: DraftPick, gm: GmTraits): number {
  const yearsOut = Math.max(0, pick.season - nextDraftSeason(league));
  return pickChartValue(pickOverall(league, pick), gm) * (1 - gm.futureDiscount) ** yearsOut;
}

export const pickLabel = (league: League, pick: DraftPick) =>
  `${pick.season} round ${pick.round}${pick.overall ? ` (No. ${pick.overall})` : ` (proj. No. ${pickOverall(league, pick)})`}${pick.originalTeamId !== pick.ownerId ? ` · via ${league.teams[pick.originalTeamId].abbrev}` : ''}`;

// ───────── player value ─────────

const POSITION_TRADE: Record<Position, number> = { QB: 1, EDGE: 0.75, WR: 0.7, CB: 0.65, DT: 0.65, OL: 0.6, LB: 0.45, S: 0.45, TE: 0.45, RB: 0.4, K: 0.1, P: 0.08 };
/** Pick-chart points per $1K of contract surplus: $30K ≈ one point, so $10M a year for three years ≈ a mid first. */
const POINTS_PER_K = 1 / 30;
/**
 * A front office trusts its read of another team's player halfway, and never by more than this many
 * overall points either way. Shopping a player to 31 teams finds the one that likes him most, as it
 * should, but for at most about 20% more value, not a fantasy price. (The one exception is a player
 * right at a team's starter line, where a small misread can move him across it, either way.)
 */
const TRADE_TRUST = 0.5;
const TRADE_BAND = 0.35;

/** Talent plus half the room left to grow, for a player 25 or younger. */
const effective = (age: number, ovr: number, pot: number) => ovr + (age <= 25 ? Math.max(0, pot - ovr) * 0.5 : 0);

function ageMultiplier(p: Player): number {
  const shift = p.position === 'QB' || p.position === 'K' || p.position === 'P' ? 3 : 0;
  const a = p.age - shift;
  if (a <= 25) return 1.15;
  if (a <= 28) return 1;
  return Math.max(0.3, 1 - (a - 28) * 0.15);
}

/**
 * What a player is worth to `team` in pick-chart points, as its front office sees him. `truth`
 * values him on his real ratings instead (for tests and analysis, never for AI decisions).
 */
export function playerValue(league: League, player: Player, team: Team, opts: { truth?: boolean } = {}): number {
  const c = player.contract;
  if (!c) return 0;
  // What this front office sees: exact for its own players (bar their ceilings), its scouts' read for anyone else.
  const view = perceive(league, team.id, player);
  const trust = opts.truth ? 0 : TRADE_TRUST;
  const truth = effective(player.age, playerOvr(player), player.potential);
  const misread = clamp(trust * (effective(player.age, view.ovr, view.potMid) - truth), -TRADE_BAND, TRADE_BAND);
  // His place on their depth chart is judged the same bounded way.
  const ovr = playerOvr(player) + clamp(trust * (view.ovr - playerOvr(player)), -TRADE_BAND, TRADE_BAND);
  let base = 3000 * Math.exp((truth + misread - 18.5) * 0.55) * POSITION_TRADE[player.position] * ageMultiplier(player);
  const left = yearsLeft(c, league.season);
  base *= left <= 1 ? 0.6 : left === 2 ? 0.85 : 1;
  // Contenders pay for proven veterans; rebuilders don't.
  const winNow = clamp(team.gm.winNow * 0.6 + contenderScore(league, team.id) * 0.4, 0, 1);
  if (player.age >= 27) base *= 1 + 0.4 * (winNow - 0.5);
  // Diminishing returns: a backup is worth a fraction of a starter.
  const better = teamPlayers(league, team.id).filter((p) => p.id !== player.id && p.position === player.position && playerOvr(p) > ovr).length;
  if (better >= STARTERS[player.position]) base *= 0.35;

  // Contract surplus over (at most) the next four years, discounted 10% a year. Only base salary
  // travels in a trade (the bonus stays behind), so that's the cost the new team carries.
  const market = marketApy(leagueMarket(league), player);
  let surplus = 0;
  for (let i = 0; i < Math.min(4, left); i++) surplus += (market - (c.years.find((y) => y.season === league.season + i)?.base ?? 0)) * 0.9 ** i;
  return base + surplus * POINTS_PER_K;
}

// ───────── proposals ─────────

export interface TradeSide {
  teamId: number;
  players: number[];
  picks: number[];
}

export interface TradeProposal {
  /** sides[0] is the proposer (usually the user), sides[1] the AI partner. Each lists what that team sends. */
  sides: [TradeSide, TradeSide];
}

export function tradeWindow(league: League): string | null {
  if (league.phase === 'playoffs' || league.phase === 'complete') return 'Trades reopen when the new league year begins.';
  if (league.phase === 'regular' && league.week > TRADE_DEADLINE_WEEK) return `The trade deadline (week ${TRADE_DEADLINE_WEEK}) has passed.`;
  return null;
}

export function playerTradeBlocker(league: League, p: Player): string | null {
  if (!p.contract || isExpired(p.contract, league.season)) return 'Not under contract.';
  const c = p.contract;
  const signedThisYear = c.signedSeason === league.season && c.signedWeek >= 0 && c.kind !== 'rookie' && c.kind !== 'tag';
  const weeks = league.phase === 'regular' ? league.week - 1 - c.signedWeek : -1;
  if (signedThisYear && weeks < TRADE_COOLDOWN_WEEKS) return `Signed this year: tradable after week ${c.signedWeek + TRADE_COOLDOWN_WEEKS}.`;
  return null;
}

/** Cap space and dead money each side would have after the trade. */
export function tradeCapImpact(league: League, proposal: TradeProposal) {
  const post = autoPostJune1(league.phase);
  return proposal.sides.map((side, i) => {
    const other = proposal.sides[1 - i];
    let space = capSpace(league, side.teamId);
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

export interface TradeVerdict {
  accepts: boolean;
  /** Value the AI side receives and gives, in its own eyes. */
  get: number;
  give: number;
  /** How much more the AI needs, in points (0 when it accepts). */
  shortfall: number;
  message: string;
  /** A rule problem (cap, roster, deadline…) that no amount of value fixes. */
  problem: string | null;
}

/** Hard rule problems (either side), independent of value. `rosterCuts`: AI teams waive a backup to make room. */
export function tradeProblem(league: League, proposal: TradeProposal, opts: { rosterCuts?: boolean } = {}): string | null {
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
  const impact = tradeCapImpact(league, proposal);
  for (const [i, side] of proposal.sides.entries()) {
    const other = proposal.sides[1 - i];
    const team = league.teams[side.teamId];
    if (impact[i].space < 0) return `${team.name} would be over the cap after this trade.`;
    const size = teamPlayers(league, side.teamId).length - side.players.length + other.players.length;
    if (size > rosterLimit(league) && !opts.rosterCuts) return `${team.name} would have too many players (${size}/${rosterLimit(league)}). Release someone first.`;
    if (league.phase === 'regular') {
      const roster = teamPlayers(league, side.teamId).filter((p) => !side.players.includes(p.id)).concat(other.players.map((id) => league.players[id]));
      for (const pos of Object.keys(STARTERS) as Position[]) {
        if (roster.filter((p) => p.position === pos).length < STARTERS[pos]) return `${team.name} can't be left without enough ${pos}s in season.`;
      }
    }
  }
  return null;
}

/**
 * The AI side's verdict. Against the user it wants a small win (`margin` from its stubbornness);
 * AI-to-AI deals pass `margin: 1`, since both sides must merely not lose in their own eyes.
 */
export function evaluateTrade(league: League, proposal: TradeProposal, opts: { margin?: number; rosterCuts?: boolean } = {}): TradeVerdict {
  const [mine, theirs] = proposal.sides;
  const ai = league.teams[theirs.teamId];
  const problem = tradeProblem(league, proposal, opts);
  const get =
    mine.players.reduce((s, id) => s + playerValue(league, league.players[id], ai), 0) +
    mine.picks.reduce((s, id) => s + pickValue(league, league.draftPicks.find((p) => p.id === id)!, ai.gm), 0);
  const give =
    theirs.players.reduce((s, id) => s + playerValue(league, league.players[id], ai), 0) +
    theirs.picks.reduce((s, id) => s + pickValue(league, league.draftPicks.find((p) => p.id === id)!, ai.gm), 0);
  const margin = opts.margin ?? 1.05 + ai.gm.stubbornness * 0.15;
  const need = Math.max(give * margin, give + (opts.margin ? 0 : 25));
  if (problem) return { accepts: false, get, give, shortfall: Math.max(0, need - get), message: problem, problem };
  // Don't empty the pick cupboard unless a star comes back.
  const star = mine.players.some((id) => perceive(league, ai.id, league.players[id]).ovr >= 16);
  if (theirs.picks.length > MAX_AI_PICKS && !star) {
    const rule = `${ai.name} won't send more than ${MAX_AI_PICKS} picks unless a star comes back.`;
    return { accepts: false, get, give, shortfall: 0, message: rule, problem: rule };
  }
  if (get >= need) return { accepts: true, get, give, shortfall: 0, message: `The ${ai.name} would accept.`, problem: null };
  const gap = need - get;
  const message = gap < need * 0.12 ? 'Close. Add a little more and they’ll do it.' : gap < need * 0.4 ? 'Not enough value for them yet.' : 'They aren’t interested at that price.';
  return { accepts: false, get, give, shortfall: gap, message, problem: null };
}

/** Move the assets. The sending team books the bonus money still on each traded contract. */
export function executeTrade(league: League, proposal: TradeProposal): void {
  const post = autoPostJune1(league.phase);
  const moved: string[][] = [[], []];
  proposal.sides.forEach((side, i) => {
    const to = proposal.sides[1 - i].teamId;
    const from = league.teams[side.teamId];
    for (const id of side.players) {
      const p = league.players[id];
      const c = p.contract!;
      // Measured against this contract's own base: it may already have been cut by an earlier trade or a mid-season signing.
      const paid = paidShare(league, c);
      const split = deadMoney(c, league.season, { paid, postJune1: post, trade: true });
      const bonusNow = split.thisYear - (c.years.find((y) => y.season === league.season)?.base ?? 0) * paid;
      if (bonusNow > 0) from.deadMoney.push({ season: league.season, amount: Math.round(bonusNow), playerId: id, note: 'Traded' });
      if (split.nextYear > 0) from.deadMoney.push({ season: league.season + 1, amount: Math.round(split.nextYear), playerId: id, note: 'Traded' });
      // Salary already paid this season stays with the old team's cap; the new team takes the rest.
      if (paid > 0) {
        const y = c.years.find((x) => x.season === league.season);
        if (y) {
          from.deadMoney.push({ season: league.season, amount: Math.round(y.base * paid), playerId: id, note: 'Salary paid before trade' });
          y.base = Math.round(y.base * (1 - paid));
          y.guaranteed = Math.min(y.guaranteed, y.base);
          y.paidBefore = weeksPaid(league);
        }
      }
      c.bonuses = [];
      c.years = c.years.filter((y) => !y.void);
      p.teamId = to;
      p.jersey = freeJersey(p.position, new Set(teamPlayers(league, to).filter((x) => x.id !== id).map((x) => x.jersey)), p.jersey);
      if (league.teams[side.teamId].taggedId === id) league.teams[side.teamId].taggedId = null;
      p.tagCount = 0; // a tag by the new team is not a consecutive one
      delete league.negotiations[id];
      moved[i].push(`${p.position} ${p.firstName} ${p.lastName}`);
    }
    for (const id of side.picks) {
      const pick = league.draftPicks.find((x) => x.id === id)!;
      pick.ownerId = to;
      moved[i].push(`${pick.season} R${pick.round}${pick.overall ? ` (No. ${pick.overall})` : ''}`);
    }
  });
  for (const side of proposal.sides) syncDepthChart(league, league.teams[side.teamId]);
  const [a, b] = proposal.sides.map((s) => league.teams[s.teamId]);
  logTransaction(league, 'trade', [a.id, b.id], `${a.abbrev} traded ${moved[0].join(', ') || 'nothing'} to ${b.abbrev} for ${moved[1].join(', ') || 'nothing'}`);
}

/**
 * "What would make this work?": add the smallest of the proposer's assets that covers the
 * shortfall, or the biggest one if none does alone.
 */
export function suggestSweetener(league: League, proposal: TradeProposal): { kind: 'player' | 'pick'; id: number } | null {
  const verdict = evaluateTrade(league, proposal);
  if (verdict.accepts || verdict.problem || verdict.shortfall <= 0) return null;
  const [mine, theirs] = proposal.sides;
  const ai = league.teams[theirs.teamId];
  const options: { kind: 'player' | 'pick'; id: number; value: number }[] = [];
  for (const pick of league.draftPicks) {
    if (pick.ownerId !== mine.teamId || pick.playerId !== undefined || mine.picks.includes(pick.id)) continue;
    options.push({ kind: 'pick', id: pick.id, value: pickValue(league, pick, ai.gm) });
  }
  for (const p of teamPlayers(league, mine.teamId)) {
    if (mine.players.includes(p.id) || playerTradeBlocker(league, p)) continue;
    const v = playerValue(league, p, ai);
    if (v > 0) options.push({ kind: 'player', id: p.id, value: v });
  }
  // Only additions that keep the deal legal (a player can overflow their roster; a pick can't).
  const legal = options
    .filter((o) => {
      const side = { ...mine, players: o.kind === 'player' ? [...mine.players, o.id] : mine.players, picks: o.kind === 'pick' ? [...mine.picks, o.id] : mine.picks };
      return !tradeProblem(league, { sides: [side, theirs] });
    })
    .sort((x, y) => x.value - y.value);
  const pick = legal.find((o) => o.value >= verdict.shortfall) ?? legal[legal.length - 1];
  return pick ? { kind: pick.kind, id: pick.id } : null;
}

// ───────── AI-to-AI trades ─────────

/**
 * A weekly market: contenders look for veteran starters from rebuilders and pay in picks.
 * Neither GM may lose value in its own eyes. Returns the trades made.
 */
export function aiTradeWeek(league: League, rng: Rng): TradeProposal[] {
  const made: TradeProposal[] = [];
  if (tradeWindow(league)) return made;
  resetContenderCache(league);
  for (let attempt = 0; attempt < 3; attempt++) {
    if (!rng.chance(0.5)) continue;
    const t = aiTradeAttempt(league, rng);
    if (t) made.push(t);
  }
  return made;
}

function aiTradeAttempt(league: League, rng: Rng): TradeProposal | null {
  const teams = league.teams.filter((t) => t.id !== league.userTeamId);
  const buyers = teams.filter((t) => contenderScore(league, t.id) >= 0.6 && t.gm.winNow >= 0.45 && capSpace(league, t.id) > 0.02 * league.caps[league.season]);
  const sellers = teams.filter((t) => contenderScore(league, t.id) <= 0.4);
  if (!buyers.length || !sellers.length) return null;
  const buyer = rng.pick(buyers);
  const seller = rng.pick(sellers);
  // A veteran starter on a short deal who would start for the buyer.
  const buyerDepth = teamPlayers(league, buyer.id);
  // The buyer shops on its own scouts' read of the seller's players.
  const seen = (p: Player) => perceive(league, buyer.id, p).ovr;
  const wouldStart = (p: Player) => buyerDepth.filter((x) => x.position === p.position && playerOvr(x) >= seen(p)).length < STARTERS[p.position];
  const targets = teamPlayers(league, seller.id).filter((p) => p.age >= 26 && seen(p) >= 13 && !playerTradeBlocker(league, p) && lastSeason(p.contract!) <= league.season + 1 && wouldStart(p));
  if (!targets.length) return null;
  const target = rng.pick(targets);
  const picks = league.draftPicks.filter((p) => p.ownerId === buyer.id && p.playerId === undefined).sort((a, b) => pickValue(league, b, seller.gm) - pickValue(league, a, seller.gm));
  // Offer the cheapest single pick (or pair) the seller would take.
  const want = playerValue(league, target, seller);
  const combos = [...picks.map((p) => [p]), ...picks.slice(0, 7).flatMap((p, i) => picks.slice(i + 1, 7).map((q) => [p, q]))]
    .map((combo) => ({ combo, value: combo.reduce((s, p) => s + pickValue(league, p, seller.gm), 0) }))
    .filter((x) => x.value >= want)
    .sort((x, y) => x.value - y.value);
  for (const { combo } of combos.slice(0, 5)) {
    const proposal: TradeProposal = { sides: [{ teamId: buyer.id, players: [], picks: combo.map((p) => p.id) }, { teamId: seller.id, players: [target.id], picks: [] }] };
    if (!evaluateTrade(league, proposal, { margin: 1, rosterCuts: true }).accepts) continue;
    // The buyer must like it too.
    const mirrored: TradeProposal = { sides: [proposal.sides[1], proposal.sides[0]] };
    if (!evaluateTrade(league, mirrored, { margin: 1, rosterCuts: true }).accepts) continue;
    executeTrade(league, proposal);
    aiCutdown(league, buyer);
    return proposal;
  }
  return null;
}

export const isTradeSeason = (league: League) => !tradeWindow(league) && (league.phase === 'regular' || isOffseason(league.phase));
