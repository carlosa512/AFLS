import { beforeAll, describe, expect, it } from 'vitest';
import { assessCoachAdvice, coachOrder, START_LEAN, startLean } from './coachDecisions';
import { teamCoaches } from './coaching';
import { slotOvr } from './familiarity';
import { createLeague } from './generate';
import { buildAutoDepthChart, syncDepthChart, teamPlayers } from './roster';
import type { League, Player } from './types';

const clone = <T>(x: T): T => structuredClone(x);
let world: League;
beforeAll(() => {
  world = createLeague({ seed: 'start-lean' });
});

/** A WR of the team with every rating set to `r` and the public facts the lean reads. */
function wr(l: League, i: number, r: number, facts: Partial<Pick<Player, 'age' | 'experience' | 'draft'>>): Player {
  const p = clone(teamPlayers(l, 0).filter((p) => p.position === 'WR')[i]);
  for (const k of Object.keys(p.ratings) as (keyof typeof p.ratings)[]) p.ratings[k] = r;
  p.injury = undefined;
  p.draft = undefined;
  return Object.assign(p, facts);
}
const pick = (round: number) => ({ season: 1, round, pick: 1, teamId: 0 });

describe('the lineup lean (project B)', () => {
  it('startLean gives a first-round rookie the most, a second-rounder less, any young player some, half in his third season and nothing at 25 or after', () => {
    expect(startLean({ age: 22, experience: 0, draft: pick(1) })).toBeCloseTo(START_LEAN.firstRound);

    expect(startLean({ age: 22, experience: 0, draft: pick(2) })).toBeCloseTo(START_LEAN.secondRound);
    expect(startLean({ age: 22, experience: 0, draft: undefined })).toBeCloseTo(START_LEAN.young);
    expect(startLean({ age: 22, experience: 1, draft: pick(1) })).toBeCloseTo(START_LEAN.firstRound);
    expect(startLean({ age: 23, experience: 2, draft: pick(1) })).toBeCloseTo(START_LEAN.firstRound / 2);
    expect(startLean({ age: 24, experience: 3, draft: pick(1) })).toBe(0);
    expect(startLean({ age: 25, experience: 0, draft: pick(1) })).toBe(0);
  });

  it('coachOrder starts a first-round rookie a little inside the lean below the veteran, never a little past it', () => {
    const rookie = wr(world, 0, 10, { age: 22, experience: 0, draft: pick(1) });
    const close = wr(world, 1, 10 + START_LEAN.firstRound - 0.5, { age: 29, experience: 7 });
    expect(slotOvr(close, 'WR') - slotOvr(rookie, 'WR')).toBeCloseTo(START_LEAN.firstRound - 0.5, 1);
    expect(coachOrder([close, rookie], 'WR', [])[0].id).toBe(rookie.id);
    const clear = wr(world, 1, 10 + START_LEAN.firstRound + 0.5, { age: 29, experience: 7 });
    expect(coachOrder([clear, rookie], 'WR', [])[0].id).toBe(clear.id);
  });

  it("a coach's quirk note never names the youth lean", () => {
    const l = clone(world);
    const t = l.teams[0];
    // A quirk that leans nothing between these two (the same work ethic): only the youth lean tells them apart.
    const staff = teamCoaches(l, 0).map((c) => ({ ...c, quirks: c.room === 'WR' ? { earnYourReps: 2 } : {} }));
    const rookie = wr(l, 0, 10, { age: 22, experience: 0, draft: pick(1) });
    const vet = wr(l, 1, 10.5, { age: 29, experience: 7 });
    rookie.traits.workEthic = vet.traits.workEthic = 12;
    rookie.shifts = vet.shifts = undefined;
    expect(coachOrder([vet, rookie], 'WR', staff)[0].id).toBe(rookie.id);
    expect(assessCoachAdvice(l, t, staff, [rookie, vet])).toBeUndefined();
  });

  it('an unavailable rookie never starts through the lean', () => {
    const rookie = wr(world, 0, 10, { age: 22, experience: 0, draft: pick(1) });
    const vet = wr(world, 1, 10.5, { age: 29, experience: 7 });
    // The chart is built from the players given; a hurt rookie isn't among them, so the veteran starts.
    expect(buildAutoDepthChart([vet]).WR[0]).toBe(vet.id);
    expect(buildAutoDepthChart([vet, rookie]).WR[0]).toBe(rookie.id);
  });

  it('a chart you set yourself keeps your order', () => {
    const l = clone(world);
    const t = l.teams[0];
    t.autoDepth = false;
    t.depthChart.WR = [...t.depthChart.WR].reverse();
    const mine = clone(t.depthChart);
    syncDepthChart(l, t);
    expect(t.depthChart.WR).toEqual(mine.WR);
  });
});
