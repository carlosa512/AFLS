import { massEdge, rushSizeEdge, sizeEdge, sizeZ } from '../size';
import { preparePersonnelGame } from '../personnel/flow';
/**
 * Play-by-play game simulation.
 *
 * Each snap is a discrete event resolved from individual player matchups
 * (blockers vs. rushers, receivers vs. their coverage defender, ball carrier
 * vs. tacklers). Outcomes emerge from ratings plus bounded randomness, so
 * better teams win more often without making upsets impossible.
 */
import { skill, useKnocks } from '../attributes';
import { moraleMean } from '../morale';
import type { ChemRoom } from '../chemistry';
import { activeCoachQuirks, type CoachQuirkId } from '../coachQuirks';
import {
  habitCalls,
  canDeferTimeout,
  canStopEarly,
  shortGoalDecision,
  fourthDownHabit,
  longKickHabit,
  twoPointHabit,
  upTempoEligible,
  UP_TEMPO_RUNOFF,
} from './coachHabits';
import { callerStyle, cultureCalls, teamCoaches, type CallerStyle } from '../coaching';
import {
  CONTACT_RISK,
  fatigueMult,
  HELD_SHARE,
  injuryLabel,
  riskFactors,
  rollInjury,
  SIDELINE_REST,
  SNAP_CONTACT,
  SNAP_EXPOSURE,
  SNAP_RISK,
  snapCost,
  type ContactEvent,
  type Mechanism,
  concussionCount,
  type RiskFactors,
} from '../injuries';
import { departmentFor, type Department } from '../medical';
import { crewCalls, gameCrew, starLean, type CrewCalls } from '../officials';
import { enforce, FOULS, type Spot } from '../penalties';
import { activeQuirks, FILM_HABITS, formFor, type QuirkId } from '../quirks';
import { clamp, Rng } from '../rng';
import { poiseOf, temperamentOf } from '../traits';
import { groundingOdds, outsideOdds, pocketCall, pocketOdds, type PocketFacts, type PocketKind } from './pocketChoice';
import {
  forcedOdds,
  fumbleOdds,
  fumbleWhy,
  rushSpot,
  sackStripOdds,
  type ContactFacts,
  type ContactKind,
  type FumbleWhy,
  type RushSpot,
  type SackFacts,
} from './fumbleOdds';
import { defenseRecovers, pickRecoverer, returnYards, type Group, type LooseKind } from './looseBall';
import {
  breakupBy,
  breakupRate,
  depthBand,
  groupIn,
  pickBatter,
  pickCatcher,
  pickReturn,
  pickSpot,
  PICK_PD,
  type Band,
  type OnField,
  type PassGroup,
} from './defendedPass';
import type {
  Crew,
  Coach,
  CoachGameReport,
  Foul,
  Game,
  GameInjury,
  GameResult,
  League,
  FieldRecord,
  FieldUnits,
  PackedActors,
  PlayActors,
  PlayKind,
  OpenField,
  PlayLogEntry,
  Player,
  StatKey,
  StatLine,
  TeamGameStats,
} from '../types';
import { MAX_STATS } from '../types';
import { approach, fieldStart } from '../field/approach';
import { MID, HASH_HI, HASH_LO } from '../field/geometry';
import { momentOf, type FieldFacts, type FieldMoment } from '../field/moment';
import type { PocketOutcome, PocketResult, PocketStart } from '../field/pocketField';
import { composePocket, pocketFrom, pocketStage, scrambleStart, type PocketMoment } from '../field/pocketMoment';
import type { StagedPlay } from '../field/stage';
import { runField } from '../field/run';
import { fieldSkills } from '../field/skills';
import { noteSkills, type FieldSnapshot } from '../field/snapshot';
import { FIELD_VERSION, KNOBS, STEP } from '../field/tuning';
import type { FieldResult, FieldStart } from '../field/types';
import { CALL_CHAR, packActors } from '../playActors';
import { isExplosive, isSuccess, playEpa, type PlayState } from '../analytics';
import {
  gameWeather,
  staminaDrain,
  turfRisk,
  weatherAt,
  weatherEffects,
  type Weather,
  type WeatherCost,
} from '../weather';
import * as coach from './coach';
import {
  OUT_TEXT,
  sidelineCall,
  sidelineOdds,
  stepReason,
  steppedCredit,
  TYPICAL,
  type SidelineCall,
  type SidelineFacts,
  type SidelineKind,
  type StepReason,
} from './sideline';
import {
  escapeOdds,
  fightsForIt,
  sackLoss,
  slideOdds,
  slideReason,
  TOUCHED,
  type SackFacts as SackLossFacts,
  type SlideFacts,
  type SlideReason,
} from './dropbackEnd';
import type { DefenseCall, PassDepth, Situation } from './coach';
import {
  activePlayers,
  buildLineup,
  teamDay,
  discipline,
  KICK_FLAG_PER_POINT,
  RETURN_COACH,
  roughness,
  type Lineup,
} from './lineup';

type Side = 0 | 1; // 0 = home, 1 = away

export interface SimOptions {
  /** Matched audits may disable coaching habits without changing staff generation. */
  coachQuirks?: boolean;
  /** Keep the full play-by-play log (otherwise only scoring plays are kept). */
  keepPlays?: boolean;
  /** Playoff games cannot end in a tie. */
  playoff?: boolean;
  /** Override the RNG seed (defaults to a per-game seed derived from the league). */
  seed?: string;
  /** Override the day's weather (defaults to the game's own, see `weather.ts`). */
  weather?: Weather;
  /** Override the officiating crew (defaults to the game's own, see `officials.ts`); null is a league-average crew. */
  crew?: Crew | null;
  /** Override each team's day, home then away (defaults to the game's own draw, `teamDay`). */
  days?: [home: number, away: number];
  /** Play each eligible open field spatially (`field/`): runs past the line, catches, returns. Keeps the plays. */
  field?: boolean;
  /** Called at the end of each eligible play with what its open field started from and what today's rolls gave
   * (and, with `field`, what the open field decided). Draws nothing. Keeps the plays. */
  fieldTap?: (tap: FieldTap) => void;
  /** Called at the end of each dropback the pocket could play, with today's credit and (with `field`) the pocket's. */
  pocketTap?: (tap: PocketTap) => void;
  /** Each dropback's choice as the engine made it (`pocketChoice.ts`), for the passer check; nothing is stored. */
  dropbackTap?: (tap: DropbackTap) => void;
  /** Each tackle in bounds on a run, a catch or a scramble, and whether the ball came out (`fumbleOdds.ts`), for the
   * fumbles check; nothing is stored. */
  contactTap?: (tap: ContactTap) => void;
  /** Every sack, for the fumbles check (`scripts/fumbles-core.ts`). */
  stripTap?: (tap: StripTap) => void;
  /** Every pass picked off or fallen incomplete, for the picks check (`scripts/picks-core.ts`). */
  defendedTap?: (tap: DefendedTap) => void;
  /** How plays end (`dropbackEnd.ts`, `stepReason`): each sack, each scramble that stays in bounds, each man who goes out
   * of bounds, for `npm run dropback`; nothing is stored. */
  endingTap?: (tap: EndingTap) => void;
  /** Force rooms' chemistry edges, home then away (tests and probes); a room left out reads its own (`chemistryOf`). */
  chemistry?: [home: Partial<Record<ChemRoom, number>>, away: Partial<Record<ChemRoom, number>>];
  /** Force rooms' staff edges (L4), home then away; a room left out reads its own (`staffEdgeOf`). */
  staff?: [home: Partial<Record<ChemRoom, number>>, away: Partial<Record<ChemRoom, number>>];
}

/** A dropback the pocket played (`field/pocketField.ts`): its moment and start, today's credit, the pocket's result. */
/** A tackle in bounds as the engine decided it: whether he fumbled, whether a defender forced it, and why. */
export interface ContactTap {
  kind: ContactKind;
  down: number;
  toGo: number;
  trailingLate: boolean;
  leadingLate: boolean;
  carrier: number;
  fumbled: boolean;
  /** A slide: touched down, a contact that can't fumble (counted as the NFL counts every scramble in bounds). */
  slid?: true;
  forced?: boolean;
  why?: FumbleWhy;
  /** Who got the ball, when it came out (`looseBall.ts`). */
  recovery?: Recovery;
  facts: ContactFacts;
}

/** The defense's man and his return, when it has the ball. */
interface Lost {
  recoverer: Player;
  returnYds: number;
}

/** Who got a loose ball: the defense (its recoverer's group, his return, a touchdown) or the offense. */
export interface Recovery {
  lost: boolean;
  group?: Group;
  returnYds: number;
  /** How far the defense had to run it to score, from where it changed hands. */
  toGoal: number;
  td: boolean;
  forcerRecovered: boolean;
}

/** A throw the defense got to or let fall (`defendedPass.ts`): its depth, a pick, a breakup or nothing, and who. */
export interface DefendedTap {
  band: Band;
  outcome: 'pick' | 'breakup' | 'none';
  /** The man credited, and his group. */
  by?: number;
  group?: PassGroup;
  /** Batted down or tipped at the line by a lineman. */
  batted: boolean;
  returnYds?: number;
  pickSix?: boolean;
  /** A pick in the end zone: a touchback. */
  endZone?: boolean;
  /** A pick credits its catcher with a pass defensed. */
  pd?: boolean;
}

/** How a play ended (`dropbackEnd.ts`): a sack's loss, a scramble's slide or fight, why a man went out of bounds. */
export interface EndingTap {
  kind: 'sack' | 'scramble' | 'out';
  down: number;
  toGo: number;
  /** Sacks: the defense's call, whether he'd left the pocket, the loss, where from, and a safety. */
  call?: DefenseCall;
  escaped?: boolean;
  loss?: number;
  yardLine?: number;
  safety?: boolean;
  /** Scrambles that end in bounds: slid, why (or that he fought for it), a tackler credited, the situation. */
  slid?: boolean;
  reason?: SlideReason | 'fight' | null;
  tackled?: boolean;
  firstDown?: boolean;
  leadingLate?: boolean;
  trailingLate?: boolean;
  /** Out of bounds: pushed, or stepping out and why (null: nothing said). */
  why?: StepReason | 'pushed' | null;
}

/** A sack as the engine decided it: the rusher's spot, the situation, whether the ball came out, and who got it. */
export interface StripTap {
  down: number;
  toGo: number;
  trailingLate: boolean;
  leadingLate: boolean;
  spot: RushSpot;
  qb: number;
  fumbled: boolean;
  forced?: boolean;
  recovery?: Recovery;
  facts: SackFacts;
}

/** A dropback as the engine decided it: sacked, or what he chose after his read, and where a throwaway came from. */
export interface DropbackTap {
  qb: number;
  pressured: boolean;
  down: number;
  toGo: number;
  toGoal: number;
  trailingLate: boolean;
  call: PocketKind | 'sack';
  outside?: boolean;
  grounded?: boolean;
  /** What the choice read (absent on a sack), for fitting `pocketChoice.ts`. */
  facts?: PocketFacts;
}

export interface PocketTap {
  moment: PocketMoment;
  start: PocketStart;
  today: {
    outcome: PocketOutcome;
    rusher: number | null;
    beat: number | null;
    hit: boolean;
    blamed: boolean;
    duration: number;
  };
  result?: PocketResult;
}

/** What today's engine rolled for an open field: the shadow a spatial play replaces (parity reads it, tests too). */
export interface TodayField {
  yards: number;
  tackler: number | null;
  touchdown: boolean;
  /** With the switch on, the out-of-bounds and duration draws taken and discarded. */
  outOfBounds: boolean;
  duration: number;
}

/** One eligible open field: where it started, today's rolls, and the spatial result when the switch is on. */
export interface FieldTap {
  moment: FieldMoment;
  start: FieldStart;
  today: TodayField;
  result?: FieldResult;
}

const QUARTER_SECONDS = 900;
const RUN_OUTSIDE: [string, number][] = [
  ['left end', -1],
  ['right end', 1],
];
const RUN_INSIDE: [string, number][] = [
  ['up the middle', 0],
  ['left guard', -0.35],
  ['right tackle', 0.45],
];
const PASS_LANES: [string, number][] = [
  ['left', -0.8],
  ['middle', 0],
  ['right', 0.8],
];

/** How far from the league's typical starter a quarterback's passing must be for a full lean. */
const QB_SPREAD = 4;
/** A quarterback's passing: accuracy at every depth and his decisions. */
const qbPassing = (qb: Player) =>
  (skill(qb, 'shortAccuracy') + skill(qb, 'midAccuracy') + skill(qb, 'deepAccuracy') + skill(qb, 'decisionMaking')) / 4;
/**
 * How much a play-caller leans on his quarterback, −1 (poor) to 1 (elite), judged against the
 * league's other starters: as a league's quarterbacks mature, the bar rises with them, so an aged
 * league doesn't drift into throwing more and more.
 */
function qbLeans(league: League, qbs: [Player, Player]): [number, number] {
  const starters = league.teams.map((t) => league.players[t.depthChart.QB[0]]).filter(Boolean);
  const typical = starters.reduce((sum, p) => sum + qbPassing(p), 0) / Math.max(1, starters.length);
  const lean = (qb: Player) => clamp((qbPassing(qb) - typical) / QB_SPREAD, -1, 1);
  return [lean(qbs[0]), lean(qbs[1])];
}

type Anim = Pick<PlayLogEntry, 'kind' | 'from' | 'air' | 'to' | 'lane' | 'who' | 'ran' | 'loose' | 'open' | 'field'>;

/**
 * Who a scrimmage play was about, read off what the engine already chose: its stat lines, the man in coverage, the
 * rusher who got home and the blocker charged for it. Nothing here draws, so recording it never changes a game.
 */
export function actorsOf(play: {
  entries: readonly (readonly [Player, StatKey, number])[];
  defender?: Player;
  rusher?: Player | null;
  beat?: Player | null;
  take?: Player;
}): PlayActors {
  const first = (key: StatKey) => play.entries.find(([, k]) => k === key)?.[0];
  const who: PlayActors = {};
  const ball = first('targets') ?? first('rushAtt');
  const set = (k: keyof PlayActors, p: Player | null | undefined) => {
    if (p) who[k] = p.id;
  };
  set('ball', ball);
  set('cover', play.defender);
  set('tackle', first('tackles'));
  set('rush', play.rusher);
  set('beat', play.beat);
  set('take', play.take);
  return who;
}
/** A slide's words and its film code (`FieldFacts.sw`), by why he slid (spec 2026-11-07 §4). */
const SLIDE_TEXT: Record<SlideReason, string> = {
  firstDown: ', slides with the first down in hand',
  clock: ', slides to keep the clock running',
  hit: ', slides to avoid the hit',
};
const SLIDE_WHY: Record<SlideReason, 1 | 2 | 3> = { firstDown: 1, clock: 2, hit: 3 };
const HOME_FIELD_EDGE = 0.4; // ratings points added to the home side's matchups
/** League-typical linemen discipline: penalty rates are scaled around these, so totals stay NFL-like. */
const OL_DISCIPLINE = 12;
const DL_DISCIPLINE = 10.8;
/** Base odds of each foul per chance at it (see docs/PENALTIES.md for the NFL rates they're tuned to). */
const FALSE_START = 0.0226;
const OFFSIDE = 0.0137;
/** Offensive holding, per run, pass, sack or scramble: declined when the play was worse for the offense anyway. */
const HOLDING = 0.0306;
/** Pass interference by depth, on incompletions thrown past the line. */
const DPI: Record<PassDepth, number> = { short: 0.012, medium: 0.045, deep: 0.09 };
/** Defensive holding, per dropback: declined when the play beat 5 yards and a first down. */
const DEF_HOLDING = 0.0134;
/** Roughing the passer, per sack or pressured throw (the NFL flags about 3% of hits on the passer). */
const ROUGHING = 0.0158;
/** Personal fouls finishing a tackle, per tackled play: a late shot, a face mask, a horse collar. */
const UNNECESSARY_ROUGHNESS = 0.0055;
const FACE_MASK = 0.0029;
const HORSE_COLLAR = 0.0005;
/** A sack celebrated in someone's face. */
const UNSPORTSMANLIKE = 0.02;
/** League-typical discipline of the men making tackles: personal-foul odds are scaled around it. */
const TACKLER_DISCIPLINE = 11;
/** A hold or a block in the back somewhere behind the returner, per kick or punt return. */
const RETURN_FOUL = 0.087;
/** A kickoff out of bounds or short of the landing zone, and a kicking team lined up wrong, per kickoff. */
const KICKOFF_MISS = 0.016;
const KICKOFF_FORMATION = 0.013;
/** Per punt caught: the coverage gets there before the ball. */
const KICK_CATCH = 0.003;
/** Per punt, field goal or extra point: a rusher who runs into the kicker, or roughs him (or the holder). */
const RUNNING_INTO_KICKER = 0.002;
const ROUGHING_KICKER = 0.0025;
/**
 * Per field goal or extra point: a false start or a hold on the kick unit, an offside on the block unit.
 * Rare in the NFL (a few a season each team); scaled by each unit's discipline like the scrimmage fouls.
 */
const KICK_FALSE_START = 0.006;
const KICK_HOLDING = 0.003;
const KICK_OFFSIDE = 0.006;
/**
 * A field goal or extra point is a short snap: half a scrimmage snap's energy and half a quiet kick's risk
 * (the NFL's injury rates the engine is tuned to already count the men hurt on kicks, so this stays small).
 */
const KICK_SNAP_COST = 0.5;
/** League-typical discipline of a kick unit (backups, mostly): special-teams odds are scaled around it. */
const ST_DISCIPLINE = 10.5;
/** A kick play's injury risk against a scrimmage snap's: a return is a collision at full speed; a touchback or a fair catch is mostly running. */
const KICK_RISK = { returned: 1.5, quiet: 0.4 };
/**
 * How far the field has shrunk on a snap: 0 at the 20, 1 on the goal line. With no room behind the
 * coverage or past the second level, the defense's call and the man across from each player decide more
 * and an offense's edge buys less (NFL 2021–25: 57% of red-zone trips end in a touchdown, and teams
 * differ in it little beyond luck).
 */
const shrink = (yardsToGoal: number) => clamp((20 - yardsToGoal) / 19, 0, 1);
/** Yards off a carry's mean at the goal line, tapering to none at the 20 (NFL runs score 57% from the 1, 29% from the 3–5, 13% from the 6–10). */
const RED_ZONE_STACK = 1.6;
/** The defense's call counts 1 + this many times over at the goal line (three times over): the right front stuffs it, the wrong one gets burned. */
const RED_ZONE_CALL = 2;
/** Share of an offense's edge (blocking, separation) it can't use at the goal line. */
const RED_ZONE_FADE = 0.5;
/** Extra weight on the covering defender's skill at the goal line, man or zone. */
const RED_ZONE_ISLAND = 0.3;
/**
 * Completion chance a throw loses at the goal line, and a throw into the end zone besides, with the end
 * line and the sideline to beat (NFL 2021–25: 57% of red-zone passes complete, 52% inside the 10).
 */
const RED_ZONE_SQUEEZE = 0.15;
const END_ZONE_THROW = 0.08;
/** An offense's edge is worth less with no room to use it; being outmatched still costs in full. */
const fade = (edge: number, tight: number) => (edge > 0 ? edge * (1 - RED_ZONE_FADE * tight) : edge);
/** Mean kickoff and punt returns before flags (the flags on returns bring the averages back to where they were). */
const KICK_RETURN = 29.5;
const PUNT_RETURN = 9;
/** League-typical edge contain and safety help: their effects are measured from these. */
const EDGE_CONTAIN = 11.5;
const DEEP_HELP = 14;
/** How much more (man) or less (zone) the covering defender's skill counts, away from a typical 12. */
const MAN_ISLAND = 0.25;
const ZONE_ISLAND = -0.15;
/** Share of non-sack pressures where the rusher hits the quarterback (NFL: about five hits a game, sacks included). */
const QB_HIT_SHARE = 0.35;
/** Sacks and pressures charged to no blocker: the coverage held, or the quarterback held the ball. */
const UNBLAMED_SACK = 0.35;
const UNBLAMED_PRESSURE = 0.15;
/** How strongly a matchup brings a habit out: 0 for a rating of 10 or less, up to 1.5 for an elite one. */
const pull = (rating: number) => clamp((rating - 10) / 5, 0, 1.5);
const unitAvg = (players: readonly Player[], contest: Parameters<typeof skill>[1]) =>
  players.reduce((a, p) => a + skill(p, contest), 0) / Math.max(1, players.length);
/** Each teammate sharing a quirk adds this share of the one before (see `stack`). */
const STACK = 0.6;
/** Snaps into a drive after which a defensive line starts to tire. */
const LONG_DRIVE = 5;
/** Completion chance a full unit of weather cost takes off a throw: wind and wet balls hurt the deep ones most. */
const WEATHER_PASS: Record<PassDepth, number> = { short: 0.25, medium: 0.42, deep: 0.67 };

/**
 * Who gets home on a pass rush: the starting edges the most, then the rotation and the linebackers,
 * and on blitzes the secondary too, so one rusher can't take half the sacks.
 */
function rushers(def: Lineup, blitz: boolean): [Player, number][] {
  return [
    ...def.edge.map((p): [Player, number] => [p, 1.8 * skill(p, 'edgeRush')]),
    ...def.dt.map((p): [Player, number] => [p, 1.3 * skill(p, 'interiorRush')]),
    ...def.rushRotation.map((p): [Player, number] => [
      p,
      p.position === 'EDGE' ? 1.1 * skill(p, 'edgeRush') : 0.6 * skill(p, 'interiorRush'),
    ]),
    ...def.lb.map((p): [Player, number] => [p, (blitz ? 1.5 : 0.45) * skill(p, 'edgeRush')]),
    ...[...def.s, def.cb[2]].filter(Boolean).map((p): [Player, number] => [p, blitz ? 4 : 0.6]),
  ];
}

/**
 * The blocker charged when `rusher` gets home. Line spots follow the depth chart (LT, LG, C, RG, RT);
 * among the men who could have had him, the weaker pass protector is more often the one who lost.
 */
function blockerFor(
  off: Lineup,
  def: Lineup,
  rusher: Player,
  blitz: boolean,
  rng: Rng,
  /** The pass's target: out on his route, he can't be the man beaten (the draws are taken all the same). */
  target: Player | null = null,
): Player | null {
  const ol = off.ol;
  if (!ol.length) return null;
  const at = (i: number) => ol[Math.min(i, ol.length - 1)];
  const [lt, lg, c, rg, rt] = [at(0), at(1), at(2), at(3), at(4)];
  const te = off.scheme.offense.personnel === '10' ? null : off.tes[0];
  const back = off.rbs[0];
  let candidates: Player[];
  if (rusher === def.edge[0]) candidates = te && rng.chance(0.12) && te !== target ? [te] : [lt];
  else if (rusher === def.edge[1]) candidates = te && rng.chance(0.12) && te !== target ? [te] : [rt];
  // The center helps both ways, so he is the man beaten less often than the guard he slides to.
  else if (rusher === def.dt[0]) candidates = [lg, lg, c];
  else if (rusher === def.dt[1]) candidates = [rg, rg, c];
  else if (rusher.position === 'EDGE') candidates = [lt, rt];
  else if (rusher.position === 'DT') candidates = [lg, rg];
  // Linebackers and defensive backs: the back's to pick up on a blitz, otherwise a lineman sliding late.
  else candidates = blitz && rng.chance(0.6) && back !== target ? [back] : [lg, c, rg];
  return rng.weighted(candidates, (p) => Math.max(1, 22 - skill(p, 'passPro')));
}
/**
 * Today's credit on a pressure or a sack, in the order `creditPressure` takes it: a hit (a sack always is one), charged
 * to nobody or not (charting services blame no blocker on about a third of sacks), and the blocker across from him. The
 * pocket anchors to these same draws, read off a copy of the credit stream before they're taken for real.
 */
function creditDraws(
  rng: Rng,
  off: Lineup,
  def: Lineup,
  rusher: Player,
  blitz: boolean,
  sack: boolean,
  target: Player | null = null,
): { hit: boolean; unblamed: boolean; blocker: Player | null } {
  const hit = sack || rng.chance(QB_HIT_SHARE);
  const unblamed = rng.chance(sack ? UNBLAMED_SACK : UNBLAMED_PRESSURE);
  return { hit, unblamed, blocker: unblamed ? null : blockerFor(off, def, rusher, blitz, rng, target) };
}

/** Separation beyond which the defense rolls a safety over. */
const SEP_ROLL = 3;
/** Carries before a lead back starts handing work to the second back. */
const LEAD_BACK_CARRIES = 14;
/**
 * Mean gain on a run between evenly matched units, before breakaways. Trimmed (with completions and
 * yards after the catch) when personal fouls came in at NFL rates: they hand offenses about a point a
 * game, so the plays themselves give it back and league scoring holds (docs/PENALTIES.md, Phase 2).
 */
const RUN_BASE = 3.86;
/** A starting DT's open-field tackling, on average (10.0 across opening leagues), and yards a point is worth at the line. */
const DT_WRAP = 10;
const DT_WRAP_PER_POINT = 0.05;
/** Mean of `f` over a unit; a unit with nobody in it reads as typical. */
const avgOf = (ps: readonly Player[], f: (p: Player) => number) =>
  ps.length ? ps.reduce((n, p) => n + f(p), 0) / ps.length : DT_WRAP;

/** Separation (receiver against cover man, rating points) past which a catch has nobody near him (`sideline.ts`). */
const FREE_SEP = 4;

/** A flag thrown during a play: the foul, who drew it, and how far downfield a spot foul happened. */
interface LiveFoul {
  foul: Foul;
  by?: Player;
  spotYards?: number;
}

/** Collects stat changes for a play so they can be discarded if a penalty wipes the play out. */
export class StatBuffer {
  entries: [Player, StatKey, number][] = [];
  add(p: Player, key: StatKey, value = 1) {
    this.entries.push([p, key, value]);
  }
}

/**
 * The collisions a play records, read from its stat line: a ball carrier brought down, his tackler, a sack, a hit on
 * the quarterback (`qb`), a return, a kick. `unhit`: he stepped out of bounds before the hit, so the tackle credited to
 * the man who forced him out is nobody's collision, and he carries only a free runner's risk.
 */
export function collisions(entries: StatBuffer['entries'], qb: Player, unhit: boolean): [Player, ContactEvent][] {
  const tackled = !unhit && entries.some(([, k]) => k === 'tackles');
  const sacked = entries.some(([, k]) => k === 'sacked');
  const gained = (p: Player) => entries.some(([x, k, v]) => x === p && (k === 'rushYds' || k === 'recYds') && v > 0);
  const out: [Player, ContactEvent][] = [];
  for (const [p, key] of entries) {
    if (key === 'rushAtt' || key === 'rec') {
      if (tackled) out.push([p, 'carrier']);
      else if (gained(p)) out.push([p, 'free']);
    } else if (key === 'tackles') {
      if (!unhit) out.push([p, 'tackler']);
    } else if (key === 'sacked') out.push([p, 'sacked']);
    else if (key === 'qbHits' && !sacked) out.push([qb, 'hit']);
    else if (key === 'krAtt' || key === 'prAtt') out.push([p, 'returner']);
    else if (key === 'punts' || key === 'fgAtt' || key === 'xpAtt') out.push([p, 'kick']);
  }
  return out;
}

interface PlayResult {
  kind: 'run' | 'pass' | 'sack' | 'scramble' | 'kneel' | 'spike';
  /** A throwaway the engine flagged as intentional grounding: how far behind the line it was thrown. */
  grounding?: { back: number };
  yards: number;
  text: string;
  duration: number;
  /** Clock stops after the play (incompletion or out of bounds late in a half). */
  clockStops: boolean;
  stats: StatBuffer;
  passAttempt?: boolean;
  complete?: boolean;
  airYards?: number;
  depth?: PassDepth;
  /** Who broke the pass up (the cover man, a safety, a lineman batting it at the line), and a ball batted down. */
  brokenUpBy?: Player;
  batted?: boolean;
  /** The man in coverage on a pass: flags for grabbing are his. */
  defender?: Player;
  /** Who got home on a sack: a late hit or a celebration is his. */
  rusher?: Player;
  lane?: number;
  turnover?: { kind: 'int' | 'fumble'; spot: number; returnYds: number; by: Player };
  /** What the engine decided in the open field (a run, a catch), for All-22. */
  open?: OpenField;
  /** A play the spatial engine played: what its replay needs. */
  field?: FieldFacts;
  /** How a run, catch or scramble went out of bounds (`sideline.ts`); absent in bounds. */
  outOfBounds?: 'pushed' | 'stepped';
}

