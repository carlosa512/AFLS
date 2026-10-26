/**
 * Injuries: who gets hurt, how badly, how fast he heals, and what it leaves behind. Design notes and
 * the research behind the numbers: `docs/INJURIES.md`; `npm run sim` checks the rates.
 *
 * - **Risk** comes from the snap (every play carries a small chance, more for the positions that run
 *   and collide most) and from contact (ball carriers brought down, sacked quarterbacks, tacklers,
 *   returners). It is scaled by the player's hidden injury resistance, which fades once his body is
 *   past its physical prime (a body built to last fades slower), by his energy late in a game
 *   (below 65 the risk climbs fast), by a history of recent injuries, by playing through one (on
 *   injections or in protective gear), and, for soft tissue, by the medical staff's sports science.
 * - **Condition** (0–100) is match fitness carried between games: a game costs some, a week gives
 *   most of it back (natural fitness and sports science decide how much). Playing every snap for
 *   weeks builds a debt; a rested player starts fresh. Energy in a game starts at his condition.
 * - **Layoffs** come from the injury type, rolled within its range, then shaped by rehab (the
 *   staff's physiotherapy), natural fitness and age. The medical staff names an estimate; the
 *   engine knows the truth. Severe injuries can take physical ratings for good.
 * - **Treatments** besides rest, where an injury allows them: a pain injection to play through a minor
 *   one, protective gear to come back early at a cost on the field, a fast-track to heal sooner and
 *   risk it going again. The player has his say: a competitor plays hurt, a contract year protects
 *   his next deal. Your players' treatments are always your call; AI teams choose their own.
 * - **Concussions** go through the protocol instead of a set layoff: a weekly draw from a bag of
 *   marbles built from his concussion history, so each one tends to last longer than the one before,
 *   makes the next likelier, and a long file can end a career in the offseason.
 * - **Injured reserve** takes a player off the 53 for at least four weeks; eight can come back each
 *   season. AI teams (and the user's, unless he takes over) place and activate players and sign
 *   replacements so every position stays covered.
 *
 * Everything random here runs on its own seeded streams (per game, per practice week), so a quiet
 * week leaves every other stream in the league exactly where it was.
 */
import { declineOnset } from './aging';
import { positionCoachFor, roomCare } from './coachQuirks';
import { teamCoaches } from './coaching';
import { capSpace, logTransaction, paidFraction } from './finance/cap';
import { lastSeason } from './finance/contract';
import {
  conditionBonus,
  departmentFor,
  diagnosisSpread,
  preventionMultiplier,
  recoveryMultiplier,
  TYPICAL,
  type Department,
} from './medical';
import {
  aiCapCompliance,
  aiCutdown,
  inSeasonReserve,
  KEEP_MIN,
  minimumFits,
  needSigning,
  signMinimum,
} from './offseason/ai';
import { ROSTER_MAX, signPlayer } from './offseason/negotiation';
import { overall, playerOvr, STARTERS } from './positions';
import { activeQuirks, addMarbles, type QuirkId } from './quirks';
import { clamp, Rng } from './rng';
import {
  activeRoster,
  chooseCover,
  isAvailable,
  placeAt,
  playingHurt,
  returnHome,
  slotOf,
  syncDepthChart,
  teamPlayers,
} from './roster';
import { characterRead, type CharacterRead } from './scouting';
import { TRAIT_MEAN } from './traits';
import type {
  Attribute,
  ConcussionProtocol,
  Injury,
  InjurySeverity,
  League,
  Player,
  Position,
  Team,
  TreatmentId,
} from './types';
import { POSITIONS } from './types';

/** Fewest weeks a player placed on injured reserve sits out. */
export const IR_MIN_WEEKS = 4;
/** Players a team may bring back from injured reserve each season. */
export const IR_RETURNS = 8;
/** Weeks between the title game and the next week 1: the offseason heals most things. */
export const OFFSEASON_WEEKS = 30;
/** A league year in weeks, for "how long ago" across seasons. */
const YEAR_WEEKS = 52;

export type Mechanism = 'contact' | 'soft';
type BodyPart =
  | 'head'
  | 'neck'
  | 'shoulder'
  | 'chest'
  | 'arm'
  | 'hand'
  | 'ribs'
  | 'back'
  | 'hip'
  | 'groin'
  | 'hamstring'
  | 'quad'
  | 'knee'
  | 'calf'
  | 'ankle'
  | 'foot'
  | 'achilles'
  | 'leg';

export interface InjuryType {
  label: string;
  part: BodyPart;
  /** How it happens: a collision, a body giving out on its own (strains, most torn ACLs), or either. */
  mechanism: Mechanism | 'both';
  /** Weeks out before rehab, fitness and age shape it, low to high (the low end is likelier). */
  weeks: [number, number];
  /** How often, relative to the others of its mechanism. */
  freq: number;
  /** Positions it finds more (or less) often than the rest. */
  pos?: Partial<Record<Position, number>>;
  /** Ratings it can cost for good, in points before natural fitness. */
  scar?: Partial<Record<Attribute, number>>;
  /** The worst of them: past 31 they become career-threatening (and every one of these is severe). */
  major?: true;
  /** Always career-threatening. */
  threatening?: true;
  /** A pain injection masks it when it's minor: joints, bones and bruises, never a muscle, the head or the neck. */
  inject?: true;
  /** Protective gear that gets him back before it has healed. */
  brace?: Brace;
  /** A faster way back than rest (rehab for a strain, surgery for a high ankle): its name. */
  fastTrack?: string;
  /** What he comes back in anyway on the normal timeline (a knee brace after an MCL): words for the card. */
  gear?: string;
}

/** Playing before it has healed, protected: a harness on a shoulder, a club on a broken hand. */
export interface Brace {
  /** What he plays in ("a club cast"). */
  gear: string;
  /** Share of the doctor's estimate he still sits before he can play in it. */
  wait: number;
  /** Rating points he plays down on while he wears it (contests his position doesn't run never read them). */
  cost: Partial<Record<Attribute, number>>;
  /** Positions that can't play in it: a quarterback can't throw in a club. */
  not?: readonly Position[];
  /** What else the choice means, for the card. */
  note?: string;
}

const SKILL_SPRINT: Partial<Record<Position, number>> = {
  WR: 1.5,
  CB: 1.5,
  S: 1.3,
  RB: 1.3,
  LB: 1,
  TE: 1,
  EDGE: 0.8,
  DT: 0.5,
  OL: 0.4,
  QB: 0.4,
  K: 0.8,
  P: 0.4,
};
const TRENCH: Partial<Record<Position, number>> = {
  OL: 1.4,
  DT: 1.4,
  EDGE: 1.2,
  LB: 1.1,
  TE: 1.1,
  RB: 0.9,
  WR: 0.6,
  CB: 0.6,
  S: 0.7,
  QB: 0.5,
  K: 0.1,
  P: 0.1,
};
const COLLISION: Partial<Record<Position, number>> = {
  CB: 1.3,
  S: 1.5,
  WR: 1.3,
  RB: 1.2,
  TE: 1.3,
  LB: 1.3,
  QB: 1,
  OL: 0.6,
  DT: 0.6,
  EDGE: 0.9,
  K: 0.3,
  P: 0.3,
};
const REHAB = 'Fast-track rehab';
const HARNESS = 'a shoulder harness';

/**
 * The injuries the game knows. Frequencies follow the NFL's injury surveillance (hamstrings first,
 * then ankle sprains, groins, high ankles and MCLs; a torn ACL about once a season per team);
 * layoffs follow return-to-play studies. Sources: docs/INJURIES.md.
 */
