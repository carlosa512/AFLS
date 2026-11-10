import { describe, expect, it } from 'vitest';
import type { ManSheet, MomentSheet } from './castSheet';
import { askWords, ASK_CLOSE, ASK_COLOR, ASK_CORE, ASK_HISTORY, type AskFact } from './playerVoice';
import type { TalkCause } from './types';

const man = (o: Partial<ManSheet> = {}): ManSheet => ({
  id: 1,
  first: 'Sam',
  last: 'Hale',
  pos: 'linebacker',
  years: 'a six-year veteran',
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
  mood: null,
  reason: null,
  ...o,
});
const moment = (o: Partial<MomentSheet> = {}): MomentSheet => ({
  record: 'losing',
  streak: null,
  lastGame: null,
  rival: false,
  seasonOver: false,
  week: 'regular',
  ...o,
});
const fact = (m: Partial<ManSheet> = {}, cause: TalkCause = 'losing', mo: Partial<MomentSheet> = {}): AskFact => ({
  man: man(m),
  moment: moment(mo),
  cause,
});

describe('askWords', () => {
  it('forty different men with one grievance write at least thirty different letters', () => {
    const recent: string[] = [];
    const leans = [null, 'money', 'winning', 'loyal'] as const;
    const tiers = [null, 'leader', 'voice'] as const;
    const sounds = [null, 'stirs', 'steadies'] as const;
    const letters: string[] = [];
    for (let i = 0; i < 40; i++) {
      const f = fact(
        {
          id: i,
          loud: i % 5 === 0,
          calm: i % 5 === 1,
          lean: leans[i % 4],
          tier: tiers[i % 3],
          sound: sounds[(i >> 1) % 3],
          habit: i % 7 === 0 ? { label: 'A habit', clause: 'does a thing' } : null,
          finalYear: i % 3 === 0,
          asks: i % 4 === 0 ? 'second' : 'first',
          years: i % 6 === 0 ? 'a second-year man' : 'a six-year veteran',
        },
        'losing',
      );
      letters.push(askWords(f, { key: `k:${i}`, recent }));
    }
    expect(new Set(letters).size).toBeGreaterThanOrEqual(30);
  });

  it('two men in one letter never share a sentence', () => {
    const recent: string[] = [];
    const a = askWords(fact({ id: 1 }), { key: 'a', recent });
    const b = askWords(fact({ id: 2 }), { key: 'b', recent });
    const split = (s: string) => s.split(/(?<=[.?!]) /);
    const shared = split(a).filter((s) => split(b).includes(s));
    expect(shared).toEqual([]);
  });

  it('a second ask says what you told him last time', () => {
    const f = fact({ asks: 'second', lastAnswer: { reply: 'reassure', when: 'in week 8' } });
    expect(askWords(f, { key: 'x', recent: [] })).toMatch(/week 8/);
  });

  it('a first ask carries no history', () => {
    const text = askWords(fact(), { key: 'x', recent: [] });
    expect(text).not.toMatch(/promise|second time|you said|you told me/i);
  });

  it('bank sizes and coverage', () => {
    // The lines some sheet can reach for a cause: plain ones, and those a sheet fact opens up.
    const sheets: Partial<ManSheet>[] = [
      {},
      { loud: true },
      { calm: true },
      { role: 'depth' },
      { role: 'rotation' },
      { years: 'a rookie' },
      { backFromInjury: true },
      { draftedHere: true },
      { feud: { with: 'Ames' }, captain: true },
    ];
    for (const cause of ['snaps', 'deal', 'losing', 'feud'] as const) {
      const core = ASK_CORE.filter((l) =>
        sheets.some((m) =>
          [{}, { record: 'winning' as const }, { streak: { kind: 'lost' as const, games: 'three' } }].some((mo) =>
            l.when!(fact(m, cause, mo)),
          ),
        ),
      );
      expect(core.length).toBeGreaterThanOrEqual(8);
      expect(core.filter((l) => (l.reads ?? 0) >= 2).length).toBeGreaterThanOrEqual(3);
    }
    expect(ASK_COLOR.length).toBeGreaterThanOrEqual(20);
    expect(ASK_HISTORY.length).toBeGreaterThanOrEqual(6);
    const colorFor = (m: Partial<ManSheet>) => ASK_COLOR.some((l) => l.when!(fact(m)));
    for (const m of [
      { lean: 'money' },
      { lean: 'winning' },
      { lean: 'loyal' },
      { tier: 'leader' },
      { tier: 'voice' },
      { sound: 'stirs' },
      { sound: 'steadies' },
      { habit: { label: 'x', clause: 'y' } },
      { finalYear: true },
      { underpaid: true },
      { captain: true },
      { homecoming: true },
      { feud: { with: 'Ames' } },
      { mentor: 'Ames' },
    ] as Partial<ManSheet>[])
      expect(colorFor(m)).toBe(true);
    for (const reply of ['promise', 'reassure', 'firm', 'ignored'] as const)
      expect(ASK_HISTORY.some((l) => l.when!(fact({ asks: 'second', lastAnswer: { reply, when: 'at camp' } })))).toBe(
        true,
      );
    expect(ASK_HISTORY.some((l) => l.when!(fact({ broken: true })))).toBe(true);
    expect(ASK_CLOSE.length).toBeGreaterThanOrEqual(8);
  });

  it('no line holds a rating-like number or a banned word', () => {
    const BAD = /\b(1?\d|20)\/20\b|\d|marble|\btraits?\b|z-score|shrug|super bowl|\bAFC\b|\bNFC\b|—/i;
    const sheets: Partial<ManSheet>[] = [
      {},
      {
        loud: true,
        feud: { with: 'Ames' },
        mentor: 'Bell',
        mentee: 'Cole',
        friends: ['Dunn'],
        asks: 'again',
        lastAnswer: { reply: 'promise', when: 'in week eight' },
        broken: true,
        kept: true,
      },
    ];
    for (const bank of [ASK_HISTORY, ASK_CORE, ASK_COLOR, ASK_CLOSE])
      for (const l of bank)
        for (const cause of ['snaps', 'deal', 'losing', 'feud'] as const)
          for (const s of sheets) {
            const f = fact(s, cause, { streak: { kind: 'lost', games: 'three' } });
            if (l.when && !l.when(f)) continue;
            expect(l.text(f)).not.toMatch(BAD);
          }
  });
});

