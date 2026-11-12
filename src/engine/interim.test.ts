/**
 * Your interim head coach at the new league year: the owner asks you before he offers the job, the letter waits on
 * your answer, and a window that closes without one is settled as the owner would have settled it. Other teams'
 * interims are decided at once, as before.
 */
import { describe, expect, it } from 'vitest';
import { installInterimHeadCoach, teamCoaches } from './coaching';
import { createLeague } from './generate';
import { deliverMail, needsYou } from './inbox';
import { decideInterim, interimPending, leadershipNewYear, settleInterim } from './leadership';
import { advanceOffseason, beginOffseason } from './offseason';
import type { League } from './types';

/** A league at the re-sign window whose own team, and one other, finished last season under an interim. */
function world(seed = 'interim-call') {
  const l = createLeague({ seed });
  const other = l.teams.find((t) => t.id !== l.userTeamId)!.id;
  // Room in both budgets to pay a head coach off, so the owner can make the change.
  for (const id of [l.userTeamId, other]) l.teams[id].staffBudgetMult = 3;
  const interim = installInterimHeadCoach(l, l.userTeamId)!;
  const theirs = installInterimHeadCoach(l, other)!;
  l.phase = 'complete';
  beginOffseason(l);
  return { l, interim, theirs, other };
}
const head = (l: League, teamId: number) => teamCoaches(l, teamId).find((c) => c.role === 'headCoach');
const letter = (l: League, coachId: number) => (l.inbox ?? []).find((m) => m.id === `interim:${l.season}:${coachId}`);

describe('your interim head coach', () => {
  it('waits on your call, while another team’s is decided at once', () => {
    const { l, interim, theirs } = world();
    expect(interimPending(l)?.id).toBe(interim.id);
    expect(interim.interim).toBe(true);
    expect(theirs.interim).toBeUndefined();
    const events = l.leadership.events.filter((e) => e.kind === 'coachPermanent' || e.kind === 'coachDismissed');
    expect(events.map((e) => e.coachId)).toEqual([theirs.id]);
  });

  it('files the owner’s question once, and it needs you until you answer', () => {
    const { l, interim } = world();
    deliverMail(l);
    deliverMail(l);
    const m = letter(l, interim.id)!;
    expect((l.inbox ?? []).filter((x) => x.id === m.id)).toHaveLength(1);
    expect(m.from).toBe('The owner');
    expect(m.subject).toContain(interim.lastName);
    expect(needsYou(l, m)).toBe(true);
    decideInterim(l, true);
    deliverMail(l);
    expect(needsYou(l, m)).toBe(false);
    // The answer is shown on the letter: no second mail about the same coach.
    expect((l.inbox ?? []).filter((x) => x.id.startsWith('leadership:') && x.body.includes(interim.lastName))).toEqual(
      [],
    );
  });

  it('gives him the job for two years when you say so', () => {
    const { l, interim } = world();
    decideInterim(l, true);
    expect(interimPending(l)).toBeNull();
    expect(interim.interim).toBeUndefined();
    expect(head(l, l.userTeamId)?.id).toBe(interim.id);
    expect(interim.contract?.through).toBe(l.season + 1);
    expect(l.leadership.events.at(-1)).toMatchObject({ kind: 'coachPermanent', coachId: interim.id });
    expect(() => decideInterim(l, false)).toThrow();
  });

  it('ends his appointment and leaves the chair to you when you say no', () => {
    const { l, interim } = world();
    decideInterim(l, false);
    expect(interimPending(l)).toBeNull();
    expect(head(l, l.userTeamId)?.id).not.toBe(interim.id);
    expect(l.leadership.events.at(-1)).toMatchObject({ kind: 'coachDismissed', coachId: interim.id });
  });

  it('is settled the owner’s way when the window closes with no answer', () => {
    const { l, interim } = world();
    const lean = l.teams[l.userTeamId].interimCall!.lean;
    advanceOffseason(l, { autoUser: true });
    expect(l.phase).toBe('freeAgency');
    expect(l.teams[l.userTeamId].interimCall).toBeUndefined();
    expect(interim.interim).toBeUndefined();
    const kept = head(l, l.userTeamId)?.id === interim.id;
    expect(kept).toBe(lean);
  });

  it('is settled by the owner himself when he changes his GM in the same review, and nothing is left pending', () => {
    // Bad years and a GM past his protected seasons: some owners move on the GM. None may throw, and none may leave
    // the question open for a GM who is gone.
    let dismissed = 0;
    for (const seed of [
      'gm-out-a',
      'gm-out-b',
      'gm-out-c',
      'gm-out-d',
      'gm-out-e',
      'gm-out-f',
      'gm-out-g',
      'gm-out-h',
    ]) {
      const l = createLeague({ seed });
      const team = l.teams[l.userTeamId];
      team.staffBudgetMult = 3;
      const interim = installInterimHeadCoach(l, team.id);
      if (!interim) continue;
      l.season += 3;
      l.phase = 'resign';
      for (let i = 1; i <= 3; i++)
        l.history.push({
          season: l.season - i,
          championId: 1,
          runnerUpId: 2,
          records: Object.fromEntries(l.teams.map((t) => [t.id, { w: 2, l: 15, t: 0 }])),
        });
      expect(() => leadershipNewYear(l), seed).not.toThrow();
      const out = l.leadership.events.some((e) => e.teamId === team.id && e.kind === 'gmDismissed');
      if (!out) continue;
      dismissed++;
      expect(team.interimCall, seed).toBeUndefined();
      expect(interim.interim, seed).toBeUndefined();
    }
    expect(dismissed).toBeGreaterThan(0);
  });

  it('settles a question a GM left behind at another team', () => {
    const { l } = world();
    // As if you had held another team's job when the window opened, then taken yours: its head coach is still an
    // interim, with the owner's view on file and nobody left to ask.
    const team = l.teams.find((t) => t.id !== l.userTeamId && head(l, t.id))!;
    const coach = head(l, team.id)!;
    coach.interim = true;
    team.interimCall = { season: l.season, coachId: coach.id, lean: true };
    settleInterim(l);
    expect(team.interimCall).toBeUndefined();
    expect(coach.interim).toBeUndefined();
    expect(head(l, team.id)?.id).toBe(coach.id);
    // Yours was settled in the same pass.
    expect(l.teams[l.userTeamId].interimCall).toBeUndefined();
  });
});
