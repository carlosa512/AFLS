import { describe, expect, it } from 'vitest';
import { RESERVED_NICKNAMES } from './data/teams';
import { createLeague } from './generate';
import { deliverMail, mailSubject, needsYou } from './inbox';
import { answerTalk } from './playerTalks';
import { TALK_ANSWER, TALK_CLOSE, TALK_LETTER } from './playerVoice';
import { activeRoster } from './roster';
import { talkCard } from './talkMail';
import type { League, Player, TalkCause } from './types';

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

  it('groups the players who speak up the same step into one message, a row each', () => {
    const l = createLeague({ seed: 'talk-mail' });
    const a = asking(l, l.userTeamId, 'deal', 0);
    const b = asking(l, l.userTeamId, 'snaps', 1);
    deliverMail(l);
    const mine = letters(l);
    expect(mine).toHaveLength(1);
    const [m] = mine;
    expect(m.id).toBe(`talk:${l.season}:${l.moraleAt}`);
    expect(m.sections![0].rows.map((r) => r.talk?.playerId)).toEqual([a.id, b.id]);
    for (const r of m.sections![0].rows) expect(r.note!.length).toBeGreaterThan(20);
    expect(m.body).not.toMatch(/\d/);
    expect(needsYou(l, m)).toBe(true);
    answerTalk(l, a.id, 'reassure');
    expect(needsYou(l, m)).toBe(true);
    answerTalk(l, b.id, 'firm');
    expect(needsYou(l, m)).toBe(false);
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

  it('varies what they say: ten players asking for a deal write at least six different letters', () => {
    const l = createLeague({ seed: 'talk-mail' });
    const askers = activeRoster(l, l.userTeamId).slice(0, 10);
    askers.forEach(
      (p, i) => (p.morale = { level: -4, talk: { club: l.userTeamId, ask: { cause: 'deal', at: l.moraleAt! - i } } }),
    );
    deliverMail(l);
    const bodies = letters(l).map((m) => m.body);
    expect(bodies).toHaveLength(10);
    expect(new Set(bodies).size).toBeGreaterThanOrEqual(6);
    // Two letters filed together never say the same thing.
    for (let i = 1; i < bodies.length; i++) expect(bodies[i]).not.toBe(bodies[i - 1]);
  });

  it('never has a man repeat his last letter', () => {
    const l = createLeague({ seed: 'talk-mail' });
    const p = asking(l, l.userTeamId, 'deal');
    deliverMail(l);
    // Seven teammates' letters in between: more than the last few any letter looks back on.
    for (let i = 1; i <= 7; i++) {
      const q = asking(l, l.userTeamId, 'deal', i);
      q.morale!.talk!.ask!.at = l.moraleAt! + i;
      deliverMail(l);
    }
    p.morale!.talk!.ask = { cause: 'deal', at: l.moraleAt! + 9 };
    deliverMail(l);
    const mine = letters(l).filter((m) => m.id.endsWith(`:${p.id}`));
    expect(mine).toHaveLength(2);
    expect(mine[1].body).not.toBe(mine[0].body);
  });

  it('says nothing it must not, in any line of his words', () => {
    const letter = {
      name: 'Davis',
      cause: 'deal' as const,
      loud: true,
      calm: true,
      veteran: true,
      young: false,
      finalYear: true,
      record: 'losing' as const,
      starter: true,
    };
    const answer = { cause: 'deal' as const, reply: 'promise' as const, loud: true, calm: true };
    const out = [
      ...TALK_LETTER.map((l) => l.text(letter)),
      ...TALK_CLOSE.map((l) => l.text(letter)),
      ...TALK_ANSWER.map((l) => l.text(answer)),
    ];
    for (const s of out) {
      expect(s.length).toBeGreaterThan(10);
      expect(s).not.toMatch(BANNED);
      expect(s).not.toMatch(/\d/);
      for (const nick of RESERVED_NICKNAMES) expect(s).not.toMatch(new RegExp(`\\b${nick}\\b`, 'i'));
    }
  });
});
