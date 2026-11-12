/**
 * The staff's notes for the week: a coach's call on the depth chart and his follow-ups on it, a coach working on a
 * player's bad habit, and the position coaches' words on their rooms. `staffRows` gives them as rows of the head
 * coach's weekly letter (`coachWeek.ts`), each signed by the coach who made it; the recommendation's `coachNoteKey`
 * is how the staff remember what they've told you.
 */
import { coachAdviceObservation, teachingNoteFor } from './coachReports';
import { COACH_ROLE_LABEL, coachName, coachTitle, ROOM_LABEL, teamCoaches } from './coaching';
import { moraleClock, moraleContext, viewContext } from './morale';
import { meetingStaffRows } from './meetings/mail';
import { beliefFact, beliefWarnKey, chemFact, chemKey, lastTold, unitFact, unitKey } from './roomFacts';
import { CHEM_ROOMS, chemistryOf, type ChemRoom } from './chemistry';
import type { StaffRow } from './meetings/mail';
import { BELIEF_WARN, CHEM_NOTE, UNIT_TURN, type UnitFact } from './roomVoice';
import { roomView, type Unit, type UnitView, type UnitWord } from './standing';
import { QUIRKS, type QuirkId } from './quirks';
import { headCoach } from './senders';
import type { CoachRoom, InboxMessage, League, MailSection } from './types';
import { openStory } from './stories';
import { tellable } from './storiesStep';
import { say, seasonSaid, wording, type Line } from './voice';

interface HabitFact {
  coach: string;
  player: string;
  habit: QuirkId;
  receptive: boolean;
}

/** A coach working on a player's bad habit, in the staff's words: what the habit does, and whether it's sticking. */
const HABIT: readonly Line<HabitFact>[] = [
  {
    when: (f) => f.receptive,
    reads: 1,
    text: (f) =>
      `${f.coach} has ${f.player} working on it in practice, because he ${QUIRKS[f.habit].clause}. He's taking to the work, and it should stick.`,
  },
  {
    when: (f) => f.receptive,
    reads: 1,
    text: (f) =>
      `${f.coach} is fixing ${f.player}'s "${QUIRKS[f.habit].label}", because he ${QUIRKS[f.habit].clause}. He learns quickly, and we'll see it soon.`,
  },
  {
    when: (f) => !f.receptive,
    reads: 1,
    text: (f) =>
      `${f.coach} is working with ${f.player} on an old habit, because he ${QUIRKS[f.habit].clause}. It'll take time.`,
  },
  {
    when: (f) => !f.receptive,
    reads: 1,
    text: (f) =>
      `${f.coach} has a long job with ${f.player}, because he ${QUIRKS[f.habit].clause}. It won't be gone by Sunday.`,
  },
  {
    when: (f) => f.receptive,
    reads: 1,
    text: (f) =>
      `${f.coach} works on ${f.player}'s habit every day, because he ${QUIRKS[f.habit].clause}. He is taking to the work.`,
  },
  {
    when: (f) => f.receptive,
    reads: 1,
    text: (f) =>
      `${f.player} is putting the work in with ${f.coach}, because he ${QUIRKS[f.habit].clause}. That is a good sign.`,
  },
  {
    when: (f) => !f.receptive,
    reads: 1,
    text: (f) =>
      `${f.coach} keeps working with ${f.player}, because he ${QUIRKS[f.habit].clause}. It has not changed yet.`,
  },
  {
    when: (f) => !f.receptive,
    reads: 1,
    text: (f) => `${f.player} still ${QUIRKS[f.habit].clause}, and ${f.coach} is the one who has to break it.`,
  },
];

// ───────── the position coach on his unit (L1) ─────────

/** Steps on morale's clock before a unit is told about again, by a note or a report. */
export const NOTE_GAP = 3;

/**
 * This week's turn in one of your rooms, if any, for the coach of that room to tell: a unit gone Split or Down
 * since it was last told, or back from Split or Down. Measured against what was last told by a report or an earlier
 * note, so the two never repeat each other; never a unit told in the last three weeks, never a room with no coach,
 * and good news only when no room has been told about for three weeks. One a week: Split, then Down, then a recovery.
 */
