import { fillOrigins } from './origin';
import { generateCoachingWorld } from './coaching';
import { applyStartingGm, initializeGms } from './gm';
import type { StartingGm } from './gm';
import { generateGm } from './gmTraits';
export { generateGm } from './gmTraits';
import { CONFERENCES, DIVISIONS, TEAM_SEEDS } from './data/teams';
import { rollGem, rollSize } from './size';
import { ATTRIBUTE_PROFILES, JERSEY_RANGES, overall, playerOvr, ROSTER_TEMPLATE, STARTERS } from './positions';
import { ageShift } from './aging';
import { recordRatings } from './development';
import { generateMedicalWorld } from './medical';
import { generateCrews } from './officials';
import { PROJECTED_CAP_GROWTH } from './finance/cap';
import { buildContract, capHit, restructure, restructurePreview, trimPast, yearOf } from './finance/contract';
import {
  BASE_CAP,
  fifthYearOptionValue,
  guaranteeAsk,
  leagueMarket,
  marketApy,
  maxBonusShare,
  payTier,
  positionRank,
  preferredYears,
  TOP_APY_PCT,
  minSalary,
  rookieApy,
  rookieBonusShare,
  type Market,
} from './finance/market';
import { clamp, Rng } from './rng';
import { buildAutoDepthChart } from './roster';
import { newIdentity } from './identity';
import { generateCombine, SCOUT_POINTS_PER_YEAR } from './scouting';
import { generateSchedule } from './season/schedule';
import { generateStaffWorld } from './staff';
import { POSITION_PREMIUM, specialistPenalty } from './offseason/positionValue';
import { generateQuirks } from './quirks';
import { generateTraits } from './traits';
import { initialPersonnelState } from './personnel/rules';
import { ensureService } from './personnel/service';
import { formPracticeSquads } from './personnel/squadMarket';
import { squadFormationCost } from './personnel/eligibility';
import { inSeasonReserve } from './offseason/ai';
import type { Contract, DraftPick, GmTraits, League, Personality, Player, Position, Ratings, Team } from './types';
import { ATTRIBUTES, POSITIONS } from './types';

export const SAVE_VERSION = 61;
/** 2026 salary cap, in thousands of dollars. */
export const SALARY_CAP = BASE_CAP;
export const DRAFT_ROUNDS = 7;
/** Picks can be traded this many drafts ahead (current NFL rule; a config constant on purpose). */
export const MAX_FUTURE_DRAFT_YEARS = 3;

export function generateRatings(rng: Rng, position: Position, quality: number): Ratings {
  const profile = ATTRIBUTE_PROFILES[position];
  const ratings = {} as Ratings;
  for (const attr of ATTRIBUTES) {
    const offset = profile[attr];
    const value = offset === undefined ? rng.normal(4, 1.6) : quality + offset + rng.normal(0, 1.5);
    ratings[attr] = Math.round(clamp(value, 1, 20));
  }
  return ratings;
}

function pickJersey(rng: Rng, position: Position, used: Set<number>): number {
  const ranges = JERSEY_RANGES[position];
  for (let tries = 0; tries < 50; tries++) {
    const [lo, hi] = ranges[tries < 30 ? 0 : rng.int(0, ranges.length - 1)];
    const n = rng.int(lo, hi);
    if (!used.has(n)) {
      used.add(n);
      return n;
    }
  }
  for (let n = 0; n < 100; n++) {
    if (!used.has(n)) {
      used.add(n);
      return n;
    }
  }
  return 0;
}

/** The first open number in a position's usual ranges (deterministic, for signings and draftees). */
export function freeJersey(position: Position, used: Set<number>, current?: number): number {
  if (current !== undefined && !used.has(current)) return current;
  for (const [lo, hi] of JERSEY_RANGES[position]) for (let n = lo; n <= hi; n++) if (!used.has(n)) return n;
  for (let n = 1; n < 100; n++) if (!used.has(n)) return n;
  return current ?? 0;
}

interface PlayerSpec {
  id: number;
  position: Position;
  quality: number;
  age: number;
  teamId: number | null;
  jerseysUsed: Set<number>;
}

export function generatePersonality(rng: Rng): Personality {
  return {
    greed: rng.float(0, 1),
    loyalty: clamp(rng.normal(0.5, 0.22), 0, 1),
    winning: clamp(rng.normal(0.5, 0.22), 0, 1),
    patience: clamp(rng.normal(0.55, 0.2), 0.1, 1),
  };
}

