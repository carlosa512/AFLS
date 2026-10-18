/**
 * Medical staffs. Every team employs a head team doctor, two physiotherapists and a sports scientist.
 * Each carries two public ratings on the 1–20 scale, and the department's blend of them is what the
 * injury model reads (`injuries.ts`):
 *
 * - **Physiotherapy** is rehab: it sets how fast injuries heal (`recoveryMultiplier`). Elite rehab
 *   takes up to a quarter off a layoff; a department rated 9 or below follows the standard clinical
 *   timeline, never a slower one.
 * - **Sports science** is load management: condition comes back faster between games and fewer
 *   soft-tissue injuries happen (`preventionMultiplier`), again never worse than baseline.
 * - The **head doctor** also makes the diagnosis: the better he is, the tighter the estimate of a
 *   layoff the screens show (the engine always knows the truth).
 *
 * Staff are paid from their own budget (not the cap), sign 1–3 year deals, and are hired and
 * dismissed in the re-sign window and free agency, like scouts and coaches. Each year they age and
 * drift: young staff improve, the old fade, and tenure, a winning program and a generous owner all
 * help a little. All medical randomness uses its own seeded Rngs, so it never shifts the league's
 * main random stream and a migrated save gets the same staffs as a new league.
 */
import { FIRST_NAMES, LAST_NAMES } from './data/names';
import { BASE_CAP } from './finance/market';
import { clamp, Rng } from './rng';
import { staffWindowOpen, type ResignOutlook, type StaffMove } from './staff';
import type { League, Medic, MedicRole, Team } from './types';

export const MEDIC_ROLES: MedicRole[] = ['doctor', 'physio', 'scientist'];
export const MEDIC_ROLE_LABEL: Record<MedicRole, string> = { doctor: 'Head team doctor', physio: 'Physiotherapist', scientist: 'Sports scientist' };
/** Chairs per role. */
export const MEDIC_SLOTS: Record<MedicRole, number> = { doctor: 1, physio: 2, scientist: 1 };
export const medicName = (m: Pick<Medic, 'firstName' | 'lastName'>) => `${m.firstName} ${m.lastName}`;

/** A department of typical staff: what the league's injury rates are calibrated around. */
export const TYPICAL = 10.5;
/** An empty chair works like a replacement-level clinician. */
const VACANT = 6;

/**
 * Every hire, dismissal, retirement and new candidate goes through this module and bumps `version`,
 * so the per-team index survives the thousands of lookups an injury pass makes.
 */
let version = 0;
const touch = () => void version++;
const index = new WeakMap<Record<number, Medic>, { version: number; byTeam: Map<number, Medic[]> }>();

/** A team's medical staff. The list is shared and cached: copy it before sorting. */
export function teamMedics(league: League, teamId: number): readonly Medic[] {
  if (!league.medics) return [];
  let hit = index.get(league.medics);
  if (!hit || hit.version !== version) {
    const byTeam = new Map<number, Medic[]>();
    for (const m of Object.values(league.medics)) if (m.teamId !== null) byTeam.set(m.teamId, [...(byTeam.get(m.teamId) ?? []), m]);
    index.set(league.medics, (hit = { version, byTeam }));
  }
  return hit.byTeam.get(teamId) ?? [];
}
export const medicMarket = (league: League): Medic[] => Object.values(league.medics ?? {}).filter((m) => m.teamId === null);

// ───────── what the department does ─────────

/** How much each chair counts toward the department's two ratings (each row sums to 1 over a full staff). */
const WEIGHT: Record<'physio' | 'science', Record<MedicRole, number>> = {
  physio: { doctor: 0.3, physio: 0.3, scientist: 0.1 },
  science: { doctor: 0.3, physio: 0.1, scientist: 0.5 },
};

export interface Department {
  physio: number;
  science: number;
  /** The head doctor's diagnosis (his average rating), or a vacant chair's. */
  diagnosis: number;
}

