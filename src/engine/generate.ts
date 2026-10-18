import { generateCoachingWorld } from './coaching';
import { FIRST_NAMES, LAST_NAMES } from './data/names';
import { CONFERENCES, DIVISIONS, TEAM_SEEDS } from './data/teams';
import {
  ATTRIBUTE_PROFILES,
  BODY,
  JERSEY_RANGES,
  overall,
  ROSTER_TEMPLATE,
  STARTERS,
} from './positions';
import { recordRatings } from './development';
import { generateMedicalWorld } from './medical';
import { generateCrews } from './officials';
import { buildContract, capHit, trimPast } from './finance/contract';
import { BASE_CAP, guaranteeAsk, leagueMarket, marketApy, minSalary, rookieApy, rookieBonusShare, type Market } from './finance/market';
import { clamp, Rng } from './rng';
import { buildAutoDepthChart } from './roster';
import { generateCombine, SCOUT_POINTS_PER_YEAR } from './scouting';
import { generateSchedule } from './season/schedule';
import { generateStaffWorld } from './staff';
import { generateQuirks } from './quirks';
import { generateTraits } from './traits';
import type { Contract, DraftPick, GmTraits, League, Personality, Player, Position, Ratings, Team } from './types';
import { ATTRIBUTES, POSITIONS } from './types';

export const SAVE_VERSION = 15;
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

  const player: Player = {
    id: spec.id,
    firstName: rng.pick(FIRST_NAMES),
    lastName: rng.pick(LAST_NAMES),
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
    traits: { workEthic: 0, durability: 0, temperament: 0, injuryResistance: 0, naturalFitness: 0 },
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
  const c = buildContract({ years: 4, total, signingBonus: bonus, guaranteedBase, voidYears: 0, escalator: 0.08 }, draftSeason, 'rookie', min);
  if (round === 1) c.fifthYearOption = 'eligible';
  return c;
}

/**
 * Standard veteran structure: bigger deals carry a bigger signing bonus and early guarantees;
 * cap-aggressive front offices push money into void years.
 */
export function veteranContract(rng: Rng, market: Market, player: Player, apyK: number, years: number, start: number, gm: GmTraits, signedWeek = 0): Contract {
  const cap = market.cap;
  const total = apyK * years;
  const share = apyK > 0.04 * cap ? rng.float(0.28, 0.45) : apyK > 0.012 * cap ? rng.float(0.1, 0.28) : rng.float(0, 0.08);
  const bonus = total * clamp(share + (gm.capAggression - 0.5) * 0.15, 0, 0.6);
  const gtdShare = guaranteeAsk(market, player) * rng.float(0.8, 1.1);
  const guaranteedBase = Math.max(0, total * gtdShare - bonus);
  const voidYears = years < 5 && gm.capAggression > 0.75 && bonus > 0.03 * cap && rng.chance(0.6) ? rng.int(1, Math.min(3, 5 - years)) : 0;
  const kind = apyK <= minSalary(player.experience, cap) * 1.05 ? 'minimum' : 'veteran';
  return buildContract({ years, total, signingBonus: bonus, guaranteedBase, voidYears, escalator: rng.float(0.02, 0.07) }, start, kind, minSalary(player.experience, cap), signedWeek);
}

/** Draft slot implied by a young player's quality when the league is created (history is invented). */
function syntheticPick(rng: Rng, ovr: number): number {
  return Math.round(clamp(262 - (ovr - 6) * 26 + rng.normal(0, 22), 1, 262));
}

/** Contracts for the league's opening rosters: rookie deals for young players, market deals for veterans. */
function initialContract(rng: Rng, market: Market, player: Player, season: number, gm: GmTraits): Contract {
  const exp = player.experience;
  const ovr = overall(player.ratings, player.position);
  if (exp < 4) {
    const draftSeason = season - exp;
    const capThen = Math.round(BASE_CAP / 1.07 ** exp);
    const pick = syntheticPick(rng, ovr - exp * 0.6);
    let c: Contract;
    if (pick <= DRAFT_ROUNDS * 32) {
      c = rookieContract(pick, draftSeason, capThen);
      player.draft = { season: draftSeason, round: Math.ceil(pick / 32), pick, teamId: player.teamId! };
    } else {
      // Undrafted: minimum salaries and a token bonus.
      const min = minSalary(0, capThen);
      c = buildContract({ years: 3, total: min * 3 + rng.int(0, 40), signingBonus: rng.int(0, 40), guaranteedBase: 0, voidYears: 0, escalator: 0.08 }, draftSeason, 'rookie', min);
    }
    if (c.fifthYearOption === 'eligible' && exp === 3) c.fifthYearOption = 'declined';
    trimPast(c, season);
    if (c.years.some((y) => !y.void)) return c;
    // An undrafted deal that has run out: he's back on a one- or two-year minimum.
    const min = minSalary(exp, BASE_CAP);
    const years = rng.int(1, 2);
    return buildContract({ years, total: min * years, signingBonus: 0, guaranteedBase: 0, voidYears: 0, escalator: 0 }, season, 'minimum', min);
  }
  const remaining = ovr >= 14 ? rng.int(2, 5) : rng.int(1, 3);
  const elapsed = rng.int(0, Math.min(2, Math.max(0, 5 - remaining)));
  const years = remaining + elapsed;
  const capThen = Math.round(BASE_CAP / 1.07 ** elapsed);
  const younger = { ...player, age: player.age - elapsed, experience: exp - elapsed };
  const then = { ...market, cap: capThen };
  const apyK = marketApy(then, younger) * rng.float(0.85, 1.15);
  const c = veteranContract(rng, then, younger, apyK, years, season - elapsed, gm);
  c.signedSeason = season - elapsed;
  trimPast(c, season);
  return c;
}