export function generatePlayer(rng: Rng, spec: PlayerSpec): Player {
  const { position, age } = spec;
  const ratings = generateRatings(rng, position, spec.quality);
  const ovr = overall(ratings, position);
  const growthYears = Math.max(0, 26 - age);
  const potential = clamp(ovr + growthYears * rng.float(0.2, 1.3) + rng.float(0, 0.8), ovr, 20);
  const experience = Math.max(0, age - 22 + rng.int(-1, 0));

  const { firstName, lastName } = newIdentity(rng, { kind: 'player', position });
  // Drawn where the old flat rolls were, so names and jerseys keep their draws.
  const build = rollSize(rng, position);
  const player: Player = {
    id: spec.id,
    firstName,
    lastName,
    position,
    age,
    ...build,
    jersey: pickJersey(rng, position, spec.jerseysUsed),
    experience,
    ratings,
    potential: Math.round(potential * 10) / 10,
    teamId: spec.teamId,
    contract: null,
    personality: generatePersonality(rng),
    traits: {
      workEthic: 0,
      durability: 0,
      temperament: 0,
      injuryResistance: 0,
      naturalFitness: 0,
      versatility: 0,
      leads: 0,
      poise: 0,
      controversy: 0,
      sportsmanship: 0,
    },
    stats: {},
  };
  player.traits = generateTraits(player);
  generateQuirks(player);
  // Seeded by the player himself: adding measurables never shifts the league's random stream.
  player.combine = generateCombine(player);
  if (rollGem(player)) player.playsBig = true;
  return player;
}

/** A slotted four-year rookie deal for the `overall` pick in the `draftSeason` draft. */
export function rookieContract(overall: number, draftSeason: number, cap: number): Contract {
  const apy = rookieApy(overall, cap);
  const total = apy * 4;
  const round = Math.ceil(overall / 32);
  const bonus = total * rookieBonusShare(overall);
  const min = minSalary(0, cap);
  // First-rounders are fully guaranteed; Day 2 picks get their first year guaranteed.
  const guaranteedBase = round === 1 ? total : round <= 3 ? min : 0;
  const c = buildContract(
    { years: 4, total, signingBonus: bonus, guaranteedBase, voidYears: 0, escalator: 0.08 },
    draftSeason,
    'rookie',
    min,
  );
  if (round === 1) c.fifthYearOption = 'eligible';
  return c;
}

/**
 * Standard veteran structure: bigger deals carry a bigger signing bonus and early guarantees;
 * cap-aggressive front offices push money into void years. Salaries climb through the deal as a settled league's
 * charges do (its multi-year deals charge 14% more next year than this, restructures included; 2-7% raises left a
 * new league's at 3%).
 */
export function veteranContract(
  rng: Rng,
  market: Market,
  player: Player,
  apyK: number,
  years: number,
  start: number,
  gm: GmTraits,
  signedWeek = 0,
): Contract {
  const cap = market.cap;
  const total = apyK * years;
  const share =
    apyK > 0.04 * cap ? rng.float(0.28, 0.45) : apyK > 0.012 * cap ? rng.float(0.1, 0.28) : rng.float(0, 0.08);
  const bonus = total * clamp(share + (gm.capAggression - 0.5) * 0.15, 0, maxBonusShare(gm.capAggression));
  const gtdShare = guaranteeAsk(market, player) * rng.float(0.8, 1.1);
  const guaranteedBase = Math.max(0, total * gtdShare - bonus);
  const voidYears =
    years < 5 && gm.capAggression > 0.75 && bonus > 0.03 * cap && rng.chance(0.6)
      ? rng.int(1, Math.min(3, 5 - years))
      : 0;
  const kind = apyK <= minSalary(player.experience, cap) * 1.05 ? 'minimum' : 'veteran';
  return buildContract(
    { years, total, signingBonus: bonus, guaranteedBase, voidYears, escalator: rng.float(0.06, 0.16) },
    start,
    kind,
    minSalary(player.experience, cap),
    signedWeek,
  );
}

/** Drafts in the opening league's invented history: rookie deals for the last four, options for the one before. */
const DRAFT_HISTORY = 5;
/** Experience of the class before those four: only its first round can still be on a rookie deal (its option year). */
const OPTION_CLASS = DRAFT_HISTORY - 1;

/** A season's luck in a draft order, on top of a franchise's talent: its record is about 0.6 talent, 0.4 bounces. */
const ORDER_LUCK = 0.5;
/** How far a class's order leans toward the teams holding its best players (per point of board grade). */
const ORDER_LEAN = 0.2;

