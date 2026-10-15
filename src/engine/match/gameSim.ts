/**
 * Play-by-play game simulation.
 *
 * Each snap is a discrete event resolved from individual player matchups
 * (blockers vs. rushers, receivers vs. their coverage defender, ball carrier
 * vs. tacklers). Outcomes emerge from ratings plus bounded randomness, so
 * better teams win more often without making upsets impossible.
 */
import { clamp, Rng } from '../rng';
import type { Game, GameResult, League, PlayKind, PlayLogEntry, Player, StatKey, StatLine, TeamGameStats } from '../types';
import { MAX_STATS } from '../types';
import * as coach from './coach';
import type { DefenseCall, PassDepth, Situation } from './coach';
import { activePlayers, buildLineup, type Lineup } from './lineup';

type Side = 0 | 1; // 0 = home, 1 = away

export interface SimOptions {
  /** Keep the full play-by-play log (otherwise only scoring plays are kept). */
  keepPlays?: boolean;
  /** Playoff games cannot end in a tie. */
  playoff?: boolean;
  /** Override the RNG seed (defaults to a per-game seed derived from the league). */
  seed?: string;
}

const QUARTER_SECONDS = 900;
const RUN_OUTSIDE: [string, number][] = [['left end', -1], ['right end', 1]];
const RUN_INSIDE: [string, number][] = [['up the middle', 0], ['left guard', -0.35], ['right tackle', 0.45]];
const PASS_LANES: [string, number][] = [['left', -0.8], ['middle', 0], ['right', 0.8]];

type Anim = Pick<PlayLogEntry, 'kind' | 'from' | 'air' | 'to' | 'lane'>;
const HOME_FIELD_EDGE = 0.4; // ratings points added to the home side's matchups

/** Collects stat changes for a play so they can be discarded if a penalty wipes the play out. */
class StatBuffer {
  entries: [Player, StatKey, number][] = [];
  add(p: Player, key: StatKey, value = 1) {
    this.entries.push([p, key, value]);
  }
}

interface PlayResult {
  kind: 'run' | 'pass' | 'sack' | 'scramble' | 'kneel';
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
  lane?: number;
  turnover?: { kind: 'int' | 'fumble'; spot: number; returnYds: number; by: Player };
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
    thirdDownAtt: 0,
    thirdDownConv: 0,
    fourthDownAtt: 0,
    fourthDownConv: 0,
    redZoneAtt: 0,
    redZoneTd: 0,
    top: 0,
  };
}

const short = (p: Player) => `${p.firstName[0]}.${p.lastName}`;

export function simulateGame(league: League, game: Game, options: SimOptions = {}): GameResult {
  return new GameSim(league, game, options).run();
}

/** A game advanced one play at a time, for watching live. Same seed → same game as simulateGame. */
export interface LiveGame {
  /** Advance until at least one new play is logged (or the game ends); returns the new entries. */
  next(): PlayLogEntry[];
  readonly over: boolean;
  result(): GameResult;
}

export function startGame(league: League, game: Game, options: SimOptions = {}): LiveGame {
  const sim = new GameSim(league, game, { ...options, keepPlays: true });
  return {
    next: () => sim.next(),
    get over() {
      return sim.isOver;
    },
    result: () => sim.result(),
  };
}

/** Hard stop for a runaway loop; a real game is ~170 iterations. */
const MAX_STEPS = 2000;

class GameSim {
  private rng: Rng;
  private lineups: [Lineup, Lineup];
  private score: [number, number] = [0, 0];
  private quarters: [number[], number[]] = [[0, 0, 0, 0], [0, 0, 0, 0]];
  private quarter = 1;
  private clock = QUARTER_SECONDS;
  private clockRunning = false;
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
  private steps = 0;
  private otCompleted: [number, number] = [0, 0];
  private driveInRedZone = false;
  private teamStats: [TeamGameStats, TeamGameStats] = [emptyTeamStats(), emptyTeamStats()];
  private playerStats: Record<number, StatLine> = {};
  private plays: PlayLogEntry[] = [];
  private snapshot: Omit<PlayLogEntry, 'text' | 'homeScore' | 'awayScore'> | null = null;
  private homeEdge: number;
  /** Ball path attached to the next logged play. */
  private anim: Anim | null = null;