export const INJURY_TYPES = {
  // ── soft tissue: the body giving out on its own ──
  hamstring: {
    label: 'Hamstring strain',
    part: 'hamstring',
    mechanism: 'soft',
    weeks: [1, 5],
    freq: 22,
    pos: SKILL_SPRINT,
    fastTrack: REHAB,
  },
  groin: {
    label: 'Groin strain',
    part: 'groin',
    mechanism: 'soft',
    weeks: [1, 4],
    freq: 13,
    pos: { ...SKILL_SPRINT, K: 1.8, P: 1.4 },
    fastTrack: REHAB,
  },
  calf: { label: 'Calf strain', part: 'calf', mechanism: 'soft', weeks: [1, 3], freq: 9, fastTrack: REHAB },
  quad: {
    label: 'Quad strain',
    part: 'quad',
    mechanism: 'soft',
    weeks: [1, 3],
    freq: 6,
    pos: { K: 2.5, P: 1.8 },
    fastTrack: REHAB,
  },
  hipFlexor: { label: 'Hip flexor strain', part: 'hip', mechanism: 'soft', weeks: [1, 3], freq: 4, fastTrack: REHAB },
  back: {
    label: 'Back spasms',
    part: 'back',
    mechanism: 'both',
    weeks: [1, 2],
    freq: 6,
    pos: { OL: 1.5, DT: 1.4, QB: 1.2, K: 0.8, P: 1 },
    inject: true,
  },
  achilles: {
    label: 'Torn Achilles',
    part: 'achilles',
    mechanism: 'soft',
    weeks: [40, 52],
    freq: 1.4,
    scar: { speed: 1.6, agility: 0.8 },
    major: true,
    pos: { RB: 1.2, LB: 1.2, CB: 1.2, WR: 1.1, DT: 0.8, OL: 0.7, QB: 0.6, K: 0.2, P: 0.2 },
  },
  // Most torn ACLs are non-contact (a plant and a cut), the rest come in traffic.
  acl: {
    label: 'Torn ACL',
    part: 'knee',
    mechanism: 'both',
    weeks: [36, 50],
    freq: 3.5,
    scar: { speed: 1.1, agility: 1.1 },
    major: true,
    pos: { WR: 1.3, TE: 1.2, RB: 1.3, LB: 1.3, CB: 1.2, S: 1.1, OL: 0.9, DT: 1, EDGE: 0.8, QB: 0.7, K: 0.2, P: 0.2 },
  },
  pectoral: {
    label: 'Torn pectoral',
    part: 'chest',
    mechanism: 'both',
    weeks: [12, 18],
    freq: 0.5,
    scar: { strength: 0.8 },
    pos: { OL: 1.8, DT: 1.8, EDGE: 1.4, LB: 1.3, TE: 1, RB: 0.5, WR: 0.3, CB: 0.3, S: 0.4, QB: 0.2, K: 0, P: 0 },
  },
  // ── contact ──
  ankle: {
    label: 'Ankle sprain',
    part: 'ankle',
    mechanism: 'contact',
    weeks: [1, 2],
    freq: 17,
    pos: TRENCH,
    inject: true,
    gear: 'an ankle brace',
  },
  // TightRope surgery ties the two leg bones back together: back weeks sooner, at a price.
  highAnkle: {
    label: 'High ankle sprain',
    part: 'ankle',
    mechanism: 'contact',
    weeks: [2, 6],
    freq: 11,
    pos: TRENCH,
    fastTrack: 'TightRope surgery',
  },
  mcl: {
    label: 'MCL sprain',
    part: 'knee',
    mechanism: 'contact',
    weeks: [2, 6],
    freq: 10,
    pos: TRENCH,
    gear: 'a knee brace',
  },
  knee: {
    label: 'Knee sprain',
    part: 'knee',
    mechanism: 'contact',
    weeks: [1, 3],
    freq: 7,
    pos: TRENCH,
    inject: true,
    gear: 'a knee brace',
  },
  meniscus: { label: 'Torn meniscus', part: 'knee', mechanism: 'contact', weeks: [3, 8], freq: 3, pos: TRENCH },
  concussion: { label: 'Concussion', part: 'head', mechanism: 'contact', weeks: [1, 3], freq: 28, pos: COLLISION },
  shoulder: {
    label: 'Shoulder sprain',
    part: 'shoulder',
    mechanism: 'contact',
    weeks: [1, 3],
    freq: 8,
    pos: { QB: 1.3, LB: 1.2, S: 1.2, OL: 0.9 },
    inject: true,
    // A quarterback can't throw in a harness (docs/INJURIES.md), the sprain no more than the labrum.
    brace: { gear: HARNESS, wait: 0.5, cost: { strength: 1, tackling: 2, passBlock: 1, runBlock: 1 }, not: ['QB'] },
  },
  // Played through in a harness all season, fixed once it's over (the offseason covers the surgery).
  labrum: {
    label: 'Torn labrum',
    part: 'shoulder',
    mechanism: 'contact',
    weeks: [12, 24],
    freq: 0.7,
    scar: { strength: 0.8, throwPower: 0.8 },
    pos: { QB: 1.3, LB: 1.2, S: 1.2, OL: 1.1 },
    brace: {
      gear: HARNESS,
      wait: 0.12,
      cost: { strength: 2, tackling: 2, passBlock: 2, runBlock: 2, passRush: 1 },
      not: ['QB'],
      note: 'surgery once the season is over',
    },
  },
  ribs: {
    label: 'Rib injury',
    part: 'ribs',
    mechanism: 'contact',
    weeks: [1, 3],
    freq: 4,
    pos: { QB: 2.2, RB: 1.2, WR: 1.1 },
    inject: true,
    brace: { gear: 'a flak jacket', wait: 0.5, cost: { throwPower: 2, throwAccDeep: 1, carrying: 1, strength: 1 } },
  },
  hand: {
    label: 'Broken hand',
    part: 'hand',
    mechanism: 'contact',
    weeks: [2, 5],
    freq: 3.5,
    pos: { OL: 1.3, DT: 1.3, WR: 1.1, CB: 1.1 },
    inject: true,
    brace: {
      gear: 'a club cast',
      wait: 0.3,
      cost: { catching: 3, carrying: 2, passBlock: 1, runBlock: 1, tackling: 1 },
      not: ['QB'],
    },
  },
  wrist: {
    label: 'Wrist injury',
    part: 'arm',
    mechanism: 'contact',
    weeks: [2, 6],
    freq: 2,
    inject: true,
    brace: {
      gear: 'a wrist brace',
      wait: 0.5,
      cost: { catching: 2, carrying: 1, passBlock: 1, runBlock: 1, tackling: 1, throwAccShort: 1, throwAccDeep: 1 },
    },
  },
  elbow: {
    label: 'Elbow sprain',
    part: 'arm',
    mechanism: 'contact',
    weeks: [1, 4],
    freq: 2.5,
    pos: { OL: 1.5, DT: 1.4, EDGE: 1.2 },
    inject: true,
    brace: {
      gear: 'an elbow brace',
      wait: 0.5,
      cost: { passBlock: 1, runBlock: 1, tackling: 1, throwPower: 2, throwAccDeep: 1 },
    },
  },
  turfToe: {
    label: 'Turf toe',
    part: 'foot',
    mechanism: 'contact',
    weeks: [2, 7],
    freq: 2.5,
    pos: { OL: 1.2, DT: 1.2, RB: 1.3, WR: 1.1 },
    inject: true,
    brace: { gear: 'a carbon plate in his shoe', wait: 0.5, cost: { speed: 2, agility: 2 } },
  },
  hipPointer: { label: 'Hip pointer', part: 'hip', mechanism: 'contact', weeks: [1, 2], freq: 3, inject: true },
  neck: {
    label: 'Neck strain',
    part: 'neck',
    mechanism: 'contact',
    weeks: [1, 3],
    freq: 4,
    pos: { LB: 1.4, S: 1.3, OL: 1.2, DT: 1.2, EDGE: 1.1 },
  },
  lisfranc: {
    label: 'Lisfranc sprain',
    part: 'foot',
    mechanism: 'contact',
    weeks: [12, 28],
    freq: 0.5,
    scar: { agility: 0.8, speed: 0.8 },
  },
  brokenLeg: {
    label: 'Broken leg',
    part: 'leg',
    mechanism: 'contact',
    weeks: [8, 16],
    freq: 0.8,
    scar: { speed: 0.8 },
  },
  multiLigament: {
    label: 'Multi-ligament knee tear',
    part: 'knee',
    mechanism: 'contact',
    weeks: [44, 60],
    freq: 0.15,
    scar: { speed: 2, agility: 2 },
    major: true,
    threatening: true,
  },
  spinal: {
    label: 'Spinal injury',
    part: 'neck',
    mechanism: 'contact',
    weeks: [26, 52],
    freq: 0.08,
    scar: { strength: 1, speed: 1 },
    major: true,
    threatening: true,
    pos: COLLISION,
  },
} as const satisfies Record<string, InjuryType>;

export type InjuryId = keyof typeof INJURY_TYPES;
const TYPE_IDS = Object.keys(INJURY_TYPES) as InjuryId[];
export const injuryType = (id: string): InjuryType =>
  (INJURY_TYPES as Record<string, InjuryType>)[id] ?? INJURY_TYPES.hamstring;
export const injuryLabel = (id: string) => injuryType(id).label;
const POOLS: Record<Mechanism, InjuryId[]> = {
  contact: TYPE_IDS.filter((id) => INJURY_TYPES[id].mechanism !== 'soft'),
  soft: TYPE_IDS.filter((id) => INJURY_TYPES[id].mechanism !== 'contact'),
};

export const SEVERITY_LABEL: Record<InjurySeverity, string> = {
  minor: 'Minor',
  moderate: 'Moderate',
  severe: 'Severe',
  'career-threatening': 'Career-threatening',
};

/** Minor costs a week or two, moderate up to six, severe longer; the worst kinds can end a career. */
export function severityFor(type: InjuryType, weeks: number, age: number): InjurySeverity {
  if (type.threatening || (type.major && age >= 32)) return 'career-threatening';
  if (type.major || weeks > 6) return 'severe';
  return weeks > 2 ? 'moderate' : 'minor';
}

// ───────── who gets hurt ─────────

/**
 * Hidden resistance as it stands at his age: it holds through the prime, then fades about 0.6 a year
 * once his physical tools start to go (`declineOnset`). A durable body (`Built to last`) both adds a
 * little and fades half as fast: the ironman who stays on the field into his mid-30s.
 */
export function effectiveResistance(p: Pick<Player, 'position' | 'age' | 'traits'>, traits = p.traits): number {
  const past = Math.max(0, p.age - declineOnset(p.position, 'physical', traits));
  const fade = 0.6 * past * clamp(1 - 0.05 * (traits.durability - TRAIT_MEAN), 0.5, 1.5);
  return traits.injuryResistance + 0.1 * (traits.durability - TRAIT_MEAN) - fade;
}

/** Risk multiplier for a resistance: ×2.4 at 1, ×0.45 at 20 (1 at the league's typical 10.5). */
export const resistanceMult = (resistance: number) => Math.exp(-0.085 * (resistance - TRAIT_MEAN));

