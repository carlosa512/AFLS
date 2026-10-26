/** Practice squad poaching over full enabled seasons: legality every week and how often it happens. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createLeague } from '../src/engine/generate';
import { playWeek } from '../src/engine/league';
import { capSpace } from '../src/engine/finance/cap';
import { activeRoster } from '../src/engine/roster';
import { settleWeek } from '../src/engine/personnel/flow';

// AFLS estimate, not an NFL count (none is public): rare but real, 0.5–3 a club a season.
const BAND = [16, 96] as const;
const count = Number(process.argv[2] ?? 2);
assert(Number.isInteger(count) && count >= 1 && count <= 20, 'Choose 1–20 full-season trials.');
const hash = (x: unknown) => createHash('sha256').update(JSON.stringify(x)).digest('hex');
let failures = 0;
for (let i = 0; i < count; i++) {
  const l = createLeague({ seed: `poaching-audit-${i}`, personnel: true, userTeamId: 0 });
  let poached = 0;
  while (l.phase === 'regular') {
    const week = l.week;
    const games = l.games.filter((g) => g.season === l.season && g.week === week);
    playWeek(l);
    const state = l.personnel!.poaching;
    for (const r of state?.results.filter((r) => r.week === week && r.toTeamId !== null) ?? []) {
      poached++;
      assert.equal(state!.locked.week, week, 'Protections were not locked for the week');
      assert(!state!.locked.ids[r.fromTeamId]?.includes(r.playerId), 'A protected player was poached');
      assert(
        !games.some((g) => [g.homeId, g.awayId].includes(r.fromTeamId) && [g.homeId, g.awayId].includes(r.toTeamId!)),
        'Poached from this week’s opponent',
      );
    }
    for (const t of l.teams) {
      assert(activeRoster(l, t.id).length <= 53, `${t.abbrev} over 53`);
      assert(capSpace(l, t.id) >= -0.001, `${t.abbrev} over the cap`);
    }
    if (l.phase === 'regular') {
      const copy = JSON.parse(JSON.stringify(l));
      settleWeek(copy);
      const settled = hash(copy);
      settleWeek(JSON.parse(JSON.stringify(copy)));
      settleWeek(copy);
      assert.equal(hash(copy), settled, 'A second settle in the same week changed the save');
    }
  }
  const ok = poached >= BAND[0] && poached <= BAND[1];
  if (!ok) failures++;
  console.log(
    `${ok ? '✓' : '✗'} ${l.seed}: ${poached} poaches in a season (target ${BAND[0]}–${BAND[1]}); rosters, cap, protections, opponents and re-settles legal`,
  );
}
console.log(`${failures} poaching number(s) outside target range`);
if (failures) process.exit(1);
