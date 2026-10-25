import type { PersonnelState } from './types';

/** Versioned AFLS choices: changing them requires a new profile, not mutating an existing career. */
export const PERSONNEL_RULES = Object.freeze({
  id: 'afls-2026-v1' as const,
  squadLimit: 16,
  weeklyProtections: 2,
  automaticProtection: 'scoutedCeiling' as const,
  accruedGames: 6,
  salaryCreditedGames: 3,
  pensionCreditedGames: 3,
});

export function initialPersonnelState(): PersonnelState {
  return { version: 1, enabled: false, profile: PERSONNEL_RULES.id };
}
