/**
 * AI coaching decisions. Pure functions of the game situation so they can be
 * unit-tested and, later, swapped for user-defined game plans.
 */
import { clamp, type Rng } from '../rng';

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
}

export type PassDepth = 'short' | 'medium' | 'deep';
export type DefenseCall = 'base' | 'runD' | 'passD' | 'blitz';
export type Tempo = 'hurry' | 'normal' | 'milk';
export type FourthDown = 'go' | 'punt' | 'fg';

const isLateHalf = (s: Situation, seconds: number) =>
  (s.quarter === 2 || s.quarter >= 4) && s.clock <= seconds;
/** Seconds left in the game (regulation fourth quarter or overtime). */
const gameSecondsLeft = (s: Situation) => (s.quarter >= 4 ? s.clock : Infinity);

export function tempo(s: Situation): Tempo {
  if (s.quarter >= 4 && s.scoreDiff < 0 && s.clock <= 300) return 'hurry';
  if (s.overtime && s.scoreDiff === 0 && s.clock <= 360) return 'hurry';
  if (s.quarter === 2 && s.clock <= 120 && s.yardLine >= 25) return 'hurry';
  if (s.quarter >= 4 && s.scoreDiff > 0 && s.clock <= 420) return 'milk';
  if (s.quarter >= 3 && s.scoreDiff >= 17) return 'milk';
  return 'normal';
}

/** Leading team runs out the clock with kneel-downs when the defense can't stop it. */
export function shouldKneel(s: Situation): boolean {
  if (s.overtime || s.scoreDiff <= 0) return false;
  if (s.quarter === 4) {
    // Never kneel on fourth down unless the snap itself ends the game.
    if (s.down === 4) return s.clock <= 3;
    // Each kneel takes ~2s, then ~40s of play clock runs unless the defense calls timeout.
    const kneels = 4 - s.down;
    const burnable = kneels * 42 - Math.min(s.defTimeouts, kneels) * 40;
    return s.clock <= burnable;
  }
  if (s.quarter === 2) return s.clock <= 30 && s.yardLine < 50 && s.down < 4;
  return false;
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
    if (behind > 0 && behind <= 3 && inRange && (secondsLeft <= 120 || s.distance > 3)) return 'fg';
    if (behind > 3 && secondsLeft <= 300) return 'go';
    if (behind > 0 && secondsLeft <= 150) return 'go';
    if (behind > 8 && secondsLeft <= 480 && s.yardLine >= 40) return 'go';
    if (s.overtime && behind === 0 && inRange && s.fgMakeProb >= 0.6) return 'fg';
  }

  // Analytics-era aggressiveness on short yardage.
  if (s.distance <= 1 && s.yardLine >= 40) return rng.chance(0.7) ? 'go' : inRange ? 'fg' : 'punt';
  if (s.distance <= 2 && s.yardLine >= 55 && yardsToGoal > 3) return rng.chance(0.45) ? 'go' : inRange ? 'fg' : 'punt';
  if (s.distance <= 1 && s.yardLine >= 30) return rng.chance(0.25) ? 'go' : 'punt';
  if (yardsToGoal <= 3 && s.distance <= 3) return rng.chance(0.55) ? 'go' : 'fg';

  if (comfortable) return 'fg';
  // No-man's land: a long kick, a short punt, or go for it.
  if (inRange && s.distance > 4) return rng.chance(0.6) ? 'fg' : 'punt';
  if (s.yardLine >= 62 && s.distance <= 4) return 'go';
  if (s.yardLine >= 66 && s.distance <= 7 && rng.chance(0.4)) return 'go';
  return 'punt';
}

