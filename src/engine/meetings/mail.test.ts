import { describe, expect, it } from 'vitest';
import { teamCoaches } from '../coaching';
import { createLeague } from '../generate';
import { deliverMail } from '../inbox';
import { playWeek } from '../league';
import { beginOffseason } from '../offseason';
import { simToEndOfSeason } from '../league';
import { acceptGmOffer, beginGmSearch } from '../leadership';
import { endGmAppointment } from '../gm';
import type { InboxMessage, League, MeetingRecord } from '../types';
import { beat } from '../stories';
import { answerMeeting, requestAddress, requestMeeting, setMeetingsByCoach } from './index';
import { stepClock } from './suggest';
import { meetingCard, meetingNeedsYou, requestRow, resultRows, yearParagraphFor } from './mail';
import { manSheet } from '../castSheet';
import { moraleContext } from '../morale';
import { teamPlayers } from '../roster';
import { unitOf } from '../standing';
import { seasonSaid } from '../voice';

const base = (() => {
  const l = createLeague({ seed: 'meeting-mail' });
  playWeek(l);
  playWeek(l);
  deliverMail(l);
  return JSON.stringify(l);
})();
const fresh = (): League => JSON.parse(base);
const ids = (l: League, prefix: string) => (l.inbox ?? []).filter((m) => m.id.startsWith(prefix));
const coach = (l: League) => ids(l, 'coach:');
const rowsOf = (m: InboxMessage) => (m.sections ?? []).flatMap((x) => x.rows);
const hc = (l: League) => teamCoaches(l, l.userTeamId).find((c) => c.role === 'headCoach')!;

