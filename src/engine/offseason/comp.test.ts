import { describe, expect, it } from 'vitest';
import { capFor, logTransaction } from '../finance/cap';
import { createLeague } from '../generate';
import type { League, Phase } from '../types';
import { COMP, compMoves, compRound, compTally } from './comp';
import { signPlayer } from './negotiation';

const league = () => {
  const l = createLeague({ seed: 'comp' });
  l.phase = 'freeAgency';
  return l;
};
/** A pay (in $K) that lands in `round`'s band. */
const payFor = (l: League, round: 3 | 4 | 5 | 6 | 7) =>
  Math.ceil(capFor(l, l.season) * COMP.bands.find((b) => b.round === round)!.share) + 1;
let nextId = 9000;
const walk = (l: League, from: number, to: number, round: 3 | 4 | 5 | 6 | 7, phase: Phase = 'freeAgency') => {
  l.phase = phase;
  const id = nextId++;
  logTransaction(l, 'sign', [to], 'signed', id, { from, apy: payFor(l, round) });
  l.phase = 'freeAgency';
  return id;
};

describe('compRound', () => {
  it('lands a share at each band edge in that band, and under the floor is null', () => {
    const cap = 1_000_000;
    for (const b of COMP.bands) expect(compRound(b.share * cap, cap)).toBe(b.round);
    expect(compRound(COMP.floor * cap - 1, cap)).toBeNull();
    expect(compRound(0.5 * cap, cap)).toBe(3);
  });
});

describe('compMoves', () => {
  it('a walker is one loss for the old team and one gain for the new', () => {
    const l = league();
    const id = walk(l, 1, 2, 4);
    const m = compMoves(l);
    expect(m.losses).toMatchObject([{ playerId: id, teamId: 1, round: 4 }]);
    expect(m.gains).toMatchObject([{ playerId: id, teamId: 2, round: 4 }]);
  });
  it('a signing with no from (a released veteran) is neither', () => {
    const l = league();
    logTransaction(l, 'sign', [2], 'signed', 5);
    expect(compMoves(l)).toEqual({ losses: [], gains: [] });
  });
  it('a signing in the preseason is neither', () => {
    const l = league();
    walk(l, 1, 2, 4, 'preseason');
    expect(compMoves(l)).toEqual({ losses: [], gains: [] });
  });
  it('a walker who re-signs with his own team is neither (real signing function)', () => {
    const l = league();
    const p = Object.values(l.players).find((q) => q.teamId === 0 && q.contract)!;
    l.phase = 'freeAgency';
    signPlayer(l, p, 0, { years: 3, apy: payFor(l, 3), guaranteed: 0 } as never);
    expect(compMoves(l)).toEqual({ losses: [], gains: [] });
  });
  it('a free agent signing elsewhere through signPlayer records his last team and pay', () => {
    const l = league();
    const p = Object.values(l.players).find((q) => q.teamId === 0 && q.contract)!;
    p.statTeams = { [l.season - 1]: [0] };
    p.left = [];
    p.teamId = null;
    p.contract = null;
    signPlayer(l, p, 5, { years: 3, apy: payFor(l, 3), guaranteed: 0 } as never);
    expect(l.transactions.at(-1)).toMatchObject({ from: 0, apy: payFor(l, 3), kind: 'sign' });
    expect(compMoves(l).gains).toMatchObject([{ teamId: 5, round: 3 }]);
    expect(compMoves(l).losses).toMatchObject([{ teamId: 0, round: 3 }]);
  });
});

describe('compTally', () => {
  const lose = (l: League, rounds: (3 | 4 | 5 | 6 | 7)[]) => rounds.forEach((r) => walk(l, 1, 20, r));
  const gain = (l: League, round: 3 | 4 | 5 | 6 | 7) => walk(l, 21, 1, round);
  it('a round 4 gain cancels a round 4 loss before a round 5', () => {
    const l = league();
    lose(l, [5, 4]);
    gain(l, 4);
    expect(compTally(l, 1).picks.map((p) => p.round)).toEqual([5]);
  });
  it('a round 5 gain with losses 3 and 6 cancels the 6', () => {
    const l = league();
    lose(l, [3, 6]);
    gain(l, 5);
    expect(compTally(l, 1).picks.map((p) => p.round)).toEqual([3]);
  });
  it('a round 5 gain with losses 4 and 6 cancels the 6', () => {
    const l = league();
    lose(l, [4, 6]);
    gain(l, 5);
    expect(compTally(l, 1).picks.map((p) => p.round)).toEqual([4]);
  });
  it('a round 5 gain with losses 4 and 7 cancels the 7', () => {
    const l = league();
    lose(l, [4, 7]);
    gain(l, 5);
    expect(compTally(l, 1).picks.map((p) => p.round)).toEqual([4]);
  });
  it('a round 7 gain with losses 3 and 4 cancels the 4, the worst left', () => {
    const l = league();
    lose(l, [3, 4]);
    gain(l, 7);
    expect(compTally(l, 1).picks.map((p) => p.round)).toEqual([3]);
  });
  it('a round 3 gain with losses 5 and 6 cancels the 5', () => {
    const l = league();
    lose(l, [5, 6]);
    gain(l, 3);
    expect(compTally(l, 1).picks.map((p) => p.round)).toEqual([6]);
  });
  it('six round 6 losses and no gains give four picks', () => {
    const l = league();
    lose(l, [6, 6, 6, 6, 6, 6]);
    expect(compTally(l, 1).picks).toHaveLength(4);
  });
  it('extraGain changes the result as signing him would', () => {
    const l = league();
    lose(l, [4]);
    expect(compTally(l, 1).picks).toHaveLength(1);
    const t = compTally(l, 1, { extraGain: { playerId: 1, apy: payFor(l, 4) } });
    expect(t.picks).toHaveLength(0);
    expect(t.cancelled).toHaveLength(1);
  });
});