function emptyTeamStats(): TeamGameStats {
  return {
    firstDowns: 0,
    plays: 0,
    totalYds: 0,
    passYds: 0,
    rushYds: 0,
    passAtt: 0,
    passCmp: 0,
    rushAtt: 0,
    sacked: 0,
    turnovers: 0,
    penalties: 0,
    penaltyYds: 0,
    flags: {},
    thirdDownAtt: 0,
    thirdDownConv: 0,
    fourthDownAtt: 0,
    fourthDownConv: 0,
    redZoneAtt: 0,
    redZoneTd: 0,
    top: 0,
    adv: {
      plays: 0,
      success: 0,
      epa: 0,
      explosive: 0,
      dropbacks: 0,
      passSuccess: 0,
      passEpa: 0,
      rushes: 0,
      rushSuccess: 0,
      rushEpa: 0,
      pressured: 0,
    },
  };
}

const short = (p: Player) => `${p.firstName[0]}.${p.lastName}`;

export function simulateGame(league: League, game: Game, options: SimOptions = {}): GameResult {
  preparePersonnelGame(league, game);
  return new GameSim(league, game, options).run();
}

/** A game advanced one play at a time, for watching live. Same seed → same game as simulateGame. */
export interface LiveGame {
  /** Advance until at least one new play is logged (or the game ends); returns the new entries. */
  next(): PlayLogEntry[];
  readonly over: boolean;
  result(): GameResult;
  /** Who is on the field so far (All-22): read-only, it draws nothing. */
  field(): FieldRecord | undefined;
}

export function startGame(league: League, game: Game, options: SimOptions = {}): LiveGame {
  preparePersonnelGame(league, game);
  const sim = new GameSim(league, game, { ...options, keepPlays: true });
  return {
    next: () => sim.next(),
    get over() {
      return sim.isOver;
    },
    result: () => sim.result(),
    field: () => sim.fieldNow(),
  };
}

/** Hard stop for a runaway loop; a real game is ~170 iterations. */
const MAX_STEPS = 2000;

/** The receivers on the field for the offense's personnel. */
function receivers(l: Lineup): Player[] {
  const personnel = l.scheme.offense.personnel;
  return personnel === '12'
    ? [...l.wrs.slice(0, 2), ...l.tes.slice(0, 2)]
    : personnel === '10'
      ? [...l.wrs, ...(l.wr4 ? [l.wr4] : [])]
      : [...l.wrs, l.tes[0]];
}

/** Who is on the field for a snap: the offense's eleven (by personnel) and the defense's. */
function units(l: Lineup): [offense: Player[], defense: Player[]] {
  return [
    [l.qb, ...l.ol, l.rbs[0], ...receivers(l)],
    [...l.dt, ...l.edge, ...l.lb, ...l.cb, ...l.s],
  ];
}

/**
 * The share of a receiver's short throws thrown behind the line: screens and quick throws to the flat with blockers in
 * front (nflverse 2019–24: 16.6% of every throw, at −3.3 air yards on average; backs' checkdowns behind the line add
 * to it).
 */
export const BEHIND_SHARE = 0.18;

/** A catch behind the line has blockers in front of it: the NFL's gain 9.1 yards after the catch (nflverse 2019–24). */
export const SCREEN_YAC = 8.6;
/**
 * Share of a screen's room that the goal line takes away: inside the 5 the whole defense is a step from the ball
 * (nflverse 2021–24: 36.7% of catches behind the line score there, 92% of those past it).
 */
const SCREEN_SQUEEZE = 0.65;
/** A screen's room after the catch with the field shrunk by `tight` (0 between the 20s, 1 at the goal line). */
export const screenRoom = (tight: number) => SCREEN_YAC * (1 - SCREEN_SQUEEZE * tight);

/**
 * How far a throw travels past the line: a back's short throw is a checkdown in the flat; a receiver's is a screen
 * behind the line or the quick game in front of it (0 to 9, about 4.2 on average, as the NFL's). Never caught behind the
 * offense's own goal line, nor more than nine yards deep in the end zone.
 */
export function passAir(rng: Rng, depth: PassDepth, isBack: boolean, yardLine: number, yardsToGoal: number): number {
  let air: number;
  if (isBack && depth === 'short') air = rng.int(-3, 4);
  else if (depth === 'short')
    air = rng.chance(BEHIND_SHARE) ? -rng.int(1, 5) : Math.round(clamp(rng.normal(4.2, 2.6), 0, 9));
  else if (depth === 'medium') air = rng.int(10, 17);
  // Deep balls travel about 29 yards in the air (nflverse 2019–24) and their catchers keep running (5.6 yards after the
  // catch): NFL 2021–25, 0.47 completions of 40+ yards a team-game, a third of them touchdowns.
  else air = 20 + Math.round(Math.min(rng.exponential(10), 60));
  air = Math.max(air, 1 - yardLine);
  return Math.min(air, yardsToGoal + 9);
}

/** A lineup as All-22 keeps it: ids by group, the same eleven `units` puts on the field. */
export function fieldUnits(l: Lineup): FieldUnits {
  const ids = (ps: readonly Player[]) => ps.map((p) => p.id);
  const on = receivers(l);
  return {
    qb: l.qb.id,
    ol: ids(l.ol),
    rb: l.rbs[0].id,
    ...(l.rbs[1] ? { rb2: l.rbs[1].id } : {}),
    wr: ids(on.filter((p) => !l.tes.includes(p))),
    te: ids(on.filter((p) => l.tes.includes(p))),
    dt: ids(l.dt),
    edge: ids(l.edge),
    lb: ids(l.lb),
    cb: ids(l.cb),
    s: ids(l.s),
    rot: l.rushRotation.map((p): [number, 'EDGE' | 'DT'] => [p.id, p.position === 'EDGE' ? 'EDGE' : 'DT']),
    k: l.k.id,
    p: l.p.id,
    kr: l.kr.id,
    pr: l.pr.id,
    st: ids(l.st),
    fg: ids(l.fg),
  };
}

/** Every id a side's units name. */
function unitIds(u: FieldUnits): number[] {
  return [
    u.qb,
    ...u.ol,
    u.rb,
    ...(u.rb2 !== undefined ? [u.rb2] : []),
    ...u.wr,
    ...u.te,
    ...u.dt,
    ...u.edge,
    ...u.lb,
    ...u.cb,
    ...u.s,
    ...u.rot.map(([id]) => id),
    u.k,
    u.p,
    u.kr,
    u.pr,
    ...u.st,
    ...u.fg,
  ];
}

class GameSim {
  private rng: Rng;
  private habitRng: Rng;
  private coachReports: CoachGameReport[] = [];
  private gameCoaches: [Coach[], Coach[]];
  private gameHabits: [Map<Coach['role'], ReadonlySet<CoachQuirkId>>, Map<Coach['role'], ReadonlySet<CoachQuirkId>>];
  private noHabits: ReadonlySet<CoachQuirkId> = new Set();
  private shots: [number, number] = [0, 0];
  private offenseSnaps: [number, number] = [0, 0];
  private deferredTimeout: [boolean, boolean] = [false, false];
  private designedShot = false;
  private safePass = false;
  private openingWindow = false;
  private deepProtection = false;
  private endZoneShot = false;
  private disguise = false;
  private preventShell = false;
  /** The defense's call on the snap being played, until its log entry is written (`FieldRecord.calls`). */
  private callNow: DefenseCall | null = null;
  /** The seed the game runs on: a play's open field draws from `${gameSeed}:field:${index}`. */
  private gameSeed = '';
  /** The spatial game's snapshot of what its open fields read (`field/snapshot.ts`). */
  private fieldSnap: FieldSnapshot | null = null;
  /** Where the ball sits across the field for the next snap: a spatial play's end, kept on the hashes. */
  private fieldY = MID;
  private habits(side: Side, role: Coach['role']): ReadonlySet<CoachQuirkId> {
    return this.gameHabits[side].get(role) ?? this.noHabits;
  }
  private coachReport(side: Side, role: Coach['role']): CoachGameReport | undefined {
    const c = this.gameCoaches[side].find((c) => c.role === role);
    if (!c) return;
    let report = this.coachReports.find((r) => r.coachId === c.id);
    if (!report) {
      report = {
        coachId: c.id,
        name: `${c.firstName} ${c.lastName}`,
        role,
        teamId: this.lineups[side].team.id,
        opportunities: {},
        choices: {},
        uses: {},
        events: [],
      };
      this.coachReports.push(report);
    }
    return report;
  }
  private evidence(
    side: Side,
    role: Coach['role'],
    id: CoachQuirkId,
    choice = false,
    used = false,
    text?: string,
    outcome?: string,
  ) {
    const r = this.coachReport(side, role);
    if (!r) return;
    r.opportunities[id] = (r.opportunities[id] ?? 0) + 1;
    if (choice) r.choices[id] = (r.choices[id] ?? 0) + 1;
    if (used) r.uses[id] = (r.uses[id] ?? 0) + 1;
    if (text && r.events.length < 4)
      r.events.push({ quirk: id, quarter: this.quarter, clock: this.clock, text, ...(outcome ? { outcome } : {}) });
  }
  private lineups: [Lineup, Lineup];
  private score: [number, number] = [0, 0];
  private quarters: [number[], number[]] = [
    [0, 0, 0, 0],
    [0, 0, 0, 0],
  ];
  private quarter = 1;
  private clock = QUARTER_SECONDS;
  private clockRunning = false;
  /** The last play went out of bounds with the clock to restart at the spot: the next runoff loses the pause. */
  private spotted = false;
  private twoMinuteWarned = false;
  private offense: Side = 0;
  private yardLine = 25;
  private down = 1;
  private lineToGain = 35;
  private timeouts: [number, number] = [3, 3];
  private openingReceiver: Side = 0;
  private kickoffBy: Side | null = null;
  private over = false;
  private started = false;
  /** A play crossed 2:00; announce the warning before the next event. */
  private pendingWarning = false;
  private steps = 0;
  private otCompleted: [number, number] = [0, 0];
  private driveInRedZone = false;
  private teamStats: [TeamGameStats, TeamGameStats] = [emptyTeamStats(), emptyTeamStats()];
  private playerStats: Record<number, StatLine> = {};
  private plays: PlayLogEntry[] = [];
  private snapshot: Omit<PlayLogEntry, 'text' | 'homeScore' | 'awayScore'> | null = null;
  private homeEdge: number;
  /** Each side's play-calling style (its coordinator's and head coach's). */
  private styles: [CallerStyle, CallerStyle];
  /** Each head coach's culture: his multiplier on his team's pre-snap and personal fouls (`cultureCalls`). */
  private culture: [number, number];
  private qbLeans: [number, number];
  /** Ball path attached to the next logged play. */
  private anim: Anim | null = null;
  /**
   * Who beat whom on a pressure is bookkeeping, not outcome: it draws from its own stream so crediting
   * a rusher and a blocker never changes how a game plays out.
   */
  private creditRng: Rng;
  /** The rusher who got home on the current snap without a sack, credited once the play resolves. */
  private pressureBy: Player | null = null;
  /** This dropback's target, once he's read (`passPlay`): out on his route, never the blocker charged. */
  private passTarget: Player | null = null;
  /** The blocker charged on this snap's pressure or sack, if any: recorded for All-22, never read by the sim. */
  private beatBy: Player | null = null;
  /** Today's outcome for the dropback being played, for the pocket (`pocketFor`). */
  private dropOutcome: PocketOutcome | null = null;
  /** The pocket on the dropback being played: its moment, its composed staging, start and result. */
  private pocketNow: { m: PocketMoment; staged: StagedPlay; start: PocketStart; result: PocketResult } | null = null;
  /** Today's pressure credit on it, as `creditPressure` drew it (the tap's). */
  private pocketToday: {
    rusher: number | null;
    beat: number | null;
    hit: boolean;
    blamed: boolean;
    duration?: number;
  } | null = null;
  /** Who was on the field, kept with the plays for All-22 (only when `keepPlays`). */
  private fieldRecord: FieldRecord | null = null;
  /**
   * Injuries draw from their own stream, like credit: a game where nobody gets hurt plays out exactly
   * as it would with no injury model at all.
   */
  private injuryRng: Rng;
  /**
   * Each player's body this game, by id: energy starts at his condition, drains on the field and
   * partly comes back on the sideline; `spent` is what the field took, `cost` a snap's price.
   */
  private bodies = new Map<number, { energy: number; spent: number; cost: number; risk: RiskFactors }>();
  private depts = new Map<number | null, Department>();
  /** Each side's units on the field (offense, defense), rebuilt with the lineup. */
  private fields: [[Player[], Player[]], [Player[], Player[]]];
  /** Hurt on the last play: they leave before the next one. */
  private hurt: [Player, Mechanism][] = [];
  /** Hurt earlier in the game: out for the rest of it. */
  private out = new Set<number>();
  private injuries: GameInjury[] = [];
  private diagnoses: NonNullable<GameResult['diagnoses']> = {};
  /** Each player's established quirks, read once per game (they only change between weeks). */
  private quirkSets = new Map<number, ReadonlySet<QuirkId>>();
  /** Scrimmage snaps in the current possession: long drives wear a defensive line down. */
  private driveSnaps = 0;
  /** Quarterbacks who see ghosts, by player id: 1 rattled, 0.5 still shaken from last week. */
  private rattled = new Map<number, number>();
  private everRattled = new Set<number>();
  private sacksTaken = new Map<number, number>();
  /** Straight completions by a rattled quarterback: three in a row can settle him. */
  private streak = new Map<number, number>();
  /** Kickers with the yips who have lost their nerve, and their misses so far. */
  private slumping = new Set<number>();
  private misses = new Map<number, number>();
  /** What this game did to players' form, for `recordForm` once it's recorded. */
  private formOut: NonNullable<GameResult['form']> = {};
  private weather: Weather;
  /** What this quarter's weather does, against a typical day (a dome plays a little better). */
  private wx: WeatherCost;
  /** Each side's energy cost per snap, by the weather: heat wears on both, thin air on the visitors. */
  private drain: [number, number];
  /** This quarter's injury odds from the turf (frozen or waterlogged). */
  private turf: number;
  private crew: Crew | undefined;
  /** What the crew does to every penalty roll: the same for both teams. */
  private calls: CrewCalls;
  /** Who drew a flag is bookkeeping, like credit: its own stream, so it never changes the game. */
  private flagRng: Rng;
  /** A defender jumped offside at the snap: the play runs, and the offense picks it or the 5 yards. */
  private offsideFlag = false;
  /** The defense fouled on the half's last play: one more snap with no time on the clock. */
  private untimed = false;
  /** How readily crews protect each quarterback, from his public record (`starLean`), read once a game. */
  private stars = new Map<number, number>();

  constructor(
    private league: League,
    private game: Game,
    private options: SimOptions,
  ) {
    // The open field reads the play log (its index, the field record): playing it keeps the plays.
    if (options.field || options.fieldTap) this.options = options = { ...options, keepPlays: true };
    const seed = options.seed ?? `${league.seed}:${game.season}:${game.id}`;
    this.gameSeed = seed;
    this.rng = new Rng(seed);
    this.habitRng = new Rng(`${seed}:coach-habits`);
    this.gameCoaches = [game.homeId, game.awayId].map((id) =>
      options.coachQuirks === false ? [] : teamCoaches(league, id).map((c) => ({ ...c, quirks: { ...c.quirks } })),
    ) as [Coach[], Coach[]];
    const habitsFor = (staff: Coach[]) =>
      new Map<Coach['role'], ReadonlySet<CoachQuirkId>>(
        staff.filter((c) => c.role !== 'positionCoach').map((c) => [c.role, new Set(activeCoachQuirks(c))]),
      );
    this.gameHabits = [habitsFor(this.gameCoaches[0]), habitsFor(this.gameCoaches[1])];
    this.creditRng = new Rng(`${seed}:credit`);
    this.injuryRng = new Rng(`${seed}:injury`);
    this.flagRng = new Rng(`${seed}:flags`);
    this.days = options.days ?? [teamDay(seed, game.homeId), teamDay(seed, game.awayId)];
    this.homeEdge = game.neutral ? 0 : HOME_FIELD_EDGE;
    this.weather = options.weather ?? gameWeather(league, game);
    this.wx = weatherEffects(weatherAt(this.weather, 1));
    this.turf = turfRisk(weatherAt(this.weather, 1));
    this.drain = [staminaDrain(this.weather, true), staminaDrain(this.weather, false)];
    this.crew = options.crew === undefined ? gameCrew(league, game) : (options.crew ?? undefined);
    this.calls = crewCalls(this.crew);
    const team = (id: number) => league.teams[id];
    // The league's mood at kickoff: every lineup this game builds, the rebuild after an injury too, reads the same one.
    this.moodMean = moraleMean(league);
    this.lineups = [
      buildLineup(
        league,
        team(game.homeId),
        undefined,
        game,
        this.moodMean,
        this.days[0],
        options.chemistry?.[0],
        options.staff?.[0],
      ),
      buildLineup(
        league,
        team(game.awayId),
        undefined,
        game,
        this.moodMean,
        this.days[1],
        options.chemistry?.[1],
        options.staff?.[1],
      ),
    ];
    this.syncKnocks();
    this.styles = [callerStyle(league, game.homeId), callerStyle(league, game.awayId)];
    this.culture = [cultureCalls(league, game.homeId), cultureCalls(league, game.awayId)];
    this.qbLeans = this.leans();
    this.fields = [units(this.lineups[0]), units(this.lineups[1])];
    if (options.keepPlays) {
      const scheme = (l: Lineup) => ({
        offense: l.scheme.offense.id,
        personnel: l.scheme.offense.personnel,
        front: l.scheme.front.id,
        coverage: l.scheme.coverage?.id ?? null,
      });
      this.fieldRecord = {
        units: [fieldUnits(this.lineups[0]), fieldUnits(this.lineups[1])],
        scheme: [scheme(this.lineups[0]), scheme(this.lineups[1])],
        jerseys: {},
        changes: [],
      };
      for (const u of this.fieldRecord.units) this.noteJerseys(u);
      if (options.field) this.fieldRecord.snap = this.fieldSnap = { seed, v: FIELD_VERSION, players: {} };
    }
    // Form carried in from last week: a quarterback still shaken, a kicker in a slump.
    for (const l of this.lineups) {
      if (this.has(l.qb, 'seesGhosts') && formFor(league, l.qb, game.week).shaken) this.rattled.set(l.qb.id, 0.5);
      if (this.has(l.k, 'yips') && formFor(league, l.k, game.week).slump) this.slumping.add(l.k.id);
    }
  }

  run(): GameResult {
    while (!this.over) this.step();
    return this.result();
  }

  get isOver(): boolean {
    return this.over;
  }

  next(): PlayLogEntry[] {
    const before = this.plays.length;
    while (!this.over && this.plays.length === before) this.step();
    return this.plays.slice(before);
  }

  /** The league's mood at kickoff (G2's game-day edge is measured against it). */
  private moodMean = 0;
  /** Each team's day, home then away (`teamDay`): drawn once, so a rebuilt lineup plays the same one. */
  private days: [number, number] = [0, 0];
  /** Both lineups' out-of-position knocks, kept in one map that every step reads through `skill`. */
  private knocks = new Map<number, number>();
  private syncKnocks() {
    this.knocks.clear();
    for (const l of this.lineups) for (const [id, k] of l.knocks) this.knocks.set(id, k);
  }

  /** Both quarterbacks' leans, read with the knocks on: a fill-in under center throws like one. */
  private leans(): [number, number] {
    const prev = useKnocks(this.knocks);
    try {
      return qbLeans(this.league, [this.lineups[0].qb, this.lineups[1].qb]);
    } finally {
      useKnocks(prev);
    }
  }

  /** One event, with this game's out-of-position knocks on (a live game interleaves with other code). */
  private step() {
    const prev = useKnocks(this.knocks);
    try {
      this.event();
    } finally {
      useKnocks(prev);
    }
  }

  /** One event: a quarter break, a kickoff, or a scrimmage down. */
  private event() {
    if (!this.started) {
      this.started = true;
      this.openingReceiver = this.rng.chance(0.5) ? 0 : 1;
      this.kickoffBy = (1 - this.openingReceiver) as Side;
    }
    if (this.pendingWarning) {
      this.pendingWarning = false;
      this.snapshot = null;
      this.log('Two-minute warning.');
    }
    if (this.hurt.length) this.injuryStoppage();
    if (++this.steps > MAX_STEPS) {
      this.over = true;
      return;
    }
    if (this.clock <= 0 && !this.untimed) {
      this.endQuarter();
      this.weatherTurns();
    } else if (this.kickoffBy !== null) {
      const kicker = this.kickoffBy;
      this.kickoffBy = null;
      this.kickoff(kicker);
    } else {
      this.scrimmageDown();
    }
  }

  // ───────────────────────── helpers ─────────────────────────

  private get def(): Side {
    return (1 - this.offense) as Side;
  }

  private get distance(): number {
    return this.lineToGain - this.yardLine;
  }

  private abbrev(side: Side): string {
    return this.lineups[side].team.abbrev;
  }

  private isOvertime(): boolean {
    return this.quarter >= 5;
  }

  /** Human-readable field position, e.g. "BOS 35". */
  private spot(yardLine = this.yardLine, side: Side = this.offense): string {
    if (yardLine === 50) return 'midfield';
    return yardLine < 50 ? `${this.abbrev(side)} ${yardLine}` : `${this.abbrev((1 - side) as Side)} ${100 - yardLine}`;
  }

  /** Adds to a stat line without the wear `credit` applies: the advanced numbers only count, they never touch play. */
  private tally(p: Player, key: StatKey, value: number) {
    const line = (this.playerStats[p.id] ??= {});
    line[key] = (line[key] ?? 0) + value;
  }

  /**
   * A dropback or designed run that counted, in the open measures (`analytics.ts`): EPA and success for the side and
   * its passer or ball carrier, explosives, pressure. Reads the play and the state around it; draws nothing.
   */
  private countAdvanced(side: Side, s: Situation, scoreBefore: [number, number], result: PlayResult) {
    const adv = this.teamStats[side].adv!;
    const before: PlayState = {
      down: s.down,
      distance: s.distance,
      yardLine: s.yardLine,
      offense: side,
      score: scoreBefore,
    };
    const after: PlayState = {
      down: this.down,
      distance: this.distance,
      yardLine: this.yardLine,
      offense: this.offense,
      score: [this.score[0], this.score[1]],
    };
    const epa = playEpa(before, after);
    const touchdown = this.score[side] - scoreBefore[side] >= 6;
    const success = !result.turnover && isSuccess(s.down, s.distance, result.yards, touchdown);
    const dropback = result.kind !== 'run';
    const lost = !!result.turnover;
    const explosive = dropback
      ? result.kind === 'scramble'
        ? isExplosive('run', result.yards, false, lost)
        : isExplosive('pass', result.yards, !!result.complete, lost)
      : isExplosive('run', result.yards, false, lost);
    adv.plays++;
    adv.epa += epa;
    if (success) adv.success++;
    if (explosive) adv.explosive++;
    const carrier = dropback ? this.lineups[side].qb : result.stats.entries.find(([, key]) => key === 'rushAtt')?.[0];
    if (dropback) {
      // Who rushed the passer on it: the front on the field and the rotation, once each (pressure-rate samples).
      const defSide = (1 - side) as Side;
      const front = this.fields[defSide][1].filter((p) => p.position === 'EDGE' || p.position === 'DT');
      for (const p of new Set([...front, ...this.lineups[defSide].rushRotation])) this.tally(p, 'rushSnaps', 1);
      adv.dropbacks++;
      adv.passEpa += epa;
      if (success) adv.passSuccess++;
      if (result.stats.entries.some(([, key]) => key === 'pressures')) adv.pressured++;
    } else {
      adv.rushes++;
      adv.rushEpa += epa;
      if (success) adv.rushSuccess++;
    }
    if (carrier) {
      if (dropback) this.tally(carrier, 'dropbacks', 1);
      this.tally(carrier, 'epa', epa);
      if (success) this.tally(carrier, 'successes', 1);
    }
  }

  private countSnap(p: Player) {
    const line = (this.playerStats[p.id] ??= {});
    line.snaps = (line.snaps ?? 0) + 1;
  }

  private credit(buf: StatBuffer, unhit = false) {
    for (const [p, key, value] of buf.entries) {
      const line = (this.playerStats[p.id] ??= {});
      if (MAX_STATS.has(key)) line[key] = Math.max(line[key] ?? 0, value);
      else line[key] = (line[key] ?? 0) + value;
    }
    this.wear(buf, unhit);
  }

  // ───────────────────────── wear and injuries ─────────────────────────

  /**
   * What a play that counted did to bodies, read from its stat line: a scrimmage snap tires everyone
   * on the field (and rests everyone off it) and carries the snap's injury risk, and each collision
   * it records (a ball carrier brought down, a sack, a hit on the quarterback, a return) adds its own.
   */
  private wear(buf: StatBuffer, unhit = false) {
    const rb2 = this.lineups[this.offense].rbs[1];
    let scrimmage = false;
    let spell = false;
    let passing = false;
    for (const [p, key] of buf.entries) {
      if (key === 'passAtt' || key === 'rushAtt') scrimmage = true;
      else if (key === 'sacked') scrimmage = true;
      if (key === 'passAtt' || key === 'sacked') passing = true;
      // The second back is on the field for the plays he's part of, spelling the lead back.
      if (p === rb2) spell = true;
    }
    if (scrimmage) this.snap(spell, passing);
    for (const [p, event] of collisions(buf.entries, this.lineups[this.offense].qb, unhit)) this.collide(p, event);
  }

  private dept(p: Player): Department {
    return this.depts.get(p.teamId) ?? this.depts.set(p.teamId, departmentFor(this.league, p.teamId)).get(p.teamId)!;
  }

  private body(p: Player) {
    let b = this.bodies.get(p.id);
    const side = this.lineups[0].team.id === p.teamId ? 0 : 1;
    if (!b)
      this.bodies.set(
        p.id,
        (b = {
          energy: p.condition ?? 100,
          spent: 0,
          cost: snapCost(p) * this.drain[side],
          risk: riskFactors(this.league, p, this.dept(p)),
        }),
      );
    return b;
  }

  /** One scrimmage snap: the units on the field tire and face the snap's risk; the units off it rest. */
  private snap(spell: boolean, passing: boolean) {
    for (let side: Side = 0; side <= 1; side++) {
      const [off, def] = this.fields[side];
      const offense = side === this.offense;
      const lead = spell && offense ? this.lineups[side].rbs[0] : null;
      for (const p0 of offense ? off : def) {
        const p = p0 === lead ? this.lineups[side].rbs[1] : p0;
        const b = this.body(p);
        b.energy -= b.cost;
        b.spent += b.cost;
        this.expose(p, SNAP_RISK * SNAP_EXPOSURE[p.position], SNAP_CONTACT);
        // The snap count: who really played, as against who dressed.
        this.countSnap(p);
      }
      // The pass-rush rotation is in the hunt on every dropback (`rushers`): a snap each, no wear (they rest between).
      if (!offense && passing) for (const p of this.lineups[side].rushRotation) this.countSnap(p);
      for (const p of offense ? def : off) {
        const b = this.body(p);
        b.energy = Math.min((p.condition ?? 100) - HELD_SHARE * b.spent, b.energy + SIDELINE_REST);
      }
    }
  }

  private collide(p: Player, event: ContactEvent) {
    const [chance, contact] = CONTACT_RISK[event];
    this.expose(p, event === 'carrier' ? chance * this.body(p).risk.carrier : chance, contact);
  }

  /** Roll for an injury: the event's chance, split into contact and soft tissue, times his risk and his fatigue. */
  private expose(p: Player, chance: number, contactShare: number) {
    if (this.out.has(p.id) || (this.hurt.length && this.hurt.some(([h]) => h === p))) return;
    const b = this.body(p);
    const tired = fatigueMult(b.energy) * this.turf;
    const contact = chance * contactShare * b.risk.contact * tired;
    const soft = chance * (1 - contactShare) * b.risk.soft * tired;
    const roll = this.injuryRng.next();
    if (roll < contact + soft) this.hurt.push([p, roll < contact ? 'contact' : 'soft']);
  }

