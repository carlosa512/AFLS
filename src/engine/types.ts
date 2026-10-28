import type { SeasonAwards, WeeklyAwards } from './awards';
/**
 * Core data model. Everything here is plain JSON-serializable data so a League
 * can be saved, loaded, exported and modded without custom (de)serializers.
 */
import type { QuirkId } from './quirks';
import type { CoachQuirkId } from './coachQuirks';
import type { RngState } from './rng';
import type {
  PersonnelState,
  PlayerService,
  ServiceAssignment,
  SquadMembership,
  GameDayPlan,
  GameDayList,
} from './personnel/types';
import type { Weather } from './weather';

export const POSITIONS = ['QB', 'RB', 'WR', 'TE', 'OL', 'DT', 'EDGE', 'LB', 'CB', 'S', 'K', 'P'] as const;
export type Position = (typeof POSITIONS)[number];

/** How a draft pick turned out against what its round should produce (`draftGrade.ts`). */
export type PickVerdict = 'steal' | 'hit' | 'miss';

/** All attributes use a 1–20 scale (FM-style) to avoid rating inflation. */
export const ATTRIBUTES = [
  'speed',
  'strength',
  'agility',
  'awareness',
  'throwPower',
  'throwAccShort',
  'throwAccDeep',
  'carrying',
  'elusiveness',
  'catching',
  'routeRunning',
  'passBlock',
  'runBlock',
  'tackling',
  'passRush',
  'runStop',
  'coverage',
  'kickPower',
  'kickAccuracy',
] as const;
export type Attribute = (typeof ATTRIBUTES)[number];
export type Ratings = Record<Attribute, number>;

/** One league year of a contract. Money is in thousands of dollars. */
export interface ContractYear {
  season: number;
  /** Base salary (paid weekly in season; counts on the cap in full for that year). */
  base: number;
  /** How much of `base` is owed even if the player is released. */
  guaranteed: number;
  /**
   * Weekly checks of this season already paid (by anyone) when `base` was set. A mid-season
   * signing or trade resets the base to cover only the weeks left, so the paid share of it is
   * counted from here, not from week 1.
   */
  paidBefore?: number;
  /** A dummy year that exists only to spread bonus money; it voids before it is played. */
  void?: true;
}

/** Bonus money paid up front and spread evenly over at most five league years of cap. */
export interface Proration {
  amount: number;
  /** First league year it counts against. */
  start: number;
  years: number;
  /** 'roster': next year's salary paid ahead as a bonus that counts in full this year. */
  source: 'signing' | 'restructure' | 'roster';
}

export type ContractKind = 'rookie' | 'veteran' | 'tag' | 'minimum';

/**
 * A contract is a list of league years plus bonus prorations, not a single salary number,
 * so every cap consequence (dead money, restructures, void years) falls out of simple formulas.
 */
export interface Contract {
  kind: ContractKind;
  signedSeason: number;
  /** Regular-season week it was signed in; 0 = offseason, -1 = existed before the league began. Drives the trade cooldown. */
  signedWeek: number;
  /** Average per real year of the deal as signed (bonus included), $K. */
  apy: number;
  /** Real (non-void) seasons as signed. */
  length: number;
  /** Current and future league years (past years are dropped), including any void years. */
  years: ContractYear[];
  bonuses: Proration[];
  /** First-round rookie deals carry a team option for a fifth season. */
  fifthYearOption?: 'eligible' | 'exercised' | 'declined';
}

export const STAT_KEYS = [
  'gp',
  /** Scrimmage snaps on the field (kick plays aside): what tells a starter from a backup who dressed. Games before v33 have none. */
  'snaps',
  'passAtt',
  'passCmp',
  'passYds',
  'passTd',
  'passInt',
  'sacked',
  'sackYds',
  'rushAtt',
  'rushYds',
  'rushTd',
  'rushLong',
  'fumbles',
  'fumblesLost',
  'targets',
  'rec',
  'recYds',
  'recTd',
  'recLong',
  'tackles',
  'tfl',
  'sacks',
  /** Rusher who beat his man and got to the quarterback or forced him off his spot (sacks included). */
  'pressures',
  /** Rusher who hit the quarterback as or after he threw (sacks included). */
  'qbHits',
  /** Blocker beaten on a sack, a pressure or a hit. */
  'sacksAllowed',
  'pressuresAllowed',
  'hitsAllowed',
  'defInt',
  'passDef',
  'forcedFum',
  'fumRec',
  'defTd',
  'fgAtt',
  'fgMade',
  'fgLong',
  'xpAtt',
  'xpMade',
  'punts',
  'puntYds',
  'krAtt',
  'krYds',
  'krTd',
  'prAtt',
  'prYds',
  'prTd',
  /** Punter whose punt was blocked. */
  'puntsBlocked',
  /** Accepted penalties charged to the player, and the yards they cost. */
  'penalties',
  'penaltyYds',
  /** Quarterback hit late, low or high, and the flag accepted. */
  'roughingDrawn',
  /** Pass attempts, sacks and scrambles: the plays a quarterback drops back on (`analytics.ts`). */
  'dropbacks',
  /** Expected points added, on the passer for a dropback and the ball carrier for a designed run. */
  'epa',
  /** Successful plays by the NFL's rule (`isSuccess`), credited like `epa`. */
  'successes',
  /** Snaps rushing the passer: a front player or the rush rotation on a dropback. */
  'rushSnaps',
] as const;
export type StatKey = (typeof STAT_KEYS)[number];
export type StatLine = Partial<Record<StatKey, number>>;
/** Stats where season/career totals take the max rather than the sum. */
export const MAX_STATS: ReadonlySet<StatKey> = new Set(['rushLong', 'recLong', 'fgLong']);

import type { CoachScheme } from './schemes';