export function unitTurnFor(
  league: League,
  told: Set<string>,
): { unit: Unit; word: UnitWord; coachId: number; key: string; fact: UnitFact } | null {
  const clock = moraleClock(league);
  const memory = lastTold(told, league.userTeamId);
  // A letter builds its own context: it never reads a screen's cache.
  const ctx = moraleContext(league);
  const staff = teamCoaches(league, league.userTeamId);
  // Good news waits until no room has been told about for three weeks: the inbox isn't a weekly mood ticker.
  const lastWord = Math.max(-Infinity, ...[...memory.units.values()].map((u) => u.clock));
  const goodNewsOpen = clock - lastWord >= NOTE_GAP;
  let best: { rank: number; view: UnitView; last: { word: UnitWord } | null; coachId: number } | null = null;
  for (const view of roomView(league, ctx).units) {
    const last = memory.units.get(view.unit) ?? null;
    // A turn is against what was told: a room nobody has reported on yet (a new GM, a new game) has none.
    if (!last || clock - last.clock < NOTE_GAP || last.word === view.word) continue;
    // A room back from Split or Down (Tight or not); a room only going Tight from Settled is the report's to tell.
    const recovered = !!last && (last.word === 'Split' || last.word === 'Down');
    const rank = view.word === 'Split' ? 0 : view.word === 'Down' ? 1 : recovered && goodNewsOpen ? 2 : -1;
    if (rank < 0 || (best && best.rank <= rank)) continue;
    const coach = staff.find((c) => c.role === 'positionCoach' && c.room === view.unit);
    if (coach) best = { rank, view, last, coachId: coach.id };
  }
  if (!best) return null;
  const { view } = best;
  return {
    unit: view.unit,
    word: view.word,
    coachId: best.coachId,
    key: unitKey(clock, league.userTeamId, view.unit, view.word),
    fact: unitFact(league, view, best.last, null, ctx),
  };
}

/**
 * Chemistry in season (L3): a room of ours turning Clicking or Out of sync, or coming back from Out of sync, since it
 * was last told; once each, in the head coach's own words. Gelling and still learning each other wait for the report.
 */
export function chemistryRows(league: League, told: Set<string>): StaffRow[] {
  return chemistryNotes(league, told).map(({ key, unit, note }) => ({ key, label: ROOM_LABEL[unit], note }));
}

/** The same notes with their room, worded around `said` when a builder keeps one. */
function chemistryNotes(
  league: League,
  told: Set<string>,
  said?: string[],
): { key: string; unit: CoachRoom; note: string }[] {
  const user = league.userTeamId;
  const memory = lastTold(told, user);
  const clock = moraleClock(league);
  const ctx = viewContext(league);
  const rows: { key: string; unit: CoachRoom; note: string }[] = [];
  for (const unit of CHEM_ROOMS) {
    const c = chemistryOf(league, user, unit);
    if (!c) continue;
    const last = memory.chem.get(unit)?.word;
    const news = c.word === 'Clicking' || c.word === 'Out of sync' || last === 'Out of sync';
    if (last === c.word || !news) continue;
    const key = chemKey(clock, user, unit, c.word);
    const note = say(CHEM_NOTE, chemFact(league, c, ctx), {
      key,
      slot: 'chem',
      ...wording(league, headCoach(league).from, said),
    });
    said?.push(note);
    rows.push({ key, unit, note });
  }
  return rows;
}

/**
 * The position coach's warning (L4): one of his rooms fell past the warning line on whoever runs its side after a bad
 * game this step (`Team.beliefFell`), before it reads in doubt; once each fall, in his words.
 */
