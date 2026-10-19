/**
 * Scouting departments. Every team employs a Director of scouting plus college scouts (draft
 * prospects) and pro scouts (everyone already in the league). Who reads a player depends on his
 * position group: a scout who specialises in it reads it best, the Director covers any group
 * nobody specialises in. The resulting read sets how wide and how wrong a team's ranges are
 * (see `perceive` in scouting.ts).
 *
 * Staff are paid from a staff budget that is separate from the salary cap, sign 1–3 year deals,
 * and can only be hired or dismissed in the re-sign window and free agency. All staff randomness
 * uses its own seeded Rngs, so it never shifts the league's main random stream.
 */
import { FIRST_NAMES, LAST_NAMES } from './data/names';
import { TEAM_SEEDS } from './data/teams';
import { BASE_CAP } from './finance/market';
import { ROSTER_TEMPLATE } from './positions';
import { clamp, Rng } from './rng';
import type { League, Position, ScoutFocus, Staff, StaffRole, Team } from './types';
import { POSITIONS } from './types';

export type Domain = 'college' | 'pro';
export type StaffTrait = 'evaluation' | 'projection';

export const ROLE_LABEL: Record<StaffRole, string> = { director: 'Director of scouting', collegeScout: 'College scout', proScout: 'Pro scout' };
export const FOCUSES: ScoutFocus[] = ['skill', 'line', 'front', 'back'];
export const FOCUS_LABEL: Record<ScoutFocus, string> = { skill: 'QB · RB · WR · TE', line: 'Offensive line', front: 'DL · LB', back: 'CB · S' };
export const FOCUS_OF: Record<Position, ScoutFocus | null> = {
  QB: 'skill',
  RB: 'skill',
  WR: 'skill',
  TE: 'skill',
  OL: 'line',
  DT: 'front',
  EDGE: 'front',
  LB: 'front',
  CB: 'back',
  S: 'back',
  K: null,
  P: null,
};
/** Most staff a department can hold in each role. */
export const STAFF_SLOTS: Record<StaffRole, number> = { director: 1, collegeScout: 4, proScout: 3 };
export const SCOUT_ROLE: Record<Domain, StaffRole> = { college: 'collegeScout', pro: 'proScout' };

/** An empty chair reads like a bad scout. */
const VACANT = 5;
/** A specialist reads his group better than his rating suggests; off his group, worse. */
const SPECIALTY = 3;
/** The Director reads every group, a step below his rating: he's spread thin. */
const DIRECTOR_PENALTY = 1;
/** The effective read of a typical department: accuracy 1, i.e. the ranges every save had before staff existed. */
const TYPICAL_READ = 12.4;

/**
 * Every hire, dismissal, retirement and new candidate goes through this module and bumps `version`,
 * so the per-team index below can be reused across the thousands of reads an AI pass makes. A
 * loaded save is a new `league.staff` object and simply builds a fresh index.
 */
let version = 0;
const touch = () => void version++;
const index = new WeakMap<Record<number, Staff>, { version: number; byTeam: Map<number, Staff[]> }>();

/** A team's staff. The list is shared and cached: copy it before sorting. */
export function teamStaff(league: League, teamId: number): readonly Staff[] {
  let hit = index.get(league.staff);
  if (!hit || hit.version !== version) {
    const byTeam = new Map<number, Staff[]>();
    for (const s of Object.values(league.staff)) if (s.teamId !== null) byTeam.set(s.teamId, [...(byTeam.get(s.teamId) ?? []), s]);
    index.set(league.staff, (hit = { version, byTeam }));
  }
  return hit.byTeam.get(teamId) ?? [];
}
export const staffMarket = (league: League): Staff[] => Object.values(league.staff).filter((s) => s.teamId === null);
export const staffName = (s: Staff) => `${s.firstName} ${s.lastName}`;

export interface Read {
  /** Effective 1–20 rating of whoever reads this group for the team. */
  rating: number;
  /** null = nobody: the Director's chair is empty. */
  by: Staff | null;
}

