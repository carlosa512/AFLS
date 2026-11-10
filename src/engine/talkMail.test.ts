import { describe, expect, it } from 'vitest';
import { RESERVED_NICKNAMES } from './data/teams';
import { createLeague } from './generate';
import { deliverMail, mailSubject, needsYou } from './inbox';
import { answerTalk } from './playerTalks';
import { TALK_ANSWER, TALK_CLOSE, TALK_LETTER } from './playerVoice';
import { activeRoster } from './roster';
import { talkCard, talkRows } from './talkMail';
import { headCoach } from './senders';
import type { League, Player, TalkCause } from './types';

const BANNED = /marble|\btraits?\b|z-score|super bowl|\bAFC\b|\bNFC\b/i;

function asking(l: League, teamId: number, cause: TalkCause = 'snaps', index = 0): Player {
  const p = activeRoster(l, teamId)[index];
  p.morale = { level: -4, talk: { club: teamId, ask: { cause, at: l.moraleAt! } } };
  return p;
}
const letters = (l: League) => (l.inbox ?? []).filter((m) => m.id.startsWith('coach:'));
/** The rows of the head coach's weekly letters that carry a man's ask. */
const askRows = (l: League) =>
  letters(l).flatMap((m) => (m.sections ?? []).flatMap((s) => s.rows.filter((r) => r.talk)));
const rowOf = (l: League, id: number) => askRows(l).find((r) => r.talk!.playerId === id)!;

