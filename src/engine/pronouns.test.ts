import { describe, expect, it } from 'vitest';
import { createLeague } from './generate';
import { hireMedic, medicMarket, medicMoveProblem, teamMedics } from './medical';
import { pron } from './pronouns';
import { hireStaff, staffMarket, staffMoveProblem, teamStaff } from './staff';
import type { League, Medic, Staff } from './types';

const MALE = /\b(he|his|him)\b/i;
const FEMALE = /\b(she|her)\b/i;

/** A league in the re-sign window, where staff moves are open, with money to spare. */
const open = (seed: string): League => {
  const l = createLeague({ seed });
  l.phase = 'resign';
  l.teams[l.userTeamId].staffBudgetMult = 5;
  return l;
};

/** Another club's person in the role, so `hire` is refused as unavailable. */
const employed = <T extends Staff | Medic>(people: T[], role: string, userTeam: number) => people.find((p) => p.role === role && p.teamId !== null && p.teamId !== userTeam)!;

describe('pron', () => {
  it('gives the woman forms to a woman scout or medic', () => {
    const l = createLeague({ seed: 'pron' });
    const scout = Object.values(l.staff)[0];
    const medic = Object.values(l.medics)[0];
    scout.woman = true;
    medic.woman = true;
    for (const p of [scout, medic]) expect(pron(p)).toEqual({ he: 'she', He: 'She', him: 'her', his: 'her', His: 'Her' });
  });
  it('gives the man forms to a coach, and to a scout or medic with no flag', () => {
    const l = createLeague({ seed: 'pron' });
    const man = { he: 'he', He: 'He', him: 'him', his: 'his', His: 'His' };
    expect(pron(Object.values(l.coaches)[0])).toEqual(man);
    expect(pron(Object.values(l.staff).find((s) => !s.woman)!)).toEqual(man);
    expect(pron(Object.values(l.medics).find((m) => !m.woman)!)).toEqual(man);
  });
});

describe('move problems about a woman', () => {
  it('say she and her for a scout, never he, his or him', () => {
    const l = open('pron-scout');
    const user = l.userTeamId;
    const found: string[] = [];
    const check = (s: Staff, move: 'hire' | 'extend' | 'release') => {
      s.woman = true;
      const problem = staffMoveProblem(l, user, s, move);
      expect(problem, `${move} ${s.role}`).not.toBeNull();
      expect(problem).not.toMatch(MALE);
      found.push(problem!);
    };
    // release: she isn't yours.
    check(staffMarket(l)[0], 'release');
    // hire: she works for another club; and your Director's chair is held.
    check(employed(Object.values(l.staff), 'proScout', user), 'hire');
    check(staffMarket(l).find((s) => s.role === 'director')!, 'hire');
    // extend: her deal is up and a replacement has taken the chair.
    const director = teamStaff(l, user).find((s) => s.role === 'director')!;
    director.contract = { salary: director.contract!.salary, through: l.season - 1 };
    hireStaff(l, user, staffMarket(l).find((s) => s.role === 'director')!.id, 1);
    check(director, 'extend');
    expect(found.filter((p) => FEMALE.test(p)).length).toBe(found.length);
    // The same strings for a man keep the man forms.
    director.woman = undefined;
    expect(staffMoveProblem(l, user, director, 'extend')).toMatch(/^His chair is taken/);
  });

  it('say she and her for a medic, never he, his or him', () => {
    const l = open('pron-medic');
    const user = l.userTeamId;
    const found: string[] = [];
    const check = (m: Medic, move: 'hire' | 'extend' | 'release') => {
      m.woman = true;
      const problem = medicMoveProblem(l, user, m, move);
      expect(problem, `${move} ${m.role}`).not.toBeNull();
      expect(problem).not.toMatch(MALE);
      found.push(problem!);
    };
    check(medicMarket(l)[0], 'release');
    check(employed(Object.values(l.medics), 'physio', user), 'hire');
    check(medicMarket(l).find((m) => m.role === 'doctor')!, 'hire');
    const doctor = teamMedics(l, user).find((m) => m.role === 'doctor')!;
    doctor.contract = { salary: doctor.contract!.salary, through: l.season - 1 };
    hireMedic(l, user, medicMarket(l).find((m) => m.role === 'doctor')!.id, 1);
    check(doctor, 'extend');
    expect(found.filter((p) => FEMALE.test(p)).length).toBe(found.length);
    doctor.woman = undefined;
    expect(medicMoveProblem(l, user, doctor, 'extend')).toMatch(/^His chair is taken/);
  });
});
