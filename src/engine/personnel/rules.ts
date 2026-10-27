import type { League } from '../types';
import type { PersonnelProfile, PersonnelState } from './types';

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

/** v2 (0.2.1) adds one practice-squad place reserved for an International Pathway player, as the NFL has since 2024. */
export const INTERNATIONAL_PROFILE = 'afls-2026-v2' as const;

/** New careers take the latest profile; a migrated career keeps the one it was given (`migrate.ts` passes v1). */
export function initialPersonnelState(profile: PersonnelProfile = INTERNATIONAL_PROFILE): PersonnelState {
  return { version: 1, enabled: false, profile };
}

export const hasInternationalPlace = (league: League) => league.personnel?.profile === INTERNATIONAL_PROFILE;

/** Practice-squad places a club has: 16, plus the international place on v2. */
export const squadPlaces = (league: League) => PERSONNEL_RULES.squadLimit + (hasInternationalPlace(league) ? 1 : 0);
