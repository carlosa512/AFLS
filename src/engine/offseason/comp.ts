import { capFor } from '../finance/cap';
import type { League } from '../types';

type Round = 3 | 4 | 5 | 6 | 7;

/**
 * Compensatory picks: a team that loses free agents and signs fewer than it loses is paid back in rounds 3–7.
 * The round comes from the deal's share of the cap (`bands`, tuned in Task 3); under `floor` it counts for nothing.
 */
export const COMP: { floor: number; bands: { round: Round; share: number }[]; max: number; on: boolean } = {
  floor: 0.008,
  bands: [
    { round: 3, share: 0.06 },
    { round: 4, share: 0.035 },
    { round: 5, share: 0.02 },
    { round: 6, share: 0.012 },
    { round: 7, share: 0.008 },
  ],
  max: 4,
  on: true,
};

/** The round a deal is worth (best band whose share it reaches), or null under the floor. `apy` and `cap` in $K. */
export function compRound(apy: number, cap: number): Round | null {
  const share = apy / cap;
  if (share < COMP.floor) return null;
  for (const b of COMP.bands) if (share >= b.share) return b.round;
  return null;
}

export interface CompMove {
  playerId: number;
  /** The team that lost him (a loss) or signed him (a gain). */
  teamId: number;
  round: Round;
  apy: number;
}

const better = (a: CompMove, b: CompMove) => a.round - b.round || b.apy - a.apy;

/** This league year's qualifying free-agent signings: those that took a player from a team, in free agency or the draft. */
export function compMoves(league: League, season = league.season): { losses: CompMove[]; gains: CompMove[] } {
  const losses: CompMove[] = [];
  const gains: CompMove[] = [];
  const cap = capFor(league, season);
  for (const t of league.transactions) {
    if (t.kind !== 'sign' || t.from === undefined || t.apy === undefined || t.playerId === undefined) continue;
    if (t.season !== season || (t.phase !== 'freeAgency' && t.phase !== 'draft')) continue;
    const round = compRound(t.apy, cap);
    if (round === null) continue;
    losses.push({ playerId: t.playerId, teamId: t.from, round, apy: t.apy });
    gains.push({ playerId: t.playerId, teamId: t.teamIds[0], round, apy: t.apy });
  }
  return { losses, gains };
}

/**
 * What a team is owed: its losses less its gains, one for one. Gains go best first (round, then pay). Each cancels the
 * best remaining loss of its own round or lower (a larger round number); if every loss left is better than the gain,
 * it cancels the worst one, so a cheaper signing never wipes out the biggest compensation. Then the cap of `COMP.max`,
 * best first. `extraGain` asks "what if I signed him".
 */
export function compTally(
  league: League,
  teamId: number,
  opts?: { extraGain?: { playerId: number; apy: number } },
): { picks: CompMove[]; cancelled: { loss: CompMove; by: CompMove }[] } {
  const { losses, gains } = compMoves(league);
  const mine = losses.filter((m) => m.teamId === teamId).sort(better);
  const got = gains.filter((m) => m.teamId === teamId);
  const extra = opts?.extraGain;
  if (extra && !got.some((g) => g.playerId === extra.playerId)) {
    const round = compRound(extra.apy, capFor(league, league.season));
    if (round !== null) got.push({ playerId: extra.playerId, teamId, round, apy: extra.apy });
  }
  const cancelled: { loss: CompMove; by: CompMove }[] = [];
  for (const g of got.sort(better)) {
    // mine is best first: the first loss no better than the gain, else (the gain is smaller than all) the worst one.
    let at = mine.findIndex((l) => l.round >= g.round);
    if (at < 0) at = mine.length - 1;
    if (at >= 0) cancelled.push({ loss: mine.splice(at, 1)[0], by: g });
  }
  return { picks: COMP.on ? mine.slice(0, COMP.max) : [], cancelled };
}
