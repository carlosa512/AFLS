import { describe, expect, it } from 'vitest';
import { cameraCenter, cameraSpan, layoutFor } from './camera';

describe('the camera', () => {
  it('picks the layout from the box', () => {
    expect(layoutFor(1440, 600)).toBe('wide');
    expect(layoutFor(390, 500)).toBe('upright');
    expect(layoutFor(320, 480)).toBe('upright');
    expect(layoutFor(0, 0)).toBe('wide');
  });

  it('leads the ball and stays on the field', () => {
    expect(cameraCenter(50, 1, 45)).toBe(55);
    expect(cameraCenter(50, -1, 45)).toBe(45);
    expect(cameraCenter(105, 1, 45)).toBeLessThanOrEqual(110 - 22.5);
    expect(cameraCenter(-5, -1, 45)).toBeGreaterThanOrEqual(-10 + 22.5);
  });

  it('pulls back for a kick', () => {
    expect(cameraSpan(undefined)).toBe(45);
    expect(cameraSpan({ kind: 'run' })).toBe(45);
    expect(cameraSpan({ kind: 'punt' })).toBe(70);
    expect(cameraSpan({ kind: 'kickoff' })).toBe(70);
  });
});
