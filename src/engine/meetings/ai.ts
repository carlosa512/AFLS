import { traitOf } from '../coachTraits';
import { moraleContext } from '../morale';
import type { Rng } from '../rng';
import type { Approach, Backing, League, MeetingSuggestion } from '../types';
import { gmTerms } from './address';
import { reactionScore, type MeetingChoice } from './react';
import { headCoachOf, membersOf } from './suggest';

/**
 * How an AI club runs a meeting (L2, spec §4): the head coach's style picks the approach, the GM's tendencies what's
 * behind it. The same choices you're offered, never more.
 */
export const AI = {
  /** A disciplinarian at or above this, a players' coach at or below. */
  stern: 14,
  soft: 7,
  /** The second-best approach this often, for variety. */
  vary: 0.2,
  /** A moment let pass. */
  skipMoment: 0.3,
  /** A GM tendency this strong decides the commitment. */
  lean: 0.6,
};

/** What the GM puts behind it: a buyer a move, a loyal GM his men's snaps, the rest words. */
function backingFor(league: League, teamId: number, s: MeetingSuggestion): Backing {
  const gm = league.teams[teamId].gm;
  const has = (b: Backing) => s.backings.includes(b);
  if (gm.winNow >= AI.lean && has('move')) return 'move';
  if (s.kind === 'gm') return gm.loyalty <= 1 - AI.lean && has('jobs') ? 'jobs' : 'words';
  // Never talks: an AI front office deals with contracts on its own calendar (`offseason/ai.ts`), so a promise of talks
  // would be kept or broken by a draw with nothing behind it, lifting an underpaid man for nothing.
  if (gm.loyalty >= AI.lean && has('snaps')) return 'snaps';
  return 'words';
}

/** The approach the room would take best, on average (the second best now and then). */
function bestApproach(league: League, teamId: number, s: MeetingSuggestion, backing: Backing, rng: Rng): Approach {
  const ctx = moraleContext(league);
  const men = membersOf(league, teamId, s.scope);
  const ranked = s.approaches
    .map((approach) => {
      const choice: MeetingChoice = { approach, backing, timing: 'monday' };
      const terms = s.kind === 'gm' ? gmTerms(league, choice) : undefined;
      const total = men.reduce((t, p) => t + reactionScore(league, teamId, p, s, choice, ctx, terms), 0);
      return { approach, mean: total / Math.max(1, men.length) };
    })
    .sort((a, b) => b.mean - a.mean);
  return rng.chance(AI.vary) && ranked[1] ? ranked[1].approach : ranked[0].approach;
}

/** An AI club's choice, or null when it lets a moment pass. Monday, always. */
export function aiChoice(league: League, teamId: number, s: MeetingSuggestion, rng: Rng): MeetingChoice | null {
  if (s.kind === 'moment' && rng.chance(AI.skipMoment)) return null;
  const backing = backingFor(league, teamId, s);
  const has = (a: Approach) => s.approaches.includes(a);
  const hc = headCoachOf(league, teamId);
  const discipline = hc ? traitOf(hc, 'discipline') : 10.5;
  let approach: Approach;
  if (s.kind !== 'gm' && discipline >= AI.stern) approach = has('callout') ? 'callout' : 'straight';
  else if (s.kind !== 'gm' && discipline <= AI.soft)
    approach = has('leader') ? 'leader' : has('losing') ? 'losing' : has('standard') ? 'standard' : 'straight';
  else approach = bestApproach(league, teamId, s, backing, rng);
  return { approach, backing, timing: 'monday' };
}