/** Who reads a player in `focus` (null for kickers and punters) for this domain and trait. */
export function readFor(staff: readonly Staff[], domain: Domain, focus: ScoutFocus | null, trait: StaffTrait): Read {
  // One Director, except in the re-sign window when a replacement overlaps the man whose deal is up: the better one reads.
  const director = staff.reduce<Staff | null>((best, s) => (s.role === 'director' && (!best || s[trait] > best[trait]) ? s : best), null);
  let best: Read = { rating: (director ? director[trait] : VACANT) - DIRECTOR_PENALTY, by: director };
  if (focus) {
    for (const s of staff) {
      if (s.role !== SCOUT_ROLE[domain]) continue;
      const r = s[trait] + (s.focus === focus ? SPECIALTY : -SPECIALTY);
      if (r > best.rating) best = { rating: r, by: s };
    }
  }
  return { rating: clamp(best.rating, 1, 20), by: best.by };
}

/**
 * How a read scales a team's errors and range widths: 1 for a typical department, halved by six
 * points of read, capped so nobody is clairvoyant or hopeless.
 */
export const accuracy = (read: number) => clamp(2 ** ((TYPICAL_READ - read) / 6), 0.45, 1.9);

// ───────── money ─────────

const BASE_ASK: Record<StaffRole, number> = { director: 1650, collegeScout: 1030, proScout: 1030 };
/** Shorter deals cost more per year; longer ones lock in a discount (and the risk he declines). */
const TERM: Record<number, number> = { 1: 1.1, 2: 1, 3: 0.95 };

/** One number for what a staff member is worth in his role: pro scouts mostly evaluate, college scouts also project. */
export function staffValue(s: Staff): number {
  if (s.role === 'director') return 0.5 * s.evaluation + 0.5 * s.projection;
  if (s.role === 'collegeScout') return 0.55 * s.evaluation + 0.45 * s.projection;
  return 0.8 * s.evaluation + 0.2 * s.projection;
}

const capOf = (league: League) => league.caps[league.season] ?? BASE_CAP;

/** Salary he asks for, $K per year: convex in quality, scaled with the cap. */
export function staffAsk(league: League, s: Staff, years = 2): number {
  return Math.round(BASE_ASK[s.role] * (capOf(league) / BASE_CAP) * 1.2 ** (staffValue(s) - 10) * TERM[years]);
}

/** The owner's staff budget for this league year, $K. */
export const staffBudget = (league: League, teamId: number) => Math.round(0.032 * capOf(league) * league.teams[teamId].staffBudgetMult);

/** Salaries owed this league year plus severance booked against it. */
export function staffPayroll(league: League, teamId: number): number {
  const pay = teamStaff(league, teamId).reduce((sum, s) => sum + (s.contract && s.contract.through >= league.season ? s.contract.salary : 0), 0);
  return pay + league.teams[teamId].staffDead.filter((d) => d.season === league.season).reduce((sum, d) => sum + d.amount, 0);
}

export const staffRoom = (league: League, teamId: number) => staffBudget(league, teamId) - staffPayroll(league, teamId);

/** His deal ran out last league year: he stays through the re-sign window, then leaves unless extended. */
export const isExpiring = (league: League, s: Staff) => !!s.contract && s.contract.through < league.season;

/** Staff moves happen in the re-sign window and free agency, like the NFL's hiring cycle. */
export const staffWindowOpen = (league: League) => league.phase === 'resign' || league.phase === 'freeAgency';

/** Severance for dismissing him now: half a year's salary, if he's still under contract. */
export const severance = (league: League, s: Staff) => (s.contract && s.contract.through >= league.season ? Math.round(s.contract.salary * 0.5) : 0);

// ───────── moves ─────────

export type StaffMove = 'hire' | 'extend' | 'release';

/** Why a move can't happen right now, or null. */
export function staffMoveProblem(league: League, teamId: number, s: Staff, move: StaffMove, years = 2): string | null {
  if (!staffWindowOpen(league)) return 'Staff moves open in the re-sign window and free agency.';
  if (move === 'release') return s.teamId === teamId ? null : 'He doesn’t work for you.';
  const held = teamStaff(league, teamId).filter((x) => x.role === s.role && !isExpiring(league, x)).length;
  if (move === 'extend') {
    if (s.teamId !== teamId || !isExpiring(league, s)) return 'Only expiring deals can be extended.';
    if (held >= STAFF_SLOTS[s.role]) return `His chair is taken: all ${STAFF_SLOTS[s.role]} ${ROLE_LABEL[s.role].toLowerCase()} jobs are filled.`;
  } else {
    if (s.teamId !== null) return 'He isn’t available.';
    if (held >= STAFF_SLOTS[s.role]) return s.role === 'director' ? 'You already have a Director. Dismiss him first.' : `All ${STAFF_SLOTS[s.role]} ${ROLE_LABEL[s.role].toLowerCase()} jobs are filled.`;
  }
  const over = staffAsk(league, s, years) - staffRoom(league, teamId);
  return over > 0 ? `Over your staff budget by $${(over / 1000).toFixed(2)}M.` : null;
}

