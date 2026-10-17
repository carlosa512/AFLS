import { describe, expect, it } from 'vitest';
import {
  CHAIRS,
  chairHolder,
  coachAsk,
  coachBudget,
  coachingFor,
  coachingFrom,
  coachingParts,
  coachMarket,
  coachMoveProblem,
  coachPayroll,
  coachResignForecast,
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
  roomEffect,
  sameChair,
  chairOf,
  teamCoaches,
  TYPICAL,
  type Chair,
} from './coaching';
import { developPlayer } from './development';
import { createLeague, generatePlayer, SAVE_VERSION } from './generate';
import { simToEndOfSeason } from './league';
import { fourthDown, passProbability, type Situation } from './match/coach';
import { migrateLeague } from './migrate';
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
  CHAIRS.map((ch, i) => ({ id: -i - 1, firstName: 'A', lastName: String(i), ...ch, age: 50, youth: rating, veterans: rating, teamId: 0, contract: null, ...overrides[ch.room ?? ch.role] }));

function rookie(pos: Position, age: number, i: number): Player {
  return generatePlayer(new Rng(`coach-test:${pos}:${i}`), { id: 2_000_000 + i, position: pos, quality: 11, age, teamId: null, jerseysUsed: new Set() });
}

/** Average change in overall over `years` offseasons for the same players under a given staff. */
function careerUnder(staff: Coach[] | null, pos: Position, age: number, years: number, n = 300): number {
  const coaching = staff ? coachingFrom(staff, pos) : NEUTRAL;
  const deltas: number[] = [];
  for (let i = 0; i < n; i++) {
    const p = rookie(pos, age, i);
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
    // Kickers and punters have no room or side: the head coach and S&C coach carry them.
    expect(coachingFrom(staffOf(TYPICAL, { headCoach: { youth: 18 } }), 'K').rate).toBeGreaterThan(star('headCoach').rate);
  });

  it('adds up the parts a screen shows to exactly what development applies', () => {
    const staff = staffOf(TYPICAL, { WR: { youth: 16, veterans: 7 }, headCoach: { youth: 12, veterans: 13 }, strengthCoach: { youth: 9, veterans: 15 } });
    for (const pos of ['WR', 'TE', 'K'] as Position[]) {
      const parts = coachingParts(staff, pos);
      const c = coachingFrom(staff, pos);
      expect(1 + parts.reduce((s, p) => s + p.growth, 0)).toBeCloseTo(c.rate, 10);
      expect(1 + parts.reduce((s, p) => s + p.body, 0)).toBeCloseTo(c.decline.physical, 10);
      expect(1 + parts.reduce((s, p) => s + p.craft, 0)).toBeCloseTo(c.decline.technical, 10);
      for (const k of ['growth', 'body', 'craft'] as const) expect(parts.reduce((s, p) => s + p.weight[k], 0)).toBeCloseTo(1, 10);
    }
    expect(roomEffect(staff, 'WR').growth).toBeGreaterThan(0.1);
    expect(roomEffect(staff, 'QB').growth).toBeCloseTo(roomEffect(staffOf(TYPICAL, { headCoach: { youth: 12 }, strengthCoach: { youth: 9 } }), 'QB').growth, 10);
  });

  it('grows young players faster and ages veterans more gently under better coaches, less than work ethic does', () => {
    const strong = staffOf(14);
    const weak = staffOf(7);
    const youngGap = careerUnder(strong, 'WR', 21, 5) - careerUnder(weak, 'WR', 21, 5);
    expect(youngGap).toBeGreaterThan(0.1);
    expect(youngGap).toBeLessThan(0.8);
    const oldGap = careerUnder(strong, 'RB', 28, 3) - careerUnder(weak, 'RB', 28, 3);
    expect(oldGap).toBeGreaterThan(0.2);
    // A typical staff is exactly today's development.
    expect(careerUnder(staffOf(TYPICAL), 'CB', 22, 4, 60)).toBe(careerUnder(null, 'CB', 22, 4, 60));
    // Clamped: no staff makes anyone a different player.
    const best = coachingFrom(staffOf(20), 'WR');
    expect(best.rate).toBeLessThanOrEqual(1.3);
    expect(best.decline.physical).toBeGreaterThanOrEqual(0.8);
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
    const young = Object.values(l.players).filter((p) => p.teamId !== null && p.age <= 23 && p.potential - playerOvr(p) > 1);
    const old = Object.values(l.players).filter((p) => p.teamId !== null && p.age >= 31 && !strong.players[p.id].retired && !weak.players[p.id].retired);
    expect(young.length).toBeGreaterThan(100);
    const change = (lg: League, ps: Player[]) => mean(ps.map((p) => playerOvr(lg.players[p.id]) - playerOvr(p)));
    expect(change(strong, young)).toBeGreaterThan(change(weak, young) + 0.1);
    expect(change(strong, old)).toBeGreaterThan(change(weak, old));
    // Nobody coaches a free agent: his year is the same either way.
    const fa = Object.values(l.players).find((p) => p.teamId === null && !p.retired)!;
    expect(strong.players[fa.id].ratings).toEqual(weak.players[fa.id].ratings);
  }, 30_000);
});

