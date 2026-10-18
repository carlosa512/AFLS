/**
 * Play-by-play game simulation.
 *
 * Each snap is a discrete event resolved from individual player matchups
 * (blockers vs. rushers, receivers vs. their coverage defender, ball carrier
 * vs. tacklers). Outcomes emerge from ratings plus bounded randomness, so
 * better teams win more often without making upsets impossible.
 */
import { skill } from '../attributes';
import { callerStyle, type CallerStyle } from '../coaching';
import { activeQuirks, type QuirkId } from '../quirks';
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

/** How far from the league's typical starter a quarterback's passing must be for a full lean. */
const QB_SPREAD = 4;
/** A quarterback's passing: accuracy at every depth and his decisions. */
const qbPassing = (qb: Player) => (skill(qb, 'shortAccuracy') + skill(qb, 'midAccuracy') + skill(qb, 'deepAccuracy') + skill(qb, 'decisionMaking')) / 4;
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

type Anim = Pick<PlayLogEntry, 'kind' | 'from' | 'air' | 'to' | 'lane'>;
const HOME_FIELD_EDGE = 0.4; // ratings points added to the home side's matchups
/** League-typical linemen discipline: penalty rates are scaled around these, so totals stay NFL-like. */
const OL_DISCIPLINE = 12;
const DL_DISCIPLINE = 10.8;
/** League-typical edge contain and safety help: their effects are measured from these. */
const EDGE_CONTAIN = 11.5;
const DEEP_HELP = 14;
/** Accuracy beyond which each point does half as much (elite passers stay inside NFL records). */
const ACC_SOFT_CAP = 16;
/** How much more (man) or less (zone) the covering defender's skill counts, away from a typical 12. */
const MAN_ISLAND = 0.25;
const ZONE_ISLAND = -0.15;
/** Share of non-sack pressures where the rusher hits the quarterback (NFL: about five hits a game, sacks included). */
const QB_HIT_SHARE = 0.35;
/** Sacks and pressures charged to no blocker: the coverage held, or the quarterback held the ball. */
const UNBLAMED_SACK = 0.35;
const UNBLAMED_PRESSURE = 0.15;
/** Fumble odds for a back who carries it loose. */
const LOOSE_CARRIAGE = 1.6;

/**
 * Who gets home on a pass rush: the starting edges the most, then the rotation and the linebackers,
 * and on blitzes the secondary too, so one rusher can't take half the sacks.
 */
function rushers(def: Lineup, blitz: boolean): [Player, number][] {
  return [
    ...def.edge.map((p): [Player, number] => [p, 1.65 * skill(p, 'edgeRush')]),
    ...def.dt.map((p): [Player, number] => [p, 1.3 * skill(p, 'interiorRush')]),
    ...def.rushRotation.map((p): [Player, number] => [p, p.position === 'EDGE' ? 1.1 * skill(p, 'edgeRush') : 0.6 * skill(p, 'interiorRush')]),
    ...def.lb.map((p): [Player, number] => [p, (blitz ? 1.5 : 0.45) * skill(p, 'edgeRush')]),
    ...[...def.s, def.cb[2]].filter(Boolean).map((p): [Player, number] => [p, blitz ? 4 : 0.6]),
  ];
}

/**
 * The blocker charged when `rusher` gets home. Line spots follow the depth chart (LT, LG, C, RG, RT);
 * among the men who could have had him, the weaker pass protector is more often the one who lost.
 */
function blockerFor(off: Lineup, def: Lineup, rusher: Player, blitz: boolean, rng: Rng): Player | null {
  const ol = off.ol;
  if (!ol.length) return null;
  const at = (i: number) => ol[Math.min(i, ol.length - 1)];
  const [lt, lg, c, rg, rt] = [at(0), at(1), at(2), at(3), at(4)];
  const te = off.scheme.offense.personnel === '10' ? null : off.tes[0];
  const back = off.rbs[0];
  let candidates: Player[];
  if (rusher === def.edge[0]) candidates = te && rng.chance(0.12) ? [te] : [lt];
  else if (rusher === def.edge[1]) candidates = te && rng.chance(0.12) ? [te] : [rt];
  // The center helps both ways, so he is the man beaten less often than the guard he slides to.
  else if (rusher === def.dt[0]) candidates = [lg, lg, c];
  else if (rusher === def.dt[1]) candidates = [rg, rg, c];
  else if (rusher.position === 'EDGE') candidates = [lt, rt];
  else if (rusher.position === 'DT') candidates = [lg, rg];
  // Linebackers and defensive backs: the back's to pick up on a blitz, otherwise a lineman sliding late.
  else candidates = blitz && rng.chance(0.6) ? [back] : [lg, c, rg];
  return rng.weighted(candidates, (p) => Math.max(1, 22 - skill(p, 'passPro')));
}
/** Separation beyond which the defense rolls a safety over. */
const SEP_ROLL = 3;
/** Carries before a lead back starts handing work to the second back. */
const LEAD_BACK_CARRIES = 14;
/** Mean gain on a run between evenly matched units, before breakaways. */
const RUN_BASE = 3.97;