function signStaff(league: League, teamId: number, s: Staff, years: number): void {
  touch();
  s.teamId = teamId;
  s.contract = { salary: staffAsk(league, s, years), through: league.season + years - 1 };
}

const logStaff = (league: League, teamId: number, text: string) => {
  if (teamId !== league.userTeamId) return;
  league.transactions.push({ season: league.season, phase: league.phase, week: league.week, teamIds: [teamId], kind: 'staff', text });
};

export function hireStaff(league: League, teamId: number, staffId: number, years = 2): void {
  const s = league.staff[staffId];
  const problem = staffMoveProblem(league, teamId, s, 'hire', years);
  if (problem) throw new Error(problem);
  signStaff(league, teamId, s, years);
  logStaff(league, teamId, `${league.teams[teamId].abbrev} hired ${ROLE_LABEL[s.role].toLowerCase()} ${staffName(s)} (${years} yr)`);
}

export function extendStaff(league: League, teamId: number, staffId: number, years = 2): void {
  const s = league.staff[staffId];
  const problem = staffMoveProblem(league, teamId, s, 'extend', years);
  if (problem) throw new Error(problem);
  signStaff(league, teamId, s, years);
  logStaff(league, teamId, `${league.teams[teamId].abbrev} extended ${ROLE_LABEL[s.role].toLowerCase()} ${staffName(s)} (${years} yr)`);
}

/** Dismiss (or let go) a staff member: he returns to the market; severance is booked if he was under contract. */
export function releaseStaff(league: League, teamId: number, staffId: number): void {
  const s = league.staff[staffId];
  const problem = staffMoveProblem(league, teamId, s, 'release');
  if (problem) throw new Error(problem);
  dismiss(league, s);
}

function dismiss(league: League, s: Staff): void {
  touch();
  const teamId = s.teamId!;
  const owed = severance(league, s);
  if (owed > 0) league.teams[teamId].staffDead.push({ season: league.season, amount: owed, name: staffName(s) });
  logStaff(league, teamId, `${league.teams[teamId].abbrev} ${owed > 0 ? 'dismissed' : 'let go'} ${ROLE_LABEL[s.role].toLowerCase()} ${staffName(s)}`);
  s.teamId = null;
  s.contract = null;
}

// ───────── generation ─────────

const ROLES: StaffRole[] = ['director', 'collegeScout', 'proScout'];
/** Candidates kept on the market for each role. */
const MARKET_SIZE: Record<StaffRole, number> = { director: 8, collegeScout: 16, proScout: 12 };

function newStaff(league: League, rng: Rng, role: StaffRole, evaluation: number, projection: number, age: number, focus?: ScoutFocus): Staff {
  const s: Staff = {
    id: league.nextStaffId++,
    firstName: rng.pick(FIRST_NAMES),
    lastName: rng.pick(LAST_NAMES),
    role,
    age,
    evaluation: Math.round(clamp(evaluation, 1, 20)),
    projection: Math.round(clamp(projection, 1, 20)),
    teamId: null,
    contract: null,
  };
  if (role !== 'director') s.focus = focus ?? rng.pick(FOCUSES);
  league.staff[s.id] = s;
  touch();
  return s;
}

/** A market candidate: experience buys a little skill; some are specialists in reading the present, others the future. */
function candidate(league: League, rng: Rng, role: StaffRole, quality = 0): Staff {
  const age = rng.int(28, 60);
  const base = 9.6 + quality + Math.min(2, 0.07 * (age - 28));
  const lean = rng.normal(0, 1.3);
  return newStaff(league, rng, role, rng.normal(base + lean, 2.3), rng.normal(base - lean, 2.3), age);
}

/** Top the market back up to its usual size. */
function refreshMarket(league: League, rng: Rng): void {
  const market = staffMarket(league);
  for (const role of ROLES) for (let n = market.filter((s) => s.role === role).length; n < MARKET_SIZE[role]; n++) candidate(league, rng, role);
}

/** A goal for each AI front office's staff quality: some invest in scouting, some don't. A persistent trait, not stored. */
const staffGoal = (league: League, team: Team) => 10 + 1.4 * new Rng(`${league.seed}:staff-goal:${team.id}`).normal() + ownerTilt(team);

