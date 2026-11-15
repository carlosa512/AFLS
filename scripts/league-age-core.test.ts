import { beforeEach, describe, expect, it } from 'vitest';
import { createLeague } from '../src/engine/generate';
import type { League, Player, Position } from '../src/engine/types';
import {
  ageBandOf,
  ageGroupOf,
  bandFor,
  exitAges,
  nextSeason,
  NFL_STARTER_AGE,
  playedIn,
  rosteredNow,
  seasonStarters,
  type Starters,
} from './league-age-core';

const template = createLeague({ seed: 'league-age-core' });
let l: League;
beforeEach(() => {
  l = structuredClone(template);
  for (const p of Object.values(l.players)) p.stats = {};
});

/** Players of a team at a position, with `n` snaps (or games for K and P) this season. */
function give(teamId: number, pos: Position, counts: number[]): Player[] {
  const at = Object.values(l.players).filter((p) => p.teamId === teamId && p.position === pos);
  return counts.map((n, i) => {
    const p = at[i];
    p.stats[l.season] = pos === 'K' || pos === 'P' ? { gp: n } : { snaps: n, gp: 17 };
    return p;
  });
}

describe('seasonStarters', () => {
  it("picks each team's top N by snaps", () => {
    const [a, b, c, d] = give(0, 'WR', [900, 800, 700, 650]);
    const [e] = give(1, 'WR', [950]);
    const s = seasonStarters(l, l.season);
    expect([a, b, c].every((p) => s.get(p.id)?.age === p.age && s.get(p.id)?.pos === 'WR')).toBe(true);
    expect(s.has(d.id)).toBe(false);
    expect(s.has(e.id)).toBe(true);
  });

  it('never counts a player with no snaps', () => {
    const [a] = give(0, 'QB', [0]);
    expect(seasonStarters(l, l.season).has(a.id)).toBe(false);
  });

  it('starts kickers and punters by games played', () => {
    const at = Object.values(l.players).filter((p) => p.teamId === 0 && p.position === 'K');
    const extra = structuredClone(at[0]);
    extra.id = 999_999;
    l.players[extra.id] = extra;
    at[0].stats[l.season] = { gp: 3 };
    extra.stats[l.season] = { gp: 17 };
    const s = seasonStarters(l, l.season);
    expect(s.has(extra.id)).toBe(true);
    expect(s.has(at[0].id)).toBe(false);
  });

  it('rosteredNow counts the 53 and reserve lists, not the practice squad or the unsigned', () => {
    const on = Object.values(l.players).find((p) => p.teamId === 0 && !p.squad)!;
    const free = Object.values(l.players).find((p) => p.teamId === null && !p.retired);
    const squad = Object.values(l.players).find((p) => p.teamId === 0 && p.squad);
    const r = rosteredNow(l);
    expect(r.has(on.id)).toBe(true);
    if (free) expect(r.has(free.id)).toBe(false);
    if (squad) expect(r.has(squad.id)).toBe(false);
  });

  it('playedIn reads snaps, and games for kickers', () => {
    const [w] = give(0, 'WR', [10]);
    const [k] = give(0, 'K', [2]);
    const played = playedIn(l, l.season);
    expect(played.has(w.id) && played.has(k.id)).toBe(true);
  });
});

describe('nextSeason', () => {
  const st = (rows: [number, Position, number][]): Starters =>
    new Map(rows.map(([id, pos, age]) => [id, { pos, age }]));
  it('sorts a starter into keep, on a roster or gone by age band and group', () => {
    const now = st([
      [1, 'OL', 29],
      [2, 'WR', 29],
      [3, 'QB', 29],
      [4, 'OL', 33],
    ]);
    const next = st([[1, 'OL', 30]]);
    const r = nextSeason(now, next, new Set([1, 2]));
    expect(r.all['29']).toEqual({ n: 3, keep: 1, play: 1, gone: 1 });
    expect(r.long['29']).toEqual({ n: 1, keep: 1, play: 0, gone: 0 });
    expect(r.short['29']).toEqual({ n: 1, keep: 0, play: 1, gone: 0 });
    expect(Object.values(r.all).reduce((n, f) => n + f!.n, 0)).toBe(3);
  });

  it('exitAges counts a starter off every roster for two seasons', () => {
    const seasons = [
      st([
        [1, 'OL', 31],
        [2, 'OL', 30],
      ]),
      st([]),
      st([]),
    ];
    const played = [new Set([1, 2]), new Set([2]), new Set<number>()];
    expect(exitAges(seasons, played)).toEqual({ OL: [31] });
  });
});

describe('bands and groups', () => {
  it('bandFor gives the warn band inside the fail band', () => {
    const b = bandFor(26.48, 0.75);
    expect(b.normal[0]).toBeCloseTo(25.73);
    expect(b.normal[1]).toBeCloseTo(27.23);
    expect(b.usual[0]).toBeCloseTo(26.03);
    expect(b.usual[1]).toBeCloseTo(26.93);
  });
  it('groups and bands', () => {
    expect(ageGroupOf('TE')).toBe('long');
    expect(ageGroupOf('CB')).toBe('short');
    expect(ageGroupOf('QB')).toBeNull();
    expect(ageBandOf(22)).toBe('21-24');
    expect(ageBandOf(32)).toBe('32');
    expect(ageBandOf(33)).toBeNull();
  });
  it('holds the NFL figures', () => {
    expect(NFL_STARTER_AGE.ALL).toEqual({ mean: 26.48, young: 32.2, old: 11.8 });
  });
});
