import { describe, expect, it } from 'vitest';
import { runnerOf, shiftBelief } from './belief';
import { createLeague } from './generate';
import { playWeek } from './league';
import { approachLabel, backingLabel, READ_LEAD, ASK } from './meetings/voice';
import { suggestFact } from './meetings/facts';
import { choicesFor } from './meetings/suggest';
import { moraleClock, moraleContext } from './morale';
import { beliefRows } from './staffNotes';
import { BELIEF_LINE, BELIEF_NOTE, BELIEF_WARN, beliefStaffLine, type BeliefFact } from './roomVoice';
import type { League, MeetingSuggestion } from './types';
import { say } from './voice';

const BANNED = /belief|chemistry|\bedge\b|\bmorale\b|\blevel\b|marble|\btraits?\b|z-score|undefined|NaN/i;
const fact = (o: Partial<BeliefFact> = {}): BeliefFact => ({
  unit: 'the receivers',
  read: 'doubts',
  coach: 'Harris',
  side: 'offense',
  ...o,
});
const base = (() => {
  const l = createLeague({ seed: 'belief-words' });
  playWeek(l);
  playWeek(l);
  return JSON.stringify(l);
})();
const fresh = (): League => JSON.parse(base);

describe('backing the staff in the coach’s words (L4)', () => {
  it('every line reads clean: no digits, no engine words, the man named', () => {
    for (const unit of ['the receivers', 'the line', 'the secondary', 'the linebackers'])
      for (const read of ['believes', 'steady', 'doubts', 'lost'] as const)
        for (const lawyer of [undefined, 'Mitchell', 'Ross'])
          for (const side of ['offense', 'defense'] as const) {
            const f = fact({ unit, read, side, ...(lawyer ? { lawyer } : {}) });
            for (const bank of [BELIEF_WARN, BELIEF_NOTE, BELIEF_LINE])
              for (const k of ['a', 'b']) {
                const s = say(bank, f, { key: k, slot: 's' });
                expect(s).not.toMatch(/\d/);
                expect(s).not.toMatch(BANNED);
                expect(s).not.toMatch(/ is been |line' |s's stirring/);
              }
          }
    expect(say(BELIEF_NOTE, fact({ lawyer: 'Mitchell' }), { key: 'k', slot: 's' })).toMatch(/Harris.*Mitchell/);
    expect(say(BELIEF_LINE, fact({ read: 'steady' }), { key: 'k', slot: 's' })).toBe('');
  });

  it('the Coaches screen groups his rooms by how they take him', () => {
    expect(
      beliefStaffLine([
        fact({ unit: 'the line', read: 'believes' }),
        fact({ unit: 'the receivers', read: 'believes' }),
        fact({ unit: 'the backs', read: 'doubts' }),
      ]),
    ).toBe('The line and the receivers believe in him; the backs have doubts.');
    expect(beliefStaffLine([fact({ read: 'steady' })])).toBe('');
  });

  it('the position coach warns once, the step a room falls, and not once it is in doubt', () => {
    const l = fresh();
    const t = l.userTeamId;
    const clock = moraleClock(l);
    l.teams[t].beliefFell = { clock, rooms: ['WR'] };
    shiftBelief(runnerOf(l, t, 'WR')!, 'WR', -0.15);
    const rows = beliefRows(l, new Set());
    expect(rows).toHaveLength(1);
    expect(rows[0].note).not.toMatch(/\d/);
    expect(beliefRows(l, new Set([rows[0].key]))).toHaveLength(0);
    // A fall from an earlier step isn't this week's news.
    l.teams[t].beliefFell = { clock: clock - 1, rooms: ['WR'] };
    expect(beliefRows(l, new Set())).toHaveLength(0);
    // Past the warning into doubt: the head coach's to tell.
    l.teams[t].beliefFell = { clock, rooms: ['WR'] };
    shiftBelief(runnerOf(l, t, 'WR')!, 'WR', -0.3);
    expect(beliefRows(l, new Set())).toHaveLength(0);
  });

  it('the meeting letter names the coordinator, and the two choices read plainly', () => {
    const l = fresh();
    const t = l.userTeamId;
    const oc = runnerOf(l, t, 'WR')!;
    oc.belief = { WR: -0.3 };
    const ctx = moraleContext(l);
    const s: MeetingSuggestion = {
      clock: moraleClock(l),
      scope: 'WR',
      kind: 'trouble',
      topic: 'coordinator',
      ...choicesFor(l, t, 'WR', 'trouble', 'coordinator', undefined, ctx),
    };
    const f = suggestFact(l, t, s, ctx);
    expect(say(READ_LEAD, f, { key: 'k', slot: 'lead' })).toBe(
      `The receivers have doubts about ${oc.lastName}'s calls.`,
    );
    expect(say(ASK, f, { key: 'k', slot: 'ask' })).toContain(`stand behind ${oc.lastName}`);
    expect(approachLabel('backHim', f)).toBe('Stand behind him');
    expect(backingLabel('notice', f)).toBe("He's on notice");
  });
});
