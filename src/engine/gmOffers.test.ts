import { describe, expect, it } from 'vitest';
import { createLeague } from './generate';
import { editGmName, endGmAppointment } from './gm';
import {
  acceptGmOffer,
  advanceGmHiringRound,
  beginGmSearch,
  declineGmOffers,
  gmCandidateScore,
  gmOfferTerms,
  gmReputation,
} from './leadership';
import { installInterimHeadCoach, protectCoach, resolveInterimHeadCoach, teamCoaches } from './coaching';
import { advanceOffseason, offseasonBlockers } from './offseason';
import { leadershipMail } from './inbox';
import { migrateLeague } from './migrate';
import { teamStaff } from './staff';
import type { GeneralManager, League, SeasonSummary } from './types';
const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v));
function world() {
  const l = createLeague({ seed: 'gm-offer-window' });
  l.season += 3;
  l.phase = 'resign';
  l.history.push({
    season: l.season - 1,
    championId: 2,
    runnerUpId: 3,
    records: Object.fromEntries(
      l.teams.map((t) => [
        t.id,
        { w: t.id === 1 ? 1 : t.id === 2 ? 9 : 7, l: t.id === 1 ? 16 : t.id === 2 ? 8 : 10, t: 0 },
      ]),
    ),
  } as SeasonSummary);
  return l;
}
function candidate(g: GeneralManager, season: number, wins: number) {
  g.career = [0, 1, 2].map((n) => ({
    season: season - n - 1,
    teamId: g.appointments[0].teamId,
    record: { fromWeek: 1, throughWeek: 18, regular: { w: wins, l: 17 - wins, t: 0 }, playoffs: null, champion: false },
  }));
}
function openings(l: League) {
  endGmAppointment(l, l.userGmId, 'dismissed');
  for (const id of [1, 2]) endGmAppointment(l, l.teams[id].gmId!, 'dismissed');
}

describe('GM offers in the staffing window', () => {
  it('guarantees the weakest open job, holds it while waiting, and requires an explicit response', () => {
    const l = world();
    openings(l);
    beginGmSearch(l);
    expect(l.leadership.search!.offers[0].teamId).toBe(1);
    expect(l.leadership.search!.offers.some((o) => o.teamId === 0)).toBe(false);
    advanceGmHiringRound(l);
    advanceGmHiringRound(l);
    expect(l.teams[1].gmId).toBeNull();
    expect(l.leadership.search!.offers.some((o) => o.teamId === 1)).toBe(true);
    expect(offseasonBlockers(l).join(' ')).toContain('Review your GM offers');
    expect(() => advanceOffseason(l)).toThrow(/Review your GM offers/);
    acceptGmOffer(l, 1);
    expect(l.teams[1].gmId).toBe(l.userGmId);
    expect(l.gms[l.userGmId].appointments.at(-1)!.terms).toEqual(
      gmOfferTerms(l, { teamId: 1, through: l.season + 2, expiresRound: 3 }),
    );
    expect(l.leadership.search!.offers).toEqual([]);
  });
  it('keeps quiet-year incumbents until a conditional offer is accepted, and allows sitting out', () => {
    const l = world();
    endGmAppointment(l, l.userGmId, 'dismissed');
    const incumbents = l.teams.map((t) => t.gmId);
    beginGmSearch(l);
    const offer = l.leadership.search!.offers[0];
    expect(offer.teamId).toBe(1);
    expect(offer.replacesGmId).toBe(incumbents[1]);
    expect(l.teams.map((t) => t.gmId)).toEqual(incumbents);
    const accepted = copy(l);
    acceptGmOffer(accepted, 1);
    expect(accepted.gms[incumbents[1]!].teamId).toBeNull();
    expect(accepted.gms[incumbents[1]!].appointments.at(-1)!.reason).toBe('dismissed');
    expect(accepted.teams[1].gmId).toBe(accepted.userGmId);
    declineGmOffers(l);
    expect(l.gms[l.userGmId].teamId).toBeNull();
    expect(l.teams[1].gmId).toBe(incumbents[1]);
    expect(l.leadership.search!.round).toBe(3);
    expect(l.teams.every((t) => t.gmId !== null)).toBe(true);
  });
  it('shows the signed staffing conditions in the offer, mail and accepted appointment', () => {
    const l = world();
    openings(l);
    const hc = teamCoaches(l, 1).find((c) => c.role === 'headCoach')!;
    protectCoach(l, hc.id, l.season, 'Owner wants one more season.');
    beginGmSearch(l);
    const offer = l.leadership.search!.offers[0],
      terms = copy(offer.terms!);
    expect(terms.staffing.join(' ')).toContain(`${hc.firstName} ${hc.lastName}`);
    expect(terms.staffing.join(' ')).toContain('already signed');
    const mail = leadershipMail(l, new Set()).find((m) => m.id === `gm-offer:${l.season}:1`)!;
    expect(mail.body).toContain(terms.expectation);
    expect(mail.body).not.toContain('round');
    acceptGmOffer(l, 1);
    expect(l.gms[l.userGmId].appointments.at(-1)!.terms).toEqual(terms);
    expect(l.teams[1].leadershipReview!.reason).toContain(terms.expectation);
    expect(hc.contract!.through).toBeGreaterThanOrEqual(l.season);
  });
  it('uses career results and individual owners for both human and AI candidates', () => {
    const l = world(),
      g = l.gms[l.userGmId];
    endGmAppointment(l, g.id, 'dismissed');
    candidate(g, l.season, 3);
    const bad = gmReputation(l, g);
    candidate(g, l.season, 12);
    expect(gmReputation(l, g)).toBeGreaterThan(bad + 0.4);
    const owners = l.teams.map((t) => gmCandidateScore(l, t.id, g));
    expect(new Set(owners).size).toBeGreaterThan(10);
    const before = gmCandidateScore(l, 1, g);
    l.userGmId = l.teams[2].gmId!;
    expect(gmCandidateScore(l, 1, g)).toBe(before);
  });
  it('gives successful careers more interest without removing the struggling career’s fallback', () => {
    const base = world();
    openings(base);
    for (let id = 3; id < 10; id++) endGmAppointment(base, base.teams[id].gmId!, 'dismissed');
    let successful = 0,
      struggling = 0;
    for (let i = 0; i < 12; i++)
      for (const wins of [3, 12]) {
        const l = copy(base);
        l.seed += `:${i}`;
        candidate(l.gms[l.userGmId], l.season, wins);
        beginGmSearch(l);
        expect(l.leadership.search!.offers.length).toBeGreaterThanOrEqual(1);
        expect(l.leadership.search!.offers.length).toBeLessThanOrEqual(3);
        if (wins === 12) successful += l.leadership.search!.offers.length;
        else struggling += l.leadership.search!.offers.length;
      }
    expect(successful).toBeGreaterThan(struggling);
  });
  it('closes GM searches alongside normal staffing without extra calendar steps and covers poached directors', () => {
    const l = world();
    for (const id of [1, 2, 3]) endGmAppointment(l, l.teams[id].gmId!, 'dismissed');
    const sources = new Map(Object.values(l.staff).map((s) => [s.id, s.teamId]));
    beginGmSearch(l);
    advanceOffseason(l, { autoUser: true });
    expect(l.phase).toBe('freeAgency');
    expect(l.teams.every((t) => t.gmId !== null)).toBe(true);
    const entrants = Object.values(l.gms).filter((g) => g.origin === 'director');
    expect(entrants.length).toBeGreaterThan(0);
    expect(entrants.some((g) => sources.get(g.scouting!.id) !== g.teamId)).toBe(true);
    for (const t of l.teams) expect(teamStaff(l, t.id).some((s) => s.role === 'director')).toBe(true);
  });
});