describe('coaching staffs and moves', () => {
  it('gives every AI team a full staff inside its budget, and the user one open position room', () => {
    const l = createLeague({ seed: 'staffs' });
    for (const team of l.teams) {
      const staff = teamCoaches(l, team.id);
      const open = CHAIRS.filter((ch) => !chairHolder(staff, ch));
      if (team.id === l.userTeamId) {
        expect(open).toHaveLength(1);
        expect(open[0].role).toBe('positionCoach');
      } else expect(open).toHaveLength(0);
      expect(coachPayroll(l, team.id)).toBeLessThanOrEqual(coachBudget(l, team.id));
      // One coach per chair.
      for (const ch of CHAIRS) expect(staff.filter((c) => sameChair(chairOf(c), ch)).length).toBeLessThanOrEqual(1);
    }
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
    const openChairs = (l: League, id: number) => CHAIRS.filter((ch) => !chairHolder(teamCoaches(l, id), ch)).length;
    expect(openChairs(picked, 7)).toBe(1);
    expect(openChairs(picked, 0)).toBe(0);
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
    const open = CHAIRS.find((ch) => !chairHolder(teamCoaches(l, user), ch))!;
    // Fill the open room with the cheapest candidate for it.
    const cheapest = coachMarket(l)
      .filter((c) => sameChair(chairOf(c), open))
      .sort((a, b) => coachAsk(l, a) - coachAsk(l, b))[0];
    hireCoach(l, user, cheapest.id, 3);
    expect(cheapest.teamId).toBe(user);
    expect(cheapest.since).toBe(l.season);
    expect(cheapest.contract!.through).toBe(l.season + 2);
    // A second coach for a filled chair needs a replace; the old one's money comes back, less severance.
    const rival = coachMarket(l).find((c) => sameChair(chairOf(c), open))!;
    expect(coachMoveProblem(l, user, rival, 'hire')).toMatch(/already have a/);
    expect(replaceProblem(l, user, rival)).toBeNull();
    const payroll = coachPayroll(l, user);
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
    // One year left: half a year's salary.
    const oneYear = teamCoaches(l, user).find((c) => c.contract!.through === l.season)!;
    if (oneYear) expect(coachSeverance(l, oneYear)).toBe(Math.round(oneYear.contract!.salary * 0.5));
    // Over budget is refused with the reason; terms are capped by role.
    l.teams[user].staffBudgetMult = 0.1;
    expect(coachMoveProblem(l, user, coachMarket(l).find((c) => c.role === 'positionCoach')!, 'hire')).toMatch(/Over your coaching budget|already have/);
    l.teams[user].staffBudgetMult = 1;
    const coord = coachMarket(l).find((c) => c.role === 'offCoord')!;
    expect(coachMoveProblem(l, user, coord, 'hire', 5)).toMatch(/1–3 years/);
    // Only expiring deals extend.
    const signed = teamCoaches(l, user).find((c) => !isCoachExpiring(l, c))!;
    expect(() => extendCoach(l, user, signed.id)).toThrow(/expiring/);
    // Dismissing someone else's coach is refused.
    const theirs = teamCoaches(l, (user + 1) % 32)[0];
    expect(() => releaseCoach(l, user, theirs.id)).toThrow();
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
    advanceOffseason(l); // resign -> free agency
    expect(letGo.teamId).not.toBe(user);
    for (const c of keep) {
      expect(c.teamId).toBe(user);
      expect(c.contract!.through).toBe(l.season + 1);
    }
  });

  it('applies exactly what the re-sign forecast promised', () => {
    const l = offseason('coach-forecast');
    const user = l.userTeamId;
    const expiring = teamCoaches(l, user).filter((c) => isCoachExpiring(l, c));
    const target = expiring[0];
    expect(target).toBeDefined();
    // Hire into his chair: he can't be extended into it, and the forecast says so.
    l.teams[user].staffBudgetMult = 5;
    const rival = coachMarket(l).find((c) => sameChair(chairOf(c), chairOf(target)))!;
    expect(coachesPushedOutBy(l, user, rival).map((c) => c.id)).toContain(target.id);
    hireCoach(l, user, rival.id, 1);
    expect(coachResignForecast(l, user).get(target.id)).toBe('chair');
    expect(coachMoveProblem(l, user, target, 'extend')).toMatch(/chair is taken/);
    // And a budget too small for anyone's raise.
    l.teams[user].staffBudgetMult = 0.05;
    const forecast = coachResignForecast(l, user);
    for (const c of expiring) if (c !== target) expect(forecast.get(c.id)).toBe('budget');
    advanceOffseason(l); // the window closes
    for (const [id, outlook] of forecast) {
      const c = l.coaches[id];
      if (outlook === 'stays') expect(c.teamId).toBe(user);
      else expect(c?.teamId ?? null).not.toBe(user);
    }
    for (const ch of CHAIRS) expect(teamCoaches(l, user).filter((c) => sameChair(chairOf(c), ch)).length).toBeLessThanOrEqual(1);
  });

  it('previews what a hire would change, losses included', () => {
    const l = offseason('coach-preview');
    const user = l.userTeamId;
    const open = CHAIRS.find((ch) => !chairHolder(teamCoaches(l, user), ch))!;
    const star = coachMarket(l).find((c) => sameChair(chairOf(c), open))!;
    star.youth = 19;
    star.veterans = 19;
    const changes = previewCoachHire(l, user, star);
    expect(changes.length).toBeGreaterThan(0);
    for (const c of changes) {
      expect(c.room).toBe(open.room);
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

  it('fills an AI team’s empty chairs before the season, and the window when it closes', () => {
    const l = offseason('coach-chairs');
    const ai = l.teams.find((t) => t.id !== l.userTeamId)!;
    const hc = chairHolder(teamCoaches(l, ai.id), { role: 'headCoach' })!;
    delete l.coaches[hc.id];
    const fresh = copy(l); // a fresh coaching index, as after a reload
    ensureCoached(fresh);
    expect(chairHolder(teamCoaches(fresh, ai.id), { role: 'headCoach' })).not.toBeNull();
    const other = copy(l);
    coachWindowCloses(other);
    for (const t of other.teams) if (t.id !== other.userTeamId) for (const ch of CHAIRS) expect(chairHolder(teamCoaches(other, t.id), ch), `${t.abbrev} ${ch.role}`).not.toBeNull();
    // The user's empty chair is his to fill.
    expect(CHAIRS.some((ch: Chair) => !chairHolder(teamCoaches(other, other.userTeamId), ch))).toBe(true);
  });

  it('fires head coaches after bad seasons, rarely after one, never after good ones', () => {
    expect(hotSeat({ w: 3, l: 14, t: 0 }, 3)).toBeGreaterThan(0.4);
    expect(hotSeat({ w: 3, l: 14, t: 0 }, 1)).toBe(0);
    expect(hotSeat({ w: 1, l: 16, t: 0 }, 1)).toBeGreaterThan(0);
    expect(hotSeat({ w: 9, l: 8, t: 0 }, 5)).toBe(0);
    expect(hotSeat({ w: 13, l: 4, t: 0 }, 5)).toBe(0);
  });

  it('keeps the coaching economy steady over several offseasons, with head coaches changing jobs', () => {
    const l = createLeague({ seed: 'coach-economy' });
    let fired = 0;
    for (let y = 0; y < 4; y++) {
      simToEndOfSeason(l);
      simOffseason(l);
      fired += l.transactions.filter((t) => t.season === l.season && t.kind === 'staff' && /head coach .* after a/.test(t.text)).length;
      const employed = Object.values(l.coaches).filter((c) => c.teamId !== null);
      const meanValue = mean(employed.map(coachValue));
      expect(meanValue).toBeGreaterThan(9.5);
      expect(meanValue).toBeLessThan(11.5);
      expect(coachMarket(l).length).toBeLessThan(160);
      for (const team of l.teams) {
        for (const ch of CHAIRS) expect(chairHolder(teamCoaches(l, team.id), ch)).not.toBeNull();
        expect(coachPayroll(l, team.id)).toBeLessThanOrEqual(coachBudget(l, team.id) * 1.12);
      }
    }
    expect(fired).toBeGreaterThan(0);
  }, 120_000);

  it('never touches the league random stream', () => {
    const l = offseason('coach-stream');
    const state = copy(l.rngState);
    coachWindowCloses(l);
    ensureCoached(l);
    expect(l.rngState).toEqual(state);
  });
});

describe('play-calling style', () => {
  it('belongs to the coaches: the coordinator calls the plays, the head coach decides fourth downs', () => {
    const l = createLeague({ seed: 'style' });
    const team = l.teams[3];
    const staff = teamCoaches(l, team.id);
    const hc = chairHolder(staff, { role: 'headCoach' })!;
    const oc = chairHolder(staff, { role: 'offCoord' })!;
    hc.style = { passLean: -0.8, fourthDown: 0.6 };
    oc.style = { passLean: 0.5 };
    expect(callerStyle(l, team.id)).toEqual({ passLean: 0.5, fourthDown: 0.6 });
    // Without a coordinator, the head coach calls his own plays.
    delete l.coaches[oc.id];
    const fresh = copy(l);
    expect(callerStyle(fresh, team.id)).toEqual({ passLean: -0.8, fourthDown: 0.6 });
    expect(chairHolder(teamCoaches(l, team.id), { role: 'defCoord' })!.style).toBeUndefined();
  });

  it('changes the mix in ordinary situations, never the end of a game', () => {
    const s: Situation = { quarter: 1, clock: 600, down: 1, distance: 10, yardLine: 30, scoreDiff: 0, offTimeouts: 3, defTimeouts: 3, overtime: false, fgMakeProb: 0.2 };
    expect(passProbability({ ...s, passLean: 1 })).toBeGreaterThan(passProbability(s));
    expect(passProbability({ ...s, passLean: -1 })).toBeLessThan(passProbability(s));
    // Two-minute drill and protecting a lead: the clock and score decide.
    const late = { ...s, quarter: 4, clock: 100, scoreDiff: -4 };
    expect(passProbability({ ...late, passLean: -1 })).toBe(passProbability(late));
    const milk = { ...s, quarter: 4, clock: 200, scoreDiff: 7 };
    expect(passProbability({ ...milk, passLean: 1 })).toBe(passProbability(milk));
    // Fourth and one near midfield: an aggressive coach goes more often.
    const fourth = { ...s, down: 4, distance: 1, yardLine: 45 };
    const goRate = (lean: number) => {
      const rng = new Rng(`fourth:${lean}`);
      let go = 0;
      for (let i = 0; i < 4000; i++) if (fourthDown({ ...fourth, fourthDown: lean }, rng) === 'go') go++;
      return go / 4000;
    };
    expect(goRate(1)).toBeGreaterThan(goRate(0) + 0.15);
    expect(goRate(-1)).toBeLessThan(goRate(0) - 0.15);
  });
});

describe('save migration to v6', () => {
  it('adds coaching staffs to an older save that match a new league', () => {
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
});
