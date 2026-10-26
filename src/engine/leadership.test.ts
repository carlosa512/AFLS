import { describe, expect, it } from 'vitest';
import { createLeague, SAVE_VERSION } from './generate';
import { appointGm, endGmAppointment } from './gm';
import {
  acceptGmOffer,
  advanceGmHiringRound,
  beginGmSearch,
  declineGmOffers,
  gmOfferTerms,
  leadershipCoachTenure,
  leadershipEvent,
  leadershipNewYear,
  interimLetter,
  leadershipWeek,
  pendingGmOffers,
  userExtensionOffer,
} from './leadership';
import { leadershipMail, mailSubject } from './inbox';
import {
  coachRoom,
  coordinatorOf,
  installInterimHeadCoach,
  coachMarket,
  hireCoach,
  releaseCoach,
  protectCoach,
  teamCoaches,
} from './coaching';
import { employed, managesTeam, withLeagueAi } from './employment';
import { migrateLeague } from './migrate';
import { teamStaff } from './staff';
import { releaseStaff } from './staff';
import { advanceOffseason, beginOffseason } from './offseason';
import type { Game, League, LeadershipEvent, SeasonSummary } from './types';
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
      l.week = 11;
      l.games = [];
      for (let w = 1; w <= 10; w++)
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

describe('the owner’s letter when our head coach goes', () => {
  /** Week 11, our club `won` games won then the rest lost, `streak` of them at the end. */
  const midseason = (wins: number, losses: number) => {
    const l = world();
    l.phase = 'regular';
    l.week = 11;
    l.games = [];
    const t = l.userTeamId;
    const results = [...Array(wins).fill(true), ...Array(losses).fill(false)] as boolean[];
    results.forEach((won, i) =>
      l.games.push({
        id: l.nextGameId++,
        season: l.season,
        week: i + 1,
        homeId: t,
        awayId: (t + 1) % 32,
        result: won ? { homeScore: 24, awayScore: 10 } : { homeScore: 10, awayScore: 24 },
      } as Game),
    );
    l.teams[t].staffBudgetMult = 3;
    return l;
  };
  const fire = (l: League) => {
    const t = l.userTeamId;
    const dc = teamCoaches(l, t).find((c) => c.role === 'defCoord')!;
    dc.youth = 20;
    dc.veterans = 20;
    const fired = teamCoaches(l, t).find((c) => c.role === 'headCoach')!;
    const interim = installInterimHeadCoach(l, t)!;
    return { t, fired, interim };
  };
  it('writes the owner letter: record, streak, interim, audition, severance', () => {
    const l = midseason(3, 7);
    const { t, fired, interim } = fire(l);
    const text = interimLetter(l, t, fired, interim, 5580, 8);
    expect(text.startsWith(`I've let ${fired.firstName} ${fired.lastName} go.`)).toBe(true);
    expect(text).toContain('3–7');
    expect(text).toContain('seven straight');
    expect(text).toContain('better than 3–7');
    expect(text).toContain(`${interim.firstName} ${interim.lastName}`);
    expect(text).toContain('keeps running the defense');
    expect(text).toContain('last seven games');
    expect(text).toContain('$5.58M');
  });
  it('says "the last game" when one is left', () => {
    const l = midseason(4, 12);
    const { t, fired, interim } = fire(l);
    const text = interimLetter(l, t, fired, interim, 5580, 8);
    expect(text).toContain('Consider the last game his audition');
  });
  it('leaves out a streak under three and says the roster is thin in the bottom half', () => {
    const l = midseason(0, 0);
    const t = l.userTeamId;
    const res = [false, false, true, false, false];
    res.forEach((won, i) =>
      l.games.push({
        id: l.nextGameId++,
        season: l.season,
        week: i + 1,
        homeId: t,
        awayId: (t + 1) % 32,
        result: won ? { homeScore: 24, awayScore: 10 } : { homeScore: 10, awayScore: 24 },
      } as Game),
    );
    const { fired, interim } = fire(l);
    const text = interimLetter(l, t, fired, interim, 5580, 24);
    expect(text).not.toContain('straight');
    expect(text).toContain('thin');
  });
  it('does not claim a market interim keeps a coordinator job', () => {
    const l = midseason(2, 8);
    const { t, fired, interim } = fire(l);
    delete interim.actingAs;
    expect(interimLetter(l, t, fired, interim, 5580, 8)).not.toContain('keeps running');
  });
  it('says when the severance puts the coaching budget over', () => {
    const l = midseason(2, 8);
    const { t, fired, interim } = fire(l);
    l.teams[t].staffBudgetMult = 0.2;
    expect(coachRoom(l, t)).toBeLessThan(0);
    expect(interimLetter(l, t, fired, interim, 5580, 8)).toMatch(/over this year/);
  });
  it('sends the letter as owner mail with an owner subject; another club gets the public line', () => {
    const l = world();
    const ours = l.userTeamId;
    const other = (ours + 5) % 32;
    for (const [id, teamId] of [
      [1, ours],
      [2, other],
    ])
      l.leadership.events.push({
        id,
        date: { season: l.season, phase: 'regular', week: 11 },
        teamId,
        kind: 'coachInterim',
        report: `${l.teams[teamId].abbrev} dismissed A B and named C D interim head coach.`,
        privateText: teamId === ours ? "I've let A B go. We're 2–8." : undefined,
      });
    const mail = leadershipMail(l, new Set());
    const mine = mail.find((m) => m.id.endsWith(':1'))!;
    expect(mine.from).toBe('The owner');
    expect(mine.subject).toBe("I've let A B go");
    expect(mine.body).toBe("I've let A B go. We're 2–8.");
    const theirs = mail.find((m) => m.id.endsWith(':2'))!;
    expect(theirs.from).toBe('SNN league desk');
    expect(theirs.body).toBe(l.leadership.events[1].report);
  });
});