/** The department's ratings: each chair's weighted rating, the best man in a chair counting when deals overlap. */
export function departmentOf(medics: readonly Medic[]): Department {
  const out = { physio: 0, science: 0 };
  for (const role of MEDIC_ROLES) {
    const held = [...medics.filter((m) => m.role === role)].sort((a, b) => medicValue(b) - medicValue(a)).slice(0, MEDIC_SLOTS[role]);
    for (let i = 0; i < MEDIC_SLOTS[role]; i++) {
      const m = held[i];
      out.physio += WEIGHT.physio[role] * (m?.physio ?? VACANT);
      out.science += WEIGHT.science[role] * (m?.science ?? VACANT);
    }
  }
  const doctor = medics.filter((m) => m.role === 'doctor').sort((a, b) => medicValue(b) - medicValue(a))[0];
  return { ...out, diagnosis: doctor ? (doctor.physio + doctor.science) / 2 : VACANT };
}

/** A team's department; free agents have nobody (baseline rehab, no prevention). */
export function departmentFor(league: League, teamId: number | null): Department {
  return teamId === null ? { physio: VACANT, science: VACANT, diagnosis: VACANT } : departmentOf(teamMedics(league, teamId));
}

/**
 * Layoff multiplier for a department's physiotherapy rating, on the spec's curve: elite (18–20)
 * 0.82→0.75, good (14–17) 0.92→0.83, adequate (10–13) 0.99→0.93, and a flat 1 at 9 and below.
 * Linear between the tiers, so a department's decimal rating lands somewhere sensible.
 */
const RECOVERY_CURVE: [number, number][] = [
  [9, 1],
  [10, 0.99],
  [13, 0.93],
  [14, 0.92],
  [17, 0.83],
  [18, 0.82],
  [20, 0.75],
];
export function recoveryMultiplier(physio: number): number {
  if (physio <= RECOVERY_CURVE[0][0]) return 1;
  for (let i = 1; i < RECOVERY_CURVE.length; i++) {
    const [x1, y1] = RECOVERY_CURVE[i];
    const [x0, y0] = RECOVERY_CURVE[i - 1];
    if (physio <= x1) return y0 + ((physio - x0) / (x1 - x0)) * (y1 - y0);
  }
  return RECOVERY_CURVE[RECOVERY_CURVE.length - 1][1];
}

/** Soft-tissue risk multiplier for a department's sports science: down to ×0.75 at 20, never above 1. */
export const preventionMultiplier = (science: number) => 1 - 0.025 * clamp(science - 10, 0, 10);

/** Extra share of lost condition won back each week, from sports science: up to +0.1 at 20. */
export const conditionBonus = (science: number) => 0.01 * clamp(science - 10, 0, 10);

/** Half-width of a diagnosis, as a share of the layoff: a great doctor names the week, a poor one a month. */
export const diagnosisSpread = (diagnosis: number) => clamp(0.55 - 0.025 * diagnosis, 0.05, 0.5);

// ───────── money ─────────

const BASE_ASK: Record<MedicRole, number> = { doctor: 1400, physio: 650, scientist: 900 };
const TERM: Record<number, number> = { 1: 1.1, 2: 1, 3: 0.95 };
export const MEDIC_MAX_YEARS = 3;

/** One number for a clinician in his role: physios are judged on rehab, scientists on science, the doctor on both. */
export function medicValue(m: Pick<Medic, 'role' | 'physio' | 'science'>): number {
  if (m.role === 'doctor') return 0.5 * m.physio + 0.5 * m.science;
  if (m.role === 'physio') return 0.8 * m.physio + 0.2 * m.science;
  return 0.2 * m.physio + 0.8 * m.science;
}

const capOf = (league: League) => league.caps[league.season] ?? BASE_CAP;

/** Salary he asks for, $K per year: convex in quality, scaled with the cap. */
export function medicAsk(league: League, m: Medic, years = 2): number {
  return Math.round(BASE_ASK[m.role] * (capOf(league) / BASE_CAP) * 1.18 ** (medicValue(m) - 10) * TERM[years]);
}

/** The owner's medical budget for this league year, $K: the same generosity as his scouting and coaching budgets. */
export const medicalBudget = (league: League, teamId: number) => Math.round(0.019 * capOf(league) * league.teams[teamId].staffBudgetMult);

/** Salaries owed this league year plus severance booked against it. */
export function medicalPayroll(league: League, teamId: number): number {
  const pay = teamMedics(league, teamId).reduce((sum, m) => sum + (m.contract && m.contract.through >= league.season ? m.contract.salary : 0), 0);
  return pay + (league.teams[teamId].medicalDead ?? []).filter((d) => d.season === league.season).reduce((sum, d) => sum + d.amount, 0);
}

export const medicalRoom = (league: League, teamId: number) => medicalBudget(league, teamId) - medicalPayroll(league, teamId);

