import { leadershipNewYear, enforceCoachChanges } from './leadership';
import { describe, expect, it } from 'vitest';
import {
  asPromoted,
  coachOfPlayer,
  developCoaches,
  headCoachVision,
  ownerLeeway,
  promoteCoach,
  promotionFor,
  promotionProblem,
  ROOM_OF,
  visionFit,
  CHAIRS,
  chairHolder,
  coachAsk,
  coachBudget,
  coachingFor,
  coachingFrom,
  coachingParts,
  coordinatorOf,
  unpaidChairs,
  installInterimHeadCoach,
  resolveInterimHeadCoach,
  teamScheme,
  coachMarket,
  coachMoveProblem,
  coachPayroll,
  coachResignForecast,
  coachRoom,
  coachSeverance,
  coachValue,
  coachWindowCloses,
  coachesPushedOutBy,
  callerStyle,
  ensureCoached,
  extendCoach,
  hireCoach,
  hotSeat,
  isCoachExpiring,
  NEUTRAL,
  previewCoachHire,
  releaseCoach,
  replaceCoach,
  replaceProblem,
  RATE_RANGE,
  DECLINE_RANGE,
  roomEffect,
  sameChair,
  chairOf,
  specialTeamsEdge,
  teamCoaches,
  TYPICAL,
} from './coaching';
import { developPlayer } from './development';
import { FRONTS, OFF_SCHEMES } from './schemes';
import { createLeague, generatePlayer, SAVE_VERSION } from './generate';
import { simToEndOfSeason } from './league';
import { fourthDown, passProbability, type Situation } from './match/coach';
import { simulateGame } from './match/gameSim';
import { buildLineup } from './match/lineup';
import { migrateLeague } from './migrate';
import { coachRecord } from './records';
import { ownerBudgets } from './staff';
import { advanceOffseason, beginOffseason, simOffseason } from './offseason';
import { playerOvr } from './positions';
import { Rng } from './rng';
import type { Coach, League, Player, Position } from './types';
import { POSITIONS } from './types';

const copy = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

const offseason = (seed: string) => {
  const league = createLeague({ seed });
  simToEndOfSeason(league);
  beginOffseason(league);
  return league;
};

/** A full staff of one quality, for reading what coaching does without a league. */
const staffOf = (rating: number, overrides: Partial<Record<string, Partial<Coach>>> = {}): Coach[] =>
  CHAIRS.map((ch, i) => ({
    id: -i - 1,
    firstName: 'A',
    lastName: String(i),
    ...ch,
    age: 50,
    youth: rating,
    veterans: rating,
    teamId: 0,
    contract: null,
    ...overrides[ch.room ?? ch.role],
  }));

function rookie(pos: Position, age: number, i: number): Player {
  return generatePlayer(new Rng(`coach-test:${pos}:${i}`), {
    id: 2_000_000 + i,
    position: pos,
    quality: 11,
    age,
    teamId: null,
    jerseysUsed: new Set(),
  });
}

/** Average change in overall over `years` offseasons for the same players under a given staff (and makeup). */
function careerUnder(
  staff: Coach[] | null,
  pos: Position,
  age: number,
  years: number,
  n = 300,
  vary?: (p: Player) => void,
): number {
  const coaching = staff ? coachingFrom(staff, pos) : NEUTRAL;
  const deltas: number[] = [];
  for (let i = 0; i < n; i++) {
    const p = rookie(pos, age, i);
    vary?.(p);
    const start = playerOvr(p);
    for (let y = 0; y < years; y++) {
      developPlayer(new Rng(`coach-test:year:${i}:${y}`), p, { playedShare: 1, ...coaching });
      p.age++;
    }
    deltas.push(playerOvr(p) - start);
  }
  return mean(deltas);
}

