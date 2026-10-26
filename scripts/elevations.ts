/** Enabled personnel integration: every game entry, active list, call-up and return over complete seasons. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createLeague } from '../src/engine/generate';
import { playWeek, userGame } from '../src/engine/league';
import { capSpace } from '../src/engine/finance/cap';
import { activeRoster } from '../src/engine/roster';
import { dressingLimit } from '../src/engine/personnel/gameDay';
import { elevationRecords, elevationUses, planAIElevations } from '../src/engine/personnel/elevations';
import { settleSquadPayroll } from '../src/engine/personnel/payroll';

const count = Number(process.argv[2] ?? 2);
assert(Number.isInteger(count) && count >= 1 && count <= 20, 'Choose 1–20 full-season trials.');
const hash = (x: unknown) => createHash('sha256').update(JSON.stringify(x)).digest('hex');
for (let i = 0; i < count; i++) {
  let l = createLeague({ seed: `elevation-audit-${i}`, personnel: true, userTeamId: 0 });
  let games = 0;
  let appearances = 0;
  while (l.phase !== 'complete') {
    const ours = userGame(l);
    if (ours && !ours.result) planAIElevations(l, ours, true); // explicit audit delegation
    const played = playWeek(l);
    for (const g of played) {
      const lists = g.personnel?.lists;
      assert(lists, 'Missing frozen game roster');
      for (const list of Object.values(lists)) {
        assert(list.dressedIds.length <= dressingLimit(l, list.dressedIds), 'Illegal 47/48 active list');
        assert(list.dressedIds.length + list.inactiveIds.length <= 55, 'More than 55');
        assert(list.elevatedIds.length <= 2, 'More than two call-ups');
      }
      for (const [id, line] of Object.entries(g.result!.playerStats)) {
        if (!(line.snaps || line.gp)) continue;
        const roster = lists[g.result!.playerTeams[Number(id)]];
        assert(roster, 'Stats credited to a foreign team');
        assert(
          roster.dressedIds.includes(Number(id)) || roster.emergencyQbId === Number(id),
          'Inactive player appeared',
        );
        if (roster.elevatedIds.includes(Number(id))) appearances++;
      }
      games++;
    }
    for (const t of l.teams) {
      assert(activeRoster(l, t.id).length <= 53, 'Call-up leaked into 53');
      assert(capSpace(l, t.id) >= -0.001, `${t.abbrev} over cap`);
    }
    for (const e of elevationRecords(l)) assert(e.status !== 'active', 'A call-up missed its return deadline');
    for (const p of Object.values(l.players))
      if (p.teamId !== null) assert(elevationUses(l, p) <= 3, 'Fourth regular-season use');
    l = JSON.parse(JSON.stringify(l));
    settleSquadPayroll(l);
    const before = hash(l);
    settleSquadPayroll(l);
    assert.equal(hash(l), before, 'Payroll duplicated after reload');
  }
  const filed = elevationRecords(l).filter((e) => e.status === 'reverted');
  assert(filed.length > 0, 'AI call-up path was never exercised');
  console.log(
    `${l.seed}: ${games} games, ${filed.length} filed call-ups, ${appearances} call-up game appearances; legal active lists, cap, service boundary, reversion and reload`,
  );
}
console.log('0 elevation integration failures');