/**
 * The opening league's last five drafts. Every team took one player a round from its own young players of each
 * class, by its board: quality at the draft (today's overall less the growth since, read with the scouts' miss)
 * plus what the real boards add for a position, kickers and punters marked down before the fifth round
 * (`positionValue.ts`). A team's eighth and later are undrafted. Every class has a full first round, as a settled
 * league's does: picks drawn from each player's quality alone left 34 first-rounders a league and rookie deals at
 * half a settled league's share of payroll; ranked on overall alone, 11.5 kickers and punters a league went in the
 * first round (a settled league's 0.1-0.2).
 *
 * Each class's order is the season before it: the weakest franchises (`talent`, the records the league is seeded
 * from) first, as the NFL's order runs, so a bad team carries the top picks' bigger rookie deals and a good one the
 * cheap ones at the end, with a season's luck on top, and leaning toward the teams that hold the class's best
 * players, since a top pick most often became one. One order for every class handed the same three franchises the
 * top three picks of all four rookie classes and made 12.4% of top-10 picks depth players (a settled league: 3.4%).
 * The oldest class keeps a record only for its first round, whose fifth-year options decide their deals
 * (`initialContract`): the opening league's history goes no further back than its rookie deals.
 */
function draftHistory(rng: Rng, league: League, season: number, talent: number[]): void {
  const classes = new Map<string, Player[]>();
  for (const p of Object.values(league.players)) {
    if (p.teamId === null || p.experience >= DRAFT_HISTORY) continue;
    const key = `${p.teamId}:${p.experience}`;
    classes.set(key, [...(classes.get(key) ?? []), p]);
  }
  for (let exp = 0; exp < DRAFT_HISTORY; exp++) {
    const boards = league.teams.map((t) =>
      (classes.get(`${t.id}:${exp}`) ?? []).map((p) => ({
        p,
        grade: playerOvr(p) - exp * 0.6 + rng.normal(0, 1) + POSITION_PREMIUM[p.position],
      })),
    );
    const order = league.teams
      .map((t) => {
        const best = Math.max(0, ...boards[t.id].map((b) => b.grade));
        return { teamId: t.id, key: talent[t.id] + rng.normal(0, ORDER_LUCK) - ORDER_LEAN * best };
      })
      .sort((a, b) => a.key - b.key);
    order.forEach(({ teamId }, slot) => {
      const board = boards[teamId];
      for (let round = 1; round <= DRAFT_ROUNDS && board.length; round++) {
        // On a full board the penalty keeps every specialist out of the first four rounds; a team's survivors of
        // a class are a handful, so here one simply waits for the fifth (the picks before him didn't stick).
        const open = board.filter((b) => specialistPenalty(b.p.position, round) === 0);
        if (!open.length) continue;
        const pick = open.reduce((best, b) => (b.grade > best.grade ? b : best));
        board.splice(board.indexOf(pick), 1);
        if (exp < OPTION_CLASS || round === 1)
          pick.p.draft = { season: season - exp, round, pick: (round - 1) * 32 + slot + 1, teamId };
      }
    });
  }
}

/**
 * Years left on a minimum-salary veteran's deal by his age on his position's clock (`ageShift`; weights for 1, 2, 3,
 * 4 and 5), as a settled league carries them at kickoff (minimum deals of players under OVR 13 from the 4th kickoff
 * on, in twelve runs; the 13+ on one-year minimums are its glutted market's, which a new league doesn't copy):
 * the old sign a year at a time, a young one now and then for three to five like an undrafted rookie.
 */
const MINIMUM_YEARS_LEFT: { upTo: number; weights: number[] }[] = [
  { upTo: 25, weights: [60, 4, 6, 11, 19] },
  { upTo: 26, weights: [55, 7, 8, 30, 0] },
  { upTo: 27, weights: [51, 8, 24, 17, 0] },
  { upTo: 28, weights: [44, 25, 31, 0, 0] },
  { upTo: 29, weights: [55, 33, 12, 0, 0] },
  { upTo: 30, weights: [72, 28, 0, 0, 0] },
  { upTo: 31, weights: [85, 15, 0, 0, 0] },
  { upTo: Infinity, weights: [100, 0, 0, 0, 0] },
];

/** Front offices that give a veteran 31 or older on his position's clock a year less than he asks (`aiOffer`). */
const SHORTER_PAST_31 = 0.4;

/**
 * Where a market-priced veteran is in his deals: they follow each other from the end of his rookie deal (four
 * years in), each as long as a player his age on his position's clock asks for (`preferredYears`), a year less from
 * the front offices not chasing now once he's 31 on that clock. A quarterback, kicker or punter signs his second deal
 * at 26 for five years, so at 30 he's in its last (a settled league's top 32 at those positions are a third in their
 * last year at 30-32); drawn by age alone, as a receiver's, 57-60% were. Returns his deal's years left, counting
 * this one, and the seasons since he signed it.
 */
function dealCycle(rng: Rng, player: Player): { remaining: number; elapsed: number } {
  for (let start = OPTION_CLASS; ; ) {
    const age = player.age - (player.experience - start);
    let length = preferredYears({ ...player, age });
    if (age - ageShift(player.position) >= 31 && rng.chance(SHORTER_PAST_31)) length = Math.max(1, length - 1);
    if (start + length > player.experience)
      return { remaining: start + length - player.experience, elapsed: player.experience - start };
    start += length;
  }
}

