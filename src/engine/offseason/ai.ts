/**
 * AI front offices. Decisions come from numeric GM traits plus the roster in front of them:
 * who to keep, who to tag, who to chase in free agency, and how to get under the cap.
 */
import { ageShift, PEAK_END } from '../aging';
import {
  accelerateProration,
  canRestructure,
  capFor,
  capSheet,
  capSpace,
  logTransaction,
  releasePlayer,
  releasePreview,
  restructureOptions,
  restructurePlayer,
} from '../finance/cap';
import { capHit, futureProration, isExpired, lastSeason, remainingProration, yearOf } from '../finance/contract';
import {
  fifthYearOptionValue,
  franchiseTagValue,
  leagueMarket,
  marketApy,
  maxBonusShare,
  minSalary,
  payTier,
  positionRank,
  topMinimum,
} from '../finance/market';
import { playerOvr, ROSTER_TEMPLATE, STARTERS } from '../positions';
import { recordRatings } from '../development';
import { teamOutlook } from '../outlook';
import { generatePlayer } from '../generate';
import { clamp, Rng } from '../rng';
import { activeRoster, syncDepthChart, teamPlayers } from '../roster';
import { characterRead, perceive, projectedCeiling, quirkWorth, viewCache } from '../scouting';
import type { League, Player, Position, Team } from '../types';
import { POSITIONS } from '../types';
import {
  contenderScore,
  demand,
  freeAgents,
  offerCharge,
  offerProblem,
  offerValue,
  rookieReserve,
  rosterLimit,
  ROSTER_MAX,
  signPlayer,
  willExtend,
  type Offer,
} from './negotiation';

/** Fewest players an AI keeps at each position through cutdowns. */
export const KEEP_MIN: Record<Position, number> = {
  QB: 2,
  RB: 3,
  WR: 5,
  TE: 2,
  OL: 8,
  DT: 4,
  EDGE: 4,
  LB: 4,
  CB: 5,
  S: 3,
  K: 1,
  P: 1,
};

/**
 * Most players an AI carries at a position on the 53: one kicker and one punter, as every NFL team opened
 * 2019-2025 (nflverse week-1 rosters, 0 of 224 with two). A second one, kept on his overall or signed as the
 * best man left, is a roster spot no team spends, and it kept old specialists in work long past the NFL's.
 */
const KEEP_MAX: Partial<Record<Position, number>> = { K: 1, P: 1 };
const surplus = (pos: Position, count: number) => count > (KEEP_MAX[pos] ?? Infinity);

/**
 * Room an AI front office plans to carry into the season, as a share of the cap: for injury signings and deadline
 * deals, which otherwise find every buyer spent to the dollar. NFL clubs carried 4.1% of the cap into 2025 on
 * average (median 2.3%) after a season of using it. A cap-aggressive GM keeps less of it, a careful one more.
 */
export const IN_SEASON_RESERVE = 0.03;
export const inSeasonReserve = (league: League, teamId: number) =>
  league.caps[league.season] * IN_SEASON_RESERVE * (1.5 - league.teams[teamId].gm.capAggression);

/**
 * Spots on the 53 still open once the draft class is in. Only players signed for the league year fill one: in the
 * re-sign window an expiring player is still on the roster, but his spot is open until he signs (a team that let 28
 * walk read as nearly full, spent their replacements' room on re-signs, and paid for 22 minimum deals at camp out of
 * the room it planned to carry into the season).
 */
function openSpots(league: League, teamId: number): number {
  const picks = league.draftPicks.filter(
    (p) => p.season === league.season && p.ownerId === teamId && p.playerId === undefined,
  ).length;
  const signed = activeRoster(league, teamId).filter((p) => p.contract && !isExpired(p.contract, league.season));
  return Math.max(0, ROSTER_MAX - signed.length - picks);
}

/**
 * Room to keep for the minimum deals that fill the open spots. Camp signs the best free agents left, mostly veterans
 * on a veteran's minimum (1.27-1.30x a second-year player's on 'offseason-audit'), so each spot is kept at the highest
 * minimum, which covers any of them; kept at the second-year minimum, a team with twenty spots to fill paid the
 * difference out of its in-season room.
 */
