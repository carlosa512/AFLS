import { describe, expect, it } from 'vitest';
import { createLeague } from './generate';
import {
  MORALE_WORDS,
  moraleContext,
  moraleFactors,
  moraleReasons,
  moraleStepOf,
  moraleTarget,
  moraleView,
  type MoraleFactors,
} from './morale';
import { playerOvr, STARTERS } from './positions';
import { activeRoster } from './roster';
import type { League, Player } from './types';

const league = createLeague({ seed: 'morale' });
const team0 = activeRoster(league, 0);

/** His team's best at his position: a starter by rank. */
function starter(pos: Player['position'] = 'WR'): Player {
  return team0.filter((p) => p.position === pos).sort((a, b) => playerOvr(b) - playerOvr(a))[0];
}

/** A veteran on a veteran deal: the best such man on team 0. */
function veteran(): Player {
  return team0
    .filter((p) => p.contract?.kind === 'veteran' && p.experience >= 3)
    .sort((a, b) => playerOvr(b) - playerOvr(a))[0];
}

/** A copy of the league with one player replaced, so a test can change him without touching the shared league. */
function withPlayer(p: Player): League {
  return { ...league, players: { ...league.players, [p.id]: p } };
}

const ZERO: MoraleFactors = { contract: 0, role: 0, team: 0, room: 0, promises: 0, rest: 0 };

describe('morale: the factors', () => {
  it('reads a starter paid half his market as unhappy with his deal, more so in his final year', () => {
    const s = veteran();
    const ctx = moraleContext(league);
    const paid = moraleFactors(league, s, ctx).contract;
    const half: Player = {
      ...s,
      contract: { ...s.contract!, apy: s.contract!.apy / 2, years: s.contract!.years.slice(0, 3) },
    };
    const under = moraleFactors(withPlayer(half), half, ctx).contract;
    const last: Player = { ...half, contract: { ...half.contract!, years: half.contract!.years.slice(0, 1) } };
    const final = moraleFactors(withPlayer(last), last, ctx).contract;
    expect(under).toBeLessThan(paid);
    expect(final).toBeLessThan(under);
    expect(final).toBeGreaterThanOrEqual(-4);
  });

  it('never reads a rookie deal in its first seasons as a grievance', () => {
    const s = starter();
    const rookie: Player = {
      ...s,
      experience: 1,
      contract: { ...s.contract!, kind: 'rookie', apy: 100 },
    };
    expect(moraleFactors(withPlayer(rookie), rookie, moraleContext(league)).contract).toBeGreaterThanOrEqual(0);
  });

  it('caps a contract at its range', () => {
    const s = starter();
    const rich: Player = { ...s, contract: { ...s.contract!, apy: s.contract!.apy * 50 } };
    expect(moraleFactors(withPlayer(rich), rich, moraleContext(league)).contract).toBeLessThanOrEqual(2);
  });

  it('reads a starter who has not played after three games as wanting more snaps', () => {
    const s = { ...starter(), experience: 4 };
    const ctx = moraleContext(league);
    ctx.records.get(0)!.w = 3;
    ctx.live.WR = 300;
    expect(moraleFactors(league, s, ctx).role).toBeLessThan(0);
    expect(moraleFactors(league, s, ctx).role).toBeGreaterThanOrEqual(-3);
  });

  it('reads a backup with no games yet as content: no role to compare', () => {
    const backup = team0
      .filter((p) => p.position === 'WR')
      .sort((a, b) => playerOvr(b) - playerOvr(a))
      .at(-1)!;
    expect(moraleFactors(league, backup, moraleContext(league)).role).toBe(0);
    expect(STARTERS.WR).toBeGreaterThan(0);
  });

  it('reads winning as good for the team factor, more for a man who wants to win', () => {
    const s = starter();
    const ctx = moraleContext(league);
    Object.assign(ctx.records.get(0)!, { w: 10, l: 2 });
    const keen: Player = { ...s, personality: { ...s.personality, winning: 1 } };
    const cool: Player = { ...s, personality: { ...s.personality, winning: 0 } };
    const k = moraleFactors(withPlayer(keen), keen, ctx).team;
    const c = moraleFactors(withPlayer(cool), cool, ctx).team;
    expect(c).toBeGreaterThan(0);
    expect(k).toBeGreaterThan(c);
    expect(k).toBeLessThanOrEqual(2);
    Object.assign(ctx.records.get(0)!, { w: 1, l: 11 });
    expect(moraleFactors(withPlayer(keen), keen, ctx).team).toBeLessThan(0);
  });

  it('reads a feud as down and the C as up for the locker room', () => {
    const [a, b] = team0;
    const base = moraleFactors(league, { ...a, ties: [] }, moraleContext(league)).room;
    const feud: Player = { ...a, ties: [{ kind: 'feud', with: b.id, since: league.season }] };
    expect(moraleFactors(withPlayer(feud), feud, moraleContext(league)).room).toBeLessThan(base);
    const captained: League = {
      ...league,
      teams: league.teams.map((t) =>
        t.id === 0
          ? { ...t, captains: { season: league.season, offense: a.id, defense: b.id, specialTeams: b.id } }
          : t,
      ),
    };
    const cap = { ...a, ties: [] };
    expect(moraleFactors(captained, cap, moraleContext(captained)).room).toBeGreaterThan(base);
  });

  it('rests a calm, patient, loyal man above a volatile, impatient one', () => {
    const s = starter();
    const calm: Player = {
      ...s,
      shifts: undefined,
      traits: { ...s.traits, temperament: 18 },
      personality: { ...s.personality, patience: 1, loyalty: 1 },
    };
    const hot: Player = {
      ...s,
      shifts: undefined,
      traits: { ...s.traits, temperament: 3 },
      personality: { ...s.personality, patience: 0, loyalty: 0 },
    };
    const ctx = moraleContext(league);
    const r1 = moraleFactors(withPlayer(calm), calm, ctx).rest;
    const r2 = moraleFactors(withPlayer(hot), hot, ctx).rest;
    expect(r1).toBeGreaterThan(0);
    expect(r2).toBeLessThan(0);
    expect(Math.abs(r1)).toBeLessThanOrEqual(1.5);
    expect(Math.abs(r2)).toBeLessThanOrEqual(1.5);
  });

  it('leaves promises at zero until players can be promised anything', () => {
    for (const p of team0.slice(0, 10)) expect(moraleFactors(league, p, moraleContext(league)).promises).toBe(0);
  });
});