export interface Player {
  id: number;
  firstName: string;
  lastName: string;
  /** A name the user (or a mod) chose: no names pass ever replaces it. */
  nameEdited?: true;
  position: Position;
  age: number;
  heightIn: number;
  weightLb: number;
  /** Plays bigger than his size: an outlier build costs him half (`sizeEdge`). Hidden like a trait; absent for most. */
  playsBig?: true;
  jersey: number;
  /** Years of pro experience (0 = rookie). */
  experience: number;
  /** Separate from calendar experience: accrued, minimum-salary and pension service. */
  service?: PlayerService;
  /** Exclusive practice-squad list membership; ordinary active/IR membership remains implicit. */
  squad?: SquadMembership;
  /** Pending waivers are not free agency; the NFL contract remains intact until settlement. */
  waiver?: { id: number; fromTeamId: number };
  /** AI gives a newly claimed player a trial instead of immediately churning him through another notice. */
  waiverArrival?: { season: number; week: number; phase: Phase };
  ratings: Ratings;
  /** Hidden ceiling for overall rating (1–20). Revealed only through scouting. */
  potential: number;
  /**
   * How his ceiling settled in each of his first league years (season → change, true, in overall points;
   * `ceiling.ts`). Hidden like the ceiling: no screen reads it. Present means that season has settled.
   */
  ceilingShifts?: Record<number, number>;
  /** null for free agents and retired players. */
  teamId: number | null;
  /** Free agents have no contract. */
  contract: Contract | null;
  retired?: boolean;
  /** `rank`: where the consensus ranked him in his class when he was taken (kept here because old picks are pruned). */
  /** `verdict`: how the pick turned out in your scouts' eyes, locked after his third season (`draftGrade.ts`). */
  draft?: {
    season: number;
    round: number;
    pick: number;
    teamId: number;
    rank?: number;
    verdict?: PickVerdict;
    /** The team that held the pick first, when it came from another team. */
    via?: number;
    /** A pick moved during the draft: the team that sent it and what it got, as pick labels. */
    deal?: PickDeal;
  };
  /** Times franchise-tagged (each consecutive tag costs more). */
  tagCount?: number;
  /** Draft prospects: the league-wide consensus read of overall and ceiling (true ratings stay hidden). AI boards use it. */
  scouting?: { grade: number; ceiling: number };
  /** Ratings at the start of each league year, in `ATTRIBUTES` order (league year → values). */
  ratingHistory?: Record<number, number[]>;
  /** Measurables and combine drills, taken once (as a prospect, or when he entered the league). */
  combine?: Combine;
  /** What the player weighs in a negotiation; 0–1 each. */
  personality: Personality;
  /** Hidden makeup (1–20 each). Never shown as numbers: scouts describe it in words (`characterRead`). */
  traits: Traits;
  /** On-field habits and their grip (1 = starting to show, 2 = established, 3 = ingrained): see `quirks.ts`. */
  quirks?: Partial<Record<QuirkId, number>>;
  /** Marbles left in his quirk bag this league year (quirk ids, `fix:<id>`, `blank`). */
  quirkBag?: Record<string, number>;
  /** Recent quirks gained and lost (week 0 = the offseason), oldest first. */
  quirkLog?: { id: QuirkId; change: 'gained' | 'lost'; season: number; week: number }[];
  /** Between games, from his quirks: shaken for his next game (a beaten QB), a kicker's slump. */
  form?: { shaken?: boolean; slump?: { season: number; untilWeek: number } };
  /** Season year → accumulated stats. */
  stats: Record<number, StatLine>;
  /** Season year → the teams he played for that season, in order (regular season). Older saves may lack early years. */
  statTeams?: Record<number, number[]>;
  /**
   * Season year → team id → that team's share of `stats`. Only kept for seasons split between teams
   * (a trade or a mid-season signing); a one-team season's line is simply `stats[season]`.
   */
  splitStats?: Record<number, Record<number, StatLine>>;
  /** Index into `ORIGINS` (`data/origins.ts`): his college, Pathway country or the CFL. Public; never read by play. */
  origin?: number;
  /** CFL arrivals with no NFL season yet: seasons up north, counted as half film by `knowledge`. */
  cflSeasons?: number;
  /** Optional picture URL (or data: URI) supplied by a roster mod; the UI shows a placeholder otherwise. */
  portrait?: string;
  /** What he is hurt with right now, if anything (see `injuries.ts`). */
  injury?: Injury;
  /** Every injury that cost him time, oldest first. Public: the league's injury reports. */
  injuries?: InjuryRecord[];
  /** Match condition, 0–100 (100 = fresh, the default): each game takes some, each week gives some back. */
  condition?: number;
  /** On injured reserve: off the 53, and out at least `IR_MIN_WEEKS`. Weeks counts the weeks he has served. */
  ir?: { season: number; week: number; weeks: number };
  /** A new position his coaches are teaching him (`training.ts`). He plays his old one until it's done. */
  learning?: Learning;
  /** Every position change, oldest first. The first `from` is the body's position: its physical aging stays his. */
  moves?: PositionMove[];
  /** This league year's development, rolled once and still landing in steps (`development.ts`). Gone once the year has landed. */
  dev?: DevYear;
}

/** A year of development on its way: the roll's inputs (its targets come back from the seed) and what has landed so far. */
export interface DevYear {
  /** League year it was rolled in (he was a year younger than he is now). */
  season: number;
  /**
   * The roll's inputs (`DevContext`): last season's games played (`share` instead when it wasn't a whole
   * number of games), and his coaches' effect at the time, kept only where the roll read it: the growth
   * rate under 26, the decline effects (physical, technical, mental) once a family of his is fading.
   */
  games?: number;
  share?: number;
  rate?: number;
  decline?: number[];
  bodyAs?: Position;
  /** The ceiling the year was rolled with, under 26 (a settle during the year moves only the next roll). Missing before v57. */
  potential?: number;
  /** Share of the year released so far (0–1). */
  done: number;
  /** Integer change applied so far to each rating, in `ATTRIBUTES` order; trailing zeros are dropped (missing = 0). */
  applied: number[];
}

/** A position-learning plan. Nothing here is ever shown for another team's player. */
export interface Learning {
  to: Position;
  /** Learning-weeks banked (`training.ts`); ready when it reaches the move's weeks. */
  done: number;
  /** Hidden pace, 0.85–1.15, rolled once when the plan starts. */
  pace: number;
  /** League year it started. */
  since: number;
  /** The team teaching him: a trade or release ends the plan. */
  teamId: number;
  /** Why his team started it (`training.ts`), shown in the news when he moves. */
  why?: MoveReason;
  /** Reserved for mentoring (docs/TRAINING.md §8): the veteran helping him learn. Unused. */
  mentor?: number;
}

/**
 * Why a team teaches a player a new position. A move needs one: "he's a little better there" isn't a
 * reason to spend a year teaching him (`training.ts`, `motivesFor`).
 */
export type MoveReason = 'hole' | 'nextYear' | 'scheme' | 'upside' | 'reps' | 'age' | 'upgrade' | 'build';

/** A position change, made on cut-down day of league year `season`. */
export interface PositionMove {
  season: number;
  from: Position;
  to: Position;
}

export type InjurySeverity = 'minor' | 'moderate' | 'severe' | 'career-threatening';

/**
 * What a player does about an injury besides resting (the default, no entry): a pain injection to
 * play through a minor one, protective gear to come back early, or a fast-track to heal sooner.
 * Which ones an injury allows, and what each costs: `injuries.ts`, `docs/INJURIES.md`.
 */
export type TreatmentId = 'injection' | 'brace' | 'fastTrack';

/** A current injury. The engine knows `weeksRemaining`; screens show the medical staff's estimate. */
export interface Injury {
  /** Key into `INJURY_TYPES` (injuries.ts). */
  type: string;
  severity: InjurySeverity;
  /** Weeks he will still miss (each week of the calendar takes one off, games or not). */
  weeksRemaining: number;
  /** The medical staff's estimate of `weeksRemaining`, low to high; it counts down with it. */
  estimate: [number, number];
  /** When it happened (week 0 = the offseason). */
  season: number;
  week: number;
  /** In a game or on the practice field. */
  where: 'game' | 'practice';
  /** The treatment he agreed to, if any (absent = resting it). */
  treatment?: TreatmentId;
  /** In protective gear: weeks still to sit before he can play in it (absent or 0 = playing). */
  braceWait?: number;
  /** In protective gear: rating points he plays down on until it heals (the engine reads it in `skill`). */
  braceCost?: Partial<Record<Attribute, number>>;
  /** A concussion: in the protocol, cleared by a weekly draw instead of a set layoff. */
  protocol?: ConcussionProtocol;
}

