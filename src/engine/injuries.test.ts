import { describe, expect, it } from 'vitest';
import { createLeague, generatePlayer, SAVE_VERSION } from './generate';
import {
  activateFromIr,
  activateProblem,
  applyInjury,
  effectiveResistance,
  fatigueMult,
  injectProblem,
  injuryRetireChance,
  injuryRisk,
  injuryType,
  injuryWeek,
  IR_MIN_WEEKS,
  IR_RETURNS,
  irProblem,
  placeOnIr,
  playThrough,
  resistanceMult,
  riskFactors,
  rollInjury,
  snapCost,
  type Mechanism,
} from './injuries';
import { playWeek, simToEndOfRegularSeason } from './league';
import { simulateGame } from './match/gameSim';
import { buildLineup } from './match/lineup';
import { departmentFor, departmentOf, hireMedic, MEDIC_SLOTS, medicAsk, medicalRoom, medicMarket, recoveryMultiplier, releaseMedic, teamMedics } from './medical';
import { migrateLeague } from './migrate';
import { playerOvr } from './positions';
import { Rng } from './rng';
import { activeRoster, isAvailable, teamPlayers } from './roster';
import { quirkWeek } from './quirks';
import { generateTraits } from './traits';
import type { Injury, League, Medic, Player } from './types';

const copy = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

/** A league in its first regular-season week (shared, copied per test). */
const base = createLeague({ seed: 'injuries-test' });
const fresh = () => copy(base);

/** A made-up injury of `weeks`, diagnosed exactly. */
function hurt(league: League, p: Player, weeks: number, type = 'hamstring'): Injury {
  const injury: Injury = { type, severity: weeks > 6 ? 'severe' : weeks > 2 ? 'moderate' : 'minor', weeksRemaining: weeks, estimate: [weeks, weeks], season: league.season, week: league.week, where: 'game' };
  applyInjury(league, p, injury);
  return injury;
}

function player(i: number, age = 26): Player {
  return generatePlayer(new Rng(`injury-player:${i}`), { id: 2_000_000 + i, position: 'WR', quality: 12, age, teamId: null, jerseysUsed: new Set() });
}

describe('injury traits', () => {
  it('rolls resistance and natural fitness after the old traits, so those never moved', () => {
    const p = player(1);
    const t = generateTraits(p);
    expect(t).toEqual(p.traits);
    for (const k of ['injuryResistance', 'naturalFitness'] as const) {
      expect(t[k]).toBeGreaterThanOrEqual(1);
      expect(t[k]).toBeLessThanOrEqual(20);
    }
    const all = Object.values(base.players).map((x) => x.traits.injuryResistance);
    expect(mean(all)).toBeGreaterThan(9.5);
    expect(mean(all)).toBeLessThan(11.5);
  });

  it('fades resistance past the physical prime, slower for a body built to last', () => {
    const p = player(2, 25);
    const at = (age: number, durability: number) => effectiveResistance({ ...p, age, traits: { ...p.traits, durability } });
    expect(at(25, 10.5)).toBeCloseTo(p.traits.injuryResistance, 5);
    expect(at(34, 10.5)).toBeLessThan(at(28, 10.5));
    // The ironman loses less of it at the same age.
    expect(at(34, 10.5) - at(25, 10.5)).toBeLessThan(at(34, 18) - at(25, 18) + 0);
    expect(at(34, 18)).toBeGreaterThan(at(34, 6));
    expect(resistanceMult(5)).toBeGreaterThan(resistanceMult(15));
  });

  it('makes a tired body riskier only below 65', () => {
    expect(fatigueMult(90)).toBe(1);
    expect(fatigueMult(65)).toBe(1);
    expect(fatigueMult(55)).toBeGreaterThan(2);
    expect(fatigueMult(45)).toBeGreaterThan(fatigueMult(55));
  });
});