const fillReserve = (league: League, teamId: number) =>
  openSpots(league, teamId) * topMinimum(league.caps[league.season]);

/**
 * Void-year money the deals running out still owe past this league year's slice. In the re-sign window the cap sheet
 * charges only the slice; the rest lands at once as dead money when free agency opens (`accelerateProration`), after
 * the window has spent the room: a team that let two such deals walk was $8M short of what it planned to keep.
 */
const voidReserve = (league: League, teamId: number) =>
  league.phase !== 'resign'
    ? 0
    : teamPlayers(league, teamId)
        .filter((p) => p.contract && isExpired(p.contract, league.season))
        .reduce((sum, p) => sum + futureProration(p.contract!, league.season), 0);

/** What an AI team can spend right now without starving the draft class or the bottom of the roster. */
export const spendable = (league: League, teamId: number) =>
  capSpace(league, teamId) -
  rookieReserve(league, teamId) -
  fillReserve(league, teamId) -
  inSeasonReserve(league, teamId) -
  voidReserve(league, teamId);

/**
 * Each position's outlooks for a team (best first; `outlook.ts`), ignoring players whose deals have
 * run out: where its room is headed, so a signing has to beat that, not just this year's overall.
 */
function depthOutlooks(league: League, team: Team): Record<Position, number[]> {
  const out = Object.fromEntries(POSITIONS.map((p) => [p, [] as number[]])) as Record<Position, number[]>;
  const wn = winNow(league, team);
  for (const p of teamPlayers(league, team.id))
    if (p.contract && !isExpired(p.contract, league.season)) out[p.position].push(teamOutlook(league, team.id, p, wn));
  for (const list of Object.values(out)) list.sort((a, b) => b - a);
  return out;
}

/**
 * How much a player would improve a roster: a starter upgrade counts most, needed depth a little.
 * `depth` and `ovr` are outlooks (`depthOutlooks`), so it's an upgrade on where the room is headed.
 */
export function needGain(depth: Record<Position, number[]>, player: Player, ovr = playerOvr(player)): number {
  const mine = depth[player.position];
  const starters = STARTERS[player.position];
  if (mine.length < starters) return Math.max(0.5, ovr - 6);
  const weakest = mine[starters - 1];
  if (ovr > weakest) return ovr - weakest + 0.5;
  if (mine.length < ROSTER_TEMPLATE[player.position])
    return 0.3 + Math.max(0, ovr - (mine[mine.length - 1] ?? 0)) * 0.1;
  return 0;
}

/** Effective contention focus: the GM's temperament nudged by where the roster actually is. */
const winNow = (league: League, team: Team) =>
  clamp(team.gm.winNow * 0.6 + contenderScore(league, team.id) * 0.4, 0, 1);

/** 0 when a team is near the cap, 1 when it has a third of the cap or more to spend. Rich teams overpay. */
const richness = (league: League, team: Team) =>
  clamp((capSpace(league, team.id) - 0.08 * league.caps[league.season]) / (0.25 * league.caps[league.season]), 0, 1);

/** A GM's offer to a player, shaped by need, ambition and cap style. */
export function aiOffer(league: League, team: Team, player: Player, rng: Rng, gain: number): Offer {
  const d = demand(league, player, team.id);
  const eager = clamp(
    0.93 +
      0.02 * Math.min(gain, 4) +
      0.06 * winNow(league, team) +
      0.07 * richness(league, team) +
      rng.float(-0.04, 0.04),
    0.85,
    1.12,
  );
  const cap = league.caps[league.season];
  const apy = Math.max(minSalary(player.experience, cap), Math.round(d.market * eager));
  // Ages read on the position's clock: a 33-year-old quarterback is a 29-year-old receiver.
  const years = clamp(
    d.askYears + (player.age - ageShift(player.position) >= 31 && team.gm.winNow < 0.5 ? -1 : 0),
    1,
    5,
  );
  const gtdPct = clamp(d.askGtdPct * rng.float(0.85, 1.05), 0, 0.9);
  const bonusPct = Math.min(gtdPct * (0.45 + 0.4 * team.gm.capAggression), maxBonusShare(team.gm.capAggression));
  const voidYears = team.gm.capAggression > 0.75 && apy > cap * 0.04 && years < 4 ? 1 : 0;
  return { years, apy, bonusPct, gtdPct, voidYears };
}