/**
 * The concussion protocol (`injuries.ts`, concussions): a bag of marbles built from his concussion
 * history, one drawn each week, never put back. An all-clear ends it; a week with symptoms doesn't;
 * a setback brings the symptoms back (two more of them go in).
 */
export interface ConcussionProtocol {
  clear: number;
  symptoms: number;
  setbacks: number;
  /** The week of his latest setback, if he has had one. */
  setbackWeek?: number;
  /** Sit him one more week once he's cleared (his team's call). */
  hold?: true;
  /** He shut himself down for the season to think about his future: no tests, back next year. */
  shutdown?: true;
}

/** One injury in a player's history. */
export interface InjuryRecord {
  type: string;
  severity: InjurySeverity;
  season: number;
  week: number;
  /** Weeks it was expected to cost when it happened. */
  weeks: number;
  /** Physical ratings it cost him for good, if any. */
  scar?: Partial<Record<Attribute, number>>;
  /** An old injury made worse by playing through it. */
  aggravated?: true;
  /** Healed on a fast-track: back sooner, and likelier to go again in his first weeks back. */
  fastTracked?: true;
  /** A concussion: his team held him a week after the protocol cleared him (counted in `weeks`). */
  held?: true;
}

/** Combine results. A missing drill means he skipped it. */
export interface Combine {
  /** Arm length and hand size, inches. */
  arms: number;
  hands: number;
  /** 40-yard dash and the agility drills, seconds. */
  forty?: number;
  shuttle?: number;
  cone?: number;
  /** 225 lb bench press, reps. */
  bench?: number;
  /** Vertical and broad jump, inches. */
  vertical?: number;
  broad?: number;
}

export interface Personality {
  /** Agent greed: how far above market the opening ask sits. */
  greed: number;
  /** Discount for staying with the current team. */
  loyalty: number;
  /** How much a contender's pitch matters. */
  winning: number;
  /** Agent patience: how many lowball offers before talks break down. */
  patience: number;
}

/**
 * Hidden traits on the ratings scale (1–20, average 10.5). Each one moves something the player does:
 * see `traits.ts` for the hooks.
 */
export interface Traits {
  /** Work ethic: how much of his ceiling he reaches, and how well he keeps his game as he ages. */
  workEthic: number;
  /** Body clock: when the decline starts and how steep it is, and how long he lasts. */
  durability: number;
  /** Composure under the whistle (high = calm): linemen with a short fuse draw more flags. */
  temperament: number;
  /** Injury resistance (high = rarely hurt): soft tissue and bone that hold up to a season of hits. */
  injuryResistance: number;
  /** Natural fitness: how much condition a game takes, how fast it comes back, and how well he heals. */
  naturalFitness: number;
  /** Versatility: how well he plays away from his own position, and how fast he learns a new one (`familiarity.ts`). */
  versatility: number;
  /** Leadership: how much the room follows him (mentoring, captains, calming a feud). */
  leads: number;
  /** Poise: how he holds up when it counts (the pressure habits in his marble bag). */
  poise: number;
  /** Controversy: how readily he says it out loud (feuds, speaking out). */
  controversy: number;
  /** Sportsmanship: how clean he plays (roughing, unnecessary roughness, face masks). */
  sportsmanship: number;
}

export type StaffRole = 'director' | 'collegeScout' | 'proScout';
/** A known appointment boundary; weeks are the next game week, and 0 in the offseason. */
export interface CareerDate {
  season: number;
  phase: Phase;
  week: number;
}

export interface StaffAppointment {
  teamId: number;
  role: StaffRole;
  start: CareerDate;
  end?: CareerDate;
  reason?: 'released' | 'promoted' | 'gm';
}
/** Position groups a scout can specialise in. Kickers and punters are the Director's job. */
export type ScoutFocus = 'skill' | 'line' | 'front' | 'back';

/** A member of a front office's scouting department (or a candidate on the market). */
export interface Staff {
  id: number;
  firstName: string;
  lastName: string;
  role: StaffRole;
  /** Set once at creation with the name (`newIdentity`), so the name, the avatar and the text agree. Absent = a man. */
  woman?: true;
  age: number;
  /** Reading what a player is today (1–20). */
  evaluation: number;
  /** Reading what a player will become (1–20). */
  projection: number;
  /** Scouts only: the position group he knows best. */
  focus?: ScoutFocus;
  /** null = on the market. */
  teamId: number | null;
  /** League years he has sat on the market unhired (counted at each new league year; absent on a staff). Three and he's gone. */
  idle?: number;
  /** Salary in $K per league year, through the end of league year `through`. null while on the market. */
  contract: { salary: number; through: number } | null;
  /** Only appointments observed by this save; promotions preserve the same person's history. */
  appointments?: StaffAppointment[];
}

/** Severance owed to a dismissed staff member, charged to that league year's staff budget. */
export interface StaffSeverance {
  season: number;
  amount: number;
  name: string;
}

/** An owner's promise to keep a particular person in a particular coaching chair. */
export interface OwnerCoachMandate {
  coachId: number;
  role: CoachRole;
  room?: CoachRoom;
  issued: CareerDate;
  through: number;
  reason: string;
}

export type CoachRole = 'headCoach' | 'offCoord' | 'defCoord' | 'positionCoach' | 'strengthCoach' | 'stCoord';
/** Position rooms, each with its own coach. Kickers and punters have none: the special teams coordinator coaches them. */
export type CoachRoom = 'QB' | 'RB' | 'WR' | 'OL' | 'DL' | 'LB' | 'DB';

/**
 * How a play-caller likes to call a game, −1…1 (0 = league average). Style, not skill: it changes the
 * mix, never the execution. It belongs to the coach, so it moves with him when he changes jobs.
 */
export interface CoachStyle {
  /** Passes more (+) or runs more (−) than the situation calls for. Offensive coordinators (they call the plays). */
  passLean?: number;
  /** Goes for it on fourth down more (+) or kicks more (−). Head coach. */
  fourthDown?: number;
}

/** A season in one role: future midseason promotions can produce several rows in the same year. */
export interface CoachSeason {
  season: number;
  teamId: number;
  role: CoachRole;
  room?: CoachRoom;
  /** Exact results in this role. Absent on legacy seasons, whose team record is used instead. */
  record?: ServiceRecord;
}

/** Results credited as games finish, so a departure cannot erase a partial season. */
export interface ServiceRecord {
  fromWeek: number;
  throughWeek: number;
  regular: { w: number; l: number; t: number };
  playoffs: { w: number; l: number; round: PlayoffRound } | null;
  champion: boolean;
}

