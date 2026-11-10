import { describe, expect, it } from 'vitest';
import { createLeague } from './generate';
import type { InboxMessage } from './types';
import { deliverMail } from './inbox';
import { playWeek } from './league';
import { headCoach } from './senders';
import {
  around,
  MOTTOS,
  mottoOf,
  recentBodies,
  saidBefore,
  saidKey,
  say,
  seasonSaid,
  sentencesOf,
  stableHash,
  toldKeys,
  type Line,
} from './voice';

describe('the line picker', () => {
  it('the most specific matching line wins', () => {
    const bank: Line<{ still: boolean }>[] = [
      { text: () => "They don't see eye to eye." },
      { when: (c) => c.still, reads: 1, text: () => 'Still not talking.' },
    ];
    expect(say(bank, { still: true }, { key: 'k', slot: 's' })).toBe('Still not talking.');
    expect(say(bank, { still: false }, { key: 'k', slot: 's' })).toBe("They don't see eye to eye.");
  });

  it('ties break the same way every time, and differently across letters', () => {
    const bank = ['a', 'b', 'c', 'd'].map((t) => ({ text: () => t }));
    const pick = (key: string) => say(bank, {}, { key, slot: 'verdict' });
    expect(pick('locker:2028:camp')).toBe(pick('locker:2028:camp'));
    expect(new Set(['1', '2', '3', '4', '5', '6', '7', '8'].map((k) => pick(`locker:${k}`))).size).toBeGreaterThan(1);
  });

  it('skips a line the sender used recently when another fits', () => {
    const bank = [{ text: () => 'Quiet room.' }, { text: () => 'Nothing to report.' }];
    for (const key of ['a', 'b', 'c', 'd', 'e', 'f'])
      expect(say(bank, {}, { key, slot: 'v', recent: ['Quiet room. Good week.'] })).toBe('Nothing to report.');
  });

  it('keeps a recent line when it is the only one that fits', () => {
    expect(say([{ text: () => 'Only.' }], {}, { key: 'a', slot: 'v', recent: ['Only.'] })).toBe('Only.');
  });

  it('says nothing when no line fits', () => {
    expect(say([{ when: () => false, text: () => 'x' }], {}, { key: 'a', slot: 'v' })).toBe('');
  });

  it('hashes the same string the same way', () => {
    expect(stableHash('abc')).toBe(stableHash('abc'));
    expect(stableHash('abc')).not.toBe(stableHash('abd'));
    expect(stableHash('abc')).toBeGreaterThanOrEqual(0);
  });

  it('a coach keeps one motto', () => {
    expect(MOTTOS.length).toBeGreaterThanOrEqual(8);
    expect(mottoOf(7)).toBe(mottoOf(7));
    expect(MOTTOS).toContain(mottoOf(7));
  });
});

describe('what the inbox has told', () => {
  const msg = (id: string, from: string, body: string, extra: Partial<InboxMessage> = {}): InboxMessage => ({
    id,
    season: 2028,
    phase: 'regular',
    week: 1,
    from,
    category: 'staff',
    subject: id,
    body,
    read: true,
    actions: [],
    ...extra,
  });

  it('counts message ids and what each covered', () => {
    const l = createLeague({ seed: 'voice' });
    l.inbox = [msg('x', 'Coach', 'b', { covered: ['feud:2028:1:2'] })];
    const told = toldKeys(l);
    expect(told.has('x')).toBe(true);
    expect(told.has('feud:2028:1:2')).toBe(true);
  });

  it("reads a sender's last letters, newest first", () => {
    const l = createLeague({ seed: 'voice' });
    l.inbox = ['1', '2', '3', '4', '5', '6', '7'].map((n) => msg(n, 'Coach', `body ${n}`));
    l.inbox.push(msg('o', 'Doctor', 'other'));
    expect(recentBodies(l, 'Coach')).toEqual(['body 7', 'body 6', 'body 5', 'body 4', 'body 3']);
  });
});

