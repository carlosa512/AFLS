import { describe, expect, it } from 'vitest';
import { createLeague } from './generate';
import { deliverMail, mailSubject } from './inbox';
import { dueCheckin } from './lockerReport';
import { betterMentor, mentoringWeek, mentorStatus } from './mentoring';
import { nameCaptains } from './personality';
import { addTie } from './relationships';
import { TRADE_DEADLINE_WEEK } from './trade/rules';
import type { InboxMessage, League, Player } from './types';

const BANNED = /marble|\btraits?\b|z-score/i;
const template = (() => {
  const l = createLeague({ seed: 'locker-mail' });
  mentoringWeek(l);
  // An established GM: his welcome is behind him, back in the draft (a GM hired inside a check-in's window skips
  // that report).
  deliverMail(l);
  for (const m of l.inbox!) Object.assign(m, { phase: 'draft', week: 0 });
  l.inbox = l.inbox!.filter((m) => m.id.includes(':welcome:') || m.id.startsWith('rundown:'));
  return l;
})();
const copy = <T>(v: T): T => structuredClone(v);
const ours = (l: League) => Object.values(l.players).filter((p) => p.teamId === l.userTeamId && !p.retired);
const reports = (l: League) => (l.inbox ?? []).filter((m) => m.id.startsWith('locker:'));
const section = (m: InboxMessage, title: string) => m.sections?.find((s) => s.title === title);
const text = (m: InboxMessage) =>
  [
    m.body,
    ...(m.sections ?? []).flatMap((s) => [s.lead ?? '', ...s.rows.flatMap((r) => [...r.cells, r.note ?? ''])]),
  ].join(' ');
const at = (l: League, phase: League['phase'], week = 0) => {
  l.phase = phase;
  l.week = week;
};
const old = (id: string, l: League): InboxMessage => ({
  id,
  season: l.season,
  phase: l.phase,
  week: l.week,
  from: 'x',
  category: 'staff',
  subject: '',
  body: '',
  read: true,
  actions: [],
});

describe('the locker room report', () => {
  it('six lost mentors file no one-off letters, and the next report lists all six', () => {
    const l = copy(template);
    at(l, 'regular', 3);
    const kids = ours(l)
      .filter((p) => p.age <= 24)
      .slice(0, 6);
    const vet = ours(l).find((p) => p.age >= 28)!;
    for (const k of kids) k.lostMentor = { id: vet.id, season: l.season, week: 2 };
    deliverMail(l);
    expect((l.inbox ?? []).filter((m) => m.id.startsWith('mentor:'))).toHaveLength(0);
    const [m] = reports(l);
    expect(m.id).toBe(`locker:${l.season}:cutdown`);
    expect(mailSubject(m)).toEqual({ kind: 'lockerReport', season: l.season, checkin: 'cutdown' });
    const lost = section(m, 'Mentoring')!.rows.filter((r) => kids.some((k) => k.id === r.playerId));
    expect(lost.length).toBeGreaterThanOrEqual(6);
    for (const k of kids) expect(m.covered).toContain(`mentor:${l.season}:2:gone:${k.id}`);
  });

  it('each check-in files once a season', () => {
    const l = copy(template);
    at(l, 'preseason');
    nameCaptains(l);
    deliverMail(l);
    deliverMail(l);
    at(l, 'regular', 1);
    deliverMail(l);
    at(l, 'regular', TRADE_DEADLINE_WEEK);
    deliverMail(l);
    deliverMail(l);
    expect(reports(l).map((m) => m.id)).toEqual([
      `locker:${l.season}:camp`,
      `locker:${l.season}:cutdown`,
      `locker:${l.season}:deadline`,
    ]);
    // The league year ticks over as the re-sign window opens: the end report looks back on the season played, and
    // the new year's camp still gets its own.
    l.season++;
    at(l, 'resign');
    deliverMail(l);
    expect(reports(l).at(-1)!.id).toBe(`locker:${l.season - 1}:end`);
    at(l, 'preseason');
    nameCaptains(l);
    deliverMail(l);
    expect(reports(l).at(-1)!.id).toBe(`locker:${l.season}:camp`);
  });

  it('a sim past cut-down to week 12 files the deadline report, not the cut-down one', () => {
    const l = copy(template);
    at(l, 'regular', 12);
    expect(dueCheckin(l, new Set())).toBe('deadline');
    deliverMail(l);
    expect(reports(l).map((m) => m.id)).toEqual([`locker:${l.season}:deadline`]);
  });

  it('a feud told once is not told again, nor one an old letter told', () => {
    const l = copy(template);
    const [a, b, c, d] = ours(l).filter((p) => p.position === 'WR' || p.position === 'OL');
    addTie(l, a, b, 'feud', 'benched');
    at(l, 'regular', 1);
    deliverMail(l);
    const [lo, hi] = a.id < b.id ? [a, b] : [b, a];
    expect(reports(l)[0].covered).toContain(`feud:${l.season}:${lo.id}:${hi.id}`);
    expect(section(reports(l)[0], 'Friction')!.rows.map((r) => r.playerId)).toContain(lo.id);
    at(l, 'regular', TRADE_DEADLINE_WEEK);
    deliverMail(l);
    expect(section(reports(l)[1], 'Friction')).toBeUndefined();
    // An upgraded save whose old one-off letter told a feud: the report leaves it alone.
    const up = copy(template);
    addTie(up, c, d, 'feud');
    const [lo2, hi2] = c.id < d.id ? [c, d] : [d, c];
    up.inbox!.push(old(`feud:${up.season}:${lo2.id}:${hi2.id}`, up));
    at(up, 'regular', 1);
    deliverMail(up);
    expect(section(reports(up)[0], 'Friction')).toBeUndefined();
  });

  it('names the captains and the leaders at camp, and only at camp', () => {
    const l = copy(template);
    at(l, 'preseason');
    nameCaptains(l);
    deliverMail(l);
    const [camp] = reports(l);
    const c = l.teams[l.userTeamId].captains!;
    const rows = section(camp, 'Captains and leaders')!.rows;
    expect(rows.slice(0, 3).map((r) => r.playerId)).toEqual([c.offense, c.defense, c.specialTeams]);
    expect(camp.covered).toContain(`captains:${l.season}`);
    at(l, 'regular', 1);
    deliverMail(l);
    expect(section(reports(l)[1], 'Captains and leaders')).toBeUndefined();
  });

  it('a quiet check-in still files, with only its verdict', () => {
    const l = copy(template);
    for (const p of ours(l)) {
      delete p.mentor;
      delete p.ties;
    }
    at(l, 'regular', 1);
    deliverMail(l);
    const [m] = reports(l);
    expect(m).toBeDefined();
    expect(m.sections ?? []).toHaveLength(0);
    expect(m.body.length).toBeGreaterThan(10);
  });

  it('grew up and learned from his mentor, at season’s end', () => {
    const l = copy(template);
    const kid = ours(l).find((p) => p.mentor !== undefined)!;
    const vet = l.players[kid.mentor!];
    kid.mentoredBy = [{ id: vet.id, from: l.season - 1, to: l.season - 1 }];
    kid.shiftedLast = { season: l.season, workEthic: 0.6 };
    at(l, 'resign');
    deliverMail(l);
    const [m] = reports(l);
    expect(section(m, 'Grew up')!.rows.map((r) => r.playerId)).toContain(kid.id);
    expect(m.covered).toContain(`mentor:${l.season}:took:${kid.id}`);
    expect((l.inbox ?? []).filter((x) => x.id.startsWith('mentor:'))).toHaveLength(0);
  });

  it('signs as the coaching staff when the head coach chair is empty', () => {
    const l = copy(template);
    for (const c of Object.values(l.coaches)) if (c.teamId === l.userTeamId && c.role === 'headCoach') c.teamId = null;
    at(l, 'regular', 1);
    deliverMail(l);
    expect(reports(l)[0].from).toBe('Coaching staff');
  });

  it('never says a hidden number or a trait name', () => {
    const l = copy(template);
    const [a, b] = ours(l).filter((p) => p.position === 'CB');
    addTie(l, a, b, 'friend');
    at(l, 'preseason');
    nameCaptains(l);
    deliverMail(l);
    at(l, 'regular', 1);
    deliverMail(l);
    for (const m of reports(l)) expect(text(m)).not.toMatch(BANNED);
  });
});

