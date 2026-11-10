/**
 * A game read from its play log: the score by quarter, each team's numbers and each player's line through any play.
 * The viewer shows them beside the field, live and in a replay, so nothing may run ahead of the play on screen and
 * nothing may end a game different from its box score. Everything here is counted the way the engine books it
 * (`resolve` in `match/gameSim.ts`), and `gameRead.test.ts` holds every number shown (`SHOWN_TEAM`, `SHOWN_LINE`) to
 * the box score over three worlds' games. A number the log can't give exactly is left out, never estimated.
 * Spec: docs/superpowers/specs/2026-11-10-broadcast-info-design.md §1.
 */
import { unitsAt } from '../engine/field/cast';
import { fumbleIn } from '../engine/field/fumble';
import { actorsIn } from '../engine/playActors';
import { teamPlayers } from '../engine/roster';
import type { FieldRecord, Game, League, Player, PlayKind, PlayLogEntry, Team } from '../engine/types';

// ───────── names ─────────

export interface PlayNames {
  /** Every linkable name, longest first so "A.Macken" wins over "A.Mack". Null when there are none. */
  re: RegExp | null;
  ids: Map<string, number>;
}

/** "K.Snyder": how the engine writes a player into a play. */
const playName = (p: Player) => `${p.firstName[0]}.${p.lastName}`;

/**
 * The players a game's plays can name, by how the play text writes them: everyone who suited up (a finished game
 * keeps them, so a replay still links after a trade or a retirement) or, while it's live, both rosters. A name two
 * of them share stays plain text rather than guess.
 */
export function buildPlayNames(league: League, game: Game | undefined): PlayNames {
  if (!game) return { re: null, ids: new Map() };
  const ids = game.result
    ? Object.keys(game.result.playerTeams).map(Number)
    : [...teamPlayers(league, game.homeId), ...teamPlayers(league, game.awayId)].map((p) => p.id);
  const byName = new Map<string, number | null>();
  for (const id of ids) {
    const p = league.players[id];
    if (!p) continue;
    const key = playName(p);
    byName.set(key, byName.has(key) ? null : id);
  }
  const names = new Map([...byName].filter((e): e is [string, number] => e[1] !== null));
  if (!names.size) return { re: null, ids: names };
  const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const alternatives = [...names.keys()].sort((a, b) => b.length - a.length).map(escape);
  return { re: new RegExp(`(${alternatives.join('|')})(?![A-Za-z])`, 'g'), ids: names };
}

// ───────── what the engine books ─────────

/** The snaps `resolve` books: a kneel is a rush, a spike a pass attempt. A snap a flag wiped out is none of them. */
const BOOKED: ReadonlySet<PlayKind> = new Set([
  'run',
  'scramble',
  'pass',
  'incomplete',
  'int',
  'sack',
  'kneel',
  'spike',
]);
/** A two-point try is a real snap in the log, but nothing in it is booked. */
const isTry = (e: PlayLogEntry) => /^Two-point try: /.test(e.text);
const booked = (e: PlayLogEntry) => !!e.kind && BOOKED.has(e.kind) && !isTry(e);
/** The ball went over: a pick, or a fumble the defense got. */
const lostBall = (e: PlayLogEntry) => e.kind === 'int' || !!fumbleIn(e)?.lost;
/** The offense scored on the play itself (a defender's return of a pick or a fumble is not this). */
const offenseTd = (e: PlayLogEntry) => /TOUCHDOWN/.test(e.text) && !lostBall(e);

const clampField = (x: number) => Math.min(100, Math.max(0, x));
/** Yards the offense made: to where the ball came out on a lost fumble, never past a goal line. */
function gainOf(e: PlayLogEntry, homeId: number): number {
  if (e.from === undefined || e.to === undefined) return 0;
  const f = fumbleIn(e);
  const end = f?.lost ? f.x : e.to;
  return Math.round((clampField(end) - clampField(e.from)) * (e.offense === homeId ? 1 : -1));
}