/** Contracts for the league's opening rosters: rookie deals for its last drafts, market deals for veterans. */
function initialContract(
  rng: Rng,
  league: League,
  market: Market,
  player: Player,
  season: number,
  gm: GmTraits,
): Contract {
  const exp = player.experience;
  const capThen = (years: number) => Math.round(BASE_CAP / 1.07 ** years);
  const draft = player.draft;
  // A first-rounder four or five years in: his club took up the fifth-year option if he's paid like a starter worth
  // its price (the first test `aiFifthYearOptions` makes; a settled league exercises about 23 of a class's 32).
  const option =
    draft?.round === 1 &&
    exp >= OPTION_CLASS - 1 &&
    exp <= OPTION_CLASS &&
    payTier(player.position, positionRank(market, player)) >= 0.45;
  if (draft && (exp < OPTION_CLASS || option)) {
    const c = rookieContract(draft.pick, draft.season, capThen(exp));
    if (option) {
      // Priced the spring he was four years in, at that year's cap.
      const value = Math.round(fifthYearOptionValue(league, player) / 1.07 ** (exp - (OPTION_CLASS - 1)));
      c.years.push({ season: draft.season + 4, base: value, guaranteed: value });
      c.fifthYearOption = 'exercised';
    } else if (c.fifthYearOption === 'eligible' && exp === OPTION_CLASS - 1) c.fifthYearOption = 'declined';
    trimPast(c, season);
    return c;
  }
  // A first-rounder whose option was declined has been on a veteran deal since: no rookie deal, no record kept.
  if (exp === OPTION_CLASS) delete player.draft;
  if (exp < OPTION_CLASS) {
    // Undrafted: three years at the minimum and a token bonus, signed after his draft.
    const min = minSalary(0, capThen(exp));
    const c = buildContract(
      {
        years: 3,
        total: min * 3 + rng.int(0, 40),
        signingBonus: rng.int(0, 40),
        guaranteedBase: 0,
        voidYears: 0,
        escalator: 0.08,
      },
      season - exp,
      'minimum',
      min,
    );
    trimPast(c, season);
    if (c.years.some((y) => !y.void)) return c;
    // A deal that has run out: he's back on a one- or two-year minimum.
    const now = minSalary(exp, BASE_CAP);
    const years = rng.int(1, 2);
    return buildContract(
      { years, total: now * years, signingBonus: 0, guaranteedBase: 0, voidYears: 0, escalator: 0 },
      season,
      'minimum',
      now,
    );
  }
  // A league already in motion: each veteran is somewhere inside a deal.
  const floor = marketApy(market, player) <= minSalary(exp, market.cap);
  let remaining: number;
  let elapsed: number;
  if (floor) {
    const row = MINIMUM_YEARS_LEFT.find((r) => player.age - ageShift(player.position) <= r.upTo)!;
    remaining = rng.weighted([1, 2, 3, 4, 5], (k) => row.weights[k - 1]);
    // His first deal after the rookie one started at four years in.
    elapsed = rng.int(0, Math.min(5 - remaining, exp - 4));
  } else ({ remaining, elapsed } = dealCycle(rng, player));
  const then = { ...market, cap: capThen(elapsed) };
  const younger = { ...player, age: player.age - elapsed, experience: exp - elapsed };
  const apyK = floor ? minSalary(younger.experience, then.cap) : marketApy(then, younger) * rng.float(0.85, 1.15);
  const c = veteranContract(rng, then, younger, apyK, remaining + elapsed, season - elapsed, gm);
  c.signedSeason = season - elapsed;
  trimPast(c, season);
  return c;
}

/**
 * A young player's extension once three seasons of his rookie deal are in (the CBA's earliest): his market for the
 * years he asks for, structured as his club's offers are (`aiOffer`: the bonus by its GM's cap style, out of the
 * guarantee his agent asks), from this league year. His rookie deal's bonus keeps its schedule, as an extension's
 * does (`prospectiveContract`).
 */
function rookieExtension(market: Market, player: Player, season: number, gm: GmTraits): Contract {
  const apy = marketApy(market, player);
  const years = preferredYears(player);
  const total = apy * years;
  const guaranteed = guaranteeAsk(market, player);
  const bonus = total * Math.min(guaranteed * (0.45 + 0.4 * gm.capAggression), maxBonusShare(gm.capAggression));
  const c = buildContract(
    {
      years,
      total,
      signingBonus: bonus,
      guaranteedBase: Math.max(0, total * guaranteed - bonus),
      voidYears: 0,
      escalator: 0.11,
    },
    season,
    'veteran',
    minSalary(player.experience, market.cap),
    -1,
  );
  c.bonuses.unshift(...player.contract!.bonuses);
  return c;
}

