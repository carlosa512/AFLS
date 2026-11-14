import { describe, expect, it } from 'vitest';
import type { PlayLogEntry, Team } from '../engine/types';
import { clockOf } from './gameRead';
import { beatClock, beatMs, beatProgress, beatSpan, skipSummary } from './fastForward';

const BUF = { id: 1, abbrev: 'BUF', city: 'Buffalo', name: 'Blizzard', colors: ['#00338d', '#c60c30'] } as Team;
const NO = { id: 2, abbrev: 'NO', city: 'New Orleans', name: 'Krewe', colors: ['#101820', '#d3bc8d'] } as Team;

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

const note = (text: string, e: Partial<PlayLogEntry> = {}): PlayLogEntry =>
  entry({ kind: undefined, down: 0, distance: 0, from: undefined, to: undefined, text, ...e });

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

describe('the line under the clock', () => {
  it('a drive that carries on: its plays, its yards and the spot', () => {
    const plays = [
      entry({ down: 3 }),
      entry({ from: 25, to: 30 }),
      entry({ kind: 'pass', from: 30, to: 42 }),
      entry({ yardLine: 42 }),
    ];
    expect(skipSummary(plays, 0, 2, BUF, NO)).toEqual(['2 plays · 17 yds', 'Ball on BUF 42']);
  });

  it('a punt: who punted, and who has the ball where', () => {
    const plays = [
      entry({ kind: 'sack' }),
      entry({ kind: 'punt', down: 4, text: 'B.Shaw punts 45 yards.' }),
      entry({ offense: 2, yardLine: 25, from: 75, to: 70 }),
      entry({ offense: 2, down: 2, yardLine: 30 }),
    ];
    expect(skipSummary(plays, 0, 2, BUF, NO)).toEqual(['1 play · Buffalo punt', 'New Orleans ball on NO 30']);
  });

  it('after a touchdown: the extra point, then the other team’s ball', () => {
    const after = (text: string) => [
      entry({ text: 'Run, TOUCHDOWN' }),
      entry({ kind: 'xp', down: 0, text }),
      entry({ kind: 'kickoff', down: 0 }),
      entry({ offense: 2, yardLine: 35 }),
    ];
    expect(skipSummary(after('M.Sherman extra point is GOOD.'), 0, 2, BUF, NO)).toEqual([
      'Extra point good',
      'New Orleans ball on NO 35',
    ]);
    expect(skipSummary(after('M.Sherman extra point is NO GOOD.'), 0, 2, BUF, NO)[0]).toBe('Extra point missed');
  });

  it('after a kickoff alone: the receiving team’s yards since', () => {
    const plays = [
      entry({ kind: 'fg', down: 4, text: 'L.Cox 30-yard field goal is GOOD.' }),
      entry({ kind: 'kickoff', down: 0 }),
      entry({ offense: 2, yardLine: 35, from: 65, to: 55 }),
      entry({ offense: 2, yardLine: 45, from: 55, to: 40 }),
      entry({ offense: 2, yardLine: 60 }),
    ];
    expect(skipSummary(plays, 0, 3, BUF, NO)).toEqual(['2 plays · 25 yds', 'New Orleans ball on BUF 40']);
  });

  it('a turnover on downs, and a gap of notes only', () => {
    const downs = [entry({ down: 4 }), note('Turnover on downs.'), entry({ offense: 2, yardLine: 32 })];
    expect(skipSummary(downs, 0, 1, BUF, NO)).toEqual(['Turnover on downs', 'New Orleans ball on NO 32']);
    const warn = [entry(), note('Two-minute warning.'), entry({ down: 3, yardLine: 40 })];
    expect(skipSummary(warn, 0, 1, BUF, NO)).toEqual(['Ball on BUF 40']);
  });

  it('no spot when the game, the half or a kick comes next', () => {
    const kneels = [entry(), entry({ kind: 'kneel', from: 54, to: 53 }), entry({ kind: 'kneel', from: 53, to: 52 })];
    expect(skipSummary(kneels, 0, 2, BUF, NO)).toEqual(['2 plays · -2 yds']);
    const half = [
      entry({ quarter: 2 }),
      entry({ quarter: 2, from: 25, to: 28 }),
      entry({ quarter: 3, kind: 'kickoff', down: 0 }),
    ];
    expect(skipSummary(half, 0, 1, BUF, NO)).toEqual(['1 play · 3 yds']);
    const punt = [entry(), entry({ from: 25, to: 28 }), entry({ kind: 'punt', down: 4 })];
    expect(skipSummary(punt, 0, 1, BUF, NO)).toEqual(['1 play · 3 yds']);
  });
});

describe('the ticking clock', () => {
  it('never runs the clock backwards when the beat is made longer', () => {
    expect(beatProgress(400, 800, 0)).toBe(0.5);
    expect(beatProgress(450, 2000, 0.5)).toBe(0.5); // the speed went from 8× to 1× mid-beat
    expect(beatProgress(3000, 2000, 0.5)).toBe(1);
    expect(beatProgress(10, 0, 0)).toBe(1);
  });
});
