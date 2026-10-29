import { describe, expect, it } from 'vitest';
import { RESERVED_NICKNAMES } from './data/teams';
import { createLeague } from './generate';
import { deliverMail } from './inbox';
import {
  CAPTAIN_WHY,
  FRICTION,
  GETTING_ALONG,
  GREW_UP,
  MENTOR_LOST,
  MENTOR_SUGGEST,
  VERDICT,
  type VerdictFact,
} from './lockerVoice';
import { mentoringWeek } from './mentoring';
import { nameCaptains } from './personality';
import { addTie } from './relationships';
import { TRADE_DEADLINE_WEEK } from './trade/rules';
import type { InboxMessage, League } from './types';
import { MOTTOS, say } from './voice';

const BANNED = /marble|\btraits?\b|z-score|super bowl|\bAFC\b|\bNFC\b/i;
const established = (seed: string) => {
  const l = createLeague({ seed });
  mentoringWeek(l);
  deliverMail(l);
  for (const m of l.inbox!) Object.assign(m, { phase: 'draft', week: 0 });
  l.inbox = l.inbox!.filter((m) => m.id.includes(':welcome:') || m.id.startsWith('rundown:'));
  return l;
};
const report = (l: League, prefix = 'locker:') => l.inbox!.filter((m) => m.id.startsWith(prefix)).at(-1)!;
const words = (m: InboxMessage) =>
  [
    m.body,
    ...(m.sections ?? []).flatMap((s) => [s.title, s.lead ?? '', ...s.rows.flatMap((r) => [...r.cells, r.note ?? ''])]),
  ].join(' ');
const quiet: VerdictFact = {
  checkin: 'cutdown',
  newFeuds: 0,
  standing: null,
  lost: 0,
  lostName: null,
  struggling: 0,
  friends: 0,
  grew: 0,
};

describe("the head coach's voice", () => {
  it('the same league writes the same report', () => {
    const a = established('voice-a');
    const b = structuredClone(a);
    for (const l of [a, b]) {
      l.phase = 'preseason';
      nameCaptains(l);
      deliverMail(l);
    }
    expect(report(b).body).toBe(report(a).body);
    expect(report(b).sections).toEqual(report(a).sections);
  });

  it('a feud from an earlier report that is still on reads "still"; a new one does not', () => {
    const l = established('voice-feud');
    const [x, y] = Object.values(l.players).filter((p) => p.teamId === l.userTeamId && p.position === 'OL');
    addTie(l, x, y, 'feud', 'benched');
    l.phase = 'regular';
    l.week = 1;
    deliverMail(l);
    expect(report(l).body).not.toMatch(/still/);
    l.week = TRADE_DEADLINE_WEEK;
    deliverMail(l);
    expect(report(l).body).toMatch(/still aren't talking/);
  });

  it('varies the verdict across letters', () => {
    const lines = new Set(
      ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((k) => say(VERDICT, quiet, { key: `locker:${k}`, slot: 'verdict' })),
    );
    expect(lines.size).toBeGreaterThan(1);
  });

  it("doesn't repeat a line from the coach's last letters when another fits", () => {
    const first = say(VERDICT, quiet, { key: 'locker:x', slot: 'verdict' });
    for (const k of ['a', 'b', 'c', 'd', 'e', 'f'])
      expect(say(VERDICT, quiet, { key: `locker:${k}`, slot: 'verdict', recent: [`${first} More.`] })).not.toBe(first);
  });

  it('says the motto at most once a report', () => {
    const l = established('voice-motto');
    l.phase = 'preseason';
    nameCaptains(l);
    deliverMail(l);
    const text = words(report(l));
    for (const m of MOTTOS) expect(text.split(m).length - 1).toBeLessThanOrEqual(1);
  });

  it('every bank has a line for any case, and none says what it must not', () => {
    const samples = [
      ...[
        quiet,
        { ...quiet, newFeuds: 1, lost: 1, lostName: 'Jefferson' },
        { ...quiet, checkin: 'end' as const, grew: 2 },
      ].map((f) => say(VERDICT, f, { key: 'k', slot: 'v' })),
      say(
        CAPTAIN_WHY,
        { role: 'offense', experience: 1, read: null, tone: null, kicker: false, qb: false },
        { key: 'k', slot: 'c' },
      ),
      say(MENTOR_LOST, { name: 'Hill', mentor: 'Zach Bynum', now: null, byYou: false }, { key: 'k', slot: 'l' }),
      say(
        MENTOR_SUGGEST,
        { name: 'Porter', mentor: 'Lewis', better: 'Nolan Roberts', status: 'not taking' },
        { key: 'k', slot: 's' },
      ),
      say(FRICTION, {}, { key: 'k', slot: 'f' }),
      say(GETTING_ALONG, { a: 'Arnold', b: 'Vincent', gone: 'traded' }, { key: 'k', slot: 'g' }),
      say(GREW_UP, { name: 'Carter', mentor: 'Cedric Tate' }, { key: 'k', slot: 'u' }),
    ];
    for (const s of samples) {
      expect(s.length).toBeGreaterThan(10);
      expect(s).not.toMatch(BANNED);
      for (const nick of RESERVED_NICKNAMES) expect(s).not.toMatch(new RegExp(`\\b${nick}\\b`, 'i'));
    }
  });
});
