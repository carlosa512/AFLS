/**
 * What the rest of the engine reads about a player's dispute (G4, `disputes.ts`): the dial and a few small readers.
 * Types only, no imports of engine code, so the roster, training, development and lineup code can read it without an
 * import loop (and `vi.mock` of this module reaches every reader).
 */
import type { Dispute, League, Player } from './types';

/** Moods that act: disputes and the AI clubs keeping their promises. `morale.rng.test.ts` turns it off. */
export const MOOD_ACTS = { on: true };

export const disputeOf = (p: Player): Dispute | undefined => (MOOD_ACTS.on ? p.morale?.dispute : undefined);

/** A holdout gone to the Reserve/Did Not Report list: off the 53, unavailable. */
export const onDidNotReport = (p: Player): boolean => {
  const d = disputeOf(p);
  return !!d && d.kind === 'holdOut' && !!d.out;
};

/** Not practicing: a hold-in before week 1, a holdout all the while. */
export function notPracticing(league: League, p: Player): boolean {
  const d = disputeOf(p);
  if (!d) return false;
  if (d.kind === 'holdOut') return true;
  return d.kind === 'holdIn' && league.phase !== 'regular' && league.phase !== 'playoffs';
}

/** An open deal promise from his own club (G4): an AI club keeps it in the re-sign window. */
export function promisedDeal(p: Player): boolean {
  const t = MOOD_ACTS.on ? p.morale?.talk : undefined;
  return !!t && t.club === p.teamId && t.promise?.kind === 'deal';
}

/** Rust after missing camp: a point in every contest his first week back, half a point the next. */
export function rustKnock(league: League, p: Player): number {
  const r = MOOD_ACTS.on ? p.morale?.rust : undefined;
  if (!r || r.season !== league.season) return 0;
  const since = league.week - r.week;
  return since === 0 ? 1 : since === 1 ? 0.5 : 0;
}
