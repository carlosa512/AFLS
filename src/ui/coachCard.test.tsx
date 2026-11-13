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
  it('opens on Bio with this season under the overview, and his whole path on Career', () => {
    const l = createLeague({ seed: 'coach-card' });
    playWeek(l);
    // A coach with a path: a coordinator elsewhere last season, head coach here now.
    const now = teamCoaches(l, l.userTeamId).find((c) => c.role === 'headCoach')!;
    const before = {
      season: l.season - 1,
      teamId: (l.userTeamId + 1) % 32,
      role: 'offCoord' as const,
      record: { regular: { w: 10, l: 7, t: 0 } },
    } as unknown as NonNullable<typeof now.career>[number];
    const hc = { ...now, career: [before, ...(now.career ?? [])] };
    const html = renderToStaticMarkup(
      <NavContext.Provider value={nav}>
        <CoachCard league={l} coach={hc} onClose={() => {}} />
      </NavContext.Provider>,
    );
    expect(html).toMatch(/aria-selected="true"[^>]*>Bio</);
    expect(html).toMatch(/role="tab"[^>]*>Career</);
    expect(html).not.toMatch(/role="tab"[^>]*>Record</);
    expect(html).toContain('<span class="eyebrow">Overview</span>');
    // Bio has this season alone under the overview, with no job (his title is in the header).
    expect(html.match(/class="season-row"/g)?.length).toBe(1);
    expect(html.indexOf('season-row')).toBeGreaterThan(html.indexOf('Overview'));
    expect(html).not.toContain('season-job');
    expect(html).not.toContain('Around the league</span>');
    expect(html).not.toContain('Habits over time');
    const career = renderToStaticMarkup(
      <NavContext.Provider value={nav}>
        <CoachCard league={l} coach={hc} onClose={() => {}} startTab="career" />
      </NavContext.Provider>,
    );
    // The chair's job description is the engine's, not something a reader needs on his card.
    expect(career).not.toContain('Has a hand in');
    // Career has his whole path, a season a row with the job he held.
    expect(career.match(/class="season-row"/g)?.length).toBe(2);
    expect(career).toContain('Offensive coordinator');
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
