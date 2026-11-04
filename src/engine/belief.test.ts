import { describe, expect, it } from 'vitest';
import {
  BELIEF,
  beliefNewYear,
  beliefOf,
  beliefRead,
  beliefWeek,
  isLawyer,
  runnerOf,
  shiftBelief,
  sideGame,
} from './belief';
import { hireCoach, releaseCoach, teamCoaches } from './coaching';
import { gamesInWeek } from './league';
import { moraleContext } from './morale';
import { createLeague } from './generate';
import { playWeek } from './league';
import type { League } from './types';

const base = (() => {
  const l = createLeague({ seed: 'belief' });
  playWeek(l);
  playWeek(l);
  return JSON.stringify(l);
})();
const fresh = (): League => JSON.parse(base);

describe('belief: the store', () => {
  it('reads the four words at their thresholds', () => {
    expect(beliefRead(0.4)).toBe('believes');
    expect(beliefRead(0.39)).toBe('steady');
    expect(beliefRead(-0.2)).toBe('doubts');
    expect(beliefRead(-0.49)).toBe('doubts');
    expect(beliefRead(-0.5)).toBe('lost');
  });

  it('holds belief inside ±1 and reads 0 when unset or vacant', () => {
    const l = fresh();
    const oc = teamCoaches(l, 0).find((c) => c.role === 'offCoord')!;
    expect(beliefOf(oc, 'OL')).toBe(0);
    shiftBelief(oc, 'OL', 5);
    expect(beliefOf(oc, 'OL')).toBe(1);
    shiftBelief(oc, 'OL', -9);
    expect(beliefOf(oc, 'OL')).toBe(-1);
    expect(beliefOf(undefined, 'OL')).toBe(0);
    expect(beliefOf(null, 'OL')).toBe(0);
  });

  it('the runner of a side is the coordinator, else the covering head coach', () => {
    const l = fresh();
    const oc = teamCoaches(l, 0).find((c) => c.role === 'offCoord')!;
    expect(runnerOf(l, 0, 'QB')?.id).toBe(oc.id);
    expect(runnerOf(l, 0, 'DB')?.role).toBe('defCoord');
    oc.teamId = null;
    // A new coaches object is a new index (a hand edit isn't a move through coaching.ts).
    l.coaches = { ...l.coaches };
    const hc = teamCoaches(l, 0).find((c) => c.role === 'headCoach')!;
    expect(runnerOf(l, 0, 'QB')?.id).toBe(hc.id);
    hc.coverOff = ['offCoord'];
    expect(runnerOf(l, 0, 'QB')).toBeNull();
  });
});

describe('belief: the week', () => {
  it('names bad and good games for each side', () => {
    expect(sideGame(13, 20, 'offense')).toBe('bad');
    expect(sideGame(14, 20, 'offense')).toBeNull();
    expect(sideGame(20, 30, 'defense')).toBe('bad');
    expect(sideGame(10, 31, 'offense')).toBe('bad');
    expect(sideGame(28, 10, 'offense')).toBe('good');
    expect(sideGame(21, 14, 'defense')).toBe('good');
    expect(sideGame(27, 10, 'offense')).toBeNull();
  });

  it("a bad game drops his side's rooms, a lawyer's room three times as far", () => {
    const l = fresh();
    const t = 0;
    const ctx = moraleContext(l);
    // A voice in one offensive room made a lawyer, in good spirits; another offensive room with none.
    const rooms = ['QB', 'RB', 'WR', 'OL'] as const;
    const withVoice = rooms.find((r) => (ctx.voices.get(`${t}:${r}`) ?? []).length)!;
    const lawyer = l.players[ctx.voices.get(`${t}:${withVoice}`)![0].id];
    lawyer.traits = { ...lawyer.traits, leads: 20, controversy: 20 };
    lawyer.morale = { level: 2, jolts: [] };
    expect(isLawyer(lawyer)).toBe(true);
    const plain = rooms.find(
      (r) => r !== withVoice && !(ctx.voices.get(`${t}:${r}`) ?? []).some((v) => isLawyer(l.players[v.id])),
    )!;
    const g = gamesInWeek(l).find((x) => x.homeId === t || x.awayId === t)!;
    const done = l.games.find((x) => x.result)!.result!;
    g.result = { ...done, homeScore: g.homeId === t ? 10 : 24, awayScore: g.homeId === t ? 24 : 10 };
    beliefWeek(l);
    const oc = runnerOf(l, t, 'QB')!;
    const dropLawyer = beliefOf(oc, withVoice);
    const dropPlain = beliefOf(oc, plain);
    expect(dropLawyer - dropPlain).toBeCloseTo((BELIEF.lawyer - 1) * BELIEF.badGame, 3);
    // The defense allowed 24 in a 14-point loss: not a bad game on its side.
    expect(beliefOf(runnerOf(l, t, 'DL'), 'DL')).toBeGreaterThan(dropPlain);
  });

  it('drifts back toward the middle and halves at the new league year', () => {
    const l = fresh();
    const oc = runnerOf(l, 0, 'OL')!;
    shiftBelief(oc, 'OL', -0.5);
    for (const g of gamesInWeek(l)) delete g.result;
    beliefWeek(l);
    expect(beliefOf(oc, 'OL')).toBeCloseTo(-0.4875, 4);
    beliefNewYear(l);
    expect(beliefOf(oc, 'OL')).toBeCloseTo(-0.244, 3);
  });

  it('a coordinator taking a new job starts every room at 0', () => {
    const l = fresh();
    const oc = runnerOf(l, 0, 'OL')!;
    shiftBelief(oc, 'OL', -0.4);
    l.phase = 'resign';
    releaseCoach(l, 0, oc.id);
    expect(oc.belief).toBeUndefined();
    shiftBelief(oc, 'OL', -0.4);
    const other = runnerOf(l, 1, 'OL')!;
    releaseCoach(l, 1, other.id);
    hireCoach(l, 1, oc.id, 1);
    expect(oc.belief).toBeUndefined();
  });
});