  /** Between plays: the injured leave for good and the next man steps in. */
  private injuryStoppage() {
    for (const [p, mechanism] of this.hurt) {
      const side: Side = this.lineups[0].team.id === p.teamId ? 0 : 1;
      this.out.add(p.id);
      const { injury, scar } = rollInjury(this.injuryRng, this.league, p, mechanism, 'game', this.dept(p), {
        season: this.game.season,
        week: this.game.week,
      });
      this.injuries.push({
        playerId: p.id,
        teamId: this.lineups[side].team.id,
        quarter: this.quarter,
        clock: this.clock,
        type: injury.type,
        estimate: [...injury.estimate],
      });
      this.diagnoses[p.id] = { injury, ...(scar ? { scar } : {}) };
      this.snapshot = null;
      this.log(
        `Injury: ${this.abbrev(side)} ${p.position} ${short(p)} (${injuryLabel(injury.type).toLowerCase()}) is out for the game.`,
      );
      const qb = this.lineups[side].qb;
      this.lineups[side] = buildLineup(
        this.league,
        this.lineups[side].team,
        this.out,
        this.game,
        this.moodMean,
        this.days[side],
        this.options.chemistry?.[side],
        this.options.staff?.[side],
      );
      this.syncKnocks();
      this.fields[side] = units(this.lineups[side]);
      if (this.fieldRecord) {
        const u = fieldUnits(this.lineups[side]);
        this.fieldRecord.changes.push([this.plays.length, side, u]);
        this.noteJerseys(u);
      }
      if (this.lineups[side].qb !== qb) this.qbLeans = this.leans();
    }
    this.hurt = [];
  }

  /** The field record as it stands (a live game's view reads it before the result exists). */
  fieldNow(): FieldRecord | undefined {
    return this.fieldRecord ?? undefined;
  }

  private noteJerseys(u: FieldUnits) {
    for (const id of unitIds(u)) this.fieldRecord!.jerseys[id] ??= this.league.players[id].jersey;
  }

  private fgProb(distance: number, kicker: Player): number {
    // Wind, snow and cold make every kick play longer; coaches see it in their range too (`coach.fieldGoalOdds`).
    // He makes about a point fewer than he reads; an extra point is about 97%.
    return coach.fieldGoalOdds(distance, skill(kicker, 'fieldGoal'), this.wx.kick);
  }

  /**
   * The odds a field goal is good once it's kicked. Coaches decide from `fgProb`; a kicker's quirks
   * only show when he kicks: a cannon gains range and sprays the short ones, ice water halves the
   * misses late in a close game.
   */
  private kickMakes(distance: number, k: Player): number {
    let p = this.fgProb(distance, k) - 0.01;
    if (this.has(k, 'boomerLeg'))
      p = distance >= 50 ? this.fgProb(distance - 4, k) - 0.01 : distance < 40 ? 1 - (1 - p) * 1.3 : p;
    if (this.has(k, 'iceWater') && this.clutch()) p = 1 - (1 - p) * 0.4;
    if (this.slumping.has(k.id)) p = 1 - (1 - p) * 1.8;
    return clamp(p, 0, 1);
  }

  private situation(): Situation {
    const off = this.offense;
    return {
      quarter: this.quarter,
      clock: this.clock,
      down: this.down,
      distance: this.distance,
      yardLine: this.yardLine,
      scoreDiff: this.score[off] - this.score[this.def],
      offTimeouts: this.timeouts[off],
      defTimeouts: this.timeouts[this.def],
      overtime: this.isOvertime(),
      fgMakeProb: this.fgProb(100 - this.yardLine + 17, this.lineups[off].k),
      passLean: this.styles[off].passLean,
      qbLean: this.qbLeans[off],
      fourthDown: this.styles[off].fourthDown,
      depthLean: this.lineups[off].scheme.offense.depth,
      blitz: this.lineups[this.def].scheme.front.blitz * (this.lineups[this.def].scheme.coverage?.blitz ?? 1),
      weather: this.wx.pass,
    };
  }

  private log(text: string, scoring = false) {
    const entry: PlayLogEntry = {
      ...(this.snapshot ?? {
        quarter: this.quarter,
        clock: this.clock,
        offense: this.lineups[this.offense].team.id,
        down: 0,
        distance: 0,
        yardLine: this.yardLine,
      }),
      text,
      homeScore: this.score[0],
      awayScore: this.score[1],
    };
    if (scoring) entry.scoring = true;
    // The dropback the pocket played keeps its facts; a flagged snap, on the play as it ran (its open field started
    // from the pocket's frames too).
    const pn = this.pocketNow;
    if (pn && this.options.field && this.anim && this.plays.length === pn.m.index) {
      if (this.anim.kind !== 'penalty') this.anim.field = { ...this.anim.field, ...pn.m.facts };
      else if (this.anim.ran) this.anim.ran = { ...this.anim.ran, field: { ...this.anim.ran.field, ...pn.m.facts } };
    }
    if (this.anim) Object.assign(entry, this.anim);
    this.anim = null;
    if (this.options.keepPlays || scoring) {
      this.plays.push(entry);
      // The defense's call on this snap, for All-22 (recorded only: the play is already played).
      if (this.fieldRecord && this.callNow && this.callNow !== 'base')
        this.fieldRecord.calls =
          (this.fieldRecord.calls ?? '').padEnd(this.plays.length - 1, '.') + CALL_CHAR[this.callNow];
    }
    this.callNow = null;
    this.snapshot = null;
  }

  /** Convert a yard line from `side`'s point of view to field coordinates. */
  private fieldX(side: Side, yardLine: number): number {
    return side === 0 ? yardLine : 100 - yardLine;
  }

  private setAnim(side: Side, kind: PlayKind, from: number, to: number, air?: number, lane = 0, who?: PackedActors) {
    this.anim = this.animOf(side, kind, from, to, air, lane, who);
  }

  private animOf(side: Side, kind: PlayKind, from: number, to: number, air?: number, lane = 0, who?: PackedActors) {
    const anim: Anim = { kind, from: this.fieldX(side, from), to: this.fieldX(side, to), lane };
    if (air !== undefined) anim.air = this.fieldX(side, air);
    if (who) anim.who = who;
    return anim;
  }

  /** Who a scrimmage play was about, packed for the log (`actorsOf`). */
  private actorsFor(result: PlayResult): PackedActors | undefined {
    return packActors(
      actorsOf({
        entries: result.stats.entries,
        defender: result.defender,
        // Kneels and spikes skip the snap's reset, so this snap's rush is only read on plays that had one.
        rusher: result.rusher ?? (result.kind === 'pass' || result.kind === 'scramble' ? this.pressureBy : null),
        beat: result.kind === 'kneel' || result.kind === 'spike' ? null : this.beatBy,
        // The man who took the ball: a pick's, a fumble's, or a ball batted down at the line.
        take: result.turnover?.by ?? (result.batted ? result.brokenUpBy : undefined),
      }),
    );
  }

  /**
   * A snap as it ran, for the log, whether it stands or a flag wipes it out: its kind, where it started and ended,
   * where the ball came down and who it was about (offense's yards; `animOf` turns them into the field's).
   */
  private ranAnim(result: PlayResult, start: number, airAt: number | undefined, who?: PackedActors): Anim {
    const side = this.offense;
    if (result.turnover) {
      const { spot, returnYds } = result.turnover;
      const isInt = result.turnover.kind === 'int';
      // A return that scores ends in the end zone (a return stops at the goal line it reaches: drawn there, it would
      // read as tackled on it).
      const end =
        isInt && spot >= 100
          ? Math.min(spot, 108)
          : returnYds >= spot
            ? Math.max(-4, Math.min(-2, spot - returnYds))
            : spot - returnYds;
      const anim = this.animOf(
        side,
        isInt ? 'int' : result.kind,
        start,
        end,
        isInt ? Math.min(spot, 108) : airAt,
        result.lane,
        who,
      );
      // Where the ball came out: the log's `to` is where the return ended, so without it All-22 can't drop the ball.
      if (!isInt) anim.loose = this.fieldX(side, spot);
      if (result.open) anim.open = result.open;
      if (result.field) anim.field = result.field;
      return anim;
    }
    const kind: PlayKind = result.kind === 'pass' ? (result.complete ? 'pass' : 'incomplete') : result.kind;
    const ran = start + result.yards;
    const end = kind === 'incomplete' ? start : ran >= 100 ? 102 : Math.max(-4, ran);
    const anim = this.animOf(side, kind, start, end, airAt, result.lane, who);
    if (result.open && (kind === 'run' || kind === 'pass')) anim.open = result.open;
    if (result.field) anim.field = result.field;
    return anim;
  }

  private takeSnapshot(down = this.down) {
    this.snapshot = {
      quarter: this.quarter,
      clock: this.clock,
      offense: this.lineups[this.offense].team.id,
      down,
      distance: down ? this.distance : 0,
      yardLine: this.yardLine,
    };
  }

  // ───────────────────────── clock ─────────────────────────

  private inTwoMinutePeriod(): boolean {
    return this.quarter === 2 || this.quarter === 4;
  }

  /** A runoff after a man went out of bounds outside the late windows loses the spot's pause; the flag is spent. */
  private spotRunoff(seconds: number): number {
    const out = this.spotted ? coach.afterOutOfBounds(seconds) : seconds;
    this.spotted = false;
    return out;
  }

  /** Time between snaps while the clock is running. */
  private preSnapRunoff(seconds: number) {
    if (this.inTwoMinutePeriod() && !this.twoMinuteWarned && this.clock > 120 && this.clock - seconds <= 120) {
      this.teamStats[this.offense].top += this.clock - 120;
      this.clock = 120;
      this.clockRunning = false;
      this.twoMinuteWarned = true;
      this.snapshot = null;
      this.log('Two-minute warning.');
      return;
    }
    const used = Math.min(this.clock, seconds);
    this.clock -= used;
    this.teamStats[this.offense].top += used;
  }

  /** Time elapsed during a live play. Returns true if the two-minute warning hit. */
  private playTime(seconds: number): boolean {
    const before = this.clock;
    const used = Math.min(this.clock, seconds);
    this.clock -= used;
    this.teamStats[this.offense].top += used;
    if (this.inTwoMinutePeriod() && !this.twoMinuteWarned && before > 120 && this.clock <= 120) {
      this.twoMinuteWarned = true;
      this.pendingWarning = true;
      return true;
    }
    return false;
  }

  /** Out-of-bounds only stops the clock late in each half. */
  private oobStopsClock(): boolean {
    return (this.quarter === 2 && this.clock <= 120) || (this.quarter >= 4 && this.clock <= 300);
  }

  private useTimeout(side: Side) {
    this.timeouts[side]--;
    this.clockRunning = false;
    this.spotted = false;
    this.snapshot = null;
    this.log(`Timeout ${this.abbrev(side)} (${this.timeouts[side]} left).`);
  }

  private endQuarter() {
    const q = this.quarter;
    if (q === 1 || q === 3) {
      this.quarter++;
      this.clock = QUARTER_SECONDS;
      return;
    }
    if (q === 2) {
      // Halftime: a rattled quarterback gets a coin flip's chance to clear his head.
      for (const id of [...this.rattled.keys()]) if (this.rng.chance(0.5)) this.rattled.delete(id);
      this.quarter = 3;
      this.clock = QUARTER_SECONDS;
      this.timeouts = [3, 3];
      this.twoMinuteWarned = false;
      this.clockRunning = false;
      this.kickoffBy = this.openingReceiver;
      return;
    }
    if (this.score[0] !== this.score[1]) {
      this.over = true;
      return;
    }
    if (q === 4 || this.options.playoff) {
      // Overtime: both teams are guaranteed a possession, then sudden death.
      this.quarter++;
      this.clock = this.options.playoff ? QUARTER_SECONDS : 600;
      this.clockRunning = false;
      if (q === 4) {
        this.timeouts = [2, 2];
        this.otCompleted = [0, 0];
        const receiver: Side = this.rng.chance(0.5) ? 0 : 1;
        this.kickoffBy = (1 - receiver) as Side;
      }
      return;
    }
    this.over = true; // regular-season tie
  }

  /** Rain or snow that comes after kickoff changes the game from the start of its quarter. */
  private weatherTurns() {
    const w = this.weather;
    if (this.over || this.quarter !== w.onset) return;
    this.wx = weatherEffects(weatherAt(w, this.quarter));
    this.turf = turfRisk(weatherAt(w, this.quarter));
    const fall = { none: '', rain: 'Rain', mixed: 'Sleet', snow: 'Snow' }[w.precip];
    this.log(
      w.roof === 'open'
        ? `${fall} moves in, and the roof closes.`
        : `${w.heavy ? `Heavy ${fall.toLowerCase()}` : fall} starts to fall.`,
    );
  }

  /** In overtime, the game ends once the trailing team has had its possession. */
  private checkOvertimeEnd(): boolean {
    if (!this.isOvertime() || this.score[0] === this.score[1]) return false;
    const trailing: Side = this.score[0] < this.score[1] ? 0 : 1;
    if (this.otCompleted[trailing] >= 1) {
      this.over = true;
      return true;
    }
    return false;
  }

  // ───────────────────────── possession & scoring ─────────────────────────

  private endPossession() {
    if (this.isOvertime()) this.otCompleted[this.offense]++;
    this.driveInRedZone = false;
    this.driveSnaps = 0;
  }

  /** Give the ball to the other team at `yardLine` (measured from their own goal line). */
  private changePossession(yardLine: number) {
    this.endPossession();
    this.offense = this.def;
    this.startSeries(yardLine);
    this.clockRunning = false;
    this.checkOvertimeEnd();
  }

  private startSeries(yardLine: number) {
    this.yardLine = clamp(Math.round(yardLine), 1, 99);
    this.down = 1;
    this.lineToGain = Math.min(100, this.yardLine + 10);
  }

  private addPoints(side: Side, points: number) {
    this.score[side] += points;
    this.quarters[side][Math.min(this.quarter, 5) - 1] =
      (this.quarters[side][Math.min(this.quarter, 5) - 1] ?? 0) + points;
  }

  private touchdown(side: Side, text: string) {
    this.addPoints(side, 6);
    if (side === this.offense && this.driveInRedZone) this.teamStats[side].redZoneTd++;
    this.log(text, true);
    this.clockRunning = false;
    if (side === this.offense) this.endPossession();
    // A walk-off only when the touchdown puts the scorer ahead; a trailing scorer still gets the try.
    if (this.score[side] > this.score[(1 - side) as Side] && this.checkOvertimeEnd()) return;
    this.conversion(side);
    if (this.checkOvertimeEnd()) return;
    this.kickoffBy = side;
  }

  private conversion(side: Side) {
    const lineup = this.lineups[side];
    const s: Situation = { ...this.situation(), scoreDiff: this.score[side] - this.score[(1 - side) as Side] };
    this.snapshot = null;
    const two = twoPointHabit(s, this.habits(side, 'headCoach'), this.habitRng);
    if (two.eligible)
      this.evidence(
        side,
        'headCoach',
        'goesForTwo',
        two.goes,
        two.goes,
        two.goes ? 'Went for two where the analytics chart says to.' : undefined,
      );
    if (coach.goForTwo(s) || two.goes) {
      const ok = this.rng.chance(clamp(0.47 + 0.01 * (skill(lineup.qb, 'shortAccuracy') - 12), 0.35, 0.6));
      if (ok) this.addPoints(side, 2);
      this.setAnim(side, 'two', 98, ok ? 102 : 99);
      this.log(`Two-point attempt ${ok ? 'is GOOD' : 'fails'}.`, true);
      return;
    }
    const k = lineup.k;
    const blocking = this.lineups[(1 - side) as Side];
    // The try is snapped from the 15; a flag can move it, and a kick a flag wipes out is tried again.
    let at: Spot = { yardLine: 85, down: 1, lineToGain: 100 };
    let note = '';
    for (let tries = 0; ; tries++) {
      const flag = tries < 3 ? this.kickFoul(lineup, blocking) : null;
      // A 33-yarder from the 15, a yard longer for every yard the ball moves back.
      const distance = 33 + 85 - at.yardLine;
      if (flag?.foul === 'falseStart') {
        const back = enforce('falseStart', at);
        at = back;
        this.flag(side, 'falseStart', flag.by, 'accepted', back.yards);
        note += `PENALTY on ${this.flagged(side, flag.by)}: False start, ${back.yards} yards. `;
        continue;
      }
      const made = this.rng.chance(Math.min(0.985, this.fgProb(distance, k) + 0.01));
      this.fgWear(lineup, blocking);
      if (flag) {
        // The kick unit's hold costs a good kick; the block unit's fouls give a missed one another go, closer.
        const kickers = flag.foul === 'holding';
        const fouler = kickers ? side : ((1 - side) as Side);
        if (kickers === made) {
          const moved = enforce(flag.foul, at);
          at = moved;
          this.flag(fouler, flag.foul, flag.by, 'accepted', moved.yards);
          note += `${short(k)} extra point is ${made ? 'good' : 'no good'}. PENALTY on ${this.flagged(fouler, flag.by)}: ${FOULS[flag.foul].label}, ${moved.yards} yards. `;
          continue;
        }
        this.flag(fouler, flag.foul, flag.by, 'declined');
        note += `${FOULS[flag.foul].label} on ${this.flagged(fouler, flag.by)}, declined. `;
      }
      const buf = new StatBuffer();
      buf.add(k, 'xpAtt');
      if (made) {
        buf.add(k, 'xpMade');
        this.addPoints(side, 1);
      }
      this.credit(buf);
      this.setAnim(side, 'xp', at.yardLine, 110, 110);
      this.log(
        `${note}${short(k)} ${distance === 33 ? 'extra point' : `${distance}-yard extra point`} is ${made ? 'GOOD' : 'NO GOOD'}.`,
        true,
      );
      return;
    }
  }

  private safety() {
    this.addPoints(this.def, 2);
    this.log(`SAFETY! ${this.abbrev(this.def)} scores 2.`, true);
    this.endPossession();
    if (this.checkOvertimeEnd()) return;
    // Free kick from the 20: receiving team usually starts near its own 40.
    this.offense = this.def;
    this.startSeries(this.rng.normal(40, 6));
    this.clockRunning = false;
  }

  // ───────────────────────── special teams ─────────────────────────

  private kickoff(kickingSide: Side) {
    this.fieldY = MID;
    const kicking = this.lineups[kickingSide];
    const receivingSide = (1 - kickingSide) as Side;
    const receiving = this.lineups[receivingSide];
    this.offense = kickingSide;
    this.driveInRedZone = false;
    this.driveSnaps = 0;
    this.snapshot = null;
    const scoreDiff = this.score[kickingSide] - this.score[receivingSide];

    if (coach.shouldOnside(scoreDiff, this.quarter, this.clock, this.timeouts[kickingSide])) {
      const recovered = this.rng.chance(0.12);
      this.playTime(3);
      this.setAnim(kickingSide, 'kickoff', 35, 46, 46);
      if (recovered) {
        this.startSeries(46);
        this.log(`${short(kicking.k)} onside kick RECOVERED by ${kicking.team.abbrev} at the ${this.spot()}.`);
      } else {
        this.offense = receivingSide;
        this.startSeries(54);
        this.log(`${short(kicking.k)} onside kick recovered by ${receiving.team.abbrev} at the ${this.spot()}.`);
      }
      this.clockRunning = false;
      return;
    }

    const kp = skill(kicking.k, 'kickoffDistance');
    const { all } = this.calls;
    // Out of bounds or short of the landing zone: the receiving team's ball at its 40. A kicker who can't
    // place the ball misses more.
    if (this.rng.chance(KICKOFF_MISS * Math.exp(-0.08 * (skill(kicking.k, 'fieldGoal') - 12)))) {
      this.offense = receivingSide;
      this.kickWear(false);
      this.flag(kickingSide, 'kickoffMiss', kicking.k, 'accepted');
      this.setAnim(kickingSide, 'kickoff', 35, 60, 60);
      this.startSeries(40);
      this.clockRunning = false;
      this.log(
        `${short(kicking.k)} kicks off out of bounds. PENALTY on ${this.flagged(kickingSide, kicking.k)}: ${FOULS.kickoffMiss.label}. Ball at the ${this.spot()}.`,
      );
      return;
    }
    const touchback = this.rng.chance(
      clamp(0.38 + 0.025 * (kp - 12) + (this.has(kicking.k, 'boomerLeg') ? 0.12 : 0) - 0.02 * this.wx.kick, 0.15, 0.8),
    );
    // A kicking team lined up wrong (offside, or out of its setup zone): 5 more yards for the receivers.
    let lined = this.rng.chance(KICKOFF_FORMATION * this.unitLoose(kicking) * all) ? this.stCommitter(kicking) : null;
    this.offense = receivingSide;
    let start: number;
    let text: string;
    if (touchback) {
      this.kickWear(false);
      this.setAnim(kickingSide, 'kickoff', 35, 104, 104);
      start = 35;
      text = `${short(kicking.k)} kicks off into the end zone. Touchback`;
    } else {
      const kr = receiving.kr;
      const edge = skill(kr, 'returns') - 12;
      start = clamp(
        Math.round(
          this.rng.normal(KICK_RETURN + 0.6 * edge + RETURN_COACH.kick * (receiving.stCoach - kicking.stCoach), 6),
        ),
        8,
        60,
      );
      const returnTd = this.rng.chance(clamp(0.004 + 0.001 * edge, 0.001, 0.012));
      if (returnTd) start = 100;
      // The open field (`field/`): caught at the 3 (the engine's own spot for a returned kickoff), run back from there.
      const kickMoment = this.fielding
        ? this.returnMoment('kickoff', 35, 97, kickingSide, receiving, kicking, start - 3, start >= 100)
        : undefined;
      const kickField = kickMoment ? this.openField(kickMoment) : null;
      const kickSpatial = kickField?.result;
      const todayStart = start;
      // The owner's call H: the return's length is today's; the open field plays it out.
      let block = this.rng.chance(RETURN_FOUL * this.unitLoose(receiving) * all)
        ? this.blockSpot(1, start, receiving)
        : null;
      // Both teams flagged: they offset, and the return stands.
      if (block && lined) {
        this.flag(receivingSide, block.foul, block.by, 'offset');
        this.flag(kickingSide, 'kickoffFormation', lined, 'offset');
        [block, lined] = [null, null];
      }
      const buf = new StatBuffer();
      buf.add(kr, 'krAtt');
      buf.add(kr, 'krYds', (block ? block.at : start) - 3);
      const kickTime = this.rng.int(5, 8);
      // Returns keep today's play time, as punts do: the engine's clock convention for kicks.
      this.playTime(kickTime);
      this.kickWear(true);
      this.setAnim(kickingSide, 'kickoff', 35, returnTd && !block ? -3 : 100 - (block ? block.spot : start), 97);
      if (kickSpatial) this.anim!.field = kickMoment!.facts;
      if (kickMoment)
        this.tap(kickField, kickMoment, {
          yards: todayStart - 3,
          tackler: null,
          touchdown: todayStart >= 100,
          outOfBounds: false,
          duration: kickTime,
        });
      if (returnTd && !block) {
        buf.add(kr, 'krTd');
        this.credit(buf);
        // On a touchdown the receivers decline a kicking team's formation foul.
        if (lined) this.flag(kickingSide, 'kickoffFormation', lined, 'declined');
        this.touchdown(receivingSide, `${short(kr)} returns the kickoff ${start - 3} yards for a TOUCHDOWN!`);
        return;
      }
      this.credit(buf);
      text = `${short(kicking.k)} kicks off. ${short(kr)} returns to the ${this.spot(block ? block.at : start, receivingSide)}`;
      if (block) {
        this.flag(receivingSide, block.foul, block.by, 'accepted', block.yards);
        text += `. PENALTY on ${this.flagged(receivingSide, block.by)}: ${FOULS[block.foul].label}, ${block.yards} yards`;
        start = block.spot;
      }
    }
    if (lined) {
      this.flag(kickingSide, 'kickoffFormation', lined, 'accepted', 5);
      text += `. PENALTY on ${this.flagged(kickingSide, lined)}: ${FOULS.kickoffFormation.label}, 5 yards`;
      start += 5;
    }
    this.startSeries(start);
    this.log(`${text}. Ball at the ${this.spot()}.`);
    this.clockRunning = false;
  }

  /**
   * A flag on a return: a hold or a block in the back somewhere behind the returner, between where he
   * caught it (`from`) and where he got to; the ball goes 10 yards back from that spot (half the distance
   * near his goal line), and the return yards stop there.
   */
  private blockSpot(
    from: number,
    to: number,
    unit: Lineup,
  ): { at: number; spot: number; yards: number; foul: Foul; by: Player | undefined } {
    const at = Math.max(1, Math.round(from + this.rng.float(0.1, 1) * (Math.min(to, 99) - from)));
    const yards = Math.min(10, Math.floor(at / 2));
    const foul: Foul = this.flagRng.chance(0.5) ? 'returnHolding' : 'blockInBack';
    return { at, spot: at - yards, yards, foul, by: this.stCommitter(unit) };
  }

  /** How loose a kick unit is against a typical one: the odds of its flags scale with it. */
  private unitLoose(unit: Lineup): number {
    return Math.exp(-KICK_FLAG_PER_POINT * (unit.specialDiscipline - ST_DISCIPLINE));
  }

  /** Who on a kick unit drew the flag, leaning on the least disciplined; the kicker if there's no unit. */
  private stCommitter(unit: Lineup): Player | undefined {
    return unit.st.length ? this.flagRng.weighted(unit.st, (p) => Math.max(1, 24 - discipline(p))) : unit.k;
  }

  /**
   * Who runs into or roughs a punter: one of the six rushing him at the front of the return unit (the rest jam the
   * gunners), as the field record lines them up; a jammer split wide never gets there.
   */
  private puntRusher(unit: Lineup): Player | undefined {
    const rush = unit.st.filter((p) => p !== unit.pr).slice(0, 6);
    return rush.length ? this.flagRng.weighted(rush, (p) => Math.max(1, 24 - discipline(p))) : this.stCommitter(unit);
  }

  /**
   * A kick play: both kick units run, tire and face the play's risk, the backups who cover kicks most of
   * all (a return is a full-speed collision; a touchback or a fair catch mostly running).
   */
  private kickWear(returned: boolean) {
    for (const l of this.lineups) {
      for (const p of l.st) {
        const b = this.body(p);
        b.energy -= b.cost;
        b.spent += b.cost;
        this.expose(
          p,
          SNAP_RISK * SNAP_EXPOSURE[p.position] * (returned ? KICK_RISK.returned : KICK_RISK.quiet),
          SNAP_CONTACT,
        );
      }
    }
  }