export function beliefRows(
  league: League,
  told: Set<string>,
  said?: string[],
): { key: string; unit: CoachRoom; coachId: number; note: string }[] {
  const team = league.teams[league.userTeamId];
  const fell = team.beliefFell;
  const clock = moraleClock(league);
  if (!fell || fell.clock !== clock) return [];
  const ctx = moraleContext(league);
  const staff = teamCoaches(league, league.userTeamId);
  const out: { key: string; unit: CoachRoom; coachId: number; note: string }[] = [];
  for (const unit of fell.rooms) {
    const key = beliefWarnKey(clock, league.userTeamId, unit);
    if (told.has(key)) continue;
    const coach = staff.find((c) => c.role === 'positionCoach' && c.room === unit);
    const fact = beliefFact(league, league.userTeamId, unit, ctx);
    // Already past the warning into doubt: that's the head coach's to tell (a meeting, the report).
    if (!coach || !fact || fact.read !== 'steady') continue;
    out.push({
      key,
      unit,
      coachId: coach.id,
      note: say(BELIEF_WARN, fact, { key, slot: 'belief', ...wording(league, headCoach(league).from, said) }),
    });
    if (said) said.push(out.at(-1)!.note);
  }
  return out;
}

// ───────── the weekly letter's staff rows ─────────

type RoomRow = MailSection['rows'][number];

/**
 * What the staff add to the weekly letter, as rows: the rooms (one row a room: the position coach's turn or warning
 * with chemistry as a clause in the same note, the head coach's own row only for a room with no position coach's
 * row; a room that has a story must have held its turn long enough to be `tellable`), and the staff room (the
 * depth-chart call, habit work and the head coach's word with the players). `covered` holds the keys they tell, and
 * `coachNote` the recommendation's key for `coachDecisions.ts`. Every sentence goes around what the head coach has
 * already said this league year. `leaveRooms` holds the rooms back on the day a locker room report tells them.
 */
