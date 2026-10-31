/**
 * Highlight levels for watching a game (FM's Key / Extended / Full match): which plays animate. The rest still land in
 * the play log and on the scoreboard. Everything is read off the log entry, so old games work too.
 * Spec: docs/superpowers/specs/2026-10-31-all-22-view-design.md §1.
 */
import type { PlayLogEntry } from '../engine/types';

export type HighlightLevel = 'key' | 'extended' | 'full';
export const HIGHLIGHT_LEVELS: readonly HighlightLevel[] = ['key', 'extended', 'full'];
const RANK: Record<HighlightLevel, number> = { key: 0, extended: 1, full: 2 };

/** Two minutes: the end of each half, where a game turns. */
const LATE = 120;
/** A one-score game: a touchdown and a two-point try. */
const ONE_SCORE = 8;
/** Plays whose spots measure the offense's gain. */
const GAINS: ReadonlySet<string> = new Set(['run', 'pass', 'scramble', 'sack']);

/** The lowest level a play shows at. */
export function highlightLevel(plays: readonly PlayLogEntry[], index: number, homeId: number): HighlightLevel {
  const e = plays[index];
  if (!e.kind) return 'full';
  const snap = e.down > 0;
  const dir = e.offense === homeId ? 1 : -1;
  // Gains from scrimmage only: a punt's spots run from the snap to the return, which is no gain for the offense.
  const gain = snap && GAINS.has(e.kind) && e.from !== undefined && e.to !== undefined ? (e.to - e.from) * dir : 0;
  // The score as it stood at the snap: the entry itself carries the score after the play.
  const prev = plays[index - 1];
  const margin = Math.abs((prev?.homeScore ?? 0) - (prev?.awayScore ?? 0));

  if (
    /TOUCHDOWN|FUMBLE|BLOCKED|SAFETY/.test(e.text) ||
    e.kind === 'fg' ||
    e.kind === 'int' ||
    e.kind === 'two' ||
    gain >= 20 ||
    // A big return: the ball comes back the other way from where the kick came down.
    ((e.kind === 'punt' || e.kind === 'kickoff') &&
      e.air !== undefined &&
      e.to !== undefined &&
      Math.abs(e.to - e.air) >= 30) ||
    (e.down === 4 && e.kind !== 'punt') ||
    (snap && e.quarter >= 4 && e.clock <= LATE && margin <= ONE_SCORE)
  )
    return 'key';
  if (
    e.down === 3 ||
    (snap && e.yardLine >= 90) ||
    e.kind === 'sack' ||
    // Inside the 10 and 15+ yards, not the 20 and 10+: either wider bar ran Extended to 80+ plays a game, past 60–80.
    gain >= 15 ||
    (snap && e.quarter === 2 && e.clock <= LATE)
  )
    return 'extended';
  return 'full';
}

/** Whether a play animates at the level picked. */
export function shows(plays: readonly PlayLogEntry[], index: number, homeId: number, pick: HighlightLevel): boolean {
  return RANK[highlightLevel(plays, index, homeId)] <= RANK[pick];
}

/** The first play after (or before) `from` that shows at `pick`, or -1 when there is none. */
export function nextShown(
  plays: readonly PlayLogEntry[],
  from: number,
  homeId: number,
  pick: HighlightLevel,
  dir: 1 | -1,
): number {
  for (let i = from + dir; i >= 0 && i < plays.length; i += dir) if (shows(plays, i, homeId, pick)) return i;
  return -1;
}
