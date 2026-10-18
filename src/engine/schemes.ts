/**
 * Schemes: what a coordinator runs. The offensive coordinator brings an offense, the defensive
 * coordinator a front and a coverage family. Each one is data the match engine reads (the mix of
 * runs and throws, who gets the ball, who rushes, how the secondary plays), so a scheme on a card is
 * a scheme on the field. Every effect is a lean from today's league-average engine (an empty chair
 * calls `BASE_*`), and the leans trade something for something, so league totals stay put.
 *
 * Labels follow football's own shorthand (and the NCAA/Madden playbook names fans know), never a
 * licensed mark.
 */
import type { ContestName } from './attributes';
import { clamp, Rng } from './rng';
import type { Coach, Position } from './types';

// ───────── offense ─────────

export type OffSchemeId = 'proStyle' | 'westCoast' | 'airRaid' | 'vertical' | 'wideZone' | 'power' | 'spreadOption';
/** Base personnel: backs and tight ends on the field (11 = 1 RB, 1 TE, 3 WR). */
export type Personnel = '11' | '12' | '10';

export interface OffScheme {
  id: OffSchemeId;
  label: string;
  /** One line for a card. */
  about: string;
  personnel: Personnel;
  /** Share of designed runs that go to the edge (league: 0.4). */
  outside: number;
  /** Shift to the short / medium / deep mix of ordinary throws (sums to 0). */
  depth: [number, number, number];
  /** Target-weight multipliers: outside receivers, the slot (WR3 or WR4), tight ends, backs. */
  targets: { wr: number; slot: number; te: number; rb: number };
  /** Extra designed-run weight for the quarterback (read option, RPO keepers). */
  qbRun: number;
  /** Timing: separation on short throws (rhythm routes hit before the coverage settles). */
  quick: number;
  /** Ratings points off the pass rush: quick drops beat it, deep drops hold the ball and feed it. */
  release: number;
  /**
   * Play action off a run game the defense has to respect: separation on early-down medium and deep
   * throws, scaled by how well the line run-blocks (a weak run game sells nothing).
   */
  playAction: number;
  /** How the scheme leans run/pass when a coach is rolled (it shapes his `passLean`). */
  lean: number;
  /** What the scheme asks of each position, for fit (contests it leans on harder than others do). */
  fit: Partial<Record<Position, ContestName[]>>;
}

const NO_TARGETS = { wr: 1, slot: 1, te: 1, rb: 1 };

