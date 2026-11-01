import { collegeOrigin } from '../origin';
import { squadReserve } from '../personnel/squads';
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
import { generatePlayer, NEXT_YEAR_CEILING, rookieContract } from '../generate';
import { clamp, Rng } from '../rng';
import { activeRoster, syncDepthChart, teamPlayers } from '../roster';
import { characterRead, perceive, projectedCeiling, quirkWorth, viewCache } from '../scouting';
import type { GmTraits, League, Player, Position, Team } from '../types';
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
  voidReserve(league, teamId) -
  squadReserve(league, teamId);

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
export const winNow = (league: League, team: Team) =>
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

/**
 * The deal a club can fit when it can't fit his market price: one year at the room it has, no bonus, as the NFL's
 * late market signs a good veteran to a prove-it deal with whoever has room. Null below his minimum.
 */
export function fitOffer(offer: Offer, budget: number, min: number): Offer | null {
  if (budget < min) return null;
  return { years: 1, apy: Math.floor(Math.min(offer.apy, budget)), bonusPct: 0, gtdPct: offer.gtdPct, voidYears: 0 };
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

export type ResignReason = 'starter' | 'young' | 'depth' | 'fading' | 'age' | 'backup';

/**
 * A club's call on one of its expiring players: keep him, tag him, or let him walk, and why. Kept on where he's
 * headed: a fading veteran has to beat the room's future, a climbing one is worth his raise. The AI's re-sign window
 * keeps whoever this doesn't send walking (`depth` grows as it re-signs); our staff's contracts letter reads the same
 * call. A tag is the call for a keeper the market pays at the top, young enough, with the tag still open: the AI
 * tosses a coin on it, our staff just say so.
 */
export function resignCall(
  league: League,
  teamId: number,
  p: Player,
  depth: Record<Position, number[]> = depthOutlooks(league, league.teams[teamId]),
  wn = winNow(league, league.teams[teamId]),
): { call: 'keep' | 'tag' | 'walk'; reason: ResignReason; ahead: number } {
  const ovr = playerOvr(p);
  const ahead = teamOutlook(league, teamId, p, wn);
  const mine = depth[p.position];
  const starterBar = mine[STARTERS[p.position] - 1] ?? 0;
  // A team knows its own players' games; their ceilings are still its scouts' judgment.
  const view = p.age <= 25 ? perceive(league, teamId, p) : null;
  const young = !!view && projectedCeiling(ovr, view.potMid, characterRead(league, teamId, p)?.workEthic) >= 12;
  const starter = ahead >= starterBar - 0.5;
  const thin = mine.length < KEEP_MIN[p.position];
  const age = p.age - ageShift(p.position);
  if (age > 33) return { call: 'walk', reason: 'age', ahead };
  if (!starter && !young && !thin) return { call: 'walk', reason: ahead < ovr ? 'fading' : 'backup', ahead };
  const reason: ResignReason = starter ? 'starter' : young ? 'young' : 'depth';
  const tier = payTier(p.position, positionRank(leagueMarket(league), p));
  const tag = tier >= 0.75 && age <= 30 && !tagBlocker(league, p);
  return { call: tag ? 'tag' : 'keep', reason, ahead };
}

/**
 * How much less of next year a rebuilding club commits early than an all-in contender, as a share of next year's cap. A
 * club playing for later keeps next year's room (unused cap carries over): 78% of NFL playoff teams restructure, and
 * about 45% of all clubs restructure nobody in a year (Over the Cap). Sized to that share in the offseason check.
 */
export const REBUILD_CAUTION = 0.1;

/**
 * How much of next year's cap a GM will commit when he pushes money forward: a bold one at a contender runs to the
 * ceiling an opening roster may (`NEXT_YEAR_CEILING`); a cautious one keeps seven points of it free, and a club playing
 * for later (`winNow`) keeps more.
 */
export const nextYearCeiling = (gm: Pick<GmTraits, 'capAggression'>, winNow: number) =>
  NEXT_YEAR_CEILING - 0.07 * (1 - gm.capAggression) - REBUILD_CAUTION * (1 - winNow);

/**
 * Whether a club plans to keep a player starting: where he's headed (its three-season read, `teamOutlook`) he's still
 * one of its starters at his position. A GM restructures only such a player: the money pushed forward lands as dead
 * money if he goes before it's paid (aging veterans restructured and then cut or traded a year on carried most of the
 * league's dead money).
 */
export function inPlans(league: League, team: Team, p: Player): boolean {
  const room = depthOutlooks(league, team)[p.position];
  const line = room[STARTERS[p.position] - 1] ?? -Infinity;
  return teamOutlook(league, team.id, p, winNow(league, team)) >= line - 1e-9;
}

/**
 * Make `need` of room this league year to keep `keeper`, as an NFL front office does: restructure its biggest deals,
 * converting only what it needs and no more than next year's books can carry as this GM keeps them (`nextYearCeiling`),
 * then cut the veteran it can best spare, never one better than the keeper. The bill comes later, on next years' caps; uncapped,
 * contenders kept their core a year and hit cap hell two later (record carryover −0.09 at three seasons, dead money
 * climbing league-wide). Returns the room made.
 */
function makeRoom(league: League, team: Team, need: number, keeper: Player): number {
  let gained = restructureRoom(league, team, need, keeper);
  if (gained < need) {
    const cut = capCut(league, team);
    if (cut && playerOvr(cut) < playerOvr(keeper)) {
      gained += releasePreview(league, cut).savings;
      releasePlayer(league, cut);
    }
  }
  return gained;
}

/**
 * What next year will need before anything is borrowed against it: the players whose deals end after this league year
 * that the club plans to keep (`inPlans`), at their market price; and next year's draft class (the picks it owns for
 * next season, a pick's slot read from its round until the order is set). The cushion for in-season injuries is the
 * ceiling's own room under the cap (`NEXT_YEAR_CEILING`), so it isn't counted again. A GM who borrowed without these was
 * short again the next spring and borrowed more: room made for keepers ran 86, 98, 137 and 167 restructures in seasons
 * 1-4.
 */
export function nextYearNeeds(league: League, team: Team): number {
  const season = league.season + 1;
  const cap = capFor(league, season);
  const market = leagueMarket(league);
  const keepers = teamPlayers(league, team.id)
    .filter((p) => p.contract && lastSeason(p.contract) === league.season && inPlans(league, team, p))
    .reduce((sum, p) => sum + marketApy(market, p), 0);
  const draft = league.draftPicks
    .filter((d) => d.season === season && d.ownerId === team.id && d.playerId === undefined)
    .reduce((sum, d) => sum + capHit(rookieContract(d.overall ?? (d.round - 1) * 32 + 16, season, cap), season), 0);
  return keepers + draft;
}

/**
 * Restructure up to `need` of room this league year, as a GM does: the biggest deals of players it plans to keep
 * starting (`inPlans`), converting only what it needs and no more than next year's books can carry as this GM keeps
 * them (`nextYearCeiling`), next year's own needs counted first (`nextYearNeeds`). Returns the room made.
 */
function restructureRoom(league: League, team: Team, need: number, keeper?: Player): number {
  let gained = 0;
  // Next year's own keepers, draft class and cushion come first: only what's left under the ceiling is borrowed.
  const owed = nextYearNeeds(league, team);
  // A contender borrows to its GM's ceiling; a club playing for later keeps more of next year free.
  const wn = winNow(league, team);
  for (let guard = 0; guard < 12 && gained < need; guard++) {
    const best = teamPlayers(league, team.id)
      .filter(
        (p) =>
          p !== keeper &&
          p.contract &&
          !isExpired(p.contract, league.season) &&
          canRestructure(league, p) &&
          inPlans(league, team, p),
      )
      .map((p) => ({ p, o: restructureOptions(league, p) }))
      .filter((x) => x.o.savings > 1_000)
      .sort((a, b) => b.o.savings - a.o.savings)[0];
    if (!best) break;
    // Converting x adds x / years to each later year's cap: keep next year's, its needs counted, under its ceiling.
    const nextRoom =
      nextYearCeiling(team.gm, wn) * capFor(league, league.season + 1) -
      capSheet(league, team.id, league.season + 1).used -
      owed;
    const amount = Math.min(Math.ceil((need - gained) / (1 - 1 / best.o.years)), Math.floor(nextRoom * best.o.years));
    // Too little to be worth converting (the candidates are deals that would save over $1K).
    if (amount < 1_000) break;
    const saved = restructurePlayer(league, best.p, amount);
    if (saved <= 0) break;
    gained += saved;
  }
  return gained;
}

/**
 * The most room `restructureRoom` could make this league year: what its planned starters' deals would save if converted,
 * held to what next year can carry after its needs (each dollar a deal moves onto next year saves `years - 1` now).
 * Read before a club bids on a free agent it can't fit, so it makes the room only once he has chosen it.
 */
function restructurable(league: League, team: Team): number {
  const deals = teamPlayers(league, team.id)
    .filter((p) => p.contract && !isExpired(p.contract, league.season) && canRestructure(league, p))
    .filter((p) => inPlans(league, team, p))
    .map((p) => restructureOptions(league, p))
    .filter((o) => o.savings > 1_000);
  if (!deals.length) return 0;
  const nextRoom =
    nextYearCeiling(team.gm, winNow(league, team)) * capFor(league, league.season + 1) -
    capSheet(league, team.id, league.season + 1).used -
    nextYearNeeds(league, team);
  const longest = Math.max(...deals.map((o) => o.years));
  return Math.max(
    0,
    Math.min(
      deals.reduce((a, o) => a + o.savings, 0),
      nextRoom * (longest - 1),
    ),
  );
}

/** The AI's re-sign window: options, extensions for keepers (room made for them), a tag for a star who won't sign. */
export function aiResignWindow(league: League, team: Team, rng: Rng): void {
  aiFifthYearOptions(league, team);
  const depth = depthOutlooks(league, team);
  const wn = winNow(league, team);
  // What a re-sign may cost: what the team can spend, plus the minimum deal it keeps for his spot while it's open.
  const budget = () =>
    spendable(league, team.id) + (openSpots(league, team.id) > 0 ? topMinimum(league.caps[league.season]) : 0);
  for (const p of expiringPlayers(league, team.id)) {
    const { call, ahead } = resignCall(league, team.id, p, depth, wn);
    if (call === 'walk') continue;
    const mine = depth[p.position];
    const offer = aiOffer(league, team, p, rng, needGain(depth, p, ahead + quirkWorth(league, team.id, p)));
    offer.apy = Math.round(offer.apy * (0.96 + team.gm.loyalty * 0.08));
    const d = demand(league, p, team.id);
    // Some players want to see what the market will pay, however loyal the club.
    const testsMarket = rng.chance(0.3 * (1 - p.personality.loyalty));
    // The new deal's year-one cap hit: 0.85x its APY ran about a tenth under a market deal's (all of a one-year one's).
    const cost = offerCharge(league, p, team.id, offer);
    const wanted = !testsMarket && offerValue(league, p, team.id, offer, d) >= d.walkAway;
    // A keeper it can't fit: the GM makes room before he lets him walk (a third of a contender's keepers were lost
    // to the cap with nobody making room).
    if (wanted && cost > budget()) makeRoom(league, team, cost - budget(), p);
    if (wanted && cost <= budget()) {
      signPlayer(league, p, team.id, offer);
      mine.push(ahead);
      mine.sort((a, b) => b - a);
      continue;
    }
    // The GM's call, not a coin: he tags a player who won't sign when keeping him is worth the tag's price, as any
    // signing must be (`upgradeBar`; where he's headed, his age with it, is in his outlook), and makes room for it first.
    // Never a tag past his own price for the player (`offer`): the tag pays a top-of-the-position wage, so only a player
    // the club values near that is worth it (a thin room counts any back as a starter, and once tagged 7-rated backs at
    // a starter's price). The league allows one tag a year.
    if (!team.taggedId && !tagBlocker(league, p) && tagValue(league, p) <= offer.apy) {
      // The tag's charge, less the old deal's (its void years' bonus money accelerates), as `tagBlocker` reads it.
      const value =
        tagValue(league, p) - (capHit(p.contract!, league.season) - remainingProration(p.contract!, league.season));
      const keep = needGain(depth, p, ahead + quirkWorth(league, team.id, p));
      if (keep >= upgradeBar(league, team, tagValue(league, p))) {
        if (value > budget()) makeRoom(league, team, value - budget(), p);
        if (value <= budget()) applyFranchiseTag(league, p);
      }
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
 * Get under the cap (or to `target` room), as the league year demands, the way a GM makes room: restructure the deals
 * of players it plans to keep, only what it needs and within next year's books as it keeps them (`restructureRoom`),
 * then cut the player it can best spare; deep in the red only starters are protected. Only when neither is left does
 * it restructure anyone (no team plays over the cap). The old pass converted the biggest deals whole, whoever held
 * them: aging veterans restructured, then cut or traded, put the league's dead money past 6% of a median cap.
 */
export function aiCapCompliance(league: League, team: Team, target = 0): void {
  const short = () => target - capSpace(league, team.id);
  if (short() <= 0) return;
  restructureRoom(league, team, short());
  for (let guard = 0; guard < 40 && short() > 0; guard++) {
    const desperate = short() > league.caps[league.season] * 0.04;
    const cut = capCut(league, team, desperate) ?? capCut(league, team, true);
    if (cut) {
      releasePlayer(league, cut);
      continue;
    }
    // Nothing left to cut: the cap is the law, so any deal that can be converted is.
    const any = teamPlayers(league, team.id)
      .filter((p) => p.contract && !isExpired(p.contract, league.season) && canRestructure(league, p))
      .map((p) => ({ p, savings: restructureOptions(league, p).savings }))
      .filter((x) => x.savings > 1_000)
      .sort((a, b) => b.savings - a.savings)[0];
    if (!any) break;
    restructurePlayer(league, any.p);
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
/**
 * One pass of the AI's free agency: each free agent, best first, to the club whose offer he values most, if it beats
 * his walk-away. `rosterMax` is the roster a club may fill to (camp's 90 when the calendar already reads 53).
 * `lastCall` is the pass as camp opens: an NFL veteran still unsigned in August takes what's left, often near the
 * veteran minimum, so a free agent signs for anything at his minimum or above.
 */
export function aiFreeAgencyDay(
  league: League,
  rng: Rng,
  opts: { includeUser?: boolean; rosterMax?: number; lastCall?: boolean } = {},
): number {
  const teams = league.teams.filter((t) => opts.includeUser || t.id !== league.userTeamId);
  const depth = new Map(teams.map((t) => [t.id, depthOutlooks(league, t)]));
  const budget = new Map(teams.map((t) => [t.id, spendable(league, t.id)]));
  const room = new Map(
    teams.map((t) => [t.id, (opts.rosterMax ?? rosterLimit(league)) - activeRoster(league, t.id).length]),
  );
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
  // What each club could restructure for a free agent, read once a pass (and again after it restructures).
  const canMake = new Map<number, number>();
  const makeable = (team: Team) => {
    if (!canMake.has(team.id)) canMake.set(team.id, restructurable(league, team));
    return canMake.get(team.id)!;
  };
  let signings = 0;
  for (const { p } of pool) {
    // Injury reports are public: nobody pays market price for a player who'll miss the start of the season.
    if (p.injury && p.injury.estimate[0] >= 4) continue;
    let best: { team: Team; offer: Offer; value: number; gain: number; borrow: number } | null = null;
    const minimum = minSalary(p.experience, league.caps[league.season]);
    // What he signs for: his walk-away, or on the last call anything from his minimum up.
    const floorAt = (teamId: number) => (opts.lastCall ? minimum : demand(league, p, teamId).walkAway);
    for (const team of teams) {
      if ((room.get(team.id) ?? 0) <= 0 || (signedToday.get(team.id) ?? 0) >= dailyLimit.get(team.id)!) continue;
      // Bid on what its own scouts see: his game, plus or minus the habits they've caught on film.
      const ahead = teamOutlook(league, team.id, p, winNow(league, team), read(team.id, p));
      const gain = needGain(depth.get(team.id)!, p, ahead + quirkWorth(league, team.id, p));
      if (gain < minGain.get(team.id)!) continue;
      let offer = aiOffer(league, team, p, rng, gain);
      if (gain < upgradeBar(league, team, offer.apy)) continue;
      // Year-one charge must fit; bonus spreads, so the hit is below the APY for bigger deals.
      const yearOne =
        offer.apy * (1 - offer.bonusPct) +
        (offer.apy * offer.years * offer.bonusPct) / Math.min(5, offer.years + offer.voidYears);
      let borrow = 0;
      if (yearOne > budget.get(team.id)! && yearOne - budget.get(team.id)! <= makeable(team)) {
        // Can't fit his market price, but restructuring players it plans to keep could, within next year's room after
        // its needs: the NFL's March restructures are mostly room for free agency. The room is made once he chooses it.
        borrow = yearOne - budget.get(team.id)!;
      } else if (yearOne > budget.get(team.id)!) {
        // Can't fit his market price: offer what it can fit, and he takes it only if it beats his walk-away (below).
        // No cut to make room: releasing a pricier veteran for him put his bonus money on the cap at once, and by year
        // four the league's dead money passed 6% of a median cap; the late passes and the last call place him instead.
        const fitted = fitOffer(offer, budget.get(team.id)!, minimum);
        if (
          !fitted ||
          gain < upgradeBar(league, team, fitted.apy) ||
          offerValue(league, p, team.id, fitted) < floorAt(team.id)
        )
          continue;
        offer = fitted;
      }
      if (
        offer.years > 1 &&
        offer.apy > 0.03 * league.caps[league.season] &&
        committedNext.get(team.id)! + offer.apy > nextCap
      )
        continue;
      const value = offerValue(league, p, team.id, offer);
      if (!best || value > best.value) best = { team, offer, value, gain, borrow };
    }
    if (!best || best.value < floorAt(best.team.id)) continue;
    if (best.borrow > 0) {
      // He chose it: make the room. Short of it, the deal the club can fit, if he'd still take it.
      budget.set(best.team.id, budget.get(best.team.id)! + restructureRoom(league, best.team, best.borrow));
      canMake.delete(best.team.id);
      const yearOne =
        best.offer.apy * (1 - best.offer.bonusPct) +
        (best.offer.apy * best.offer.years * best.offer.bonusPct) /
          Math.min(5, best.offer.years + best.offer.voidYears);
      if (yearOne > budget.get(best.team.id)!) {
        const fitted = fitOffer(best.offer, budget.get(best.team.id)!, minimum);
        if (
          !fitted ||
          best.gain < upgradeBar(league, best.team, fitted.apy) ||
          offerValue(league, p, best.team.id, fitted) < floorAt(best.team.id)
        )
          continue;
        best.offer = fitted;
      }
    }
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
  p.origin = collegeOrigin(league.seed, p.id, 3);
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
  fillCampRoster(league, team, rng);
  payAhead(league, team);
  syncDepthChart(league, team);
}

/** Waiver holds can prevent a camp fill. Once they settle, top up without repeating cuts or camp decisions. */
export function fillCampRoster(league: League, team: Team, rng: Rng): void {
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
  let extra =
    capSpace(league, team.id) -
    inSeasonReserve(league, team.id) -
    squadReserve(league, team.id) -
    PAY_AHEAD_CUSHION * league.caps[season];
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