/** Probability the offense calls a pass (vs. a run). */
export function passProbability(s: Situation): number {
  let p: number;
  if (s.down === 1) p = s.distance > 10 ? 0.61 : 0.475;
  else if (s.down === 2) p = s.distance >= 8 ? 0.64 : s.distance <= 3 ? 0.42 : 0.57;
  else p = s.distance >= 7 ? 0.88 : s.distance >= 4 ? 0.74 : s.distance <= 1 ? 0.3 : 0.52;

  if (100 - s.yardLine <= 3) p -= 0.12;
  const secondsLeft = gameSecondsLeft(s);
  if (s.quarter >= 4 && s.scoreDiff < 0) {
    if (secondsLeft <= 240) p += 0.35;
    else if (s.scoreDiff <= -9) p += 0.18;
  }
  if (s.quarter >= 3 && s.scoreDiff <= -15) p += 0.12;
  if (s.quarter >= 4 && s.scoreDiff > 0) p -= secondsLeft <= 300 ? 0.3 : 0.12;
  if (s.quarter >= 3 && s.scoreDiff >= 15) p -= 0.12;
  if (s.quarter === 2 && s.clock <= 120) p += 0.25;
  return clamp(p, 0.08, 0.97);
}

export function passDepth(s: Situation, rng: Rng): PassDepth {
  const yardsToGoal = 100 - s.yardLine;
  let mix: [number, number, number];
  if (s.distance >= 15) mix = [0.35, 0.4, 0.25];
  else if (s.distance >= 7) mix = [0.5, 0.36, 0.14];
  else if (s.distance <= 3) mix = [0.72, 0.2, 0.08];
  else mix = [0.6, 0.29, 0.11];
  if (tempo(s) === 'hurry') mix = [mix[0] - 0.1, mix[1] + 0.06, mix[2] + 0.04];
  // Hail Mary at the end of a half.
  if ((s.quarter === 2 || s.quarter >= 4) && s.clock <= 8 && s.scoreDiff <= 0) mix = [0, 0.1, 0.9];
  if (yardsToGoal <= 12) mix = [mix[0] + mix[2], mix[1], 0];
  if (yardsToGoal <= 5) mix = [1, 0, 0];
  const r = rng.next() * (mix[0] + mix[1] + mix[2]);
  return r < mix[0] ? 'short' : r < mix[0] + mix[1] ? 'medium' : 'deep';
}

export function defenseCall(s: Situation, rng: Rng): DefenseCall {
  const late = s.quarter >= 4 && s.scoreDiff < 0 && s.clock <= 240; // offense trailing late
  if (late && s.distance >= 5) return rng.chance(0.75) ? 'passD' : 'base';
  if (s.distance <= 2 && s.down >= 3) return rng.chance(0.7) ? 'runD' : 'blitz';
  if (s.down >= 3 && s.distance >= 7) return rng.chance(0.3) ? 'blitz' : rng.chance(0.55) ? 'passD' : 'base';
  if (s.down === 2 && s.distance >= 8) return rng.chance(0.15) ? 'blitz' : 'base';
  return rng.chance(0.08) ? 'blitz' : rng.chance(0.12) ? 'runD' : 'base';
}

/** After a touchdown: kick the extra point or go for two? `scoreDiff` excludes the PAT. */
export function goForTwo(s: Situation): boolean {
  if (s.quarter < 4) return false;
  const d = s.scoreDiff;
  return d === -2 || d === -5 || d === -10 || d === 1 || d === 5 || (d === -1 && s.clock <= 60 && !s.overtime);
}

export function shouldOnside(scoreDiff: number, quarter: number, clock: number): boolean {
  return quarter >= 4 && scoreDiff < 0 && scoreDiff >= -16 && clock <= 150;
}

export function offenseTimeout(s: Situation): boolean {
  if (s.offTimeouts <= 0) return false;
  if (s.quarter >= 4 && s.scoreDiff <= 0 && s.clock <= 120) return true;
  return s.quarter === 2 && s.clock <= 60 && s.yardLine >= 45;
}

export function defenseTimeout(s: Situation): boolean {
  if (s.defTimeouts <= 0 || s.quarter < 4) return false;
  // Defense is trailing and needs the ball back.
  return s.scoreDiff > 0 && s.scoreDiff <= 16 && s.clock <= 180 && s.clock > 5;
}
