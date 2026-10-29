/**
 * The staff's notes for the week, in a letter of their own: a coach's call on the depth chart and his follow-ups on
 * it, and a coach working on a player's bad habit. They used to ride inside the recap and the opposition report,
 * which are about the game; here each note is signed by the coach who made it. One letter a week, only when there's
 * a note. It carries the recommendation's `coachNoteKey`, which is how the staff remember what they've told you.
 */
import { coachAdviceObservation, teachingNoteFor } from './coachReports';
import { COACH_ROLE_LABEL } from './coaching';
import { QUIRKS, type QuirkId } from './quirks';
import { headCoach, type Draft } from './senders';
import type { InboxAction, League, MailSection } from './types';
import { recentBodies, say, type Line } from './voice';

const OPENER: readonly Line<{ calls: number; habits: number }>[] = [
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
  const habit = teachingNoteFor(league);
  if (!call && !habit) return [];
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
  const sender = headCoach(league);
  const actions: InboxAction[] = [
    ...rows.map((r) => ({ kind: 'player' as const, playerId: r.playerId! })),
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
        call && habit
          ? 'From the staff: a depth-chart call and habit work'
          : call
            ? `From the staff: ${name(call.playerId)}`
            : `From the staff: working on ${name(habit!.playerId)}`,
      body: say(
        OPENER,
        { calls: call ? 1 : 0, habits: habit ? 1 : 0 },
        { key: id, slot: 'opener', recent: recentBodies(league, sender.from) },
      ),
      sections: [{ title: 'From the staff', columns: ['Player', 'Coach'], rows }],
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
