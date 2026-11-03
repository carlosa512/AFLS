import { moraleContext, promisesScore, type MoraleContext } from '../morale';
import { computeRecords } from '../season/standings';
import { honouredSince, unitRead } from '../standing';
import { TRADE_DEADLINE_WEEK } from '../trade/rules';
import type { Approach, Backing, League, MeetingRecord, MeetingSuggestion, Player } from '../types';
import { CRED, credibilityRead, shiftCredibility } from './credibility';
import { holdMeeting, isDriven, isVolatile, type MeetingChoice, type SpeakerTerms } from './react';
import { headCoachOf, meetingsOf, ROOMS, stepClock, topicOf, membersOf } from './suggest';

/**
 * The GM address (L2, spec §3): break glass in a crisis, once a season, the whole team, you speak. Trust in your word
 * (the promises you've kept and broken) decides most of it; the stakes are twice a coach's meeting.
 */
const CRISIS = { losing: 4, rooms: 3 };
/** What each approach does with each kind of man (on top of trust in your word). */
export const ADDRESS = { ownIt: 0.15, raiseBar: 0.3 };
/** A shake-up is "right after" for this many weeks. */
const SHAKE_WEEKS = 1;

/** The club fired its head coach in the last week: an interim is in the chair since then. */
function justFired(league: League, teamId: number): boolean {
  const hc = headCoachOf(league, teamId);
  const at = hc?.interim ? hc.interimAppointments?.at(-1) : undefined;
  return !!at && at.season === league.season && at.teamId === teamId && league.week - at.week <= SHAKE_WEEKS;
}

/** It traded a captain or a star (honoured in the last three seasons) in the last week. */
function bigTrade(league: League, teamId: number): boolean {
  const team = league.teams[teamId];
  const c = team.captains?.season === league.season ? team.captains : undefined;
  const captains = new Set(c ? [c.offense, c.defense, c.specialTeams] : []);
  const stars = honouredSince(league, league.season - 2);
  return (league.market?.history ?? []).some(
    (r) =>
      r.season === league.season &&
      r.phase === league.phase &&
      league.week - r.week <= SHAKE_WEEKS &&
      r.sides.some((s) => s.teamId === teamId && s.players.some((id) => captains.has(id) || stars.has(id))),
  );
}

/** A shake-up the room is still taking in: a fresh start is on offer. */
const shakeUp = (league: League, teamId: number) => justFired(league, teamId) || bigTrade(league, teamId);

/** The address is open: a crisis, and not yet used this season. */
export function gmAddressOpen(league: League, teamId: number, ctx?: MoraleContext): boolean {
  if (meetingsOf(league.teams[teamId]).gmAddressSeason === league.season) return false;
  if (league.phase !== 'regular' && league.phase !== 'playoffs') return false;
  const streak = computeRecords(league).get(teamId)?.streak ?? '';
  if (streak[0] === 'L' && Number(streak.slice(1)) >= CRISIS.losing) return true;
  if (shakeUp(league, teamId)) return true;
  const context = ctx ?? moraleContext(league);
  const troubled = ROOMS.filter((u) => {
    const w = unitRead(league, teamId, u, context)?.word;
    return w === 'Down' || w === 'Split';
  });
  return troubled.length >= CRISIS.rooms;
}

/** What the GM can say and put behind it. Monday only. */
export function addressSuggestion(league: League, teamId: number, ctx: MoraleContext): MeetingSuggestion {
  const approaches: Approach[] = ['ownIt', 'raiseBar'];
  if (shakeUp(league, teamId)) approaches.push('freshStart');
  const backings: Backing[] = ['jobs'];
  if (league.phase === 'regular' && league.week <= TRADE_DEADLINE_WEEK) backings.push('move');
  backings.push('words');
  return {
    clock: stepClock(league),
    scope: 'team',
    kind: 'gm',
    topic: topicOf(league, membersOf(league, teamId, 'team'), ctx),
    approaches,
    backings,
    timings: ['monday'],
    named: [],
  };
}

/** The GM's terms: trust in your word replaces the coach's, then what each approach does with each kind of man. */
export function gmTerms(league: League, choice: MeetingChoice): SpeakerTerms {
  void league;
  return {
    trust: (p: Player) => (0.5 * promisesScore(p)) / 3,
    lean: (p: Player) => {
      if (choice.approach === 'ownIt') return p.personality.loyalty >= 0.6 || p.experience >= 6 ? ADDRESS.ownIt : 0;
      if (choice.approach === 'raiseBar') return isDriven(p) ? ADDRESS.raiseBar : isVolatile(p) ? -ADDRESS.raiseBar : 0;
      return 0;
    },
  };
}

/** Hold it: twice a coach's stakes, spent for the season; a coach whose word has worn thin pays when it flops. */
export function holdGmAddress(
  league: League,
  teamId: number,
  choice: MeetingChoice,
  ctx?: MoraleContext,
): MeetingRecord {
  const m = meetingsOf(league.teams[teamId]);
  if (m.pending?.kind !== 'gm') throw new Error('No address is waiting.');
  const record = holdMeeting(league, teamId, { ...choice, timing: 'monday' }, gmTerms(league, choice), ctx);
  m.gmAddressSeason = league.season;
  const flop = record.outcomes.bristles.length > record.outcomes.lands.length;
  const hc = headCoachOf(league, teamId);
  if (hc && flop && credibilityRead(hc) === 'wornThin') shiftCredibility(hc, CRED.meetingBristles);
  return record;
}
