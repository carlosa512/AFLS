import { beforeEach, describe, expect, it } from 'vitest';
import { createLeague } from '../generate';
import { capHit } from '../finance/contract';
import { releasePreview } from '../finance/cap';
import { minSalary } from '../finance/market';
import { activeRoster, practiceSquad } from '../roster';
import { perceive } from '../scouting';
import type { League } from '../types';
import { elevationRecords, nextTeamGame, planElevation } from './elevations';
import { settleWeek } from './flow';
import {
  lockProtections,
  poachContract,
  poachProblem,
  protectedIds,
  protectionPicks,
  resolvePoaching,
  setPin,
  submitPoachOffer,
} from './poaching';
import { squadPayroll } from './payroll';
import { serviceSeasons } from './service';
import { waiverOrder } from './waivers';
import { promoteSquadPlayer } from './squads';

const template = createLeague({ seed: 'poaching-tests', personnel: true, userTeamId: 0 });
const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v));
let l: League;
beforeEach(() => {
  l = copy(template);
  for (const t of l.teams) t.carryover = 100_000;
});
/** The club's own read of its squad, best ceiling first, the way the automatic picks rank them. */
const ranked = (teamId: number) =>
  practiceSquad(l, teamId)
    .map((p) => ({ id: p.id, pot: perceive(l, teamId, p).potMid }))
    .sort((a, b) => b.pot - a.pot || a.id - b.id)
    .map((x) => x.id);

describe('two protections a week', () => {
  it('auto protection takes the two best scouted ceilings', () => {
    expect(protectionPicks(l, 0)).toEqual(ranked(0).slice(0, 2));
    lockProtections(l);
    expect(protectedIds(l, 0)).toEqual(ranked(0).slice(0, 2));
    expect(protectedIds(l, 5)).toEqual(ranked(5).slice(0, 2));
  });

  it('a pin replaces the lower auto pick', () => {
    const pick = ranked(0).at(-1)!;
    setPin(l, 0, pick, true);
    expect(protectionPicks(l, 0)).toEqual([pick, ranked(0)[0]]);
  });

  it('a pin after the lock waits until next week', () => {
    lockProtections(l);
    const before = protectedIds(l, 0);
    const pick = ranked(0).at(-1)!;
    setPin(l, 0, pick, true);
    expect(protectedIds(l, 0)).toEqual(before);
    l.week = 2;
    lockProtections(l);
    expect(protectedIds(l, 0)).toContain(pick);
  });

  it('a protected player who leaves frees no slot this week', () => {
    lockProtections(l);
    const [first, second] = protectedIds(l, 0);
    const room = practiceSquad(l, 0).length; // promotion needs a 53 place: open one
    expect(room).toBeGreaterThan(2);
    const cut = l.teams[0].depthChart.WR.at(-1)!;
    l.players[cut].teamId = null;
    l.players[cut].contract = null;
    promoteSquadPlayer(l, l.players[first]);
    lockProtections(l);
    expect(protectedIds(l, 0)).toEqual([second]);
  });

  it('locking twice in a week and after a JSON reload changes nothing', () => {
    lockProtections(l);
    const locked = copy(l.personnel!.poaching!.locked);
    setPin(l, 0, ranked(0).at(-1)!, true);
    lockProtections(l);
    expect(l.personnel!.poaching!.locked).toEqual(locked);
    const loaded = copy(l);
    lockProtections(loaded);
    expect(loaded.personnel!.poaching!.locked).toEqual(locked);
  });

  it('a third pin is refused, and only your own squad players can be pinned', () => {
    const [a, b, c] = ranked(0);
    setPin(l, 0, a, true);
    setPin(l, 0, b, true);
    expect(() => setPin(l, 0, c, true)).toThrow(/two/);
    expect(() => setPin(l, 0, practiceSquad(l, 3)[0].id, true)).toThrow(/your practice squad/);
    setPin(l, 0, a, false);
    setPin(l, 0, c, true);
    expect(l.personnel!.poaching!.pins[0]).toEqual([b, c]);
  });
});

/** Two clubs that don't meet this week, so neither is the other's next opponent. */
function apart(a: number): number {
  const g = nextTeamGame(l, a)!;
  return l.teams.find((t) => t.id !== a && t.id !== g.homeId && t.id !== g.awayId)!.id;
}
/** Open a place on a club's 53. */
function room(teamId: number) {
  const p = activeRoster(l, teamId)
    .filter((x) => x.position === 'WR')
    .at(-1)!;
  p.teamId = null;
  p.contract = null;
}
/** An unprotected squad player of `from`. */
const target = (from: number) => practiceSquad(l, from).find((p) => !protectionPicks(l, from).includes(p.id))!;