/** A member of a team's coaching staff (or a candidate on the market). */
export interface CoachGameReport {
  /** At most four accepted late-game calls, independent of replay retention and habit modifiers. */
  defensiveDecisions?: {
    quarter: number;
    clock: number;
    down: number;
    distance: number;
    call: 'base' | 'runD' | 'passD' | 'blitz';
    outcome: 'fourthDownStop' | 'turnover' | 'touchdownAllowed';
    text: string;
    marginBefore: number;
    marginAfter: number;
  }[];
  coachId: number;
  name: string;
  role: CoachRole;
  teamId: number;
  opportunities: Partial<Record<CoachQuirkId, number>>;
  choices: Partial<Record<CoachQuirkId, number>>;
  uses: Partial<Record<CoachQuirkId, number>>;
  events: { quirk: CoachQuirkId; quarter: number; clock: number; text: string; outcome?: string }[];
}
export interface CoachAdvice {
  /** Durable publication stamps survive mail deletion and history trimming. */
  noted?: Partial<Record<'offer' | 'followup' | 'revisit', number>>;
  review?: { week: number; promising: boolean; adopted: boolean };
  revisit?: { week: number; text: string };
  season: number;
  week: number;
  coachId: number;
  coachName: string;
  position: Position;
  playerId: number;
  playerName: string;
  aheadId: number;
  aheadName: string;
  reason: string;
  applied: boolean;
  baselineGames: number;
  baselineStats?: StatLine;
  resolved?: string;
}

export interface Coach {
  teachingBlock?: string;
  teachingNote?: {
    season: number;
    week: number;
    playerId: number;
    playerName: string;
    habit: QuirkId;
    coachName: string;
    receptive: boolean;
  };
  quirks?: Partial<Record<CoachQuirkId, number>>;
  quirkBag?: Record<string, number>;
  quirkEvidence?: Partial<Record<CoachQuirkId, number>>;
  quirkLog?: { id: CoachQuirkId; grip: number; from?: number; season: number; week: number }[];
  quirkOrigin?: { id: CoachQuirkId; playerId: number; source: string };
  quirkYear?: number;
  quirkWeek?: string;
  quirkIntroduced?: string[];
  id: number;
  firstName: string;
  lastName: string;
  role: CoachRole;
  /** Position coaches only: the room he runs. */
  room?: CoachRoom;
  age: number;
  /** Youth development (1–20): how fast players under 26 grow toward their ceiling. */
  youth: number;
  /** Veteran care (1–20): how gently players past their prime decline. */
  veterans: number;
  /** Head coaches (fourth downs) and offensive coordinators (run/pass): how they call a game. */
  style?: CoachStyle;
  /** Coordinators: the offense, or the front and coverage, they run (see `schemes.ts`). */
  scheme?: CoachScheme;
  /** null = on the market. */
  teamId: number | null;
  /** League years he has sat on the market unhired (counted at each new league year; absent on a staff). Three and he's gone. */
  idle?: number;
  /** League year he joined his current team (tenure). */
  since?: number;
  /** His last job, for the market ("Head coach, NYX: fired after 3–14"). */
  lastJob?: string;
  /** Observed service by season, team and role; legacy rows look up the team's historical record. */
  career?: CoachSeason[];
  /** A temporary leadership appointment; conversion to permanent is always explicit. */
  interim?: boolean;
  /** An interim head coach promoted from a coordinator chair still runs it until the offseason. */
  actingAs?: 'offCoord' | 'defCoord';
  /** A head coach runs a side whose coordinator chair is empty, unless his team switched it off for that side. */
  coverOff?: ('offCoord' | 'defCoord')[];
  /** Observed interim takeovers survive dismissal, permanent hiring and retirement. */
  interimAppointments?: { season: number; teamId: number; week: number }[];
  /** A former player: his playing career is that player's record in `league.players`. */
  playerId?: number;
  /** Salary in $K per league year, through the end of league year `through`. null while on the market. */
  contract: { salary: number; through: number } | null;
}

export type MedicRole = 'doctor' | 'physio' | 'scientist';

/** A member of a team's medical staff (or a candidate on the market). Ratings are public, like coaches'. */
export interface Medic {
  id: number;
  firstName: string;
  lastName: string;
  role: MedicRole;
  /** Set once at creation with the name (`newIdentity`), so the name, the avatar and the text agree. Absent = a man. */
  woman?: true;
  age: number;
  /** Physiotherapy (1–20): rehab that gets injured players back sooner. */
  physio: number;
  /** Sports science (1–20): load management that keeps players fresh and off the table. */
  science: number;
  /** null = on the market. */
  teamId: number | null;
  /** League years he has sat on the market unhired (counted at each new league year; absent on a staff). Three and he's gone. */
  idle?: number;
  /** League year he joined his current team (tenure). */
  since?: number;
  lastJob?: string;
  /** Salary in $K per league year, through the end of league year `through`. null while on the market. */
  contract: { salary: number; through: number } | null;
}

export interface Conference {
  name: string;
  abbrev: string;
}

export interface Division {
  name: string;
  conference: number;
}

export type DepthChart = Record<Position, number[]>;

/** A player lined up at another position: where, and who put him there. */
export interface PlayingAt {
  pos: Position;
  by: 'staff' | 'user';
  /** When staff lined him up there (its cover note to you is filed once per move). */
  since?: { season: number; week: number };
}

export interface Team {
  coachAdvice?: CoachAdvice[];
  /** Season-long suppression is independent of the six readable threads and the coach who proposed them. */
  coachAdviceMemory?: {
    season: number;
    players: number[];
    pairs: string[];
    positions: Partial<Record<Position, number>>;
  };
  id: number;
  city: string;
  name: string;
  abbrev: string;
  conference: number;
  division: number;
  colors: [string, string];
  depthChart: DepthChart;
  /** The kick and punt returners the user picked (player ids); unset, the lineup picks the best backup. */
  returners?: { kr?: number; pr?: number };
  /** If true the depth chart is rebuilt from ratings before every game. */
  autoDepth: boolean;
  /**
   * Players lined up away from their own position ("Play at…"), by player id: where, and whether the user or the
   * staff put him there (staff sends its own back once the position is healthy). Kept by auto-sort too.
   */
  playingAt?: Record<number, PlayingAt>;
  /** Dead money charged to this team, by league year. */
  deadMoney: DeadMoney[];
  /** Unused cap rolled over from the previous league year, in $K. */
  carryover: number;
  /** Post-June 1 release designations used this league year (max 2). */
  postJune1Used: number;
  /** Player franchise-tagged this league year, if any. */
  taggedId?: number | null;
  /** AI general manager tendencies (the user's team keeps one too, unused). */
  gm: GmTraits;
  /** Persistent person currently running this front office; null only during an appointment transition. */
  gmId: number | null;
  /**
   * Owner's spending on football staff relative to the league norm (the user's is 1): scales both the
   * scouting and the coaching budget. Staff pay is not on the cap.
   */
  staffBudgetMult: number;
  staffDead: StaffSeverance[];
  /** League year the team last finished over its coaching budget: the owner won't go over again the year after. */
  coachOverspent?: number;
  /** Severance owed to dismissed coaches, charged to the coaching budget. */
  coachDead: StaffSeverance[];
  /** Coaches this club let go this year are excluded from its own immediate replacements. */
  coachDepartures?: { season: number; ids: number[] };
  /** Promises follow the club, including when its GM changes. Expired promises remain on file. */
  ownerMandates: OwnerCoachMandate[];
  /** Makes opening-year owner decisions idempotent across saves and repeated calendar calls. */
  ownerReviewSeason?: number;
  leadershipReview?: LeadershipReview;
  leadershipWeek?: { season: number; week: number };
  /** The owner's patience and the heat on the GM and head coach (`ownerBag.ts`). */
  ownerBag?: OwnerBag;
  /** Severance owed to dismissed medical staff, charged to the medical budget. */
  medicalDead: StaffSeverance[];
  /** False when the user manages injuries by hand (IR moves, replacements). AI teams always delegate. */
  autoInjuries?: boolean;
  /** Practice squads: false when you run the squad yourself (refills, call-ups, futures). Absent: your staff does. */
  autoSquad?: false;
  /** Injured-reserve return designations used, by league year (`IR_RETURNS` per season). */
  irReturns?: Record<number, number>;
  /**
   * Position moves (`training.ts`). `coachesDecide`: the coaches start their own suggestion (the user's
   * team only; AI teams always do). `passed`: suggestions turned down, player id → league year.
   */
  training?: { coachesDecide?: boolean; passed?: Record<number, number> };
  /**
   * Where the front office sees itself (`trade/plans.ts`) and the league year it got there: kept so
   * a team on the line doesn't flip between buying and selling from one week to the next.
   */
  stance?: { mode: Stance; since: number };
}