/** The most `fitPayroll` scales a roster's pay above the minimum: past it, what's missing comes as raises. */
const MAX_SCALE = 1.5;
/** The most of next year's cap an opening roster's restructures may commit. */
const NEXT_YEAR_CEILING = 0.97;
/**
 * The most a last-year deal is raised to, as a multiple of its player's market. A settled league's kickoffs pay their
 * last-year deals 1.13-1.55 times their market in all; 1.55 a deal left a new league's at 1.16 (the position's top
 * holds the best back) and 28.5% of payroll, against a settled 29-33%.
 */
const LAST_YEAR_MOST = 1.7;

/**
 * Nudge veteran money so a team's opening payroll lands near `target`, never over the cap. Rookie deals stay
 * slotted, and an undrafted player's first deal stays the minimum he signed for. `gm` is the team's, for the
 * extensions it signs.
 *
 * A roster over its target fits the way a capped-out front office does (`aiCapCompliance`): it restructures, the
 * biggest savings first, which moves money into later years as a settled league's restructures have, but only while
 * next year's commitments stay under 97% of its cap: restructuring as far as this year needed put 49 teams in fifty
 * leagues over next year's cap (the most at 144.6%; a settled league's kickoffs top out at 108%). What that can't fit
 * comes off pay, every year alike.
 *
 * A roster under its target first pays its veterans in their last year as a settled league does, past their market
 * (1.13-1.55 times it at its kickoffs; at their market a new league committed 77.6% of next year's cap against a
 * settled league's 73.2%, and its in-season buyers, who read two years of room, were too few). It takes them no
 * further than 1.7 times (1.19 in all, 29.3% of payroll, 72.6% of next year committed at the median): a raise on a deal in its last year is this year's money alone, room again in the spring
 * for whoever hoards it (a team whose last-year deals took every raise, at up to 3.5 times their market, kept 31.7% of
 * the cap unspent at its next kickoff). Then it scales their salaries above the
 * minimum, every year alike, by at most 1.5 and never past a position's top of the market, so the market, not the
 * cap, decides what stars earn (a scale up to 2.5 left ten deals a league at twice the market into the next season; a
 * settled league has five). What's still missing comes as raises over each deal's remaining years, by pay above the
 * minimum and then by charge, and no year's charge passes the position's top or twice the player's market: past that
 * a deal is dead weight, and a thin roster's room spread by charge alone once paid an offensive lineman ranked 255th
 * 5.9 times the minimum.
 *
 * A new league's talent sits on its rookie deals more than a settled league's does (players on them hold 47% of
 * what its rosters are worth on the market, against 31%), so six rosters in ten come out of the scaling more than 1%
 * of the cap short (13% on average) and three in ten are still short past the raises. They extend, as front offices
 * with room do: first the young players three seasons into their rookie deals whom the market prices above them, at
 * that price, then the veterans in their last year, the best paid first, whose pay carries on for the years a player
 * his age signs for and takes the raises too. Past that, a thin roster pays like one in a hot market, a deal running
 * to three and a half times its player's market (three times the minimum for a player the market prices at it);
 * about one team in fifteen gets that far.
 */
