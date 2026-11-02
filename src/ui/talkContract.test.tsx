import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createLeague } from '../engine/generate';
import { contractTalkBlocker, talksOpen } from '../engine/offseason/negotiation';
import { activeRoster } from '../engine/roster';
import type { League, Player } from '../engine/types';
import { TalkContractButton } from './negotiation';
import { NavContext, type Nav } from './nav';
import { PlayerCard } from './screens/PlayerCard';
import { LockerRoom } from './screens/LockerRoom';
import { moraleView, viewContext } from '../engine/morale';
import { roomReasons, roomView } from '../engine/standing';

const nav = {
  openPlayer: () => {},
  openTeam: () => {},
  go: () => {},
  openStaff: () => {},
  compareIds: [],
} as unknown as Nav;

const base = createLeague({ seed: 'talk-contract' });
const fresh = () => structuredClone(base);
/** One of your players with `left` years on his deal (a veteran deal, so the rookie rule stays out of it). */
const withYears = (l: League, left: number): Player => {
  const p = activeRoster(l, l.userTeamId).find((x) => x.contract && x.contract.kind !== 'rookie')!;
  const c = p.contract!;
  c.years = Array.from({ length: left }, (_, i) => ({ ...c.years[0], season: l.season + i }));
  return p;
};

describe('talking contract from anywhere', () => {
  it('opens in the last two years of a deal, on your own club', () => {
    const l = fresh();
    l.phase = 'regular';
    expect(talksOpen(l, withYears(l, 2))).toBe(true);
    const l2 = fresh();
    l2.phase = 'regular';
    expect(talksOpen(l2, withYears(l2, 4))).toBe(false);
    const other = activeRoster(l, (l.userTeamId + 1) % l.teams.length)[0];
    expect(talksOpen(l, other)).toBe(false);
  });

  it('is closed during the playoffs, with the reason', () => {
    const l = fresh();
    l.phase = 'playoffs';
    const p = withYears(l, 1);
    expect(talksOpen(l, p)).toBe(true);
    expect(contractTalkBlocker(l, p)).toMatch(/league year/);
  });

  it('shows the yellow Negotiate button only when he is eligible', () => {
    const l = fresh();
    l.phase = 'regular';
    const html = renderToStaticMarkup(<TalkContractButton league={l} player={withYears(l, 1)} />);
    expect(html).toContain('btn-primary');
    expect(html).toContain('Negotiate');
    const l2 = fresh();
    l2.phase = 'regular';
    expect(renderToStaticMarkup(<TalkContractButton league={l2} player={withYears(l2, 4)} />)).toBe('');
  });

  it("puts the button in the player card's contract section", () => {
    const l = fresh();
    l.phase = 'regular';
    const p = withYears(l, 1);
    const html = renderToStaticMarkup(
      <NavContext.Provider value={nav}>
        <PlayerCard league={l} player={p} onClose={() => {}} />
      </NavContext.Provider>,
    );
    const contract = html.slice(html.indexOf('<h3>Contract</h3>'));
    expect(contract).toContain('Negotiate');
  });
});

describe('the Locker Room: who wants a new deal', () => {
  /** A receiver of yours paid far under his market: he wants a new deal. */
  const underpaid = (l: League, left: number) => {
    const p = activeRoster(l, l.userTeamId).find(
      (x) => x.position === 'WR' && x.contract && x.contract.kind !== 'rookie' && x.experience >= 4,
    )!;
    const c = p.contract!;
    c.apy = 300;
    c.years = Array.from({ length: left }, (_, i) => ({
      ...c.years[0],
      season: l.season + i,
      base: 300,
    }));
    p.personality.greed = 1;
    p.morale = { level: -4 };
    return p;
  };
  const html = (l: League) =>
    renderToStaticMarkup(
      <NavContext.Provider value={nav}>
        <LockerRoom league={l} />
      </NavContext.Provider>,
    );

  it('offers talks to an eligible man who wants a new deal, right on his room', () => {
    const l = fresh();
    l.phase = 'regular';
    const p = underpaid(l, 1);
    expect(moraleView(l, p)!.reasons).toContain('Wants a new deal');
    const room = roomView(l).units.find((u) => u.unit === 'WR')!;
    expect(room.reasons.some((r) => r.text === 'Wants a new deal')).toBe(true);
    const out = html(l);
    const card = out.slice(out.indexOf('Receivers &amp; tight ends'));
    expect(card.slice(0, card.indexOf('room-card"') > 0 ? card.indexOf('room-card"') : undefined)).toContain(
      'Negotiate',
    );
  });

  it("doesn't count a man whose deal can't be extended yet", () => {
    const l = fresh();
    l.phase = 'regular';
    for (const x of activeRoster(l, l.userTeamId).filter((y) => y.position === 'WR' || y.position === 'TE'))
      if (x.contract)
        x.contract.years = Array.from({ length: 4 }, (_, i) => ({
          ...x.contract!.years[0],
          season: l.season + i,
        }));
    underpaid(l, 4);
    const room = roomView(l).units.find((u) => u.unit === 'WR')!;
    expect(room.reasons.some((r) => r.text === 'Wants a new deal')).toBe(false);
  });

  it("doesn't count a man who wants more money but isn't upset", () => {
    const l = fresh();
    l.phase = 'regular';
    const p = underpaid(l, 1);
    p.morale = { level: 0 };
    expect(moraleView(l, p)!.reasons).toContain('Wants a new deal');
    const out = html(l);
    const card = out.slice(out.indexOf('Receivers &amp; tight ends'));
    expect(card.slice(0, card.indexOf('Mentoring'))).not.toContain(p.lastName + '</a></span><button');
    expect(roomReasons(l, p, viewContext(l))).not.toContain('Wants a new deal');
  });

  it('folds each room’s mentoring away until you open it', () => {
    const l = fresh();
    const out = html(l);
    expect(out).toMatch(/<details class="room-fold"><summary>Mentoring/);
  });
});