/** Energy below which the risk climbs: tired legs and late hits. Exponential, about ×2.5 at 55. */
export const FATIGUE_LINE = 65;
export const fatigueMult = (energy: number) => (energy >= FATIGUE_LINE ? 1 : Math.exp((FATIGUE_LINE - energy) / 11));

/** Injuries in the last two league years. */
function recentInjuries(p: Player, season: number): number {
  return (p.injuries ?? []).filter((r) => r.season >= season - 1).length;
}

/** Weeks since an injury (or any season/week stamp), approximately across league years. */
const weeksSince = (league: League, season: number, week: number) =>
  (league.season - season) * YEAR_WEEKS + (league.week - week);

/** Risk multiplier on the injury he came back from, in his first six weeks back. */
const BACK_SOON = 1.5;
/** The same, when he rushed back on a fast-track. */
const FAST_TRACK_RECUR = 2.5;

/**
 * Just back from an injury: a strain is the likeliest thing to go again (hamstrings above all), and
 * anything he rushed back from on a fast-track likelier still, a high ankle included.
 */
function backTooSoon(league: League, p: Player): { contact: number; soft: number } {
  const last = p.injuries?.at(-1);
  if (!last || p.injury || weeksSince(league, last.season, last.week) - last.weeks >= 6) return { contact: 1, soft: 1 };
  const m = last.fastTracked ? FAST_TRACK_RECUR : BACK_SOON;
  if (injuryType(last.type).mechanism !== 'contact') return { contact: 1, soft: m };
  return { contact: last.fastTracked ? m : 1, soft: 1 };
}

/** Playing through an injury: on injections the pain is masked; in protective gear it's guarded. */
const PLAYING_HURT_RISK: Record<TreatmentId, number> = { injection: 2.5, brace: 1.6, fastTrack: 1 };

export interface RiskFactors {
  /** Multipliers on a contact and a soft-tissue event's base chance, before fatigue. */
  contact: number;
  soft: number;
  /** On top of `contact`, when he is brought down with the ball: how his running habits take a tackle. */
  carrier: number;
}

/** What makes this player likelier (or less likely) to get hurt this week, apart from his energy. */
export function riskFactors(
  league: League,
  p: Player,
  dept: Department = departmentFor(league, p.teamId),
): RiskFactors {
  const hurt = p.injury?.treatment && playingHurt(p.injury) ? PLAYING_HURT_RISK[p.injury.treatment] : 1;
  const base =
    resistanceMult(effectiveResistance(p)) * (1 + 0.07 * Math.min(5, recentInjuries(p, league.season))) * hurt;
  const back = backTooSoon(league, p);
  return {
    contact: base * back.contact,
    soft: base * preventionMultiplier(dept.science) * back.soft,
    carrier: carrierHabit(activeQuirks(p)),
  };
}

// ───────── habits (the injury side of quirks) ─────────

/**
 * A back's running style decides what a tackle does to him. High-Knee Stride runs upright: ankle
 * tackles slide off, but he takes the big hits square, so more of them hurt and they land up top.
 * Contact Averse goes down before the hit arrives: fewer yards, fewer injuries.
 */
const carrierHabit = (quirks: readonly QuirkId[]) =>
  (quirks.includes('highKnee') ? 1.25 : 1) * (quirks.includes('contactAverse') ? 0.7 : 1);
const LOWER_BODY: ReadonlySet<BodyPart> = new Set(['ankle', 'knee', 'foot', 'leg', 'achilles', 'calf']);
const UPPER_BODY: ReadonlySet<BodyPart> = new Set(['head', 'neck', 'shoulder', 'ribs', 'chest']);
/** Where an upright runner's contact injuries land: up top more, the legs less. */
const partLean = (quirks: readonly QuirkId[], mechanism: Mechanism, part: BodyPart) =>
  mechanism === 'contact' && quirks.includes('highKnee')
    ? LOWER_BODY.has(part)
      ? 0.6
      : UPPER_BODY.has(part)
        ? 1.6
        : 1
    : 1;

/**
 * The habit a serious hit can leave behind: a quarterback starts seeing ghosts, a back starts going
 * down early, a receiver starts hearing footsteps. One marble in his bag: it shifts the odds, the
 * draws still decide.
 */
const HIT_SHY: Partial<Record<Position, QuirkId>> = {
  QB: 'seesGhosts',
  RB: 'contactAverse',
  WR: 'hearsFootsteps',
  TE: 'hearsFootsteps',
};

// ───────── in a game ─────────

/** Chance of an injury per snap on the field, before position and risk factors. */
export const SNAP_RISK = 0.0005;
/** How exposed each position is on an ordinary snap: the runners and hitters, not the quarterback in his pocket. */
export const SNAP_EXPOSURE: Record<Position, number> = {
  QB: 0.25,
  RB: 0.85,
  WR: 1.1,
  TE: 1.15,
  OL: 0.9,
  DT: 0.95,
  EDGE: 1,
  LB: 1.1,
  CB: 1.15,
  S: 1.05,
  K: 0,
  P: 0,
};
/** Share of the snap risk that is contact (pileups, cut blocks, a knee rolled up on); the rest is soft tissue. */
export const SNAP_CONTACT = 0.35;

export type ContactEvent = 'carrier' | 'free' | 'tackler' | 'sacked' | 'hit' | 'returner' | 'kick';
/**
 * Collisions the play-by-play records, on top of the snap: [chance per event, share of it that is
 * contact]. A ball carrier brought down takes the most, a sacked quarterback more still.
 */
export const CONTACT_RISK: Record<ContactEvent, [number, number]> = {
  carrier: [0.0016, 0.85],
  /** Scored or ran out of bounds before anyone got to him. */
  free: [0.0006, 0.3],
  tackler: [0.0011, 0.8],
  sacked: [0.003, 0.9],
  hit: [0.001, 0.9],
  returner: [0.003, 0.85],
  kick: [0.0004, 0.1],
};

// ───────── condition and energy ─────────

/** Energy a snap on the field costs, by position: backs, receivers and the defensive front run the most. */
const SNAP_COST: Record<Position, number> = {
  QB: 0.32,
  RB: 0.66,
  WR: 0.66,
  TE: 0.62,
  OL: 0.55,
  DT: 0.72,
  EDGE: 0.72,
  LB: 0.62,
  CB: 0.66,
  S: 0.58,
  K: 0,
  P: 0,
};
/** Energy back per snap on the sideline, up to his ceiling. */
export const SIDELINE_REST = 0.3;
/** Share of the energy spent that a game takes for good (the rest comes back on the sideline). */
export const HELD_SHARE = 0.55;

/** What a snap costs him: natural fitness about ±25%, and a little more each year past 28. */
export function snapCost(p: Player): number {
  // A lineman who is Gassed in High-Tempo really does run out of gas: his energy goes faster too.
  const gassed = activeQuirks(p).includes('gassed') ? 1.15 : 1;
  return (
    SNAP_COST[p.position] *
    (1 - 0.025 * (p.traits.naturalFitness - TRAIT_MEAN)) *
    (1 + 0.015 * Math.max(0, p.age - 28)) *
    gassed
  );
}

/** Share of lost condition a week of rest gives back: fitness, sports science and age decide it. */
export function weeklyRecovery(p: Player, dept: Department, coachBonus = 0): number {
  return clamp(
    0.68 +
      0.02 * (p.traits.naturalFitness - TRAIT_MEAN) +
      conditionBonus(dept.science) +
      coachBonus -
      0.01 * Math.max(0, p.age - 30),
    0.4,
    0.95,
  );
}

// ───────── what it is and how long ─────────

export interface RolledInjury {
  injury: Injury;
  scar?: Partial<Record<Attribute, number>>;
}

/**
 * Diagnose an injury. A player playing through one (on injections or in protective gear) makes that
 * one worse instead of picking up something new: the same injury, half again as long on top of what
 * was left.
 */
export function rollInjury(
  rng: Rng,
  league: League,
  p: Player,
  mechanism: Mechanism,
  where: Injury['where'],
  dept: Department = departmentFor(league, p.teamId),
  at = { season: league.season, week: league.week },
): RolledInjury {
  const prior = p.injury;
  let id: string;
  let weeks: number;
  if (prior && playingHurt(prior)) {
    id = prior.type;
    weeks = Math.round((prior.weeksRemaining + rollWeeks(rng, p, injuryType(id), dept)) * 1.5);
  } else {
    // Recent injuries to a part make it the likeliest to go again.
    const recent = new Set(
      (p.injuries ?? [])
        .filter((r) => weeksSince(league, r.season, r.week) < YEAR_WEEKS)
        .map((r) => injuryType(r.type).part),
    );
    const quirks = activeQuirks(p);
    const head = concussionRisk(league, p, at);
    id = rng.weighted(POOLS[mechanism], (t) => {
      const type: InjuryType = INJURY_TYPES[t];
      return (
        type.freq *
        (type.pos?.[p.position] ?? 1) *
        (recent.has(type.part) ? (mechanism === 'soft' ? 2.5 : 1.5) : 1) *
        partLean(quirks, mechanism, type.part) *
        (t === 'concussion' ? head : 1)
      );
    });
    if (id === 'concussion') return { injury: diagnoseConcussion(rng, league, p, dept, at, where) };
    weeks = rollWeeks(rng, p, injuryType(id), dept);
  }
  const type = injuryType(id);
  const severity = severityFor(type, weeks, p.age);
  // The doctor's estimate brackets the truth, unevenly, so its midpoint gives nothing away.
  const spread = diagnosisSpread(dept.diagnosis);
  const lo = Math.max(1, Math.min(weeks, Math.round(weeks * (1 - spread * rng.float(0.2, 1)))));
  const hi = Math.max(weeks, Math.round(weeks * (1 + spread * rng.float(0.2, 1))));
  const injury: Injury = {
    type: id,
    severity,
    weeksRemaining: weeks,
    estimate: [lo, hi],
    season: at.season,
    week: at.week,
    where,
  };
  const scar = severity === 'severe' || severity === 'career-threatening' ? rollScar(rng, p, type) : undefined;
  return scar ? { injury, scar } : { injury };
}

