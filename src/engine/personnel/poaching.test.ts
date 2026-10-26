import { beforeEach, describe, expect, it } from 'vitest';
import { createLeague } from '../generate';
import { capHit } from '../finance/contract';
import { releasePreview } from '../finance/cap';
import { minSalary } from '../finance/market';
import { activeRoster, practiceSquad } from '../roster';
import { perceive } from '../scouting';
import type { League } from '../types';
import { STARTERS } from '../positions';
import { deliverMail, mailSubject } from '../inbox';
import { manageInjuries } from '../injuries';
import { Rng } from '../rng';
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
  aiPoachCover,
  heldForPoaching,
  submitAIPoachOffers,
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

describe('AI poaching', () => {
  /** An AI club that doesn't play `exclude`'s club this week. */
  const aiClub = () => l.teams.find((t) => t.id !== l.userTeamId && t.id !== 0 && t.id === apart(0))!.id;
  /** No healthy WRs left on `teamId`'s 53 and no free-agent WRs: the only cover is another club's squad. */
  function shortOfReceivers(teamId: number, keepPlaces = false) {
    for (const p of activeRoster(l, teamId).filter((x) => x.position === 'WR')) {
      if (keepPlaces)
        p.injury = {
          type: 'Ankle sprain',
          severity: 'moderate',
          weeksRemaining: 4,
          estimate: [3, 5],
          season: l.season,
          week: 1,
          where: 'game',
        };
      else Object.assign(p, { teamId: null, contract: null, retired: true });
    }
    for (const p of Object.values(l.players)) if (p.teamId === null && p.position === 'WR') p.retired = true;
  }
  const offers = () => l.personnel?.poaching?.offers ?? [];

  it('an AI club short at a position poaches the best unprotected fit by its own read', () => {
    const club = aiClub();
    shortOfReceivers(club);
    submitAIPoachOffers(l);
    const mine = offers().filter((o) => o.teamId === club);
    expect(mine).toHaveLength(1);
    const g = nextTeamGame(l, club)!;
    const pool = l.teams
      .filter((t) => t.id !== club && t.id !== g.homeId && t.id !== g.awayId)
      .flatMap((t) =>
        practiceSquad(l, t.id).filter(
          (p) => p.position === 'WR' && !protectionPicks(l, t.id).includes(p.id) && !p.injury,
        ),
      );
    const best = pool.sort((a, b) => perceive(l, club, b).ovr - perceive(l, club, a).ovr || a.id - b.id)[0];
    expect(mine[0].playerId).toBe(best.id);
    expect(STARTERS.WR).toBeGreaterThan(0);
  });

  it('injury cover prefers a better squad player elsewhere and holds his place until the settle', () => {
    const club = aiClub();
    const wrs = activeRoster(l, club).filter((x) => x.position === 'WR');
    for (const p of wrs.slice(1)) Object.assign(p, { teamId: null, contract: null, retired: true });
    for (const p of Object.values(l.players)) if (p.teamId === null && p.position === 'WR') p.retired = true;
    manageInjuries(l, l.teams[club], new Rng('poach-cover'));
    const mine = offers().filter((o) => o.teamId === club);
    expect(mine).toHaveLength(1);
    expect(l.players[mine[0].playerId].position).toBe('WR');
    expect(heldForPoaching(l, club).places).toBe(1);
    expect(activeRoster(l, club).length).toBeLessThan(53); // the place stays open for him
    expect(aiPoachCover(l, club, 'TE')).toBe(false); // one offer a week
  });

  it('an AI club at 53 or without cap room never poaches', () => {
    const club = aiClub();
    shortOfReceivers(club, true); // hurt, so still on the 53
    expect(activeRoster(l, club)).toHaveLength(53);
    submitAIPoachOffers(l);
    expect(offers().filter((o) => o.teamId === club)).toHaveLength(0);
    for (const p of activeRoster(l, club).filter((x) => x.position === 'WR'))
      Object.assign(p, { teamId: null, contract: null, retired: true });
    l.teams[club].carryover = -1_000_000;
    submitAIPoachOffers(l);
    expect(offers().filter((o) => o.teamId === club)).toHaveLength(0);
  });

  it('at most one AI offer a club a week', () => {
    const club = aiClub();
    shortOfReceivers(club);
    for (const p of activeRoster(l, club).filter((x) => x.position === 'TE'))
      Object.assign(p, { teamId: null, contract: null, retired: true });
    submitAIPoachOffers(l);
    submitAIPoachOffers(l);
    expect(offers().filter((o) => o.teamId === club)).toHaveLength(1);
  });

  it("the user's club never poaches without autoUser", () => {
    shortOfReceivers(0);
    submitAIPoachOffers(l);
    expect(offers().filter((o) => o.teamId === 0)).toHaveLength(0);
    submitAIPoachOffers(l, true);
    expect(offers().filter((o) => o.teamId === 0)).toHaveLength(1);
  });
});

describe('losing a squad player', () => {
  it('sends one mail from the head coach, once', () => {
    const club = apart(0);
    room(club);
    const p = target(0);
    submitPoachOffer(l, { playerId: p.id, teamId: club, years: 1 });
    settleWeek(l);
    expect(p.teamId).toBe(club);
    deliverMail(l);
    deliverMail(l);
    const mail = (l.inbox ?? []).filter((m) => m.id.startsWith('squadPoach:'));
    expect(mail).toHaveLength(1);
    expect(mail[0].from).toMatch(/Head coach|Coaching staff/);
    expect(mail[0].subject).toContain(p.lastName);
    expect(mail[0].subject).toContain(l.teams[club].name);
    expect(mailSubject(mail[0])).toEqual({ kind: 'squadPoach', season: l.season, week: l.week, playerId: p.id });
  });
});
