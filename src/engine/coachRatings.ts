import type { Coach, CoachRole } from './types';

/** Existing role quality: shared by market valuation and quality-dependent habit acquisition. */
const YOUTH_SHARE: Record<CoachRole, number> = {
  headCoach: 0.5,
  offCoord: 0.6,
  defCoord: 0.6,
  positionCoach: 0.55,
  strengthCoach: 0.35,
  stCoord: 0.5,
};
export const coachValue = (c: Pick<Coach, 'role' | 'youth' | 'veterans'>) =>
  YOUTH_SHARE[c.role] * c.youth + (1 - YOUTH_SHARE[c.role]) * c.veterans;
