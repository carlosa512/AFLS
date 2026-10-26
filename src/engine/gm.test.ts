import { describe, expect, it } from 'vitest';
import { headCoachVision } from './coaching';
import { createLeague, SAVE_VERSION } from './generate';
import {
  appointDirectorAsGm,
  appointGm,
  endGmAppointment,
  gmStartProblem,
  gmTraits,
  makeGmPermanent,
  startingGm,
  teamGm,
} from './gm';
import { recordResult, startLiveGame } from './league';
import { migrateLeague } from './migrate';
import { coachRecord, gmRecord } from './records';
import { promoteScoutToDirector, releaseStaff, staffMarket, teamStaff } from './staff';
import type { Game, GameResult, League } from './types';

const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const world = () => createLeague({ seed: 'gm-careers' });
const director = (l: League, teamId: number) => teamStaff(l, teamId).find((s) => s.role === 'director')!;
const game = (l: League, week: number, homeId = 0, awayId = 1): Game => ({
  id: l.nextGameId++,
  season: l.season,
  week,
  homeId,
  awayId,
});
const result = (homeScore: number, awayScore: number) =>
  ({
    homeScore,
    awayScore,
    playerStats: {},
    playerTeams: {},
  }) as GameResult;

function legacy(l: League): League {
  const old = copy(l);
  old.version = 40;
  delete (old as Partial<League>).gms;
  delete (old as Partial<League>).userGmId;
  delete (old as Partial<League>).nextGmId;
  for (const t of old.teams) delete (t as Partial<typeof t>).gmId;
  for (const s of Object.values(old.staff)) delete s.appointments;
  for (const c of [...Object.values(old.coaches), ...Object.values(old.retiredCoaches)])
    for (const season of c.career ?? []) delete season.record;
  for (const g of old.games) delete g.management;
  return old;
}

describe('persistent GM identities', () => {
  it('creates one permanent incumbent per team and a separate persistent user identity', () => {
    const l = world();
    expect(Object.keys(l.gms)).toHaveLength(l.teams.length);
    expect(new Set(l.teams.map((t) => t.gmId)).size).toBe(l.teams.length);
    for (const t of l.teams) {
      const gm = teamGm(l, t.id)!;
      expect(gm.teamId).toBe(t.id);
      expect(gm.appointments[0]).toMatchObject({ teamId: t.id, interim: false });
      expect(gmTraits(l, gm)).toBe(t.gm);
      expect(gm.traits).toBeUndefined();
    }
    const user = l.gms[l.userGmId];
    l.userTeamId = 5;
    expect(l.gms[l.userGmId]).toBe(user);
    expect(copy(l).gms[l.userGmId]).toEqual(user);
  });

  it('moves tendencies with the person between teams and retains closed appointments', () => {
    const l = world();
    const gm = teamGm(l, 0)!;
    const traits = copy(l.teams[0].gm);
    l.phase = 'resign';
    endGmAppointment(l, gm.id, 'dismissed');
    expect(gm.traits).toEqual(traits);
    expect(l.teams[0].gmId).toBeNull();
    l.teams[0].gm.winNow = 0;
    expect(gm.traits).toEqual(traits);
    endGmAppointment(l, teamGm(l, 1)!.id, 'expired');
    appointGm(l, 1, gm.id, { through: l.season + 3 });
    expect(gm.appointments).toHaveLength(2);
    expect(gm.appointments[0]).toMatchObject({ reason: 'dismissed', end: { phase: 'resign' } });
    expect(gm.appointments[1].interim).toBe(false);
    expect(l.teams[1].gm).toEqual(traits);
    expect(gm.traits).toBeUndefined();
    const loaded = copy(l);
    expect(gmTraits(loaded, loaded.gms[gm.id])).toBe(loaded.teams[1].gm);
  });

  it('only allows interim appointments midseason, and makes permanence an explicit offseason offer', () => {
    const l = world();
    const gm = teamGm(l, 0)!;
    endGmAppointment(l, gm.id, 'dismissed');
    l.phase = 'resign';
    expect(() => appointGm(l, 0, gm.id, { through: l.season, interim: true })).toThrow(/midseason/);
    l.phase = 'regular';
    l.week = 8;
    expect(() => appointGm(l, 0, gm.id, { through: l.season + 1, interim: true })).toThrow(/this season only/);
    appointGm(l, 0, gm.id, { through: l.season, interim: true });
    expect(() => makeGmPermanent(l, gm.id, l.season + 3)).toThrow(/offseason/);
    l.season++;
    l.phase = 'resign';
    expect(gm.appointments.at(-1)?.interim).toBe(true);
    makeGmPermanent(l, gm.id, l.season + 2);
    expect(gm.appointments).toHaveLength(3);
    expect(gm.appointments.at(-2)).toMatchObject({ interim: true, reason: 'permanent' });
    expect(gm.appointments.at(-1)).toMatchObject({ interim: false, through: l.season + 2 });
    expect(() => makeGmPermanent(l, gm.id, l.season + 2)).toThrow(/not an active interim/);
  });

  it('does not rehire retired people or overwrite an occupied job', () => {
    const l = world();
    const gm = teamGm(l, 0)!;
    endGmAppointment(l, gm.id, 'retired');
    expect(() => appointGm(l, 0, gm.id, { through: l.season })).toThrow(/not available/);
    expect(gm.appointments.at(-1)?.reason).toBe('retired');
    const other = teamGm(l, 1)!;
    endGmAppointment(l, other.id, 'expired');
    expect(() => appointGm(l, 2, other.id, { through: l.season })).toThrow(/already has a GM/);
    expect(other.teamId).toBeNull();
  });
});

