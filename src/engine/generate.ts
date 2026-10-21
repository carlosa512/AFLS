import { generateCoachingWorld } from './coaching';
import { CONFERENCES, DIVISIONS, TEAM_SEEDS } from './data/teams';
import { ATTRIBUTE_PROFILES, BODY, JERSEY_RANGES, overall, playerOvr, ROSTER_TEMPLATE, STARTERS } from './positions';
import { recordRatings } from './development';
import { generateMedicalWorld } from './medical';
import { generateCrews } from './officials';
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
import { generateQuirks } from './quirks';
import { generateTraits } from './traits';
import type { Contract, DraftPick, GmTraits, League, Personality, Player, Position, Ratings, Team } from './types';
import { ATTRIBUTES, POSITIONS } from './types';

export const SAVE_VERSION = 35;
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
  const [hMin, hMax, wMin, wMax] = BODY[position];
  const experience = Math.max(0, age - 22 + rng.int(-1, 0));

  const { firstName, lastName } = newIdentity(rng, { kind: 'player', position });
  const player: Player = {
    id: spec.id,
    firstName,
    lastName,
    position,
    age,
    heightIn: rng.int(hMin, hMax),
    weightLb: rng.int(wMin, wMax),
    jersey: pickJersey(rng, position, spec.jerseysUsed),
    experience,
    ratings,
    potential: Math.round(potential * 10) / 10,
    teamId: spec.teamId,
    contract: null,
    personality: generatePersonality(rng),
    traits: { workEthic: 0, durability: 0, temperament: 0, injuryResistance: 0, naturalFitness: 0, versatility: 0 },
    stats: {},
  };
  player.traits = generateTraits(player);
  generateQuirks(player);
  // Seeded by the player himself: adding measurables never shifts the league's random stream.
  player.combine = generateCombine(player);
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

/**
 * The opening league's last five drafts. Every team took one player a round, its best young players of each class
 * in order of their quality at the draft (today's overall less the growth since, read with the scouts' miss), and
 * the weakest franchises (`talent`, the records the league is seeded from) pick first in every round, as the
 * NFL's order runs: a bad team carries the top picks' bigger rookie deals, a good one the cheap ones at the end. A
 * team's eighth and later are undrafted. Every class has a full first round, as a settled league's does: picks
 * drawn from each player's quality alone left 34 first-rounders a league and rookie deals at half a settled
 * league's share of payroll. The oldest class keeps a record only for its first round, whose fifth-year options
 * decide their deals (`initialContract`): the opening league's history goes no further back than its rookie deals.
 */
function draftHistory(rng: Rng, league: League, season: number, talent: number[]): void {
  const order = league.teams.map((t) => t.id).sort((a, b) => talent[a] - talent[b]);
  const classes = new Map<string, Player[]>();
  for (const p of Object.values(league.players)) {
    if (p.teamId === null || p.experience >= DRAFT_HISTORY) continue;
    const key = `${p.teamId}:${p.experience}`;
    classes.set(key, [...(classes.get(key) ?? []), p]);
  }
  for (let exp = 0; exp < DRAFT_HISTORY; exp++) {
    order.forEach((teamId, slot) =>
      (classes.get(`${teamId}:${exp}`) ?? [])
        .map((p) => ({ p, grade: playerOvr(p) - exp * 0.6 + rng.normal(0, 1) }))
        .sort((a, b) => b.grade - a.grade)
        .slice(0, DRAFT_ROUNDS)
        .forEach(({ p }, round) => {
          if (exp < OPTION_CLASS || round === 0)
            p.draft = { season: season - exp, round: round + 1, pick: round * 32 + slot + 1, teamId };
        }),
    );
  }
}

/**
 * Years left on a veteran's deal by his age (weights for 1, 2, 3, 4 and 5), as a settled league carries them at
 * kickoff (its 4th to 6th kickoffs over eight six-season runs): a young veteran has just signed his long second
 * deal, a 30-year-old is in the last year or two of his. Minimum deals: the old sign a year at a time, young depth
 * for three to five like an undrafted rookie. Drawn by talent alone, a new league's deals ran 2.1-2.3 years at every
 * age: over a third of its veterans in their prime were a year from free agency, its money a year from leaving.
 */
