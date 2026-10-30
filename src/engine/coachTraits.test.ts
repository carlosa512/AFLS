import { describe, expect, it } from 'vitest';
import { coolAmbition, rollCoachTraits, traitLean, traitOf, traitsFromPlayer } from './coachTraits';
import { createLeague } from './generate';
import { migrateLeague } from './migrate';
import type { Coach, CoachTraits, Player } from './types';

const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const range = (n: number) => Array.from({ length: n }, (_, i) => i);
const typical = (): CoachTraits => ({ ambition: 10, loyalty: 10, adaptability: 10, discipline: 10 });
const coach = (over: Partial<Coach> = {}): Coach => ({
  id: 1,
  firstName: 'Ray',
  lastName: 'Holt',
  role: 'defCoord',
  age: 45,
  youth: 10,
  veterans: 10,
  teamId: null,
  contract: null,
  traits: typical(),
  ...over,
});

describe('coach traits', () => {
  it('rolls the same traits from the seed and id, on the 1–20 scale', () => {
    const a = rollCoachTraits('s', { id: 7, age: 40 });
    expect(rollCoachTraits('s', { id: 7, age: 40 })).toEqual(a);
    for (const v of Object.values(a)) expect(v >= 1 && v <= 20 && Number.isInteger(v)).toBe(true);
  });

  it('leans young coaches ambitious', () => {
    const mean = (age: number) => avg(range(400).map((id) => rollCoachTraits('s', { id, age }).ambition));
    expect(mean(30) - mean(60)).toBeGreaterThan(2);
  });

  it('reads a missing trait as typical', () => {
    expect(traitOf(coach({ traits: undefined }), 'loyalty')).toBe(10.5);
    expect(traitLean(10.5)).toBe(0);
    expect(traitLean(1)).toBe(-1);
    expect(traitLean(20)).toBe(1);
  });

  it('carries a former player’s character in', () => {
    const p = { personality: { greed: 0.5, loyalty: 0.05, winning: 0.95, patience: 0.5 } } as Player;
    p.traits = {
      workEthic: 10,
      durability: 10,
      temperament: 10,
      injuryResistance: 10,
      naturalFitness: 10,
      versatility: 18,
      leads: 10,
      poise: 10,
      controversy: 10,
      sportsmanship: 10,
    };
    const ts = range(50).map((id) => traitsFromPlayer('s', { id }, p));
    expect(avg(ts.map((t) => t.ambition))).toBeGreaterThan(13);
    expect(avg(ts.map((t) => t.loyalty))).toBeLessThan(8);
    expect(avg(ts.map((t) => t.adaptability))).toBeGreaterThan(15);
  });

  it('cools ambition a point a year from 56', () => {
    const c = coach({ age: 56, traits: { ...typical(), ambition: 12 } });
    coolAmbition(c);
    expect(c.traits!.ambition).toBe(11);
    c.age = 55;
    coolAmbition(c);
    expect(c.traits!.ambition).toBe(11);
  });

  it('gives every coach in a new league traits, legends included', () => {
    const l = createLeague({ seed: 'traits' });
    for (const c of [...Object.values(l.coaches), ...Object.values(l.retiredCoaches)]) expect(c.traits).toBeDefined();
  });

  it('upgrades a v69 save to what a new league from its seed has', () => {
    const l = createLeague({ seed: 'traits-mig' });
    const all = () => [...Object.values(l.coaches), ...Object.values(l.retiredCoaches)];
    const want = Object.fromEntries(all().map((c) => [c.id, c.traits]));
    for (const c of all()) delete c.traits;
    l.version = 69;
    const up = migrateLeague(l)!;
    const got = [...Object.values(up.coaches), ...Object.values(up.retiredCoaches)];
    expect(Object.fromEntries(got.map((c) => [c.id, c.traits]))).toEqual(want);
  });
});
