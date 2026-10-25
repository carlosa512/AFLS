/** Exercise the staged personnel system explicitly; ordinary careers remain disabled until the full feature ships. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createLeague } from '../src/engine/generate';
import { playWeek, simToEndOfSeason } from '../src/engine/league';
import { advanceOffseason, beginOffseason } from '../src/engine/offseason';
import { capSpace } from '../src/engine/finance/cap';
import { activeRoster } from '../src/engine/roster';
import { submitAIClaims } from '../src/engine/personnel/ai';
import { advanceNextPersonnelEvent, nextWaiverDeadline } from '../src/engine/personnel/flow';
import { PERSONNEL_RULES } from '../src/engine/personnel/rules';
import type { League } from '../src/engine/types';

const count = Math.max(1, Number(process.argv[2] ?? 2));
assert(Number.isInteger(count) && count <= 20, 'Choose 1–20 trial leagues.');
const savedHash = (league: League) => createHash('sha256').update(JSON.stringify(league)).digest('hex');

function legal(league: League, opening = false) {
  for (const team of league.teams) {
    const roster = activeRoster(league, team.id);
    assert(roster.length <= 53, `${team.abbrev}: too many players`);
    if (opening) assert.equal(roster.length, 53, `${team.abbrev}: short at opening`);
    assert(capSpace(league, team.id) >= 0, `${team.abbrev}: over cap`);
  }
  for (const entry of league.personnel!.waivers!.pending) {
    const p = league.players[entry.playerId];
    assert.equal(p.waiver?.id, entry.id);
    assert.equal(p.teamId, null);
    assert.deepEqual(p.contract, entry.contract, 'A pending contract changed');
  }
}

for (let trial = 0; trial < count; trial++) {
  const seed = trial === 0 ? 'waiver-ai-trial' : `waiver-ai-trial-${trial + 1}`;
  const league = createLeague({ seed });
  simToEndOfSeason(league);
  league.personnel!.enabled = true;
  beginOffseason(league);
  for (let step = 0; step < 16 && league.phase !== 'preseason'; step++) advanceOffseason(league, { autoUser: true });
  assert.equal(league.phase, 'preseason');
  advanceOffseason(league, { autoUser: true });
  const state = league.personnel!.waivers!;
  const pending = state.pending.length;
  const deadline = nextWaiverDeadline(league);
  if (deadline !== undefined) submitAIClaims(league, deadline, true);
  const submitted = state.claims.length;
  const clubs = new Set(state.claims.map((c) => c.teamId)).size;
  let notices = 0;
  while (nextWaiverDeadline(league) !== undefined && notices < 128) {
    const reloaded = JSON.parse(JSON.stringify(league)) as League;
    advanceNextPersonnelEvent(league, true);
    advanceNextPersonnelEvent(reloaded, true);
    // Compare saved data, not absent-vs-undefined runtime properties; never build a multi-MB assertion diff.
    assert.equal(savedHash(reloaded), savedHash(league), 'A JSON reload changed the notice outcome');
    legal(league);
    notices++;
  }
  assert.equal(nextWaiverDeadline(league), undefined, 'Cutdown claim churn did not settle');
  assert(Object.values(state.aiWindow?.awards ?? {}).every((n) => n <= PERSONNEL_RULES.maxAIWaiverAddsPerWindow));
  advanceOffseason(league, { autoUser: true });
  legal(league, true);
  const awards = league.transactions.filter(
    (t) => t.season === league.season && t.phase === 'preseason' && t.kind === 'claim',
  ).length;
  for (let week = 0; week < 4; week++) {
    playWeek(league);
    legal(league);
  }
  console.log(
    `${seed}: ${pending} initial waivers, ${submitted} claims from ${clubs} clubs, ${awards} awards over ${notices} notices; all opening rosters 53, four weeks legal, reloads identical`,
  );
}
console.log('0 personnel invariant failures');
