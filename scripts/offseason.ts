/**
 * Offseason audit: run seasons back to back and summarize what the AI front offices did
 * (signings, tags, cuts, cap health, roster sizes, league talent), how well they drafted, and the
 * health of the scouting-staff and coaching economies, so drift is easy to spot.
 *
 *   npm run offseason            # 3 seasons
 *   npm run offseason -- 6
 */
import { coachBudget, coachingFor, coachMarket, coachPayroll, coachValue, CHAIRS, chairHolder, staffScore, teamCoaches } from '../src/engine/coaching';
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

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
/** Young players' OVR gains under the best- and worst-8 coaching staffs, pooled over the run. */
const gains = { best: [] as number[], worst: [] as number[] };

for (let s = 0; s < seasons; s++) {
  simToEndOfSeason(league);
  // Saves are one JSON blob in IndexedDB: awards must stay a sliver of it as seasons pile up.
  const kb = (x: unknown) => (JSON.stringify(x).length / 1024).toFixed(1);
  console.log(`${league.season} save ${kb(league)} KB · awards ${kb(league.awards)} KB · players of the week/month ${kb(league.weeklyAwards)} KB`);
  // What development is about to apply: the neutrality ledger, and who grows under which staff.
  const rostered = Object.values(league.players).filter((p) => !p.retired && p.teamId !== null);
  const young = rostered.filter((p) => p.age < 26 && p.position !== 'K' && p.position !== 'P');
  const rate = avg(young.map((p) => coachingFor(league, p.teamId, p.position).rate));
  const body = avg(rostered.filter((p) => p.age >= 28).map((p) => coachingFor(league, p.teamId, p.position).decline.physical));
  const craft = avg(rostered.filter((p) => p.age >= 28).map((p) => coachingFor(league, p.teamId, p.position).decline.technical));
  const byCoaching = [...league.teams].sort((a, b) => staffScore(teamCoaches(league, b.id)) - staffScore(teamCoaches(league, a.id))).map((t) => t.id);
  const before = new Map(young.map((p) => [p.id, { ovr: playerOvr(p), team: p.teamId! }]));
  beginOffseason(league);
  for (const [id, b] of before) {
    const p = league.players[id];
    if (p.retired) continue;
    if (byCoaching.slice(0, 8).includes(b.team)) gains.best.push(playerOvr(p) - b.ovr);
    if (byCoaching.slice(-8).includes(b.team)) gains.worst.push(playerOvr(p) - b.ovr);
  }
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
  const coaches = Object.values(league.coaches).filter((c) => c.teamId !== null);
  const roleMean = (role: string) => avg(coaches.filter((c) => c.role === role).map(coachValue)).toFixed(1);
  const pay = league.teams.map((t) => coachPayroll(league, t.id) / coachBudget(league, t.id));
  const teamRate = league.teams.map((t) => avg(rostered.filter((p) => p.teamId === t.id && p.age < 26 && p.position !== 'K' && p.position !== 'P').map((p) => coachingFor(league, t.id, p.position).rate)));
  const filled = league.teams.map((t) => CHAIRS.filter((ch) => chairHolder(teamCoaches(league, t.id), ch)).length);
  const staffMoves = moves.filter((m) => m.kind === 'coach');
  console.log(
    `  coaching: value HC ${roleMean('headCoach')} OC ${roleMean('offCoord')} DC ${roleMean('defCoord')} S&C ${roleMean('strengthCoach')} PC ${roleMean('positionCoach')} · ledger growth x${rate.toFixed(3)} (u26) body x${body.toFixed(3)} craft x${craft.toFixed(3)} (28+) · team growth x${Math.min(...teamRate).toFixed(2)}–x${Math.max(...teamRate).toFixed(2)} · payroll ${(100 * avg(pay)).toFixed(0)}% (${(100 * Math.min(...pay)).toFixed(0)}–${(100 * Math.max(...pay)).toFixed(0)}%) · over budget ${pay.filter((x) => x > 1).length} · chairs ${Math.min(...filled)}–${Math.max(...filled)} · HCs fired ${staffMoves.filter((m) => /head coach .* after a/.test(m.text)).length} hired ${staffMoves.filter((m) => / as head coach$/.test(m.text)).length} · market ${coachMarket(league).length}`,
  );
  console.log(
    `  moves: re-signed ${count('resign')}, signed ${count('sign')}, released ${count('release')}, restructured ${count('restructure')}, tagged ${count('tag')}, options ${count('option')}, drafted ${count('draft')}, retired(notable) ${count('retire')}\n`,
  );
}
console.log(`young players' yearly OVR gain under the best-8 coaching staffs ${avg(gains.best).toFixed(3)} (n=${gains.best.length}) vs worst-8 ${avg(gains.worst).toFixed(3)} (n=${gains.worst.length})`);