describe('what coaches do for players', () => {
  it('reads a typical staff and free agents as neutral, and an empty chair as a weak coach', () => {
    for (const pos of POSITIONS) expect(coachingFrom(staffOf(TYPICAL), pos)).toEqual(NEUTRAL);
    const l = createLeague({ seed: 'neutral' });
    expect(coachingFor(l, null, 'WR')).toEqual(NEUTRAL);
    const noReceiversCoach = staffOf(TYPICAL).filter((c) => c.room !== 'WR');
    expect(coachingFrom(noReceiversCoach, 'WR').rate).toBeLessThan(0.9);
    expect(coachingFrom(noReceiversCoach, 'TE').rate).toBeLessThan(0.9);
    expect(coachingFrom(noReceiversCoach, 'QB')).toEqual(NEUTRAL);
  });

  it('weights the position coach most for growth in his room and the S&C coach most for the body', () => {
    const star = (key: string) => coachingFrom(staffOf(TYPICAL, { [key]: { youth: 18, veterans: 18 } }), 'WR');
    const room = star('WR');
    const coord = star('offCoord');
    const head = star('headCoach');
    const sc = star('strengthCoach');
    expect(room.rate).toBeGreaterThan(coord.rate);
    expect(coord.rate).toBeGreaterThanOrEqual(head.rate);
    expect(sc.decline.physical).toBeLessThan(room.decline.physical);
    expect(room.decline.technical).toBeLessThan(coord.decline.technical);
    // The S&C coach keeps bodies going, not technique; a defensive coordinator does nothing for a receiver.
    expect(sc.decline.technical).toBe(1);
    expect(star('defCoord')).toEqual(NEUTRAL);
    // Kickers and punters have no room or side: the special teams coordinator is their position coach.
    expect(coachingFrom(staffOf(TYPICAL, { headCoach: { youth: 18 } }), 'K').rate).toBeGreaterThan(1);
    expect(coachingFrom(staffOf(TYPICAL, { stCoord: { youth: 18 } }), 'K').rate).toBeGreaterThan(
      coachingFrom(staffOf(TYPICAL, { headCoach: { youth: 18 } }), 'K').rate,
    );
  });

  it('adds up the parts a screen shows to exactly what development applies', () => {
    const staff = staffOf(TYPICAL, {
      WR: { youth: 16, veterans: 7 },
      headCoach: { youth: 12, veterans: 13 },
      strengthCoach: { youth: 9, veterans: 15 },
    });
    for (const pos of ['WR', 'TE', 'K'] as Position[]) {
      const parts = coachingParts(staff, pos);
      const c = coachingFrom(staff, pos);
      expect(1 + parts.reduce((s, p) => s + p.growth, 0)).toBeCloseTo(c.rate, 10);
      expect(1 + parts.reduce((s, p) => s + p.body, 0)).toBeCloseTo(c.decline.physical, 10);
      expect(1 + parts.reduce((s, p) => s + p.craft, 0)).toBeCloseTo(c.decline.technical, 10);
      for (const k of ['growth', 'body', 'craft'] as const)
        expect(parts.reduce((s, p) => s + p.weight[k], 0)).toBeCloseTo(1, 10);
    }
    expect(roomEffect(staff, 'WR').growth).toBeGreaterThan(0.1);
    expect(roomEffect(staff, 'QB').growth).toBeCloseTo(
      roomEffect(staffOf(TYPICAL, { headCoach: { youth: 12 }, strengthCoach: { youth: 9 } }), 'QB').growth,
      10,
    );
  });

  it('grows young players faster and ages veterans more gently under better coaches, less than work ethic does', () => {
    const strong = staffOf(14);
    const weak = staffOf(7);
    const youngGap = careerUnder(strong, 'WR', 21, 5) - careerUnder(weak, 'WR', 21, 5);
    expect(youngGap).toBeGreaterThan(0.1);
    // Seven points of staff against nine of work ethic on the same players: the player's own makeup matters more.
    const grinder = careerUnder(null, 'WR', 21, 5, 300, (p) => (p.traits.workEthic = 15));
    const coaster = careerUnder(null, 'WR', 21, 5, 300, (p) => (p.traits.workEthic = 6));
    expect(youngGap).toBeLessThan(grinder - coaster);
    const oldGap = careerUnder(strong, 'RB', 28, 3) - careerUnder(weak, 'RB', 28, 3);
    expect(oldGap).toBeGreaterThan(0.2);
    // A typical staff is exactly today's development.
    expect(careerUnder(staffOf(TYPICAL), 'CB', 22, 4, 60)).toBe(careerUnder(null, 'CB', 22, 4, 60));
    // Capped: no staff makes anyone a different player, and the parts stop adding up past the caps.
    const best = coachingFrom(staffOf(20), 'WR');
    expect(best.rate).toBe(RATE_RANGE[1]);
    expect(best.decline.physical).toBe(DECLINE_RANGE[0]);
    expect(1 + coachingParts(staffOf(20), 'WR').reduce((sum, part) => sum + part.growth, 0)).toBeGreaterThan(best.rate);
  });

  it('never draws extra random numbers from a player’s stream', () => {
    const a = new Rng('stream');
    const b = new Rng('stream');
    developPlayer(a, rookie('LB', 23, 1), { playedShare: 0.5 });
    developPlayer(b, rookie('LB', 23, 1), { playedShare: 0.5, ...coachingFrom(staffOf(17), 'LB') });
    expect(a.getState()).toEqual(b.getState());
  });

  it('develops players with the coaches they finished the season with', () => {
    const l = createLeague({ seed: 'coached' });
    simToEndOfSeason(l);
    const strong = copy(l);
    const weak = copy(l);
    for (const c of Object.values(strong.coaches)) c.youth = c.veterans = 18;
    for (const c of Object.values(weak.coaches)) c.youth = c.veterans = 3;
    beginOffseason(strong);
    beginOffseason(weak);
    const young = Object.values(l.players).filter(
      (p) => p.teamId !== null && p.age <= 23 && p.potential - playerOvr(p) > 1,
    );
    const old = Object.values(l.players).filter(
      (p) => p.teamId !== null && p.age >= 31 && !strong.players[p.id].retired && !weak.players[p.id].retired,
    );
    expect(young.length).toBeGreaterThan(100);
    const change = (lg: League, ps: Player[]) => mean(ps.map((p) => playerOvr(lg.players[p.id]) - playerOvr(p)));
    expect(change(strong, young)).toBeGreaterThan(change(weak, young) + 0.1);
    expect(change(strong, old)).toBeGreaterThan(change(weak, old));
    // Nobody coaches a free agent: his year is the same either way.
    const fa = Object.values(l.players).find((p) => p.teamId === null && !p.retired)!;
    expect(strong.players[fa.id].ratings).toEqual(weak.players[fa.id].ratings);
    // Coaching moves players, never the league's own stream: same draft class, same schedule.
    expect(strong.rngState).toEqual(weak.rngState);
    expect(strong.draftClass.map((id) => strong.players[id].ratings)).toEqual(
      weak.draftClass.map((id) => weak.players[id].ratings),
    );
  });
});

