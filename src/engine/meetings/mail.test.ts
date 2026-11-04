import { describe, expect, it } from 'vitest';
import { teamCoaches } from '../coaching';
import { createLeague } from '../generate';
import { deliverMail } from '../inbox';
import { playWeek } from '../league';
import { beginOffseason } from '../offseason';
import { simToEndOfSeason } from '../league';
import { acceptGmOffer, beginGmSearch } from '../leadership';
import { endGmAppointment } from '../gm';
import type { League, MeetingRecord } from '../types';
import { answerMeeting, requestAddress, requestMeeting, setMeetingsByCoach } from './index';
import { stepClock } from './suggest';
import { meetingCard, meetingNeedsYou, yearParagraphFor } from './mail';

const base = (() => {
  const l = createLeague({ seed: 'meeting-mail' });
  playWeek(l);
  playWeek(l);
  deliverMail(l);
  return JSON.stringify(l);
})();
const fresh = (): League => JSON.parse(base);
const ids = (l: League, prefix: string) => (l.inbox ?? []).filter((m) => m.id.startsWith(prefix));
const hc = (l: League) => teamCoaches(l, l.userTeamId).find((c) => c.role === 'headCoach')!;

describe('meetings: the letters', () => {
  it('a suggestion waiting on you files one letter, once', () => {
    const l = fresh();
    expect(requestMeeting(l, 'DL')).not.toBeNull();
    deliverMail(l);
    deliverMail(l);
    const letters = ids(l, 'meeting:');
    expect(letters).toHaveLength(1);
    expect(letters[0].from).toMatch(/Head coach/);
    expect(letters[0].body).not.toMatch(/\d/);
  });

  it('answering files one result letter that names the window', () => {
    const l = fresh();
    const s = requestMeeting(l, 'DL')!;
    deliverMail(l);
    const backing = s.backings.find((b) => b !== 'words') ?? 'words';
    answerMeeting(l, { approach: 'straight', backing, timing: 'monday' });
    deliverMail(l);
    deliverMail(l);
    const results = ids(l, 'meeting-result:');
    expect(results).toHaveLength(1);
    expect(results[0].body).toMatch(/What I told them: “/);
    if (backing !== 'words') expect(results[0].body).toMatch(/within|before/);
    else expect(results[0].body).toMatch(/doesn't change what's bothering them/);
  });

  it("a commitment's last week adds a due row to the staff notes, once", () => {
    const l = fresh();
    const team = l.teams[l.userTeamId];
    const wr = l.players[team.depthChart.WR[0]];
    team.meetings!.open.push({
      backing: 'talks',
      scope: 'WR',
      opened: stepClock(l) - 2,
      closes: stepClock(l) + 2,
      named: [wr.id],
      boughtIn: [],
      by: 'coach',
    });
    playWeek(l);
    deliverMail(l);
    playWeek(l);
    deliverMail(l);
    const due = (l.inbox ?? [])
      .flatMap((m) => m.sections ?? [])
      .flatMap((s) => s.rows)
      .filter((r) => /comes due next week/.test(r.note ?? ''));
    expect(due).toHaveLength(1);
    expect(due[0].note).toMatch(new RegExp(`${wr.lastName}'s agent`));
    expect(due[0].negotiate?.playerId).toBe(wr.id);
  });

  it("a change in the coach's word adds his candid line once", () => {
    const l = fresh();
    hc(l).credibility = -0.6;
    playWeek(l);
    deliverMail(l);
    playWeek(l);
    deliverMail(l);
    const candid = (l.inbox ?? [])
      .flatMap((m) => m.sections ?? [])
      .flatMap((s) => s.rows)
      .filter((r) => /worn thin/.test(r.note ?? ''));
    expect(candid).toHaveLength(1);
    // The row says what it's about, and so does the letter when it's the only thing in it.
    expect(candid[0].cells[0]).toBe('My word with the players');
    expect(candid[0].note).toMatch(/team meeting/);
    const letter = (l.inbox ?? []).find((m) => m.sections?.some((s) => s.rows.includes(candid[0])))!;
    if (letter.sections!.every((s) => s.rows.length === 1))
      expect(letter.subject).toBe('From me: my word with the players');
  });

  it('your address to the team files a captain’s letter', () => {
    const l = fresh();
    // Open the address: four straight losses is the crisis.
    const team = l.teams[l.userTeamId];
    for (const g of l.games
      .filter((g) => g.season === l.season && (g.homeId === team.id || g.awayId === team.id))
      .slice(0, 4))
      g.result = {
        ...(l.games.find((x) => x.result)!.result as object),
        homeScore: g.homeId === team.id ? 3 : 30,
        awayScore: g.homeId === team.id ? 30 : 3,
      } as never;
    const s = requestAddress(l);
    expect(s).not.toBeNull();
    answerMeeting(l, { approach: 'ownIt', backing: 'words', timing: 'monday' });
    deliverMail(l);
    const letters = ids(l, 'meeting-captain:');
    expect(letters).toHaveLength(1);
    expect(letters[0].from).toMatch(/captain/i);
  });

  it('SNN runs a rumor on a coach losing his room, once a season', () => {
    const l = fresh();
    const other = l.teams.find((t) => t.id !== l.userTeamId)!;
    const coach = teamCoaches(l, other.id).find((c) => c.role === 'headCoach')!;
    coach.credibility = -0.8;
    for (const g of l.games.filter(
      (g) => g.season === l.season && g.result && (g.homeId === other.id || g.awayId === other.id),
    ))
      g.result = {
        ...(g.result as object),
        homeScore: g.homeId === other.id ? 3 : 30,
        awayScore: g.homeId === other.id ? 30 : 3,
      } as never;
    const games = l.games
      .filter((g) => g.season === l.season && !g.result && (g.homeId === other.id || g.awayId === other.id))
      .slice(0, 1);
    for (const g of games)
      g.result = {
        ...(l.games.find((x) => x.result)!.result as object),
        homeScore: g.homeId === other.id ? 3 : 30,
        awayScore: g.homeId === other.id ? 30 : 3,
      } as never;
    deliverMail(l);
    deliverMail(l);
    const rumors = ids(l, 'rumor:');
    expect(rumors).toHaveLength(1);
    expect(rumors[0].body).toMatch(new RegExp(`Word out of ${other.city}`));
    expect(rumors[0].body).not.toMatch(/\d/);
  });

  it("the season's-end report tells the year's meetings", () => {
    const l = createLeague({ seed: 'meeting-year' });
    setMeetingsByCoach(l, true);
    simToEndOfSeason(l);
    beginOffseason(l);
    deliverMail(l);
    const team = l.teams[l.userTeamId];
    const report = ids(l, `locker:${l.season - 1}:end`).at(-1);
    expect(team.meetings?.lastYear?.held).toBeGreaterThan(0);
    expect(report?.body ?? '').toMatch(/We got the guys together/);
  });
});