  private punt() {
    const off = this.lineups[this.offense];
    const def = this.lineups[this.def];
    this.takeSnapshot();
    const buf = new StatBuffer();
    const p = off.p;
    this.playTime(this.rng.int(6, 9));

    const blockOdds = (this.has(p, 'quickRelease') ? 0.3 : 1) * (this.has(p, 'slingFoot') ? 3 : 1);
    if (this.rng.chance(0.005 * blockOdds)) {
      buf.add(p, 'puntsBlocked');
      this.credit(buf);
      const ballAt = this.yardLine - 8;
      this.setAnim(this.offense, 'punt', this.yardLine, ballAt);
      if (ballAt <= 0) {
        this.log(`${short(p)} punt is BLOCKED out of the end zone.`);
        this.safety();
        return;
      }
      this.log(`${short(p)} punt is BLOCKED!`);
      this.changePossession(100 - ballAt);
      return;
    }

    // A rusher into the punter: 5 yards for running into him (taken only when it moves the chains), 15 and
    // a first down for roughing him. Either way the punting team keeps the ball.
    const { all } = this.calls;
    const rush = this.rng.next();
    let note = '';
    if (rush < (RUNNING_INTO_KICKER + ROUGHING_KICKER) * all) {
      const foul: Foul = rush < RUNNING_INTO_KICKER * all ? 'runningIntoKicker' : 'roughingKicker';
      const by = this.puntRusher(def);
      const yards = Math.min(FOULS[foul].yards as number, Math.floor((100 - this.yardLine) / 2));
      if (foul === 'roughingKicker' || this.yardLine + yards >= this.lineToGain) {
        this.flag(this.def, foul, by, 'accepted', yards);
        this.setAnim(this.offense, 'penalty', this.yardLine, this.yardLine + yards);
        this.yardLine += yards;
        this.firstDown();
        this.clockRunning = false;
        this.log(
          `${short(p)} punts. PENALTY on ${this.flagged(this.def, by)}: ${FOULS[foul].label}, ${yards} yards. No play.`,
        );
        return;
      }
      this.flag(this.def, foul, by, 'declined');
      note = `. ${FOULS[foul].label} on ${this.flagged(this.def, by)}, declined`;
    }

    const outkicks = this.has(p, 'outkicksCoverage');
    const coffin = this.has(p, 'coffinCorner');
    const arc = this.has(p, 'highArc');
    // Weather shortens punts, and wind scatters them.
    let gross = Math.round(
      clamp(
        this.rng.normal(
          46 + 0.9 * (skill(p, 'puntDistance') - 12) + (outkicks ? 3 : 0) - (arc ? 3 : 0) - 0.5 * this.wx.kick,
          5.5 + 0.3 * Math.max(0, this.wx.kick),
        ),
        25,
        70,
      ),
    );
    // Pin it deep instead of booting into the end zone from plus territory.
    const room = 100 - this.yardLine;
    if (gross > room - 5 && room < 60) {
      const accuracy = clamp(0.45 + 0.03 * (skill(p, 'puntPlacement') - 12) + (coffin ? 0.2 : 0), 0.25, 0.85);
      // A coffin-corner man's good one dies inside the 10; anyone else's can carry to the 15.
      gross = this.rng.chance(accuracy) ? room - this.rng.int(3, coffin ? 10 : 15) : room;
    }
    buf.add(p, 'punts');
    buf.add(p, 'puntYds', gross);
    const landing = this.yardLine + gross;
    this.setAnim(this.offense, 'punt', this.yardLine, Math.min(landing, 105), Math.min(landing, 105));
    if (landing >= 100) {
      this.credit(buf);
      this.kickWear(false);
      this.log(`${short(p)} punts ${gross} yards into the end zone. Touchback${note}.`);
      this.changePossession(20);
      return;
    }
    const receiveAt = 100 - landing;
    const pr = def.pr;
    // The coverage gets there before the ball (downed punts have nobody to interfere with): 15 yards from the catch.
    if (receiveAt > 10 && this.rng.chance(KICK_CATCH * all)) {
      const by = this.stCommitter(off);
      const spot = Math.min(99, receiveAt + 15);
      this.credit(buf);
      this.kickWear(false);
      this.flag(this.offense, 'kickCatch', by, 'accepted', spot - receiveAt);
      this.log(
        `${short(p)} punts ${gross} yards${note}. PENALTY on ${this.flagged(this.offense, by)}: ${FOULS.kickCatch.label}, ${spot - receiveAt} yards. Ball at the ${this.spot(spot, this.def)}.`,
      );
      this.changePossession(spot);
      return;
    }
    // A well-placed punt (hang time, toward the sideline) leaves the returner no room.
    // No hang time means no fair catches; a coffin-corner man from plus territory leaves no room.
    const hang = (outkicks ? -0.15 : 0) + (coffin && room < 60 ? 0.2 : 0) + (arc ? 0.12 : 0);
    if (receiveAt <= 10 || this.rng.chance(clamp(0.42 + 0.02 * (skill(p, 'puntPlacement') - 12) + hang, 0.2, 0.65))) {
      this.credit(buf);
      this.kickWear(false);
      this.log(
        `${short(p)} punts ${gross} yards${note}. ${receiveAt <= 10 ? 'Downed' : `Fair catch by ${short(pr)}`} at the ${this.spot(receiveAt, this.def)}.`,
      );
      this.changePossession(receiveAt);
      return;
    }
    const edge = skill(pr, 'returns') - 12;
    let ret = Math.max(
      0,
      Math.round(
        this.rng.normal(
          PUNT_RETURN +
            0.5 * edge +
            RETURN_COACH.punt * (def.stCoach - off.stCoach) +
            (outkicks ? 3 : 0) -
            (arc ? 1.5 : 0),
          6,
        ),
      ),
    );
    if (this.rng.chance(clamp(0.006 + 0.0015 * edge, 0.002, 0.02))) ret = 100 - receiveAt;
    // The open field (`field/`): from the catch. (The punt's play time was taken before the kick, as today.)
    const puntMoment = this.fielding
      ? this.returnMoment('punt', this.yardLine, landing, this.offense, def, off, ret, receiveAt + ret >= 100)
      : undefined;
    const puntField = puntMoment ? this.openField(puntMoment) : null;
    const puntSpatial = puntField?.result;
    const todayRet = ret;
    const block = this.rng.chance(RETURN_FOUL * this.unitLoose(def) * all)
      ? this.blockSpot(receiveAt, receiveAt + ret, def)
      : null;
    const end = block ? block.spot : receiveAt + ret;
    // Returns run back toward the punting team's goal line.
    this.setAnim(this.offense, 'punt', this.yardLine, end >= 100 ? -3 : 100 - end, landing);
    if (puntSpatial) this.anim!.field = puntMoment!.facts;
    if (puntMoment)
      this.tap(puntField, puntMoment, {
        yards: todayRet,
        tackler: null,
        touchdown: receiveAt + todayRet >= 100,
        outOfBounds: false,
        duration: 0,
      });
    buf.add(pr, 'prAtt');
    buf.add(pr, 'prYds', (block ? block.at : receiveAt + ret) - receiveAt);
    if (!block && receiveAt + ret >= 100) buf.add(pr, 'prTd');
    this.credit(buf);
    this.kickWear(true);
    if (!block && receiveAt + ret >= 100) {
      this.log(`${short(p)} punts ${gross} yards${note}.`);
      this.endPossession();
      this.offense = this.def;
      this.touchdown(this.offense, `${short(pr)} returns the punt ${ret} yards for a TOUCHDOWN!`);
      return;
    }
    if (block) {
      this.flag(this.def, block.foul, block.by, 'accepted', block.yards);
      this.log(
        `${short(p)} punts ${gross} yards${note}. ${short(pr)} returns to the ${this.spot(block.at, this.def)}. PENALTY on ${this.flagged(this.def, block.by)}: ${FOULS[block.foul].label}, ${block.yards} yards. Ball at the ${this.spot(end, this.def)}.`,
      );
    } else
      this.log(
        `${short(p)} punts ${gross} yards${note}. ${short(pr)} returns ${ret} yards to the ${this.spot(end, this.def)}.`,
      );
    this.changePossession(end);
  }

  private fieldGoal() {
    const off = this.lineups[this.offense];
    const def = this.lineups[this.def];
    const k = off.k;
    this.takeSnapshot();
    const flag = this.kickFoul(off, def);
    // A false start: no kick, five yards back, and the coach decides again on the next snap.
    if (flag?.foul === 'falseStart') {
      const spot = enforce('falseStart', this.spotNow());
      this.setAnim(this.offense, 'penalty', this.yardLine, spot.yardLine);
      this.flag(this.offense, 'falseStart', flag.by, 'accepted', spot.yards);
      this.yardLine = spot.yardLine;
      this.clockRunning = false;
      // A dead ball on the last snap of a half: the down was never played.
      if (this.clock <= 0) this.untimed = true;
      this.log(`Field goal try. PENALTY on ${this.flagged(this.offense, flag.by)}: False start, ${spot.yards} yards.`);
      return;
    }
    const distance = 100 - this.yardLine + 17;
    this.playTime(this.rng.int(4, 6));
    const made = this.rng.chance(this.kickMakes(distance, k));
    this.fgWear(off, def);
    if (flag && this.fgPenalty(flag, made, distance)) return;
    const note = flag
      ? `. ${FOULS[flag.foul].label} on ${this.flagged(flag.foul === 'holding' ? this.offense : this.def, flag.by)}, declined`
      : '';
    const buf = new StatBuffer();
    buf.add(k, 'fgAtt');
    this.kickForm(k, made);
    this.setAnim(this.offense, 'fg', this.yardLine - 7, 110, 110);
    if (made) {
      buf.add(k, 'fgMade');
      buf.add(k, 'fgLong', distance);
      this.credit(buf);
      this.addPoints(this.offense, 3);
      this.log(`${short(k)} ${distance}-yard field goal is GOOD${note}.`, true);
      this.endPossession();
      this.clockRunning = false;
      if (this.checkOvertimeEnd()) return;
      this.kickoffBy = this.offense;
      return;
    }
    this.credit(buf);
    this.log(`${short(k)} ${distance}-yard field goal is NO GOOD${note}.`);
    // Defense takes over at the spot of the kick (or the 20, whichever is better).
    this.changePossession(Math.max(20, 100 - (this.yardLine - 7)));
  }

  /**
   * The flags on a field goal or extra point, one roll: a false start or a hold on the kick unit (the line
   * and its wings), offside, running into or roughing the kicker on the block unit (the defense's front).
   */
  private kickFoul(kicking: Lineup, blocking: Lineup): { foul: Foul; by: Player | undefined } | null {
    const { all, holding } = this.calls;
    const kickers = Math.exp(-0.06 * (kicking.fgDiscipline - OL_DISCIPLINE)) * all;
    const blockers = Math.exp(-0.06 * (blocking.blockDiscipline - DL_DISCIPLINE)) * all;
    const odds: [Foul, number][] = [
      ['falseStart', KICK_FALSE_START * kickers],
      ['holding', KICK_HOLDING * kickers * holding],
      ['offside', KICK_OFFSIDE * blockers],
      ['runningIntoKicker', RUNNING_INTO_KICKER * all],
      ['roughingKicker', ROUGHING_KICKER * all],
    ];
    let roll = this.rng.next();
    for (const [foul, p] of odds) {
      if (roll < p) {
        const players =
          foul === 'falseStart' || foul === 'holding' ? kicking.fg : [...blocking.dt, ...blocking.edge, ...blocking.lb];
        const by = players.length
          ? this.flagRng.weighted(players, (x) => Math.max(1, 24 - discipline(x)) * (x.position === 'LB' ? 0.3 : 1))
          : undefined;
        return { foul, by };
      }
      roll -= p;
    }
    return null;
  }

  /** A field goal or extra point: the kick unit and the block unit tire a little and face a quiet kick's risk. */
  private fgWear(kicking: Lineup, blocking: Lineup) {
    for (const p of [...kicking.fg, ...blocking.dt, ...blocking.edge, ...blocking.lb]) {
      const b = this.body(p);
      b.energy -= KICK_SNAP_COST * b.cost;
      b.spent += KICK_SNAP_COST * b.cost;
      this.expose(p, SNAP_RISK * SNAP_EXPOSURE[p.position] * KICK_RISK.quiet * KICK_SNAP_COST, SNAP_CONTACT);
    }
  }

  /**
   * A live-ball flag on a field goal, once the kick is known. A hold on the kick unit costs a good kick (the
   * defense takes the 10 yards and the kick again); the block unit's fouls give a missed kick another go, or
   * the chains. Over a good kick the offense keeps its points, unless the flag brings a first down inside
   * the 10 with time to use it. Returns true when the penalty is taken: the kick is wiped, the down replayed.
   */
  private fgPenalty(flag: { foul: Foul; by: Player | undefined }, made: boolean, distance: number): boolean {
    const kickers = flag.foul === 'holding';
    const side = kickers ? this.offense : this.def;
    const at = this.spotNow();
    const spot = enforce(flag.foul, at);
    const firstDown = spot.down === 1 && (at.down !== 1 || spot.lineToGain !== at.lineToGain);
    const late = (this.quarter === 2 || this.quarter >= 4) && this.clock < 120;
    // In overtime the points are worth more than any first down.
    const take = kickers ? made : !made || (firstDown && 100 - spot.yardLine <= 10 && !late && this.quarter <= 4);
    if (!take) {
      this.flag(side, flag.foul, flag.by, 'declined');
      return false;
    }
    this.flag(side, flag.foul, flag.by, 'accepted', spot.yards);
    this.setAnim(this.offense, 'penalty', at.yardLine, spot.yardLine);
    this.yardLine = spot.yardLine;
    if (firstDown) this.firstDown();
    this.clockRunning = false;
    // A flag on a kick at the gun: the half can't end on it, so the down is played again.
    if (this.clock <= 0 && (this.quarter === 2 || this.quarter >= 4)) this.untimed = true;
    this.log(
      `${short(this.lineups[this.offense].k)} ${distance}-yard field goal is ${made ? 'good' : 'no good'}. PENALTY on ${this.flagged(side, flag.by)}: ${FOULS[flag.foul].label}, ${spot.yards} yards. No play.${this.untimed ? ' Untimed down.' : ''}`,
    );
    return true;
  }

  // ───────────────────────── scrimmage ─────────────────────────

  private scrimmageDown() {
    const offSide = this.offense;
    if (this.clockRunning) {
      const s = this.situation();
      if (coach.playForFieldGoal(s)) {
        // Bleed the clock to the last few seconds, then stop it for a kick at the gun.
        const runoff = this.spotRunoff(this.rng.int(coach.MILK_RUNOFF_MIN, 41));
        const leave = this.rng.int(2, 4);
        // If the next snap would come with too little time for a play and a kick, stop at the gun instead.
        if (s.clock - runoff <= 10) {
          this.preSnapRunoff(Math.max(0, s.clock - leave));
          if (s.offTimeouts > 0) this.useTimeout(offSide);
          else this.clockRunning = false; // the field-goal unit sprints on and snaps in time
        } else {
          this.preSnapRunoff(runoff);
          this.clockRunning = false; // already ran the clock for this snap
        }
      } else if (coach.offenseTimeout(s)) this.useTimeout(offSide);
      else if (
        coach.defenseTimeout(s) ||
        (canStopEarly(s) && this.habits(this.def, 'headCoach').has('stopsTheClock'))
      ) {
        const delay =
          canDeferTimeout(s) &&
          !this.deferredTimeout[this.def] &&
          this.habits(this.def, 'headCoach').has('clingsToTimeouts') &&
          this.habitRng.chance(0.2);
        if (canDeferTimeout(s))
          this.evidence(
            this.def,
            'headCoach',
            'clingsToTimeouts',
            delay,
            delay,
            delay ? 'Held a defensive timeout through another snap late in the game.' : undefined,
          );
        if (delay) {
          this.deferredTimeout[this.def] = true;
          this.log('The sideline holds its timeout for another snap.');
        } else {
          if (s.clock > 180)
            this.evidence(
              this.def,
              'headCoach',
              'stopsTheClock',
              true,
              true,
              'Stopped the clock early to preserve another possession.',
            );
          this.useTimeout(this.def);
        }
      } else if (coach.shouldSpike(s)) return this.spike();
    }
    if (this.clockRunning) {
      const now = this.situation();
      const t = coach.tempo(now);
      let fast = false;
      if (upTempoEligible(now)) {
        fast = this.habits(this.offense, 'offCoord').has('upTempo');
        this.evidence(this.offense, 'offCoord', 'upTempo', fast, fast);
      }
      this.preSnapRunoff(
        this.spotRunoff(
          fast
            ? this.rng.int(...UP_TEMPO_RUNOFF)
            : t === 'hurry'
              ? this.rng.int(8, 16)
              : t === 'milk'
                ? this.rng.int(coach.MILK_RUNOFF_MIN, 41)
                : // 29–39 s between snaps at a normal tempo puts plays a game mid-band (NFL 61–65). It was 27–38
                  // while coaches punted more: the analytics era's fourth-down tries keep drives alive, and at 27
                  // the league ran half a play a team-game more, its fifth-best rushers and receivers over theirs.
                  // 28–38 until 0.4.4: the clock now waits only for the spot after a man goes out of bounds
                  // (`coach.afterOutOfBounds`), and the play that freed up let the stronger side win more often.
                  this.rng.int(29, 39),
        ),
      );
    }
    if (this.clock <= 0 && !this.untimed) return;
    // The untimed down is this one: whatever happens on it, the half ends after (unless the defense fouls again).
    this.untimed = false;

    const s = this.situation();
    if (coach.shouldKneel(s)) return this.kneel();
    if (coach.kickNow(s)) return this.fieldGoal();

    if (this.down === 4) {
      let decision = coach.fourthDown(s, this.rng);
      if (shortGoalDecision(s)) {
        const hc = this.habits(offSide, 'headCoach');
        const adjustment = fourthDownHabit(s, decision, hc, this.habitRng);
        const { takes, backs } = adjustment;
        decision = adjustment.decision;
        this.evidence(
          offSide,
          'headCoach',
          'takesThePoints',
          decision === 'fg',
          takes,
          takes ? 'Chose the comfortable field goal on fourth down near the goal line.' : undefined,
        );
        this.evidence(
          offSide,
          'headCoach',
          'backsHisOffense',
          decision === 'go',
          backs,
          backs ? 'Trusted the offense on fourth down near the goal line.' : undefined,
        );
      }
      const kicker = this.lineups[offSide].k;
      const long = longKickHabit(
        s,
        decision,
        this.habits(offSide, 'headCoach'),
        skill(kicker, 'fieldGoal') >= 14 || this.has(kicker, 'boomerLeg'),
        this.habitRng,
      );
      if (long.eligible) {
        decision = long.decision;
        this.evidence(
          offSide,
          'headCoach',
          'distrustsLongKick',
          decision !== 'fg',
          long.passes,
          long.passes
            ? `Passed on a long field goal and ${decision === 'go' ? 'went for it' : 'punted'} instead.`
            : undefined,
        );
      }
      if (decision === 'punt') return this.punt();
      if (decision === 'fg') return this.fieldGoal();
    }

    if (this.preSnapPenalty()) return;

    this.offenseSnaps[offSide]++;
    const oc = this.habits(offSide, 'offCoord');
    const dc = this.habits(this.def, 'defCoord');
    const calls = habitCalls(s, oc, dc, this.offenseSnaps[offSide]);
    let defCall = coach.defenseCall(s, this.rng);
    const heat = calls.heat && defCall !== 'blitz' && this.habitRng.chance(0.075);
    const coverage = calls.coverage && defCall === 'blitz' && this.habitRng.chance(0.17);
    const crowd = calls.crowdLine && defCall !== 'runD' && this.habitRng.chance(0.06);
    if (heat) defCall = 'blitz';
    if (coverage) defCall = 'passD';
    if (crowd) defCall = 'runD';
    // A prevent shell most snaps, not every one: the frustration is that it shows up when it shouldn't.
    this.preventShell = calls.preventShell && this.habitRng.chance(0.6);
    if (this.preventShell) defCall = 'passD';
    this.callNow = defCall;
    if (calls.prevent) this.evidence(this.def, 'defCoord', 'playsPrevent', this.preventShell, this.preventShell);
    this.disguise = calls.disguise;
    if (calls.obvious) this.evidence(this.def, 'defCoord', 'disguisesCoverages', calls.disguise, calls.disguise);
    if (calls.redZone) this.evidence(this.offense, 'offCoord', 'attacksEndZone', calls.endZoneShot, calls.endZoneShot);
    if (calls.third) {
      this.evidence(this.def, 'defCoord', 'thirdDownHeat', defCall === 'blitz', heat);
      this.evidence(this.def, 'defCoord', 'trustsCoverage', defCall !== 'blitz', coverage);
    }
    if (calls.crowd) this.evidence(this.def, 'defCoord', 'crowdsTheLine', defCall === 'runD', crowd);
    this.designedShot =
      calls.shotEligible && this.shots[offSide] < 2 && oc.has('shotPlayArchitect') && this.habitRng.chance(0.055);
    if (this.designedShot) this.shots[offSide]++;
    this.safePass = calls.safeDepth;
    this.openingWindow = calls.opening;
    this.deepProtection = calls.protectDeep;
    this.endZoneShot = calls.endZoneShot;
    this.pressureBy = null;
    this.passTarget = null;
    this.beatBy = null;
    this.dropOutcome = null;
    this.pocketNow = null;
    this.pocketToday = null;
    const passing = this.rng.chance(clamp(coach.passProbability(s) + calls.passShift, 0, 1)) || this.designedShot;
    const result = passing ? this.passPlay(s, defCall) : this.runPlay(s, defCall);
    if (calls.settling)
      this.evidence(
        offSide,
        'offCoord',
        'settlesForThree',
        !passing || result.depth === 'short',
        oc.has('settlesForThree'),
      );
    if (calls.shell)
      this.evidence(
        offSide,
        'offCoord',
        'goesIntoShell',
        !passing || result.depth === 'short',
        oc.has('goesIntoShell'),
      );
    if (calls.shotEligible)
      this.evidence(
        offSide,
        'offCoord',
        'shotPlayArchitect',
        passing && result.depth === 'deep',
        this.designedShot,
        this.designedShot ? `Designed a deep shot: ${result.text}` : undefined,
        this.designedShot
          ? result.kind === 'sack'
            ? 'ended in a sack'
            : result.kind === 'scramble'
              ? 'became a scramble'
              : result.turnover?.kind === 'int'
                ? 'was intercepted'
                : result.complete
                  ? `produced a ${result.yards}-yard completion`
                  : 'fell incomplete'
          : undefined,
      );
    if (passing && this.offenseSnaps[offSide] <= 6)
      this.evidence(
        offSide,
        'offCoord',
        'scriptedOpening',
        result.complete === true,
        this.openingWindow && result.depth !== undefined,
      );
    if (calls.protect && passing)
      this.evidence(
        this.def,
        'defCoord',
        'protectsDeep',
        result.depth === 'deep',
        calls.protectDeep && result.depth !== undefined,
      );
    if (this.designedShot) result.text = `Designed shot: ${result.text}`;
    // A throw the pocket hasn't played yet (an incompletion, a pick, a throwaway, a catch in the end zone) plays it now.
    if (passing && this.dropOutcome && result.kind === 'pass' && !this.pocketNow) {
      const actors = actorsOf({
        entries: result.stats.entries,
        defender: result.defender,
        rusher: null,
        beat: null,
        take: result.turnover?.by,
      });
      const int = result.turnover?.kind === 'int';
      // As the log keeps it: a pick's spot always (`ranAnim`), a throw's air when it has some.
      const air = int
        ? this.fieldX(this.offense, Math.min(this.yardLine + (result.airYards ?? 0), 100))
        : result.airYards
          ? this.fieldX(this.offense, this.yardLine + result.airYards)
          : undefined;
      this.pocketFor(
        int ? 'int' : result.complete ? 'pass' : 'incomplete',
        {
          ...(air !== undefined ? { air } : {}),
          lane: result.lane ?? 0,
          ...(actors.ball !== undefined ? { ball: actors.ball } : {}),
          ...(actors.cover !== undefined ? { cover: actors.cover } : {}),
          ...(int && actors.take !== undefined ? { take: actors.take } : {}),
        },
        this.dropOutcome,
        {
          ...(result.grounding ? { gr: 1 as const } : {}),
          // A rollout thrown away from a clean pocket: nobody got home, and the film sends nobody.
          ...(this.dropOutcome === 'awayOut' && !this.pressureBy ? { cq: 1 as const } : {}),
        },
      );
    }
    const pocketBy = this.pocketCredit();
    if (this.pressureBy) {
      this.creditPressure(result.stats, this.pressureBy, defCall, false, pocketBy);
      // The log names the man the pocket sent.
      if (pocketBy) this.pressureBy = pocketBy.rusher;
    }
    this.pocketTapNow(result.duration);
    const beforePlays = this.teamStats[offSide].plays;
    const beforeTurnovers = this.teamStats[offSide].turnovers;
    const beforePoints = this.score[offSide];
    const scoreBefore: [number, number] = [this.score[0], this.score[1]];
    const defensiveSide = (1 - offSide) as Side;
    const shotEvent = this.designedShot
      ? this.coachReports
          .find((r) => r.teamId === this.lineups[offSide].team.id && r.role === 'offCoord')
          ?.events.at(-1)
      : undefined;
    this.resolve(result);
    if (this.teamStats[offSide].plays > beforePlays) this.countAdvanced(offSide, s, scoreBefore, result);
    if (
      this.teamStats[offSide].plays > beforePlays &&
      s.quarter >= 4 &&
      (s.overtime || s.clock <= 180) &&
      Math.abs(s.scoreDiff) <= 8
    ) {
      const turnover = this.teamStats[offSide].turnovers > beforeTurnovers;
      const stopped = s.down === 4 && this.offense !== offSide && this.score[offSide] === beforePoints;
      const conceded = defCall === 'blitz' && this.score[offSide] - beforePoints >= 6 && !turnover;
      const outcome = turnover ? 'turnover' : stopped ? 'fourthDownStop' : conceded ? 'touchdownAllowed' : undefined;
      if (outcome) {
        const report = this.coachReport(defensiveSide, 'defCoord');
        if (report) {
          const decisions = (report.defensiveDecisions ??= []);
          let decisionText = result.text;
          for (const player of [result.rusher, result.defender, result.turnover?.by])
            if (player) decisionText = decisionText.replace(short(player), `${player.firstName} ${player.lastName}`);
          const full = (p: Player) => `${p.firstName} ${p.lastName}`;
          if (result.turnover)
            decisionText = `${full(result.turnover.by)} ${result.turnover.kind === 'int' ? 'intercepted the pass' : 'recovered a fumble'}`;
          else if (result.kind === 'sack' && result.rusher) decisionText = `${full(result.rusher)} made the sack`;
          else if (result.kind === 'pass' && !result.complete)
            decisionText = result.brokenUpBy
              ? `${full(result.brokenUpBy)} ${result.batted ? 'batted the pass down' : 'broke up the pass'}`
              : 'the pass fell incomplete';
          else if (conceded)
            decisionText = `the offense scored on a ${result.yards}-yard ${result.kind === 'pass' ? 'pass' : 'run'}`;
          else decisionText = 'the offense finished short of the marker';
          decisions.push({
            quarter: s.quarter,
            clock: s.clock,
            down: s.down,
            distance: s.distance,
            call: defCall,
            outcome,
            text: decisionText,
            marginBefore: -s.scoreDiff,
            marginAfter: this.score[defensiveSide] - this.score[offSide],
          });
          if (decisions.length > 4) decisions.shift();
        }
      }
    }
    if (shotEvent && this.teamStats[offSide].plays === beforePlays)
      shotEvent.outcome = 'was wiped out by an accepted or offsetting penalty';
  }

  /**
   * Before the snap: a false start kills the play; a defender offside lets it run (a free play), and
   * the offense picks the result or the 5 yards once it's over (`callFouls`).
   */
  private preSnapPenalty(): boolean {
    const off = this.offense;
    const roll = this.rng.next();
    // A hard count draws the defense offside (a jumpy lineman most of all), and now and then his own line.
    const hardCount = this.has(this.lineups[off].qb, 'hardCount');
    const pFalseStart =
      FALSE_START *
      Math.exp(-0.06 * (this.lineups[off].offenseDiscipline - OL_DISCIPLINE)) *
      (hardCount ? 1.15 : 1) *
      this.culture[off] *
      this.calls.all;
    const dl = this.lineups[this.def];
    const dlFront = [...dl.dt, ...dl.edge];
    const pOffside =
      OFFSIDE *
      Math.exp(-0.06 * (dl.defenseDiscipline - DL_DISCIPLINE)) *
      (1 + 0.1 * this.count(dlFront, 'firstStep')) *
      (hardCount ? 1.3 : 1) *
      (1 + (hardCount ? 0.3 : 0.08) * this.count(dlFront, 'jumpHappy')) *
      this.culture[this.def] *
      this.calls.all;
    if (roll < pFalseStart) {
      const by = this.committer('falseStart', null);
      const spot = enforce('falseStart', this.spotNow());
      this.takeSnapshot();
      this.setAnim(off, 'penalty', this.yardLine, spot.yardLine);
      this.yardLine = spot.yardLine;
      this.flag(off, 'falseStart', by, 'accepted', spot.yards);
      this.clockRunning = false;
      this.log(`PENALTY on ${this.flagged(off, by)}: False start, ${spot.yards} yards.`);
      return true;
    }
    this.offsideFlag = roll < pFalseStart + pOffside;
    return false;
  }

