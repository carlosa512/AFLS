/**
 * Coaching staffs. Every team employs a head coach, two coordinators, a strength & conditioning
 * coach and a coach for each position room. Each coach has two ratings, and both feed player
 * development (`coachingFor`, read once a year by `beginOffseason`):
 *
 * - **Youth development** speeds up how fast players under 26 grow toward their ceiling.
 * - **Veteran care** slows how fast players past their prime lose it. The S&C coach keeps bodies
 *   going (physical tools); everyone else keeps technique and the mental game sharp.
 *
 * A position coach weighs most for his room, a coordinator for his side of the ball, the head coach a
 * little for everyone. A typical staff (every rating 10.5) changes nothing, so the league's
 * development calibration holds; a strong staff is worth roughly 60% of what work ethic is
 * (`npm run careers` gates it at 30–95%).
 *
 * Head coaches and offensive coordinators also carry a play-calling style (`CoachStyle`) that the
 * match engine reads: style, not skill, so it changes the mix of calls and never the execution.
 *
 * Coaches are paid from their own budget (separate from the scouts' and from the salary cap), sign
 * 1–3 year deals (head coaches up to 5), and are hired and dismissed in the re-sign window and free
 * agency, like scouts. All coaching randomness uses its own seeded Rngs: it never shifts the
 * league's main random stream, and a migrated save gets the same coaches as a new league.
 */
import type { AgingFamily } from './attributes';
import { agingFamily } from './aging';
import { FIRST_NAMES, LAST_NAMES } from './data/names';
import { logTransaction } from './finance/cap';
import { BASE_CAP } from './finance/market';
import { OVR_WEIGHTS, ROSTER_TEMPLATE } from './positions';
import { clamp, Rng } from './rng';
import { BASE_OFFENSE, COVERAGES, FRONTS, OFF_SCHEMES, pressureOf, rollScheme, type CoachScheme, type TeamScheme } from './schemes';
import { ownerTilt, staffWindowOpen, type ResignOutlook, type StaffMove } from './staff';
import type { Attribute, Coach, CoachRole, CoachRoom, CoachStyle, League, Player, Position, Team } from './types';
import { POSITIONS } from './types';

export const COACH_ROOMS: CoachRoom[] = ['QB', 'RB', 'WR', 'OL', 'DL', 'LB', 'DB'];
export const ROOM_OF: Record<Position, CoachRoom | null> = {
  QB: 'QB',
  RB: 'RB',
  WR: 'WR',
  TE: 'WR',
  OL: 'OL',
  DT: 'DL',
  EDGE: 'DL',
  LB: 'LB',
  CB: 'DB',
  S: 'DB',
  K: null,
  P: null,
};
/** Positions in each room. */
export const ROOM_POSITIONS: Record<CoachRoom, Position[]> = Object.fromEntries(COACH_ROOMS.map((r) => [r, POSITIONS.filter((p) => ROOM_OF[p] === r)])) as Record<CoachRoom, Position[]>;
export const ROOM_LABEL: Record<CoachRoom, string> = {
  QB: 'Quarterbacks',
  RB: 'Running backs',
  WR: 'Receivers & tight ends',
  OL: 'Offensive line',
  DL: 'Defensive line',
  LB: 'Linebackers',
  DB: 'Secondary',
};
const ROOM_COACH: Record<CoachRoom, string> = {
  QB: 'Quarterbacks coach',
  RB: 'Running backs coach',
  WR: 'Receivers coach',
  OL: 'Offensive line coach',
  DL: 'Defensive line coach',
  LB: 'Linebackers coach',
  DB: 'Secondary coach',
};
export const COACH_ROLE_LABEL: Record<CoachRole, string> = {
  headCoach: 'Head coach',
  offCoord: 'Offensive coordinator',
  defCoord: 'Defensive coordinator',
  positionCoach: 'Position coach',
  strengthCoach: 'Strength & conditioning coach',
};
/** "Head coach", "Receivers coach"… */
export const coachTitle = (c: Pick<Coach, 'role' | 'room'>) => (c.role === 'positionCoach' && c.room ? ROOM_COACH[c.room] : COACH_ROLE_LABEL[c.role]);
export const coachName = (c: Coach) => `${c.firstName} ${c.lastName}`;

type Side = 'offense' | 'defense';
const SIDE_OF = (p: Position): Side | null => (p === 'K' || p === 'P' ? null : ['QB', 'RB', 'WR', 'TE', 'OL'].includes(p) ? 'offense' : 'defense');

/** One job on a staff: a role, plus a room for position coaches. */
export interface Chair {
  role: CoachRole;
  room?: CoachRoom;
}
/** Every team's chairs, in the order an AI team fills them. */
export const CHAIRS: Chair[] = [
  { role: 'headCoach' },
  { role: 'offCoord' },
  { role: 'defCoord' },
  { role: 'strengthCoach' },
  ...(['QB', 'OL', 'DB', 'WR', 'DL', 'LB', 'RB'] as CoachRoom[]).map((room) => ({ role: 'positionCoach' as const, room })),
];
export const chairOf = (c: Pick<Coach, 'role' | 'room'>): Chair => (c.role === 'positionCoach' ? { role: c.role, room: c.room } : { role: c.role });
export const sameChair = (a: Chair, b: Chair) => a.role === b.role && (a.role !== 'positionCoach' || a.room === b.room);
const LEADERSHIP: ReadonlySet<CoachRole> = new Set(['headCoach', 'offCoord', 'defCoord']);

/**
 * Every hire, dismissal, retirement and new candidate goes through this module and bumps `version`,
 * so the per-team index below survives the thousands of lookups a development pass makes. A loaded
 * save is a new `league.coaches` object and simply builds a fresh index.
 */
let version = 0;
const touch = () => void version++;
const index = new WeakMap<Record<number, Coach>, { version: number; byTeam: Map<number, Coach[]> }>();

/** A team's coaches. The list is shared and cached: copy it before sorting. */
export function teamCoaches(league: League, teamId: number): readonly Coach[] {
  let hit = index.get(league.coaches);
  if (!hit || hit.version !== version) {
    const byTeam = new Map<number, Coach[]>();
    for (const c of Object.values(league.coaches)) if (c.teamId !== null) byTeam.set(c.teamId, [...(byTeam.get(c.teamId) ?? []), c]);
    index.set(league.coaches, (hit = { version, byTeam }));
  }
  return hit.byTeam.get(teamId) ?? [];
}
export const coachMarket = (league: League): Coach[] => Object.values(league.coaches).filter((c) => c.teamId === null);

// ───────── what coaches do for players ─────────

/** A coach with these ratings changes nothing: the league's typical staff. */
export const TYPICAL = 10.5;
/** An empty chair works like a replacement-level assistant. */
const VACANT = 6;
/** Growth per point of youth development: the same slope as a point of work ethic (`growthMult`). */
const GROWTH_PER_POINT = 0.065;
/** Decline per point of veteran care, for the body (S&C-led) and for technique and the mental game. */
const BODY_PER_POINT = 0.03;
const CRAFT_PER_POINT = 0.025;

export type Source = 'headCoach' | 'coordinator' | 'positionCoach' | 'strengthCoach';
/**
 * How much each coach counts, by what he works on. A position coach teaches his room, a coordinator
 * his side of the ball, the head coach sets the standard for everyone, and the S&C coach owns the
 * body. Kickers and punters have no room or side: the head coach and S&C coach split their growth
 * and body, and the head coach alone keeps their technique.
 */
export const INFLUENCE: Record<'growth' | 'body' | 'craft', Record<Source, number>> = {
  growth: { positionCoach: 0.45, coordinator: 0.2, headCoach: 0.2, strengthCoach: 0.15 },
  body: { positionCoach: 0.35, coordinator: 0, headCoach: 0.25, strengthCoach: 0.4 },
  craft: { positionCoach: 0.5, coordinator: 0.25, headCoach: 0.25, strengthCoach: 0 },
};

export interface Coaching {
  /** Growth multiplier for players under 26 (`DevContext.rate`). */
  rate: number;
  /** Decline multiplier per family of ratings (`DevContext.decline`); below 1 ages more gently. */
  decline: Record<AgingFamily, number>;
}
export const NEUTRAL: Coaching = { rate: 1, decline: { physical: 1, technical: 1, mental: 1 } };

/** The coach in a chair; in the re-sign window a replacement can overlap the man whose deal is up, and the better one counts. */
export function chairHolder(coaches: readonly Coach[], chair: Chair): Coach | null {
  return coaches.reduce<Coach | null>((best, c) => (sameChair(chairOf(c), chair) && (!best || coachValue(c) > coachValue(best)) ? c : best), null);
}

