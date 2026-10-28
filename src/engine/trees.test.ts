import { describe, expect, it } from 'vitest';
import { createLeague } from './generate';
import { disciplesOf, linksOf, mainMentor } from './trees';
import type { Coach, CoachRole, League } from './types';

/** A league whose coaches' careers are cleared, so each test writes exactly the history it means. */
function blank(): { l: League; c: Coach[] } {
  const l = createLeague({ seed: 'trees' });
  const c = Object.values(l.coaches);
  for (const x of c) {
    x.career = [];
    delete x.pastUnder;
  }
  return { l, c };
}
const row = (
  season: number,
  teamId: number,
  role: CoachRole,
  extra: Partial<Coach['career'] extends (infer R)[] | undefined ? R : never> = {},
) => ({
  season,
  teamId,
  role,
  ...extra,
});

describe('coaching tree links', () => {
  it('needs three seasons together on a head coach’s staff', () => {
    const { l, c } = blank();
    const [hc, oc, dc] = c;
    hc.career = [2020, 2021, 2022].map((s) => row(s, 4, 'headCoach'));
    oc.career = [2020, 2021, 2022].map((s) => row(s, 4, 'offCoord'));
    dc.career = [2021, 2022].map((s) => row(s, 4, 'defCoord'));
    expect(linksOf(l, oc.id)).toEqual([expect.objectContaining({ mentorId: hc.id, seasons: 3, as: 'headCoach' })]);
    expect(linksOf(l, dc.id)).toEqual([]);
    expect(mainMentor(l, oc.id)?.id).toBe(hc.id);
    expect(disciplesOf(l, hc.id).map((x) => x.id)).toEqual([oc.id]);
  });

  it('adds up seasons under the same man at two clubs', () => {
    const { l, c } = blank();
    const [hc, oc] = c;
    hc.career = [row(2020, 4, 'headCoach'), row(2021, 4, 'headCoach'), row(2022, 9, 'headCoach')];
    oc.career = [row(2020, 4, 'offCoord'), row(2021, 4, 'offCoord'), row(2022, 9, 'offCoord')];
    expect(linksOf(l, oc.id)[0]).toMatchObject({ mentorId: hc.id, seasons: 3 });
  });

  it('credits an interim season to the head coach who had the most weeks', () => {
    const { l, c } = blank();
    const [hc, interim, oc] = c;
    const rec = (fromWeek: number, throughWeek: number) => ({
      record: { fromWeek, throughWeek, regular: { w: 0, l: 0, t: 0 }, playoffs: null, champion: false },
    });
    hc.career = [row(2020, 4, 'headCoach'), row(2021, 4, 'headCoach'), row(2022, 4, 'headCoach', rec(1, 6))];
    interim.career = [row(2022, 4, 'headCoach', rec(7, 18))];
    oc.career = [2020, 2021, 2022].map((s) => row(s, 4, 'offCoord'));
    expect(linksOf(l, oc.id).find((k) => k.mentorId === hc.id)).toBeUndefined();
  });

  it('links a position coach to his side’s coordinator', () => {
    const { l, c } = blank();
    const [oc, qbCoach] = c;
    oc.career = [2020, 2021, 2022].map((s) => row(s, 4, 'offCoord'));
    qbCoach.career = [2020, 2021, 2022].map((s) => row(s, 4, 'positionCoach', { room: 'QB' }));
    expect(linksOf(l, qbCoach.id)).toEqual([
      expect.objectContaining({ mentorId: oc.id, seasons: 3, as: 'coordinator' }),
    ]);
  });

  it('counts founding history kept in pastUnder', () => {
    const { l, c } = blank();
    const [hc, oc] = c;
    oc.pastUnder = [{ coachId: hc.id, role: 'offCoord', seasons: 4 }];
    expect(linksOf(l, oc.id)).toEqual([expect.objectContaining({ mentorId: hc.id, seasons: 4, as: 'headCoach' })]);
    expect(mainMentor(l, oc.id)?.id).toBe(hc.id);
  });
});