/** A layoff within the type's range (short ones likelier), shaped by rehab, natural fitness and age. */
function rollWeeks(rng: Rng, p: Player, type: InjuryType, dept: Department): number {
  const [lo, hi] = type.weeks;
  const base = lo + (hi - lo) * rng.next() ** 1.25;
  const fitness = 1 - 0.015 * (p.traits.naturalFitness - TRAIT_MEAN);
  const age = 1 + 0.015 * Math.max(0, p.age - 29);
  return Math.max(1, Math.round(base * recoveryMultiplier(dept.physio) * fitness * age));
}

/** From this age a scar's lost points are lost for good, ceiling included (younger players still grow back). */
const SCAR_REGROW_AGE = 26;

/**
 * What a severe injury takes for good: natural fitness and age decide how much of his athleticism
 * comes back. A young body rebuilds most of it, a veteran's doesn't (it also keeps a league from
 * slowly draining: a scar at 23 would otherwise be carried for a decade).
 */
function rollScar(rng: Rng, p: Player, type: InjuryType): Partial<Record<Attribute, number>> | undefined {
  if (!type.scar) return undefined;
  const age = clamp(0.1 + 0.1 * (p.age - 23), 0.1, 1.2);
  const keep = clamp(1.1 - 0.05 * (p.traits.naturalFitness - TRAIT_MEAN), 0.6, 1.6) * age;
  const out: Partial<Record<Attribute, number>> = {};
  for (const [attr, pts] of Object.entries(type.scar) as [Attribute, number][]) {
    const raw = pts * keep * rng.float(0.6, 1.4);
    const n = Math.floor(raw) + (rng.chance(raw - Math.floor(raw)) ? 1 : 0);
    if (n > 0) out[attr] = n;
  }
  return Object.keys(out).length ? out : undefined;
}

/**
 * Put an injury on a player: it replaces any he was playing through, goes in his history, and a
 * severe one costs its scar (from 26, ceiling included: a step lost is lost for the rest of his career).
 */
export function applyInjury(
  league: League,
  p: Player,
  injury: Injury,
  scar?: Partial<Record<Attribute, number>>,
): void {
  const aggravated = playingHurt(p.injury);
  p.injury = injury;
  const record: NonNullable<Player['injuries']>[number] = {
    type: injury.type,
    severity: injury.severity,
    season: injury.season,
    week: injury.week,
    weeks: injury.weeksRemaining,
  };
  if (aggravated) record.aggravated = true;
  if (scar) {
    const before = playerOvr(p);
    const taken: Partial<Record<Attribute, number>> = {};
    for (const [attr, n] of Object.entries(scar) as [Attribute, number][]) {
      const lost = Math.min(n, p.ratings[attr] - 1);
      if (lost <= 0) continue;
      p.ratings[attr] -= lost;
      taken[attr] = lost;
    }
    // A veteran's ceiling drops with it; a player still growing keeps his and can win the points back.
    const drop = before - playerOvr(p);
    if (drop > 0 && p.age >= SCAR_REGROW_AGE)
      p.potential = Math.max(playerOvr(p), Math.round((p.potential - drop) * 10) / 10);
    if (Object.keys(taken).length) record.scar = taken;
  }
  (p.injuries ??= []).push(record);
  // A serious hit in a game can leave a habit behind (not a strain, not the practice field).
  const type = injuryType(injury.type);
  const shy = HIT_SHY[p.position];
  // Each concussion leaves more of a mark than the last: a marble for every one on his file.
  const marks = type.part === 'head' ? Math.max(1, Math.round(concussionLoad(p, injury.season, injury.week))) : 1;
  if (
    shy &&
    injury.where === 'game' &&
    type.mechanism !== 'soft' &&
    (injury.severity !== 'minor' || type.part === 'head')
  )
    addMarbles(league, p, [shy], marks);
  if (p.teamId === null) return;
  // News: everything about the user's players; around the league, only the big ones to good players.
  const team = league.teams[p.teamId];
  const big = injury.severity === 'severe' || injury.severity === 'career-threatening';
  if (p.teamId === league.userTeamId || (big && playerOvr(p) >= 13)) {
    logTransaction(
      league,
      'injury',
      [p.teamId],
      `${team.abbrev} ${p.position} ${p.firstName} ${p.lastName}: ${injuryLabel(injury.type).toLowerCase()}${aggravated ? ', aggravated' : ''} (${estimateText(injury)})`,
    );
  }
}

// ───────── what screens say ─────────

/** "out 2–3 weeks", "out for the season", from the medical staff's estimate. */
export function estimateText(injury: Pick<Injury, 'estimate'>, weeksLeftInSeason?: number): string {
  const [lo, hi] = injury.estimate;
  if (weeksLeftInSeason !== undefined && lo >= weeksLeftInSeason) return 'out for the season';
  if (hi <= 1) return 'out about a week';
  if (lo === hi) return `out about ${lo} weeks`;
  return `out ${lo}–${hi} weeks`;
}

/** A short status for a roster row: "IR", "Out 2–3 wk", "Playing hurt", or null when healthy. */
export function injuryTag(p: Player): string | null {
  if (p.ir) return 'IR';
  if (!p.injury) return null;
  if (playingHurt(p.injury)) return 'Playing hurt';
  if (p.injury.braceWait) return `Out ${p.injury.braceWait} wk`;
  if (p.injury.protocol && !p.injury.protocol.shutdown) return 'Protocol';
  const [lo, hi] = p.injury.estimate;
  return hi <= 1 ? 'Out 1 wk' : lo === hi ? `Out ${lo} wk` : `Out ${lo}–${hi} wk`;
}

const weeksText = (n: number) => (n === 1 ? 'a week' : `${n} weeks`);

/**
 * His outlook in words, treatment included: "out 2–3 weeks", "playing through it on injections",
 * "back in a club cast in a week", "out 1–2 weeks, after TightRope surgery".
 */
export function outlookText(injury: Injury, weeksLeftInSeason?: number): string {
  const type = injuryType(injury.type);
  if (injury.protocol?.shutdown) return 'shut down for the season to think about his future';
  if (injury.protocol) return `in the concussion protocol, ${protocolOutlook(injury.estimate)}`;
  if (injury.treatment === 'injection') return 'playing through it on injections';
  if (injury.treatment === 'brace' && type.brace)
    return injury.braceWait
      ? `back in ${type.brace.gear} in ${weeksText(injury.braceWait)}`
      : `playing in ${type.brace.gear}`;
  const out = estimateText(injury, weeksLeftInSeason);
  return injury.treatment === 'fastTrack' && type.fastTrack
    ? `${out}, after ${type.fastTrack === REHAB ? 'fast-track rehab' : type.fastTrack}`
    : out;
}

/** "day to day", "day to day, up to 3 weeks", "out 2–4 weeks": the doctor's read of the protocol. */
function protocolOutlook([lo, hi]: [number, number]): string {
  if (hi <= 1) return 'day to day';
  if (lo <= 0) return `day to day, up to ${hi} weeks`;
  return lo === hi ? `out about ${weeksText(lo)}` : `out ${lo}–${hi} weeks`;
}

export type RiskTier = 'Low' | 'Medium' | 'High';

export interface InjuryRiskRead {
  /** False when the team knows too little to say (no film, no sit-down, no history). */
  known: boolean;
  tier: RiskTier;
  /** True when it rests on a thin read. */
  hedged: boolean;
  line: string;
  /** The resistance this read amounts to at his age, on the traits' scale. Engine-only: screens get the tier. */
  read: number;
}

const RISK_LINE: Record<RiskTier, string> = {
  Low: 'his body holds up: a low injury risk',
  Medium: 'an ordinary injury risk',
  High: 'his body breaks down: a high injury risk',
};

/**
 * What `teamId` believes about how injury-prone a player is, in words. For its own players that is
 * the medical staff's judgment (the doctor examines him every week: sharp, not perfect). For anyone
 * else it is the scouts' read of a body they've only seen on film, which a poor department can miss
 * by a mile, plus what the league's injury reports say about him: a long list of injuries outweighs
 * any scout. Age is public, so everyone sees the fade.
 */