/** Which chair each source is for a player at this position (null: nobody covers him from there). */
function sourceChair(source: Source, position: Position): Chair | null {
  if (source === 'headCoach') return { role: 'headCoach' };
  if (source === 'strengthCoach') return { role: 'strengthCoach' };
  if (source === 'positionCoach') {
    const room = ROOM_OF[position];
    return room ? { role: 'positionCoach', room } : null;
  }
  const side = SIDE_OF(position);
  return side ? { role: side === 'offense' ? 'offCoord' : 'defCoord' } : null;
}
const SOURCES: Source[] = ['positionCoach', 'coordinator', 'headCoach', 'strengthCoach'];

export interface Contribution {
  source: Source;
  chair: Chair;
  coach: Coach | null;
  /** Share of each blend this coach carries for the player (0 when he has no say). */
  weight: Record<'growth' | 'body' | 'craft', number>;
  /** His part of the growth and decline changes (fractions: +0.05 = 5% faster growth). */
  growth: number;
  body: number;
  craft: number;
}

/**
 * Who shapes a player at this position, and by how much: each chair's share of the blend times its
 * rating's distance from typical. The same numbers make up `coachingFrom`, so the parts a screen
 * shows add up to what development applies, until an extreme staff reaches the caps (`RATE_RANGE`,
 * `DECLINE_RANGE`): past them, more rating buys nothing.
 */
export function coachingParts(coaches: readonly Coach[], position: Position): Contribution[] {
  const parts: { source: Source; chair: Chair; coach: Coach | null }[] = [];
  for (const source of SOURCES) {
    const chair = sourceChair(source, position);
    if (chair) parts.push({ source, chair, coach: chairHolder(coaches, chair) });
  }
  const totals = { growth: 0, body: 0, craft: 0 };
  for (const p of parts) for (const k of ['growth', 'body', 'craft'] as const) totals[k] += INFLUENCE[k][p.source];
  return parts.map((p) => {
    const w = { growth: INFLUENCE.growth[p.source] / totals.growth, body: INFLUENCE.body[p.source] / totals.body, craft: INFLUENCE.craft[p.source] / totals.craft };
    const youth = p.coach?.youth ?? VACANT;
    const veterans = p.coach?.veterans ?? VACANT;
    return {
      ...p,
      weight: w,
      growth: w.growth * GROWTH_PER_POINT * (youth - TYPICAL),
      body: -w.body * BODY_PER_POINT * (veterans - TYPICAL),
      craft: -w.craft * CRAFT_PER_POINT * (veterans - TYPICAL),
    };
  });
}

/** No staff makes anyone a different player: growth within ±30%, decline within ±20% of typical. */
export const RATE_RANGE: [number, number] = [0.7, 1.3];
export const DECLINE_RANGE: [number, number] = [0.8, 1.2];

/** What a staff does for a player at this position. Pure: no random numbers, so it never moves a player's stream. */
export function coachingFrom(coaches: readonly Coach[], position: Position): Coaching {
  const parts = coachingParts(coaches, position);
  const sum = (k: 'growth' | 'body' | 'craft') => parts.reduce((s, p) => s + p[k], 0);
  const craft = clamp(1 + sum('craft'), ...DECLINE_RANGE);
  return { rate: clamp(1 + sum('growth'), ...RATE_RANGE), decline: { physical: clamp(1 + sum('body'), ...DECLINE_RANGE), technical: craft, mental: craft } };
}

/** What his coaches do for a player this year. Free agents have nobody: neutral, so a release is no development cliff. */
export function coachingFor(league: League, teamId: number | null, position: Position): Coaching {
  return teamId === null ? NEUTRAL : coachingFrom(teamCoaches(league, teamId), position);
}

/** Share of a position's overall in each family of ratings: how much a family's decline costs him. */
const FAMILY_SHARE: Record<Position, Record<AgingFamily, number>> = Object.fromEntries(
  POSITIONS.map((pos) => {
    const w = OVR_WEIGHTS[pos];
    const total = Object.values(w).reduce((a, b) => a + (b ?? 0), 0);
    const share: Record<AgingFamily, number> = { physical: 0, technical: 0, mental: 0 };
    for (const [a, v] of Object.entries(w)) share[agingFamily(pos, a as Attribute)] += (v ?? 0) / total;
    return [pos, share];
  }),
) as Record<Position, Record<AgingFamily, number>>;

export interface Effect {
  /** +0.12 = grows 12% faster than with a typical staff. */
  growth: number;
  /** −0.05 = declines 5% more slowly, weighted by how much each family counts at his position. */
  aging: number;
}
/** One pair of numbers a screen can show for a position: growth and aging against a typical staff. */
export function effectOf(c: Coaching, position: Position): Effect {
  const share = FAMILY_SHARE[position];
  const aging = (Object.keys(share) as AgingFamily[]).reduce((s, f) => s + share[f] * (c.decline[f] - 1), 0);
  return { growth: c.rate - 1, aging };
}

/** A room's effect: the average over its positions, weighted by roster spots (or K and P for null). */
export function roomEffect(coaches: readonly Coach[], room: CoachRoom | null): Effect {
  const positions = room ? ROOM_POSITIONS[room] : (['K', 'P'] as Position[]);
  let n = 0;
  const out = { growth: 0, aging: 0 };
  for (const pos of positions) {
    const e = effectOf(coachingFrom(coaches, pos), pos);
    out.growth += e.growth * ROSTER_TEMPLATE[pos];
    out.aging += e.aging * ROSTER_TEMPLATE[pos];
    n += ROSTER_TEMPLATE[pos];
  }
  return { growth: out.growth / n, aging: out.aging / n };
}

// ───────── play-calling style ─────────

/** A play-caller's style as the match engine reads it: 0 = league average. */
export interface CallerStyle {
  passLean: number;
  fourthDown: number;
}
const NO_STYLE: CallerStyle = { passLean: 0, fourthDown: 0 };

/**
 * The offensive coordinator calls the plays and the head coach decides fourth downs: one owner per
 * tendency, so what a card says is what the game does. An empty chair calls a league-average game.
 */
export function callerStyle(league: League, teamId: number): CallerStyle {
  if (!league.coaches) return NO_STYLE;
  const staff = teamCoaches(league, teamId);
  return {
    passLean: chairHolder(staff, { role: 'offCoord' })?.style?.passLean ?? 0,
    fourthDown: chairHolder(staff, { role: 'headCoach' })?.style?.fourthDown ?? 0,
  };
}

/**
 * A team's schemes: the offensive coordinator's offense, the defensive coordinator's front and coverage.
 * An empty chair runs the league-average base (Pro Style, a 4-3 with no coverage lean).
 */
export function teamScheme(league: League, teamId: number): TeamScheme {
  const staff = league.coaches ? teamCoaches(league, teamId) : [];
  const oc = chairHolder(staff, { role: 'offCoord' })?.scheme;
  const dc = chairHolder(staff, { role: 'defCoord' })?.scheme;
  return {
    offense: oc?.offense ? OFF_SCHEMES[oc.offense] : BASE_OFFENSE,
    front: FRONTS[dc?.front ?? 'fourThree'],
    coverage: dc?.coverage ? COVERAGES[dc.coverage] : null,
  };
}

/** Plain words for a style, only where it stands out. */
export function styleNotes(style: CoachStyle | undefined): string[] {
  const out: string[] = [];
  const pass = style?.passLean ?? 0;
  const fourth = style?.fourthDown ?? 0;
  if (pass >= 0.35) out.push('Pass-first');
  else if (pass <= -0.35) out.push('Run-first');
  if (fourth >= 0.35) out.push('Aggressive on 4th down');
  else if (fourth <= -0.35) out.push('Conservative on 4th down');
  return out;
}

// ───────── what a head coach wants ─────────

/** A head coach's vision for his staff: how much his offense throws (−1…1), and the defense he wants run. */
export interface Vision {
  pass: number;
  /** His defense, front and coverage: what he looks for in a defensive coordinator. */
  defense: CoachScheme;
  /** How much pressure that defense brings (`pressureOf`), for words. */
  pressure: number;
}

/**
 * What a head coach wants from his coordinators. One who coached the team last season keeps his system: what his
 * coordinators ran then (a new coordinator runs it on, so the best men moving up never empty the league of a scheme).
 * A new one brings his own: a former play-caller the offense he called, a former defensive coordinator the pressure
 * his defense brought; otherwise an aggressive head coach leans to the pass, a conservative one to the run, and his
 * taste on defense is his own. Tastes come from the same spread coordinators do (play-callers' leans, defensive
 * coordinators' schemes), so hiring for fit pairs men up without thinning out any kind of offense or defense. Rolled
 * from his id: nothing stored, and the league's random stream never moves.
 */
