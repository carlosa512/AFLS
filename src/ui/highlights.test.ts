import { describe, expect, it } from 'vitest';
import { createLeague } from '../engine/generate';
import { simulateGame } from '../engine/match/gameSim';
import type { PlayLogEntry } from '../engine/types';
import { highlightLevel, nextShown, shows } from './highlights';

const HOME = 1;
const AWAY = 2;

/** 1st & 10 at the 25, Q1 15:00, 0–0, the home side running for 3. */
const entry = (e: Partial<PlayLogEntry> = {}): PlayLogEntry => ({
  quarter: 1,
  clock: 900,
  offense: HOME,
  down: 1,
  distance: 10,
  yardLine: 25,
  text: 'Run for 3 yards',
  homeScore: 0,
  awayScore: 0,
  kind: 'run',
  from: 25,
  to: 28,
  ...e,
});
const level = (e: Partial<PlayLogEntry>) => highlightLevel([entry(e)], 0, HOME);
const levelAfter = (prev: Partial<PlayLogEntry>, e: Partial<PlayLogEntry>) =>
  highlightLevel([entry(prev), entry(e)], 1, HOME);

describe('highlight levels', () => {
  it('a touchdown, a pick, a field goal and a 4th-down try are Key; a punt is not', () => {
    expect(level({ text: 'Run, TOUCHDOWN' })).toBe('key');
    expect(level({ kind: 'int' })).toBe('key');
    expect(level({ kind: 'fg', down: 4 })).toBe('key');
    expect(level({ down: 4, distance: 1 })).toBe('key');
    expect(level({ kind: 'punt', down: 4, text: 'punts 45 yards' })).toBe('full');
  });

  it('reads the gain the offense way: 22 yards for the away side is Key', () => {
    expect(level({ offense: AWAY, from: 70, to: 48 })).toBe('key');
  });

  it('a third down, a snap inside the 10, a sack and a 15-yard gain are Extended; 12 yards is Full', () => {
    expect(level({ down: 3 })).toBe('extended');
    expect(level({ yardLine: 92 })).toBe('extended');
    expect(level({ yardLine: 85 })).toBe('full');
    expect(level({ kind: 'sack', to: 20 })).toBe('extended');
    expect(level({ to: 40 })).toBe('extended');
    expect(level({ to: 37 })).toBe('full');
  });

  it('the last two minutes of a one-score game are Key, read from the score before the snap', () => {
    expect(levelAfter({ homeScore: 17, awayScore: 10 }, { quarter: 4, clock: 90, homeScore: 17, awayScore: 10 })).toBe(
      'key',
    );
    expect(levelAfter({ homeScore: 24, awayScore: 10 }, { quarter: 4, clock: 90, homeScore: 24, awayScore: 10 })).toBe(
      'full',
    );
  });

  it('the first half’s two-minute drill is Extended', () => {
    expect(level({ quarter: 2, clock: 100 })).toBe('extended');
  });

  it('an announcement is Full', () => {
    expect(level({ kind: undefined, down: 0, text: 'Timeout DAL (2 left).' })).toBe('full');
  });

  it('nextShown steps over plays below the pick, both ways, and gives -1 past the end', () => {
    const plays = [entry(), entry({ down: 3 }), entry(), entry({ kind: 'int' }), entry()];
    expect(nextShown(plays, 0, HOME, 'key', 1)).toBe(3);
    expect(nextShown(plays, 0, HOME, 'extended', 1)).toBe(1);
    expect(nextShown(plays, 0, HOME, 'full', 1)).toBe(1);
    expect(nextShown(plays, 4, HOME, 'extended', -1)).toBe(3);
    expect(nextShown(plays, 3, HOME, 'key', 1)).toBe(-1);
    expect(nextShown(plays, 3, HOME, 'key', -1)).toBe(-1);
    expect(shows(plays, 1, HOME, 'key')).toBe(false);
    expect(shows(plays, 1, HOME, 'extended')).toBe(true);
  });

  it('across 40 simulated games, Key averages 25–40 plays and Extended 60–80', () => {
    const league = createLeague({ seed: 'highlights' });
    const N = 40;
    let key = 0;
    let ext = 0;
    for (let i = 0; i < N; i++) {
      const g = league.games[i];
      const plays = simulateGame(league, g, { keepPlays: true, seed: `h-${i}` }).plays ?? [];
      plays.forEach((_, j) => {
        if (shows(plays, j, g.homeId, 'key')) key++;
        if (shows(plays, j, g.homeId, 'extended')) ext++;
      });
    }
    const keyAvg = key / N;
    const extAvg = ext / N;
    expect(keyAvg).toBeGreaterThanOrEqual(25);
    expect(keyAvg).toBeLessThanOrEqual(40);
    expect(extAvg).toBeGreaterThanOrEqual(60);
    expect(extAvg).toBeLessThanOrEqual(80);
  }, 120_000);
});