export function injuryRisk(
  league: League,
  teamId: number,
  p: Player,
  character?: CharacterRead | null,
): InjuryRiskRead {
  const history = (p.injuries ?? []).filter((r) => r.season >= league.season - 2 && !r.aggravated).length;
  // What his snaps would predict: about one time-loss injury a full season, plus the practice field.
  let played = 0;
  let years = 0;
  for (let s = league.season - 2; s <= league.season; s++) {
    if (!p.stats[s] && s !== league.season) continue;
    played += p.stats[s]?.gp ?? 0;
    years++;
  }
  const expected = 0.045 * played + 0.1 * years;
  let read: number;
  let durability = TRAIT_MEAN;
  let sd: number;
  if (p.teamId === teamId) {
    const dept = departmentFor(league, teamId);
    sd = 2.6 * clamp(2 ** ((TRAIT_MEAN - dept.diagnosis) / 6), 0.45, 1.9) * 0.5;
    const own = new Rng(`${league.seed}:view:${teamId}:${p.id}:medical`);
    read = clamp(p.traits.injuryResistance + sd * own.normal(), 1, 20);
    durability = p.traits.durability;
  } else {
    // A caller that already has the scouts' read passes it (`character`): it costs three seeded streams.
    const c = character === undefined ? characterRead(league, teamId, p) : character;
    if (!c && !history) return { known: false, tier: 'Medium', hedged: true, line: '', read: TRAIT_MEAN };
    read = c?.injuryResistance ?? TRAIT_MEAN;
    durability = c?.durability ?? TRAIT_MEAN;
    sd = c ? Math.max(c.sd, 1) : 4;
  }
  // Injury reports are public: more injuries than his snaps would predict over three years is
  // evidence of a fragile body, fewer of a sturdy one.
  read += clamp(-1.2 * (history - expected), -5, 1.5);
  const eff = effectiveResistance(p, { ...p.traits, injuryResistance: read, durability });
  const tier: RiskTier = eff >= 12.5 ? 'Low' : eff <= 8 ? 'High' : 'Medium';
  return { known: true, tier, hedged: sd > 2 && history < 2, line: RISK_LINE[tier], read: eff };
}

// ───────── injured reserve ─────────

const inSeason = (league: League) => league.phase === 'regular' || league.phase === 'playoffs';
/** The first week a move made now sits out: the week about to be played, or week 1 in the offseason. */
const nextWeek = (league: League) => (inSeason(league) ? league.week : 1);
/** Weeks of football left this season, playoffs included (so a team still alive can plan a return). */
export const weeksLeft = (league: League) => (inSeason(league) ? Math.max(0, 22 - league.week + 1) : 22);
export const irReturnsUsed = (league: League, teamId: number) => league.teams[teamId].irReturns?.[league.season] ?? 0;

export function irProblem(league: League, p: Player): string | null {
  if (p.squad) return 'Practice squad players do not occupy the NFL injured reserve list.';
  if (p.teamId === null) return 'He isn’t on a roster.';
  if (p.ir) return 'He is already on injured reserve.';
  if (!p.injury) return 'Only an injured player can go on injured reserve.';
  if (league.phase === 'complete') return 'The season is over.';
  return null;
}

/** Off the 53 for at least four weeks: the spot is free for a replacement. */
export function placeOnIr(league: League, p: Player, first = nextWeek(league)): void {
  const problem = irProblem(league, p);
  if (problem) throw new Error(problem);
  if (p.injury) restIt(p.injury);
  p.ir = { season: league.season, week: first, weeks: 0 };
  syncDepthChart(league, league.teams[p.teamId!]);
  const team = league.teams[p.teamId!];
  if (p.teamId === league.userTeamId || playerOvr(p) >= 13)
    logTransaction(
      league,
      'injury',
      [p.teamId!],
      `${team.abbrev} placed ${p.position} ${p.firstName} ${p.lastName} on injured reserve`,
    );
}

export function activateProblem(league: League, p: Player): string | null {
  if (!p.ir || p.teamId === null) return 'He isn’t on injured reserve.';
  if (p.injury && !playingHurt(p.injury)) return 'He is still hurt.';
  const team = league.teams[p.teamId];
  // In the offseason the reserve list clears on its own; in season the four-week minimum and the return limit apply.
  if (inSeason(league)) {
    if (p.ir.weeks < IR_MIN_WEEKS) return `He must sit out at least ${IR_MIN_WEEKS} weeks (${p.ir.weeks} so far).`;
    if (irReturnsUsed(league, team.id) >= IR_RETURNS)
      return `You've used all ${IR_RETURNS} return designations this season.`;
  }
  if (activeRoster(league, team.id).length >= ROSTER_MAX && inSeason(league))
    return `Your roster is full (${ROSTER_MAX}). Release someone first.`;
  return null;
}

export function activateFromIr(league: League, p: Player): void {
  const problem = activateProblem(league, p);
  if (problem) throw new Error(problem);
  const team = league.teams[p.teamId!];
  if (inSeason(league)) (team.irReturns ??= {})[league.season] = irReturnsUsed(league, team.id) + 1;
  delete p.ir;
  syncDepthChart(league, team);
  if (p.teamId === league.userTeamId || playerOvr(p) >= 13)
    logTransaction(
      league,
      'injury',
      [team.id],
      `${team.abbrev} activated ${p.position} ${p.firstName} ${p.lastName} from injured reserve`,
    );
}

// ───────── treatments ─────────

export const TREATMENT_IDS: readonly TreatmentId[] = ['injection', 'brace', 'fastTrack'];

/** What a treatment is called for this injury: "Play through it (injections)", "Back early in a club cast", "TightRope surgery". */
export function treatmentLabel(id: TreatmentId, type: InjuryType): string {
  if (id === 'injection') return 'Play through it (injections)';
  if (id === 'brace') return `Back early in ${type.brace?.gear ?? 'a brace'}`;
  return type.fastTrack ?? REHAB;
}

/** The treatments this injury allows at all (whether he can take one now is `treatmentProblem`). */
export const treatmentsFor = (type: InjuryType): TreatmentId[] =>
  TREATMENT_IDS.filter((id) => (id === 'injection' ? type.inject : id === 'brace' ? type.brace : type.fastTrack));

/** Why he can't start a treatment now, or null. */
export function treatmentProblem(p: Player, id: TreatmentId): string | null {
  const inj = p.injury;
  if (!inj) return 'He isn’t hurt.';
  const type = injuryType(inj.type);
  if (inj.treatment) return inj.treatment === id ? 'He is already on it.' : 'Stop his current treatment first.';
  if (id === 'injection') {
    if (!type.inject)
      return type.part === 'head' || type.part === 'neck'
        ? 'Never with his head or his neck.'
        : type.mechanism === 'soft'
          ? 'No needle lets a strained muscle sprint.'
          : 'An injection can’t mask this one.';
    if (p.ir) return 'He is on injured reserve.';
    if (inj.severity !== 'minor') return 'Only a minor injury can be played through on injections.';
  } else if (id === 'brace') {
    if (!type.brace) return 'No brace gets him back early from this.';
    if (type.brace.not?.includes(p.position)) return `A ${p.position} can’t play in ${type.brace.gear}.`;
    if (p.ir) return 'He is on injured reserve.';
    if (braceWait(inj, type.brace) >= inj.estimate[0])
      return `He’d be healed before he could play in ${type.brace.gear}.`;
  } else {
    if (!type.fastTrack) return 'There’s no faster way back from this.';
    if (inj.estimate[1] < 2) return 'He’s back within the week anyway.';
  }
  return null;
}

/** Weeks he sits before he can play in protective gear: a share of the doctor's estimate. */
export const braceWait = (inj: Injury, brace: Brace) =>
  Math.round(((inj.estimate[0] + inj.estimate[1]) / 2) * brace.wait);

/** Share of the layoff a fast-track takes off at a typical department; better physios take more. */
export const fastTrackCut = (physio: number) => clamp(0.25 + 0.01 * (physio - TYPICAL), 0.15, 0.35);
/** How much of the program he really does: a hard worker all of it, a coaster about half (the risk stays the same). */
const commitment = (p: Player) => clamp(0.75 + 0.06 * (p.traits.workEthic - TRAIT_MEAN), 0.5, 1);

export interface TreatmentAnswer {
  yes: boolean;
  /** His reason, in words ("a competitor, he wants to be out there"); empty when he simply agrees. */
  why: string;
}

const isContractYear = (league: League, p: Player) => !!p.contract && lastSeason(p.contract) === league.season;

/**
 * Whether he'll go along with a treatment, and why. The roll is his own, fixed for this injury and
 * this treatment, so asking twice gets the same answer; it changes only when his situation does (the
 * playoffs, his contract). A competitor plays hurt; a contract year, with an agent who drives a hard
 * bargain, protects the next deal; a needle that once made it worse isn't forgotten. A fast-track is
 * an easier sell: nearly everyone wants back sooner.
 */
export function treatmentAnswer(league: League, p: Player, id: TreatmentId): TreatmentAnswer {
  const inj = p.injury!;
  const roll = new Rng(`${league.seed}:treat:${p.id}:${inj.season}:${inj.week}:${inj.type}:${id}`).next();
  const reasons: [number, string][] = [];
  const winning = p.personality.winning - 0.5;
  if (id === 'fastTrack') {
    reasons.push([0.9, '']);
    reasons.push([0.2 * winning, winning > 0 ? 'he wants back on the field' : 'he’d rather take his time']);
    if (isContractYear(league, p)) reasons.push([0.1, 'he wants to be back for his contract year']);
  } else {
    reasons.push([id === 'injection' ? 0.8 : 0.88, '']);
    reasons.push([
      0.4 * winning,
      winning > 0 ? 'a competitor, he wants to be out there' : 'he isn’t one to play through pain',
    ]);
    if (league.phase === 'playoffs') reasons.push([0.1, 'it’s the playoffs']);
    if (isContractYear(league, p))
      reasons.push([-0.35 * p.personality.greed, 'he’s protecting his next deal in a contract year']);
    if (id === 'injection' && p.injuries?.some((r) => r.aggravated))
      reasons.push([-0.3, 'he made one worse on injections before']);
  }
  const willing = clamp(
    reasons.reduce((a, [v]) => a + v, 0),
    0.05,
    0.98,
  );
  const yes = roll < willing;
  // His reason: whatever pushed hardest the way he went.
  const said = reasons
    .filter(([v, why]) => why && (yes ? v > 0.02 : v < -0.02))
    .sort((a, b) => (yes ? b[0] - a[0] : a[0] - b[0]))[0];
  return { yes, why: said?.[1] ?? (yes ? '' : 'he’d rather let it heal') };
}