export function headCoachVision(league: League, hc: Coach): Vision {
  const lean = new Rng(`${league.seed}:vision:${hc.id}`).normal(0, 0.27);
  const taste = rollScheme(`${league.seed}:taste`, { id: hc.id, role: 'defCoord' })!;
  const stayed = hc.teamId !== null && hc.since !== undefined && hc.since < league.season;
  const oc = stayed ? lastSeasonHolder(league, hc.teamId!, 'offCoord') : undefined;
  const dc = stayed ? lastSeasonHolder(league, hc.teamId!, 'defCoord') : undefined;
  const defense = dc?.scheme?.front ? dc.scheme : hc.scheme?.front ? hc.scheme : taste;
  return {
    pass: oc?.style?.passLean ?? hc.style?.passLean ?? clamp(0.8 * (hc.style?.fourthDown ?? 0) + lean, -1, 1),
    defense: { front: defense.front, coverage: defense.coverage },
    pressure: pressureOf(defense),
  };
}

/** Who held a chair on a team at the end of last season, read off careers (he may have moved on, or retired). */
function lastSeasonHolder(league: League, teamId: number, role: CoachRole): Coach | undefined {
  const last = league.season - 1;
  const held = (c: Coach) => !!c.career?.some((cs) => cs.season === last && cs.teamId === teamId && cs.role === role);
  return Object.values(league.coaches).find(held) ?? Object.values(league.retiredCoaches).find(held);
}

/** How a coordinator fits his head coach's vision: 1 is what he wants, 0 the opposite. Null for other chairs, or with no head coach. */
export function visionFit(league: League, hc: Coach | null, c: Coach, vision?: Vision): number | null {
  if (!hc || (c.role !== 'offCoord' && c.role !== 'defCoord')) return null;
  const v = vision ?? headCoachVision(league, hc);
  if (c.role === 'offCoord') return 1 - Math.min(1, Math.abs((c.style?.passLean ?? 0) - v.pass) / 1.2);
  // The defense he wants by name, front first: matched on a single pressure scale, the rarest fronts would lose every
  // close call to a near enough one and fade from the league.
  return (c.scheme?.front === v.defense.front ? 0.6 : 0) + (c.scheme?.coverage === v.defense.coverage ? 0.4 : 0);
}

/** A vision in plain words, side by side: "a pass-first offense", "a defense that brings pressure", "balance". */
export function visionNotes(v: Vision): { offense: string; defense: string } {
  return {
    offense: v.pass >= 0.3 ? 'a pass-first offense' : v.pass <= -0.3 ? 'a run-first offense' : 'a balanced offense',
    defense: v.pressure >= 0.3 ? 'a defense that brings pressure' : v.pressure <= -0.3 ? 'a defense that rushes four and covers' : 'a balanced defense',
  };
}

// ───────── money ─────────

const BASE_ASK: Record<CoachRole, number> = { headCoach: 7000, offCoord: 2400, defCoord: 2400, strengthCoach: 2400, positionCoach: 1000 };
/** Shorter deals cost more per year; longer ones lock in a discount. */
const TERM: Record<number, number> = { 1: 1.1, 2: 1, 3: 0.95, 4: 0.92, 5: 0.9 };
/** Longest deal a role signs: head coaches get the long contracts. */
export const maxYears = (role: CoachRole) => (role === 'headCoach' ? 5 : 3);
/** How much of a coach's worth is youth development (the rest is veteran care), by what his job leans on. */
const YOUTH_SHARE: Record<CoachRole, number> = { headCoach: 0.5, offCoord: 0.6, defCoord: 0.6, positionCoach: 0.55, strengthCoach: 0.35 };

/** One number for a coach's quality in his role. */
export const coachValue = (c: Pick<Coach, 'role' | 'youth' | 'veterans'>) => YOUTH_SHARE[c.role] * c.youth + (1 - YOUTH_SHARE[c.role]) * c.veterans;

const capOf = (league: League, season = league.season) => league.caps[season] ?? BASE_CAP;

/** Salary he asks for, $K per year: convex in quality, scaled with the cap, and dearer off a winning staff (`pedigree`). */
export function coachAsk(league: League, c: Coach, years = 2): number {
  return Math.round(BASE_ASK[c.role] * (capOf(league) / BASE_CAP) * 1.16 ** (coachValue(c) - 10) * TERM[years] * (1 + PEDIGREE * pedigree(league, c)));
}
/** How much more a coach asks per unit of his staff's last win share over .500: off a 13–4 staff about a fifth more, off 4–13 a fifth less. */
const PEDIGREE = 0.8;
/** Last season's win share of the staff he finished it on, less .500 (0 if he wasn't on one): winners get raises and offers. */
function pedigree(league: League, c: Coach): number {
  const last = c.career?.at(-1);
  if (!last || last.season !== league.season - 1) return 0;
  const rec = league.history.find((h) => h.season === last.season)?.records[last.teamId];
  const games = rec ? rec.w + rec.l + rec.t : 0;
  return rec && games ? (rec.w + 0.5 * rec.t) / games - 0.5 : 0;
}

/** The owner's coaching budget for this league year, $K. The same generosity as his scouting budget. */
export const coachBudget = (league: League, teamId: number, season = league.season) => Math.round(0.095 * capOf(league, season) * league.teams[teamId].staffBudgetMult);

/** Severance booked against a league year's coaching budget. */
export const coachSeverancePaid = (league: League, teamId: number, season = league.season) =>
  league.teams[teamId].coachDead.filter((d) => d.season === season).reduce((sum, d) => sum + d.amount, 0);

/** Salaries owed in a league year plus severance booked against it. */
export function coachPayroll(league: League, teamId: number, season = league.season): number {
  const pay = teamCoaches(league, teamId).reduce((sum, c) => sum + (c.contract && c.contract.through >= season ? c.contract.salary : 0), 0);
  return pay + coachSeverancePaid(league, teamId, season);
}

/**
 * New league year: an owner remembers finishing last year over his coaching budget, and won't go over again this year
 * (`ownerLeeway`). Call it once the year has ticked over, before old severance is forgotten (`developCoaches`).
 */
export function noteCoachOverspend(league: League): void {
  const last = league.season - 1;
  for (const team of league.teams) if (coachPayroll(league, team.id, last) > coachBudget(league, team.id, last)) team.coachOverspent = last;
}

/** Why an owner will or won't go past the coaching budget: a screen turns it into his words. */
export type OwnerReason = 'assistant' | 'lastYear' | 'losing' | 'tight' | 'playoffs' | 'winNow' | 'newCoach' | 'bigMarket' | 'stretch';

/** What an owner will add past the coaching budget for one chair this year ($K), and why. */
export interface OwnerStance {
  amount: number;
  reason: OwnerReason;
  /** The reason in a few plain words. */
  why: string;
}

/**
 * How far past the coaching budget an owner will go for this chair this year. The budget is his comfort zone, not a
 * league rule (the NFL caps players' pay, never coaches'): he'll stretch for a head coach or a coordinator when the
 * team is going somewhere (last season) and his market can carry it, for a new head coach even after a losing year,
 * never for an assistant and never two years running. AI owners and yours answer alike.
 */
export function ownerLeeway(league: League, teamId: number, chair: Chair): OwnerStance {
  const team = league.teams[teamId];
  const no = (reason: OwnerReason, why: string): OwnerStance => ({ amount: 0, reason, why });
  if (!LEADERSHIP.has(chair.role)) return no('assistant', 'he only goes over budget for a head coach or a coordinator');
  if (team.coachOverspent === league.season - 1) return no('lastYear', 'he went over budget last year and wants it kept this year');
  const rec = lastRecord(league, teamId);
  const share = winShare(league, teamId);
  const playoffs = madePlayoffs(league, teamId);
  const contending = playoffs || share >= 0.6;
  const losing = !!rec && share < 0.4;
  if (losing && chair.role !== 'headCoach') return no('losing', `not after a ${recordText(rec!)} season`);
  const amount = Math.round(clamp(LEEWAY.base + LEEWAY.market * (team.staffBudgetMult - 1) + (contending ? LEEWAY.contending : 0), 0, LEEWAY.max) * coachBudget(league, teamId));
  if (amount <= 0) return no('tight', 'his market can’t carry more than the budget');
  if (playoffs) return { amount, reason: 'playoffs', why: 'the team made the playoffs and he wants a title' };
  if (contending) return { amount, reason: 'winNow', why: `after a ${recordText(rec!)} season he wants to win now` };
  if (losing) return { amount, reason: 'newCoach', why: 'a new head coach is worth it after a losing season' };
  if (team.staffBudgetMult >= 1.08) return { amount, reason: 'bigMarket', why: 'a big market can carry it' };
  return { amount, reason: 'stretch', why: 'he’ll stretch a little for the right man' };
}
/** Leeway as a share of the budget: anyone's, per unit of owner budget over average, a contender's extra, the most. */
const LEEWAY = { base: 0.03, market: 0.25, contending: 0.05, max: 0.12 };