  private kneel() {
    const qb = this.lineups[this.offense].qb;
    this.takeSnapshot();
    const buf = new StatBuffer();
    if (this.down === 4) {
      // Fourth down: the quarterback rolls out and runs around until the clock hits zero.
      const loss = Math.min(this.rng.int(4, 9), this.yardLine - 1);
      buf.add(qb, 'rushAtt');
      buf.add(qb, 'rushYds', -loss);
      const text = `${short(qb)} rolls out and runs out the clock`;
      this.resolve({ kind: 'kneel', yards: -loss, text, duration: this.clock, clockStops: false, stats: buf });
      return;
    }
    // At the 1 the snap is taken in place: a kneel must never become a safety.
    const loss = Math.min(1, this.yardLine - 1);
    buf.add(qb, 'rushAtt');
    buf.add(qb, 'rushYds', -loss);
    this.resolve({
      kind: 'kneel',
      yards: -loss,
      text: `${short(qb)} kneels.`,
      duration: 2,
      clockStops: false,
      stats: buf,
    });
  }

  /** Out of timeouts: hurry to the line and throw the ball into the turf. Costs a down. */
  private spike() {
    this.preSnapRunoff(this.rng.int(4, 8));
    if (this.clock <= 0) return;
    const qb = this.lineups[this.offense].qb;
    const buf = new StatBuffer();
    buf.add(qb, 'passAtt');
    this.takeSnapshot();
    this.resolve({
      kind: 'spike',
      yards: 0,
      text: `${short(qb)} spikes the ball to stop the clock`,
      duration: this.clock >= 3 ? 1 : 0,
      clockStops: true,
      stats: buf,
      passAttempt: true,
      complete: false,
    });
  }

  /** Weighted pick of the defender who makes the tackle, based on how far the play went. */
  private pickTackler(def: Lineup, yards: number): Player {
    const pool: [Player, number][] = [];
    const add = (ps: Player[], w: number) => ps.forEach((p) => pool.push([p, w * (0.5 + skill(p, 'tackling') / 20)]));
    if (yards <= 2) {
      add(def.dt, 1.1);
      add(def.edge, 1.2);
      add(def.lb, 2.4);
      add(def.s, 0.6);
      add(def.cb, 0.4);
    } else if (yards < 10) {
      add(def.dt, 0.4);
      add(def.edge, 0.6);
      add(def.lb, 2.5);
      add(def.s, 1.4);
      add(def.cb, 1);
    } else {
      add(def.lb, 1);
      add(def.s, 2.5);
      add(def.cb, 2);
    }
    return this.rng.weighted(pool, ([, w]) => w)[0];
  }

  /** Whether he brings a habit, without noting it for All-22: the sideline call reads every habit that could lean it,
   * and film shows only the ones that decided something. */
  private holds(p: Player, q: QuirkId): boolean {
    if (!p.quirks) return false;
    let set = this.quirkSets.get(p.id);
    if (!set) this.quirkSets.set(p.id, (set = new Set(activeQuirks(p))));
    return set.has(q);
  }

  /**
   * Out of bounds (`sideline.ts`): pushed out, stepped out or in bounds, one draw on the game's stream from the play's
   * facts, the same in every game; the open field plays it out. Returns the call and the facts (a stepped-out catch's
   * tackle credit reads them).
   */
  private sideline(
    kind: SidelineKind,
    s: Situation,
    o: { carrier: Player; chaser: Player; lane: number; run: number; free: boolean; gain: number },
  ): { call: SidelineCall; facts: SidelineFacts } {
    const tempo = coach.tempo(s);
    const def = this.lineups[this.def];
    const c = o.carrier;
    const facts: SidelineFacts = {
      kind,
      wide: Math.min(1, Math.abs(o.lane)),
      run: o.run,
      free: o.free,
      // Hurrying, he steps out when it stops the clock; milking, he stays in whenever (a man out still waits for the spot).
      clock: tempo === 'hurry' && this.oobStopsClock() ? 'out' : tempo === 'milk' ? 'in' : 'none',
      shortOfSticks: s.down >= 3 && o.gain < s.distance,
      edge: kind === 'run' && def.edge.length ? Math.max(...def.edge.map((p) => skill(p, 'setEdge'))) : TYPICAL.edge,
      carrier: {
        position: c.position,
        speed: skill(c, 'longSpeed'),
        build: sizeZ(c).w,
        energy: this.body(c).energy,
        hurt: Math.min(3, (c.injuries ?? []).filter((i) => i.season >= this.game.season - 1).length),
        poise: poiseOf(c),
        has: (q) => this.holds(c, q),
      },
      chaser: {
        pursuit: skill(o.chaser, 'pursuit'),
        tackling: skill(o.chaser, 'tackling'),
        has: (q) => this.holds(o.chaser, q),
      },
    };
    return { call: sidelineCall(sidelineOdds(facts), this.rng.next()), facts };
  }

  /** Why he went out (`stepReason`): pushed, or stepping out for the clock, before the hit, or with nothing said. */
  private static outWhy(call: SidelineCall, facts?: SidelineFacts): StepReason | 'pushed' | null {
    if (call === 'pushed') return 'pushed';
    return call === 'stepped' && facts ? stepReason(facts) : null;
  }

  /** The text a play out of bounds ends with, saying why (`OUT_TEXT`). */
  private static outText(call: SidelineCall, facts?: SidelineFacts): string {
    if (call === 'in') return '';
    const why = GameSim.outWhy(call, facts);
    return why === 'pushed' ? OUT_TEXT.pushed : why ? OUT_TEXT[why] : OUT_TEXT.stepped;
  }

  /** The field's facts for a man out of bounds: pushed (1) or stepping out (2), and why he stepped out (`ow`). */
  private static oobFacts(call: SidelineCall, facts?: SidelineFacts): Pick<FieldFacts, 'oob' | 'ow'> {
    if (call === 'in') return {};
    if (call === 'pushed') return { oob: 1 };
    const why = GameSim.outWhy(call, facts);
    return { oob: 2, ...(why === 'clock' ? { ow: 1 as const } : why === 'hit' ? { ow: 2 as const } : {}) };
  }

  /** A man out of bounds, for `npm run dropback`. */
  private outTap(s: Situation, call: SidelineCall, facts?: SidelineFacts): void {
    if (call === 'in') return;
    this.options.endingTap?.({ kind: 'out', down: s.down, toGo: s.distance, why: GameSim.outWhy(call, facts) });
  }

  /** Whether a player brings an established quirk to this game (`quirks.ts`). */
  private has(p: Player | undefined, q: QuirkId): boolean {
    if (!p?.quirks) return false;
    let set = this.quirkSets.get(p.id);
    if (!set) this.quirkSets.set(p.id, (set = new Set(activeQuirks(p))));
    const found = set.has(q);
    // A habit film can show, in play: noted for All-22 (`OpenField.habits`). Reading it draws nothing.
    if (found && FILM_HABITS.has(q)) this.noted.set(`${p.id}:${q}`, [p.id, q]);
    return found;
  }

  /** The film habits `has()` found since `noted` was last cleared (the start of a run or a pass). */
  private noted = new Map<string, [number, QuirkId]>();

  /** A play's open field as written to its result: its rolls and the habits noted, or nothing at all. */
  private openOf(open: OpenField): { open?: OpenField } {
    if (this.noted.size) open.habits = [...this.noted.values()];
    return Object.keys(open).length ? { open } : {};
  }

  // ───────────────────────── the open field (`field/`) ─────────────────────────

  /** Plays the open field spatially, or taps it for parity. */
  private get fielding(): boolean {
    return !!(this.options.field || this.options.fieldTap || this.options.pocketTap);
  }

  /** What the play's log entry will open with (`log`, `takeSnapshot`): a moment says the same. */
  private head(): Pick<FieldMoment, 'quarter' | 'clock' | 'offense' | 'down' | 'distance' | 'yardLine'> {
    const h = this.snapshot ?? {
      quarter: this.quarter,
      clock: this.clock,
      offense: this.lineups[this.offense].team.id,
      down: this.down,
      distance: this.down ? this.distance : 0,
      yardLine: this.yardLine,
    };
    return {
      quarter: h.quarter,
      clock: h.clock,
      offense: h.offense,
      down: h.down,
      distance: h.distance,
      yardLine: h.yardLine,
    };
  }

  /** The facts a scrimmage play's open field starts from: the snap's spot, the front's legs, the clock's wishes. */
  private scrimmageFacts(s: Situation): FieldFacts {
    const tempo = coach.tempo(s);
    return {
      y: this.fieldY,
      ...(this.tired(s) ? { tired: 1 as const } : {}),
      ...(tempo === 'hurry' ? { out: 1 as const } : tempo === 'milk' ? { stay: 1 as const } : {}),
    };
  }

  /**
   * The open field at a moment: the approach and the start (on the play's own streams, never the game's), and with the
   * switch on, what it decided. Null when the field can't start it: the play keeps today's result.
   */
  private openField(m: FieldMoment): { start: FieldStart; result?: FieldResult } | null {
    if (!this.fieldRecord) return null;
    // A catch's or a pick's open field starts from the pocket's frames (one staging for both).
    const pocketStaged = this.pocketNow?.m.index === m.index ? this.pocketNow.staged : undefined;
    const a = approach(m, this.fieldRecord, this.game.homeId, this.gameSeed, pocketStaged);
    if (!a) return null;
    const start = fieldStart(
      a,
      m,
      (id) => {
        const p = this.league.players[id];
        return p ? fieldSkills(p, activeQuirks) : undefined;
      },
      new Rng(`${this.gameSeed}:field:${m.index}:hold`),
    );
    if (!start) return null;
    if (!this.options.field) return { start };
    const result = runField(start, new Rng(`${this.gameSeed}:field:${m.index}`));
    if (this.fieldSnap) noteSkills(this.fieldSnap, start, m.index);
    // The next snap goes down where he did, on the hashes.
    const n = start.players.length;
    const k = start.players.findIndex((p) => p.id === start.carrier);
    const step = Math.min(result.frames.length / (n * 2) - 1, Math.round(result.duration / STEP));
    this.fieldY = Math.round(clamp(result.frames[(step * n + k) * 2 + 1], HASH_LO, HASH_HI) * 100) / 100;
    return { start, result };
  }

  /**
   * A return's moment: the kick from `from` (the kicking side's yards) coming down at `land`, the receiving unit's
   * coaching edge in rating points. A kick's log entry opens with the clock and spot after the return, so a return's
   * moment keeps none of them (the approach doesn't read them on a kick).
   */
  private returnMoment(
    kick: 'kickoff' | 'punt',
    from: number,
    land: number,
    kickingSide: Side,
    receiving: Lineup,
    kicking: Lineup,
    /** Today's return: its yards from the catch, and whether it scored (the owner's call H). */
    to: number,
    td: boolean,
  ): FieldMoment {
    // A coaching point is worth what today's roll gives it, in points of the returner's `returns`.
    const perPoint = kick === 'kickoff' ? 0.6 : 0.5;
    const edge =
      Math.round(
        ((RETURN_COACH[kick === 'kickoff' ? 'kick' : 'punt'] * (receiving.stCoach - kicking.stCoach)) / perPoint) * 100,
      ) / 100;
    return {
      kind: 'return',
      kick,
      index: this.plays.length,
      offense: this.head().offense,
      quarter: 0,
      clock: 0,
      down: 0,
      distance: 0,
      yardLine: 0,
      from: this.fieldX(kickingSide, from),
      air: this.fieldX(kickingSide, land),
      lane: 0,
      call: 'base',
      facts: {
        y: kick === 'kickoff' ? MID : this.fieldY,
        ...(edge ? { edge } : {}),
        to,
        ...(td ? { td: 1 as const } : {}),
      },
    };
  }

  /**
   * A turnover the open field runs back: a pick short of the end zone, or a strip-sack's ball recovered in the field of
   * play. Today's return is its result (the owner's call H): its yards from where the ball changed hands, and whether
   * it scored. Null for any other turnover (a pick in the end zone, a lost fumble after a carry).
   */
  private turnoverFacts(result: PlayResult): FieldFacts | null {
    const t = result.turnover!;
    const pick = t.kind === 'int' && result.kind === 'pass' && t.spot < 100;
    const strip = t.kind === 'fumble' && result.kind === 'sack' && t.spot > 0;
    if (!pick && !strip) return null;
    // From where it changed hands, the goal line is `spot` yards off.
    const td = t.returnYds >= t.spot;
    return { y: this.fieldY, to: td ? t.spot : t.returnYds, ...(td ? { td: 1 as const } : {}) };
  }

  /**
   * The turnover's return on the open field, read off its own log entry just written (`momentOf`, as the replay reads
   * it). With the switch on the entry keeps the facts only if the field could start it; tapped alone it's untouched.
   */
  private turnoverField(index: number, facts: FieldFacts, duration: number) {
    const e = this.plays[index];
    if (!e || !this.fieldRecord) return;
    const m = momentOf(this.options.field ? e : { ...e, field: facts }, this.fieldRecord, index, this.game.homeId);
    const field = m ? this.openField(m) : null;
    if (this.options.field && !field?.result) delete e.field;
    if (m && field)
      this.tap(field, m, {
        yards: facts.to!,
        tackler: null,
        touchdown: !!facts.td,
        outOfBounds: false,
        duration,
      });
  }

  /**
   * Today's out-of-bounds call for a play the open field is about to run (the switch on): today's odds, on the play's
   * own stream so the game's is the same whether the field plays it or not (today's roll is still taken, in its
   * place). The field takes him out at his spot (call H).
   */

  /**
   * The pocket at this dropback (`field/pocketField.ts`), staged blind from the snap and played on the play's own
   * stream; once a play, cached. Whether a pressure is a hit, and whether it (or a sack) is charged to nobody, are rolled
   * on the play's own streams at today's odds (today's credit draws are still taken in their place). Null when the
   * pocket can't play it (a screen, a short line, a staging that fails).
   */
  private pocketFor(
    kind: PocketMoment['kind'],
    o: { air?: number; to?: number; lane: number; ball?: number; cover?: number; take?: number },
    called: PocketOutcome,
    extra: Partial<FieldFacts> = {},
    /** Today's man who got home (a sack's; a pressure's is `pressureBy`). */
    todayBy: Player | null = this.pressureBy,
  ): { m: PocketMoment; staged: StagedPlay; start: PocketStart; result: PocketResult } | null {
    if (this.pocketNow) return this.pocketNow;
    if (!this.fielding || !this.fieldRecord) return null;
    const index = this.plays.length;
    const stream = (k: string) => new Rng(`${this.gameSeed}:field:${index}:${k}`);
    // Today's own credit, read off a copy of its stream (the real draws come after, the same): whether a pressure was a
    // hit, whether it's charged, and to whom. Without today's man, the play's own streams at today's odds.
    const quiet =
      called === 'clean' || called === 'escape' || called === 'awayClean' || (called === 'awayOut' && !!extra.cq);
    const credited = !quiet && todayBy !== null;
    const today = credited
      ? creditDraws(
          new Rng(this.creditRng.getState()),
          this.lineups[this.offense],
          this.lineups[this.def],
          todayBy,
          this.callNow === 'blitz',
          called === 'sack',
          this.passTarget,
        )
      : null;
    const outcome: PocketOutcome =
      called === 'pressure' && (today ? today.hit : stream('hit').chance(QB_HIT_SHARE)) ? 'hit' : called;
    const nb =
      !quiet &&
      (today ? today.unblamed : stream('blame').chance(outcome === 'sack' ? UNBLAMED_SACK : UNBLAMED_PRESSURE));
    const m: PocketMoment = {
      index,
      ...this.head(),
      kind,
      from: this.fieldX(this.offense, this.yardLine),
      ...(o.air !== undefined ? { air: o.air } : {}),
      ...(o.to !== undefined ? { to: o.to } : {}),
      lane: o.lane,
      ...(o.ball !== undefined ? { ball: o.ball } : {}),
      ...(o.cover !== undefined ? { cover: o.cover } : {}),
      ...(o.take !== undefined ? { take: o.take } : {}),
      call: this.callNow ?? 'base',
      ...(this.designedShot ? { shot: 1 as const } : {}),
      facts: {
        y: this.fieldY,
        ...extra,
        pk: outcome,
        ...(nb ? { nb: 1 as const } : {}),
        ...this.pocketAnchor(outcome, nb, todayBy, today ? today.blocker : undefined, stream('spot')),
      },
    };
    const staged = pocketStage(m, this.fieldRecord, this.game.homeId, this.gameSeed);
    const pocket =
      staged &&
      pocketFrom(
        m,
        staged,
        (id) => {
          const p = this.league.players[id];
          return p ? fieldSkills(p, activeQuirks) : undefined;
        },
        this.gameSeed,
      );
    if (!staged || !pocket) return null;
    if (this.options.field && this.fieldSnap) noteSkills(this.fieldSnap, pocket.start, index);
    this.pocketNow = { m, staged: composePocket(staged, pocket), ...pocket };
    return this.pocketNow;
  }

  /**
   * Today's credit as the pocket's anchor: the group of today's man who got home, and the spot of the blocker today's
   * rule charges with him (`blockerFor`, on the play's own stream at today's odds). The field picks the men within them.
   */
  private pocketAnchor(
    outcome: PocketOutcome,
    nb: boolean,
    by: Player | null,
    /** Today's man (`creditDraws`); undefined when there's no today's credit to read. */
    todayBeat: Player | null | undefined,
    rng: Rng,
  ): Partial<FieldFacts> {
    if (!by || outcome === 'clean' || outcome === 'escape') return {};
    const rg = by.position === 'EDGE' ? 'e' : by.position === 'DT' ? 'i' : by.position === 'LB' ? 'l' : 'd';
    if (nb) return { rg };
    const off = this.lineups[this.offense];
    const def = this.lineups[this.def];
    const b = todayBeat === undefined ? blockerFor(off, def, by, this.callNow === 'blitz', rng) : todayBeat;
    if (!b) return { rg };
    const k = off.ol.indexOf(b);
    const n = off.ol.length;
    const bs = k < 0 ? 'b' : k === 0 || k === n - 1 ? 't' : k === 1 || k === n - 2 ? 'g' : 'c';
    // Today's man himself (`bb`): the pocket loses him where he can; his spot when he isn't among its men.
    return { rg, bs, ...(todayBeat ? { bb: todayBeat.id } : {}) };
  }

  /** The pocket's credit, with the switch on: who got home, who lost him, whether he hit him, whether it's charged. */
  private pocketCredit(): { rusher: Player; beat: Player | null; hit: boolean; blamed: boolean } | undefined {
    const pn = this.pocketNow;
    if (!pn || !this.options.field || pn.result.rusher === null) return undefined;
    const rusher = this.league.players[pn.result.rusher];
    if (!rusher) return undefined;
    return {
      rusher,
      beat: pn.result.beat === null ? null : (this.league.players[pn.result.beat] ?? null),
      hit: pn.m.facts.pk === 'hit',
      blamed: !pn.m.facts.nb,
    };
  }

  /** The tap for the dropback just played, once today's credit is in. */
  private pocketTapNow(duration: number) {
    const pn = this.pocketNow;
    if (!pn || !this.options.pocketTap) return;
    const t = this.pocketToday;
    this.options.pocketTap({
      moment: pn.m,
      start: pn.start,
      today: {
        outcome: pn.m.facts.pk!,
        rusher: t?.rusher ?? null,
        beat: t?.beat ?? null,
        hit: t?.hit ?? false,
        blamed: t?.blamed ?? true,
        duration: t?.duration ?? duration,
      },
      ...(this.options.field ? { result: pn.result } : {}),
    });
  }

  /** The play's time with the open field: from the snap to its whistle. */
  private fieldTime(start: FieldStart, result: FieldResult): number {
    const pad = KNOBS.pad + (start.kind === 'catch' ? KNOBS.padCatch : 0);
    return Math.max(3, Math.round(start.t0 + result.duration + pad));
  }

  /** The open field as the log keeps it: the bounce and habits as rolled, the first miss as the broken tackle. */
  private fieldOpen(open: OpenField, result: FieldResult): OpenField {
    const kept: OpenField = {};
    if (open.bounce) kept.bounce = 1;
    const miss = result.misses[0];
    if (miss) kept.broke = { by: miss.by, how: miss.how };
    return kept;
  }

  private tap(field: { start: FieldStart; result?: FieldResult } | null, m: FieldMoment, today: TodayField) {
    if (field && this.options.fieldTap)
      this.options.fieldTap({ moment: m, start: field.start, today, result: field.result });
  }

  /** How many of a unit carry a quirk. */
  private count(players: readonly Player[], q: QuirkId): number {
    let n = 0;
    for (const p of players) if (this.has(p, q)) n++;
    return n;
  }

  /**
   * A unit's quirk with diminishing returns: each teammate who shares it adds 60% of the one before,
   * so a line of five anchors is worth about 2.3 of them, never five. Flags (holding, offside) stay
   * per man in `count`: every lineman can commit his own.
   */
  private stack(players: readonly Player[], q: QuirkId): number {
    return (1 - STACK ** this.count(players, q)) / (1 - STACK);
  }

  private runPlay(s: Situation, defCall: DefenseCall): PlayResult {
    // What the open field held, for All-22 (`OpenField`): the rolls below, and the habits found in play.
    const open: OpenField = {};
    this.noted.clear();
    const off = this.lineups[this.offense];
    const def = this.lineups[this.def];
    const rng = this.rng;
    const buf = new StatBuffer();
    const yardsToGoal = 100 - this.yardLine;

    // Read options for every quarterback, designed runs for the mobile ones and sneaks on a yard to go
    // or at the goal line: NFL quarterbacks take about 15% of their teams' rushing yards (scrambles
    // included) and score about a fifth of the rushing touchdowns.
    const sneak = s.distance <= 1 || yardsToGoal <= 2 ? 0.14 : 0;
    // Even the fastest quarterback is a quarterback: designed runs stop growing past a point.
    const qbRunWeight = 0.025 + sneak + clamp(skill(off.qb, 'scrambling') - 8, 0, 5) * 0.015 + off.scheme.offense.qbRun;
    // Lead backs get about 60% of the carries and the second back spells him, more so as the lead
    // back's carries pile up: on a 35-run day the backup takes a real share (few backs average 22 a game).
    const leadCarries = this.playerStats[off.rbs[0].id]?.rushAtt ?? 0;
    const leadLoad =
      leadCarries <= LEAD_BACK_CARRIES ? 1 : Math.max(0.35, 1 - 0.08 * (leadCarries - LEAD_BACK_CARRIES));
    const rusher = rng.weighted(
      [
        [off.rbs[0], (yardsToGoal <= 5 ? 0.55 : 0.665) * leadLoad],
        // Teams spread goal-line work too, so one back rarely scores 18.
        [off.rbs[1] ?? off.rbs[0], yardsToGoal <= 5 ? 0.4 : 0.255],
        [off.qb, qbRunWeight],
        [off.wrs[0], 0.015],
      ] as [Player, number][],
      ([, w]) => w,
    )[0];
    // Zone schemes stretch to the edge, gap schemes hit it downhill.
    const called = rng.chance(off.scheme.offense.outside);
    // A back who bounces everything takes some inside calls to the edge, where nobody is blocking.
    const bounce = !called && this.has(rusher, 'bouncesExternal') && rng.chance(0.35);
    const outside = called || bounce;
    if (bounce) open.bounce = 1;
    // Near the goal the call is the story: a goal-line front chokes the run, a pass shell gets run on.
    const tight = shrink(yardsToGoal);
    const boxAdj = { base: 0, runD: 1.5, passD: -1.5, blitz: 0.6 }[defCall] * (1 + RED_ZONE_CALL * tight);
    const homeAdj = this.offense === 0 ? this.homeEdge : -this.homeEdge;
    // Weight moves weight at the point of attack: the line's against the front's.
    const mass = 0.5 * massEdge(off.ol, [...def.dt, ...def.edge]);
    const lineDelta = fade(off.runBlock - (def.runStop + boxAdj) + homeAdj + mass, tight);
    const rusherSkill = skill(rusher, outside ? 'outsideRun' : 'insideRun');

    // Outside runs also have to get around the edge defenders.
    const contain = outside ? 0.2 * (def.edgeContain - EDGE_CONTAIN) : 0;
    // The best backs average about a yard a carry more than the league, not three: the line and the
    // defense decide most of a run, the back the rest (NFL rushing leaders run 4.5–5.5 a carry).
    const lean = this.runQuirks(off, def, rusher, outside, bounce, lineDelta, this.tired(s));
    let yards = rng.normal(
      RUN_BASE + 0.25 * lineDelta + 0.1 * (rusherSkill - 12) - contain + lean.mean - RED_ZONE_STACK * tight,
      2.9 + lean.spread,
    );
    // The roll at the line, before the breakaway: the open field starts from it when the run gets past the line.
    const raw = yards;
    if (yards > 4) {
      // Past the line: beat the best linebacker's tackle, then outrun the deep safety.
      const lb = def.lb.reduce<Player | undefined>(
        (best, p) => (!best || skill(p, 'tackling') > skill(best, 'tackling') ? p : best),
        undefined,
      );
      const lbTackle = lb ? skill(lb, 'tackling') : -Infinity;
      // A heavy back runs through a light linebacker's tackle; a light one bounces off a big one.
      const contact = lb ? 2 * sizeEdge(rusher, 'contact', lb) : 0;
      const speed = skill(rusher, 'longSpeed');
      const pBreak = clamp(
        0.2 +
          0.015 * (skill(rusher, 'breakTackles') - lbTackle + contact) +
          0.012 * (speed - skill(def.s[0], 'pursuit')) +
          lean.breakaway,
        0.08,
        0.36,
      );
      if (rng.chance(pBreak)) {
        // Written down for All-22: who missed, and whether the back's size won it.
        if (lb) open.broke = { by: lb.id, how: contact > 0 ? 'size' : 'move' };
        yards += rng.exponential(Math.max(2.5, 5 + 0.25 * (speed - 12)));
        // A back who gets past the safety is often gone (NFL 2021–25: 0.64 runs of 20+ a team-game, 19% of them touchdowns).
        if (rng.chance(clamp(0.18 + 0.008 * (speed - 12), 0.05, 0.3))) {
          yards += rng.exponential(26);
          open.gone = 1;
        }
      }
    }
    // A run stopped at the line is a tackle too: tackles who wrap up hold a short gain short, ones who don't give up
    // the extra yard. Centred on a typical starter, so the league's carries don't move.
    if (yards < 4) yards -= DT_WRAP_PER_POINT * (avgOf(def.dt, (p) => skill(p, 'tackling')) - DT_WRAP);
    yards = Math.round(Math.max(yards, -6));
    // He falls forward: a short gain often gets one more yard.
    if (yards >= -1 && yards <= 3 && this.has(rusher, 'finishesForward') && rng.chance(0.5)) {
      yards++;
      open.forward = 1;
    }
    if (this.yardLine + yards < 0) yards = -this.yardLine;
    const td = yards >= yardsToGoal;
    if (td) yards = yardsToGoal;

    const [dir, lane] = outside ? rng.pick(RUN_OUTSIDE) : rng.pick(RUN_INSIDE);

    // The open field (`field/`): a run the line got past. Today's rolls are all taken first (the tackler too), so the
    // game's stream is the same to here whether the field plays it or not; from here it follows the play's result.
    // Today's tackler, then the sideline call (`sideline.ts`): both before the field, the same in every game.
    const shadow = td ? undefined : this.pickTackler(def, yards);
    const side = shadow
      ? this.sideline('run', s, {
          carrier: rusher,
          chaser: shadow,
          lane,
          run: yards,
          free: !!(open.broke || open.gone),
          gain: yards,
        })
      : null;
    const call: SidelineCall = side?.call ?? 'in';
    let moment: FieldMoment | undefined;
    let field: { start: FieldStart; result?: FieldResult } | null = null;
    if (this.fielding && raw >= 1) {
      const h = this.head();
      moment = {
        kind: 'run',
        index: this.plays.length,
        ...h,
        from: this.fieldX(this.offense, this.yardLine),
        lane,
        ball: rusher.id,
        call: defCall,
        ...(open.bounce ? { bounce: 1 as const } : {}),
        facts: {
          ...this.scrimmageFacts(s),
          z: Math.round(((raw - RUN_BASE) / 2.9) * 1000) / 1000,
          to: yards,
          ...(td ? { td: 1 as const } : {}),
          ...GameSim.oobFacts(call, side?.facts),
        },
      };
      field = this.openField(moment);
    }
    const spatial = field?.result;
    // The owner's call H: the yards are today's; the open field played how he got there, and who brought him down.
    const played = { yards, touchdown: td };
    const gain = played.yards;
    const runOpen = spatial ? this.fieldOpen(open, spatial) : open;
    const facts = spatial ? { field: moment!.facts } : {};
    const today = (tackler: Player | null | undefined, outOfBounds: boolean, duration: number): TodayField => ({
      yards,
      tackler: tackler?.id ?? null,
      touchdown: td,
      outOfBounds,
      duration,
    });

    buf.add(rusher, 'rushAtt');
    buf.add(rusher, 'rushYds', gain);
    buf.add(rusher, 'rushLong', gain);
    let text = `${short(rusher)} rush ${dir} for ${gain === 0 ? 'no gain' : `${gain} yard${Math.abs(gain) === 1 ? '' : 's'}`}`;

    if (played.touchdown) {
      buf.add(rusher, 'rushTd');
      const duration = rng.int(4, 7);
      if (moment) this.tap(field, moment, today(shadow, false, duration));
      return {
        ...this.openOf(runOpen),
        ...facts,
        kind: 'run',
        yards: gain,
        text: `${text}, TOUCHDOWN`,
        duration: spatial ? this.fieldTime(field!.start, spatial) : duration,
        clockStops: true,
        stats: buf,
        lane,
      };
    }

    // The tackle: today's man, or the one the open field put on him (on out of bounds, the man who forced him); none
    // when nobody had him. The scorer credits whoever forced a runner out, pushed or stepped (NFL: every time).
    const tackler = spatial ? (spatial.tackler === null ? null : this.league.players[spatial.tackler]) : shadow;
    if (tackler) {
      buf.add(tackler, 'tackles');
      if (gain < 0) buf.add(tackler, 'tfl');
      text += ` (${short(tackler)})`;
    }

    // On a play out of bounds nothing knocks the ball loose in play: a man who steps out takes no hit, and a ball
    // jarred loose at the sideline goes out with him and stays the offense's.
    const loose = tackler && call === 'in' ? this.contact('run', s, rusher, tackler, def, this.yardLine + gain) : null;
    if (tackler && loose) {
      buf.add(rusher, 'fumbles');
      if (loose.why !== 'own') buf.add(tackler, 'forcedFum');
      text += GameSim.looseText(loose.why, tackler);
      if (loose.lost) {
        const { recoverer, returnYds } = loose.lost;
        buf.add(rusher, 'fumblesLost');
        buf.add(recoverer, 'fumRec');
        const duration = rng.int(4, 7);
        if (moment) this.tap(field, moment, today(shadow, false, duration));
        return {
          ...this.openOf(runOpen),
          ...facts,
          kind: 'run',
          lane,
          yards: gain,
          text: `${text}. FUMBLE, recovered by ${short(recoverer)}`,
          duration: spatial ? this.fieldTime(field!.start, spatial) : duration,
          clockStops: true,
          stats: buf,
          turnover: { kind: 'fumble', spot: this.yardLine + gain, returnYds, by: recoverer },
        };
      }
      text += '. Fumble, recovered by the offense';
    }
    const oob = call !== 'in';
    text += GameSim.outText(call, side?.facts);
    this.outTap(s, call, side?.facts);
    const duration = rng.int(4, 7);
    if (moment) this.tap(field, moment, today(shadow, oob, duration));
    return {
      ...this.openOf(runOpen),
      ...facts,
      kind: 'run',
      yards: gain,
      text,
      duration: spatial ? this.fieldTime(field!.start, spatial) : duration,
      clockStops: oob && this.oobStopsClock(),
      stats: buf,
      lane,
      ...(oob ? { outOfBounds: call } : {}),
    };
  }

