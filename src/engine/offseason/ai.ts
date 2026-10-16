/**
 * AI front offices. Decisions come from numeric GM traits plus the roster in front of them:
 * who to keep, who to tag, who to chase in free agency, and how to get under the cap.
 */
import { accelerateProration, canRestructure, capFor, capSheet, capSpace, logTransaction, releasePlayer, releasePreview, restructureOptions, restructurePlayer } from '../finance/cap';
import { capHit, isExpired, lastSeason, remainingProration, yearOf } from '../finance/contract';
import { fifthYearOptionValue, franchiseTagValue, leagueMarket, marketApy, minSalary, payTier, positionRank } from '../finance/market';
import { playerOvr, ROSTER_TEMPLATE, STARTERS } from '../positions';
import { recordRatings } from '../development';
import { generatePlayer } from '../generate';
import { clamp, type Rng } from '../rng';
import { syncDepthChart, teamPlayers } from '../roster';
import { perceive, viewCache } from '../scouting';
import type { League, Player, Position, Team } from '../types';
import { POSITIONS } from '../types';
import { contenderScore, demand, freeAgents, offerValue, rookieReserve, rosterLimit, ROSTER_MAX, signPlayer, type Offer } from './negotiation';

/** Fewest players an AI keeps at each position through cutdowns. */
export const KEEP_MIN: Record<Position, number> = { QB: 2, RB: 3, WR: 5, TE: 2, OL: 8, DT: 4, EDGE: 4, LB: 4, CB: 5, S: 3, K: 1, P: 1 };

const cushion = (league: League) => league.caps[league.season] * 0.025;

/** Room to keep for minimum deals that bring the roster to 53 once the draft class is in. */
function fillReserve(league: League, teamId: number): number {
  const picks = league.draftPicks.filter((p) => p.season === league.season && p.ownerId === teamId && p.playerId === undefined).length;
  const missing = Math.max(0, ROSTER_MAX - teamPlayers(league, teamId).length - picks);
  return missing * minSalary(1, league.caps[league.season]);
}

/** What an AI team can spend right now without starving the draft class or the bottom of the roster. */
const spendable = (league: League, teamId: number) => capSpace(league, teamId) - rookieReserve(league, teamId) - fillReserve(league, teamId) - cushion(league);

/** Overalls at each position for a team (best first), ignoring players whose deals have run out. */
function depthOvrs(league: League, teamId: number): Record<Position, number[]> {
  const out = Object.fromEntries(POSITIONS.map((p) => [p, [] as number[]])) as Record<Position, number[]>;
  for (const p of teamPlayers(league, teamId)) if (p.contract && !isExpired(p.contract, league.season)) out[p.position].push(playerOvr(p));
  for (const list of Object.values(out)) list.sort((a, b) => b - a);
  return out;
}

/** How much a player would improve a roster: a starter upgrade counts most, needed depth a little. */
export function needGain(depth: Record<Position, number[]>, player: Player, ovr = playerOvr(player)): number {
  const mine = depth[player.position];
  const starters = STARTERS[player.position];
  if (mine.length < starters) return Math.max(0.5, ovr - 6);
  const weakest = mine[starters - 1];
  if (ovr > weakest) return ovr - weakest + 0.5;
  if (mine.length < ROSTER_TEMPLATE[player.position]) return 0.3 + Math.max(0, ovr - (mine[mine.length - 1] ?? 0)) * 0.1;
  return 0;
}

/** Effective contention focus: the GM's temperament nudged by where the roster actually is. */
const winNow = (league: League, team: Team) => clamp(team.gm.winNow * 0.6 + contenderScore(league, team.id) * 0.4, 0, 1);

/** 0 when a team is near the cap, 1 when it has a third of the cap or more to spend. Rich teams overpay. */
const richness = (league: League, team: Team) => clamp((capSpace(league, team.id) - 0.08 * league.caps[league.season]) / (0.25 * league.caps[league.season]), 0, 1);

/** A GM's offer to a player, shaped by need, ambition and cap style. */
export function aiOffer(league: League, team: Team, player: Player, rng: Rng, gain: number): Offer {
  const d = demand(league, player, team.id);
  const eager = clamp(0.93 + 0.02 * Math.min(gain, 4) + 0.06 * winNow(league, team) + 0.07 * richness(league, team) + rng.float(-0.04, 0.04), 0.85, 1.12);
  const cap = league.caps[league.season];
  const apy = Math.max(minSalary(player.experience, cap), Math.round(d.market * eager));
  const years = clamp(d.askYears + (player.age >= 31 && team.gm.winNow < 0.5 ? -1 : 0), 1, 5);
  const gtdPct = clamp(d.askGtdPct * rng.float(0.85, 1.05), 0, 0.9);
  const bonusPct = gtdPct * (0.45 + 0.4 * team.gm.capAggression);
  const voidYears = team.gm.capAggression > 0.75 && apy > cap * 0.04 && years < 4 ? 1 : 0;
  return { years, apy, bonusPct, gtdPct, voidYears };
}

