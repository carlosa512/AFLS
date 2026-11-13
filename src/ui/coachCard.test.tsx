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
  it('opens on Bio with his seasons under the overview, and Career a tap away', () => {
    const l = createLeague({ seed: 'coach-card' });
    playWeek(l);
    // Something for Career to show, so the card has its tabs.
    const hc = {
      ...teamCoaches(l, l.userTeamId).find((c) => c.role === 'headCoach')!,
      lastJob: 'Offensive coordinator, HOU',
    };
    const html = renderToStaticMarkup(
      <NavContext.Provider value={nav}>
        <CoachCard league={l} coach={hc} onClose={() => {}} />
      </NavContext.Provider>,
    );
    expect(html).toMatch(/aria-selected="true"[^>]*>Bio</);
    expect(html).toMatch(/role="tab"[^>]*>Career</);
    expect(html).not.toMatch(/role="tab"[^>]*>Record</);
    expect(html).toContain('<span class="eyebrow">Overview</span>');
    // His seasons sit under the overview, on Bio: no second tab repeating them.
    expect(html.indexOf('season-row')).toBeGreaterThan(html.indexOf('Overview'));
    expect(html).not.toContain('Around the league</span>');
    expect(html).not.toContain('Habits over time');
    const career = renderToStaticMarkup(
      <NavContext.Provider value={nav}>
        <CoachCard league={l} coach={hc} onClose={() => {}} startTab="career" />
      </NavContext.Provider>,
    );
    // The chair's job description is the engine's, not something a reader needs on his card.
    expect(career).not.toContain('Has a hand in');
  });

  it('shows no Career tab when he has nothing there to show', () => {
    const l = createLeague({ seed: 'coach-card' });
    const hc = teamCoaches(l, l.userTeamId).find((c) => c.role === 'headCoach')!;
    const bare = {
      ...hc,
      interimAppointments: [],
      playerId: undefined,
      pastUnder: [],
      quirkOrigin: undefined,
      lastJob: undefined,
      quirkLog: [],
    };
    const html = renderToStaticMarkup(
      <NavContext.Provider value={nav}>
        <CoachCard league={l} coach={bare} onClose={() => {}} />
      </NavContext.Provider>,
    );
    expect(html).not.toMatch(/role="tab"/);
    expect(html).toContain('<span class="eyebrow">Overview</span>');
  });
});