describe('the weekly roundup of changes around the league', () => {
  const event = (
    l: League,
    id: number,
    teamId: number,
    kind: 'coachInterim' | 'gmDismissed' | 'gmHired',
    week = 12,
  ) => {
    const e = {
      id,
      date: { season: l.season, phase: 'regular' as const, week },
      teamId,
      kind,
      report: `${l.teams[teamId].abbrev} ${kind} report ${id}.`,
    };
    l.leadership.events.push(e);
    return e;
  };
  const others = (l: League) => l.teams.map((t) => t.id).filter((id) => id !== l.userTeamId);
  it('gathers other clubs’ in-season changes of one week into one SNN roundup', () => {
    const l = world();
    const [a, b] = others(l);
    const ea = event(l, 1, a, 'coachInterim');
    const eb = event(l, 2, b, 'coachInterim');
    const mail = leadershipMail(l, new Set());
    expect(mail).toHaveLength(1);
    expect(mail[0].id).toBe(`leadership-week:${l.season}:12:1-2`);
    expect(mail[0].from).toBe('SNN league desk');
    expect(mail[0].subject).toBe(`Coaching changes: ${l.teams[a].abbrev}, ${l.teams[b].abbrev}`);
    expect(mail[0].body).toContain(ea.report);
    expect(mail[0].body).toContain(eb.report);
  });
  it('names GM-only weeks and mixed weeks, each club once', () => {
    const l = world();
    const [a, b] = others(l);
    event(l, 1, a, 'gmDismissed');
    event(l, 2, a, 'gmHired');
    event(l, 3, b, 'gmDismissed');
    expect(leadershipMail(l, new Set())[0].subject).toBe(
      `Front-office changes: ${l.teams[a].abbrev}, ${l.teams[b].abbrev}`,
    );
    const m = world();
    event(m, 1, a, 'gmDismissed');
    event(m, 2, a, 'coachInterim');
    event(m, 3, b, 'coachInterim');
    expect(leadershipMail(m, new Set())[0].subject).toBe(
      `Changes around the league: ${m.teams[a].abbrev}, ${m.teams[b].abbrev}`,
    );
  });
  it('keeps one club’s GM change as one story, not a roundup', () => {
    const l = world();
    const [a] = others(l);
    const fired = event(l, 1, a, 'gmDismissed');
    const hired = event(l, 2, a, 'gmHired');
    const mail = leadershipMail(l, new Set());
    expect(mail).toHaveLength(1);
    expect(mail[0].subject).toBe(fired.report);
    expect(mail[0].body).toBe(`${fired.report}\n\n${hired.report}`);
  });
  it('keeps a single change as its own story and our own club apart', () => {
    const l = world();
    const [a] = others(l);
    const ea = event(l, 1, a, 'coachInterim');
    event(l, 2, l.userTeamId, 'coachInterim');
    const mail = leadershipMail(l, new Set());
    expect(mail).toHaveLength(2);
    const story = mail.find((m) => m.id === `leadership:${l.season}:1`)!;
    expect(story.subject).toBe(ea.report);
    expect(mail.find((m) => m.id === `leadership:${l.season}:2`)!.from).toBe('The owner');
  });
  it('does not refile a story an old save already delivered, nor a filed roundup', () => {
    const l = world();
    const [a, b, c] = others(l);
    event(l, 1, a, 'coachInterim');
    const eb = event(l, 2, b, 'coachInterim');
    const mail = leadershipMail(l, new Set([`leadership:${l.season}:1`]));
    expect(mail).toHaveLength(1);
    expect(mail[0].subject).toBe(eb.report);
    event(l, 3, c, 'coachInterim');
    expect(leadershipMail(l, new Set([`leadership-week:${l.season}:12`]))).toHaveLength(0);
  });
});