// ───────── re-sign window ─────────

/** Fifth-year options: exercise for players worth an above-average starter's salary. */
export function aiFifthYearOptions(league: League, team: Team): void {
  for (const p of teamPlayers(league, team.id)) {
    const c = p.contract;
    if (!c || c.fifthYearOption !== 'eligible' || lastSeason(c) !== league.season) continue;
    const tier = payTier(p.position, positionRank(leagueMarket(league), p));
    exerciseFifthYearOption(league, p, tier >= 0.45);
  }
}

export function exerciseFifthYearOption(league: League, player: Player, exercise: boolean): void {
  const c = player.contract!;
  if (c.fifthYearOption !== 'eligible') return;
  const team = league.teams[player.teamId!];
  if (!exercise) {
    c.fifthYearOption = 'declined';
    return;
  }
  const value = fifthYearOptionValue(league, player);
  // Fully guaranteed once exercised (2020 CBA).
  c.years.push({ season: lastSeason(c) + 1, base: value, guaranteed: value });
  c.years.sort((a, b) => a.season - b.season);
  c.fifthYearOption = 'exercised';
  logTransaction(league, 'option', [team.id], `${team.abbrev} exercised ${player.position} ${player.firstName} ${player.lastName}'s fifth-year option ($${(value / 1000).toFixed(1)}M)`);
}

/** One franchise tag per team per league year, for a player whose deal has run out. */
export function tagBlocker(league: League, player: Player): string | null {
  if (league.phase !== 'resign') return 'Tags are applied in the re-sign window, before free agency.';
  if (!player.contract || !isExpired(player.contract, league.season)) return 'Only players whose contracts have expired can be tagged.';
  const team = league.teams[player.teamId!];
  if (team.taggedId) return 'You have already used your franchise tag this year.';
  const value = tagValue(league, player);
  // The old deal's charge goes, but its remaining bonus money accelerates as dead money.
  const freed = capHit(player.contract, league.season) - remainingProration(player.contract, league.season);
  if (value > capSpace(league, team.id) + freed) return 'Not enough cap room for the tag.';
  return null;
}

export function tagValue(league: League, player: Player): number {
  const prior = player.contract ? (yearOf(player.contract, lastSeason(player.contract))?.base ?? 0) : 0;
  return franchiseTagValue(league, player, prior);
}

export function applyFranchiseTag(league: League, player: Player): void {
  const team = league.teams[player.teamId!];
  const value = tagValue(league, player);
  // The old deal voids: its remaining bonus money (void years included) becomes dead money now.
  accelerateProration(league, player, team.id);
  player.contract = { kind: 'tag', signedSeason: league.season, signedWeek: 0, apy: value, length: 1, years: [{ season: league.season, base: value, guaranteed: value }], bonuses: [] };
  player.tagCount = (player.tagCount ?? 0) + 1;
  team.taggedId = player.id;
  delete league.negotiations[player.id];
  logTransaction(league, 'tag', [team.id], `${team.abbrev} franchise-tagged ${player.position} ${player.firstName} ${player.lastName} ($${(value / 1000).toFixed(1)}M)`);
}

/** Expiring players a team still holds the rights to, best first. */
export function expiringPlayers(league: League, teamId: number): Player[] {
  return teamPlayers(league, teamId)
    .filter((p) => p.contract && isExpired(p.contract, league.season))
    .sort((a, b) => playerOvr(b) - playerOvr(a));
}

/** The AI's re-sign window: options, extensions for keepers, a tag for a star who won't sign. */
export function aiResignWindow(league: League, team: Team, rng: Rng): void {
  aiFifthYearOptions(league, team);
  const depth = depthOvrs(league, team.id);
  let budget = spendable(league, team.id);
  const market = leagueMarket(league);
  for (const p of expiringPlayers(league, team.id)) {
    const ovr = playerOvr(p);
    const mine = depth[p.position];
    const starterBar = mine[STARTERS[p.position] - 1] ?? 0;
    // A team knows its own players' games; their ceilings are still its scouts' judgment.
    const young = p.age <= 25 && perceive(league, team.id, p).potMid >= 12;
    const keeper = (ovr >= starterBar - 0.5 || young || mine.length < KEEP_MIN[p.position]) && p.age <= 33;
    if (!keeper) continue;
    const offer = aiOffer(league, team, p, rng, needGain(depth, p));
    offer.apy = Math.round(offer.apy * (0.96 + team.gm.loyalty * 0.08));
    const d = demand(league, p, team.id);
    // Some players want to see what the market will pay, however loyal the club.
    const testsMarket = rng.chance(0.3 * (1 - p.personality.loyalty));
    // Roughly the new deal's year-one cap hit (the bonus is spread).
    const cost = offer.apy * 0.85;
    if (!testsMarket && offerValue(league, p, team.id, offer, d) >= d.walkAway && cost <= budget) {
      signPlayer(league, p, team.id, offer);
      budget -= cost;
      mine.push(ovr);
      mine.sort((a, b) => b - a);
      continue;
    }
    const tier = payTier(p.position, positionRank(market, p));
    if (!team.taggedId && tier >= 0.75 && p.age <= 30 && rng.chance(0.35)) {
      const value = tagValue(league, p);
      if (value <= budget) {
        applyFranchiseTag(league, p);
        budget -= value;
      }
    }
  }
  aiCapCompliance(league, team);
}

