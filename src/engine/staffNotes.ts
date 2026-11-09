/**
 * The staff's notes for the week, in a letter of their own: a coach's call on the depth chart and his follow-ups on
 * it, and a coach working on a player's bad habit. They used to ride inside the recap and the opposition report,
 * which are about the game; here each note is signed by the coach who made it. One letter a week, only when there's
 * a note. It carries the recommendation's `coachNoteKey`, which is how the staff remember what they've told you.
 */
import { coachAdviceObservation, teachingNoteFor } from './coachReports';
import { COACH_ROLE_LABEL, coachName, coachTitle, ROOM_LABEL, teamCoaches } from './coaching';
import { moraleClock, moraleContext, viewContext } from './morale';
import { reportTellsRooms } from './lockerReport';
import { meetingStaffRows } from './meetings/mail';
import { beliefFact, beliefWarnKey, chemFact, chemKey, lastTold, unitFact, unitKey } from './roomFacts';
import { CHEM_ROOMS, chemistryOf } from './chemistry';
import type { StaffRow } from './meetings/mail';
import { BELIEF_WARN, CHEM_NOTE, UNIT_PHRASE, UNIT_TURN, type UnitFact } from './roomVoice';
import { roomView, type Unit, type UnitView, type UnitWord } from './standing';
import { QUIRKS, type QuirkId } from './quirks';
import { headCoach, type Draft } from './senders';
import type { CoachRoom, InboxAction, InboxMessage, League, MailSection } from './types';
import { openStory } from './stories';
import { tellable } from './storiesStep';
import { recentBodies, say, seasonSaid, toldKeys, wording, type Line } from './voice';

const OPENER: readonly Line<{ calls: number; habits: number; units: number }>[] = [
  {
    when: (f) => f.units > 0 && (f.calls > 0 || f.habits > 0),
    reads: 2,
    text: () => 'A few notes from the staff room this week, one of them on how a room is feeling.',
  },
  {
    when: (f) => f.units > 0 && f.calls === 0 && f.habits === 0,
    reads: 1,
    text: () => 'One of my position coaches has a read on his room this week.',
  },
  {
    when: (f) => f.units > 0 && f.calls === 0 && f.habits === 0,
    reads: 1,
    text: () => 'A word from one of my position coaches on his guys.',
  },
  {
    when: (f) => f.units > 0 && f.calls === 0 && f.habits === 0,
    reads: 1,
    text: () => 'My position coaches keep me posted on their rooms. This came up.',
  },
  {
    when: (f) => f.units > 0 && f.calls === 0 && f.habits === 0,
    reads: 1,
    text: () => "Passing on something from the position coaches' room.",
  },
  {
    when: (f) => f.calls > 0 && f.habits > 0,
    reads: 2,
    text: () => 'Two things from the staff room this week: a call on the depth chart, and some habit work.',
  },
  { when: (f) => f.calls > 0, reads: 1, text: () => 'A call from the staff room on the depth chart. Your decision.' },
  { when: (f) => f.calls > 0, reads: 1, text: () => 'One of my guys has a depth-chart call for you this week.' },
  { when: (f) => f.habits > 0, reads: 1, text: () => "What we're working on in practice this week." },
  { when: (f) => f.habits > 0, reads: 1, text: () => 'A note from practice: one of my coaches has a project.' },
  { text: () => 'From the staff room this week.' },
];

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
      `${f.coach} has ${f.player} on it in practice: he ${QUIRKS[f.habit].clause}. He's taking to the work; it should stick.`,
  },
  {
    when: (f) => f.receptive,
    reads: 1,
    text: (f) =>
      `${f.coach} is fixing ${f.player}'s "${QUIRKS[f.habit].label}": he ${QUIRKS[f.habit].clause}. Good student. We'll see it soon.`,
  },
  {
    when: (f) => !f.receptive,
    reads: 1,
    text: (f) =>
      `${f.coach} is working with ${f.player} on it: he ${QUIRKS[f.habit].clause}. Old habit. It'll take time.`,
  },
  {
    when: (f) => !f.receptive,
    reads: 1,
    text: (f) =>
      `${f.coach} has a project in ${f.player}: he ${QUIRKS[f.habit].clause}. Don't expect it gone by Sunday.`,
  },
];