  /** What the passer's choice reads off the situation (and the check tallies it by). */
  private dropbackSituation(s: Situation): Pick<DropbackTap, 'down' | 'toGo' | 'toGoal' | 'trailingLate'> {
    return {
      down: s.down,
      toGo: s.distance,
      toGoal: 100 - s.yardLine,
      trailingLate: s.quarter >= 4 && s.clock <= 300 && s.scoreDiff <= -1 && s.scoreDiff >= -16,
    };
  }

  private passPlay(s: Situation, defCall: DefenseCall): PlayResult {
    // What the open field held after a catch, for All-22 (`OpenField`).
    const open: OpenField = {};
    this.noted.clear();
    const off = this.lineups[this.offense];
    const def = this.lineups[this.def];
    const rng = this.rng;
    const qb = off.qb;
    const buf = new StatBuffer();
    const yardsToGoal = 100 - this.yardLine;
    const homeAdj = this.offense === 0 ? this.homeEdge : -this.homeEdge;
    // A quarterback who thrives in the hurry-up is sharper in it.
    const fast = coach.tempo(s) === 'hurry' && this.has(qb, 'noHuddle') ? 2.5 : 0;
    // A rattled quarterback rushes his reads and forces throws into covered windows.
    const ghosts = this.rattled.get(qb.id) ?? 0;
    const decisions = skill(qb, 'decisionMaking') + fast - 3 * ghosts;

    const rushAdj = { base: 0, runD: 0.3, passD: -1, blitz: 2.5 }[defCall];
    // A back who picks up the blitz buys his quarterback time; one who whiffs gets him hit.
    const pickup =
      defCall === 'blitz'
        ? 0.3 * (skill(off.rbs[0], 'passPro') + (this.has(off.rbs[0], 'blitzPickup') ? 5 : 0) - 10)
        : 0;
    const front = [...def.dt, ...def.edge];
    const quirkRush = this.rushQuirks(off, def, s, defCall === 'blitz');
    const pressureDelta =
      def.passRush +
      rushAdj -
      off.passBlock -
      pickup -
      homeAdj -
      off.scheme.offense.release +
      quirkRush +
      // Length on the edge and leverage inside: a short tackle on a speed rusher, a squat tackle under a tall guard.
      rushSizeEdge(off.ol, def.edge, def.dt) +
      // A disguised look buys the rush a beat; a prevent shell rushes three.
      (this.disguise ? 0.6 : 0) -
      (this.preventShell ? 0.8 : 0);
    const pressured = rng.chance(clamp(0.3 + 0.035 * pressureDelta, 0.1, 0.65));

    if (pressured) {
      const pocket = skill(qb, 'pocketPresence') + (this.has(qb, 'muddyPockets') ? 1.5 : 0);
      // A bull rush collapses the pocket rather than finishing: more hurries, fewer of them sacks. A
      // heavy first punch buys the extra beat; a bend around the corner finishes.
      // 0.21 holds an aged league at two sacks a team-game (npm run careers): its veteran passers read the
      // rush well enough that long-run sacks had drifted to 1.97 on main's engine; fresh leagues sit mid-band.
      const pSack =
        clamp(0.21 - 0.022 * (pocket - 12), 0.08, 0.38) *
        (1 - 0.05 * this.stack(front, 'bullRush')) *
        (1 - 0.04 * this.stack(off.ol, 'heavyPunch')) *
        (1 + 0.08 * this.stack(def.edge, 'bendsArc')) *
        (1 + 0.03 * this.stack(off.ol, 'twoTapSet')) *
        (defCall === 'blitz' && this.has(off.rbs[0], 'blitzPickup') ? 0.8 : 1);
      if (rng.chance(pSack)) {
        this.dropOutcome = 'sack';
        this.options.dropbackTap?.({ ...this.dropbackSituation(s), qb: qb.id, pressured: true, call: 'sack' });
        return this.sack(s, def, defCall);
      }
      this.pressureBy = this.creditRng.weighted(rushers(def, defCall === 'blitz'), ([, w]) => w)[0];
    }

    const ordinaryDepth = coach.passDepth(s, rng);
    const depth = this.designedShot
      ? 'deep'
      : this.safePass && ordinaryDepth === 'deep' && this.habitRng.chance(0.1)
        ? 'short'
        : this.endZoneShot && ordinaryDepth === 'short' && this.habitRng.chance(0.12)
          ? 'medium'
          : ordinaryDepth;
    // Targets: [receiver, base weight by depth, coverage defender]
    const lbCover = def.lb[1] ?? def.lb[0];
    const scheme = off.scheme.offense;
    const tw = scheme.targets;
    const times = (w: Record<PassDepth, number>, m: number) => ({
      short: w.short * m,
      medium: w.medium * m,
      deep: w.deep * m,
    });
    const teCover = rng.chance(0.5) ? (def.s[1] ?? def.s[0]) : def.lb[0];
    // Personnel decides who runs routes: 12 swaps the slot receiver for a second tight end, 10 the tight end for a fourth receiver.
    const options: [Player | undefined, Record<PassDepth, number>, Player][] = [
      [off.wrs[0], times({ short: 0.21, medium: 0.27, deep: 0.33 }, tw.wr), def.cb[0]],
      [off.wrs[1], times({ short: 0.17, medium: 0.26, deep: 0.3 }, tw.wr), def.cb[1] ?? def.cb[0]],
      [
        scheme.personnel === '12' ? undefined : off.wrs[2],
        times({ short: 0.14, medium: 0.15, deep: 0.15 }, tw.slot),
        def.cb[2] ?? def.cb[0],
      ],
      scheme.personnel === '10'
        ? [off.wr4, times({ short: 0.14, medium: 0.15, deep: 0.1 }, tw.slot), def.s[1] ?? def.s[0]]
        : [off.tes[0], times({ short: 0.2, medium: 0.21, deep: 0.11 }, tw.te), teCover],
      [off.rbs[0], times({ short: 0.28, medium: 0.07, deep: 0.02 }, tw.rb), lbCover],
      [off.rbs[1], times({ short: 0.09, medium: 0.02, deep: 0 }, tw.rb), def.lb[0]],
      scheme.personnel === '12'
        ? [off.tes[1], times({ short: 0.12, medium: 0.12, deep: 0.08 }, tw.te), def.cb[2] ?? def.lb[0]]
        : [
            scheme.personnel === '10' ? undefined : off.tes[1],
            times({ short: 0.03, medium: 0.02, deep: 0.01 }, tw.te),
            def.lb[0],
          ],
    ];
    const valid = options.filter((o): o is [Player, Record<PassDepth, number>, Player] => !!o[0]);
    // In tight space defenses bracket the top receiver, so red-zone looks spread to the tight end and backs.
    const bracket = yardsToGoal <= 10 ? 0.75 : 1;
    // Better receivers draw more looks, but not so many more that the top five outrun NFL leaders
    // (dome teams' receivers already get a lift from the weather).
    const [receiver, , defender] = rng.weighted(
      valid,
      ([p, w]) => w[depth] * (0.6 + 0.032 * skill(p, 'targeting')) * (p === off.wrs[0] ? bracket : 1),
    );
    const isBack = receiver.position === 'RB';
    this.passTarget = receiver;

    const recvSkill = skill(receiver, depth === 'deep' ? 'deepRoutes' : 'shortRoutes');
    const coverage = def.scheme.coverage;
    // Man coverage puts the matchup on an island (the defender's skill counts for more); zone spreads it.
    const man = !!coverage?.man || defCall === 'blitz';
    const earlyDown = s.down <= 2 && depth !== 'short' && coach.tempo(s) === 'normal';
    let covSkill =
      skill(defender, depth === 'deep' ? 'deepCoverage' : 'coverage') +
      this.coverQuirks(defender, depth, man, earlyDown);
    // Coverage quirks: hips that turn and run, eyes that jump the first break, hips that can't run in man.
    if (depth === 'deep')
      covSkill += (this.has(defender, 'fluidHips') ? 2.5 : 0) - (this.has(defender, 'bitesOnDoubleMoves') ? 3 : 0);
    else if (this.has(defender, 'bitesOnDoubleMoves')) covSkill += 0.5;
    // Man coverage, or the man-to-man a blitz leaves behind it.
    if (man && this.has(defender, 'manDeficit')) covSkill -= 6;
    // With the field shrunk every coverage is an island: the man across from the receiver is the whole defense.
    const tight = shrink(yardsToGoal);
    const island = (coverage ? (coverage.man ? MAN_ISLAND : ZONE_ISLAND) : 0) + RED_ZONE_ISLAND * tight;
    let sep = recvSkill - covSkill - island * (covSkill - 12) + homeAdj + (isBack && depth === 'short' ? 2.5 : 0);
    // Turning to find the ball means losing the man now and then.
    if (this.has(defender, 'playsTheBall')) sep += 0.6;
    // A receiver who sells his stem beats man coverage; one who can't get off the jam doesn't.
    if (man && this.has(receiver, 'stemsDB')) sep += 2.5;
    if (man && depth !== 'deep' && this.has(receiver, 'getsJammed')) sep -= 2.5;
    // At the line in man, weight wins the jam: a light receiver gets rerouted by a big corner.
    if (man && depth !== 'deep') sep += sizeEdge(receiver, 'press', defender);
    if (coverage) sep += coverage.sep[depth === 'short' ? 0 : depth === 'medium' ? 1 : 2];
    if (depth === 'short') sep += scheme.quick;
    // Play action off a run game the defense respects: the linebackers bite and the windows behind them open.
    if (scheme.playAction && earlyDown) sep += scheme.playAction * clamp((off.runBlock - 8) / 4, 0, 1.5);
    // Every offense fakes a handoff now and then: linemen who crash on it leave the window behind them open.
    if (earlyDown)
      sep +=
        0.5 * this.stack(front, 'bitesOnPlayAction') +
        0.7 * this.stack(def.lb, 'misreadsKeys') -
        0.2 * this.stack(def.lb, 'diagnoses');
    // The deep safety closes windows over the top (deep balls always face some help).
    // A quarterback who moves the safety with his eyes takes the help away from a zone.
    const eyes = !man && depth !== 'short' && this.has(qb, 'safetyEyes') ? 3.5 : 0;
    const help = skill(def.s[0], 'deepHelp') - DEEP_HELP - eyes;
    if (depth === 'deep') sep -= 0.93 + 0.35 * help;
    else if (depth === 'medium') sep -= 0.2 * help;
    if (this.designedShot && depth === 'deep') sep += 0.5;
    if (this.openingWindow) sep += 0.25;
    if (this.deepProtection) sep += depth === 'deep' ? -0.3 : depth === 'short' ? 0.15 : 0;
    // Prevent: everything in front of the deep shell is open.
    if (this.preventShell) sep += depth === 'deep' ? -0.5 : depth === 'medium' ? 0.4 : 0.8;
    // Near the goal the call counts for more; a blitz leaves the same man coverage behind it anywhere.
    sep += defCall === 'blitz' ? 1.5 : { base: 0, runD: 0.8, passD: -1.2 }[defCall] * (1 + RED_ZONE_CALL * tight);
    // Defenses roll coverage toward a mismatch, so a receiver far better than his man still gets open
    // but not by a mile: big separation pays less and less (keeps elite seasons inside NFL records).
    if (sep > SEP_ROLL) sep = SEP_ROLL + (sep - SEP_ROLL) * 0.5;
    sep = fade(sep, tight);

    // His read made, he chooses (`pocketChoice.ts`): throw it, throw it away, or take off. One draw.
    const situation = this.dropbackSituation(s);
    const choiceFacts: PocketFacts = {
      pressured,
      sep,
      depth,
      down: situation.down,
      toGo: situation.toGo,
      toGoal: situation.toGoal,
      trailingLate: situation.trailingLate,
      passer: {
        decisions,
        scrambling: skill(qb, 'scrambling'),
        pocket: skill(qb, 'pocketPresence') + (this.has(qb, 'muddyPockets') ? 1.5 : 0),
        poise: poiseOf(qb),
        energy: this.body(qb).energy,
        hurt: Math.min(3, (qb.injuries ?? []).filter((i) => i.season >= this.game.season - 1).length),
        rattled: ghosts,
        has: (q) => this.has(qb, q),
      },
    };
    const choice = pocketCall(pocketOdds(choiceFacts), rng.next());
    if (choice === 'run') {
      this.dropOutcome = pressured ? 'scramble' : 'escape';
      this.options.dropbackTap?.({ ...situation, qb: qb.id, pressured, call: 'run', facts: choiceFacts });
      return this.scramble(def, s);
    }
    if (choice === 'away') {
      // From outside the pocket (rolled out past the tackle) or inside it, and maybe flagged: grounding.
      const outside = rng.chance(outsideOdds(choiceFacts));
      const grounded = rng.chance(Math.min(1, groundingOdds(pressured, outside) * this.calls.all));
      this.dropOutcome = outside ? 'awayOut' : pressured ? 'away' : 'awayClean';
      this.options.dropbackTap?.({
        ...situation,
        qb: qb.id,
        pressured,
        call: 'away',
        outside,
        grounded,
        facts: choiceFacts,
      });
      buf.add(qb, 'passAtt');
      return {
        kind: 'pass',
        yards: 0,
        text: `${short(qb)} ${outside ? 'rolls out and throws it away' : pressured ? 'under pressure, throws it away' : 'throws it away'}`,
        duration: rng.int(4, 6),
        clockStops: true,
        stats: buf,
        passAttempt: true,
        complete: false,
        airYards: 0,
        depth: 'short',
        // Thrown from his drop, about 7 yards back; rolled out, near the line.
        ...(grounded ? { grounding: { back: outside ? 2 : 7 } } : {}),
      };
    }
    // A throw: clean, or under pressure (a hit or a hurry: the pocket's own roll, `pocketFor`).
    this.dropOutcome = pressured ? 'pressure' : 'clean';
    this.options.dropbackTap?.({ ...situation, qb: qb.id, pressured, call: 'throw', facts: choiceFacts });

    // Every point of accuracy counts in full: no cap on what an elite passer can do.
    const acc =
      skill(qb, depth === 'short' ? 'shortAccuracy' : depth === 'medium' ? 'midAccuracy' : 'deepAccuracy') +
      fast -
      1.5 * ghosts +
      // Over the middle and downfield a short passer throws through his own line; a tall one sees over it.
      (depth === 'short' ? 0 : sizeEdge(qb, 'lanes'));
    const air = passAir(rng, depth, isBack, this.yardLine, yardsToGoal);

    // Base odds are tuned with injuries on: backups throw and catch about a tenth of the passes, as in the NFL.
    // The red zone's squeeze takes about a point off the league's rate, and short throws elsewhere give most of it back.
    // By depth as the NFL completes them (nflverse 2019–24: 81% behind the line, 70% at 0–9, 55% at 10–19, 36% deep),
    // before the passer, the separation and the hands. Those shares count throwaways (nflverse gives them air yards: 4%
    // of attempts, FTN 2023–24) and a throw here is never one, so each sits 1.5 points higher (NFL completion without
    // throwaways 67.2–68.0% against 64.5–65.3% with them).
    let pComplete =
      (depth === 'short' && air < 0 ? 0.825 : { short: 0.755, medium: 0.555, deep: 0.386 }[depth]) +
      0.018 * (acc - 12) +
      0.019 * sep +
      0.012 * (skill(receiver, 'hands') - 12);
    if (pressured) pComplete -= 0.17 - 0.01 * (decisions - 12);
    // A gunslinger who threw it rather than throw it away forces it into coverage.
    if (pressured && this.has(qb, 'gunslinger')) pComplete -= 0.1;
    // The field shrinks: no room behind the coverage, and less underneath.
    pComplete -= RED_ZONE_SQUEEZE * tight;
    if (yardsToGoal < 20 && air >= yardsToGoal) pComplete -= END_ZONE_THROW;
    if (depth === 'deep' && this.has(receiver, 'goesUpForIt')) pComplete += 0.04;
    else if (depth !== 'deep' && this.has(receiver, 'hearsFootsteps')) pComplete -= 0.04;
    // Contested balls: hands shown late win them, hands that trap against the body don't.
    if (sep < 1) pComplete += this.contested(receiver, defender);
    pComplete -= WEATHER_PASS[depth] * this.wx.pass;
    pComplete = clamp(pComplete, 0.05, 0.95);

    // Picks by depth as the NFL throws them (nflverse 2019–24: 0.8% behind the line, 1.4% at 0–9, 3.4% at 10–19, 6.3%
    // deep), before the passer's eyes and arm and the coverage's hands.
    const pInt =
      (depth === 'short' && air < 0 ? 0.0065 : { short: 0.0113, medium: 0.0245, deep: 0.0422 }[depth]) *
      Math.exp(
        -0.07 * (decisions - 12) -
          0.05 * (acc - 12) +
          0.065 *
            (skill(defender, 'ballSkills') +
              this.ballHawk(defender, !coverage?.man, depth) +
              (sep < 1 ? sizeEdge(defender, 'contested', receiver) : 0) -
              8) -
          0.05 * sep +
          // A ball-hawking safety lurks over the top.
          (depth === 'short' ? 0 : 0.05 * (skill(def.s[0], 'ballSkills') - 12)),
      ) *
      (pressured ? 1.6 : 1) *
      (coverage?.ints ?? 1) *
      this.riskyThrow(qb, receiver, depth, !coverage?.man) *
      this.undercut(def, depth, !coverage?.man) *
      (this.disguise ? 1.15 : 1);

    const [sideLabel, lane] = rng.pick(PASS_LANES);
    const depthLabel = `${depth} ${sideLabel}`;
    buf.add(qb, 'passAtt');
    buf.add(receiver, 'targets');
    const duration = rng.int(5, 8);
    const base = {
      kind: 'pass' as const,
      passAttempt: true,
      airYards: air,
      depth,
      duration,
      stats: buf,
      lane,
      defender,
    };

    const roll = rng.next();
    // Who gets to the ball (`defendedPass.ts`): the cover man first, else a group the throw's depth points to; a lineman
    // only at the line, batting it down or tipping it up.
    const band = depthBand(air);
    const onField: OnField = { CB: def.cb, S: def.s, LB: def.lb, DL: [...def.dt, ...def.edge] };
    if (roll < pInt) {
      const batter = pickBatter(onField.DL, this.pressureBy, rng.next());
      const catcher = pickCatcher(band, defender, onField, batter, rng.next(), rng.next());
      // Tipped at the line: the man in the lane caught it (whatever his position, he's playing on the line).
      const tipped = catcher === batter;
      buf.add(qb, 'passInt');
      buf.add(catcher, 'defInt');
      const pd = rng.chance(PICK_PD);
      if (pd) buf.add(catcher, 'passDef');
      // Tipped at the line, it changes hands there; a pick in the end zone is a touchback, run back no yard.
      const spot = pickSpot(this.yardLine, air, tipped);
      const returnYds = spot >= 100 ? 0 : pickReturn(band, spot, rng.next());
      this.options.defendedTap?.({
        band,
        outcome: 'pick',
        by: catcher.id,
        group: groupIn(onField, catcher),
        batted: tipped,
        returnYds,
        pickSix: spot < 100 && returnYds >= spot,
        endZone: spot >= 100,
        pd,
      });
      return {
        ...base,
        ...(tipped ? { airYards: spot - this.yardLine } : {}),
        yards: 0,
        complete: false,
        clockStops: true,
        text: `${short(qb)} pass ${depthLabel} intended for ${short(receiver)}${tipped ? ', tipped at the line,' : ''} INTERCEPTED by ${short(catcher)}`,
        turnover: { kind: 'int', spot, returnYds, by: catcher },
      };
    }

    if (roll >= pInt + pComplete) {
      let text = `${short(qb)} pass ${depthLabel} to ${short(receiver)} incomplete`;
      let brokenUpBy: Player | undefined;
      let batted = false;
      if (rng.chance(breakupRate(band))) {
        const batter = pickBatter(onField.DL, this.pressureBy, rng.next());
        brokenUpBy = breakupBy(band, defender, onField, batter, rng.next(), rng.next());
        batted = brokenUpBy === batter;
        buf.add(brokenUpBy, 'passDef');
      }
      if (brokenUpBy)
        text += batted ? `, batted down at the line by ${short(brokenUpBy)}` : `, broken up by ${short(brokenUpBy)}`;
      this.options.defendedTap?.({
        band,
        outcome: brokenUpBy ? 'breakup' : 'none',
        ...(brokenUpBy ? { by: brokenUpBy.id, group: groupIn(onField, brokenUpBy) } : {}),
        batted,
      });
      return {
        ...base,
        yards: 0,
        complete: false,
        clockStops: true,
        text,
        ...(brokenUpBy ? { brokenUpBy } : {}),
        ...(batted ? { batted } : {}),
      };
    }

    // Completion.
    let gain: number;
    let tackler: Player | null = null;
    if (air >= yardsToGoal) {
      gain = yardsToGoal;
    } else {
      tackler = rng.chance(0.6) ? defender : this.pickTackler(def, air + 4);
      const yacSkill =
        skill(receiver, 'afterCatch') - skill(tackler, 'tackling') + sizeEdge(receiver, 'contact', tackler);
      // Room after the catch by where it's made, as the NFL's catchers find it (nflverse 2019–24: 9.1 yards behind the
      // line, 4.2 at 0–9, 3.7 at 10–19, 5.6 deep), before the catcher and the tackler.
      let yac = Math.max(
        0,
        rng.normal(
          (depth === 'short' && air < 0 ? screenRoom(tight) : { short: 3.6, medium: 3.2, deep: 6 }[depth]) +
            0.3 * yacSkill +
            this.afterCatch(receiver, tackler, depth),
          3,
        ),
      );
      // Most catches are tackled where they're made and a few break into the open and go a long way (NFL
      // 2021–25: 15% of 20+ yard completions score, and three passing touchdowns in ten come from 21 yards or more).
      if (rng.chance(clamp((0.05 + 0.009 * yacSkill) * (coverage?.yac ?? 1), 0.01, 0.08))) {
        yac += rng.exponential(22);
        // Written down for All-22: he broke the man who'd have tackled him, by size or by a move.
        open.broke = { by: tackler.id, how: sizeEdge(receiver, 'contact', tackler) > 0 ? 'size' : 'move' };
      }
      gain = Math.min(air + Math.round(yac), yardsToGoal);
    }

    // The open field (`field/`) after a catch short of the goal line: today's rolls are all in, the field takes it from
    // the catch.
    const todayGain = gain;
    const shadow = tackler;
    let moment: FieldMoment | undefined;
    let field: { start: FieldStart; result?: FieldResult } | null = null;
    // The sideline call (`sideline.ts`) before the field, the same in every game; a touchdown has none.
    const side =
      gain < yardsToGoal && tackler
        ? this.sideline('catch', s, {
            carrier: receiver,
            chaser: tackler,
            lane,
            run: gain - air,
            // Nobody near: he broke the tackle, or caught it well clear of his man (`sep`, in rating points).
            free: !!open.broke || sep >= FREE_SEP,
            gain,
          })
        : null;
    const call: SidelineCall = side?.call ?? 'in';
    if (this.fielding && air < yardsToGoal) {
      // The pocket first: the catch's open field starts from where it left everyone.
      if (this.dropOutcome)
        this.pocketFor(
          'pass',
          {
            ...(air ? { air: this.fieldX(this.offense, this.yardLine + air) } : {}),
            lane,
            ball: receiver.id,
            cover: defender.id,
          },
          this.dropOutcome,
        );
      const h = this.head();
      moment = {
        kind: 'catch',
        index: this.plays.length,
        ...h,
        from: this.fieldX(this.offense, this.yardLine),
        // A catch at the line logs no air (`resolve`'s `airAt`): the moment says the same.
        ...(air ? { air: this.fieldX(this.offense, this.yardLine + air) } : {}),
        lane,
        ball: receiver.id,
        cover: defender.id,
        // The man who got to him, as the log names him: the pocket's with the switch on.
        ...((this.pocketCredit()?.rusher ?? this.pressureBy)
          ? { rush: (this.pocketCredit()?.rusher ?? this.pressureBy)!.id }
          : {}),
        call: defCall,
        ...(this.designedShot ? { shot: 1 as const } : {}),
        facts: {
          ...this.scrimmageFacts(s),
          to: gain,
          ...(gain >= yardsToGoal ? { td: 1 as const } : {}),
          ...GameSim.oobFacts(call, side?.facts),
          // The pocket it came out of, as the log keeps it (with the switch on).
          ...(this.options.field && this.pocketNow
            ? (({ pk, nb, rg, bs, bb }) => ({
                pk,
                ...(nb ? { nb } : {}),
                ...(rg ? { rg } : {}),
                ...(bs ? { bs } : {}),
                ...(bb !== undefined ? { bb } : {}),
              }))(this.pocketNow.m.facts)
            : {}),
        },
      };
      field = this.openField(moment);
    }
    const spatial = field?.result;
    // The owner's call H: today's yards; the open field's tackler (on out of bounds, the man who forced him), none when
    // nobody had him.
    if (spatial) tackler = spatial.tackler === null ? null : this.league.players[spatial.tackler];
    const catchOpen = spatial ? this.fieldOpen(open, spatial) : open;
    const facts = spatial ? { field: moment!.facts } : {};
    const timed = spatial ? { duration: this.fieldTime(field!.start, spatial) } : {};
    const today = (outOfBounds: boolean): TodayField => ({
      yards: todayGain,
      tackler: shadow?.id ?? null,
      touchdown: todayGain >= yardsToGoal,
      outOfBounds,
      duration,
    });
    const td = gain >= yardsToGoal;
    buf.add(qb, 'passCmp');
    buf.add(qb, 'passYds', gain);
    buf.add(receiver, 'rec');
    buf.add(receiver, 'recYds', gain);
    buf.add(receiver, 'recLong', gain);
    let text = `${short(qb)} pass ${depthLabel} to ${short(receiver)} for ${gain} yard${Math.abs(gain) === 1 ? '' : 's'}`;
    if (td) {
      buf.add(qb, 'passTd');
      buf.add(receiver, 'recTd');
      if (moment) this.tap(field, moment, today(false));
      return {
        ...base,
        ...this.openOf(catchOpen),
        ...facts,
        ...timed,
        yards: gain,
        complete: true,
        clockStops: true,
        text: `${text}, TOUCHDOWN`,
      };
    }
    if (!spatial && this.yardLine + gain <= 0) gain = -this.yardLine;
    // A catch he stepped out on credits a tackle only when someone forced it (NFL: half of them).
    if (call === 'stepped' && tackler && !rng.chance(steppedCredit(side!.facts))) tackler = null;
    if (tackler) {
      buf.add(tackler, 'tackles');
      text += ` (${short(tackler)})`;
    }

    // On a play out of bounds nothing knocks the ball loose in play (as on a run).
    const loose =
      tackler && call === 'in' ? this.contact('catch', s, receiver, tackler, def, this.yardLine + gain) : null;
    if (tackler && loose) {
      buf.add(receiver, 'fumbles');
      if (loose.why !== 'own') buf.add(tackler, 'forcedFum');
      text += GameSim.looseText(loose.why, tackler);
      if (loose.lost) {
        const { recoverer, returnYds } = loose.lost;
        buf.add(receiver, 'fumblesLost');
        buf.add(recoverer, 'fumRec');
        if (moment) this.tap(field, moment, today(false));
        return {
          ...base,
          ...this.openOf(catchOpen),
          ...facts,
          ...timed,
          yards: gain,
          complete: true,
          clockStops: true,
          text: `${text}. FUMBLE, recovered by ${short(recoverer)}`,
          turnover: { kind: 'fumble', spot: this.yardLine + gain, returnYds, by: recoverer },
        };
      }
      text += '. Fumble, recovered by the offense';
    }
    const oob = call !== 'in';
    text += GameSim.outText(call, side?.facts);
    this.outTap(s, call, side?.facts);
    if (moment) this.tap(field, moment, today(oob));
    return {
      ...base,
      ...this.openOf(catchOpen),
      ...facts,
      ...timed,
      yards: gain,
      complete: true,
      clockStops: oob && this.oobStopsClock(),
      text,
      ...(oob ? { outOfBounds: call } : {}),
    };
  }