/** His deal ran out last league year: he stays through the re-sign window, then leaves unless extended. */
export const isMedicExpiring = (league: League, m: Medic) => !!m.contract && m.contract.through < league.season;

/** Severance for dismissing him now: half a year's salary, if he's still under contract. */
export const medicSeverance = (league: League, m: Medic) => (m.contract && m.contract.through >= league.season ? Math.round(m.contract.salary * 0.5) : 0);

// ───────── moves ─────────

/** Why a move can't happen right now, or null. */
export function medicMoveProblem(league: League, teamId: number, m: Medic, move: StaffMove, years = 2): string | null {
  if (!staffWindowOpen(league)) return 'Medical staff moves open in the re-sign window and free agency.';
  if (move === 'release') return m.teamId === teamId ? null : 'He doesn’t work for you.';
  if (years < 1 || years > MEDIC_MAX_YEARS) return `Medical staff sign for 1–${MEDIC_MAX_YEARS} years.`;
  const held = teamMedics(league, teamId).filter((x) => x.role === m.role && x !== m && !isMedicExpiring(league, x)).length;
  const label = MEDIC_ROLE_LABEL[m.role].toLowerCase();
  if (move === 'extend') {
    if (m.teamId !== teamId || !isMedicExpiring(league, m)) return 'Only expiring deals can be extended.';
    if (held >= MEDIC_SLOTS[m.role]) return `His chair is taken: your ${label} job${MEDIC_SLOTS[m.role] > 1 ? 's are' : ' is'} filled.`;
  } else {
    if (m.teamId !== null) return 'He isn’t available.';
    if (held >= MEDIC_SLOTS[m.role]) return MEDIC_SLOTS[m.role] > 1 ? `Both ${label} jobs are filled. Dismiss one first.` : `You already have a ${label}. Dismiss him first.`;
  }
  const over = medicAsk(league, m, years) - medicalRoom(league, teamId);
  return over > 0 ? `Over your medical budget by $${(over / 1000).toFixed(2)}M.` : null;
}

function signMedic(league: League, teamId: number, m: Medic, years: number): void {
  touch();
  if (m.teamId !== teamId) m.since = league.season;
  m.teamId = teamId;
  m.contract = { salary: medicAsk(league, m, years), through: league.season + years - 1 };
}

/** Medical news is the user's own business: AI hires don't make headlines. */
function logMedic(league: League, teamId: number, text: string): void {
  if (teamId !== league.userTeamId) return;
  league.transactions.push({ season: league.season, phase: league.phase, week: league.week, teamIds: [teamId], kind: 'medical', text });
}
const labelOf = (m: Medic) => MEDIC_ROLE_LABEL[m.role].toLowerCase();

export function hireMedic(league: League, teamId: number, medicId: number, years = 2): void {
  const m = league.medics[medicId];
  const problem = medicMoveProblem(league, teamId, m, 'hire', years);
  if (problem) throw new Error(problem);
  signMedic(league, teamId, m, years);
  logMedic(league, teamId, `${league.teams[teamId].abbrev} hired ${labelOf(m)} ${medicName(m)} (${years} yr)`);
}

export function extendMedic(league: League, teamId: number, medicId: number, years = 2): void {
  const m = league.medics[medicId];
  const problem = medicMoveProblem(league, teamId, m, 'extend', years);
  if (problem) throw new Error(problem);
  signMedic(league, teamId, m, years);
  logMedic(league, teamId, `${league.teams[teamId].abbrev} extended ${labelOf(m)} ${medicName(m)} (${years} yr)`);
}

/** Dismiss (or let go) a clinician: he returns to the market; severance is booked if he was under contract. */
export function releaseMedic(league: League, teamId: number, medicId: number): void {
  const m = league.medics[medicId];
  const problem = medicMoveProblem(league, teamId, m, 'release');
  if (problem) throw new Error(problem);
  dismiss(league, m);
}

function dismiss(league: League, m: Medic): void {
  touch();
  const team = league.teams[m.teamId!];
  const owed = medicSeverance(league, m);
  if (owed > 0) (team.medicalDead ??= []).push({ season: league.season, amount: owed, name: medicName(m) });
  logMedic(league, team.id, `${team.abbrev} ${owed > 0 ? 'dismissed' : 'let go'} ${labelOf(m)} ${medicName(m)}`);
  m.lastJob = `${MEDIC_ROLE_LABEL[m.role]}, ${team.abbrev}`;
  m.teamId = null;
  m.contract = null;
  delete m.since;
}

