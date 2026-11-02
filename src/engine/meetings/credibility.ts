import { computeRecords } from '../season/standings';
import type { Coach, League } from '../types';

/**
 * A head coach's word with his room (L2, spec §2.3): a hidden number in −1…1, read only in words. Meetings that land,
 * commitments kept and winning streaks raise it; meetings that bristle, commitments broken and losing streaks lower
 * it; every week it drifts back toward the middle, so a season's slide can be climbed out of.
 */
export const CRED = {
  meetingLands: 0.12,
  meetingBristles: -0.15,
  kept: 0.15,
  broken: -0.25,
  winStreak: 0.03,
  loseStreak: -0.04,
  drift: 0.97,
};

/** A streak this long or longer moves his word each week it runs. */
const STREAK = 3;

export type CredibilityRead = 'believes' | 'steady' | 'heardBefore' | 'wornThin';

const round = (v: number) => Math.round(v * 10000) / 10000;
const clamp = (v: number) => Math.max(-1, Math.min(1, v));

export const credibilityOf = (c: Coach): number => c.credibility ?? 0;

/** "The room believes him", nothing said, "they've heard it before", "his word has worn thin". */
export function credibilityRead(c: Coach): CredibilityRead {
  const v = credibilityOf(c);
  if (v >= 0.4) return 'believes';
  if (v <= -0.5) return 'wornThin';
  if (v <= -0.2) return 'heardBefore';
  return 'steady';
}

export function shiftCredibility(c: Coach, by: number): void {
  c.credibility = round(clamp(credibilityOf(c) + by));
}

/** One week for one head coach: the drift toward the middle, then his club's streak (`W3`, `L4`…) if it has one. */
export function credibilityTick(c: Coach, streak: string): void {
  c.credibility = round(credibilityOf(c) * CRED.drift);
  const n = Number(streak.slice(1));
  if (n >= STREAK) shiftCredibility(c, streak[0] === 'W' ? CRED.winStreak : CRED.loseStreak);
}

/** The league's week (after its moods): every head coach in a chair. Nothing drawn. */
export function credibilityWeek(league: League): void {
  const records = computeRecords(league);
  for (const c of Object.values(league.coaches)) {
    if (c.role !== 'headCoach' || c.teamId === null) continue;
    credibilityTick(c, records.get(c.teamId)?.streak ?? '');
  }
}

/** A head coach taking over a club: his word starts in the middle, and his first meetings land a little easier. */
export function startHeadCoach(c: Coach): void {
  c.credibility = 0;
  c.newVoice = 2;
}
