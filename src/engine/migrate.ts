/**
 * Save upgrades. Each step takes a league saved by an older build and reshapes it in place,
 * so careers survive engine changes instead of being thrown away.
 */
import { awardSeason } from './awards';
import { addSpecialTeamsCoordinators, generateCoachingWorld } from './coaching';
import { DIVISIONS, LEGACY_COLORS, LEGACY_FIRST_TEAM, TEAM_SEEDS } from './data/teams';
import { buildContract } from './finance/contract';
import { minSalary } from './finance/market';
import { recordRatings } from './development';
import { generateMedicalWorld } from './medical';
import { addQbProtection, generateCrews } from './officials';
import { createDraftPicks, generateGm, generatePersonality, MAX_FUTURE_DRAFT_YEARS, SAVE_VERSION } from './generate';
import { Rng } from './rng';
import { generateCombine, SCOUT_POINTS_PER_YEAR } from './scouting';
import { generateStaffWorld, setOwnerBudgets } from './staff';
import { playoffSummary } from './records';
import { peopleAtLoad, renamePeople, type PeopleAtLoad } from './rename';
import { rollScheme } from './schemes';
import { assignKickoffs, assignPlayoffKickoffs } from './season/kickoff';
import { PLAYOFF_ROUNDS } from './season/playoffs';
import { addStats, statSeasons } from './stats';
import { generateQuirks } from './quirks';
import { generateTraits } from './traits';
import type { Injury, League, StatLine, TradeMarket } from './types';

