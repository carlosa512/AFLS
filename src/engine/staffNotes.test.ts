import { describe, expect, it } from 'vitest';
import { adviceKey, updateCoachAdvice } from './coachDecisions';
import { releaseCoach, ROOM_LABEL, teamCoaches } from './coaching';
import { createLeague } from './generate';
import { deliverMail, mailSubject } from './inbox';
import { moraleClock } from './morale';
import { activeRoster, teamPlayers } from './roster';
import { UNITS, unitOf, type Unit, type UnitWord } from './standing';
import { staffRows, unitTurnFor } from './staffNotes';
import { storiesStep } from './storiesStep';
import { toldKeys } from './voice';
import { TRADE_DEADLINE_WEEK } from './trade/rules';
import { ATTRIBUTES, type League } from './types';

const BANNED = /marble|\btraits?\b|z-score/i;
const template = createLeague({ seed: 'coach-story-tests' });
const copy = <T>(v: T): T => structuredClone(v);
const notes = (l: League) => l.inbox!.filter((m) => m.id.startsWith('staffNotes:'));
const matchups = (l: League) => l.inbox!.filter((m) => m.id.startsWith('matchup:'));

/** Our WR coach prefers a hard-working young receiver over a veteran a little ahead of him: a recommendation. */
function recommending() {
  const l = copy(template);
  l.phase = 'regular';
  const t = l.teams[l.userTeamId];
  const staff = teamCoaches(l, t.id);
  for (const coach of staff) coach.quirks = {};
  staff.find((c) => c.room === 'WR')!.quirks = { earnYourReps: 2 };
  const wr = teamPlayers(l, t.id).filter((p) => p.position === 'WR');
  for (const [i, p] of wr.entries()) for (const key of ATTRIBUTES) p.ratings[key] = i < 2 ? 16 : i < 4 ? 12 : 8;
  wr[2].traits.workEthic = 5;
  wr[3].traits.workEthic = 18;
  t.autoDepth = false;
  t.depthChart.WR = wr.map((p) => p.id);
  updateCoachAdvice(l, t, staff, teamPlayers(l, t.id));
  return { l, t };
}

describe('the staff-notes letter', () => {
  it("carries the week's depth-chart call, once, and the staff remember they said it", () => {
    const { l, t } = recommending();
    const a = t.coachAdvice!.at(-1)!;
    deliverMail(l);
    deliverMail(l);
    expect(notes(l)).toHaveLength(1);
    const [m] = notes(l);
    expect(mailSubject(m)).toEqual({ kind: 'staffNotes', season: l.season, week: l.week });
    expect(m.coachNoteKey).toBe(adviceKey(a, 'offer'));
    expect(a.noted?.offer).toBe(l.week);
    const rows = m.sections![0].rows;
    expect(rows.some((r) => r.playerId === a.playerId)).toBe(true);
    expect(m.body + rows.map((r) => r.cells.join(' ')).join(' ')).not.toMatch(BANNED);
  });

  it('leaves the opposition report to the opponent', () => {
    const { l } = recommending();
    deliverMail(l);
    for (const m of matchups(l)) {
      expect(m.coachNote).toBeUndefined();
      expect(m.body).not.toMatch(/recommends trying/);
    }
  });

  it('files in a week with a note even without a game, and not in a week without one', () => {
    const { l, t } = recommending();
    for (const g of l.games) if (g.week === l.week && (g.homeId === t.id || g.awayId === t.id)) g.week = 99;
    deliverMail(l);
    expect(notes(l)).toHaveLength(1);
    const quiet = copy(template);
    quiet.phase = 'regular';
    // A quiet room too: every mood level and nothing told about the rooms, so no position coach has news.
    for (const p of teamPlayers(quiet, quiet.userTeamId)) if (p.morale) p.morale = { level: 0 };
    for (const k of Object.keys(quiet.mailTold ?? {})) if (k.startsWith('unit:')) delete quiet.mailTold![k];
    deliverMail(quiet);
    expect(notes(quiet)).toHaveLength(0);
  });

  it("carries a coach's habit work, and the recap stays on the game", () => {
    const l = copy(template);
    l.phase = 'regular';
    const c = teamCoaches(l, l.userTeamId).find((x) => x.role === 'positionCoach')!;
    const p = teamPlayers(l, l.userTeamId)[5];
    c.teachingNote = {
      season: l.season,
      week: l.week,
      playerId: p.id,
      playerName: `${p.firstName} ${p.lastName}`,
      habit: 'peeks',
      coachName: `${c.firstName} ${c.lastName}`,
      receptive: true,
    };
    deliverMail(l);
    const [m] = notes(l);
    expect(m).toBeDefined();
    expect(m.sections![0].rows[0].note).toMatch(/peeks into the backfield|Peeks in the Backfield/i);
    expect(m.sections![0].rows[0].playerId).toBe(p.id);
    for (const r of l.inbox!.filter((x) => x.id.startsWith('recap:')))
      expect(r.body).not.toMatch(/focused coaching attention/);
  });

  it('tells a habit once, not every week the coach keeps at it', () => {
    const l = copy(template);
    l.phase = 'regular';
    const c = teamCoaches(l, l.userTeamId).find((x) => x.role === 'positionCoach')!;
    const p = teamPlayers(l, l.userTeamId)[5];
    const note = (week: number) => {
      c.teachingNote = {
        season: l.season,
        week,
        playerId: p.id,
        playerName: `${p.firstName} ${p.lastName}`,
        habit: 'peeks',
        coachName: `${c.firstName} ${c.lastName}`,
        receptive: true,
      };
    };
    note(l.week);
    deliverMail(l);
    l.week++;
    note(l.week);
    deliverMail(l);
    expect(notes(l)).toHaveLength(1);
  });
});