// ───────── re-sign window ─────────

/** How far below the room's last starter (outlook) a player can sit and still be planned as one: a job battle. */
const BATTLE = 0.25;

/**
 * Fifth-year options: exercise for players worth an above-average starter's salary who will start
 * here, or whom the club can carry next year anyway (an asset to trade). A guaranteed starter's
 * salary for a backup on a full cap is how a club ends up selling him for what it can get.
 */
export function aiFifthYearOptions(league: League, team: Team): void {
  const wn = winNow(league, team);
  for (const p of teamPlayers(league, team.id)) {
    const c = p.contract;
    if (!c || c.fifthYearOption !== 'eligible' || lastSeason(c) !== league.season) continue;
    const tier = payTier(p.position, positionRank(leagueMarket(league), p));
    if (tier < 0.45) {
      exerciseFifthYearOption(league, p, false);
      continue;
    }
    // Who else is signed through the option year at his position, by where they're headed.
    const others = teamPlayers(league, team.id)
      .filter((q) => q !== p && q.position === p.position && q.contract && lastSeason(q.contract) > league.season)
      .map((q) => teamOutlook(league, team.id, q, wn))
      .sort((a, b) => b - a);
    const bar = others[STARTERS[p.position] - 1] ?? -Infinity;
    const starts = teamOutlook(league, team.id, p, wn) >= bar - BATTLE;
    const room = capSheet(league, team.id, league.season + 1).space - fifthYearOptionValue(league, p);
    exerciseFifthYearOption(league, p, starts || room >= 0.05 * capFor(league, league.season + 1));
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
  logTransaction(
    league,
    'option',
    [team.id],
    `${team.abbrev} exercised ${player.position} ${player.firstName} ${player.lastName}'s fifth-year option ($${(value / 1000).toFixed(1)}M)`,
  );
}

/** One franchise tag per team per league year, for a player whose deal has run out. */
export function tagBlocker(league: League, player: Player): string | null {
  if (league.phase !== 'resign') return 'Tags are applied in the re-sign window, before free agency.';
  if (!player.contract || !isExpired(player.contract, league.season))
    return 'Only players whose contracts have expired can be tagged.';
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
  player.contract = {
    kind: 'tag',
    signedSeason: league.season,
    signedWeek: 0,
    apy: value,
    length: 1,
    years: [{ season: league.season, base: value, guaranteed: value }],
    bonuses: [],
  };
  player.tagCount = (player.tagCount ?? 0) + 1;
  team.taggedId = player.id;
  delete league.negotiations[player.id];
  logTransaction(
    league,
    'tag',
    [team.id],
    `${team.abbrev} franchise-tagged ${player.position} ${player.firstName} ${player.lastName} ($${(value / 1000).toFixed(1)}M)`,
  );
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
  const depth = depthOutlooks(league, team);
  const wn = winNow(league, team);
  const market = leagueMarket(league);
  // What a re-sign may cost: what the team can spend, plus the minimum deal it keeps for his spot while it's open.
  const budget = () =>
    spendable(league, team.id) + (openSpots(league, team.id) > 0 ? topMinimum(league.caps[league.season]) : 0);
  for (const p of expiringPlayers(league, team.id)) {
    const ovr = playerOvr(p);
    // Kept on where he's headed: a fading veteran has to beat the room's future, a climbing one is worth his raise.
    const ahead = teamOutlook(league, team.id, p, wn);
    const mine = depth[p.position];
    const starterBar = mine[STARTERS[p.position] - 1] ?? 0;
    // A team knows its own players' games; their ceilings are still its scouts' judgment.
    const view = p.age <= 25 ? perceive(league, team.id, p) : null;
    const young = !!view && projectedCeiling(ovr, view.potMid, characterRead(league, team.id, p)?.workEthic) >= 12;
    const keeper =
      (ahead >= starterBar - 0.5 || young || mine.length < KEEP_MIN[p.position]) && p.age - ageShift(p.position) <= 33;
    if (!keeper) continue;
    const offer = aiOffer(league, team, p, rng, needGain(depth, p, ahead + quirkWorth(league, team.id, p)));
    offer.apy = Math.round(offer.apy * (0.96 + team.gm.loyalty * 0.08));
    const d = demand(league, p, team.id);
    // Some players want to see what the market will pay, however loyal the club.
    const testsMarket = rng.chance(0.3 * (1 - p.personality.loyalty));
    // The new deal's year-one cap hit: 0.85x its APY ran about a tenth under a market deal's (all of a one-year one's).
    const cost = offerCharge(league, p, team.id, offer);
    if (!testsMarket && offerValue(league, p, team.id, offer, d) >= d.walkAway && cost <= budget()) {
      signPlayer(league, p, team.id, offer);
      mine.push(ahead);
      mine.sort((a, b) => b - a);
      continue;
    }
    const tier = payTier(p.position, positionRank(market, p));
    if (!team.taggedId && tier >= 0.75 && p.age - ageShift(p.position) <= 30 && rng.chance(0.35)) {
      // The tag's charge, less the old deal's (its void years' bonus money accelerates), as `tagBlocker` reads it.
      const value =
        tagValue(league, p) - (capHit(p.contract!, league.season) - remainingProration(p.contract!, league.season));
      if (value <= budget()) applyFranchiseTag(league, p);
    }
  }
  aiCapCompliance(league, team);
}

/**
 * The trade-and-extend: an AI team extends a player it just traded for, with a year or less left,
 * when he's willing (`willExtend`, as the buyer priced him), he'd start for it and its offer meets
 * his ask and fits under the cap. Returns whether he signed.
 */
export function aiExtendArrival(league: League, team: Team, p: Player): boolean {
  if (p.teamId !== team.id || team.id === league.userTeamId) return false;
  const depth = depthOutlooks(league, team);
  const ovr = teamOutlook(league, team.id, p, winNow(league, team));
  // The room he joined, without him.
  const others = [...depth[p.position]];
  others.splice(others.indexOf(ovr), 1);
  if (ovr < (others[STARTERS[p.position] - 1] ?? 0) - 0.5) return false;
  if (!willExtend(league, p, team.id)) return false;
  const rng = new Rng(`${league.seed}:extend-offer:${league.season}:${p.id}:${team.id}`);
  const offer = aiOffer(league, team, p, rng, needGain({ ...depth, [p.position]: others }, p, ovr));
  const d = demand(league, p, team.id);
  if (offerValue(league, p, team.id, offer, d) < d.walkAway || offerProblem(league, p, team.id, offer)) return false;
  signPlayer(league, p, team.id, offer);
  return true;
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
    // With no gentler move left (every position at its minimum, say, after camp's fills), any GM restructures,
    // then cuts down to his starters: no team opens a season over the cap.
    const gentle = capCut(league, team, desperate);
    if (team.gm.capAggression >= 0.35 || desperate || !gentle) {
      const candidate = roster
        .filter((p) => canRestructure(league, p) && restructureOptions(league, p).savings > 1_000)
        .sort((a, b) => restructureOptions(league, b).savings - restructureOptions(league, a).savings)[0];
      if (candidate) {
        restructurePlayer(league, candidate);
        continue;
      }
    }
    const cut = gentle ?? capCut(league, team, true);
    if (!cut) break;
    releasePlayer(league, cut);
  }
}

