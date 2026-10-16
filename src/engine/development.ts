/** Player development between seasons. */
import { ATTRIBUTE_PROFILES, playerOvr } from './positions';
import { clamp, type Rng } from './rng';
import type { Player } from './types';
import { ATTRIBUTES } from './types';

/** Simple age curve: growth toward potential while young, decline after the prime. */
export function developPlayer(rng: Rng, player: Player) {
  const age = player.age;
  const peakEnd = { RB: 27, WR: 29, CB: 28, S: 29, LB: 29, EDGE: 29, DT: 30, TE: 30, OL: 31, QB: 33, K: 35, P: 35 }[player.position];
  const ovr = playerOvr(player);
  let delta: number;
  if (age < 26) delta = Math.max(0, player.potential - ovr) * rng.float(0.15, 0.5);
  else if (age <= peakEnd) delta = rng.normal(0, 0.4);
  else delta = -rng.float(0.3, 1.4) * (1 + (age - peakEnd) * 0.25);
  // Only position-relevant skills develop; off-position attributes stay put.
  const relevant = ATTRIBUTE_PROFILES[player.position];
  for (const attr of ATTRIBUTES) {
    if (relevant[attr] === undefined) continue;
    const physical = attr === 'speed' || attr === 'agility' || attr === 'strength';
    // Physical tools fade faster than mental ones.
    const d = delta < 0 ? delta * (physical ? 1.4 : attr === 'awareness' ? 0.3 : 1) : delta * (attr === 'awareness' ? 1.2 : 1);
    player.ratings[attr] = Math.round(clamp(player.ratings[attr] + d + rng.normal(0, 0.35), 1, 20));
  }
}