// These play a season first (`offseason`).
describe('coaching staffs and moves', () => {
  it('gives every team a full staff inside its budget, and the user a typical one', () => {
    const l = createLeague({ seed: 'staffs' });
    for (const team of l.teams) {
      const staff = teamCoaches(l, team.id);
      for (const ch of CHAIRS) expect(staff.filter((c) => sameChair(chairOf(c), ch))).toHaveLength(1);
      expect(coachPayroll(l, team.id)).toBeLessThanOrEqual(coachBudget(l, team.id));
    }
    // Development runs before the first window, so the user starts with nothing he couldn't fix in time.
    const mine = teamCoaches(l, l.userTeamId);
    for (const c of mine) expect(Math.abs(coachValue(c) - TYPICAL)).toBeLessThanOrEqual(2);
    expect(Math.abs(mean(mine.map(coachValue)) - TYPICAL)).toBeLessThan(0.75);
    // His first decisions: deals that run out after one season.
    expect(mine.some((c) => c.contract!.through === l.season)).toBe(true);
    for (const c of Object.values(l.coaches)) {
      expect(c.youth).toBeGreaterThanOrEqual(1);
      expect(c.veterans).toBeLessThanOrEqual(20);
      expect(c.role === 'positionCoach').toBe(!!c.room);
    }
    expect(coachMarket(l).length).toBeGreaterThan(50);
  });

  it('gives the opening user staff to the team he picks, without changing anything else', () => {
    const team0 = createLeague({ seed: 'pick' });
    const picked = createLeague({ seed: 'pick', userTeamId: 7 });
    const typical = (l: League, id: number) => teamCoaches(l, id).every((c) => Math.abs(coachValue(c) - TYPICAL) <= 2);
    expect(typical(picked, 7)).toBe(true);
    expect(picked.players).toEqual(team0.players);
    expect(picked.games).toEqual(team0.games);
    expect(picked.rngState).toEqual(team0.rngState);
  });

  it('only move in the re-sign window and free agency', () => {
    const l = createLeague({ seed: 'coach-window' });
    const candidate = coachMarket(l)[0];
    expect(coachMoveProblem(l, l.userTeamId, candidate, 'hire')).toMatch(/re-sign window/);
    expect(() => hireCoach(l, l.userTeamId, candidate.id)).toThrow();
  });

  it('hire within budget and chair, replace in one move, dismiss with severance, extend only expiring deals', () => {
    const l = offseason('coach-moves');
    const user = l.userTeamId;
    l.teams[user].staffBudgetMult = 2; // money is tested on its own below
    // Dismissing a coach under contract books half of what's left, at most a year's salary.
    const pc = teamCoaches(l, user).find((c) => c.role === 'positionCoach' && !isCoachExpiring(l, c))!;
    const chair = chairOf(pc);
    const yearsLeft = pc.contract!.through - l.season + 1;
    const pcSalary = pc.contract!.salary;
    expect(coachSeverance(l, pc)).toBe(Math.round(pcSalary * Math.min(1, 0.5 * yearsLeft)));
    let payroll = coachPayroll(l, user);
    releaseCoach(l, user, pc.id);
    expect(coachPayroll(l, user)).toBe(payroll - pcSalary + Math.round(pcSalary * Math.min(1, 0.5 * yearsLeft)));
    // Hire into the open chair.
    const cheapest = coachMarket(l)
      .filter((c) => sameChair(chairOf(c), chair))
      .sort((a, b) => coachAsk(l, a) - coachAsk(l, b))[0];
    hireCoach(l, user, cheapest.id, 3);
    expect(cheapest.teamId).toBe(user);
    expect(cheapest.since).toBe(l.season);
    expect(cheapest.contract!.through).toBe(l.season + 2);
    // A second coach for a filled chair needs a replace; the old one's money comes back, less severance.
    const rival = coachMarket(l).find((c) => sameChair(chairOf(c), chair))!;
    expect(coachMoveProblem(l, user, rival, 'hire')).toMatch(/already have a/);
    expect(replaceProblem(l, user, rival)).toBeNull();
    payroll = coachPayroll(l, user);
    const salary = cheapest.contract!.salary;
    const severance = coachSeverance(l, cheapest);
    expect(severance).toBe(salary); // three years left: capped at a year's salary
    const ask = coachAsk(l, rival, 2);
    replaceCoach(l, user, rival.id, 2);
    expect(cheapest.teamId).toBeNull();
    expect(cheapest.lastJob).toMatch(/coach/);
    expect(rival.teamId).toBe(user);
    expect(coachPayroll(l, user)).toBe(payroll - salary + severance + ask);
    expect(l.teams[user].coachDead.at(-1)!.amount).toBe(severance);
    // Terms are capped by role; only expiring deals extend; nobody dismisses another team's coach.
    expect(coachMoveProblem(l, user, coachMarket(l).find((c) => c.role === 'offCoord')!, 'hire', 5)).toMatch(
      /1–3 years/,
    );
    expect(() => extendCoach(l, user, teamCoaches(l, user).find((c) => !isCoachExpiring(l, c))!.id)).toThrow(
      /expiring/,
    );
    expect(() => releaseCoach(l, user, teamCoaches(l, (user + 1) % 32)[0].id)).toThrow();
  });

  it('refuses what the budget can’t cover, counting what a replacement frees', () => {
    const l = offseason('coach-budget');
    const user = l.userTeamId;
    /** Set the owner's money so the coaching room is exactly `room`. */
    const setRoom = (room: number) => {
      l.teams[user].staffBudgetMult = 1;
      l.teams[user].staffBudgetMult = (coachPayroll(l, user) + room) / coachBudget(l, user);
    };
    // A chair whose man's deal is up is open to a hire: the budget decides. An assistant's chair, where the owner
    // never goes over (for a head coach or coordinator he might, `ownerLeeway`).
    const leadership = ['headCoach', 'offCoord', 'defCoord'];
    const expiring = teamCoaches(l, user).find((c) => isCoachExpiring(l, c) && !leadership.includes(c.role))!;
    const hire = coachMarket(l).find((c) => sameChair(chairOf(c), chairOf(expiring)))!;
    setRoom(coachAsk(l, hire) - 50);
    expect(coachMoveProblem(l, user, hire, 'hire')).toMatch(/Over your coaching budget/);
    setRoom(coachAsk(l, hire) + 50);
    expect(coachMoveProblem(l, user, hire, 'hire')).toBeNull();
    // Replacing a man with a year left frees half his salary (the other half is severance).
    const holder = teamCoaches(l, user).find((c) => !isCoachExpiring(l, c) && c.contract!.through === l.season)!;
    expect(holder).toBeDefined();
    const freed = holder.contract!.salary - coachSeverance(l, holder);
    expect(freed).toBeGreaterThan(100);
    const incoming = coachMarket(l).find((c) => sameChair(chairOf(c), chairOf(holder)))!;
    setRoom(coachAsk(l, incoming) - freed / 2);
    expect(coachRoom(l, user)).toBeLessThan(coachAsk(l, incoming));
    expect(replaceProblem(l, user, incoming)).toBeNull();
    setRoom(coachAsk(l, incoming) - freed - 50);
    expect(replaceProblem(l, user, incoming)).toMatch(/even after dismissing/);
  });

  it('re-signs the user’s expiring coaches when the window closes, unless he let them go', () => {
    const l = offseason('coach-renew');
    const user = l.userTeamId;
    const expiring = teamCoaches(l, user).filter((c) => isCoachExpiring(l, c));
    expect(expiring.length).toBeGreaterThan(1);
    const [letGo, ...keep] = expiring;
    releaseCoach(l, user, letGo.id);
    expect(l.teams[user].coachDead.filter((d) => d.season === l.season)).toHaveLength(0); // his deal was up: no severance
    l.teams[user].staffBudgetMult = 3; // money is not the question here
    const chairs = new Map(keep.map((c) => [c.id, chairOf(c)]));
    do {
      advanceOffseason(l);
    } while (l.phase === 'resign'); // hiring rounds, then free agency
    expect(letGo.teamId).not.toBe(user);
    // Re-signed, he can still be promoted away (a team can't block a promotion): only the rest must stay.
    const stayed = keep.filter((c) => c.teamId === user || sameChair(chairOf(c), chairs.get(c.id)!));
    expect(stayed.length).toBeGreaterThan(0);
    for (const c of stayed) {
      expect(c.teamId).toBe(user);
      expect(c.contract!.through).toBe(l.season + 1);
    }
  });

  it('applies exactly what the re-sign forecast promised', () => {
    const l = offseason('coach-forecast');
    const user = l.userTeamId;
    const expiring = teamCoaches(l, user).filter((c) => isCoachExpiring(l, c));
    expect(expiring.length).toBeGreaterThanOrEqual(3);
    const [target, ...rest] = expiring;
    // Hire into his chair: he can't be extended into it, and the forecast says so.
    l.teams[user].staffBudgetMult = 5;
    const rival = coachMarket(l).find((c) => sameChair(chairOf(c), chairOf(target)))!;
    expect(coachesPushedOutBy(l, user, rival).map((c) => c.id)).toContain(target.id);
    hireCoach(l, user, rival.id, 1);
    expect(coachResignForecast(l, user).get(target.id)).toBe('chair');
    expect(coachMoveProblem(l, user, target, 'extend')).toMatch(/chair is taken/);
    // Money for the best of the rest and not much more: best first stays, the others are priced out.
    const best = [...rest].sort((a, b) => coachValue(b) - coachValue(a))[0];
    const room = coachAsk(l, best) + 10;
    l.teams[user].staffBudgetMult = 1;
    l.teams[user].staffBudgetMult = (coachPayroll(l, user) + room) / coachBudget(l, user);
    const forecast = coachResignForecast(l, user);
    expect(forecast.get(best.id)).toBe('stays');
    for (const c of rest) if (c !== best) expect(forecast.get(c.id)).toBe('budget');
    const chairs = new Map([...forecast.keys()].map((id) => [id, chairOf(l.coaches[id])]));
    do {
      advanceOffseason(l);
    } while (l.phase === 'resign'); // the staffing window closes after GM hiring
    for (const [id, outlook] of forecast) {
      const c = l.coaches[id];
      // He re-signs; another club may still promote him out of it (a team can't block a promotion).
      if (outlook === 'stays') expect(c.teamId === user || !sameChair(chairOf(c), chairs.get(id)!)).toBe(true);
      else expect(c?.teamId ?? null).not.toBe(user);
    }
    for (const ch of CHAIRS)
      expect(teamCoaches(l, user).filter((c) => sameChair(chairOf(c), ch)).length).toBeLessThanOrEqual(1);
  });

  it('forecasts a replacement with the salary it frees, as replaceCoach does', () => {
    const l = offseason('coach-replace-forecast');
    const user = l.userTeamId;
    const holder = teamCoaches(l, user).find((c) => !isCoachExpiring(l, c) && c.contract!.through === l.season)!;
    const incoming = coachMarket(l).find((c) => sameChair(chairOf(c), chairOf(holder)))!;
    const expiring = teamCoaches(l, user)
      .filter((c) => isCoachExpiring(l, c))
      .sort((a, b) => coachValue(b) - coachValue(a))[0];
    const freed = holder.contract!.salary - coachSeverance(l, holder);
    // Room for the hire and the best expiring deal only once the replaced man's salary is counted.
    const room = coachAsk(l, incoming) + coachAsk(l, expiring) - freed / 2;
    l.teams[user].staffBudgetMult = 1;
    l.teams[user].staffBudgetMult = (coachPayroll(l, user) + room) / coachBudget(l, user);
    const before = coachResignForecast(l, user);
    const predicted = coachesPushedOutBy(l, user, incoming).map((c) => c.id);
    expect(predicted).not.toContain(expiring.id);
    replaceCoach(l, user, incoming.id, 2);
    const after = coachResignForecast(l, user);
    const actual = [...before].filter(([id, o]) => o === 'stays' && after.get(id) !== 'stays').map(([id]) => id);
    expect(predicted.sort()).toEqual(actual.sort());
  });

  it('previews what a hire would change, losses included', () => {
    const l = offseason('coach-preview');
    const user = l.userTeamId;
    l.teams[user].staffBudgetMult = 3; // nobody is pushed out here
    const pc = teamCoaches(l, user).find((c) => c.role === 'positionCoach' && !isCoachExpiring(l, c) && c.youth < 18)!;
    const star = coachMarket(l).find((c) => sameChair(chairOf(c), chairOf(pc)))!;
    star.youth = 19;
    star.veterans = 19;
    const changes = previewCoachHire(l, user, star);
    expect(changes.length).toBeGreaterThan(0);
    for (const c of changes) {
      expect(c.room).toBe(pc.room);
      expect(c.to.growth).toBeGreaterThan(c.from.growth);
    }
    // A worse head coach than the one he'd replace shows as losses everywhere.
    const hc = chairHolder(teamCoaches(l, user), { role: 'headCoach' })!;
    const weak = coachMarket(l).find((c) => c.role === 'headCoach')!;
    weak.youth = Math.max(1, hc.youth - 6);
    weak.veterans = Math.max(1, hc.veterans - 6);
    const losses = previewCoachHire(l, user, weak);
    expect(losses.length).toBe(8); // seven rooms plus the specialists
    for (const c of losses) expect(c.to.growth).toBeLessThan(c.from.growth);
  });

  it('fills an AI team’s empty chairs before the season and when the window closes, never the user’s', () => {
    const l = offseason('coach-chairs');
    const ai = l.teams.find((t) => t.id !== l.userTeamId)!;
    const hc = chairHolder(teamCoaches(l, ai.id), { role: 'headCoach' })!;
    delete l.coaches[hc.id];
    const mine = teamCoaches(l, l.userTeamId).find((c) => c.role === 'positionCoach' && !isCoachExpiring(l, c))!;
    delete l.coaches[mine.id];
    const fresh = copy(l); // a fresh coaching index, as after a reload
    ensureCoached(fresh);
    expect(chairHolder(teamCoaches(fresh, ai.id), { role: 'headCoach' })).not.toBeNull();
    const other = copy(l);
    coachWindowCloses(other);
    for (const t of other.teams)
      if (t.id !== other.userTeamId)
        for (const ch of CHAIRS)
          expect(chairHolder(teamCoaches(other, t.id), ch), `${t.abbrev} ${ch.role}`).not.toBeNull();
    // The user's empty chair is his to fill.
    expect(chairHolder(teamCoaches(other, other.userTeamId), chairOf(mine))).toBeNull();
  });

  it('fires head coaches after bad seasons, rarely after one, never after good ones', () => {
    expect(hotSeat({ w: 3, l: 14, t: 0 }, 3)).toBeGreaterThan(0.4);
    expect(hotSeat({ w: 3, l: 14, t: 0 }, 1)).toBe(0);
    expect(hotSeat({ w: 1, l: 16, t: 0 }, 1)).toBeGreaterThan(0);
    expect(hotSeat({ w: 9, l: 8, t: 0 }, 5)).toBe(0);
    expect(hotSeat({ w: 13, l: 4, t: 0 }, 5)).toBe(0);
  });

  it('puts AI head coaches on the hot seat at the window, and never re-hires the man just let go', () => {
    const l = createLeague({ seed: 'hot-seat' });
    l.phase = 'resign';
    l.season += 3;
    l.history.push({
      season: l.season - 1,
      championId: 31,
      runnerUpId: 30,
      records: Object.fromEntries(l.teams.map((t) => [t.id, { w: 8, l: 9, t: 0 }])),
    });
    const last = l.history.at(-1)!;
    // This review isolates coaching accountability: each GM is new, but each head coach has had time.
    for (const t of l.teams) {
      const job = l.gms[t.gmId!].appointments.at(-1)!;
      job.start.season = l.season - 1;
      job.priorSeasons = 0;
    }
    const ai = l.teams.filter((t) => t.id !== l.userTeamId);
    const before = new Map(ai.map((t) => [t.id, chairHolder(teamCoaches(l, t.id), { role: 'headCoach' })!]));
    const [bad, good] = [ai.slice(0, 16), ai.slice(16)];
    for (const t of bad) {
      last.records[t.id] = { w: 1, l: 16, t: 0 };
      before.get(t.id)!.since = l.season - 3;
    }
    for (const t of good) last.records[t.id] = { w: 13, l: 4, t: 0 };
    leadershipNewYear(l);
    enforceCoachChanges(l, true);
    coachWindowCloses(l);
    // Three in four of a 1–16 team's veteran head coaches go; a 13–4 team never fires its man.
    const fired = bad.filter((t) => before.get(t.id)!.teamId !== t.id);
    expect(fired.length).toBeGreaterThan(6);
    for (const t of good) expect(before.get(t.id)!.lastJob ?? '').not.toMatch(/season/);
    for (const t of fired) {
      expect(before.get(t.id)!.teamId).not.toBe(t.id);
      expect(chairHolder(teamCoaches(l, t.id), { role: 'headCoach' })).not.toBeNull();
    }
    // Nobody an AI team let go in this window is back on that team.
    for (const t of ai) for (const c of teamCoaches(l, t.id)) expect(c.lastJob ?? '').not.toContain(`, ${t.abbrev}`);
    expect(l.transactions.some((tx) => tx.kind === 'coach' && /(dismissed|let go) head coach/.test(tx.text))).toBe(
      true,
    );
  });

  it('keeps the coaching economy steady over several offseasons, with head coaches changing jobs', () => {
    const l = createLeague({ seed: 'coach-economy' });
    let fired = 0;
    for (let y = 0; y < 4; y++) {
      simToEndOfSeason(l);
      simOffseason(l);
      fired += l.transactions.filter(
        (t) => t.season === l.season && t.kind === 'coach' && /(dismissed|let go) head coach/.test(t.text),
      ).length;
      const employed = Object.values(l.coaches).filter((c) => c.teamId !== null);
      const meanValue = mean(employed.map(coachValue));
      expect(meanValue).toBeGreaterThan(9.5);
      expect(meanValue).toBeLessThan(11.5);
      expect(coachMarket(l).length).toBeLessThan(160);
      for (const team of l.teams) {
        for (const ch of CHAIRS) expect(chairHolder(teamCoaches(l, team.id), ch)).not.toBeNull();
        // A team with nobody affordable left signs a journeyman on a one-year deal even over budget
        // (a chair can't stay empty), so a few percent over is allowed.
        expect(coachPayroll(l, team.id)).toBeLessThanOrEqual(coachBudget(l, team.id) * 1.12);
      }
    }
    expect(fired).toBeGreaterThan(0);
  });
});

