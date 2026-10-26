import { describe, expect, it } from 'vitest';
import {
  chairHolder,
  coachMandate,
  coachMarket,
  coachMoveProblem,
  coachPayroll,
  coachRoom,
  coachWindowCloses,
  developCoaches,
  ownerRetentionReviews,
  protectCoach,
  promoteCoach,
  promotionProblem,
  releaseCoach,
  replaceCoach,
  replaceProblem,
  teamCoaches,
} from './coaching';
import { recruitmentProblem } from './employment';
import { capSpace } from './finance/cap';
import { createLeague, SAVE_VERSION } from './generate';
import { appointGm, endGmAppointment } from './gm';
import { deliverMail } from './inbox';
import { medicMoveProblem, teamMedics } from './medical';
import { migrateLeague } from './migrate';
import { staffMoveProblem, teamStaff } from './staff';
import type { CoachRole, League, SeasonSummary } from './types';

const world = () => createLeague({ seed: 'owner-mandates' });
const copy = <T>(x: T): T => JSON.parse(JSON.stringify(x));
const coach = (l: League, teamId = l.userTeamId, role: CoachRole = 'headCoach') =>
  chairHolder(teamCoaches(l, teamId), { role })!;
function history(l: League, season: number, w: number): SeasonSummary {
  return {
    season,
    championId: 0,
    records: Object.fromEntries(l.teams.map((t) => [t.id, { w, l: 17 - w, t: 0 }])),
  } as SeasonSummary;
}