describe('mentoring reads for the report', () => {
  it("says how a pair is going in the coaches' words", () => {
    const l = copy(template);
    const kid = ours(l).find((p) => p.mentor !== undefined)!;
    expect(['early days', 'learning well', 'not taking', 'picking up his bad habits']).toContain(mentorStatus(l, kid));
    kid.mentorWeeks = 0;
    expect(mentorStatus(l, kid)).toBe('early days');
  });

  it('suggests a better mentor only when one would do more for him', () => {
    const l = copy(template);
    const kid: Player = ours(l).find((p) => p.mentor !== undefined)!;
    kid.mentorWeeks = 8;
    const pick = betterMentor(l, l.userTeamId, kid);
    if (pick) {
      expect(pick.id).not.toBe(kid.mentor);
      expect(pick.teamId).toBe(l.userTeamId);
    }
  });
});

describe('the locker room report, across the calendar', () => {
  it("the season's end tells what happened after the deadline", () => {
    const l = copy(template);
    at(l, 'regular', TRADE_DEADLINE_WEEK);
    deliverMail(l);
    const [a, b] = ours(l).filter((p) => p.position === 'LB');
    addTie(l, a, b, 'feud');
    // The league year ticks over as the re-sign window opens.
    l.season++;
    at(l, 'resign');
    deliverMail(l);
    const [lo] = a.id < b.id ? [a, b] : [b, a];
    expect(section(reports(l).at(-1)!, 'Friction')!.rows.map((r) => r.playerId)).toContain(lo.id);
  });

  it('names the captains in the first report of the season when camp went by unseen', () => {
    const l = copy(template);
    at(l, 'preseason');
    nameCaptains(l);
    at(l, 'regular', 2);
    deliverMail(l);
    const [m] = reports(l);
    expect(m.id).toBe(`locker:${l.season}:cutdown`);
    expect(section(m, 'Captains and leaders')).toBeDefined();
    at(l, 'regular', TRADE_DEADLINE_WEEK);
    deliverMail(l);
    expect(section(reports(l).at(-1)!, 'Captains and leaders')).toBeUndefined();
  });

  it('remembers what it told after the letter itself has left the inbox', () => {
    const l = copy(template);
    const [a, b] = ours(l).filter((p) => p.position === 'WR');
    addTie(l, a, b, 'feud');
    at(l, 'regular', 1);
    deliverMail(l);
    expect(section(reports(l)[0], 'Friction')).toBeDefined();
    // A full inbox lets the report go.
    l.inbox = l.inbox!.filter((m) => !m.id.startsWith('locker:'));
    at(l, 'regular', TRADE_DEADLINE_WEEK);
    deliverMail(l);
    expect(section(reports(l).at(-1)!, 'Friction')).toBeUndefined();
  });
});
