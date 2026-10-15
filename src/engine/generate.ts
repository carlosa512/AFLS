import { FIRST_NAMES, LAST_NAMES } from './data/names';
import { CONFERENCES, DIVISIONS, TEAM_SEEDS } from './data/teams';
import {
  ATTRIBUTE_PROFILES,
  BODY,
  JERSEY_RANGES,
  overall,
  POSITION_VALUE,
  ROSTER_TEMPLATE,
  STARTERS,
} from './positions';
import { clamp, Rng } from './rng';
import { buildAutoDepthChart } from './roster';
import { generateSchedule } from './season/schedule';
import type { League, Player, Position, Ratings, Team } from './types';
import { ATTRIBUTES, POSITIONS } from './types';

export const SAVE_VERSION = 1;
/** 2026 salary cap, in thousands of dollars. */
export const SALARY_CAP = 301_200;
/** League-minimum salary, in thousands of dollars. */
export const MIN_SALARY = 885;

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

/** Estimated yearly market value in $K for a player of this position and overall. */
export function marketValue(position: Position, ovr: number): number {
  return Math.max(MIN_SALARY, POSITION_VALUE[position] * 80_000 * Math.exp((ovr - 19) * 0.24));
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

interface PlayerSpec {
  id: number;
  position: Position;
  quality: number;
  age: number;
  teamId: number | null;
  jerseysUsed: Set<number>;
}

export function generatePlayer(rng: Rng, spec: PlayerSpec): Player {
  const { position, age } = spec;
  const ratings = generateRatings(rng, position, spec.quality);
  const ovr = overall(ratings, position);
  const growthYears = Math.max(0, 26 - age);
  const potential = clamp(ovr + growthYears * rng.float(0.2, 1.3) + rng.float(0, 0.8), ovr, 20);
  const [hMin, hMax, wMin, wMax] = BODY[position];
  const experience = Math.max(0, age - 22 + rng.int(-1, 0));

  let salary = marketValue(position, ovr) * rng.float(0.8, 1.2);
  let years: number;
  if (experience < 4) {
    // Rookie-scale deals: cheap relative to value.
    salary *= rng.float(0.12, 0.55);
    years = 4 - experience;
  } else {
    years = ovr >= 14 ? rng.int(2, 5) : rng.int(1, 3);
  }

  return {
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
    contract: { salary: Math.round(Math.max(MIN_SALARY, salary)), years },
    stats: {},
  };
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

/** Scale salaries so total payroll lands at `target` without dropping anyone below the minimum. */
function normalizePayroll(players: Player[], target: number): void {
  const floor = players.length * MIN_SALARY;
  const current = players.reduce((s, p) => s + p.contract.salary, 0);
  if (current <= floor) return;
  const factor = (target - floor) / (current - floor);
  for (const p of players) {
    p.contract.salary = Math.round(MIN_SALARY + (p.contract.salary - MIN_SALARY) * factor);
  }
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
    salaryCap: SALARY_CAP,
    conferences: CONFERENCES.map((c) => ({ ...c })),
    divisions: DIVISIONS.map((d) => ({ ...d })),
    teams: [],
    players: {},
    nextPlayerId: 1,
    games: [],
    nextGameId: 1,
    history: [],
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
        roster.push(player);
        league.players[player.id] = player;
      }
    }
    normalizePayroll(roster, SALARY_CAP * rng.float(0.86, 0.97));
    team.depthChart = buildAutoDepthChart(roster);
  });

  league.games = generateSchedule(league, rng);
  league.rngState = rng.getState();
  return league;
}
