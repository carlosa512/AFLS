import { capFor } from './finance/cap';
import { compRound, compTally } from './offseason/comp';
import { demand, walkedAway } from './offseason/negotiation';
import type { League, Player } from './types';

/** Words only: the round and who it is for, never a pay or a cap share. */
const ROUND: Record<number, string> = { 3: '3rd', 4: '4th', 5: '5th', 6: '6th', 7: '7th' };
const short = (p?: Player) => (p ? `${p.firstName[0]}. ${p.lastName}` : 'a player');

/** What letting a player of ours walk would likely earn (his market pay's round), or null when it would earn nothing. */
export function walkLine(league: League, p: Player): string | null {
  const round = compRound(demand(league, p, league.userTeamId).market, capFor(league, league.season));
  return round === null ? null : `If he signs elsewhere, likely a ${ROUND[round]}-round compensatory pick next year.`;
}

/** What signing a free agent at `apy` would undo: the loss of ours his signing cancels, or null. */
export function cancelLine(league: League, p: Player, apy: number): string | null {
  const user = league.userTeamId;
  if (league.phase !== 'freeAgency' || walkedAway(p, user) === undefined) return null;
  const { cancelled } = compTally(league, user, { extraGain: { playerId: p.id, apy } });
  const hit = cancelled.find((c) => c.by.playerId === p.id);
  if (!hit) return null;
  return `Signing him cancels the ${ROUND[hit.loss.round]}-round compensatory pick you are on track for (${short(league.players[hit.loss.playerId])}).`;
}

/** The compensatory picks our club is on track for while free agency runs, or null with none. */
export function tallyLine(league: League): string | null {
  if (league.phase !== 'freeAgency') return null;
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
