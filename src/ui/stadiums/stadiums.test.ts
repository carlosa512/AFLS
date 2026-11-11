import { describe, expect, it } from 'vitest';
import { at, DECKS, wallLine } from './bowl';
import { toFrame } from './camera';
import { lum } from './colour';
import { crowdPalette, sectionFill, turnoutOf } from './crowd';
import { recorder } from './pen';

describe('the camera', () => {
  it('puts the field where the owner approved it', () => {
    expect(toFrame(60, 0, 0).x).toBeCloseTo(327.93, 1);
    expect(toFrame(60, 0, 0).y).toBeCloseTo(171.98, 1);
    expect(toFrame(-60, 0, 0).x).toBeCloseTo(32.07, 1);
    expect(toFrame(60, 0, 53.33).x).toBeCloseTo(280, 1);
    expect(toFrame(60, 0, 53.33).y).toBeCloseTo(90, 1);
  });
  it('draws what is further away smaller and higher, and what is taller higher', () => {
    expect(toFrame(0, 0, 53.33).depth).toBeGreaterThan(toFrame(0, 0, 0).depth);
    expect(toFrame(0, 0, 26.665).y).toBeCloseTo(123.06, 1); // midfield is not halfway up: the far half is shorter
    expect(toFrame(0, 10, 26.665).y).toBeLessThan(toFrame(0, 0, 26.665).y);
  });
});

describe('the bowl', () => {
  it('runs from the near-left end, round the far side, to the near-right end', () => {
    const w = wallLine();
    expect(w[0]).toMatchObject({ x: -67, z: -12, part: 'L' });
    expect(w[w.length - 1]).toMatchObject({ x: 67, part: 'R' });
    expect(w[w.length - 1].z).toBeCloseTo(-12, 0); // the right end steps down from the corner, so it ends a third of a yard short
    expect(w.filter((p) => p.part === 'F').every((p) => Math.abs(p.z - 60.33) < 0.01)).toBe(true);
    expect(w.every((p, i) => p.i === i && (i === 0 || p.u > w[i - 1].u))).toBe(true);
    expect(at(w[0], 0, 0)).toEqual(toFrame(-67, 0, -12));
  });
  it('keeps the decks low: the top row is 21.4 yards up, 31 yards back', () => {
    expect(DECKS.map((d) => d.rows)).toEqual([14, 6, 14]);
    expect(DECKS[2]).toMatchObject({ d1: 31, y1: 21.4 });
  });
});

describe('the pen', () => {
  it('records what was drawn, in order', () => {
    const r = recorder();
    r.poly(
      [
        [0, 0],
        [1, 0],
        [1, 1],
      ],
      '#fff',
    );
    r.dot(1, 1, 1, '#000');
    expect(r.shapes.map((s) => s.kind)).toEqual(['poly', 'dot']);
  });
});

describe('who turns up', () => {
  const rec = (w: number, l: number, t = 0) => ({ w, l, t });
  it('reads the record: .600 fills the ground, under .400 half of it', () => {
    expect(turnoutOf(rec(6, 4), 5, false)).toBe('winning');
    expect(turnoutOf(rec(5, 5), 5, false)).toBe('even');
    expect(turnoutOf(rec(4, 6), 5, false)).toBe('even');
    expect(turnoutOf(rec(3, 7), 5, false)).toBe('losing');
  });
  it('treats no record as even, a tie as half a win, the early home games kindly and the playoffs as full', () => {
    expect(turnoutOf(rec(0, 0), 0, false)).toBe('even');
    expect(turnoutOf(rec(5, 4, 1), 5, false)).toBe('even'); // .550
    expect(turnoutOf(rec(0, 4), 2, false)).toBe('even'); // a third home game
    expect(turnoutOf(rec(0, 5), 3, false)).toBe('losing');
    expect(turnoutOf(rec(9, 8), 8, true)).toBe('winning');
  });
  it('empties the upper deck and the ends first, and never fills or empties a section outright', () => {
    expect(sectionFill(0.52, 2, 'L', 0)).toBeLessThan(sectionFill(0.52, 0, 'F', 0));
    expect(sectionFill(0.97, 2, 'L', -0.5)).toBeGreaterThan(0.9);
    expect(sectionFill(0.03, 2, 'L', -0.5)).toBeGreaterThanOrEqual(0.03);
    expect(sectionFill(1, 0, 'F', 0.5)).toBeLessThanOrEqual(0.985);
  });
  it('dresses a crowd you can see, whatever the club’s colours', () => {
    expect(crowdPalette(['#000000', '#101010']).every((c) => lum(c) > 0.2)).toBe(true);
    expect(crowdPalette(['#fb4f14', '#002244'])[0]).toBe('#fb4f14');
  });
});