describe('the coaching carousel', () => {
  it('moves a coach one rung up: a position coach to his side’s coordinator, a coordinator to head coach', () => {
    expect(promotionFor({ role: 'positionCoach', room: 'QB' })).toEqual({ role: 'offCoord' });
    expect(promotionFor({ role: 'positionCoach', room: 'DB' })).toEqual({ role: 'defCoord' });
    expect(promotionFor({ role: 'defCoord' })).toEqual({ role: 'headCoach' });
    expect(promotionFor({ role: 'strengthCoach' })).toBeNull();
    expect(promotionFor({ role: 'headCoach' })).toBeNull();
  });

  it('lets the user promote from within: same man and ratings, the scheme a preview showed, his old chair open', () => {
    const l = offseason('promote');
    const user = l.userTeamId;
    l.teams[user].staffBudgetMult = 2; // money is tested on its own
    releaseCoach(l, user, chairHolder(teamCoaches(l, user), { role: 'offCoord' })!.id);
    const qb = chairHolder(teamCoaches(l, user), { role: 'positionCoach', room: 'QB' })!;
    const ratings = { youth: qb.youth, veterans: qb.veterans };
    const preview = asPromoted(l, qb, { role: 'offCoord' });
    expect(promotionProblem(l, user, qb)).toBeNull();
    promoteCoach(l, user, qb.id);
    expect(qb).toMatchObject({
      role: 'offCoord',
      teamId: user,
      ...ratings,
      scheme: preview.scheme,
      style: preview.style,
    });
    expect(qb.room).toBeUndefined();
    expect(chairHolder(teamCoaches(l, user), { role: 'positionCoach', room: 'QB' })).toBeNull();
    // The chair above a defensive line coach is taken.
    expect(
      promotionProblem(l, user, chairHolder(teamCoaches(l, user), { role: 'positionCoach', room: 'DL' })!),
    ).toMatch(/holds that chair/);
  });

  it('lets AI teams promote off other staffs (nobody can block a promotion) and still fills every AI chair', () => {
    const l = offseason('poach');
    for (const t of l.teams.filter((x) => x.id !== l.userTeamId).slice(0, 10)) {
      const current = chairHolder(teamCoaches(l, t.id), { role: 'headCoach' });
      if (current) delete l.coaches[current.id];
    }
    const fresh = copy(l); // a fresh coaching index, as after a reload
    coachWindowCloses(fresh);
    expect(
      fresh.transactions.some((tx) => tx.season === fresh.season && tx.kind === 'coach' && tx.teamIds.length > 1),
    ).toBe(true);
    for (const t of fresh.teams)
      if (t.id !== fresh.userTeamId)
        for (const ch of CHAIRS)
          expect(chairHolder(teamCoaches(fresh, t.id), ch), `${t.abbrev} ${ch.role}`).not.toBeNull();
  });

  it('gives a head coach a vision: an aggressive one wants to throw, a former play-caller his own offense', () => {
    const l = createLeague({ seed: 'vision' });
    const hc = chairHolder(teamCoaches(l, 0), { role: 'headCoach' })!;
    const oc = chairHolder(teamCoaches(l, 0), { role: 'offCoord' })!;
    const bold = { ...hc, style: { fourthDown: 0.8 } };
    expect(headCoachVision(l, bold).pass).toBeGreaterThan(
      headCoachVision(l, { ...hc, style: { fourthDown: -0.8 } }).pass,
    );
    expect(headCoachVision(l, { ...hc, style: { fourthDown: 0, passLean: -0.6 } }).pass).toBe(-0.6);
    expect(visionFit(l, bold, { ...oc, style: { passLean: 0.7 } })!).toBeGreaterThan(
      visionFit(l, bold, { ...oc, style: { passLean: -0.7 } })!,
    );
    expect(visionFit(l, bold, hc)).toBeNull();
  });

  it('sends some retiring veterans into coaching, nearly always in their own room, linked to their playing record', () => {
    const l = createLeague({ seed: 'to-coach' });
    const vets = Object.values(l.players)
      .filter((p) => p.teamId !== null)
      .slice(0, 800);
    for (const p of vets) p.experience = 10;
    developCoaches(l, vets);
    const ex = Object.values(l.coaches).filter((c) => c.playerId !== undefined);
    expect(ex.length).toBeGreaterThan(25);
    expect(ex.length).toBeLessThan(150);
    for (const c of ex) {
      const p = l.players[c.playerId!];
      expect(c).toMatchObject({
        role: 'positionCoach',
        teamId: null,
        firstName: p.firstName,
        lastName: p.lastName,
        age: p.age,
      });
      expect(ROOM_OF[p.position]).not.toBeNull(); // kickers and punters have no room to coach
      expect(coachOfPlayer(l, p.id)).toBe(c);
    }
    expect(ex.filter((c) => c.room === ROOM_OF[l.players[c.playerId!].position]).length / ex.length).toBeGreaterThan(
      0.7,
    );
  });
});