/**
 * Nudge veteran money so a team's opening payroll lands near `target`. Rookie deals stay
 * slotted, and the nudge is bounded so the market, not the cap, decides what stars earn.
 */
function fitPayroll(players: Player[], season: number, target: number): void {
  const vets = players.filter((p) => p.contract!.kind !== 'rookie');
  const fixed = players.filter((p) => p.contract!.kind === 'rookie').reduce((s, p) => s + capHit(p.contract!, season), 0);
  const floor = vets.reduce((s, p) => s + minSalary(p.experience, BASE_CAP), 0);
  const current = vets.reduce((s, p) => s + capHit(p.contract!, season), 0);
  if (current <= floor) return;
  let factor = clamp((target - fixed - floor) / (current - floor), 0.75, 1.5);
  // Never open a league over the cap.
  const ceiling = (BASE_CAP * 0.985 - fixed - floor) / (current - floor);
  factor = Math.min(factor, ceiling);
  for (const p of vets) {
    const c = p.contract!;
    const min = minSalary(p.experience, BASE_CAP);
    for (const y of c.years) {
      if (y.void) continue;
      y.base = Math.round(min + Math.max(0, y.base - min) * factor);
      y.guaranteed = Math.min(y.base, Math.round(y.guaranteed * factor));
    }
    for (const b of c.bonuses) b.amount = Math.round(b.amount * factor);
    c.apy = Math.round(min + Math.max(0, c.apy - min) * factor);
  }
}

const GM_ARCHETYPES: GmTraits[] = [
  { archetype: 'Cap Magician', winNow: 0.7, capAggression: 0.9, pickChart: 'analytics', futureDiscount: 0.2, loyalty: 0.8, stubbornness: 0.3 },
  { archetype: 'All-In', winNow: 0.95, capAggression: 0.7, pickChart: 'johnson', futureDiscount: 0.38, loyalty: 0.4, stubbornness: 0.2 },
  { archetype: 'Draft and Develop', winNow: 0.35, capAggression: 0.2, pickChart: 'analytics', futureDiscount: 0.18, loyalty: 0.6, stubbornness: 0.5 },
  { archetype: 'Can-Kicker', winNow: 0.75, capAggression: 0.85, pickChart: 'johnson', futureDiscount: 0.3, loyalty: 0.5, stubbornness: 0.3 },
  { archetype: 'Hard-Liner', winNow: 0.55, capAggression: 0.3, pickChart: 'johnson', futureDiscount: 0.3, loyalty: 0.2, stubbornness: 0.9 },
  { archetype: 'Pick Hoarder', winNow: 0.2, capAggression: 0.2, pickChart: 'analytics', futureDiscount: 0.15, loyalty: 0.3, stubbornness: 0.6 },
  { archetype: 'Balanced', winNow: 0.5, capAggression: 0.5, pickChart: 'johnson', futureDiscount: 0.25, loyalty: 0.5, stubbornness: 0.5 },
];

export function generateGm(rng: Rng): GmTraits {
  const a = rng.pick(GM_ARCHETYPES);
  const j = (v: number) => Math.round(clamp(v + rng.normal(0, 0.08), 0, 1) * 100) / 100;
  return { ...a, winNow: j(a.winNow), capAggression: j(a.capAggression), loyalty: j(a.loyalty), stubbornness: j(a.stubbornness), futureDiscount: clamp(j(a.futureDiscount), 0.15, 0.4) };
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
    faDay: 0,
    knowledge: {},
    scoutPoints: SCOUT_POINTS_PER_YEAR,
    staff: {},
    nextStaffId: 1,
    coaches: {},
    nextCoachId: 1,
    medics: {},
    nextMedicId: 1,
    crews: [],
  };

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

    // Talent varies between franchises, which creates contenders and rebuilders.
    const teamTalent = rng.normal(0, 0.2);
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
  for (const team of league.teams) {
    const roster = Object.values(league.players).filter((p) => p.teamId === team.id);
    for (const p of roster) {
      p.contract = initialContract(rng, market, p, season, team.gm);
      p.contract.signedWeek = -1; // part of the world as generated: no trade cooldown
    }
    fitPayroll(roster, season, SALARY_CAP * rng.float(0.86, 0.96));
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