  /** Ball-skill points a defender's quirks add: a zone hawk in zone, a ball hawk anywhere, a baiter on short throws. */
  private ballHawk(defender: Player, zone: boolean, depth: PassDepth): number {
    return (
      (zone && this.has(defender, 'zoneHawk') ? 5 : 0) +
      (this.has(defender, 'playsTheBall') ? 4 : 0) +
      (depth === 'short' && this.has(defender, 'baitsQB') ? 9 : 0)
    );
  }

  /** A kick that counts: fourth quarter or overtime, within one score. */
  private clutch(): boolean {
    return this.quarter >= 4 && Math.abs(this.score[this.offense] - this.score[this.def]) <= 8;
  }

  /**
   * A field goal's mark on a kicker's form. A clutch make earns an ice-water marble and ends a slump;
   * a kicker with the yips loses his nerve for the game on any miss, and a clutch miss (or a second
   * miss) starts a slump that carries into the coming weeks.
   */
  private kickForm(k: Player, made: boolean) {
    const out = (this.formOut[k.id] ??= {});
    if (made) {
      if (!this.clutch()) return;
      out.clutch = true;
      if (this.slumping.delete(k.id)) out.slump = 'end';
      return;
    }
    if (!this.has(k, 'yips')) return;
    this.slumping.add(k.id);
    const misses = (this.misses.get(k.id) ?? 0) + 1;
    this.misses.set(k.id, misses);
    if (this.clutch() || misses >= 2) out.slump = 'start';
  }

  /** A rattled quarterback settles after three straight completions, about half the time. */
  private settle(qb: Player, complete: boolean) {
    if (!this.rattled.has(qb.id)) return;
    const run = complete ? (this.streak.get(qb.id) ?? 0) + 1 : 0;
    this.streak.set(qb.id, run);
    if (run >= 3) {
      this.streak.set(qb.id, 0);
      if (this.rng.chance(0.5)) this.rattled.delete(qb.id);
    }
  }

  /** A defensive line tires on long drives and against the hurry-up. */
  private tired(s: Situation): boolean {
    return coach.tempo(s) === 'hurry' || this.driveSnaps >= LONG_DRIVE;
  }

  /**
   * Pressure the linemen's, backers' and passer's quirks add (ratings points on the rush): first steps,
   * bull rushes and second moves on one side; anchors, stunt calls and quick sets on the other. Feet
   * and waists only show against rushers fast or slippery enough to punish them.
   */
  private rushQuirks(off: Lineup, def: Lineup, s: Situation, blitz: boolean): number {
    const front = [...def.dt, ...def.edge];
    const speed = pull(unitAvg(def.edge, 'longSpeed'));
    const moves = pull(unitAvg(def.edge, 'edgeRush'));
    const power = pull(unitAvg(def.dt, 'interiorRush'));
    let d =
      0.35 * this.stack(front, 'firstStep') + 0.3 * this.stack(front, 'bullRush') - 0.35 * this.stack(off.ol, 'anchor');
    if (s.down === 3 && s.distance >= 7) d += 0.5 * this.stack(front, 'planAdjuster');
    if (this.tired(s)) d -= 0.4 * this.stack(front, 'gassed');
    if (blitz)
      d +=
        0.7 * (this.stack(off.ol, 'lungesAtStunts') - this.stack(off.ol, 'stuntCommunicator')) +
        0.7 * this.stack(def.lb, 'greenDog');
    d += 0.35 * this.stack(off.ol, 'waistBender') * moves + 0.35 * this.stack(off.ol, 'heavyFeet') * speed;
    d += this.stack(off.ol, 'twoTapSet') * (0.2 * power - 0.35 * speed);
    if (this.has(off.qb, 'patsTheBall')) d += 0.3;
    return d;
  }

  /**
   * A run's lean from everyone's quirks: `mean` yards, extra `spread`, and the change in the odds of
   * breaking into the open. Swing quirks (a back hunting the home run, a lineman chasing pancakes, a
   * linebacker shooting gaps) widen the spread and cost a little on the typical carry.
   */
  private runQuirks(
    off: Lineup,
    def: Lineup,
    rusher: Player,
    outside: boolean,
    bounce: boolean,
    lineDelta: number,
    tired: boolean,
  ) {
    const front = [...def.dt, ...def.edge];
    const dbs = [...def.cb, ...def.s];
    const has = (q: QuirkId) => (this.has(rusher, q) ? 1 : 0);
    const ol = (q: QuirkId) => this.stack(off.ol, q);
    const dl = (q: QuirkId) => this.stack(front, q);
    const lb = (q: QuirkId) => this.stack(def.lb, q);
    let mean = -0.1 * has('dwellsInHole') - 0.03 * ol('pancakePreacher') - 0.05 * lb('gapShooter');
    let spread = 0.6 * has('dwellsInHole') + 0.25 * ol('pancakePreacher') + 0.4 * lb('gapShooter');
    let breakaway = 0;
    // The back.
    if (has('patientPresser')) mean += 0.2 + 0.05 * lineDelta;
    if (bounce) {
      mean -= 0.5;
      spread += 0.5;
    }
    mean -= 0.1 * has('jumpCutter') + 0.2 * has('contactAverse');
    spread += 0.4 * has('jumpCutter');
    breakaway += 0.015 * has('jumpCutter') + 0.015 * has('highKnee') - 0.04 * has('contactAverse');
    // The line.
    if (lineDelta > 0) mean += 0.2 * ol('finishedToDirt');
    if (!outside) mean -= 0.15 * ol('pullsSoft');
    breakaway += 0.02 * ol('secondLevel');
    // The front.
    mean += -0.08 * dl('battenDown') + 0.12 * dl('armTackler') + (tired ? 0.15 * dl('gassed') : 0);
    if (!outside) mean += -0.1 * dl('unblockable') + 0.12 * this.stack(def.edge, 'bendsArc');
    breakaway -= 0.015 * dl('highMotor');
    // The second level and the secondary.
    mean +=
      -0.08 * lb('diagnoses') +
      0.15 * lb('slowFlow') +
      0.25 * lb('stuckOnBlocks') * clamp((off.runBlock - 10) / 3, 0, 1.5);
    if (outside) mean -= 0.15 * lb('scraper') + 0.1 * this.stack(dbs, 'alleyCrusher');
    // A thumper stops the carrier where he meets him: less after contact on every run, and fewer breakaways.
    mean -= 0.08 * lb('thumper');
    breakaway -= 0.012 * lb('thumper');
    return { mean, spread, breakaway };
  }

  /** Coverage points a defender's quirks add, by depth and look. */
  private coverQuirks(defender: Player, depth: PassDepth, man: boolean, earlyDown: boolean): number {
    let c = 0;
    if (man && depth !== 'deep' && this.has(defender, 'physicalJammer')) c += 3;
    if (depth === 'short' && this.has(defender, 'baitsQB')) c -= 0.5;
    // Short zone throws are his; beyond them he gives up less than he takes away. At −2.5 the net fell to the
    // effect audit's floor (z −2.0) once fourth-down tries and quicker tempos changed the throws he sees.
    if (!man && this.has(defender, 'spotDrop')) c += depth === 'short' ? 3 : -1.5;
    if (this.has(defender, 'offMan')) c += depth === 'deep' ? 1.5 : depth === 'short' ? -1.5 : 0;
    if (earlyDown && this.has(defender, 'peeks')) c -= 2;
    return c;
  }

  /** Completion odds on a contested ball (little separation) from the receiver's and defender's quirks. */
  private contested(receiver: Player, defender: Player): number {
    let p = 0;
    if (this.has(receiver, 'lateHands')) p += 0.04;
    if (this.has(receiver, 'bodyCatcher')) p -= 0.05;
    if (this.has(receiver, 'shortArm')) p -= 0.07;
    if (this.has(defender, 'catchPoint')) p += 0.04;
    // Above the rim: the taller man wins the jump ball, counted like a point of hands.
    return p + 0.012 * sizeEdge(receiver, 'contested', defender);
  }

  /** Yards after the catch the receiver's and tackler's quirks add. */
  private afterCatch(receiver: Player, tackler: Player, depth: PassDepth): number {
    let y = 0;
    if (this.has(receiver, 'yacSlasher')) y += 0.6;
    if (this.has(receiver, 'runsEastWest')) y -= 0.6;
    if (depth === 'short' && this.has(receiver, 'softHands')) y += 1;
    if (this.has(tackler, 'thumper')) y -= 0.8;
    // Big receivers know who won't hit them.
    if (receiver.weightLb >= 225 && this.has(tackler, 'businessDecision')) y += 2;
    return y;
  }

  /**
   * A tackle in bounds (`fumbleOdds.ts`): whether the ball comes out, whether a defender forced it, and why. Draws on the
   * game's stream; taps every tackle for the fumbles check. Null when he held on.
   */
  private contact(
    kind: ContactKind,
    s: Situation,
    carrier: Player,
    tackler: Player,
    def: Lineup,
    spot: number,
  ): { why: FumbleWhy; lost: Lost | null } | null {
    const facts = this.contactFacts(kind, s, carrier, tackler);
    const fumbled = this.rng.chance(fumbleOdds(facts));
    const forced = fumbled ? this.rng.chance(forcedOdds(kind)) : undefined;
    const why: FumbleWhy | undefined = fumbled ? (forced ? fumbleWhy(facts, this.rng.next()) : 'own') : undefined;
    const out = why ? this.loose(kind, !!forced, tackler, def, spot) : null;
    this.options.contactTap?.({
      kind,
      down: facts.down,
      toGo: facts.toGo,
      trailingLate: facts.trailingLate,
      leadingLate: facts.leadingLate,
      carrier: carrier.id,
      fumbled,
      ...(fumbled ? { forced, why, recovery: out!.recovery } : {}),
      facts,
    });
    return why ? { why, lost: out!.lost } : null;
  }

  /** What a tackle in bounds reads (`fumbleOdds.ts`): the play, the hit and the carrier. Draws nothing. */
  private contactFacts(kind: ContactKind, s: Situation, carrier: Player, tackler: Player): ContactFacts {
    const late = s.quarter >= 4 && s.clock <= 300;
    return {
      kind,
      down: s.down,
      toGo: s.distance,
      trailingLate: late && s.scoreDiff < 0,
      leadingLate: late && s.scoreDiff > 0,
      weather: this.wx.fumble,
      carrier: {
        position: carrier.position,
        ballSecurity: skill(carrier, 'ballSecurity'),
        energy: this.body(carrier).energy,
        has: (q) => this.has(carrier, q),
      },
      size: sizeEdge(tackler, 'contact', carrier),
      tackler: { tackling: skill(tackler, 'tackling'), has: (q) => this.has(tackler, q) },
    };
  }

  /** A slide touched down: tapped as a contact that can't fumble, so the fumbles check counts scrambles as the NFL does. */
  private slideTap(s: Situation, carrier: Player, tackler: Player): void {
    const facts = this.contactFacts('scramble', s, carrier, tackler);
    this.options.contactTap?.({
      kind: 'scramble',
      down: facts.down,
      toGo: facts.toGo,
      trailingLate: facts.trailingLate,
      leadingLate: facts.leadingLate,
      carrier: carrier.id,
      fumbled: false,
      slid: true,
      facts,
    });
  }

  /**
   * The loose ball (`looseBall.ts`): who gets it (the defense's share by the play and forced or not), who on the defense
   * is credited (the man who forced it first, else a group, then a man of it on the field), and his return toward a goal
   * line `spot` yards off (reaching it is the touchdown). Draws on the game's stream: the recovery, then two for the man
   * and one for the return, only when the defense has it.
   */
  private loose(
    kind: LooseKind,
    forced: boolean,
    forcer: Player,
    def: Lineup,
    spot: number,
  ): { lost: Lost | null; recovery: Recovery } {
    if (!this.rng.chance(defenseRecovers(kind, forced)))
      return { lost: null, recovery: { lost: false, returnYds: 0, toGoal: spot, td: false, forcerRecovered: false } };
    const onField: Record<Group, Player[]> = { DB: [...def.cb, ...def.s], LB: def.lb, DL: [...def.edge, ...def.dt] };
    const recoverer = pickRecoverer(kind, forced ? forcer : null, onField, this.rng.next(), this.rng.next());
    const group: Group =
      recoverer.position === 'CB' || recoverer.position === 'S' ? 'DB' : recoverer.position === 'LB' ? 'LB' : 'DL';
    const returnYds = returnYards(group, spot, this.rng.next());
    const td = returnYds >= spot;
    return {
      lost: { recoverer, returnYds },
      recovery: { lost: true, group, returnYds, toGoal: spot, td, forcerRecovered: recoverer === forcer && forced },
    };
  }

  /** How the ball came out, as the play says it (`field/fumble.ts` reads it back for the film). */
  private static looseText(why: FumbleWhy, tackler: Player): string {
    return why === 'strip'
      ? `, stripped by ${short(tackler)}`
      : why === 'hit'
        ? ', jarred loose by the hit'
        : why === 'fight'
          ? ', fighting for the extra yard, the ball comes out'
          : ', puts it on the ground';
  }

  /** Linebackers who undercut throws in zone, whoever the ball is meant for. */
  private undercut(def: Lineup, depth: PassDepth, zone: boolean): number {
    return zone && depth !== 'deep' ? 1 + 0.15 * this.stack(def.lb, 'zoneHawk') : 1;
  }

  /** Interception odds from the passer's and the receiver's quirks. */
  private riskyThrow(qb: Player, receiver: Player, depth: PassDepth, zone: boolean): number {
    let m = this.has(qb, 'gunslinger') ? 1.25 : 1;
    if (depth === 'short' && zone && this.has(qb, 'staresDown')) m *= 1.5;
    if (depth === 'deep' && this.has(receiver, 'goesUpForIt')) m *= 0.9;
    return m;
  }

  private sack(s: Situation, def: Lineup, defCall: DefenseCall): PlayResult {
    const qb = this.lineups[this.offense].qb;
    const buf = new StatBuffer();
    // Sacks spread like the NFL's: the starting edges get the most, but the rotation, the
    // linebackers and, on blitzes, the secondary all get home, so one rusher can't take half.
    const sacker0 = this.rng.weighted(rushers(def, defCall === 'blitz'), ([, w]) => w)[0];
    // How far back (`dropbackEnd.ts`): whether he'd left the pocket, then the loss from the NFL's shape for it, the
    // down, the call, the man and the spot; never past his own goal line (reaching it is a safety).
    const lossFacts: SackLossFacts = {
      down: s.down,
      toGo: s.distance,
      yardLine: this.yardLine,
      call: defCall,
      qb: {
        pocketPresence: skill(qb, 'pocketPresence'),
        scrambling: skill(qb, 'scrambling'),
        has: (q) => this.has(qb, q),
      },
    };
    const escaped = this.rng.chance(escapeOdds(lossFacts));
    const loss = sackLoss(lossFacts, escaped, this.rng.next());
    this.options.endingTap?.({
      kind: 'sack',
      down: s.down,
      toGo: s.distance,
      call: defCall,
      escaped,
      loss,
      yardLine: this.yardLine,
      safety: loss >= this.yardLine,
    });
    const duration = this.rng.int(4, 6);
    // Whether the ball comes out (`sackStripOdds`): the rusher's spot and hit, the quarterback, the down and the clock.
    const late = s.quarter >= 4 && s.clock <= 300;
    const strip: SackFacts = {
      down: s.down,
      toGo: s.distance,
      trailingLate: late && s.scoreDiff < 0,
      leadingLate: late && s.scoreDiff > 0,
      weather: this.wx.fumble,
      qb: { ballSecurity: skill(qb, 'ballSecurity'), energy: this.body(qb).energy, has: (q) => this.has(qb, q) },
      rusher: {
        spot: rushSpot(sacker0.position),
        tackling: skill(sacker0, 'tackling'),
        has: (q) => this.has(sacker0, q),
      },
      size: sizeEdge(sacker0, 'contact', qb),
    };
    const fumbled = this.rng.chance(sackStripOdds(strip));
    const forced = fumbled && this.rng.chance(forcedOdds('sack'));
    // Who gets it (`looseBall.ts`), toward a goal line where the ball lies.
    const loose = fumbled ? this.loose('sack', forced, sacker0, def, Math.max(0, this.yardLine - loss)) : null;
    const lost = !!loose?.lost;
    this.options.stripTap?.({
      down: strip.down,
      toGo: strip.toGo,
      trailingLate: strip.trailingLate,
      leadingLate: strip.leadingLate,
      spot: strip.rusher.spot,
      qb: qb.id,
      fumbled,
      ...(fumbled ? { forced, recovery: loose!.recovery } : {}),
      facts: strip,
    });
    // Today's draws are all in (a lost one's recoverer and return below keep their place); with the switch on the
    // pocket plays it (not a strip-sack lost: the turnover's own field takes that ball) and its man has the sack.
    const pocket = lost
      ? null
      : this.pocketFor(
          'sack',
          { to: this.fieldX(this.offense, this.yardLine - loss), lane: 0 },
          'sack',
          escaped ? { ex: 1 } : {},
          sacker0,
        );
    const pocketBy = this.pocketCredit();
    const sacker = pocketBy?.rusher ?? sacker0;
    if (pocket) this.pocketToday = { ...this.pocketToday, rusher: null, beat: null, hit: true, blamed: true, duration };
    buf.add(qb, 'sacked');
    buf.add(qb, 'sackYds', loss);
    buf.add(sacker, 'sacks');
    buf.add(sacker, 'tackles');
    buf.add(sacker, 'tfl');
    this.creditPressure(buf, sacker0, defCall, true, pocketBy);
    // A sack at the line costs nothing: "for 0 yards", as the NFL's books write it.
    let text = `${short(qb)} SACKED by ${short(sacker)} for ${loss ? `-${loss}` : 0} yards`;
    const taken = (this.sacksTaken.get(qb.id) ?? 0) + 1;
    this.sacksTaken.set(qb.id, taken);
    if (taken >= 2 && (this.rattled.get(qb.id) ?? 0) < 1 && this.has(qb, 'seesGhosts')) {
      this.rattled.set(qb.id, 1);
      this.everRattled.add(qb.id);
      this.streak.set(qb.id, 0);
      text += `. ${short(qb)} looks rattled`;
    }
    const at = pocket && this.options.field ? pocket.result.at : null;
    const result: PlayResult = {
      kind: 'sack',
      yards: -loss,
      text,
      // With the switch on, the sack lands when the pocket says (and a pad past the whistle).
      duration: at !== null ? Math.max(3, Math.round(at + KNOBS.padSack)) : duration,
      clockStops: false,
      stats: buf,
      rusher: sacker,
    };
    if (fumbled) {
      buf.add(qb, 'fumbles');
      if (forced) buf.add(sacker, 'forcedFum');
      // His own: he lost it himself, as a carrier does (`field/fumble.ts` reads it back).
      else result.text += GameSim.looseText('own', sacker);
      if (loose?.lost) {
        const { recoverer, returnYds } = loose.lost;
        buf.add(qb, 'fumblesLost');
        buf.add(recoverer, 'fumRec');
        result.text += `. FUMBLE, recovered by ${short(recoverer)}`;
        result.turnover = { kind: 'fumble', spot: this.yardLine - loss, returnYds, by: recoverer };
        result.clockStops = true;
      } else {
        result.text += '. Fumble, recovered by the offense';
      }
    }
    return result;
  }

  /**
   * A rusher got home: credit him, and charge the blocker across from him (spots from `schemes.ts`:
   * the right end rushes the left tackle, the tackles take on the guards and center, an unblocked
   * blitzer is the back's to pick up). A sack is also a pressure and a hit.
   */
  private creditPressure(
    buf: StatBuffer,
    rusher: Player,
    defCall: DefenseCall,
    sack: boolean,
    /** With the switch on, the pocket's man and blocker: credited instead, today's draws still taken (with today's man). */
    field?: { rusher: Player; beat: Player | null; hit: boolean; blamed: boolean },
  ) {
    const off = this.lineups[this.offense];
    const def = this.lineups[this.def];
    const {
      hit: hitToday,
      unblamed,
      blocker: blockerToday,
    } = creditDraws(this.creditRng, off, def, rusher, defCall === 'blitz', sack, this.passTarget);
    if (this.pocketNow)
      this.pocketToday = {
        ...this.pocketToday,
        rusher: rusher.id,
        beat: blockerToday?.id ?? null,
        hit: hitToday,
        blamed: !unblamed,
      };
    const by = field?.rusher ?? rusher;
    const hit = field ? sack || field.hit : hitToday;
    const blocker = field ? (field.blamed ? field.beat : null) : blockerToday;
    buf.add(by, 'pressures');
    if (hit) buf.add(by, 'qbHits');
    if (!blocker) return;
    this.beatBy = blocker;
    buf.add(blocker, 'pressuresAllowed');
    if (hit) buf.add(blocker, 'hitsAllowed');
    if (sack) buf.add(blocker, 'sacksAllowed');
  }

  private scramble(def: Lineup, s: Situation): PlayResult {
    const qb = this.lineups[this.offense].qb;
    const buf = new StatBuffer();
    const speed = skill(qb, 'scrambling');
    // Scrambles find open grass: the NFL's average about seven yards.
    // An edge rusher who loses contain opens the lane; one who never stops chasing closes it late.
    const front = [...def.dt, ...def.edge];
    let yards = this.rng.normal(6 + 0.35 * Math.min(speed - 9, 5) + 1.2 * this.stack(front, 'losesContainment'), 3.5);
    if (yards > 6 && this.rng.chance((0.15 + 0.015 * (speed - 12)) * (1 - 0.15 * this.stack(front, 'highMotor'))))
      yards += this.rng.exponential(10);
    yards = Math.round(Math.max(-3, yards));
    const yardsToGoal = 100 - this.yardLine;
    const td = yards >= yardsToGoal;
    if (td) yards = yardsToGoal;
    buf.add(qb, 'rushAtt');
    buf.add(qb, 'rushYds', yards);
    buf.add(qb, 'rushLong', yards);
    let text = `${short(qb)} scrambles for ${yards} yard${Math.abs(yards) === 1 ? '' : 's'}`;
    const tackler0 = td ? null : this.pickTackler(def, yards);
    const lane = this.rng.pick([-0.9, 0.9]);
    const tdDuration = td ? this.rng.int(5, 8) : 0;
    // The sideline call (`sideline.ts`): a scrambler always heads wide; the clock, his habits and the chase decide.
    const side =
      td || !tackler0
        ? null
        : this.sideline('scramble', s, { carrier: qb, chaser: tackler0, lane, run: yards, free: false, gain: yards });
    const call: SidelineCall = side?.call ?? 'in';
    const oob = call !== 'in';
    // Staying in bounds he slides or fights for it (`dropbackEnd.ts`): the sticks, the score and the clock, the man
    // closing, his legs, habits and makeup. A slider touched down is that man's tackle.
    const late = s.quarter >= 4 && s.clock <= 300;
    const slideFacts: SlideFacts | null =
      td || oob
        ? null
        : {
            down: s.down,
            toGo: s.distance,
            gained: yards,
            scoreDiff: s.scoreDiff,
            late,
            toGoal: yardsToGoal - yards,
            qb: {
              scrambling: speed,
              weightZ: sizeZ(qb).w,
              temperament: temperamentOf(qb),
              poise: poiseOf(qb),
              age: qb.age,
              concussions: concussionCount(qb),
              energy: this.body(qb).energy,
              hurt: Math.min(3, (qb.injuries ?? []).filter((i) => i.season >= this.game.season - 1).length),
              has: (q) => this.holds(qb, q),
            },
            chaser: tackler0
              ? { tackling: skill(tackler0, 'tackling'), has: (q) => this.holds(tackler0, q) }
              : { tackling: TYPICAL.tackling, has: () => false },
          };
    const slide = !!slideFacts && this.rng.chance(slideOdds(slideFacts));
    const touched = slide && this.rng.chance(TOUCHED);
    const slideWhy = slide ? slideReason(slideFacts!) : null;
    const fights = !!slideFacts && !slide && fightsForIt(slideFacts);
    const duration0 = td ? tdDuration : this.rng.int(5, 8);
    // Today's draws are all in. With the switch on (a scramble that crosses the line), the pocket plays the escape and
    // the open field takes him from the line to today's yards; out of bounds or a slide is nobody's tackle.
    const called = this.dropOutcome === 'escape' ? 'escape' : 'scramble';
    const pocket =
      yards >= 1
        ? this.pocketFor('scramble', { lane }, called, {
            ...this.scrimmageFacts(s),
            to: yards,
            ...(td ? { td: 1 as const } : {}),
            ...GameSim.oobFacts(call, side?.facts),
            ...(slide ? { sl: 1 as const, sw: SLIDE_WHY[slideWhy!], ...(touched ? { tc: 1 as const } : {}) } : {}),
          })
        : null;
    let field: { start: FieldStart; result: FieldResult } | null = null;
    if (pocket && this.options.field) {
      const start = scrambleStart(pocket.staged, pocket, pocket.m, (id) => {
        const p = this.league.players[id];
        return p ? fieldSkills(p, activeQuirks) : undefined;
      });
      if (start) {
        const result = runField(start, new Rng(`${this.gameSeed}:field:${pocket.m.index}`));
        if (this.fieldSnap) noteSkills(this.fieldSnap, start, pocket.m.index);
        field = { start, result };
      }
    }
    const tackler = field
      ? field.result.tackler === null
        ? null
        : this.league.players[field.result.tackler]
      : tackler0;
    if (td) {
      buf.add(qb, 'rushTd');
      text += ', TOUCHDOWN';
    } else if (tackler && (!slide || touched)) {
      // Out of bounds credits the man who forced him (NFL: every scramble), pushed or stepped.
      buf.add(tackler, 'tackles');
      text += ` (${short(tackler)})`;
    }
    const duration = field ? this.fieldTime(field.start, field.result) : duration0;
    if (td) return { kind: 'scramble', yards, text, duration, clockStops: true, stats: buf, lane };
    // Tackled in bounds without a slide, the ball can come out (`fumbleOdds.ts`): a lost one turns it over at the spot.
    const loose =
      tackler && !oob && !slide ? this.contact('scramble', s, qb, tackler, def, this.yardLine + yards) : null;
    // A slide counts as the NFL counts every scramble in bounds: a contact that can't fumble.
    const toucher = tackler ?? tackler0;
    if (slide && toucher) this.slideTap(s, qb, toucher);
    if (slideFacts)
      this.options.endingTap?.({
        kind: 'scramble',
        down: s.down,
        toGo: s.distance,
        slid: slide,
        reason: slideWhy ?? (fights ? 'fight' : null),
        tackled: !!tackler && (!slide || touched),
        firstDown: yards >= s.distance,
        leadingLate: late && s.scoreDiff > 0,
        trailingLate: late && s.scoreDiff < 0,
      });
    this.outTap(s, call, side?.facts);
    if (tackler && loose) {
      buf.add(qb, 'fumbles');
      if (loose.why !== 'own') buf.add(tackler, 'forcedFum');
      text += GameSim.looseText(loose.why, tackler);
      if (loose.lost) {
        const { recoverer, returnYds } = loose.lost;
        buf.add(qb, 'fumblesLost');
        buf.add(recoverer, 'fumRec');
        return {
          kind: 'scramble',
          yards,
          text: `${text}. FUMBLE, recovered by ${short(recoverer)}`,
          duration,
          clockStops: true,
          stats: buf,
          lane,
          turnover: { kind: 'fumble', spot: this.yardLine + yards, returnYds, by: recoverer },
        };
      }
      text += '. Fumble, recovered by the offense';
    }
    const ending = oob
      ? GameSim.outText(call, side?.facts)
      : slide
        ? SLIDE_TEXT[slideWhy!]
        : fights && !loose
          ? ', fights for every yard'
          : '';
    return {
      kind: 'scramble',
      yards,
      text: text + ending,
      duration,
      clockStops: oob && this.oobStopsClock(),
      stats: buf,
      lane,
      ...(oob ? { outOfBounds: call } : {}),
    };
  }

