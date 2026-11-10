/**
 * One whole season played as a GM who answers everything, then the head coach's weekly letters read together: one a
 * step, no sentence twice, no room told twice inside three steps, every meeting's result in the next letter. Slow
 * (a full season of sims), so it lives apart from the fast letter tests.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { createLeague } from './generate';
import { deliverMail } from './inbox';
import { employed } from './employment';
import { acceptGmOffer, pendingGmOffers } from './leadership';
import { playWeek } from './league';
import { answerMeeting } from './meetings';
import { advanceOffseason } from './offseason';
import { answerRoomTalk, answerTalk } from './playerTalks';
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
/** Meetings held whose result no letter told within two steps (the last steps of a season may still be waiting). */
function heldWithoutResult(l: League): string[] {
  const letters = l.inbox!.filter((m) => m.id.startsWith('coach:'));
  const now = Math.max(...letters.map(clockOf));
  return (l.teams[l.userTeamId].meetings?.log ?? []).flatMap((r) => {
    const key = `meeting-result:${l.season}:${r.clock}:${r.scope}`;
    const told = letters.find((m) => m.covered?.includes(key));
    if (!told) return now - r.clock >= 2 ? [`${key} never told`] : [];
    return clockOf(told) - r.clock > 2 ? [`${key} told ${clockOf(told) - r.clock} steps on`] : [];
  });
}

/** One season played as a GM who answers everything (a room's losing once, as its row does) to the end of the playoffs. */
function playSeason(seed: string, userTeamId: number): League {
  const l = createLeague({ seed, userTeamId });
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
    for (const p of Object.values(l.players)) {
      const ask = p.teamId === l.userTeamId ? p.morale?.talk?.ask : undefined;
      if (!ask) continue;
      if (ask.cause === 'losing') answerRoomTalk(l, 'team', 'reassure');
      else answerTalk(l, p.id, 'reassure');
    }
    const pend = l.teams[l.userTeamId].meetings?.pending;
    if (pend)
      answerMeeting(l, {
        approach: pend.approaches[0],
        backing: pend.backings[pend.backings.length - 1],
        timing: pend.timings[0],
      });
    deliverMail(l);
  }
  return l;
}

const coachLetters = (l: League) => l.inbox!.filter((m) => m.id.startsWith('coach:'));
const storiesOpened = (l: League) =>
  [...(l.stories?.open ?? []), ...(l.stories?.closed ?? [])].filter((s) => Math.floor(s.opened / 32) === l.season);

// The bounds are the owner's ("less is more with how many emails we already get"): what reaches him is the letters
// and the stories the coach told; stories opened is the bookkeeping behind them. A miss is a design question, not a
// number to move. One season each, as measured when R4 and R5 were written:
//   seed, team   | letters | told | opened | still open
//   mail1, 3     |   11   | 5   |  7    |  3
//   vol2, 10     |   11   | 8   |  11   |  4
describe.each([
  { seed: 'mail1', team: 3 },
  { seed: 'vol2', team: 10 },
])("the head coach's letters over a season: $seed", ({ seed, team }) => {
  let l: League;
  let coach: InboxMessage[];
  beforeAll(() => {
    l = playSeason(seed, team);
    coach = coachLetters(l);
  }, 180_000);

  it('keeps their promises', () => {
    expect(coach.length).toBeGreaterThan(5);
    expect(new Set(coach.map((m) => m.id)).size).toBe(coach.length);
    expect(l.inbox!.some((m) => /^(talk|meeting|meeting-result|staffNotes):/.test(m.id))).toBe(false);
    expect(dupes(sentences(coach))).toEqual([]);
    expect(dupes(coach.map((m) => m.subject))).toEqual([]);
    expect(roomsToldWithin(coach, 3)).toEqual([]);
    expect(heldWithoutResult(l)).toEqual([]);
  });
  it('letters', () => expect(coach.length).toBeLessThanOrEqual(12));
  it('stories the coach told', () => {
    const all = [...(l.stories?.open ?? []), ...(l.stories?.closed ?? [])];
    expect(all.filter((s) => (s.told?.coach ?? 0) > 0).length).toBeLessThanOrEqual(10);
  });
  it('stories opened', () => expect(storiesOpened(l).length).toBeLessThanOrEqual(12));
  it('rows', () => expect(Math.max(...coach.map((m) => rowsOf(m).length))).toBeLessThanOrEqual(6));
  it('open', () => expect(l.stories!.open.length).toBeLessThanOrEqual(4));
});