/**
 * What each owner spends on his staffs (scouting, coaching, medical), ×1 being the league's average owner:
 * his market's revenue on a square-root scale (the richest market about a third over, the leanest about a
 * tenth under), centred on ×1 so the league's staffs stay where they were. A market without a figure (a mod's) is ×1.
 */
export function ownerBudgets(revenues: readonly (number | undefined)[]): number[] {
  const known = revenues.filter((r): r is number => !!r);
  const mean = known.reduce((a, b) => a + b, 0) / (known.length || 1);
  const raw = revenues.map((r) => (r ? Math.sqrt(r / mean) : 1));
  const avg = raw.reduce((a, b) => a + b, 0) / (raw.length || 1);
  return raw.map((x) => Math.round(clamp(x / avg, 0.75, 1.35) * 100) / 100);
}

/** Every team's owner budget from its market (`TEAM_SEEDS`, by abbreviation). */
export function setOwnerBudgets(league: League): void {
  const budgets = ownerBudgets(league.teams.map((t) => TEAM_SEEDS.find((s) => s.abbrev === t.abbrev)?.revenue));
  league.teams.forEach((t, i) => (t.staffBudgetMult = budgets[i]));
}

/** A free-spending owner aims higher when he hires, a frugal one lower (rating points; zero on average). */
export const ownerTilt = (team: Team) => 4 * (team.staffBudgetMult - 1);

/** The owner's spending in words, where it stands out. */
export const ownerBudgetNote = (mult: number) => (mult >= 1.08 ? 'Big-spending owner' : mult <= 0.94 ? 'Tight-budget owner' : null);

/** How many scouts an AI team carries: rebuilders lean on college scouts, contenders on pro scouts. */
function aiTarget(team: Team): Record<StaffRole, number> {
  return { director: 1, collegeScout: team.gm.winNow < 0.4 ? 4 : 3, proScout: team.gm.winNow >= 0.75 ? 3 : 2 };
}

/**
 * The opening league: AI departments of varying quality inside their budgets, and a deliberately
 * typical department for the user with one position group nobody specialises in (a first decision).
 */
export function generateStaffWorld(league: League): void {
  const rng = new Rng(`${league.seed}:staff:init`);
  setOwnerBudgets(league);
  for (const team of league.teams) {
    team.staffDead = [];
    const user = team.id === league.userTeamId;
    const hired: Staff[] = [];
    if (user) {
      const foci = rng.shuffle([...FOCUSES]);
      const proFoci = rng.shuffle([...FOCUSES]);
      hired.push(newStaff(league, rng, 'director', 11, 11, rng.int(44, 56)));
      hired.push(newStaff(league, rng, 'collegeScout', 10, 12, rng.int(30, 50), foci[0]));
      hired.push(newStaff(league, rng, 'collegeScout', 11, 10, rng.int(30, 50), foci[1]));
      hired.push(newStaff(league, rng, 'collegeScout', 10, 11, rng.int(30, 50), foci[2]));
      hired.push(newStaff(league, rng, 'proScout', 12, 10, rng.int(30, 50), proFoci[0]));
      hired.push(newStaff(league, rng, 'proScout', 12, 9, rng.int(30, 50), proFoci[1]));
    } else {
      const tier = (staffGoal(league, team) - 10) * 0.8;
      const target = aiTarget(team);
      hired.push(newStaff(league, rng, 'director', rng.normal(11 + tier, 2.2), rng.normal(11 + tier, 2.2), rng.int(40, 60)));
      for (const role of ['collegeScout', 'proScout'] as const) {
        const foci = rng.shuffle([...FOCUSES]);
        for (let i = 0; i < target[role]; i++) {
          const lean = role === 'proScout' ? 0.6 : -0.4;
          hired.push(newStaff(league, rng, role, rng.normal(10.3 + tier + lean, 2.4), rng.normal(10.3 + tier - lean, 2.4), rng.int(28, 58), foci[i % 4]));
        }
      }
    }
    // Stagger contracts so departments don't all turn over in the same year.
    hired.forEach((s, i) => signStaff(league, team.id, s, user ? (i % 3) + 1 : rng.int(1, 3)));
    // Fit the budget: the priciest member is a little worse than he'd otherwise be.
    for (let guard = 0; guard < 60 && staffRoom(league, team.id) < 0; guard++) {
      const priciest = hired.reduce((a, b) => (b.contract!.salary > a.contract!.salary ? b : a));
      priciest.evaluation = Math.max(1, priciest.evaluation - 1);
      priciest.projection = Math.max(1, priciest.projection - 1);
      priciest.contract!.salary = staffAsk(league, priciest, priciest.contract!.through - league.season + 1);
    }
  }
  refreshMarket(league, rng);
}

