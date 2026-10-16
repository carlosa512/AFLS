/**
 * Save upgrades. Each step takes a league saved by an older build and reshapes it in place,
 * so careers survive engine changes instead of being thrown away.
 */
import { DIVISIONS, LEGACY_FIRST_TEAM, TEAM_SEEDS } from './data/teams';
import { buildContract } from './finance/contract';
import { minSalary } from './finance/market';
import { recordRatings } from './development';
import { createDraftPicks, generateGm, generatePersonality, MAX_FUTURE_DRAFT_YEARS, SAVE_VERSION } from './generate';
import { Rng } from './rng';
import { generateCombine, SCOUT_POINTS_PER_YEAR } from './scouting';
import type { League } from './types';

/** Returns the upgraded league, or null if the save is from a newer (unknown) version. */
export function migrateLeague(league: League): League | null {
  if (typeof league.version !== 'number' || league.version > SAVE_VERSION) return null;
  renameLegacyTeams(league);
  if (league.version < 2) toV2(league);
  if (league.version < 3) toV3(league);
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
