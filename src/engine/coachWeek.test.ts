import { describe, expect, it } from 'vitest';
import { adviceKey, updateCoachAdvice } from './coachDecisions';
import { coachWeekId, fitItems, MAX_ROWS, STALE, type WeekItem } from './coachWeek';
import { teamCoaches } from './coaching';
import { createLeague } from './generate';
import { deliverMail, mailSubject, needsYou } from './inbox';
import { answerMeeting, requestMeeting } from './meetings';
import { moraleClock, moraleContext } from './morale';
import { answerRoomTalk, answerTalk } from './playerTalks';
import { activeRoster, teamPlayers } from './roster';
import { UNITS, unitOf, weightOf, type Unit } from './standing';
import { shareWord } from './storiesStep';
import { ATTRIBUTES, type InboxMessage, type League, type Player, type TalkCause } from './types';

const template = createLeague({ seed: 'coach-week' });
const copy = <T>(v: T): T => structuredClone(v);
const OLD = /^(talk|meeting|meeting-result|staffNotes):/;
const letters = (l: League) => (l.inbox ?? []).filter((m) => m.id.startsWith('coach:'));
const rowsOf = (m: InboxMessage) => (m.sections ?? []).flatMap((s) => s.rows);
const textOf = (m: InboxMessage) =>
  `${m.body} ${rowsOf(m).map((r) => `${r.cells.join(' ')} ${r.before ?? ''} ${r.note ?? ''}`)}`;
const men = (l: League, unit: Unit) =>
  activeRoster(l, l.userTeamId).filter((p) => unitOf(p.position) === unit && p.morale);
const splitUnit = (l: League, unit: Unit) =>
  men(l, unit).forEach((p, i) => {
    p.morale!.level = i % 2 ? 2 : -2;
    delete p.morale!.jolts;
  });

/** Week 6, every room Okay and told Settled five steps ago, the season's first report in: the week is the letter's alone. */
function inSeason(): League {
  const l = copy(template);
  l.phase = 'regular';
  l.week = 6;
  l.moraleAt = moraleClock(l);
  for (const u of UNITS) {
    if (u === 'ST') continue;
    men(l, u).forEach((p) => {
      p.morale!.level = 0;
      delete p.morale!.jolts;
    });
    l.mailTold = { ...l.mailTold, [`unit:${moraleClock(l) - 5}:${l.userTeamId}:${u}:Settled`]: 1 };
  }
  const filed = { season: l.season, phase: 'regular' as const, week: 1, from: 'x', subject: '', body: '' };
  l.inbox = [
    ...(l.inbox ?? []),
    { ...filed, id: `locker:${l.season}:cutdown`, category: 'staff', read: true, actions: [] },
  ];
  return l;
}
function asking(l: League, cause: TalkCause = 'snaps', index = 0): Player {
  const p = activeRoster(l, l.userTeamId)[index];
  p.morale = { level: -4, talk: { club: l.userTeamId, ask: { cause, at: l.moraleAt! } } };
  return p;
}
const nextStep = (l: League) => {
  l.moraleAt = l.moraleAt! + 1;
};