describe('GM identity and durable interim history', () => {
  it('only lets the human rename their persistent GM, including between jobs', () => {
    const l = world(),
      g = l.gms[l.userGmId],
      other = l.teams[1].gmId!;
    const appearance = g.appearanceId,
      appointments = copy(g.appointments);
    expect(() => editGmName(l, other, 'Other', 'Name')).toThrow(/Only your own/);
    expect(() => editGmName(l, g.id, ' ', 'Name')).toThrow(/Both names/);
    expect(() => editGmName(l, g.id, 'X'.repeat(25), 'Name')).toThrow(/24/);
    editGmName(l, g.id, '  Morgan ', ' Rivera ');
    expect(g.firstName).toBe('Morgan');
    expect(g.lastName).toBe('Rivera');
    expect(g.appearanceId).toBe(appearance);
    expect(g.appointments).toEqual(appointments);
    endGmAppointment(l, g.id, 'dismissed');
    editGmName(l, g.id, 'New', 'Name');
    expect(migrateLeague(copy(l))!.gms[g.id].firstName).toBe('New');
  });
  it('preserves an interim takeover through permanent hiring and save/load without inventing game results', () => {
    const l = world();
    l.phase = 'regular';
    l.week = 9;
    l.teams[1].staffBudgetMult = 3;
    const c = installInterimHeadCoach(l, 1)!;
    expect(c).not.toBeNull();
    const record = copy(c.career ?? []);
    expect(c.interimAppointments).toEqual([{ season: l.season, teamId: 1, week: 9 }]);
    l.season++;
    l.phase = 'resign';
    resolveInterimHeadCoach(l, c, true);
    expect(c.interim).toBeUndefined();
    expect(c.career ?? []).toEqual(record);
    const loaded = migrateLeague(copy(l))!;
    expect(loaded.coaches[c.id].interimAppointments).toEqual(c.interimAppointments);
  });
  it('migrates only observed interim takeovers and supplies an offer to a legacy unemployed save', () => {
    const l = world();
    l.version = 43;
    endGmAppointment(l, l.userGmId, 'dismissed');
    const c = teamCoaches(l, 1).find((c) => c.role === 'headCoach')!;
    l.leadership.events.push({
      id: 1,
      date: { season: l.season - 1, phase: 'regular', week: 13 },
      teamId: 1,
      kind: 'coachInterim',
      coachId: c.id,
      report: 'Interim appointment.',
    });
    const loaded = migrateLeague(copy(l))!;
    expect(loaded.coaches[c.id].interimAppointments).toEqual([{ season: l.season - 1, teamId: 1, week: 13 }]);
    expect(loaded.leadership.search!.offers.length).toBeGreaterThanOrEqual(1);
    const saved = JSON.stringify(loaded);
    expect(JSON.stringify(migrateLeague(loaded))).toBe(saved);
  });
});