// ───────── generation ─────────

/** Candidates kept on the market for each role. */
const MARKET_SIZE: Record<MedicRole, number> = { doctor: 8, physio: 14, scientist: 10 };

function newMedic(league: League, rng: Rng, role: MedicRole, physio: number, science: number, age: number): Medic {
  const m: Medic = {
    id: league.nextMedicId++,
    firstName: rng.pick(FIRST_NAMES),
    lastName: rng.pick(LAST_NAMES),
    role,
    age,
    physio: Math.round(clamp(physio, 1, 20)),
    science: Math.round(clamp(science, 1, 20)),
    teamId: null,
    contract: null,
  };
  league.medics[m.id] = m;
  touch();
  return m;
}

/** What his role leans on: a physio's strength is rehab, a scientist's is science, a doctor does both. */
const LEAN: Record<MedicRole, number> = { doctor: 0, physio: 1.2, scientist: -1.2 };

/** A market candidate: experience buys a little skill. */
function candidate(league: League, rng: Rng, role: MedicRole): Medic {
  const age = rng.int(role === 'doctor' ? 36 : 27, 62);
  const base = 9.2 + Math.min(2, 0.07 * (age - 28));
  const lean = LEAN[role] + rng.normal(0, 1);
  return newMedic(league, rng, role, rng.normal(base + lean, 2.2), rng.normal(base - lean, 2.2), age);
}

/** Top the market back up to its usual size. */
function refreshMarket(league: League, rng: Rng): void {
  const market = medicMarket(league);
  for (const role of MEDIC_ROLES) for (let n = market.filter((m) => m.role === role).length; n < MARKET_SIZE[role]; n++) candidate(league, rng, role);
}

/** Each AI front office's goal for its medical staff: some invest, some don't, centred on typical. A persistent trait, not stored. */
const goalCache = new Map<string, Map<number, number>>();
function teamGoal(league: League, teamId: number): number {
  let goals = goalCache.get(league.seed);
  if (!goals) {
    const z = league.teams.map((t) => new Rng(`${league.seed}:medical-goal:${t.id}`).normal());
    const mean = z.reduce((a, b) => a + b, 0) / z.length;
    goals = new Map(league.teams.map((t, i) => [t.id, TYPICAL + 1.3 * (z[i] - mean)]));
    goalCache.set(league.seed, goals);
  }
  return goals.get(teamId) ?? TYPICAL;
}

/** Chairs in the order an AI team fills them. */
const CHAIRS: MedicRole[] = ['doctor', 'physio', 'scientist', 'physio'];

/** The opening league: AI staffs of varying quality inside their budgets, and a typical staff for the user. */
export function generateMedicalWorld(league: League): void {
  league.medics ??= {};
  league.nextMedicId ??= 1;
  const rng = new Rng(`${league.seed}:medical:init`);
  for (const team of league.teams) {
    team.medicalDead = [];
    const user = team.id === league.userTeamId;
    const level = user ? TYPICAL : TYPICAL + 0.8 * (teamGoal(league, team.id) - TYPICAL);
    const hired = CHAIRS.map((role) => {
      const lean = LEAN[role] + rng.normal(0, user ? 0.5 : 1);
      const sd = user ? 0.6 : 2;
      return newMedic(league, rng, role, rng.normal(level + lean, sd), rng.normal(level - lean, sd), rng.int(role === 'doctor' ? 40 : 28, 58));
    });
    // Stagger contracts so departments don't all turn over in the same year.
    hired.forEach((m, i) => signMedic(league, team.id, m, user ? (i % 3) + 1 : rng.int(1, MEDIC_MAX_YEARS)));
    for (const m of hired) m.since = league.season - rng.int(0, 3);
    // Fit the budget: the priciest member is a little worse than he'd otherwise be.
    for (let guard = 0; guard < 60 && medicalRoom(league, team.id) < 0; guard++) {
      const priciest = hired.reduce((a, b) => (b.contract!.salary > a.contract!.salary ? b : a));
      priciest.physio = Math.max(1, priciest.physio - 1);
      priciest.science = Math.max(1, priciest.science - 1);
      priciest.contract!.salary = medicAsk(league, priciest, priciest.contract!.through - league.season + 1);
    }
  }
  touch();
  refreshMarket(league, rng);
}