describe('staff notes: the position coach on his unit', () => {
  const men = (l: League, unit: Unit) =>
    activeRoster(l, l.userTeamId).filter((p) => unitOf(p.position) === unit && p.morale);
  const setUnit = (l: League, unit: Unit, level: number) =>
    men(l, unit).forEach((p) => {
      p.morale!.level = level;
      delete p.morale!.jolts;
    });
  const splitUnit = (l: League, unit: Unit) =>
    men(l, unit).forEach((p, i) => {
      p.morale!.level = i % 2 ? 2 : -2;
      delete p.morale!.jolts;
    });
  const told = (l: League, unit: Unit, word: UnitWord, ago: number) => {
    l.mailTold = { ...l.mailTold, [`unit:${moraleClock(l) + ago}:${l.userTeamId}:${unit}:${word}`]: 1 };
  };
  /** Week 6, every unit Okay and told Settled five steps ago. */
  const inSeason = () => {
    const l = copy(template);
    l.phase = 'regular';
    l.week = 6;
    for (const u of UNITS) {
      if (u === 'ST') continue;
      setUnit(l, u, 0);
      told(l, u, 'Settled', -5);
    }
    // This stretch's locker report is already in: the week is the staff notes' alone.
    const filed = { season: l.season, phase: 'regular' as const, week: 1, from: 'x', subject: '', body: '' };
    l.inbox = [
      ...(l.inbox ?? []),
      { ...filed, id: `locker:${l.season}:cutdown`, category: 'staff', read: true, actions: [] },
    ];
    return l;
  };
  const fireRoomCoach = (l: League, unit: Unit) => {
    const c = teamCoaches(l, l.userTeamId).find((x) => x.role === 'positionCoach' && x.room === unit);
    // Coaching moves open in the re-sign window: step into it to let him go, then back to the season.
    if (!c) return;
    l.phase = 'resign';
    releaseCoach(l, l.userTeamId, c.id);
    l.phase = 'regular';
  };

  it('the position coach writes when his unit turns Split', () => {
    const l = inSeason();
    splitUnit(l, 'WR');
    const turn = unitTurnFor(l, toldKeys(l))!;
    expect(turn.unit).toBe('WR');
    expect(turn.word).toBe('Split');
    expect(turn.key).toBe(`unit:${moraleClock(l)}:${l.userTeamId}:WR:Split`);
  });

  it('files it in the week’s notes, in his words, and remembers it', () => {
    const l = inSeason();
    splitUnit(l, 'WR');
    deliverMail(l);
    const m = notes(l).at(-1)!;
    const row = m.sections![0].rows.find((r) => r.cells[0] === ROOM_LABEL.WR)!;
    expect(row.note).toMatch(/\b(my|I|I'm)\b/i);
    expect(row.note).not.toMatch(BANNED);
    expect(m.covered).toContain(`unit:${moraleClock(l)}:${l.userTeamId}:WR:Split`);
  });

  it('says nothing about a unit told within three weeks', () => {
    const l = inSeason();
    told(l, 'WR', 'Split', -2);
    expect(unitTurnFor(l, toldKeys(l))).toBeNull();
  });

  it('ignores Settled to Restless', () => {
    const l = inSeason();
    setUnit(l, 'WR', -0.5); // Restless: below Okay's middle, above Poor
    expect(unitTurnFor(l, toldKeys(l))?.unit).not.toBe('WR');
  });

  it('no note when a room only goes from Settled to Tight: the report tells that', () => {
    const l = inSeason();
    setUnit(l, 'WR', 2);
    expect(unitTurnFor(l, toldKeys(l))?.unit).not.toBe('WR');
  });

  it('good news waits three weeks after the last word on any room; bad news does not', () => {
    const l = inSeason();
    told(l, 'WR', 'Split', -4);
    told(l, 'QB', 'Settled', -1);
    setUnit(l, 'WR', 0); // the receivers are back, but a room was told about last week
    expect(unitTurnFor(l, toldKeys(l))).toBeNull();
    splitUnit(l, 'OL'); // the line splitting is news this week all the same
    expect(unitTurnFor(l, toldKeys(l))?.unit).toBe('OL');
  });

  it('says nothing about a room nobody has reported on yet (a new GM, a new game)', () => {
    const l = inSeason();
    for (const k of Object.keys(l.mailTold ?? {})) if (k.startsWith('unit:')) delete l.mailTold![k];
    splitUnit(l, 'WR');
    expect(unitTurnFor(l, toldKeys(l))).toBeNull();
  });

  it('still writes on deadline day: that report leaves the rooms to him', () => {
    const l = inSeason();
    l.week = TRADE_DEADLINE_WEEK;
    splitUnit(l, 'WR');
    deliverMail(l);
    const report = l.inbox!.find((m) => m.id === `locker:${l.season}:deadline`)!;
    expect(report.sections?.find((s) => s.title === 'The room')).toBeUndefined();
    expect(notes(l).some((m) => m.sections?.some((s) => s.rows.some((r) => r.cells[0] === ROOM_LABEL.WR)))).toBe(true);
  });

  it("leaves a turn to the season's first report when it goes out the same day", () => {
    const l = inSeason();
    l.inbox = l.inbox!.filter((m) => m.id !== `locker:${l.season}:cutdown`);
    splitUnit(l, 'WR');
    deliverMail(l);
    const report = l.inbox!.find((m) => m.id === `locker:${l.season}:cutdown`)!;
    expect(report.sections!.find((s) => s.title === 'The room')!.rows.some((r) => r.cells[0] === ROOM_LABEL.WR)).toBe(
      true,
    );
    expect(notes(l).some((m) => m.sections?.some((s) => s.rows.some((r) => r.cells[0] === ROOM_LABEL.WR)))).toBe(false);
  });

  it('stays quiet when the room has no position coach', () => {
    const l = inSeason();
    splitUnit(l, 'WR');
    fireRoomCoach(l, 'WR');
    expect(unitTurnFor(l, toldKeys(l))?.unit).not.toBe('WR');
  });
});

describe('staff notes: chemistry (L3)', () => {
  it('tells a room turning out of sync in season, once, in the head coach’s own words', () => {
    const l = copy(template);
    l.phase = 'regular';
    l.week = 5;
    const line = activeRoster(l, l.userTeamId).filter((p) => unitOf(p.position) === 'OL');
    deliverMail(l);
    for (const p of line) p.morale = { level: -9, jolts: [] };
    l.week = 6;
    deliverMail(l);
    l.week = 7;
    deliverMail(l);
    const rows = notes(l)
      .flatMap((m) => m.sections ?? [])
      .flatMap((s) => s.rows)
      .filter((r) => /out of sync/i.test(r.note ?? ''));
    expect(rows).toHaveLength(1);
    expect(rows[0].cells[0]).toBe(ROOM_LABEL.OL);
    expect(rows[0].note).not.toMatch(/\d|chemistry/i);
  });
});

describe('staff rows for the weekly letter', () => {
  const men = (l: League, unit: Unit) =>
    activeRoster(l, l.userTeamId).filter((p) => unitOf(p.position) === unit && p.morale);
  const splitUnit = (l: League, unit: Unit) =>
    men(l, unit).forEach((p, i) => {
      p.morale!.level = i % 2 ? 2 : -2;
      delete p.morale!.jolts;
    });
  const inSeason = () => {
    const l = copy(template);
    l.phase = 'regular';
    l.week = 6;
    for (const u of UNITS) {
      if (u === 'ST') continue;
      men(l, u).forEach((p) => {
        p.morale!.level = 0;
        delete p.morale!.jolts;
      });
      l.mailTold = { ...l.mailTold, [`unit:${moraleClock(l) - 5}:${l.userTeamId}:${u}:Settled`]: 1 };
    }
    return l;
  };

  it('one row a room: chemistry rides in the position coach’s note', () => {
    const l = inSeason();
    splitUnit(l, 'WR');
    l.mailTold = { ...l.mailTold, [`chem:${moraleClock(l) - 5}:${l.userTeamId}:WR:Out of sync`]: 1 };
    const { rooms, covered } = staffRows(l, toldKeys(l));
    const chemNotes = covered.filter((k) => k.startsWith('chem:')).length;
    const wr = rooms.filter((r) => r.cells[0] === ROOM_LABEL.WR);
    expect(wr).toHaveLength(1);
    expect(wr[0].coachId).toBeDefined();
    expect(wr[0].note).toBeTruthy();
    // The room was told Out of sync before, so its chemistry now is news: a clause in the same note.
    expect(chemNotes).toBeGreaterThan(0);
    expect(covered).toContain(`unit:${moraleClock(l)}:${l.userTeamId}:WR:Split`);
    expect(rooms.map((r) => r.note).join(' ')).not.toMatch(/shrug|\d/i);
  });

  it('a room is not told the week it turns', () => {
    const l = inSeason();
    splitUnit(l, 'WR');
    // The league's step has run to this week's clock (the template's is from week one).
    l.moraleAt = moraleClock(l);
    storiesStep(l);
    const story = l.stories!.open.find((s) => s.kind === 'room' && s.unit === 'WR')!;
    expect(story.beats.at(-1)!.kind).toBe('turned');
    expect(staffRows(l, toldKeys(l)).rooms.filter((r) => r.cells[0] === ROOM_LABEL.WR)).toHaveLength(0);
    // A step later it still stands, and the coach tells it.
    for (const b of story.beats) b.at -= 1;
    expect(staffRows(l, toldKeys(l)).rooms.filter((r) => r.cells[0] === ROOM_LABEL.WR)).toHaveLength(1);
  });

  it('holds the rooms back on a report’s day, and carries the depth-chart call with its key', () => {
    const { l, t } = recommending();
    const a = t.coachAdvice!.at(-1)!;
    splitUnit(l, 'WR');
    const held = staffRows(l, toldKeys(l), true);
    expect(held.rooms).toHaveLength(0);
    expect(held.staff.some((r) => r.playerId === a.playerId)).toBe(true);
    expect(held.coachNote?.coachNoteKey).toBe(adviceKey(a, 'offer'));
  });
});
