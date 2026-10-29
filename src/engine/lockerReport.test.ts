import { describe, expect, it } from 'vitest';
import { createLeague } from './generate';
import { deliverMail, mailSubject } from './inbox';
import { dueCheckin } from './lockerReport';
import { moraleView } from './morale';
import { playerOvr } from './positions';
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

describe('the locker room report: morale', () => {
  const moody = (l: League) => {
    for (const p of ours(l)) p.morale = { level: 2, jolts: [] };
    const [a, b] = ours(l);
    a.morale = { level: -2, jolts: [] };
    b.morale = { level: -5, jolts: [] };
    return [a, b];
  };

  it("lists who's down, worst first, each with the coach's note", () => {
    const l = copy(template);
    at(l, 'regular', 3);
    const [poor, worse] = moody(l);
    deliverMail(l);
    const [m] = reports(l);
    const rows = section(m, 'Morale')!.rows;
    expect(rows.map((r) => r.playerId).slice(0, 2)).toEqual([worse.id, poor.id]);
    expect(rows[0].cells).toContain('Very poor');
    for (const r of rows) expect(r.note?.length).toBeGreaterThan(10);
    expect(m.covered).toContain(`morale:${l.season}:cutdown:${worse.id}:down`);
    expect(text(m)).not.toMatch(BANNED);
    for (const r of rows) expect([...r.cells.slice(1), r.note].join(' ')).not.toMatch(/\d/);
  });

  it('tells only what changed by the next report: who slipped, and who came around', () => {
    const l = copy(template);
    at(l, 'regular', 3);
    const [poor, worse] = moody(l);
    deliverMail(l);
    poor.morale = { level: 2, jolts: [] };
    const fresh = ours(l)[2];
    fresh.morale = { level: -4, jolts: [] };
    at(l, 'regular', TRADE_DEADLINE_WEEK);
    deliverMail(l);
    const m = reports(l).find((x) => x.id.endsWith(':deadline'))!;
    const rows = section(m, 'Morale')!.rows;
    const ids = rows.map((r) => r.playerId);
    // Still down since last time: told already, not again.
    expect(ids).not.toContain(worse.id);
    expect(ids).toContain(fresh.id);
    expect(rows.find((r) => r.playerId === poor.id)?.cells).toContain('Good');
  });

  it('names the worst six, and points to the Locker Room for the rest', () => {
    const l = copy(template);
    at(l, 'regular', 3);
    for (const [i, p] of ours(l).entries()) p.morale = { level: i < 9 ? -2 - i * 0.1 : 0, jolts: [] };
    deliverMail(l);
    const s = section(reports(l)[0], 'Morale')!;
    expect(s.rows).toHaveLength(6);
    expect(s.lead).toMatch(/Locker Room/);
    expect(s.lead).not.toMatch(/\d/);
  });

  it('names a man flying once, not every other report', () => {
    const l = copy(template);
    for (const p of ours(l)) p.morale = { level: 0, jolts: [] };
    const star = ours(l)[0];
    star.morale = { level: 8, jolts: [] };
    at(l, 'preseason');
    nameCaptains(l);
    deliverMail(l);
    at(l, 'regular', 3);
    deliverMail(l);
    at(l, 'regular', TRADE_DEADLINE_WEEK);
    deliverMail(l);
    const named = reports(l).filter((m) => section(m, 'Morale')?.rows.some((r) => r.playerId === star.id));
    expect(named.map((m) => m.id)).toEqual([`locker:${l.season}:camp`]);
  });

  it('reads reasons off the league as it is, not a screen’s cache', () => {
    const l = copy(template);
    at(l, 'regular', 3);
    for (const p of ours(l)) p.morale = { level: 0, jolts: [] };
    const qbs = ours(l)
      .filter((p) => p.position === 'QB')
      .sort((x, y) => playerOvr(y) - playerOvr(x));
    const backup = qbs[1];
    backup.morale = { level: -4, jolts: [] };
    // He sat last season, as a backup does.
    backup.stats[l.season - 1] = { gp: 10 } as Player['stats'][number];
    // A screen reads the room while he's the backup; then the starter leaves inside the step.
    expect(moraleView(l, backup)?.reasons).not.toContain('Wants more snaps');
    qbs[0].teamId = null;
    deliverMail(l);
    const row = section(reports(l)[0], 'Morale')!.rows.find((r) => r.playerId === backup.id)!;
    // Now the best quarterback on the roster, still on the bench: the letter says so.
    expect(row.note).toMatch(/snaps|field/);
  });

  it('leaves the section out when nobody is down or flying', () => {
    const l = copy(template);
    at(l, 'regular', 3);
    for (const p of ours(l)) p.morale = { level: 0, jolts: [] };
    deliverMail(l);
    expect(section(reports(l)[0], 'Morale')).toBeUndefined();
  });

  it('puts the section after the captains and before the mentoring', () => {
    const l = copy(template);
    at(l, 'preseason');
    nameCaptains(l);
    moody(l);
    deliverMail(l);
    const titles = reports(l)[0].sections!.map((s) => s.title);
    expect(titles.indexOf('Morale')).toBeGreaterThan(titles.indexOf('Captains and leaders'));
    if (titles.includes('Mentoring')) expect(titles.indexOf('Morale')).toBeLessThan(titles.indexOf('Mentoring'));
  });
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
      p.morale = { level: 0, jolts: [] };
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
