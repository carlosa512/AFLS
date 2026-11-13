import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { createLeague } from '../engine/generate';
import { playWeek } from '../engine/league';
import type { League } from '../engine/types';
import { NavContext, type Nav } from './nav';
import { Stats } from './screens/Stats';

const nav = {
  openPlayer: () => {},
  openTeam: () => {},
  go: () => {},
  openStaff: () => {},
  compareIds: [],
} as unknown as Nav;
const render = (l: League, tab: 'leaders' | 'awards' | 'records') =>
  renderToStaticMarkup(
    <NavContext.Provider value={nav}>
      <Stats league={l} tab={tab} />
    </NavContext.Provider>,
  );

describe('the top of the Stats screen', () => {
  it('says what is missing before anything is played, with no empty picker', () => {
    const l = createLeague({ seed: 'stats-head' });
    const leaders = render(l, 'leaders');
    expect(leaders).toContain('Stats appear once the first week is played.');
    expect(leaders).not.toContain('<select');
    const awards = render(l, 'awards');
    expect(awards).toContain('Stats appear once the first week is played.');
    expect(awards).not.toContain('aria-label="Awards season"');
  });

  it('puts the season picker in the bar and drops the heading that repeats it', () => {
    const l = createLeague({ seed: 'stats-head' });
    playWeek(l);
    const html = render(l, 'leaders');
    expect(html).toMatch(/class="page-bar-aside"><select/);
    expect(html).not.toContain('league leaders');
    expect(render(l, 'records')).not.toContain('Single-season records');
  });

  it("keeps a leader's team on its own line under his name", () => {
    const l = createLeague({ seed: 'stats-head' });
    playWeek(l);
    const html = render(l, 'leaders');
    expect(html).toMatch(/class="player-sub">[A-Z]{2,3}</);
    expect(html).not.toMatch(/<small class="muted"> [A-Z]{2,3}<\/small>/);
  });
});