/** How far past the coaching budget one of your moves would take you ($K; zero or less: within it). */
export function moveOverspend(league: League, teamId: number, c: Coach, years: number, move: StaffMove | 'replace' | 'promote'): number {
  if (move === 'promote') return coachAsk(league, asPromoted(league, c, promotionFor(c)!), years) - owedNow(league, c) - coachRoom(league, teamId);
  const holder = move === 'replace' ? sitting(league, teamId, c) : null;
  return coachAsk(league, c, years) - coachRoom(league, teamId) - (holder ? freedBy(league, holder) : 0);
}

/** Null if the move fits the budget, or the owner covers the overspend; otherwise what's wrong, with the owner's answer. */
function budgetProblem(league: League, teamId: number, chair: Chair, over: number, replacing?: Coach | null): string | null {
  if (over <= 0) return null;
  const owner = ownerLeeway(league, teamId, chair);
  if (over <= owner.amount) return null;
  const m = (k: number) => `$${(k / 1000).toFixed(2)}M`;
  const by = `Over your coaching budget by ${m(over)}${replacing ? `, even after dismissing ${coachName(replacing)}` : ''}`;
  return owner.amount > 0 ? `${by}; your owner will add ${m(owner.amount)} (${owner.why}), no more.` : `${by}, and your owner won’t go over: ${owner.why}.`;
}

export const coachRoom = (league: League, teamId: number) => coachBudget(league, teamId) - coachPayroll(league, teamId);

/** His deal ran out last league year: he stays through the re-sign window, then leaves unless extended. */
export const isCoachExpiring = (league: League, c: Coach) => !!c.contract && c.contract.through < league.season;

/** Severance for dismissing him now: half of what's left on his deal, at most a year's salary. */
export function coachSeverance(league: League, c: Coach): number {
  if (!c.contract || c.contract.through < league.season) return 0;
  const yearsLeft = c.contract.through - league.season + 1;
  return Math.round(c.contract.salary * Math.min(1, 0.5 * yearsLeft));
}

// ───────── moves ─────────

/** The man in this coach's chair on a team, other than him and not on his way out. */
const sitting = (league: League, teamId: number, c: Coach) => teamCoaches(league, teamId).find((x) => x !== c && sameChair(chairOf(x), chairOf(c)) && !isCoachExpiring(league, x)) ?? null;

/** Why a move can't happen right now, or null. With `budget` false, only what the owner can't wave through (`ownerLeeway`). */
export function coachMoveProblem(league: League, teamId: number, c: Coach, move: StaffMove, years = 2, budget = true): string | null {
  if (!staffWindowOpen(league)) return 'Coaching moves open in the re-sign window and free agency.';
  if (move === 'release') return c.teamId === teamId ? null : 'He doesn’t work for you.';
  if (years < 1 || years > maxYears(c.role)) return `A ${coachTitle(c).toLowerCase()} signs for 1–${maxYears(c.role)} years.`;
  const holder = sitting(league, teamId, c);
  if (move === 'extend') {
    if (c.teamId !== teamId || !isCoachExpiring(league, c)) return 'Only expiring deals can be extended.';
    if (holder) return `His chair is taken: ${coachName(holder)} is your ${coachTitle(c).toLowerCase()}.`;
  } else {
    if (c.teamId !== null) return 'He isn’t available.';
    if (holder) return `You already have a ${coachTitle(c).toLowerCase()}: replace ${coachName(holder)} or dismiss him first.`;
  }
  return budget ? budgetProblem(league, teamId, chairOf(c), moveOverspend(league, teamId, c, years, move)) : null;
}

/** Why `c` can't replace the man in his chair right now, or null (`budget` as in `coachMoveProblem`). Dismissing him frees his salary but books severance. */
export function replaceProblem(league: League, teamId: number, c: Coach, years = 2, budget = true): string | null {
  if (!staffWindowOpen(league)) return 'Coaching moves open in the re-sign window and free agency.';
  if (c.teamId !== null) return 'He isn’t available.';
  if (years < 1 || years > maxYears(c.role)) return `A ${coachTitle(c).toLowerCase()} signs for 1–${maxYears(c.role)} years.`;
  const holder = sitting(league, teamId, c);
  if (!holder) return 'Nobody sits in that chair: hire him instead.';
  return budget ? budgetProblem(league, teamId, chairOf(c), moveOverspend(league, teamId, c, years, 'replace'), holder) : null;
}

/** Who a hire would replace, if his chair is taken. */
export const replaces = (league: League, teamId: number, c: Coach) => sitting(league, teamId, c);

/** Budget a replacement frees this league year: the man's salary, less the severance his dismissal books. */
const freedBy = (league: League, holder: Coach) => (holder.contract?.salary ?? 0) - coachSeverance(league, holder);

function signCoach(league: League, teamId: number, c: Coach, years: number): void {
  touch();
  if (c.teamId !== teamId) c.since = league.season;
  c.teamId = teamId;
  c.contract = { salary: coachAsk(league, c, years), through: league.season + years - 1 };
}

/**
 * Coaching news: everything the user does; around the league, only what makes headlines (head coaches
 * coming and going, coordinators hired), so the news feed isn't buried in assistants.
 */
function logCoach(league: League, teamId: number, c: Coach, text: string, headline = c.role === 'headCoach'): void {
  if (teamId !== league.userTeamId && !headline) return;
  logTransaction(league, 'coach', [teamId], text);
}
const titleLower = (c: Coach) => coachTitle(c).toLowerCase();
const termText = (years: number) => `${years} yr`;

export function hireCoach(league: League, teamId: number, coachId: number, years = 2): void {
  const c = league.coaches[coachId];
  const problem = coachMoveProblem(league, teamId, c, 'hire', years);
  if (problem) throw new Error(problem);
  signCoach(league, teamId, c, years);
  logCoach(league, teamId, c, `${league.teams[teamId].abbrev} hired ${titleLower(c)} ${coachName(c)} (${termText(years)})`);
}

export function extendCoach(league: League, teamId: number, coachId: number, years = 2): void {
  const c = league.coaches[coachId];
  const problem = coachMoveProblem(league, teamId, c, 'extend', years);
  if (problem) throw new Error(problem);
  signCoach(league, teamId, c, years);
  logCoach(league, teamId, c, `${league.teams[teamId].abbrev} extended ${titleLower(c)} ${coachName(c)} (${termText(years)})`);
}

/** Dismiss (or let go) a coach: he returns to the market; severance is booked if he was under contract. */
export function releaseCoach(league: League, teamId: number, coachId: number): void {
  const c = league.coaches[coachId];
  const problem = coachMoveProblem(league, teamId, c, 'release');
  if (problem) throw new Error(problem);
  dismiss(league, c);
}

/** Dismiss the man in his chair and hire `coachId` in one move. */
export function replaceCoach(league: League, teamId: number, coachId: number, years = 2): void {
  const c = league.coaches[coachId];
  const problem = replaceProblem(league, teamId, c, years);
  if (problem) throw new Error(problem);
  dismiss(league, sitting(league, teamId, c)!);
  signCoach(league, teamId, c, years);
  logCoach(league, teamId, c, `${league.teams[teamId].abbrev} hired ${titleLower(c)} ${coachName(c)} (${termText(years)})`);
}

function dismiss(league: League, c: Coach, why?: string): void {
  touch();
  const teamId = c.teamId!;
  const team = league.teams[teamId];
  const owed = coachSeverance(league, c);
  if (owed > 0) team.coachDead.push({ season: league.season, amount: owed, name: coachName(c) });
  logCoach(league, teamId, c, `${team.abbrev} ${owed > 0 ? 'dismissed' : 'let go'} ${titleLower(c)} ${coachName(c)}${why ? ` ${why}` : ''}`);
  c.lastJob = `${coachTitle(c)}, ${team.abbrev}${why ? ` (${why})` : ''}`;
  c.teamId = null;
  c.contract = null;
  delete c.since;
}

// ───────── promotions ─────────

const OFFENSE_ROOMS: ReadonlySet<CoachRoom> = new Set(['QB', 'RB', 'WR', 'OL']);

/** The chair one rung up: a position coach becomes his side's coordinator, a coordinator a head coach. */
export function promotionFor(c: Pick<Coach, 'role' | 'room'>): Chair | null {
  if (c.role === 'offCoord' || c.role === 'defCoord') return { role: 'headCoach' };
  if (c.role === 'positionCoach' && c.room) return { role: OFFENSE_ROOMS.has(c.room) ? 'offCoord' : 'defCoord' };
  return null;
}

/**
 * A coach as he'd be one rung up: the same man and ratings in the new chair, with the play-calling style
 * and scheme it needs rolled once from his id (so a preview is what the promotion gives). What he had
 * stays with him: a head coach who called plays keeps his pass lean, and wants that offense.
 */