describe('owners', () => {
  it('spend what their markets earn: centred on the average owner, the biggest market most, the user’s owner too', () => {
    const l = createLeague({ seed: 'owners', userTeamId: 16 });
    const mults = l.teams.map((t) => t.staffBudgetMult);
    expect(mean(mults)).toBeCloseTo(1, 1);
    expect(l.teams[16].abbrev).toBe('DAL');
    expect(l.teams[16].staffBudgetMult).toBe(Math.max(...mults));
    expect(l.teams.find((t) => t.abbrev === 'JAX')!.staffBudgetMult).toBe(Math.min(...mults));
    // A market without a revenue figure (a mod's) gets the average owner.
    expect(ownerBudgets([600, 600, undefined])).toEqual([1, 1, 1]);
  });

  it('go past the coaching budget only for the men who run the team, when it makes sense, and never two years running', () => {
    const l = offseason('owner-leeway');
    const user = l.userTeamId;
    l.teams[user].staffBudgetMult = 1;
    const last = l.history.find((h) => h.season === l.season - 1)!;
    expect(ownerLeeway(l, user, { role: 'positionCoach', room: 'QB' })).toMatchObject({
      amount: 0,
      reason: 'assistant',
    });
    last.records[user] = { w: 4, l: 13, t: 0 };
    if (last.playoffs) delete last.playoffs[user];
    expect(ownerLeeway(l, user, { role: 'offCoord' })).toMatchObject({ amount: 0, reason: 'losing' });
    expect(ownerLeeway(l, user, { role: 'headCoach' }).reason).toBe('newCoach');
    last.records[user] = { w: 12, l: 5, t: 0 };
    (last.playoffs ??= {})[user] = { w: 1, l: 1, round: 'DIV' };
    expect(ownerLeeway(l, user, { role: 'offCoord' }).reason).toBe('playoffs');
    // A hire past the budget by less than he'll add goes through; by more, it's blocked with his answer.
    releaseCoach(l, user, chairHolder(teamCoaches(l, user), { role: 'offCoord' })!.id);
    const pick = coachMarket(l).find((c) => c.role === 'offCoord')!;
    // Room is set with a ledger entry, not the owner's money: his leeway is a share of his budget.
    const setRoom = (room: number) => {
      const team = l.teams[user];
      team.coachDead = team.coachDead.filter((d) => d.name !== 'test');
      team.coachDead.push({ season: l.season, amount: coachRoom(l, user) - room, name: 'test' });
    };
    setRoom(coachAsk(l, pick) - 100);
    expect(ownerLeeway(l, user, { role: 'offCoord' }).amount).toBeGreaterThan(100);
    expect(coachMoveProblem(l, user, pick, 'hire')).toBeNull();
    setRoom(coachAsk(l, pick) - ownerLeeway(l, user, { role: 'offCoord' }).amount - 500);
    expect(coachMoveProblem(l, user, pick, 'hire')).toMatch(/your owner will add/);
    l.teams[user].coachOverspent = l.season - 1;
    expect(ownerLeeway(l, user, { role: 'headCoach' })).toMatchObject({ amount: 0, reason: 'lastYear' });
  });

  it('upgrades older saves: owners from their markets, and an empty archive of retired coaches', () => {
    const l = createLeague({ seed: 'owners-v14' });
    const old = copy(l);
    old.version = 14;
    for (const t of old.teams) t.staffBudgetMult = 1;
    delete (old as Partial<League>).retiredCoaches;
    const up = migrateLeague(old)!;
    expect(up.version).toBe(SAVE_VERSION);
    expect(up.retiredCoaches).toEqual({});
    expect(up.teams.map((t) => t.staffBudgetMult)).toEqual(l.teams.map((t) => t.staffBudgetMult));
  });
});