const lineToGain = (e: PlayLogEntry) => Math.min(100, e.yardLine + e.distance);
const half = (quarter: number) => (quarter <= 2 ? 1 : quarter <= 4 ? 2 : 3);

/**
 * Whether the chains moved on play `i`, the way the engine decides it: the offense's next snap is a first down it
 * didn't already have (another down, or a new line to gain). A play with no snap after it in its half (the clock ran
 * out) is judged by its own yards.
 */
function movedChains(plays: readonly PlayLogEntry[], i: number, homeId: number): boolean {
  const e = plays[i];
  if (lostBall(e)) return false;
  if (e.kind !== 'penalty' && offenseTd(e)) return true;
  for (let j = i + 1; j < plays.length; j++) {
    const n = plays[j];
    if (half(n.quarter) !== half(e.quarter)) break;
    if (n.kind === 'kickoff' || n.kind === 'xp' || isTry(n)) return false;
    if (!n.down) continue;
    if (n.offense !== e.offense) return false;
    return n.down === 1 && (e.down !== 1 || lineToGain(n) !== lineToGain(e));
  }
  return e.kind !== 'penalty' && gainOf(e, homeId) >= e.distance;
}

// ───────── the score ─────────

/** Score by quarter through play `index`: a quarter appears once a play of it has been seen. */
export function quartersAt(plays: readonly PlayLogEntry[], index: number): { home: number[]; away: number[] } {
  const home: number[] = [];
  const away: number[] = [];
  let h = 0;
  let a = 0;
  for (let i = 0; i <= index && i < plays.length; i++) {
    const e = plays[i];
    while (home.length < e.quarter) {
      home.push(0);
      away.push(0);
    }
    home[e.quarter - 1] += e.homeScore - h;
    away[e.quarter - 1] += e.awayScore - a;
    h = e.homeScore;
    a = e.awayScore;
  }
  return { home, away };
}

// ───────── team numbers ─────────

/** The part of the box score's team stats the viewer shows. */
export interface RunningTeam {
  totalYds: number;
  passYds: number;
  rushYds: number;
  firstDowns: number;
  thirdDownAtt: number;
  thirdDownConv: number;
  turnovers: number;
}
/** The team numbers the equality test holds to the box score, and so the only ones a screen may show. */
export const SHOWN_TEAM: readonly (keyof RunningTeam)[] = [
  'totalYds',
  'passYds',
  'rushYds',
  'firstDowns',
  'thirdDownAtt',
  'thirdDownConv',
  'turnovers',
];

const blankTeam = (): RunningTeam => ({
  totalYds: 0,
  passYds: 0,
  rushYds: 0,
  firstDowns: 0,
  thirdDownAtt: 0,
  thirdDownConv: 0,
  turnovers: 0,
});

/** Each team's numbers through play `index` (-1: nothing yet). */
export function teamStatsAt(
  plays: readonly PlayLogEntry[],
  index: number,
  homeId: number,
): { home: RunningTeam; away: RunningTeam } {
  const home = blankTeam();
  const away = blankTeam();
  for (let i = 0; i <= index && i < plays.length; i++) {
    const e = plays[i];
    const t = e.offense === homeId ? home : away;
    // A flag that wiped the snap out books nothing, but it can still move the chains.
    if (e.kind === 'penalty' && e.down && !isTry(e)) {
      if (movedChains(plays, i, homeId)) t.firstDowns++;
      continue;
    }
    if (!booked(e)) continue;
    const gain = gainOf(e, homeId);
    if (e.kind === 'pass' || e.kind === 'sack') t.passYds += gain;
    else if (e.kind === 'run' || e.kind === 'scramble' || e.kind === 'kneel') t.rushYds += gain;
    if (lostBall(e)) t.turnovers++;
    if (e.down === 3) {
      t.thirdDownAtt++;
      // A conversion is the play's own doing: a late flag's fifteen yards move the chains without one.
      if (!lostBall(e) && (offenseTd(e) || gain >= e.distance)) t.thirdDownConv++;
    }
    if (movedChains(plays, i, homeId)) t.firstDowns++;
  }
  home.totalYds = home.passYds + home.rushYds;
  away.totalYds = away.passYds + away.rushYds;
  return { home, away };
}

