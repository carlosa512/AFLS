/**
 * Penalties: every foul the engine calls, who commits it, and how it's enforced. The match engine
 * rolls fouls and picks who drew them; this module says where the ball goes, and `match/coach.ts`
 * decides whether the side fouled against takes it. Spec, research and phases: docs/PENALTIES.md.
 */
import type { Foul } from './types';

export interface FoulInfo {
  label: string;
  /** The team that commits it: on a kick, the kicking or the receiving team. */
  side: 'offense' | 'defense' | 'kicking' | 'receiving';
  /** Yards it costs; 'spot' puts the ball where the foul happened (pass interference). */
  yards: number | 'spot';
  /** A defensive foul that moves the chains whatever the yardage. */
  autoFirst?: boolean;
  /** No play happens: the whistle blows before the snap. */
  deadBall?: boolean;
  /** The crew tendency, besides Flag Volume, that scales it (see `officials.ts`). */
  tendency: 'holding' | 'coverage' | 'qbProtection' | null;
  /** A personal foul: 15 yards, and the man's temper shows in it. */
  personal?: boolean;
  /**
   * Enforced where the play ended, the play standing: 'always' for a foul after the whistle,
   * 'pastLine' for one at the end of a run or a catch past the line (behind it, or on an
   * incompletion, a sack or a turnover, it goes from the previous spot and wipes the play out).
   */
  late?: 'always' | 'pastLine';
  /** A special-teams foul: rolled and enforced on the kick itself (`kickoff`, `punt` in the engine), never by `enforce`. */
  special?: boolean;
}

export const FOULS: Record<Foul, FoulInfo> = {
  falseStart: { label: 'False start', side: 'offense', yards: 5, deadBall: true, tendency: null },
  offside: { label: 'Offside', side: 'defense', yards: 5, tendency: null },
  holding: { label: 'Offensive holding', side: 'offense', yards: 10, tendency: 'holding' },
  passInterference: { label: 'Pass interference', side: 'defense', yards: 'spot', autoFirst: true, tendency: 'coverage' },
  defHolding: { label: 'Defensive holding', side: 'defense', yards: 5, autoFirst: true, tendency: 'coverage' },
  roughingPasser: { label: 'Roughing the passer', side: 'defense', yards: 15, autoFirst: true, tendency: 'qbProtection', personal: true, late: 'pastLine' },
  unnecessaryRoughness: { label: 'Unnecessary roughness', side: 'defense', yards: 15, autoFirst: true, tendency: null, personal: true, late: 'pastLine' },
  faceMask: { label: 'Face mask', side: 'defense', yards: 15, autoFirst: true, tendency: null, personal: true, late: 'pastLine' },
  horseCollar: { label: 'Horse collar', side: 'defense', yards: 15, autoFirst: true, tendency: null, personal: true, late: 'pastLine' },
  unsportsmanlike: { label: 'Unsportsmanlike conduct', side: 'defense', yards: 15, autoFirst: true, tendency: null, personal: true, late: 'always' },
  // Special teams: 10 yards from the spot of a block on a return; the receiving team's ball at its 40 on a
  // kickoff out of bounds or short of the landing zone; 5 for a kicking team lined up wrong; 15 from the
  // catch for interfering with it; 5 for running into a punter, 15 and the ball for roughing him.
  returnHolding: { label: 'Holding on a return', side: 'receiving', yards: 10, tendency: null, special: true },
  blockInBack: { label: 'Illegal block in the back', side: 'receiving', yards: 10, tendency: null, special: true },
  kickoffMiss: { label: 'Kickoff out of bounds or short', side: 'kicking', yards: 0, tendency: null, special: true },
  kickoffFormation: { label: 'Kickoff offside or formation', side: 'kicking', yards: 5, tendency: null, special: true },
  kickCatch: { label: 'Kick-catch interference', side: 'kicking', yards: 15, tendency: null, special: true },
  runningIntoKicker: { label: 'Running into the kicker', side: 'receiving', yards: 5, tendency: null, special: true },
  roughingKicker: { label: 'Roughing the kicker', side: 'receiving', yards: 15, autoFirst: true, tendency: null, personal: true, special: true },
};
export const FOUL_KINDS = Object.keys(FOULS) as Foul[];

/** The ball before the snap: yards from the offense's goal line, the down, and the line to gain. */
export interface Spot {
  yardLine: number;
  down: number;
  lineToGain: number;
}

/**
 * Where a foul leaves the ball, enforced from the previous spot. Half the distance to the goal caps
 * every penalty but a spot foul, which stops at the 1. A defensive foul moves the chains if it's an
 * automatic first down or reaches the line to gain; an offensive one replays the down. `spotYards` is
 * how far downfield a spot foul happened.
 */
export function enforce(foul: Foul, at: Spot, spotYards = 0): Spot & { yards: number } {
  const info = FOULS[foul];
  if (info.side === 'offense') {
    const yards = Math.min(info.yards as number, Math.floor(at.yardLine / 2));
    return { yardLine: at.yardLine - yards, down: at.down, lineToGain: at.lineToGain, yards };
  }
  const yards = info.yards === 'spot' ? Math.min(Math.max(1, spotYards), 99 - at.yardLine) : Math.min(info.yards, Math.floor((100 - at.yardLine) / 2));
  const yardLine = at.yardLine + yards;
  if (info.autoFirst || yardLine >= at.lineToGain) return { yardLine, down: 1, lineToGain: Math.min(100, yardLine + 10), yards };
  return { yardLine, down: at.down, lineToGain: at.lineToGain, yards };
}
