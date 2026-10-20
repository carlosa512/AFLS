/**
 * AI coaching decisions. Pure functions of the game situation so they can be
 * unit-tested and, later, swapped for user-defined game plans.
 */
import { clamp, type Rng } from '../rng';
import { shiftMix } from '../schemes';

export interface Situation {
  quarter: number;
  /** Seconds left in the current quarter. */
  clock: number;
  down: number;
  distance: number;
  /** Yards from the offense's own goal line (0–100). */
  yardLine: number;
  /** Offense score minus defense score. */
  scoreDiff: number;
  offTimeouts: number;
  defTimeouts: number;
  overtime: boolean;
  /** Probability the kicker makes a field goal from the current spot. */
  fgMakeProb: number;
  /** The play-caller's lean toward the pass, −1…1 (0 = league average; see `CoachStyle`). */
  passLean?: number;
  /** How far the play-caller trusts his quarterback's arm, −1…1 (0 = a league-average passer). */
  qbLean?: number;
  /** The head coach's appetite for going for it on fourth down, −1…1. */
  fourthDown?: number;
  /** The offense's scheme: shift to the short / medium / deep mix of ordinary throws. */
  depthLean?: [number, number, number];
  /** The defense's scheme: blitz-rate multiplier (1 = league average). */
  blitz?: number;
  /** How much worse than a typical day the weather makes passing (negative indoors; see `weather.ts`). */
  weather?: number;
}

export type PassDepth = 'short' | 'medium' | 'deep';
export type DefenseCall = 'base' | 'runD' | 'passD' | 'blitz';
export type Tempo = 'hurry' | 'normal' | 'milk';
export type FourthDown = 'go' | 'punt' | 'fg';

const isLateHalf = (s: Situation, seconds: number) => (s.quarter === 2 || s.quarter >= 4) && s.clock <= seconds;
/** Seconds left in the game (regulation fourth quarter or overtime). */
const gameSecondsLeft = (s: Situation) => (s.quarter >= 4 ? s.clock : Infinity);

/** Pass probability a full-strength lean adds or takes away in an ordinary situation. */
const PASS_LEAN = 0.06;
/**
 * Pass probability a top passer adds (a poor one takes it away) in an ordinary situation: callers
 * keep throwing with a great quarterback even with a lead, so NFL passing leaders throw 600+ times.
 */
const QB_LEAN = 0.06;
/** Pass probability a full unit of weather cost takes away in an ordinary situation: coaches run in the slop. */
const WEATHER_LEAN = 0.15;
/** How far a full-strength fourth-down appetite scales the odds of going for it on the judgment calls. */
const FOURTH_LEAN = 0.4;
/**
 * Where a coach's taste gets a say: not the end of a half, not the last five minutes, not overtime,
 * and not when the clock already dictates the tempo. There the scripts decide, the same for everyone.
 */
const ordinary = (s: Situation) => !s.overtime && !isLateHalf(s, s.quarter === 2 ? 120 : 300) && tempo(s) === 'normal';
/** A judgment-call go-for-it chance, nudged by the head coach's appetite in ordinary situations. */
const goOdds = (s: Situation, base: number) =>
  ordinary(s) ? clamp(base * (1 + FOURTH_LEAN * (s.fourthDown ?? 0)), 0, 0.95) : base;

export function tempo(s: Situation): Tempo {
  if (playForFieldGoal(s)) return 'milk';
  if (s.quarter >= 4 && s.scoreDiff < 0 && s.clock <= 300) return 'hurry';
  // Tied late with the ball in reach of field-goal range: try to win it in regulation.
  if (s.quarter === 4 && s.scoreDiff === 0 && s.clock <= 120 && s.yardLine >= 35) return 'hurry';
  if (s.overtime && s.scoreDiff === 0 && s.clock <= 360) return 'hurry';
  if (s.quarter === 2 && s.clock <= 120 && s.yardLine >= 25) return 'hurry';
  if (s.quarter >= 4 && s.scoreDiff > 0 && s.clock <= 420) return 'milk';
  if (s.quarter >= 3 && s.scoreDiff >= 17) return 'milk';
  return 'normal';
}

