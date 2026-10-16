/**
 * Offseason audit: run seasons back to back and summarize what the AI front offices did
 * (signings, tags, cuts, cap health, roster sizes, league talent), how well they drafted, and the
 * health of the scouting-staff economy, so drift is easy to spot.
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
import { departmentScore, staffBudget, staffMarket, staffPayroll, staffValue, teamStaff } from '../src/engine/staff';
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
  beginOffseason(league);
  snapshot(league, `${league.season} new year`);
  while (league.phase !== 'regular') {
    const phase = league.phase;
    advanceOffseason(league, { autoUser: true });
    if (phase !== league.phase) snapshot(league, `${league.season} → ${league.phase}`);
  }
  // The log is capped, so count this offseason's moves by date rather than by position in it.
  const moves = league.transactions.filter((m) => m.season === league.season && m.phase !== 'regular' && m.phase !== 'playoffs');
  const count = (k: string) => moves.filter((m) => m.kind === k).length;
  // Draft quality in true terms (the AI only sees its own reads): early picks, and best- vs worst-staffed teams.
  const picks = league.draftPicks.filter((pk) => pk.season === league.season && pk.playerId !== undefined && pk.round <= 3);
  const worth = (id: number) => 0.6 * playerOvr(league.players[id]) + 0.4 * league.players[id].potential;
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  const byStaff = [...league.teams].sort((a, b) => departmentScore(league, a.id) - departmentScore(league, b.id)).map((t) => t.id);
  const pickWorth = (ids: number[]) => avg(picks.filter((pk) => ids.includes(pk.ownerId)).map((pk) => worth(pk.playerId!)));
  const reach = avg(picks.filter((pk) => pk.consRank !== undefined).map((pk) => Math.abs(pk.overall! - pk.consRank!)));
  console.log(
    `  draft: R1 worth ${avg(picks.filter((pk) => pk.round === 1).map((pk) => worth(pk.playerId!))).toFixed(2)} · R2-3 ${avg(picks.filter((pk) => pk.round > 1).map((pk) => worth(pk.playerId!))).toFixed(2)} · best-8 staffs ${pickWorth(byStaff.slice(0, 8)).toFixed(2)} vs worst-8 ${pickWorth(byStaff.slice(-8)).toFixed(2)} · avg |slot - consensus rank| ${reach.toFixed(1)}`,
  );
  const employed = Object.values(league.staff).filter((st) => st.teamId !== null);
  const scores = league.teams.map((t) => departmentScore(league, t.id));
  console.log(
    `  staff: accuracy x${(2 ** avg(scores)).toFixed(2)} (best x${(2 ** Math.min(...scores)).toFixed(2)}, worst x${(2 ** Math.max(...scores)).toFixed(2)}) · value ${avg(employed.map(staffValue)).toFixed(2)} · per team ${Math.min(...league.teams.map((t) => teamStaff(league, t.id).length))}-${Math.max(...league.teams.map((t) => teamStaff(league, t.id).length))} · over budget ${league.teams.filter((t) => staffPayroll(league, t.id) > staffBudget(league, t.id)).length} · market ${staffMarket(league).length}`,
  );
  console.log(
    `  moves: re-signed ${count('resign')}, signed ${count('sign')}, released ${count('release')}, restructured ${count('restructure')}, tagged ${count('tag')}, options ${count('option')}, drafted ${count('draft')}, retired(notable) ${count('retire')}\n`,
  );
}