  /** Apply a scrimmage play: penalties, clock, stats, and the resulting field state. */
  private resolve(result: PlayResult) {
    const offSide = this.offense;
    const defSide = this.def;
    const ts = this.teamStats[offSide];
    if (!this.snapshot) this.takeSnapshot();
    const downBefore = this.down;
    const startYardLine = this.yardLine;
    if (this.yardLine >= 80) this.markRedZone();
    let text = result.text;
    const airAt = result.passAttempt && result.airYards ? startYardLine + result.airYards : undefined;

    const fouls = this.playFouls(result);
    const warning = this.playTime(result.duration);
    this.driveSnaps++;
    const who = this.actorsFor(result);

    let late: { yardLine: number; text: string } | undefined;
    let ground: (Spot & { text: string }) | undefined;
    if (fouls.length) {
      const call = this.callFouls(result, fouls, this.ranAnim(result, startYardLine, airAt, who));
      // Taken (or offsetting): the play never happened, though the snap still wore the defense down.
      if (call === true) return;
      text += call.note;
      late = call.late;
      ground = call.ground;
    }
    ts.plays++;

    this.credit(result.stats, result.outOfBounds === 'stepped');
    if (result.kind === 'pass' || result.kind === 'spike') {
      ts.passAtt++;
      if (result.complete) {
        ts.passCmp++;
        ts.passYds += result.yards;
      }
      if (result.kind === 'pass') this.settle(this.lineups[offSide].qb, !!result.complete);
    } else if (result.kind === 'sack') {
      ts.sacked++;
      ts.passYds += result.yards;
    } else {
      ts.rushAtt++;
      ts.rushYds += result.yards;
    }
    if (downBefore === 3) ts.thirdDownAtt++;
    if (downBefore === 4) ts.fourthDownAtt++;

    if (result.turnover) {
      ts.turnovers++;
      const { spot, returnYds, by } = result.turnover;
      this.anim = this.ranAnim(result, startYardLine, airAt, who);
      const index = this.plays.length;
      const turned = this.fielding ? this.turnoverFacts(result) : null;
      if (turned && this.options.field) this.anim.field = turned;
      this.log(text);
      if (turned) this.turnoverField(index, turned, result.duration);
      if (spot >= 100 && result.turnover.kind === 'int') {
        this.changePossession(20);
        this.snapshot = null;
        this.log(`Touchback.`);
        return;
      }
      const newYardLine = 100 - spot + returnYds;
      if (newYardLine >= 100) {
        this.endPossession();
        this.offense = defSide;
        const buf = new StatBuffer();
        buf.add(by, 'defTd');
        this.credit(buf);
        this.snapshot = null;
        this.touchdown(defSide, `${short(by)} returns it ${returnYds} yards for a TOUCHDOWN!`);
        return;
      }
      this.changePossession(newYardLine);
      return;
    }

    this.yardLine += result.yards;
    this.clockRunning = !(result.clockStops || warning);
    // Out of bounds outside the late windows: the clock waits for the spot, then runs (`coach.afterOutOfBounds`).
    this.spotted = this.clockRunning && !!result.outOfBounds;
    const kind: PlayKind = result.kind === 'pass' ? (result.complete ? 'pass' : 'incomplete') : result.kind;
    const end = kind === 'incomplete' ? startYardLine : this.yardLine >= 100 ? 102 : this.yardLine;
    this.setAnim(offSide, kind, startYardLine, end, airAt, result.lane, who);
    if (result.open && (kind === 'run' || kind === 'pass')) this.anim!.open = result.open;
    if (result.field) this.anim!.field = result.field;

    if (ground) {
      // Grounding: the incompletion stands, the ball goes back and the down is lost.
      this.yardLine = ground.yardLine;
      if (this.yardLine <= 0) {
        this.log(`${text}. ${ground.text} Thrown from the end zone: safety.`);
        this.safety();
        return;
      }
      this.log(`${text}. ${ground.text}`);
      if (ground.down > 4) {
        if (this.clock === 0 && (this.quarter === 2 || this.quarter === 4)) return;
        this.log('Turnover on downs.');
        this.changePossession(100 - this.yardLine);
        return;
      }
      this.down = ground.down;
      return;
    }

    if (this.yardLine >= 100) {
      if (downBefore === 3) ts.thirdDownConv++;
      if (downBefore === 4) ts.fourthDownConv++;
      ts.firstDowns++;
      this.touchdown(offSide, text);
      return;
    }
    if (this.yardLine <= 0) {
      this.log(text);
      this.safety();
      return;
    }
    if (late) {
      // The play stands, and the 15 yards go on from where it ended, with a first down.
      if (this.yardLine >= this.lineToGain) {
        if (downBefore === 3) ts.thirdDownConv++;
        if (downBefore === 4) ts.fourthDownConv++;
      }
      this.yardLine = late.yardLine;
      this.firstDown();
      this.clockRunning = false;
      if (this.clock <= 0 && (this.quarter === 2 || this.quarter >= 4)) this.untimed = true;
      this.log(`${text}. ${late.text}${this.untimed ? ' Untimed down.' : ''}`);
      return;
    }
    this.log(text);
    if (this.yardLine >= this.lineToGain) {
      if (downBefore === 3) ts.thirdDownConv++;
      if (downBefore === 4) ts.fourthDownConv++;
      this.firstDown();
    } else if (this.down === 4) {
      // When a half runs out on this play, possession no longer matters (halftime/overtime kickoffs follow).
      if (this.clock === 0 && (this.quarter === 2 || this.quarter === 4)) return;
      this.log('Turnover on downs.');
      this.changePossession(100 - this.yardLine);
      return;
    } else {
      this.down++;
    }
  }

  // ───────────────────────── penalties ─────────────────────────

  private spotNow(): Spot {
    return { yardLine: this.yardLine, down: this.down, lineToGain: this.lineToGain };
  }

  /** "BUF (J.Allen)": the team flagged, and the man who drew it. */
  private flagged(side: Side, by: Player | undefined): string {
    return by ? `${this.abbrev(side)} (${short(by)})` : this.abbrev(side);
  }

  /**
   * The flags on a scrimmage play: an offside from the snap, then one roll for the offense (holding, on
   * any run or dropback) and one for the coverage (on dropbacks). Whether a flag counts comes after,
   * once the play is known (`callFouls`).
   */
  private playFouls(result: PlayResult): LiveFoul[] {
    const fouls: LiveFoul[] = [];
    if (this.offsideFlag) fouls.push({ foul: 'offside' });
    this.offsideFlag = false;
    // The passer's own: a throwaway the engine flagged as he threw it (`passPlay`).
    if (result.grounding)
      fouls.push({ foul: 'grounding', by: this.lineups[this.offense].qb, spotYards: result.grounding.back });
    if (result.kind === 'kneel' || result.kind === 'spike') return fouls;
    const off = this.lineups[this.offense];
    const def = this.lineups[this.def];
    const { all, holding, coverage } = this.calls;
    const pHold =
      HOLDING *
      Math.exp(-0.05 * (off.offenseDiscipline - OL_DISCIPLINE)) *
      (1 + 0.15 * this.count(off.ol, 'handPlacement')) *
      all *
      holding;
    if (this.rng.chance(pHold)) fouls.push({ foul: 'holding' });
    if (result.kind !== 'run') {
      // A handsy defender grabs more (on a sack or a scramble, any of them might be the one), and a crew
      // that watches coverage closely sees more of it.
      const dbs = [...def.cb, ...def.s];
      const handsy = result.defender
        ? this.has(result.defender, 'handsy')
          ? 1
          : 0
        : this.count(dbs, 'handsy') / Math.max(1, dbs.length);
      const grabby = (1 + 0.6 * handsy) * all * coverage;
      const pDpi =
        // (A ball batted down at the line never reached anyone to interfere with.)
        result.kind === 'pass' && !result.complete && !result.turnover && !result.batted && result.airYards! > 0
          ? DPI[result.depth!] * grabby
          : 0;
      const roll = this.rng.next();
      if (roll < pDpi) fouls.push({ foul: 'passInterference', spotYards: result.airYards });
      else if (roll < pDpi + DEF_HOLDING * grabby) fouls.push({ foul: 'defHolding' });
    }
    this.personalFouls(result, fouls);
    return fouls;
  }

  /**
   * Personal fouls: a hit on the passer late, low or high; a tackle finished with a late shot, a face
   * mask or a horse collar; a sack celebrated in someone's face. The hits during a play lean on how clean the man who
   * did it plays (`roughness`: his sportsmanship), the celebration after the whistle on his temper (`discipline`), and
   * roughing on how closely the crew protects the passer and how decorated he is (`starLean`).
   */
  private personalFouls(result: PlayResult, fouls: LiveFoul[]) {
    // Every foul here is the defense's: its head coach's culture scales them all (`cultureCalls`).
    const { qbProtection } = this.calls;
    const all = this.calls.all * this.culture[this.def];
    const loose = (p: Player, typical: number) => Math.exp(-0.06 * (discipline(p) - typical));
    const dirty = (p: Player, typical: number) => Math.exp(-0.06 * (roughness(p) - typical));
    const rusher = result.kind === 'sack' ? result.rusher : result.kind === 'pass' ? this.pressureBy : null;
    if (
      rusher &&
      this.rng.chance(
        ROUGHING * dirty(rusher, DL_DISCIPLINE) * all * qbProtection * this.star(this.lineups[this.offense].qb),
      )
    ) {
      fouls.push({ foul: 'roughingPasser', by: rusher });
    }
    if (result.turnover) return;
    const tacklers = result.stats.entries.filter(([, key]) => key === 'tackles').map(([p]) => p);
    if (tacklers.length) {
      const late = tacklers.reduce((sum, p) => sum + dirty(p, TACKLER_DISCIPLINE), 0) / tacklers.length;
      const pRough = UNNECESSARY_ROUGHNESS * late * all;
      const pMask = FACE_MASK * late * all;
      const roll = this.rng.next();
      const foul: Foul | null =
        roll < pRough
          ? 'unnecessaryRoughness'
          : roll < pRough + pMask
            ? 'faceMask'
            : roll < pRough + pMask + HORSE_COLLAR * all
              ? 'horseCollar'
              : null;
      if (foul) fouls.push({ foul, by: this.flagRng.pick(tacklers) });
    }
    // After the whistle: apart from whatever was flagged during the play.
    if (
      result.kind === 'sack' &&
      result.rusher &&
      !fouls.length &&
      this.rng.chance(UNSPORTSMANLIKE * loose(result.rusher, DL_DISCIPLINE) * all)
    ) {
      fouls.push({ foul: 'unsportsmanlike', by: result.rusher });
    }
  }

  /** How readily the crews protect this quarterback, from his public record. */
  private star(qb: Player): number {
    let lean = this.stars.get(qb.id);
    if (lean === undefined) this.stars.set(qb.id, (lean = starLean(this.league, qb.id)));
    return lean;
  }

  /**
   * Judge a play's flags. Both teams flagged: they offset and the down is replayed. Otherwise the side
   * fouled against takes whichever suits it best, the play or a penalty (`coach.takesPenalty`), and any
   * flag it doesn't take is declined. Returns true when the play is wiped out, or else the note on the
   * declined flags to add to its text.
   */
  private callFouls(
    result: PlayResult,
    fouls: LiveFoul[],
    /** The snap as it ran: logged with a play the flags wipe out, so All-22 shows it before the walk-off. */
    ran: Anim,
  ):
    | true
    | {
        note: string;
        late?: { yardLine: number; text: string };
        /** A foul that lets the play stand and is enforced besides (grounding): where the ball goes, and the call. */
        ground?: Spot & { text: string };
      } {
    const offSide = this.offense;
    const defSide = this.def;
    const sideOf = (f: LiveFoul): Side => (FOULS[f.foul].side === 'offense' ? offSide : defSide);
    for (const f of fouls) f.by ??= this.committer(f.foul, result);
    const named = (f: LiveFoul) => `${FOULS[f.foul].label.toLowerCase()} on ${this.flagged(sideOf(f), f.by)}`;
    const at = this.spotNow();

    if (new Set(fouls.map(sideOf)).size === 2) {
      this.wipe(result);
      for (const f of fouls) this.flag(sideOf(f), f.foul, f.by, 'offset');
      this.clockRunning = false;
      this.setAnim(offSide, 'penalty', at.yardLine, at.yardLine, undefined, result.lane);
      this.anim!.ran = {
        kind: ran.kind,
        to: ran.to,
        ...(ran.air !== undefined ? { air: ran.air } : {}),
        ...(ran.loose !== undefined ? { loose: ran.loose } : {}),
        ...(ran.open ? { open: ran.open } : {}),
        ...(ran.who ? { who: ran.who } : {}),
        ...(ran.field ? { field: ran.field } : {}),
      };
      this.log(`${result.text}. Offsetting penalties: ${fouls.map(named).join(', ')}. Replay the down.`);
      return true;
    }

    const fouled = FOULS[fouls[0].foul].side === 'offense' ? 'defense' : 'offense';
    // A spot behind the goal line is a safety, a down past the 4th a turnover on downs (grounding's loss of down).
    const worth = (s: Spot) =>
      s.yardLine <= 0
        ? -2 - coach.downValue(40, 1, 10)
        : s.down > 4
          ? -coach.downValue(100 - s.yardLine, 1, 10)
          : coach.downValue(s.yardLine, s.down, Math.min(s.lineToGain, 100) - s.yardLine);
    // A foul at the end of a run or a catch past the line (or after the whistle) goes on from where the
    // play ended, and the play stands; one that ended in the end zone can't (the NFL would carry it to
    // the kickoff or the try, which the engine doesn't), so it's declined.
    const end = at.yardLine + result.yards;
    const lateOn = (f: LiveFoul) => {
      const late = FOULS[f.foul].late;
      return (
        late === 'always' ||
        (late === 'pastLine' && !result.turnover && result.yards > 0 && (result.kind !== 'pass' || !!result.complete))
      );
    };
    const options = fouls.map((f) => {
      const late = lateOn(f);
      return { f, late, spot: enforce(f.foul, late ? { ...at, yardLine: end } : at, f.spotYards) };
    });
    const usable = options.filter((o) => !(o.late && (end >= 100 || end <= 0)));
    usable.sort((a, b) => (fouled === 'offense' ? worth(b.spot) - worth(a.spot) : worth(a.spot) - worth(b.spot)));
    const [best] = usable;
    const take = !!best && coach.takesPenalty(fouled, this.playValue(result), worth(best.spot), !!result.turnover);
    let note = '';
    for (const { f } of options.filter((o) => !take || o !== best)) {
      this.flag(sideOf(f), f.foul, f.by, 'declined');
      note += `. ${FOULS[f.foul].label} on ${this.flagged(sideOf(f), f.by)}, declined`;
    }
    if (!take) return { note };

    const { f, spot } = best;
    const side = sideOf(f);
    const called = `PENALTY on ${this.flagged(side, f.by)}: ${FOULS[f.foul].label}, ${spot.yards} yards.`;
    if (FOULS[f.foul].stands) {
      // The play stays in the book (grounding: an incompletion and an attempt); the ball goes back, the down is lost.
      this.flag(side, f.foul, f.by, 'accepted', spot.yards);
      return { note, ground: { ...spot, text: `${called} Loss of down.` } };
    }
    if (best.late) {
      // The rusher who drew it hit the passer, whatever the credit stream said.
      if (
        f.foul === 'roughingPasser' &&
        f.by &&
        !result.stats.entries.some(([p, key]) => p === f.by && key === 'qbHits')
      )
        result.stats.add(f.by, 'qbHits');
      this.flag(side, f.foul, f.by, 'accepted', spot.yards);
      return { note, late: { yardLine: spot.yardLine, text: called } };
    }
    this.wipe(result);
    this.flag(side, f.foul, f.by, 'accepted', spot.yards);
    this.yardLine = spot.yardLine;
    // An automatic first down (or a foul that reaches the line) moves the chains; anything else replays the down.
    if (spot.down === 1 && (at.down !== 1 || spot.lineToGain !== at.lineToGain)) this.firstDown();
    this.clockRunning = false;
    // A defensive foul on the last play of a half: the offense gets one more snap.
    if (side === defSide && this.clock <= 0 && (this.quarter === 2 || this.quarter >= 4)) this.untimed = true;
    this.setAnim(offSide, 'penalty', at.yardLine, this.yardLine, undefined, result.lane);
    this.anim!.ran = {
      kind: ran.kind,
      to: ran.to,
      ...(ran.air !== undefined ? { air: ran.air } : {}),
      ...(ran.loose !== undefined ? { loose: ran.loose } : {}),
      ...(ran.open ? { open: ran.open } : {}),
      ...(ran.who ? { who: ran.who } : {}),
      ...(ran.field ? { field: ran.field } : {}),
    };
    const what = FOULS[f.foul].yards === 'spot' ? '' : ' No play.';
    this.log(`${result.text}${note}. ${called}${what}${this.untimed ? ' Untimed down.' : ''}`);
    return true;
  }

  /** A play a flag wipes out: its stats are never credited, and a sack doesn't count toward a beating. */
  private wipe(result: PlayResult) {
    if (result.kind !== 'sack') return;
    const qb = this.lineups[this.offense].qb;
    this.sacksTaken.set(qb.id, (this.sacksTaken.get(qb.id) ?? 1) - 1);
  }

  /** A play as it stands, valued for the offense like a penalty's spot (`coach.downValue`). */
  private playValue(result: PlayResult): number {
    if (result.turnover) {
      const { kind, spot, returnYds } = result.turnover;
      if (kind === 'int' && spot >= 100) return -coach.downValue(20, 1, 10);
      const theirs = 100 - spot + returnYds;
      return theirs >= 100 ? -coach.TOUCHDOWN_VALUE : -coach.downValue(theirs, 1, 10);
    }
    const yardLine = this.yardLine + result.yards;
    if (yardLine >= 100) return coach.TOUCHDOWN_VALUE;
    // A safety: two points and a free kick from the 20.
    if (yardLine <= 0) return -2 - coach.downValue(40, 1, 10);
    if (yardLine >= this.lineToGain) return coach.downValue(yardLine, 1, Math.min(10, 100 - yardLine));
    if (this.down === 4) return -coach.downValue(100 - yardLine, 1, 10);
    return coach.downValue(yardLine, this.down + 1, this.lineToGain - yardLine);
  }

  /**
   * Who drew a flag, leaning on the men with the least discipline: linemen most of all for false starts,
   * holding and offside (a tight end or a receiver now and then), and the man in coverage for grabbing.
   */
  private committer(foul: Foul, result: PlayResult | null): Player | undefined {
    const off = this.lineups[this.offense];
    const def = this.lineups[this.def];
    const loose = (p: Player) => Math.max(1, 24 - discipline(p));
    const pick = (players: Player[], weight: (p: Player) => number) =>
      players.length ? this.flagRng.weighted(players, (p) => loose(p) * weight(p)) : undefined;
    switch (foul) {
      case 'falseStart':
        return pick([...off.ol, ...off.tes.slice(0, 1), ...off.wrs], (p) =>
          p.position === 'OL' ? 1 : p.position === 'TE' ? 0.35 : 0.12,
        );
      case 'holding':
        return pick([...off.ol, ...off.tes.slice(0, 1), ...off.rbs.slice(0, 1)], (p) =>
          p.position === 'OL' ? (this.has(p, 'handPlacement') ? 1.5 : 1) : p.position === 'TE' ? 0.3 : 0.1,
        );
      case 'offside':
        return pick(
          [...def.dt, ...def.edge, ...def.lb],
          (p) => (p.position === 'LB' ? 0.15 : 1) * (this.has(p, 'jumpHappy') ? 2 : 1),
        );
      case 'passInterference':
      case 'defHolding':
        return result?.defender ?? pick([...def.cb, ...def.s], (p) => (this.has(p, 'handsy') ? 2 : 1));
      // Personal fouls name their man when they're rolled; this is only the fallback.
      default:
        return pick([...def.dt, ...def.edge, ...def.lb, ...def.cb, ...def.s], () => 1);
    }
  }

  /** A flag on `side`: accepted ones cost yards and count as penalties (the team's and the man's); declined and offsetting ones are only counted. */
  private flag(side: Side, foul: Foul, by: Player | undefined, outcome: 'accepted' | 'declined' | 'offset', yards = 0) {
    const ts = this.teamStats[side];
    if (outcome !== 'accepted') {
      const tally = outcome === 'declined' ? (ts.declined ??= {}) : (ts.offset ??= {});
      tally[foul] = (tally[foul] ?? 0) + 1;
      return;
    }
    ts.penalties++;
    ts.penaltyYds += yards;
    ts.flags![foul] = (ts.flags![foul] ?? 0) + 1;
    if (foul === 'roughingPasser') {
      const qb = (this.playerStats[this.lineups[this.offense].qb.id] ??= {});
      qb.roughingDrawn = (qb.roughingDrawn ?? 0) + 1;
    }
    if (!by) return;
    const line = (this.playerStats[by.id] ??= {});
    line.penalties = (line.penalties ?? 0) + 1;
    line.penaltyYds = (line.penaltyYds ?? 0) + yards;
  }

  private markRedZone() {
    if (!this.driveInRedZone) {
      this.driveInRedZone = true;
      this.teamStats[this.offense].redZoneAtt++;
    }
  }

  private firstDown() {
    this.teamStats[this.offense].firstDowns++;
    this.down = 1;
    this.lineToGain = Math.min(100, this.yardLine + 10);
  }

  result(): GameResult {
    const plays = this.plays;
    const playerTeams: Record<number, number> = {};
    for (const l of this.lineups) for (const p of activePlayers(l)) playerTeams[p.id] = l.team.id;
    for (const id of Object.keys(this.playerStats)) playerTeams[Number(id)] ??= this.league.players[Number(id)].teamId!;
    for (const id of Object.keys(playerTeams)) (this.playerStats[Number(id)] ??= {}).gp = 1;
    const [home, away] = this.teamStats;
    home.totalYds = home.passYds + home.rushYds;
    away.totalYds = away.passYds + away.rushYds;
    // What the game took out of everyone who played.
    const condition: Record<number, number> = {};
    for (const [id, b] of this.bodies) if (b.spent > 0) condition[id] = Math.round(b.energy * 10) / 10;
    // A quarterback who saw ghosts and took a beating carries it into his next game.
    for (const id of this.everRattled) if ((this.sacksTaken.get(id) ?? 0) >= 5) (this.formOut[id] ??= {}).shaken = true;
    for (const [id, f] of Object.entries(this.formOut)) if (!Object.keys(f).length) delete this.formOut[Number(id)];
    const reactions: CoachGameReport[] = [];
    for (const side of [0, 1] as const)
      for (const c of this.gameCoaches[side]) {
        if (c.role !== 'positionCoach' || !c.room) continue;
        const habits = activeCoachQuirks(c);
        if (!habits.includes('patientTeacher') && !habits.includes('earnYourReps')) continue;
        for (const [id, line] of Object.entries(this.playerStats)) {
          const p = this.league.players[Number(id)];
          if (!p || playerTeams[p.id] !== c.teamId || p.age > 25) continue;
          const room = (
            {
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
            } as const
          )[p.position];
          const poorReceiving = (line.targets ?? 0) >= 6 && (line.rec ?? 0) <= 1;
          if (
            room !== c.room ||
            ((line.passInt ?? 0) < 3 && (line.fumbles ?? 0) < 2 && (line.sacksAllowed ?? 0) < 2 && !poorReceiving)
          )
            continue;
          const fact =
            (line.passInt ?? 0) >= 3
              ? `${line.passInt} interceptions`
              : (line.fumbles ?? 0) >= 2
                ? `${line.fumbles} fumbles`
                : (line.sacksAllowed ?? 0) >= 2
                  ? `${line.sacksAllowed} sacks allowed`
                  : `${line.rec ?? 0} catches from ${line.targets} targets`;
          const patient = habits.includes('patientTeacher');
          reactions.push({
            coachId: c.id,
            name: `${c.firstName} ${c.lastName}`,
            role: c.role,
            teamId: c.teamId!,
            opportunities: {},
            choices: {},
            uses: {},
            events: [
              {
                quirk: patient ? 'patientTeacher' : 'earnYourReps',
                quarter: this.quarter,
                clock: this.clock,
                text: patient
                  ? `Wants to stay patient with ${p.firstName} ${p.lastName} after ${fact}; he favors giving young players time to learn.`
                  : `Wants ${p.firstName} ${p.lastName}'s place reviewed after ${fact}; preparation will weigh in his recommendation.`,
              },
            ],
          });
          break;
        }
      }
    // The advanced numbers are measures: three decimals keep every saved box score small.
    const thousandth = (v: number) => Math.round(v * 1000) / 1000;
    for (const ts of [home, away])
      if (ts.adv) for (const k of ['epa', 'passEpa', 'rushEpa'] as const) ts.adv[k] = thousandth(ts.adv[k]);
    for (const line of Object.values(this.playerStats)) if (line.epa !== undefined) line.epa = thousandth(line.epa);
    return {
      ...(this.coachReports.length || reactions.length ? { coaching: [...this.coachReports, ...reactions] } : {}),
      ...(Object.keys(this.formOut).length ? { form: this.formOut } : {}),
      homeScore: this.score[0],
      awayScore: this.score[1],
      overtime: this.quarter >= 5,
      quarters: { home: this.quarters[0], away: this.quarters[1] },
      home,
      away,
      playerStats: this.playerStats,
      playerTeams,
      plays,
      ...(this.fieldRecord ? { field: this.fieldRecord } : {}),
      ...(this.injuries.length ? { injuries: this.injuries, diagnoses: this.diagnoses } : {}),
      condition,
      weather: this.weather,
      ...(this.crew ? { crewId: this.crew.id } : {}),
    };
  }
}
