import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createLeague } from '../engine/generate';
import { practiceSquad } from '../engine/roster';
import { deskState, type Advice } from '../engine/trade';
import { emptyMarket } from '../engine/trade/execute';
import { teamPlayers } from '../engine/roster';
import type { TradeOffer } from '../engine/types';
import { OfferCard, StaffStrip } from './offers';
import { AssetList, TradeDesk } from './screens/Trades';
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

describe('trade desk hero', () => {
  it('says what needs you and the facts behind it', () => {
    const l = createLeague({ seed: 'desk-hero', personnel: true });
    const html = renderToStaticMarkup(<TradeDesk league={l} />);
    expect(html).toContain('office-hero');
    expect(html).toContain(deskState(l).text);
    for (const label of [
      'Deadline',
      'Offers waiting',
      'On your block',
      'Untouchable',
      'Teams asking about your players',
    ])
      expect(html).toContain(label);
    expect(html).toContain('Build a trade');
  });
});

describe('offer cards', () => {
  const l = createLeague({ seed: 'offer-cards' });
  it('the staff strip leads with the take and tones each voice', () => {
    const advice: Advice[] = [
      { who: 'coach', line: 'X would start for us at CB.', tone: 'good' },
      { who: 'cap', line: 'Cap room after: -$1.0M.', tone: 'bad' },
    ];
    const html = renderToStaticMarkup(<StaffStrip league={l} advice={advice} />);
    expect(html.indexOf('Staff against')).toBeLessThan(html.indexOf('Head coach'));
    expect(html).toContain('tag-pill tag-good">Head coach');
    expect(html).toContain('tag-pill tag-bad">Cap');
    expect(renderToStaticMarkup(<StaffStrip league={l} advice={[]} />)).toBe('');
  });
  it("a bid shows its kind and your staff's take, and reading it changes nothing", () => {
    l.market = emptyMarket();
    const rival = l.teams.find((t) => t.id !== l.userTeamId)!;
    const mine = teamPlayers(l, l.userTeamId).find((p) => p.contract)!;
    const theirs = teamPlayers(l, rival.id).find((p) => p.contract)!;
    const offer: TradeOffer = {
      id: 1,
      teamId: rival.id,
      sides: [
        { teamId: rival.id, players: [theirs.id], picks: [] },
        { teamId: l.userTeamId, players: [mine.id], picks: [] },
      ],
      kind: 'swap',
      reason: 'bid',
      season: l.season,
      phase: l.phase,
      week: l.week,
      moment: 0,
      status: 'pending',
      patience: 2,
      worth: 100,
    };
    l.market.offers.push(offer);
    const before = JSON.stringify(l);
    const html = renderToStaticMarkup(<OfferCard league={l} offer={offer} />);
    expect(JSON.stringify(l)).toBe(before);
    expect(html).toContain('offer-card');
    expect(html).toContain('>Bid<');
    expect(html).toMatch(/Staff likes it|Split|Staff against/);
  });
});
