/**
 * What a draft board adds or takes for a prospect's position, apart from his talent: read by the AI's boards
 * (`draft.ts`) and by the opening league's invented draft history (`generate.ts`), so a new league's old drafts
 * went the way its real ones go. A module of its own because `draft.ts` builds rookie deals from `generate.ts`.
 */
import type { Position } from '../types';

export const POSITION_PREMIUM: Record<Position, number> = {
  QB: 1.2,
  EDGE: 0.6,
  OL: 0.3,
  CB: 0.3,
  WR: 0.3,
  DT: 0.3,
  LB: 0,
  S: 0,
  TE: 0,
  RB: -0.1,
  K: -2.5,
  P: -2.8,
};

/** Kickers and punters wait for the late rounds: before the fifth, a board marks one down this much. */
export const specialistPenalty = (position: Position, round: number): number =>
  (position === 'K' || position === 'P') && round < 5 ? 3 : 0;
