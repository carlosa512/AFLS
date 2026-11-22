import { capFor } from './finance/cap';
import { compRound, compTally, compWindow } from './offseason/comp';
import { demand, walkedAway } from './offseason/negotiation';
import type { League, Player } from './types';

/** Words only: the round and who it is for, never a pay or a cap share. */
export const ROUND: Record<number, string> = { 3: '3rd', 4: '4th', 5: '5th', 6: '6th', 7: '7th' };
export const short = (p?: Player) => (p ? `${p.firstName[0]}. ${p.lastName}` : 'a player');

/** What letting a player of ours walk would likely earn (his market pay's round), or null when it would earn nothing. */
export function walkLine(league: League, p: Player): string | null {
  const user = league.userTeamId;
  // Only a player whose last team is ours could be credited to us.
  if (walkedAway(p, user === 0 ? 1 : 0) !== user) return null;
  const round = compRound(demand(league, p, user).market, capFor(league, league.season));
  return round === null ? null : `If he signs elsewhere, likely a ${ROUND[round]}-round compensatory pick next year.`;
}

/** What signing a free agent at `apy` would undo: the loss of ours his signing cancels, or null. */
export function cancelLine(league: League, p: Player, apy: number): string | null {
  const user = league.userTeamId;
  if (!compWindow(league.phase) || walkedAway(p, user) === undefined) return null;
  // Adding a gain can reshuffle which losses the others cancel, so compare the picks before and after.
  const after = compTally(league, user, { extraGain: { playerId: p.id, apy } }).picks;
  const hit = compTally(league, user).picks.find((b) => !after.some((a) => a.playerId === b.playerId));
  if (!hit) return null;
  return `Signing him cancels the ${ROUND[hit.round]}-round compensatory pick you are on track for (${short(league.players[hit.playerId])}).`;
}

/** The compensatory picks our club is on track for while free agency runs, or null with none. */
export function tallyLine(league: League): string | null {
  if (!compWindow(league.phase)) return null;
  const { picks } = compTally(league, league.userTeamId);
  if (!picks.length) return null;
  const parts = picks.map((m, i) => {
    const who = `(${short(league.players[m.playerId])})`;
    return i === 0 ? `a ${ROUND[m.round]}-round compensatory pick ${who}` : `a ${ROUND[m.round]} ${who}`;
  });
  const list =
    parts.length < 2 ? parts[0] : `${parts.slice(0, -1).join(', ')}${parts.length > 2 ? ',' : ''} and ${parts.at(-1)}`;
  return `On track for ${list}.`;
}
