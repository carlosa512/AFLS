import { describe, expect, it } from 'vitest';
import { createLeague, generatePlayer, SAVE_VERSION } from './generate';
import {
  activateFromIr,
  activateProblem,
  applyInjury,
  concussionLoad,
  concussionRetireChance,
  concussionWindow,
  effectiveResistance,
  holdAfterProtocol,
  fatigueMult,
  injuryRetireChance,
  injuryRisk,
  injuryType,
  injuriesNewYear,
  injuryWeek,
  IR_MIN_WEEKS,
  IR_RETURNS,
  irProblem,
  manageInjuries,
  NEED,
  placeOnIr,
  proposeTreatment,
  protocolBag,
  resistanceMult,
  riskFactors,
  rollInjury,
  snapCost,
  stopTreatment,
  treatmentAnswer,
  treatmentProblem,
  type Mechanism,
} from './injuries';
import { skill } from './attributes';
import { lastSeason } from './finance/contract';
import { playWeek, simToEndOfRegularSeason } from './league';
import { simulateGame } from './match/gameSim';
import { buildLineup } from './match/lineup';
import {
  departmentFor,
  departmentOf,
  hireMedic,
  MEDIC_SLOTS,
  medicAsk,
  medicalRoom,
  medicMarket,
  recoveryMultiplier,
  releaseMedic,
  teamMedics,
} from './medical';
import { migrateLeague } from './migrate';
import { playerOvr } from './positions';
import { Rng } from './rng';
import { activeRoster, chooseCover, COVER_BAR, isAvailable, placeAt, teamPlayers } from './roster';
import { slotOvr } from './familiarity';
import { signPlayer } from './offseason/negotiation';
import { quirkWeek } from './quirks';
import { generateTraits } from './traits';
import type { Injury, League, Medic, Player, Position, Ratings, Team, TreatmentId } from './types';

const copy = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

/** A league in its first regular-season week (shared, copied per test). */
const base = createLeague({ seed: 'injuries-test' });
const fresh = () => copy(base);

/** A made-up injury of `weeks`, diagnosed exactly. */
function hurt(league: League, p: Player, weeks: number, type = 'hamstring'): Injury {
  const injury: Injury = {
    type,
    severity: weeks > 6 ? 'severe' : weeks > 2 ? 'moderate' : 'minor',
    weeksRemaining: weeks,
    estimate: [weeks, weeks],
    season: league.season,
    week: league.week,
    where: 'game',
  };
  applyInjury(league, p, injury);
  return injury;
}