export const OFF_SCHEMES: Record<OffSchemeId, OffScheme> = {
  proStyle: {
    id: 'proStyle',
    label: 'Pro Style',
    about: 'Balanced under center and in the gun: a bit of everything, no glaring tell.',
    personnel: '11',
    outside: 0.4,
    depth: [0, 0, 0],
    targets: NO_TARGETS,
    qbRun: 0,
    quick: 0,
    release: 0,
    playAction: 0,
    lean: 0,
    fit: {},
  },
  westCoast: {
    id: 'westCoast',
    label: 'West Coast',
    about: 'Timing throws underneath; backs and tight ends catch a lot, the yards come after the catch.',
    personnel: '11',
    outside: 0.4,
    depth: [0.08, -0.04, -0.04],
    targets: { wr: 0.95, slot: 1, te: 1.15, rb: 1.2 },
    qbRun: 0,
    quick: 0.8,
    release: 0.8,
    playAction: 0,
    lean: 0.15,
    fit: { QB: ['shortAccuracy', 'decisionMaking'], WR: ['shortRoutes', 'afterCatch'], TE: ['shortRoutes', 'hands'], RB: ['targeting', 'afterCatch'] },
  },
  airRaid: {
    id: 'airRaid',
    label: 'Air Raid',
    about: 'Four wide, spread the field and throw: the slot receivers eat, the tight end sits.',
    personnel: '10',
    outside: 0.45,
    depth: [-0.02, 0.05, -0.03],
    targets: { wr: 1, slot: 1.35, te: 0.7, rb: 0.8 },
    qbRun: 0,
    quick: 0.35,
    release: 0.7,
    playAction: 0,
    lean: 0.55,
    fit: { QB: ['shortAccuracy', 'midAccuracy'], WR: ['shortRoutes', 'targeting'], OL: ['passPro'] },
  },
  vertical: {
    id: 'vertical',
    label: 'Air Coryell',
    about: 'Vertical passing: stretch the field with the outside receivers and take shots deep.',
    personnel: '11',
    outside: 0.4,
    depth: [-0.07, 0.02, 0.05],
    targets: { wr: 1.15, slot: 0.95, te: 0.95, rb: 0.7 },
    qbRun: 0,
    quick: 0,
    release: -0.3,
    playAction: 0.15,
    lean: 0.35,
    fit: { QB: ['deepAccuracy'], WR: ['deepRoutes'], OL: ['passPro'] },
  },
  wideZone: {
    id: 'wideZone',
    label: 'Wide Zone',
    about: 'Outside zone runs stretch the defense, then boots and play action over the top of it.',
    personnel: '11',
    outside: 0.6,
    depth: [-0.03, 0.05, -0.02],
    targets: { wr: 1, slot: 1, te: 1.1, rb: 1.1 },
    qbRun: 0,
    quick: 0,
    release: 0,
    playAction: 0.3,
    lean: -0.3,
    fit: { RB: ['outsideRun'], OL: ['runBlocking'], QB: ['midAccuracy'], TE: ['runBlocking'] },
  },
  power: {
    id: 'power',
    label: 'Power Gap',
    about: 'Two tight ends and downhill runs between the tackles; shots off play action.',
    personnel: '12',
    outside: 0.25,
    depth: [-0.02, -0.01, 0.03],
    targets: { wr: 1.05, slot: 1, te: 1.25, rb: 0.9 },
    qbRun: 0,
    quick: 0,
    release: 0,
    playAction: 0.1,
    lean: -0.5,
    fit: { RB: ['insideRun', 'breakTackles'], OL: ['runBlocking'], TE: ['runBlocking'] },
  },
  spreadOption: {
    id: 'spreadOption',
    label: 'Spread Option',
    about: 'Read option and RPOs from the gun: the quarterback runs, the throws come quick.',
    personnel: '11',
    outside: 0.5,
    depth: [0.06, -0.03, -0.03],
    targets: { wr: 0.95, slot: 1.3, te: 0.8, rb: 1 },
    qbRun: 0.045,
    quick: 0.25,
    release: 0.4,
    playAction: 0.15,
    lean: -0.1,
    fit: { QB: ['scrambling', 'shortAccuracy'], RB: ['outsideRun'], WR: ['shortRoutes'] },
  },
};
export const OFF_SCHEME_IDS = Object.keys(OFF_SCHEMES) as OffSchemeId[];
export const BASE_OFFENSE = OFF_SCHEMES.proStyle;

export const PERSONNEL_LABEL: Record<Personnel, string> = {
  '11': '11 personnel (1 RB, 1 TE, 3 WR)',
  '12': '12 personnel (1 RB, 2 TE, 2 WR)',
  '10': '10 personnel (1 RB, 4 WR)',
};

// ───────── defense ─────────

export type FrontId = 'fourThree' | 'wide9' | 'threeFour' | 'fireZone' | 'nickel';
export type CoverageId = 'cover1' | 'cover2' | 'cover3' | 'quarters';

