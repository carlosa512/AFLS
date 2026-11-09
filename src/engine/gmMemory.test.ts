import { describe, expect, it, beforeEach } from 'vitest';
import { createLeague } from './generate';
import { aiGm } from './gmHabits';
import { marginFor } from './trade/judge';
import {
  KEEP_MOMENTS,
  KEEP_SEASONS,
  noteMoment,
  pruneMoments,
  standingBand,
  standingStep,
  standingWith,
  WEIGHTS,
} from './gmMemory';
import type { GeneralManager, League, YouMoment } from './types';

let l: League;
let gm: GeneralManager;
const mk = (over: Partial<YouMoment>): YouMoment => ({ kind: 'trade', season: l.season, phase: l.phase, ...over });

beforeEach(() => {
  l = createLeague({ seed: 'gm-memory' });
  gm = aiGm(l, l.teams[1])!;
});

describe('standing', () => {
  it('is neutral with no moments, and for no GM', () => {
    expect(standingWith(l, gm)).toBe(0);
    expect(standingWith(l, undefined)).toBe(0);
  });
  it('orders the weights', () => {
    expect(WEIGHTS.heWon).toBeGreaterThan(WEIGHTS.tookOffer);
    expect(WEIGHTS.tookOffer).toBeGreaterThan(0);
    expect(WEIGHTS.ledOn).toBeLessThan(0);
    expect(WEIGHTS.finalNo).toBeLessThan(WEIGHTS.ledOn);
    expect(WEIGHTS.youWon).toBeLessThan(WEIGHTS.finalNo);
  });
  it('stays within −1 … 1', () => {
    gm.withYou = Array.from({ length: 12 }, () => mk({ kind: 'finalNo' }));
    expect(standingWith(l, gm)).toBe(-1);
    gm.withYou = Array.from({ length: 12 }, () => mk({ kind: 'trade', verdict: 'heWon' }));
    expect(standingWith(l, gm)).toBe(1);
  });
  it("a stubborn GM's moment outlasts a flexible GM's", () => {
    const at = (s: number) => {
      gm.traits = { ...(gm.traits ?? l.teams[1].gm), stubbornness: s };
      gm.withYou = [mk({ kind: 'trade', season: l.season - 2, verdict: 'youWon' })];
      return standingWith(l, gm);
    };
    const stubborn = at(1);
    const flexible = at(0);
    expect(Math.abs(stubborn)).toBeGreaterThan(Math.abs(flexible));
  });
  it("a big trade's verdict counts one and a half times", () => {
    const one = (big: boolean) => {
      gm.withYou = [mk({ kind: 'trade', verdict: 'youWon', big })];
      return standingWith(l, gm) - WEIGHTS.trade;
    };
    expect(one(true)).toBeCloseTo(1.5 * one(false), 5);
  });
  it('bands and steps', () => {
    expect([0.4, 0.2, 0, -0.2, -0.4].map(standingBand)).toEqual(['warm', 'easy', 'neutral', 'cool', 'sour']);
    expect([0.35, 0.34, -0.34, -0.35].map(standingStep)).toEqual([1, 0, 0, -1]);
  });
});

describe('keeping moments', () => {
  it('keeps six seasons and twelve moments, a big trade the last to go', () => {
    gm.withYou = [mk({ kind: 'trade', big: true }), ...Array.from({ length: 12 }, () => mk({ kind: 'ledOn' }))];
    gm.withYou.push(mk({ kind: 'finalNo', season: l.season - KEEP_SEASONS - 1 }));
    pruneMoments(l, gm);
    expect(gm.withYou).toHaveLength(KEEP_MOMENTS);
    expect(gm.withYou.some((m) => m.big)).toBe(true);
    expect(gm.withYou.some((m) => m.season < l.season - KEEP_SEASONS)).toBe(false);
  });
  it('notes a moment for an AI GM, never for yours or for nobody', () => {
    noteMoment(l, gm, { kind: 'tookOffer' });
    expect(gm.withYou).toHaveLength(1);
    expect(gm.withYou![0]).toMatchObject({ kind: 'tookOffer', season: l.season, phase: l.phase });
    noteMoment(l, l.gms[l.userGmId], { kind: 'tookOffer' });
    expect(l.gms[l.userGmId].withYou).toBeUndefined();
    expect(() => noteMoment(l, undefined, { kind: 'tookOffer' })).not.toThrow();
  });
});

describe('his price', () => {
  it('moves his price with you at most six percent either way', () => {
    const t = l.teams[1];
    const o = l.teams[l.userTeamId];
    expect(marginFor(t, o, true, 1) - marginFor(t, o, true, 0)).toBeCloseTo(-0.06, 9);
    expect(marginFor(t, o, true, -1) - marginFor(t, o, true, 0)).toBeCloseTo(0.06, 9);
  });
});