function player(i: number, age = 26): Player {
  return generatePlayer(new Rng(`injury-player:${i}`), {
    id: 2_000_000 + i,
    position: 'WR',
    quality: 12,
    age,
    teamId: null,
    jerseysUsed: new Set(),
  });
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
    const at = (age: number, durability: number) =>
      effectiveResistance({ ...p, age, traits: { ...p.traits, durability } });
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
      (['doctor', 'physio', 'physio', 'scientist'] as const).map((role, i) => ({
        id: 900 + i,
        firstName: 'A',
        lastName: 'B',
        role,
        age: 40,
        physio: rating,
        science: rating,
        teamId: 0,
        contract: null,
      }));
    const weeks = (rating: number) => {
      const dept = departmentOf(staff(rating));
      const out: number[] = [];
      for (let i = 0; i < 400; i++)
        out.push(rollInjury(new Rng(`rehab:${i}`), league, p, 'soft', 'game', dept).injury.weeksRemaining);
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
    const affordable = medicMarket(league).find(
      (m) =>
        m.role === 'physio' && m.id !== mine.id && medicAsk(league, m, 2) <= medicalRoom(league, league.userTeamId),
    )!;
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

  it('scars a severe injury: physical ratings drop, and from 26 the ceiling with them', () => {
    const league = fresh();
    const acl = (): Injury => ({
      type: 'acl',
      severity: 'severe',
      weeksRemaining: 40,
      estimate: [36, 44],
      season: league.season,
      week: 1,
      where: 'game',
    });
    const p = Object.values(league.players).find((x) => x.position === 'RB' && x.age >= 26)!;
    const before = { speed: p.ratings.speed, agility: p.ratings.agility, ovr: playerOvr(p), pot: p.potential };
    applyInjury(league, p, acl(), { speed: 2, agility: 1 });
    expect(p.ratings.speed).toBe(before.speed - 2);
    expect(p.ratings.agility).toBe(before.agility - 1);
    expect(playerOvr(p)).toBeLessThan(before.ovr);
    expect(p.potential).toBeLessThan(before.pot);
    expect(p.injuries!.at(-1)!.scar).toEqual({ speed: 2, agility: 1 });
    // A player still growing loses the points but keeps his ceiling: he can win them back.
    const young = Object.values(league.players).find((x) => x.position === 'RB' && x.age <= 23)!;
    const ceiling = young.potential;
    const speed = young.ratings.speed;
    applyInjury(league, young, acl(), { speed: 2 });
    expect(young.ratings.speed).toBe(speed - 2);
    expect(young.potential).toBe(ceiling);
  });

  it('makes a played-through injury worse instead of adding a new one', () => {
    const league = fresh();
    const p = willing(Object.values(league.players).find((x) => x.teamId === 0 && x.position === 'WR')!);
    hurt(league, p, 2, 'ankle');
    expect(treatmentProblem(p, 'injection')).toBeNull();
    expect(proposeTreatment(league, p, 'injection').yes).toBe(true);
    expect(isAvailable(p)).toBe(true);
    const { injury } = rollInjury(new Rng('aggravate'), league, p, 'soft', 'game');
    expect(injury.type).toBe('ankle');
    expect(injury.weeksRemaining).toBeGreaterThan(2);
    applyInjury(league, p, injury);
    expect(p.injuries!.at(-1)!.aggravated).toBe(true);
    expect(p.injury!.treatment).toBeUndefined();
  });

  it('only masks minor joint, bone and bruise injuries with a needle', () => {
    const league = fresh();
    const [a, b, c] = Object.values(league.players).filter((x) => x.teamId === 0);
    hurt(league, a, 5, 'ankle');
    expect(treatmentProblem(a, 'injection')).toMatch(/minor/);
    hurt(league, b, 2, 'hamstring');
    expect(treatmentProblem(b, 'injection')).toMatch(/muscle/);
    hurt(league, c, 2, 'concussion');
    expect(treatmentProblem(c, 'injection')).toMatch(/head/);
    // A strain has a fast-track, a concussion has nothing but rest.
    expect(treatmentProblem(b, 'fastTrack')).toBeNull();
    expect(TREATMENTS.map((id) => treatmentProblem(c, id))).not.toContain(null);
  });
});

/** A player who goes along with anything: a competitor with no contract on his mind. */
function willing(p: Player): Player {
  p.personality.winning = 1;
  p.contract = null;
  return p;
}
const TREATMENTS: TreatmentId[] = ['injection', 'brace', 'fastTrack'];

