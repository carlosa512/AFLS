/**
 * The open field's constants. `KNOBS` are the six the spec names (plus the line's hold), fitted once against parity
 * (`npm run parity-fit`) and then constants; nothing is tuned per player or per team. The rest is fixed physics.
 */

/** Seconds a step: the replay's own frame (20 a second), so the replay of a spatial play is the simulation. */
export const STEP = 0.05;

export const KNOBS = {
  /** Scales every reaction delay (0.3 s at 12 `reads`). */
  react: 1,
  /** Scales the spread of a defender's intercept estimate: a poor angle overruns and must come back. */
  angle: 1,
  /** Tackle odds at even skills, from the side. */
  tackle: 0.72,
  /** A move's success at even skills. */
  move: 0.25,
  /** Yards after contact at even skills, at 6 yd/s from the side. */
  afterContact: 1.2,
  /** Block sheds a second at even skills. */
  shed: 0.9,
  /** Seconds a line block holds past the line at z = 0 (each sd of the roll adds half of it). */
  hold: 0.6,
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