export interface Front {
  id: FrontId;
  label: string;
  about: string;
  /** Pass-rush composite weights: edges, interior, linebackers (league: 0.55 / 0.35 / 0.1). */
  rush: { edge: number; dt: number; lb: number };
  /** Run-stop composite weights: interior, edges, linebackers, safeties (league: 0.35 / 0.25 / 0.3 / 0.1). */
  run: { dt: number; edge: number; lb: number; s: number };
  /** Ratings points on the unit composites: a front built to rush gives ground against the run, and back. */
  rushAdj: number;
  runAdj: number;
  /** Change to how well the edges turn outside runs back in. */
  containAdj: number;
  /** Blitz-rate multiplier. */
  blitz: number;
  /** Spot names for the depth chart, in depth order. */
  spots: { EDGE: string[]; DT: string[]; LB: string[]; CB: string[] };
  fit: Partial<Record<Position, ContestName[]>>;
}

export const FRONTS: Record<FrontId, Front> = {
  fourThree: {
    id: 'fourThree',
    label: '4-3',
    about: 'Four down linemen win their gaps; two linebackers run and hit behind them.',
    rush: { edge: 0.55, dt: 0.35, lb: 0.1 },
    run: { dt: 0.35, edge: 0.25, lb: 0.3, s: 0.1 },
    rushAdj: 0,
    runAdj: 0,
    containAdj: 0,
    blitz: 1,
    spots: { EDGE: ['RE', 'LE'], DT: ['DT', 'NT'], LB: ['MLB', 'WLB'], CB: ['CB1', 'CB2', 'NB'] },
    fit: { DT: ['interiorRush', 'runDefense'], EDGE: ['edgeRush'], LB: ['runFit'] },
  },
  wide9: {
    id: 'wide9',
    label: '4-3 Wide 9',
    about: 'Ends split way outside and pin their ears back: more heat, softer against runs to the edge.',
    rush: { edge: 0.65, dt: 0.28, lb: 0.07 },
    run: { dt: 0.4, edge: 0.2, lb: 0.3, s: 0.1 },
    rushAdj: 0.35,
    runAdj: -0.25,
    containAdj: -0.8,
    blitz: 0.8,
    spots: { EDGE: ['RE', 'LE'], DT: ['DT', 'DT'], LB: ['MLB', 'WLB'], CB: ['CB1', 'CB2', 'NB'] },
    fit: { EDGE: ['edgeRush'], DT: ['interiorRush'] },
  },
  threeFour: {
    id: 'threeFour',
    label: '3-4 Two-Gap',
    about: 'A big nose and ends who two-gap and eat blocks, so the linebackers run free. Stout, not flashy.',
    rush: { edge: 0.55, dt: 0.25, lb: 0.2 },
    run: { dt: 0.45, edge: 0.2, lb: 0.3, s: 0.05 },
    rushAdj: -0.3,
    runAdj: 0.4,
    containAdj: 0.3,
    blitz: 1.1,
    spots: { EDGE: ['ROLB', 'LOLB'], DT: ['DE', 'NT'], LB: ['MIKE', 'WILL'], CB: ['CB1', 'CB2', 'NB'] },
    fit: { DT: ['runDefense'], EDGE: ['setEdge', 'edgeRush'], LB: ['runFit'] },
  },
  fireZone: {
    id: 'fireZone',
    label: '3-4 Fire Zone',
    about: 'Odd front that sends pressure from everywhere: linebackers and DBs blitz, zone behind it.',
    rush: { edge: 0.55, dt: 0.25, lb: 0.2 },
    run: { dt: 0.35, edge: 0.25, lb: 0.3, s: 0.1 },
    rushAdj: 0.45,
    runAdj: -0.15,
    containAdj: 0,
    blitz: 1.7,
    spots: { EDGE: ['ROLB', 'LOLB'], DT: ['DE', 'NT'], LB: ['MIKE', 'MO'], CB: ['CB1', 'CB2', 'NB'] },
    fit: { LB: ['edgeRush'], EDGE: ['edgeRush'] },
  },
  nickel: {
    id: 'nickel',
    label: '4-2-5 Nickel',
    about: 'Lighter and faster: an extra defensive back as the base, built to stop the pass first.',
    rush: { edge: 0.55, dt: 0.35, lb: 0.1 },
    run: { dt: 0.35, edge: 0.25, lb: 0.25, s: 0.15 },
    rushAdj: 0.1,
    runAdj: -0.45,
    containAdj: 0,
    blitz: 0.9,
    spots: { EDGE: ['RE', 'LE'], DT: ['DT', 'DT'], LB: ['MLB', 'WLB'], CB: ['CB1', 'CB2', 'STAR'] },
    fit: { CB: ['coverage'], S: ['runFit'], LB: ['coverage'] },
  },
};
export const FRONT_IDS = Object.keys(FRONTS) as FrontId[];

