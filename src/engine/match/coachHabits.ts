import type { CoachQuirkId } from '../coachQuirks';
import { goForTwo, tempo, type FourthDown, type Situation } from './coach';
import type { Rng } from '../rng';

export type Habits = ReadonlySet<CoachQuirkId>;
/** Late forced plays retain priority. Each modifier is limited to the decision its owner controls. */
export function habitCalls(s: Situation, offense: Habits, defense: Habits, snaps: number) {
  const ordinary = !s.overtime && tempo(s) === 'normal' && !((s.quarter === 2 || s.quarter >= 4) && s.clock <= 120);
  const settling = ordinary && s.down <= 2 && Math.abs(s.scoreDiff) <= 8 && s.fgMakeProb >= 0.8;
  const shell = !s.overtime && s.quarter === 4 && s.clock > 180 && s.scoreDiff > 0 && s.scoreDiff <= 8;
  const third = ordinary && s.down === 3 && s.distance >= 7 && s.yardLine < 90;
  const crowd = ordinary && s.down <= 2 && s.distance <= 3;
  const protect = !s.overtime && s.quarter === 4 && s.scoreDiff < 0 && s.scoreDiff >= -8 && s.clock <= 240;
  const toGo = 100 - s.yardLine;
  const redZone = ordinary && s.down <= 2 && toGo <= 20 && toGo > 3;
  const obvious = ordinary && ((s.down === 3 && s.distance >= 7) || (s.down === 2 && s.distance >= 10));
  // Two scores up late, the offense needing both: where a prevent shell shows up.
  const prevent = !s.overtime && s.quarter === 4 && s.clock <= 240 && s.scoreDiff <= -9 && s.scoreDiff >= -16;
  const attack = redZone && offense.has('attacksEndZone');
  return {
    settling,
    shell,
    third,
    crowd,
    protect,
    redZone,
    obvious,
    prevent,
    passShift:
      (settling && offense.has('settlesForThree') ? -0.05 : 0) +
      (shell && offense.has('goesIntoShell') ? -0.05 : 0) +
      (attack ? 0.03 : 0),
    endZoneShot: attack,
    safeDepth: (settling && offense.has('settlesForThree')) || (shell && offense.has('goesIntoShell')),
    shotEligible: ordinary && s.down <= 2 && s.distance >= 3 && s.yardLine >= 25 && s.yardLine <= 65,
    opening: offense.has('scriptedOpening') && snaps <= 6 && ordinary,
    heat: third && defense.has('thirdDownHeat'),
    coverage: third && defense.has('trustsCoverage'),
    crowdLine: crowd && defense.has('crowdsTheLine'),
    protectDeep: protect && defense.has('protectsDeep'),
    disguise: obvious && defense.has('disguisesCoverages'),
    preventShell: prevent && defense.has('playsPrevent'),
  };
}

/**
 * No-huddle before the clock demands it: down two scores late in the third, down at all in the fourth, or any
 * drive in the last two and a half minutes of the first half. A quicker tempo, not the full two-minute drill:
 * a full hurry on every one of those snaps was worth well over a point a game to both sides.
 */
export function upTempoEligible(s: Situation): boolean {
  if (s.overtime || tempo(s) !== 'normal') return false;
  if (s.quarter === 2) return s.clock <= 150;
  return s.quarter >= 4 ? s.scoreDiff < 0 : s.quarter === 3 && s.clock <= 300 && s.scoreDiff <= -9;
}
/** Seconds between snaps at Up-Tempo's pace (a normal tempo is 27–38, a hurry-up 8–16). */
export const UP_TEMPO_RUNOFF: [number, number] = [18, 26];

/**
 * The second-half spots the two-point chart likes that the league's default chart leaves to the kick: down
 * eight after the touchdown (down 14 before it) in either quarter, and the fourth quarter's chart a quarter early.
 */
export function twoPointSpot(s: Situation): boolean {
  if (s.overtime || s.quarter < 3 || goForTwo(s)) return false;
  return s.scoreDiff === -8 || (s.quarter === 3 && (s.scoreDiff === -2 || s.scoreDiff === 1 || s.scoreDiff === 5));
}
export function twoPointHabit(s: Situation, habits: Habits, rng: Rng) {
  const eligible = twoPointSpot(s);
  return { eligible, goes: eligible && habits.has('goesForTwo') && rng.chance(0.8) };
}

/** A long field goal the default call would try in an ordinary moment (not a forced end-of-half or late-game kick). */
export function longKickDecision(s: Situation, baseline: FourthDown): boolean {
  return (
    baseline === 'fg' &&
    !s.overtime &&
    tempo(s) === 'normal' &&
    s.fgMakeProb < 0.75 &&
    !(s.quarter === 2 && s.clock <= 120) &&
    !(s.quarter >= 4 && s.clock <= 300)
  );
}
/** He trusts a kicker with the leg for it (`trusted`); anyone else's long try becomes a punt, or a try on fourth and short. */
export function longKickHabit(s: Situation, baseline: FourthDown, habits: Habits, trusted: boolean, rng: Rng) {
  const eligible = longKickDecision(s, baseline);
  const passes = eligible && !trusted && habits.has('distrustsLongKick') && rng.chance(0.6);
  return { eligible, passes, decision: passes ? (s.distance <= 2 ? ('go' as const) : ('punt' as const)) : baseline };
}
export function canDeferTimeout(s: Situation): boolean {
  return (
    !s.overtime &&
    s.quarter === 4 &&
    s.scoreDiff > 0 &&
    s.scoreDiff <= 16 &&
    s.defTimeouts > 0 &&
    s.clock >= 80 &&
    s.clock <= 180
  );
}
export function canStopEarly(s: Situation): boolean {
  return (
    !s.overtime &&
    s.quarter === 4 &&
    s.scoreDiff > 0 &&
    s.scoreDiff <= 16 &&
    s.defTimeouts > 0 &&
    s.clock > 180 &&
    s.clock <= 210
  );
}
export function shortGoalDecision(s: Situation): boolean {
  return (
    !s.overtime &&
    tempo(s) === 'normal' &&
    s.down === 4 &&
    s.yardLine >= 97 &&
    s.distance <= 3 &&
    s.fgMakeProb >= 0.8 &&
    !(s.quarter === 2 && s.clock <= 120) &&
    !(s.quarter >= 4 && s.clock <= 300)
  );
}

export function fourthDownHabit(s: Situation, baseline: FourthDown, habits: Habits, rng: Rng) {
  const eligible = shortGoalDecision(s);
  const takes = eligible && baseline === 'go' && habits.has('takesThePoints') && rng.chance(0.05);
  const backs = eligible && baseline === 'fg' && habits.has('backsHisOffense') && rng.chance(0.05);
  return { decision: takes ? ('fg' as const) : backs ? ('go' as const) : baseline, takes, backs };
}
