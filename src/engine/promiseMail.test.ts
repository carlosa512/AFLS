import { describe, expect, it } from 'vitest';
import { createLeague } from './generate';
import { mailSubject } from './inbox';
import { promiseMail, promisesNeedYou } from './promiseMail';
import { activeRoster } from './roster';
import type { InboxMessage, League } from './types';

/** A league whose season has just ended, with a deal promised to one of yours and snaps to another. */
function ended() {
  const l = createLeague({ seed: 'promise-mail' });
  l.phase = 'complete';
  const clock = l.moraleAt!;
  const [a, b] = activeRoster(l, l.userTeamId).filter((p) => p.morale);
  a.morale!.talk = { club: l.userTeamId, promise: { kind: 'deal', made: clock, due: clock + 10 } };
  b.morale!.talk = { club: l.userTeamId, promise: { kind: 'snaps', made: clock, left: 2 } };
  const other = activeRoster(l, (l.userTeamId + 1) % 32).find((p) => p.morale)!;
  other.morale!.talk = { club: other.teamId!, promise: { kind: 'deal', made: clock, due: clock + 10 } };
  return { l, a, b, other };
}

const asMessage = (_l: League, d: ReturnType<typeof promiseMail>[number]): InboxMessage =>
  ({ ...d, read: false }) as unknown as InboxMessage;

describe("the head coach's promises reminder", () => {
  it('files one letter when the season is complete, a row per open promise to your players', () => {
    const { l, a, b, other } = ended();
    const mail = promiseMail(l, new Set());
    expect(mail).toHaveLength(1);
    expect(mail[0].id).toBe(`promises:${l.season}`);
    const rows = mail[0].sections![0].rows;
    expect(rows.map((r) => r.playerId).sort()).toEqual([a.id, b.id].sort());
    const deal = rows.find((r) => r.playerId === a.id)!;
    expect(deal.note).toBe('A new deal by the end of the re-sign window.');
    expect(deal.negotiate).toEqual({ playerId: a.id });
    const snaps = rows.find((r) => r.playerId === b.id)!;
    expect(snaps.note).toBe('More snaps: two games left, carried into next season.');
    expect(snaps.negotiate).toBeUndefined();
    expect(rows.some((r) => r.playerId === other.id)).toBe(false);
  });

  it('files nothing without an open promise, before the season ends, or twice', () => {
    const { l, a, b } = ended();
    expect(promiseMail(l, new Set([`promises:${l.season}`]))).toEqual([]);
    l.phase = 'playoffs';
    expect(promiseMail(l, new Set())).toEqual([]);
    l.phase = 'complete';
    delete a.morale!.talk;
    delete b.morale!.talk;
    expect(promiseMail(l, new Set())).toEqual([]);
  });

  it('needs you while a deal on it is still open', () => {
    const { l, a } = ended();
    const m = asMessage(l, promiseMail(l, new Set())[0]);
    expect(promisesNeedYou(l, m)).toBe(true);
    delete a.morale!.talk!.promise;
    expect(promisesNeedYou(l, m)).toBe(false);
  });

  it('reads its subject back', () => {
    const { l } = ended();
    const m = asMessage(l, promiseMail(l, new Set())[0]);
    expect(mailSubject(m)).toEqual({ kind: 'promises', season: l.season });
  });
});
