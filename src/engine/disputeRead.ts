/**
 * What the rest of the engine reads about a player's dispute (G4, `disputes.ts`): the dial and a few small readers.
 * Types only, no imports of engine code, so the roster, training, development and lineup code can read it without an
 * import loop (and `vi.mock` of this module reaches every reader).
 */
import type { Dispute, League, Player } from './types';

/** Moods that act: disputes and the AI clubs keeping their promises. `morale.rng.test.ts` turns it off. */
export const MOOD_ACTS = { on: true };

/**
 * His open dispute, at the club he has it with. Traded, released or given a raise since the last step, it's over at once
 * (he reports, he practices); the next step files how it ended.
 */
export function disputeOf(p: Player): Dispute | undefined {
  const m = MOOD_ACTS.on ? p.morale : undefined;
  const d = m?.dispute;
  if (!d || d.club !== p.teamId) return undefined;
  if (p.contract && m!.apy !== undefined && p.contract.apy > m!.apy) return undefined;
  return d;
}

/** A trade request as the league may know it (G4b): public once it's leaked, private to his own club until then. */
export function wantsOut(p: Player): 'private' | 'public' | null {
  const d = disputeOf(p);
  if (!d || d.kind !== 'trade') return null;
  return d.public === undefined ? 'private' : 'public';
}

/** A holdout gone to the Reserve/Did Not Report list, or reported to a full 53 and waiting on room: off it, unavailable. */
export const onDidNotReport = (p: Player): boolean => {
  const d = disputeOf(p);
  return (!!d && d.kind === 'holdOut' && !!d.out) || (MOOD_ACTS.on && !!p.morale?.reported);
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
