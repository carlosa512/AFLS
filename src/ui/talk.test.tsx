import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactElement } from 'react';
import { createLeague } from '../engine/generate';
import { deliverMail } from '../engine/inbox';
import { answerTalk } from '../engine/playerTalks';
import { activeRoster } from '../engine/roster';
import type { TalkCause } from '../engine/types';
import { MailCards, MailSections } from './mail';
import { NavContext, type Nav } from './nav';

const nav = { openPlayer: () => {}, openTeam: () => {}, go: () => {}, openStaff: () => {} } as unknown as Nav;
const render = (el: ReactElement) => renderToStaticMarkup(<NavContext.Provider value={nav}>{el}</NavContext.Provider>);

function letter(cause: TalkCause) {
  const l = createLeague({ seed: 'talk-ui' });
  const p = activeRoster(l, l.userTeamId)[0];
  p.morale = { level: -4, talk: { club: l.userTeamId, ask: { cause, at: l.moraleAt! } } };
  deliverMail(l);
  return { l, p, m: l.inbox!.find((x) => x.id.startsWith('talk:'))! };
}

describe('two players the same step', () => {
  it('reads as one message, each with his own answers', () => {
    const l = createLeague({ seed: 'talk-ui' });
    const [a, b] = activeRoster(l, l.userTeamId);
    a.morale = { level: -4, talk: { club: l.userTeamId, ask: { cause: 'deal', at: l.moraleAt! } } };
    b.morale = { level: -4, talk: { club: l.userTeamId, ask: { cause: 'losing', at: l.moraleAt! } } };
    deliverMail(l);
    const m = l.inbox!.find((x) => x.id.startsWith('talk:'))!;
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
    const html = render(<MailCards league={l} message={m} />);
    expect(html).toContain('Promise more snaps');
    expect(html).toContain('Reassure him');
    expect(html).toContain('Be firm');
    expect(render(<MailCards league={letter('deal').l} message={letter('deal').m} />)).toContain('Promise a new deal');
    const losing = letter('losing');
    expect(render(<MailCards league={losing.l} message={losing.m} />)).not.toContain('Promise');
  });

  it('shows what you said once answered, with no buttons', () => {
    const { l, p, m } = letter('snaps');
    answerTalk(l, p.id, 'promise');
    const html = render(<MailCards league={l} message={m} />);
    expect(html).not.toContain('Reassure him');
    expect(html).toContain('You promised him more snaps');
  });
});