describe('an interim at a club with no GM', () => {
  it('is still reviewed as the league year opens, and his acting chair ends', () => {
    const l = world();
    l.phase = 'regular';
    l.week = 11;
    const t = (l.userTeamId + 3) % 32;
    l.teams[t].staffBudgetMult = 3;
    const dc = teamCoaches(l, t).find((c) => c.role === 'defCoord')!;
    dc.youth = 20;
    dc.veterans = 20;
    const hc = installInterimHeadCoach(l, t)!;
    expect(hc.actingAs).toBe('defCoord');
    endGmAppointment(l, l.teams[t].gmId!, 'dismissed');
    l.season++;
    l.phase = 'resign';
    leadershipNewYear(l);
    expect(hc.interim).toBeUndefined();
    expect(hc.actingAs).toBeUndefined();
    expect(
      l.leadership.events.some((e) => e.teamId === t && (e.kind === 'coachPermanent' || e.kind === 'coachDismissed')),
    ).toBe(true);
    expect(coordinatorOf(teamCoaches(l, t), 'defCoord')?.id === hc.id && hc.role === 'headCoach').toBe(false);
  });
});

describe('a roundup week with a late change', () => {
  it('files a change that arrives after the week’s roundup went out, and nothing twice', () => {
    const l = world();
    const others = l.teams.map((t) => t.id).filter((id) => id !== l.userTeamId);
    const push = (id: number, teamId: number) =>
      l.leadership.events.push({
        id,
        date: { season: l.season, phase: 'regular', week: 12 },
        teamId,
        kind: 'coachInterim',
        report: `${l.teams[teamId].abbrev} report ${id}.`,
      });
    push(1, others[0]);
    push(2, others[1]);
    const first = leadershipMail(l, new Set());
    expect(first).toHaveLength(1);
    push(3, others[2]);
    const later = leadershipMail(l, new Set(first.map((m) => m.id)));
    expect(later).toHaveLength(1);
    expect(later[0].body).toBe(`${l.teams[others[2]].abbrev} report 3.`);
    expect(leadershipMail(l, new Set([...first, ...later].map((m) => m.id)))).toHaveLength(0);
  });
  it('files one club’s GM change once, however often mail is delivered', () => {
    const l = world();
    const [a] = l.teams.map((t) => t.id).filter((id) => id !== l.userTeamId);
    for (const [id, kind] of [
      [1, 'gmDismissed'],
      [2, 'gmHired'],
    ] as const)
      l.leadership.events.push({
        id,
        date: { season: l.season, phase: 'regular', week: 12 },
        teamId: a,
        kind,
        report: `report ${id}.`,
      });
    const first = leadershipMail(l, new Set());
    expect(first).toHaveLength(1);
    expect(leadershipMail(l, new Set(first.map((m) => m.id)))).toHaveLength(0);
  });
  it('treats an old roundup id as covering its whole week', () => {
    const l = world();
    const [a, b] = l.teams.map((t) => t.id).filter((id) => id !== l.userTeamId);
    for (const [id, teamId] of [
      [1, a],
      [2, b],
    ])
      l.leadership.events.push({
        id,
        date: { season: l.season, phase: 'regular', week: 12 },
        teamId,
        kind: 'coachInterim',
        report: 'r',
      });
    expect(leadershipMail(l, new Set([`leadership-week:${l.season}:12`]))).toHaveLength(0);
  });
});

