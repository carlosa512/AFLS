import { describe, expect, it } from 'vitest';
import { BELIEF, beliefOf, runnerOf, shiftBelief, meetingBelief } from '../belief';
import { createLeague } from '../generate';
import { playWeek } from '../league';
import { moraleContext } from '../morale';
import { relieveCoordinator } from '../relieve';
import type { Commitment, League, MeetingRecord, MeetingSuggestion } from '../types';
import { judgeCommitments } from './commitments';
import { reactionScore } from './react';
import { choicesFor, headCoachOf, meetingsOf, membersOf, troubles } from './suggest';

const base = (() => {
  const l = createLeague({ seed: 'coordinator-doubt' });
  playWeek(l);
  playWeek(l);
  return JSON.stringify(l);
})();
const fresh = (): League => JSON.parse(base);

describe('meetings: a room doubting its coordinator', () => {
  it('a room turning on its coordinator is trouble once', () => {
    const l = fresh();
    const t = l.userTeamId;
    shiftBelief(runnerOf(l, t, 'OL')!, 'OL', -0.3);
    const ctx = moraleContext(l);
    expect(troubles(l, t, ctx).some((x) => x.scope === 'OL' && x.topic === 'coordinator')).toBe(true);
    meetingsOf(l.teams[t]).doubts = ['OL'];
    expect(troubles(l, t, ctx).some((x) => x.scope === 'OL' && x.topic === 'coordinator')).toBe(false);
  });

  it("offers Stand behind him and He's on notice for it", () => {
    const l = fresh();
    const t = l.userTeamId;
    const ctx = moraleContext(l);
    const c = choicesFor(l, t, 'OL', 'trouble', 'coordinator', undefined, ctx);
    expect(c.approaches[0]).toBe('backHim');
    expect(c.backings).toContain('notice');
    const other = choicesFor(l, t, 'OL', 'trouble', 'losing', undefined, ctx);
    expect(other.approaches).not.toContain('backHim');
    expect(other.backings).not.toContain('notice');
  });

  it('standing behind him fits a fresh doubt better than a lost room', () => {
    const l = fresh();
    const t = l.userTeamId;
    const oc = runnerOf(l, t, 'OL')!;
    oc.youth = 12;
    oc.veterans = 12;
    const ctx = moraleContext(l);
    const s: MeetingSuggestion = {
      clock: l.moraleAt ?? 0,
      scope: 'OL',
      kind: 'trouble',
      topic: 'coordinator',
      ...choicesFor(l, t, 'OL', 'trouble', 'coordinator', undefined, ctx),
    };
    const p = membersOf(l, t, 'OL')[0];
    const choice = { approach: 'backHim' as const, backing: 'words' as const, timing: 'monday' as const };
    oc.belief = { OL: -0.3 };
    const freshDoubt = reactionScore(l, t, p, s, choice, ctx);
    oc.belief = { OL: -0.7 };
    expect(reactionScore(l, t, p, s, choice, ctx)).toBeLessThan(freshDoubt);
  });

  it("a meeting that lands lifts the room's belief, standing behind him twice as much", () => {
    const l = fresh();
    const t = l.userTeamId;
    const men = membersOf(l, t, 'OL');
    const weights = new Map(men.map((p) => [p.id, 1]));
    const record = (approach: MeetingRecord['approach'], lands: boolean): MeetingRecord => ({
      clock: 0,
      scope: 'OL',
      kind: 'trouble',
      approach,
      backing: 'words',
      timing: 'monday',
      outcomes: { lands: lands ? men.map((p) => p.id) : [], bristles: lands ? [] : men.map((p) => p.id) },
    });
    const oc = runnerOf(l, t, 'OL')!;
    const at = (approach: MeetingRecord['approach'], lands: boolean) => {
      delete oc.belief;
      meetingBelief(l, t, record(approach, lands), weights);
      return beliefOf(oc, 'OL');
    };
    expect(at('straight', true)).toBeCloseTo(BELIEF.lands, 9);
    expect(at('backHim', true)).toBeCloseTo(2 * BELIEF.lands, 9);
    expect(at('straight', false)).toBeCloseTo(-BELIEF.bristles, 9);
    expect(at('backHim', false)).toBeCloseTo(-2 * BELIEF.bristles, 9);
  });
});

describe("meetings: He's on notice", () => {
  const notice = (l: League, belief: number) => {
    const t = l.userTeamId;
    const oc = runnerOf(l, t, 'OL')!;
    oc.belief = { OL: belief };
    l.moraleAt ??= l.season * 32;
    const c: Commitment = {
      backing: 'notice',
      scope: 'OL',
      opened: l.moraleAt,
      closes: l.moraleAt + 4,
      named: [],
      boughtIn: [],
      by: 'coach',
      coord: oc.id,
      coachId: headCoachOf(l, t)!.id,
    };
    meetingsOf(l.teams[t]).open.push(c);
    return { t, oc };
  };
  const step = (l: League, by = 1) => {
    l.moraleAt! += by;
    judgeCommitments(l);
  };
  const last = (l: League, t: number) => meetingsOf(l.teams[t]).settled?.at(-1);

  it('is kept when the room climbs out of doubt', () => {
    const l = fresh();
    const { t, oc } = notice(l, -0.1);
    step(l);
    expect(last(l, t)?.kept).toBe(true);
    expect(last(l, t)?.coord).toBe(oc.id);
    expect(beliefOf(oc, 'OL')).toBeCloseTo(-0.1 + BELIEF.kept, 6);
  });

  it('is kept when the man is gone from his chair', () => {
    const l = fresh();
    const { t, oc } = notice(l, -0.4);
    relieveCoordinator(l, t, oc.id);
    step(l);
    expect(last(l, t)?.kept).toBe(true);
  });

  it('is broken when the window closes with the room in doubt and him still there', () => {
    const l = fresh();
    const { t, oc } = notice(l, -0.3);
    step(l, 4);
    expect(last(l, t)?.kept).toBe(false);
    expect(beliefOf(oc, 'OL')).toBeCloseTo(-0.3 + BELIEF.broken, 6);
  });

  it('a coordinator gone from the league counts as gone, never throws', () => {
    const l = fresh();
    const { t, oc } = notice(l, -0.4);
    delete l.coaches[oc.id];
    l.coaches = { ...l.coaches };
    expect(() => step(l)).not.toThrow();
    expect(last(l, t)?.kept).toBe(true);
  });
});
