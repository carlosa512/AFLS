import { describe, expect, it } from 'vitest';
import { adviceKey, updateCoachAdvice } from './coachDecisions';
import { teamCoaches } from './coaching';
import { createLeague } from './generate';
import { deliverMail, mailSubject } from './inbox';
import { teamPlayers } from './roster';
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