// ───────── player lines ─────────

/** The part of a player's box-score line the viewer shows. */
export interface RunningLine {
  passAtt?: number;
  passCmp?: number;
  passYds?: number;
  passTd?: number;
  passInt?: number;
  rushAtt?: number;
  rushYds?: number;
  rushTd?: number;
  rec?: number;
  recYds?: number;
  recTd?: number;
  sacks?: number;
  defInt?: number;
}
/**
 * The player numbers the equality test holds to the box score. Tackles are not among them: the log names a play's
 * first tackler only, and the box score also counts assists and the kicking game's tackles.
 */
export const SHOWN_LINE: readonly (keyof RunningLine)[] = [
  'passAtt',
  'passCmp',
  'passYds',
  'passTd',
  'passInt',
  'rushAtt',
  'rushYds',
  'rushTd',
  'rec',
  'recYds',
  'recTd',
  'sacks',
  'defInt',
];

/**
 * Each player's line through play `index`, by player id. Who did it comes from the play's own actors; the passer
 * from the game's field record, or from the play's text when the game kept none (a name two players share gives
 * nobody a line).
 */
export function linesAt(
  plays: readonly PlayLogEntry[],
  index: number,
  homeId: number,
  names: PlayNames,
  record?: FieldRecord,
): Map<number, RunningLine> {
  const lines = new Map<number, RunningLine>();
  const add = (id: number | undefined, key: keyof RunningLine, n = 1) => {
    if (id === undefined) return;
    const line = lines.get(id) ?? {};
    line[key] = (line[key] ?? 0) + n;
    lines.set(id, line);
  };
  for (let i = 0; i <= index && i < plays.length; i++) {
    const e = plays[i];
    if (!booked(e)) continue;
    const who = actorsIn(e);
    const passer = (): number | undefined =>
      record ? unitsAt(record, i)[e.offense === homeId ? 0 : 1].qb : names.ids.get(/^\S+/.exec(e.text)?.[0] ?? '');
    const gain = gainOf(e, homeId);
    const td = offenseTd(e);
    switch (e.kind) {
      case 'pass':
      case 'incomplete':
      case 'int':
      case 'spike': {
        const qb = passer();
        add(qb, 'passAtt');
        if (e.kind === 'int') {
          add(qb, 'passInt');
          add(who.take, 'defInt');
        }
        if (e.kind === 'pass') {
          add(qb, 'passCmp');
          add(qb, 'passYds', gain);
          add(who.ball, 'rec');
          add(who.ball, 'recYds', gain);
          if (td) {
            add(qb, 'passTd');
            add(who.ball, 'recTd');
          }
        }
        break;
      }
      case 'sack':
        add(who.rush, 'sacks');
        break;
      case 'run':
      case 'scramble':
      case 'kneel': {
        const runner = who.ball ?? (e.kind === 'run' ? undefined : passer());
        add(runner, 'rushAtt');
        add(runner, 'rushYds', gain);
        if (td) add(runner, 'rushTd');
        break;
      }
    }
  }
  return lines;
}

// ───────── the clock ─────────

/**
 * Seconds since the opening kickoff at each play, the clock as it stood at the snap. A quarter is 900; an overtime
 * period is as long as the clock it opened on (ten minutes in the regular season, fifteen in the playoffs).
 */
export function secondsOf(plays: readonly PlayLogEntry[]): number[] {
  const endOf = periodEnds(plays);
  return plays.map((e) => endOf(e.quarter) - e.clock);
}

