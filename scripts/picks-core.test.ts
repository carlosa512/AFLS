import { describe, expect, it } from 'vitest';
import type { DefendedTap } from '../src/engine/match/gameSim';
import { judgePicks, newPickTally, tapDefended } from './picks-core';
import type { Line } from './sideline-core';

const inRange = (l: Line) => !!l.info || (Number.isFinite(l.value) && l.value >= l.range[0] && l.value <= l.range[1]);
const deepPick = (group: DefendedTap['group']): DefendedTap => ({
  band: 'deep',
  outcome: 'pick',
  group,
  batted: false,
  returnYds: 0,
});

describe('the picks check', () => {
  it('judges who picks off a deep ball against the NFL’s split', () => {
    const ok = newPickTally();
    for (let i = 0; i < 2000; i++) tapDefended(ok, deepPick(i % 100 < 53 ? 'S' : 'CB'));
    const line = (t: ReturnType<typeof newPickTally>) =>
      judgePicks(t).find((l) => l.label === 'picks, deep: by the safeties')!;
    expect(inRange(line(ok))).toBe(true);
    expect(line(ok).info).toBeUndefined();
    const off = newPickTally();
    for (let i = 0; i < 2000; i++) tapDefended(off, deepPick(i % 100 < 20 ? 'S' : 'CB'));
    expect(inRange(line(off))).toBe(false);
  });

  it('reports a mean return, judging nothing', () => {
    const t = newPickTally();
    for (let i = 0; i < 2000; i++) tapDefended(t, { ...deepPick('S'), returnYds: i % 10 });
    expect(judgePicks(t).find((l) => l.label === 'picks, deep: mean return')!.info).toBe(true);
  });

  it('judges who breaks it up by the throw’s depth: the line bats a screen, not a bomb', () => {
    const t = newPickTally();
    for (let i = 0; i < 4000; i++)
      tapDefended(t, { band: 'deep', outcome: 'breakup', group: i % 100 < 15 ? 'DL' : 'CB', batted: i % 100 < 15 });
    const line = judgePicks(t).find((l) => l.label === 'breakups, deep: by the line')!;
    expect(line).toBeDefined();
    expect(inRange(line)).toBe(false);
  });
});