// ───────── the yearly cycle ─────────

/** Rising under 35, steady through the 40s, fading from the mid-50s. */
function trend(age: number): number {
  if (age < 35) return 0.3;
  if (age < 45) return 0.12;
  if (age < 55) return 0;
  if (age < 62) return -0.25;
  return -0.55;
}
export const medicTrendLabel = (age: number) => (age < 35 ? 'Rising' : age < 55 ? 'Prime' : 'Declining');

/** Last season's win share, for the program's pull on its staff. */
function lastWinShare(league: League, teamId: number): number {
  const rec = league.history.find((h) => h.season === league.season - 1)?.records[teamId];
  const games = rec ? rec.w + rec.l + rec.t : 0;
  return rec && games ? (rec.w + 0.5 * rec.t) / games : 0.5;
}

/**
 * New league year: staff age and drift (tenure, a winning program and a generous owner each help a
 * little: settled staff know their players, good programs draw good residents and better equipment),
 * the old retire, part of the unhired market drifts out of football, and fresh candidates arrive.
 */
export function developMedics(league: League): void {
  touch();
  const rng = new Rng(`${league.seed}:medical:dev:${league.season}`);
  for (const m of Object.values(league.medics ?? {})) {
    m.age++;
    let drift = trend(m.age);
    if (m.teamId !== null) {
      const team = league.teams[m.teamId];
      drift += (league.season - (m.since ?? league.season) >= 2 ? 0.1 : 0) + 0.4 * (lastWinShare(league, m.teamId) - 0.5) + 0.3 * (team.staffBudgetMult - 1);
    }
    m.physio = Math.round(clamp(m.physio + rng.normal(drift, 0.5), 1, 20));
    m.science = Math.round(clamp(m.science + rng.normal(drift, 0.5), 1, 20));
    const retires = m.age >= 70 || (m.age >= 63 && rng.chance((m.age - 62) * 0.15));
    const drifts = m.teamId === null && rng.chance(0.4);
    if (retires || drifts) {
      if (retires && m.teamId !== null) logMedic(league, m.teamId, `${MEDIC_ROLE_LABEL[m.role]} ${medicName(m)} retired`);
      delete league.medics[m.id];
    }
  }
  for (const team of league.teams) team.medicalDead = (team.medicalDead ?? []).filter((d) => d.season >= league.season);
  touch();
  refreshMarket(league, rng);
}

/**
 * What happens to each of the user's expiring deals when the re-sign window closes, if he does
 * nothing more: best first, each re-signs for two years at his ask while a chair and the budget
 * allow. The screen and the calendar both use this, so the forecast is the outcome.
 */
export function medicResignForecast(league: League, teamId: number): Map<number, ResignOutlook> {
  const mine = teamMedics(league, teamId);
  const taken: Partial<Record<MedicRole, number>> = {};
  let room = medicalRoom(league, teamId);
  const out = new Map<number, ResignOutlook>();
  for (const m of mine.filter((x) => isMedicExpiring(league, x)).sort((a, b) => medicValue(b) - medicValue(a))) {
    const held = mine.filter((x) => x.role === m.role && !isMedicExpiring(league, x)).length + (taken[m.role] ?? 0);
    const ask = medicAsk(league, m, 2);
    if (held >= MEDIC_SLOTS[m.role]) out.set(m.id, 'chair');
    else if (ask > room) out.set(m.id, 'budget');
    else {
      out.set(m.id, 'stays');
      taken[m.role] = (taken[m.role] ?? 0) + 1;
      room -= ask;
    }
  }
  return out;
}

/**
 * End of the re-sign window. AI teams keep or let go their expiring staff and fill open chairs; the
 * user's expiring staff re-sign for two years at their ask unless dismissed first, so a missed click
 * never empties a chair. Anyone the budget can't cover leaves.
 */
export function medicalWindowCloses(league: League, opts: { autoUser?: boolean } = {}): void {
  const rng = new Rng(`${league.seed}:medical:window:${league.season}`);
  const user = league.userTeamId;
  if (!opts.autoUser) {
    for (const [id, outlook] of medicResignForecast(league, user)) {
      const m = league.medics[id];
      if (outlook === 'stays') {
        signMedic(league, user, m, 2);
        logMedic(league, user, `${league.teams[user].abbrev} re-signed ${labelOf(m)} ${medicName(m)} (2 yr)`);
      } else dismiss(league, m);
    }
  }
  for (const team of rng.shuffle(league.teams.filter((t) => opts.autoUser || t.id !== user))) aiMedicalMoves(league, team, rng);
  refreshMarket(league, rng);
}