describe('coaches who leave football', () => {
  it('keep their career on file, so their record outlives them; candidates who never coached are forgotten', () => {
    const l = createLeague({ seed: 'coach-archive' });
    simToEndOfSeason(l);
    const hc = chairHolder(teamCoaches(l, 3), { role: 'headCoach' })!;
    const unknown = coachMarket(l).find((c) => !c.career?.length)!;
    hc.age = unknown.age = 80; // past any retirement age
    const record = coachRecord(l, hc);
    beginOffseason(l);
    for (const c of [hc, unknown]) expect(l.coaches[c.id]).toBeUndefined();
    const kept = l.retiredCoaches[hc.id];
    expect(kept).toMatchObject({
      teamId: null,
      contract: null,
      career: [{ season: l.season - 1, teamId: 3, role: 'headCoach' }],
    });
    expect(kept.since).toBeUndefined();
    expect(coachRecord(l, kept)).toEqual(record);
    expect(l.retiredCoaches[unknown.id]).toBeUndefined();
  });
});

describe('play-calling style', () => {
  it('belongs to the coaches: the coordinator calls the plays, the head coach decides fourth downs', () => {
    const l = createLeague({ seed: 'style' });
    const team = l.teams[3];
    const staff = teamCoaches(l, team.id);
    const hc = chairHolder(staff, { role: 'headCoach' })!;
    const oc = chairHolder(staff, { role: 'offCoord' })!;
    expect(hc.style?.passLean).toBeUndefined();
    expect(oc.style?.fourthDown).toBeUndefined();
    hc.style = { fourthDown: 0.6 };
    oc.style = { passLean: 0.5 };
    expect(callerStyle(l, team.id)).toEqual({ passLean: 0.5, fourthDown: 0.6 });
    // Without a coordinator the offense calls a league-average game.
    delete l.coaches[oc.id];
    expect(callerStyle(copy(l), team.id)).toEqual({ passLean: 0, fourthDown: 0.6 });
    expect(chairHolder(teamCoaches(l, team.id), { role: 'defCoord' })!.style).toBeUndefined();
  });

  it('changes the mix in ordinary situations, never the end of a half or a game', () => {
    const s: Situation = {
      quarter: 1,
      clock: 600,
      down: 1,
      distance: 10,
      yardLine: 30,
      scoreDiff: 0,
      offTimeouts: 3,
      defTimeouts: 3,
      overtime: false,
      fgMakeProb: 0.2,
    };
    expect(passProbability({ ...s, passLean: 1 })).toBeGreaterThan(passProbability(s));
    expect(passProbability({ ...s, passLean: -1 })).toBeLessThan(passProbability(s));
    // The two-minute drill, protecting a lead, backed up late in a half, overtime: the clock and score decide.
    const late: Situation[] = [
      { ...s, quarter: 4, clock: 100, scoreDiff: -4 },
      { ...s, quarter: 4, clock: 200, scoreDiff: 7 },
      { ...s, quarter: 2, clock: 100, down: 2, distance: 7, yardLine: 20 },
      { ...s, quarter: 4, clock: 110, yardLine: 20 },
      { ...s, quarter: 5, clock: 500, overtime: true },
    ];
    for (const x of late)
      for (const lean of [-1, 1]) expect(passProbability({ ...x, passLean: lean })).toBe(passProbability(x));
    // Fourth and one near midfield in the first half: an aggressive coach goes more often.
    const fourth = { ...s, down: 4, distance: 1, yardLine: 45 };
    const goRate = (x: Situation, lean: number) => {
      const rng = new Rng(`fourth:${lean}`);
      let go = 0;
      for (let i = 0; i < 4000; i++) if (fourthDown({ ...x, fourthDown: lean }, rng) === 'go') go++;
      return go / 4000;
    };
    expect(goRate(fourth, 1)).toBeGreaterThan(goRate(fourth, 0) + 0.15);
    expect(goRate(fourth, -1)).toBeLessThan(goRate(fourth, 0) - 0.15);
    // Tied with ten seconds left, or up three at the two-minute warning: the same odds for every coach.
    const odds = (x: Situation) => {
      const seen: number[] = [];
      fourthDown(x, { chance: (p: number) => (seen.push(p), false) } as unknown as Rng);
      return seen;
    };
    for (const x of [
      { ...fourth, quarter: 4, clock: 10, yardLine: 50 },
      { ...fourth, quarter: 4, clock: 150, scoreDiff: 3 },
      { ...fourth, quarter: 2, clock: 90 },
    ]) {
      expect(odds({ ...x, fourthDown: 1 })).toEqual(odds(x));
      expect(odds({ ...x, fourthDown: -1 })).toEqual(odds(x));
    }
  });

  it('reaches the field: a pass-first coordinator throws more, an aggressive head coach goes for it more', () => {
    const base = createLeague({ seed: 'style-games' });
    const styled = (lean: number) => {
      const l = copy(base); // a fresh coaching index
      for (const c of Object.values(l.coaches)) {
        if (c.role === 'offCoord') c.style = { passLean: lean };
        if (c.role === 'headCoach') c.style = { fourthDown: lean };
      }
      return l;
    };
    const tally = (l: League) => {
      let passes = 0;
      let plays = 0;
      let fourth = 0;
      for (const g of l.games.slice(0, 64)) {
        const r = simulateGame(l, g);
        for (const t of [r.home, r.away]) {
          passes += t.passAtt + t.sacked;
          plays += t.passAtt + t.sacked + t.rushAtt;
          fourth += t.fourthDownAtt;
        }
      }
      return { pass: passes / plays, fourth };
    };
    const hi = tally(styled(1));
    const lo = tally(styled(-1));
    expect(hi.pass).toBeGreaterThan(lo.pass + 0.04);
    expect(hi.fourth).toBeGreaterThan(lo.fourth);
  });
});