describe('the scouting leadership pipeline', () => {
  it('preserves a scout’s identity, appointments and appearance through director and GM promotions', () => {
    const l = world();
    const scout = teamStaff(l, 0).find((s) => s.role === 'collegeScout')!;
    const oldDirector = director(l, 0);
    const identity = { id: scout.id, firstName: scout.firstName, lastName: scout.lastName, age: scout.age };
    l.phase = 'resign';
    l.teams[0].staffBudgetMult = 5;
    releaseStaff(l, 0, oldDirector.id);
    promoteScoutToDirector(l, 0, scout.id);
    expect(scout).toMatchObject({ ...identity, role: 'director' });
    expect(scout.appointments?.map((a) => a.role)).toEqual(['collegeScout', 'director']);
    expect(scout.appointments?.[0].reason).toBe('promoted');
    expect(scout.focus).toBeUndefined();
    endGmAppointment(l, teamGm(l, 0)!.id, 'dismissed');
    const dead = copy(l.teams[0].staffDead);
    const gm = appointDirectorAsGm(l, 0, scout.id, { through: l.season + 2 });
    expect(gm).toMatchObject({
      firstName: identity.firstName,
      lastName: identity.lastName,
      age: identity.age,
      origin: 'director',
      appearanceId: `staff:${scout.id}`,
    });
    expect(gm.scouting?.appointments?.at(-1)?.reason).toBe('gm');
    expect(l.staff[scout.id]).toBeUndefined();
    expect(staffMarket(l).some((s) => s.id === scout.id)).toBe(false);
    expect(teamStaff(l, 0).some((s) => s.id === scout.id)).toBe(false);
    expect(l.teams[0].staffDead).toEqual(dead);
    expect(copy(l).gms[gm.id].scouting).toEqual(gm.scouting);
  });

  it('blocks direct scout-to-GM jumps and midseason cross-team poaching without side effects', () => {
    const l = world();
    const scout = teamStaff(l, 0).find((s) => s.role === 'proScout')!;
    const otherDirector = director(l, 1);
    endGmAppointment(l, teamGm(l, 0)!.id, 'dismissed');
    const before = copy(l);
    expect(() => appointDirectorAsGm(l, 0, scout.id, { through: l.season })).toThrow(/scouting director/);
    expect(() => appointDirectorAsGm(l, 0, otherDirector.id, { through: l.season, interim: true })).toThrow(
      /poached midseason/,
    );
    expect(l).toEqual(before);
  });

  it('allows its own director to take a midseason interim appointment', () => {
    const l = world();
    const source = director(l, 0);
    l.week = 10;
    endGmAppointment(l, teamGm(l, 0)!.id, 'dismissed');
    const gm = appointDirectorAsGm(l, 0, source.id, { through: l.season, interim: true });
    expect(gm.appointments[0]).toMatchObject({ interim: true, start: { week: 10 } });
  });

  it('rejects invalid promotion contracts and occupied director jobs before changing a scout', () => {
    const l = world();
    const scout = teamStaff(l, 0).find((s) => s.role === 'collegeScout')!;
    l.phase = 'playoffs';
    expect(() => promoteScoutToDirector(l, 0, scout.id)).toThrow(/season|window/);
    l.phase = 'resign';
    expect(() => promoteScoutToDirector(l, 0, scout.id)).toThrow(/occupied/);
    releaseStaff(l, 0, director(l, 0).id);
    const before = copy(scout);
    expect(() => promoteScoutToDirector(l, 0, scout.id, 4)).toThrow(/1–3/);
    l.teams[0].staffBudgetMult = 0;
    expect(() => promoteScoutToDirector(l, 0, scout.id)).toThrow(/budget/);
    expect(scout).toEqual(before);
  });
});

