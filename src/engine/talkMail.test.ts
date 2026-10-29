import { describe, expect, it } from 'vitest';
import { RESERVED_NICKNAMES } from './data/teams';
import { createLeague } from './generate';
import { deliverMail, mailSubject, needsYou } from './inbox';
import { answerTalk } from './playerTalks';
import { TALK_ANSWER, TALK_LETTER } from './playerVoice';
import { activeRoster } from './roster';
import { talkCard } from './talkMail';
import type { League, Player, TalkCause } from './types';
import { say } from './voice';

const BANNED = /marble|\btraits?\b|z-score|super bowl|\bAFC\b|\bNFC\b/i;

function asking(l: League, teamId: number, cause: TalkCause = 'snaps', index = 0): Player {
  const p = activeRoster(l, teamId)[index];
  p.morale = { level: -4, talk: { club: teamId, ask: { cause, at: l.moraleAt! } } };
  return p;
}
const letters = (l: League) => (l.inbox ?? []).filter((m) => m.id.startsWith('talk:'));

describe('your players’ letters', () => {
  it('files one letter per ask on your roster, and none for another club’s', () => {
    const l = createLeague({ seed: 'talk-mail' });
    const p = asking(l, l.userTeamId);
    asking(l, (l.userTeamId + 1) % 32);
    deliverMail(l);
    deliverMail(l);
    const mine = letters(l);
    expect(mine).toHaveLength(1);
    expect(mine[0].id).toBe(`talk:${l.season}:${l.moraleAt}:${p.id}`);
    expect(mine[0].from).toContain(p.lastName);
    expect(mailSubject(mine[0])).toEqual({ kind: 'talk', season: l.season, clock: l.moraleAt, playerId: p.id });
  });

  it('needs you until you answer', () => {
    const l = createLeague({ seed: 'talk-mail' });
    const p = asking(l, l.userTeamId, 'deal');
    deliverMail(l);
    const [m] = letters(l);
    expect(needsYou(l, m)).toBe(true);
    expect(talkCard(l, mailSubject(m) as never)).toMatchObject({ state: 'open', canPromise: true, cause: 'deal' });
    answerTalk(l, p.id, 'reassure');
    expect(needsYou(l, m)).toBe(false);
    const card = talkCard(l, mailSubject(m) as never);
    expect(card.state).toBe('answered');
    expect(card.line!.length).toBeGreaterThan(10);
  });

  it('offers no promise for the losing', () => {
    const l = createLeague({ seed: 'talk-mail' });
    asking(l, l.userTeamId, 'losing');
    deliverMail(l);
    expect(talkCard(l, mailSubject(letters(l)[0]) as never).canPromise).toBe(false);
  });

  it('stops needing a GM who left the club, and files nothing for his new club’s old talks', () => {
    const l = createLeague({ seed: 'talk-mail' });
    asking(l, l.userTeamId);
    deliverMail(l);
    const [m] = letters(l);
    const next = (l.userTeamId + 5) % 32;
    const theirs = activeRoster(l, next)[0];
    theirs.morale = {
      level: -4,
      talk: { club: next, answered: { reply: 'firm', at: l.moraleAt!, ask: l.moraleAt! } },
    };
    l.userTeamId = next;
    expect(needsYou(l, m)).toBe(false);
    deliverMail(l);
    expect(letters(l).filter((x) => x.id.endsWith(`:${theirs.id}`))).toHaveLength(0);
  });

  it('says nothing it must not, in any cause or answer', () => {
    const out: string[] = [];
    for (const cause of ['snaps', 'deal', 'losing', 'feud'] as const)
      for (const loud of [false, true])
        for (const calm of [false, true]) {
          out.push(
            say(TALK_LETTER, { name: 'Davis', cause, loud, calm }, { key: `k${cause}${loud}${calm}`, slot: 'l' }),
          );
          for (const reply of ['promise', 'reassure', 'firm', 'ignored'] as const)
            out.push(say(TALK_ANSWER, { cause, reply, loud, calm }, { key: `k${cause}${reply}`, slot: 'a' }));
        }
    for (const s of out) {
      expect(s.length).toBeGreaterThan(10);
      expect(s).not.toMatch(BANNED);
      expect(s).not.toMatch(/\d/);
      for (const nick of RESERVED_NICKNAMES) expect(s).not.toMatch(new RegExp(`\\b${nick}\\b`, 'i'));
    }
  });
});