/** Collects stat changes for a play so they can be discarded if a penalty wipes the play out. */
class StatBuffer {
  entries: [Player, StatKey, number][] = [];
  add(p: Player, key: StatKey, value = 1) {
    this.entries.push([p, key, value]);
  }
}

interface PlayResult {
  kind: 'run' | 'pass' | 'sack' | 'scramble' | 'kneel' | 'spike';
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
  /** Each player's established quirks, read once per game (they only change between weeks). */
  private quirkSets = new Map<number, ReadonlySet<QuirkId>>();

  constructor(
    private league: League,
    game: Game,
    private options: SimOptions,
  ) {
    this.rng = new Rng(options.seed ?? `${league.seed}:${game.season}:${game.id}`);
    this.creditRng = new Rng(`${options.seed ?? `${league.seed}:${game.season}:${game.id}`}:credit`);
    this.homeEdge = game.neutral ? 0 : HOME_FIELD_EDGE;
    const team = (id: number) => league.teams[id];
    this.lineups = [buildLineup(league, team(game.homeId)), buildLineup(league, team(game.awayId))];
    this.styles = [callerStyle(league, game.homeId), callerStyle(league, game.awayId)];
    this.qbLeans = qbLeans(league, [this.lineups[0].qb, this.lineups[1].qb]);
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
    if (this.pendingWarning) {
      this.pendingWarning = false;
      this.snapshot = null;
      this.log('Two-minute warning.');
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
    const center = 60 + 1.15 * (skill(kicker, 'fieldGoal') - 12);
    const p = 1 / (1 + Math.exp((distance - center) / 6.8));
    return distance > center + 12 ? 0 : p;
  }

  /**
   * The odds a field goal is good once it's kicked. Coaches decide from `fgProb`; a kicker's quirks
   * only show when he kicks: a cannon gains range and sprays the short ones, ice water halves the
   * misses late in a close game.
   */
  private kickMakes(distance: number, k: Player): number {
    let p = this.fgProb(distance, k) - 0.01;
    if (this.has(k, 'boomerLeg')) p = distance >= 50 ? this.fgProb(distance - 4, k) - 0.01 : distance < 40 ? 1 - (1 - p) * 1.3 : p;
    if (this.has(k, 'iceWater') && this.quarter >= 4 && Math.abs(this.score[this.offense] - this.score[this.def]) <= 8) p = 1 - (1 - p) * 0.5;
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
    if (coach.goForTwo(s)) {
      const ok = this.rng.chance(clamp(0.47 + 0.01 * (skill(lineup.qb, 'shortAccuracy') - 12), 0.35, 0.6));
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
    this.driveInRedZone = false;
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
    const touchback = this.rng.chance(clamp(0.38 + 0.025 * (kp - 12) + (this.has(kicking.k, 'boomerLeg') ? 0.12 : 0), 0.15, 0.8));
    this.offense = receivingSide;
    if (touchback) {
      this.setAnim(kickingSide, 'kickoff', 35, 104, 104);
      this.startSeries(35);
      this.log(`${short(kicking.k)} kicks off into the end zone. Touchback.`);
    } else {
      const kr = receiving.kr;
      const edge = skill(kr, 'returns') - 12;
      let start = clamp(Math.round(this.rng.normal(28 + 0.6 * edge, 6)), 8, 60);
      const returnTd = this.rng.chance(clamp(0.004 + 0.001 * edge, 0.001, 0.012));
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

    const outkicks = this.has(p, 'outkicksCoverage');
    const coffin = this.has(p, 'coffinCorner');
    let gross = Math.round(clamp(this.rng.normal(46 + 0.9 * (skill(p, 'puntDistance') - 12) + (outkicks ? 3 : 0), 5.5), 25, 70));
    // Pin it deep instead of booting into the end zone from plus territory.
    const room = 100 - this.yardLine;
    if (gross > room - 5 && room < 60) {
      const accuracy = clamp(0.45 + 0.03 * (skill(p, 'puntPlacement') - 12) + (coffin ? 0.15 : 0), 0.25, 0.85);
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
    // A well-placed punt (hang time, toward the sideline) leaves the returner no room.
    // No hang time means no fair catches; a coffin-corner man from plus territory leaves no room.
    const hang = (outkicks ? -0.15 : 0) + (coffin && room < 60 ? 0.15 : 0);
    if (receiveAt <= 10 || this.rng.chance(clamp(0.42 + 0.02 * (skill(p, 'puntPlacement') - 12) + hang, 0.2, 0.65))) {
      this.credit(buf);
      this.log(`${short(p)} punts ${gross} yards. ${receiveAt <= 10 ? 'Downed' : `Fair catch by ${short(pr)}`} at the ${this.spot(receiveAt, this.def)}.`);
      this.changePossession(receiveAt);
      return;
    }
    const edge = skill(pr, 'returns') - 12;
    let ret = Math.max(0, Math.round(this.rng.normal(8 + 0.5 * edge + (outkicks ? 3 : 0), 6)));
    if (this.rng.chance(clamp(0.006 + 0.0015 * edge, 0.002, 0.02))) ret = 100 - receiveAt;
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
    const made = this.rng.chance(this.kickMakes(distance, k));
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
      if (coach.playForFieldGoal(s)) {
        // Bleed the clock to the last few seconds, then stop it for a kick at the gun.
        const runoff = this.rng.int(coach.MILK_RUNOFF_MIN, 41);
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
      else if (coach.defenseTimeout(s)) this.useTimeout(this.def);
      else if (coach.shouldSpike(s)) return this.spike();
    }
    if (this.clockRunning) {
      const t = coach.tempo(this.situation());
      this.preSnapRunoff(t === 'hurry' ? this.rng.int(8, 16) : t === 'milk' ? this.rng.int(coach.MILK_RUNOFF_MIN, 41) : this.rng.int(28, 39));
    }
    if (this.clock <= 0) return;

    const s = this.situation();
    if (coach.shouldKneel(s)) return this.kneel();
    if (coach.kickNow(s)) return this.fieldGoal();

    if (this.down === 4) {
      const decision = coach.fourthDown(s, this.rng);
      if (decision === 'punt') return this.punt();
      if (decision === 'fg') return this.fieldGoal();
    }

    if (this.preSnapPenalty()) return;

    const defCall = coach.defenseCall(s, this.rng);
    this.pressureBy = null;
    const result = this.rng.chance(coach.passProbability(s)) ? this.passPlay(s, defCall) : this.runPlay(s, defCall);
    if (this.pressureBy) this.creditPressure(result.stats, this.pressureBy, defCall, false);
    this.resolve(result);
  }

  private preSnapPenalty(): boolean {
    const off = this.offense;
    const roll = this.rng.next();
    const pFalseStart = 0.027 * Math.exp(-0.06 * (this.lineups[off].offenseDiscipline - OL_DISCIPLINE));
    const dl = this.lineups[this.def];
    const pOffside = 0.017 * Math.exp(-0.06 * (dl.defenseDiscipline - DL_DISCIPLINE)) * (1 + 0.1 * this.count([...dl.dt, ...dl.edge], 'firstStep'));
    if (roll < pFalseStart) {
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
    if (roll < pFalseStart + pOffside) {
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
    this.resolve({ kind: 'kneel', yards: -loss, text: `${short(qb)} kneels.`, duration: 2, clockStops: false, stats: buf });
  }

  /** Out of timeouts: hurry to the line and throw the ball into the turf. Costs a down. */
  private spike() {
    this.preSnapRunoff(this.rng.int(4, 8));
    if (this.clock <= 0) return;
    const qb = this.lineups[this.offense].qb;
    const buf = new StatBuffer();
    buf.add(qb, 'passAtt');
    this.takeSnapshot();
    this.resolve({ kind: 'spike', yards: 0, text: `${short(qb)} spikes the ball to stop the clock`, duration: this.clock >= 3 ? 1 : 0, clockStops: true, stats: buf, passAttempt: true, complete: false });
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

  /** Whether a player brings an established quirk to this game (`quirks.ts`). */
  private has(p: Player | undefined, q: QuirkId): boolean {
    if (!p?.quirks) return false;
    let set = this.quirkSets.get(p.id);
    if (!set) this.quirkSets.set(p.id, (set = new Set(activeQuirks(p))));
    return set.has(q);
  }

  /** How many of a unit carry a quirk. */
  private count(players: readonly Player[], q: QuirkId): number {
    let n = 0;
    for (const p of players) if (this.has(p, q)) n++;
    return n;
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

    // Read options for every quarterback, designed runs for the mobile ones and sneaks on a yard to go
    // or at the goal line: NFL quarterbacks take about 15% of their teams' rushing yards (scrambles
    // included) and score about a fifth of the rushing touchdowns.
    const sneak = s.distance <= 1 || yardsToGoal <= 2 ? 0.14 : 0;
    // Even the fastest quarterback is a quarterback: designed runs stop growing past a point.
    const qbRunWeight = 0.025 + sneak + clamp(skill(off.qb, 'scrambling') - 8, 0, 5) * 0.015 + off.scheme.offense.qbRun;
    // Lead backs get about 60% of the carries and the second back spells him, more so as the lead
    // back's carries pile up: on a 35-run day the backup takes a real share (few backs average 22 a game).
    const leadCarries = this.playerStats[off.rbs[0].id]?.rushAtt ?? 0;
    const leadLoad = leadCarries <= LEAD_BACK_CARRIES ? 1 : Math.max(0.35, 1 - 0.08 * (leadCarries - LEAD_BACK_CARRIES));
    const rusher = rng.weighted(
      [
        [off.rbs[0], (yardsToGoal <= 5 ? 0.55 : 0.62) * leadLoad],
        // Teams spread goal-line work too, so one back rarely scores 18.
        [off.rbs[1] ?? off.rbs[0], yardsToGoal <= 5 ? 0.4 : 0.3],
        [off.qb, qbRunWeight],
        [off.wrs[0], 0.015],
      ] as [Player, number][],
      ([, w]) => w,
    )[0];
    // Zone schemes stretch to the edge, gap schemes hit it downhill.
    const outside = rng.chance(off.scheme.offense.outside);
    const boxAdj = { base: 0, runD: 1.5, passD: -1.5, blitz: 0.6 }[defCall];
    const homeAdj = this.offense === 0 ? this.homeEdge : -this.homeEdge;
    const lineDelta = off.runBlock - (def.runStop + boxAdj) + homeAdj;
    const rusherSkill = skill(rusher, outside ? 'outsideRun' : 'insideRun');

    // Outside runs also have to get around the edge defenders.
    const contain = outside ? 0.2 * (def.edgeContain - EDGE_CONTAIN) : 0;
    // The best backs average about a yard a carry more than the league, not three: the line and the
    // defense decide most of a run, the back the rest (NFL rushing leaders run 4.5–5.5 a carry).
    // Quirks that swing a run both ways: a back hunting the home run, a lineman chasing pancakes, a
    // linebacker shooting gaps. Each widens the spread and costs a little on the typical carry.
    const dwells = this.has(rusher, 'dwellsInHole') ? 1 : 0;
    const pancakes = this.count(off.ol, 'pancakePreacher');
    const shooters = this.count(def.lb, 'gapShooter');
    const spread = 2.9 + 0.8 * dwells + 0.25 * pancakes + 0.4 * shooters;
    const swing = 0.25 * dwells + 0.05 * pancakes + 0.1 * shooters;
    let yards = rng.normal(RUN_BASE + 0.25 * lineDelta + 0.1 * (rusherSkill - 12) - contain - swing, spread);
    if (yards > 4) {
      // Past the line: beat the best linebacker's tackle, then outrun the deep safety.
      const lbTackle = Math.max(...def.lb.map((p) => skill(p, 'tackling')));
      const speed = skill(rusher, 'longSpeed');
      const pBreak = clamp(0.2 + 0.015 * (skill(rusher, 'breakTackles') - lbTackle) + 0.012 * (speed - skill(def.s[0], 'pursuit')), 0.08, 0.36);
      if (rng.chance(pBreak)) {
        yards += rng.exponential(Math.max(2.5, 5 + 0.25 * (speed - 12)));
        if (rng.chance(clamp(0.1 + 0.008 * (speed - 12), 0.05, 0.18))) yards += rng.exponential(22);
      }
    }
    yards = Math.round(Math.max(yards, -6));
    // He falls forward: a short gain gets one more yard.
    if (yards >= -1 && yards <= 3 && this.has(rusher, 'finishesForward')) yards++;
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

    const pFumble = 0.013 * Math.exp(-0.13 * (skill(rusher, 'ballSecurity') - 12)) * (this.has(rusher, 'looseCarriage') ? LOOSE_CARRIAGE : 1);
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
    const buf = new StatBuffer();
    const yardsToGoal = 100 - this.yardLine;
    const homeAdj = this.offense === 0 ? this.homeEdge : -this.homeEdge;
    const decisions = skill(qb, 'decisionMaking');

    const rushAdj = { base: 0, runD: 0.3, passD: -1, blitz: 2.5 }[defCall];
    // A back who picks up the blitz buys his quarterback time; one who whiffs gets him hit.
    const pickup = defCall === 'blitz' ? 0.3 * (skill(off.rbs[0], 'passPro') - 10) : 0;
    // Quirks up front: a quick first step and a bull rush get there more often, an anchor holds up.
    const front = [...def.dt, ...def.edge];
    const quirkRush = 0.35 * this.count(front, 'firstStep') + 0.3 * this.count(front, 'bullRush') - 0.35 * this.count(off.ol, 'anchor');
    const pressureDelta = def.passRush + rushAdj - off.passBlock - pickup - homeAdj - off.scheme.offense.release + quirkRush;
    const pressured = rng.chance(clamp(0.3 + 0.035 * pressureDelta, 0.1, 0.65));

    if (pressured) {
      const pocket = skill(qb, 'pocketPresence') + (this.has(qb, 'muddyPockets') ? 1.5 : 0);
      // A bull rush collapses the pocket rather than finishing: more hurries, fewer of them sacks.
      const pSack = clamp(0.2 - 0.022 * (pocket - 12), 0.08, 0.38) * (1 - 0.08 * this.count(front, 'bullRush'));
      if (rng.chance(pSack)) return this.sack(def, defCall);
      this.pressureBy = this.creditRng.weighted(rushers(def, defCall === 'blitz'), ([, w]) => w)[0];
      if (rng.chance(clamp(0.16 + 0.02 * (skill(qb, 'scrambling') - 9), 0.06, 0.4))) return this.scramble(def, s);
      // A gunslinger never throws it away.
      if (!this.has(qb, 'gunslinger') && rng.chance(0.12)) {
        buf.add(qb, 'passAtt');
        return { kind: 'pass', yards: 0, text: `${short(qb)} under pressure, throws it away`, duration: rng.int(4, 6), clockStops: true, stats: buf, passAttempt: true, complete: false, airYards: 0, depth: 'short' };
      }
    }

    // Coverage holds and nothing comes open: a quarterback with legs takes off anyway.
    if (!pressured && rng.chance(clamp(0.015 + 0.004 * (skill(qb, 'scrambling') - 9), 0.005, 0.05))) return this.scramble(def, s);

    const depth = coach.passDepth(s, rng);
    // Targets: [receiver, base weight by depth, coverage defender]
    const lbCover = def.lb[1] ?? def.lb[0];
    const scheme = off.scheme.offense;
    const tw = scheme.targets;
    const times = (w: Record<PassDepth, number>, m: number) => ({ short: w.short * m, medium: w.medium * m, deep: w.deep * m });
    const teCover = rng.chance(0.5) ? def.s[1] ?? def.s[0] : def.lb[0];
    // Personnel decides who runs routes: 12 swaps the slot receiver for a second tight end, 10 the tight end for a fourth receiver.
    const options: [Player | undefined, Record<PassDepth, number>, Player][] = [
      [off.wrs[0], times({ short: 0.19, medium: 0.27, deep: 0.33 }, tw.wr), def.cb[0]],
      [off.wrs[1], times({ short: 0.17, medium: 0.26, deep: 0.3 }, tw.wr), def.cb[1] ?? def.cb[0]],
      [scheme.personnel === '12' ? undefined : off.wrs[2], times({ short: 0.14, medium: 0.15, deep: 0.15 }, tw.slot), def.cb[2] ?? def.cb[0]],
      scheme.personnel === '10'
        ? [off.wr4, times({ short: 0.14, medium: 0.15, deep: 0.1 }, tw.slot), def.s[1] ?? def.s[0]]
        : [off.tes[0], times({ short: 0.2, medium: 0.21, deep: 0.11 }, tw.te), teCover],
      [off.rbs[0], times({ short: 0.3, medium: 0.07, deep: 0.02 }, tw.rb), lbCover],
      [off.rbs[1], times({ short: 0.09, medium: 0.02, deep: 0 }, tw.rb), def.lb[0]],
      scheme.personnel === '12'
        ? [off.tes[1], times({ short: 0.12, medium: 0.12, deep: 0.08 }, tw.te), def.cb[2] ?? def.lb[0]]
        : [scheme.personnel === '10' ? undefined : off.tes[1], times({ short: 0.03, medium: 0.02, deep: 0.01 }, tw.te), def.lb[0]],
    ];
    const valid = options.filter((o): o is [Player, Record<PassDepth, number>, Player] => !!o[0]);
    // In tight space defenses bracket the top receiver, so red-zone looks spread to the tight end and backs.
    const bracket = yardsToGoal <= 10 ? 0.75 : 1;
    const [receiver, , defender] = rng.weighted(valid, ([p, w]) => w[depth] * (0.6 + 0.04 * skill(p, 'targeting')) * (p === off.wrs[0] ? bracket : 1));
    const isBack = receiver.position === 'RB';

    const recvSkill = skill(receiver, depth === 'deep' ? 'deepRoutes' : 'shortRoutes');
    const coverage = def.scheme.coverage;
    // Man coverage puts the matchup on an island (the defender's skill counts for more); zone spreads it.
    let covSkill = skill(defender, depth === 'deep' ? 'deepCoverage' : 'coverage');
    // Coverage quirks: hips that turn and run, eyes that jump the first break, hips that can't run in man.
    if (depth === 'deep') covSkill += (this.has(defender, 'fluidHips') ? 2.5 : 0) - (this.has(defender, 'bitesOnDoubleMoves') ? 3 : 0);
    else if (this.has(defender, 'bitesOnDoubleMoves')) covSkill += 0.5;
    // Man coverage, or the man-to-man a blitz leaves behind it.
    if ((coverage?.man || defCall === 'blitz') && this.has(defender, 'manDeficit')) covSkill -= 5;
    const island = coverage ? (coverage.man ? MAN_ISLAND : ZONE_ISLAND) : 0;
    let sep = recvSkill - covSkill - island * (covSkill - 12) + homeAdj + (isBack && depth === 'short' ? 2.5 : 0);
    // Turning to find the ball means losing the man now and then.
    if (this.has(defender, 'playsTheBall')) sep += 0.6;
    if (coverage) sep += coverage.sep[depth === 'short' ? 0 : depth === 'medium' ? 1 : 2];
    if (depth === 'short') sep += scheme.quick;
    // Play action off a run game the defense respects: the linebackers bite and the windows behind them open.
    const earlyDown = s.down <= 2 && depth !== 'short' && coach.tempo(s) === 'normal';
    if (scheme.playAction && earlyDown) sep += scheme.playAction * clamp((off.runBlock - 8) / 4, 0, 1.5);
    // Every offense fakes a handoff now and then: linemen who crash on it leave the window behind them open.
    if (earlyDown) sep += 0.3 * this.count(front, 'bitesOnPlayAction');
    // The deep safety closes windows over the top (deep balls always face some help).
    const help = skill(def.s[0], 'deepHelp') - DEEP_HELP;
    if (depth === 'deep') sep -= 0.93 + 0.35 * help;
    else if (depth === 'medium') sep -= 0.2 * help;
    sep += { base: 0, runD: 0.8, passD: -1.2, blitz: 1.5 }[defCall];
    // Defenses roll coverage toward a mismatch, so a receiver far better than his man still gets open
    // but not by a mile: big separation pays less and less (keeps elite seasons inside NFL records).
    if (sep > SEP_ROLL) sep = SEP_ROLL + (sep - SEP_ROLL) * 0.5;

    // Past a point, placement can't beat physics: the best arms complete a few more, not every throw.
    const rawAcc = skill(qb, depth === 'short' ? 'shortAccuracy' : depth === 'medium' ? 'midAccuracy' : 'deepAccuracy');
    const acc = rawAcc > ACC_SOFT_CAP ? ACC_SOFT_CAP + (rawAcc - ACC_SOFT_CAP) * 0.5 : rawAcc;
    let pComplete = { short: 0.79, medium: 0.6, deep: 0.38 }[depth] + 0.018 * (acc - 12) + 0.019 * sep + 0.012 * (skill(receiver, 'hands') - 12);
    if (pressured) pComplete -= 0.17 - 0.01 * (decisions - 12);
    // A gunslinger who won't throw it away forces it into coverage instead.
    if (pressured && this.has(qb, 'gunslinger')) pComplete -= 0.1;
    if (yardsToGoal <= 10 && depth !== 'short') pComplete -= 0.06;
    if (depth === 'deep' && this.has(receiver, 'goesUpForIt')) pComplete += 0.03;
    else if (depth !== 'deep' && this.has(receiver, 'hearsFootsteps')) pComplete -= 0.04;
    pComplete = clamp(pComplete, 0.05, 0.95);

    const pInt =
      { short: 0.0095, medium: 0.023, deep: 0.04 }[depth] *
      Math.exp(
        -0.07 * (decisions - 12) -
          0.05 * (acc - 12) +
          0.05 * (skill(defender, 'ballSkills') + this.ballHawk(defender, !coverage?.man) - 8) -
          0.05 * sep +
          // A ball-hawking safety lurks over the top.
          (depth === 'short' ? 0 : 0.05 * (skill(def.s[0], 'ballSkills') - 12)),
      ) *
      (pressured ? 1.6 : 1) *
      (coverage?.ints ?? 1) *
      this.riskyThrow(qb, receiver, depth, !coverage?.man) *
      this.undercut(def, depth, !coverage?.man);

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
      const yacSkill = skill(receiver, 'afterCatch') - skill(tackler, 'tackling');
      let yac = Math.max(0, rng.normal({ short: 3.6, medium: 2.8, deep: 2.4 }[depth] + 0.3 * yacSkill + (this.has(receiver, 'yacSlasher') ? 0.6 : 0), 3));
      if (rng.chance(clamp((0.022 + 0.004 * yacSkill) * (coverage?.yac ?? 1), 0.01, 0.06))) yac += rng.exponential(16);
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

    if (rng.chance(0.0065 * Math.exp(-0.12 * (skill(receiver, 'ballSecurity') - 12)) * (this.has(receiver, 'looseCarriage') ? LOOSE_CARRIAGE : 1))) {
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

  /** Ball-skill points a defender's quirks add: a zone hawk in zone, a ball hawk anywhere. */
  private ballHawk(defender: Player, zone: boolean): number {
    return (zone && this.has(defender, 'zoneHawk') ? 5 : 0) + (this.has(defender, 'playsTheBall') ? 4 : 0);
  }

  /** Linebackers who undercut throws in zone, whoever the ball is meant for. */
  private undercut(def: Lineup, depth: PassDepth, zone: boolean): number {
    return zone && depth !== 'deep' ? 1 + 0.15 * this.count(def.lb, 'zoneHawk') : 1;
  }

  /** Interception odds from the passer's and the receiver's quirks. */
  private riskyThrow(qb: Player, receiver: Player, depth: PassDepth, zone: boolean): number {
    let m = this.has(qb, 'gunslinger') ? 1.25 : 1;
    if (depth === 'short' && zone && this.has(qb, 'staresDown')) m *= 1.5;
    if (depth === 'deep' && this.has(receiver, 'goesUpForIt')) m *= 0.9;
    return m;
  }

  private sack(def: Lineup, defCall: DefenseCall): PlayResult {
    const qb = this.lineups[this.offense].qb;
    const buf = new StatBuffer();
    // Sacks spread like the NFL's: the starting edges get the most, but the rotation, the
    // linebackers and, on blitzes, the secondary all get home, so one rusher can't take half.
    const sacker = this.rng.weighted(rushers(def, defCall === 'blitz'), ([, w]) => w)[0];
    let loss = Math.round(clamp(this.rng.normal(6.5, 2.5), 1, 15));
    if (this.yardLine - loss < 0) loss = this.yardLine;
    buf.add(qb, 'sacked');
    buf.add(qb, 'sackYds', loss);
    buf.add(sacker, 'sacks');
    buf.add(sacker, 'tackles');
    buf.add(sacker, 'tfl');
    this.creditPressure(buf, sacker, defCall, true);
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

  /**
   * A rusher got home: credit him, and charge the blocker across from him (spots from `schemes.ts`:
   * the right end rushes the left tackle, the tackles take on the guards and center, an unblocked
   * blitzer is the back's to pick up). A sack is also a pressure and a hit.
   */
  private creditPressure(buf: StatBuffer, rusher: Player, defCall: DefenseCall, sack: boolean) {
    const off = this.lineups[this.offense];
    const def = this.lineups[this.def];
    const rng = this.creditRng;
    const hit = sack || rng.chance(QB_HIT_SHARE);
    buf.add(rusher, 'pressures');
    if (hit) buf.add(rusher, 'qbHits');
    // Coverage sacks and a quarterback holding the ball: nobody up front lost (charting services blame no blocker on about a third of sacks).
    if (rng.chance(sack ? UNBLAMED_SACK : UNBLAMED_PRESSURE)) return;
    const blocker = blockerFor(off, def, rusher, defCall === 'blitz', rng);
    if (!blocker) return;
    buf.add(blocker, 'pressuresAllowed');
    if (hit) buf.add(blocker, 'hitsAllowed');
    if (sack) buf.add(blocker, 'sacksAllowed');
  }

  private scramble(def: Lineup, s: Situation): PlayResult {
    const qb = this.lineups[this.offense].qb;
    const buf = new StatBuffer();
    const speed = skill(qb, 'scrambling');
    // Scrambles find open grass: the NFL's average about seven yards.
    let yards = this.rng.normal(6 + 0.35 * Math.min(speed - 9, 5), 3.5);
    if (yards > 6 && this.rng.chance(0.15 + 0.015 * (speed - 12))) yards += this.rng.exponential(10);
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
    const lane = this.rng.pick([-0.9, 0.9]);
    if (td) return { kind: 'scramble', yards, text, duration: this.rng.int(5, 8), clockStops: true, stats: buf, lane };
    // A quarterback in a two-minute drill heads for the sideline; one protecting a lead stays in.
    const t = coach.tempo(s);
    const oob = this.rng.chance(t === 'hurry' ? 0.55 : t === 'milk' ? 0.05 : 0.2);
    const slide = !oob && this.rng.chance(0.4);
    const ending = oob ? ', out of bounds' : slide ? ', slides' : '';
    return { kind: 'scramble', yards, text: text + ending, duration: this.rng.int(5, 8), clockStops: oob && this.oobStopsClock(), stats: buf, lane };
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
      const pHold = 0.038 * Math.exp(-0.05 * (this.lineups[offSide].offenseDiscipline - OL_DISCIPLINE)) * (1 + 0.15 * this.count(this.lineups[offSide].ol, 'handPlacement'));
      if (roll < pHold && !bad && result.yards > -8) {
        const yards = Math.min(10, Math.floor(this.yardLine / 2));
        penalty = { on: offSide, yards: -yards, text: `PENALTY on ${this.abbrev(offSide)}: Offensive holding, ${yards} yards. No play.`, autoFirst: false, replayDown: true };
      } else if (result.passAttempt && !result.complete && !bad && result.airYards! > 0) {
        const pDpi = { short: 0.008, medium: 0.03, deep: 0.06 }[result.depth!];
        if (roll < pHold + pDpi) {
          const yards = Math.min(Math.max(1, result.airYards!), 99 - this.yardLine);
          penalty = { on: defSide, yards, text: `PENALTY on ${this.abbrev(defSide)}: Pass interference, ${yards} yards.`, autoFirst: true, replayDown: false };
        } else if (roll < pHold + pDpi + 0.02) {
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
    if (result.kind === 'pass' || result.kind === 'spike') {
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
      // When a half runs out on this play, possession no longer matters (halftime/overtime kickoffs follow).
      if (this.clock === 0 && (this.quarter === 2 || this.quarter === 4)) return;
      this.log('Turnover on downs.');
      this.changePossession(100 - this.yardLine);
      return;
    } else {
      this.down++;
    }
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
