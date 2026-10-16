/** Player development between seasons. */
import { ATTRIBUTE_INFO } from './attributes';
import { ATTRIBUTE_PROFILES, playerOvr } from './positions';
import { clamp, type Rng } from './rng';
import type { Player } from './types';
import { ATTRIBUTES } from './types';

/** Last age of a player's prime at each position; decline starts the year after. */
export const PEAK_END = { RB: 27, WR: 29, CB: 28, S: 29, LB: 29, EDGE: 29, DT: 30, TE: 30, OL: 31, QB: 33, K: 35, P: 35 } as const;

/** Note a player's ratings at the start of a league year, for his development history. */
export function recordRatings(player: Player, season: number): void {
  (player.ratingHistory ??= {})[season] = ATTRIBUTES.map((a) => player.ratings[a]);
}

/** Simple age curve: growth toward potential while young, decline after the prime. */
export function developPlayer(rng: Rng, player: Player) {
  const age = player.age;
  const peakEnd = PEAK_END[player.position];
  const ovr = playerOvr(player);
  let delta: number;
  if (age < 26) delta = Math.max(0, player.potential - ovr) * rng.float(0.15, 0.5);
  else if (age <= peakEnd) delta = rng.normal(0, 0.4);
  else delta = -rng.float(0.3, 1.4) * (1 + (age - peakEnd) * 0.25);
  // Only position-relevant skills develop; off-position attributes stay put.
  const relevant = ATTRIBUTE_PROFILES[player.position];
  for (const attr of ATTRIBUTES) {
    if (relevant[attr] === undefined) continue;
    // Physical tools fade faster than technique; the mental game grows longest and fades last.
    const aging = ATTRIBUTE_INFO[attr].aging;
    const d = delta < 0 ? delta * { physical: 1.4, technical: 1, mental: 0.3 }[aging] : delta * (aging === 'mental' ? 1.2 : 1);
    player.ratings[attr] = Math.round(clamp(player.ratings[attr] + d + rng.normal(0, 0.35), 1, 20));
  }
}