describe('medical staff', () => {
  it('follows the spec curve: flat at 9 and below, a quarter off at 20', () => {
    expect(recoveryMultiplier(5)).toBe(1);
    expect(recoveryMultiplier(9)).toBe(1);
    expect(recoveryMultiplier(10)).toBeCloseTo(0.99, 5);
    expect(recoveryMultiplier(13)).toBeCloseTo(0.93, 5);
    expect(recoveryMultiplier(14)).toBeCloseTo(0.92, 5);
    expect(recoveryMultiplier(17)).toBeCloseTo(0.83, 5);
    expect(recoveryMultiplier(18)).toBeCloseTo(0.82, 5);
    expect(recoveryMultiplier(20)).toBeCloseTo(0.75, 5);
    for (let r = 1; r < 20; r += 0.5) expect(recoveryMultiplier(r + 0.5)).toBeLessThanOrEqual(recoveryMultiplier(r));
  });

  it('gives every team a full department inside its budget, and a market to hire from', () => {
    for (const team of base.teams) {
      const staff = teamMedics(base, team.id);
      expect(staff.length).toBe(Object.values(MEDIC_SLOTS).reduce((a, b) => a + b, 0));
      expect(medicalRoom(base, team.id)).toBeGreaterThanOrEqual(0);
    }
    expect(medicMarket(base).length).toBeGreaterThan(20);
  });

  it('heals faster behind elite rehab', () => {
    const league = fresh();
    const p = Object.values(league.players).find((x) => x.teamId === 0)!;
    const staff = (rating: number): Medic[] =>
      (['doctor', 'physio', 'physio', 'scientist'] as const).map((role, i) => ({ id: 900 + i, firstName: 'A', lastName: 'B', role, age: 40, physio: rating, science: rating, teamId: 0, contract: null }));
    const weeks = (rating: number) => {
      const dept = departmentOf(staff(rating));
      const out: number[] = [];
      for (let i = 0; i < 400; i++) out.push(rollInjury(new Rng(`rehab:${i}`), league, p, 'soft', 'game', dept).injury.weeksRemaining);
      return mean(out);
    };
    expect(weeks(20)).toBeLessThan(weeks(5) * 0.85);
  });

  it('hires and dismisses only in the staff window, within the budget', () => {
    const league = fresh();
    const physio = medicMarket(league).find((m) => m.role === 'physio')!;
    expect(() => hireMedic(league, league.userTeamId, physio.id)).toThrow(/re-sign window/);
    league.phase = 'resign';
    // Both physio chairs are full: one has to go first.
    expect(() => hireMedic(league, league.userTeamId, physio.id)).toThrow(/Dismiss/);
    const mine = teamMedics(league, league.userTeamId).find((m) => m.role === 'physio')!;
    releaseMedic(league, league.userTeamId, mine.id);
    expect(league.medics[mine.id].teamId).toBeNull();
    const affordable = medicMarket(league).find((m) => m.role === 'physio' && m.id !== mine.id && medicAsk(league, m, 2) <= medicalRoom(league, league.userTeamId))!;
    hireMedic(league, league.userTeamId, affordable.id, 2);
    expect(league.medics[affordable.id].teamId).toBe(league.userTeamId);
  });
});