export function staffRows(
  league: League,
  told: Set<string>,
  { leaveRooms = false }: { leaveRooms?: boolean } = {},
): {
  rooms: MailSection['rows'];
  staff: MailSection['rows'];
  covered: string[];
  /** Each rooms row's unit and the keys it tells, in row order (the editor keeps them with the row). */
  roomMeta: { unit: CoachRoom; keys: string[] }[];
  /** The keys each staff row tells, in row order (the depth-chart call tells none: its note key rides on the letter). */
  staffKeys: string[][];
  coachNote?: Pick<InboxMessage, 'coachNoteKey' | 'coachNote'>;
} {
  const sender = headCoach(league);
  const said = seasonSaid(league, sender.from, 'coach:');
  const clock = moraleClock(league);
  const key = `staffRows:${league.season}:${clock}`;
  const covered: string[] = [];
  const staff: RoomRow[] = [];
  const staffKeys: string[][] = [];
  const name = (playerId: number) => {
    const p = league.players[playerId];
    return p ? `${p.firstName} ${p.lastName}` : '';
  };
  const chair = (coachId: number) => {
    const c = league.coaches[coachId];
    return c ? COACH_ROLE_LABEL[c.role] : 'Coach';
  };

  // The staff room: a call on the depth chart, habit work.
  const call = coachAdviceObservation(league);
  if (call) {
    staff.push({
      playerId: call.playerId,
      cells: [name(call.playerId), `${call.coachName}, ${chair(call.coachId)}`],
      note: call.text,
    });
    staffKeys.push([]);
  }
  const found = teachingNoteFor(league);
  const habitKey = found && `teach:${league.season}:${found.coachId}:${found.playerId}:${found.habit}`;
  if (found && !told.has(habitKey!)) {
    const note = say(
      HABIT,
      {
        coach: league.coaches[found.coachId]?.lastName ?? found.coachName,
        player: league.players[found.playerId]?.lastName ?? '',
        habit: found.habit,
        receptive: found.receptive,
      },
      { key, slot: 'habit', ...wording(league, sender.from, said) },
    );
    said.push(note);
    covered.push(habitKey!);
    staffKeys.push([habitKey!]);
    staff.push({
      playerId: found.playerId,
      cells: [name(found.playerId), `${found.coachName}, ${chair(found.coachId)}`],
      note,
    });
  }
  // His word with the players has no story to hang on: it comes with the staff's notes.
  for (const r of meetingStaffRows(league, told, said)) {
    covered.push(r.key);
    staffKeys.push([r.key]);
    staff.push({ cells: [r.label, sender.from], note: r.note });
  }

  // The rooms: the position coach's turn and warning, then chemistry in the same note.
  const rooms = new Map<CoachRoom, { cells: string[]; coachId?: number; notes: string[]; keys: string[] }>();
  const room = (unit: CoachRoom, coachId: number) => {
    const c = league.coaches[coachId];
    const row = rooms.get(unit) ?? {
      cells: [ROOM_LABEL[unit], `${coachName(c)}, ${coachTitle(c)}`],
      coachId,
      notes: [],
      keys: [],
    };
    rooms.set(unit, row);
    return row;
  };
  if (!leaveRooms) {
    // A room told about by anything (a turn, its chemistry, its coach's belief) in the last few steps is left alone:
    // what it has to say waits its turn, and a room never comes up twice in the same fortnight.
    const memory = lastTold(told, league.userTeamId);
    const now = moraleClock(league);
    const warned = new Map<string, number>();
    for (const k of told) {
      const w = k.match(/^belief-warn:(\d+):(\d+):(\w+)$/);
      if (w && Number(w[2]) === league.userTeamId)
        warned.set(w[3], Math.max(warned.get(w[3]) ?? -Infinity, Number(w[1])));
    }
    const rested = (unit: Unit) =>
      [
        memory.units.get(unit)?.clock,
        memory.chem.get(unit as ChemRoom)?.clock,
        memory.belief.get(unit as CoachRoom)?.clock,
        warned.get(unit),
      ].some((c) => c !== undefined && now - c < NOTE_GAP);
    const turn = unitTurnFor(league, told);
    const story = turn && openStory(league, { kind: 'room', teamId: league.userTeamId, unit: turn.unit as CoachRoom });
    // A room's turn must have stood: the week it turns is too soon to tell.
    if (turn && !rested(turn.unit) && (!story || tellable(league, story, clock))) {
      const note = say(UNIT_TURN, turn.fact, { key, slot: `unit:${turn.unit}`, ...wording(league, sender.from, said) });
      said.push(note);
      covered.push(turn.key);
      const row = room(turn.unit as CoachRoom, turn.coachId);
      row.notes.push(note);
      row.keys.push(turn.key);
    }
    for (const w of beliefRows(league, told, said)) {
      if (rested(w.unit) && !rooms.has(w.unit)) continue;
      covered.push(w.key);
      const row = room(w.unit, w.coachId);
      row.notes.push(w.note);
      row.keys.push(w.key);
    }
    for (const c of chemistryNotes(league, told, said)) {
      if (rested(c.unit) && !rooms.has(c.unit)) continue;
      covered.push(c.key);
      // The room's row is signed by its position coach when the club has one, the head coach when it has none.
      const pc = teamCoaches(league, league.userTeamId).find((x) => x.role === 'positionCoach' && x.room === c.unit);
      const own = rooms.get(c.unit) ?? (pc ? room(c.unit, pc.id) : undefined);
      if (own) {
        own.notes.push(c.note);
        own.keys.push(c.key);
      } else rooms.set(c.unit, { cells: [ROOM_LABEL[c.unit], sender.from], notes: [c.note], keys: [c.key] });
    }
  }
  return {
    rooms: [...rooms.values()].map((r) => ({
      cells: r.cells,
      note: r.notes.join(' '),
      ...(r.coachId !== undefined ? { coachId: r.coachId } : {}),
    })),
    roomMeta: [...rooms].map(([unit, r]) => ({ unit, keys: r.keys })),
    staff,
    staffKeys,
    covered,
    ...(call
      ? {
          coachNote: {
            coachNoteKey: call.key,
            coachNote: { coachId: call.coachId, coachName: call.coachName, text: call.text, kind: call.kind },
          },
        }
      : {}),
  };
}