/** When each period ends, in game seconds: 900 a quarter, an overtime period as long as the clock it opened on. */
function periodEnds(plays: readonly PlayLogEntry[]): (quarter: number) => number {
  const opened = new Map<number, number>();
  for (const e of plays) if (e.quarter > 4 && !opened.has(e.quarter)) opened.set(e.quarter, e.clock);
  const length = (q: number) => (q <= 4 ? 900 : (opened.get(q) ?? 900));
  return (quarter) => {
    let s = 0;
    for (let k = 1; k <= quarter; k++) s += length(k);
    return s;
  };
}

/** How long the game on this log runs: regulation, plus the overtime it has reached. */
export function gameLength(plays: readonly PlayLogEntry[]): number {
  const seconds = secondsOf(plays);
  return Math.max(3600, seconds.length ? seconds[seconds.length - 1] : 0);
}

// ───────── timeouts ─────────

/** Timeouts left through play `index`: three a half, two in overtime, less each one the log says was called. */
export function timeoutsAt(
  plays: readonly PlayLogEntry[],
  index: number,
  home: Pick<Team, 'abbrev'>,
  away: Pick<Team, 'abbrev'>,
): { home: number; away: number } {
  const left = { home: 3, away: 3 };
  let at = 1;
  for (let i = 0; i <= index && i < plays.length; i++) {
    const e = plays[i];
    if (half(e.quarter) !== at) {
      at = half(e.quarter);
      left.home = left.away = at === 3 ? 2 : 3;
    }
    const m = /^Timeout (\S+) \((\d) left\)\.$/.exec(e.text);
    if (!m) continue;
    if (m[1] === home.abbrev) left.home = Number(m[2]);
    else if (m[1] === away.abbrev) left.away = Number(m[2]);
  }
  return left;
}

// ───────── drives ─────────

export type DriveEnd = 'td' | 'fg' | 'missed' | 'punt' | 'int' | 'fumble' | 'downs' | 'safety' | 'half' | 'end' | 'on';

export interface Drive {
  teamId: number;
  /** Its first snap and its last play (the kick that ended it included), as indexes into the log. */
  first: number;
  last: number;
  /** Game seconds (`secondsOf`) at its first snap, and when it was over. */
  start: number;
  end: number;
  /** Yards from its own goal line at the first snap. */
  from: number;
  /** Snaps the box score counts as plays: runs, passes, sacks, kneels and spikes. */
  snaps: number;
  /** From where it started to where it ended, flags included. */
  yards: number;
  how: DriveEnd;
  /** Points put up from its first snap until the next drive began: its own, or the defense's off a turnover. */
  points: { home: number; away: number };
}

/** A kick that happened (a flag can wipe one out: "No play"). */
const kicked = (e: PlayLogEntry) => !/No play\./.test(e.text);

/**
 * Every drive in the log, in order. A kickoff, an extra point and a two-point try belong to none. A live game's last
 * drive is still going (`'on'`); a finished game's ended with the game.
 */