describe('diagnosis', () => {
  it('rolls a layoff in the type range, with an estimate that brackets the truth', () => {
    const league = fresh();
    const p = Object.values(league.players).find((x) => x.teamId === 3)!;
    for (let i = 0; i < 200; i++) {
      const mech: Mechanism = i % 2 ? 'soft' : 'contact';
      const { injury } = rollInjury(new Rng(`diag:${i}`), league, p, mech, 'game');
      expect(injury.weeksRemaining).toBeGreaterThanOrEqual(1);
      expect(injury.estimate[0]).toBeLessThanOrEqual(injury.weeksRemaining);
      expect(injury.estimate[1]).toBeGreaterThanOrEqual(injury.weeksRemaining);
    }
  });

  it('scars a severe injury: physical ratings and the ceiling drop for good', () => {
    const league = fresh();
    const p = Object.values(league.players).find((x) => x.position === 'RB' && x.teamId === 0)!;
    const before = { speed: p.ratings.speed, agility: p.ratings.agility, ovr: playerOvr(p), pot: p.potential };
    const injury: Injury = { type: 'acl', severity: 'severe', weeksRemaining: 40, estimate: [36, 44], season: league.season, week: 1, where: 'game' };
    applyInjury(league, p, injury, { speed: 2, agility: 1 });
    expect(p.ratings.speed).toBe(before.speed - 2);
    expect(p.ratings.agility).toBe(before.agility - 1);
    expect(playerOvr(p)).toBeLessThan(before.ovr);
    expect(p.potential).toBeLessThan(before.pot);
    expect(p.injuries!.at(-1)!.scar).toEqual({ speed: 2, agility: 1 });
  });

  it('makes a played-through injury worse instead of adding a new one', () => {
    const league = fresh();
    const p = Object.values(league.players).find((x) => x.teamId === 0 && x.position === 'WR')!;
    hurt(league, p, 2);
    expect(injectProblem(p)).toBeNull();
    playThrough(league, p);
    expect(isAvailable(p)).toBe(true);
    const { injury } = rollInjury(new Rng('aggravate'), league, p, 'soft', 'game');
    expect(injury.type).toBe('hamstring');
    expect(injury.weeksRemaining).toBeGreaterThan(2);
    applyInjury(league, p, injury);
    expect(p.injuries!.at(-1)!.aggravated).toBe(true);
    expect(p.injury!.injected).toBeUndefined();
  });

  it('only lets a minor injury be played through', () => {
    const league = fresh();
    const p = Object.values(league.players).find((x) => x.teamId === 0)!;
    hurt(league, p, 5);
    expect(injectProblem(p)).toMatch(/minor/);
  });
});

describe('lineups', () => {
  it('sits the injured and plays the next man up', () => {
    const league = fresh();
    const team = league.teams[0];
    const [wr1, wr2] = team.depthChart.WR;
    hurt(league, league.players[wr1], 3);
    const l = buildLineup(league, team);
    expect(l.wrs.map((p) => p.id)).not.toContain(wr1);
    expect(l.wrs[0].id).toBe(wr2);
  });

  it('borrows from a neighbouring position when one runs dry', () => {
    const league = fresh();
    const team = league.teams[0];
    for (const id of team.depthChart.K) hurt(league, league.players[id], 3);
    const l = buildLineup(league, team);
    expect(l.k.position).toBe('P');
    for (const id of team.depthChart.CB) hurt(league, league.players[id], 3);
    const l2 = buildLineup(league, team);
    expect(l2.cb).toHaveLength(3);
    const ids = new Set([...l2.cb, ...l2.s, ...l2.wrs].map((p) => p.id));
    expect(ids.size).toBe(l2.cb.length + l2.s.length + l2.wrs.length);
    // Both specialists out of the same game: somebody still kicks and punts.
    const l3 = buildLineup(league, team, new Set([...team.depthChart.K, ...team.depthChart.P]));
    expect(l3.k).toBeDefined();
    expect(l3.p).toBeDefined();
  });

  it('keeps a game reproducible, injuries and all, and records who got hurt', () => {
    const league = fresh();
    const game = league.games.find((g) => g.week === 1)!;
    const a = simulateGame(league, game);
    const b = simulateGame(league, game);
    expect(b).toEqual(a);
    for (const i of a.injuries ?? []) {
      expect(a.playerTeams[i.playerId]).toBe(i.teamId);
      expect(i.injury.weeksRemaining).toBeGreaterThanOrEqual(1);
    }
    // Everyone who played left with less condition than he started with.
    expect(Object.values(a.condition ?? {}).every((c) => c < 100)).toBe(true);
  });
});

describe('the weekly cycle', () => {
  it('heals a week at a time and brings condition back', () => {
    const league = fresh();
    const p = Object.values(league.players).find((x) => x.teamId === 5)!;
    hurt(league, p, 2);
    p.condition = 60;
    league.week++;
    injuryWeek(league);
    expect(p.injury?.weeksRemaining).toBe(1);
    expect(p.condition!).toBeGreaterThan(80);
    league.week++;
    injuryWeek(league);
    expect(p.injury).toBeUndefined();
  });

  it('keeps every team able to field a lineup through a season of injuries', () => {
    const league = fresh();
    simToEndOfRegularSeason(league);
    const hurtThisYear = Object.values(league.players).reduce((n, p) => n + (p.injuries ?? []).filter((r) => r.season === league.season).length, 0);
    // About 20–36 time-loss injuries per team over a season.
    expect(hurtThisYear / 32).toBeGreaterThan(15);
    expect(hurtThisYear / 32).toBeLessThan(40);
    for (const team of league.teams) {
      expect(activeRoster(league, team.id).length).toBeLessThanOrEqual(53);
      expect(() => buildLineup(league, team)).not.toThrow();
    }
  }, 60_000);
});

