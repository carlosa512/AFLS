import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { createLeague } from '../engine/generate';
import { playWeek } from '../engine/league';
import { teamCoaches } from '../engine/coaching';
import { NavContext, type Nav } from './nav';
import { CoachCard } from './screens/Coaches';

const nav = {
  openPlayer: () => {},
  openTeam: () => {},
  go: () => {},
  openStaff: () => {},
  compareIds: [],
} as unknown as Nav;

describe("the coach's card", () => {
  it('opens on Bio, with Record and Career a tap away, and an overview in place of the old box', () => {
    const l = createLeague({ seed: 'coach-card' });
    playWeek(l);
    const hc = teamCoaches(l, l.userTeamId).find((c) => c.role === 'headCoach')!;
    const html = renderToStaticMarkup(
      <NavContext.Provider value={nav}>
        <CoachCard league={l} coach={hc} onClose={() => {}} />
      </NavContext.Provider>,
    );
    expect(html).toMatch(/aria-selected="true"[^>]*>Bio</);
    expect(html).toMatch(/>Record</);
    expect(html).toMatch(/>Career</);
    expect(html).toContain('<span class="eyebrow">Overview</span>');
    expect(html).not.toContain('Around the league</span>');
    expect(html).not.toContain('Habits over time');
  });
});