/** Start a treatment he has agreed to. A fast-track takes its weeks off now; gear makes him wait a little first. */
function startTreatment(league: League, p: Player, id: TreatmentId): void {
  const inj = p.injury!;
  const type = injuryType(inj.type);
  inj.treatment = id;
  if (id === 'brace' && type.brace) {
    const wait = braceWait(inj, type.brace);
    if (wait > 0) inj.braceWait = wait;
    inj.braceCost = { ...type.brace.cost };
  }
  if (id === 'fastTrack') {
    const cut = fastTrackCut(departmentFor(league, p.teamId).physio);
    const before = inj.weeksRemaining;
    inj.weeksRemaining = Math.max(1, Math.round(before * (1 - cut * commitment(p))));
    // The doctor plans on the program as written; how much of it he does is up to him. The estimate
    // still brackets the truth.
    const planned = 1 - cut * 0.75;
    inj.estimate = [
      Math.min(inj.weeksRemaining, Math.max(1, Math.round(inj.estimate[0] * planned))),
      Math.max(inj.weeksRemaining, Math.round(inj.estimate[1] * planned)),
    ];
    const record = p.injuries?.at(-1);
    if (record && record.type === inj.type && record.season === inj.season && record.week === inj.week) {
      record.weeks = Math.max(1, record.weeks - (before - inj.weeksRemaining));
      record.fastTracked = true;
    }
  }
  if (p.teamId !== null) syncDepthChart(league, league.teams[p.teamId]);
}

/** Put a treatment to him: if he agrees it starts now. Throws if he can't take it at all. */
export function proposeTreatment(league: League, p: Player, id: TreatmentId): TreatmentAnswer {
  const problem = treatmentProblem(p, id);
  if (problem) throw new Error(problem);
  const answer = treatmentAnswer(league, p, id);
  if (answer.yes) startTreatment(league, p, id);
  return answer;
}

/** Back to resting it: off the injections, out of the gear. A fast-track can't be undone. */
function restIt(inj: Injury): void {
  if (inj.treatment !== 'injection' && inj.treatment !== 'brace') return;
  delete inj.treatment;
  delete inj.braceWait;
  delete inj.braceCost;
}

export function stopTreatment(league: League, p: Player): void {
  if (!p.injury) return;
  restIt(p.injury);
  if (p.teamId !== null) syncDepthChart(league, league.teams[p.teamId]);
}

// ───────── concussions ─────────

/**
 * A concussed player enters the protocol. There is no set layoff: each week he takes the test, a
 * marble drawn from his own bag and never put back. An all-clear ends it, a week with symptoms keeps
 * him out, a setback brings the symptoms back (two more of them go in the bag). A first concussion
 * clears in time for the next game half the time, about two in five over the league as in the NFL (59% miss a game,
 * median 9 days: docs/INJURIES.md); every earlier one on his file adds symptoms and setbacks, so each
 * tends to last longer than the one before, and makes the next one likelier.
 */
const CLEAR = 4;
const SYMPTOMS = 4;
/** Games after he's cleared in which a second concussion is likelier: the brain isn't done when the symptoms are. */
export const CONCUSSION_WINDOW = 2;

/**
 * His concussion history as it weighs on the next one: each past concussion counts in full for two
 * years, then fades to half by four, never less. Staying clean helps; it never wipes the file.
 */
export function concussionLoad(p: Player, season: number, week: number): number {
  let load = 0;
  for (const r of p.injuries ?? []) {
    if (r.type !== 'concussion') continue;
    const years = ((season - r.season) * YEAR_WEEKS + (week - r.week)) / YEAR_WEEKS;
    load += clamp(1 - 0.25 * (years - 2), 0.5, 1);
  }
  return load;
}

export const concussionCount = (p: Player) => (p.injuries ?? []).filter((r) => r.type === 'concussion').length;

/** Weeks left (0 when none) of the window after his last concussion cleared, when a second one is likelier. */
export function concussionWindow(league: League, p: Player): number {
  const last = (p.injuries ?? []).filter((r) => r.type === 'concussion').at(-1);
  if (!last || p.injury?.type === 'concussion') return 0;
  // Weeks since the test that cleared him: the first game he could play is one week on.
  const since = weeksSince(league, last.season, last.week) - (last.weeks - (last.held ? 1 : 0));
  return since >= 1 && since <= CONCUSSION_WINDOW ? CONCUSSION_WINDOW - since + 1 : 0;
}

/** How much likelier a contact injury is to be a concussion for him: his file, and a brain cleared only just. */
function concussionRisk(league: League, p: Player, at: { season: number; week: number }): number {
  return (1 + 0.3 * Math.min(4, concussionLoad(p, at.season, at.week))) * (concussionWindow(league, p) > 0 ? 2 : 1);
}

/** His bag for a new concussion: two more symptoms and a setback for each earlier one, more if it was recent or he's 30 or older. */
export function protocolBag(p: Player, at: { season: number; week: number }): ConcussionProtocol {
  const load = concussionLoad(p, at.season, at.week);
  const recent = (p.injuries ?? []).some(
    (r) => r.type === 'concussion' && (at.season - r.season) * YEAR_WEEKS + (at.week - r.week) < YEAR_WEEKS,
  );
  return {
    clear: CLEAR,
    symptoms: SYMPTOMS + Math.round(2 * load) + (recent ? 1 : 0) + (p.age >= 30 ? 1 : 0),
    setbacks: Math.round(load),
  };
}

/**
 * Draws he can expect until the all-clear: without replacement, (others + clears + 1) / (clears + 1),
 * each setback counting for itself and, if it comes out before the all-clear, the two symptoms it adds.
 */
function expectedTests(b: ConcussionProtocol): number {
  const others = b.symptoms + b.setbacks + (2 * b.setbacks * b.setbacks) / (b.setbacks + b.clear);
  return (others + b.clear + 1) / (b.clear + 1);
}

/**
 * The doctor's read of the protocol from here: the games he can expect to miss, as a range as wide as
 * any other estimate of his. `testFirst`: the next test comes before the next game (the week it happened).
 */
function estimateProtocol(rng: Rng, inj: Injury, dept: Department, testFirst: boolean): void {
  const out = expectedTests(inj.protocol!) - (testFirst ? 1 : 0);
  const spread = diagnosisSpread(dept.diagnosis);
  inj.weeksRemaining = Math.max(1, Math.round(out));
  inj.estimate = [
    Math.max(0, Math.floor(out * (1 - spread * rng.float(0.2, 1)))),
    Math.max(1, Math.ceil(out * (1 + spread * rng.float(0.2, 1)))),
  ];
}

/**
 * Diagnose a concussion: into the protocol. His third in a season, or a file this long, has him
 * weighing his future, and about half the time (fewer for a competitor) he shuts himself down for the
 * rest of the year: no tests, back after the offseason. That roll runs on his own stream.
 */
function diagnoseConcussion(
  rng: Rng,
  league: League,
  p: Player,
  dept: Department,
  at: { season: number; week: number },
  where: Injury['where'],
): Injury {
  const type = INJURY_TYPES.concussion;
  const protocol = protocolBag(p, at);
  const injury: Injury = {
    type: 'concussion',
    severity: 'minor',
    weeksRemaining: 1,
    estimate: [0, 1],
    season: at.season,
    week: at.week,
    where,
    protocol,
  };
  if (weighsHisFuture(league, p, at)) {
    protocol.shutdown = true;
    injury.weeksRemaining = Math.max(1, weeksLeft(league));
    injury.estimate = [injury.weeksRemaining, injury.weeksRemaining];
  } else estimateProtocol(rng, injury, dept, where === 'game');
  injury.severity = severityFor(type, injury.weeksRemaining, p.age);
  return injury;
}

/** A third concussion this season, or a fifth on his file, and he may shut himself down for the year. */
function weighsHisFuture(league: League, p: Player, at: { season: number; week: number }): boolean {
  if (!inSeason(league)) return false;
  const thisSeason = (p.injuries ?? []).filter((r) => r.type === 'concussion' && r.season === at.season).length + 1;
  if (thisSeason < 3 && concussionLoad(p, at.season, at.week) + 1 < 5) return false;
  return new Rng(`${league.seed}:shutdown:${p.id}:${at.season}:${at.week}`).chance(
    clamp(0.5 - 0.6 * (p.personality.winning - 0.5), 0.2, 0.8),
  );
}

