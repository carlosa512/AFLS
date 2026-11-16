import { describe, expect, it } from 'vitest';
import { createLeague } from '../generate';
import { ageShift } from '../aging';
import { playerOvr } from '../positions';
import { FADING, fadingBar, fillReserve, inSeasonReserve, SPEND_FIRST, spendable } from './ai';

describe('free agency passes more on fading veterans (market and exits)', () => {
  const l = createLeague({ seed: 'fading' });
  const p = Object.values(l.players).find((x) => x.position === 'WR')!;
  const at = (clock: number) => ({ ...p, age: clock + ageShift(p.position) });

  it('a veteran 32 or older on his clock and headed down needs a bigger gain', () => {
    expect(FADING.bar).toBeGreaterThan(1);
    expect(fadingBar(at(FADING.age), playerOvr(p) - 0.5)).toBe(FADING.bar);
  });

  it('a younger man, or an old one not headed down, is judged as before', () => {
    expect(fadingBar(at(FADING.age - 1), playerOvr(p) - 0.5)).toBe(1);
    expect(fadingBar(at(FADING.age + 1), playerOvr(p))).toBe(1);
  });
});

describe('AI clubs spend first in free agency (market and exits)', () => {
  it('in its first days a club may spend its in-season cushion and half its fill reserve, then keeps them again', () => {
    const l = createLeague({ seed: 'spend-first' });
    const team = l.teams.find((t) => t.id !== l.userTeamId)!;
    l.phase = 'freeAgency';
    l.faDay = SPEND_FIRST.days + 1;
    const later = spendable(l, team.id);
    l.faDay = 1;
    const early = spendable(l, team.id);
    expect(early - later).toBeCloseTo(inSeasonReserve(l, team.id) + SPEND_FIRST.fillShare * fillReserve(l, team.id), 0);
    l.phase = 'resign';
    expect(spendable(l, team.id)).toBeCloseTo(later, 0);
  });
});
