/**
 * Penalties: every foul the engine calls, who commits it, and how it's enforced. The match engine
 * rolls fouls and picks who drew them; this module says where the ball goes, and `match/coach.ts`
 * decides whether the side fouled against takes it. Spec, research and phases: docs/PENALTIES.md.
 */
import type { Foul } from './types';

export interface FoulInfo {
  label: string;
  /** The team that commits it. */
  side: 'offense' | 'defense';
  /** Yards it costs; 'spot' puts the ball where the foul happened (pass interference). */
  yards: number | 'spot';
  /** A defensive foul that moves the chains whatever the yardage. */
  autoFirst?: boolean;
  /** No play happens: the whistle blows before the snap. */
  deadBall?: boolean;
  /** The crew tendency, besides Flag Volume, that scales it (see `officials.ts`). */
  tendency: 'holding' | 'coverage' | null;
}

export const FOULS: Record<Foul, FoulInfo> = {
  falseStart: { label: 'False start', side: 'offense', yards: 5, deadBall: true, tendency: null },
  offside: { label: 'Offside', side: 'defense', yards: 5, tendency: null },
  holding: { label: 'Offensive holding', side: 'offense', yards: 10, tendency: 'holding' },
  passInterference: { label: 'Pass interference', side: 'defense', yards: 'spot', autoFirst: true, tendency: 'coverage' },
  defHolding: { label: 'Defensive holding', side: 'defense', yards: 5, autoFirst: true, tendency: 'coverage' },
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