describe('seasonSaid', () => {
  it('reads bodies and row notes of this league year only, split into sentences', () => {
    const l = createLeague({ seed: 'voice-said' });
    const base = { phase: 'regular' as const, week: 1, category: 'staff' as const, read: true, actions: [] };
    l.inbox = [
      { ...base, id: 'a', season: l.season, from: 'Coach', subject: 'a', body: 'One thing. Two things? Three!' },
      {
        ...base,
        id: 'b',
        season: l.season,
        from: 'Coach',
        subject: 'b',
        body: 'Lead.',
        sections: [{ title: 't', rows: [{ cells: ['x'], note: '“He said so. Then more.”' }] }],
      },
      { ...base, id: 'c', season: l.season - 1, from: 'Coach', subject: 'c', body: 'Last year.' },
      { ...base, id: 'd', season: l.season, from: 'Doctor', subject: 'd', body: 'Not his.' },
    ];
    expect(seasonSaid(l, 'Coach')).toEqual([
      'One thing.',
      'Two things?',
      'Three!',
      'Lead.',
      'He said so.',
      'Then more.',
    ]);
  });
});

describe('what was said, after the inbox forgets it', () => {
  it('steps from a group that has all been said to the next one that has not', () => {
    const bank: Line<object>[] = [
      { reads: 2, text: () => 'Narrow one.' },
      { reads: 2, text: () => 'Narrow two.' },
      { reads: 1, text: () => 'Plain.' },
    ];
    const at = { key: 'k', slot: 's', skip: (t: string) => t.startsWith('Narrow') };
    expect(say(bank, {}, at)).toBe('Plain.');
    // With nothing left unsaid it still answers, from the most specific group.
    expect(say(bank, {}, { ...at, skip: () => true })).toMatch(/^Narrow/);
  });

  it('knows a multi-sentence line by any sentence of it, quotes aside', () => {
    expect(sentencesOf('“One. Two.”')).toEqual(['One.', 'Two.']);
    const l = createLeague({ seed: 'said-before' });
    l.mailTold = { [saidKey('Two.')]: l.season, [saidKey('Old.')]: l.season - 1 };
    expect(saidBefore(l, 'One. Two.')).toBe(true);
    expect(saidBefore(l, 'Old.')).toBe(false);
    expect(around(l, ['A sentence here. Another.']).skip('Another.')).toBe(true);
  });

  it('remembers what was said after the inbox evicts it', () => {
    const l = createLeague({ seed: 'said-evicted' });
    deliverMail(l);
    const coach = headCoach(l).from;
    const early = l.inbox!.filter((m) => m.body && m.from === coach).slice(0, 6);
    expect(early.length).toBeGreaterThan(0);
    const filler = Array.from({ length: 300 }, (_, i) => ({
      ...l.inbox![0],
      id: `filler:${i}`,
      from: 'Filler',
      body: `Filler ${i}.`,
      sections: undefined,
      covered: undefined,
      week: 18,
      phase: 'regular' as const,
    }));
    l.inbox!.push(...filler);
    playWeek(l);
    deliverMail(l);
    const gone = early.filter((m) => !l.inbox!.some((x) => x.id === m.id));
    expect(gone.length).toBeGreaterThan(0);
    const m = gone[0];
    const sentence = sentencesOf(m.body)[0];
    expect(seasonSaid(l, m.from)).not.toContain(sentence);
    expect(saidBefore(l, sentence)).toBe(true);
    // Only the head coach's sentences are kept: another sender's are not.
    const other = l.inbox!.find((x) => x.from !== coach && x.from !== 'Filler' && x.body);
    if (other) {
      const s2 = sentencesOf(other.body).find(
        (x) =>
          !sentencesOf(
            l
              .inbox!.filter((y) => y.from === coach)
              .map((y) => y.body)
              .join(' '),
          ).includes(x),
      );
      if (s2) expect(saidBefore(l, s2)).toBe(false);
    }
    const bank = [{ text: () => sentence }, { text: () => 'Something else.' }];
    expect(say(bank, {}, { key: 'k', slot: 's', ...around(l, seasonSaid(l, m.from)) })).toBe('Something else.');
  });
});