describe('game-time career attribution', () => {
  it('splits GM records at replacement, counts ties once, and survives history pruning and save/load', () => {
    const l = world();
    const first = teamGm(l, 0)!;
    recordResult(l, game(l, 1), result(21, 14));
    endGmAppointment(l, first.id, 'dismissed');
    const second = appointDirectorAsGm(l, 0, director(l, 0).id, { through: l.season, interim: true });
    const tied = game(l, 2);
    recordResult(l, tied, result(17, 17));
    recordResult(l, tied, result(17, 17));
    recordResult(l, game(l, 3), result(7, 21));
    expect(gmRecord(l, first).regular).toEqual({ w: 1, l: 0, t: 0 });
    expect(gmRecord(l, second).regular).toEqual({ w: 0, l: 1, t: 1 });
    l.games = [];
    l.history = [];
    l.userTeamId = 7;
    const loaded = copy(l);
    expect(gmRecord(loaded).regular).toEqual({ w: 1, l: 0, t: 0 });
    expect(gmRecord(loaded, loaded.gms[second.id]).regular).toEqual({ w: 0, l: 1, t: 1 });
  });

  it('uses the appointments captured when a live game starts, even if leadership later changes', () => {
    const l = world();
    const first = teamGm(l, 0)!;
    const g = l.games.find((x) => x.homeId === 0)!;
    startLiveGame(l, g);
    endGmAppointment(l, first.id, 'dismissed');
    const second = appointDirectorAsGm(l, 0, director(l, 0).id, { through: l.season, interim: true });
    recordResult(l, g, result(28, 14));
    expect(gmRecord(l, first).regular.w).toBe(1);
    expect(gmRecord(l, second).regular.w).toBe(0);
  });

  it('preserves a dismissed coach’s partial season and separates a promoted coach’s roles', () => {
    const l = world();
    const head = Object.values(l.coaches).find((c) => c.teamId === 0 && c.role === 'headCoach')!;
    const coord = Object.values(l.coaches).find((c) => c.teamId === 0 && c.role === 'offCoord')!;
    recordResult(l, game(l, 1), result(10, 21));
    head.teamId = null;
    coord.role = 'headCoach';
    recordResult(l, game(l, 2), result(21, 10));
    const loaded = copy(l);
    expect(coachRecord(loaded, loaded.coaches[head.id]).regular).toEqual({ w: 0, l: 1, t: 0 });
    expect(coachRecord(loaded, loaded.coaches[coord.id], ['headCoach']).regular).toEqual({ w: 1, l: 0, t: 0 });
    expect(coachRecord(loaded, loaded.coaches[coord.id]).regular).toEqual({ w: 1, l: 1, t: 0 });
  });

  it('does not give a departed GM a championship won by the successor', () => {
    const l = world();
    const first = teamGm(l, 0)!;
    recordResult(l, game(l, 1), result(21, 14));
    endGmAppointment(l, first.id, 'dismissed');
    const second = appointDirectorAsGm(l, 0, director(l, 0).id, { through: l.season, interim: true });
    const final = { ...game(l, 22), playoffRound: 'FINAL' as const };
    recordResult(l, final, result(28, 14));
    expect(gmRecord(l, first).titles).toBe(0);
    expect(gmRecord(l, second)).toMatchObject({ titles: 1, playoffTrips: 1, playoffs: { w: 1, l: 0 } });
  });

  it('carries the last coordinator’s system forward after a split season', () => {
    const l = world();
    const head = Object.values(l.coaches).find((c) => c.teamId === 0 && c.role === 'headCoach')!;
    const first = Object.values(l.coaches).find((c) => c.teamId === 0 && c.role === 'offCoord')!;
    const second = Object.values(l.coaches).find((c) => c.teamId === null && c.role === 'offCoord')!;
    first.style = { passLean: -0.8 };
    recordResult(l, game(l, 1), result(10, 21));
    first.teamId = null;
    second.teamId = 0;
    second.style = { passLean: 0.8 };
    recordResult(l, game(l, 2), result(21, 10));
    l.season++;
    expect(headCoachVision(l, head).pass).toBe(0.8);
  });
});