  constructor(
    private league: League,
    game: Game,
    private options: SimOptions,
  ) {
    this.rng = new Rng(options.seed ?? `${league.seed}:${game.season}:${game.id}`);
    this.homeEdge = game.neutral ? 0 : HOME_FIELD_EDGE;
    const team = (id: number) => league.teams[id];
    this.lineups = [buildLineup(league, team(game.homeId)), buildLineup(league, team(game.awayId))];
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

  /** One event: a quarter break, a kickoff, or a scrimmage down. */
  private step() {
    if (!this.started) {
      this.started = true;
      this.openingReceiver = this.rng.chance(0.5) ? 0 : 1;
      this.kickoffBy = (1 - this.openingReceiver) as Side;
    }
    if (++this.steps > MAX_STEPS) {
      this.over = true;
      return;
    }
    if (this.clock <= 0) {
      this.endQuarter();
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

  private credit(buf: StatBuffer) {
    for (const [p, key, value] of buf.entries) {
      const line = (this.playerStats[p.id] ??= {});
      if (MAX_STATS.has(key)) line[key] = Math.max(line[key] ?? 0, value);
      else line[key] = (line[key] ?? 0) + value;
    }
  }

  private fgProb(distance: number, kicker: Player): number {
    const r = kicker.ratings;
    const center = 60 + 0.55 * (r.kickAccuracy - 12) + 0.6 * (r.kickPower - 12);
    const p = 1 / (1 + Math.exp((distance - center) / 6.8));
    return distance > center + 12 ? 0 : p;
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
    if (this.anim) Object.assign(entry, this.anim);
    this.anim = null;
    if (this.options.keepPlays || scoring) this.plays.push(entry);
    this.snapshot = null;
  }

  /** Convert a yard line from `side`'s point of view to field coordinates. */
  private fieldX(side: Side, yardLine: number): number {
    return side === 0 ? yardLine : 100 - yardLine;
  }

  private setAnim(side: Side, kind: PlayKind, from: number, to: number, air?: number, lane = 0) {
    this.anim = { kind, from: this.fieldX(side, from), to: this.fieldX(side, to), lane };
    if (air !== undefined) this.anim.air = this.fieldX(side, air);
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
    this.quarters[side][Math.min(this.quarter, 5) - 1] = (this.quarters[side][Math.min(this.quarter, 5) - 1] ?? 0) + points;
  }

  private touchdown(side: Side, text: string) {
    this.addPoints(side, 6);
    if (side === this.offense && this.driveInRedZone) this.teamStats[side].redZoneTd++;
    this.log(text, true);
    this.clockRunning = false;
    if (side === this.offense) this.endPossession();
    if (this.checkOvertimeEnd()) return;
    this.conversion(side);
    if (this.checkOvertimeEnd()) return;
    this.kickoffBy = side;
  }

  private conversion(side: Side) {
    const lineup = this.lineups[side];
    const s: Situation = { ...this.situation(), scoreDiff: this.score[side] - this.score[(1 - side) as Side] };
    this.snapshot = null;
    if (coach.goForTwo(s)) {
      const q = lineup.qb.ratings;
      const ok = this.rng.chance(clamp(0.47 + 0.01 * (q.throwAccShort - 12), 0.35, 0.6));
      if (ok) this.addPoints(side, 2);
      this.setAnim(side, 'two', 98, ok ? 102 : 99);
      this.log(`Two-point attempt ${ok ? 'is GOOD' : 'fails'}.`, true);
      return;
    }
    const k = lineup.k;
    const made = this.rng.chance(Math.min(0.985, this.fgProb(33, k) + 0.01));
    const buf = new StatBuffer();
    buf.add(k, 'xpAtt');
    if (made) {
      buf.add(k, 'xpMade');
      this.addPoints(side, 1);
    }
    this.credit(buf);
    this.setAnim(side, 'xp', 85, 110, 110);
    this.log(`${short(k)} extra point is ${made ? 'GOOD' : 'NO GOOD'}.`, true);
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
    const kicking = this.lineups[kickingSide];
    const receivingSide = (1 - kickingSide) as Side;
    const receiving = this.lineups[receivingSide];
    this.offense = kickingSide;
    this.snapshot = null;
    const scoreDiff = this.score[kickingSide] - this.score[receivingSide];

    if (coach.shouldOnside(scoreDiff, this.quarter, this.clock)) {
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

    const kp = kicking.k.ratings.kickPower;
    const touchback = this.rng.chance(clamp(0.38 + 0.025 * (kp - 12), 0.15, 0.7));
    this.offense = receivingSide;
    if (touchback) {
      this.setAnim(kickingSide, 'kickoff', 35, 104, 104);
      this.startSeries(35);
      this.log(`${short(kicking.k)} kicks off into the end zone. Touchback.`);
    } else {
      const kr = receiving.kr;
      const skill = (kr.ratings.speed + kr.ratings.elusiveness) / 2 - 12;
      let start = clamp(Math.round(this.rng.normal(28 + 0.6 * skill, 6)), 8, 60);
      const returnTd = this.rng.chance(clamp(0.004 + 0.001 * skill, 0.001, 0.012));
      if (returnTd) start = 100;
      const buf = new StatBuffer();
      buf.add(kr, 'krAtt');
      buf.add(kr, 'krYds', start - 3);
      this.playTime(this.rng.int(5, 8));
      this.setAnim(kickingSide, 'kickoff', 35, returnTd ? -3 : 100 - start, 97);
      if (returnTd) {
        buf.add(kr, 'krTd');
        this.credit(buf);
        this.touchdown(receivingSide, `${short(kr)} returns the kickoff ${start - 3} yards for a TOUCHDOWN!`);
        return;
      }
      this.credit(buf);
      this.startSeries(start);
      this.log(`${short(kicking.k)} kicks off. ${short(kr)} returns to the ${this.spot()}.`);
    }
    this.clockRunning = false;
  }

  private punt() {
    const off = this.lineups[this.offense];
    const def = this.lineups[this.def];
    this.takeSnapshot();
    const buf = new StatBuffer();
    const p = off.p;
    this.playTime(this.rng.int(6, 9));

    if (this.rng.chance(0.005)) {
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

    let gross = Math.round(clamp(this.rng.normal(46 + 0.9 * (p.ratings.kickPower - 12), 5.5), 25, 70));
    // Pin it deep instead of booting into the end zone from plus territory.
    const room = 100 - this.yardLine;
    if (gross > room - 5 && room < 60) {
      const accuracy = clamp(0.45 + 0.03 * (p.ratings.kickAccuracy - 12), 0.25, 0.75);
      gross = this.rng.chance(accuracy) ? room - this.rng.int(3, 15) : room;
    }
    buf.add(p, 'punts');
    buf.add(p, 'puntYds', gross);
    const landing = this.yardLine + gross;
    this.setAnim(this.offense, 'punt', this.yardLine, Math.min(landing, 105), Math.min(landing, 105));
    if (landing >= 100) {
      this.credit(buf);
      this.log(`${short(p)} punts ${gross} yards into the end zone. Touchback.`);
      this.changePossession(20);
      return;
    }
    const receiveAt = 100 - landing;
    const pr = def.pr;
    if (receiveAt <= 10 || this.rng.chance(0.42)) {
      this.credit(buf);
      this.log(`${short(p)} punts ${gross} yards. ${receiveAt <= 10 ? 'Downed' : `Fair catch by ${short(pr)}`} at the ${this.spot(receiveAt, this.def)}.`);
      this.changePossession(receiveAt);
      return;
    }
    const skill = (pr.ratings.speed + pr.ratings.elusiveness) / 2 - 12;
    let ret = Math.max(0, Math.round(this.rng.normal(8 + 0.5 * skill, 6)));
    if (this.rng.chance(clamp(0.006 + 0.0015 * skill, 0.002, 0.02))) ret = 100 - receiveAt;
    // Returns run back toward the punting team's goal line.
    this.setAnim(this.offense, 'punt', this.yardLine, landing - ret <= 0 ? -3 : landing - ret, landing);
    buf.add(pr, 'prAtt');
    buf.add(pr, 'prYds', ret);
    if (receiveAt + ret >= 100) buf.add(pr, 'prTd');
    this.credit(buf);
    if (receiveAt + ret >= 100) {
      this.log(`${short(p)} punts ${gross} yards.`);
      this.endPossession();
      this.offense = this.def;
      this.touchdown(this.offense, `${short(pr)} returns the punt ${ret} yards for a TOUCHDOWN!`);
      return;
    }
    this.log(`${short(p)} punts ${gross} yards. ${short(pr)} returns ${ret} yards to the ${this.spot(receiveAt + ret, this.def)}.`);
    this.changePossession(receiveAt + ret);
  }

  private fieldGoal() {
    const off = this.lineups[this.offense];
    const k = off.k;
    this.takeSnapshot();
    const distance = 100 - this.yardLine + 17;
    const buf = new StatBuffer();
    buf.add(k, 'fgAtt');
    this.playTime(this.rng.int(4, 6));
    const made = this.rng.chance(this.fgProb(distance, k) - 0.01);
    this.setAnim(this.offense, 'fg', this.yardLine - 7, 110, 110);
    if (made) {
      buf.add(k, 'fgMade');
      buf.add(k, 'fgLong', distance);
      this.credit(buf);
      this.addPoints(this.offense, 3);
      this.log(`${short(k)} ${distance}-yard field goal is GOOD.`, true);
      this.endPossession();
      this.clockRunning = false;
      if (this.checkOvertimeEnd()) return;
      this.kickoffBy = this.offense;
      return;
    }
    this.credit(buf);
    this.log(`${short(k)} ${distance}-yard field goal is NO GOOD.`);
    // Defense takes over at the spot of the kick (or the 20, whichever is better).
    this.changePossession(Math.max(20, 100 - (this.yardLine - 7)));
  }

  // ───────────────────────── scrimmage ─────────────────────────

  private scrimmageDown() {
    const offSide = this.offense;
    if (this.clockRunning) {
      const s = this.situation();
      if (coach.offenseTimeout(s)) this.useTimeout(offSide);
      else if (coach.defenseTimeout(s)) this.useTimeout(this.def);
    }
    if (this.clockRunning) {
      const t = coach.tempo(this.situation());
      this.preSnapRunoff(t === 'hurry' ? this.rng.int(8, 16) : t === 'milk' ? this.rng.int(36, 41) : this.rng.int(28, 39));
      if (this.clock <= 0) return;
    }

    const s = this.situation();
    if (coach.shouldKneel(s)) return this.kneel();

    const endOfHalf = (this.quarter === 2 || this.quarter >= 4) && this.clock <= 6;
    const kickToWinOrTie = this.quarter === 2 || (s.scoreDiff <= 0 && s.scoreDiff >= -3);
    if (endOfHalf && kickToWinOrTie && s.fgMakeProb >= 0.25) return this.fieldGoal();

    if (this.down === 4) {
      const decision = coach.fourthDown(s, this.rng);
      if (decision === 'punt') return this.punt();
      if (decision === 'fg') return this.fieldGoal();
    }

    if (this.preSnapPenalty()) return;

    const defCall = coach.defenseCall(s, this.rng);
    const result = this.rng.chance(coach.passProbability(s)) ? this.passPlay(s, defCall) : this.runPlay(s, defCall);
    this.resolve(result);
  }

  private preSnapPenalty(): boolean {
    const off = this.offense;
    const roll = this.rng.next();
    if (roll < 0.027) {
      const yards = Math.min(5, Math.floor(this.yardLine / 2));
      this.takeSnapshot();
      this.setAnim(off, 'penalty', this.yardLine, this.yardLine - yards);
      this.yardLine -= yards;
      this.teamStats[off].penalties++;
      this.teamStats[off].penaltyYds += yards;
      this.clockRunning = false;
      this.log(`PENALTY on ${this.abbrev(off)}: False start, ${yards} yards.`);
      return true;
    }
    if (roll < 0.044) {
      const yards = Math.min(5, Math.floor((100 - this.yardLine) / 2));
      this.takeSnapshot();
      this.setAnim(off, 'penalty', this.yardLine, this.yardLine + yards);
      this.yardLine += yards;
      this.teamStats[this.def].penalties++;
      this.teamStats[this.def].penaltyYds += yards;
      if (this.yardLine >= this.lineToGain) this.firstDown();
      this.clockRunning = false;
      this.log(`PENALTY on ${this.abbrev(this.def)}: Offside, ${yards} yards.`);
      return true;
    }
    return false;
  }

  private kneel() {
    const qb = this.lineups[this.offense].qb;
    this.takeSnapshot();
    const buf = new StatBuffer();
    buf.add(qb, 'rushAtt');
    buf.add(qb, 'rushYds', -1);
    this.resolve({ kind: 'kneel', yards: -1, text: `${short(qb)} kneels.`, duration: 2, clockStops: false, stats: buf });
  }

  /** Weighted pick of the defender who makes the tackle, based on how far the play went. */
  private pickTackler(def: Lineup, yards: number): Player {
    const pool: [Player, number][] = [];
    const add = (ps: Player[], w: number) => ps.forEach((p) => pool.push([p, w * (0.5 + p.ratings.tackling / 20)]));
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

  private fumbleRecoveredByDefense(): boolean {
    return this.rng.chance(0.52);
  }

  private runPlay(s: Situation, defCall: DefenseCall): PlayResult {
    const off = this.lineups[this.offense];
    const def = this.lineups[this.def];
    const rng = this.rng;
    const buf = new StatBuffer();
    const yardsToGoal = 100 - this.yardLine;

    const qbRunWeight = Math.max(0, off.qb.ratings.speed - 9) * 0.012;
    const rusher = rng.weighted(
      [
        [off.rbs[0], 0.68],
        [off.rbs[1] ?? off.rbs[0], 0.24],
        [off.qb, qbRunWeight],
        [off.wrs[0], 0.015],
      ] as [Player, number][],
      ([, w]) => w,
    )[0];
    const r = rusher.ratings;
    const outside = rng.chance(0.4);
    const boxAdj = { base: 0, runD: 1.5, passD: -1.5, blitz: 0.6 }[defCall];
    const homeAdj = this.offense === 0 ? this.homeEdge : -this.homeEdge;
    const lineDelta = off.runBlock - (def.runStop + boxAdj) + homeAdj;
    const rusherSkill = outside
      ? r.speed * 0.45 + r.agility * 0.3 + r.elusiveness * 0.25
      : r.strength * 0.35 + r.elusiveness * 0.35 + r.awareness * 0.3;

    let yards = rng.normal(3.85 + 0.3 * lineDelta + 0.2 * (rusherSkill - 12), 2.9);
    if (yards > 4) {
      const lb = def.lb.reduce((a, b) => (b.ratings.tackling > a.ratings.tackling ? b : a));
      const pBreak = clamp(0.2 + 0.025 * (r.elusiveness - lb.ratings.tackling) + 0.02 * (r.speed - def.s[0].ratings.speed), 0.05, 0.5);
      if (rng.chance(pBreak)) {
        yards += rng.exponential(Math.max(2, 5 + 0.4 * (r.speed - 12)));
        if (rng.chance(clamp(0.1 + 0.012 * (r.speed - 12), 0.03, 0.25))) yards += rng.exponential(22);
      }
    }
    yards = Math.round(Math.max(yards, -6));
    if (this.yardLine + yards < 0) yards = -this.yardLine;
    const td = yards >= yardsToGoal;
    if (td) yards = yardsToGoal;

    buf.add(rusher, 'rushAtt');
    buf.add(rusher, 'rushYds', yards);
    buf.add(rusher, 'rushLong', yards);
    const [dir, lane] = outside ? rng.pick(RUN_OUTSIDE) : rng.pick(RUN_INSIDE);
    let text = `${short(rusher)} rush ${dir} for ${yards === 0 ? 'no gain' : `${yards} yard${Math.abs(yards) === 1 ? '' : 's'}`}`;

    if (td) {
      buf.add(rusher, 'rushTd');
      return { kind: 'run', yards, text: `${text}, TOUCHDOWN`, duration: rng.int(4, 7), clockStops: true, stats: buf, lane };
    }

    const tackler = this.pickTackler(def, yards);
    buf.add(tackler, 'tackles');
    if (yards < 0) buf.add(tackler, 'tfl');
    text += ` (${short(tackler)})`;

    const pFumble = 0.012 * Math.exp(-0.13 * (r.carrying - 12));
    if (rng.chance(pFumble)) {
      buf.add(rusher, 'fumbles');
      buf.add(tackler, 'forcedFum');
      if (this.fumbleRecoveredByDefense()) {
        const recoverer = this.pickTackler(def, yards);
        buf.add(rusher, 'fumblesLost');
        buf.add(recoverer, 'fumRec');
        const returnYds = rng.chance(0.1) ? rng.int(5, 40) : rng.int(0, 3);
        return {
          kind: 'run',
          lane,
          yards,
          text: `${text}. FUMBLE, recovered by ${short(recoverer)}`,
          duration: rng.int(4, 7),
          clockStops: true,
          stats: buf,
          turnover: { kind: 'fumble', spot: this.yardLine + yards, returnYds, by: recoverer },
        };
      }
      text += '. Fumble, recovered by the offense';
    }
    // Ball carriers protecting a lead stay in bounds.
    const oob = rng.chance((outside ? 0.18 : 0.04) * (coach.tempo(s) === 'milk' ? 0.25 : 1));
    if (oob) text += ', out of bounds';
    return { kind: 'run', yards, text, duration: rng.int(4, 7), clockStops: oob && this.oobStopsClock(), stats: buf, lane };
  }

  private passPlay(s: Situation, defCall: DefenseCall): PlayResult {
    const off = this.lineups[this.offense];
    const def = this.lineups[this.def];
    const rng = this.rng;
    const qb = off.qb;
    const q = qb.ratings;
    const buf = new StatBuffer();
    const yardsToGoal = 100 - this.yardLine;
    const homeAdj = this.offense === 0 ? this.homeEdge : -this.homeEdge;

    const rushAdj = { base: 0, runD: 0.3, passD: -1, blitz: 2.5 }[defCall];
    const pressureDelta = def.passRush + rushAdj - off.passBlock - homeAdj;
    const pressured = rng.chance(clamp(0.3 + 0.035 * pressureDelta, 0.1, 0.65));

    if (pressured) {
      const pSack = clamp(0.21 - 0.012 * (q.awareness - 12) - 0.01 * (q.agility - 12), 0.08, 0.38);
      if (rng.chance(pSack)) return this.sack(def, defCall);
      if (rng.chance(clamp(0.1 + 0.02 * (q.speed - 10), 0.03, 0.35))) return this.scramble(def);
      if (rng.chance(0.12)) {
        buf.add(qb, 'passAtt');
        return { kind: 'pass', yards: 0, text: `${short(qb)} under pressure, throws it away`, duration: rng.int(4, 6), clockStops: true, stats: buf, passAttempt: true, complete: false, airYards: 0, depth: 'short' };
      }
    }

    const depth = coach.passDepth(s, rng);
    // Targets: [receiver, base weight by depth, coverage defender]
    const lbCover = def.lb[1] ?? def.lb[0];
    const options: [Player | undefined, Record<PassDepth, number>, Player][] = [
      [off.wrs[0], { short: 0.2, medium: 0.33, deep: 0.42 }, def.cb[0]],
      [off.wrs[1], { short: 0.17, medium: 0.26, deep: 0.3 }, def.cb[1] ?? def.cb[0]],
      [off.wrs[2], { short: 0.14, medium: 0.15, deep: 0.15 }, def.cb[2] ?? def.cb[0]],
      [off.tes[0], { short: 0.19, medium: 0.19, deep: 0.1 }, rng.chance(0.5) ? def.s[1] ?? def.s[0] : def.lb[0]],
      [off.rbs[0], { short: 0.22, medium: 0.04, deep: 0.02 }, lbCover],
      [off.rbs[1], { short: 0.06, medium: 0.01, deep: 0 }, def.lb[0]],
      [off.tes[1], { short: 0.03, medium: 0.02, deep: 0.01 }, def.lb[0]],
    ];
    const valid = options.filter((o): o is [Player, Record<PassDepth, number>, Player] => !!o[0]);
    const [receiver, , defender] = rng.weighted(valid, ([p, w]) => {
      const skill = (p.ratings.catching + p.ratings.routeRunning + p.ratings.speed) / 3;
      return w[depth] * (0.6 + 0.04 * skill);
    });
    const r = receiver.ratings;
    const d = defender.ratings;
    const isBack = receiver.position === 'RB';

    const recvSkill =
      depth === 'deep'
        ? r.speed * 0.45 + r.routeRunning * 0.35 + r.agility * 0.2
        : r.routeRunning * 0.45 + r.speed * 0.25 + r.agility * 0.3;
    const defSkill = d.coverage * 0.55 + d.speed * 0.3 + d.awareness * 0.15;
    let sep = recvSkill - defSkill + homeAdj + (isBack && depth === 'short' ? 2.5 : 0);
    if (depth === 'deep') sep -= 0.15 * (def.s[0].ratings.coverage - 8);
    sep += { base: 0, runD: 0.8, passD: -1.2, blitz: 1.5 }[defCall];

    const acc =
      depth === 'short' ? q.throwAccShort : depth === 'medium' ? (q.throwAccShort + q.throwAccDeep) / 2 : q.throwAccDeep * 0.7 + q.throwPower * 0.3;
    let pComplete = { short: 0.79, medium: 0.6, deep: 0.38 }[depth] + 0.018 * (acc - 12) + 0.022 * sep + 0.012 * (r.catching - 12);
    if (pressured) pComplete -= 0.17 - 0.01 * (q.awareness - 12);
    if (yardsToGoal <= 10 && depth !== 'short') pComplete -= 0.06;
    pComplete = clamp(pComplete, 0.05, 0.95);

    const pInt =
      { short: 0.0095, medium: 0.023, deep: 0.04 }[depth] *
      Math.exp(-0.07 * (q.awareness - 12) - 0.05 * (acc - 12) + 0.05 * (d.catching - 8) - 0.05 * sep) *
      (pressured ? 1.6 : 1);

    let air: number;
    if (isBack && depth === 'short') air = rng.int(-3, 4);
    else if (depth === 'short') air = Math.round(clamp(rng.normal(2.9, 3.2), -3, 9));
    else if (depth === 'medium') air = rng.int(10, 17);
    else air = 20 + Math.round(Math.min(rng.exponential(7), 40));
    air = Math.max(air, 1 - this.yardLine);
    air = Math.min(air, yardsToGoal + 9);

    const [sideLabel, lane] = rng.pick(PASS_LANES);
    const depthLabel = `${depth} ${sideLabel}`;
    buf.add(qb, 'passAtt');
    buf.add(receiver, 'targets');
    const duration = rng.int(5, 8);
    const base = { kind: 'pass' as const, passAttempt: true, airYards: air, depth, duration, stats: buf, lane };

    const roll = rng.next();
    if (roll < pInt) {
      const catcher = rng.chance(0.65) ? defender : rng.pick(def.s);
      buf.add(qb, 'passInt');
      buf.add(catcher, 'defInt');
      buf.add(catcher, 'passDef');
      const spot = Math.min(this.yardLine + air, 100);
      const returnYds = Math.round(Math.max(0, rng.normal(9, 10)) + (rng.chance(0.06) ? rng.exponential(30) : 0));
      return {
        ...base,
        yards: 0,
        complete: false,
        clockStops: true,
        text: `${short(qb)} pass ${depthLabel} intended for ${short(receiver)} INTERCEPTED by ${short(catcher)}`,
        turnover: { kind: 'int', spot, returnYds, by: catcher },
      };
    }

    if (roll >= pInt + pComplete) {
      let text = `${short(qb)} pass ${depthLabel} to ${short(receiver)} incomplete`;
      if (rng.chance(0.3)) {
        buf.add(defender, 'passDef');
        text += `, broken up by ${short(defender)}`;
      }
      return { ...base, yards: 0, complete: false, clockStops: true, text };
    }

    // Completion.
    let gain: number;
    let tackler: Player | null = null;
    if (air >= yardsToGoal) {
      gain = yardsToGoal;
    } else {
      tackler = rng.chance(0.6) ? defender : this.pickTackler(def, air + 4);
      const t = tackler.ratings;
      const yacSkill = r.elusiveness * 0.45 + r.speed * 0.35 + r.strength * 0.2 - (t.tackling * 0.6 + t.speed * 0.4);
      let yac = Math.max(0, rng.normal({ short: 3.6, medium: 2.8, deep: 2.4 }[depth] + 0.3 * yacSkill, 3));
      if (rng.chance(clamp(0.025 + 0.005 * yacSkill, 0.01, 0.07))) yac += rng.exponential(16);
      gain = Math.min(air + Math.round(yac), yardsToGoal);
    }
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
      return { ...base, yards: gain, complete: true, clockStops: true, text: `${text}, TOUCHDOWN` };
    }
    if (this.yardLine + gain <= 0) gain = -this.yardLine;
    buf.add(tackler!, 'tackles');
    text += ` (${short(tackler!)})`;

    if (rng.chance(0.006 * Math.exp(-0.12 * (r.carrying - 12)))) {
      buf.add(receiver, 'fumbles');
      buf.add(tackler!, 'forcedFum');
      if (this.fumbleRecoveredByDefense()) {
        const recoverer = this.pickTackler(def, gain);
        buf.add(receiver, 'fumblesLost');
        buf.add(recoverer, 'fumRec');
        return {
          ...base,
          yards: gain,
          complete: true,
          clockStops: true,
          text: `${text}. FUMBLE, recovered by ${short(recoverer)}`,
          turnover: { kind: 'fumble', spot: this.yardLine + gain, returnYds: rng.int(0, 5), by: recoverer },
        };
      }
      text += '. Fumble, recovered by the offense';
    }
    const t = coach.tempo(s);
    const oob = rng.chance(t === 'hurry' ? 0.35 : t === 'milk' ? 0.05 : 0.18);
    if (oob) text += ', out of bounds';
    return { ...base, yards: gain, complete: true, clockStops: oob && this.oobStopsClock(), text };
  }

  private sack(def: Lineup, defCall: DefenseCall): PlayResult {
    const qb = this.lineups[this.offense].qb;
    const buf = new StatBuffer();
    const pool: [Player, number][] = [
      ...def.edge.map((p): [Player, number] => [p, 3 * p.ratings.passRush]),
      ...def.dt.map((p): [Player, number] => [p, 1.5 * p.ratings.passRush]),
      ...def.lb.map((p): [Player, number] => [p, (defCall === 'blitz' ? 1.5 : 0.3) * p.ratings.passRush]),
    ];
    const sacker = this.rng.weighted(pool, ([, w]) => w)[0];
    let loss = Math.round(clamp(this.rng.normal(6.5, 2.5), 1, 15));
    if (this.yardLine - loss < 0) loss = this.yardLine;
    buf.add(qb, 'sacked');
    buf.add(qb, 'sackYds', loss);
    buf.add(sacker, 'sacks');
    buf.add(sacker, 'tackles');
    buf.add(sacker, 'tfl');
    const text = `${short(qb)} SACKED by ${short(sacker)} for -${loss} yards`;
    const result: PlayResult = { kind: 'sack', yards: -loss, text, duration: this.rng.int(4, 6), clockStops: false, stats: buf };
    if (this.rng.chance(0.1)) {
      buf.add(qb, 'fumbles');
      buf.add(sacker, 'forcedFum');
      if (this.fumbleRecoveredByDefense()) {
        const recoverer = this.rng.chance(0.5) ? sacker : this.pickTackler(def, 0);
        buf.add(qb, 'fumblesLost');
        buf.add(recoverer, 'fumRec');
        result.text += `. FUMBLE, recovered by ${short(recoverer)}`;
        result.turnover = { kind: 'fumble', spot: this.yardLine - loss, returnYds: this.rng.chance(0.15) ? this.rng.int(5, 30) : 0, by: recoverer };
        result.clockStops = true;
      } else {
        result.text += '. Fumble, recovered by the offense';
      }
    }
    return result;
  }

  private scramble(def: Lineup): PlayResult {
    const qb = this.lineups[this.offense].qb;
    const buf = new StatBuffer();
    const q = qb.ratings;
    let yards = this.rng.normal(4 + 0.35 * (q.speed - 10), 3.5);
    if (yards > 6 && this.rng.chance(0.15 + 0.015 * (q.speed - 12))) yards += this.rng.exponential(10);
    yards = Math.round(Math.max(-3, yards));
    const yardsToGoal = 100 - this.yardLine;
    const td = yards >= yardsToGoal;
    if (td) yards = yardsToGoal;
    buf.add(qb, 'rushAtt');
    buf.add(qb, 'rushYds', yards);
    buf.add(qb, 'rushLong', yards);
    let text = `${short(qb)} scrambles for ${yards} yard${Math.abs(yards) === 1 ? '' : 's'}`;
    if (td) {
      buf.add(qb, 'rushTd');
      text += ', TOUCHDOWN';
    } else {
      const tackler = this.pickTackler(def, yards);
      buf.add(tackler, 'tackles');
      text += ` (${short(tackler)})`;
    }
    const slide = !td && this.rng.chance(0.4);
    const lane = this.rng.pick([-0.9, 0.9]);
    return { kind: 'scramble', yards, text: slide ? `${text}, slides` : text, duration: this.rng.int(5, 8), clockStops: false, stats: buf, lane };
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
    const text = result.text;
    const airAt = result.passAttempt && result.airYards ? startYardLine + result.airYards : undefined;

    // During-play penalties.
    let penalty: { on: Side; yards: number; text: string; autoFirst: boolean; replayDown: boolean } | null = null;
    if (result.kind === 'run' || result.kind === 'pass') {
      const roll = this.rng.next();
      const bad = !!result.turnover;
      if (roll < 0.038 && !bad && result.yards > -8) {
        const yards = Math.min(10, Math.floor(this.yardLine / 2));
        penalty = { on: offSide, yards: -yards, text: `PENALTY on ${this.abbrev(offSide)}: Offensive holding, ${yards} yards. No play.`, autoFirst: false, replayDown: true };
      } else if (result.passAttempt && !result.complete && !bad && result.airYards! > 0) {
        const pDpi = { short: 0.008, medium: 0.03, deep: 0.06 }[result.depth!];
        if (roll < 0.038 + pDpi) {
          const yards = Math.min(Math.max(1, result.airYards!), 99 - this.yardLine);
          penalty = { on: defSide, yards, text: `PENALTY on ${this.abbrev(defSide)}: Pass interference, ${yards} yards.`, autoFirst: true, replayDown: false };
        } else if (roll < 0.038 + pDpi + 0.02) {
          const yards = Math.min(5, Math.floor((100 - this.yardLine) / 2));
          penalty = { on: defSide, yards, text: `PENALTY on ${this.abbrev(defSide)}: Defensive holding, ${yards} yards.`, autoFirst: true, replayDown: false };
        }
      }
    }

    const warning = this.playTime(result.duration);
    ts.plays++;

    if (penalty) {
      this.teamStats[penalty.on].penalties++;
      this.teamStats[penalty.on].penaltyYds += Math.abs(penalty.yards);
      this.yardLine += penalty.yards;
      if (penalty.autoFirst) this.firstDown();
      this.clockRunning = false;
      this.setAnim(offSide, 'penalty', startYardLine, this.yardLine, undefined, result.lane);
      this.log(`${text}. ${penalty.text}`);
      return;
    }

    this.credit(result.stats);
    if (result.kind === 'pass') {
      ts.passAtt++;
      if (result.complete) {
        ts.passCmp++;
        ts.passYds += result.yards;
      }
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
      const isInt = result.turnover.kind === 'int';
      const end = isInt && spot >= 100 ? Math.min(spot, 108) : Math.max(-4, spot - returnYds);
      this.setAnim(offSide, isInt ? 'int' : result.kind, startYardLine, end, isInt ? Math.min(spot, 108) : airAt, result.lane);
      this.log(text);
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
    const kind: PlayKind = result.kind === 'pass' ? (result.complete ? 'pass' : 'incomplete') : result.kind;
    const end = kind === 'incomplete' ? startYardLine : this.yardLine >= 100 ? 102 : this.yardLine;
    this.setAnim(offSide, kind, startYardLine, end, airAt, result.lane);

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
    this.log(text);
    if (this.yardLine >= this.lineToGain) {
      if (downBefore === 3) ts.thirdDownConv++;
      if (downBefore === 4) ts.fourthDownConv++;
      this.firstDown();
    } else if (this.down === 4) {
      this.log('Turnover on downs.');
      this.changePossession(100 - this.yardLine);
      return;
    } else {
      this.down++;
    }
    if (warning) this.log('Two-minute warning.');
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
    return {
      homeScore: this.score[0],
      awayScore: this.score[1],
      overtime: this.quarter >= 5,
      quarters: { home: this.quarters[0], away: this.quarters[1] },
      home,
      away,
      playerStats: this.playerStats,
      playerTeams,
      plays,
    };
  }
}
