import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactElement } from 'react';
import { createLeague } from '../engine/generate';
import { deliverMail } from '../engine/inbox';
import { answerTalk } from '../engine/playerTalks';
import { activeRoster } from '../engine/roster';
import type { InboxMessage, League, TalkCause } from '../engine/types';
import { MailCards, MailSections } from './mail';
import { NavContext, type Nav } from './nav';

const nav = { openPlayer: () => {}, openTeam: () => {}, go: () => {}, openStaff: () => {} } as unknown as Nav;
const render = (el: ReactElement) => renderToStaticMarkup(<NavContext.Provider value={nav}>{el}</NavContext.Provider>);
/** The weekly letter as the reader sees it: its cards, then its rows with their answers. */
const show = (l: League, m: InboxMessage) =>
  render(
    <>
      <MailCards league={l} message={m} />
      <MailSections league={l} sections={m.sections ?? []} />
    </>,
  );

function letter(cause: TalkCause) {
  const l = createLeague({ seed: 'talk-ui' });
  const p = activeRoster(l, l.userTeamId)[0];
  p.morale = { level: -4, talk: { club: l.userTeamId, ask: { cause, at: l.moraleAt! } } };
  deliverMail(l);
  return { l, p, m: l.inbox!.find((x) => x.id.startsWith('coach:'))! };
}

describe('two players the same step', () => {
  it('reads as one message, each with his own answers', () => {
    const l = createLeague({ seed: 'talk-ui' });
    const [a, b] = activeRoster(l, l.userTeamId);
    a.morale = { level: -4, talk: { club: l.userTeamId, ask: { cause: 'deal', at: l.moraleAt! } } };
    b.morale = { level: -4, talk: { club: l.userTeamId, ask: { cause: 'losing', at: l.moraleAt! } } };
    deliverMail(l);
    const m = l.inbox!.find((x) => x.id.startsWith('coach:'))!;
    const html = render(<MailSections league={l} sections={m.sections!} />);
    expect(html.match(/Reassure him/g)).toHaveLength(2);
    expect(html.match(/Promise a new deal/g)).toHaveLength(1);
    expect(html).toContain(a.lastName);
    expect(html).toContain(b.lastName);
  });
});

describe('a player’s letter', () => {
  it('offers the promise he asked for, reassurance and a firm line', () => {
    const { l, m } = letter('snaps');
    const html = show(l, m);
    expect(html).toContain('Promise more snaps');
    expect(html).toContain('Reassure him');
    expect(html).toContain('Be firm');
    const deal = letter('deal');
    expect(show(deal.l, deal.m)).toContain('Promise a new deal');
    const losing = letter('losing');
    expect(show(losing.l, losing.m)).not.toContain('Promise');
  });

  it('shows what you said once answered, with no buttons', () => {
    const { l, p, m } = letter('snaps');
    answerTalk(l, p.id, 'promise');
    const html = show(l, m);
    expect(html).not.toContain('Reassure him');
    expect(html).toContain('You promised him more snaps');
  });
});

describe('a contract letter: talks right from it', () => {
  /** His deal set to `left` years from this season, a veteran's, so the extension rule decides. */
  const deal = (l: ReturnType<typeof createLeague>, p: ReturnType<typeof activeRoster>[number], left: number) => {
    const c = p.contract!;
    c.kind = 'veteran';
    c.years = Array.from({ length: left }, (_, i) => ({ ...c.years[0], season: l.season + i }));
  };

  it('puts the yellow Negotiate button by his answers when his deal is open to talks', () => {
    const { l, p, m } = letter('deal');
    deal(l, p, 1);
    const html = show(l, m);
    expect(html).toContain('Promise a new deal');
    expect(html).toMatch(/btn-primary[^>]*>Negotiate/);
  });

  it('leaves it off when his deal is not open to talks, or the letter is about something else', () => {
    const a = letter('deal');
    deal(a.l, a.p, 4);
    expect(show(a.l, a.m)).not.toContain('>Negotiate<');
    const b = letter('losing');
    deal(b.l, b.p, 1);
    expect(show(b.l, b.m)).not.toContain('>Negotiate<');
  });
});
