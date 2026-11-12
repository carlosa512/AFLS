import { describe, expect, it } from 'vitest';
import type { CoachSheet, ManSheet, MomentSheet } from './castSheet';
import {
  BEFORE,
  CLOCK,
  CLOSING,
  HEADLINE,
  LINK,
  OPENING,
  RESULT_MAN,
  RESULT_ROOM,
  SET_FOR,
  STILL_WAITING,
  type StoryFact,
} from './coachWeekVoice';
import type { BeatKind, StoryKind, Timing } from './types';
import { say, type Line } from './voice';

const man = (o: Partial<ManSheet> = {}): ManSheet => ({
  id: 1,
  first: 'Ty',
  last: 'Stokes',
  pos: 'defensive lineman',
  years: 'a third-year man',
  role: 'starter',
  captain: false,
  personality: null,
  loud: false,
  calm: false,
  lean: null,
  tier: null,
  sound: null,
  friends: [],
  feud: null,
  mentor: null,
  mentee: null,
  habit: null,
  lastSeason: null,
  backFromInjury: false,
  finalYear: false,
  rookieDeal: false,
  underpaid: false,
  asks: 'first',
  lastAnswer: null,
  kept: false,
  broken: false,
  dispute: false,
  draftedHere: false,
  homecoming: false,
  grudgeGame: false,
  mood: 'Okay',
  reason: null,
  ...o,
});
const moment = (o: Partial<MomentSheet> = {}): MomentSheet => ({
  record: 'even',
  streak: null,
  lastGame: null,
  rival: false,
  seasonOver: false,
  week: 'regular',
  ...o,
});
const coach: CoachSheet = {
  name: 'Dan Hale',
  style: 'plain',
  motto: 'Next man up.',
  isNew: false,
  word: 'steady',
};
const at = { key: 'k', slot: 's' };
/** What a letter never says: digits, engine words, the old shrug, an em dash. */
const BAD =
  /\d|—|shrug|\b(standing|weight|influence|tier|hierarchy|cohesion|chemistry|morale|credibility|score|faction|clique|rating)\b|super bowl|\bAFC\b|\bNFC\b/i;
const clean = (s: string) => {
  expect(s.length).toBeGreaterThan(0);
  expect(s).not.toMatch(BAD);
  expect(s).not.toContain('..');
};
/** Every line of a bank, as it reads for one fact: the ones whose condition fits. */
const every = <C>(bank: readonly Line<C>[], c: C) => bank.filter((l) => !l.when || l.when(c)).map((l) => l.text(c));