describe('a benching answer is not a talk answer', () => {
  const FALSE =
    /still waiting|make it right|be fine|be patient|hang in there|firm with me|to me straight|never heard|silence|follow through/;
  const every = (bank: readonly { when?: (f: AskFact) => boolean; text: (f: AskFact) => string }[], f: AskFact) =>
    bank.filter((l) => !l.when || l.when(f)).map((l) => l.text(f));

  it('a man told he was back in, who started, then asks about his deal: no line reads a talk promise or a no', () => {
    for (const reply of ['promise', 'reassure', 'firm'] as const)
      for (const kept of [false, true]) {
        const f = fact({ asks: 'second', lastAnswer: { reply, when: 'in week 4', cause: 'benched' }, kept }, 'deal');
        for (const bank of [ASK_HISTORY, ASK_CLOSE]) for (const t of every(bank, f)) expect(t).not.toMatch(FALSE);
      }
  });

  it('"follow through" never follows a kept promise', () => {
    const f = fact({ asks: 'second', lastAnswer: { reply: 'promise', when: 'at camp', cause: 'deal' }, kept: true });
    for (const t of every(ASK_CLOSE, f)) expect(t).not.toMatch(/follow through/);
    const open = fact({ asks: 'second', lastAnswer: { reply: 'promise', when: 'at camp', cause: 'deal' } });
    expect(every(ASK_CLOSE, open)).toContain("I'm asking you to follow through.");
  });
});
