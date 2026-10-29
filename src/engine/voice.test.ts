import { describe, expect, it } from 'vitest';
import { createLeague } from './generate';
import type { InboxMessage } from './types';
import { MOTTOS, mottoOf, recentBodies, say, stableHash, toldKeys, type Line } from './voice';

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
