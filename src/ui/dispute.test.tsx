import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactElement } from 'react';
import { answerDispute } from '../engine/disputes';
import { createLeague } from '../engine/generate';
import { deliverMail } from '../engine/inbox';
import { activeRoster } from '../engine/roster';
import { MailCards } from './mail';
import { NavContext, type Nav } from './nav';

const nav = { openPlayer: () => {}, openTeam: () => {}, go: () => {}, openStaff: () => {} } as unknown as Nav;
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
});
