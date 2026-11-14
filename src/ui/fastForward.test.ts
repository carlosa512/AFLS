import { describe, expect, it } from 'vitest';
import type { PlayLogEntry, Team } from '../engine/types';
import { clockOf } from './gameRead';
import { beatClock, beatMs, beatSpan } from './fastForward';

const BUF = { id: 1, abbrev: 'BUF', city: 'Buffalo', name: 'Blizzard', colors: ['#00338d', '#c60c30'] } as Team;
const NO = { id: 2, abbrev: 'NO', city: 'New Orleans', name: 'Krewe', colors: ['#101820', '#d3bc8d'] } as Team;
void NO;

/** 1st & 10 at its own 25, Q1 15:00, 0–0, the home side running for 3. */
const entry = (e: Partial<PlayLogEntry> = {}): PlayLogEntry => ({
  quarter: 1,
  clock: 900,
  offense: BUF.id,
  down: 1,
  distance: 10,
  yardLine: 25,
  text: 'J.Back rush up the middle for 3 yards',
  homeScore: 0,
  awayScore: 0,
  kind: 'run',
  from: 25,
  to: 28,
  ...e,
});

describe('the beat and its clock', () => {
  it('beats 2 s at 1×, about 1.4 s at 2×, 1 s at 4× and never under the banner floor', () => {
    expect([1, 2, 4, 8].map(beatMs)).toEqual([2000, 1414, 1000, 800]);
  });

  it('reads the clock back from game seconds, a period’s end as its own 0:00', () => {
    const plays = [entry({ quarter: 1, clock: 900 }), entry({ quarter: 2, clock: 700 })];
    expect(clockOf(plays, 0)).toEqual({ quarter: 1, clock: 900 });
    expect(clockOf(plays, 900)).toEqual({ quarter: 1, clock: 0 });
    expect(clockOf(plays, 901)).toEqual({ quarter: 2, clock: 899 });
  });

  it('flips into overtime at the overtime’s own length', () => {
    const plays = [entry({ quarter: 4, clock: 30 }), entry({ quarter: 5, clock: 600 })];
    expect(clockOf(plays, 3600)).toEqual({ quarter: 4, clock: 0 });
    expect(clockOf(plays, 3601)).toEqual({ quarter: 5, clock: 599 });
  });

  it('counts from the last highlight to the next one’s snap, but never into the next half', () => {
    const plays = [
      entry({ quarter: 1, clock: 500 }),
      entry({ quarter: 1, clock: 470 }),
      entry({ quarter: 1, clock: 430 }),
    ];
    expect(beatSpan(plays, 0, 1)).toEqual({ start: 400, end: 470 });
    const half = [entry({ quarter: 2, clock: 40 }), entry({ quarter: 2, clock: 5 }), entry({ quarter: 3, clock: 900 })];
    expect(beatSpan(half, 0, 1)).toEqual({ start: 1760, end: 1795 });
    // No next play (the game ends in the gap): the last play's snap.
    expect(beatSpan(plays.slice(0, 2), 0, 1)).toEqual({ start: 400, end: 430 });
    expect(beatClock(plays, { start: 400, end: 470 }, 0.5)).toEqual({ quarter: 1, clock: 465 });
  });
});
