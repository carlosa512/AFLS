/**
 * How draft picks turned out and how prospects read on draft day, always through the user's club's scouts: a pick
 * judged against what its round should produce (provisional for two seasons, locked after the third, when his ceiling
 * has settled), a prospect's risk, and where the staff's board parts from the league's consensus.
 */
import { perceive, tierOf } from './scouting';
import type { League, Player, PickVerdict } from './types';

export type { PickVerdict };

/** Seasons before a pick's verdict locks: a ceiling settles over his first three (`ceiling.ts`). */
export const VERDICT_YEARS = 3;

/**
 * What a round should produce, as a `tierOf` level (0 = elite): a first-rounder a high-end starter, a second a solid
 * starter, a third a fringe starter, Day 3 a quality backup.
 */
export const ROUND_BAR = (round: number) => Math.min(round, 4);

/** Two levels over the bar is a steal, at it or over a hit, under it a miss. */
export function verdictFor(round: number, tier: number): PickVerdict {
  const bar = ROUND_BAR(round);
  return tier <= bar - 2 ? 'steal' : tier <= bar ? 'hit' : 'miss';
}

/** A pick's mark: `verdict` null while it's too early to say; `locked` once stored for good. */
export interface PickMark {
  verdict: PickVerdict | null;
  locked: boolean;
}

/** The live verdict: where the user's scouts think he tops out, against his round's bar. */
const liveVerdict = (league: League, p: Player): PickVerdict =>
  verdictFor(p.draft!.round, tierOf(league, p.position, perceive(league, league.userTeamId, p).potMid));

/**
 * How a pick reads now, or null for a player from no draft this league held (a new league's veterans come with
 * made-up draft lines and no consensus read). Too early until his rookie season is in: its end is the first time
 * his ceiling settles.
 */
export function pickMark(league: League, p: Player): PickMark | null {
  if (!p.draft || !p.scouting) return null;
  if (p.draft.verdict) return { verdict: p.draft.verdict, locked: true };
  if (p.experience === 0 && !Object.keys(p.ceilingShifts ?? {}).length) return { verdict: null, locked: false };
  return { verdict: liveVerdict(league, p), locked: false };
}

/**
 * Locks the verdict on every pick three league years back, from the user's club's read at that moment. Retired
 * players count (a bust who left early is still a bust); a stored verdict is never rewritten.
 */
export function lockVerdicts(league: League): void {
  for (const p of Object.values(league.players)) {
    if (!p.draft || !p.scouting || p.draft.verdict) continue;
    if (league.season - p.draft.season >= VERDICT_YEARS) p.draft.verdict = liveVerdict(league, p);
  }
}
