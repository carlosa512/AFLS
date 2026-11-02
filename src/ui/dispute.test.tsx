import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactElement } from 'react';
import { answerDispute } from '../engine/disputes';
import { createLeague } from '../engine/generate';
import { deliverMail } from '../engine/inbox';
import { activeRoster } from '../engine/roster';
import { MailCards, answerDisputeLetter } from './mail';
import { NavContext, type Nav } from './nav';
import { LockerRoom } from './screens/LockerRoom';
import { PlayerCard } from './screens/PlayerCard';
import { Roster } from './screens/Roster';

const nav = {
  openPlayer: () => {},
  openTeam: () => {},
  go: () => {},
  openStaff: () => {},
  compareIds: [],
} as unknown as Nav;
const render = (el: ReactElement) => renderToStaticMarkup(<NavContext.Provider value={nav}>{el}</NavContext.Provider>);

/** One of your men holding out, his letter filed. */
function holdout() {
  const l = createLeague({ seed: 'dispute-ui' });
  const p = activeRoster(l, l.userTeamId).find((x) => x.morale && x.contract?.kind === 'veteran')!;
  p.morale = {
    level: -5,
    jolts: [],
    dispute: { kind: 'holdOut', cause: 'deal', since: l.moraleAt!, club: l.userTeamId },
  };
  deliverMail(l);
  return { l, p, m: l.inbox!.find((x) => x.id.startsWith('dispute:'))! };
}

describe('a dispute’s letter (G4)', () => {
  it('offers talks, a promise, a firm line and shopping him', () => {
    const { l, m } = holdout();
    const html = render(<MailCards league={l} message={m} />);
    for (const b of ['Negotiate', 'Promise a deal', 'Hold firm', 'Shop him']) expect(html).toContain(b);
  });

  it('reads “He won’t take your word” past four broken promises', () => {
    const { l, p, m } = holdout();
    p.morale!.talk = { club: l.userTeamId, broken: 4 };
    const html = render(<MailCards league={l} message={m} />);
    expect(html).toContain('He won’t take your word');
    expect(html).not.toContain('Promise a deal');
  });

  it('shows what you said once answered, with no buttons', () => {
    const { l, p, m } = holdout();
    answerDispute(l, p.id, 'firm');
    const html = render(<MailCards league={l} message={m} />);
    expect(html).toContain('You held firm');
    expect(html).not.toContain('Shop him');
  });

  it('puts him on your trade block when you shop him, and only then', () => {
    const shop = holdout();
    answerDisputeLetter(shop.l, shop.p.id, 'shop');
    expect(shop.l.market?.status[shop.p.id]).toBe('listed');
    const firm = holdout();
    answerDisputeLetter(firm.l, firm.p.id, 'firm');
    expect(firm.l.market?.status[firm.p.id]).toBeUndefined();
  });
});

describe('disputes on the screens (G4)', () => {
  /** One of your men holding out, and another club's. */
  function both() {
    const { l, p } = holdout();
    p.morale!.dispute!.out = true;
    const theirs = activeRoster(l, (l.userTeamId + 1) % 32).find((x) => x.morale)!;
    theirs.morale!.dispute = { kind: 'holdOut', cause: 'deal', since: l.moraleAt!, club: theirs.teamId!, out: true };
    return { l, p, theirs };
  }

  it('lists your disputes in the Locker Room', () => {
    const { l, p } = both();
    const html = render(<LockerRoom league={l} />);
    expect(html).toContain('Disputes');
    expect(html).toContain(p.lastName);
    expect(html).toContain('Holding out');
  });

  it('counts a holdout as not reported on the Roster, and tags him', () => {
    const { l } = both();
    const html = render(<Roster league={l} teamId={l.userTeamId} />);
    expect(html).toContain('did not report');
    expect(html).toContain('Holding out');
  });

  it("shows Holding out on any club's player card", () => {
    const { l, theirs } = both();
    expect(render(<PlayerCard league={l} player={theirs} onClose={() => {}} />)).toContain('Holding out');
  });
});