/** This week's test, on his own stream: the all-clear, another week, or a setback. */
function protocolTest(league: League, p: Player, inj: Injury, dept: Department): void {
  const pr = inj.protocol!;
  const rng = new Rng(`${league.seed}:${league.season}:${league.week}:protocol:${p.id}`);
  const roll = rng.int(0, pr.clear + pr.symptoms + pr.setbacks - 1);
  if (roll < pr.clear) return clearProtocol(league, p, inj);
  if (roll < pr.clear + pr.symptoms) pr.symptoms--;
  else {
    pr.setbacks--;
    pr.symptoms += 2;
    pr.setbackWeek = league.week;
  }
  estimateProtocol(rng, inj, dept, false);
}

/** Cleared: his file shows the games he really missed, and a team that holds him sits him one more week. */
function clearProtocol(league: League, p: Player, inj: Injury): void {
  const held = !!inj.protocol!.hold;
  const missed = Math.max(0, weeksSince(league, inj.season, inj.week)) + (held ? 1 : 0);
  const record = p.injuries?.at(-1);
  if (record && record.type === inj.type && record.season === inj.season && record.week === inj.week) {
    record.weeks = missed;
    record.severity = severityFor(INJURY_TYPES.concussion, missed, p.age);
    if (held) record.held = true;
  }
  if (!held) {
    delete p.injury;
    return;
  }
  delete inj.protocol;
  inj.weeksRemaining = 1;
  inj.estimate = [1, 1];
}

/** Sit him a week once he's cleared, or not: a week off the field is a week of the window spent safe. */
export function holdAfterProtocol(p: Player, on: boolean): void {
  const pr = p.injury?.protocol;
  if (!pr || pr.shutdown) return;
  if (on) pr.hold = true;
  else delete pr.hold;
}

/** Concussions' share of the offseason retirement chance, by his file: from the third on, more with each one. */
const CONCUSSION_RETIRE: [number, number][] = [
  [2.5, 0],
  [3, 0.03],
  [4, 0.1],
  [5, 0.25],
  [6, 0.4],
];

/**
 * Chance concussions end his career this offseason (`season` is the league year that just began): from
 * about the third on his file, rising with each one, half again after two in the season just played.
 */
export function concussionRetireChance(p: Player, season: number): number {
  const load = concussionLoad(p, season, 0);
  if (load <= CONCUSSION_RETIRE[0][0]) return 0;
  const i = CONCUSSION_RETIRE.findIndex(([at]) => at >= load);
  const base =
    i < 0
      ? CONCUSSION_RETIRE.at(-1)![1]
      : CONCUSSION_RETIRE[i - 1][1] +
        ((load - CONCUSSION_RETIRE[i - 1][0]) / (CONCUSSION_RETIRE[i][0] - CONCUSSION_RETIRE[i - 1][0])) *
          (CONCUSSION_RETIRE[i][1] - CONCUSSION_RETIRE[i - 1][1]);
  const lastYear = (p.injuries ?? []).filter((r) => r.type === 'concussion' && r.season === season - 1).length;
  return Math.min(0.6, base * (lastYear >= 2 ? 1.5 : 1));
}

// ───────── the weekly cycle ─────────

/** Chance a player picks up an injury on the practice field in a week, before his risk factors. */
export const PRACTICE_RATE = 0.0055;
/** Share of practice injuries that come from contact (most are strains). */
const PRACTICE_CONTACT = 0.25;

/**
 * After a week's games: time heals (every injury from before this week loses a week, every reserve
 * stint gains one), condition comes back, the practice field claims a few, and front offices that
 * delegate their injuries (every AI team, and the user's unless he turned it off) make their moves.
 */
export function injuryWeek(league: League): void {
  const season = league.season;
  const week = league.week;
  const depts = new Map<number | null, Department>();
  const dept = (teamId: number | null) =>
    depts.get(teamId) ?? depts.set(teamId, departmentFor(league, teamId)).get(teamId)!;
  // His position coach's habits: how hard the room practices and how well it recovers.
  const care = (p: Player) =>
    p.teamId === null ? roomCare(undefined) : roomCare(positionCoachFor(teamCoaches(league, p.teamId), p.position));
  for (const p of Object.values(league.players)) {
    if (p.retired) continue;
    const inj = p.injury;
    // A concussion is a test a week, the first in the week it happened: some clear in time for the next game.
    if (inj?.protocol && !inj.protocol.shutdown) protocolTest(league, p, inj, dept(p.teamId));
    else if (inj && (inj.season < season || inj.week < week)) {
      inj.weeksRemaining--;
      inj.estimate = [Math.max(0, inj.estimate[0] - 1), Math.max(0, inj.estimate[1] - 1)];
      if (inj.braceWait && --inj.braceWait <= 0) delete inj.braceWait;
      if (inj.weeksRemaining <= 0) delete p.injury;
    }
    if (p.ir && (p.ir.season < season || p.ir.week <= week)) p.ir.weeks++;
    if (p.condition !== undefined && p.condition < 100) {
      const c = p.condition + (100 - p.condition) * weeklyRecovery(p, dept(p.teamId), care(p).recovery);
      if (c >= 99.5) delete p.condition;
      else p.condition = Math.round(c * 10) / 10;
    }
  }
  // Practice: teams still playing football this week and next.
  const playing = practicingTeams(league);
  const rng = new Rng(`${league.seed}:${season}:${week}:practice`);
  for (const p of Object.values(league.players)) {
    if (p.retired || p.teamId === null || !playing.has(p.teamId) || p.ir || p.injury) continue;
    const d = dept(p.teamId);
    const f = riskFactors(league, p, d);
    // A worn-down body practices tired.
    const worn = (1 + Math.max(0, 85 - (p.condition ?? 100)) / 25) * care(p).practice;
    const contact = PRACTICE_RATE * PRACTICE_CONTACT * f.contact * worn;
    const soft = PRACTICE_RATE * (1 - PRACTICE_CONTACT) * f.soft * worn;
    const roll = rng.next();
    if (roll >= contact + soft) continue;
    const hurt = rollInjury(rng, league, p, roll < contact ? 'contact' : 'soft', 'practice', d);
    applyInjury(league, p, hurt.injury, hurt.scar);
  }
  // Front offices with something to handle: anyone hurt or on reserve, or a spot open on the 53.
  const rosters = new Map<number, Player[]>();
  for (const p of Object.values(league.players))
    if (p.teamId !== null) (rosters.get(p.teamId) ?? rosters.set(p.teamId, []).get(p.teamId)!).push(p);
  const ai = new Rng(`${league.seed}:${season}:${week}:injury-moves`);
  for (const team of league.teams) {
    const roster = rosters.get(team.id) ?? [];
    // A staff cover counts too: it has to go back once the injury it covered for heals.
    const busy =
      roster.some((p) => p.injury || p.ir) ||
      roster.length < ROSTER_MAX ||
      Object.values(team.playingAt ?? {}).some((x) => x.by === 'staff');
    if (busy && delegates(league, team)) manageInjuries(league, team, ai, roster);
    // A front office over the cap gets back under before the next game: no team plays a week over it.
    // (Yours is told to, and can't play on until it has: `offseasonBlockers`.)
    if (team.id !== league.userTeamId && capSpace(league, team.id) < 0) aiCapCompliance(league, team);
  }
}

/** Every team in the regular season; in the playoffs, only the teams still alive. */
function practicingTeams(league: League): Set<number> {
  if (league.phase !== 'playoffs') return new Set(league.teams.map((t) => t.id));
  const alive = new Set<number>();
  for (const g of league.games)
    if (g.season === league.season && g.playoffRound && (!g.result || g.week >= league.week))
      [g.homeId, g.awayId].forEach((id) => alive.add(id));
  return alive;
}

/** AI teams always handle their own injuries; the user's team does too unless he has taken over. */
export const delegates = (league: League, team: Team) => team.id !== league.userTeamId || team.autoInjuries !== false;

/**
 * A front office's injury moves: its starters' treatments (AI teams only: the user's players are
 * always his call), long injuries on reserve, healed players back while there are return designations
 * left, and a replacement on a minimum deal where a position runs thin (cutting the least valuable man
 * if the roster is full).
 */
export function manageInjuries(league: League, team: Team, rng: Rng, roster = teamPlayers(league, team.id)): void {
  const season = inSeason(league);
  for (const p of roster) {
    // A cut to make room for a returning player may have released him already.
    if (p.teamId !== team.id || p.squad) continue;
    const inj = p.injury;
    if (inj && !p.ir && !inj.treatment && season && team.id !== league.userTeamId) aiTreatment(league, team, p);
    if (
      inj &&
      !p.ir &&
      !playingHurt(inj) &&
      weeksOut(inj) >= IR_MIN_WEEKS + 0.5 &&
      (season || league.phase === 'preseason')
    )
      placeOnIr(league, p, season ? league.week + 1 : 1);
    else if (
      p.ir &&
      !p.injury &&
      (!season || (p.ir.weeks >= IR_MIN_WEEKS && irReturnsUsed(league, team.id) < IR_RETURNS))
    ) {
      // Your staff never cuts a man to bring one back: he waits on reserve until you make room.
      if (team.id === league.userTeamId && activeRoster(league, team.id).length >= ROSTER_MAX) continue;
      if (inSeason(league)) (team.irReturns ??= {})[league.season] = irReturnsUsed(league, team.id) + 1;
      delete p.ir;
      if (activeRoster(league, team.id).length > ROSTER_MAX) aiCutdown(league, team);
      syncDepthChart(league, team);
    }
  }
  // Your staff covers from the roster; signings and cuts stay yours.
  if (season) coverPositions(league, team, rng, roster, team.id !== league.userTeamId);
}