export function fitPayroll(players: Player[], season: number, target: number, market: Market, gm: GmTraits): void {
  const slotted = (p: Player) => p.contract!.kind === 'rookie' || (!p.draft && p.experience < OPTION_CLASS);
  const vets = players.filter((p) => !slotted(p));
  const fixed = () => players.filter(slotted).reduce((s, p) => s + capHit(p.contract!, season), 0);
  const ceiling = BASE_CAP * 0.985;
  const aim = Math.min(target, ceiling);
  const min = (p: Player) => minSalary(p.experience, BASE_CAP);
  const top = (p: Player) => TOP_APY_PCT[p.position] * BASE_CAP;
  const hit = (p: Player) => capHit(p.contract!, season);
  const payroll = () => fixed() + vets.reduce((s, p) => s + hit(p), 0);
  const real = (p: Player) => p.contract!.years.filter((y) => !y.void && y.season >= season);
  const running = (p: Player) => real(p).length > 1;
  const above = (p: Player) => Math.max(0, hit(p) - min(p));
  const salary = (p: Player) => Math.max(0, (yearOf(p.contract!, season)?.base ?? 0) - min(p));
  const restructuring = (p: Player) => restructurePreview(p.contract!, season, Infinity, min(p));
  let nextRoom =
    NEXT_YEAR_CEILING * BASE_CAP * (1 + PROJECTED_CAP_GROWTH) -
    players.reduce((s, p) => s + capHit(p.contract!, season + 1), 0);
  let over = payroll() - aim;
  for (const p of vets
    .filter((p) => p.contract!.kind === 'veteran' && restructuring(p).savings > 0)
    .sort((a, b) => restructuring(b).savings - restructuring(a).savings)) {
    if (over <= 0 || nextRoom <= 0) break;
    // Converting x saves x(1 - 1/years) now and charges x/years to each later year, next year's included.
    const { years } = restructuring(p);
    const saved = restructure(p.contract!, season, Math.min(over / (1 - 1 / years), nextRoom * years), min(p));
    over -= saved;
    nextRoom -= saved / (years - 1);
  }
  const scale = (p: Player, f: number) => {
    const c = p.contract!;
    // An overpaid roster still pays by position: nobody's raise takes him past his position's top of the market.
    if (f > 1 && c.apy > min(p)) f = Math.min(f, Math.max(1, (top(p) - min(p)) / (c.apy - min(p))));
    let raised = 0;
    for (const y of c.years) {
      if (y.void) continue;
      const was = y.base;
      y.base = Math.round(min(p) + Math.max(0, y.base - min(p)) * f);
      y.guaranteed = Math.min(y.base, Math.round(y.guaranteed * f));
      raised += y.base - was;
    }
    if (f > 1) {
      // A raise is salary: bonus money would still be charged once the years it was raised for have run.
      c.apy = Math.round(c.apy + raised / c.length);
      return;
    }
    for (const b of c.bonuses) b.amount = Math.round(b.amount * f);
    c.apy = Math.round(min(p) + Math.max(0, c.apy - min(p)) * f);
  };
  if (payroll() < aim) {
    // Each last-year deal by how far it is from the most it may be paid, as salary for this year alone.
    const last = vets.filter(
      (p) => !running(p) && p.contract!.kind === 'veteran' && p.contract!.years.every((y) => !y.void),
    );
    const gap = (p: Player) => Math.max(0, Math.min(top(p), LAST_YEAR_MOST * marketApy(market, p)) - hit(p));
    const gaps = last.reduce((s, p) => s + gap(p), 0);
    const room = aim - payroll();
    for (const p of gaps > 0 ? last : []) {
      // Rounded down: a dollar over the target would scale the roster back down.
      const extra = Math.floor(Math.min(gap(p), (room * gap(p)) / gaps));
      yearOf(p.contract!, season)!.base += extra;
      p.contract!.apy = Math.round(p.contract!.apy + extra / p.contract!.length);
    }
  }
  if (payroll() > aim) {
    const factor = Math.max(0, 1 - (payroll() - aim) / vets.reduce((s, p) => s + above(p), 0));
    for (const p of vets) scale(p, factor);
  } else {
    const pool = vets.filter(running).reduce((s, p) => s + salary(p), 0);
    if (pool > 0) {
      const factor = clamp(1 + (aim - payroll()) / pool, 1, MAX_SCALE);
      for (const p of vets.filter(running)) scale(p, factor);
    }
  }
  let short = aim - payroll();
  if (short <= 1) return;
  const worth = new Map(players.map((p) => [p, marketApy(market, p)]));
  const priced = (p: Player) => worth.get(p)! > min(p);
  /** Raises over the remaining years of running deals `who` picks, none past `most` in any year. */
  const raise = (most: (p: Player) => number, who: (p: Player) => boolean = () => true) => {
    for (const weight of [salary, hit]) {
      for (let pass = 0; pass < 6 && short > 1; pass++) {
        const room = new Map(
          vets
            .filter((p) => running(p) && who(p))
            .map((p) => [p, Math.max(0, Math.min(...real(p).map((y) => most(p) - capHit(p.contract!, y.season))))]),
        );
        const open = [...room.keys()].filter((p) => room.get(p)! >= 1 && weight(p) > 0);
        const pool = open.reduce((s, p) => s + weight(p), 0);
        let given = 0;
        for (const p of open) {
          const c = p.contract!;
          const extra = Math.min(room.get(p)!, Math.round((short * weight(p)) / pool));
          if (extra <= 0) continue;
          const years = real(p);
          for (const y of years) y.base += extra;
          c.apy = Math.round(c.apy + (extra * years.length) / c.length);
          // Paid past the minimum, it's a market deal now.
          if (c.kind === 'minimum' && c.apy > min(p) * 1.05) c.kind = 'veteran';
          given += extra;
        }
        if (given <= 0) break;
        short -= given;
      }
    }
  };
  const twice = (p: Player) => Math.min(top(p), 2 * worth.get(p)!);
  raise(twice);
  const young = players
    .filter((p) => p.contract!.kind === 'rookie' && p.experience >= OPTION_CLASS - 1 && worth.get(p)! > hit(p))
    .sort((a, b) => worth.get(b)! - hit(b) - (worth.get(a)! - hit(a)));
  for (const p of young) {
    if (short <= 1) break;
    const c = rookieExtension(market, p, season, gm);
    // A deal comes whole: one that would take the payroll past the most it may open at waits for one that fits, and
    // one that takes it past the target ends the fill (holding each to the target left fewer extended, more of the
    // room on expiring veterans' extensions).
    if (capHit(c, season) - hit(p) > short + (ceiling - aim)) continue;
    short -= capHit(c, season) - hit(p);
    p.contract = c;
    vets.push(p);
  }
  const expiring = vets
    .filter(
      (p) => !running(p) && priced(p) && p.contract!.kind === 'veteran' && p.contract!.years.every((y) => !y.void),
    )
    .sort((a, b) => salary(b) - salary(a));
  for (const p of expiring) {
    if (short <= 1) break;
    const c = p.contract!;
    const now = yearOf(c, season)!;
    const more = Array.from({ length: preferredYears({ ...p, age: p.age + 1 }) }, (_, i) => ({
      season: season + 1 + i,
      base: Math.round(now.base * 1.05 ** (i + 1)),
      guaranteed: 0,
    }));
    c.years.push(...more);
    c.apy = Math.round((c.apy * c.length + more.reduce((sum, y) => sum + y.base, 0)) / (c.length + more.length));
    c.length += more.length;
    raise(twice, (q) => q === p);
  }
  raise((p) => (priced(p) ? Math.min(top(p), 3.5 * worth.get(p)!) : 3 * min(p)));
}

