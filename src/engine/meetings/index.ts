import { managesTeam } from '../employment';
import { moraleContext, YEAR } from '../morale';
import type { League, MeetingRecord, MeetingScope, MeetingSuggestion } from '../types';
import { addressSuggestion, gmAddressOpen, holdGmAddress } from './address';
import { aiChoice } from './ai';
import { judgeCommitments } from './commitments';
import { holdMeeting, meetingRng, type MeetingChoice } from './react';
import {
  choicesFor,
  COOLDOWN,
  headCoachOf,
  markOffered,
  meetingsOf,
  membersOf,
  offCooldown,
  stepClock,
  suggestMeeting,
  topicOf,
} from './suggest';

/**
 * Team meetings (L2): the public face of `meetings/`. The calendar runs `meetingsStep` after every morale step; screens
 * and letters call the user actions below.
 */
export { credibilityOf, credibilityRead, type CredibilityRead } from './credibility';
export type { MeetingChoice } from './react';

/** An AI GM at a crisis speaks to his team this often (once a season at most). */
export const AI_ADDRESS = { chance: 0.25 };

/**
 * One step: last season's log cleared, a pending suggestion from an earlier step lapsed, then each club's meeting: an
 * AI club (or yours, with the coach's hand) holds it at once, yours otherwise waits on you. Then the commitments.
 */
export function meetingsStep(league: League): void {
  const clock = stepClock(league);
  const ctx = moraleContext(league);
  for (const team of league.teams) {
    const m = meetingsOf(team);
    m.log = m.log.filter((r) => Math.floor(r.clock / YEAR) === league.season);
    const yours = managesTeam(league, team.id);
    if (m.pending && (m.pending.clock < clock || !yours)) delete m.pending;
    if (!yours && gmAddressOpen(league, team.id, ctx)) {
      const s = addressSuggestion(league, team.id, ctx);
      const rng = meetingRng(league, team.id, s, 'gm:choice');
      if (rng.chance(AI_ADDRESS.chance)) {
        const choice = aiChoice(league, team.id, s, rng);
        if (choice) {
          m.pending = s;
          holdGmAddress(league, team.id, choice);
          m.lastOffer = clock;
          continue;
        }
      }
    }
    const s = suggestMeeting(league, team.id, ctx);
    if (!s) continue;
    if (yours && !m.byCoach) {
      m.pending = s;
      continue;
    }
    const choice = aiChoice(league, team.id, s, meetingRng(league, team.id, s, `${s.scope}:choice`));
    if (!choice) continue;
    m.pending = s;
    holdMeeting(league, team.id, choice);
  }
  judgeCommitments(league);
}

/** "Let the coach handle it": he holds your meetings himself, like mentoring. */
export function setMeetingsByCoach(league: League, on: boolean): void {
  const m = meetingsOf(league.teams[league.userTeamId]);
  if (on) m.byCoach = true;
  else delete m.byCoach;
}

/** Your answer to what's waiting: hold it as chosen, or not now. */
export function answerMeeting(league: League, answer: MeetingChoice | 'skip'): MeetingRecord | null {
  const m = meetingsOf(league.teams[league.userTeamId]);
  const s = m.pending;
  if (!s) return null;
  if (answer === 'skip') {
    delete m.pending;
    return null;
  }
  if (!s.approaches.includes(answer.approach) || !s.backings.includes(answer.backing))
    throw new Error('That choice is not on offer.');
  return s.kind === 'gm'
    ? holdGmAddress(league, league.userTeamId, answer)
    : holdMeeting(league, league.userTeamId, answer);
}

/** You ask the head coach for a room's meeting (or the team's): only off its cooldown, and nothing else waiting. */
export function requestMeeting(league: League, scope: MeetingScope): MeetingSuggestion | null {
  const teamId = league.userTeamId;
  const m = meetingsOf(league.teams[teamId]);
  const clock = stepClock(league);
  if (m.pending || !headCoachOf(league, teamId) || !offCooldown(league, teamId, scope)) return null;
  if (m.log.some((r) => clock - r.clock < COOLDOWN.week)) return null;
  const ctx = moraleContext(league);
  const topic = topicOf(league, membersOf(league, teamId, scope), ctx);
  const s: MeetingSuggestion = {
    clock,
    scope,
    kind: 'trouble',
    topic,
    ...choicesFor(league, teamId, scope, 'trouble', topic, undefined, ctx),
  };
  markOffered(league, teamId, scope);
  m.pending = s;
  return s;
}

/** Your address to the team, when a crisis has opened it. */
export function requestAddress(league: League): MeetingSuggestion | null {
  const teamId = league.userTeamId;
  const m = meetingsOf(league.teams[teamId]);
  if (!gmAddressOpen(league, teamId)) return null;
  m.pending = addressSuggestion(league, teamId, moraleContext(league));
  return m.pending;
}

/** You're leaving the club: whatever was waiting on you lapses (its commitments stay the club's). */
export function leaveClub(league: League, teamId: number): void {
  const m = league.teams[teamId]?.meetings;
  if (m) delete m.pending;
}
