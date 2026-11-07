import { describe, expect, it } from 'vitest';
import type { QuirkId } from '../quirks';
import {
  escapeOdds,
  fightsForIt,
  sackLoss,
  slideOdds,
  slideReason,
  type SackFacts,
  type SlideFacts,
} from './dropbackEnd';

const habits =
  (...qs: QuirkId[]) =>
  (q: QuirkId) =>
    qs.includes(q);
const sack = (over: Partial<SackFacts> = {}, qb: Partial<SackFacts['qb']> = {}): SackFacts => ({
  down: 1,
  toGo: 10,
  yardLine: 40,
  call: 'base',
  ...over,
  qb: { pocketPresence: 12, scrambling: 12, has: habits(), ...qb },
});
const slide = (
  over: Partial<SlideFacts> = {},
  qb: Partial<SlideFacts['qb']> = {},
  chaser: Partial<SlideFacts['chaser']> = {},
): SlideFacts => ({
  down: 2,
  toGo: 10,
  gained: 5,
  scoreDiff: 0,
  late: false,
  toGoal: 50,
  ...over,
  qb: {
    scrambling: 12,
    weightZ: 0,
    temperament: 10.5,
    poise: 10,
    age: 27,
    concussions: 0,
    energy: 85,
    hurt: 0,
    has: habits(),
    ...qb,
  },
  chaser: { tackling: 12, has: habits(), ...chaser },
});
/** Mean loss over an even grid of draws. */
const mean = (f: SackFacts, escaped = false) => {
  let sum = 0;
  for (let i = 0; i < 400; i++) sum += sackLoss(f, escaped, (i + 0.5) / 400);
  return sum / 400;
};

describe("a sack's yards", () => {
  it('never passes his own goal line, can cost nothing, and is whole yards', () => {
    for (let yl = 0; yl <= 5; yl++)
      for (let i = 0; i < 100; i++) {
        const l = sackLoss(sack({ yardLine: yl }), i % 2 === 0, i / 100);
        expect(l).toBeLessThanOrEqual(yl);
        expect(l).toBeGreaterThanOrEqual(0);
        expect(Number.isInteger(l)).toBe(true);
      }
    expect(sackLoss(sack(), false, 0)).toBe(0);
  });

  it('leans on the down, the rush, the escape, the spot and the man', () => {
    expect(mean(sack({ down: 3, toGo: 10 }))).toBeGreaterThan(mean(sack()));
    expect(mean(sack({ call: 'blitz' }))).toBeGreaterThan(mean(sack()));
    expect(mean(sack())).toBeGreaterThan(mean(sack({ call: 'passD' })));
    expect(mean(sack(), true)).toBeLessThan(mean(sack()));
    expect(mean(sack({ yardLine: 8 }))).toBeLessThan(mean(sack()));
    expect(mean(sack({}, { pocketPresence: 16 }))).toBeLessThan(mean(sack({}, { pocketPresence: 8 })));
    expect(mean(sack({}, { has: habits('muddyPockets') }))).toBeGreaterThan(mean(sack()));
  });

  it('escapes the pocket about one sack in four, more with legs and a man who bails', () => {
    expect(escapeOdds(sack())).toBeCloseTo(0.228, 1);
    expect(escapeOdds(sack({}, { scrambling: 16 }))).toBeGreaterThan(escapeOdds(sack()));
    expect(escapeOdds(sack({}, { has: habits('bailsEarly') }))).toBeGreaterThan(escapeOdds(sack()));
  });
});

describe('the slide', () => {
  it('leans on the sticks, the score and the clock, the chase and the man', () => {
    const base = slideOdds(slide());
    expect(slideOdds(slide({ gained: 11 }))).toBeGreaterThan(base);
    expect(slideOdds(slide({ late: true, scoreDiff: 7 }))).toBeGreaterThan(slideOdds(slide({ late: true })));
    expect(slideOdds(slide({ late: true, scoreDiff: -7 }))).toBeLessThan(slideOdds(slide({ late: true })));
    expect(slideOdds(slide({ down: 3, toGo: 5, gained: 3 }))).toBeLessThan(slideOdds(slide({ toGo: 5, gained: 3 })));
    expect(slideOdds(slide({ toGoal: 3 }))).toBeLessThan(base);
    expect(slideOdds(slide({}, {}, { has: habits('thumper') }))).toBeGreaterThan(base);
    expect(slideOdds(slide({}, { concussions: 2 }))).toBeGreaterThan(base);
    expect(slideOdds(slide({}, { scrambling: 16 }))).toBeLessThan(base);
    expect(slideOdds(slide({}, { has: habits('gunslinger') }))).toBeLessThan(base);
    expect(slideOdds(slide({}, { has: habits('bailsEarly') }))).toBeGreaterThan(base);
    for (const f of [
      slide(),
      slide({ gained: 30, late: true, scoreDiff: 7 }),
      slide({ down: 4, gained: 0, toGo: 9 }),
    ]) {
      expect(slideOdds(f)).toBeGreaterThan(0);
      expect(slideOdds(f)).toBeLessThan(1);
    }
  });

  it('reads the first down in hand at the sticks exactly', () => {
    const f = slide({ down: 3, toGo: 4, gained: 4 });
    expect(slideReason(f)).toBe('firstDown');
    expect(fightsForIt(f)).toBe(false);
  });

  it('names the strongest reason', () => {
    expect(slideReason(slide({ gained: 12 }))).toBe('firstDown');
    expect(slideReason(slide({ late: true, scoreDiff: 7 }))).toBe('clock');
    expect(slideReason(slide({}, {}, { has: habits('thumper') }))).toBe('hit');
  });

  it('fights for it short of the sticks on 3rd and 4th, or on 2nd with a short fuse', () => {
    expect(fightsForIt(slide({ down: 3, toGo: 6, gained: 3 }))).toBe(true);
    expect(fightsForIt(slide({ down: 4, toGo: 2, gained: 1 }))).toBe(true);
    expect(fightsForIt(slide({ down: 2, toGo: 6, gained: 3 }, { temperament: 5 }))).toBe(true);
    expect(fightsForIt(slide({ down: 2, toGo: 6, gained: 3 }, { temperament: 12 }))).toBe(false);
    expect(fightsForIt(slide({ down: 3, toGo: 6, gained: 7 }))).toBe(false);
  });
});
