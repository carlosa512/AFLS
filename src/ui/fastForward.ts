/**
 * The fast-forward between highlights: when the highlight level skips plays, the field glides on, the clock counts
 * down and a card says what changed. These are its pure reads: how long the beat lasts, the clock it counts, and the
 * line under it. Spec: docs/superpowers/specs/2026-11-14-fast-forward-between-highlights-design.md.
 */
import type { PlayLogEntry, Team } from '../engine/types';
import { booked, clockOf, gainOf, halfOf, kicked, secondsOf } from './gameRead';
import { downParts } from './screens/Scorebug';
import { BANNER_FLOOR } from './moments';

/** The beat at 1×, in milliseconds. Sped up it shortens with the square root of the speed, never under the floor. */
export const BEAT_MS = 2000;

/** How long the beat lasts at this speed: 2 s at 1×, about 1.4 s at 2×, 1 s at 4×, the banner floor at 8×. */
export function beatMs(speed: number): number {
  return Math.round(Math.max(BANNER_FLOOR, BEAT_MS / Math.sqrt(speed)));
}

/**
 * The game seconds a beat counts through: from the last highlight's snap to the next highlight's, so the clock never
 * jumps again when that play starts. A next play in another half (or none) stops it at the landed play's snap.
 */
export function beatSpan(plays: readonly PlayLogEntry[], from: number, to: number): { start: number; end: number } {
  const seconds = secondsOf(plays);
  const next = plays[to + 1];
  const end = next && halfOf(next.quarter) === halfOf(plays[to].quarter) ? seconds[to + 1] : seconds[to];
  return { start: seconds[from], end };
}

/** The clock `k` of the way through a beat (0 to 1), to the whole second. */
export function beatClock(
  plays: readonly PlayLogEntry[],
  span: { start: number; end: number },
  k: number,
): { quarter: number; clock: number } {
  return clockOf(plays, Math.round(span.start + (span.end - span.start) * k));
}

/** A play that hands the ball to the other team inside a gap, and what the card calls it (a kickoff has no words). */
function handOver(e: PlayLogEntry, home: Team, away: Team): { words?: string } | null {
  if (e.kind === 'punt' && kicked(e)) return { words: `${(e.offense === home.id ? home : away).city} punt` };
  if (e.kind === 'xp') return { words: /NO GOOD\.$/.test(e.text) ? 'Extra point missed' : 'Extra point good' };
  if (e.text === 'Turnover on downs.') return { words: 'Turnover on downs' };
  if (e.kind === 'kickoff') return {};
  return null;
}

/**
 * What the card under the clock says about the plays skipped (`from + 1` through `to`): the snaps and either how the
 * ball changed teams or the yards they made, then where the next snap is. Zero to two lines.
 */
export function skipSummary(
  plays: readonly PlayLogEntry[],
  from: number,
  to: number,
  home: Team,
  away: Team,
): string[] {
  const gap = plays.slice(from + 1, to + 1);
  const snaps = gap.filter(booked);
  const overs = gap.map((e) => handOver(e, home, away));
  const changed = overs.some((h) => h !== null);
  const words = overs.filter((h) => h?.words).pop()?.words;
  // With no words for the change (a kickoff), the yards since it: the receiving team's.
  const last = overs.reduce((at, h, i) => (h ? i : at), -1);
  const since = gap.slice(last + 1).filter(booked);
  const first: string[] = [];
  if (snaps.length) first.push(`${snaps.length} play${snaps.length === 1 ? '' : 's'}`);
  if (words) first.push(words);
  else if (since.length) first.push(`${since.reduce((sum, e) => sum + gainOf(e, home.id), 0)} yds`);
  const lines = first.length ? [first.join(' · ')] : [];
  const next = plays[to + 1];
  const spot =
    next && next.kind !== 'punt' && halfOf(next.quarter) === halfOf(plays[to].quarter)
      ? downParts(next, home, away)
      : null;
  if (spot) lines.push(changed ? `${(next.offense === home.id ? home : away).city} ball on ${spot.where}` : spot.spot);
  return lines;
}

/**
 * How far through its beat the clock is: elapsed over the beat's length, but never less than it already showed, so a
 * beat made longer mid-way (the speed button) holds the clock rather than running it backwards.
 */
export function beatProgress(elapsedMs: number, ms: number, prev: number): number {
  if (ms <= 0) return 1;
  return Math.max(prev, Math.min(1, elapsedMs / ms));
}
