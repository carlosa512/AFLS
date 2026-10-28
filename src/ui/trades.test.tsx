import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createLeague } from '../engine/generate';
import { practiceSquad } from '../engine/roster';
import { AssetList } from './screens/Trades';
import { TabBoundary } from './boundary';

describe('trade table', () => {
  // Practice squad players are on a team with no contract (a weekly agreement instead): the asset
  // list read their contract and blanked the whole app.
  it("lists a team's practice squad players as untradable", () => {
    const l = createLeague({ seed: 'trades-squad', personnel: true });
    expect(practiceSquad(l, l.userTeamId).length).toBeGreaterThan(0);
    const html = renderToStaticMarkup(
      <AssetList league={l} teamId={l.userTeamId} picked={{ players: [], picks: [] }} onChange={() => {}} />,
    );
    expect(html).toContain('Practice squad players cannot be traded.');
  });
});

describe('front office tab boundary', () => {
  it('turns a render error into a message naming the tab', () => {
    const error = new TypeError("Cannot read properties of null (reading 'years')");
    const boundary = new TabBoundary({ name: 'Trades', children: null });
    boundary.state = TabBoundary.getDerivedStateFromError(error);
    const html = renderToStaticMarkup(<>{boundary.render()}</>);
    expect(html).toContain('Trades couldn&#x27;t open');
    expect(html).toContain('reading &#x27;years&#x27;');
    expect(html).toContain('Try again');
  });
  it('draws the tab when nothing broke', () => {
    const html = renderToStaticMarkup(
      <TabBoundary name="Trades">
        <p>the table</p>
      </TabBoundary>,
    );
    expect(html).toBe('<p>the table</p>');
  });
});
