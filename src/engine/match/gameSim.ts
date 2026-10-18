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
import { CONTACT_RISK, fatigueMult, HELD_SHARE, injuryLabel, riskFactors, rollInjury, SIDELINE_REST, SNAP_CONTACT, SNAP_EXPOSURE, SNAP_RISK, snapCost, type ContactEvent, type Mechanism, type RiskFactors } from '../injuries';
import { departmentFor, type Department } from '../medical';
import { crewCalls, gameCrew, type CrewCalls } from '../officials';
import { enforce, FOULS, type Spot } from '../penalties';
import { activeQuirks, formFor, type QuirkId } from '../quirks';
import { clamp, Rng } from '../rng';
import type { Crew, Foul, Game, GameInjury, GameResult, League, PlayKind, PlayLogEntry, Player, StatKey, StatLine, TeamGameStats } from '../types';
import { MAX_STATS } from '../types';
import { gameWeather, staminaDrain, turfRisk, weatherAt, weatherEffects, type Weather, type WeatherCost } from '../weather';
import * as coach from './coach';
import type { DefenseCall, PassDepth, Situation } from './coach';
import { activePlayers, buildLineup, discipline, type Lineup } from './lineup';

type Side = 0 | 1; // 0 = home, 1 = away

export interface SimOptions {
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
/** Base odds of each foul per chance at it (see docs/PENALTIES.md for the NFL rates they're tuned to). */
const FALSE_START = 0.027;
const OFFSIDE = 0.017;
/** Offensive holding, per run, pass, sack or scramble: declined when the play was worse for the offense anyway. */
const HOLDING = 0.039;
/** Pass interference by depth, on incompletions thrown past the line. */
const DPI: Record<PassDepth, number> = { short: 0.012, medium: 0.045, deep: 0.09 };
/** Defensive holding, per dropback: declined when the play beat 5 yards and a first down. */
const DEF_HOLDING = 0.0134;
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
/** How strongly a matchup brings a habit out: 0 for a rating of 10 or less, up to 1.5 for an elite one. */
const pull = (rating: number) => clamp((rating - 10) / 5, 0, 1.5);
const unitAvg = (players: readonly Player[], contest: Parameters<typeof skill>[1]) => players.reduce((a, p) => a + skill(p, contest), 0) / Math.max(1, players.length);
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

/** A flag thrown during a play: the foul, who drew it, and how far downfield a spot foul happened. */
interface LiveFoul {
  foul: Foul;
  by?: Player;
  spotYards?: number;
}

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
  /** The man in coverage on a pass: flags for grabbing are his. */
  defender?: Player;
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
    flags: {},
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

/** Who is on the field for a snap: the offense's eleven (by personnel) and the defense's. */
function units(l: Lineup): [offense: Player[], defense: Player[]] {
  const personnel = l.scheme.offense.personnel;
  const receivers = personnel === '12' ? [...l.wrs.slice(0, 2), ...l.tes.slice(0, 2)] : personnel === '10' ? [...l.wrs, ...(l.wr4 ? [l.wr4] : [])] : [...l.wrs, l.tes[0]];
  return [
    [l.qb, ...l.ol, l.rbs[0], ...receivers],
    [...l.dt, ...l.edge, ...l.lb, ...l.cb, ...l.s],
  ];
}

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