describe('treatments', () => {
  it('gets a broken hand back early in a club cast, a step down on his hands until it heals', () => {
    const league = fresh();
    const p = willing(Object.values(league.players).find((x) => x.teamId === 0 && x.position === 'WR')!);
    const hands = skill(p, 'hands');
    hurt(league, p, 4, 'hand');
    expect(proposeTreatment(league, p, 'brace').yes).toBe(true);
    expect(p.injury!.braceWait).toBe(1);
    expect(isAvailable(p)).toBe(false);
    league.week++;
    injuryWeek(league);
    expect(p.injury!.braceWait).toBeUndefined();
    expect(isAvailable(p)).toBe(true);
    expect(skill(p, 'hands')).toBeLessThan(hands - 2);
    expect(riskFactors(league, p).contact).toBeGreaterThan(
      1.5 * riskFactors(league, { ...p, injury: undefined }).contact,
    );
    // Out of the cast: he sits until it heals, and plays at full strength once it has.
    stopTreatment(league, p);
    expect(isAvailable(p)).toBe(false);
    expect(p.injury!.braceCost).toBeUndefined();
    expect(skill(p, 'hands')).toBe(hands);
  });

  it('keeps the gear off a quarterback’s throwing hand and shoulder, and off a strain', () => {
    const league = fresh();
    const qb = Object.values(league.players).find((x) => x.teamId === 0 && x.position === 'QB')!;
    hurt(league, qb, 4, 'hand');
    expect(treatmentProblem(qb, 'brace')).toMatch(/QB/);
    const backup = Object.values(league.players).find((x) => x.teamId === 0 && x.position === 'QB' && x !== qb)!;
    hurt(league, backup, 4, 'shoulder');
    expect(treatmentProblem(backup, 'brace')).toMatch(/QB/);
    const wr = Object.values(league.players).find((x) => x.teamId === 0 && x.position === 'WR')!;
    hurt(league, wr, 4, 'hamstring');
    expect(treatmentProblem(wr, 'brace')).toMatch(/No brace/);
  });

  it('fast-tracks a strain: back sooner, and likelier to go again once he is back', () => {
    const league = fresh();
    const p = willing(Object.values(league.players).find((x) => x.teamId === 0 && x.position === 'WR')!);
    hurt(league, p, 5);
    p.injury!.estimate = [4, 6];
    expect(proposeTreatment(league, p, 'fastTrack').yes).toBe(true);
    const inj = p.injury!;
    expect(inj.weeksRemaining).toBeLessThan(5);
    expect(inj.estimate[0]).toBeLessThanOrEqual(inj.weeksRemaining);
    expect(inj.estimate[1]).toBeGreaterThanOrEqual(inj.weeksRemaining);
    expect(p.injuries!.at(-1)!).toMatchObject({ fastTracked: true, weeks: inj.weeksRemaining });
    // Three weeks after he's back: a plain return is half again as likely to tear; a rushed one far more.
    const back = (fastTracked: boolean) => {
      const q: Player = {
        ...p,
        injury: undefined,
        injuries: [
          {
            type: 'hamstring',
            severity: 'moderate',
            season: league.season,
            week: league.week - 5,
            weeks: 2,
            ...(fastTracked ? { fastTracked: true as const } : {}),
          },
        ],
      };
      return riskFactors(league, q).soft;
    };
    expect(back(true) / back(false)).toBeCloseTo(2.5 / 1.5, 5);
  });

  it('lets a player say no, the same way every time he is asked', () => {
    const league = fresh();
    const pool = Object.values(league.players).filter(
      (x) => x.teamId !== null && x.contract && lastSeason(x.contract) === league.season,
    );
    let refused = 0;
    for (const p of pool.slice(0, 40)) {
      p.personality.greed = 1;
      p.personality.winning = 0.5;
      hurt(league, p, 2, 'ankle');
      const a = treatmentAnswer(league, p, 'injection');
      expect(treatmentAnswer(league, p, 'injection')).toEqual(a);
      if (a.yes) continue;
      refused++;
      expect(a.why).toMatch(/contract year/);
      expect(proposeTreatment(league, p, 'injection').yes).toBe(false);
      expect(p.injury!.treatment).toBeUndefined();
    }
    expect(refused).toBeGreaterThan(5);
  });

  it('pushes an AI starter back early for a win-now GM, never the user’s', () => {
    const league = fresh();
    const starterWr = (teamId: number) => willing(league.players[league.teams[teamId].depthChart.WR[0]]);
    const ai = league.teams.find((t) => t.id !== league.userTeamId)!;
    ai.gm.winNow = 0.9;
    const theirs = starterWr(ai.id);
    hurt(league, theirs, 4, 'hand');
    manageInjuries(league, ai, new Rng('ai-treat'));
    expect(theirs.injury!.treatment).toBe('brace');
    expect(theirs.ir).toBeUndefined();
    const user = league.teams[league.userTeamId];
    user.gm.winNow = 0.9;
    const ours = starterWr(user.id);
    hurt(league, ours, 4, 'hand');
    manageInjuries(league, user, new Rng('ai-treat'));
    expect(ours.injury!.treatment).toBeUndefined();
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
      // Not `playerTeams`: a man hurt before he touched the ball has no stat line.
      expect([game.homeId, game.awayId]).toContain(i.teamId);
      expect(league.players[i.playerId].teamId).toBe(i.teamId);
      expect(a.diagnoses?.[i.playerId]?.injury.weeksRemaining).toBeGreaterThanOrEqual(1);
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
    const hurtThisYear = Object.values(league.players).reduce(
      (n, p) => n + (p.injuries ?? []).filter((r) => r.season === league.season).length,
      0,
    );
    // About 20–36 time-loss injuries per team over a season.
    expect(hurtThisYear / 32).toBeGreaterThan(15);
    expect(hurtThisYear / 32).toBeLessThan(40);
    for (const team of league.teams) {
      expect(activeRoster(league, team.id).length).toBeLessThanOrEqual(53);
      expect(() => buildLineup(league, team)).not.toThrow();
    }
    // Box scores keep the doctor's word from the day, not the truth, and not his countdown since.
    const results = league.games.flatMap((g) => (g.result ? [g.result] : []));
    expect(results.every((r) => r.diagnoses === undefined && r.condition === undefined)).toBe(true);
    const healed = results.flatMap((r) => r.injuries ?? []).filter((i) => !league.players[i.playerId].injury);
    expect(healed.some((i) => i.estimate[1] >= 2)).toBe(true);
  });
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
  });

  it('lets AI teams move long injuries to reserve and stay at 53 healthy-enough players', () => {
    const league = fresh();
    for (let w = 0; w < 8; w++) playWeek(league);
    const onIr = Object.values(league.players).filter((p) => p.ir);
    expect(onIr.length).toBeGreaterThan(0);
    for (const p of onIr) expect(p.teamId).not.toBeNull();
    for (const team of league.teams)
      if (team.id !== league.userTeamId) expect(activeRoster(league, team.id).length).toBeLessThanOrEqual(53);
  });
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
    rival.injuries = [0, 1, 2, 3].map((i) => ({
      type: 'hamstring',
      severity: 'moderate' as const,
      season: league.season - (i % 2),
      week: 3 + i,
      weeks: 3,
    }));
    const after = injuryRisk(league, league.userTeamId, rival);
    expect(after.known).toBe(true);
    expect(after.read).toBeLessThan(before.read - 2);
    expect(after.tier).toBe('High');
  });
});

