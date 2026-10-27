/**
 * The attribute registry: what every rating means, how it ages, and the named contests the match
 * engine resolves with it. Every rating the engine reads goes through `skill(player, contest)`, so
 * this file is the single map from ratings to plays. Tooltips, the scout report and the
 * attribute audit (`npm run audit`) all read it; a new attribute is not done until a contest here
 * uses it and the audit shows it moves outcomes.
 */
import { OVR_WEIGHTS } from './positions';
import type { Attribute, Player, Position } from './types';
import { ATTRIBUTES } from './types';

export type AttributeGroup = 'Physical' | 'Mental' | 'Passing' | 'Ball skills' | 'Blocking' | 'Defense' | 'Kicking';
/** How a rating moves with age: physical tools peak early and fade first, mental ones keep growing. */
export type AgingFamily = 'physical' | 'technical' | 'mental';

export interface AttributeInfo {
  short: string;
  label: string;
  group: AttributeGroup;
  aging: AgingFamily;
  /** What it does, in one sentence. */
  about: string;
  /** How a scout names it as a strength or a weakness ("his long speed", "work on his long speed"). */
  trait: string;
}

export const ATTRIBUTE_INFO: Record<Attribute, AttributeInfo> = {
  speed: {
    short: 'SPD',
    label: 'Speed',
    group: 'Physical',
    aging: 'physical',
    about: 'Long speed: separation on deep routes, breakaway runs, pursuit and scrambles.',
    trait: 'long speed',
  },
  agility: {
    short: 'AGI',
    label: 'Agility',
    group: 'Physical',
    aging: 'physical',
    about: 'Change of direction: cuts, route breaks, mirroring in coverage, slipping blocks and sacks.',
    trait: 'change of direction',
  },
  strength: {
    short: 'STR',
    label: 'Strength',
    group: 'Physical',
    aging: 'physical',
    about: 'Play strength: anchoring and driving in the trenches, running through contact.',
    trait: 'play strength',
  },
  awareness: {
    short: 'AWR',
    label: 'Awareness',
    group: 'Mental',
    aging: 'mental',
    about: 'Football IQ: reading the play, finding soft spots, avoiding sacks, picks and penalties.',
    trait: 'football IQ',
  },
  throwPower: {
    short: 'THP',
    label: 'Throw power',
    group: 'Passing',
    aging: 'physical',
    about: 'Arm strength: drives the ball into tight windows and down the field.',
    trait: 'arm strength',
  },
  throwAccShort: {
    short: 'SAC',
    label: 'Short accuracy',
    group: 'Passing',
    aging: 'technical',
    about: 'Ball placement under 10 yards and on two-point tries.',
    trait: 'short-area accuracy',
  },
  throwAccDeep: {
    short: 'DAC',
    label: 'Deep accuracy',
    group: 'Passing',
    aging: 'technical',
    about: 'Ball placement on intermediate and deep throws.',
    trait: 'deep-ball accuracy',
  },
  carrying: {
    short: 'CAR',
    label: 'Ball security',
    group: 'Ball skills',
    aging: 'technical',
    about: 'Holding on through contact: fewer fumbles on runs and catches.',
    trait: 'ball security',
  },
  elusiveness: {
    short: 'ELU',
    label: 'Elusiveness',
    group: 'Ball skills',
    aging: 'physical',
    about: 'Making tacklers miss: broken tackles, yards after the catch, returns.',
    trait: 'elusiveness in space',
  },
  catching: {
    short: 'CTH',
    label: 'Hands',
    group: 'Ball skills',
    aging: 'technical',
    about: 'Catching what reaches him; for defenders, turning breakups into interceptions.',
    trait: 'hands',
  },
  routeRunning: {
    short: 'RTE',
    label: 'Route running',
    group: 'Ball skills',
    aging: 'technical',
    about: 'Getting open: separation from the man covering him, and how often the QB looks his way.',
    trait: 'route running',
  },
  passBlock: {
    short: 'PBK',
    label: 'Pass blocking',
    group: 'Blocking',
    aging: 'technical',
    about: 'Pass protection technique: keeps the pocket clean and the QB upright.',
    trait: 'pass protection',
  },
  runBlock: {
    short: 'RBK',
    label: 'Run blocking',
    group: 'Blocking',
    aging: 'technical',
    about: 'Run-blocking technique: wins at the point of attack and opens lanes.',
    trait: 'run blocking',
  },
  tackling: {
    short: 'TAK',
    label: 'Tackling',
    group: 'Defense',
    aging: 'technical',
    about: 'Finishing plays: fewer broken tackles and less yardage after the catch.',
    trait: 'tackling',
  },
  passRush: {
    short: 'PRS',
    label: 'Pass rush',
    group: 'Defense',
    aging: 'technical',
    about: 'Pass-rush moves: pressure, sacks and hurried throws.',
    trait: 'pass-rush moves',
  },
  runStop: {
    short: 'RST',
    label: 'Run stopping',
    group: 'Defense',
    aging: 'technical',
    about: 'Shedding blocks and plugging gaps against the run.',
    trait: 'run defense',
  },
  coverage: {
    short: 'COV',
    label: 'Coverage',
    group: 'Defense',
    aging: 'technical',
    about: 'Staying with receivers and closing windows; safeties also help over the top.',
    trait: 'coverage',
  },
  kickPower: {
    short: 'KPW',
    label: 'Kick power',
    group: 'Kicking',
    aging: 'physical',
    about: 'Leg strength: field-goal range, touchbacks and punt distance.',
    trait: 'leg strength',
  },
  kickAccuracy: {
    short: 'KAC',
    label: 'Kick accuracy',
    group: 'Kicking',
    aging: 'technical',
    about: 'Field goals and extra points, and pinning punts inside the 20.',
    trait: 'accuracy',
  },
};