/** Least game clock a "milk" pre-snap runoff burns (the offense lets the play clock run down). */
export const MILK_RUNOFF_MIN = 36;
/** A clock-killing fourth-down snap (the quarterback rolls out and runs around) lasts about this long. */
export const CLOCK_KILL_SECONDS = 8;

/**
 * Victory formation. The leader kneels when the remaining downs can drain the clock:
 * each kneel takes ~2s, then the play clock runs ~40s unless the defense calls timeout,
 * and a fourth-down snap can burn the last few seconds.
 */
export function shouldKneel(s: Situation): boolean {
  if (s.overtime) return false;
  if (s.quarter === 4 && s.scoreDiff > 0) {
    if (s.down === 4) return s.clock <= CLOCK_KILL_SECONDS;
    const kneels = 4 - s.down;
    // The two-minute warning stops the clock once, and so does each timeout the defense will use.
    const stops = (s.clock > 120 ? 1 : 0) + Math.min(defenseWillStopClock(s) ? s.defTimeouts : 0, kneels);
    const runoffs = kneels - stops;
    return s.clock <= kneels * 2 + Math.max(0, runoffs) * MILK_RUNOFF_MIN + CLOCK_KILL_SECONDS;
  }
  // Tied, deep in its own end with seconds left: play for overtime rather than risk a turnover.
  if (s.quarter === 4 && s.scoreDiff === 0) return s.down < 4 && s.clock <= 25 && s.yardLine <= 30;
  // End of the first half: kneel unless there's a realistic shot at points.
  if (s.quarter === 2) return s.down < 4 && s.clock <= 30 && (s.yardLine < 30 || (s.scoreDiff > 0 && s.yardLine < 50));
  return false;
}

/**
 * Tied or down by one or two and already in comfortable range late: run the clock down,
 * stop it with the last timeout, and kick at the gun so the opponent never gets the ball back.
 */
export function playForFieldGoal(s: Situation): boolean {
  return (
    s.quarter === 4 && !s.overtime && s.scoreDiff <= 0 && s.scoreDiff >= -2 && s.fgMakeProb >= 0.85 && s.clock <= 100
  );
}

/** A field goal now ties or wins, and the clock can't afford another snap first. */
export function kickNow(s: Situation): boolean {
  if (s.quarter !== 2 && s.quarter < 4) return false;
  const helps = s.quarter === 2 || (s.scoreDiff <= 0 && s.scoreDiff >= -3);
  if (!helps || s.fgMakeProb < 0.25) return false;
  // A snap takes up to 8 seconds: inside that, there is no play to run before the kick.
  if (s.clock <= 8) return true;
  // Overtime has no "end of half" pressure until the very end; regulation does.
  if (s.overtime) return false;
  // Already in comfortable range: don't risk a snap that could eat the last seconds.
  if (s.clock <= 12 && s.fgMakeProb >= 0.8) return true;
  // Without a timeout, a play that ends in bounds runs out the clock: kick while it is stopped.
  // On third down there's no spike left to save it: an in-bounds snap (up to 8s) and the hurried
  // fourth-down lineup after it (up to 16s) can take 24s.
  return s.offTimeouts === 0 && s.clock <= (s.down >= 3 ? 24 : 20);
}

/** Out of timeouts in a two-minute drill: clock it with a spike rather than snap a play. */
export function shouldSpike(s: Situation): boolean {
  if (s.offTimeouts > 0 || s.down >= 4 || s.clock > 35 || s.clock < 3) return false;
  const needPoints =
    s.quarter >= 4 ? s.scoreDiff <= 0 && !(s.scoreDiff === 0 && s.yardLine < 40) : s.quarter === 2 && s.yardLine >= 45;
  if (!needPoints) return false;
  // On third down a spike only makes sense to set up a field goal that ties or wins.
  const fgEnough = s.quarter === 2 || s.scoreDiff >= -3;
  return s.down < 3 || (fgEnough && s.fgMakeProb >= 0.3);
}