describe('morale: the target and the words', () => {
  it('adds the factors and clamps the sum', () => {
    expect(moraleTarget({ ...ZERO, contract: 1, role: -2, rest: 0.5 })).toBeCloseTo(-0.5);
    expect(moraleTarget({ contract: 9, role: 9, team: 9, room: 9, promises: 0, rest: 9 })).toBe(10);
    expect(moraleTarget({ contract: -9, role: -9, team: -9, room: -9, promises: 0, rest: -9 })).toBe(-10);
  });

  it('maps every band to its word', () => {
    const cases: [number, string][] = [
      [10, 'Superb'],
      [6, 'Superb'],
      [5.99, 'Very good'],
      [3, 'Very good'],
      [2.99, 'Good'],
      [1, 'Good'],
      [0.99, 'Okay'],
      [-0.99, 'Okay'],
      [-1, 'Poor'],
      [-2.99, 'Poor'],
      [-3, 'Very poor'],
      [-5.99, 'Very poor'],
      [-6, 'Abysmal'],
      [-10, 'Abysmal'],
    ];
    for (const [level, word] of cases) expect(MORALE_WORDS[moraleStepOf(level)], String(level)).toBe(word);
  });

  it('gives reasons in words only, biggest first, at most three', () => {
    const p = starter();
    const f: MoraleFactors = { ...ZERO, contract: -3, role: -1, team: 1.5, room: 0.8 };
    const reasons = moraleReasons(league, p, f);
    expect(reasons).toEqual(['Wants a new deal', 'Loving the winning', 'Wants more snaps']);
    for (const r of reasons) expect(r).not.toMatch(/\d/);
    expect(moraleReasons(league, p, { ...ZERO, contract: 0.5 })).toEqual([]);
  });
});

describe('morale: what a screen may see', () => {
  it('shows your own players only, and only once they have a mood', () => {
    const mine = team0[0];
    const theirs = activeRoster(league, 1)[0];
    const moody = (p: Player): Player => ({ ...p, morale: { level: 2, jolts: [] } });
    const l = { ...league, players: { ...league.players, [mine.id]: moody(mine), [theirs.id]: moody(theirs) } };
    expect(moraleView(l, l.players[mine.id])).toMatchObject({ step: 5, word: 'Good' });
    expect(moraleView(l, l.players[theirs.id])).toBeNull();
    expect(moraleView(league, { ...mine, morale: undefined })).toBeNull();
  });
});