// ───────── cap compliance ─────────

/**
 * Get under the cap (or to `target` room): cap-aggressive GMs restructure stars, the rest cut the
 * worst value per dollar. Deep in the red, anyone restructures and only starters are protected.
 */
export function aiCapCompliance(league: League, team: Team, target = 0): void {
  for (let guard = 0; guard < 40 && capSpace(league, team.id) < target; guard++) {
    const roster = teamPlayers(league, team.id).filter((p) => p.contract && !isExpired(p.contract, league.season));
    const desperate = capSpace(league, team.id) < target - league.caps[league.season] * 0.04;
    if (team.gm.capAggression >= 0.35 || desperate) {
      const candidate = roster
        .filter((p) => canRestructure(league, p) && restructureOptions(league, p).savings > 1_000)
        .sort((a, b) => restructureOptions(league, b).savings - restructureOptions(league, a).savings)[0];
      if (candidate) {
        restructurePlayer(league, candidate);
        continue;
      }
    }
    const counts = new Map<Position, number>();
    for (const p of roster) counts.set(p.position, (counts.get(p.position) ?? 0) + 1);
    const floor = (pos: Position) => (desperate ? STARTERS[pos] : KEEP_MIN[pos]);
    const cut = roster
      .filter((p) => (counts.get(p.position) ?? 0) > floor(p.position))
      .map((p) => ({ p, savings: releasePreview(league, p).savings }))
      .filter((x) => x.savings > 200)
      .sort((a, b) => playerOvr(a.p) / a.savings - playerOvr(b.p) / b.savings)[0];
    if (!cut) break;
    releasePlayer(league, cut.p);
  }
}

// ───────── free agency ─────────

/** One day of free agency: every AI team bids on the players it needs; each player takes his best offer if it's good enough. */
export function aiFreeAgencyDay(league: League, rng: Rng, opts: { includeUser?: boolean } = {}): number {
  const teams = league.teams.filter((t) => opts.includeUser || t.id !== league.userTeamId);
  const depth = new Map(teams.map((t) => [t.id, depthOvrs(league, t.id)]));
  const budget = new Map(teams.map((t) => [t.id, spendable(league, t.id)]));
  const room = new Map(teams.map((t) => [t.id, rosterLimit(league) - teamPlayers(league, t.id).length]));
  // Cap planning: big deals must also fit next year's books, not just this year's.
  const nextCap = capFor(league, league.season + 1) * 0.92;
  const committedNext = new Map(teams.map((t) => [t.id, capSheet(league, t.id, league.season + 1).used]));
  const signedToday = new Map<number, number>();
  const dailyLimit = new Map(teams.map((t) => [t.id, 4 + Math.round(richness(league, t) * 5)]));
  const minGain = new Map(teams.map((t) => [t.id, 0.3 - richness(league, t) * 0.2]));
  const market = leagueMarket(league);
  const pool = freeAgents(league)
    .map((p) => ({ p, value: marketApy(market, p) }))
    .sort((a, b) => b.value - a.value);
  // Each front office bids on what its own scouts see; the player's price is still his real market.
  const read = viewCache(league);
  let signings = 0;
  for (const { p } of pool) {
    let best: { team: Team; offer: Offer; value: number } | null = null;
    for (const team of teams) {
      if ((room.get(team.id) ?? 0) <= 0 || (signedToday.get(team.id) ?? 0) >= dailyLimit.get(team.id)!) continue;
      const gain = needGain(depth.get(team.id)!, p, read(team.id, p).ovr);
      if (gain < minGain.get(team.id)!) continue;
      const offer = aiOffer(league, team, p, rng, gain);
      // Year-one charge must fit; bonus spreads, so the hit is below the APY for bigger deals.
      const yearOne = offer.apy * (1 - offer.bonusPct) + (offer.apy * offer.years * offer.bonusPct) / Math.min(5, offer.years + offer.voidYears);
      if (yearOne > budget.get(team.id)!) continue;
      if (offer.years > 1 && offer.apy > 0.03 * league.caps[league.season] && committedNext.get(team.id)! + offer.apy > nextCap) continue;
      const value = offerValue(league, p, team.id, offer);
      if (!best || value > best.value) best = { team, offer, value };
    }
    if (!best || best.value < demand(league, p, best.team.id).walkAway) continue;
    const before = capSpace(league, best.team.id);
    signPlayer(league, p, best.team.id, best.offer);
    signings++;
    budget.set(best.team.id, budget.get(best.team.id)! - (before - capSpace(league, best.team.id)));
    room.set(best.team.id, room.get(best.team.id)! - 1);
    if (best.offer.years > 1) committedNext.set(best.team.id, committedNext.get(best.team.id)! + best.offer.apy);
    signedToday.set(best.team.id, (signedToday.get(best.team.id) ?? 0) + 1);
    const d = depth.get(best.team.id)![p.position];
    d.push(playerOvr(p));
    d.sort((a, b) => b - a);
  }
  return signings;
}

