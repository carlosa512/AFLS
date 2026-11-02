import { describe, expect, it } from 'vitest';
import { createLeague } from './generate';
import { deliverMail, mailSubject } from './inbox';
import { dueCheckin } from './lockerReport';
import { moraleClock, moraleView } from './morale';
import { ROOM_LABEL } from './coaching';
import { leadersOf, unitOf, voicesOf, type Unit } from './standing';
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

  it("tells what a man's mood is costing him once he's Very poor or worse", () => {
    const l = copy(template);
    at(l, 'regular', 3);
    const [poor, worse] = moody(l);
    deliverMail(l);
    const rows = section(reports(l)[0], 'Morale')!.rows;
    expect(rows.find((r) => r.playerId === worse.id)!.note).toMatch(/practice|game day|his work/);
    expect(rows.find((r) => r.playerId === poor.id)!.note).not.toMatch(/practice|game day|his work/);
  });

  it('tells what it costs him when a broken promise is what weighs on him', () => {
    const l = copy(template);
    at(l, 'regular', 3);
    const [, worse] = moody(l);
    worse.morale = { level: -5, jolts: [{ kind: 'broken', size: -4, at: l.moraleAt! }] };
    deliverMail(l);
    const row = section(reports(l)[0], 'Morale')!.rows.find((r) => r.playerId === worse.id)!;
    expect(row.note).toMatch(/practice|game day|his work/);
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

  it('tells a kept promise too, though he is neither down nor flying', () => {
    const l = copy(template);
    for (const p of ours(l)) p.morale = { level: 0 };
    at(l, 'regular', 3);
    const p = ours(l)[3];
    p.morale = { level: 0, jolts: [{ kind: 'kept', size: 2, at: l.moraleAt! }] };
    deliverMail(l);
    const row = section(reports(l)[0], 'Morale')?.rows.find((r) => r.playerId === p.id);
    expect(row?.cells).toContain('Promise kept');
  });

  it('tells a broken promise once, in the next report', () => {
    const l = copy(template);
    for (const p of ours(l)) p.morale = { level: 0 };
    at(l, 'regular', 3);
    const p = ours(l)[2];
    p.morale = { level: 0, jolts: [{ kind: 'broken', size: -4, at: l.moraleAt! }] };
    deliverMail(l);
    const rows = section(reports(l)[0], 'Morale')!.rows.filter((r) => r.playerId === p.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].note).toMatch(/waiting|word/);
    expect(rows[0].note).not.toMatch(/\d/);
    at(l, 'regular', TRADE_DEADLINE_WEEK);
    deliverMail(l);
    const later = reports(l).find((m) => m.id.endsWith(':deadline'))!;
    expect(section(later, 'Morale')?.rows.some((r) => r.playerId === p.id) ?? false).toBe(false);
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
    expect(titles.indexOf('Morale')).toBeGreaterThan(titles.indexOf('Who the room follows'));
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
    const rows = section(camp, 'Who the room follows')!.rows;
    expect(rows.slice(0, 3).map((r) => r.playerId)).toEqual([c.offense, c.defense, c.specialTeams]);
    expect(camp.covered).toContain(`captains:${l.season}`);
    at(l, 'regular', 1);
    deliverMail(l);
    expect(section(reports(l)[1], 'Who the room follows')).toBeUndefined();
  });

  it('a quiet check-in still files, with only its verdict', () => {
    const l = copy(template);
    for (const p of ours(l)) {
      delete p.mentor;
      delete p.ties;
      p.morale = { level: 0, jolts: [] };
    }
    // Nothing told about the rooms either, so no room is coming back from anything.
    for (const k of Object.keys(l.mailTold ?? {})) if (k.startsWith('unit:')) delete l.mailTold![k];
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
    expect(section(m, 'Who the room follows')).toBeDefined();
    at(l, 'regular', TRADE_DEADLINE_WEEK);
    deliverMail(l);
    expect(section(reports(l).at(-1)!, 'Who the room follows')).toBeUndefined();
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

describe('the locker room report: the room', () => {
  /** The unit's men alternately up and down, no jolts: a Split read. */
  const splitUnit = (l: League, unit: Unit) =>
    ours(l)
      .filter((p) => unitOf(p.position) === unit && p.morale)
      .forEach((p, i) => {
        p.morale!.level = i % 2 ? 2 : -2;
        delete p.morale!.jolts;
      });
  const camp = () => {
    const l = copy(template);
    at(l, 'preseason');
    nameCaptains(l);
    return l;
  };

  it('a first report tells only Split and Down units, and no standing changes', () => {
    const l = camp();
    deliverMail(l);
    const m = reports(l).at(-1)!;
    for (const r of section(m, 'The room')?.rows ?? []) expect(['Split', 'Down']).toContain(r.cells[1]);
    expect(
      section(m, 'Who the room follows')!.rows.some((r) => /Found his voice|Now a leader|Quieter now/.test(r.cells[1])),
    ).toBe(false);
  });

  it('stamps every leader, voice and read unit', () => {
    const l = camp();
    deliverMail(l);
    const m = reports(l).at(-1)!;
    expect(m.covered!.some((k) => /^unit:\d+:(QB|RB|WR|OL|DL|LB|DB):\w+$/.test(k))).toBe(true);
    expect(m.covered!.some((k) => /^standing:\d+:\d+:(leader|voice)$/.test(k))).toBe(true);
  });

  it('tells a split unit, and reads "still" when it is still split at the next report', () => {
    const l = camp();
    splitUnit(l, 'WR');
    deliverMail(l);
    const first = section(reports(l).at(-1)!, 'The room')!.rows.find((r) => r.cells[0] === ROOM_LABEL.WR)!;
    expect(first.cells[1]).toBe('Split');
    expect(first.note).not.toMatch(/still/i);
    at(l, 'regular', 1);
    splitUnit(l, 'WR');
    deliverMail(l);
    const again = section(reports(l).at(-1)!, 'The room')!.rows.find((r) => r.cells[0] === ROOM_LABEL.WR)!;
    expect(again.note).toMatch(/still/i);
  });

  it('lists a captain once, as captain, even when his place in the room changed', () => {
    const l = camp();
    const c = l.teams[l.userTeamId].captains!;
    l.mailTold = { ...l.mailTold, [`standing:${moraleClock(l) - 1}:${c.offense}:voice`]: 1 };
    deliverMail(l);
    const rows = section(reports(l).at(-1)!, 'Who the room follows')!.rows;
    expect(rows.filter((r) => r.playerId === c.offense)).toHaveLength(1);
  });

  it('leaves out a unit that only cooled from Tight to Settled', () => {
    const l = camp();
    // Only this memory of the line: the template filed reads of its own.
    for (const k of Object.keys(l.mailTold ?? {})) if (k.startsWith('unit:')) delete l.mailTold![k];
    l.mailTold = { ...l.mailTold, [`unit:${moraleClock(l) - 1}:OL:Tight`]: 1 };
    for (const p of ours(l).filter((x) => unitOf(x.position) === 'OL' && x.morale)) {
      p.morale!.level = 0;
      delete p.morale!.jolts;
    }
    deliverMail(l);
    const rows = section(reports(l).at(-1)!, 'The room')?.rows ?? [];
    expect(rows.find((r) => r.cells[0] === ROOM_LABEL.OL)).toBeUndefined();
  });

  it('a leader on injured reserve has not left', () => {
    const l = camp();
    deliverMail(l);
    const inDb = (x: Player) => unitOf(x.position) === 'DB';
    const p = leadersOf(l, l.userTeamId).find(inDb) ?? voicesOf(l, l.userTeamId).find(inDb)!;
    p.ir = { season: l.season, week: 1, weeks: 0 };
    at(l, 'regular', 1);
    deliverMail(l);
    expect(text(reports(l).at(-1)!)).not.toMatch(new RegExp(`since ${p.lastName} left`));
  });

  it('a leader who left the club is told as gone when his unit has no voice', () => {
    const l = camp();
    deliverMail(l);
    const room = ours(l).filter((x) => unitOf(x.position) === 'DB');
    const lead = leadersOf(l, l.userTeamId).find((x) => unitOf(x.position) === 'DB') ?? room[0];
    // Stamp him as a leader at the last report, then make the rest of the room quiet and let him go.
    l.mailTold = { ...l.mailTold, [`standing:${moraleClock(l)}:${lead.id}:leader`]: 1 };
    for (const x of room) x.traits.leads = 1;
    lead.teamId = null;
    const c = l.teams[l.userTeamId].captains!;
    if (c.defense === lead.id || room.some((x) => x.id === c.defense)) c.defense = -1;
    for (const x of room.filter((y) => y.id !== lead.id)) {
      x.morale!.level = -4;
      delete x.morale!.jolts;
    }
    at(l, 'regular', 1);
    deliverMail(l);
    expect(text(reports(l).at(-1)!)).toMatch(new RegExp(`since ${lead.lastName} left`));
  });
});