describe('save migration to v6', () => {
  it('gives an opening-season save the same staffs a new league has', () => {
    const league = createLeague({ seed: 'migrate-v6' });
    const old = copy(league);
    old.version = 5;
    delete (old as Partial<League>).coaches;
    delete (old as Partial<League>).nextCoachId;
    for (const t of old.teams) delete (t as Partial<typeof t>).coachDead;
    const up = migrateLeague(old)!;
    expect(up.version).toBe(SAVE_VERSION);
    expect(up.coaches).toEqual(league.coaches);
    expect(up.teams.map((t) => t.coachDead)).toEqual(league.teams.map((t) => t.coachDead));
    expect(up.rngState).toEqual(league.rngState);
    expect(migrateLeague(copy(up))).toEqual(up);
  });

  it('gives a mid-career save full staffs inside every budget', () => {
    const league = createLeague({ seed: 'migrate-v6-later' });
    simToEndOfSeason(league);
    simOffseason(league);
    const old = copy(league);
    old.version = 5;
    delete (old as Partial<League>).coaches;
    delete (old as Partial<League>).nextCoachId;
    for (const t of old.teams) delete (t as Partial<typeof t>).coachDead;
    const up = migrateLeague(old)!;
    for (const t of up.teams) {
      for (const ch of CHAIRS) expect(chairHolder(teamCoaches(up, t.id), ch)).not.toBeNull();
      expect(coachPayroll(up, t.id)).toBeLessThanOrEqual(coachBudget(up, t.id));
      for (const c of teamCoaches(up, t.id)) expect(c.contract!.through).toBeGreaterThanOrEqual(up.season);
    }
    expect(up.rngState).toEqual(league.rngState);
  });
});