export const AGING_TEXT: Record<AgingFamily, string> = {
  physical: 'Physical: done growing by about 25 and the first to fade.',
  technical: 'Technique: built with reps, holds through the prime.',
  mental: 'Mental: keeps sharpening past the prime and fades last.',
};

type Weights = Partial<Record<Attribute, number>>;

export interface Contest {
  label: string;
  /** Positions the engine reads this contest for. */
  positions: readonly Position[];
  /** Blend of ratings; weights sum to 1 so a skill stays on the 1–20 scale. */
  weights: Weights;
  /** What it decides on the field. */
  decides: string;
}

const OFF_BALL: Position[] = ['RB', 'QB', 'WR'];
const RECEIVERS: Position[] = ['WR', 'TE', 'RB'];
const DEFENDERS: Position[] = ['DT', 'EDGE', 'LB', 'CB', 'S'];

/** Every matchup the engine resolves, and the ratings it reads for each. */
export const CONTESTS = {
  // ── Trenches ──
  passPro: {
    label: 'Pass protection',
    positions: ['OL', 'TE', 'RB'],
    weights: { passBlock: 0.7, strength: 0.15, agility: 0.1, awareness: 0.05 },
    decides: 'pressure and sacks; backs pick up blitzes',
  },
  runBlocking: {
    label: 'Run blocking',
    positions: ['OL', 'TE'],
    weights: { runBlock: 0.7, strength: 0.2, awareness: 0.1 },
    decides: 'yards at the line on runs',
  },
  edgeRush: {
    label: 'Edge rush',
    positions: ['EDGE', 'LB'],
    weights: { passRush: 0.65, speed: 0.2, agility: 0.1, strength: 0.05 },
    decides: 'pressure off the edge and on blitzes, and who gets the sack',
  },
  interiorRush: {
    label: 'Interior rush',
    positions: ['DT'],
    weights: { passRush: 0.65, strength: 0.2, agility: 0.15 },
    decides: 'pressure up the middle, and who gets the sack',
  },
  runDefense: {
    label: 'Holding the point',
    positions: ['DT', 'EDGE'],
    weights: { runStop: 0.6, strength: 0.25, tackling: 0.1, awareness: 0.05 },
    decides: 'yards at the line on runs',
  },
  setEdge: {
    label: 'Setting the edge',
    positions: ['EDGE'],
    weights: { tackling: 0.4, speed: 0.3, awareness: 0.3 },
    decides: 'yards on outside runs',
  },
  runFit: {
    label: 'Run fits',
    positions: ['LB', 'S'],
    weights: { runStop: 0.4, tackling: 0.25, awareness: 0.25, speed: 0.1 },
    decides: 'filling the gap and making the stop on runs',
  },
  discipline: {
    label: 'Discipline',
    positions: ['OL', 'DT', 'EDGE'],
    weights: { awareness: 1 },
    decides: 'false starts, holding and offside',
  },
  // ── Quarterback ──
  pocketPresence: {
    label: 'Pocket presence',
    positions: ['QB'],
    weights: { awareness: 0.55, agility: 0.45 },
    decides: 'whether pressure becomes a sack',
  },
  decisionMaking: {
    label: 'Decision making',
    positions: ['QB'],
    weights: { awareness: 1 },
    decides: 'completions under pressure and interception risk',
  },
  shortAccuracy: {
    label: 'Short passing',
    positions: ['QB'],
    weights: { throwAccShort: 1 },
    decides: 'completions under 10 yards and two-point tries',
  },
  midAccuracy: {
    label: 'Intermediate passing',
    positions: ['QB'],
    weights: { throwAccShort: 0.45, throwAccDeep: 0.35, throwPower: 0.2 },
    decides: 'completions 10–19 yards downfield',
  },
  deepAccuracy: {
    label: 'Deep passing',
    positions: ['QB'],
    weights: { throwAccDeep: 0.7, throwPower: 0.3 },
    decides: 'completions 20+ yards downfield',
  },
  scrambling: {
    label: 'Scrambling',
    positions: ['QB'],
    weights: { speed: 1 },
    decides: 'escaping pressure, scramble yards and designed runs',
  },
  // ── Ball carriers ──
  insideRun: {
    label: 'Inside running',
    positions: OFF_BALL,
    weights: { strength: 0.35, elusiveness: 0.35, awareness: 0.3 },
    decides: 'yards on runs between the tackles',
  },
  outsideRun: {
    label: 'Outside running',
    positions: OFF_BALL,
    weights: { speed: 0.45, agility: 0.3, elusiveness: 0.25 },
    decides: 'yards on runs to the edge',
  },
  breakTackles: {
    label: 'Breaking tackles',
    positions: OFF_BALL,
    weights: { elusiveness: 0.75, strength: 0.25 },
    decides: 'getting past the second level',
  },
  longSpeed: {
    label: 'Breakaway speed',
    positions: OFF_BALL,
    weights: { speed: 1 },
    decides: 'how far a run goes once he is loose',
  },
  ballSecurity: {
    label: 'Ball security',
    positions: ['RB', 'QB', 'WR', 'TE'],
    weights: { carrying: 1 },
    decides: 'fumbles on runs and catches',
  },
  // ── Receivers ──
  targeting: {
    label: 'Target share',
    positions: RECEIVERS,
    weights: { catching: 0.34, routeRunning: 0.33, speed: 0.33 },
    decides: 'how often the quarterback looks his way',
  },
  shortRoutes: {
    label: 'Short routes',
    positions: RECEIVERS,
    weights: { routeRunning: 0.4, agility: 0.25, speed: 0.2, awareness: 0.15 },
    decides: 'separation on short and intermediate throws',
  },
  deepRoutes: {
    label: 'Deep routes',
    positions: RECEIVERS,
    weights: { speed: 0.45, routeRunning: 0.35, agility: 0.2 },
    decides: 'separation on deep throws',
  },
  hands: {
    label: 'Hands',
    positions: RECEIVERS,
    weights: { catching: 1 },
    decides: 'catching the ball once it arrives',
  },
  afterCatch: {
    label: 'After the catch',
    positions: RECEIVERS,
    weights: { elusiveness: 0.45, speed: 0.35, strength: 0.2 },
    decides: 'yards after the catch',
  },
  returns: {
    label: 'Returns',
    positions: ['RB', 'WR', 'CB'],
    weights: { speed: 0.45, elusiveness: 0.45, agility: 0.1 },
    decides: 'who returns kicks, and how far',
  },
  // ── Back seven ──
  coverage: {
    label: 'Short coverage',
    positions: ['CB', 'S', 'LB'],
    weights: { coverage: 0.5, agility: 0.25, awareness: 0.15, speed: 0.1 },
    decides: 'mirroring his man on short and intermediate throws',
  },
  deepCoverage: {
    label: 'Deep coverage',
    positions: ['CB', 'S', 'LB'],
    weights: { coverage: 0.45, speed: 0.4, awareness: 0.15 },
    decides: 'carrying his man on deep throws',
  },
  deepHelp: {
    label: 'Help over the top',
    positions: ['S'],
    weights: { coverage: 0.5, awareness: 0.3, speed: 0.2 },
    decides: 'closing windows on intermediate and deep throws',
  },
  ballSkills: {
    label: 'Ball skills',
    positions: ['CB', 'S', 'LB'],
    weights: { catching: 1 },
    decides: 'interceptions',
  },
  tackling: {
    label: 'Open-field tackling',
    positions: DEFENDERS,
    weights: { tackling: 0.6, speed: 0.4 },
    decides: 'yards after the catch, broken tackles, and who makes the stop',
  },
  pursuit: {
    label: 'Pursuit',
    positions: ['S'],
    weights: { speed: 0.5, tackling: 0.25, awareness: 0.25 },
    decides: 'running down a back who breaks loose',
  },
  // ── Special teams ──
  fieldGoal: {
    label: 'Field goals',
    positions: ['K'],
    weights: { kickAccuracy: 0.48, kickPower: 0.52 },
    decides: 'field-goal and extra-point range and accuracy',
  },
  kickoffDistance: { label: 'Kickoffs', positions: ['K'], weights: { kickPower: 1 }, decides: 'touchbacks' },
  puntDistance: { label: 'Punt distance', positions: ['P'], weights: { kickPower: 1 }, decides: 'gross punt yards' },
  puntPlacement: {
    label: 'Punt placement',
    positions: ['P'],
    weights: { kickAccuracy: 1 },
    decides: 'pinning punts inside the 20 and away from returners',
  },
} as const satisfies Record<string, Contest>;

