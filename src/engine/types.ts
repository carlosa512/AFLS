/**
 * Core data model. Everything here is plain JSON-serializable data so a League
 * can be saved, loaded, exported and modded without custom (de)serializers.
 */
import type { RngState } from './rng';

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

export interface Contract {
  /** Salary per season, in thousands of dollars. */
  salary: number;
  /** Seasons remaining including the current one. */
  years: number;
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
] as const;
export type StatKey = (typeof STAT_KEYS)[number];
export type StatLine = Partial<Record<StatKey, number>>;
/** Stats where season/career totals take the max rather than the sum. */
export const MAX_STATS: ReadonlySet<StatKey> = new Set(['rushLong', 'recLong', 'fgLong']);

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
  teamId: number | null;
  contract: Contract;
  /** Season year → accumulated stats. */
  stats: Record<number, StatLine>;
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
  /** If true the depth chart is rebuilt from ratings before every game. */
  autoDepth: boolean;
}

export type PlayoffRound = 'WC' | 'DIV' | 'CONF' | 'FINAL';

export interface TeamGameStats {
  firstDowns: number;
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
  thirdDownAtt: number;
  thirdDownConv: number;
  fourthDownAtt: number;
  fourthDownConv: number;
  redZoneAtt: number;
  redZoneTd: number;
  /** Seconds of possession. */
  top: number;
}

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

export type Phase = 'regular' | 'playoffs' | 'complete';

export interface SeasonSummary {
  season: number;
  championId: number;
  runnerUpId: number;
  /** Final regular-season records, by team id. */
  records: Record<number, { w: number; l: number; t: number }>;
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
  salaryCap: number;
  conferences: Conference[];
  divisions: Division[];
  teams: Team[];
  players: Record<number, Player>;
  nextPlayerId: number;
  games: Game[];
  nextGameId: number;
  history: SeasonSummary[];
}
