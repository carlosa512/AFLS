/**
 * A seeded league's fingerprint: play it for some seasons and hash its save. A change meant to leave play alone (a speed
 * change, an index) must give the same hash before and after.
 *
 *   npm run fingerprint -- <seed> <seasons> [--personnel]
 */
import { createHash } from 'node:crypto';
import { createLeague } from '../src/engine/generate';
import { simToEndOfSeason } from '../src/engine/league';
import { advanceOffseason, beginOffseason } from '../src/engine/offseason/index';
import { RETIRED_KEEP } from '../src/engine/roster';
import type { Player } from '../src/engine/types';

const [seed = 'fingerprint', n = '3'] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const personnel = process.argv.includes('--personnel');
// `--slim`: retired players reduced to what they keep (`RETIRED_KEEP`) before hashing, so a change that only drops
// what a retired player no longer needs hashes the same.
const slim = process.argv.includes('--slim');
const league = createLeague({ seed, personnel });
for (let s = 0; s < Number(n); s++) {
  simToEndOfSeason(league);
  beginOffseason(league);
  while (league.phase !== 'regular') advanceOffseason(league, { autoUser: true });
}
if (slim)
  for (const p of Object.values(league.players))
    if (p.retired)
      for (const k of Object.keys(p))
        if (!RETIRED_KEEP.includes(k as keyof Player)) delete (p as unknown as Record<string, unknown>)[k];
const hash = createHash('sha256').update(JSON.stringify(league)).digest('hex');
console.log(`${seed} ${n} personnel ${personnel ? 'on' : 'off'}${slim ? ' slim' : ''} ${hash}`);
