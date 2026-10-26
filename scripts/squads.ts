/** Enabled-career audit: the staged profile is not switched on for normal careers. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createLeague } from '../src/engine/generate';
import { capSpace } from '../src/engine/finance/cap';
import { playWeek, simToEndOfSeason } from '../src/engine/league';
import { simOffseason } from '../src/engine/offseason';
import { activeRoster, isAvailable, practiceSquad } from '../src/engine/roster';
import { squadFit } from '../src/engine/personnel/eligibility';
import { squadPayroll, settleSquadPayroll } from '../src/engine/personnel/payroll';
import type { League } from '../src/engine/types';

const count = Math.max(1, Number(process.argv[2] ?? 2));
assert(Number.isInteger(count) && count <= 10, 'Choose 1–10 trial leagues.');
const hash = (l: League) => createHash('sha256').update(JSON.stringify(l)).digest('hex');
function legal(l: League, opening = false) {
  for (const t of l.teams) {
    const squad = practiceSquad(l, t.id);
    assert.equal(squadFit(l, squad), null, `${t.abbrev}: illegal category assignment`);
    assert(
      squad.every((p) => !p.contract && !isAvailable(p)),
      `${t.abbrev}: squad contract or eligibility leak`,
    );
    assert(activeRoster(l, t.id).length <= 53, `${t.abbrev}: over 53`);
    if (opening) assert.equal(activeRoster(l, t.id).length, 53, `${t.abbrev}: opening roster short`);
    assert(capSpace(l, t.id) >= 0, `${t.abbrev}: over cap`);
    const pay = squadPayroll(l, t.id);
    assert(pay.earned >= 0 && pay.projected >= 0 && Number.isFinite(pay.total), `${t.abbrev}: invalid payroll`);
  }
}
for (let trial = 0; trial < count; trial++) {
  let l = createLeague({ seed: `squad-audit-${trial}`, personnel: true });
  for (const t of l.teams) assert.equal(practiceSquad(l, t.id).length, 16);
  legal(l, true);
  for (let week = 0; week < 18; week++) {
    if (l.phase !== 'regular') break;
    playWeek(l);
    legal(l);
  }
  simToEndOfSeason(l);
  legal(l);
  const earned = l.teams.reduce((sum, t) => sum + squadPayroll(l, t.id).earned, 0);
  const oldIds = Object.values(l.players)
    .filter((p) => p.squad)
    .map((p) => p.id);
  l = JSON.parse(JSON.stringify(l));
  settleSquadPayroll(l);
  const saved = hash(l);
  settleSquadPayroll(l);
  assert.equal(hash(l), saved, 'Payroll settled twice');
  simOffseason(l);
  legal(l, true);
  assert(
    oldIds.every((id) => !l.players[id].squad || l.players[id].squad!.agreement?.season === l.season),
    'Old agreement survived expiry',
  );
  const filled = l.teams.map((t) => practiceSquad(l, t.id).length);
  for (let week = 0; week < 4; week++) {
    playWeek(l);
    legal(l);
  }
  console.log(
    `squad-audit-${trial}: 32 new squads of 16; full season + offseason + four weeks legal; prior payroll $${(earned / 1000).toFixed(2)}M; returning opening squads ${Math.min(...filled)}–${Math.max(...filled)}; reload/payroll idempotent`,
  );
}
console.log('0 squad invariant failures');