describe('meetings: the letters', () => {
  it('a suggestion waiting on you is a row of the weekly letter, once', () => {
    const l = fresh();
    l.moraleAt = stepClock(l);
    expect(requestMeeting(l, 'DL')).not.toBeNull();
    deliverMail(l);
    deliverMail(l);
    const letters = coach(l);
    expect(letters).toHaveLength(1);
    expect(ids(l, 'meeting:')).toHaveLength(0);
    expect(letters[0].from).toMatch(/Head coach/);
    expect(letters[0].body).not.toMatch(/\d/);
    const want = letters[0].sections!.find((x) => x.title === 'What I want to do')!;
    expect(want.rows).toHaveLength(1);
    expect(want.rows[0].meeting).toMatchObject({ scope: 'DL' });
    expect(want.rows[0].note).not.toMatch(/\d/);
  });

  it('answering tells the result a step on, in rows that name the window', () => {
    const l = fresh();
    l.moraleAt = stepClock(l);
    const s = requestMeeting(l, 'DL')!;
    deliverMail(l);
    const backing = s.backings.find((b) => b !== 'words') ?? 'words';
    answerMeeting(l, { approach: 'straight', backing, timing: 'monday' });
    deliverMail(l);
    expect(ids(l, 'meeting-result:')).toHaveLength(0);
    l.moraleAt++;
    deliverMail(l);
    deliverMail(l);
    expect(coach(l)).toHaveLength(2);
    const rows = rowsOf(coach(l)[1]).filter((r) => r.cells[0] === 'The D-line');
    const told = rows.find((r) => r.cells[1] === 'What I told them')!;
    const owed = rows.find((r) => r.cells[1] === 'Where that leaves us')!;
    expect(told.note).toMatch(/“/);
    if (backing !== 'words') expect(owed.note).toMatch(/within|before|by the/);
    else expect(owed.note).toMatch(/doesn't change what's bothering them/);
    expect(ids(l, 'meeting-result:')).toHaveLength(0);
  });

  it("a commitment's last week adds a due row to the weekly letter, once", () => {
    const l = fresh();
    l.moraleAt = stepClock(l);
    const team = l.teams[l.userTeamId];
    const wr = l.players[team.depthChart.WR[0]];
    // The story a held meeting's commitment opens: a deal, due in two steps.
    beat(l, { kind: 'deal', teamId: team.id, playerId: wr.id }, 'commitment', stepClock(l) - 2, {
      due: stepClock(l) + 2,
    });
    const due = () =>
      coach(l)
        .flatMap(rowsOf)
        .filter((r) => r.cells[1] === 'The clock' && r.playerId === wr.id);
    for (let i = 0; i < 4; i++) {
      deliverMail(l);
      l.moraleAt!++;
    }
    // Halfway, then due: each told once, and the man has his Negotiate button.
    expect(due()).toHaveLength(2);
    expect(due().at(-1)!.note).toMatch(new RegExp(wr.lastName));
    expect(due().at(-1)!.negotiate?.playerId).toBe(wr.id);
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
  it('tells no result for a meeting held before you took the job, and tells one held after', () => {
    const l = fresh();
    l.phase = 'resign';
    l.moraleAt = stepClock(l);
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
    l.moraleAt = stepClock(l) + 1;
    deliverMail(l);
    const told = () =>
      coach(l)
        .flatMap(rowsOf)
        .filter((r) => r.cells[1] === 'What I told them');
    expect(told()).toHaveLength(0);
    // The next one is yours, and is told a step on.
    l.teams[1].meetings!.log.push(held(stepClock(l)));
    deliverMail(l);
    expect(told()).toHaveLength(0);
    l.moraleAt!++;
    deliverMail(l);
    expect(told()).toHaveLength(1);
  });
});

describe('meetings: a result told a week on', () => {
  /** A meeting held with the room, then its record in hand. */
  const held = (l: League, backing: 'talks' | 'words' = 'words') => {
    const s = requestMeeting(l, 'DL')!;
    const b = backing === 'talks' ? (s.backings.find((x) => x !== 'words') ?? 'words') : 'words';
    answerMeeting(l, { approach: 'straight', backing: b, timing: 'monday' });
    return l.teams[l.userTeamId].meetings!.log.at(-1)!;
  };
  const dl = (l: League) => teamPlayers(l, l.userTeamId).filter((p) => unitOf(p.position) === 'DL');

  it('tells a result from where each man is now', () => {
    const l = fresh();
    const r = held(l);
    const a = dl(l)[0];
    r.outcomes = { lands: [a.id], bristles: [] };
    // He is poor now, and his deal is the reason.
    a.contract!.apy = 1;
    a.morale!.level = -2;
    const man = manSheet(l, a, moraleContext(l))!;
    expect(man.mood).toBe('Poor');
    const rows = resultRows(l, r, []);
    const his = rows.find((x) => x.playerId === a.id)!;
    expect(his.note).toBeTruthy();
    expect(man.reason).toBe('Wants a new deal');
    expect(his.note).toMatch(/deal/);
    expect(JSON.stringify(rows)).not.toMatch(/shrug/i);
  });

  it('says the room is steadier when it read Down then and is not now', () => {
    const l = fresh();
    const r = held(l);
    r.word = 'Down';
    for (const p of dl(l)) p.morale!.level = 3;
    const rows = resultRows(l, r, []);
    const row = rows.find((x) => x.cells[1] === 'What I told them')!;
    expect(row.note).toMatch(/steadier|tight now|were down|was down/i);
    expect(row.note).toMatch(/“.+”/);
  });

  it('names the men a commitment owes, with the Negotiate row, and files the quote on its own row', () => {
    const l = fresh();
    const r = held(l, 'talks');
    const rows = resultRows(l, r, []);
    expect(rows.some((x) => x.cells[1] === 'Where that leaves us')).toBe(true);
    if (r.backing === 'talks') expect(rows.some((x) => x.negotiate)).toBe(true);
  });

  it('four meetings in a season give four different "what I told them"', () => {
    const l = fresh();
    const r = held(l);
    const said: string[] = seasonSaid(l, 'x');
    const told = [0, 1, 2, 3].map((i) => {
      const rec = { ...r, clock: r.clock + i };
      const row = resultRows(l, rec, said).find((x) => x.cells[1] === 'What I told them')!;
      return row.note!.match(/“(.+)”/)![1];
    });
    expect(new Set(told).size).toBe(4);
  });

  it('the pending suggestion is a row that carries its meeting', () => {
    const l = fresh();
    expect(requestRow(l)).toBeNull();
    const s = requestMeeting(l, 'DL')!;
    const row = requestRow(l)!;
    expect(row.meeting).toEqual({ clock: s.clock, scope: 'DL' });
    expect(row.note).toBeTruthy();
    expect(row.note).not.toMatch(/\d/);
  });
});