/**
 * The player `aiCapCompliance` cuts next for room: the least play per dollar saved, at a position it
 * can spare him (only starters are protected when it's `desperate`). Nothing is released; the trade
 * market calls around about him first when the league year opens.
 */
export function capCut(league: League, team: Team, desperate = false): Player | null {
  const roster = teamPlayers(league, team.id).filter((p) => p.contract && !isExpired(p.contract, league.season));
  // The floor counts who can play: a player on injured reserve still costs cap but fills no spot.
  const counts = new Map<Position, number>();
  for (const p of roster) if (!p.ir) counts.set(p.position, (counts.get(p.position) ?? 0) + 1);
  const floor = (pos: Position) => (desperate ? STARTERS[pos] : KEEP_MIN[pos]);
  return (
    roster
      .filter((p) => (counts.get(p.position) ?? 0) > floor(p.position))
      .map((p) => ({ p, savings: releasePreview(league, p).savings }))
      .filter((x) => x.savings > 200)
      .sort((a, b) => playerOvr(a.p) / a.savings - playerOvr(b.p) / b.savings)[0]?.p ?? null
  );
}

// ───────── free agency ─────────

/** A free agent's deal past this share of the cap needs a bigger upgrade, `PRICE_GAIN` outlook points per share over it (a $60M quarterback on a $300M cap: about 1). */
const PRICEY = 0.03;
const PRICE_GAIN = 6;