export interface Coverage {
  id: CoverageId;
  label: string;
  about: string;
  /** Man coverage: the matchup decides more (stronger weight on the defender), backs turned on the ball. */
  man: boolean;
  /** Safeties deep: two-high shells take a defender out of the box. */
  twoHigh: boolean;
  /** Separation by depth (short, medium, deep): where the coverage is soft and where it isn't. */
  sep: [number, number, number];
  /** Ratings points on run stop from the shell (a single-high safety rolls into the box). */
  runAdj: number;
  /** Interception odds multiplier (zone eyes on the quarterback; man trails the receiver). */
  ints: number;
  /** Long run after the catch multiplier. */
  yac: number;
  /** Blitz-rate multiplier. */
  blitz: number;
  fit: Partial<Record<Position, ContestName[]>>;
}

export const COVERAGES: Record<CoverageId, Coverage> = {
  cover1: {
    id: 'cover1',
    label: 'Cover 1 Man',
    about: 'Press man across the board with one safety deep: lockdown corners win it, beaten ones lose it.',
    man: true,
    twoHigh: false,
    sep: [-0.15, 0, 0.1],
    runAdj: 0.35,
    ints: 0.9,
    yac: 1.15,
    blitz: 1.2,
    fit: { CB: ['coverage', 'deepCoverage'], S: ['deepHelp'] },
  },
  cover2: {
    id: 'cover2',
    label: 'Tampa 2',
    about: 'Two deep safeties and a middle linebacker who carries the seam: nothing over the top, holes in between.',
    man: false,
    twoHigh: true,
    sep: [0.1, 0.25, -0.45],
    runAdj: -0.3,
    ints: 1.1,
    yac: 0.9,
    blitz: 0.8,
    fit: { LB: ['coverage'], S: ['deepHelp'], CB: ['tackling'] },
  },
  cover3: {
    id: 'cover3',
    label: 'Cover 3',
    about: 'Single-high zone: a safety in the box against the run, the deep thirds closed, the flats open.',
    man: false,
    twoHigh: false,
    sep: [0.2, -0.05, -0.15],
    runAdj: 0.3,
    ints: 1.05,
    yac: 1,
    blitz: 1,
    fit: { S: ['deepHelp', 'runFit'], CB: ['deepCoverage'] },
  },
  quarters: {
    id: 'quarters',
    label: 'Quarters',
    about: 'Cover 4 pattern-matching: safeties read the run and rob the deep ball. Hard to throw on, weaker in the flats.',
    man: false,
    twoHigh: true,
    sep: [0.25, -0.1, -0.3],
    runAdj: 0,
    ints: 1,
    yac: 0.95,
    blitz: 0.9,
    fit: { S: ['runFit', 'deepHelp'], CB: ['coverage'] },
  },
};
export const COVERAGE_IDS = Object.keys(COVERAGES) as CoverageId[];

/** What a coordinator runs. Offensive coordinators carry `offense`; defensive ones `front` and `coverage`. */
export interface CoachScheme {
  offense?: OffSchemeId;
  front?: FrontId;
  coverage?: CoverageId;
}

/** A team's schemes as the engine reads them; an empty chair runs the league-average base. */
export interface TeamScheme {
  offense: OffScheme;
  front: Front;
  coverage: Coverage | null;
}

// ───────── spots ─────────

