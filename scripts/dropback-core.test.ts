import { describe, expect, it } from 'vitest';
import type { EndingTap } from '../src/engine/match/gameSim';
import { judgeEndings, newEndingTally, tapEnding } from './dropback-core';
import type { Line } from './sideline-core';

const inRange = (l: Line) => !!l.info || (Number.isFinite(l.value) && l.value >= l.range[0] && l.value <= l.range[1]);
const sack = (loss: number): EndingTap => ({
  kind: 'sack',
  down: 1,
  toGo: 10,
  call: 'base',
  escaped: false,
  loss,
  yardLine: 40,
});
const line = (t: ReturnType<typeof newEndingTally>, label: string) => judgeEndings(t).find((l) => l.label === label)!;

describe('the dropback check', () => {
  it("judges sacks that cost nothing against the NFL's share", () => {
    const ok = newEndingTally();
    for (let i = 0; i < 4000; i++) tapEnding(ok, sack(i % 100 < 7 ? 0 : 7));
    expect(line(ok, 'sacks: no loss').info).toBeUndefined();
    expect(inRange(line(ok, 'sacks: no loss'))).toBe(true);
    const off = newEndingTally();
    for (let i = 0; i < 4000; i++) tapEnding(off, sack(i % 100 < 25 ? 0 : 7));
    expect(inRange(line(off, 'sacks: no loss'))).toBe(false);
  });

  it('reports the slide share, never judging it', () => {
    const t = newEndingTally();
    for (let i = 0; i < 4000; i++)
      tapEnding(t, { kind: 'scramble', down: 2, toGo: 10, slid: i % 2 === 0, tackled: true, firstDown: false });
    const l = line(t, 'scrambles in bounds: slid');
    expect(l.info).toBe(true);
    expect(l.value).toBeCloseTo(0.5, 2);
  });
});