/** A concussion on his file `yearsAgo` before this week, cleared after `weeks`. */
const pastConcussion = (league: League, yearsAgo: number, weeks = 1): NonNullable<Player['injuries']>[number] => ({
  type: 'concussion',
  severity: 'minor',
  season: league.season - yearsAgo,
  week: league.week,
  weeks,
});

/** Concuss him in this week's game: into the protocol, his bag built from his file. */
function concuss(league: League, p: Player, where: Injury['where'] = 'game'): Injury {
  const at = { season: league.season, week: league.week };
  const injury: Injury = {
    type: 'concussion',
    severity: 'minor',
    weeksRemaining: 1,
    estimate: [0, 1],
    season: at.season,
    week: at.week,
    where,
    protocol: protocolBag(p, at),
  };
  applyInjury(league, p, injury);
  return injury;
}

/** Weekly cycles until he's out of the protocol: how many it took. */
function untilCleared(league: League, p: Player): number {
  for (let n = 1; n <= 40; n++) {
    injuryWeek(league);
    league.week++;
    if (p.injury?.type !== 'concussion') return n;
  }
  throw new Error('never cleared');
}

describe('concussions', () => {
  it('weighs each past concussion in full for two years, then half by four, never less', () => {
    const league = fresh();
    const p = Object.values(league.players).find((x) => x.teamId === 0)!;
    p.injuries = [pastConcussion(league, 1)];
    expect(concussionLoad(p, league.season, league.week)).toBeCloseTo(1, 5);
    p.injuries = [pastConcussion(league, 3)];
    expect(concussionLoad(p, league.season, league.week)).toBeCloseTo(0.75, 5);
    p.injuries = [pastConcussion(league, 6), pastConcussion(league, 1)];
    expect(concussionLoad(p, league.season, league.week)).toBeCloseTo(1.5, 5);
  });

  it('fills a bigger bag with each concussion on his file', () => {
    const league = fresh();
    const p = Object.values(league.players).find((x) => x.teamId === 0 && x.age < 30)!;
    const at = { season: league.season, week: league.week };
    const first = protocolBag(p, at);
    expect(first).toEqual({ clear: 4, symptoms: 4, setbacks: 0 });
    p.injuries = [pastConcussion(league, 3), pastConcussion(league, 2), pastConcussion(league, 0.5)];
    const fourth = protocolBag(p, at);
    expect(fourth.clear).toBe(4);
    expect(fourth.symptoms).toBeGreaterThan(first.symptoms + 5);
    expect(fourth.setbacks).toBeGreaterThanOrEqual(2);
  });

  it('clears about half of first concussions in time for the next game, and the file shows the games he missed', () => {
    const league = fresh();
    const players = Object.values(league.players)
      .filter((x) => x.teamId !== null)
      .slice(0, 300);
    for (const p of players) concuss(league, p);
    injuryWeek(league);
    const cleared = players.filter((p) => p.injury?.type !== 'concussion').length / players.length;
    expect(cleared).toBeGreaterThan(0.38);
    expect(cleared).toBeLessThan(0.62);
    for (const p of players.filter((x) => x.injury?.type !== 'concussion').slice(0, 20))
      expect(p.injuries!.find((r) => r.type === 'concussion')!.weeks).toBe(0);
    // The rest are still in it: day to day, never more than his bag allows.
    const still = players.find((p) => p.injury?.protocol)!;
    expect(still.injury!.estimate[0]).toBeGreaterThanOrEqual(0);
    league.week++;
    const n = untilCleared(league, still);
    expect(still.injuries!.find((r) => r.type === 'concussion')!.weeks).toBe(n);
  });

  it('takes longer, on average, the more concussions he has had', () => {
    const missed = (history: number) => {
      const league = fresh();
      const players = Object.values(league.players)
        .filter((x) => x.teamId !== null && x.age < 30)
        .slice(0, 120);
      for (const p of players) {
        p.injuries = Array.from({ length: history }, (_, i) => pastConcussion(league, 0.3 + i * 0.6));
        concuss(league, p);
      }
      let total = 0;
      for (let w = 0; w < 30 && players.some((p) => p.injury?.protocol); w++) {
        injuryWeek(league);
        league.week++;
      }
      for (const p of players) total += p.injuries!.at(history)!.weeks;
      return total / players.length;
    };
    expect(missed(3)).toBeGreaterThan(missed(0) + 1);
  });

  it('brings symptoms back with a setback: two more of them in the bag', () => {
    const league = fresh();
    const p = Object.values(league.players).find((x) => x.teamId === 0)!;
    const inj = concuss(league, p);
    inj.protocol = { clear: 1, symptoms: 0, setbacks: 1 };
    // Week by week until the setback marble comes out (one of two, so soon).
    for (let w = 0; w < 30 && inj.protocol?.setbackWeek === undefined && p.injury; w++) {
      inj.protocol!.clear = 0;
      injuryWeek(league);
      league.week++;
    }
    expect(inj.protocol!.setbackWeek).toBeDefined();
    expect(inj.protocol!.symptoms).toBe(2);
    expect(inj.protocol!.setbacks).toBe(0);
  });

  it('sits him one more week when his team holds him, and counts the week', () => {
    const league = fresh();
    const p = Object.values(league.players).find((x) => x.teamId === 0)!;
    const inj = concuss(league, p);
    inj.protocol = { clear: 1, symptoms: 0, setbacks: 0 };
    holdAfterProtocol(p, true);
    injuryWeek(league);
    expect(p.injury?.protocol).toBeUndefined();
    expect(isAvailable(p)).toBe(false);
    league.week++;
    injuryWeek(league);
    expect(p.injury).toBeUndefined();
    expect(p.injuries!.at(-1)).toMatchObject({ type: 'concussion', weeks: 1, held: true });
    // Cleared a week ago, back now: one week left of the window when a second one is likelier.
    league.week++;
    expect(concussionWindow(league, p)).toBe(1);
  });

  it('has a player with a third concussion in a season weigh his future, and sometimes shut himself down', () => {
    const league = fresh();
    let shut = 0;
    for (const p of Object.values(league.players)
      .filter((x) => x.teamId !== null)
      .slice(0, 60)) {
      p.personality.winning = 0.5;
      p.injuries = [pastConcussion(league, 0), pastConcussion(league, 0)];
      const { injury } = rollConcussion(league, p);
      if (!injury.protocol?.shutdown) continue;
      shut++;
      expect(injury.estimate[0]).toBeGreaterThanOrEqual(weeksLeftNow(league));
    }
    expect(shut).toBeGreaterThan(15);
    expect(shut).toBeLessThan(45);
  });

  it('can end a career in the offseason from about the third concussion on', () => {
    const league = fresh();
    const p = Object.values(league.players).find((x) => x.teamId === 0)!;
    const season = league.season + 1;
    p.injuries = [pastConcussion(league, 1), pastConcussion(league, 0)];
    expect(concussionRetireChance(p, season)).toBe(0);
    p.injuries.push(pastConcussion(league, 0));
    const three = concussionRetireChance(p, season);
    expect(three).toBeGreaterThan(0);
    p.injuries.push(pastConcussion(league, 1), pastConcussion(league, 2));
    expect(concussionRetireChance(p, season)).toBeGreaterThan(0.2);
    // Old ones weigh less: the same three, years ago, end fewer careers.
    p.injuries = [pastConcussion(league, 5), pastConcussion(league, 5), pastConcussion(league, 5)];
    expect(concussionRetireChance(p, season)).toBe(0);
  });
});