export function fourthDown(s: Situation, rng: Rng): FourthDown {
  const yardsToGoal = 100 - s.yardLine;
  const inRange = s.fgMakeProb >= 0.4;
  const comfortable = s.fgMakeProb >= 0.7;
  const secondsLeft = gameSecondsLeft(s);

  // End of half: take the points if we can.
  if (isLateHalf(s, 20) && s.quarter === 2) return inRange ? 'fg' : 'punt';

  // Late-game logic.
  if (s.quarter >= 4) {
    const behind = -s.scoreDiff;
    // A trailing offense in overtime is on its last possession: any punt ends the game.
    if (s.overtime && behind > 0) return behind <= 3 && inRange ? 'fg' : 'go';
    if (behind > 0 && behind <= 3 && inRange && (secondsLeft <= 120 || s.distance > 3)) return 'fg';
    if (behind > 3 && secondsLeft <= 300) return 'go';
    if (behind > 0 && secondsLeft <= 150) return 'go';
    if (behind > 8 && secondsLeft <= 480 && s.yardLine >= 40) return 'go';
    if (s.overtime && behind === 0 && inRange && s.fgMakeProb >= 0.6) return 'fg';
  }

  // Analytics-era aggressiveness on short yardage; how far a coach takes it is his call.
  if (s.distance <= 1 && s.yardLine >= 40) return rng.chance(goOdds(s, 0.7)) ? 'go' : inRange ? 'fg' : 'punt';
  if (s.distance <= 2 && s.yardLine >= 55 && yardsToGoal > 3)
    return rng.chance(goOdds(s, 0.6)) ? 'go' : inRange ? 'fg' : 'punt';
  if (s.distance <= 1 && s.yardLine >= 30) return rng.chance(goOdds(s, 0.25)) ? 'go' : 'punt';
  if (yardsToGoal <= 3 && s.distance <= 3) return rng.chance(goOdds(s, 0.6)) ? 'go' : 'fg';
  if (s.distance <= 4 && s.yardLine >= 60 && yardsToGoal > 3)
    return rng.chance(goOdds(s, 0.3)) ? 'go' : s.fgMakeProb >= 0.55 ? 'fg' : 'punt';

  if (comfortable) return 'fg';
  // No-man's land: a long kick, a short punt, or go for it. Coin-flip kicks are for the end of games.
  if (s.fgMakeProb >= 0.55 && s.distance > 4) return rng.chance(0.6) ? 'fg' : 'punt';
  if (s.yardLine >= 62 && s.distance <= 4) return 'go';
  if (s.yardLine >= 66 && s.distance <= 7 && rng.chance(goOdds(s, 0.4))) return 'go';
  return 'punt';
}

