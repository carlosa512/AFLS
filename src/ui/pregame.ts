/**
 * Before the kickoff: who is out for each side. Injuries are public (the league's injury report), so this reads any
 * club's; it says who cannot play, never who would have started (that would lean on ratings a screen may not show).
 * A live game takes this once, as it starts (`live.start`): the league moves on when the game is recorded, and a
 * finished game's save doesn't keep who sat out, so a replay has no list.
 */
import { injuryLabel } from '../engine/injuries';
import { isAvailable, teamPlayers } from '../engine/roster';
import type { Game, League } from '../engine/types';

/** A man who misses the game, and why in the injury report's words. */
export interface OutMan {
  id: number;
  what: string;
}
export interface GameOut {
  home: OutMan[];
  away: OutMan[];
}

/**
 * A club's hurt men who can't play this week (a man playing through it is not out), the longest layoff first by the
 * doctor's estimate: the same order as the injury report (`hurtList`), never the true weeks.
 */
export function outFor(league: League, teamId: number): OutMan[] {
  const est = (e?: [number, number]) => (e ? e[1] * 100 + e[0] : -1);
  return teamPlayers(league, teamId)
    .filter((p) => (p.injury || p.ir) && !isAvailable(p))
    .sort((a, b) => est(b.injury?.estimate) - est(a.injury?.estimate) || a.id - b.id)
    .map((p) => ({ id: p.id, what: p.injury ? injuryLabel(p.injury.type).toLowerCase() : 'injured reserve' }));
}

export const outAt = (league: League, game: Game): GameOut => ({
  home: outFor(league, game.homeId),
  away: outFor(league, game.awayId),
});
