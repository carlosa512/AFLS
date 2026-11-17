import { describe, expect, it } from 'vitest';
import { beliefOf, runnerOf, shiftBelief } from './belief';
import {
  coordinatorOf,
  coveringHeadCoach,
  interimCandidates,
  promoteCover,
  promoteCoverProblem,
  protectCoach,
  relieveProblem,
  setHeadCoachCover,
  teamCoaches,
  VACANT,
} from './coaching';
import { createLeague } from './generate';
import { playWeek } from './league';
import { relieveCoordinator } from './relieve';
import { sideValue } from './staffEdge';
import type { League } from './types';

const base = (() => {
  const l = createLeague({ seed: 'relieve' });
  playWeek(l);
  playWeek(l);
  return JSON.stringify(l);
})();
const fresh = (): League => JSON.parse(base);
const oc = (l: League, t = 0) => teamCoaches(l, t).find((c) => c.role === 'offCoord')!;
const hc = (l: League, t = 0) => teamCoaches(l, t).find((c) => c.role === 'headCoach')!;

describe('relieving a coordinator mid-season', () => {
  it('relieves a coordinator only in camp and the regular season', () => {
    const l = fresh();
    expect(relieveProblem(l, 0, oc(l).id)).toBeNull();
    l.phase = 'preseason';
    expect(relieveProblem(l, 0, oc(l).id)).toBeNull();
    for (const phase of ['resign', 'playoffs'] as const) {
      l.phase = phase;
      expect(relieveProblem(l, 0, oc(l).id)).toBe('Coordinators can be relieved from camp through the regular season.');
    }
    l.phase = 'regular';
    expect(relieveProblem(l, 0, hc(l).id)).toBe(
      'Only your offensive or defensive coordinator can be relieved in season.',
    );
  });

  it("an owner's mandate blocks it and severance is booked", () => {
    const l = fresh();
    const c = oc(l);
    protectCoach(l, c.id, l.season, 'The owner wants him kept.');
    expect(relieveProblem(l, 0, c.id)).toMatch(/^Owner mandate/);
    const m = fresh();
    const d = oc(m);
    d.contract = { salary: 2000, through: m.season + 1 };
    const dead = m.teams[0].coachDead.length;
    relieveCoordinator(m, 0, d.id);
    expect(d.teamId).toBeNull();
    expect(m.teams[0].coachDead).toHaveLength(dead + 1);
    expect(m.teams[0].coachDead.at(-1)!.amount).toBe(2000);
  });

  it('the head coach covers by default and the rooms start fresh', () => {
    const l = fresh();
    const c = oc(l);
    const h = hc(l);
    shiftBelief(c, 'OL', -0.6);
    shiftBelief(h, 'OL', -0.3);
    h.coverOff = ['offCoord'];
    relieveCoordinator(l, 0, c.id);
    expect(runnerOf(l, 0, 'OL')?.id).toBe(h.id);
    expect(beliefOf(h, 'OL')).toBe(0);
    expect(h.coverOff ?? []).not.toContain('offCoord');
  });

  it('a position coach can step up as interim', () => {
    const l = fresh();
    const c = oc(l);
    const pc = interimCandidates(l, 0, 'offCoord')[0];
    expect(pc).toBeDefined();
    const room = pc.room!;
    relieveCoordinator(l, 0, c.id, pc.id);
    expect(pc.role).toBe('offCoord');
    expect(runnerOf(l, 0, 'QB')?.id).toBe(pc.id);
    expect(teamCoaches(l, 0).some((x) => x.role === 'positionCoach' && x.room === room)).toBe(false);
    expect(beliefOf(pc, 'QB')).toBe(0);
  });

  it('with nobody to step in the side reads vacant', () => {
    const l = fresh();
    const h = hc(l);
    h.teamId = null;
    l.coaches = { ...l.coaches };
    relieveCoordinator(l, 0, oc(l).id);
    expect(sideValue(l, 0, 'offCoord')).toBe(VACANT);
  });

  it('logs the change for SNN', () => {
    const l = fresh();
    const c = oc(l);
    relieveCoordinator(l, 0, c.id);
    const e = l.leadership.events.filter((x) => x.kind === 'coachRelieved');
    expect(e).toHaveLength(1);
    expect(e[0].teamId).toBe(0);
    expect(e[0].coachId).toBe(c.id);
    expect(e[0].report).toContain(`relieved offensive coordinator ${c.firstName} ${c.lastName} of his duties`);
  });
});

describe('promoting a coordinator while the head coach covers (2026-11-16)', () => {
  /** In season, the offensive coordinator relieved and the head coach running the offense. */
  const covered = () => {
    const l = fresh();
    relieveCoordinator(l, 0, oc(l).id);
    expect(coveringHeadCoach(teamCoaches(l, 0), 'offCoord')?.id).toBe(hc(l).id);
    return l;
  };

  it('a position coach on that side takes the chair on a one-year deal and the head coach stops covering', () => {
    const l = covered();
    const pc = interimCandidates(l, 0, 'offCoord')[0];
    expect(pc).toBeDefined();
    expect(promoteCoverProblem(l, 0, pc.id)).toBeNull();
    promoteCover(l, 0, pc.id);
    expect(coordinatorOf(teamCoaches(l, 0), 'offCoord')?.id).toBe(pc.id);
    expect(coveringHeadCoach(teamCoaches(l, 0), 'offCoord')).toBeNull();
    expect(pc.contract!.through).toBe(l.season);
  });

  it('only from camp through the regular season', () => {
    const l = covered();
    const pc = interimCandidates(l, 0, 'offCoord')[0];
    for (const phase of ['resign', 'freeAgency', 'playoffs'] as const) {
      l.phase = phase;
      expect(promoteCoverProblem(l, 0, pc.id)).toBe(
        'A coordinator can be promoted this way from camp through the regular season.',
      );
    }
    l.phase = 'preseason';
    expect(promoteCoverProblem(l, 0, pc.id)).toBeNull();
  });

  it('only while the head coach covers the chair', () => {
    const filled = fresh();
    const pc = interimCandidates(filled, 0, 'offCoord')[0];
    expect(promoteCoverProblem(filled, 0, pc.id)).toBe('The head coach isn’t running that side.');
    const off = covered();
    setHeadCoachCover(off, 0, 'offCoord', false);
    expect(promoteCoverProblem(off, 0, pc.id)).toBe('The head coach isn’t running that side.');
  });

  it('only a coach on that side who would step up', () => {
    const l = covered();
    const def = teamCoaches(l, 0).find(
      (c) => c.role === 'positionCoach' && !interimCandidates(l, 0, 'offCoord').includes(c),
    )!;
    expect(promoteCoverProblem(l, 0, def.id)).toBe('He won’t step up into that chair.');
  });
});