export function asPromoted(league: League, c: Coach, chair: Chair): Coach {
  const rng = new Rng(`${league.seed}:promote:${c.id}:${chair.role}`);
  const up: Coach = { ...c, role: chair.role };
  delete up.room;
  const style = { ...rollStyle(rng, chair.role), ...c.style };
  if (Object.keys(style).length) up.style = style;
  const scheme = rollScheme(league.seed, up);
  if (scheme && !(chair.role === 'offCoord' ? c.scheme?.offense : c.scheme?.front)) up.scheme = { ...c.scheme, ...scheme };
  return up;
}

/** Coaches one rung below a chair who could step up into it for this team: its own, the market's and, with `poach`, other staffs' (a team can't block a promotion). */
function risers(league: League, teamId: number, chair: Chair, poach: boolean): Coach[] {
  return Object.values(league.coaches).filter((c) => {
    const up = promotionFor(c);
    if (!up || !sameChair(up, chair) || !c.career?.length) return false;
    return c.teamId === null || c.teamId === teamId || (poach && c.since !== league.season);
  });
}

/** Salary he's owed this league year (nothing once his deal has run out). */
const owedNow = (league: League, c: Coach) => (c.contract && c.contract.through >= league.season ? c.contract.salary : 0);

/** He steps up into the chair above his own on `teamId`'s staff: off another staff with no severance (he chose to go), or within his own. */
function promoteInto(league: League, teamId: number, c: Coach, years: number): void {
  touch();
  const chair = promotionFor(c)!;
  const from = c.teamId;
  const was = titleLower(c);
  const team = league.teams[teamId];
  Object.assign(c, asPromoted(league, c, chair));
  delete c.room;
  if (from !== teamId) {
    c.teamId = null;
    delete c.since;
  }
  signCoach(league, teamId, c, years);
  const text =
    from === teamId
      ? `${team.abbrev} promoted ${was} ${coachName(c)} to ${titleLower(c)}`
      : `${team.abbrev} hired ${from !== null ? `${league.teams[from].abbrev} ` : ''}${was} ${coachName(c)} as ${titleLower(c)}`;
  logTransaction(league, 'coach', from !== null && from !== teamId ? [teamId, from] : [teamId], text);
}

/** Why your coach can't step up into the chair above his right now, or null (`budget` as in `coachMoveProblem`). */
export function promotionProblem(league: League, teamId: number, c: Coach, years = 2, budget = true): string | null {
  if (!staffWindowOpen(league)) return 'Coaching moves open in the re-sign window and free agency.';
  if (c.teamId !== teamId) return 'He doesn’t work for you.';
  const chair = promotionFor(c);
  if (!chair) return 'There is no chair above his.';
  if (!c.career?.length) return 'He needs a season in his chair first.';
  if (years < 1 || years > maxYears(chair.role)) return `A ${COACH_ROLE_LABEL[chair.role].toLowerCase()} signs for 1–${maxYears(chair.role)} years.`;
  const holder = teamCoaches(league, teamId).find((x) => sameChair(chairOf(x), chair) && !isCoachExpiring(league, x));
  if (holder) return `${coachName(holder)} holds that chair: dismiss him first.`;
  return budget ? budgetProblem(league, teamId, chair, moveOverspend(league, teamId, c, years, 'promote')) : null;
}

/** Promote one of your coaches into the open chair above his: a new deal at that chair's going rate, and his old chair opens. */
export function promoteCoach(league: League, teamId: number, coachId: number, years = 2): void {
  const c = league.coaches[coachId];
  const problem = promotionProblem(league, teamId, c, years);
  if (problem) throw new Error(problem);
  promoteInto(league, teamId, c, years);
}

// ───────── careers ─────────

/** The coach a former player became, on a staff, on the market or retired, if he went into coaching. */
export const coachOfPlayer = (league: League, playerId: number): Coach | undefined =>
  Object.values(league.coaches).find((c) => c.playerId === playerId) ?? Object.values(league.retiredCoaches).find((c) => c.playerId === playerId);

/** When a season ends, every coach on a staff is credited with it, in the chair he holds now. */
export function recordCoachSeasons(league: League): void {
  for (const c of Object.values(league.coaches)) {
    if (c.teamId === null) continue;
    const career = (c.career ??= []);
    if (career.some((s) => s.season === league.season)) continue;
    career.push({ season: league.season, teamId: c.teamId, role: c.role, ...(c.room ? { room: c.room } : {}) });
  }
}

// ───────── generation ─────────

/** Candidates kept on the market for each chair. */
const MARKET_SIZE: Record<CoachRole, number> = { headCoach: 12, offCoord: 12, defCoord: 12, strengthCoach: 12, positionCoach: 8 };
/** Ages a candidate for each role comes from: a head coach gets there with experience. */
const CANDIDATE_AGE: Record<CoachRole, [number, number]> = { headCoach: [40, 62], offCoord: [34, 58], defCoord: [34, 58], strengthCoach: [28, 52], positionCoach: [28, 58] };

/** A coach's yearly drift by age: rising into his 30s, still learning into his 50s, fading from 55. */
function trend(age: number): number {
  if (age < 35) return 0.2;
  if (age < 45) return 0.07;
  if (age < 55) return 0.04;
  if (age < 62) return -0.1;
  if (age < 68) return -0.3;
  return -0.5;
}
/** What experience adds by this age, from 28: what a candidate that old has picked up. */
function experience(age: number): number {
  let sum = 0;
  for (let a = 29; a <= age; a++) sum += trend(a);
  return sum;
}
export const coachTrendLabel = (age: number) => (age < 35 ? 'Rising' : age < 55 ? 'Prime' : 'Declining');

/** A play-caller's style: most coaches sit near the middle, a few are known for something. */
function rollStyle(rng: Rng, role: CoachRole): CoachStyle | undefined {
  // `|| 0` keeps −0 out of saves (a JSON round trip would turn it into 0).
  const roll = () => Math.round(clamp(rng.normal(0, 0.45), -1, 1) * 20) / 20 || 0;
  if (role === 'headCoach') return { fourthDown: roll() };
  if (role === 'offCoord') return { passLean: roll() };
  return undefined;
}

function newCoach(league: League, rng: Rng, chair: Chair, youth: number, veterans: number, age: number): Coach {
  const c: Coach = {
    id: league.nextCoachId++,
    firstName: rng.pick(FIRST_NAMES),
    lastName: rng.pick(LAST_NAMES),
    role: chair.role,
    age,
    youth: Math.round(clamp(youth, 1, 20)),
    veterans: Math.round(clamp(veterans, 1, 20)),
    teamId: null,
    contract: null,
  };
  if (chair.room) c.room = chair.room;
  const style = rollStyle(rng, chair.role);
  if (style) c.style = style;
  const scheme = rollScheme(league.seed, c);
  if (scheme) c.scheme = scheme;
  league.coaches[c.id] = c;
  touch();
  return c;
}

/**
 * Entry quality of new candidates for a role: drawn toward the typical coach if the league's employed men in that
 * role drift away from it. Each role keeps its own level because promotions skim the best teachers off the top:
 * left to one league-wide pull, position coaches (who shape development most) would sink while the chairs above rise.
 */
const ENTRY = 8.6;
function entryBase(league: League, role: CoachRole): number {
  const employed = Object.values(league.coaches).filter((c) => c.teamId !== null && c.role === role);
  if (employed.length < 25) return ENTRY;
  const mean = employed.reduce((s, c) => s + coachValue(c), 0) / employed.length;
  return ENTRY + clamp(TYPICAL - mean, -1.5, 1.5);
}

/** A market candidate: experience buys skill; some lean toward developing youth, others toward keeping veterans going. */
function candidate(league: League, rng: Rng, chair: Chair, base: number): Coach {
  const [lo, hi] = CANDIDATE_AGE[chair.role];
  const age = rng.int(lo, hi);
  const level = base + experience(age);
  const lean = rng.normal(0, 1.3);
  const sd = chair.role === 'headCoach' ? 2 : 2.3;
  return newCoach(league, rng, chair, rng.normal(level + lean, sd), rng.normal(level - lean, sd), age);
}

/** Top the market back up to its usual size. */
function refreshMarket(league: League, rng: Rng): void {
  const market = coachMarket(league);
  const bases = new Map(Object.keys(MARKET_SIZE).map((role) => [role, entryBase(league, role as CoachRole)]));
  for (const chair of CHAIRS) {
    const size = MARKET_SIZE[chair.role];
    for (let n = market.filter((c) => sameChair(chairOf(c), chair)).length; n < size; n++) candidate(league, rng, chair, bases.get(chair.role)!);
  }
}

/**
 * Each AI front office's goal for its staff: some invest in coaching, some don't, centred so the
 * league's average staff stays typical. Win-now teams pay for a head coach and coordinators;
 * rebuilders put their money into the teachers. A persistent trait, not stored.
 */