describe('injured reserve', () => {
  it('frees a roster spot for at least four weeks, then needs a return designation', () => {
    const league = fresh();
    const team = league.teams[league.userTeamId];
    team.autoInjuries = false;
    const p = teamPlayers(league, team.id).find((x) => x.position === 'LB')!;
    expect(irProblem(league, p)).toMatch(/injured/);
    hurt(league, p, 5);
    const before = activeRoster(league, team.id).length;
    placeOnIr(league, p);
    expect(activeRoster(league, team.id).length).toBe(before - 1);
    expect(isAvailable(p)).toBe(false);
    // Hurt in week 1's game: he misses weeks 2 to 6.
    for (let w = 0; w < 6; w++) {
      expect(activateProblem(league, p)).not.toBeNull();
      playWeek(league);
    }
    expect(p.injury).toBeUndefined();
    expect(p.ir!.weeks).toBeGreaterThanOrEqual(IR_MIN_WEEKS);
    // A full roster has to make room first.
    if (activeRoster(league, team.id).length >= 53) expect(activateProblem(league, p)).toMatch(/full/);
    else {
      activateFromIr(league, p);
      expect(p.ir).toBeUndefined();
      expect(team.irReturns![league.season]).toBe(1);
    }
    team.irReturns = { [league.season]: IR_RETURNS };
    const q = teamPlayers(league, team.id).find((x) => x.position === 'S' && !x.injury)!;
    q.ir = { season: league.season, week: 1, weeks: IR_MIN_WEEKS };
    expect(activateProblem(league, q)).toMatch(/designations|full/);
  }, 30_000);

  it('lets AI teams move long injuries to reserve and stay at 53 healthy-enough players', () => {
    const league = fresh();
    for (let w = 0; w < 8; w++) playWeek(league);
    const onIr = Object.values(league.players).filter((p) => p.ir);
    expect(onIr.length).toBeGreaterThan(0);
    for (const p of onIr) expect(p.teamId).not.toBeNull();
    for (const team of league.teams) if (team.id !== league.userTeamId) expect(activeRoster(league, team.id).length).toBeLessThanOrEqual(53);
  }, 30_000);
});

describe('careers', () => {
  it('pushes a 33-year-old with a long file toward retirement', () => {
    const p = player(3, 33);
    expect(injuryRetireChance(p, 2030)).toBe(0);
    p.injuries = [
      { type: 'mcl', severity: 'moderate', season: 2029, week: 3, weeks: 5 },
      { type: 'hamstring', severity: 'moderate', season: 2029, week: 12, weeks: 3 },
      { type: 'highAnkle', severity: 'moderate', season: 2028, week: 7, weeks: 4 },
    ];
    expect(injuryRetireChance(p, 2030)).toBeGreaterThan(0.2);
    const q = player(4, 31);
    q.injuries = [{ type: 'acl', severity: 'career-threatening', season: 2029, week: 9, weeks: 44 }];
    expect(injuryRetireChance(q, 2030)).toBeGreaterThan(0);
  });

  it('lets your medical staff read your players; a rival is read by the scouts, plus his injury reports', () => {
    const league = fresh();
    const mine = teamPlayers(league, league.userTeamId)[0];
    expect(injuryRisk(league, league.userTeamId, mine).known).toBe(true);
    const rival = teamPlayers(league, 7).find((p) => p.experience >= 3 && p.age <= 27)!;
    rival.traits.injuryResistance = 7;
    const before = injuryRisk(league, league.userTeamId, rival);
    rival.injuries = [0, 1, 2, 3].map((i) => ({ type: 'hamstring', severity: 'moderate' as const, season: league.season - (i % 2), week: 3 + i, weeks: 3 }));
    const after = injuryRisk(league, league.userTeamId, rival);
    expect(after.known).toBe(true);
    expect(after.read).toBeLessThan(before.read - 2);
    expect(after.tier).toBe('High');
  });
});