describe('your contract offer', () => {
  /** The user's deal ran out last season; no history, so the owner keeps everyone. */
  function expiring() {
    const l = world();
    l.phase = 'resign';
    l.gms[l.userGmId].appointments.at(-1)!.through = l.season - 1;
    delete l.leadership.search;
    return l;
  }
  it('offers the user an extension instead of extending silently', () => {
    const l = expiring();
    leadershipNewYear(l);
    const o = userExtensionOffer(l)!;
    expect(o).toMatchObject({ teamId: l.userTeamId, through: l.season + 2, incumbent: true, extension: true });
    expect(l.leadership.search!.offers[0]).toBe(o);
    expect(l.gms[l.userGmId].appointments.at(-1)!.through).toBe(l.season - 1);
    expect(l.leadership.events.some((e) => e.kind === 'gmExtended' && e.gmId === l.userGmId)).toBe(false);
    expect(pendingGmOffers(l)).toBe(true);
    expect(() => advanceOffseason(l)).toThrow(/offer/);
  });
  it('makes a one-year prove-it offer on a warning', () => {
    const l = expiring();
    const t = l.teams[l.userTeamId];
    t.leadershipReview = { season: l.season, week: 0, gmId: l.userGmId, outcome: 'warning', reason: 'Progress.' };
    beginGmSearch(l);
    expect(userExtensionOffer(l)!.through).toBe(l.season);
  });
  it('accepting extends the deal and files the public line', () => {
    const l = expiring();
    leadershipNewYear(l);
    l.knowledge[10] = 1;
    acceptGmOffer(l, l.userTeamId);
    expect(l.gms[l.userGmId].appointments.at(-1)!.through).toBe(l.season + 2);
    expect(l.leadership.events.at(-1)).toMatchObject({ kind: 'gmExtended', gmId: l.userGmId });
    expect(l.knowledge[10]).toBe(1);
    expect(pendingGmOffers(l)).toBe(false);
  });
  it('declining ends the job and still guarantees a way back, never at our old club', () => {
    const l = expiring();
    leadershipNewYear(l);
    const old = l.userTeamId;
    declineGmOffers(l);
    const user = l.gms[l.userGmId];
    expect(user.teamId).toBeNull();
    expect(user.appointments.at(-1)!.reason).toBe('expired');
    const offers = l.leadership.search!.offers;
    expect(offers.length).toBeGreaterThan(0);
    expect(offers.every((o) => o.teamId !== old && !o.extension)).toBe(true);
    expect(l.leadership.search!.playerDeclined).toBeFalsy();
    expect(pendingGmOffers(l)).toBe(true);
  });
  it('sim offseason accepts the extension', () => {
    const l = expiring();
    leadershipNewYear(l);
    advanceGmHiringRound(l, { autoUser: true });
    expect(l.gms[l.userGmId].appointments.at(-1)!.through).toBe(l.season + 2);
    expect(l.gms[l.userGmId].teamId).toBe(l.userTeamId);
  });
  it('makes no extension offer when the owner lets the user go', () => {
    const l = expiring();
    l.teams[l.userTeamId].leadershipReview = {
      season: l.season,
      week: 0,
      gmId: l.userGmId,
      outcome: 'gmChange',
      reason: 'Change.',
    };
    beginGmSearch(l);
    expect(userExtensionOffer(l)).toBeUndefined();
  });
  it('gives an interim user the permanent offer, never an extension', () => {
    const l = expiring();
    l.gms[l.userGmId].appointments.at(-1)!.interim = true;
    leadershipNewYear(l);
    expect(l.leadership.search!.offers.some((o) => o.extension)).toBe(false);
  });
  it('writes the extension’s terms for a GM staying on, not a new hire', () => {
    const l = expiring();
    leadershipNewYear(l);
    expect(gmOfferTerms(l, userExtensionOffer(l)!).expectation).toBe(
      'Keep the club moving forward: the owner likes the direction.',
    );
    const w = expiring();
    w.teams[w.userTeamId].leadershipReview = {
      season: w.season,
      week: 0,
      gmId: w.userGmId,
      outcome: 'warning',
      reason: 'Progress.',
    };
    beginGmSearch(w);
    expect(gmOfferTerms(w, userExtensionOffer(w)!).expectation).toBe(
      'Show clear progress this season, or the owner makes a change.',
    );
  });
  it('carries an open extension offer through the v50 upgrade', () => {
    const l = expiring();
    leadershipNewYear(l);
    const old = copy(l);
    old.version = 49;
    const loaded = migrateLeague(old)!;
    expect(loaded.version).toBe(SAVE_VERSION);
    expect(SAVE_VERSION).toBeGreaterThanOrEqual(50);
    expect(userExtensionOffer(loaded)).toEqual(userExtensionOffer(l));
  });
  it('still extends AI GMs in place', () => {
    const l = expiring();
    const gm = l.gms[l.teams.find((t) => t.id !== l.userTeamId)!.gmId!];
    gm.appointments.at(-1)!.through = l.season - 1;
    leadershipNewYear(l);
    expect(gm.appointments.at(-1)!.through).toBe(l.season + 2);
    expect(l.leadership.events.some((e) => e.kind === 'gmExtended' && e.gmId === gm.id)).toBe(true);
  });
});