/** The least upgrade (`needGain`) a team bids for at all: a rich one takes a flyer on depth. */
const minGainFor = (league: League, team: Team) => 0.3 - richness(league, team) * 0.2;

/**
 * The upgrade a free agent at `apy` has to buy: a big contract is an investment, not a swap of
 * numbers, so the more of the cap it takes, the bigger the step it must be on where the room is
 * headed (no $80M a year for a quarterback level with the young one already there).
 */
export const upgradeBar = (league: League, team: Team, apy: number) =>
  minGainFor(league, team) + PRICE_GAIN * Math.max(0, apy / league.caps[league.season] - PRICEY);

/** One day of free agency: every AI team bids on the players it needs; each player takes his best offer if it's good enough. */
export function aiFreeAgencyDay(league: League, rng: Rng, opts: { includeUser?: boolean } = {}): number {
  const teams = league.teams.filter((t) => opts.includeUser || t.id !== league.userTeamId);
  const depth = new Map(teams.map((t) => [t.id, depthOutlooks(league, t)]));
  const budget = new Map(teams.map((t) => [t.id, spendable(league, t.id)]));
  const room = new Map(teams.map((t) => [t.id, rosterLimit(league) - activeRoster(league, t.id).length]));
  // Cap planning: big deals must also fit next year's books, not just this year's.
  const nextCap = capFor(league, league.season + 1) * 0.92;
  const committedNext = new Map(teams.map((t) => [t.id, capSheet(league, t.id, league.season + 1).used]));
  const signedToday = new Map<number, number>();
  const dailyLimit = new Map(teams.map((t) => [t.id, 4 + Math.round(richness(league, t) * 5)]));
  const minGain = new Map(teams.map((t) => [t.id, minGainFor(league, t)]));
  const market = leagueMarket(league);
  const pool = freeAgents(league)
    .map((p) => ({ p, value: marketApy(market, p) }))
    .sort((a, b) => b.value - a.value);
  // Each front office bids on what its own scouts see; the player's price is still his real market.
  const read = viewCache(league);
  let signings = 0;
  for (const { p } of pool) {
    // Injury reports are public: nobody pays market price for a player who'll miss the start of the season.
    if (p.injury && p.injury.estimate[0] >= 4) continue;
    let best: { team: Team; offer: Offer; value: number } | null = null;
    for (const team of teams) {
      if ((room.get(team.id) ?? 0) <= 0 || (signedToday.get(team.id) ?? 0) >= dailyLimit.get(team.id)!) continue;
      // Bid on what its own scouts see: his game, plus or minus the habits they've caught on film.
      const ahead = teamOutlook(league, team.id, p, winNow(league, team), read(team.id, p));
      const gain = needGain(depth.get(team.id)!, p, ahead + quirkWorth(league, team.id, p));
      if (gain < minGain.get(team.id)!) continue;
      const offer = aiOffer(league, team, p, rng, gain);
      if (gain < upgradeBar(league, team, offer.apy)) continue;
      // Year-one charge must fit; bonus spreads, so the hit is below the APY for bigger deals.
      const yearOne =
        offer.apy * (1 - offer.bonusPct) +
        (offer.apy * offer.years * offer.bonusPct) / Math.min(5, offer.years + offer.voidYears);
      if (yearOne > budget.get(team.id)!) continue;
      if (
        offer.years > 1 &&
        offer.apy > 0.03 * league.caps[league.season] &&
        committedNext.get(team.id)! + offer.apy > nextCap
      )
        continue;
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
    d.push(teamOutlook(league, best.team.id, p, winNow(league, best.team)));
    d.sort((a, b) => b - a);
  }
  return signings;
}

// ───────── training camp ─────────

/** What a team loses by cutting a player: talent, upside as its scouts project it, and any dead money it would eat. */
function keepScore(league: League, p: Player, read = viewCache(league)): number {
  const youth =
    p.age <= 24
      ? Math.max(
          0,
          projectedCeiling(playerOvr(p), read(p.teamId!, p).potMid, characterRead(league, p.teamId!, p)?.workEthic) -
            playerOvr(p),
        ) * 0.5
      : 0;
  const pre = releasePreview(league, p);
  const sunk = pre.thisYear + pre.nextYear > Math.max(0, pre.savings) ? 1.5 : 0;
  const draftee = p.draft?.season === league.season && p.draft.round <= 3 ? 2 : 0;
  return playerOvr(p) + quirkWorth(league, p.teamId!, p) + youth + sunk + draftee;
}

/**
 * Cut down to `limit` (53), never below the positional minimums. Players on injured reserve don't
 * count and can't be cut here; `pool` limits who may go (an in-season cut to make room for a signing).
 */
export function aiCutdown(league: League, team: Team, limit = ROSTER_MAX, pool?: readonly Player[]): void {
  for (const p of cutChoice(league, activeRoster(league, team.id), limit, pool)) releasePlayer(league, p);
}

/**
 * Who `aiCutdown` would let go to bring `roster` down to `limit`: the least valuable players at
 * positions it can spare, one at a time (only from `pool` if given). Nothing is released.
 */
export function cutChoice(
  league: League,
  roster: readonly Player[],
  limit: number,
  pool?: readonly Player[],
): Player[] {
  const read = viewCache(league);
  const allowed = pool && new Set(pool.map((p) => p.id));
  const left = [...roster];
  const out: Player[] = [];
  while (left.length > limit) {
    const counts = new Map<Position, number>();
    for (const p of left) counts.set(p.position, (counts.get(p.position) ?? 0) + 1);
    const cut = left
      .filter((p) => (counts.get(p.position) ?? 0) > KEEP_MIN[p.position] && (!allowed || allowed.has(p.id)))
      // A second specialist goes before anyone else, the weaker of the two first.
      .map((p) => ({ p, score: keepScore(league, p, read) - (surplus(p.position, counts.get(p.position)!) ? 100 : 0) }))
      .sort((a, b) => a.score - b.score)[0]?.p;
    if (!cut) break;
    out.push(cut);
    left.splice(left.indexOf(cut), 1);
  }
  return out;
}

/**
 * A replacement-level "street" free agent, for when the pool at a position has run dry: no older than
 * `maxAge`, so his minimum (it rises with his years) fits the room he's signed into.
 */
function streetFreeAgent(league: League, position: Position, rng: Rng, maxAge = 30): Player {
  const p = generatePlayer(rng, {
    id: league.nextPlayerId++,
    position,
    quality: clamp(rng.normal(7.5, 1.2), 4, 10),
    age: rng.int(Math.min(24, maxAge), maxAge),
    teamId: null,
    jerseysUsed: new Set(),
  });
  recordRatings(p, league.season);
  league.players[p.id] = p;
  return p;
}

/** A one-year minimum deal for `player`. */
const minimumOffer = (league: League, player: Player): Offer => ({
  years: 1,
  apy: minSalary(player.experience, league.caps[league.season]),
  bonusPct: 0,
  gtdPct: 0,
  voidYears: 0,
});

/**
 * Whether `player` would sign a one-year minimum with `teamId` today: only when the least he'll take is the
 * minimum. A player the market still values above it waits for a real deal (a star unsigned in free agency
 * doesn't come cheap in camp). The floor itself is the test, not `offerValue`: its knocks for a short,
 * unguaranteed deal would have a minimum-salary veteran turn down the only deal there is.
 */
const takesMinimum = (league: League, player: Player, teamId: number): boolean =>
  demand(league, player, teamId).walkAway <= minimumOffer(league, player).apy;

/**
 * Whether `signMinimum` at `position` can sign someone within `budget`: a healthy free agent whose minimum
 * fits, or room for any minimum (a street free agent's rises with his years).
 */
export function minimumFits(league: League, position: Position, budget: number): boolean {
  const cap = league.caps[league.season];
  return (
    budget >= topMinimum(cap) ||
    freeAgents(league).some((p) => p.position === position && !p.injury && minSalary(p.experience, cap) <= budget)
  );
}

/**
 * The free agent a team would sign for a hole at `position`, and his price: one year at what he'll take now (his
 * walk-away, which comes down as the season goes on), the best by this front office's read whose price fits
 * `budget` ($K, full-season terms). None if nobody fits.
 */
export function needSigning(
  league: League,
  team: Team,
  position: Position,
  budget: number,
): { player: Player; offer: Offer } | undefined {
  const best = freeAgents(league)
    .filter((p) => p.position === position && !p.injury)
    .map((p) => {
      const d = demand(league, p, team.id);
      // What an offer is worth to him is linear in its APY: price the deal that just meets his walk-away.
      const perDollar = offerValue(league, p, team.id, { ...minimumOffer(league, p), apy: 1 }, d);
      // Never under the league minimum, however much he'd like to play for this team.
      const floor = minimumOffer(league, p);
      const offer = { ...floor, apy: Math.max(floor.apy, Math.ceil(d.walkAway / perDollar)) };
      return { player: p, offer, ovr: perceive(league, team.id, p).ovr + quirkWorth(league, team.id, p) };
    })
    .filter((x) => x.offer.apy <= budget)
    .sort((a, b) => b.ovr - a.ovr)[0];
  return best && { player: best.player, offer: best.offer };
}

/** The position where `team` has the fewest players over what it keeps through cutdowns. */
function thinnest(league: League, team: Team): Position {
  const roster = activeRoster(league, team.id);
  return POSITIONS.map((pos) => ({ pos, gap: roster.filter((p) => p.position === pos).length - KEEP_MIN[pos] })).sort(
    (a, b) => a.gap - b.gap,
  )[0].pos;
}

/**
 * Sign the best available healthy free agent at `position` (any position if undefined) who'll take a one-year
 * minimum deal. `budget` ($K) skips anyone whose minimum (it rises with experience) wouldn't fit.
 */
export function signMinimum(
  league: League,
  team: Team,
  rng: Rng,
  position?: Position,
  budget = Infinity,
  under = Infinity,
): boolean {
  const cap = league.caps[league.season];
  // The best available as this front office sees him (younger than `under`, when it wants a younger man).
  const roster = activeRoster(league, team.id);
  const full = (pos: Position) => surplus(pos, roster.filter((p) => p.position === pos).length + 1);
  let pick = freeAgents(league)
    .filter(
      (p) =>
        (position ? p.position === position : !full(p.position)) &&
        p.age < under &&
        !p.injury &&
        minSalary(p.experience, cap) <= budget &&
        takesMinimum(league, p, team.id),
    )
    .map((p) => ({ p, ovr: perceive(league, team.id, p).ovr + quirkWorth(league, team.id, p) }))
    .sort((a, b) => b.ovr - a.ovr)[0]?.p;
  if (!pick) {
    // Nobody left who'll take the minimum: a street free agent will, wherever the roster is thinnest, as long as
    // one young enough for the room exists (a player has at most his age less 22 years in the league, so room
    // for any free agent's minimum, as `minimumFits` reads it, is room for a 22-year-old's).
    let maxAge = 30;
    while (maxAge >= 22 && minSalary(maxAge - 22, cap) > budget) maxAge--;
    if (maxAge < 22) return false;
    pick = streetFreeAgent(league, position ?? thinnest(league, team), rng, maxAge);
  }
  signPlayer(league, pick, team.id, minimumOffer(league, pick), 'minimum');
  return true;
}

/**
 * Training camp: fill any position below its minimum, cut to 53, then top the roster back up to
 * 53 with minimum deals, making cap room for them if needed.
 */
export function aiTrainingCamp(league: League, team: Team, rng: Rng): void {
  for (const pos of POSITIONS) {
    while (activeRoster(league, team.id).filter((p) => p.position === pos).length < KEEP_MIN[pos])
      if (!signMinimum(league, team, rng, pos)) break;
  }
  // A specialist past his prime gets a younger leg to beat in camp, the best one left: with one kicker and one punter
  // a team, a young one otherwise reached a roster only through the draft, and old ones kept their jobs (8.3 K/P
  // starters aged 38+ of 64 in the careers check; NFL 2019-25 about 2.6). From two years past it, a league whose
  // front offices change hands still sat at the check's ceiling of 8. The weaker of the two goes below.
  for (const pos of Object.keys(KEEP_MAX) as Position[]) {
    const mine = activeRoster(league, team.id).filter((p) => p.position === pos);
    if (mine.length === 1 && mine[0].age >= PEAK_END[pos] + 1)
      signMinimum(league, team, rng, pos, Infinity, mine[0].age);
  }
  aiCutdown(league, team);
  // A team already at 53 or under cuts no one above, so a second specialist goes here: the weaker one.
  const read = viewCache(league);
  for (const pos of Object.keys(KEEP_MAX) as Position[]) {
    const mine = activeRoster(league, team.id).filter((p) => p.position === pos);
    for (const p of mine.sort((a, b) => keepScore(league, b, read) - keepScore(league, a, read)).slice(KEEP_MAX[pos]))
      releasePlayer(league, p);
  }
  const missing = ROSTER_MAX - activeRoster(league, team.id).length;
  if (missing > 0) aiCapCompliance(league, team, missing * minSalary(1, league.caps[league.season]));
  // Get legal before topping up (the minimums above can tip a team over, and the cut that fixes it opens a spot),
  // then sign only deals that fit, so the 53 fills without going back over.
  aiCapCompliance(league, team);
  // A position a cap cut left short fills first, then the 53 fills with whoever's best.
  const short = (pos: Position) =>
    activeRoster(league, team.id).filter((p) => p.position === pos).length < KEEP_MIN[pos];
  for (const pos of POSITIONS)
    while (short(pos) && activeRoster(league, team.id).length < ROSTER_MAX)
      if (!signMinimum(league, team, rng, pos, capSpace(league, team.id))) break;
  while (
    activeRoster(league, team.id).length < ROSTER_MAX &&
    capSpace(league, team.id) >= minSalary(1, league.caps[league.season])
  )
    if (!signMinimum(league, team, rng, undefined, capSpace(league, team.id))) break;
  payAhead(league, team);
  syncDepthChart(league, team);
}

/** Room past its planned reserve a team keeps rather than paying it ahead, as a share of the cap. */
const PAY_AHEAD_CUSHION = 0.01;

/**
 * Room a team still holds past the reserve it planned, once camp is done and the 53 is full: a pay-as-you-go club turns
 * next year's salary into a roster bonus paid now, which counts in full this year and leaves next year's books that
 * much lighter. Nobody is paid more, only sooner. Without it a team with nobody worth its room kept it all to kickoff
 * (5-11 AI teams a season 1-8.7 points of the cap past their plan, the league's median kickoff room at the audit's 4%
 * ceiling). It keeps a point of the cap past its plan: that room was the deadline buyers' (kept to half a point,
 * in-season trades fell from 16.2 to 14.4 a season), and the league's teams still open at their reserve or a little
 * over. The best-paid veterans go first; rookie deals keep their slotted
 * shape, and no year drops under the minimum.
 */
export function payAhead(league: League, team: Team): void {
  const season = league.season;
  let extra = capSpace(league, team.id) - inSeasonReserve(league, team.id) - PAY_AHEAD_CUSHION * league.caps[season];
  if (extra < 1) return;
  const next = (p: Player) => yearOf(p.contract!, season + 1);
  const floor = (p: Player) => minSalary(p.experience + 1, capFor(league, season + 1));
  const deals = activeRoster(league, team.id)
    .filter((p) => p.contract?.kind === 'veteran' && next(p) && !next(p)!.void)
    .sort((a, b) => next(b)!.base - next(a)!.base);
  for (const p of deals) {
    if (extra < 1) break;
    const y = next(p)!;
    const x = Math.floor(Math.min(extra, y.base - floor(p)));
    if (x <= 0) continue;
    y.base -= x;
    y.guaranteed = Math.min(y.guaranteed, y.base);
    p.contract!.bonuses.push({ amount: x, start: season, years: 1, source: 'roster' });
    extra -= x;
  }
}
