import { describe, expect, it } from 'vitest';
import type { QuirkId } from '../quirks';
import { Rng } from '../rng';
import { FIELD_W } from './geometry';
import { clampToField, moveSegs, pickMove, type MoveKind } from './carrier';

const KINDS: MoveKind[] = ['juke', 'jumpCut', 'spin', 'runThrough', 'stiffArm'];
const none = new Set<QuirkId>();
const habits = (...q: QuirkId[]) => new Set<QuirkId>(q);
const headings = Array.from({ length: 8 }, (_, i) => ({
  x: Math.cos((i * Math.PI) / 4),
  y: Math.sin((i * Math.PI) / 4),
}));
const spots = [
  { x: 50, y: 26 },
  { x: 50, y: 1.2 },
  { x: 50, y: FIELD_W - 1.2 },
  { x: -8.5, y: 20 },
  { x: 108.5, y: 30 },
  { x: 1, y: 2 },
];
const speed = (s: { x0: number; y0: number; x1: number; y1: number; dur: number }) =>
  Math.hypot(s.x1 - s.x0, s.y1 - s.y0) / s.dur;
const pace = (segs: ReturnType<typeof moveSegs>) =>
  segs.reduce((t, s) => t + Math.hypot(s.x1 - s.x0, s.y1 - s.y0), 0) / segs.reduce((t, s) => t + s.dur, 0);

describe("a ball carrier's moves", () => {
  it("ends every move on the carrier's line of run, inside the field, never quicker than his pace", () => {
    for (const kind of KINDS)
      for (const h of headings)
        for (const at of spots)
          for (const side of [1, -1] as const) {
            const segs = moveSegs(kind, at, h, 8, side);
            expect(segs.length).toBeGreaterThan(0);
            expect(segs[0].x0).toBeCloseTo(at.x, 5);
            expect(segs[0].y0).toBeCloseTo(at.y, 5);
            for (const s of segs) {
              expect(s.move).toBe(kind);
              expect(s.peak).toBe(0);
              for (const p of [
                { x: s.x0, y: s.y0 },
                { x: s.x1, y: s.y1 },
              ])
                expect(clampToField(p)).toEqual(p);
              expect(speed(s)).toBeLessThanOrEqual(8.01);
            }
            for (let i = 1; i < segs.length; i++) {
              expect(segs[i].x0).toBeCloseTo(segs[i - 1].x1, 5);
              expect(segs[i].y0).toBeCloseTo(segs[i - 1].y1, 5);
            }
            const end = segs[segs.length - 1];
            // Distance from the line through `at` along the heading.
            const off = Math.abs((end.x1 - at.x) * h.y - (end.y1 - at.y) * h.x);
            expect(off, `${kind} ${JSON.stringify(at)} ${JSON.stringify(h)} ${side}`).toBeLessThan(0.3);
          }
  });

  it('slows the carrier through a run-through and a spin, not through a juke', () => {
    const at = { x: 50, y: 26 };
    const h = { x: 1, y: 0 };
    expect(pace(moveSegs('runThrough', at, h, 8, 1))).toBeLessThan(8 * 0.7);
    expect(pace(moveSegs('spin', at, h, 8, 1))).toBeLessThan(4.5);
    expect(pace(moveSegs('stiffArm', at, h, 8, 1))).toBeLessThan(8 * 0.9);
    expect(pace(moveSegs('jumpCut', at, h, 8, 1))).toBeLessThanOrEqual(4.01);
    expect(pace(moveSegs('juke', at, h, 8, 1))).toBeGreaterThanOrEqual(8 * 0.6);
    // A juke is a sharp step to one side.
    const juke = moveSegs('juke', at, h, 8, 1);
    expect(Math.max(...juke.map((s) => s.y1 - at.y))).toBeCloseTo(1.5, 1);
  });

  it('picks size moves for size and footwork for the rest, the same way every time', () => {
    const seen = { size: new Set<MoveKind>(), move: new Set<MoveKind>() };
    for (let i = 0; i < 200; i++)
      for (const how of ['size', 'move'] as const) {
        const k = pickMove(how, none, none, new Rng(`m${i}`));
        expect(pickMove(how, none, none, new Rng(`m${i}`))).toBe(k);
        seen[how].add(k);
      }
    expect([...seen.size].sort()).toEqual(['runThrough', 'stiffArm']);
    expect([...seen.move].sort()).toEqual(['juke', 'jumpCut', 'spin']);
  });

  it('lets the habits pick: a jump-cutter jump-cuts, an arm tackle is run through, a contact-averse back never runs through', () => {
    for (let i = 0; i < 100; i++) {
      const rng = () => new Rng(`h${i}`);
      expect(pickMove('move', habits('jumpCutter'), none, rng())).toBe('jumpCut');
      expect(pickMove('move', habits('highKnee'), none, rng())).toBe('runThrough');
      expect(pickMove('move', none, habits('armTackler'), rng())).toBe('runThrough');
      expect(pickMove('size', habits('contactAverse'), none, rng())).toBe('juke');
      for (const how of ['size', 'move'] as const)
        expect(['runThrough', 'stiffArm']).not.toContain(
          pickMove(how, habits('contactAverse', 'highKnee'), habits('armTackler'), rng()),
        );
    }
  });
});