/** Contend, bubble, retool or rebuild: it decides who buys and who sells. */
export type Stance = 'contend' | 'bubble' | 'retool' | 'rebuild';

/** What one side of a trade sends. */
export interface TradeSide {
  teamId: number;
  players: number[];
  picks: number[];
  /**
   * Salary it keeps paying ($K of this season's base still owed, by player): booked as its dead
   * money, taken off the buyer's base. Never below the minimum the player is owed.
   */
  retain?: Record<number, number>;
}

/** What a trade was, for the news: a contender's rental, a rebuilder's sale, a star, a swap, a cap dump, next year's pick for this year's. */
export type DealKind =
  | 'rental'
  | 'buy'
  | 'sale'
  | 'star'
  | 'swap'
  | 'dump'
  | 'futureSwap'
  | 'cutdown'
  | 'casualty'
  /** A pick moved during the draft. */
  | 'draft'
  | 'user';

/** One player's exam by the buyer's doctor (`trade/physicals.ts`); `note` is the doctor's words. */
export interface Physical {
  playerId: number;
  result: 'passed' | 'failed' | 'concerns' | 'rehab';
  note: string;
}

/** A trade with its assets, kept for trade trails and the market's memory (the transaction log keeps only text). */
export interface TradeRecord {
  season: number;
  phase: Phase;
  week: number;
  sides: [TradeSide, TradeSide];
  kind: DealKind;
  /** Players their new team extended on arrival (the trade-and-extend), with the deal each was traded on. */
  extended?: { playerId: number; tradedOn: Contract }[];
  /** The players' physicals, when any were flagged. */
  physicals?: Physical[];
}

/** A front office watching another team's player: interest builds over market moments and fades when nothing comes of it. */
export interface TradeInterest {
  teamId: number;
  playerId: number;
  /** 1 watching, 2 asking around, 3 ready to deal. */
  level: number;
  /** The market moment it was last raised (`TradeMarket.moment`). */
  at: number;
}

/** Public talk about the market, from what front offices are really doing (see `trade/market.ts`). */
export interface Rumor {
  id: string;
  season: number;
  phase: Phase;
  week: number;
  kind: 'shopping' | 'interest';
  teamIds: number[];
  playerId: number;
  text: string;
}

/** Your say on one of your players: never asked about, or on the block (absent: available). */
export type TradeStatus = 'untouchable' | 'listed';

/**
 * An AI team's offer to the user (`trade/offers.ts`). `sides[0]` is the AI team's, `sides[1]` yours.
 * It stays open until you next advance the calendar (play a week, take an offseason step).
 */
export interface TradeOffer {
  id: number;
  teamId: number;
  sides: [TradeSide, TradeSide];
  /** What the deal is; an enquiry carries no package ("Is your CB available?"). */
  kind: DealKind | 'enquiry';
  /**
   * Why he called: he wants your player, he's selling one you need, he needs cap room, he's answering your shop or
   * your counter, he wants to move up to your pick on the clock (`draft`), or his price for his pick (`ask`).
   */
  reason: 'bid' | 'pitch' | 'dump' | 'enquiry' | 'shop' | 'counter' | 'draft' | 'ask';
  season: number;
  phase: Phase;
  week: number;
  /** The market moment it was made at (`TradeMarket.moment`). */
  moment: number;
  status: 'pending' | 'accepted' | 'declined' | 'answered' | 'expired' | 'withdrawn';
  /** The one line the card shows once it is resolved: what happened to it. */
  outcome?: string;
  /** Counters he'll still hear before he walks away; at 0 his counter is his final offer. */
  patience: number;
  final?: boolean;
  /** What he gives up in it, at the league's prices: an offer after a decline must beat it by 10%. */
  worth: number;
  /** The offer this counter answers. */
  replyTo?: number;
}

/** Your dealings with one AI GM: proposals this moment, who he won't ask about, the decline cooldowns, and his trust in you. */
export interface TradeTalks {
  /** The market moment `asks` counts for. */
  moment: number;
  /** Your proposals to him this moment (about four, then he's done talking). */
  asks: number;
  /** Talks are off until this moment passes (a final offer turned down). */
  offUntil?: number;
  /** −1 … 1: he trusts you more after fair deals, less after rejections and pulled counters; drifts back to 0. */
  trust: number;
  /** Players he won't ask about until a moment ("Not for sale", a declined offer), and the offer he'd have to beat. */
  cooldowns: Record<number, { until: number; worth: number }>;
}

/**
 * A deal of yours waiting on your decision after a physical flagged a player: your doctor's (you're
 * buying) or theirs (they're buying yours, and come back with `reduced`). It lapses when you advance.
 */
export interface TradeExam {
  sides: [TradeSide, TradeSide];
  aiId: number;
  kind: DealKind;
  tag?: string;
  exams: Physical[];
  by: 'yours' | 'theirs';
  reduced?: [TradeSide, TradeSide];
  /** The offer it came from, and the players you chose to release to make room. */
  offerId?: number;
  release?: number[];
}

/** The trade market's memory (`trade/market.ts`): what was traded, who is watching whom, what's being said, what's on your desk. */
export interface TradeMarket {
  /** Market moments so far (a week up to the deadline, an offseason step): interest fades by them. */
  moment: number;
  /** The last five league years of trades. */
  history: TradeRecord[];
  interest: TradeInterest[];
  /** The latest rumors, oldest first. */
  rumors: Rumor[];
  nextOfferId: number;
  /** Offers to you: the pending ones and the last 60 resolved. */
  offers: TradeOffer[];
  /** Your players' statuses (absent: available). */
  status: Record<number, TradeStatus>;
  /** Your dealings with each AI GM, by team id. */
  talks: Record<number, TradeTalks>;
  /** The moment each of your players was last shopped (once a moment). */
  shopped: Record<number, number>;
  /** A deal of yours waiting on your call after its physical. */
  exam?: TradeExam;
  /** The pick (id) of yours the draft-day offers were last made for: once a pick. */
  clockPick?: number;
  /** The pick (id) you last shopped on the clock. */
  shoppedPick?: number;
  /** The overall on the clock when you last called the teams ahead of you. */
  calledAhead?: number;
}