const YEARS_LEFT: { upTo: number; market: number[]; minimum: number[] }[] = [
  { upTo: 25, market: [0, 0, 0, 17, 83], minimum: [40, 2, 10, 24, 24] },
  { upTo: 26, market: [0, 0, 8, 59, 33], minimum: [63, 2, 8, 19, 8] },
  { upTo: 27, market: [0, 5, 40, 42, 13], minimum: [58, 6, 17, 15, 4] },
  { upTo: 28, market: [4, 35, 44, 16, 1], minimum: [44, 24, 23, 9, 0] },
  { upTo: 29, market: [35, 44, 18, 2, 1], minimum: [48, 33, 16, 3, 0] },
  { upTo: 30, market: [53, 39, 6, 2, 0], minimum: [66, 26, 5, 3, 0] },
  { upTo: 31, market: [61, 27, 9, 3, 0], minimum: [75, 17, 7, 1, 0] },
  { upTo: 32, market: [62, 32, 6, 0, 0], minimum: [83, 14, 3, 0, 0] },
  { upTo: 34, market: [73, 24, 3, 0, 0], minimum: [91, 8, 1, 0, 0] },
  { upTo: Infinity, market: [80, 20, 0, 0, 0], minimum: [100, 0, 0, 0, 0] },
];

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
  // A league already in motion: each veteran is somewhere inside a deal, with the years left a player his age has.
  const floor = marketApy(market, player) <= minSalary(exp, market.cap);
  const row = YEARS_LEFT.find((r) => player.age <= r.upTo)!;
  const weights = floor ? row.minimum : row.market;
  const remaining = rng.weighted([1, 2, 3, 4, 5], (k) => weights[k - 1]);
  // His first deal after the rookie one started at four years in.
  const elapsed = rng.int(0, Math.min(5 - remaining, exp - 4));
  const then = { ...market, cap: capThen(elapsed) };
  const younger = { ...player, age: player.age - elapsed, experience: exp - elapsed };
  const apyK = floor ? minSalary(younger.experience, then.cap) : marketApy(then, younger) * rng.float(0.85, 1.15);
  const c = veteranContract(rng, then, younger, apyK, remaining + elapsed, season - elapsed, gm);
  c.signedSeason = season - elapsed;
  trimPast(c, season);
  return c;
}

/** The most `fitPayroll` scales a roster's pay above the minimum: past it, what's missing comes as raises. */
const MAX_SCALE = 1.5;

/**
 * Nudge veteran money so a team's opening payroll lands near `target`, never over the cap. Rookie deals stay
 * slotted.
 *
 * A roster over its target fits the way a capped-out front office does (`aiCapCompliance`): it restructures, the
 * biggest savings first, which moves money into later years as a settled league's restructures have (its
 * multi-year deals charge 14% more next year than this); only what that can't fit comes off pay. A roster under it
 * scales pay above the minimum, every year of a deal alike, by at most 1.5 and never past a position's top of the
 * market, so the market, not the cap, decides what stars earn (a scale up to 2.5 left ten deals a league at twice
 * the market into the next season; a settled league has five).
 *
 * A roster still short takes the rest as raises over each deal's remaining years: a front-load into this year
 * alone opened the next with 57-64% of the cap committed against a settled league's 73, and the room went to
 * whoever hoarded it. The raises go by pay above the minimum, and no year's charge passes the position's top of the
 * market, four times the deal's average in its last year, or twice the player's market in a deal with years to run
 * (past that a deal is dead weight into next season); what a capped player can't take goes to the rest, so a thin
 * roster's room doesn't land on one man. A team still short once every such deal is full raises its
 * minimum-salary veterans too, then lets any deal run up to the position's top: it stops only when nobody has room
 * left (one that stopped at its above-minimum veterans opened at 71.7% of the cap).
 */