describe('the offseason carousel digest', () => {
  const event = (
    l: League,
    id: number,
    teamId: number,
    kind: LeadershipEvent['kind'],
    phase: 'resign' | 'freeAgency' = 'resign',
  ) => {
    const gm = l.gms[l.teams[teamId].gmId!];
    const e: LeadershipEvent = {
      id,
      date: { season: l.season, phase, week: 0 },
      teamId,
      kind,
      gmId: gm.id,
      report: `${l.teams[teamId].abbrev} ${kind} report ${id}.`,
    };
    l.leadership.events.push(e);
    return e;
  };
  const others = (l: League) => l.teams.map((t) => t.id).filter((id) => id !== l.userTeamId);
  it('gathers other clubs’ events of one offseason step into one SNN digest', () => {
    const l = world();
    const [a, b, c, d] = others(l);
    event(l, 1, a, 'gmDismissed');
    event(l, 2, b, 'gmDismissed');
    event(l, 3, a, 'gmHired');
    event(l, 4, c, 'warning');
    event(l, 5, d, 'gmExtended');
    const mail = leadershipMail(l, new Set());
    expect(mail).toHaveLength(1);
    expect(mail[0].id).toBe(`leadership-phase:${l.season}:resign:1-5`);
    expect(mail[0].from).toBe('SNN league desk');
    expect(mail[0].subject).toBe('Front-office carousel: 2 GMs out, 1 hired, 1 on the hot seat');
    expect(mail[0].carousel!.map((r) => r.group)).toEqual(['out', 'out', 'hired', 'extended', 'hotSeat']);
    expect(mail[0].carousel!.find((r) => r.group === 'hotSeat')!.line).toBe('prove-it season');
    expect(mailSubject({ ...mail[0], read: false })).toEqual({ kind: 'frontOffice', season: l.season });
  });
  it('never puts our own club in the digest', () => {
    const l = world();
    const [a, b] = others(l);
    event(l, 1, a, 'gmDismissed');
    event(l, 2, l.userTeamId, 'gmHired');
    event(l, 3, b, 'gmDismissed');
    const digest = leadershipMail(l, new Set()).find((m) => m.id.startsWith('leadership-phase'))!;
    expect(digest.carousel!.some((r) => r.teamId === l.userTeamId)).toBe(false);
  });
  it('files nothing twice for a save that already had single mails', () => {
    const l = world();
    const [a, b, c] = others(l);
    event(l, 1, a, 'gmDismissed');
    event(l, 2, b, 'gmDismissed');
    event(l, 3, c, 'gmDismissed');
    const mail = leadershipMail(l, new Set([`leadership:${l.season}:1`]));
    expect(mail).toHaveLength(1);
    expect(mail[0].carousel!.map((r) => r.teamId)).toEqual([b, c]);
  });
  it('starts a new digest for events after the first was filed', () => {
    const l = world();
    const [a, b, c, d] = others(l);
    event(l, 1, a, 'gmDismissed');
    event(l, 2, b, 'gmDismissed');
    const first = leadershipMail(l, new Set())[0].id;
    event(l, 3, c, 'gmHired');
    event(l, 4, d, 'gmHired');
    const next = leadershipMail(l, new Set([first]));
    expect(next.map((m) => m.id)).toEqual([`leadership-phase:${l.season}:resign:3-4`]);
  });
  it('never re-files a digested event as owner mail once we run that club', () => {
    const l = world();
    const [a, b] = others(l);
    const fired = event(l, 1, a, 'gmDismissed');
    fired.privateText = 'The owner’s private reason.';
    event(l, 2, b, 'gmDismissed');
    const digest = leadershipMail(l, new Set())[0];
    l.phase = 'resign';
    endGmAppointment(l, l.teams[a].gmId!, 'dismissed');
    endGmAppointment(l, l.userGmId, 'dismissed');
    appointGm(l, a, l.userGmId, { through: l.season + 2 });
    l.userTeamId = a;
    l.leadership.nextEventId = 10; // past the hand-made events above
    leadershipEvent(l, { teamId: a, kind: 'gmHired', gmId: l.userGmId, report: 'Hired.' });
    const later = leadershipMail(l, new Set([digest.id]));
    expect(later.some((m) => m.body.includes('private reason'))).toBe(false);
    expect(later.some((m) => m.id === `leadership:${l.season}:1`)).toBe(false);
  });
  it('still files our own change when its id falls inside another club’s roundup', () => {
    const l = world();
    const [a, b] = others(l);
    event(l, 1, a, 'gmDismissed');
    const ours = event(l, 2, l.userTeamId, 'coachPermanent');
    event(l, 3, b, 'gmDismissed');
    const digest = leadershipMail(l, new Set()).find((m) => m.id.startsWith('leadership-phase'))!;
    expect(digest.id).toBe(`leadership-phase:${l.season}:resign:1-3`);
    expect(leadershipMail(l, new Set([digest.id])).map((m) => m.id)).toEqual([`leadership:${l.season}:${ours.id}`]);
  });
  it('lists a new GM told to keep the head coach as a hire, not a hot seat', () => {
    const l = world();
    const [a, b] = others(l);
    event(l, 1, a, 'gmHired');
    const note = event(l, 2, a, 'warning');
    note.coachId = teamCoaches(l, a).find((c) => c.role === 'headCoach')!.id;
    event(l, 3, b, 'gmDismissed');
    const digest = leadershipMail(l, new Set())[0];
    expect(digest.subject).not.toContain('hot seat');
    expect(digest.carousel!.map((r) => r.group)).toEqual(['out', 'hired']);
    expect(digest.carousel!.find((r) => r.group === 'hired')!.line).toBe('new GM, keeps the head coach');
  });
  it('calls an interim GM hire what it is', () => {
    const l = world();
    const [a, b] = others(l);
    event(l, 1, a, 'gmHired');
    event(l, 2, b, 'gmDismissed');
    l.gms[l.teams[a].gmId!].appointments.at(-1)!.interim = true;
    expect(leadershipMail(l, new Set())[0].carousel!.find((r) => r.group === 'hired')!.line).toBe('interim GM');
  });
  it('keeps a lone event as its own story, and steps apart', () => {
    const l = world();
    const [a, b] = others(l);
    const lone = event(l, 1, a, 'gmRetired');
    event(l, 2, b, 'gmHired', 'freeAgency');
    const mail = leadershipMail(l, new Set());
    expect(mail).toHaveLength(2);
    expect(mail[0].subject).toBe(lone.report);
  });
});