export interface DeadMoney {
  season: number;
  amount: number;
  playerId: number;
  note: string;
}

/** Numeric traits rather than scripted behaviour, so AI front offices disagree with each other. */
export interface GmTraits {
  archetype: string;
  /** Contention focus: values veterans now over picks later. */
  winNow: number;
  /** Willingness to restructure, push money into void years. */
  capAggression: number;
  /** Old-school pick chart (steep) vs analytics chart (flat). */
  pickChart: 'johnson' | 'analytics';
  /** Per-year discount on future draft picks (0.15–0.40). */
  futureDiscount: number;
  /** Pays its own stars early and is reluctant to trade them. */
  loyalty: number;
  /** Wants a bigger win in any trade. */
  stubbornness: number;
}

export interface GmAppointment {
  teamId: number;
  start: CareerDate;
  end?: CareerDate;
  interim: boolean;
  through: number;
  terms?: GmJobTerms;
  /** Generated opening-world tenure, without inventing prior game results. Not used by migrated saves. */
  priorSeasons?: number;
  reason?: 'dismissed' | 'expired' | 'retired' | 'permanent';
}

export interface GmSeason {
  season: number;
  teamId: number;
  record?: ServiceRecord;
}

/** A GM's identity outlives any one club, including their former scouting career. */
export interface GeneralManager {
  id: number;
  firstName: string;
  lastName: string;
  nameEdited?: true;
  woman?: true;
  age: number;
  /** Stable across scouting promotions, team changes, unemployment and retirement. */
  appearanceId: string;
  teamId: number | null;
  retired?: true;
  /** While employed, tendencies live in their club's `gm`; on departure they move here. */
  traits?: GmTraits;
  appointments: GmAppointment[];
  career: GmSeason[];
  /** Opening incumbents are supplied with the world; all later entrants come from scouting directors. */
  origin: 'opening' | 'director';
  scouting?: Staff;
}

/** The owner's marble bag (`ownerBag.ts`). Heat belongs to the people named; a new face starts clean. */
export interface OwnerBag {
  /** The last finished season whose result went in. */
  season: number;
  calm: number;
  gm: number;
  coach: number;
  gmId: number | null;
  coachId: number | null;
}

export interface LeadershipReview {
  season: number;
  week: number;
  gmId: number;
  coachId?: number;
  outcome: 'back' | 'warning' | 'coachChange' | 'gmChange' | 'bothChange';
  /** Private instructions, visible only to the club's current GM. */
  reason: string;
}

export interface LeadershipEvent {
  id: number;
  date: CareerDate;
  teamId: number;
  kind:
    | 'gmDismissed'
    | 'gmRetired'
    | 'gmHired'
    | 'gmExtended'
    | 'coachDismissed'
    | 'coachInterim'
    | 'coachPermanent'
    | 'warning'
    | 'coachChange';
  gmId?: number;
  coachId?: number;
  /** Confirmed public news or explicitly qualified reporting. Never the private instruction. */
  report: string;
  privateText?: string;
}

/** The Arena Gazette's tables (`gazette.ts`), saved with the column as they read when filed. */
export type GazetteUnit = 'epa' | 'pct' | 'perDropback' | 'rushSuccess' | 'pressureRate';
export interface GazetteRow {
  teamId: number;
  playerId?: number;
  name: string;
  value: number;
  rank: number;
}
export interface GazetteTable {
  title: string;
  unit: GazetteUnit;
  players?: true;
  /** Lower is better (a defense's numbers allowed). */
  lowerBetter?: true;
  rows: GazetteRow[];
}

/** One of the director's recommendations, as it read when filed. */
export interface AdviceRow {
  kind: 'buy' | 'sell' | 'sign';
  playerId: number;
  /** His club when filed; null for a free agent. */
  teamId: number | null;
  name: string;
  position: Position;
  why: string;
  /** The director's ballpark: "likely a 4th", "about $8.5M a year". */
  price: string;
  /** For a sale: the club to open talks with (it asked about him, or it's buying). */
  partnerId?: number;
}

export interface CarouselRow {
  group: 'out' | 'hired' | 'extended' | 'hotSeat' | 'coaches';
  teamId: number;
  gmId?: number;
  coachId?: number;
  name: string;
  line: string;
}

export interface GmJobOffer {
  teamId: number;
  through: number;
  expiresRound: number;
  incumbent?: boolean;
  /** The owner's offer to extend the user in the job he already holds: accept, or decline and go into the job market. */
  extension?: boolean;
  /** A quiet-year conditional offer replaces this incumbent only on acceptance. */
  replacesGmId?: number;
  terms?: GmJobTerms;
}

export interface GmJobTerms {
  expectation: string;
  staffing: string[];
}

/** Staff in their actual roles when a game began, independent of later employment changes. */
export interface GameManagement {
  home: { gmId: number | null; coaches: { id: number; role: CoachRole; room?: CoachRoom }[] };
  away: { gmId: number | null; coaches: { id: number; role: CoachRole; room?: CoachRoom }[] };
}

export interface DraftPick {
  id: number;
  /** Draft year (the draft held in that league year's offseason). */
  season: number;
  round: number;
  originalTeamId: number;
  ownerId: number;
  /** Overall slot once the order is known. */
  overall?: number;
  /** The player taken with it, once used. */
  playerId?: number;
  /** Where the league consensus ranked that player in his class: reach or steal. */
  consRank?: number;
  /** Moved during the draft: who sent it and what it got (copied to the player it's used on). */
  moved?: PickDeal;
}

/** A pick traded during the draft: the team that sent it and what it got for it, as pick labels ("No. 18"). */
export interface PickDeal {
  from: number;
  got: string[];
}

/** A user negotiation with a player (re-signing or free agency). Asks are derived, not stored. */
export interface Negotiation {
  playerId: number;
  teamId: number;
  /** Lowball offers left before the agent walks away (insults cost two). */
  patience: number;
  status: 'open' | 'broken';
  /** Talks broken off in this phase reopen in the next one. */
  brokenPhase?: Phase;
  message?: string;
}

export interface Transaction {
  season: number;
  phase: Phase;
  week: number;
  teamIds: number[];
  kind:
    | 'sign'
    | 'resign'
    | 'release'
    | 'waiver'
    | 'claim'
    | 'trade'
    | 'restructure'
    | 'tag'
    | 'option'
    | 'draft'
    | 'retire'
    | 'staff'
    | 'coach'
    | 'gm'
    | 'injury'
    | 'medical'
    | 'position'
    | 'elevation';
  text: string;
}

export type InboxCategory =
  | 'awards'
  | 'contracts'
  | 'retirement'
  | 'medical'
  | 'scouting'
  | 'matchup'
  | 'trades'
  | 'staff'
  | 'league';

