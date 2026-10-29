import { describe, expect, it } from 'vitest';
import { createLeague, SAVE_VERSION } from './generate';
import { deliverMail, mailSubject } from './inbox';
import { migrateLeague } from './migrate';
import type { InboxMessage } from './types';

describe('save v65', () => {
  it('a v64 save loads at 65 with its inbox as it was', () => {
    const l = createLeague({ seed: 'v65' });
    deliverMail(l);
    const before = JSON.parse(JSON.stringify(l.inbox));
    l.version = 64;
    const up = migrateLeague(l)!;
    expect(SAVE_VERSION).toBe(65);
    expect(up.version).toBe(65);
    expect(up.inbox).toEqual(before);
  });
});

describe('the new letters read back', () => {
  const m = (id: string): InboxMessage => ({
    id,
    season: 2028,
    phase: 'regular',
    week: 3,
    from: 'x',
    category: 'staff',
    subject: '',
    body: '',
    read: true,
    actions: [],
  });
  it('reads each new id to its kind, and old ids as before', () => {
    expect(mailSubject(m('locker:2028:camp'))).toEqual({ kind: 'lockerReport', season: 2028, checkin: 'camp' });
    expect(mailSubject(m('waivers:2028:regular:3'))).toEqual({ kind: 'waivers', season: 2028, week: 3 });
    expect(mailSubject(m('staffNotes:2028:4'))).toEqual({ kind: 'staffNotes', season: 2028, week: 4 });
    expect(mailSubject(m('positions:2028:regular:1'))).toEqual({ kind: 'positionMoves', season: 2028 });
    expect(mailSubject(m('feud:2028:1:2'))?.kind).toBe('locker');
  });
});
