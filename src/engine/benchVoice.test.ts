import { describe, expect, it } from 'vitest';
import type { BenchFact } from './benching';
import {
  BENCH_ASK,
  BENCH_BEFORE,
  BENCH_CLOSE,
  BENCH_REPLY,
  BENCH_STILL,
  BENCH_TOOK,
  benchSaid,
  CLEARED,
  CLOSE_ENDS,
  JOBS_ROW,
  type BenchCloseFact,
} from './benchVoice';
import type { ManSheet } from './castSheet';
import type { BeatKind } from './types';
import { say, type Line } from './voice';

const man = (o: Partial<ManSheet> = {}): ManSheet => ({
  id: 1,
  first: 'Ty',
  last: 'Stokes',
  pos: 'quarterback',
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
const fact = (o: Partial<BenchFact> = {}): BenchFact => ({
  man: man(),
  other: man({ id: 2, last: 'Reyes' }),
  by: 'you',
  backFromInjury: false,
  role: 'holder',
  weeksOpen: 'no',
  otherAsked: false,
  better: false,
  wordBroken: null,
  ...o,
});

/** What a line never says: digits, an em dash, the old shrug, engine words, an NFL nickname. */
const BAD =
  /\d|—|shrug|\b(standing|weight|influence|tier|hierarchy|cohesion|chemistry|morale|credibility|score|rating|trait)\b|super bowl|\bAFC\b|\bNFC\b/i;
const clean = (s: string) => {
  expect(s.length).toBeGreaterThan(0);
  expect(s).not.toMatch(BAD);
  expect(s).not.toContain('..');
};
const every = <C>(bank: readonly Line<C>[], c: C) => bank.filter((l) => !l.when || l.when(c)).map((l) => l.text(c));

const men = [
  man(),
  man({ years: 'a ten-year veteran', captain: true }),
  man({ years: 'a rookie', calm: true }),
  man({ loud: true, broken: true, dispute: true }),
  man({ backFromInjury: true, mood: 'Poor' }),
];
const facts: BenchFact[] = men.flatMap((m) =>
  (['holder', 'other'] as const).flatMap((role) =>
    (['you', 'staff'] as const).flatMap((by) =>
      [true, false].flatMap((withOther) =>
        ['no', 'one', 'two', 'three', 'many'].flatMap((weeksOpen) =>
          [true, false].flatMap((better) =>
            ([null, 'backIn', 'thisWeek', 'yours'] as const).map((wordBroken) =>
              fact({
                man: m,
                role,
                by,
                weeksOpen,
                better,
                wordBroken,
                backFromInjury: m.backFromInjury,
                other: withOther ? man({ id: 2, last: 'Reyes' }) : null,
                otherAsked: withOther && weeksOpen !== 'no',
              }),
            ),
          ),
        ),
      ),
    ),
  ),
);

describe('the benching chain’s words', () => {
  it('every ask, line before and week of waiting reads clean for every fact it can be given', () => {
    for (const f of facts) {
      for (const bank of [BENCH_ASK, BENCH_BEFORE, BENCH_STILL]) for (const t of every(bank, f)) clean(t);
      // A line that names the other man is only chosen when there is one.
      if (!f.other) for (const t of every(BENCH_ASK, f)) expect(t).not.toContain('undefined');
      expect(say(BENCH_ASK, f, { key: 'k', slot: 'ask' })).toBeTruthy();
    }
  });

  it('a word given and broken: no line says nobody told them, and the man it was given to says so', () => {
    for (const f of facts.filter((x) => x.wordBroken))
      for (const bank of [BENCH_ASK, BENCH_BEFORE, BENCH_STILL])
        for (const t of every(bank, f))
          expect(t).not.toMatch(/nobody (has told|is saying)|been told a thing|hasn't heard from you|nobody has told/i);
    // A line about the broken word is only his when the word was his: the holder's back in, the other man's job.
    const his = (f: BenchFact) =>
      f.role === 'holder' ? f.wordBroken === 'backIn' || f.wordBroken === 'thisWeek' : f.wordBroken === 'yours';
    for (const f of facts.filter((x) => x.wordBroken && !his(x)))
      for (const t of every(BENCH_ASK, f)) expect(t).not.toMatch(/You told me|You said/);
    expect(every(BENCH_ASK, fact({ role: 'other', wordBroken: 'yours' }))).toContain(
      'You told me it was mine. Then I sat.',
    );
  });

  it('with the staff sorting the chart no line says the GM sat, benched or moved him', () => {
    for (const f of facts.filter((x) => x.by === 'staff'))
      for (const bank of [BENCH_ASK, BENCH_BEFORE, BENCH_STILL])
        for (const t of every(bank, f)) expect(t).not.toMatch(/you (sat|benched|moved)|you set|you put|your lineup/i);
  });

  it('a ten-year captain and a second-year man do not ask the same way, and the man who took his job is named', () => {
    const vet = fact({ man: man({ years: 'a ten-year veteran', captain: true }) });
    const young = fact({ man: man({ years: 'a second-year man' }) });
    const a = say(BENCH_ASK, vet, { key: 'k', slot: 'ask' });
    const b = say(BENCH_ASK, young, { key: 'k', slot: 'ask' });
    expect(a).not.toBe(b);
    expect(a).toContain('Reyes');
    expect(b).toContain('Reyes');
  });

  it('a week later reads differently from the first week, and names the other man once he has asked', () => {
    const first = say(BENCH_ASK, fact(), { key: 'k', slot: 'ask' });
    const later = say(BENCH_STILL, fact({ weeksOpen: 'one', otherAsked: true }), { key: 'k', slot: 'still' });
    expect(later).not.toBe(first);
    expect(later).toContain('Reyes');
    expect(say(BENCH_STILL, fact({ weeksOpen: 'one' }), { key: 'k', slot: 'still' })).not.toContain('asking too');
  });

  it('how he took it, his reply, the reminder and the camp row read clean', () => {
    const replies = ['backIn', 'thisWeek', 'earn', 'his', 'yours', 'compete'] as const;
    for (const m of men)
      for (const reply of replies) {
        for (const down of [true, false]) for (const t of every(BENCH_TOOK, { man: m, reply, down })) clean(t);
        for (const t of every(BENCH_REPLY, { man: m, reply })) clean(t);
        clean(benchSaid(reply, 'Reyes'));
        clean(benchSaid(reply, undefined));
        expect(say(BENCH_TOOK, { man: m, reply, down: false }, { key: 'k', slot: 's' })).toBeTruthy();
        expect(say(BENCH_REPLY, { man: m, reply }, { key: 'k', slot: 's' })).toBeTruthy();
      }
    for (const m of men)
      for (const listed of ['second', 'third', 'down the chart']) {
        for (const t of every(CLEARED, { man: m, listed })) {
          clean(t);
          expect(t).toContain(listed);
          expect(t).toMatch(/Put him back\?$/);
        }
      }
    for (const ahead of [false, true]) {
      const close = { pos: 'left guard', first: 'Moore', second: 'Kelly', ahead };
      for (const t of every(JOBS_ROW, { lineup: 'Quarterback: Reyes.', close })) {
        clean(t);
        // A second man the scouts read higher is never "behind" the starter.
        if (ahead) expect(t).not.toMatch(/right behind|close to/);
      }
    }
    for (const t of every(JOBS_ROW, { lineup: 'Quarterback: Reyes.' })) clean(t);
  });

  it('every way a benching ends has its own line, and none falls back to "That one is closed"', () => {
    const ends: [BeatKind, string | undefined, boolean][] = [
      ['backIn', undefined, true],
      ['left', 'other', true],
      ['left', 'holder', true],
      ['left', 'holder', false],
      ['left', 'both', true],
      ['settled', 'out', true],
      ['settled', 'outHolder', true],
      ['settled', 'outOther', true],
      ['settled', 'his', true],
      ['settled', 'his', false],
      ['settled', 'keeps', true],
      ['settled', 'earned', true],
      ['settled', 'earnedBack', true],
      ['settled', 'chart', true],
      ['settled', 'chartBack', true],
    ];
    for (const [beat, how, withOther] of ends)
      for (const m of [null, ...men]) {
        const f: BenchCloseFact = {
          beat,
          ...(how ? { how } : {}),
          holder: 'Gibson',
          ...(withOther ? { other: 'Reyes' } : {}),
          man: m,
        };
        const lines = every(BENCH_CLOSE, f);
        for (const t of lines) {
          clean(t);
          expect(t).not.toMatch(/That one is closed/);
          expect(t).not.toContain('undefined');
        }
        // The specific line, not the plain fallback, wins.
        const said = say(BENCH_CLOSE, f, { key: 'k', slot: 's' });
        expect(said).not.toMatch(/^The question over/);
      }
    expect(
      say(
        BENCH_CLOSE,
        { beat: 'left', how: 'other', holder: 'Gibson', other: 'Reyes', man: null },
        { key: 'k', slot: 's' },
      ),
    ).toBe("Reyes has left, so it's Gibson's job again.");
  });

  it('sweep: every closing the engine can file reads a specific line, with and without a named other man', () => {
    for (const end of CLOSE_ENDS)
      for (const withOther of end.needsOther ? [true] : [true, false])
        for (const m of [null, ...men]) {
          const f: BenchCloseFact = {
            beat: end.beat,
            ...(end.how ? { how: end.how } : {}),
            holder: 'Gibson',
            ...(withOther ? { other: 'Reyes' } : {}),
            man: m,
          };
          const said = say(BENCH_CLOSE, f, { key: 'k', slot: 's' });
          expect(said, `${end.beat}/${end.how}/${withOther}`).not.toBe('');
          expect(said).not.toMatch(/^The question over|That one is closed/);
          expect(said).not.toContain('undefined');
          expect(said).toContain(end.how === 'both' || end.how === 'other' ? 'Reyes' : 'Gibson');
        }
  });
});