const goalCache = new Map<string, Map<number, number>>();
function teamGoal(league: League, teamId: number): number {
  let goals = goalCache.get(league.seed);
  if (!goals) {
    const z = league.teams.map((t) => new Rng(`${league.seed}:coach-goal:${t.id}`).normal());
    const mean = z.reduce((a, b) => a + b, 0) / z.length;
    goals = new Map(league.teams.map((t, i) => [t.id, TYPICAL + 1.3 * (z[i] - mean)]));
    goalCache.set(league.seed, goals);
  }
  return goals.get(teamId) ?? TYPICAL;
}
function roleGoal(league: League, team: Team, role: CoachRole): number {
  const winNow = league.teams.reduce((s, t) => s + t.gm.winNow, 0) / league.teams.length;
  const tilt = (LEADERSHIP.has(role) ? 3 : -2.5) * (team.gm.winNow - winNow);
  // A contender going for it all aims higher for the men who run the team: that's when budgets get stretched.
  const push = LEADERSHIP.has(role) && madePlayoffs(league, team.id) ? CONTENDER_PUSH : 0;
  return teamGoal(league, team.id) + tilt + ownerTilt(team) + push;
}
/** Rating points a playoff team adds to what it wants in a head coach or coordinator. */
const CONTENDER_PUSH = 1;
const madePlayoffs = (league: League, teamId: number) => !!league.history.find((h) => h.season === league.season - 1)?.playoffs?.[teamId];

/**
 * The opening league: AI staffs of varying quality inside their budgets, and a full, typical staff
 * for the user. Development runs before the first re-sign window, so an empty chair the user could
 * not fill would cost his players a year; his first decisions are the deals that run out after one
 * season (contracts are staggered 1–3 years).
 */
export function generateCoachingWorld(league: League): void {
  const rng = new Rng(`${league.seed}:coach:init`);
  for (const team of league.teams) {
    team.coachDead = [];
    const user = team.id === league.userTeamId;
    const hired: Coach[] = [];
    for (const chair of CHAIRS) {
      const [lo, hi] = CANDIDATE_AGE[chair.role];
      const age = rng.int(lo, hi);
      if (user) {
        const lean = rng.pick([-1, 0, 1]);
        hired.push(newCoach(league, rng, chair, 10.5 + lean + rng.pick([-1, 0, 0, 1]), 10.5 - lean + rng.pick([-1, 0, 0, 1]), age));
      } else {
        const level = TYPICAL + 0.8 * (roleGoal(league, team, chair.role) - TYPICAL);
        const lean = rng.normal(0, 1.2);
        hired.push(newCoach(league, rng, chair, rng.normal(level + lean, 2.2), rng.normal(level - lean, 2.2), age));
      }
    }
    // Stagger contracts so staffs don't all turn over in the same year.
    hired.forEach((c, i) => signCoach(league, team.id, c, user ? (i % 3) + 1 : rng.int(1, maxYears(c.role))));
    // Hired before the league's first season: tenure counts from a year or two back.
    for (const c of hired) c.since = league.season - rng.int(0, c.role === 'headCoach' ? 4 : 2);
    // Fit the budget: the coach paid most above his role's going rate is a little worse than he'd
    // otherwise be (by raw salary it would always be the head coach).
    const premium = (c: Coach) => c.contract!.salary / BASE_ASK[c.role];
    for (let guard = 0; guard < 80 && coachRoom(league, team.id) < 0; guard++) {
      const priciest = hired.reduce((a, b) => (premium(b) > premium(a) ? b : a));
      priciest.youth = Math.max(1, priciest.youth - 1);
      priciest.veterans = Math.max(1, priciest.veterans - 1);
      priciest.contract!.salary = coachAsk(league, priciest, priciest.contract!.through - league.season + 1);
    }
  }
  touch();
  refreshMarket(league, rng);
}

// ───────── the yearly cycle ─────────

/** Base chance a retiring veteran (four seasons or more) goes into coaching, before his football IQ and work ethic. */
const TO_COACH = 0.08;

/**
 * Some players pick up a whistle when they retire: sharp, hard-working veterans most often, nearly always
 * in the room they played in (a few cross to another room on their side of the ball; kickers and punters
 * have none). A first-time coach starts a little below a typical candidate, nearer it for a sharp football
 * mind, and grows from there like any young coach.
 */
function exPlayerCoach(league: League, p: Player, base: number): void {
  const room = ROOM_OF[p.position];
  if (!room || p.experience < 4) return;
  const rng = new Rng(`${league.seed}:to-coach:${p.id}`);
  const iq = p.ratings.awareness - 10;
  const work = p.traits.workEthic - 10;
  if (!rng.chance(clamp(TO_COACH + 0.006 * iq + 0.006 * work, 0.01, 0.15))) return;
  const sameSide = COACH_ROOMS.filter((r) => r !== room && OFFENSE_ROOMS.has(r) === OFFENSE_ROOMS.has(room));
  const level = base - 0.5 + 0.12 * iq + 0.08 * work;
  const lean = rng.normal(0, 1.3);
  const c = newCoach(league, rng, { role: 'positionCoach', room: rng.chance(0.85) ? room : rng.pick(sameSide) }, rng.normal(level + lean, 2.3), rng.normal(level - lean, 2.3), p.age);
  Object.assign(c, { firstName: p.firstName, lastName: p.lastName, playerId: p.id });
}

/**
 * New league year: coaches age and develop, the old retire, part of the unhired market drifts out
 * of football, some of the players who just retired join it, and fresh candidates fill it back up.
 * Old severance is forgotten.
 */
export function developCoaches(league: League, retirees: readonly Player[] = []): void {
  touch();
  const rng = new Rng(`${league.seed}:coach:dev:${league.season}`);
  for (const c of Object.values(league.coaches)) {
    c.age++;
    const t = trend(c.age);
    c.youth = Math.round(clamp(c.youth + rng.normal(t, 0.5), 1, 20));
    c.veterans = Math.round(clamp(c.veterans + rng.normal(t, 0.5), 1, 20));
    // Head coaches and coordinators work into their late 60s; assistants retire a few years sooner.
    const [from, forced, step] = LEADERSHIP.has(c.role) ? [64, 74, 0.1] : [61, 68, 0.15];
    const retires = c.age >= forced || (c.age > from && rng.chance((c.age - from) * step));
    const drifts = c.teamId === null && rng.chance(0.4);
    if (retires || drifts) {
      if (retires && c.teamId !== null) logCoach(league, c.teamId, c, `${league.teams[c.teamId].abbrev} ${titleLower(c)} ${coachName(c)} retired`);
      // Anyone who coached a season stays on file, so his record outlives him; the rest are forgotten.
      if (c.career?.length) {
        c.teamId = null;
        c.contract = null;
        delete c.since;
        league.retiredCoaches[c.id] = c;
      }
      delete league.coaches[c.id];
    }
  }
  for (const team of league.teams) team.coachDead = team.coachDead.filter((d) => d.season >= league.season);
  const base = entryBase(league, 'positionCoach');
  for (const p of retirees) exPlayerCoach(league, p, base);
  touch();
  refreshMarket(league, rng);
}

/**
 * What happens to each of the user's expiring deals when the re-sign window closes, if he does
 * nothing more: best first, each re-signs for two years at his ask while his chair is free and the
 * budget allows. The screen and the calendar both use this, so the forecast is the outcome.
 */
export function coachResignForecast(league: League, teamId: number, hire?: { c: Coach; years: number }): Map<number, ResignOutlook> {
  const mine = teamCoaches(league, teamId);
  const taken: Chair[] = mine.filter((x) => !isCoachExpiring(league, x)).map(chairOf);
  if (hire) taken.push(chairOf(hire.c));
  // A hire into a taken chair is a replacement: the man he replaces frees his salary, less severance.
  const replaced = hire && sitting(league, teamId, hire.c);
  let room = coachRoom(league, teamId) - (hire ? coachAsk(league, hire.c, hire.years) - (replaced ? freedBy(league, replaced) : 0) : 0);
  const out = new Map<number, ResignOutlook>();
  for (const c of mine.filter((x) => isCoachExpiring(league, x)).sort((a, b) => coachValue(b) - coachValue(a))) {
    const ask = coachAsk(league, c, 2);
    if (taken.some((ch) => sameChair(ch, chairOf(c)))) out.set(c.id, 'chair');
    else if (ask > room) out.set(c.id, 'budget');
    else {
      out.set(c.id, 'stays');
      taken.push(chairOf(c));
      room -= ask;
    }
  }
  return out;
}

/** Budget left once the expiring coaches forecast to stay have re-signed. */
export function coachRoomAfterResigns(league: League, teamId: number): number {
  let room = coachRoom(league, teamId);
  for (const [id, outlook] of coachResignForecast(league, teamId)) if (outlook === 'stays') room -= coachAsk(league, league.coaches[id], 2);
  return room;
}

