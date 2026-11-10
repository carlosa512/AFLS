/**
 * One whole season played as a GM who answers everything, then the head coach's weekly letters read together: one a
 * step, no sentence twice, no room told twice inside three steps, every meeting's result in the next letter. Slow
 * (a full season of sims), so it lives apart from the fast letter tests.
 */
import { moraleClock } from './morale';
import { beforeAll, describe, expect, it } from 'vitest';
import { createLeague } from './generate';
import { deliverMail } from './inbox';
import { employed } from './employment';
import { acceptGmOffer, pendingGmOffers } from './leadership';
import { playWeek } from './league';
import { answerMeeting } from './meetings';
import { advanceOffseason } from './offseason';
import { answerBench, benchCard, couldPlay, holdsJob, questionOf } from './benching';
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
  const now = l.moraleAt ?? moraleClock(l);
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
      // A benched ask has its own answers: "just this week" to the man who sat, "keep competing" to the other.
      else if (ask.cause === 'benched')
        answerBench(l, p.id, questionOf(l.teams[l.userTeamId], p.id)?.holder === p.id ? 'thisWeek' : 'compete');
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
// After the benching chain (storylines Task 11) and a closing riding in the next letter like a result:
//   mail1, 3     |   11   | 5   |  8    |  3
//   vol2, 10     |   11   | 5   |  8    |  4
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

// ───── the benching chain over a season ─────

/**
 * One season where, after week 5, a healthy job-holder at QB is moved below his backup. Nothing is answered for two
 * weeks (his ask, a week of waiting), then the other man is told "It's his job". Every other ask is answered as in
 * `playSeason`.
 */
function playBenchSeason(seed: string, userTeamId: number) {
  const l = createLeague({ seed, userTeamId });
  deliverMail(l);
  const team = l.teams[userTeamId];
  let sat: { holder: number; other: number } | undefined;
  let sitWeek = 0;
  let answered = false;
  for (let i = 0; i < 100; i++) {
    if (l.phase === 'complete') break;
    if (l.phase === 'resign' && pendingGmOffers(l)) {
      const offers = l.leadership.search!.offers;
      acceptGmOffer(l, (offers.find((o) => o.teamId === l.userTeamId) ?? offers[0]).teamId);
    } else if (l.phase === 'regular' || l.phase === 'playoffs') {
      // After week 5's games: sit a healthy holder behind the man below him on the chart.
      if (!sat && l.phase === 'regular' && l.week === 6) {
        const ids = team.depthChart.QB;
        const holder = ids.map((id) => l.players[id]).find((p) => holdsJob(team, p.id) && couldPlay(l, p));
        const other = ids
          .map((id) => l.players[id])
          .find((p) => p !== holder && !holdsJob(team, p.id) && couldPlay(l, p));
        if (holder && other) {
          team.autoDepth = false;
          team.depthChart.QB = [other.id, holder.id, ...ids.filter((id) => id !== holder.id && id !== other.id)];
          sat = { holder: holder.id, other: other.id };
          sitWeek = l.week;
        }
      }
      playWeek(l);
    } else advanceOffseason(l, { autoUser: true });
    if (!employed(l) && !pendingGmOffers(l)) break;
    deliverMail(l);
    for (const p of Object.values(l.players)) {
      const ask = p.teamId === l.userTeamId ? p.morale?.talk?.ask : undefined;
      if (!ask) continue;
      if (ask.cause === 'losing') answerRoomTalk(l, 'team', 'reassure');
      // The scenario's job question is left open until the answer below.
      else if (ask.cause === 'benched') {
        if (sat && (p.id === sat.holder || p.id === sat.other) && !answered) continue;
        answerBench(l, p.id, questionOf(team, p.id)?.holder === p.id ? 'thisWeek' : 'compete');
      } else answerTalk(l, p.id, 'reassure');
    }
    if (sat && !answered && l.week >= sitWeek + 2 && questionOf(team, sat.holder)) {
      answered = answerBench(l, sat.other, 'his');
    }
    const pend = team.meetings?.pending;
    if (pend)
      answerMeeting(l, {
        approach: pend.approaches[0],
        backing: pend.backings[pend.backings.length - 1],
        timing: pend.timings[0],
      });
    deliverMail(l);
  }
  return { l, sat, answered };
}

// Measured when written (bench5, team 25): 10 letters, 7 stories told, 7 opened, 6 rows at most, 3 open, 5 benching rows.
// The holder's ask in the step he sat, answered "his job" two weeks on, his closing in the next letter. The week between files no letter of its own: a "still waiting" note only rides along
// when a letter is filed for another reason, so it is not counted here.
describe("the head coach's letters over a season with a benching: bench5", () => {
  const TEAM = 25;
  let l: League;
  let coach: InboxMessage[];
  let sat: { holder: number; other: number } | undefined;
  let answered = false;
  beforeAll(() => {
    ({ l, sat, answered } = playBenchSeason('bench5', TEAM));
    coach = coachLetters(l);
  }, 180_000);
  const benchRows = () =>
    coach.flatMap((m) =>
      rowsOf(m).filter(
        (r) => r.bench !== undefined || (r.cells[1] === 'Closed' && [sat?.holder, sat?.other].includes(r.playerId)),
      ),
    );

  it('keeps their promises', () => {
    expect(sat).toBeDefined();
    expect(answered).toBe(true);
    expect(dupes(sentences(coach))).toEqual([]);
    expect(dupes(coach.map((m) => m.subject))).toEqual([]);
    expect(roomsToldWithin(coach, 3)).toEqual([]);
    expect(heldWithoutResult(l)).toEqual([]);
  });
  it('asks, waits and closes', () => {
    const ask = benchRows().filter((r) => r.bench && r.playerId === sat!.holder);
    const closed = benchRows().filter((r) => r.cells[1] === 'Closed');
    expect(ask.length).toBeGreaterThanOrEqual(1);
    expect(closed.length).toBeGreaterThanOrEqual(1);
    expect(benchRows().length).toBeGreaterThanOrEqual(3);
    // The ask is the first bench row of the holder, and the two weeks it waited filed no second ask for him.
    const first = coach.findIndex((m) => rowsOf(m).some((r) => r.bench && r.playerId === sat!.holder));
    expect(first).toBeGreaterThanOrEqual(0);
    expect(questionOf(l.teams[TEAM], sat!.holder)).toBeUndefined();
  });
  it('leaves no open row for a man who is off the club', () => {
    const open = coach.flatMap((m) =>
      rowsOf(m).filter(
        (r) => r.bench && l.players[r.bench.playerId]?.teamId !== TEAM && benchCard(l, r.bench).state === 'open',
      ),
    );
    expect(open).toEqual([]);
  });
  it('keeps the volume bounds', () => {
    expect(coach.length).toBeLessThanOrEqual(12);
    const all = [...(l.stories?.open ?? []), ...(l.stories?.closed ?? [])];
    expect(all.filter((s) => (s.told?.coach ?? 0) > 0).length).toBeLessThanOrEqual(10);
    expect(storiesOpened(l).length).toBeLessThanOrEqual(12);
    expect(Math.max(...coach.map((m) => rowsOf(m).length))).toBeLessThanOrEqual(6);
    expect(l.stories!.open.length).toBeLessThanOrEqual(4);
  });
});