/** Where a message's buttons go: a player's card, a team's roster, a game's box score, a front-office tab, the cap sheet or the standings. */
export type InboxAction =
  | { kind: 'player'; playerId: number }
  | { kind: 'team'; teamId: number }
  | { kind: 'game'; gameId: number }
  | { kind: 'resign' }
  | { kind: 'fa'; pos?: Position }
  | { kind: 'draft' }
  | { kind: 'coaches' }
  | { kind: 'gms' }
  | { kind: 'staff' }
  | { kind: 'medical' }
  | { kind: 'trades' }
  | { kind: 'cap' }
  | { kind: 'standings' };

/** Public, event-time facts retained with a rookie checkpoint letter. */
export interface RookieReportRow {
  playerId: number;
  name: string;
  position: Position;
  round: number;
  pick: number;
  snaps: number | null;
  production: string;
  context: string;
  contributed: boolean;
}

export interface LeagueNewsReport {
  division: string;
  table?: 'division' | 'team' | 'yearOverYear';
  teamId: number;
  season: number;
  standings: { teamId: number; name: string; w: number; l: number; t: number; gap: number; streak: string }[];
  stats: { label: string; current: string; previous: string; currentRank: string; previousRank: string }[];
}

export interface InboxMessage {
  /** Internal correspondence belongs to the club, even after its GM changes jobs. */
  organizationId?: number;
  /** Stable coaching thread observation, used only to avoid repeating it in other mail. */
  coachNoteKey?: string;
  /** Snapshot of a staff recommendation within an existing report, also retained in body for search. */
  coachNote?: { coachId: number; coachName: string; text: string; kind: 'recommendation' | 'followup' | 'revisit' };
  /** Built from what the message is about, so delivering twice can't duplicate it. */
  id: string;
  season: number;
  phase: Phase;
  /** The week it's dated (0 in the offseason). */
  week: number;
  from: string;
  /** Another club's front office wrote it (offers, deals): the inbox draws it in that club's colours. */
  fromTeamId?: number;
  /** The sender's staff card, when one of the team's own staff signs it. */
  fromCard?: { kind: 'coach' | 'scout' | 'medic'; id: number };
  category: InboxCategory;
  subject: string;
  body: string;
  leagueReport?: LeagueNewsReport;
  /** The head coach's rundown for a new GM, as filed: unit ranks on our scouts' read (1 = the league's best), key players, prospects. */
  rundown?: { offenseRank: number; defenseRank: number; offense: number[]; defense: number[]; prospects: number[] };
  /** The director's market report: per trade (in `marketTrades` order), his note on what it means for us and whether SNN ran it, as filed. */
  marketNotes?: { note?: string; snn?: true }[];
  /** The Arena Gazette's numbers column (`gazette.ts`): its edition and tables, as filed. */
  gazette?: { edition: string; tables: GazetteTable[] };
  /** The director's recommendations, as they read when filed (`directorAdvice.ts`). */
  advice?: { lean?: 'buy' | 'targeted' | 'sell'; rows: AdviceRow[] };
  /** SNN's offseason front-office digest, as it read when filed: one row per change around the league. */
  carousel?: CarouselRow[];
  tradeReport?: {
    period?: string;
    exchanges: { teamId: number; receives: string }[];
    rumors: { playerId: number; name: string; position: Position; clubId: number; status: string; sourceId?: string }[];
  };
  rookieReport?: { teamId: number; games: number; rows: RookieReportRow[] };
  read: boolean;
  actions: InboxAction[];
  /** Filed away by the user: out of the inbox, under Archived. */
  archived?: true;
  /** Deleted by the user: hidden everywhere, but kept so the same news is never filed again. */
  deleted?: true;
}

export type PlayoffRound = 'WC' | 'DIV' | 'CONF' | 'FINAL';

/** A side's advanced numbers for one game, as the offense (`analytics.ts`); its defense's are the opponent's. */
export interface AdvancedStats {
  /** Dropbacks and designed runs that counted (kneels and spikes aside). */
  plays: number;
  success: number;
  epa: number;
  explosive: number;
  dropbacks: number;
  passSuccess: number;
  passEpa: number;
  rushes: number;
  rushSuccess: number;
  rushEpa: number;
  /** Dropbacks with a pass rusher getting home or forcing the quarterback off his spot. */
  pressured: number;
}

export interface TeamGameStats {
  firstDowns: number;
  /** Plays that counted: runs, passes and sacks. A play a flag wipes out isn't one, as in the NFL's count. */
  plays: number;
  totalYds: number;
  passYds: number;
  rushYds: number;
  passAtt: number;
  passCmp: number;
  rushAtt: number;
  sacked: number;
  turnovers: number;
  penalties: number;
  penaltyYds: number;
  /** Accepted penalties by kind, what the officiating crew pages read (games before v15 have none). */
  flags?: Partial<Record<Foul, number>>;
  /** Flags the other side declined, and flags that offset one of theirs (games before v16 have none). */
  declined?: Partial<Record<Foul, number>>;
  offset?: Partial<Record<Foul, number>>;
  thirdDownAtt: number;
  thirdDownConv: number;
  fourthDownAtt: number;
  fourthDownConv: number;
  redZoneAtt: number;
  redZoneTd: number;
  /** Seconds of possession. */
  top: number;
  /** Advanced numbers (`analytics.ts`); games before v52 have none. */
  adv?: AdvancedStats;
}

/** The fouls the engine calls (see `FOULS` in `officials.ts`). */
export type Foul =
  | 'falseStart'
  | 'offside'
  | 'holding'
  | 'passInterference'
  | 'defHolding'
  | 'roughingPasser'
  | 'unnecessaryRoughness'
  | 'faceMask'
  | 'horseCollar'
  | 'unsportsmanlike'
  | 'returnHolding'
  | 'blockInBack'
  | 'kickoffMiss'
  | 'kickoffFormation'
  | 'kickCatch'
  | 'runningIntoKicker'
  | 'roughingKicker';

/**
 * An officiating crew, known by its head referee (see `officials.ts`). Its tendencies are 1–20 like
 * ratings and just as hidden: screens show only what the crew calls, never these numbers.
 */
export interface Crew {
  id: number;
  firstName: string;
  lastName: string;
  /** How many flags of every kind it throws. */
  flagVolume: number;
  /** How often it calls offensive holding. */
  holding: number;
  /** How often it calls pass interference and defensive holding. */
  coverage: number;
  /** How closely it protects the quarterback: roughing the passer (saves before v17 get it on load). */
  qbProtection: number;
}

/** What the replay viewer animates for a logged play. */
export type PlayKind =
  | 'run'
  | 'pass'
  | 'incomplete'
  | 'int'
  | 'sack'
  | 'scramble'
  | 'kneel'
  | 'spike'
  | 'penalty'
  | 'kickoff'
  | 'punt'
  | 'fg'
  | 'xp'
  | 'two';

export interface PlayLogEntry {
  quarter: number;
  clock: number;
  offense: number;
  down: number;
  distance: number;
  /** Ball spot as yards from the offense's own goal line. */
  yardLine: number;
  text: string;
  homeScore: number;
  awayScore: number;
  scoring?: boolean;
  /**
   * Ball path for the replay viewer, in field coordinates: 0 = home goal line,
   * 100 = away goal line (end zones run to -10 and 110). Home attacks toward 100.
   */
  kind?: PlayKind;
  from?: number;
  /** Where a pass or kick comes down. */
  air?: number;
  to?: number;
  /** Direction across the field from the offense's view: -1 left … 1 right. */
  lane?: number;
}