/** Expiring coaches who would re-sign today but not after this hire (it takes their chair or their money). */
export function coachesPushedOutBy(league: League, teamId: number, c: Coach, years = 2): Coach[] {
  const before = coachResignForecast(league, teamId);
  const after = coachResignForecast(league, teamId, { c, years });
  return [...before].filter(([id, outlook]) => outlook === 'stays' && after.get(id) !== 'stays').map(([id]) => league.coaches[id]);
}

/** Last season's record, for the hot seat. */
function lastRecord(league: League, teamId: number): { w: number; l: number; t: number } | null {
  return league.history.find((h) => h.season === league.season - 1)?.records[teamId] ?? null;
}

/**
 * End of the re-sign window. AI teams fire head coaches after bad seasons, keep or let go their
 * expiring coaches and fill open chairs. The user's expiring coaches are re-signed for two years at
 * their ask unless dismissed first, so a missed click never empties a chair; anyone the budget
 * can't cover leaves.
 */
export function coachWindowCloses(league: League, opts: { autoUser?: boolean } = {}): void {
  const rng = new Rng(`${league.seed}:coach:window:${league.season}`);
  const user = league.userTeamId;
  if (!opts.autoUser) {
    for (const [id, outlook] of coachResignForecast(league, user)) {
      const c = league.coaches[id];
      if (outlook === 'stays') {
        signCoach(league, user, c, 2);
        logCoach(league, user, c, `${league.teams[user].abbrev} re-signed ${titleLower(c)} ${coachName(c)} (2 yr)`);
      } else dismiss(league, c);
    }
  }
  const teams = rng.shuffle(league.teams.filter((t) => opts.autoUser || t.id !== user));
  // The market is topped up after each team: with this much turnover a thin pool would leave the last teams journeymen.
  const gone = new Map(
    teams.map((team) => {
      const out = aiCoachMoves(league, team, rng);
      refreshMarket(league, rng);
      return [team.id, out];
    }),
  );
  // Teams that moved early lost men to later teams' promotions: they fill those chairs now, without raiding anyone.
  for (const team of teams) fillChairs(league, team, rng, gone.get(team.id));
  refreshMarket(league, rng);
}

/** Chance an AI team fires its head coach after this record: patience runs out after a couple of bad years. */
export function hotSeat(rec: { w: number; l: number; t: number }, tenure: number): number {
  const games = rec.w + rec.l + rec.t;
  if (!games) return 0;
  const pct = (rec.w + 0.5 * rec.t) / games;
  if (tenure < 2) return pct <= 0.15 ? 0.35 : 0;
  // A winning season (9–8 and up) is always safe.
  return clamp((0.525 - pct) * 3, 0, 0.85);
}

/**
 * How quick an owner is to fire his head coach, ×0.5 (patient) … ×1.5 (quick trigger) on the hot seat. Each
 * owner's own, rolled from the league seed (not stored, never the real club's), centred so the league's
 * firings stay where they are.
 */
export function ownerTrigger(league: League, teamId: number): number {
  return clamp(1 + new Rng(`${league.seed}:owner-trigger:${teamId}`).normal(0, 0.3), 0.5, 1.5);
}
/** The owner's streak in words, where it stands out. */
export const ownerTriggerNote = (trigger: number) => (trigger >= 1.25 ? 'Quick trigger with head coaches' : trigger <= 0.75 ? 'Patient with head coaches' : null);

// Offensive coordinators turn over faster than defensive ones (NFL tenure 2.3 years against 2.6).
const KEEP: Record<CoachRole, number> = { headCoach: 0.95, offCoord: 0.6, defCoord: 0.7, strengthCoach: 0.75, positionCoach: 0.7 };

const recordText = (rec: { w: number; l: number; t: number }) => `${rec.w}–${rec.l}${rec.t ? `–${rec.t}` : ''}`;
/** Last season's win share (0.5 with no record): a winning staff is the one others raid. */
function winShare(league: League, teamId: number | null): number {
  const rec = teamId === null ? null : lastRecord(league, teamId);
  const games = rec ? rec.w + rec.l + rec.t : 0;
  return rec && games ? (rec.w + 0.5 * rec.t) / games : 0.5;
}

/** Chance a head coach who survives a bad season loses a coordinator for it. */
export function scapegoat(rec: { w: number; l: number; t: number }): number {
  const games = rec.w + rec.l + rec.t;
  return games ? clamp((0.5 - (rec.w + 0.5 * rec.t) / games) * 1.5, 0, 0.45) : 0;
}

/** One AI team's window: the hot seat, expiring deals and every open chair. Returns who it let go, so it won't hire them back. */
function aiCoachMoves(league: League, team: Team, rng: Rng): Set<number> {
  // Whoever the team lets go now is not its candidate for the same chair a minute later.
  const gone = new Set<number>();
  const staff = () => teamCoaches(league, team.id);
  const decide = (c: Coach) => {
    const years = rng.int(1, maxYears(c.role));
    const keep = coachValue(c) >= roleGoal(league, team, c.role) - 2 && rng.chance(KEEP[c.role]) && coachAsk(league, c, years) <= spare(league, team.id, chairOf(c));
    if (keep) signCoach(league, team.id, c, years);
    else {
      dismiss(league, c);
      gone.add(c.id);
    }
  };
  const hc = chairHolder(staff(), { role: 'headCoach' });
  const rec = lastRecord(league, team.id);
  // Firing him is paying two head coaches this year: an owner who can't afford a real replacement keeps him.
  const affordable = hc && spare(league, team.id, chairOf(hc)) + owedNow(league, hc) - coachSeverance(league, hc) >= 0.6 * coachAsk(league, hc, 2);
  if (hc && rec && affordable && rng.chance(ownerTrigger(league, team.id) * hotSeat(rec, league.season - (hc.since ?? league.season)))) {
    dismiss(league, hc, `after a ${recordText(rec)} season`);
    gone.add(hc.id);
  } else if (hc && rec && rng.chance(scapegoat(rec))) {
    const coordinator = chairHolder(staff(), { role: rng.chance(0.6) ? 'offCoord' : 'defCoord' });
    if (coordinator && canLetGo(league, team.id, coordinator)) {
      dismiss(league, coordinator, `after a ${recordText(rec)} season`);
      gone.add(coordinator.id);
    }
  }
  // The head coach's deal first: a new one picks his staff (`cleanHouse`) before anyone else's is decided.
  const head = chairHolder(staff(), { role: 'headCoach' });
  if (head && isCoachExpiring(league, head)) decide(head);
  if (!chairHolder(staff(), { role: 'headCoach' })) fillChairs(league, team, rng, gone, true);
  for (const c of staff().filter((x) => isCoachExpiring(league, x))) decide(c);
  fillChairs(league, team, rng, gone, true);
  return gone;
}

/** Who a new head coach keeps, before fit: a coordinator who fits what he wants is worth up to +0.3 (the NFL keeps about one in five). */
const KEEP_FOR_NEW: Record<CoachRole, number> = { headCoach: 1, offCoord: 0.05, defCoord: 0.05, strengthCoach: 0.4, positionCoach: 0.5 };

/** The owner pays a coach off only if what's left covers a typical man in his chair and keeps money aside for every chair not yet paid for (`spare`). */
const canLetGo = (league: League, teamId: number, c: Coach) =>
  spare(league, teamId, chairOf(c)) + owedNow(league, c) - coachSeverance(league, c) >= BASE_ASK[c.role] * (capOf(league) / BASE_CAP);

/**
 * A new head coach brings his own people: a coordinator who fits his vision sometimes stays, one who
 * doesn't almost always goes, and half the teachers stay; the money decides the rest (`canLetGo`). Anyone
 * he keeps whose deal is up re-signs.
 */
function cleanHouse(league: League, team: Team, hc: Coach, rng: Rng, gone: Set<number>): void {
  for (const c of [...teamCoaches(league, team.id)]) {
    if (c === hc || c.since === league.season) continue;
    const years = rng.int(1, maxYears(c.role));
    const expiring = isCoachExpiring(league, c);
    const wanted = rng.chance(KEEP_FOR_NEW[c.role] + 0.3 * (visionFit(league, hc, c) ?? 0));
    const keep = expiring ? wanted && coachAsk(league, c, years) <= spare(league, team.id, chairOf(c)) : wanted || !canLetGo(league, team.id, c);
    if (!keep) {
      dismiss(league, c, 'when a new head coach arrived');
      gone.add(c.id);
    } else if (expiring) signCoach(league, team.id, c, years);
  }
}

/** What leaving a chair's worth of money aside costs: what the one-year journeyman (rated about 6) a team falls back on can ask. */
const reserveFor = (league: League, role: CoachRole) => 0.66 * BASE_ASK[role] * (capOf(league) / BASE_CAP);

/**
 * What an AI team can spend on one chair: its budget room plus what the owner will add for it (`ownerLeeway`, unless
 * `withOwner` is false), less money set aside for every other chair not yet paid for this year (empty, or its man's
 * deal is up). Every AI money decision reads it.
 */
