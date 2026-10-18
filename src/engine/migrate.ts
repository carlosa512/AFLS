/**
 * Save upgrades. Each step takes a league saved by an older build and reshapes it in place,
 * so careers survive engine changes instead of being thrown away.
 */
import { awardSeason } from './awards';
import { generateCoachingWorld } from './coaching';
import { DIVISIONS, LEGACY_COLORS, LEGACY_FIRST_TEAM, TEAM_SEEDS } from './data/teams';
import { buildContract } from './finance/contract';
import { minSalary } from './finance/market';
import { recordRatings } from './development';
import { generateMedicalWorld } from './medical';
import { createDraftPicks, generateGm, generatePersonality, MAX_FUTURE_DRAFT_YEARS, SAVE_VERSION } from './generate';
import { Rng } from './rng';
import { generateCombine, SCOUT_POINTS_PER_YEAR } from './scouting';
import { generateStaffWorld } from './staff';
import { playoffSummary } from './records';
import { rollScheme } from './schemes';
import { addStats, statSeasons } from './stats';
import { generateTraits } from './traits';
import type { League, StatLine } from './types';

/** Returns the upgraded league, or null if the save is from a newer (unknown) version. */
export function migrateLeague(league: League): League | null {
  if (typeof league.version !== 'number' || league.version > SAVE_VERSION) return null;
  renameLegacyTeams(league);
  if (league.version < 2) toV2(league);
  if (league.version < 3) toV3(league);
  if (league.version < 4) toV4(league);
  if (league.version < 5) toV5(league);
  if (league.version < 6) toV6(league);
  if (league.version < 7) toV7(league);
  if (league.version < 8) toV8(league);
  if (league.version < 9) toV9(league);
  if (league.version < 10) toV10(league);
  if (league.version < 12) toV12(league);
  return league;
}

/** Saves made before the switch to real NFL markets (same ids and divisions). */
function renameLegacyTeams(league: League) {
  const first = league.teams[0];
  if (first?.city === LEGACY_FIRST_TEAM.city && first.name === LEGACY_FIRST_TEAM.name) {
    league.teams.forEach((team, i) => {
      const seed = TEAM_SEEDS[i];
      Object.assign(team, { city: seed.city, name: seed.name, abbrev: seed.abbrev, colors: [...seed.colors] });
    });
    league.divisions.forEach((d, i) => (d.name = DIVISIONS[i].name));
  }
}

/** v1 → v2: year-by-year contracts, cap ledger, GM traits, draft picks, transactions. */
function toV2(league: League) {
  const rng = new Rng(`${league.seed}:migrate-v2`);
  const legacy = league as unknown as { salaryCap?: number };
  const cap = legacy.salaryCap ?? 301_200;
  delete legacy.salaryCap;
  league.caps = { [league.season]: cap };
  for (const team of league.teams) {
    team.deadMoney = [];
    team.carryover = 0;
    team.postJune1Used = 0;
    team.taggedId = null;
    team.gm = generateGm(rng);
  }
  for (const p of Object.values(league.players)) {
    const old = p.contract as unknown as { salary: number; years: number } | null;
    p.personality = generatePersonality(rng);
    if (p.teamId === null || !old) {
      // v1 had no free agency: anyone without a team had retired.
      p.retired = true;
      p.contract = null;
      continue;
    }
    const years = Math.max(1, old.years);
    p.contract = buildContract(
      { years, total: old.salary * years, signingBonus: 0, guaranteedBase: 0, voidYears: 0, escalator: 0 },
      league.season,
      p.experience < 4 ? 'rookie' : 'veteran',
      minSalary(p.experience, cap),
    );
    p.contract.signedSeason = league.season - 1;
  }
  league.draftPicks = [];
  league.nextPickId = 1;
  for (let y = 1; y <= MAX_FUTURE_DRAFT_YEARS; y++) createDraftPicks(league, league.season + y);
  league.draftClass = [];
  league.transactions = [];
  league.negotiations = {};
  league.faDay = 0;
  league.version = 2;
}

/** v2 → v3: scouting knowledge and budget, combine results, and a first ratings snapshot. */
function toV3(league: League) {
  league.knowledge = {};
  league.scoutPoints = SCOUT_POINTS_PER_YEAR;
  for (const p of Object.values(league.players)) {
    p.combine ??= generateCombine(p);
    if (!p.retired) recordRatings(p, league.season);
  }
  league.version = 3;
}

/** v3 → v4: scouting departments for every team, and the staff market. */
function toV4(league: League) {
  if (!league.staff || !Object.keys(league.staff).length) {
    league.staff = {};
    league.nextStaffId = 1;
    generateStaffWorld(league);
  }
  league.version = 4;
}