  constructor(
    private league: League,
    private game: Game,
    private options: SimOptions,
  ) {
    this.rng = new Rng(options.seed ?? `${league.seed}:${game.season}:${game.id}`);
    this.creditRng = new Rng(`${options.seed ?? `${league.seed}:${game.season}:${game.id}`}:credit`);
    this.injuryRng = new Rng(`${options.seed ?? `${league.seed}:${game.season}:${game.id}`}:injury`);
    this.flagRng = new Rng(`${options.seed ?? `${league.seed}:${game.season}:${game.id}`}:flags`);
    this.homeEdge = game.neutral ? 0 : HOME_FIELD_EDGE;
    this.weather = options.weather ?? gameWeather(league, game);
    this.wx = weatherEffects(weatherAt(this.weather, 1));
    this.turf = turfRisk(weatherAt(this.weather, 1));
    this.drain = [staminaDrain(this.weather, true), staminaDrain(this.weather, false)];
    this.crew = options.crew === undefined ? gameCrew(league, game) : (options.crew ?? undefined);
    this.calls = crewCalls(this.crew);
    const team = (id: number) => league.teams[id];
    this.lineups = [buildLineup(league, team(game.homeId)), buildLineup(league, team(game.awayId))];
    this.styles = [callerStyle(league, game.homeId), callerStyle(league, game.awayId)];
    this.qbLeans = qbLeans(league, [this.lineups[0].qb, this.lineups[1].qb]);
    this.fields = [units(this.lineups[0]), units(this.lineups[1])];
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

  private credit(buf: StatBuffer) {
    for (const [p, key, value] of buf.entries) {
      const line = (this.playerStats[p.id] ??= {});
      if (MAX_STATS.has(key)) line[key] = Math.max(line[key] ?? 0, value);
      else line[key] = (line[key] ?? 0) + value;
    }
    this.wear(buf);
  }

  // ───────────────────────── wear and injuries ─────────────────────────

  /**
   * What a play that counted did to bodies, read from its stat line: a scrimmage snap tires everyone
   * on the field (and rests everyone off it) and carries the snap's injury risk, and each collision
   * it records (a ball carrier brought down, a sack, a hit on the quarterback, a return) adds its own.
   */
  private wear(buf: StatBuffer) {
    const rb2 = this.lineups[this.offense].rbs[1];
    let scrimmage = false;
    let tackled = false;
    let sacked = false;
    let spell = false;
    for (const [p, key] of buf.entries) {
      if (key === 'passAtt' || key === 'rushAtt') scrimmage = true;
      else if (key === 'sacked') scrimmage = sacked = true;
      else if (key === 'tackles') tackled = true;
      // The second back is on the field for the plays he's part of, spelling the lead back.
      if (p === rb2) spell = true;
    }
    if (scrimmage) this.snap(spell);
    for (const [p, key] of buf.entries) {
      if (key === 'rushAtt' || key === 'rec') {
        if (tackled) this.collide(p, 'carrier');
        else if (this.gained(buf, p)) this.collide(p, 'free');
      } else if (key === 'tackles') this.collide(p, 'tackler');
      else if (key === 'sacked') this.collide(p, 'sacked');
      else if (key === 'qbHits' && !sacked) this.collide(this.lineups[this.offense].qb, 'hit');
      else if (key === 'krAtt' || key === 'prAtt') this.collide(p, 'returner');
      else if (key === 'punts' || key === 'fgAtt' || key === 'xpAtt') this.collide(p, 'kick');
    }
  }

  /** Did he gain ground on the play (a carry or catch nobody tackled him on: a score or out of bounds)? */
  private gained(buf: StatBuffer, p: Player): boolean {
    for (const [x, k, v] of buf.entries) if (x === p && (k === 'rushYds' || k === 'recYds') && v > 0) return true;
    return false;
  }

  private dept(p: Player): Department {
    return this.depts.get(p.teamId) ?? this.depts.set(p.teamId, departmentFor(this.league, p.teamId)).get(p.teamId)!;
  }

  private body(p: Player) {
    let b = this.bodies.get(p.id);
    const side = this.lineups[0].team.id === p.teamId ? 0 : 1;
    if (!b) this.bodies.set(p.id, (b = { energy: p.condition ?? 100, spent: 0, cost: snapCost(p) * this.drain[side], risk: riskFactors(this.league, p, this.dept(p)) }));
    return b;
  }

  /** One scrimmage snap: the units on the field tire and face the snap's risk; the units off it rest. */
  private snap(spell: boolean) {
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
      }
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
      const { injury, scar } = rollInjury(this.injuryRng, this.league, p, mechanism, 'game', this.dept(p), { season: this.game.season, week: this.game.week });
      this.injuries.push({ playerId: p.id, teamId: this.lineups[side].team.id, quarter: this.quarter, clock: this.clock, type: injury.type, estimate: [...injury.estimate] });
      this.diagnoses[p.id] = { injury, ...(scar ? { scar } : {}) };
      this.snapshot = null;
      this.log(`Injury: ${this.abbrev(side)} ${p.position} ${short(p)} (${injuryLabel(injury.type).toLowerCase()}) is out for the game.`);
      const qb = this.lineups[side].qb;
      this.lineups[side] = buildLineup(this.league, this.lineups[side].team, this.out);
      this.fields[side] = units(this.lineups[side]);
      if (this.lineups[side].qb !== qb) this.qbLeans = qbLeans(this.league, [this.lineups[0].qb, this.lineups[1].qb]);
    }
    this.hurt = [];
  }

  private fgProb(distance: number, kicker: Player): number {
    // Wind, snow and cold make every kick play longer; coaches see it in their range too.
    distance += this.wx.kick;
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
    this.log(w.roof === 'open' ? `${fall} moves in, and the roof closes.` : `${w.heavy ? `Heavy ${fall.toLowerCase()}` : fall} starts to fall.`);
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
    const touchback = this.rng.chance(clamp(0.38 + 0.025 * (kp - 12) + (this.has(kicking.k, 'boomerLeg') ? 0.12 : 0) - 0.02 * this.wx.kick, 0.15, 0.8));
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

    const outkicks = this.has(p, 'outkicksCoverage');
    const coffin = this.has(p, 'coffinCorner');
    const arc = this.has(p, 'highArc');
    // Weather shortens punts, and wind scatters them.
    let gross = Math.round(clamp(this.rng.normal(46 + 0.9 * (skill(p, 'puntDistance') - 12) + (outkicks ? 3 : 0) - (arc ? 3 : 0) - 0.5 * this.wx.kick, 5.5 + 0.3 * Math.max(0, this.wx.kick)), 25, 70));
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
      this.log(`${short(p)} punts ${gross} yards into the end zone. Touchback.`);
      this.changePossession(20);
      return;
    }
    const receiveAt = 100 - landing;
    const pr = def.pr;
    // A well-placed punt (hang time, toward the sideline) leaves the returner no room.
    // No hang time means no fair catches; a coffin-corner man from plus territory leaves no room.
    const hang = (outkicks ? -0.15 : 0) + (coffin && room < 60 ? 0.2 : 0) + (arc ? 0.12 : 0);
    if (receiveAt <= 10 || this.rng.chance(clamp(0.42 + 0.02 * (skill(p, 'puntPlacement') - 12) + hang, 0.2, 0.65))) {
      this.credit(buf);
      this.log(`${short(p)} punts ${gross} yards. ${receiveAt <= 10 ? 'Downed' : `Fair catch by ${short(pr)}`} at the ${this.spot(receiveAt, this.def)}.`);
      this.changePossession(receiveAt);
      return;
    }
    const edge = skill(pr, 'returns') - 12;
    let ret = Math.max(0, Math.round(this.rng.normal(8 + 0.5 * edge + (outkicks ? 3 : 0) - (arc ? 1.5 : 0), 6)));
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
    this.kickForm(k, made);
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
      this.preSnapRunoff(t === 'hurry' ? this.rng.int(8, 16) : t === 'milk' ? this.rng.int(coach.MILK_RUNOFF_MIN, 41) : this.rng.int(28, 38));
    }
    if (this.clock <= 0 && !this.untimed) return;
    // The untimed down is this one: whatever happens on it, the half ends after (unless the defense fouls again).
    this.untimed = false;

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

  /**
   * Before the snap: a false start kills the play; a defender offside lets it run (a free play), and
   * the offense picks the result or the 5 yards once it's over (`callFouls`).
   */
  private preSnapPenalty(): boolean {
    const off = this.offense;
    const roll = this.rng.next();
    // A hard count draws the defense offside (a jumpy lineman most of all), and now and then his own line.
    const hardCount = this.has(this.lineups[off].qb, 'hardCount');
    const pFalseStart = FALSE_START * Math.exp(-0.06 * (this.lineups[off].offenseDiscipline - OL_DISCIPLINE)) * (hardCount ? 1.15 : 1) * this.calls.all;
    const dl = this.lineups[this.def];
    const dlFront = [...dl.dt, ...dl.edge];
    const pOffside =
      OFFSIDE *
      Math.exp(-0.06 * (dl.defenseDiscipline - DL_DISCIPLINE)) *
      (1 + 0.1 * this.count(dlFront, 'firstStep')) *
      (hardCount ? 1.3 : 1) *
      (1 + (hardCount ? 0.3 : 0.08) * this.count(dlFront, 'jumpHappy')) *
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

  /**
   * A unit's quirk with diminishing returns: each teammate who shares it adds 60% of the one before,
   * so a line of five anchors is worth about 2.3 of them, never five. Flags (holding, offside) stay
   * per man in `count`: every lineman can commit his own.
   */
  private stack(players: readonly Player[], q: QuirkId): number {
    return (1 - STACK ** this.count(players, q)) / (1 - STACK);
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
    const boxAdj = { base: 0, runD: 1.5, passD: -1.5, blitz: 0.6 }[defCall];
    const homeAdj = this.offense === 0 ? this.homeEdge : -this.homeEdge;
    const lineDelta = off.runBlock - (def.runStop + boxAdj) + homeAdj;
    const rusherSkill = skill(rusher, outside ? 'outsideRun' : 'insideRun');

    // Outside runs also have to get around the edge defenders.
    const contain = outside ? 0.2 * (def.edgeContain - EDGE_CONTAIN) : 0;
    // The best backs average about a yard a carry more than the league, not three: the line and the
    // defense decide most of a run, the back the rest (NFL rushing leaders run 4.5–5.5 a carry).
    const lean = this.runQuirks(off, def, rusher, outside, bounce, lineDelta, this.tired(s));
    let yards = rng.normal(RUN_BASE + 0.25 * lineDelta + 0.1 * (rusherSkill - 12) - contain + lean.mean, 2.9 + lean.spread);
    if (yards > 4) {
      // Past the line: beat the best linebacker's tackle, then outrun the deep safety.
      const lbTackle = Math.max(...def.lb.map((p) => skill(p, 'tackling')));
      const speed = skill(rusher, 'longSpeed');
      const pBreak = clamp(0.2 + 0.015 * (skill(rusher, 'breakTackles') - lbTackle) + 0.012 * (speed - skill(def.s[0], 'pursuit')) + lean.breakaway, 0.08, 0.36);
      if (rng.chance(pBreak)) {
        yards += rng.exponential(Math.max(2.5, 5 + 0.25 * (speed - 12)));
        if (rng.chance(clamp(0.1 + 0.008 * (speed - 12), 0.05, 0.18))) yards += rng.exponential(22);
      }
    }
    yards = Math.round(Math.max(yards, -6));
    // He falls forward: a short gain often gets one more yard.
    if (yards >= -1 && yards <= 3 && this.has(rusher, 'finishesForward') && rng.chance(0.5)) yards++;
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

    const pFumble = 0.013 * Math.exp(-0.13 * (skill(rusher, 'ballSecurity') - 12)) * this.fumbleOdds(rusher, tackler, true);
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
    // A quarterback who thrives in the hurry-up is sharper in it.
    const fast = coach.tempo(s) === 'hurry' && this.has(qb, 'noHuddle') ? 2.5 : 0;
    // A rattled quarterback rushes his reads and forces throws into covered windows.
    const ghosts = this.rattled.get(qb.id) ?? 0;
    const decisions = skill(qb, 'decisionMaking') + fast - 3 * ghosts;

    const rushAdj = { base: 0, runD: 0.3, passD: -1, blitz: 2.5 }[defCall];
    // A back who picks up the blitz buys his quarterback time; one who whiffs gets him hit.
    const pickup = defCall === 'blitz' ? 0.3 * (skill(off.rbs[0], 'passPro') + (this.has(off.rbs[0], 'blitzPickup') ? 5 : 0) - 10) : 0;
    const front = [...def.dt, ...def.edge];
    const quirkRush = this.rushQuirks(off, def, s, defCall === 'blitz');
    const pressureDelta = def.passRush + rushAdj - off.passBlock - pickup - homeAdj - off.scheme.offense.release + quirkRush;
    const pressured = rng.chance(clamp(0.3 + 0.035 * pressureDelta, 0.1, 0.65));

    if (pressured) {
      const pocket = skill(qb, 'pocketPresence') + (this.has(qb, 'muddyPockets') ? 1.5 : 0);
      // A bull rush collapses the pocket rather than finishing: more hurries, fewer of them sacks. A
      // heavy first punch buys the extra beat; a bend around the corner finishes.
      const pSack =
        clamp(0.2 - 0.022 * (pocket - 12), 0.08, 0.38) *
        (1 - 0.05 * this.stack(front, 'bullRush')) *
        (1 - 0.04 * this.stack(off.ol, 'heavyPunch')) *
        (1 + 0.08 * this.stack(def.edge, 'bendsArc')) *
        (1 + 0.03 * this.stack(off.ol, 'twoTapSet')) *
        (defCall === 'blitz' && this.has(off.rbs[0], 'blitzPickup') ? 0.8 : 1);
      if (rng.chance(pSack)) return this.sack(def, defCall);
      this.pressureBy = this.creditRng.weighted(rushers(def, defCall === 'blitz'), ([, w]) => w)[0];
      const bail = this.has(qb, 'bailsEarly') ? 1.7 : 1;
      if (rng.chance(clamp((0.16 + 0.02 * (skill(qb, 'scrambling') - 9)) * bail, 0.06, 0.55))) return this.scramble(def, s);
      // A gunslinger never throws it away.
      if (!this.has(qb, 'gunslinger') && rng.chance(0.12)) {
        buf.add(qb, 'passAtt');
        return { kind: 'pass', yards: 0, text: `${short(qb)} under pressure, throws it away`, duration: rng.int(4, 6), clockStops: true, stats: buf, passAttempt: true, complete: false, airYards: 0, depth: 'short' };
      }
    }

    // Coverage holds and nothing comes open: a quarterback with legs takes off anyway.
    if (!pressured && rng.chance(clamp(0.015 + 0.004 * (skill(qb, 'scrambling') - 9), 0.005, 0.05))) return this.scramble(def, s);

    const depth = coach.passDepth(s, rng);
    // He leaves before the deep route comes open.
    if (depth === 'deep' && !pressured && this.has(qb, 'bailsEarly') && rng.chance(0.15)) return this.scramble(def, s);
    // Targets: [receiver, base weight by depth, coverage defender]
    const lbCover = def.lb[1] ?? def.lb[0];
    const scheme = off.scheme.offense;
    const tw = scheme.targets;
    const times = (w: Record<PassDepth, number>, m: number) => ({ short: w.short * m, medium: w.medium * m, deep: w.deep * m });
    const teCover = rng.chance(0.5) ? def.s[1] ?? def.s[0] : def.lb[0];
    // Personnel decides who runs routes: 12 swaps the slot receiver for a second tight end, 10 the tight end for a fourth receiver.
    const options: [Player | undefined, Record<PassDepth, number>, Player][] = [
      [off.wrs[0], times({ short: 0.21, medium: 0.27, deep: 0.33 }, tw.wr), def.cb[0]],
      [off.wrs[1], times({ short: 0.17, medium: 0.26, deep: 0.3 }, tw.wr), def.cb[1] ?? def.cb[0]],
      [scheme.personnel === '12' ? undefined : off.wrs[2], times({ short: 0.14, medium: 0.15, deep: 0.15 }, tw.slot), def.cb[2] ?? def.cb[0]],
      scheme.personnel === '10'
        ? [off.wr4, times({ short: 0.14, medium: 0.15, deep: 0.1 }, tw.slot), def.s[1] ?? def.s[0]]
        : [off.tes[0], times({ short: 0.2, medium: 0.21, deep: 0.11 }, tw.te), teCover],
      [off.rbs[0], times({ short: 0.28, medium: 0.07, deep: 0.02 }, tw.rb), lbCover],
      [off.rbs[1], times({ short: 0.09, medium: 0.02, deep: 0 }, tw.rb), def.lb[0]],
      scheme.personnel === '12'
        ? [off.tes[1], times({ short: 0.12, medium: 0.12, deep: 0.08 }, tw.te), def.cb[2] ?? def.lb[0]]
        : [scheme.personnel === '10' ? undefined : off.tes[1], times({ short: 0.03, medium: 0.02, deep: 0.01 }, tw.te), def.lb[0]],
    ];
    const valid = options.filter((o): o is [Player, Record<PassDepth, number>, Player] => !!o[0]);
    // In tight space defenses bracket the top receiver, so red-zone looks spread to the tight end and backs.
    const bracket = yardsToGoal <= 10 ? 0.75 : 1;
    // Better receivers draw more looks, but not so many more that the top five outrun NFL leaders
    // (dome teams' receivers already get a lift from the weather).
    const [receiver, , defender] = rng.weighted(valid, ([p, w]) => w[depth] * (0.6 + 0.032 * skill(p, 'targeting')) * (p === off.wrs[0] ? bracket : 1));
    const isBack = receiver.position === 'RB';

    const recvSkill = skill(receiver, depth === 'deep' ? 'deepRoutes' : 'shortRoutes');
    const coverage = def.scheme.coverage;
    // Man coverage puts the matchup on an island (the defender's skill counts for more); zone spreads it.
    const man = !!coverage?.man || defCall === 'blitz';
    const earlyDown = s.down <= 2 && depth !== 'short' && coach.tempo(s) === 'normal';
    let covSkill = skill(defender, depth === 'deep' ? 'deepCoverage' : 'coverage') + this.coverQuirks(defender, depth, man, earlyDown);
    // Coverage quirks: hips that turn and run, eyes that jump the first break, hips that can't run in man.
    if (depth === 'deep') covSkill += (this.has(defender, 'fluidHips') ? 2.5 : 0) - (this.has(defender, 'bitesOnDoubleMoves') ? 3 : 0);
    else if (this.has(defender, 'bitesOnDoubleMoves')) covSkill += 0.5;
    // Man coverage, or the man-to-man a blitz leaves behind it.
    if (man && this.has(defender, 'manDeficit')) covSkill -= 6;
    const island = coverage ? (coverage.man ? MAN_ISLAND : ZONE_ISLAND) : 0;
    let sep = recvSkill - covSkill - island * (covSkill - 12) + homeAdj + (isBack && depth === 'short' ? 2.5 : 0);
    // Turning to find the ball means losing the man now and then.
    if (this.has(defender, 'playsTheBall')) sep += 0.6;
    // A receiver who sells his stem beats man coverage; one who can't get off the jam doesn't.
    if (man && this.has(receiver, 'stemsDB')) sep += 2.5;
    if (man && depth !== 'deep' && this.has(receiver, 'getsJammed')) sep -= 2.5;
    if (coverage) sep += coverage.sep[depth === 'short' ? 0 : depth === 'medium' ? 1 : 2];
    if (depth === 'short') sep += scheme.quick;
    // Play action off a run game the defense respects: the linebackers bite and the windows behind them open.
    if (scheme.playAction && earlyDown) sep += scheme.playAction * clamp((off.runBlock - 8) / 4, 0, 1.5);
    // Every offense fakes a handoff now and then: linemen who crash on it leave the window behind them open.
    if (earlyDown) sep += 0.5 * this.stack(front, 'bitesOnPlayAction') + 0.7 * this.stack(def.lb, 'misreadsKeys') - 0.2 * this.stack(def.lb, 'diagnoses');
    // The deep safety closes windows over the top (deep balls always face some help).
    // A quarterback who moves the safety with his eyes takes the help away from a zone.
    const eyes = !man && depth !== 'short' && this.has(qb, 'safetyEyes') ? 3.5 : 0;
    const help = skill(def.s[0], 'deepHelp') - DEEP_HELP - eyes;
    if (depth === 'deep') sep -= 0.93 + 0.35 * help;
    else if (depth === 'medium') sep -= 0.2 * help;
    sep += { base: 0, runD: 0.8, passD: -1.2, blitz: 1.5 }[defCall];
    // Defenses roll coverage toward a mismatch, so a receiver far better than his man still gets open
    // but not by a mile: big separation pays less and less (keeps elite seasons inside NFL records).
    if (sep > SEP_ROLL) sep = SEP_ROLL + (sep - SEP_ROLL) * 0.5;

    // Past a point, placement can't beat physics: the best arms complete a few more, not every throw.
    const rawAcc = skill(qb, depth === 'short' ? 'shortAccuracy' : depth === 'medium' ? 'midAccuracy' : 'deepAccuracy') + fast - 1.5 * ghosts;
    const acc = rawAcc > ACC_SOFT_CAP ? ACC_SOFT_CAP + (rawAcc - ACC_SOFT_CAP) * 0.5 : rawAcc;
    // Base odds are tuned with injuries on: backups throw and catch about a tenth of the passes, as in the NFL.
    let pComplete = { short: 0.803, medium: 0.611, deep: 0.383 }[depth] + 0.018 * (acc - 12) + 0.019 * sep + 0.012 * (skill(receiver, 'hands') - 12);
    if (pressured) pComplete -= 0.17 - 0.01 * (decisions - 12);
    // A gunslinger who won't throw it away forces it into coverage instead.
    if (pressured && this.has(qb, 'gunslinger')) pComplete -= 0.1;
    if (yardsToGoal <= 10 && depth !== 'short') pComplete -= 0.06;
    if (depth === 'deep' && this.has(receiver, 'goesUpForIt')) pComplete += 0.04;
    else if (depth !== 'deep' && this.has(receiver, 'hearsFootsteps')) pComplete -= 0.04;
    // Contested balls: hands shown late win them, hands that trap against the body don't.
    if (sep < 1) pComplete += this.contested(receiver, defender);
    pComplete -= WEATHER_PASS[depth] * this.wx.pass;
    pComplete = clamp(pComplete, 0.05, 0.95);

    const pInt =
      { short: 0.0089, medium: 0.0216, deep: 0.0375 }[depth] *
      Math.exp(
        -0.07 * (decisions - 12) -
          0.05 * (acc - 12) +
          0.065 * (skill(defender, 'ballSkills') + this.ballHawk(defender, !coverage?.man, depth) - 8) -
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
    const base = { kind: 'pass' as const, passAttempt: true, airYards: air, depth, duration, stats: buf, lane, defender };

    const roll = rng.next();
    if (roll < pInt) {
      // The man in coverage, or a safety over the top: the one with the better hands, more often.
      const catcher = rng.chance(0.65) ? defender : rng.weighted(def.s, (p) => skill(p, 'ballSkills'));
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
      let yac = Math.max(0, rng.normal({ short: 3.85, medium: 2.8, deep: 2.4 }[depth] + 0.3 * yacSkill + this.afterCatch(receiver, tackler, depth), 3));
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

    if (rng.chance(0.0065 * Math.exp(-0.12 * (skill(receiver, 'ballSecurity') - 12)) * this.fumbleOdds(receiver, tackler!, false))) {
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

  /** Ball-skill points a defender's quirks add: a zone hawk in zone, a ball hawk anywhere, a baiter on short throws. */
  private ballHawk(defender: Player, zone: boolean, depth: PassDepth): number {
    return (zone && this.has(defender, 'zoneHawk') ? 5 : 0) + (this.has(defender, 'playsTheBall') ? 4 : 0) + (depth === 'short' && this.has(defender, 'baitsQB') ? 9 : 0);
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
    let d = 0.35 * this.stack(front, 'firstStep') + 0.3 * this.stack(front, 'bullRush') - 0.35 * this.stack(off.ol, 'anchor');
    if (s.down === 3 && s.distance >= 7) d += 0.5 * this.stack(front, 'planAdjuster');
    if (this.tired(s)) d -= 0.4 * this.stack(front, 'gassed');
    if (blitz) d += 0.7 * (this.stack(off.ol, 'lungesAtStunts') - this.stack(off.ol, 'stuntCommunicator')) + 0.7 * this.stack(def.lb, 'greenDog');
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
  private runQuirks(off: Lineup, def: Lineup, rusher: Player, outside: boolean, bounce: boolean, lineDelta: number, tired: boolean) {
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
    mean += -0.08 * lb('diagnoses') + 0.15 * lb('slowFlow') + 0.25 * lb('stuckOnBlocks') * clamp((off.runBlock - 10) / 3, 0, 1.5);
    if (outside) mean -= 0.15 * lb('scraper') + 0.1 * this.stack(dbs, 'alleyCrusher');
    breakaway -= 0.012 * lb('thumper');
    return { mean, spread, breakaway };
  }

  /** Coverage points a defender's quirks add, by depth and look. */
  private coverQuirks(defender: Player, depth: PassDepth, man: boolean, earlyDown: boolean): number {
    let c = 0;
    if (man && depth !== 'deep' && this.has(defender, 'physicalJammer')) c += 3;
    if (depth === 'short' && this.has(defender, 'baitsQB')) c -= 0.5;
    if (!man && this.has(defender, 'spotDrop')) c += depth === 'short' ? 3 : -2.5;
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
    return p;
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

  /** Fumble odds from the ball carrier's and tackler's quirks. */
  private fumbleOdds(carrier: Player, tackler: Player, run: boolean): number {
    let m = (this.has(carrier, 'looseCarriage') ? LOOSE_CARRIAGE : 1) * this.wx.fumble;
    if (run && this.has(carrier, 'highKnee')) m *= 1.3;
    if (run && this.has(carrier, 'contactAverse')) m *= 0.7;
    if (this.has(tackler, 'ballStripper')) m *= 1.5;
    return m;
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
    let text = `${short(qb)} SACKED by ${short(sacker)} for -${loss} yards`;
    const taken = (this.sacksTaken.get(qb.id) ?? 0) + 1;
    this.sacksTaken.set(qb.id, taken);
    if (taken >= 2 && (this.rattled.get(qb.id) ?? 0) < 1 && this.has(qb, 'seesGhosts')) {
      this.rattled.set(qb.id, 1);
      this.everRattled.add(qb.id);
      this.streak.set(qb.id, 0);
      text += `. ${short(qb)} looks rattled`;
    }
    const result: PlayResult = { kind: 'sack', yards: -loss, text, duration: this.rng.int(4, 6), clockStops: false, stats: buf };
    // A quarterback who pats the ball before he throws gives the rusher a swipe at it.
    if (this.rng.chance(this.has(qb, 'patsTheBall') ? 0.18 : 0.1)) {
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
    // An edge rusher who loses contain opens the lane; one who never stops chasing closes it late.
    const front = [...def.dt, ...def.edge];
    let yards = this.rng.normal(6 + 0.35 * Math.min(speed - 9, 5) + 1.2 * this.stack(front, 'losesContainment'), 3.5);
    if (yards > 6 && this.rng.chance((0.15 + 0.015 * (speed - 12)) * (1 - 0.15 * this.stack(front, 'highMotor')))) yards += this.rng.exponential(10);
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
    let text = result.text;
    const airAt = result.passAttempt && result.airYards ? startYardLine + result.airYards : undefined;

    const fouls = this.playFouls(result);
    const warning = this.playTime(result.duration);
    this.driveSnaps++;

    if (fouls.length) {
      const call = this.callFouls(result, fouls);
      // Taken (or offsetting): the play never happened, though the snap still wore the defense down.
      if (call === true) return;
      text += call;
    }
    ts.plays++;

    this.credit(result.stats);
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
    if (result.kind === 'kneel' || result.kind === 'spike') return fouls;
    const off = this.lineups[this.offense];
    const def = this.lineups[this.def];
    const { all, holding, coverage } = this.calls;
    const pHold = HOLDING * Math.exp(-0.05 * (off.offenseDiscipline - OL_DISCIPLINE)) * (1 + 0.15 * this.count(off.ol, 'handPlacement')) * all * holding;
    if (this.rng.chance(pHold)) fouls.push({ foul: 'holding' });
    if (result.kind === 'run') return fouls;
    // A handsy defender grabs more (on a sack or a scramble, any of them might be the one), and a crew
    // that watches coverage closely sees more of it.
    const dbs = [...def.cb, ...def.s];
    const handsy = result.defender ? (this.has(result.defender, 'handsy') ? 1 : 0) : this.count(dbs, 'handsy') / Math.max(1, dbs.length);
    const grabby = (1 + 0.6 * handsy) * all * coverage;
    const pDpi = result.kind === 'pass' && !result.complete && !result.turnover && result.airYards! > 0 ? DPI[result.depth!] * grabby : 0;
    const roll = this.rng.next();
    if (roll < pDpi) fouls.push({ foul: 'passInterference', spotYards: result.airYards });
    else if (roll < pDpi + DEF_HOLDING * grabby) fouls.push({ foul: 'defHolding' });
    return fouls;
  }

  /**
   * Judge a play's flags. Both teams flagged: they offset and the down is replayed. Otherwise the side
   * fouled against takes whichever suits it best, the play or a penalty (`coach.takesPenalty`), and any
   * flag it doesn't take is declined. Returns true when the play is wiped out, or else the note on the
   * declined flags to add to its text.
   */
  private callFouls(result: PlayResult, fouls: LiveFoul[]): true | string {
    const offSide = this.offense;
    const defSide = this.def;
    const sideOf = (f: LiveFoul): Side => (FOULS[f.foul].side === 'offense' ? offSide : defSide);
    for (const f of fouls) f.by = this.committer(f.foul, result);
    const named = (f: LiveFoul) => `${FOULS[f.foul].label.toLowerCase()} on ${this.flagged(sideOf(f), f.by)}`;
    const at = this.spotNow();

    if (new Set(fouls.map(sideOf)).size === 2) {
      this.wipe(result);
      for (const f of fouls) this.flag(sideOf(f), f.foul, f.by, 'offset');
      this.clockRunning = false;
      this.setAnim(offSide, 'penalty', at.yardLine, at.yardLine, undefined, result.lane);
      this.log(`${result.text}. Offsetting penalties: ${fouls.map(named).join(', ')}. Replay the down.`);
      return true;
    }

    const fouled = FOULS[fouls[0].foul].side === 'offense' ? 'defense' : 'offense';
    const worth = (s: Spot) => coach.downValue(s.yardLine, s.down, Math.min(s.lineToGain, 100) - s.yardLine);
    const options = fouls.map((f) => ({ f, spot: enforce(f.foul, at, f.spotYards) }));
    options.sort((a, b) => (fouled === 'offense' ? worth(b.spot) - worth(a.spot) : worth(a.spot) - worth(b.spot)));
    const [best] = options;
    const take = coach.takesPenalty(fouled, this.playValue(result), worth(best.spot), !!result.turnover);
    let note = '';
    for (const { f } of take ? options.slice(1) : options) {
      this.flag(sideOf(f), f.foul, f.by, 'declined');
      note += `. ${FOULS[f.foul].label} on ${this.flagged(sideOf(f), f.by)}, declined`;
    }
    if (!take) return note;

    const { f, spot } = best;
    const side = sideOf(f);
    this.wipe(result);
    this.flag(side, f.foul, f.by, 'accepted', spot.yards);
    this.yardLine = spot.yardLine;
    // An automatic first down (or a foul that reaches the line) moves the chains; anything else replays the down.
    if (spot.down === 1 && (at.down !== 1 || spot.lineToGain !== at.lineToGain)) this.firstDown();
    this.clockRunning = false;
    // A defensive foul on the last play of a half: the offense gets one more snap.
    if (side === defSide && this.clock <= 0 && (this.quarter === 2 || this.quarter >= 4)) this.untimed = true;
    this.setAnim(offSide, 'penalty', at.yardLine, this.yardLine, undefined, result.lane);
    const what = FOULS[f.foul].yards === 'spot' ? '' : ' No play.';
    this.log(`${result.text}${note}. PENALTY on ${this.flagged(side, f.by)}: ${FOULS[f.foul].label}, ${spot.yards} yards.${what}${this.untimed ? ' Untimed down.' : ''}`);
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
    const pick = (players: Player[], weight: (p: Player) => number) => (players.length ? this.flagRng.weighted(players, (p) => loose(p) * weight(p)) : undefined);
    switch (foul) {
      case 'falseStart':
        return pick([...off.ol, ...off.tes.slice(0, 1), ...off.wrs], (p) => (p.position === 'OL' ? 1 : p.position === 'TE' ? 0.35 : 0.12));
      case 'holding':
        return pick([...off.ol, ...off.tes.slice(0, 1), ...off.rbs.slice(0, 1)], (p) => (p.position === 'OL' ? (this.has(p, 'handPlacement') ? 1.5 : 1) : p.position === 'TE' ? 0.3 : 0.1));
      case 'offside':
        return pick([...def.dt, ...def.edge, ...def.lb], (p) => (p.position === 'LB' ? 0.15 : 1) * (this.has(p, 'jumpHappy') ? 2 : 1));
      case 'passInterference':
      case 'defHolding':
        return result?.defender ?? pick([...def.cb, ...def.s], (p) => (this.has(p, 'handsy') ? 2 : 1));
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
    return {
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
      ...(this.injuries.length ? { injuries: this.injuries, diagnoses: this.diagnoses } : {}),
      condition,
      weather: this.weather,
      ...(this.crew ? { crewId: this.crew.id } : {}),
    };
  }
}