describe('saves', () => {
  it('upgrades an old save: same traits a new league rolls, a medical staff, nobody hurt', () => {
    const old = copy(base) as League;
    old.version = 10;
    for (const p of Object.values(old.players)) {
      delete (p.traits as Partial<Player['traits']>).injuryResistance;
      delete (p.traits as Partial<Player['traits']>).naturalFitness;
    }
    delete (old as Partial<League>).medics;
    for (const t of old.teams) delete (t as Partial<typeof t>).medicalDead;
    const up = migrateLeague(old)!;
    expect(up.version).toBe(SAVE_VERSION);
    for (const p of Object.values(up.players).slice(0, 40)) expect(p.traits).toEqual(base.players[p.id].traits);
    expect(teamMedics(up, 0).length).toBe(4);
    expect(departmentFor(up, 0).physio).toBeGreaterThan(1);
    expect(up.teams.every((t) => Array.isArray(t.medicalDead))).toBe(true);
  });
});

describe('quirks and injuries', () => {
  it('lets a back\'s running habits change what a tackle does to him', () => {
    const league = fresh();
    const rb = Object.values(league.players).find((p) => p.teamId === 0 && p.position === 'RB')!;
    rb.quirks = {};
    expect(riskFactors(league, rb).carrier).toBe(1);
    rb.quirks = { highKnee: 2 };
    expect(riskFactors(league, rb).carrier).toBeGreaterThan(1);
    rb.quirks = { contactAverse: 2 };
    expect(riskFactors(league, rb).carrier).toBeLessThan(1);
    // An upright runner's contact injuries land up top more and on the legs less.
    const lowerShare = () => {
      let low = 0;
      for (let i = 0; i < 1500; i++) if (['ankle', 'knee', 'foot', 'leg', 'achilles'].includes(injuryType(rollInjury(new Rng(`lean:${i}`), league, rb, 'contact', 'game').injury.type).part)) low++;
      return low / 1500;
    };
    rb.quirks = {};
    const plain = lowerShare();
    rb.quirks = { highKnee: 2 };
    expect(lowerShare()).toBeLessThan(plain - 0.05);
  });

  it('drains a gassed lineman faster', () => {
    const dt = Object.values(base.players).find((p) => p.position === 'DT')!;
    const fresh = { ...dt, quirks: {} };
    const gassed = { ...dt, quirks: { gassed: 2 } };
    expect(snapCost(gassed)).toBeCloseTo(snapCost(fresh) * 1.15, 5);
  });

  it('leaves a hit-shy marble after a serious hit in a game, not after a strain or practice', () => {
    const league = fresh();
    const wr = Object.values(league.players).find((p) => p.teamId === 0 && p.position === 'WR')!;
    wr.quirkBag = { blank: 5 };
    const at = (type: string, where: Injury['where']): Injury => ({ type, severity: 'moderate', weeksRemaining: 3, estimate: [3, 3], season: league.season, week: 2, where });
    applyInjury(league, wr, at('hamstring', 'game'));
    applyInjury(league, wr, at('mcl', 'practice'));
    expect(wr.quirkBag.hearsFootsteps ?? 0).toBe(0);
    applyInjury(league, wr, at('mcl', 'game'));
    expect(wr.quirkBag.hearsFootsteps).toBe(1);
  });

  it('skips the weekly habit draw for a player who is out injured', () => {
    const league = fresh();
    const out = Object.values(league.players).find((p) => p.teamId === 0 && p.position === 'LB')!;
    hurt(league, out, 20);
    const bag = JSON.stringify(out.quirkBag);
    for (let w = 1; w <= 18; w++) {
      league.week = w;
      quirkWeek(league);
    }
    expect(JSON.stringify(out.quirkBag)).toBe(bag);
  });
});
