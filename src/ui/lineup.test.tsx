import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { confirmLineup } from '../engine/benching';
import { createLeague } from '../engine/generate';
import { offseasonStep } from './App';
import { NavContext, type Nav } from './nav';
import { Roster } from './screens/Roster';

const nav = {
  openPlayer: () => {},
  openTeam: () => {},
  go: () => {},
  openStaff: () => {},
  compareIds: [],
} as unknown as Nav;
const roster = (l: ReturnType<typeof camp>) =>
  renderToStaticMarkup(
    <NavContext.Provider value={nav}>
      <Roster league={l} teamId={l.userTeamId} />
    </NavContext.Provider>,
  );

/** A club on the last step of camp, the chart in your hands. */
function camp(autoDepth: boolean) {
  const l = createLeague({ seed: 'lineup-ui' });
  l.phase = 'preseason';
  l.teams[l.userTeamId].autoDepth = autoDepth;
  return l;
}

describe('setting your lineup', () => {
  it('the advance button reads "Set your lineup" only with the chart yours and the season unconfirmed', () => {
    const auto = camp(true);
    expect(offseasonStep(auto)!.label).toBe(`Start the ${auto.season} season`);
    const l = camp(false);
    const step = offseasonStep(l)!;
    expect(step.label).toBe('Set your lineup');
    expect(step.then).toEqual({ view: 'roster' });
    step.run(l);
    expect(l.phase).toBe('preseason');
    confirmLineup(l);
    expect(offseasonStep(l)!.label).toBe(`Start the ${l.season} season`);
  });

  it('with practice squads on, the lineup comes after the 53 are submitted, ahead of the claims step', () => {
    const l = createLeague({ seed: 'lineup-personnel', personnel: true });
    l.phase = 'preseason';
    l.teams[l.userTeamId].autoDepth = false;
    l.personnel!.clock = { season: l.season, cutdown: false };
    expect(offseasonStep(l)!.label).toBe('Submit the 53 and open cutdown claims');
    l.personnel!.clock = { season: l.season, cutdown: true };
    const step = offseasonStep(l)!;
    expect(step.label).toBe('Set your lineup');
    expect(step.then).toEqual({ view: 'roster' });
    confirmLineup(l);
    expect(offseasonStep(l)!.label).not.toBe('Set your lineup');
  });

  it('the depth chart carries the banner and the Confirm button until you confirm', () => {
    const l = camp(false);
    const html = roster(l);
    expect(html).toContain('Week 1 lineup');
    expect(html).toContain('Confirm');
    expect(html).not.toContain('holding their jobs');
    confirmLineup(l);
    expect(roster(l)).not.toContain('Week 1 lineup');
  });
});
