/**
 * The staff's notes for the week, in a letter of their own: a coach's call on the depth chart and his follow-ups on
 * it, and a coach working on a player's bad habit. They used to ride inside the recap and the opposition report,
 * which are about the game; here each note is signed by the coach who made it. One letter a week, only when there's
 * a note. It carries the recommendation's `coachNoteKey`, which is how the staff remember what they've told you.
 */
import { coachAdviceObservation, teachingNoteFor } from './coachReports';
import { COACH_ROLE_LABEL, coachName, coachTitle, ROOM_LABEL, teamCoaches } from './coaching';
import { moraleClock, moraleContext } from './morale';
import { dueCheckin } from './lockerReport';
import { lastTold, unitFact, unitKey } from './roomFacts';
import { UNIT_PHRASE, UNIT_TURN, type UnitFact } from './roomVoice';
import { roomView, type Unit, type UnitView, type UnitWord } from './standing';
import { QUIRKS, type QuirkId } from './quirks';
import { headCoach, type Draft } from './senders';
import type { CoachRoom, InboxAction, League, MailSection } from './types';
import { recentBodies, say, toldKeys, type Line } from './voice';

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
  // A head coach's report going out today tells the rooms itself: the position coach doesn't repeat it.
  const unitNote = dueCheckin(league, have) ? null : unitTurnFor(league, told);
  if (!call && !habit && !unitNote) return [];
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
  const sender = headCoach(league);
  const covered = [...(habit ? [habitKey!] : []), ...(unitNote ? [unitNote.key] : [])];
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
        unitNote && !call && !habit
          ? `From the staff: ${UNIT_PHRASE[unitNote.unit as CoachRoom]}`
          : call && habit
            ? 'From the staff: a depth-chart call and habit work'
            : call
              ? `From the staff: ${name(call.playerId)}`
              : `From the staff: working on ${name(habit!.playerId)}`,
      body: say(
        OPENER,
        { calls: call ? 1 : 0, habits: habit ? 1 : 0, units: unitNote ? 1 : 0 },
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
