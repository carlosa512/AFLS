import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createLeague } from '../engine/generate';
import { practiceSquad } from '../engine/roster';
import { deskState, type Advice } from '../engine/trade';
import { emptyMarket } from '../engine/trade/execute';
import { teamPlayers } from '../engine/roster';
import type { TradeOffer } from '../engine/types';
import { BlockPanel, MarketPanel, OfferCard, StaffStrip, talksWords, WantsPills } from './offers';
import { ASKS, tradeContext, updateStances } from '../engine/trade';
import { AssetList, DealSlip, TradeDesk } from './screens/Trades';
import { pickLabel } from '../engine/trade';
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

describe('the trade partner card', () => {
  const l = createLeague({ seed: 'partner-card' });
  const rival = l.teams.find((t) => t.id !== l.userTeamId)!;
  it("shows what a rival wants on your scouts' read, and says when they barely know him", () => {
    const html = renderToStaticMarkup(<WantsPills league={l} team={rival} />);
    expect(html).toMatch(/tag-pill|No pressing needs/);
    expect(html).not.toContain('barely know');
    const ctx = tradeContext(l);
    const view = ctx.view;
    ctx.view = (teamId, p) => (p.teamId === rival.id ? { ...view(teamId, p), knowledge: 0.2 } : view(teamId, p));
    expect(renderToStaticMarkup(<WantsPills league={l} team={rival} ctx={ctx} />)).toContain(
      'our scouts barely know them',
    );
  });
  it('says in words whether he is still taking proposals', () => {
    l.market = emptyMarket();
    expect(talksWords(l, rival.id)).toBe('Taking proposals');
    l.market.talks[rival.id] = { moment: 0, asks: ASKS - 1, trust: 0, cooldowns: {} };
    expect(talksWords(l, rival.id)).toBe('Nearly done talking this week');
    l.market.talks[rival.id].asks = ASKS;
    expect(talksWords(l, rival.id)).toBe("We're done talking this week.");
  });
});

describe('your block', () => {
  it('opens with cards for players you listed or locked, never a practice squad player', () => {
    const l = createLeague({ seed: 'block-cards', personnel: true });
    l.market = emptyMarket();
    expect(renderToStaticMarkup(<BlockPanel league={l} />)).not.toContain('office-card');
    const listed = teamPlayers(l, l.userTeamId).find((p) => p.contract)!;
    const [squad] = practiceSquad(l, l.userTeamId);
    l.market.status = { [listed.id]: 'listed', [squad.id]: 'listed' };
    let html = renderToStaticMarkup(<BlockPanel league={l} />);
    const card = html.slice(html.indexOf('card-row'), html.indexOf('Sort your block'));
    expect(card).toContain(listed.lastName);
    expect(html.match(/office-card/g)).toHaveLength(1);
    expect(html).not.toContain('team asking');
    const rival = l.teams.find((t) => t.id !== l.userTeamId)!;
    l.market.offers.push({
      id: 1,
      teamId: rival.id,
      sides: [
        { teamId: rival.id, players: [], picks: [] },
        { teamId: l.userTeamId, players: [listed.id], picks: [] },
      ],
      kind: 'buy',
      reason: 'bid',
      season: l.season,
      phase: l.phase,
      week: l.week,
      moment: 0,
      status: 'declined',
      patience: 2,
      worth: 100,
    });
    html = renderToStaticMarkup(<BlockPanel league={l} />);
    expect(html).toContain('1 team asking');
  });
});

describe('the market', () => {
  it('is every other front office as a card, grouped by who is buying and selling', () => {
    const l = createLeague({ seed: 'market-cards' });
    updateStances(tradeContext(l));
    l.market = emptyMarket();
    const html = renderToStaticMarkup(<MarketPanel league={l} />);
    expect(html.match(/class="office-card/g)).toHaveLength(l.teams.length - 1);
    expect(html).toMatch(/Buying|Listening|Selling/);
    expect(html).toContain('Quiet so far.');
    expect(html).not.toContain("Who's dealing");
  });
  it('draws before the market exists', () => {
    const l = createLeague({ seed: 'market-new' });
    delete l.market;
    expect(renderToStaticMarkup(<MarketPanel league={l} />)).toContain('Quiet so far.');
  });
});

describe('the deal slip', () => {
  it('lists each player and pick with a remove button, and says how to add when empty', () => {
    const l = createLeague({ seed: 'deal-slip' });
    const p = teamPlayers(l, l.userTeamId).find((x) => x.contract)!;
    const pick = l.draftPicks.find((x) => x.ownerId === l.userTeamId && x.playerId === undefined)!;
    const html = renderToStaticMarkup(
      <DealSlip
        league={l}
        teamId={l.userTeamId}
        label="You send"
        picked={{ players: [p.id], picks: [pick.id] }}
        onChange={() => {}}
      />,
    );
    expect(html).toContain(p.lastName);
    expect(html).toContain(pickLabel(l, pick));
    expect(html).toContain(`aria-label="Remove ${p.firstName} ${p.lastName}"`);
    expect(html).toContain(`aria-label="Remove ${pickLabel(l, pick)}"`);
    expect(
      renderToStaticMarkup(
        <DealSlip
          league={l}
          teamId={l.userTeamId}
          label="You send"
          picked={{ players: [], picks: [] }}
          onChange={() => {}}
        />,
      ),
    ).toContain('Add from the picker below.');
  });
});