function aiMedicalMoves(league: League, team: Team, rng: Rng): void {
  const goal = teamGoal(league, team.id);
  const gone = new Set<number>();
  for (const m of teamMedics(league, team.id).filter((x) => isMedicExpiring(league, x))) {
    const years = rng.int(1, MEDIC_MAX_YEARS);
    const keep = medicValue(m) >= goal - 2 && rng.chance(0.75) && medicAsk(league, m, years) <= medicalRoom(league, team.id);
    if (keep) signMedic(league, team.id, m, years);
    else {
      dismiss(league, m);
      gone.add(m.id);
    }
  }
  fillChairs(league, team, rng, gone);
}

/** Hire into every empty chair, closest to the team's goal, leaving room for the chairs still open. */
function fillChairs(league: League, team: Team, rng: Rng, gone: ReadonlySet<number> = new Set()): void {
  const goal = teamGoal(league, team.id);
  for (const role of CHAIRS) {
    const mine = teamMedics(league, team.id);
    if (mine.filter((m) => m.role === role).length >= MEDIC_SLOTS[role]) continue;
    const open = MEDIC_ROLES.reduce((n, r) => n + Math.max(0, MEDIC_SLOTS[r] - mine.filter((m) => m.role === r).length), 0) - 1;
    const reserve = open * 450 * (capOf(league) / BASE_CAP);
    const years = rng.int(1, MEDIC_MAX_YEARS);
    const room = medicalRoom(league, team.id);
    const affordable = (budget: number) => medicMarket(league).filter((m) => m.role === role && !gone.has(m.id) && medicAsk(league, m, years) <= budget);
    const pool = affordable(room - reserve).length ? affordable(room - reserve) : affordable(room);
    const pick = pool.map((m) => ({ m, score: Math.abs(medicValue(m) - goal) + rng.normal(0, 0.6) })).sort((a, b) => a.score - b.score)[0]?.m;
    // Nobody affordable: a journeyman takes the job on a one-year deal, so no chair stays empty.
    const hire = pick ?? newMedic(league, rng, role, rng.normal(6.5, 1), rng.normal(6.5, 1), rng.int(30, 45));
    signMedic(league, team.id, hire, pick ? years : 1);
  }
}

/** Before the season: no AI team starts with an empty chair (vacancies from retirements). */
export function ensureMedical(league: League, opts: { autoUser?: boolean } = {}): void {
  const rng = new Rng(`${league.seed}:medical:camp:${league.season}`);
  for (const team of league.teams) if (opts.autoUser || team.id !== league.userTeamId) fillChairs(league, team, rng);
}

// ───────── reporting ─────────

/** One number for a department: rehab and prevention, equally. */
export const departmentScore = (d: Department) => 0.5 * d.physio + 0.5 * d.science;

/** Letter grade by rank among the 32 departments: A top 3, B next 6, C middle 14, D next 6, F bottom 3. */
export function medicalGrades(league: League): Map<number, { rank: number; grade: string }> {
  const ranked = league.teams.map((t) => ({ id: t.id, score: departmentScore(departmentFor(league, t.id)) })).sort((a, b) => b.score - a.score);
  return new Map(ranked.map((x, i) => [x.id, { rank: i + 1, grade: i < 3 ? 'A' : i < 9 ? 'B' : i < 23 ? 'C' : i < 29 ? 'D' : 'F' }]));
}

/** What hiring `m` would do to the department (replacing the weakest man in his role if the chairs are full). */
export function previewMedicHire(league: League, teamId: number, m: Medic): { from: Department; to: Department } {
  const mine = teamMedics(league, teamId).filter((x) => !isMedicExpiring(league, x) || medicResignForecast(league, teamId).get(x.id) === 'stays');
  const same = mine.filter((x) => x.role === m.role).sort((a, b) => medicValue(a) - medicValue(b));
  const out = same.length >= MEDIC_SLOTS[m.role] ? same[0] : null;
  return { from: departmentOf(mine), to: departmentOf([...mine.filter((x) => x !== out), m]) };
}