// ───────── the yearly cycle ─────────

/** Rising under 35, steady through the 40s, declining from the mid-50s. */
function trend(age: number): number {
  if (age < 35) return 0.35;
  if (age < 45) return 0.15;
  if (age < 55) return 0;
  if (age < 62) return -0.3;
  return -0.6;
}
export const staffTrendLabel = (age: number) => (age < 35 ? 'Rising' : age < 55 ? 'Prime' : 'Declining');

/**
 * New league year: staff age and develop, the old retire, part of the unhired market drifts out of
 * football (otherwise unsigned talent piles up and hiring gets easier every year), and fresh
 * candidates arrive. Old severance is forgotten.
 */
export function developStaff(league: League): void {
  touch();
  const rng = new Rng(`${league.seed}:staff:dev:${league.season}`);
  for (const s of Object.values(league.staff)) {
    s.age++;
    const t = trend(s.age);
    s.evaluation = Math.round(clamp(s.evaluation + rng.normal(t, 0.55), 1, 20));
    s.projection = Math.round(clamp(s.projection + rng.normal(t, 0.55), 1, 20));
    const retires = s.age >= 68 || (s.age >= 62 && rng.chance((s.age - 61) * 0.15));
    const drifts = s.teamId === null && rng.chance(0.4);
    if (retires || drifts) {
      if (retires && s.teamId !== null) logStaff(league, s.teamId, `${ROLE_LABEL[s.role]} ${staffName(s)} retired`);
      delete league.staff[s.id];
    }
  }
  for (const team of league.teams) team.staffDead = team.staffDead.filter((d) => d.season >= league.season);
  refreshMarket(league, rng);
  touch();
}

export type ResignOutlook = 'stays' | 'budget' | 'chair';

/**
 * What happens to each of the user's expiring deals when the re-sign window closes, if he does
 * nothing more: best first, each re-signs for two years at his ask while a chair and the budget
 * allow. The screen and the calendar both use this, so the forecast is the outcome.
 */
export function resignForecast(league: League, teamId: number, hire?: { s: Staff; years: number }): Map<number, ResignOutlook> {
  const mine = teamStaff(league, teamId);
  // A hire in the window takes his chair and his salary before the expiring deals are decided.
  const taken: Partial<Record<StaffRole, number>> = hire ? { [hire.s.role]: 1 } : {};
  let room = staffRoom(league, teamId) - (hire ? staffAsk(league, hire.s, hire.years) : 0);
  const out = new Map<number, ResignOutlook>();
  for (const s of mine.filter((x) => isExpiring(league, x)).sort((a, b) => staffValue(b) - staffValue(a))) {
    const held = mine.filter((x) => x.role === s.role && !isExpiring(league, x)).length + (taken[s.role] ?? 0);
    const ask = staffAsk(league, s, 2);
    if (held >= STAFF_SLOTS[s.role]) out.set(s.id, 'chair');
    else if (ask > room) out.set(s.id, 'budget');
    else {
      out.set(s.id, 'stays');
      taken[s.role] = (taken[s.role] ?? 0) + 1;
      room -= ask;
    }
  }
  return out;
}

/** Budget left once the expiring staff forecast to stay have re-signed. */
export function staffRoomAfterResigns(league: League, teamId: number): number {
  let room = staffRoom(league, teamId);
  for (const [id, outlook] of resignForecast(league, teamId)) if (outlook === 'stays') room -= staffAsk(league, league.staff[id], 2);
  return room;
}

/** Expiring staff who would re-sign today but not after this hire (it takes their chair or their money). */
export function pushedOutBy(league: League, teamId: number, s: Staff, years = 2): Staff[] {
  const before = resignForecast(league, teamId);
  const after = resignForecast(league, teamId, { s, years });
  return [...before].filter(([id, outlook]) => outlook === 'stays' && after.get(id) !== 'stays').map(([id]) => league.staff[id]);
}

