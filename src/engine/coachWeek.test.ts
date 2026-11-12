import { describe, expect, it } from 'vitest';
import { answerBench, benchCard, benchKickoff, dismissReminder, restoreCard, setJobs } from './benching';
import { perceive } from './scouting';
import { STARTERS } from './positions';
import { adviceKey, updateCoachAdvice } from './coachDecisions';
import {
  coachWeekId,
  LETTER_GAP,
  fitItems,
  jobsFact,
  newestLosingLetter,
  MAX_ROWS,
  STALE,
  weekItems,
  type WeekItem,
} from './coachWeek';
import { teamCoaches } from './coaching';
import { createLeague } from './generate';
import { deliverMail, mailSubject, needsYou } from './inbox';
import { answerMeeting, meetingsStep, requestMeeting } from './meetings';
import { moraleAdvance, moraleClock, moraleContext } from './morale';
import { answerRoomTalk, answerTalk } from './playerTalks';
import { activeRoster, teamPlayers } from './roster';
import { UNITS, unitOf, weightOf, type Unit } from './standing';
import { beat, closeStory, COACH, markTold } from './stories';
import { seasonSaid, toldKeys } from './voice';
import { shareWord } from './storiesStep';
import {
  ATTRIBUTES,
  POSITIONS,
  type Commitment,
  type InboxMessage,
  type League,
  type Player,
  type TalkCause,
} from './types';
import { noteCommitment } from './meetings/commitments';

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
/** The next step the coach may write: he writes at most every other step (`LETTER_GAP`). */
const nextLetter = (l: League) => {
  l.moraleAt = l.moraleAt! + LETTER_GAP;
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
    // What needs you first, then what does not: he writes it as a letter, not a form.
    expect(m.sections!.map((s) => s.title)).toEqual(['Who came to see me', 'What I want to do', 'The rooms']);
    expect(m.sections!.every((s) => s.layout === 'letter')).toBe(true);
    const ask = rowsOf(m).find((r) => r.talk?.playerId === p.id)!;
    expect(ask.lead).toMatch(/^(came to see me|asked to see me|stopped by my office) about his contract\.$/);
    // The rest is told with a word that it asks nothing.
    expect(m.sections!.find((s) => s.title === 'The rooms')!.lead).toBe('The rest needs nothing from you.');
    expect(rowsOf(m).some((r) => r.talk?.playerId === p.id)).toBe(true);
    expect(rowsOf(m).some((r) => r.meeting)).toBe(true);
    expect(m.actions).toEqual([{ kind: 'locker' }]);
    expect(mailSubject(m)).toEqual({ kind: 'coachWeek', season: l.season, clock: l.moraleAt });
    expect(m.body).not.toMatch(/\d/);
  });

  it("brings the club's losing as one row and one answer, whoever asked", () => {
    const l = inSeason();
    const dl = activeRoster(l, l.userTeamId).filter((p) => ['DT', 'EDGE', 'WR', 'QB'].includes(p.position));
    for (const p of dl.slice(0, 3))
      p.morale = { level: -4, talk: { club: l.userTeamId, ask: { cause: 'losing', at: l.moraleAt! } } };
    deliverMail(l);
    const [m] = letters(l);
    const asks = m.sections!.find((x) => x.title === 'Who came to see me')!.rows;
    expect(asks).toHaveLength(1);
    expect(asks[0].talkRoom).toEqual({ unit: 'team', clock: l.moraleAt });
    // The others of the room are named in a sentence of his own, outside the quote.
    expect(asks[0].note).toMatch(/”.* (said the same|came to me|feel|asked me|Add)/);
    expect(needsYou(l, m)).toBe(true);
    expect(answerRoomTalk(l, 'team', 'reassure')).toBe(3);
    expect(needsYou(l, m)).toBe(false);
    // The room's answer is kept, so a man of it asking inside the gap is answered the same (`talkStep`).
    expect(l.teams[l.userTeamId].losingAnswer?.team?.reply).toBe('reassure');
  });

  it('lets only the newest letter holding the losing need you, and its answer covers every open ask', () => {
    const l = inSeason();
    const [a, b] = activeRoster(l, l.userTeamId).filter((p) => p.position === 'WR');
    a.morale = { level: -4, talk: { club: l.userTeamId, ask: { cause: 'losing', at: l.moraleAt! } } };
    deliverMail(l);
    const first = letters(l)[0];
    expect(needsYou(l, first)).toBe(true);
    nextLetter(l);
    b.morale = { level: -4, talk: { club: l.userTeamId, ask: { cause: 'losing', at: l.moraleAt! } } };
    deliverMail(l);
    const second = letters(l).find((m) => m.id !== first.id && rowsOf(m).some((r) => r.talkRoom))!;
    expect(second).toBeTruthy();
    expect(needsYou(l, first)).toBe(false);
    expect(needsYou(l, second)).toBe(true);
    expect(answerRoomTalk(l, 'team', 'reassure')).toBe(2);
    expect(needsYou(l, second)).toBe(false);
  });

  describe.each([['archived'], ['deleted']] as const)('a losing letter %s with asks open', (how) => {
    function twoLetters() {
      const l = inSeason();
      const [a, b] = activeRoster(l, l.userTeamId).filter((p) => p.position === 'WR');
      a.morale = { level: -4, talk: { club: l.userTeamId, ask: { cause: 'losing', at: l.moraleAt! } } };
      deliverMail(l);
      const first = letters(l)[0];
      nextLetter(l);
      b.morale = { level: -4, talk: { club: l.userTeamId, ask: { cause: 'losing', at: l.moraleAt! } } };
      deliverMail(l);
      const second = letters(l).find((m) => m.id !== first.id)!;
      return { l, first, second };
    }
    it('hands the buttons to an older letter in the inbox', () => {
      const { l, first, second } = twoLetters();
      second[how] = true;
      expect(newestLosingLetter(l)).toBe(first.id);
      expect(needsYou(l, first)).toBe(true);
      expect(needsYou(l, second)).toBe(false);
    });
    it('is told again in the next step when no letter is left, and only once', () => {
      const { l, first, second } = twoLetters();
      first[how] = true;
      second[how] = true;
      expect(newestLosingLetter(l)).toBeUndefined();
      nextLetter(l);
      deliverMail(l);
      const fresh = letters(l).filter((m) => m !== first && m !== second);
      expect(fresh).toHaveLength(1);
      expect(rowsOf(fresh[0]).some((r) => r.talkRoom)).toBe(true);
      expect(needsYou(l, fresh[0])).toBe(true);
      deliverMail(l);
      expect(letters(l).filter((m) => m !== first && m !== second)).toHaveLength(1);
    });
  });

  it("writes at most every other step: the second step's ask rides in the third step's letter, still answerable", () => {
    const l = inSeason();
    const a = asking(l, 'deal', 0);
    deliverMail(l);
    expect(letters(l)).toHaveLength(1);
    nextStep(l);
    const b = asking(l, 'deal', 1);
    deliverMail(l);
    // Nothing is filed the step after a letter, and nothing is lost: the ask waits, open, not ignored.
    expect(letters(l)).toHaveLength(1);
    expect(b.morale!.talk!.ask).toBeDefined();
    expect(answerTalk(l, b.id, 'reassure')).toBe(true);
    b.morale!.talk = { club: l.userTeamId, ask: { cause: 'deal', at: l.moraleAt! } };
    nextStep(l);
    deliverMail(l);
    expect(letters(l)).toHaveLength(2);
    expect(rowsOf(letters(l)[1]).some((r) => r.talk?.playerId === b.id)).toBe(true);
    expect(needsYou(l, letters(l)[1])).toBe(true);
    expect(a.morale!.talk!.ask).toBeDefined();
  });

  it('a suggestion made the step after a letter is held, carried in the next letter and still answerable', () => {
    const l = inSeason();
    asking(l, 'deal', 0);
    deliverMail(l);
    expect(letters(l)).toHaveLength(1);
    nextStep(l);
    expect(requestMeeting(l, 'DL')).not.toBeNull();
    deliverMail(l);
    expect(letters(l)).toHaveLength(1);
    nextStep(l);
    meetingsStep(l);
    const pending = l.teams[l.userTeamId].meetings!.pending!;
    expect(pending.scope).toBe('DL');
    deliverMail(l);
    expect(letters(l)).toHaveLength(2);
    const want = rowsOf(letters(l)[1]).find((r) => r.meeting);
    expect(want?.meeting).toMatchObject({ scope: 'DL', clock: pending.clock });
    expect(
      answerMeeting(l, { approach: pending.approaches[0], backing: pending.backings[0], timing: pending.timings[0] }),
    ).not.toBeNull();
  });

  /** An open commitment at your club, coming due `left` steps from now. */
  function commit(l: League, c: Partial<Commitment> & Pick<Commitment, 'backing' | 'scope' | 'named'>, left: number) {
    const full: Commitment = { opened: l.moraleAt! - 1, closes: l.moraleAt! + left, boughtIn: [], by: 'coach', ...c };
    const m = (l.teams[l.userTeamId].meetings ??= { open: [], log: [] } as never);
    m.open.push(full);
    return { c: full, key: `due:${full.opened}:${full.scope}:${full.backing}` };
  }
  const dueKeys = (l: League) =>
    letters(l)
      .flatMap((m) => m.covered ?? [])
      .filter((k) => /^due:|^clock:\d+:\d+:due$/.test(k));

  it('a commitment held by no story is warned before it comes due, and a letter two steps out already carries it', () => {
    const l = inSeason();
    const p = activeRoster(l, l.userTeamId)[3];
    const { key } = commit(l, { backing: 'snaps', scope: 'team', named: [p.id] }, 2);
    deliverMail(l);
    expect(letters(l)).toHaveLength(1);
    const row = rowsOf(letters(l)[0]).find((r) => r.cells[1] === 'The clock')!;
    expect(row.note).toContain('in two weeks');
    expect(row.note).toContain(p.lastName);
    expect(letters(l)[0].covered).toContain(key);
    // Told once: the next letter does not warn again.
    nextLetter(l);
    asking(l, 'deal', 0);
    deliverMail(l);
    expect(letters(l)).toHaveLength(2);
    expect(dueKeys(l)).toEqual([key]);
  });

  it('a letter three steps out and a held step still warn before it comes due', () => {
    const l = inSeason();
    const { key } = commit(l, { backing: 'jobs', scope: 'DL', named: [] }, 3);
    asking(l, 'deal', 0);
    deliverMail(l);
    expect(dueKeys(l)).toEqual([]);
    nextStep(l);
    deliverMail(l);
    expect(letters(l)).toHaveLength(1);
    nextStep(l);
    deliverMail(l);
    expect(letters(l)).toHaveLength(2);
    expect(dueKeys(l)).toEqual([key]);
    expect(textOf(letters(l)[1])).toContain('next week');
  });

  it("a promise's clock is told two steps before it comes due, so a held step cannot swallow it", () => {
    const l = inSeason();
    const p = activeRoster(l, l.userTeamId)[5];
    beat(l, { kind: 'deal', teamId: l.userTeamId, playerId: p.id }, 'promised', l.moraleAt! - 1, {
      due: l.moraleAt! + 2,
    });
    deliverMail(l);
    expect(letters(l)).toHaveLength(1);
    expect(dueKeys(l)).toHaveLength(1);
    nextStep(l);
    deliverMail(l);
    nextStep(l);
    asking(l, 'deal', 0);
    deliverMail(l);
    expect(dueKeys(l)).toHaveLength(1);
  });

  it("the GM's own address is his to have said, not the coach's", () => {
    const l = inSeason();
    commit(l, { backing: 'jobs', scope: 'team', named: [], by: 'gm' }, 1);
    deliverMail(l);
    const row = rowsOf(letters(l)[0]).find((r) => r.cells[1] === 'The clock')!;
    expect(row.note).toMatch(/^You told them/);
  });

  it('a talks commitment with a deal story is warned exactly once, with its Negotiate button', () => {
    const l = inSeason();
    const p = activeRoster(l, l.userTeamId)[4];
    const { c, key } = commit(l, { backing: 'talks', scope: unitOf(p.position) as never, named: [p.id] }, 3);
    noteCommitment(l, l.userTeamId, c);
    for (let i = 0; i < 4; i++) {
      deliverMail(l);
      nextStep(l);
    }
    expect(dueKeys(l)).toEqual([key]);
    const row = letters(l)
      .flatMap(rowsOf)
      .find((r) => r.cells[1] === 'The clock' && r.note?.includes('comes due'))!;
    expect(row.negotiate).toEqual({ playerId: p.id });
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

  it('never cuts a result’s Negotiate row, and covers a result only when its room or a man made the letter', () => {
    const res = (n: number, part: NonNullable<WeekItem['part']>, key = `res:${n}`): WeekItem => ({
      ...item(3, 10, n),
      key,
      section: 'since',
      covers: ['res'],
      result: true,
      part,
    });
    const filler = Array.from({ length: MAX_ROWS }, (_, n) => item(1, 10, 100 + n));
    const kept = fitItems([...filler, res(1, 'next', 'res'), res(2, 'talks')], 10);
    expect(kept.some((i) => i.part === 'talks')).toBe(true);
    // Its room's row was cut, so the letter does not mark it told.
    expect(kept.filter((i) => i.result).every((i) => i.covers!.length === 0 && i.key !== 'res')).toBe(true);
    const some = fitItems([res(1, 'told', 'res'), res(2, 'talks')], 10);
    expect(some.every((i) => i.covers![0] === 'res')).toBe(true);
  });

  it('drops a room note that has waited three steps', () => {
    const items = [item(4, 10 - STALE, 1), item(5, 10 - STALE, 2), item(4, 10 - STALE + 1, 3), item(2, 0, 4)];
    expect(fitItems(items, 10).map((i) => i.key)).toEqual(['k3', 'k4']);
  });

  const held = (backing: 'words' | 'other') => {
    const l = inSeason();
    const s = requestMeeting(l, 'DL')!;
    deliverMail(l);
    expect(rowsOf(letters(l)[0]).some((r) => r.meeting)).toBe(true);
    answerMeeting(l, {
      approach: 'straight',
      backing: backing === 'words' ? 'words' : (s.backings.find((b) => b !== 'words') ?? 'words'),
      timing: 'monday',
    });
    deliverMail(l);
    // The same step: the result is owed, not told, and nothing new is filed.
    expect(letters(l)).toHaveLength(1);
    expect(textOf(letters(l)[0])).not.toMatch(/What I told them/);
    return l;
  };
  const told = (m: InboxMessage) =>
    rowsOf(m).some((r) => r.cells[1] === 'What I told them') &&
    rowsOf(m).some((r) => r.cells[1] === 'Where that leaves us');

  it('rides a meeting’s result in the next letter filed for something else', () => {
    const l = held('words');
    nextLetter(l);
    const p = asking(l, 'deal');
    deliverMail(l);
    expect(letters(l)).toHaveLength(2);
    expect(told(letters(l)[1])).toBe(true);
    expect(l.inbox!.some((m) => OLD.test(m.id))).toBe(false);
    // Told once.
    answerTalk(l, p.id, 'reassure');
    nextLetter(l);
    deliverMail(l);
    expect(letters(l)).toHaveLength(2);
  });

  it('files a result alone only when it has waited two steps, or owes something', () => {
    const l = held('words');
    nextStep(l);
    deliverMail(l);
    expect(letters(l)).toHaveLength(1);
    nextStep(l);
    deliverMail(l);
    expect(letters(l)).toHaveLength(2);
    expect(told(letters(l)[1])).toBe(true);
    // A commitment with talks owes a Negotiate row, so it files at once.
    const o = held('other');
    nextStep(o);
    deliverMail(o);
    const owes = rowsOf(letters(o).at(-1)!).some((r) => r.negotiate);
    expect(letters(o)).toHaveLength(owes ? 2 : 1);
  });

  /** A man's snaps story, told by the coach, closing at this step: a closing with nothing to answer. */
  function closing(l: League): number {
    const p = activeRoster(l, l.userTeamId)[3];
    const on = { kind: 'snaps' as const, teamId: l.userTeamId, playerId: p.id };
    markTold(beat(l, on, 'asked', l.moraleAt! - 3)!, COACH);
    return closeStory(l, on, 'kept', l.moraleAt!)!.id;
  }
  const closes = (m: InboxMessage, id: number) => (m.covered ?? []).some((k) => k.startsWith(`story:${id}:`));

  it('files a closing alone only when it has waited two steps', () => {
    const l = inSeason();
    const id = closing(l);
    deliverMail(l);
    expect(letters(l)).toHaveLength(0);
    nextStep(l);
    deliverMail(l);
    expect(letters(l)).toHaveLength(0);
    nextStep(l);
    deliverMail(l);
    expect(letters(l)).toHaveLength(1);
    expect(closes(letters(l)[0], id)).toBe(true);
    // Told once.
    nextStep(l);
    deliverMail(l);
    expect(letters(l)).toHaveLength(1);
  });

  it('rides a closing in a letter filed for something else in between', () => {
    const l = inSeason();
    const id = closing(l);
    deliverMail(l);
    expect(letters(l)).toHaveLength(0);
    nextStep(l);
    const p = asking(l, 'deal');
    deliverMail(l);
    expect(letters(l)).toHaveLength(1);
    expect(closes(letters(l)[0], id)).toBe(true);
    answerTalk(l, p.id, 'reassure');
    nextStep(l);
    deliverMail(l);
    expect(letters(l)).toHaveLength(1);
  });

  it('carries an unanswered ask as a short row, never his quote twice', () => {
    const l = inSeason();
    const p = asking(l, 'deal');
    deliverMail(l);
    const [first] = letters(l);
    const quote = rowsOf(first).find((r) => r.talk?.playerId === p.id)!.note!;
    expect(quote).toMatch(/^“/);
    nextLetter(l);
    deliverMail(l);
    const second = letters(l)[1];
    const row = rowsOf(second).find((r) => r.talk?.playerId === p.id)!;
    expect(row.note).not.toMatch(/“/);
    expect(row.talk).toEqual({ playerId: p.id, clock: l.moraleAt! - LETTER_GAP });
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
    // A depth-chart call is a decision for you: it files a letter alone.
    deliverMail(l);
    const [m] = letters(l);
    expect(letters(l)).toHaveLength(1);
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

// ───────── the benching chain's rows ─────────

describe('the head coach’s letters on a benching', () => {
  /** A club with a QB room of three, jobs set, and the chart hand-sorted. */
  function club(seed: string) {
    const l = createLeague({ seed });
    const team = l.teams[l.userTeamId];
    setJobs(l);
    team.autoDepth = false;
    const q = team.depthChart.QB.map((id) => l.players[id]);
    return { l, team, q };
  }
  const order = (team: League['teams'][number], ids: number[]) => {
    team.depthChart.QB = [...ids, ...team.depthChart.QB.filter((id) => !ids.includes(id))];
  };
  /** One week as the calendar runs it: kickoff noted, the morale step with its benching, the letters filed. */
  function step(l: League) {
    benchKickoff(l);
    moraleAdvance(l, moraleClock(l, true));
    l.week++;
    deliverMail(l);
  }
  const benchRows = (l: League) =>
    letters(l)
      .flatMap(rowsOf)
      .filter((r) => r.bench);

  it('files his ask with a bench row, never a talk row, and the card has his four answers', () => {
    const { l, team, q } = club('bench-letter');
    order(team, [q[1].id, q[0].id]);
    step(l);
    const [m] = letters(l);
    const row = rowsOf(m).find((r) => r.bench?.playerId === q[0].id)!;
    expect(row).toBeDefined();
    expect(row.talk).toBeUndefined();
    expect(row.note).toMatch(/^“/);
    expect(benchCard(l, row.bench!).options).toHaveLength(4);
    expect(needsYou(l, m)).toBe(true);
    // Answered, the letter stops asking.
    answerBench(l, q[0].id, 'earn');
    expect(needsYou(l, m)).toBe(false);
  });

  it('a week on, the question still open reads differently and names the other man once he has asked', () => {
    const { l, team, q } = club('bench-still');
    order(team, [q[1].id, q[0].id]);
    step(l);
    const first = letters(l)
      .flatMap(rowsOf)
      .find((r) => r.bench?.playerId === q[0].id)!;
    // Swapped back with nobody told: the other man sits and asks.
    order(team, [q[0].id, q[1].id]);
    step(l);
    // The coach writes every other step: the other man's ask waits a step and comes in the next letter.
    expect(letters(l)).toHaveLength(1);
    step(l);
    const second = letters(l).at(-1)!;
    const rows = rowsOf(second).filter((r) => r.bench);
    expect(rows.map((r) => r.bench!.playerId).sort()).toEqual([q[0].id, q[1].id].sort());
    expect(rows.find((r) => r.bench!.playerId === q[1].id)!.note).toMatch(/^“/);
    const still = rows.find((r) => r.bench!.playerId === q[0].id)!;
    expect(still.note).not.toBe(first.note);
    expect(still.note).toContain(q[1].lastName);
    expect(benchCard(l, rows.find((r) => r.bench!.playerId === q[1].id)!.bench!).options).toHaveLength(3);
    // The old row stays answerable while the question is open.
    expect(benchCard(l, first.bench!).state).toBe('open');
  });

  it('a question left open is a note that rides along and never files a letter, and the ask itself is tier one', () => {
    const { l, team, q } = club('bench-quiet');
    order(team, [q[1].id, q[0].id]);
    step(l);
    expect(
      weekItems(l, new Set(), [])
        .filter((i) => i.row.bench)
        .map((i) => i.tier),
    ).toEqual([1]);
    // A week later, with nobody answering, the same question is a tier four note.
    benchKickoff(l);
    moraleAdvance(l, moraleClock(l, true));
    l.week++;
    const mine = weekItems(l, toldKeys(l), seasonSaid(l, letters(l)[0].from, 'coach:')).filter((i) => i.row.bench);
    expect(mine.map((i) => i.tier)).toEqual([4]);
  });

  it('the reminder is told once, with Put him back and Leave it', () => {
    const { l, team, q } = club('bench-reminder');
    q[0].injury = {
      type: 'hamstring',
      severity: 'moderate',
      weeksRemaining: 1,
      estimate: [1, 2],
      season: l.season,
      week: l.week,
      where: 'game',
    };
    order(team, [q[1].id, q[2].id, q[0].id]);
    benchKickoff(l);
    delete q[0].injury;
    moraleAdvance(l, moraleClock(l, true));
    l.week++;
    deliverMail(l);
    const rows = letters(l)
      .flatMap(rowsOf)
      .filter((r) => r.restore);
    expect(rows).toHaveLength(1);
    expect(rows[0].note).toMatch(/Put him back\?$/);
    expect(restoreCard(l, q[0].id).state).toBe('open');
    dismissReminder(l, q[0].id);
    nextStep(l);
    deliverMail(l);
    nextStep(l);
    deliverMail(l);
    expect(
      letters(l)
        .flatMap(rowsOf)
        .filter((r) => r.restore),
    ).toHaveLength(1);
  });

  it('the reminder outlasts a held step: cleared the step after a letter, it comes in the next, and he waits for it', () => {
    const { l, team, q } = club('bench-reminder-held');
    // Step c: a letter filed for something else.
    benchKickoff(l);
    moraleAdvance(l, moraleClock(l, true));
    l.week++;
    const filer = activeRoster(l, l.userTeamId).find((p) => p.position !== 'QB' && p.morale)!;
    filer.morale!.talk = { club: l.userTeamId, ask: { cause: 'snaps', at: l.moraleAt! } };
    deliverMail(l);
    expect(letters(l)).toHaveLength(1);
    // Step c+1: he was out at kickoff and is cleared after it, listed third. The coach does not write this step.
    q[0].injury = {
      type: 'hamstring',
      severity: 'moderate',
      weeksRemaining: 1,
      estimate: [1, 2],
      season: l.season,
      week: l.week,
      where: 'game',
    };
    order(team, [q[1].id, q[2].id, q[0].id]);
    benchKickoff(l);
    delete q[0].injury;
    moraleAdvance(l, moraleClock(l, true));
    l.week++;
    deliverMail(l);
    expect(letters(l)).toHaveLength(1);
    // Step c+2: he sat a game healthy before the reminder reached you, and does not ask; the reminder comes now.
    step(l);
    expect(q[0].morale?.talk?.ask).toBeUndefined();
    expect(team.jobs!.questions ?? []).toHaveLength(0);
    const last = letters(l).at(-1)!;
    expect(letters(l)).toHaveLength(2);
    const row = rowsOf(last).find((r) => r.restore?.playerId === q[0].id);
    expect(row).toBeDefined();
    expect(restoreCard(l, q[0].id).state).toBe('open');
    expect(needsYou(l, last)).toBe(true);
    expect(rowsOf(last).some((r) => r.bench?.playerId === q[0].id)).toBe(false);
    // Leave it, and the one-game rule applies: he sits again and asks.
    dismissReminder(l, q[0].id);
    step(l);
    expect(q[0].morale?.talk?.ask?.cause).toBe('benched');
  });

  it('told he was back in, he started, and when he asks about his deal nothing says a promise is still out', () => {
    const { l, team, q } = club('bench-then-deal');
    order(team, [q[1].id, q[0].id]);
    step(l);
    expect(answerBench(l, q[0].id, 'backIn')).toBe(true);
    order(team, [q[0].id, q[1].id]);
    step(l);
    expect(q[0].morale!.talk!.answered).toMatchObject({ cause: 'benched', reply: 'promise' });
    expect(q[0].morale!.talk!.kept ?? 0).toBe(0);
    for (let i = 0; i < 2; i++) {
      l.moraleAt = l.moraleAt! + 1;
      q[0].morale!.talk!.ask = { cause: 'deal', at: l.moraleAt };
      deliverMail(l);
    }
    const row = letters(l)
      .flatMap(rowsOf)
      .find((r) => r.talk?.playerId === q[0].id)!;
    expect(row).toBeDefined();
    expect(`${row.before ?? ''} ${row.note ?? ''}`).not.toMatch(
      /still waiting|make it right|nothing has come|told him no|turned him down|follow through|about this before|raised it before/,
    );
  });

  it('a benching that closes is told in one closing row, once', () => {
    const { l, team, q } = club('bench-closing');
    order(team, [q[1].id, q[0].id]);
    step(l);
    answerBench(l, q[0].id, 'his');
    const closing = () =>
      letters(l)
        .flatMap(rowsOf)
        .filter((r) => r.cells[1] === 'Closed' && r.playerId === q[0].id);
    for (let i = 0; i < 4; i++) {
      nextStep(l);
      deliverMail(l);
    }
    expect(closing()).toHaveLength(1);
    expect(closing()[0].note).toContain(q[0].lastName);
    expect(closing()[0].note).not.toMatch(/That one is closed/);
    expect(benchRows(l).length).toBeGreaterThan(0);
  });

  it('the camp jobs row waits for the cut-down moment, is told once a season, and calls a battle close only by our scouts` read', () => {
    const { l } = club('bench-camp');
    l.phase = 'preseason';
    l.personnel!.enabled = true;
    l.personnel!.clock = { season: l.season, cutdown: false };
    expect(weekItems(l, new Set(), []).some((i) => i.key.startsWith('jobs:'))).toBe(false);
    l.personnel!.clock = { season: l.season, cutdown: true };
    const row = weekItems(l, new Set(), []).find((i) => i.key.startsWith('jobs:'))!;
    expect(row.tier).toBe(5);
    expect(row.row.note).toContain('Quarterback:');
    expect(weekItems(l, new Set([row.key]), []).some((i) => i.key.startsWith('jobs:'))).toBe(false);
    // The close battle, if any, is the nearest pair within half a point, and "ahead" says which way the scouts read it.
    const fact = jobsFact(l);
    const team = l.teams[l.userTeamId];
    const gaps = POSITIONS.flatMap((pos) => {
      const chart = team.depthChart[pos].map((id) => l.players[id]);
      const last = chart[STARTERS[pos] - 1];
      const next = chart[STARTERS[pos]];
      if (!last || !next) return [];
      const a = perceive(l, team.id, last).ovr;
      const b = perceive(l, team.id, next).ovr;
      return Math.abs(a - b) <= 0.5 ? [{ pos, diff: Math.abs(a - b), ahead: b > a }] : [];
    }).sort((x, y) => x.diff - y.diff);
    if (!gaps.length) expect(fact.close).toBeUndefined();
    else expect(fact.close).toMatchObject({ ahead: gaps[0].ahead });
  });
});

describe('the coverage note', () => {
  /** An edition on file whose one tile is a Column about `key`. */
  const edition = (l: League, week: number, key: string, cast: number[] = [], clubId = l.userTeamId): InboxMessage => {
    const story = {
      key,
      kind: 'column' as const,
      angle: key.endsWith('+') ? '1+' : '1-',
      tier: 3 as const,
      clubId,
      kicker: 'Column',
      headline: '',
      summary: '',
      picture: {},
      cast,
      numbers: [],
      paragraphs: [],
      links: [],
    };
    return {
      id: `snn:${l.season}:w${week}`,
      season: l.season,
      phase: 'regular',
      week,
      from: 'SNN — Sports News Network',
      category: 'league',
      subject: '',
      body: '',
      read: true,
      actions: [],
      covered: [key],
      edition: { label: `Week ${week}`, scores: [], lead: story, tiles: [story] },
    };
  };
  const blame = (l: League, unit: string) => `column:${l.season}:unit:${l.userTeamId}:${unit}:1-`;
  const notes = (l: League) => weekItems(l, toldKeys(l), []).filter((i) => i.key.startsWith('coverage:'));

  it('names the senior man of a unit SNN has just called a problem, once', () => {
    const l = inSeason();
    l.inbox!.push(edition(l, 5, blame(l, 'pass rush')));
    const found = notes(l);
    expect(found).toHaveLength(1);
    const p = l.players[found[0].row.playerId!];
    expect(p.teamId).toBe(l.userTeamId);
    expect(p.position).toBe('EDGE');
    expect(found[0].tier).toBe(5);
    expect(found[0].row.note).toContain('pass rush');
    expect(found[0].row.note).toContain(p.lastName);
    expect(found[0].key).toBe(`coverage:${l.season}:${p.id}`);
    // Told once a season for a man.
    l.mailTold = { ...l.mailTold, [found[0].key]: l.season };
    expect(notes(l)).toEqual([]);
  });

  it('is about the man the Column named, when it named one', () => {
    const l = inSeason();
    const qb = activeRoster(l, l.userTeamId).find((p) => p.position === 'QB')!;
    l.inbox!.push(edition(l, 5, blame(l, 'passing game'), [qb.id]));
    expect(notes(l).map((i) => i.row.playerId)).toEqual([qb.id]);
  });

  it('says nothing about old coverage, credit, or another club', () => {
    const l = inSeason();
    // Three editions ago.
    l.inbox!.push(edition(l, 3, blame(l, 'run game')), edition(l, 4, 'x'), edition(l, 5, 'y'));
    expect(notes(l)).toEqual([]);
    const m = inSeason();
    m.inbox!.push(edition(m, 5, `column:${m.season}:unit:${m.userTeamId}:run game:1+`));
    m.inbox!.push(
      edition(m, 4, `column:${m.season}:unit:${(m.userTeamId + 1) % 32}:run game:1-`, [], (m.userTeamId + 1) % 32),
    );
    expect(notes(m)).toEqual([]);
  });

  it('is one row however much was written, and never a letter by itself', () => {
    const l = inSeason();
    l.inbox!.push(edition(l, 4, blame(l, 'run game')), edition(l, 5, blame(l, 'coverage')));
    expect(notes(l)).toHaveLength(1);
    deliverMail(l);
    expect(letters(l)).toEqual([]);
  });
});

describe('men still waiting on an answer', () => {
  it('are one short section: who, and their answers, under one sentence', () => {
    const l = inSeason();
    const [a, b] = [asking(l, 'deal', 0), asking(l, 'deal', 1)];
    deliverMail(l);
    // Unanswered, a letter later.
    nextLetter(l);
    asking(l, 'snaps', 2);
    deliverMail(l);
    const m = letters(l).at(-1)!;
    const waiting = m.sections!.find((s) => s.title === 'Still waiting on you')!;
    expect(waiting).toBeDefined();
    expect(waiting.lead).toBe('Two players are still waiting on you about their contracts.');
    expect(waiting.rows.map((r) => r.playerId).sort()).toEqual([a.id, b.id].sort());
    expect(waiting.rows.every((r) => r.compact && r.talk)).toBe(true);
    // After the new ask, before the notes.
    expect(m.sections!.map((s) => s.title).slice(0, 2)).toEqual(['Who came to see me', 'Still waiting on you']);
  });

  it('names one man, and says only that they wait when they ask about different things', () => {
    const l = inSeason();
    const a = asking(l, 'deal', 0);
    deliverMail(l);
    nextLetter(l);
    asking(l, 'snaps', 2);
    deliverMail(l);
    const one = letters(l)
      .at(-1)!
      .sections!.find((s) => s.title === 'Still waiting on you')!;
    expect(one.lead).toBe(`${a.lastName} is still waiting on you about his contract.`);
    const m = inSeason();
    asking(m, 'deal', 0);
    asking(m, 'snaps', 1);
    deliverMail(m);
    nextLetter(m);
    asking(m, 'deal', 2);
    deliverMail(m);
    const mixed = letters(m)
      .at(-1)!
      .sections!.find((s) => s.title === 'Still waiting on you')!;
    expect(mixed.lead).toBe('Two players are still waiting on an answer from you.');
  });
});