function spare(league: League, teamId: number, except: Chair, withOwner = true, teachersFirst = false): number {
  const staff = teamCoaches(league, teamId);
  const unpaid = CHAIRS.filter((ch) => {
    if (sameChair(ch, except)) return false;
    const holder = chairHolder(staff, ch);
    return !holder || isCoachExpiring(league, holder);
  });
  // Hiring a head coach or coordinator, a GM keeps a typical teacher's pay aside for every open teaching chair: the
  // big names don't get to starve the rooms (going past the budget for them is the owner's call, `ownerLeeway`).
  const aside = (role: CoachRole) => (teachersFirst && !LEADERSHIP.has(role) ? BASE_ASK[role] * (capOf(league) / BASE_CAP) : reserveFor(league, role));
  return coachRoom(league, teamId) + (withOwner ? ownerLeeway(league, teamId, except).amount : 0) - unpaid.reduce((sum, ch) => sum + aside(ch.role), 0);
}

/** How much a coordinator's fit with the head coach weighs in an AI hire, in rating points (none at all to the opposite of what he wants). */
const VISION_WEIGHT = 1.5;
/** A promotion has to look this much better than a man who has held the chair (rating points)… */
const RISER_COST = 0.5;
/** …less this much per unit of his team's last win share over .500: a winning staff is the one that gets raided… */
const HOT = 2;
/** …and less this for the team's own man, who knows the building. */
const INSIDER = 0.6;
/** A leadership candidate who has never held a chair in the league (a college coach, an outsider) has this much to prove… */
const OUTSIDER = 0.8;
/** …and one who has held this very chair before (a former head coach, most often) this much less: about a third of the NFL's new head coaches are retreads. */
const PROVEN = 0.35;

/** Score points per typical salary an AI hire would take the team past its budget. */
const OVERSPEND = 1.5;

interface Hire {
  c: Coach;
  /** Him in the chair: himself, or as he'd be promoted into it. */
  as: Coach;
}

/**
 * Hire into every empty chair, closest to the team's goal for that role, leaving room for the chairs still
 * open; a coordinator is judged on fit with the head coach as well. Head coach and coordinator chairs can go
 * to a man one rung below: the team's own, the market's or, with `poach` (the window), another staff's. The
 * chair he leaves opens in turn, and a new head coach then picks his staff (`cleanHouse`).
 */
function fillChairs(league: League, team: Team, rng: Rng, gone: Set<number> = new Set(), poach = false): void {
  const open = () => CHAIRS.filter((ch) => !chairHolder(teamCoaches(league, team.id), ch));
  // A chair is tried once: a promotion only ever opens chairs further down the list.
  const tried: Chair[] = [];
  for (let chair: Chair | undefined = open()[0]; chair; chair = open().find((ch) => !tried.some((t) => sameChair(t, ch)))) {
    tried.push(chair);
    const years = rng.int(1, maxYears(chair.role));
    const hc = chairHolder(teamCoaches(league, team.id), { role: 'headCoach' });
    const vision = hc && (chair.role === 'offCoord' || chair.role === 'defCoord') ? headCoachVision(league, hc) : undefined;
    const candidates: Hire[] = [
      ...coachMarket(league)
        .filter((c) => sameChair(chairOf(c), chair))
        .map((c) => ({ c, as: c })),
      ...risers(league, team.id, chair, poach).map((c) => ({ c, as: asPromoted(league, c, chair) })),
    ].filter((x) => !gone.has(x.c.id));
    // Promoting his own man frees what he's paid now, and opens his chair to fill.
    const cost = (x: Hire) => coachAsk(league, x.as, years) - (x.c.teamId === team.id ? owedNow(league, x.c) - reserveFor(league, x.c.role) : 0);
    // Only what leaves the money set aside for the other chairs: overspend here and the last chair can't be paid.
    const leading = LEADERSHIP.has(chair.role);
    const pool = candidates.filter((x) => cost(x) <= spare(league, team.id, chair, true, leading));
    // Going past the budget (on the owner's word) has to buy a clearly better man: a typical salary over costs OVERSPEND points.
    const within = spare(league, team.id, chair, false, leading);
    const overspend = (x: Hire) => (OVERSPEND * Math.max(0, cost(x) - within)) / (BASE_ASK[chair.role] * (capOf(league) / BASE_CAP));
    const goal = roleGoal(league, team, chair.role);
    const score = (x: Hire) =>
      Math.abs(coachValue(x.as) - goal) +
      VISION_WEIGHT * (1 - (visionFit(league, hc, x.as, vision) ?? 1)) +
      overspend(x) +
      (x.as !== x.c
        ? RISER_COST - HOT * (winShare(league, x.c.teamId) - 0.5) - (x.c.teamId === team.id ? INSIDER : 0)
        : !LEADERSHIP.has(chair.role)
          ? 0
          : !x.c.career?.length
            ? OUTSIDER
            : x.c.career.some((cs) => cs.role === chair.role)
              ? -PROVEN
              : 0) +
      rng.normal(0, 0.6);
    const pick = pool.map((x) => ({ x, s: score(x) })).sort((a, b) => a.s - b.s)[0]?.x;
    if (pick && pick.as !== pick.c) promoteInto(league, team.id, pick.c, years);
    else {
      // Nobody affordable: a journeyman takes the job on a one-year deal, so no chair stays empty. Rated about 6, he
      // costs no more than the money a chair has set aside (`reserveFor`).
      const hire = pick?.c ?? newCoach(league, rng, chair, rng.normal(6, 0.8), rng.normal(6, 0.8), rng.int(30, 45));
      signCoach(league, team.id, hire, pick ? years : 1);
      logCoach(league, team.id, hire, `${team.abbrev} hired ${coachName(hire)} as ${titleLower(hire)}`, LEADERSHIP.has(chair.role));
    }
    if (chair.role === 'headCoach' && poach) cleanHouse(league, team, chairHolder(teamCoaches(league, team.id), chair)!, rng, gone);
  }
}

/** Before the season: no AI team starts with an empty chair (vacancies from retirements). */
export function ensureCoached(league: League, opts: { autoUser?: boolean } = {}): void {
  const rng = new Rng(`${league.seed}:coach:camp:${league.season}`);
  for (const team of league.teams) if (opts.autoUser || team.id !== league.userTeamId) fillChairs(league, team, rng);
}

// ───────── reporting ─────────

/** A staff's worth to a typical roster: its average growth gain minus its average aging cost, by roster spots. */
export function staffScore(coaches: readonly Coach[]): number {
  let score = 0;
  let n = 0;
  for (const pos of POSITIONS) {
    const e = effectOf(coachingFrom(coaches, pos), pos);
    score += (e.growth - e.aging) * ROSTER_TEMPLATE[pos];
    n += ROSTER_TEMPLATE[pos];
  }
  return score / n;
}

/** Letter grade by rank among the 32 staffs: A top 3, B next 6, C middle 14, D next 6, F bottom 3. */
/** `see` is how a screen's team reads other clubs' coaches (`seenCoach`), so a ranking never leaks their true ratings. */
export function coachingGrades(league: League, see: (c: Coach) => Coach = (c) => c): Map<number, { rank: number; grade: string }> {
  const ranked = league.teams.map((t) => ({ id: t.id, score: staffScore(teamCoaches(league, t.id).map(see)) })).sort((a, b) => b.score - a.score);
  return new Map(ranked.map((x, i) => [x.id, { rank: i + 1, grade: i < 3 ? 'A' : i < 9 ? 'B' : i < 23 ? 'C' : i < 29 ? 'D' : 'F' }]));
}

export interface RoomChange {
  /** null = kickers and punters. */
  room: CoachRoom | null;
  from: Effect;
  to: Effect;
}

/**
 * What hiring `c` would change for each room, comparing the staff as it will stand with and without
 * him: expiring coaches forecast to re-sign count as staying, anyone the hire would push out (or the
 * man he replaces) counts as gone, so losses show as well as gains.
 */
export function previewCoachHire(league: League, teamId: number, c: Coach, years = 2, seen: Coach = c): RoomChange[] {
  const staying = (forecast: Map<number, ResignOutlook>) => teamCoaches(league, teamId).filter((x) => !isCoachExpiring(league, x) || forecast.get(x.id) === 'stays');
  const now = staying(coachResignForecast(league, teamId));
  // His ask (and so the budget) is the real man's; what he'd do for the rooms is the team's read of him (`seen`).
  const after = [...staying(coachResignForecast(league, teamId, { c, years })).filter((x) => !sameChair(chairOf(x), chairOf(c))), seen];
  const out: RoomChange[] = [];
  for (const room of [...COACH_ROOMS, null]) {
    const from = roomEffect(now, room);
    const to = roomEffect(after, room);
    if (Math.abs(to.growth - from.growth) > 0.0005 || Math.abs(to.aging - from.aging) > 0.0005) out.push({ room, from, to });
  }
  return out;
}