describe('the head coach’s weekly lines', () => {
  it('every headline for a season of beats is different', () => {
    const beats: [StoryKind, BeatKind][] = [
      ['deal', 'asked'],
      ['deal', 'answered'],
      ['deal', 'promised'],
      ['deal', 'commitment'],
      ['deal', 'kept'],
      ['deal', 'broken'],
      ['deal', 'settled'],
      ['snaps', 'asked'],
      ['snaps', 'kept'],
      ['benched', 'sat'],
      ['benched', 'satAgain'],
      ['benched', 'backIn'],
      ['losing', 'asked'],
      ['losing', 'lifted'],
      ['feud', 'started'],
      ['feud', 'ended'],
      ['room', 'turned'],
      ['room', 'eased'],
      ['room', 'recovered'],
      ['room', 'suggested'],
      ['room', 'held'],
      ['room', 'commitment'],
      ['staff', 'doubt'],
      ['staff', 'warned'],
      ['staff', 'worn'],
      ['staff', 'recovered'],
    ];
    const heads = beats.map(([kind, beat]) =>
      say(
        HEADLINE,
        { kind, beat, man: man(), mate: 'Hill', noun: 'the D-line', coach: 'Hayes' } satisfies StoryFact,
        at,
      ),
    );
    expect(new Set(heads).size).toBe(beats.length);
    for (const h of heads) {
      clean(h);
      expect(h.split(' ').length).toBeLessThanOrEqual(8);
    }
    const f = (kind: StoryKind, beat: BeatKind): StoryFact => ({ kind, beat, man: man(), noun: 'the D-line' });
    expect(say(HEADLINE, f('deal', 'asked'), at)).toBe("Stokes's deal");
    expect(say(HEADLINE, f('deal', 'settled'), at)).toBe('Stokes signed');
    expect(say(HEADLINE, f('room', 'turned'), at)).toBe('The D-line');
  });

  it('a headline for a beat no line knows still names its subject', () => {
    expect(say(HEADLINE, { kind: 'deal', beat: 'sat', man: man() }, at)).toBe("Stokes's deal");
    expect(say(HEADLINE, { kind: 'room', beat: 'sat', noun: 'the receivers' }, at)).toBe('The receivers');
  });

  it('says the room is steadier when it read Down then and Settled now', () => {
    const line = say(RESULT_ROOM, { noun: 'the D-line', then: 'Down', now: 'Settled' }, at);
    expect(line).toMatch(/steadier|was down when we met/);
    expect(say(RESULT_ROOM, { noun: 'the D-line', then: 'Split', now: 'Split' }, at)).toMatch(
      /Nothing moved|where it started/,
    );
    expect(say(RESULT_ROOM, { noun: 'the receivers', then: 'Down', now: 'Down' }, at)).not.toMatch(/receivers is/);
    expect(say(RESULT_ROOM, { noun: 'the receivers', then: 'Down', now: 'Tight' }, at)).toMatch(/receivers are|were/);
  });

  it('tells a man from where he is now, with his reason', () => {
    const f = {
      man: man({ mood: 'Poor', reason: 'Wants a new deal' }),
      outcome: 'lands',
      named: false,
      nowDown: true,
      topic: 'deal',
    } as const;
    expect(say(RESULT_MAN, f, at)).toMatch(/deal/);
    expect(say(RESULT_MAN, { ...f, outcome: 'bristles' }, at)).toMatch(/deal/);
    expect(say(RESULT_MAN, { ...f, outcome: 'none' }, at)).toMatch(/deal/);
    const better = { ...f, man: man({ mood: 'Good', reason: null }), nowDown: false } as const;
    expect(say(RESULT_MAN, better, at)).toMatch(/happier|fine now/);
    expect(say(RESULT_MAN, { ...better, outcome: 'bristles' }, at)).toMatch(/come around|all right/);
  });

  it('every bank reads clean for every fact it can be given', () => {
    const men = [
      man(),
      man({ asks: 'second', lastAnswer: { reply: 'promise', when: 'in week 4' } }),
      man({ asks: 'again', lastAnswer: { reply: 'reassure', when: 'at camp' }, broken: true }),
      man({ lastAnswer: { reply: 'firm', when: 'last season' }, kept: true, dispute: true }),
      man({ lastAnswer: { reply: 'ignored', when: 'over the winter' }, tier: 'leader', sound: 'stirs' }),
      man({ tier: 'voice', mood: 'Poor', reason: 'The losing is wearing on him' }),
    ];
    for (const m of men) {
      for (const l of every(BEFORE, { man: m })) clean(l);
      for (const l of every(STILL_WAITING, { man: m })) clean(l);
      for (const kind of ['deal', 'snaps', 'benched', 'losing', 'feud'] as StoryKind[])
        for (const share of ['part', 'most'] as const)
          for (const word of ['Down', 'Split'] as const)
            for (const l of every(LINK, { man: m, share, kind, noun: 'the D-line', word })) clean(l);
      for (const outcome of ['lands', 'bristles', 'none'] as const)
        for (const nowDown of [true, false])
          for (const named of [true, false])
            for (const topic of ['deal', 'snaps', 'none'] as const)
              for (const l of every(RESULT_MAN, { man: m, outcome, named, nowDown, topic })) clean(l);
    }
    for (const kind of ['deal', 'snaps', 'benched', 'losing', 'feud', 'room', 'staff'] as StoryKind[]) {
      for (const at2 of ['half', 'due'] as const)
        for (const noun of ['the D-line', 'the receivers'])
          for (const l of every(CLOCK, { kind, at: at2, man: man(), noun })) clean(l);
      for (const beat of [
        'kept',
        'broken',
        'recovered',
        'ended',
        'lifted',
        'left',
        'settled',
        'backIn',
        'relieved',
      ] as BeatKind[])
        for (const l of every(CLOSING, { kind, beat, man: man(), mate: 'Hill', noun: 'the D-line', coach: 'Hayes' }))
          clean(l);
    }
    const weeks: MomentSheet['week'][] = ['camp', 'deadline', 'push', 'bye', 'regular', 'playoffs', 'offseason'];
    for (const week of weeks)
      for (const streak of [null, { kind: 'lost', games: 'three' }, { kind: 'won', games: 'four' }] as const)
        for (const link of [undefined, { noun: 'the D-line', man: 'Stokes', word: 'Down' as const }])
          for (const result of [true, false])
            for (const l of every(OPENING, {
              moment: moment({ week, streak, rival: true, seasonOver: week === 'offseason' }),
              coach,
              items: 2,
              asks: 1,
              link,
              top: { kind: 'deal', man: 'Stokes' },
              result,
              closing: true,
            }))
              clean(l);
    for (const timing of ['afterGame', 'monday', 'wednesday'] as Timing[])
      for (const l of every(SET_FOR, { timing, scope: 'DL', noun: 'the D-line', backing: 'talks' })) clean(l);
    for (const then of ['Down', 'Split', null] as const)
      for (const now of ['Tight', 'Settled', 'Restless', 'Down', 'Split', null] as const)
        for (const l of every(RESULT_ROOM, { noun: 'the D-line', then, now })) clean(l);
  });

  it('ties the week to a linked room and names the man', () => {
    const line = say(
      OPENING,
      {
        moment: moment(),
        coach,
        items: 3,
        asks: 1,
        link: { noun: 'the D-line', man: 'Stokes', word: 'Down' },
        result: false,
        closing: false,
      },
      at,
    );
    expect(line).toMatch(/Stokes/);
    expect(line).toMatch(/D-line is down/);
  });

  it('a benching answer is never called back as a talk: no promise waiting, no no, no "about this before"', () => {
    for (const reply of ['promise', 'reassure', 'firm'] as const)
      for (const kept of [false, true]) {
        const m = man({ asks: 'second', lastAnswer: { reply, when: 'in week 4', cause: 'benched' }, kept });
        for (const l of every(BEFORE, { man: m, cause: 'deal' }))
          expect(l).not.toMatch(
            /your word, and|make it right|patient|hang in|told him no|turned him down|about this|raised it/,
          );
      }
  });

  it('calls back to what you told a man, by when', () => {
    const line = say(BEFORE, { man: man({ asks: 'second', lastAnswer: { reply: 'promise', when: 'at camp' } }) }, at);
    expect(line).toMatch(/at camp/i);
    expect(
      say(BEFORE, { man: man({ asks: 'second', lastAnswer: { reply: 'reassure', when: 'in week 4' } }) }, at),
    ).toMatch(/week four/);
    expect(say(BEFORE, { man: man({ broken: true }) }, at)).toMatch(/promise|word/);
  });

  it('sets the meeting for the time it was set', () => {
    expect(say(SET_FOR, { timing: 'wednesday', scope: 'DL', noun: 'the D-line', backing: 'words' }, at)).toMatch(
      /Wednesday/,
    );
    expect(say(SET_FOR, { timing: 'afterGame', scope: 'DL', noun: 'the D-line', backing: 'words' }, at)).toMatch(
      /after the game/,
    );
  });

  it('no line claims what its facts do not say', () => {
    // A man who reads Poor now is never happier, whatever he heard.
    for (const outcome of ['lands', 'bristles', 'none'] as const)
      for (const named of [true, false])
        for (const topic of ['deal', 'none'] as const) {
          const f = { man: man({ mood: 'Poor', reason: 'Wants a new deal' }), outcome, named, nowDown: true, topic };
          for (const l of every(RESULT_MAN, f)) expect(l).not.toMatch(/happier|fine now|all right|come around/);
          const g = { ...f, man: man({ mood: 'Good' }), nowDown: false };
          for (const l of every(RESULT_MAN, g)) expect(l).not.toMatch(/down now|bothering him/);
        }
    // A broken promise is never "still waiting".
    const broken = man({ broken: true, kept: true, lastAnswer: { reply: 'promise', when: 'at camp' } });
    for (const l of every(BEFORE, { man: broken })) expect(l).not.toMatch(/still waiting|Nothing yet|kept your word/);
    // A team-scope result has no room read to compare.
    expect(every(RESULT_ROOM, { noun: 'the team', then: 'Down', now: null })).toEqual([]);
    expect(every(RESULT_ROOM, { noun: 'the team', then: null, now: null })).toEqual([]);
    // A bye claims only the bye.
    const bye = every(OPENING, {
      moment: moment({ week: 'bye' }),
      coach,
      items: 1,
      asks: 0,
      result: false,
      closing: false,
    });
    for (const l of bye) expect(l).not.toMatch(/talk to|used it|few things|needs you|rest/);
    // The opening states a fact of the week in plain words: nothing that only announces the letter, and players are players.
    const weeks: MomentSheet['week'][] = ['camp', 'deadline', 'push', 'bye', 'regular', 'playoffs', 'offseason'];
    for (const week of weeks)
      for (const streak of [null, { kind: 'lost', games: 'three' }, { kind: 'won', games: 'four' }] as const)
        for (const result of [true, false])
          for (const l of every(OPENING, {
            moment: moment({ week, streak, rival: true, seasonOver: week === 'offseason' }),
            coach,
            items: 2,
            asks: 1,
            link: { noun: 'the D-line', man: 'Stokes', word: 'Down' },
            top: { kind: 'deal', man: 'Stokes' },
            result,
            closing: true,
          }))
            expect(l).not.toMatch(/\b(here is|as I see it|my people|my desk|men|man)\b/i);
    // A week with nothing to open on has no opening: no line only announces the letter.
    expect(every(OPENING, { moment: moment(), coach, items: 2, asks: 0, result: false, closing: false })).toEqual([]);
    // A story with nobody to name says nothing about him.
    for (const l of every(CLOSING, { kind: 'deal', beat: 'kept' }))
      expect(l).toMatch(/^(That one|We can stop|That is)/);
    // A plural room takes a plural verb at its close.
    for (const l of every(CLOSING, { kind: 'room', beat: 'recovered', noun: 'the receivers' }))
      expect(l).not.toMatch(/receivers is|itself/);
  });
});