/** Offensive spots by base personnel, in depth order. The rest of the room is depth. */
const OFF_SPOTS: Record<Personnel, Partial<Record<Position, string[]>>> = {
  '11': { QB: ['QB'], RB: ['HB'], WR: ['X', 'Z', 'SLOT'], TE: ['Y'], OL: ['LT', 'LG', 'C', 'RG', 'RT'] },
  '12': { QB: ['QB'], RB: ['HB'], WR: ['X', 'Z'], TE: ['Y', 'F'], OL: ['LT', 'LG', 'C', 'RG', 'RT'] },
  '10': { QB: ['QB'], RB: ['HB'], WR: ['X', 'Z', 'SLOT', 'H'], TE: [], OL: ['LT', 'LG', 'C', 'RG', 'RT'] },
};

/** Starting spot names at a position under a team's schemes (empty: nobody starts there). */
export function spotsFor(scheme: TeamScheme, pos: Position): string[] {
  const off = OFF_SPOTS[scheme.offense.personnel][pos];
  if (off) return off;
  if (pos === 'EDGE' || pos === 'DT' || pos === 'LB' || pos === 'CB') return scheme.front.spots[pos];
  if (pos === 'S') return ['FS', 'SS'];
  return [pos];
}

// ───────── fit ─────────

/** The contests a team's schemes lean on at a position (offense from the OC, defense from the DC). */
export function fitContests(scheme: TeamScheme, pos: Position): ContestName[] {
  const all = [...(scheme.offense.fit[pos] ?? []), ...(scheme.front.fit[pos] ?? []), ...(scheme.coverage?.fit[pos] ?? [])];
  return [...new Set(all)];
}

export type FitGrade = 'Ideal' | 'Good' | 'Average' | 'Poor';
/**
 * How a player's read of the skills a scheme leans on compares with a typical starter (12 on the
 * contest scale). Takes contest values, so callers decide whose eyes: the user's view for screens.
 */
export function fitGrade(values: number[]): FitGrade | null {
  if (!values.length) return null;
  const v = values.reduce((a, b) => a + b, 0) / values.length;
  return v >= 14.5 ? 'Ideal' : v >= 12 ? 'Good' : v >= 9.5 ? 'Average' : 'Poor';
}

// ───────── labels ─────────

export const offenseLabel = (id: OffSchemeId | undefined) => (id ? OFF_SCHEMES[id].label : BASE_OFFENSE.label);
export const defenseLabel = (front: FrontId | undefined, coverage: CoverageId | undefined) =>
  [front ? FRONTS[front].label : null, coverage ? COVERAGES[coverage].label : null].filter(Boolean).join(' · ');

/** The scheme pill a coach's card shows ("Air Raid", "3-4 Two-Gap · Cover 1 Man"), or null. */
export function coachSchemeLabel(c: Pick<Coach, 'role' | 'scheme'>): string | null {
  if (c.role === 'offCoord') return offenseLabel(c.scheme?.offense);
  if (c.role === 'defCoord') return defenseLabel(c.scheme?.front, c.scheme?.coverage) || null;
  return null;
}

// ───────── generation ─────────

/**
 * A coordinator's scheme, from his own seeded stream (league seed and coach id), so rolling it never
 * shifts the league's main random stream, and an upgraded save gets the scheme a new league would.
 * An offensive coordinator's scheme follows his run/pass lean: pass-first men run passing offenses.
 */
