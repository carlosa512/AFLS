import { describe, expect, it } from 'vitest';
import { createLeague, SAVE_VERSION } from './generate';
import { endGmAppointment } from './gm';
import {
  acceptGmOffer,
  advanceGmHiringRound,
  beginGmSearch,
  declineGmOffers,
  gmDismissalChance,
  leadershipCoachTenure,
  leadershipNewYear,
  leadershipWeek,
} from './leadership';
import { leadershipMail } from './inbox';
import { coachMarket, hireCoach, releaseCoach, protectCoach, teamCoaches } from './coaching';
import { employed, managesTeam, withLeagueAi } from './employment';
import { migrateLeague } from './migrate';
import { teamStaff } from './staff';
import { releaseStaff } from './staff';
import { advanceOffseason, beginOffseason } from './offseason';
import type { Game, League, SeasonSummary } from './types';
const world = () => createLeague({ seed: 'gm-carousel-tests' });
const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v));
function badYears(l: League) {
  l.season += 3;
  l.phase = 'resign';
  for (let i = 1; i <= 3; i++)
    l.history.push({
      season: l.season - i,
      championId: 1,
      runnerUpId: 2,
      records: Object.fromEntries(l.teams.map((t) => [t.id, { w: 3, l: 14, t: 0 }])),
    } as SeasonSummary);
}