describe('poaching', () => {
  it("a protected player can't be poached", () => {
    const from = apart(0);
    room(0);
    const star = l.players[protectionPicks(l, from)[0]];
    expect(poachProblem(l, { playerId: star.id, teamId: 0, years: 1 })).toMatch(/protected/);
  });

  it("next opponents can't poach from each other", () => {
    const g = nextTeamGame(l, 0)!;
    const opp = g.homeId === 0 ? g.awayId : g.homeId;
    room(0);
    room(opp);
    expect(poachProblem(l, { playerId: target(opp).id, teamId: 0, years: 1 })).toMatch(/play them this week/);
    expect(poachProblem(l, { playerId: target(0).id, teamId: opp, years: 1 })).toMatch(/play them this week/);
  });

  it('no room or cap: the offer lapses with a reason at the settle', () => {
    const from = apart(0);
    room(0);
    const p = target(from);
    submitPoachOffer(l, { playerId: p.id, teamId: 0, years: 1 });
    const back = Object.values(l.players).find((x) => x.teamId === null && x.contract === null && x.position === 'WR')!;
    back.teamId = 0; // the place is gone again before the settle
    back.contract = poachContract(l, back, 1);
    settleWeek(l);
    expect(p.teamId).toBe(from);
    const r = l.personnel!.poaching!.results.find((x) => x.playerId === p.id)!;
    expect(r.toTeamId).toBeNull();
    expect(r.reason).toMatch(/53/);
  });

  it('the longer deal wins, then waiver priority', () => {
    const from = apart(0);
    const others = l.teams.map((t) => t.id).filter((id) => id !== from && apart(id) !== undefined);
    const [a, b, c] = others.filter((id) => {
      const g = nextTeamGame(l, id)!;
      return g.homeId !== from && g.awayId !== from;
    });
    for (const id of [a, b, c]) room(id);
    const p = target(from);
    submitPoachOffer(l, { playerId: p.id, teamId: a, years: 1 });
    submitPoachOffer(l, { playerId: p.id, teamId: b, years: 2 });
    resolvePoaching(l);
    expect(p.teamId).toBe(b);
    const q = target(from);
    const order = waiverOrder(l);
    const [first, second] = [a, c].sort((x, y) => order.indexOf(x) - order.indexOf(y));
    submitPoachOffer(l, { playerId: q.id, teamId: second, years: 1 });
    submitPoachOffer(l, { playerId: q.id, teamId: first, years: 1 });
    resolvePoaching(l);
    expect(q.teamId).toBe(first);
  });

  it('a poached player joins the 53 on a minimum deal with three guaranteed weeks; the old squad pay stops', () => {
    const from = apart(0);
    room(0);
    const p = target(from);
    const pay = squadPayroll(l, from).projected;
    submitPoachOffer(l, { playerId: p.id, teamId: 0, years: 2 });
    settleWeek(l);
    expect(p.teamId).toBe(0);
    expect(p.squad).toBeUndefined();
    expect(activeRoster(l, 0)).toContain(p);
    const salary = minSalary(serviceSeasons(p, l.season), l.caps[l.season]);
    const y = p.contract!.years[0];
    expect(p.contract!.years.length).toBe(2);
    expect(y.guaranteed).toBe(Math.min(y.base, Math.ceil((3 * salary) / 18)));
    expect(squadPayroll(l, from).projected).toBeLessThan(pay);
    expect(practiceSquad(l, from)).not.toContain(p);
  });

  it('cut a week later, the remaining guaranteed weeks are dead money', () => {
    const from = apart(0);
    room(0);
    const p = target(from);
    submitPoachOffer(l, { playerId: p.id, teamId: 0, years: 1 });
    settleWeek(l);
    const guaranteed = p.contract!.years[0].guaranteed;
    expect(guaranteed).toBeGreaterThan(0);
    const dead = releasePreview(l, p).thisYear;
    expect(dead).toBeGreaterThan(0);
    expect(dead).toBeLessThanOrEqual(guaranteed + 0.5);
    expect(capHit(p.contract!, l.season)).toBeGreaterThanOrEqual(dead);
  });

  it('a planned call-up with the old club is cancelled', () => {
    const from = apart(0);
    room(0);
    const p = target(from);
    planElevation(l, p, nextTeamGame(l, from)!);
    submitPoachOffer(l, { playerId: p.id, teamId: 0, years: 1 });
    settleWeek(l);
    expect(p.teamId).toBe(0);
    expect(elevationRecords(l).find((e) => e.playerId === p.id)!.status).toBe('cancelled');
  });

  it('resolving twice or after a reload signs nobody twice', () => {
    const from = apart(0);
    room(0);
    const p = target(from);
    submitPoachOffer(l, { playerId: p.id, teamId: 0, years: 1 });
    settleWeek(l);
    const after = copy(l);
    expect(resolvePoaching(l)).toEqual([]);
    settleWeek(l);
    expect(l).toEqual(after);
    const loaded = copy(l);
    settleWeek(loaded);
    expect(loaded).toEqual(after);
  });
});
