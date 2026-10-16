/**
 * Offseason audit: run seasons back to back and summarize what the AI front offices did
 * (signings, tags, cuts, cap health, roster sizes, league talent) so drift is easy to spot.
 *
 *   npm run offseason            # 3 seasons
 *   npm run offseason -- 6
 */
import { capSheet } from '../src/engine/finance/cap';
import { createLeague } from '../src/engine/generate';
import { simToEndOfSeason } from '../src/engine/league';
import { advanceOffseason, beginOffseason } from '../src/engine/offseason';
import { freeAgents } from '../src/engine/offseason/negotiation';
import { playerOvr, STARTERS } from '../src/engine/positions';
import { teamPlayers } from '../src/engine/roster';
import type { League } from '../src/engine/types';

const seasons = Number(process.argv[2] ?? 3);
const league = createLeague({ seed: 'offseason-audit' });
const M = (k: number) => `$${(k / 1000).toFixed(1)}M`;

function snapshot(l: League, label: string) {
  const sheets = l.teams.map((t) => capSheet(l, t.id));
  const sizes = l.teams.map((t) => teamPlayers(l, t.id).length);
  const space = sheets.map((s) => s.space).sort((a, b) => a - b);
  const dead = sheets.map((s) => s.dead).sort((a, b) => a - b);
  const starters = l.teams.flatMap((t) =>
    (Object.keys(STARTERS) as (keyof typeof STARTERS)[]).flatMap((pos) => t.depthChart[pos].slice(0, STARTERS[pos]).map((id) => playerOvr(l.players[id]))),
  );
  const avgStarter = starters.reduce((a, b) => a + b, 0) / starters.length;
  console.log(
    `${label.padEnd(22)} roster ${Math.min(...sizes)}–${Math.max(...sizes)} · space ${M(space[0])} / median ${M(space[16])} / ${M(space[31])} · over cap ${space.filter((s) => s < 0).length} · dead median ${M(dead[16])} max ${M(dead[31])} · starter OVR ${avgStarter.toFixed(2)} · FAs ${freeAgents(l).length}`,
  );
}

for (let s = 0; s < seasons; s++) {
  simToEndOfSeason(league);
  const before = league.transactions.length;
  beginOffseason(league);
  snapshot(league, `${league.season} new year`);
  while (league.phase !== 'regular') {
    const phase = league.phase;
    advanceOffseason(league, { autoUser: true });
    if (phase !== league.phase) snapshot(league, `${league.season} → ${league.phase}`);
  }
  const moves = league.transactions.slice(before);
  const count = (k: string) => moves.filter((m) => m.kind === k).length;
  console.log(
    `  moves: re-signed ${count('resign')}, signed ${count('sign')}, released ${count('release')}, restructured ${count('restructure')}, tagged ${count('tag')}, options ${count('option')}, drafted ${count('draft')}, retired(notable) ${count('retire')}\n`,
  );
}