describe('special teams coordinator', () => {
  it('coaches the kickers and punters, and his quality shows in his kick units on game day', () => {
    const league = createLeague({ seed: 'st-coord' });
    const team = league.teams[0];
    const staff = teamCoaches(league, team.id);
    const st = chairHolder(staff, { role: 'stCoord' })!;
    expect(st).not.toBeNull();
    for (const pos of ['K', 'P'] as const)
      expect(coachingParts(staff, pos).find((p) => p.coach === st)?.source).toBe('positionCoach');
    expect(specialTeamsEdge(league, team.id)).toBeCloseTo(coachValue(st) - TYPICAL, 9);
    const before = buildLineup(league, team);
    st.youth = 18;
    st.veterans = 18;
    const after = buildLineup(league, team);
    expect(after.stCoach).toBeCloseTo(18 - TYPICAL, 9);
    // Half a point of discipline per point of his quality, on every kick unit.
    for (const k of ['specialDiscipline', 'fgDiscipline', 'blockDiscipline'] as const)
      expect(after[k] - before[k]).toBeCloseTo(0.5 * (after.stCoach - before.stCoach), 9);
  });

  it('gives a v18 save a special teams coordinator on every team, inside the budget, and candidates on the market', () => {
    const league = createLeague({ seed: 'st-migrate' });
    const old = copy(league);
    old.version = 18;
    for (const c of Object.values(old.coaches)) if (c.role === 'stCoord') delete old.coaches[c.id];
    const up = migrateLeague(old)!;
    expect(up.version).toBe(SAVE_VERSION);
    for (const t of up.teams) {
      expect(chairHolder(teamCoaches(up, t.id), { role: 'stCoord' })).not.toBeNull();
      expect(coachPayroll(up, t.id)).toBeLessThanOrEqual(coachBudget(up, t.id));
    }
    expect(coachMarket(up).some((c) => c.role === 'stCoord')).toBe(true);
    expect(migrateLeague(copy(up))).toEqual(up);
  });
});

describe('an interim head coach keeps his coordinator job', () => {
  const midseason = (seed = 'interim-acting') => {
    const l = createLeague({ seed });
    l.phase = 'regular';
    l.week = 11;
    l.teams[3].staffBudgetMult = 3;
    return l;
  };
  const best = (l: League, role: 'offCoord' | 'defCoord') => {
    const c = teamCoaches(l, 3).find((c) => c.role === role)!;
    c.youth = 20;
    c.veterans = 20;
    return c;
  };
  it('leaves his old chair to him and hires nobody into it', () => {
    const l = midseason();
    const dc = best(l, 'defCoord');
    const front = dc.scheme!.front!;
    const hc = installInterimHeadCoach(l, 3)!;
    expect(hc.id).toBe(dc.id);
    expect(hc.actingAs).toBe('defCoord');
    expect(chairHolder(teamCoaches(l, 3), { role: 'defCoord' })).toBeNull();
    expect(coordinatorOf(teamCoaches(l, 3), 'defCoord')!.id).toBe(dc.id);
    expect(teamScheme(l, 3).front).toBe(FRONTS[front]);
  });
  it('reads the offense and its calls from him when he was the offensive coordinator', () => {
    const l = midseason();
    const oc = best(l, 'offCoord');
    oc.style = { ...oc.style, passLean: 0.4 };
    const offense = oc.scheme!.offense!;
    installInterimHeadCoach(l, 3);
    expect(oc.actingAs).toBe('offCoord');
    expect(teamScheme(l, 3).offense).toBe(OFF_SCHEMES[offense]);
    expect(callerStyle(l, 3).passLean).toBe(0.4);
  });
  it('counts him as the coordinator for development', () => {
    const l = midseason();
    const dc = best(l, 'defCoord');
    installInterimHeadCoach(l, 3);
    expect(coachingParts(teamCoaches(l, 3), 'LB').find((p) => p.source === 'coordinator')!.coach!.id).toBe(dc.id);
  });
  it('gives up the chair when a coordinator is hired into it', () => {
    const l = midseason();
    const dc = best(l, 'defCoord');
    installInterimHeadCoach(l, 3);
    l.phase = 'resign';
    const hire = coachMarket(l).find((c) => c.role === 'defCoord')!;
    hireCoach(l, 3, hire.id, 1);
    expect(dc.actingAs).toBeUndefined();
    expect(coordinatorOf(teamCoaches(l, 3), 'defCoord')!.id).toBe(hire.id);
  });
  it('gives up the chair when made permanent', () => {
    const l = midseason();
    const dc = best(l, 'defCoord');
    installInterimHeadCoach(l, 3);
    l.season++;
    l.phase = 'resign';
    resolveInterimHeadCoach(l, dc, true);
    expect(dc.actingAs).toBeUndefined();
    expect(coordinatorOf(teamCoaches(l, 3), 'defCoord')).toBeNull();
  });
  it('leaves no acting chair on a coach who retires', () => {
    const l = midseason();
    const dc = best(l, 'defCoord');
    installInterimHeadCoach(l, 3);
    dc.age = 90;
    dc.career = [{ season: l.season, teamId: 3, role: 'defCoord' }];
    developCoaches(l);
    expect(l.retiredCoaches[dc.id]).toBeDefined();
    expect(l.retiredCoaches[dc.id].actingAs).toBeUndefined();
  });
  it('keeps no money aside for the chair the interim covers', () => {
    const l = midseason();
    best(l, 'defCoord');
    installInterimHeadCoach(l, 3);
    expect(unpaidChairs(l, 3, { role: 'stCoord' }).some((ch) => ch.role === 'defCoord')).toBe(false);
  });
  it('never acts as coordinator when the interim came from the market', () => {
    const l = midseason();
    for (const c of teamCoaches(l, 3).filter((c) => c.role === 'offCoord' || c.role === 'defCoord')) c.teamId = null;
    const hc = installInterimHeadCoach(l, 3)!;
    expect(hc.actingAs).toBeUndefined();
  });
});
