/**
 * The open field's constants. `KNOBS` are the six the spec names (plus the line's hold), fitted once against parity
 * (`npm run parity-fit`) and then constants; nothing is tuned per player or per team. The rest is fixed physics.
 */

/** Seconds a step: the replay's own frame (20 a second), so the replay of a spatial play is the simulation. */
export const STEP = 0.05;

export const KNOBS = {
  /** Scales every reaction delay (0.3 s at 12 `reads`). */
  react: 0.926,
  /** Scales the spread of a defender's intercept estimate: a poor angle overruns and must come back. */
  angle: 0.659,
  /** Tackle odds at even skills, from the side. */
  tackle: 1.027,
  /** A move's success at even skills. */
  move: 0.02,
  /** Yards after contact at even skills, at 6 yd/s from the side. */
  afterContact: 0.647,
  /** Block sheds a second at even skills. */
  shed: 1.673,
  /** Seconds a line block holds past the line at z = 0. */
  hold: 0.6,
  /** How strongly the run's roll sets the line: a block holds `hold × e^(line × z)` (a clean hole holds longer). */
  line: 1,
  /** Top speed a point of `longSpeed` is worth (yards a second). */
  speed: 0.14,
  /** Scales every contest's per-point term (moves, tackles, power, sheds): how much a point of skill decides. */
  skill: 0.651,
  /** He steps out rather than take a hit when no lane is worth `outGain` yards and the sideline is within `outLine`. */
  outLine: 10.375,
  outGain: 2.125,
  /** Seconds the clock runs past the open field's whistle on a run or a catch (the engine's play time convention). */
  pad: 1.667,
  /** Yards an outside run's read gives a heading toward the play side in his first second: he stretches the edge. */
  stretch: 0.25,
  /** Tackle odds added on a return (its coverage's own, against the returner). */
  retTackle: -0.015,
  /** Seconds a return team's block holds before its man may shed it. */
  retHold: 0.303,
  /** Scales the ball carrier's own per-point terms (top speed, power, moves) against the defense's. */
  carrier: 0.331,
  /** Seconds a free second-level defender reacts late per sd of the run's roll above its mean: on a clean hole the
   * first free man meets the back further past the line. */
  meet: 0.4,
};

/** The carrier re-reads the field this often (seconds); a jump-cutter more often. */
export const READ_EVERY = 0.25;
export const JUMP_READ = 0.15;
/** A defender who has to get through or round a block arrives this much later (seconds), as the carrier reads it. */
export const BLOCK_DELAY = 0.6;
/** Contact: a free defender this close to the carrier (yards) makes a play on him. */
export const REACH = 1.5;
/** Safety stop: no open field lasts longer (seconds). */
export const MAX_FIELD = 20;
/** The hardest a man can slow down (yards a second, each second); a man going down after a miss sheds speed faster. */
export const BRAKE = 9;
export const FALL = 12;
/** How long a man who missed is on the ground, and how long before he can make another play. */
export const DOWN_FOR = 1;
export const RECONTEST = 1;
/** Headings the carrier weighs, each side of straight upfield (degrees), and how far down each he looks (yards). */
export const FAN = 80;
export const FAN_STEP = 10;
export const LOOK = 30;
/** Read noise at 12 `reads` (yards on a heading's score). */
export const READ_NOISE = 2.5;
