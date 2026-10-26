import type { PersonnelState } from './types';

/**
 * Versioned AFLS choices: changing them requires a new profile, not mutating an existing career. v1 was trimmed
 * on 2026-10-26 before any career could switch it on, so it keeps its id.
 */
export const PERSONNEL_RULES = Object.freeze({
  id: 'afls-2026-v1' as const,
  squadLimit: 16,
  elevationsPerGame: 2,
  regularElevations: 3,
  weeklyProtections: 2,
  automaticProtection: 'scoutedCeiling' as const,
  accruedGames: 6,
  /** Business policy, not an NFL restriction or a limit on manual user claims. */
  maxAIWaiverAddsPerWindow: 2,
});

export function initialPersonnelState(): PersonnelState {
  return { version: 1, enabled: false, profile: PERSONNEL_RULES.id };
}