export function fitPayroll(players: Player[], season: number, target: number, market: Market): void {
  const vets = players.filter((p) => p.contract!.kind !== 'rookie');
  const fixed = players
    .filter((p) => p.contract!.kind === 'rookie')
    .reduce((s, p) => s + capHit(p.contract!, season), 0);
  const aim = Math.min(target, BASE_CAP * 0.985);
  const min = (p: Player) => minSalary(p.experience, BASE_CAP);
  const top = (p: Player) => TOP_APY_PCT[p.position] * BASE_CAP;
  const hit = (p: Player) => capHit(p.contract!, season);
  const payroll = () => vets.reduce((s, p) => s + hit(p), 0);
  const restructuring = (p: Player) => restructurePreview(p.contract!, season, Infinity, min(p));
  let over = fixed + payroll() - aim;
  for (const p of vets
    .filter((p) => p.contract!.kind === 'veteran' && restructuring(p).savings > 0)
    .sort((a, b) => restructuring(b).savings - restructuring(a).savings)) {
    if (over <= 0) break;
    over -= restructure(p.contract!, season, over / (1 - 1 / restructuring(p).years), min(p));
  }
  const floor = vets.reduce((s, p) => s + min(p), 0);
  const current = payroll();
  if (current > floor) {
    const factor = Math.min(
      clamp((target - fixed - floor) / (current - floor), 0.75, MAX_SCALE),
      (aim - fixed - floor) / (current - floor),
    );
    for (const p of vets) {
      const c = p.contract!;
      // An overpaid roster still pays by position: nobody's raise takes him past his position's top of the market.
      const f =
        factor > 1 && c.apy > min(p) ? Math.min(factor, Math.max(1, (top(p) - min(p)) / (c.apy - min(p)))) : factor;
      for (const y of c.years) {
        if (y.void) continue;
        y.base = Math.round(min(p) + Math.max(0, y.base - min(p)) * f);
        y.guaranteed = Math.min(y.base, Math.round(y.guaranteed * f));
      }
      for (const b of c.bonuses) b.amount = Math.round(b.amount * f);
      c.apy = Math.round(min(p) + Math.max(0, c.apy - min(p)) * f);
    }
  }
  let short = aim - fixed - payroll();
  if (short <= 1) return;
  const real = (p: Player) => p.contract!.years.filter((y) => !y.void);
  const above = (p: Player) => Math.max(0, (yearOf(p.contract!, season)?.base ?? 0) - min(p));
  const average = new Map(vets.map((p) => [p, p.contract!.apy]));
  const worth = new Map(vets.map((p) => [p, marketApy(market, p)]));
  const capped = (p: Player) => Math.min(top(p), real(p).length > 1 ? 2 * worth.get(p)! : 4 * average.get(p)!);
  const stages = [
    { weight: above, most: capped },
    { weight: hit, most: capped },
    { weight: hit, most: top },
  ];
  for (const { weight, most } of stages) {
    for (let pass = 0; pass < 6 && short > 1; pass++) {
      const room = new Map(
        vets.map((p) => {
          const years = real(p);
          return [
            p,
            years.length ? Math.max(0, Math.min(...years.map((y) => most(p) - capHit(p.contract!, y.season)))) : 0,
          ];
        }),
      );
      const open = vets.filter((p) => room.get(p)! >= 1 && weight(p) > 0);
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
}

const GM_ARCHETYPES: GmTraits[] = [
  {
    archetype: 'Cap Magician',
    winNow: 0.7,
    capAggression: 0.9,
    pickChart: 'analytics',
    futureDiscount: 0.2,
    loyalty: 0.8,
    stubbornness: 0.3,
  },
  {
    archetype: 'All-In',
    winNow: 0.95,
    capAggression: 0.7,
    pickChart: 'johnson',
    futureDiscount: 0.38,
    loyalty: 0.4,
    stubbornness: 0.2,
  },
  {
    archetype: 'Draft and Develop',
    winNow: 0.35,
    capAggression: 0.2,
    pickChart: 'analytics',
    futureDiscount: 0.18,
    loyalty: 0.6,
    stubbornness: 0.5,
  },
  {
    archetype: 'Can-Kicker',
    winNow: 0.75,
    capAggression: 0.85,
    pickChart: 'johnson',
    futureDiscount: 0.3,
    loyalty: 0.5,
    stubbornness: 0.3,
  },
  {
    archetype: 'Hard-Liner',
    winNow: 0.55,
    capAggression: 0.3,
    pickChart: 'johnson',
    futureDiscount: 0.3,
    loyalty: 0.2,
    stubbornness: 0.9,
  },
  {
    archetype: 'Pick Hoarder',
    winNow: 0.2,
    capAggression: 0.2,
    pickChart: 'analytics',
    futureDiscount: 0.15,
    loyalty: 0.3,
    stubbornness: 0.6,
  },
  {
    archetype: 'Balanced',
    winNow: 0.5,
    capAggression: 0.5,
    pickChart: 'johnson',
    futureDiscount: 0.25,
    loyalty: 0.5,
    stubbornness: 0.5,
  },
];

export function generateGm(rng: Rng): GmTraits {
  const a = rng.pick(GM_ARCHETYPES);
  const j = (v: number) => Math.round(clamp(v + rng.normal(0, 0.08), 0, 1) * 100) / 100;
  return {
    ...a,
    winNow: j(a.winNow),
    capAggression: j(a.capAggression),
    loyalty: j(a.loyalty),
    stubbornness: j(a.stubbornness),
    futureDiscount: clamp(j(a.futureDiscount), 0.15, 0.4),
  };
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
      staffBudgetMult: 1,
      staffDead: [],
      coachDead: [],
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
  for (const team of league.teams) {
    const roster = Object.values(league.players).filter((p) => p.teamId === team.id);
    for (const p of roster) {
      p.contract = initialContract(rng, league, market, p, season, team.gm);
      p.contract.signedWeek = -1; // part of the world as generated: no trade cooldown
    }
    // Some room for the season's injury signings and deadline deals: a new league aimed at 94-99% of the cap (a
    // settled league's kickoff level) traded 10 times in season against 14 at 90-99%, and its structure, not its
    // level, keeps a team from hoarding what's left (most room at a seasons 1-4 kickoff 23% on 15 seeds).
    fitPayroll(roster, season, SALARY_CAP * rng.float(0.9, 0.99), market);
  }

  for (let y = 1; y <= MAX_FUTURE_DRAFT_YEARS; y++) createDraftPicks(league, season + y);
  league.games = generateSchedule(league, rng);
  league.rngState = rng.getState();
  // Scouting departments, coaching and medical staffs and the officiating crews draw from their own
  // seeded streams: the players and schedule above are unchanged by them.
  generateStaffWorld(league);
  generateCoachingWorld(league);
  generateMedicalWorld(league);
  generateCrews(league);
  return league;
}