/** Returns the upgraded league, or null if the save is from a newer (unknown) version. */
export function migrateLeague(league: League): League | null {
  if (typeof league.version !== 'number' || league.version > SAVE_VERSION) return null;
  renameLegacyTeams(league);
  // who the save held as it loaded, before the steps below add anyone (the names pass, v27, reads it)
  const atLoad = league.version < 27 ? peopleAtLoad(league) : null;
  if (league.version < 2) toV2(league);
  if (league.version < 3) toV3(league);
  if (league.version < 4) toV4(league);
  if (league.version < 5) toV5(league);
  if (league.version < 6) toV6(league);
  if (league.version < 7) toV7(league);
  if (league.version < 8) toV8(league);
  if (league.version < 9) toV9(league);
  if (league.version < 10) toV10(league);
  if (league.version < 11) toV11(league);
  if (league.version < 12) league.version = 12; // v12: optional `form` on players and game results, nothing to fill in
  if (league.version < 13) toV13(league);
  if (league.version < 14) league.version = 14; // v14: optional `weather` on game results, nothing to fill in
  if (league.version < 15) toV15(league);
  if (league.version < 16) league.version = 16; // v16: declined and offsetting flags, players' penalties: optional, nothing to fill in
  if (league.version < 17) toV17(league);
  if (league.version < 18) league.version = 18; // v18: optional `returners` on teams and special-teams flags, nothing to fill in
  if (league.version < 19) toV19(league);
  if (league.version < 20) league.version = 20; // v20: optional `inbox`, filled (already read) on the first delivery
  if (league.version < 21) toV21(league);
  if (league.version < 22) toV22(league);
  if (league.version < 23) league.version = 23; // v23: optional `market` on the league and `stance` on teams, filled by the first market moment
  if (league.version < 24) league.version = 24; // v24: optional `archived` and `deleted` on inbox messages, set by the user
  if (league.version < 25) toV25(league);
  if (league.version < 26) league.version = 26; // v26: optional `woman` on scouts and medics, set at creation (absent = a man)
  if (atLoad) toV27(league, atLoad); // last: the earlier steps seed new fields from the old names
  if (league.version < 28) toV28(league);
  if (league.version < 29) league.version = 29; // v29: optional `protocol` on concussions and `held` on records, nothing to fill in
  if (league.version < 30) toV30(league);
  if (league.version < 31) toV31(league);
  if (league.version < 32) league.version = 32; // v32: optional `dev` on players (a year of development still landing) and `idle` on market coaches, scouts and medics, nothing to fill in
  if (league.version < 33) toV33(league);
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
  for (const h of league.history)
    if (!h.playoffs && league.games.some((g) => g.season === h.season && g.playoffRound && g.result))
      h.playoffs = playoffSummary(league, h.season);

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
    if (seasons.length)
      c.career = seasons.map((h) => ({
        season: h.season,
        teamId: c.teamId!,
        role: c.role,
        ...(c.room ? { room: c.room } : {}),
      }));
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

/** v10 → v11: quirks, rolled from each player's own seed, the same history a new league would give him. */
function toV11(league: League) {
  for (const p of Object.values(league.players)) if (!p.retired && !p.quirkBag) generateQuirks(p);
  league.version = 11;
}

/**
 * v30 → v31: position moves (`learning`, `moves`, `training`: optional, nothing to fill in) and the
 * versatility trait, rolled from each player's own seed after the others, so he gets what a new league
 * would give him.
 */
/** v33: a retired player drops the ratings-by-year log (retirement now does this), so old saves shrink too. */
function toV33(league: League) {
  for (const p of Object.values(league.players)) if (p.retired) delete p.ratingHistory;
  league.version = 33;
}

function toV31(league: League) {
  for (const p of Object.values(league.players))
    if (p.traits.versatility === undefined) p.traits.versatility = generateTraits(p).versatility;
  league.version = 31;
}

/**
 * v12 → v13: injuries. Two more hidden traits, rolled from each player's own seed after the old ones
 * (so those don't move and he gets what a new league would give him), and a medical staff for every
 * team from its own stream. Everyone starts healthy and fresh.
 */
function toV13(league: League) {
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
  league.version = 13;
}

/**
 * v14 → v15: officiating crews, the same ones a new league would get from this seed. Games already
 * played keep no crew and no penalties by kind, so the crews' numbers start with the next game.
 */
function toV15(league: League) {
  if (!league.crews?.length) generateCrews(league);
  league.version = 15;
}

/** v16 → v17: the crews' fourth tendency, QB Protection, as a new league from this seed would roll it. */
function toV17(league: League) {
  addQbProtection(league);
  league.version = 17;
}

/** v18 → v19: the special teams coordinator, a new chair: every team hires one, and the market gets candidates. */
function toV19(league: League) {
  addSpecialTeamsCoordinators(league);
  league.version = 19;
}

/** v20 → v21: a drafted player keeps his consensus rank; fill it in from the picks not yet pruned. */
function toV21(league: League) {
  for (const pk of league.draftPicks) {
    const d = pk.playerId !== undefined ? league.players[pk.playerId]?.draft : undefined;
    if (d && pk.consRank !== undefined) d.rank = pk.consRank;
  }
  league.version = 21;
}

/**
 * v21 → v22: an archive for coaches leaving football (those who left before this build are already gone), and owners
 * who spend what their markets earn (`ownerBudgets`), the user's own included, where older saves rolled them at
 * random. Coaches may now carry a `playerId` (former players) and teams a `coachOverspent` year: nothing to fill in.
 */
function toV22(league: League) {
  league.retiredCoaches ??= {};
  setOwnerBudgets(league);
  league.version = 22;
}

/** v25: offers to you, your players' statuses and your dealings with each GM join the market (empty to start). */
function toV25(league: League): void {
  const market = league.market as (Partial<TradeMarket> & Pick<TradeMarket, 'moment'>) | undefined;
  if (market)
    Object.assign(market, {
      nextOfferId: market.nextOfferId ?? 1,
      offers: market.offers ?? [],
      status: market.status ?? {},
      talks: market.talks ?? {},
      shopped: market.shopped ?? {},
    });
  league.version = 25;
}

/** v27: the names pass. Everyone the old pools named is renamed from the heritage pools, the stored text with them. */
function toV27(league: League, atLoad: PeopleAtLoad): void {
  renamePeople(league, atLoad);
  league.version = 27;
}

/** v30: kickoff times. This season's games get their slots; earlier seasons' stay as they were played. */
function toV30(league: League): void {
  const season = league.games.filter((g) => g.season === league.season);
  assignKickoffs(
    league,
    season.filter((g) => !g.playoffRound),
    league.season,
  );
  for (const round of PLAYOFF_ROUNDS) {
    const games = season.filter((g) => g.playoffRound === round);
    if (games.length) assignPlayoffKickoffs(league, games, round);
  }
  league.version = 30;
}

/** v28: treatments. Playing through an injury on injections was a flag; it is now one treatment of three. */
function toV28(league: League): void {
  for (const p of Object.values(league.players)) {
    const inj = p.injury as (Injury & { injected?: boolean }) | undefined;
    if (!inj || !('injected' in inj)) continue;
    if (inj.injected) inj.treatment = 'injection';
    delete inj.injected;
  }
  league.version = 28;
}
