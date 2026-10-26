import { describe, expect, it } from 'vitest';
import { chairHolder, teamCoaches } from './coaching';
import { createLeague } from './generate';
import { coachBlame, drawOffseason, ownerBag, ownerCalm, seasonHeat } from './ownerBag';
import { Rng } from './rng';
import type { League, OwnerBag, SeasonSummary } from './types';

const rec = (w: number) => ({ w, l: 17 - w, t: 0 });
const bag = (b: Partial<OwnerBag>): OwnerBag => ({
  season: 0,
  calm: 6,
  gm: 0,
  coach: 0,
  gmId: 0,
  coachId: 0,
  ...b,
});

/** Last season's results for every club, with team 0's head coach credited for it. */
function season(l: League, w: number, playoffs = false) {
  const s = l.season;
  l.history.push({
    season: s,
    championId: 1,
    runnerUpId: 2,
    records: Object.fromEntries(l.teams.map((t) => [t.id, rec(w)])),
    ...(playoffs ? { playoffs: { 0: { w: 0, l: 1, round: 'wildCard' } } } : {}),
  } as SeasonSummary);
  const hc = chairHolder(teamCoaches(l, 0), { role: 'headCoach' })!;
  (hc.career ??= []).push({ teamId: 0, season: s, role: 'headCoach' });
  l.season++;
}

describe("the owner's marble bag", () => {
  it('puts more heat in for a worse season, and none for a winning one', () => {
    expect([2, 4, 6, 8, 9, 13].map((w) => seasonHeat(rec(w)))).toEqual([4, 3, 2, 1, 0, 0]);
  });

  it('blames a talented roster losing on the head coach and a thin one on the GM', () => {
    expect(coachBlame(0, 32, rec(4))).toBeGreaterThan(0.6);
    expect(coachBlame(31, 32, rec(4))).toBeLessThan(0.5);
    for (const rank of [0, 15, 31]) {
      expect(coachBlame(rank, 32, rec(0))).toBeLessThanOrEqual(0.85);
      expect(coachBlame(rank, 32, rec(8))).toBeGreaterThanOrEqual(0.35);
    }
  });

  it('gives a patient owner more calm marbles than a quick one', () => {
    const l = createLeague({ seed: 'owner-bag-calm' });
    const calms = l.teams.map((t) => ownerCalm(l, t.id));
    expect(Math.min(...calms)).toBeGreaterThanOrEqual(5);
    expect(Math.max(...calms)).toBeLessThanOrEqual(9);
    expect(new Set(calms).size).toBeGreaterThan(1);
  });

  it('builds heat over a losing run, once per season, and a playoff trip cools it', () => {
    const l = createLeague({ seed: 'owner-bag-fill' });
    const t = l.teams[0];
    ownerBag(l, t);
    season(l, 3);
    const one = { ...ownerBag(l, t) };
    expect(one.gm + one.coach).toBeGreaterThan(0);
    expect(ownerBag(l, t)).toEqual(one);
    season(l, 3);
    const two = { ...ownerBag(l, t) };
    expect(two.gm + two.coach).toBeGreaterThan(one.gm + one.coach);
    season(l, 11, true);
    const after = ownerBag(l, t);
    expect(after.gm).toBeLessThanOrEqual(Math.floor(two.gm / 2));
    expect(after.coach).toBeLessThanOrEqual(Math.floor(two.coach / 2));
  });

  it('starts a new GM clean, with the owner’s patience back', () => {
    const l = createLeague({ seed: 'owner-bag-new-gm' });
    const t = l.teams[0];
    ownerBag(l, t);
    season(l, 2);
    const b = ownerBag(l, t);
    b.calm = 2;
    b.gm = 5;
    t.gmId = l.teams[1].gmId;
    ownerBag(l, t);
    expect(b).toMatchObject({ gm: 0, calm: ownerCalm(l, t.id), gmId: t.gmId });
  });

  it('rarely acts on one 8–9 season, usually acts on a run of bad ones, and never lets a run last for ever', () => {
    let quiet = 0,
      longRuns = 0;
    for (let i = 0; i < 400; i++) {
      const rng = new Rng(`owner-bag-odds:${i}`);
      if (drawOffseason(bag({ gm: 1 }), 1, rng).gm) quiet++;
      // Three heat a year on the GM, three draws a review: the run ends by the fifth review almost every time.
      const b = bag({});
      let survived = 0;
      for (let y = 0; y < 5; y++) {
        b.gm += 3;
        if (drawOffseason(b, 3, rng).gm) break;
        survived++;
      }
      if (survived === 5) longRuns++;
    }
    // One heat marble against an average owner's six calm ones: about one time in seven.
    expect(quiet / 400).toBeLessThan(0.2);
    expect(longRuns / 400).toBeLessThan(0.03);
  });

  it('spends the calm marbles it draws, for good', () => {
    const b = bag({ calm: 3 });
    drawOffseason(b, 3, new Rng('spend'));
    expect(b.calm).toBe(0);
  });
});