/** Probability the offense calls a pass (vs. a run). */
export function passProbability(s: Situation): number {
  let p: number;
  if (s.down === 1) p = s.distance > 10 ? 0.65 : 0.505;
  else if (s.down === 2) p = s.distance >= 8 ? 0.68 : s.distance <= 3 ? 0.45 : 0.61;
  else p = s.distance >= 7 ? 0.88 : s.distance >= 4 ? 0.74 : s.distance <= 1 ? 0.3 : 0.52;

  if (100 - s.yardLine <= 3) p -= 0.12;
  // The play-caller's taste, in ordinary situations only: the clock and the score decide the end of games.
  if (ordinary(s)) p += PASS_LEAN * (s.passLean ?? 0) + QB_LEAN * (s.qbLean ?? 0) - WEATHER_LEAN * (s.weather ?? 0);
  const secondsLeft = gameSecondsLeft(s);
  if (s.quarter >= 4 && s.scoreDiff < 0) {
    if (secondsLeft <= 240) p += 0.35;
    else if (s.scoreDiff <= -9) p += 0.18;
  }
  if (s.quarter >= 3 && s.scoreDiff <= -15) p += 0.12;
  if (s.quarter >= 4 && s.scoreDiff > 0) p -= secondsLeft <= 300 ? 0.3 : 0.12;
  if (s.quarter >= 3 && s.scoreDiff >= 15) p -= 0.12;
  if (s.quarter === 2 && s.clock <= 120) p += 0.25;
  if (playForFieldGoal(s)) return 0.05;
  // Inside the last 40 seconds a run that ends in bounds can lose the game: throw.
  if (s.quarter >= 4 && s.scoreDiff < 0 && secondsLeft <= 40) return 1;
  if (s.quarter === 4 && s.scoreDiff === 0 && secondsLeft <= 40 && s.yardLine >= 40) return 0.95;
  return clamp(p, 0.08, 0.97);
}

export function passDepth(s: Situation, rng: Rng): PassDepth {
  const yardsToGoal = 100 - s.yardLine;
  let mix: [number, number, number];
  if (s.distance >= 15) mix = [0.35, 0.4, 0.25];
  else if (s.distance >= 7) mix = [0.5, 0.36, 0.14];
  else if (s.distance <= 3) mix = [0.72, 0.2, 0.08];
  else mix = [0.6, 0.29, 0.11];
  // The scheme's taste (West Coast underneath, Air Coryell deep) only where the situation doesn't dictate.
  if (s.depthLean && ordinary(s)) mix = shiftMix(mix, s.depthLean);
  // Wind and slop take the deep ball away; a dome gives a little back.
  if (s.weather && ordinary(s)) mix = [mix[0], mix[1], mix[2] * Math.exp(-2 * s.weather)];
  if (tempo(s) === 'hurry') mix = [mix[0] - 0.1, mix[1] + 0.06, mix[2] + 0.04];
  // Hail Mary at the end of a half.
  if ((s.quarter === 2 || s.quarter >= 4) && s.clock <= 8 && s.scoreDiff <= 0) mix = [0, 0.1, 0.9];
  if (yardsToGoal <= 12) mix = [mix[0] + mix[2], mix[1], 0];
  if (yardsToGoal <= 5) mix = [1, 0, 0];
  const r = rng.next() * (mix[0] + mix[1] + mix[2]);
  return r < mix[0] ? 'short' : r < mix[0] + mix[1] ? 'medium' : 'deep';
}

export function defenseCall(s: Situation, rng: Rng): DefenseCall {
  // A fire-zone coordinator sends more pressure, a Tampa 2 one sits back: same situations, scaled odds.
  const b = (p: number) => clamp(p * (s.blitz ?? 1), 0, 0.6);
  const late = s.quarter >= 4 && s.scoreDiff < 0 && s.clock <= 240; // offense trailing late
  if (late && s.distance >= 5) return rng.chance(0.75) ? 'passD' : 'base';
  if (s.distance <= 2 && s.down >= 3) return rng.chance(0.7) ? 'runD' : 'blitz';
  if (s.down >= 3 && s.distance >= 7) return rng.chance(b(0.3)) ? 'blitz' : rng.chance(0.55) ? 'passD' : 'base';
  if (s.down === 2 && s.distance >= 8) return rng.chance(b(0.15)) ? 'blitz' : 'base';
  return rng.chance(b(0.08)) ? 'blitz' : rng.chance(0.12) ? 'runD' : 'base';
}

/** After a touchdown: kick the extra point or go for two? `scoreDiff` excludes the PAT. */
export function goForTwo(s: Situation): boolean {
  if (s.quarter < 4) return false;
  const d = s.scoreDiff;
  return d === -2 || d === -5 || d === -10 || d === 1 || d === 5 || (d === -1 && s.clock <= 60 && !s.overtime);
}