/**
 * End of the re-sign window. AI teams keep or let go their expiring staff and fill open chairs
 * (aiming at their own quality goal, which keeps the league's average steady). The user's
 * expiring staff are re-signed for two years at their ask unless dismissed first, so a missed
 * click never empties a chair; anyone the budget can't cover leaves.
 */
export function staffWindowCloses(league: League, opts: { autoUser?: boolean } = {}): void {
  const rng = new Rng(`${league.seed}:staff:window:${league.season}`);
  const user = league.userTeamId;
  if (!opts.autoUser) {
    for (const [id, outlook] of resignForecast(league, user)) {
      const s = league.staff[id];
      if (outlook === 'stays') {
        signStaff(league, user, s, 2);
        logStaff(league, user, `${league.teams[user].abbrev} re-signed ${ROLE_LABEL[s.role].toLowerCase()} ${staffName(s)} (2 yr)`);
      } else dismiss(league, s);
    }
  }
  const teams = rng.shuffle(league.teams.filter((t) => opts.autoUser || t.id !== user));
  for (const team of teams) aiStaffMoves(league, team, rng);
  refreshMarket(league, rng);
}

/** A journeyman Director's one-year ask, a little above the usual (`fillChairs`'s last resort). */
const JOURNEYMAN = 7.5;
const journeymanAsk = (league: League) => Math.round(BASE_ASK.director * (capOf(league) / BASE_CAP) * 1.2 ** (JOURNEYMAN - 10) * TERM[1]);

function aiStaffMoves(league: League, team: Team, rng: Rng): void {
  const goal = staffGoal(league, team);
  // The Director's deal first: scouts re-signed before him could leave no money for the one chair that can't stay empty.
  for (const s of teamStaff(league, team.id)
    .filter((x) => isExpiring(league, x))
    .sort((a, b) => Number(b.role === 'director') - Number(a.role === 'director'))) {
    const years = rng.int(1, 3);
    // With the Director's chair empty, his money stays aside: scouts re-signed first could otherwise
    // leave only the journeyman fallback (`fillChairs`), hired whatever the budget says.
    const noDirector = !teamStaff(league, team.id).some((x) => x.role === 'director' && !isExpiring(league, x));
    const reserve = s.role !== 'director' && noDirector ? journeymanAsk(league) : 0;
    const keep = staffValue(s) >= goal - 2 && rng.chance(0.75) && staffAsk(league, s, years) <= staffRoom(league, team.id) - reserve;
    if (keep) signStaff(league, team.id, s, years);
    else dismiss(league, s);
  }
  fillChairs(league, team, rng, goal);
}

/** Hire toward the team's target counts, closest to its quality goal, spreading specialties. */
function fillChairs(league: League, team: Team, rng: Rng, goal = staffGoal(league, team)): void {
  const target = aiTarget(team);
  for (const role of ROLES) {
    for (let guard = 0; guard < 6; guard++) {
      const mine = teamStaff(league, team.id);
      if (mine.filter((s) => s.role === role).length >= target[role]) break;
      const covered = new Set(mine.filter((s) => s.role === role).map((s) => s.focus));
      // Leave room to fill the other open chairs at cheap asks; if that leaves nobody affordable,
      // hire the best that fits now and leave a later chair open instead.
      const open = ROLES.reduce((n, r) => n + Math.max(0, target[r] - mine.filter((s) => s.role === r).length), 0) - 1;
      const reserve = open * 700 * (capOf(league) / BASE_CAP);
      const years = rng.int(1, 3);
      const affordable = (room: number) => staffMarket(league).filter((s) => s.role === role && staffAsk(league, s, years) <= room);
      const room = staffRoom(league, team.id);
      const pool = affordable(room - reserve).length ? affordable(room - reserve) : affordable(room);
      const pick = pool
        .map((s) => ({ s, score: Math.abs(staffValue(s) - goal) + rng.normal(0, 0.6) - (s.focus && !covered.has(s.focus) ? 1.5 : 0) }))
        .sort((a, b) => a.score - b.score)[0]?.s;
      if (pick) {
        signStaff(league, team.id, pick, years);
        continue;
      }
      // Nobody affordable. A department can't run without a Director, so a cheap journeyman takes
      // that job; an unaffordable scout's chair stays empty until next year.
      if (role !== 'director') break;
      signStaff(league, team.id, newStaff(league, rng, role, rng.normal(6.5, 1), rng.normal(6.5, 1), rng.int(30, 45)), 1);
    }
  }
}