export function drivesOf(plays: readonly PlayLogEntry[], homeId: number, live = false): Drive[] {
  const seconds = secondsOf(plays);
  const endOf = periodEnds(plays);
  const drives: Drive[] = [];
  /** The drive being played, its spot after its last snap, and whether it has ended (it then waits for the next one). */
  let open: Drive | null = null;
  let spot = 0;
  let done = false;
  const scoreAt = (i: number) =>
    i < 0 ? { home: 0, away: 0 } : { home: plays[i].homeScore, away: plays[i].awayScore };
  /** Settle the last drive's points and end: everything up to the play before `next` is its doing. */
  const settle = (next: number) => {
    const d = drives[drives.length - 1];
    if (!d) return;
    const before = scoreAt(d.first - 1);
    const after = scoreAt(next - 1);
    d.points = { home: after.home - before.home, away: after.away - before.away };
  };
  const close = (how: DriveEnd, last: number) => {
    if (!open || done) return;
    open.how = how;
    open.last = last;
    open.yards = spot - open.from;
    // Over when the next thing happens in its half; at its own last snap when nothing does.
    const n = plays[last + 1];
    open.end = n && half(n.quarter) === half(plays[last].quarter) ? seconds[last + 1] : seconds[last];
    // The clock ran out on it: it lasted to the end of its period (the half, regulation, or an overtime).
    if (how === 'half' || how === 'end') open.end = Math.max(open.end, endOf(plays[last].quarter));
    done = true;
  };
  for (let i = 0; i < plays.length; i++) {
    const e = plays[i];
    const prev = plays[i - 1];
    if (open && !done && prev && half(prev.quarter) !== half(e.quarter)) close('half', i - 1);
    if (open && !done && e.text === 'Turnover on downs.') close('downs', i - 1);
    if (open && !done && /^SAFETY!/.test(e.text)) close('safety', i - 1);
    if (!e.down || !e.kind || e.kind === 'kickoff' || e.kind === 'xp' || e.kind === 'two' || isTry(e)) continue;
    // A snap: the other side's, or the first since a drive ended, starts a new one.
    if (!open || done || open.teamId !== e.offense) {
      close('downs', i - 1);
      settle(i);
      open = {
        teamId: e.offense,
        first: i,
        last: i,
        start: seconds[i],
        end: seconds[i],
        from: e.yardLine,
        snaps: 0,
        yards: 0,
        how: 'on',
        points: { home: 0, away: 0 },
      };
      drives.push(open);
      done = false;
    }
    open.last = i;
    spot = e.yardLine;
    if (booked(e)) {
      open.snaps++;
      // A pick's logged end is where the return finished: the offense made nothing.
      if (e.kind !== 'int') spot = clampField(e.yardLine + gainOf(e, homeId));
      if (e.kind === 'int') close('int', i);
      else if (fumbleIn(e)?.lost) close('fumble', i);
      else if (offenseTd(e)) close('td', i);
    } else if (e.kind === 'fg' && kicked(e)) close(/NO GOOD|no good/.test(e.text) ? 'missed' : 'fg', i);
    else if (e.kind === 'punt' && kicked(e)) close('punt', i);
  }
  if (open && !done) {
    if (live) {
      open.yards = spot - open.from;
      open.end = seconds[plays.length - 1];
    } else close('end', plays.length - 1);
  }
  settle(plays.length);
  return drives;
}

// ───────── injuries ─────────

/** A man hurt in the game, as the log's own line told it. */
export interface LogInjury {
  index: number;
  /** Absent when the name is not one man's (`buildPlayNames`). */
  playerId: number | undefined;
  teamAbbrev: string;
  name: string;
  what: string;
  quarter: number;
  clock: number;
}

/** The men hurt through play `index`, in the order it happened. */
export function injuriesAt(plays: readonly PlayLogEntry[], index: number, names: PlayNames): LogInjury[] {
  const out: LogInjury[] = [];
  for (let i = 0; i <= index && i < plays.length; i++) {
    const m = /^Injury: (\S+) \S+ (\S+) \((.+)\) is out for the game\.$/.exec(plays[i].text);
    if (!m) continue;
    out.push({
      index: i,
      playerId: names.ids.get(m[2]),
      teamAbbrev: m[1],
      name: m[2],
      what: m[3],
      quarter: plays[i].quarter,
      clock: plays[i].clock,
    });
  }
  return out;
}

// ───────── records ─────────

/** A club's record going into a game: the games before its week, or the whole regular season for a playoff game. */
export function recordBefore(league: League, teamId: number, game: Game): { w: number; l: number; t: number } {
  const r = { w: 0, l: 0, t: 0 };
  for (const g of league.games) {
    if (!g.result || g.playoffRound || g.season !== game.season || g.week >= game.week) continue;
    if (g.homeId !== teamId && g.awayId !== teamId) continue;
    const us = g.homeId === teamId ? g.result.homeScore : g.result.awayScore;
    const them = g.homeId === teamId ? g.result.awayScore : g.result.homeScore;
    if (us > them) r.w++;
    else if (us < them) r.l++;
    else r.t++;
  }
  return r;
}