export function staffNotesMail(league: League, have: Set<string>): Draft[] {
  if (league.phase !== 'regular' && league.phase !== 'playoffs') return [];
  const id = `staffNotes:${league.season}:${league.week}`;
  if (have.has(id)) return [];
  const call = coachAdviceObservation(league);
  // A coach keeps at a habit for weeks: tell it once (`covered`), not every week he's still on it.
  const told = toldKeys(league);
  const found = teachingNoteFor(league);
  const habitKey = found && `teach:${league.season}:${found.coachId}:${found.playerId}:${found.habit}`;
  const habit = found && !told.has(habitKey!) ? found : undefined;
  // In season the rooms are the position coaches' to tell, except on the day the season's first report tells them.
  const unitNote = reportTellsRooms(league, have) ? null : unitTurnFor(league, told);
  // The head coach's own rows (L2): a commitment coming due, and his word with the room when it has moved.
  const own = [
    ...meetingStaffRows(league, told),
    ...(reportTellsRooms(league, have) ? [] : chemistryRows(league, told)),
  ];
  const warns = reportTellsRooms(league, have) ? [] : beliefRows(league, told);
  if (!call && !habit && !unitNote && !own.length && !warns.length) return [];
  const chair = (coachId: number) => {
    const c = league.coaches[coachId];
    return c ? COACH_ROLE_LABEL[c.role] : 'Coach';
  };
  const name = (playerId: number) => {
    const p = league.players[playerId];
    return p ? `${p.firstName} ${p.lastName}` : '';
  };
  const rows: MailSection['rows'] = [];
  if (call)
    rows.push({
      playerId: call.playerId,
      cells: [name(call.playerId), `${call.coachName}, ${chair(call.coachId)}`],
      note: call.text,
    });
  if (habit)
    rows.push({
      playerId: habit.playerId,
      cells: [name(habit.playerId), `${habit.coachName}, ${chair(habit.coachId)}`],
      note: say(
        HABIT,
        {
          coach: league.coaches[habit.coachId]?.lastName ?? habit.coachName,
          player: league.players[habit.playerId]?.lastName ?? '',
          habit: habit.habit,
          receptive: habit.receptive,
        },
        { key: id, slot: 'habit', recent: recentBodies(league, headCoach(league).from) },
      ),
    });
  if (unitNote) {
    const c = league.coaches[unitNote.coachId];
    rows.push({
      cells: [ROOM_LABEL[unitNote.unit as CoachRoom], `${coachName(c)}, ${coachTitle(c)}`],
      note: say(UNIT_TURN, unitNote.fact, {
        key: id,
        slot: `unit:${unitNote.unit}`,
        recent: recentBodies(league, headCoach(league).from),
      }),
    });
  }
  for (const w of warns) {
    const c = league.coaches[w.coachId];
    rows.push({ cells: [ROOM_LABEL[w.unit], `${coachName(c)}, ${coachTitle(c)}`], note: w.note });
  }
  const sender = headCoach(league);
  for (const r of own)
    rows.push({
      ...(r.playerId !== undefined ? { playerId: r.playerId } : {}),
      cells: [r.label, `${sender.from}`],
      note: r.note,
      ...(r.negotiate !== undefined ? { negotiate: { playerId: r.negotiate } } : {}),
    });
  const covered = [
    ...(habit ? [habitKey!] : []),
    ...(unitNote ? [unitNote.key] : []),
    ...warns.map((w) => w.key),
    ...own.map((r) => r.key),
  ];
  const actions: InboxAction[] = [
    ...rows.flatMap((r) => (r.playerId === undefined ? [] : [{ kind: 'player' as const, playerId: r.playerId }])),
    { kind: 'team', teamId: league.userTeamId },
  ];
  return [
    {
      id,
      season: league.season,
      phase: league.phase,
      week: league.week,
      ...sender,
      category: 'staff',
      subject:
        own.length && !unitNote && !call && !habit && !warns.length
          ? // His word alone says what it's about; "the room" alone left a reader guessing.
            own.every((r) => r.key.startsWith('cred:'))
            ? 'From me: my word with the players'
            : 'From me: a word on the room'
          : unitNote && !call && !habit
            ? `From the staff: ${UNIT_PHRASE[unitNote.unit as CoachRoom]}`
            : warns.length && !call && !habit && !unitNote
              ? `From the staff: ${UNIT_PHRASE[warns[0].unit]}`
              : call && habit
                ? 'From the staff: a depth-chart call and habit work'
                : call
                  ? `From the staff: ${name(call.playerId)}`
                  : `From the staff: working on ${name(habit!.playerId)}`,
      body:
        own.length && !unitNote && !call && !habit && !warns.length
          ? own.length === 1
            ? 'One thing from me this week.'
            : own.length === 2
              ? 'Two things from me this week.'
              : 'A few things from me this week.'
          : say(
              OPENER,
              { calls: call ? 1 : 0, habits: habit ? 1 : 0, units: (unitNote ? 1 : 0) + warns.length },
              { key: id, slot: 'opener', recent: recentBodies(league, sender.from) },
            ),
      sections: [{ title: 'From the staff', columns: ['Player', 'Coach'], rows }],
      ...(covered.length ? { covered } : {}),
      ...(call
        ? {
            coachNoteKey: call.key,
            coachNote: { coachId: call.coachId, coachName: call.coachName, text: call.text, kind: call.kind },
          }
        : {}),
      actions,
    },
  ];
}

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
  coachNote?: Pick<InboxMessage, 'coachNoteKey' | 'coachNote'>;
} {
  const sender = headCoach(league);
  const said = seasonSaid(league, sender.from);
  const clock = moraleClock(league);
  const key = `staffRows:${league.season}:${clock}`;
  const covered: string[] = [];
  const staff: RoomRow[] = [];
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
  if (call)
    staff.push({
      playerId: call.playerId,
      cells: [name(call.playerId), `${call.coachName}, ${chair(call.coachId)}`],
      note: call.text,
    });
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
    staff.push({
      playerId: found.playerId,
      cells: [name(found.playerId), `${found.coachName}, ${chair(found.coachId)}`],
      note,
    });
  }
  // His word with the players has no story to hang on: it comes with the staff's notes.
  for (const r of meetingStaffRows(league, told, said).filter((x) => x.key.startsWith('cred:'))) {
    covered.push(r.key);
    staff.push({ cells: [r.label, sender.from], note: r.note });
  }

  // The rooms: the position coach's turn and warning, then chemistry in the same note.
  const rooms = new Map<CoachRoom, { cells: string[]; coachId?: number; notes: string[] }>();
  const room = (unit: CoachRoom, coachId: number) => {
    const c = league.coaches[coachId];
    const row = rooms.get(unit) ?? {
      cells: [ROOM_LABEL[unit], `${coachName(c)}, ${coachTitle(c)}`],
      coachId,
      notes: [],
    };
    rooms.set(unit, row);
    return row;
  };
  if (!leaveRooms) {
    const turn = unitTurnFor(league, told);
    const story = turn && openStory(league, { kind: 'room', teamId: league.userTeamId, unit: turn.unit as CoachRoom });
    // A room's turn must have stood: the week it turns is too soon to tell.
    if (turn && (!story || tellable(league, story, clock))) {
      const note = say(UNIT_TURN, turn.fact, { key, slot: `unit:${turn.unit}`, ...wording(league, sender.from, said) });
      said.push(note);
      covered.push(turn.key);
      room(turn.unit as CoachRoom, turn.coachId).notes.push(note);
    }
    for (const w of beliefRows(league, told, said)) {
      covered.push(w.key);
      room(w.unit, w.coachId).notes.push(w.note);
    }
    for (const c of chemistryNotes(league, told, said)) {
      covered.push(c.key);
      const own = rooms.get(c.unit);
      if (own) own.notes.push(c.note);
      else rooms.set(c.unit, { cells: [ROOM_LABEL[c.unit], sender.from], notes: [c.note] });
    }
  }
  return {
    rooms: [...rooms.values()].map((r) => ({
      cells: r.cells,
      note: r.notes.join(' '),
      ...(r.coachId !== undefined ? { coachId: r.coachId } : {}),
    })),
    staff,
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
