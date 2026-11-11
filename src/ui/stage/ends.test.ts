import { describe, expect, it } from 'vitest';
import { FIELD_W } from '../../engine/field/ballPath';
import { endsSwitched, stadiumSpot } from './ends';

describe('switching ends', () => {
  it('switches for the second and fourth quarters, and every other overtime after them', () => {
    expect([1, 2, 3, 4, 5, 6].map(endsSwitched)).toEqual([false, true, false, true, false, true]);
  });

  it('leaves a spot alone until the ends switch', () => {
    expect(stadiumSpot(30, 10, 1)).toEqual({ x: 30, y: 10 });
    expect(stadiumSpot(30, 10, 3)).toEqual({ x: 30, y: 10 });
  });

  it('turns the field half way round midfield, so a team’s left is still its left', () => {
    expect(stadiumSpot(100, 10, 2)).toEqual({ x: 0, y: FIELD_W - 10 });
    expect(stadiumSpot(50, FIELD_W / 2, 2)).toEqual({ x: 50, y: FIELD_W / 2 });
  });

  it('is its own way back', () => {
    const there = stadiumSpot(27, 41, 4);
    const back = stadiumSpot(there.x, there.y, 4);
    expect(back.x).toBeCloseTo(27);
    expect(back.y).toBeCloseTo(41);
  });
});