describe('the head coach’s weekly letter', () => {
  it('files one letter for a step with an ask, a room and a request, and none of the old ids', () => {
    const l = inSeason();
    const p = asking(l, 'deal');
    splitUnit(l, 'WR');
    expect(requestMeeting(l, 'DL')).not.toBeNull();
    deliverMail(l);
    deliverMail(l);
    expect(letters(l)).toHaveLength(1);
    expect(l.inbox!.some((m) => OLD.test(m.id))).toBe(false);
    const [m] = letters(l);
    expect(m.id).toBe(coachWeekId(l.season, l.moraleAt!));
    expect(m.sections!.map((s) => s.title)).toEqual(['Who came to see me', 'The rooms', 'What I want to do']);
    expect(m.sections!.every((s) => s.layout === 'people')).toBe(true);
    expect(rowsOf(m).some((r) => r.talk?.playerId === p.id)).toBe(true);
    expect(rowsOf(m).some((r) => r.meeting)).toBe(true);
    expect(m.actions).toEqual([{ kind: 'locker' }]);
    expect(mailSubject(m)).toEqual({ kind: 'coachWeek', season: l.season, clock: l.moraleAt });
    expect(m.body).not.toMatch(/\d/);
  });

  it("brings a room's losing as one row and one answer, whoever of the room asked", () => {
    const l = inSeason();
    const dl = activeRoster(l, l.userTeamId).filter((p) => p.position === 'DT' || p.position === 'EDGE');
    for (const p of dl.slice(0, 3))
      p.morale = { level: -4, talk: { club: l.userTeamId, ask: { cause: 'losing', at: l.moraleAt! } } };
    deliverMail(l);
    const [m] = letters(l);
    const asks = m.sections!.find((x) => x.title === 'Who came to see me')!.rows;
    expect(asks).toHaveLength(1);
    expect(asks[0].talkRoom).toEqual({ unit: 'DL', clock: l.moraleAt });
    // The others of the room are named in a sentence of his own, outside the quote.
    expect(asks[0].note).toMatch(/”.* (said the same|came to me|feel|asked me|Add)/);
    expect(needsYou(l, m)).toBe(true);
    expect(answerRoomTalk(l, 'DL', 'reassure')).toBe(3);
    expect(needsYou(l, m)).toBe(false);
    // The room's answer is kept, so a man of it asking inside the gap is answered the same (`talkStep`).
    expect(l.teams[l.userTeamId].losingAnswer?.DL?.reply).toBe('reassure');
  });

  it('files nothing in a quiet step', () => {
    const l = inSeason();
    deliverMail(l);
    expect(letters(l)).toHaveLength(0);
  });

  const item = (tier: WeekItem['tier'], born: number, n: number): WeekItem => ({
    tier,
    key: `k${n}`,
    section: 'rooms',
    row: { cells: [`r${n}`] },
    born,
  });

  it('holds a letter to its rows, cutting from the lowest tier up', () => {
    const items = [
      ...[1, 2, 3, 1, 2, 3].map((t, n) => item(t as WeekItem['tier'], 10, n)),
      ...[4, 5, 4, 5, 4, 5, 4].map((t, n) => item(t as WeekItem['tier'], 10, 10 + n)),
    ];
    const kept = fitItems(items, 10);
    expect(kept).toHaveLength(MAX_ROWS);
    // The notes wait first, the staff room before the rooms; what needs an answer always stays.
    expect(kept.every((i) => i.tier <= 3)).toBe(true);
    expect(kept.filter((i) => i.tier === 1)).toHaveLength(2);
    expect(fitItems([...items.slice(0, 1), item(1, 10, 20), item(1, 10, 21)], 10)).toHaveLength(3);
  });

  it('keeps every tier 1 item even past the rows', () => {
    const asks = Array.from({ length: MAX_ROWS + 2 }, (_, n) => item(1, 10, n));
    expect(fitItems([...asks, item(2, 10, 99)], 10)).toHaveLength(MAX_ROWS + 2);
  });

  it('drops a room note that has waited three steps', () => {
    const items = [item(4, 10 - STALE, 1), item(5, 10 - STALE, 2), item(4, 10 - STALE + 1, 3), item(2, 0, 4)];
    expect(fitItems(items, 10).map((i) => i.key)).toEqual(['k3', 'k4']);
  });

  it('tells a meeting’s result in the next step’s letter, and always files that letter', () => {
    const l = inSeason();
    const s = requestMeeting(l, 'DL')!;
    deliverMail(l);
    const first = letters(l)[0];
    expect(rowsOf(first).some((r) => r.meeting)).toBe(true);
    answerMeeting(l, {
      approach: 'straight',
      backing: s.backings.find((b) => b !== 'words') ?? 'words',
      timing: 'monday',
    });
    deliverMail(l);
    // The same step: the result is owed, not told, and nothing new is filed.
    expect(letters(l)).toHaveLength(1);
    expect(textOf(letters(l)[0])).not.toMatch(/What I told them/);
    nextStep(l);
    deliverMail(l);
    expect(letters(l)).toHaveLength(2);
    const since = letters(l)[1].sections!.find((x) => x.title === 'Since last week')!;
    expect(since.rows.some((r) => r.cells[1] === 'What I told them')).toBe(true);
    expect(since.rows.some((r) => r.cells[1] === 'Where that leaves us')).toBe(true);
    expect(l.inbox!.some((m) => OLD.test(m.id))).toBe(false);
    // Told once.
    nextStep(l);
    deliverMail(l);
    expect(letters(l)).toHaveLength(2);
  });

  it('carries an unanswered ask as a short row, never his quote twice', () => {
    const l = inSeason();
    const p = asking(l, 'deal');
    deliverMail(l);
    const [first] = letters(l);
    const quote = rowsOf(first).find((r) => r.talk?.playerId === p.id)!.note!;
    expect(quote).toMatch(/^“/);
    nextStep(l);
    deliverMail(l);
    const second = letters(l)[1];
    const row = rowsOf(second).find((r) => r.talk?.playerId === p.id)!;
    expect(row.note).not.toMatch(/“/);
    expect(row.talk).toEqual({ playerId: p.id, clock: l.moraleAt! - 1 });
    expect(textOf(second)).not.toContain(quote.slice(1, -1).split(/(?<=[.?!]) /)[0]);
    expect(row.note).toContain(p.lastName);
  });

  it('does not ask again what an old-format letter is already asking', () => {
    const l = inSeason();
    const p = asking(l, 'deal');
    l.inbox!.push({
      id: `talk:${l.season}:${l.moraleAt}:${p.id}`,
      season: l.season,
      phase: 'regular',
      week: l.week,
      from: 'x',
      subject: 'old',
      body: 'old',
      category: 'staff',
      read: false,
      actions: [{ kind: 'player', playerId: p.id }],
    });
    deliverMail(l);
    // (A room's note may still come: nothing in the letter is his.)
    expect(
      letters(l)
        .flatMap(rowsOf)
        .some((r) => r.talk?.playerId === p.id),
    ).toBe(false);
    nextStep(l);
    deliverMail(l);
    // A step on he is still waiting: one short row, not his quote.
    const row = letters(l)
      .flatMap(rowsOf)
      .find((r) => r.talk?.playerId === p.id)!;
    expect(row.note).not.toMatch(/“/);
  });

  it('answering a row files nothing new and changes nothing filed', () => {
    const l = inSeason();
    const p = asking(l, 'deal');
    deliverMail(l);
    const letter = letters(l)[0];
    const before = JSON.stringify(letter);
    answerTalk(l, p.id, 'reassure');
    deliverMail(l);
    expect(letters(l)).toHaveLength(1);
    expect(JSON.stringify(l.inbox!.find((m) => m.id === letter.id))).toBe(before);
  });

  it('names the link when a voice’s deal feeds his room', () => {
    const l = inSeason();
    const ctx = moraleContext(l);
    // The heaviest man of a small room, whose room is split.
    const unit: Unit = 'QB';
    splitUnit(l, unit);
    const p = [...men(l, unit)].sort((a, b) => weightOf(l, b, ctx) - weightOf(l, a, ctx))[0];
    expect(shareWord(l, p, ctx)).not.toBeNull();
    p.morale = { level: -4, talk: { club: l.userTeamId, ask: { cause: 'deal', at: l.moraleAt! - 3 } } };
    const at = l.moraleAt! - 2;
    l.stories = {
      next: 3,
      closed: [],
      open: [
        { id: 1, kind: 'room', teamId: l.userTeamId, unit, opened: at, beats: [{ at, kind: 'turned', how: 'Split' }] },
        {
          id: 2,
          kind: 'deal',
          teamId: l.userTeamId,
          playerId: p.id,
          opened: at,
          feeds: [1],
          beats: [{ at, kind: 'asked' }],
        },
      ],
    };
    // His ask was told before; the room's turn is what is new.
    l.mailTold = { ...l.mailTold, [`talk:${l.season}:${at - 1}:${p.id}`]: l.season };
    deliverMail(l);
    const [m] = letters(l);
    expect(m).toBeDefined();
    expect(m.body + rowsOf(m).map((r) => r.note)).toMatch(new RegExp(p.lastName));
    expect(m.sections!.some((s) => s.title === 'The rooms')).toBe(true);
    // Told: the story's outlet count moves, and it is not told again.
    expect(l.stories.open.find((s) => s.id === 1)!.told?.coach).toBe(1);
  });

  it('needs you while a row is open and not after', () => {
    const l = inSeason();
    const p = asking(l, 'snaps');
    deliverMail(l);
    const [m] = letters(l);
    expect(needsYou(l, m)).toBe(true);
    answerTalk(l, p.id, 'firm');
    expect(needsYou(l, m)).toBe(false);
  });

  it('needs you while its meeting request is the one waiting', () => {
    const l = inSeason();
    requestMeeting(l, 'DL');
    deliverMail(l);
    const [m] = letters(l);
    expect(needsYou(l, m)).toBe(true);
    answerMeeting(l, 'skip');
    expect(needsYou(l, m)).toBe(false);
  });

  it('carries the depth-chart call’s coachNoteKey', () => {
    const l = inSeason();
    const t = l.teams[l.userTeamId];
    const staff = teamCoaches(l, t.id);
    for (const coach of staff) coach.quirks = {};
    staff.find((c) => c.room === 'WR')!.quirks = { earnYourReps: 2 };
    const wr = teamPlayers(l, t.id).filter((p) => p.position === 'WR');
    for (const [i, p] of wr.entries()) for (const key of ATTRIBUTES) p.ratings[key] = i < 2 ? 16 : i < 4 ? 12 : 8;
    wr[2].traits.workEthic = 5;
    wr[3].traits.workEthic = 18;
    t.autoDepth = false;
    t.depthChart.WR = wr.map((p) => p.id);
    updateCoachAdvice(l, t, staff, teamPlayers(l, t.id));
    const a = t.coachAdvice!.at(-1)!;
    // A note alone files nothing; with a man's ask in the week it rides along.
    deliverMail(l);
    expect(letters(l)).toHaveLength(0);
    asking(l, 'snaps');
    deliverMail(l);
    const [m] = letters(l);
    expect(m.coachNoteKey).toBe(adviceKey(a, 'offer'));
    expect(m.sections!.some((s) => s.title === 'From the staff room')).toBe(true);
  });

  it('never repeats a subject in a league year', () => {
    const l = inSeason();
    const p = asking(l, 'deal');
    deliverMail(l);
    for (let i = 0; i < 3; i++) {
      p.morale!.talk!.ask = { cause: 'deal', at: l.moraleAt! };
      delete p.morale!.talk!.answered;
      nextStep(l);
      p.morale!.talk!.ask = { cause: 'deal', at: l.moraleAt! };
      l.mailTold = Object.fromEntries(Object.entries(l.mailTold ?? {}).filter(([k]) => !k.startsWith('talk:')));
      deliverMail(l);
    }
    const subjects = letters(l).map((m) => m.subject);
    expect(new Set(subjects).size).toBe(subjects.length);
  });

  it('still reads, and still asks, the letters old saves already hold', () => {
    const l = inSeason();
    const p = asking(l, 'deal');
    const old = (id: string): InboxMessage => ({
      id,
      season: l.season,
      phase: 'regular',
      week: l.week,
      from: 'x',
      subject: 's',
      body: 'b',
      category: 'staff',
      read: false,
      actions: [{ kind: 'player', playerId: p.id }],
    });
    const talk = old(`talk:${l.season}:${l.moraleAt}:${p.id}`);
    expect(mailSubject(talk)).toEqual({ kind: 'talk', season: l.season, clock: l.moraleAt, playerId: p.id });
    expect(needsYou(l, talk)).toBe(true);
    answerTalk(l, p.id, 'firm');
    expect(needsYou(l, talk)).toBe(false);
    expect(mailSubject(old(`staffNotes:${l.season}:4`))).toEqual({ kind: 'staffNotes', season: l.season, week: 4 });
    expect(mailSubject(old(`meeting:${l.season}:${l.moraleAt}:DL`))).toMatchObject({ kind: 'meeting', scope: 'DL' });
    expect(mailSubject(old(`meeting-result:${l.season}:${l.moraleAt}:DL`))).toMatchObject({
      kind: 'meeting',
      result: true,
    });
  });
});