describe('owner coaching mandates', () => {
  it('signs an expired deal before restricting actions, charging payroll rather than the player cap', () => {
    const l = world();
    l.phase = 'resign';
    const c = coach(l);
    c.contract!.through = l.season - 1;
    const cap = capSpace(l, l.userTeamId),
      room = coachRoom(l, l.userTeamId);
    const rng = l.rngState;
    protectCoach(l, c.id, l.season, 'The owner wants to see another season.');
    expect(c.contract!.through).toBe(l.season);
    expect(coachRoom(l, l.userTeamId)).toBe(room - c.contract!.salary);
    expect(coachPayroll(l, l.userTeamId)).toBeGreaterThan(0);
    expect(capSpace(l, l.userTeamId)).toBe(cap);
    expect(l.rngState).toBe(rng);
    const replacement = coachMarket(l).find((x) => x.role === 'headCoach')!;
    const before = JSON.stringify(l);
    expect(coachMoveProblem(l, l.userTeamId, c, 'release')).toMatch(/Owner mandate/);
    expect(replaceProblem(l, l.userTeamId, replacement, 2, false)).toMatch(/Owner mandate/);
    expect(() => releaseCoach(l, l.userTeamId, c.id)).toThrow(/Owner mandate/);
    expect(() => replaceCoach(l, l.userTeamId, replacement.id)).toThrow(/Owner mandate/);
    expect(JSON.stringify(l)).toBe(before);
  });

  it('does not shorten or reprice a live deal, and repeated promises do not duplicate or charge twice', () => {
    const l = world(),
      c = coach(l);
    c.contract = { salary: 10000, through: l.season + 4 };
    const old = copy(c.contract);
    const first = protectCoach(l, c.id, l.season, 'Keep him.');
    expect(protectCoach(l, c.id, l.season, 'Keep him.')).toBe(first);
    expect(l.teams[l.userTeamId].ownerMandates).toHaveLength(1);
    expect(c.contract).toEqual(old);
    protectCoach(l, c.id, l.season + 1, 'Give him longer.');
    expect(coachMandate(l, c)?.through).toBe(l.season + 1);
    expect(c.contract).toEqual(old);
  });

  it('blocks moving a protected coordinator even with budget checks bypassed', () => {
    const l = world();
    l.phase = 'resign';
    const c = coach(l, l.userTeamId, 'offCoord');
    c.career = [{ season: l.season - 1, teamId: l.userTeamId, role: 'offCoord' }];
    protectCoach(l, c.id, l.season, 'Keep the offense together.');
    expect(promotionProblem(l, l.userTeamId, c, 2, false)).toMatch(/Owner mandate/);
    expect(() => promoteCoach(l, l.userTeamId, c.id)).toThrow(/Owner mandate/);
  });

  it('keeps AI-backed coaches through hot-seat reviews, replacement staffs and other clubs’ promotions', () => {
    const l = world();
    l.phase = 'resign';
    l.history.push(history(l, l.season - 1, 1));
    const head = coach(l, 1),
      coord = coach(l, 2, 'offCoord');
    head.since = l.season - 5;
    head.contract!.through = l.season - 1;
    coord.youth = coord.veterans = 20;
    coord.career = [{ season: l.season - 1, teamId: 2, role: 'offCoord' }];
    protectCoach(l, head.id, l.season, 'Another chance.');
    protectCoach(l, coord.id, l.season, 'Keep the coordinator.');
    releaseCoach(l, 2, coach(l, 2).id);
    coachWindowCloses(l, { autoUser: true });
    expect(coach(l, 1).id).toBe(head.id);
    expect(coach(l, 2, 'offCoord').id).toBe(coord.id);
    expect(coach(l, 2).id).not.toBeUndefined();
    expect(coord.role).toBe('offCoord');
    expect(l.teams[1].coachDead.some((x) => x.name === `${head.firstName} ${head.lastName}`)).toBe(false);
    expect(l.teams[2].coachDead.some((x) => x.name === `${coord.firstName} ${coord.lastName}`)).toBe(false);
  });

  it('belongs to the organization across GM changes and expires at the promised year boundary', () => {
    const l = world();
    l.phase = 'resign';
    const c = coach(l),
      gmId = l.teams[l.userTeamId].gmId!;
    protectCoach(l, c.id, l.season, 'The coach stays whoever runs the front office.');
    endGmAppointment(l, gmId, 'dismissed');
    const other = l.teams[1].gmId!;
    endGmAppointment(l, other, 'expired');
    appointGm(l, l.userTeamId, other, { through: l.season + 2 });
    const loaded = migrateLeague(copy(l))!;
    expect(coachMoveProblem(loaded, loaded.userTeamId, loaded.coaches[c.id], 'release')).toMatch(/Owner mandate/);
    loaded.season++;
    expect(coachMoveProblem(loaded, loaded.userTeamId, loaded.coaches[c.id], 'release')).toBeNull();
    expect(loaded.teams[loaded.userTeamId].ownerMandates).toHaveLength(1);
  });

  it('allows retirement without handing the promise to a replacement or silently converting an interim', () => {
    const l = world(),
      c = coach(l);
    protectCoach(l, c.id, l.season, 'Keep him if he continues coaching.');
    c.age = 74;
    developCoaches(l);
    expect(l.coaches[c.id]).toBeUndefined();
    expect(coachMandate(l, c)).toBeUndefined();
    const another = coach(l, 1);
    another.interim = true;
    expect(() => protectCoach(l, another.id, l.season + 1, 'Keep him.')).toThrow(/permanent offer/);
  });

  it('makes seeded retention decisions once before moves, and does not grant consecutive extra chances', () => {
    const l = world();
    l.phase = 'resign';
    l.history.push(history(l, l.season - 1, 7));
    for (const t of l.teams) coach(l, t.id).since = l.season - 1;
    const rng = l.rngState;
    const identical = copy(l);
    ownerRetentionReviews(l);
    ownerRetentionReviews(identical);
    expect(l).toEqual(identical);
    const backed = l.teams.filter((t) => t.ownerMandates.length);
    expect(backed.length).toBeGreaterThan(0);
    expect(backed.length).toBeLessThan(32);
    for (const t of backed) expect(coach(l, t.id).contract!.through).toBeGreaterThanOrEqual(l.season);
    const before = JSON.stringify(l);
    ownerRetentionReviews(l);
    expect(JSON.stringify(l)).toBe(before);
    expect(l.rngState).toBe(rng);
    l.season++;
    l.history.push(history(l, l.season - 1, 8));
    ownerRetentionReviews(l);
    for (const t of backed) expect(t.ownerMandates).toHaveLength(1);
  });

  it('explains the signed commitment in the owner letter exactly once', () => {
    const l = world();
    l.phase = 'resign';
    const c = coach(l);
    protectCoach(l, c.id, l.season, 'The owner wants one more year.');
    deliverMail(l);
    deliverMail(l);
    const letters = l.inbox!.filter((m) => m.id === `owner:${l.season}:${l.userTeamId}`);
    expect(letters).toHaveLength(1);
    expect(letters[0].body).toContain('contract already covers that commitment');
    expect(letters[0].body).toContain('The owner wants one more year.');
  });

  it('migrates old saves without inventing mandates or changing people, contracts or randomness', () => {
    const l = world();
    l.version = 41;
    for (const t of l.teams) delete (t as Partial<typeof t>).ownerMandates;
    const before = copy(l);
    const loaded = migrateLeague(copy(l))!;
    expect(loaded.version).toBe(SAVE_VERSION);
    expect(loaded.coaches).toEqual(before.coaches);
    expect(loaded.gms).toEqual(before.gms);
    expect(loaded.rngState).toEqual(before.rngState);
    expect(loaded.teams.every((t) => t.ownerMandates.length === 0)).toBe(true);
    expect(migrateLeague(copy(loaded))).toEqual(loaded);
  });
});

describe('shared staff recruitment restrictions', () => {
  it('blocks employed coaches, scouts and medics from moving clubs during regular season and playoffs', () => {
    const l = world();
    for (const phase of ['regular', 'playoffs'] as const) {
      l.phase = phase;
      expect(recruitmentProblem(l, 0, 1)).toMatch(/poached midseason/);
      expect(recruitmentProblem(l, 0, 0)).toBeNull();
      expect(recruitmentProblem(l, 0, null)).toBeNull();
      expect(coachMoveProblem(l, 0, coach(l, 1), 'hire')).toMatch(/poached midseason/);
      expect(staffMoveProblem(l, 0, teamStaff(l, 1)[0], 'hire')).toMatch(/poached midseason/);
      expect(medicMoveProblem(l, 0, teamMedics(l, 1)[0], 'hire')).toMatch(/poached midseason/);
    }
    l.phase = 'resign';
    expect(recruitmentProblem(l, 0, 1)).toBeNull();
    l.phase = 'freeAgency';
    expect(recruitmentProblem(l, 0, 1)).toBeNull();
  });
});
