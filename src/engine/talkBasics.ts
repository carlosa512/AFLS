/**
 * What the talks (`playerTalks.ts`) and the benching chain (`benching.ts`) both read: the asks a club hears in a step,
 * the club whose letters you answer, and a man's talk record. Kept apart so neither module imports the other for them.
 */
import { employed } from './employment';
import type { League, Player, Talk } from './types';

/**
 * The head coach writes at most every other step (`coachWeek.ts`): the step after a letter files none. It is also the
 * longest a cleared starter's reminder can take to reach you, so his grace (`benching.ts`) runs this many steps.
 */
export const LETTER_GAP = 2;

/** Asks a club hears in one step. */
export const PER_CLUB = 2;

/** The club whose letters you answer: yours, while you have a job. */
export const yourClub = (league: League) => (employed(league) ? league.userTeamId : null);

/** His talk record with his club, started when it is first needed. */
export const talkOf = (p: Player): Talk => (p.morale!.talk ??= { club: p.teamId! });