/** Each team's seven picks in the `season` draft. */
export function createDraftPicks(league: League, season: number): void {
  for (const team of league.teams) {
    for (let round = 1; round <= DRAFT_ROUNDS; round++) {
      const pick: DraftPick = { id: league.nextPickId++, season, round, originalTeamId: team.id, ownerId: team.id };
      league.draftPicks.push(pick);
    }
  }
}

/** Quality (target overall) for the Nth player on the depth chart at a position. */
/**
 * Quality per point of a franchise's recent win share, above or below .500 (`TeamSeed.winPct`). The real
 * league's spread (.335 to .750 over 2015–2024) then spans about 1.65 points of starter quality, on top of
 * the luck of each player's roll (about half a point between teams): a new league's team ratings follow the
 * real records at about 0.7 (0.6–0.75 by seed), so the old pecking order shows in year one without deciding it.
 */
const PEDIGREE = 4;

function slotQuality(rng: Rng, position: Position, slot: number, teamTalent: number): number {
  const starters = STARTERS[position];
  let q: number;
  if (slot < starters) q = rng.normal(12.8, 2.3);
  else if (slot === starters) q = rng.normal(10, 1.8);
  else q = rng.normal(8.3, 1.7);
  return clamp(q + teamTalent, 4, 19.5);
}

function slotAge(rng: Rng, isStarter: boolean): number {
  if (isStarter) return Math.round(clamp(rng.normal(27, 3), 22, 36));
  return rng.chance(0.55) ? rng.int(22, 25) : rng.int(25, 32);
}

export interface NewLeagueOptions {
  seed?: string;
  userTeamId?: number;
  season?: number;
  name?: string;
  /** Development opt-in until elevations, protections and the full yearly lifecycle ship. */
  personnel?: boolean;
  /**
   * The user takes over the club's own scouts, coaches and medics instead of a fresh, typical staff, so the
   * staff grades on New Game are what he inherits. Off by default: scripts and tests keep the typical start.
   */
  inheritStaff?: boolean;
  /** The name and age you start as (New Game). Omitted: the club's own GM, as generated. */
  gm?: StartingGm;
}

