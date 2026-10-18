import type { SeasonAwards, WeeklyAwards } from './awards';
/**
 * Core data model. Everything here is plain JSON-serializable data so a League
 * can be saved, loaded, exported and modded without custom (de)serializers.
 */
import type { QuirkId } from './quirks';
import type { RngState } from './rng';
import type { Weather } from './weather';

export const POSITIONS = ['QB', 'RB', 'WR', 'TE', 'OL', 'DT', 'EDGE', 'LB', 'CB', 'S', 'K', 'P'] as const;
export type Position = (typeof POSITIONS)[number];

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
  source: 'signing' | 'restructure';
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
  position: Position;
  age: number;
  heightIn: number;
  weightLb: number;
  jersey: number;
  /** Years of pro experience (0 = rookie). */
  experience: number;
  ratings: Ratings;
  /** Hidden ceiling for overall rating (1–20). Revealed only through scouting. */
  potential: number;
  /** null for free agents and retired players. */
  teamId: number | null;
  /** Free agents have no contract. */
  contract: Contract | null;
  retired?: boolean;
  /** `rank`: where the consensus ranked him in his class when he was taken (kept here because old picks are pruned). */
  draft?: { season: number; round: number; pick: number; teamId: number; rank?: number };
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
}

export type InjurySeverity = 'minor' | 'moderate' | 'severe' | 'career-threatening';

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
  /** Playing through it on injections: available, but far likelier to make it worse. */
  injected?: boolean;
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
}

export type StaffRole = 'director' | 'collegeScout' | 'proScout';
/** Position groups a scout can specialise in. Kickers and punters are the Director's job. */
export type ScoutFocus = 'skill' | 'line' | 'front' | 'back';

/** A member of a front office's scouting department (or a candidate on the market). */
export interface Staff {
  id: number;
  firstName: string;
  lastName: string;
  role: StaffRole;
  age: number;
  /** Reading what a player is today (1–20). */
  evaluation: number;
  /** Reading what a player will become (1–20). */
  projection: number;
  /** Scouts only: the position group he knows best. */
  focus?: ScoutFocus;
  /** null = on the market. */
  teamId: number | null;
  /** Salary in $K per league year, through the end of league year `through`. null while on the market. */
  contract: { salary: number; through: number } | null;
}

/** Severance owed to a dismissed staff member, charged to that league year's staff budget. */
export interface StaffSeverance {
  season: number;
  amount: number;
  name: string;
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

/** One season a coach spent on a staff: the team and the chair he held when it ended. */
export interface CoachSeason {
  season: number;
  teamId: number;
  role: CoachRole;
  room?: CoachRoom;
}

/** A member of a team's coaching staff (or a candidate on the market). */
export interface Coach {
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
  /** League year he joined his current team (tenure). */
  since?: number;
  /** His last job, for the market ("Head coach, NYX: fired after 3–14"). */
  lastJob?: string;
  /** Every season he finished on a staff, oldest first (records come from `league.history`). */
  career?: CoachSeason[];
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
  age: number;
  /** Physiotherapy (1–20): rehab that gets injured players back sooner. */
  physio: number;
  /** Sports science (1–20): load management that keeps players fresh and off the table. */
  science: number;
  /** null = on the market. */
  teamId: number | null;
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

export interface Team {
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
  /**
   * Owner's spending on football staff relative to the league norm (the user's is 1): scales both the
   * scouting and the coaching budget. Staff pay is not on the cap.
   */
  staffBudgetMult: number;
  staffDead: StaffSeverance[];
  /** Severance owed to dismissed coaches, charged to the coaching budget. */
  coachDead: StaffSeverance[];
  /** Severance owed to dismissed medical staff, charged to the medical budget. */
  medicalDead: StaffSeverance[];
  /** False when the user manages injuries by hand (IR moves, replacements). AI teams always delegate. */
  autoInjuries?: boolean;
  /** Injured-reserve return designations used, by league year (`IR_RETURNS` per season). */
  irReturns?: Record<number, number>;
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
  kind: 'sign' | 'resign' | 'release' | 'trade' | 'restructure' | 'tag' | 'option' | 'draft' | 'retire' | 'staff' | 'coach' | 'injury' | 'medical';
  text: string;
}

export type InboxCategory = 'awards' | 'contracts' | 'retirement' | 'medical' | 'scouting' | 'matchup' | 'trades';

/** Where a message's buttons go: a player's card, a team's roster, or a front-office tab. */
export type InboxAction = { kind: 'player'; playerId: number } | { kind: 'team'; teamId: number } | { kind: 'resign' } | { kind: 'draft' } | { kind: 'medical' };

export interface InboxMessage {
  /** Built from what the message is about, so delivering twice can't duplicate it. */
  id: string;
  season: number;
  phase: Phase;
  /** The week it's dated (0 in the offseason). */
  week: number;
  from: string;
  /** The sender's staff card, when one of the club's own staff signs it. */
  fromCard?: { kind: 'coach' | 'scout' | 'medic'; id: number };
  category: InboxCategory;
  subject: string;
  body: string;
  read: boolean;
  actions: InboxAction[];
}

export type PlayoffRound = 'WC' | 'DIV' | 'CONF' | 'FINAL';

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
export type PlayKind = 'run' | 'pass' | 'incomplete' | 'int' | 'sack' | 'scramble' | 'kneel' | 'spike' | 'penalty' | 'kickoff' | 'punt' | 'fg' | 'xp' | 'two';

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

export interface Game {
  id: number;
  season: number;
  /** 1–18 regular season; 19+ playoffs. */
  week: number;
  homeId: number;
  awayId: number;
  playoffRound?: PlayoffRound;
  neutral?: boolean;
  result?: GameResult;
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
  /** Save-format version; bump and add a migration when the shape changes. */
  version: number;
  name: string;
  seed: string;
  rngState: RngState;
  season: number;
  /** Next week to be played (1-based). */
  week: number;
  phase: Phase;
  userTeamId: number;
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
  /** Every member of a medical staff, employed or on the market (see `medical.ts`). */
  medics: Record<number, Medic>;
  nextMedicId: number;
  /** The league's officiating crews, by id (see `officials.ts`). */
  crews: Crew[];
}
