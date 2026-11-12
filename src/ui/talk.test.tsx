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
    expect(html.match(/Reassure him/g)).toHaveLength(1);
    // The losing has its own three answers.
    for (const words of [
      'We&#x27;ll turn this around',
      'I need you to lead the room',
      'That&#x27;s on the coach and you',
    ])
      expect(html).toContain(words);
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
    expect(show(losing.l, losing.m)).not.toContain('Reassure him');
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

describe('the losing across letters', () => {
  it('shows buttons only on the newest letter that holds the losing row', () => {
    const { l, m: first } = letter('losing');
    // The coach writes every other step: the second letter is the step after next.
    l.moraleAt = l.moraleAt! + 2;
    const b = activeRoster(l, l.userTeamId)[1];
    b.morale = { level: -4, talk: { club: l.userTeamId, ask: { cause: 'losing', at: l.moraleAt! } } };
    deliverMail(l);
    const second = l.inbox!.filter((x) => x.id.startsWith('coach:')).find((x) => x.id !== first.id)!;
    const old = render(<MailSections league={l} sections={first.sections!} letterId={first.id} />);
    const fresh = render(<MailSections league={l} sections={second.sections!} letterId={second.id} />);
    expect(old).not.toContain('I need you to lead the room');
    expect(fresh).toContain('I need you to lead the room');
  });
});

describe('a slumping leader’s letter', () => {
  it('offers two answers, his quarterback or his man, and no promise', () => {
    const { l, p, m } = letter('form');
    const html = show(l, m);
    expect(html).toContain(p.lastName);
    expect(html).toMatch(/about where he stands\./);
    expect(html).toContain(p.position === 'QB' ? 'He&#x27;s my quarterback' : 'He&#x27;s my starter');
    expect(html).toContain('Play your way out of it');
    expect(html).not.toContain('Promise');
    expect(html).not.toContain('Reassure him');
    // Answered, the row says what you told him.
    answerTalk(l, p.id, 'firm');
    expect(show(l, m)).toContain('play his way out of it');
    const again = letter('form');
    answerTalk(again.l, again.p.id, 'reassure');
    expect(show(again.l, again.m)).toMatch(/he&#x27;s your (man|quarterback)/);
  });
});

describe('the head coach’s letter, written as a letter', () => {
  it('leads into a man’s words in the coach’s own, with his answers on one line under them', () => {
    const { l, p, m } = letter('snaps');
    const html = show(l, m);
    expect(html).toContain('class="coach-letter"');
    expect(html).toMatch(/(came to see me|asked to see me|stopped by my office) about his snaps\./);
    expect(html).toContain(`Your answer to ${p.lastName}`);
    // No boxed card titled "Your answer" for each man.
    expect(html).not.toContain('<h4>Your answer</h4>');
    expect(html).toContain('Promise more snaps');
  });

  it('still draws a letter filed before this the way it was filed', () => {
    const { l, m } = letter('snaps');
    const old = { ...m, sections: m.sections!.map((s) => ({ ...s, layout: 'people' as const })) };
    const html = show(l, old);
    expect(html).not.toContain('class="coach-letter"');
    expect(html).toContain('<h4>Your answer</h4>');
  });

  it('is signed by the coach', () => {
    const { l, m } = letter('snaps');
    const html = render(<MailSections league={l} sections={m.sections!} letterId={m.id} signed="James" />);
    expect(html).toMatch(/class="coach-letter-sign"[^>]*>James</);
  });
});