/** Before the season: no AI team starts without a full department (vacancies from retirements). */
export function ensureStaffed(league: League, opts: { autoUser?: boolean } = {}): void {
  const rng = new Rng(`${league.seed}:staff:camp:${league.season}`);
  for (const team of league.teams) if (opts.autoUser || team.id !== league.userTeamId) fillChairs(league, team, rng);
}

// ───────── reporting ─────────

/** Share of a roster in each group: how much a read on that group matters. */
const GROUP_SHARE = (() => {
  const total = POSITIONS.reduce((n, p) => n + ROSTER_TEMPLATE[p], 0);
  const share = new Map<ScoutFocus | null, number>();
  for (const p of POSITIONS) share.set(FOCUS_OF[p], (share.get(FOCUS_OF[p]) ?? 0) + ROSTER_TEMPLATE[p] / total);
  return share;
})();
export const GROUPS: (ScoutFocus | null)[] = [...FOCUSES, null];
export const groupLabel = (g: ScoutFocus | null) => (g ? FOCUS_LABEL[g] : 'K · P');

/** Average log-accuracy across groups, domains and traits (lower is sharper; 0 = typical). */
export function departmentScore(league: League, teamId: number, staff = teamStaff(league, teamId)): number {
  let score = 0;
  for (const g of GROUPS) {
    for (const domain of ['college', 'pro'] as const) {
      for (const trait of ['evaluation', 'projection'] as const) {
        // Pro reads are mostly about the present; college reads lean on projection.
        const w = domain === 'pro' ? (trait === 'evaluation' ? 0.8 : 0.2) : trait === 'evaluation' ? 0.55 : 0.45;
        score += GROUP_SHARE.get(g)! * 0.5 * w * Math.log2(accuracy(readFor(staff, domain, g, trait).rating));
      }
    }
  }
  return score;
}

/** Letter grade by rank among the 32 departments: A top 3, B next 6, C middle 14, D next 6, F bottom 3. */
export function departmentGrades(league: League): Map<number, { rank: number; grade: string }> {
  const ranked = league.teams.map((t) => ({ id: t.id, score: departmentScore(league, t.id) })).sort((a, b) => a.score - b.score);
  return new Map(ranked.map((x, i) => [x.id, { rank: i + 1, grade: i < 3 ? 'A' : i < 9 ? 'B' : i < 23 ? 'C' : i < 29 ? 'D' : 'F' }]));
}

export interface WeakSpot {
  domain: Domain;
  group: ScoutFocus | null;
  read: Read;
}

/** The read that costs the team most: low rating on a big group. */
export function weakestSpot(league: League, teamId: number): WeakSpot {
  const staff = teamStaff(league, teamId);
  let worst: WeakSpot & { cost: number } = { domain: 'college', group: null, read: readFor(staff, 'college', null, 'evaluation'), cost: -Infinity };
  for (const g of GROUPS) {
    for (const domain of ['college', 'pro'] as const) {
      const read = readFor(staff, domain, g, 'evaluation');
      const cost = GROUP_SHARE.get(g)! * Math.log2(accuracy(read.rating));
      if (cost > worst.cost) worst = { domain, group: g, read, cost };
    }
  }
  return worst;
}

export interface ReadChange {
  domain: Domain;
  group: ScoutFocus | null;
  trait: StaffTrait;
  from: number;
  to: number;
}

/**
 * What hiring `s` would change in the team's reads (replacing its Director, if he's one), comparing
 * the department as it will stand with and without him: expiring staff forecast to re-sign count as
 * staying, and anyone the hire would push out counts as gone, so losses show as well as gains.
 */
export function previewHire(league: League, teamId: number, s: Staff, years = 2): ReadChange[] {
  const staying = (forecast: Map<number, ResignOutlook>) => teamStaff(league, teamId).filter((x) => !isExpiring(league, x) || forecast.get(x.id) === 'stays');
  const now = staying(resignForecast(league, teamId));
  const after = [...staying(resignForecast(league, teamId, { s, years })).filter((x) => s.role !== 'director' || x.role !== 'director'), s];
  const out: ReadChange[] = [];
  for (const g of GROUPS) {
    for (const domain of ['college', 'pro'] as const) {
      for (const trait of ['evaluation', 'projection'] as const) {
        const from = readFor(now, domain, g, trait).rating;
        const to = readFor(after, domain, g, trait).rating;
        if (to !== from) out.push({ domain, group: g, trait, from, to });
      }
    }
  }
  return out;
}