describe('v41 migration', () => {
  it('preserves known user history, backfills current results, and does not invent AI GM history', () => {
    const l = world();
    l.history = [{ season: l.season - 1, championId: 1, runnerUpId: 2, records: { 0: { w: 8, l: 9, t: 0 } } }];
    const g = game(l, 1);
    l.games.push(g);
    recordResult(l, g, result(21, 14));
    l.week = 2;
    const old = legacy(l);
    const rng = copy(old.rngState);
    const players = copy(old.players);
    const history = copy(old.history);
    const traits = copy(old.teams.map((t) => t.gm));
    const up = migrateLeague(old)!;
    expect(up.version).toBe(SAVE_VERSION);
    expect(up.rngState).toEqual(rng);
    expect(up.players).toEqual(players);
    expect(up.history).toEqual(history);
    expect(up.teams.map((t) => t.gm)).toEqual(traits);
    expect(gmRecord(up).regular).toEqual({ w: 9, l: 9, t: 0 });
    expect(teamGm(up, 1)!.career).toEqual([]);
    expect(up.games.find((x) => x.id === g.id)?.management).toBeUndefined();
    expect(migrateLeague(copy(up))).toEqual(up);
  });

  it('never credits a completed season twice and preserves existing coach history', () => {
    const l = world();
    const head = Object.values(l.coaches).find((c) => c.teamId === 0 && c.role === 'headCoach')!;
    const g = game(l, 1);
    l.games.push(g);
    recordResult(l, g, result(21, 14));
    l.phase = 'complete';
    l.history = [{ season: l.season, championId: 0, runnerUpId: 1, records: { 0: { w: 10, l: 7, t: 0 } } }];
    const up = migrateLeague(legacy(l))!;
    expect(gmRecord(up).regular).toEqual({ w: 10, l: 7, t: 0 });
    expect(coachRecord(up, up.coaches[head.id]).regular).toEqual({ w: 10, l: 7, t: 0 });
    expect(migrateLeague(copy(up))).toEqual(up);
  });
});

describe('the GM you start as', () => {
  it('a new career starts with the GM name and age you chose', () => {
    const l = createLeague({
      seed: 'gm-start',
      userTeamId: 5,
      gm: { firstName: ' Ada ', lastName: 'Lovelace', age: 33 },
    });
    const gm = l.gms[l.userGmId];
    expect(gm.teamId).toBe(5);
    expect([gm.firstName, gm.lastName, gm.age]).toEqual(['Ada', 'Lovelace', 33]);
    expect(gm.nameEdited).toBe(true);
    // Only your GM changes: the rest of the world is the one the preview showed.
    const plain = createLeague({ seed: 'gm-start', userTeamId: 5 });
    expect(l.players).toEqual(plain.players);
    expect(l.rngState).toEqual(plain.rngState);
  });

  it('starting ages run from 30 to 45, whole years only', () => {
    expect(gmStartProblem('Ada', 'Lovelace', 30)).toBeNull();
    expect(gmStartProblem('Ada', 'Lovelace', 45)).toBeNull();
    expect(gmStartProblem('Ada', 'Lovelace', 29)).toMatch(/30 to 45/);
    expect(gmStartProblem('Ada', 'Lovelace', 46)).toMatch(/30 to 45/);
    expect(gmStartProblem('Ada', 'Lovelace', 33.5)).toMatch(/30 to 45/);
    expect(gmStartProblem(' ', 'Lovelace', 33)).toMatch(/Both names/);
    expect(() => createLeague({ seed: 'gm-start', gm: { firstName: 'A', lastName: 'B', age: 60 } })).toThrow(
      /30 to 45/,
    );
  });

  it('the New Game default is the club GM, with the age brought into the starting range', () => {
    const l = createLeague({ seed: 'gm-start', userTeamId: 5 });
    const gm = l.gms[l.teams[5].gmId!];
    expect(startingGm(gm)).toEqual({
      firstName: gm.firstName,
      lastName: gm.lastName,
      age: Math.min(45, Math.max(30, gm.age)),
    });
  });
});
