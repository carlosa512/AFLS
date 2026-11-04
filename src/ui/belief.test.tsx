import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { runnerOf } from '../engine/belief';
import { protectCoach } from '../engine/coaching';
import { createLeague } from '../engine/generate';
import { playWeek } from '../engine/league';
import type { League } from '../engine/types';
import { NavContext, type Nav } from './nav';
import { CoachesScreen } from './screens/Coaches';
import { LockerRoom } from './screens/LockerRoom';

const nav = {
  openPlayer: () => {},
  openTeam: () => {},
  go: () => {},
  openStaff: () => {},
  compareIds: [],
} as unknown as Nav;
const base = (() => {
  const l = createLeague({ seed: 'belief-ui' });
  playWeek(l);
  playWeek(l);
  return JSON.stringify(l);
})();
const fresh = (): League => JSON.parse(base);
const locker = (l: League) =>
  renderToStaticMarkup(
    <NavContext.Provider value={nav}>
      <LockerRoom league={l} />
    </NavContext.Provider>,
  );
const coaches = (l: League) =>
  renderToStaticMarkup(
    <NavContext.Provider value={nav}>
      <CoachesScreen league={l} />
    </NavContext.Provider>,
  );

describe('backing the staff on screen (L4)', () => {
  it('the Locker Room card says a room doubts its coordinator, his name a link, and says nothing when steady', () => {
    const l = fresh();
    const oc = runnerOf(l, l.userTeamId, 'WR')!;
    for (const r of ['QB', 'RB', 'WR', 'OL'] as const) oc.belief = { ...oc.belief, [r]: 0 };
    expect(locker(l)).not.toContain('room-belief');
    oc.belief = { WR: -0.3 };
    const html = locker(l);
    expect(html).toMatch(
      new RegExp(
        `<p class="room-chem room-belief">Doubts about <button class="linklike">${oc.lastName}</button>&#x27;s calls`,
      ),
    );
    expect(html.match(/room-belief/g)).toHaveLength(1);
  });

  it("the Coaches screen tells how a coordinator's rooms take him, and offers to relieve him in season", () => {
    const l = fresh();
    const oc = runnerOf(l, l.userTeamId, 'OL')!;
    oc.belief = { OL: 0.5, QB: -0.3 };
    const html = coaches(l);
    expect(html).toContain('The line believes in him; the quarterbacks have doubts.');
    // In season a coordinator is relieved, not dismissed: one button for it.
    expect(html).not.toMatch(new RegExp(`aria-label="Dismiss[^"]*${oc.firstName} ${oc.lastName}"`));
    expect(html).toMatch(new RegExp(`aria-label="Relieve him[^"]*${oc.firstName} ${oc.lastName}"`));
  });

  it('no relieve in the offseason, and the reason when an owner protects him', () => {
    const l = fresh();
    const oc = runnerOf(l, l.userTeamId, 'OL')!;
    protectCoach(l, oc.id, l.season, 'The owner wants him kept.');
    expect(coaches(l)).toMatch(new RegExp(`aria-label="Relieve him[^"]*${oc.firstName} ${oc.lastName}" disabled=""`));
    expect(coaches(l)).toContain('The owner wants him kept.');
    l.phase = 'resign';
    expect(coaches(l)).not.toContain('Relieve him');
  });
});