describe('meetings: one letter per suggestion', () => {
  it('after you pass on his suggestion, you cannot ask for another the same week', () => {
    const l = fresh();
    const m = l.teams[l.userTeamId].meetings ?? (l.teams[l.userTeamId].meetings = { log: [], open: [] });
    m.lastOffer = stepClock(l);
    expect(requestMeeting(l, 'team')).toBeNull();
  });

  it('your address never takes over the coach’s letter for the same week and scope', () => {
    const l = fresh();
    const s = requestMeeting(l, 'team')!;
    deliverMail(l);
    answerMeeting(l, 'skip');
    // A crisis opens the address the same week.
    const m = l.teams[l.userTeamId].meetings!;
    m.pending = {
      ...s,
      kind: 'gm',
      approaches: ['ownIt', 'raiseBar'],
      backings: ['jobs', 'words'],
      timings: ['monday'],
    };
    expect(meetingCard(l, { clock: s.clock, scope: 'team' }).state).toBe('passed');
    expect(meetingNeedsYou(l, { clock: s.clock, scope: 'team' })).toBe(false);
    answerMeeting(l, { approach: 'ownIt', backing: 'words', timing: 'monday' });
    expect(meetingCard(l, { clock: s.clock, scope: 'team' }).state).toBe('passed');
  });
});

describe('meetings: whose promise the year tells', () => {
  it('tells a promise from your own address as yours', () => {
    const l = fresh();
    const m = l.teams[l.userTeamId].meetings ?? (l.teams[l.userTeamId].meetings = { log: [], open: [] });
    m.lastYear = {
      season: l.season - 1,
      held: 1,
      settled: [{ clock: (l.season - 1) * 32 + 14, scope: 'team', backing: 'jobs', kept: false, named: [], by: 'gm' }],
    };
    expect(yearParagraphFor(l)).toMatch(/You told them nobody's job was safe/);
    expect(yearParagraphFor(l)).not.toMatch(/I said/);
  });
});

describe('meetings: letters from a new club', () => {
  it('files no letter for a meeting held before you took the job, and does for one after', () => {
    const l = fresh();
    l.phase = 'resign';
    const held = (clock: number): MeetingRecord => ({
      clock,
      scope: 'team',
      kind: 'trouble',
      approach: 'straight',
      backing: 'words',
      timing: 'monday',
      outcomes: { lands: [], bristles: [] },
    });
    // The club held a meeting this step, before you arrived.
    l.teams[1].meetings!.log.push(held(stepClock(l)));
    endGmAppointment(l, l.userGmId, 'dismissed');
    endGmAppointment(l, l.teams[1].gmId!, 'dismissed');
    beginGmSearch(l);
    l.leadership.search!.offers = [{ teamId: 1, through: l.season + 2, expiresRound: 2 }];
    acceptGmOffer(l, 1);
    deliverMail(l);
    expect(ids(l, 'meeting-result:')).toHaveLength(0);
    // The next one is yours.
    l.teams[1].meetings!.log.push(held(stepClock(l) + 1));
    deliverMail(l);
    expect(ids(l, 'meeting-result:')).toHaveLength(1);
  });
});