export function createLeague(options: NewLeagueOptions = {}): League {
  const seed = options.seed ?? Math.random().toString(36).slice(2, 10);
  const rng = new Rng(seed);
  const season = options.season ?? 2026;

  const league: League = {
    version: SAVE_VERSION,
    name: options.name ?? 'National Gridiron League',
    seed,
    rngState: rng.getState(),
    season,
    week: 1,
    phase: 'regular',
    userTeamId: options.userTeamId ?? 0,
    userGmId: 0,
    gms: {},
    nextGmId: 1,
    leadership: { nextEventId: 1, events: [] },
    caps: { [season]: SALARY_CAP },
    conferences: CONFERENCES.map((c) => ({ ...c })),
    divisions: DIVISIONS.map((d) => ({ ...d })),
    teams: [],
    players: {},
    nextPlayerId: 1,
    games: [],
    nextGameId: 1,
    history: [],
    awards: [],
    weeklyAwards: [],
    draftPicks: [],
    nextPickId: 1,
    draftClass: [],
    transactions: [],
    negotiations: {},
    inbox: [],
    faDay: 0,
    knowledge: {},
    scoutPoints: SCOUT_POINTS_PER_YEAR,
    staff: {},
    nextStaffId: 1,
    coaches: {},
    nextCoachId: 1,
    retiredCoaches: {},
    medics: {},
    nextMedicId: 1,
    crews: [],
  };

  const talent: number[] = [];
  TEAM_SEEDS.forEach((seedTeam, i) => {
    const division = Math.floor(i / 4);
    const team: Team = {
      id: i,
      city: seedTeam.city,
      name: seedTeam.name,
      abbrev: seedTeam.abbrev,
      colors: [...seedTeam.colors],
      conference: DIVISIONS[division].conference,
      division,
      depthChart: buildAutoDepthChart([]),
      autoDepth: true,
      deadMoney: [],
      carryover: 0,
      postJune1Used: 0,
      taggedId: null,
      gm: generateGm(rng),
      gmId: null,
      staffBudgetMult: 1,
      staffDead: [],
      coachDead: [],
      ownerMandates: [],
      medicalDead: [],
    };
    league.teams.push(team);

    // Talent varies between franchises, which creates contenders and rebuilders: the real franchise's last ten
    // seasons set where it starts (Kansas City's .750 about +1.0 on every starter's quality, Jacksonville's .335
    // about −0.66), with a little luck on top; a team without a record (a mod's) starts at random.
    const teamTalent =
      seedTeam.winPct === undefined ? rng.normal(0, 0.2) : PEDIGREE * (seedTeam.winPct - 0.5) + rng.normal(0, 0.1);
    talent.push(teamTalent);
    const jerseysUsed = new Set<number>();
    const roster: Player[] = [];
    for (const position of POSITIONS) {
      for (let slot = 0; slot < ROSTER_TEMPLATE[position]; slot++) {
        const isStarter = slot < STARTERS[position];
        const player = generatePlayer(rng, {
          id: league.nextPlayerId++,
          position,
          quality: slotQuality(rng, position, slot, teamTalent),
          age: slotAge(rng, isStarter),
          teamId: team.id,
          jerseysUsed,
        });
        recordRatings(player, season);
        roster.push(player);
        league.players[player.id] = player;
      }
    }
    team.depthChart = buildAutoDepthChart(roster);
  });

  // Contracts are priced against the whole league's talent, so they come after every roster exists.
  const market = leagueMarket(league);
  draftHistory(rng, league, season, talent);
  fillOrigins(league);
  for (const team of league.teams) {
    const roster = Object.values(league.players).filter((p) => p.teamId === team.id);
    for (const p of roster) {
      p.contract = initialContract(rng, league, market, p, season, team.gm);
      p.contract.signedWeek = -1; // part of the world as generated: no trade cooldown
    }
    // Some room for the season's injury signings and deadline deals: a new league aimed at 94-99% of the cap (a
    // settled league's kickoff level) traded 10 times in season against 14 at 90-99%, and its structure, not its
    // level, keeps a team from hoarding what's left (most room at a seasons 1-4 kickoff 23% on 15 seeds).
    const target = SALARY_CAP * rng.float(0.9, 0.99);
    const squadBudget = squadFormationCost(league);
    const aim = options.personnel
      ? Math.min(target, SALARY_CAP - inSeasonReserve(league, team.id)) - squadBudget - 20
      : target;
    fitPayroll(roster, season, aim, market, team.gm);
    // The first fitting pass can raise a formerly below-minimum base. Reconcile inside world creation,
    // before any contract is presented to the manager; normal careers retain their original generation.
    for (
      let pass = 0;
      options.personnel && pass < 8 && roster.reduce((sum, p) => sum + capHit(p.contract!, season), 0) > aim;
      pass++
    )
      fitPayroll(roster, season, aim, market, team.gm);
  }

  for (let y = 1; y <= MAX_FUTURE_DRAFT_YEARS; y++) createDraftPicks(league, season + y);
  league.games = generateSchedule(league, rng);
  league.rngState = rng.getState();
  initializeGms(league, true);
  if (options.gm) applyStartingGm(league, options.gm);
  // Scouting departments, coaching and medical staffs and the officiating crews draw from their own
  // seeded streams: the players and schedule above are unchanged by them. Inheriting builds every club's
  // staff as an AI club's (no user while they're hired), so the same seed gives the same staffs whoever is picked.
  if (options.inheritStaff) league.userTeamId = -1;
  generateStaffWorld(league);
  generateCoachingWorld(league);
  generateMedicalWorld(league);
  league.userTeamId = options.userTeamId ?? 0;
  generateCrews(league);
  league.personnel = initialPersonnelState();
  league.personnel.enabled = options.personnel ?? false;
  for (const p of Object.values(league.players)) ensureService(p, season);
  if (options.personnel) formPracticeSquads(league, true);
  return league;
}