describe('your players’ asks, in the head coach’s weekly letter', () => {
  it('files a row for each ask on your roster, and none for another club’s', () => {
    const l = createLeague({ seed: 'talk-mail' });
    const p = asking(l, l.userTeamId);
    const other = asking(l, (l.userTeamId + 1) % 32);
    deliverMail(l);
    deliverMail(l);
    expect(letters(l)).toHaveLength(1);
    const [m] = letters(l);
    expect(askRows(l).map((r) => r.talk!.playerId)).toEqual([p.id]);
    expect(rowOf(l, other.id)).toBeUndefined();
    // The head coach brings it to you, in the player's own words.
    expect(m.from).toBe(headCoach(l).from);
    expect(rowOf(l, p.id).cells[0]).toContain(p.lastName);
    expect(rowOf(l, p.id).note).toMatch(/^“.+”$/);
    expect(mailSubject(m)).toEqual({ kind: 'coachWeek', season: l.season, clock: l.moraleAt });
  });

  it('puts the players who speak up the same step in one letter, a row each', () => {
    const l = createLeague({ seed: 'talk-mail' });
    const a = asking(l, l.userTeamId, 'deal', 0);
    const b = asking(l, l.userTeamId, 'snaps', 1);
    deliverMail(l);
    expect(letters(l)).toHaveLength(1);
    const [m] = letters(l);
    expect(askRows(l).map((r) => r.talk?.playerId)).toEqual([a.id, b.id]);
    for (const r of askRows(l)) expect(r.note!.length).toBeGreaterThan(20);
    expect(m.body).not.toMatch(/\d/);
    expect(m.from).toBe(headCoach(l).from);
    expect(needsYou(l, m)).toBe(true);
    answerTalk(l, a.id, 'reassure');
    expect(needsYou(l, m)).toBe(true);
    // Answering one of the two files nothing new: the step's letter is already on file.
    deliverMail(l);
    expect(letters(l)).toHaveLength(1);
    answerTalk(l, b.id, 'firm');
    expect(needsYou(l, m)).toBe(false);
  });

  it('needs you until you answer', () => {
    const l = createLeague({ seed: 'talk-mail' });
    const p = asking(l, l.userTeamId, 'deal');
    deliverMail(l);
    const [m] = letters(l);
    const row = rowOf(l, p.id);
    expect(needsYou(l, m)).toBe(true);
    expect(talkCard(l, row.talk!)).toMatchObject({ state: 'open', canPromise: true, cause: 'deal' });
    answerTalk(l, p.id, 'reassure');
    expect(needsYou(l, m)).toBe(false);
    const card = talkCard(l, row.talk!);
    expect(card.state).toBe('answered');
    expect(card.line!.length).toBeGreaterThan(10);
  });

  it('offers no promise for the losing', () => {
    const l = createLeague({ seed: 'talk-mail' });
    const p = asking(l, l.userTeamId, 'losing');
    deliverMail(l);
    expect(talkCard(l, rowOf(l, p.id).talk!).canPromise).toBe(false);
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
    expect(askRows(l).filter((r) => r.talk!.playerId === theirs.id)).toHaveLength(0);
  });

  it('closes a row while you are between jobs: its buttons would answer nothing', () => {
    const l = createLeague({ seed: 'talk-mail' });
    const p = asking(l, l.userTeamId);
    deliverMail(l);
    const [m] = letters(l);
    const s = rowOf(l, p.id).talk!;
    expect(talkCard(l, s).state).toBe('open');
    l.gms[l.userGmId].teamId = null;
    expect(talkCard(l, s).state).toBe('closed');
    expect(needsYou(l, m)).toBe(false);
  });

  it('varies what they say: ten players asking for a deal write at least six different rows', () => {
    const l = createLeague({ seed: 'talk-mail' });
    const askers = activeRoster(l, l.userTeamId).slice(0, 10);
    askers.forEach(
      (p, i) => (p.morale = { level: -4, talk: { club: l.userTeamId, ask: { cause: 'deal', at: l.moraleAt! - i } } }),
    );
    deliverMail(l);
    const notes = askRows(l).map((r) => r.note);
    expect(notes).toHaveLength(10);
    expect(new Set(notes).size).toBeGreaterThanOrEqual(6);
    // Two rows of one letter never say the same thing.
    for (let i = 1; i < notes.length; i++) expect(notes[i]).not.toBe(notes[i - 1]);
  });

  it('never has a man repeat his last quote', () => {
    const l = createLeague({ seed: 'talk-mail' });
    const p = asking(l, l.userTeamId, 'deal');
    deliverMail(l);
    const first = rowOf(l, p.id).note;
    // Seven teammates' asks in between: more than the last few any letter looks back on.
    for (let i = 1; i <= 7; i++) {
      const q = asking(l, l.userTeamId, 'deal', i);
      q.morale!.talk!.ask!.at = l.moraleAt! + i;
      l.moraleAt = l.moraleAt! + 1;
      deliverMail(l);
    }
    l.moraleAt = l.moraleAt! + 2;
    p.morale!.talk!.ask = { cause: 'deal', at: l.moraleAt };
    deliverMail(l);
    const mine = askRows(l).filter((r) => r.talk!.playerId === p.id && /^“/.test(r.note!));
    expect(mine).toHaveLength(2);
    expect(mine[1].note).not.toBe(first);
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

describe('talkRows', () => {
  it('writes a row for each open ask filed at the clock, no two sharing a sentence', () => {
    const l = createLeague({ seed: 'talk-rows' });
    asking(l, l.userTeamId, 'losing', 0);
    asking(l, l.userTeamId, 'losing', 1);
    asking(l, (l.userTeamId + 1) % 32, 'losing', 0);
    const rows = talkRows(l, l.moraleAt!, []);
    expect(rows).toHaveLength(2);
    expect(rows[0].talk).toEqual({ playerId: rows[0].playerId, clock: l.moraleAt });
    expect(rows[0].cells[1]).toBe('About the losing');
    const split = (s?: string) => (s ?? '').slice(1, -1).split(/(?<=[.?!]) /);
    expect(split(rows[0].note).filter((s) => split(rows[1].note).includes(s))).toEqual([]);
    expect(talkRows(l, l.moraleAt! + 1, [])).toEqual([]);
  });
});