/** Roll contact injuries until one is a concussion (the pick is weighted; the protocol is what's tested). */
function rollConcussion(league: League, p: Player) {
  for (let i = 0; i < 500; i++) {
    const hurt = rollInjury(new Rng(`concuss:${p.id}:${i}`), league, p, 'contact', 'game');
    if (hurt.injury.type === 'concussion') return hurt;
  }
  throw new Error('no concussion');
}
const weeksLeftNow = (league: League) => 22 - league.week + 1;

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

  it('turns injections from a flag into a treatment (v28)', () => {
    const old = copy(base) as League;
    old.version = 27;
    const [a, b] = Object.values(old.players).filter((x) => x.teamId === 0);
    a.injury = {
      type: 'ankle',
      severity: 'minor',
      weeksRemaining: 1,
      estimate: [1, 1],
      season: old.season,
      week: old.week,
      where: 'game',
      injected: true,
    } as Injury;
    b.injury = {
      type: 'ankle',
      severity: 'minor',
      weeksRemaining: 1,
      estimate: [1, 1],
      season: old.season,
      week: old.week,
      where: 'game',
      injected: false,
    } as Injury;
    const up = migrateLeague(old)!;
    expect(up.players[a.id].injury).toMatchObject({ treatment: 'injection' });
    expect(up.players[b.id].injury!.treatment).toBeUndefined();
    expect('injected' in up.players[a.id].injury!).toBe(false);
    expect(isAvailable(up.players[a.id])).toBe(true);
  });
});