/** Weeks the doctor expects him to miss: the estimate's middle, or the wait before he plays in gear. */
const weeksOut = (inj: Injury) =>
  inj.treatment === 'brace' ? (inj.braceWait ?? 0) : (inj.estimate[0] + inj.estimate[1]) / 2;

/** A GM this keen on winning now pushes his starters back early all season; everyone does in the playoffs. */
const AI_PUSH = 0.6;

/**
 * An AI front office's call on a hurt starter: in the playoffs a needle for a minor injury he'd miss
 * a game or two with, and for a win-now GM (everyone, in the playoffs) gear to get him back early or a
 * fast-track to get him back sooner. The player can say no.
 */
function aiTreatment(league: League, team: Team, p: Player): void {
  const slot = team.depthChart[p.position].indexOf(p.id);
  if (slot < 0 || slot >= STARTERS[p.position]) return;
  const playoffs = league.phase === 'playoffs';
  if (!playoffs && team.gm.winNow < AI_PUSH) return;
  const inj = p.injury!;
  for (const id of TREATMENT_IDS) {
    if (id === 'injection' && !(playoffs && inj.weeksRemaining <= Math.min(2, weeksLeft(league)))) continue;
    if (id === 'brace' && weeksOut(inj) < 2) continue;
    if (treatmentProblem(p, id) || !treatmentAnswer(league, p, id).yes) continue;
    startTreatment(league, p, id);
    return;
  }
}

/** Fewest healthy players a team needs at each position to field a lineup without emergencies. */
export const NEED: Record<Position, number> = {
  QB: 2,
  RB: 2,
  WR: 4,
  TE: 2,
  OL: 7,
  DT: 3,
  EDGE: 3,
  LB: 3,
  CB: 4,
  S: 3,
  K: 1,
  P: 1,
};

/** Positions where `team` has fewer healthy players than it needs, counted where they line up. */
export function shortPositions(league: League, team: Team): Position[] {
  const healthy = new Map<Position, number>();
  for (const p of activeRoster(league, team.id))
    if (isAvailable(p)) healthy.set(slotOf(league, p), (healthy.get(slotOf(league, p)) ?? 0) + 1);
  return POSITIONS.filter((pos) => (healthy.get(pos) ?? 0) < NEED[pos]);
}

/** Healthy players at `pos` on `team`, counted where they line up. */
export const healthyAt = (league: League, team: Team, pos: Position) =>
  activeRoster(league, team.id).filter((p) => isAvailable(p) && slotOf(league, p) === pos).length;

/**
 * Staff's covers end once they're not needed: a player staff lined up at a position goes back to his own when
 * that position has enough healthy players of its own again, or when he's hurt himself. The user's moves stay.
 */
function releaseCovers(league: League, team: Team): void {
  const at = team.playingAt;
  if (!at) return;
  const roster = activeRoster(league, team.id);
  for (const [id, entry] of Object.entries(at)) {
    if (entry.by !== 'staff') continue;
    const p = league.players[Number(id)];
    const own = roster.filter((q) => q.position === entry.pos && !at[q.id] && isAvailable(q)).length;
    if (!isAvailable(p) || own >= NEED[entry.pos]) returnHome(league, p.id);
  }
}

/**
 * Wherever too few healthy players are left (counted where they line up), use what the roster has first: a spare
 * player who's a decent backup there moves over (`chooseCover`). Then, with `sign` (AI teams), a replacement on
 * a minimum deal, cutting to make room. Without it (your staff) nobody is signed or cut.
 * `roster` is the team as it stood before this pass (re-read only once a move changes it).
 */
function coverPositions(league: League, team: Team, rng: Rng, roster: Player[], sign: boolean): void {
  releaseCovers(league, team);
  let current = roster.filter((p) => p.teamId === team.id && !p.ir && !p.squad);
  // Positions nobody on the roster can cover, when this pass can't sign: left short.
  const stuck = new Set<Position>();
  for (let guard = 0; guard < 12; guard++) {
    if (guard > 0) current = activeRoster(league, team.id);
    const healthy = new Map<Position, number>();
    for (const p of current)
      if (isAvailable(p)) healthy.set(slotOf(league, p), (healthy.get(slotOf(league, p)) ?? 0) + 1);
    const short = POSITIONS.filter((pos) => !stuck.has(pos) && (healthy.get(pos) ?? 0) < NEED[pos]).sort(
      (a, b) => (healthy.get(a) ?? 0) / NEED[a] - (healthy.get(b) ?? 0) / NEED[b],
    )[0];
    if (short) {
      const cover = chooseCover(league, team, short, NEED);
      if (cover) {
        placeAt(league, cover.id, short, undefined, 'staff');
        continue;
      }
    }
    if (!sign) {
      if (!short) return;
      stuck.add(short);
      continue;
    }
    const open = current.length < ROSTER_MAX;
    if (!short && !open) return;
    // Room on the roster and nobody short: fill the spot where depth is thinnest against a full roster.
    const pos =
      short ??
      POSITIONS.map((p) => ({ p, gap: (healthy.get(p) ?? 0) - KEEP_MIN[p] })).sort((a, b) => a.gap - b.gap)[0].p;
    // Only a deal that fits under the cap: a team out of room plays short-handed (the lineup borrows a fill-in).
    // It makes sure a signing fits before it cuts a man to make a spot, or it would release him for a deal it
    // can't make (and leave a street free agent it can't afford on the market).
    const room = roomForMinimum(league, team);
    // A real free agent at his price first, out of the room kept for the season (no hole spends past it).
    const budget = Math.min(room, inSeasonReserve(league, team.id));
    // Priced once: a cut to make room sends a man at another position to the market, not one this pick weighs.
    const pick = needSigning(league, team, pos, budget);
    if (!pick && !minimumFits(league, pos, room)) return;
    if (!open && !cutForRoom(league, team, pos)) return;
    if (pick) {
      signPlayer(league, pick.player, team.id, pick.offer);
      continue;
    }
    if (!signMinimum(league, team, rng, pos, room)) return;
  }
}

/**
 * Cap room for a minimum deal signed now, in full-season terms: a deal signed mid-season only counts the
 * weeks left (`prospectiveContract`), so the same room covers a bigger annual minimum later in the year.
 */
function roomForMinimum(league: League, team: Team): number {
  const left = 1 - paidFraction(league);
  const space = capSpace(league, team.id);
  // In the playoffs every weekly check has been paid: a signing costs nothing this year.
  return left > 0 ? space / left : space >= 0 ? Infinity : 0;
}

/** Release the least valuable healthy player at a position with depth to spare. False if nobody can go. */
function cutForRoom(league: League, team: Team, need: Position): boolean {
  const roster = activeRoster(league, team.id);
  const counts = new Map<Position, number>();
  for (const p of roster) if (isAvailable(p)) counts.set(p.position, (counts.get(p.position) ?? 0) + 1);
  const spare = roster.filter(
    (p) =>
      p.position !== need &&
      isAvailable(p) &&
      (counts.get(p.position) ?? 0) > NEED[p.position] &&
      team.depthChart[p.position].indexOf(p.id) >= STARTERS[p.position],
  );
  if (!spare.length) return false;
  aiCutdown(league, team, ROSTER_MAX - 1, spare);
  return activeRoster(league, team.id).length < ROSTER_MAX;
}

/**
 * The new league year: thirty weeks off heal most things (an ACL from midseason still costs him the
 * start of the next one), the reserve list clears, and everyone reports fresh.
 */
export function injuriesNewYear(league: League): void {
  // Thirty weeks off refill every position: staff's covers go back (the user's own moves stay his).
  for (const team of league.teams)
    for (const [id, at] of Object.entries(team.playingAt ?? {})) if (at.by === 'staff') returnHome(league, Number(id));
  for (const p of Object.values(league.players)) {
    delete p.ir;
    delete p.condition;
    const inj = p.injury;
    if (!inj) continue;
    if (p.retired || inj.weeksRemaining <= OFFSEASON_WEEKS) {
      delete p.injury;
      continue;
    }
    inj.weeksRemaining -= OFFSEASON_WEEKS;
    inj.estimate = [Math.max(1, inj.estimate[0] - OFFSEASON_WEEKS), Math.max(1, inj.estimate[1] - OFFSEASON_WEEKS)];
    delete inj.treatment;
    delete inj.braceWait;
    delete inj.braceCost;
  }
}

/**
 * Chance injuries end a career this offseason, on top of age (`retireChance`): a veteran of 33 or
 * more whose body has a long file, or anyone 30 or older coming off a career-threatening injury.
 * `season` is the league year that just began.
 */
export function injuryRetireChance(p: Player, season: number): number {
  const recent = (p.injuries ?? []).filter((r) => r.season >= season - 2);
  const threatened = recent.some((r) => r.season === season - 1 && r.severity === 'career-threatening');
  const missed = recent.reduce((s, r) => s + Math.min(r.weeks, 18), 0);
  const chronic = recent.filter((r) => r.weeks >= 2).length >= 3 || missed >= 16;
  if (threatened && p.age >= 33) return 0.6;
  if (threatened && p.age >= 30) return 0.25;
  if (chronic && p.age >= 33) return 0.25;
  return 0;
}

/** What a player plays like out of position, for emergency lineups. */
export const ovrAt = (p: Player, pos: Position) => overall(p.ratings, pos);
