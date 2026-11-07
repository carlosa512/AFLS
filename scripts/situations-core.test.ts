import { describe, expect, it } from 'vitest';
import { judgeSituations, newSituationTally, tapSituation } from './situations-core';

const line = (lines: ReturnType<typeof judgeSituations>, label: string) => lines.find((l) => l.label === label)!;
const inRange = (l: { value: number; range: [number, number] }) => l.value >= l.range[0] && l.value <= l.range[1];

describe('the situations check', () => {
  it("judges incompletions' time against the NFL's", () => {
    const at = (seconds: number) => {
      const t = newSituationTally();
      for (let i = 0; i < 2000; i++)
        tapSituation(t, {
          kind: 'time',
          play: 'incomplete',
          yards: 0,
          air: 5,
          seconds: seconds + (i % 3) - 1,
          field: false,
        });
      return line(judgeSituations(t), 'time: incomplete, 0-9 air');
    };
    expect(inRange(at(4.36))).toBe(true);
    expect(at(4.36).info).toBeUndefined();
    expect(inRange(at(5.9))).toBe(false);
  });

  it('judges the share of early tries that go for two', () => {
    const t = newSituationTally();
    for (let i = 0; i < 4000; i++)
      tapSituation(t, { kind: 'try', quarter: 2, scoreDiff: 6, appetite: 0, goes: i % 1000 < 46 });
    const l = line(judgeSituations(t), 'two: share, quarters 1-3');
    expect(inRange(l)).toBe(true);
    expect(l.info).toBeUndefined();
  });

  it('reports the coverage, never judges it', () => {
    const t = newSituationTally();
    for (let i = 0; i < 100; i++)
      tapSituation(t, {
        kind: 'return',
        play: 'kickoff',
        yards: 25,
        td: false,
        returner: 0,
        returnerId: 1,
        coverage: i % 2 ? 2 : -2,
      });
    for (const l of judgeSituations(t).filter((x) => x.label.includes('coverage'))) expect(l.info).toBe(true);
  });
});
