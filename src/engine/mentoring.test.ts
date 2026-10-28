import { describe, expect, it } from 'vitest';
import { createLeague } from './generate';
import {
  canBeMentored,
  canMentor,
  leadFactor,
  MAX_MENTEES,
  mentoringWeek,
  mentoringYearEnd,
  mentorShift,
  planMentors,
  positionBonus,
  setMentor,
  settleMentoring,
  standingFactor,
  takes,
} from './mentoring';
import { activeRoster } from './roster';
import type { Player, Traits } from './types';

const league = createLeague({ seed: 'mentoring' });
const roster = Object.values(league.players).filter((p) => p.teamId === 0);

/** Two of team 0's players made into a veteran and a kid of the same position, with the traits given. */
function pair(vet: Partial<Traits>, kid: Partial<Traits>): [Player, Player] {
  const [a, b] = roster;
  const v: Player = { ...a, age: 30, experience: 8, position: 'LB', traits: { ...a.traits, ...vet } };
  const k: Player = { ...b, age: 22, experience: 1, position: 'LB', traits: { ...b.traits, ...kid } };
  delete v.shifts;
  delete k.shifts;
  return [v, k];
}

describe('mentoring: who', () => {
  it('takes a veteran of 27 or five seasons, and a young player of 21 to 24', () => {
    const [v, k] = pair({}, {});
    expect(canMentor(v)).toBe(true);
    expect(canMentor({ ...v, age: 25, experience: 5 })).toBe(true);
    expect(canMentor({ ...v, age: 25, experience: 3 })).toBe(false);
    expect(canBeMentored(k)).toBe(true);
    expect(canBeMentored({ ...k, age: 25 })).toBe(false);
    expect(canBeMentored({ ...k, age: 20 })).toBe(false);
  });
});

describe('mentoring: what rubs off', () => {
  it('pulls toward the mentor on all three, both ways, never past a point a year', () => {
    const [vet, kid] = pair(
      { workEthic: 18, temperament: 4, poise: 16, leads: 18 },
      { workEthic: 8, temperament: 12, poise: 9, controversy: 10 },
    );
    const s = mentorShift(league, vet, kid, 18);
    expect(s.workEthic).toBeGreaterThan(0);
    expect(s.temperament).toBeLessThan(0); // a hothead teaches the wrong habits too
    expect(s.poise).toBeGreaterThan(0);
    for (const v of Object.values(s)) expect(Math.abs(v)).toBeLessThanOrEqual(1);
  });

  it('lets a leader pull far harder than a quiet man', () => {
    expect(leadFactor(18)).toBeGreaterThan(leadFactor(4) * 3);
    expect(leadFactor(20)).toBe(1.5);
    expect(leadFactor(1)).toBe(0.3);
    const [leader, kid] = pair({ workEthic: 15, leads: 18 }, { workEthic: 9, controversy: 10 });
    const quiet = { ...leader, traits: { ...leader.traits, leads: 4 } };
    expect(mentorShift(league, quiet, kid, 9).workEthic).toBeLessThan(
      mentorShift(league, leader, kid, 9).workEthic / 3,
    );
  });

  it('counts a mentor who never played as a backup', () => {
    const [v] = pair({}, {});
    expect(standingFactor(league, { ...v, stats: {} })).toBe(0.4);
  });

  it('a young player who stirs the room takes less', () => {
    const [, kid] = pair({}, { controversy: 10 });
    expect(takes({ ...kid, traits: { ...kid.traits, controversy: 18 } })).toBeLessThan(takes(kid));
    expect(takes(kid)).toBe(1);
  });

  it('gives a bonus for a mentor who has played his position', () => {
    const [v, k] = pair({}, {});
    expect(positionBonus(league, v, k)).toBe(1.12);
    expect(positionBonus(league, { ...v, position: 'QB', stats: {} }, k)).toBe(1);
  });

  it('teaches nothing in a season they never shared', () => {
    const [vet, kid] = pair({ workEthic: 18 }, { workEthic: 8 });
    expect(mentorShift(league, vet, kid, 0)).toEqual({ workEthic: 0, temperament: 0, poise: 0 });
  });
});

