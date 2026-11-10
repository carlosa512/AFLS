/**
 * One whole season played as a GM who answers everything, then the head coach's weekly letters read together: one a
 * step, no sentence twice, no room told twice inside three steps, every meeting's result in the next letter. Slow
 * (a full season of sims), so it lives apart from the fast letter tests.
 */
import { describe, expect, it } from 'vitest';
import { createLeague } from './generate';
import { deliverMail } from './inbox';
import { employed } from './employment';
import { acceptGmOffer, pendingGmOffers } from './leadership';
import { playWeek } from './league';
import { answerMeeting } from './meetings';
import { advanceOffseason } from './offseason';
import { answerTalk } from './playerTalks';
import type { InboxMessage, League } from './types';
import { sentencesOf } from './voice';

const rowsOf = (m: InboxMessage) => (m.sections ?? []).flatMap((s) => s.rows);
const dupes = (xs: string[]) => {
  const n = new Map<string, number>();
  for (const x of xs) n.set(x, (n.get(x) ?? 0) + 1);
  return [...n].filter(([, c]) => c > 1).map(([s, c]) => `${c}x ${s}`);
};
/** Every sentence a letter says: its body, and each row's note, what it was before, and its quote. */
const sentences = (ms: InboxMessage[]) =>
  ms.flatMap((m) => [
    ...sentencesOf(m.body),
    ...rowsOf(m).flatMap((r) => [...sentencesOf(r.note), ...sentencesOf(r.before)]),
  ]);
const clockOf = (m: InboxMessage) => Number(m.id.split(':')[2]);
/** A room named in "The rooms" of two letters less than `gap` steps apart. */
function roomsToldWithin(ms: InboxMessage[], gap: number): string[] {
  const out: string[] = [];
  const last = new Map<string, number>();
  for (const m of [...ms].sort((a, b) => clockOf(a) - clockOf(b))) {
    const rooms = (m.sections ?? [])
      .filter((s) => s.title === 'The rooms')
      .flatMap((s) => s.rows.map((r) => r.cells[0]));
    for (const room of rooms) {
      const at = last.get(room);
      if (at !== undefined && clockOf(m) - at < gap) out.push(`${room} at ${at} and ${clockOf(m)}`);
      last.set(room, clockOf(m));
    }
  }
  return out;
}
/** A meeting held for which no letter covers its result. */
function heldWithoutResult(l: League): string[] {
  const covered = new Set((l.inbox ?? []).flatMap((m) => m.covered ?? []));
  return (l.teams[l.userTeamId].meetings?.log ?? [])
    .map((r) => `meeting-result:${l.season}:${r.clock}:${r.scope}`)
    .filter((k) => !covered.has(k));
}

describe("the head coach's letters over a season", () => {
  it('keep their promises', () => {
    const l = createLeague({ seed: 'mail1', userTeamId: 3 });
    deliverMail(l);
    for (let i = 0; i < 100; i++) {
      if (l.phase === 'complete') break;
      if (l.phase === 'resign' && pendingGmOffers(l)) {
        const offers = l.leadership.search!.offers;
        acceptGmOffer(l, (offers.find((o) => o.teamId === l.userTeamId) ?? offers[0]).teamId);
      } else if (l.phase === 'regular' || l.phase === 'playoffs') playWeek(l);
      else advanceOffseason(l, { autoUser: true });
      if (!employed(l) && !pendingGmOffers(l)) break;
      deliverMail(l);
      for (const p of Object.values(l.players))
        if (p.teamId === l.userTeamId && p.morale?.talk?.ask) answerTalk(l, p.id, 'reassure');
      const pend = l.teams[l.userTeamId].meetings?.pending;
      if (pend)
        answerMeeting(l, {
          approach: pend.approaches[0],
          backing: pend.backings[pend.backings.length - 1],
          timing: pend.timings[0],
        });
      deliverMail(l);
    }
    const coach = l.inbox!.filter((m) => m.id.startsWith('coach:'));
    expect(coach.length).toBeGreaterThan(5);
    expect(new Set(coach.map((m) => m.id)).size).toBe(coach.length);
    expect(l.inbox!.some((m) => /^(talk|meeting|meeting-result|staffNotes):/.test(m.id))).toBe(false);
    expect(dupes(sentences(coach))).toEqual([]);
    expect(dupes(coach.map((m) => m.subject))).toEqual([]);
    expect(roomsToldWithin(coach, 3)).toEqual([]);
    expect(heldWithoutResult(l)).toEqual([]);
  }, 180_000);
});