export function rollScheme(seed: string, c: Pick<Coach, 'id' | 'role' | 'style'>): CoachScheme | undefined {
  const rng = new Rng(`${seed}:scheme:${c.id}`);
  if (c.role === 'offCoord') {
    const lean = c.style?.passLean ?? 0;
    // Closer leans weigh more; Pro Style is everyone's fallback.
    return { offense: rng.weighted(OFF_SCHEME_IDS, (id) => (id === 'proStyle' ? 1.2 : 0.15 + Math.exp(-((lean - OFF_SCHEMES[id].lean) ** 2) / 0.12))) };
  }
  if (c.role === 'defCoord') {
    const front = rng.weighted(FRONT_IDS, (id) => (id === 'fourThree' ? 1.4 : id === 'threeFour' ? 1.2 : 1));
    // Fire-zone fronts play zone behind the pressure; everyone else picks freely.
    const coverage = rng.weighted(COVERAGE_IDS, (id) => (front === 'fireZone' && id === 'cover1' ? 0.4 : id === 'cover3' ? 1.3 : 1));
    return { front, coverage };
  }
  return undefined;
}

/** Clamp-safe shift of a three-way mix by a scheme's lean; keeps every share positive. */
export function shiftMix(mix: [number, number, number], by: [number, number, number]): [number, number, number] {
  return [clamp(mix[0] + by[0], 0.01, 1), clamp(mix[1] + by[1], 0, 1), clamp(mix[2] + by[2], 0, 1)];
}

/** A team's schemes if `c` took over his side of the ball (for previewing a coordinator hire). */
export function schemeWith(scheme: TeamScheme, c: Pick<Coach, 'role' | 'scheme'>): TeamScheme {
  if (c.role === 'offCoord') return { ...scheme, offense: OFF_SCHEMES[c.scheme?.offense ?? 'proStyle'] };
  if (c.role === 'defCoord') return { ...scheme, front: FRONTS[c.scheme?.front ?? 'fourThree'], coverage: c.scheme?.coverage ? COVERAGES[c.scheme.coverage] : null };
  return scheme;
}

/** One line on what a coordinator's scheme is about. */
export function coachSchemeAbout(c: Pick<Coach, 'role' | 'scheme'>): string | null {
  if (c.role === 'offCoord') return OFF_SCHEMES[c.scheme?.offense ?? 'proStyle'].about;
  if (c.role === 'defCoord' && c.scheme?.front) return `${FRONTS[c.scheme.front].about}${c.scheme.coverage ? ` ${COVERAGES[c.scheme.coverage].about}` : ''}`;
  return null;
}

/**
 * How much pressure a defense brings, about −1 (rushes four, sits in coverage) … 1.8 (a fire zone in man): its blitz
 * rate on a log scale, so "Blitz-happy" (×1.3) reads about 0.65 and "Rushes four" (×0.75) about −0.7. Not capped: a
 * head coach who wants a fire zone can tell one from a milder 3-4 man scheme.
 */
export function pressureOf(s: CoachScheme): number {
  const blitz = (s.front ? FRONTS[s.front].blitz : 1) * (s.coverage ? COVERAGES[s.coverage].blitz : 1);
  return Math.log(blitz) / Math.log(1.5);
}

/**
 * A defensive coordinator's identity in a tag or two, read off what his front and coverage do in a game
 * (blitz rate, man or zone, safeties deep, the lean against the run): the defense's answer to an offensive
 * coordinator's "Pass-first". Empty for a balanced defense.
 */
export function defenseNotes(c: Pick<Coach, 'role' | 'scheme'>): string[] {
  if (c.role !== 'defCoord' || !c.scheme?.front) return [];
  const front = FRONTS[c.scheme.front];
  const cov = c.scheme.coverage ? COVERAGES[c.scheme.coverage] : null;
  const blitz = front.blitz * (cov?.blitz ?? 1);
  const run = front.runAdj + (cov?.runAdj ?? 0);
  const out: string[] = [];
  if (blitz >= 1.3) out.push('Blitz-happy');
  else if (blitz <= 0.75) out.push('Rushes four');
  if (cov?.man) out.push('Press man');
  else if (cov?.twoHigh) out.push('Two-high shell');
  if (out.length < 2 && run >= 0.5) out.push('Stops the run first');
  else if (out.length < 2 && run <= -0.5) out.push('Built for the pass');
  return out;
}
