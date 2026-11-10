import { describe, expect, it } from 'vitest';
import { setTrait } from '../coachTraits';
import { createLeague } from '../generate';
import { YEAR } from '../morale';
import { Rng } from '../rng';
import { activeRoster } from '../roster';
import { tierOf, unitOf, weightOf } from '../standing';
import { moraleContext } from '../morale';
import type { League, MeetingSuggestion } from '../types';
import { aiChoice } from './ai';
import { answerMeeting, leaveClub, meetingsStep, requestMeeting, setMeetingsByCoach } from './index';
import { headCoachOf } from './suggest';

const base = createLeague({ seed: 'meetings-ai' });
const USER = base.userTeamId;
const AI = USER === 5 ? 6 : 5;

function calm(week = 5): League {
  const l = structuredClone(base);
  l.phase = 'regular';
  l.week = week;
  l.moraleAt = l.season * YEAR + 8 + week;
  for (const p of Object.values(l.players)) {
    if (p.morale) p.morale = { level: 0.5 };
    delete p.ties;
  }
  return l;
}
/** Split a room of the club with a voice in it. */
function trouble(l: League, teamId: number): string {
  const ctx = moraleContext(l);
  for (const unit of ['WR', 'OL', 'DL', 'DB', 'LB', 'RB']) {
    const men = activeRoster(l, teamId).filter((p) => unitOf(p.position) === unit);
    if (!men.some((p) => tierOf(l, p, weightOf(l, p, ctx)) !== null)) continue;
    men.forEach((p, i) => (p.morale = { level: i % 2 ? 2 : -2 }));
    return unit;
  }
  throw new Error('no room');
}
const next = (l: League) => {
  l.moraleAt! += 1;
  l.week += 1;
  meetingsStep(l);
};

describe('meetings: clubs and the calendar', () => {
  it('an AI club with a split room holds a meeting and logs it', () => {
    const l = calm();
    const unit = trouble(l, AI);
    meetingsStep(l);
    const m = l.teams[AI].meetings!;
    expect(m.log.length).toBe(1);
    expect(m.log[0].scope).toBe(unit);
    expect(m.pending).toBeUndefined();
  });

  it('yours waits on you a step longer (the coach writes every other step), then lapses without coming straight back', () => {
    const l = calm();
    const unit = trouble(l, USER);
    meetingsStep(l);
    const m = l.teams[USER].meetings!;
    expect(m.pending?.scope).toBe(unit);
    expect(m.log).toEqual([]);
    const made = m.pending!;
    // The next step it is still the one waiting, the same suggestion: no second one while it is held.
    next(l);
    expect(m.pending).toBe(made);
    expect(m.pending!.clock).toBe(made.clock);
    // A step later it lapses.
    next(l);
    expect(m.pending).toBeUndefined();
  });

  it('let the coach handle it: he holds yours himself', () => {
    const l = calm();
    trouble(l, USER);
    setMeetingsByCoach(l, true);
    meetingsStep(l);
    expect(l.teams[USER].meetings!.log.length).toBe(1);
    expect(l.teams[USER].meetings!.pending).toBeUndefined();
  });

  it('you can answer it or say no', () => {
    const l = calm();
    trouble(l, USER);
    meetingsStep(l);
    answerMeeting(l, 'skip');
    expect(l.teams[USER].meetings!.pending).toBeUndefined();
    expect(l.teams[USER].meetings!.log).toEqual([]);
    const l2 = calm();
    trouble(l2, USER);
    meetingsStep(l2);
    const r = answerMeeting(l2, { approach: 'straight', backing: 'words', timing: 'monday' });
    expect(r?.approach).toBe('straight');
    expect(l2.teams[USER].meetings!.log.length).toBe(1);
  });

  it('a requested meeting respects the cooldowns', () => {
    const l = calm();
    const s = requestMeeting(l, 'WR');
    expect(s?.scope).toBe('WR');
    expect(s?.kind).toBe('trouble');
    answerMeeting(l, { approach: 'straight', backing: 'words', timing: 'monday' });
    expect(requestMeeting(l, 'WR')).toBeNull();
    l.moraleAt! += 3;
    expect(requestMeeting(l, 'WR')).toBeNull();
    l.moraleAt! += 1;
    expect(requestMeeting(l, 'WR')?.scope).toBe('WR');
  });

  it('a disciplinarian says it straight; a players’ coach lets a leader say it', () => {
    const l = calm();
    const s: MeetingSuggestion = {
      clock: l.moraleAt!,
      scope: 'WR',
      kind: 'trouble',
      topic: 'none',
      approaches: ['leader', 'straight', 'standard'],
      backings: ['words'],
      timings: ['afterGame', 'monday', 'wednesday'],
      named: [],
      leader: activeRoster(l, AI).find((p) => unitOf(p.position) === 'WR')!.id,
    };
    const hc = headCoachOf(l, AI)!;
    setTrait(hc, 'discipline', 18);
    expect(aiChoice(l, AI, s, new Rng('a'))?.approach).toBe('straight');
    setTrait(hc, 'discipline', 4);
    expect(aiChoice(l, AI, s, new Rng('a'))?.approach).toBe('leader');
    expect(aiChoice(l, AI, s, new Rng('a'))?.timing).toBe('monday');
  });

  it('a GM leaving a club leaves it nothing pending', () => {
    const l = calm();
    trouble(l, USER);
    meetingsStep(l);
    expect(l.teams[USER].meetings!.pending).toBeDefined();
    leaveClub(l, USER);
    expect(l.teams[USER].meetings!.pending).toBeUndefined();
    // And a club you no longer run lets anything pending lapse at the next step.
    const l2 = calm();
    trouble(l2, USER);
    meetingsStep(l2);
    l2.gms[l2.userGmId].teamId = AI;
    next(l2);
    expect(l2.teams[USER].meetings!.pending).toBeUndefined();
  });
});