/** v5: hidden traits (work ethic, durability, temperament), seeded per player so an upgraded save matches a new one. */
function toV5(league: League) {
  for (const p of Object.values(league.players)) p.traits ??= generateTraits(p);
  league.version = 5;
}

/**
 * v6: coaching staffs for every team, and the coaching market, from their own seeded streams (the
 * league's stream is untouched). A save still in its opening season gets exactly a new league's
 * staffs; a later one gets staffs of the same kind, signed from its current league year.
 */
function toV6(league: League) {
  if (!league.coaches || !Object.keys(league.coaches).length) {
    league.coaches = {};
    league.nextCoachId = 1;
    generateCoachingWorld(league);
  }
  for (const team of league.teams) team.coachDead ??= [];
  league.version = 6;
}

/**
 * v7: season awards. Every finished regular season is voted from the stats the save already keeps;
 * clubs come from the box scores where they survive (the last two seasons), else a player's current
 * team if he was signed by then.
 */
function toV7(league: League) {
  league.awards ??= [];
  const done = league.phase === 'regular' ? league.season - 1 : league.season;
  for (const season of statSeasons(league).reverse()) if (season <= done) awardSeason(league, season);
  league.version = 7;
}

/** v8: players of the week and month. Only winners are stored, and older saves simply start without any. */
function toV8(league: League) {
  league.weeklyAwards ??= [];
  league.version = 8;
}

/**
 * v8 → v9: team colours that follow the real clubs (unless a mod set its own), stats by team, playoff runs and coaching careers. Only the seasons whose games are still on
 * file (the last one or two) can be rebuilt exactly; earlier seasons stay without a team rather than guessing.
 * Coaches get their current chair back to the year they joined (`since`), the best the old save knows.
 */
function toV9(league: League) {
  for (const team of league.teams) {
    const legacy = LEGACY_COLORS[team.abbrev];
    const seed = TEAM_SEEDS.find((t) => t.abbrev === team.abbrev);
    if (legacy && seed && team.colors[0] === legacy[0] && team.colors[1] === legacy[1]) team.colors = [...seed.colors];
  }
  for (const h of league.history) if (!h.playoffs && league.games.some((g) => g.season === h.season && g.playoffRound && g.result)) h.playoffs = playoffSummary(league, h.season);

  const byPlayer = new Map<number, Map<number, Map<number, StatLine>>>();
  for (const g of [...league.games].sort((a, b) => a.season - b.season || a.week - b.week)) {
    if (!g.result || g.playoffRound) continue;
    for (const [id, line] of Object.entries(g.result.playerStats)) {
      const teamId = g.result.playerTeams[Number(id)];
      if (teamId === undefined) continue;
      const seasons = byPlayer.get(Number(id)) ?? byPlayer.set(Number(id), new Map()).get(Number(id))!;
      const teams = seasons.get(g.season) ?? seasons.set(g.season, new Map()).get(g.season)!;
      addStats(teams.get(teamId) ?? teams.set(teamId, {}).get(teamId)!, line);
    }
  }
  for (const [id, seasons] of byPlayer) {
    const p = league.players[id];
    if (!p) continue;
    for (const [season, teams] of seasons) {
      (p.statTeams ??= {})[season] = [...teams.keys()];
      if (teams.size > 1) (p.splitStats ??= {})[season] = Object.fromEntries(teams);
    }
  }

  for (const c of Object.values(league.coaches)) {
    if (c.teamId === null || c.since === undefined) continue;
    const seasons = league.history.filter((h) => h.season >= c.since!);
    if (seasons.length) c.career = seasons.map((h) => ({ season: h.season, teamId: c.teamId!, role: c.role, ...(c.room ? { room: c.room } : {}) }));
  }
  league.version = 9;
}

/** v9 → v10: coordinators get their schemes, the same ones a new league would roll for them. */
function toV10(league: League) {
  for (const c of Object.values(league.coaches ?? {})) {
    const scheme = rollScheme(league.seed, c);
    if (scheme && !c.scheme) c.scheme = scheme;
  }
  league.version = 10;
}

/**
 * → v12: injuries. Two more hidden traits, rolled from each player's own seed after the old ones (so
 * those don't move and he gets what a new league would give him), and a medical staff for every team
 * from its own stream. Everyone starts healthy and fresh.
 */
function toV12(league: League) {
  for (const p of Object.values(league.players)) {
    if (p.traits.injuryResistance !== undefined) continue;
    const t = generateTraits(p);
    p.traits.injuryResistance = t.injuryResistance;
    p.traits.naturalFitness = t.naturalFitness;
  }
  if (!league.medics) {
    league.medics = {};
    league.nextMedicId = 1;
    generateMedicalWorld(league);
  }
  league.version = 12;
}