describe('quirks and injuries', () => {
  it("lets a back's running habits change what a tackle does to him", () => {
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
      for (let i = 0; i < 1500; i++)
        if (
          ['ankle', 'knee', 'foot', 'leg', 'achilles'].includes(
            injuryType(rollInjury(new Rng(`lean:${i}`), league, rb, 'contact', 'game').injury.type).part,
          )
        )
          low++;
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
    const at = (type: string, where: Injury['where']): Injury => ({
      type,
      severity: 'moderate',
      weeksRemaining: 3,
      estimate: [3, 3],
      season: league.season,
      week: 2,
      where,
    });
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

describe('covering a short position', () => {
  const aiTeam = (league: League) => league.teams.find((t) => t.id !== league.userTeamId)!;
  /** Hurt all but `left` healthy players at `pos` (two weeks: off the field, not on reserve). */
  const thin = (league: League, teamId: number, pos: Position, left: number) =>
    teamPlayers(league, teamId)
      .filter((p) => p.position === pos)
      .slice(left)
      .forEach((p) => hurt(league, p, 2));
  /** Everyone on the team outside `keep` rated 1 across the board: nobody covers anywhere. */
  const blank = (league: League, teamId: number, keep: Position[]) => {
    for (const p of teamPlayers(league, teamId))
      if (!keep.includes(p.position)) for (const k of Object.keys(p.ratings)) p.ratings[k as keyof Ratings] = 1;
  };
  const staffAt = (league: League, teamId: number) =>
    Object.entries(league.teams[teamId].playingAt ?? {}).filter(([, v]) => v.by === 'staff');
  const ids = (league: League, teamId: number) =>
    teamPlayers(league, teamId)
      .map((p) => p.id)
      .sort();
  /** The last linebacker on the chart, rated `r` across the board: a spare who's a decent backup at safety. */
  const spareLb = (league: League, team: Team, r = 13) => {
    const p = league.players[team.depthChart.LB.at(-1)!];
    for (const k of Object.keys(p.ratings)) p.ratings[k as keyof Ratings] = r;
    expect(slotOvr(p, 'S')).toBeGreaterThanOrEqual(COVER_BAR);
    return p;
  };

  it('covers a short position from the roster before signing anyone', () => {
    const league = fresh();
    const team = aiTeam(league);
    const spare = spareLb(league, team);
    thin(league, team.id, 'S', NEED.S - 1);
    const before = ids(league, team.id);
    manageInjuries(league, team, new Rng('cover'));
    expect(team.playingAt?.[spare.id]).toMatchObject({ pos: 'S', by: 'staff' });
    expect(team.depthChart.S).toContain(spare.id);
    expect(ids(league, team.id)).toEqual(before);
  });

  it('never covers with a starter, a man his position cannot spare, or anyone under the bar', () => {
    const league = fresh();
    const team = aiTeam(league);
    thin(league, team.id, 'S', NEED.S - 1);
    blank(league, team.id, ['S']);
    expect(chooseCover(league, team, 'S', NEED)).toBeNull();
    // The starting linebacker is good enough, but he starts.
    const lbs = team.depthChart.LB.map((id) => league.players[id]);
    for (const k of Object.keys(lbs[0].ratings)) lbs[0].ratings[k as keyof Ratings] = 20;
    expect(chooseCover(league, team, 'S', NEED)).toBeNull();
    // A backup good enough, with linebackers down to what the position needs: none to spare.
    const backup = lbs[lbs.length - 1];
    for (const k of Object.keys(backup.ratings)) backup.ratings[k as keyof Ratings] = 15;
    expect(chooseCover(league, team, 'S', NEED)).toBe(backup);
    lbs.slice(1, lbs.length - NEED.LB + 1).forEach((p) => p !== backup && hurt(league, p, 2));
    expect(chooseCover(league, team, 'S', NEED)).toBeNull();
  });

  it('uses one spare player for one hole only', () => {
    const league = fresh();
    const team = aiTeam(league);
    blank(league, team.id, ['S', 'CB']);
    // Starting corners stay strong, one spare corner is good enough anywhere in the secondary or behind it.
    team.depthChart.CB.forEach((id, i) => {
      const r = i < 3 ? 18 : i === team.depthChart.CB.length - 1 ? 15 : 1;
      for (const k of Object.keys(league.players[id].ratings)) league.players[id].ratings[k as keyof Ratings] = r;
    });
    thin(league, team.id, 'S', NEED.S - 1);
    thin(league, team.id, 'LB', NEED.LB - 1);
    const spare = league.players[team.depthChart.CB.at(-1)!];
    manageInjuries(league, team, new Rng('cover'));
    expect(staffAt(league, team.id)).toHaveLength(1);
    // Equally short, linebacker comes first: he stays there rather than being moved on to safety.
    expect(team.playingAt?.[spare.id]?.pos).toBe('LB');
  });

  it("sends staff's cover back when the position heals, or when he's hurt himself; leaves a user's move", () => {
    const league = fresh();
    const team = aiTeam(league);
    const cover = spareLb(league, team);
    thin(league, team.id, 'S', NEED.S - 1);
    manageInjuries(league, team, new Rng('cover'));
    expect(team.playingAt?.[cover.id]?.by).toBe('staff');
    const mine = teamPlayers(league, team.id).find((p) => p.position === 'WR' && !team.playingAt?.[p.id])!;
    placeAt(league, mine.id, 'TE');
    for (const p of teamPlayers(league, team.id)) if (p.position === 'S') delete p.injury;
    manageInjuries(league, team, new Rng('cover'));
    expect(team.playingAt?.[cover.id]).toBeUndefined();
    expect(team.depthChart[cover.position]).toContain(cover.id);
    expect(team.playingAt?.[mine.id]).toEqual({ pos: 'TE', by: 'user' });
    // Short again, covered again; then the cover is hurt himself.
    thin(league, team.id, 'S', NEED.S - 1);
    manageInjuries(league, team, new Rng('cover'));
    expect(team.playingAt?.[cover.id]?.by).toBe('staff');
    hurt(league, cover, 2);
    manageInjuries(league, team, new Rng('cover'));
    expect(team.playingAt?.[cover.id]).toBeUndefined();
  });

  it("ends staff's cover when the last injury heals, though nobody else is hurt", () => {
    const league = fresh();
    const team = aiTeam(league);
    const cover = spareLb(league, team);
    for (const p of teamPlayers(league, team.id)) delete p.injury;
    thin(league, team.id, 'S', NEED.S - 1);
    manageInjuries(league, team, new Rng('cover'));
    expect(team.playingAt?.[cover.id]?.by).toBe('staff');
    // Every injury on the team heals; the weekly cycle runs with a full, healthy roster.
    for (const p of teamPlayers(league, team.id)) delete p.injury;
    expect(activeRoster(league, team.id)).toHaveLength(53);
    injuryWeek(league);
    expect(team.playingAt?.[cover.id]).toBeUndefined();
  });

  it("clears staff's covers at the new league year, and keeps the user's moves", () => {
    const league = fresh();
    const team = aiTeam(league);
    const cover = spareLb(league, team);
    thin(league, team.id, 'S', NEED.S - 1);
    manageInjuries(league, team, new Rng('cover'));
    const mine = teamPlayers(league, team.id).find((p) => p.position === 'WR')!;
    placeAt(league, mine.id, 'TE');
    injuriesNewYear(league);
    expect(team.playingAt?.[cover.id]).toBeUndefined();
    expect(team.depthChart[cover.position]).toContain(cover.id);
    expect(team.playingAt?.[mine.id]).toEqual({ pos: 'TE', by: 'user' });
  });

  it('your staff covers but never signs or cuts', () => {
    const league = fresh();
    const team = league.teams[league.userTeamId];
    expect(activeRoster(league, team.id)).toHaveLength(53);
    const spare = spareLb(league, team);
    thin(league, team.id, 'S', NEED.S - 1);
    const before = ids(league, team.id);
    manageInjuries(league, team, new Rng('cover'));
    expect(team.playingAt?.[spare.id]).toMatchObject({ pos: 'S', by: 'staff' });
    expect(ids(league, team.id)).toEqual(before);
    // Nobody good enough: still nobody signed, nobody cut.
    for (const [id] of staffAt(league, team.id)) delete team.playingAt![Number(id)];
    blank(league, team.id, ['S']);
    manageInjuries(league, team, new Rng('cover'));
    expect(staffAt(league, team.id)).toHaveLength(0);
    expect(ids(league, team.id)).toEqual(before);
  });

  it('a healed player on your IR waits for a spot instead of costing someone his job', () => {
    const league = fresh();
    const team = league.teams[league.userTeamId];
    const p = teamPlayers(league, team.id).find((x) => x.position === 'LB')!;
    p.ir = { season: league.season, week: 1, weeks: IR_MIN_WEEKS };
    const fa = player(7);
    league.players[fa.id] = fa;
    signPlayer(league, fa, team.id, { years: 1, apy: 2000, bonusPct: 0, gtdPct: 0, voidYears: 0 });
    expect(activeRoster(league, team.id)).toHaveLength(53);
    const before = ids(league, team.id);
    manageInjuries(league, team, new Rng('cover'));
    expect(p.ir).toBeDefined();
    expect(ids(league, team.id)).toEqual(before);
  });
});