export interface GameResult {
  /** Event-time coaching evidence; independent of replay retention. */
  coaching?: CoachGameReport[];
  homeScore: number;
  awayScore: number;
  overtime: boolean;
  quarters: { home: number[]; away: number[] };
  home: TeamGameStats;
  away: TeamGameStats;
  playerStats: Record<number, StatLine>;
  /** Player id → team id at kickoff, so box scores survive trades and retirements. */
  playerTeams: Record<number, number>;
  plays?: PlayLogEntry[];
  /** Players hurt in the game, in the order it happened, with the doctor's word at the time. */
  injuries?: GameInjury[];
  /**
   * The truth behind `injuries` (player id → diagnosis and any scar). Applied when the result is
   * recorded, then dropped like `condition`: the box score keeps only what the doctor said.
   */
  diagnoses?: Record<number, { injury: Injury; scar?: Partial<Record<Attribute, number>> }>;
  /**
   * Each player's condition at the final whistle. Applied when the result is recorded, then dropped:
   * the game itself doesn't keep it.
   */
  condition?: Record<number, number>;
  /** What the game did to players' form (player id → change): see `recordForm` in `quirks.ts`. */
  form?: Record<number, { shaken?: true; slump?: 'start' | 'end'; clutch?: true }>;
  /** The conditions it was played in (games before v14 have none). */
  weather?: Weather;
  /** The officiating crew that worked it (games before v15 have none). */
  crewId?: number;
}

/** An injury as a box score keeps it: who, when, what, and the estimate as it was made then. */
export interface GameInjury {
  playerId: number;
  teamId: number;
  quarter: number;
  clock: number;
  /** Key into `INJURY_TYPES` (injuries.ts). */
  type: string;
  /** The medical staff's estimate in weeks, frozen at the time (the player's own counts down). */
  estimate: [number, number];
}

/** When a game kicks off: its day of the game week and the time, in minutes after midnight US Eastern. */
export interface Kickoff {
  day: 'thu' | 'sat' | 'sun' | 'mon';
  et: number;
}

export interface Game {
  /** Staff/user plans stay editable until 90 minutes before kickoff; lists are immutable game snapshots. */
  personnel?: { plans: Record<number, GameDayPlan>; elevationsFiled?: true; lists?: Record<number, GameDayList> };
  /** Membership at kickoff, cleared when service is settled with the result. */
  serviceRoster?: ServiceAssignment[];
  id: number;
  season: number;
  /** 1–18 regular season; 19+ playoffs. */
  week: number;
  homeId: number;
  awayId: number;
  playoffRound?: PlayoffRound;
  neutral?: boolean;
  /** Its slot (`season/kickoff.ts`); missing on games from saves before v30. */
  kickoff?: Kickoff;
  /** The slot it was first scheduled in, once the league has flexed it (`season/flex.ts`). */
  flexed?: Kickoff;
  result?: GameResult;
  /** In-flight attribution, consumed when the result is committed to career records. */
  management?: GameManagement;
}

/**
 * `complete` is the gap after the title game. The offseason phases belong to the next league
 * year: `league.season` ticks over when the offseason begins, like the NFL's March new year.
 */
export type Phase = 'regular' | 'playoffs' | 'complete' | 'resign' | 'freeAgency' | 'draft' | 'preseason';
export const OFFSEASON_PHASES: readonly Phase[] = ['resign', 'freeAgency', 'draft', 'preseason'];

export interface SeasonSummary {
  season: number;
  championId: number;
  runnerUpId: number;
  /** Final regular-season records, by team id. */
  records: Record<number, { w: number; l: number; t: number }>;
  /** Playoff teams only: their playoff record and the furthest round they played. Missing in older saves. */
  playoffs?: Record<number, { w: number; l: number; round: PlayoffRound }>;
}

export interface League {
  /** Foundation profile; transactions stay disabled until the complete personnel lifecycle ships. */
  personnel?: PersonnelState;
  /** Save-format version; bump and add a migration when the shape changes. */
  version: number;
  name: string;
  seed: string;
  /** Optional comparison branch for future match outcomes; preserves the world's people and owner personalities. */
  simulationSalt?: string;
  rngState: RngState;
  season: number;
  /** Next week to be played (1-based). */
  week: number;
  phase: Phase;
  userTeamId: number;
  /** The user's persistent identity; does not change when a different team is viewed or managed. */
  userGmId: number;
  gms: Record<number, GeneralManager>;
  nextGmId: number;
  leadership: {
    nextEventId: number;
    events: LeadershipEvent[];
    search?: { season: number; round: number; offers: GmJobOffer[]; playerDeclined?: boolean };
  };
  /** League-year salary cap, in $K, by season (future years are projections until reached). */
  caps: Record<number, number>;
  conferences: Conference[];
  divisions: Division[];
  teams: Team[];
  players: Record<number, Player>;
  nextPlayerId: number;
  games: Game[];
  nextGameId: number;
  history: SeasonSummary[];
  /** Season awards, oldest first, voted when each regular season ends (see `awards.ts`). */
  awards: SeasonAwards[];
  /** Players of the week and month, oldest season first (see `awards.ts`). */
  weeklyAwards: WeeklyAwards[];
  draftPicks: DraftPick[];
  nextPickId: number;
  /** Prospects for the upcoming draft (player ids, teamId null until drafted). */
  draftClass: number[];
  transactions: Transaction[];
  /** The user's mail, oldest first (see `inbox.ts`). Unset until the first delivery. */
  inbox?: InboxMessage[];
  /** Eviction boundary: older mail cannot return; same-date IDs distinguish removed mail from new arrivals. */
  mailFloor?: { date: number; ids: string[] };
  negotiations: Record<number, Negotiation>;
  /** Free-agency day within the current offseason (0 before it opens). */
  faDay: number;
  /**
   * What the user's scouts have learned beyond film, by player id (0–1). Only scouted players
   * appear; everyone else's knowledge is derived (see `engine/scouting.ts`).
   */
  knowledge: Record<number, number>;
  /** Scouting visits left this league year. */
  scoutPoints: number;
  /** Every scouting staff member, employed (teamId set) or on the market (teamId null). */
  staff: Record<number, Staff>;
  nextStaffId: number;
  /** Every coach, employed (teamId set) or on the market (teamId null). */
  coaches: Record<number, Coach>;
  nextCoachId: number;
  /** Coaches who left football (retired, or never hired again) after coaching a season: kept for records. */
  retiredCoaches: Record<number, Coach>;
  /** Every member of a medical staff, employed or on the market (see `medical.ts`). */
  medics: Record<number, Medic>;
  nextMedicId: number;
  /** The league's officiating crews, by id (see `officials.ts`). */
  crews: Crew[];
  /** The trade market's memory (`trade/market.ts`). Unset until the first market moment. */
  market?: TradeMarket;
}
