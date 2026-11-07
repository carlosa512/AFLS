import { describe, expect, it } from 'vitest';
import { createLeague } from '../generate';
import type { GameResult, PlayLogEntry } from '../types';
import { groupOf } from './defendedPass';
import { simulateGame, type DefendedTap } from './gameSim';

const league = createLeague({ seed: 'picks-t' });
const taps: DefendedTap[] = [];
const results: GameResult[] = [];
for (const g of league.games.filter((x) => !x.playoffRound).slice(0, 40))
  results.push(simulateGame(league, g, { keepPlays: true, defendedTap: (t) => taps.push(t) }));
// A two-point try's snap books nothing and taps nothing (`twoPointTry`).
const plays: PlayLogEntry[] = results.flatMap((r) => r.plays!.filter((e) => !/^Two-point try: /.test(e.text)));
const kindOf = (e: PlayLogEntry) => (e.kind === 'penalty' ? e.ran?.kind : e.kind);
const nameOf = (id: number) => {
  const p = league.players[id];
  return `${p.firstName[0]}.${p.lastName}`;
};

describe('picks and breakups in a game', () => {
  it('taps every pick and every incompletion once, naming the man of the group it says', () => {
    // (A throwaway falls incomplete but nobody gets to it: it isn't a throw the defense played.)
    const logged = plays.filter(
      (e) =>
        e.down > 0 &&
        (kindOf(e) === 'int' || (kindOf(e) === 'incomplete' && !/throws it away|thrown away/.test(e.text))),
    );
    expect(taps.length).toBe(logged.length);
    expect(taps.filter((t) => t.outcome === 'pick').length).toBeGreaterThan(10);
    expect(taps.filter((t) => t.outcome === 'breakup').length).toBeGreaterThan(50);
    for (const t of taps) if (t.outcome !== 'none') expect(t.group).toBe(groupOf(league.players[t.by!]));
  });

  it('credits what the taps say: a pick to its catcher, a pass defensed to the breakup and most picks', () => {
    const sum = (k: 'defInt' | 'passDef') =>
      results.reduce((n, r) => n + Object.values(r.playerStats).reduce((m, s) => m + (s[k] ?? 0), 0), 0);
    // (A flag can wipe out a play's stats, never its tap: the taps are an upper bound.)
    const picks = taps.filter((t) => t.outcome === 'pick');
    expect(sum('defInt')).toBeLessThanOrEqual(picks.length);
    expect(sum('defInt')).toBeGreaterThan(picks.length * 0.85);
    const pd = taps.filter((t) => t.outcome === 'breakup').length + picks.filter((t) => t.pd).length;
    expect(sum('passDef')).toBeLessThanOrEqual(pd);
    expect(sum('passDef')).toBeGreaterThan(pd * 0.85);
  });

  it('writes a ball batted at the line, and turns a tipped pick over at the line', () => {
    const batted = taps.filter((t) => t.outcome === 'breakup' && t.batted);
    expect(batted.length).toBeGreaterThan(0);
    expect(plays.filter((e) => /, batted down at the line by /.test(e.text)).length).toBe(batted.length);
    // A play a flag wiped out keeps the throw as it ran (`ran`), from the same snap.
    for (const e of plays.filter((x) => kindOf(x) === 'int' && /tipped at the line/.test(x.text)))
      expect(Math.abs((e.ran?.air ?? e.air ?? 0) - (e.from ?? 0)), e.text).toBeLessThanOrEqual(1.01);
  });

  it('never runs back a pick made in the end zone: a touchback', () => {
    for (const t of taps) if (t.outcome === 'pick' && t.endZone) expect(t.returnYds).toBe(0);
    for (const t of taps) if (t.outcome === 'pick' && t.by) expect(nameOf(t.by).length).toBeGreaterThan(2);
  });
});
