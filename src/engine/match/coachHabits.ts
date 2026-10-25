import type { CoachQuirkId } from '../coachQuirks';
import { tempo, type FourthDown, type Situation } from './coach';
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
  return {
    settling,
    shell,
    third,
    crowd,
    protect,
    passShift:
      (settling && offense.has('settlesForThree') ? -0.05 : 0) + (shell && offense.has('goesIntoShell') ? -0.05 : 0),
    safeDepth: (settling && offense.has('settlesForThree')) || (shell && offense.has('goesIntoShell')),
    shotEligible: ordinary && s.down <= 2 && s.distance >= 3 && s.yardLine >= 25 && s.yardLine <= 65,
    opening: offense.has('scriptedOpening') && snaps <= 6 && ordinary,
    heat: third && defense.has('thirdDownHeat'),
    coverage: third && defense.has('trustsCoverage'),
    crowdLine: crowd && defense.has('crowdsTheLine'),
    protectDeep: protect && defense.has('protectsDeep'),
  };
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