export type ContestName = keyof typeof CONTESTS;

/**
 * Players lined up away from their own position, and the rating points each loses on every skill there
 * (`knockFor` in familiarity.ts). The match engine sets it around each step of a game and the lineup while
 * it adds up its units; everywhere else (screens, valuations, development) it is unset.
 */
let knocks: ReadonlyMap<number, number> | null = null;

/** Make `next` the knocks `skill` applies; returns the ones it replaces, to put back. */
export function useKnocks(next: ReadonlyMap<number, number> | null): ReadonlyMap<number, number> | null {
  const prev = knocks;
  knocks = next;
  return prev;
}

/** A player's rating for one contest: a weighted blend of his attributes on the 1–20 scale. */
export function skill(p: Player, contest: ContestName): number {
  const w: Weights = CONTESTS[contest].weights;
  let s = 0;
  for (const attr in w) s += p.ratings[attr as Attribute] * w[attr as Attribute]!;
  // Back early in a harness or a cast: a step down on what the injury touches until it heals.
  const cost = p.injury?.braceCost;
  if (cost)
    for (const attr in cost)
      s -= Math.min(cost[attr as Attribute]!, p.ratings[attr as Attribute] - 1) * (w[attr as Attribute] ?? 0);
  return knocks ? s - (knocks.get(p.id) ?? 0) : s;
}

/** Contests that read `attr` for a player at `position`, heaviest first. */
export function contestsFor(attr: Attribute, position: Position): ContestName[] {
  return (Object.keys(CONTESTS) as ContestName[])
    .filter((c) => {
      const def: Contest = CONTESTS[c];
      return def.positions.includes(position) && (def.weights[attr] ?? 0) > 0;
    })
    .sort((a, b) => ((CONTESTS[b] as Contest).weights[attr] ?? 0) - ((CONTESTS[a] as Contest).weights[attr] ?? 0));
}

/**
 * Attributes that matter at a position: the ones its overall weighs, heaviest first, then any
 * other the engine reads for it. Everything else is "other" for that position.
 */
export function relevantAttributes(position: Position): Attribute[] {
  const weights = OVR_WEIGHTS[position];
  const weighted = (Object.keys(weights) as Attribute[]).sort((a, b) => weights[b]! - weights[a]!);
  const read = ATTRIBUTES.filter((a) => !weights[a] && contestsFor(a, position).length > 0);
  return [...weighted, ...read];
}
