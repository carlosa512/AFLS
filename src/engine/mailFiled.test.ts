/**
 * Where a letter is filed in the inbox. A letter keeps the week it is about (`week`: its id, its subject and the sim's
 * own reading of it never change), but the desk has moved on by the time a game's mail arrives: what you read in week
 * 17's build-up is filed under week 17, whichever game it is about.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { createLeague } from './generate';
import { deliverMail, mailDate } from './inbox';
import { playWeek } from './league';
import type { InboxMessage, League } from './types';

const PHASES = ['regular', 'playoffs', 'complete'];
const key = (m: InboxMessage) => {
  const d = mailDate(m);
  return d.season * 1000 + PHASES.indexOf(d.phase) * 100 + d.week;
};

describe('where a letter is filed', () => {
  let l: League;
  beforeAll(() => {
    l = createLeague({ seed: 'mail-filed' });
    deliverMail(l);
    for (let week = 1; week <= 3; week++) {
      playWeek(l);
      deliverMail(l);
    }
  }, 120_000);
  const of = (prefix: string, week: number) =>
    l.inbox!.filter((m) => m.id.startsWith(prefix) && m.phase === 'regular' && m.week === week);

  it('files what a game sends under the week it is read in', () => {
    // Week 3 is played and the desk is in week 4.
    expect(l.week).toBe(4);
    const after = [...of('recap:', 3), ...of('snn:', 3)];
    expect(after.length).toBeGreaterThanOrEqual(2);
    for (const m of after) {
      // Still about week 3.
      expect(m.week).toBe(3);
      expect(mailDate(m)).toEqual({ season: l.season, phase: 'regular', week: 4 });
    }
  });

  it('files the build-up to a game under its own week', () => {
    const before = of('matchup:', 4);
    expect(before).toHaveLength(1);
    expect(before[0].filed).toBeUndefined();
    expect(mailDate(before[0])).toEqual({ season: l.season, phase: 'regular', week: 4 });
  });

  it('files nothing that arrived after week 3’s games under week 3 or earlier', () => {
    for (const m of l.inbox!.filter((x) => x.phase === 'regular' && x.week >= 1 && x.week <= 3 && x.filed))
      expect(mailDate(m).week).toBe(m.week + 1);
    // Every recap came after its game.
    for (const week of [1, 2, 3]) for (const m of of('recap:', week)) expect(mailDate(m).week).toBe(week + 1);
  });

  it('never runs backwards down the inbox, so a week is one heading', () => {
    const keys = l.inbox!.map(key);
    for (let i = 1; i < keys.length; i++) expect(keys[i]).toBeGreaterThanOrEqual(keys[i - 1]);
  });

  it('after a long advance, files each week’s mail the week after its own and not all under today', () => {
    const far = createLeague({ seed: 'mail-filed-far' });
    deliverMail(far);
    const had = new Set(far.inbox!.map((m) => m.id));
    for (let week = 1; week <= 4; week++) playWeek(far);
    deliverMail(far);
    const late = far.inbox!.filter((m) => !had.has(m.id) && m.phase === 'regular' && m.week >= 1 && m.week < far.week);
    expect(late.length).toBeGreaterThan(0);
    for (const m of late) expect(mailDate(m).week).toBe(m.week + 1);
  });

  it('reads a letter from before this as it was dated', () => {
    const old = { season: 2026, phase: 'regular', week: 9 } as InboxMessage;
    expect(mailDate(old)).toEqual({ season: 2026, phase: 'regular', week: 9 });
  });
});
