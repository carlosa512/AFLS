import { describe, expect, it } from 'vitest';
import { bandMark, bandOf } from './band';
import { LEADER_NORMAL } from './leaders';

const USUAL: [number, number] = [3, 15];
const NORMAL: [number, number] = [1.5, 20];

describe('a line that swings with the league', () => {
  it('is usual inside today’s range, edges included', () => {
    expect(bandOf(4, USUAL, NORMAL)).toBe('usual');
    expect(bandOf(3, USUAL, NORMAL)).toBe('usual');
    expect(bandOf(15, USUAL, NORMAL)).toBe('usual');
  });

  it('is unusual outside it but inside the normal band, edges included', () => {
    expect(bandOf(2.5, USUAL, NORMAL)).toBe('unusual');
    expect(bandOf(1.5, USUAL, NORMAL)).toBe('unusual');
    expect(bandOf(20, USUAL, NORMAL)).toBe('unusual');
  });

  it('is abnormal outside the normal band', () => {
    expect(bandOf(1.4, USUAL, NORMAL)).toBe('abnormal');
    expect(bandOf(21, USUAL, NORMAL)).toBe('abnormal');
  });

  it('without a normal band, fails outside today’s range as before', () => {
    expect(bandOf(2.5, USUAL)).toBe('abnormal');
    expect(bandOf(4, USUAL)).toBe('usual');
  });

  it('is none for a value that is not a number', () => {
    expect(bandOf(NaN, USUAL, NORMAL)).toBe('none');
  });

  it('marks an unusual value as a warning, never with an arrow', () => {
    const mark = bandMark(2.5, USUAL, NORMAL);
    expect(mark).toBe('  ⚠ unusual for a league (fails outside 1.5–20)');
    expect(mark).not.toMatch(/[▲▼]/);
    expect(bandMark(1, USUAL, NORMAL)).toBe('  ▼ LOW');
    expect(bandMark(30, USUAL, NORMAL)).toBe('  ▲ HIGH');
    expect(bandMark(4, USUAL, NORMAL)).toBe('');
    expect(bandMark(NaN, USUAL, NORMAL)).toBe('  ✗ NOT MEASURED');
  });
});

describe('QB rushing leaders in the careers check', () => {
  const n = LEADER_NORMAL['QB rushing yds'];
  // the careers check's usual band: today's range, widened 5% (`careers.ts`)
  const usualFirst: [number, number] = [618, 1050];
  const usualFifth: [number, number] = [380, 683];
  it('warns, not fails, for the #1 637 and #5 375 that failed CI', () => {
    expect(bandOf(637, usualFirst, n.first)).toBe('usual');
    expect(bandOf(375, usualFifth, n.fifth)).toBe('unusual');
    expect(bandMark(375, usualFifth, n.fifth)).toContain('⚠');
  });
  it('fails outside the normal band', () => {
    expect(bandOf(300, usualFifth, n.fifth)).toBe('abnormal');
    expect(bandOf(500, usualFirst, n.first)).toBe('abnormal');
    expect(bandOf(1200, usualFirst, n.first)).toBe('abnormal');
  });
});