/**
 * Onside only when kicking deep can't work: in a one-score game the defense needs enough clock
 * stoppages to force a three-and-out and still get the ball back with time to score.
 */
export function shouldOnside(scoreDiff: number, quarter: number, clock: number, timeouts: number): boolean {
  if (quarter < 4 || scoreDiff >= 0 || scoreDiff < -16) return false;
  if (scoreDiff < -8) return clock <= 240;
  const stops = Math.min(3, timeouts + (quarter === 4 && clock > 120 ? 1 : 0));
  // Three snaps (~6s each), ~40s of play clock before each one we can't stop, then the punt.
  const leftAfterPunt = clock - 18 - (3 - stops) * 40 - 8;
  return leftAfterPunt < 35;
}

export function offenseTimeout(s: Situation): boolean {
  if (s.offTimeouts <= 0 || playForFieldGoal(s)) return false;
  if (s.quarter >= 4 && s.scoreDiff < 0 && s.clock <= 120) return s.offTimeouts > 1 || s.clock <= 40;
  // Tied: only worth stopping the clock once the ball is near scoring range.
  if (s.quarter >= 4 && s.scoreDiff === 0 && s.clock <= 120) return s.yardLine >= 45;
  return s.quarter === 2 && s.clock <= 60 && s.yardLine >= 45;
}

/** A trailing defense still in the game saves time for one more possession. */
const defenseWillStopClock = (s: Situation) => s.quarter >= 4 && s.scoreDiff > 0 && s.scoreDiff <= 16;

export function defenseTimeout(s: Situation): boolean {
  if (s.defTimeouts <= 0) return false;
  return defenseWillStopClock(s) && s.clock <= 180 && s.clock > 5;
}

// ───────── penalties: take it or decline it ─────────

/** Rough expected points of a first-and-ten here: about 0.85 at your own 25, 4.35 at the other 25. */
const firstDownValue = (yardLine: number) => 0.07 * yardLine - 0.9;
/** A touchdown and its try, less the field position the kickoff hands back. */
export const TOUCHDOWN_VALUE = 6.3;
/** How often a series moves the chains from each down at 10 to go, and how much each extra yard costs. */
const CONVERT = [0, 0.7, 0.55, 0.38];
const CONVERT_PER_YARD = [0, 0.02, 0.025, 0.03];

/**
 * What a down is worth to the offense, in rough expected points: the chance of moving the chains
 * (falling with the down and the yards to go) times the next first down, and otherwise what a punt or
 * a field goal leaves. Fourth down is the better of kicking and going for it (70% at 4th and 1, a
 * quarter at 4th and 10, the ball turned over at the spot when it fails). Only comparisons matter: it
 * decides which of two outcomes a team would rather have.
 */
export function downValue(yardLine: number, down: number, toGo: number): number {
  const kick = yardLine >= 63 ? 1.5 : -firstDownValue(Math.max(20, 60 - yardLine));
  const next = firstDownValue(Math.min(99, yardLine + toGo));
  if (down >= 4) {
    const convert = clamp(0.7 - 0.05 * (toGo - 1), 0.1, 0.75);
    return Math.max(kick, convert * next - (1 - convert) * firstDownValue(100 - yardLine));
  }
  const convert = clamp(CONVERT[down] - CONVERT_PER_YARD[down] * (toGo - 10), 0.03, 0.97);
  return convert * next + (1 - convert) * kick;
}

/**
 * Take the penalty or the play? The side fouled against picks whichever leaves it better off, both
 * valued for the offense (`downValue`): the offense wants the higher, the defense the lower. A tie
 * takes the penalty, and a defense never hands back a takeaway, whatever the field position says.
 */
export function takesPenalty(fouled: 'offense' | 'defense', play: number, penalty: number, turnover = false): boolean {
  if (turnover && fouled === 'defense') return false;
  return fouled === 'offense' ? penalty >= play : penalty <= play;
}