// ───────── training camp ─────────

/** What a team loses by cutting a player: talent, upside as its scouts project it, and any dead money it would eat. */
function keepScore(league: League, p: Player, read = viewCache(league)): number {
  const youth = p.age <= 24 ? Math.max(0, read(p.teamId!, p).potMid - playerOvr(p)) * 0.5 : 0;
  const pre = releasePreview(league, p);
  const sunk = pre.thisYear + pre.nextYear > Math.max(0, pre.savings) ? 1.5 : 0;
  const draftee = p.draft?.season === league.season && p.draft.round <= 3 ? 2 : 0;
  return playerOvr(p) + youth + sunk + draftee;
}

/** Cut down to 53, never below the positional minimums. */
export function aiCutdown(league: League, team: Team): void {
  const read = viewCache(league);
  while (teamPlayers(league, team.id).length > ROSTER_MAX) {
    const roster = teamPlayers(league, team.id);
    const counts = new Map<Position, number>();
    for (const p of roster) counts.set(p.position, (counts.get(p.position) ?? 0) + 1);
    const cut = roster
      .filter((p) => (counts.get(p.position) ?? 0) > KEEP_MIN[p.position])
      .map((p) => ({ p, score: keepScore(league, p, read) }))
      .sort((a, b) => a.score - b.score)[0]?.p;
    if (!cut) break;
    releasePlayer(league, cut);
  }
}

/** A replacement-level "street" free agent, for when the pool at a position has run dry. */
function streetFreeAgent(league: League, position: Position, rng: Rng): Player {
  const p = generatePlayer(rng, { id: league.nextPlayerId++, position, quality: clamp(rng.normal(7.5, 1.2), 4, 10), age: rng.int(24, 30), teamId: null, jerseysUsed: new Set() });
  recordRatings(p, league.season);
  league.players[p.id] = p;
  return p;
}

/** Sign the best available free agent at `position` (any position if undefined) to a one-year minimum deal. */
function signMinimum(league: League, team: Team, rng: Rng, position?: Position): boolean {
  // The best available as this front office sees him.
  let pick = freeAgents(league)
    .filter((p) => !position || p.position === position)
    .map((p) => ({ p, ovr: perceive(league, team.id, p).ovr }))
    .sort((a, b) => b.ovr - a.ovr)[0]?.p;
  if (!pick && position) pick = streetFreeAgent(league, position, rng);
  if (!pick) return false;
  const min = minSalary(pick.experience, league.caps[league.season]);
  signPlayer(league, pick, team.id, { years: 1, apy: min, bonusPct: 0, gtdPct: 0, voidYears: 0 }, 'minimum');
  return true;
}

/**
 * Training camp: fill any position below its minimum, cut to 53, then top the roster back up to
 * 53 with minimum deals, making cap room for them if needed.
 */
export function aiTrainingCamp(league: League, team: Team, rng: Rng): void {
  for (const pos of POSITIONS) {
    while (teamPlayers(league, team.id).filter((p) => p.position === pos).length < KEEP_MIN[pos]) if (!signMinimum(league, team, rng, pos)) break;
  }
  aiCutdown(league, team);
  const missing = ROSTER_MAX - teamPlayers(league, team.id).length;
  if (missing > 0) aiCapCompliance(league, team, missing * minSalary(1, league.caps[league.season]));
  while (teamPlayers(league, team.id).length < ROSTER_MAX && capSpace(league, team.id) >= minSalary(1, league.caps[league.season])) if (!signMinimum(league, team, rng)) break;
  aiCapCompliance(league, team);
  syncDepthChart(league, team);
}
