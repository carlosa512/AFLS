import { managesTeam } from '../employment';
import { moraleContext, YEAR } from '../morale';
import { beat } from '../stories';
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
  driverIn,
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

/** A meeting's room is a story of its own (the team, for a meeting of everyone). */
const roomOn = (teamId: number, s: MeetingSuggestion) => ({ kind: 'room' as const, teamId, unit: s.scope });

/**
 * One step: last season's log cleared, a pending suggestion from an earlier step lapsed, then each club's meeting: an
 * AI club (or yours, with the coach's hand) holds it at once, yours otherwise waits on you. Then the commitments.
 */
export function meetingsStep(league: League): void {
  const clock = stepClock(league);
  const ctx = moraleContext(league);
  for (const team of league.teams) {
    const m = meetingsOf(team);
    // A new league year: last year's meetings leave the log, and what the re-sign window's report tells is kept.
    const stale = m.log.filter((r) => Math.floor(r.clock / YEAR) < league.season);
    // Only your club's year is told (the re-sign window's report); an AI club keeps none of it.
    if (!managesTeam(league, team.id)) {
      delete m.settled;
      delete m.lastYear;
    } else if (stale.length || m.settled?.some((x) => Math.floor(x.clock / YEAR) < league.season)) {
      const last = league.season - 1;
      m.lastYear = {
        season: last,
        held: stale.filter((r) => Math.floor(r.clock / YEAR) === last).length,
        settled: (m.settled ?? []).filter((x) => Math.floor(x.clock / YEAR) === last),
      };
      m.settled = (m.settled ?? []).filter((x) => Math.floor(x.clock / YEAR) >= league.season);
      if (!m.settled.length) delete m.settled;
    }
    m.log = m.log.filter((r) => Math.floor(r.clock / YEAR) === league.season);
    const yours = managesTeam(league, team.id);
    if (m.pending && (m.pending.clock < clock || !yours)) delete m.pending;
    if (!yours && gmAddressOpen(league, team.id, ctx)) {
      const s = addressSuggestion(league, team.id, ctx);
      const rng = meetingRng(league, team.id, s, 'gm:choice');
      if (rng.chance(AI_ADDRESS.chance)) {
        const choice = aiChoice(league, team.id, s, rng, ctx);
        if (choice) {
          m.pending = s;
          holdGmAddress(league, team.id, choice, ctx);
          m.lastOffer = clock;
          continue;
        }
      }
    }
    const s = suggestMeeting(league, team.id, ctx);
    if (!s) continue;
    if (yours && !m.byCoach) {
      m.pending = s;
      beat(league, roomOn(team.id, s), 'suggested', clock, { how: s.topic });
      continue;
    }
    const choice = aiChoice(league, team.id, s, meetingRng(league, team.id, s, `${s.scope}:choice`), ctx);
    if (!choice) continue;
    m.pending = s;
    beat(league, roomOn(team.id, s), 'suggested', clock, { how: s.topic });
    holdMeeting(league, team.id, choice, undefined, ctx);
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
    if (s.kind !== 'gm') beat(league, roomOn(league.userTeamId, s), 'passed', stepClock(league));
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
  // He already brought you one this week (you said not now): one suggestion a week, and one letter for it.
  if (m.lastOffer !== undefined && clock - m.lastOffer < COOLDOWN.week) return null;
  const ctx = moraleContext(league);
  const men = membersOf(league, teamId, scope);
  const topic = topicOf(league, men, ctx);
  const s: MeetingSuggestion = {
    clock,
    scope,
    kind: 'trouble',
    topic,
    asked: true,
    ...choicesFor(league, teamId, scope, 'trouble', topic, driverIn(league, men, ctx), ctx),
  };
  markOffered(league, teamId, scope);
  m.pending = s;
  beat(league, roomOn(teamId, s), 'suggested', clock, { how: s.topic });
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