describe('GM leadership and searches', () => {
  it('makes an offseason hire permanent even if the candidate previously held an interim job', () => {
    const l = world();
    l.phase = 'resign';
    l.teams[l.userTeamId].staffBudgetMult = 3;
    const old = teamCoaches(l, l.userTeamId).find((c) => c.role === 'headCoach')!;
    releaseCoach(l, l.userTeamId, old.id);
    const candidate = coachMarket(l).find((c) => c.role === 'headCoach' && c.id !== old.id)!;
    candidate.interim = true;
    hireCoach(l, l.userTeamId, candidate.id, 2);
    expect(candidate.interim).toBeUndefined();
    expect(() => protectCoach(l, candidate.id, l.season, 'Keep the new permanent head coach.')).not.toThrow();
  });
  it('starts head-coach patience from the role change, not years already spent in the building', () => {
    const l = world();
    const c = teamCoaches(l, 0).find((c) => c.role === 'headCoach')!;
    c.since = l.season - 5;
    c.career = [
      { teamId: 0, season: l.season - 1, role: 'offCoord' },
      { teamId: 0, season: l.season, role: 'headCoach' },
    ];
    expect(leadershipCoachTenure(l, c)).toBe(0);
    l.season++;
    expect(leadershipCoachTenure(l, c)).toBe(1);
  });
  it('covers a director vacancy at the end of hiring even when no GM promotion caused it', () => {
    const l = world();
    l.phase = 'resign';
    const d = teamStaff(l, 1).find((s) => s.role === 'director')!;
    releaseStaff(l, 1, d.id);
    beginGmSearch(l);
    for (let r = 0; r < 3; r++) advanceGmHiringRound(l);
    expect(teamStaff(l, 1).some((s) => s.role === 'director')).toBe(true);
  });
  it('advances an unemployed offseason with all clubs controlled by the AI and a valid viewer after every step', () => {
    const l = world();
    endGmAppointment(l, l.userGmId, 'dismissed');
    l.phase = 'complete';
    const viewer = l.userTeamId;
    beginOffseason(l);
    declineGmOffers(l);
    expect(l.userTeamId).toBe(viewer);
    for (let n = 0; n < 24 && (l.phase as string) !== 'regular'; n++) {
      advanceOffseason(l);
      expect(l.userTeamId).toBe(viewer);
    }
    expect(l.phase).toBe('regular');
    expect(employed(l)).toBe(false);
    expect(l.teams.every((t) => t.gmId !== null)).toBe(true);
  });
  it('gives a rebuilding hire time, protects success and puts sustained failure at risk', () => {
    const l = world();
    l.season++;
    l.phase = 'resign';
    l.history.push({
      season: l.season - 1,
      championId: 1,
      runnerUpId: 2,
      records: { 0: { w: 1, l: 16, t: 0 } },
    } as SeasonSummary);
    expect(gmDismissalChance(l, 0)).toBe(0);
    l.season += 2;
    l.history.push({
      season: l.season - 1,
      championId: 1,
      runnerUpId: 2,
      records: { 0: { w: 3, l: 14, t: 0 } },
    } as SeasonSummary);
    expect(gmDismissalChance(l, 0)).toBeGreaterThan(0.4);
    l.history.at(-1)!.records[0] = { w: 11, l: 6, t: 0 };
    expect(gmDismissalChance(l, 0)).toBe(0);
  });
  it('reviews once, changes GMs, preserves owner-backed coaches and fills vacancies through real directors', () => {
    const l = world();
    badYears(l);
    const heads = new Map(l.teams.map((t) => [t.id, teamCoaches(l, t.id).find((c) => c.role === 'headCoach')!]));
    for (const c of heads.values()) protectCoach(l, c.id, l.season, 'The coach stays with a new GM.');
    leadershipNewYear(l);
    const fired = l.leadership.events.filter((e) => e.kind === 'gmDismissed');
    expect(fired.length).toBeGreaterThan(0);
    const events = l.leadership.events.length;
    leadershipNewYear(l);
    expect(l.leadership.events).toHaveLength(events);
    for (let i = 0; i < 3; i++) advanceGmHiringRound(l, { autoUser: true });
    for (const t of l.teams) {
      expect(t.gmId).not.toBeNull();
      expect(teamStaff(l, t.id).some((s) => s.role === 'director')).toBe(true);
      expect(heads.get(t.id)!.teamId).toBe(t.id);
    }
    for (const g of Object.values(l.gms).filter((g) => g.origin === 'director')) {
      expect(g.appearanceId).toBe(`staff:${g.scouting!.id}`);
      expect(g.scouting!.role).toBe('director');
      expect(l.staff[g.scouting!.id]).toBeUndefined();
      expect(g.appointments.at(-1)!.interim).toBe(false);
    }
  });
  it('holds offered jobs, makes acceptance explicit and changes authority and scouting access', () => {
    const l = world();
    l.phase = 'resign';
    const user = l.gms[l.userGmId];
    endGmAppointment(l, user.id, 'dismissed');
    endGmAppointment(l, l.teams[1].gmId!, 'dismissed');
    beginGmSearch(l);
    l.leadership.search!.offers = [{ teamId: 1, through: l.season + 2, expiresRound: 2 }];
    advanceGmHiringRound(l);
    expect(l.teams[1].gmId).toBeNull();
    expect(user.teamId).toBeNull();
    l.knowledge[10] = 1;
    acceptGmOffer(l, 1);
    expect(managesTeam(l, 1)).toBe(true);
    expect(managesTeam(l, 0)).toBe(false);
    expect(l.userTeamId).toBe(1);
    expect(l.knowledge).toEqual({});
    expect(() => acceptGmOffer(l, 1)).toThrow(/no longer/);
  });
  it('permits sitting out, expires unanswered offers and restores the viewer club after AI simulation errors', () => {
    const l = world();
    l.phase = 'resign';
    endGmAppointment(l, l.userGmId, 'dismissed');
    beginGmSearch(l);
    l.leadership.search!.offers = [];
    for (let i = 0; i < 3; i++) advanceGmHiringRound(l);
    expect(employed(l)).toBe(false);
    const last = l.userTeamId;
    expect(() =>
      withLeagueAi(l, () => {
        expect(l.userTeamId).toBe(-1);
        throw new Error('probe');
      }),
    ).toThrow('probe');
    expect(l.userTeamId).toBe(last);
    expect(l.leadership.search!.round).toBe(3);
  });
  it('creates midseason interims from eligible internal or unemployed people, with coverage and no repeat decision', () => {
    let tested = false;
    for (let n = 0; n < 8 && !tested; n++) {
      const l = world();
      badYears(l);
      l.seed += n;
      l.phase = 'regular';
      l.week = 9;
      l.games = [];
      for (let w = 1; w <= 8; w++)
        for (let t = 0; t < 32; t += 2)
          l.games.push({
            id: l.nextGameId++,
            season: l.season,
            week: w,
            homeId: t,
            awayId: t + 1,
            result: { homeScore: 0, awayScore: 20 },
          } as Game);
      const sources = new Map(Object.values(l.staff).map((s) => [s.id, s.teamId]));
      const coachingSources = new Map(Object.values(l.coaches).map((c) => [c.id, c.teamId]));
      leadershipWeek(l);
      const moves = l.leadership.events.filter((e) => e.kind === 'gmHired' || e.kind === 'coachInterim');
      if (!moves.length) continue;
      tested = true;
      const before = JSON.stringify(l);
      leadershipWeek(l);
      expect(JSON.stringify(l)).toBe(before);
      for (const e of moves) {
        if (e.gmId) {
          const g = l.gms[e.gmId];
          expect(g.appointments.at(-1)).toMatchObject({ interim: true, through: l.season });
          if (g.scouting) expect([null, e.teamId]).toContain(sources.get(g.scouting.id));
          expect(teamStaff(l, e.teamId).some((s) => s.role === 'director')).toBe(true);
        } else if (e.coachId) {
          expect([null, e.teamId]).toContain(coachingSources.get(e.coachId));
          expect(l.coaches[e.coachId].interim).toBe(true);
        }
      }
    }
    expect(tested).toBe(true);
  });
  it('shows outside decisions as reporting, not private instructions, and migrates old headlines', () => {
    const l = world();
    l.leadership.events.push({
      id: 1,
      date: { season: l.season, phase: 'regular', week: 9 },
      teamId: 1,
      kind: 'warning',
      report: 'Sources suggest a prove-it year.',
      privateText: 'CONFIDENTIAL keep this exact staff.',
    });
    expect(leadershipMail(l, new Set())[0].body).toBe('Sources suggest a prove-it year.');
    l.userTeamId = 1;
    l.gms[l.userGmId].teamId = 1;
    l.teams[1].gmId = l.userGmId;
    expect(leadershipMail(l, new Set())[0].body).toContain('CONFIDENTIAL');
    const old = world();
    old.version = 42;
    delete (old as Partial<League>).leadership;
    old.transactions.push({
      season: 2026,
      phase: 'resign',
      week: 1,
      kind: 'coach',
      teamIds: [1],
      text: 'ABC owner retained head coach Name through 2027: PRIVATE reason',
    });
    const loaded = migrateLeague(copy(old))!;
    expect(loaded.version).toBe(SAVE_VERSION);
    expect(loaded.transactions.at(-1)!.text).not.toContain('PRIVATE');
    expect(loaded.leadership.events).toEqual([]);
  });
});