describe('mentoring: pairs and seasons', () => {
  const fresh = () => createLeague({ seed: 'mentoring-pairs' });
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

  it('pairs young players, two at most per mentor, by leadership and not work ethic', () => {
    const l = fresh();
    for (const t of l.teams) planMentors(l, t.id);
    const players = Object.values(l.players);
    const load = new Map<number, number>();
    for (const p of players) if (p.mentor !== undefined) load.set(p.mentor, (load.get(p.mentor) ?? 0) + 1);
    expect(load.size).toBeGreaterThan(32);
    for (const n of load.values()) expect(n).toBeLessThanOrEqual(MAX_MENTEES);
    const chosen = [...load.keys()].map((id) => l.players[id].traits.workEthic);
    const eligible = players.filter((p) => p.teamId !== null && canMentor(p)).map((p) => p.traits.workEthic);
    expect(Math.abs(mean(chosen) - mean(eligible))).toBeLessThan(0.75);
    const leads = [...load.keys()].map((id) => l.players[id].traits.leads);
    expect(mean(leads)).toBeGreaterThan(
      mean(players.filter((p) => p.teamId !== null && canMentor(p)).map((p) => p.traits.leads)),
    );
  });

  it('counts a week only while both are on the active 53', () => {
    const l = fresh();
    l.phase = 'regular';
    mentoringWeek(l);
    const kid = Object.values(l.players).find((p) => p.mentor !== undefined)!;
    const vet = l.players[kid.mentor!];
    mentoringWeek(l);
    vet.ir = { season: l.season, week: l.week, weeks: 0 };
    mentoringWeek(l);
    delete vet.ir;
    mentoringWeek(l);
    expect(kid.mentor).toBe(vet.id);
    expect(kid.mentorWeeks).toBe(3);
  });

  it('banks a pair split mid-season once, and keeps the record', () => {
    const l = fresh();
    mentoringWeek(l);
    mentoringWeek(l);
    const kid = Object.values(l.players).find((p) => p.mentor !== undefined)!;
    const vet = l.players[kid.mentor!];
    const owed = mentorShift(l, vet, kid, kid.mentorWeeks!);
    vet.teamId = (vet.teamId! + 1) % 32;
    mentoringWeek(l);
    mentoringWeek(l);
    expect(kid.mentor === undefined || kid.mentor !== vet.id).toBe(true);
    expect(kid.mentorBank?.workEthic ?? 0).toBeCloseTo(owed.workEthic, 9);
    expect(kid.mentoredBy).toEqual([{ id: vet.id, from: l.season, to: l.season }]);
    expect(kid.shifts).toBeUndefined(); // it lands at the new league year, not before
  });

  it('lands at the new league year, a point at most per trait, and stops after 24', () => {
    const l = fresh();
    mentoringWeek(l);
    const kid = Object.values(l.players).find((p) => p.mentor !== undefined)!;
    kid.age = 24;
    kid.mentorWeeks = 18;
    kid.mentorBank = { workEthic: 0.9, temperament: -0.8 };
    l.season++;
    mentoringYearEnd(l);
    settleMentoring(l, kid);
    expect(Math.abs(kid.shifts!.workEthic!)).toBeLessThanOrEqual(1);
    expect(Math.abs(kid.shifts!.temperament!)).toBeLessThanOrEqual(1);
    expect(kid.mentorBank).toBeUndefined();
    expect(kid.mentor).toBeUndefined(); // he turns 25
    expect(kid.mentoredBy?.length).toBeGreaterThan(0);
  });

  it('keeps what landed only for your own players, whose letters read it', () => {
    const l = fresh();
    const [ours, theirs] = [l.userTeamId, (l.userTeamId + 1) % 32].map(
      (t) => Object.values(l.players).find((p) => p.teamId === t && p.age < 24)!,
    );
    l.season++;
    for (const p of [ours, theirs]) {
      p.mentorBank = { workEthic: 0.6 };
      settleMentoring(l, p);
      expect(p.shifts?.workEthic).toBe(0.6);
    }
    expect(ours.shiftedLast).toEqual({ season: l.season, workEthic: 0.6 });
    expect(theirs.shiftedLast).toBeUndefined();
  });

  it('leaves a room without a veteran unpaired', () => {
    const l = fresh();
    for (const p of activeRoster(l, 3)) {
      p.age = 22;
      p.experience = 1;
    }
    planMentors(l, 3);
    expect(activeRoster(l, 3).some((p) => p.mentor !== undefined)).toBe(false);
  });

  it('never touches a pair you set, and lets you choose none', () => {
    const l = fresh();
    const team = l.userTeamId;
    const roster = activeRoster(l, team);
    const kid = roster.find(canBeMentored)!;
    const vet = roster.filter(canMentor).sort((a, b) => a.traits.leads - b.traits.leads)[0];
    setMentor(l, kid.id, vet.id);
    planMentors(l, team);
    expect(kid.mentor).toBe(vet.id);
    expect(kid.mentorSetByYou).toBe(true);
    setMentor(l, kid.id, null);
    planMentors(l, team);
    expect(kid.mentor).toBeUndefined();
    expect(() => setMentor(l, kid.id, kid.id)).toThrow();
  });

  it('moves players against each other, never the league as a whole', () => {
    const l = fresh();
    l.phase = 'regular';
    for (let w = 0; w < 18; w++) mentoringWeek(l);
    l.season++;
    mentoringYearEnd(l);
    const banked = Object.values(l.players).filter((p) => p.mentorBank);
    expect(banked.length).toBeGreaterThan(100);
    for (const k of ['workEthic', 'temperament', 'poise'] as const) {
      const total = banked.reduce((s, p) => s + (p.mentorBank![k] ?? 0), 0);
      expect(Math.abs(total / banked.length)).toBeLessThan(0.005); // to the rounding
      for (const p of banked) expect(Math.abs(p.mentorBank![k] ?? 0)).toBeLessThanOrEqual(1);
    }
  });
});
