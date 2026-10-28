import { describe, expect, it } from 'vitest';
import {
  ceilingLean,
  ceilingShift,
  peerTable,
  playLean,
  settleCeiling,
  settleFinished,
  type PeerTable,
} from './ceiling';
import { CEILING_SWING, settleYear } from './development';
import { playWeek, simToEndOfRegularSeason, simToEndOfSeason } from './league';
import { beginOffseason } from './offseason';
import { allSeeds } from './season/playoffs';
import { createLeague } from './generate';
import { playerOvr } from './positions';
import { Rng } from './rng';
import type { League, Player, StatLine } from './types';
import { ATTRIBUTES } from './types';

const copy = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const QB_LINE: StatLine = { gp: 16, passAtt: 520, passCmp: 330, passYds: 3900, passTd: 26, passInt: 10 };

/** A league and one of its young players at `pos`, made a rookie this season. */
function rookie(seed: string, pos = 'QB'): { league: League; p: Player } {
  const league = createLeague({ seed });
  const p = Object.values(league.players).find((x) => x.position === pos && x.teamId !== null)!;
  p.age = 22;
  p.experience = 0;
  delete p.ceilingShifts;
  return { league, p };
}

/** A player rated `ovr` across the board at the start of `season`. */
const ratedAt = (p: Player, season: number, ovr: number) =>
  ((p.ratingHistory ??= {})[season] = ATTRIBUTES.map(() => ovr));

describe('settleCeiling', () => {
  it('the same seed settles the same shift', () => {
    const a = rookie('ceiling-a');
    const b = rookie('ceiling-a');
    const season = a.league.season;
    expect(settleCeiling(a.league, a.p, season, peerTable(a.league, season))).toBe(true);
    settleCeiling(b.league, b.p, season, peerTable(b.league, season));
    expect(a.p.ceilingShifts![season]).toBe(b.p.ceilingShifts![season]);
    expect(a.p.potential).toBe(b.p.potential);
  });

  it('settles once a season', () => {
    const { league, p } = rookie('ceiling-once');
    const peers = peerTable(league, league.season);
    settleCeiling(league, p, league.season, peers);
    const after = p.potential;
    expect(settleCeiling(league, p, league.season, peers)).toBe(false);
    expect(p.potential).toBe(after);
  });

  it('skips players 26 and over and players past their third year', () => {
    const { league, p } = rookie('ceiling-skip');
    const peers = peerTable(league, league.season);
    const old = { ...copy(p), age: 26 };
    const vet = { ...copy(p), experience: 3 };
    expect(settleCeiling(league, old, league.season, peers)).toBe(false);
    expect(settleCeiling(league, vet, league.season, peers)).toBe(false);
    expect(old.ceilingShifts).toBeUndefined();
    expect(vet.potential).toBe(p.potential);
  });

  it('can drop the ceiling below his overall, and no rating moves', () => {
    let below = 0;
    const base = rookie('ceiling-drop');
    for (let i = 0; i < 60; i++) {
      const { league } = base;
      const p = copy(base.p);
      p.id = 100000 + i; // a stream of his own each time
      p.traits.workEthic = 1;
      p.potential = playerOvr(p) + 0.3;
      const ratings = { ...p.ratings };
      settleCeiling(league, p, league.season, new Map());
      expect(p.ratings).toEqual(ratings);
      expect(p.potential).toBeLessThanOrEqual(20);
      if (p.potential < playerOvr(p)) below++;
    }
    expect(below).toBeGreaterThan(20);
  });
});

describe('the lean', () => {
  /** Peer quarterbacks rated 9–17 whose passer rating rises a step (6 points) per overall point. */
  const peers = (): PeerTable =>
    new Map([['QB', Array.from({ length: 90 }, (_, i) => ({ ovr: 9 + (i % 9), measure: 60 + 6 * (i % 9) }))]]);

  it('reads peers rated like him, not the league', () => {
    const { league, p } = rookie('ceiling-peers');
    const season = league.season;
    p.stats[season] = QB_LINE; // a passer rating in the 90s: about a 14's line on this table
    ratedAt(p, season, 10);
    const low = playLean(p, season, peers());
    ratedAt(p, season, 15);
    const high = playLean(p, season, peers());
    expect(low).toBeGreaterThan(0);
    expect(high).toBeLessThan(0);
    expect(Math.abs(low)).toBeLessThanOrEqual(0.4);
  });

  it('positions without a rule and short seasons lean 0 on play', () => {
    const te = rookie('ceiling-te', 'TE');
    te.p.stats[te.league.season] = { gp: 16, rec: 40, recYds: 500 };
    expect(playLean(te.p, te.league.season, peers())).toBe(0);
    const qb = rookie('ceiling-short');
    qb.p.stats[qb.league.season] = { gp: 3, passAtt: 20, passCmp: 12, passYds: 150 };
    expect(playLean(qb.p, qb.league.season, peers())).toBe(0);
    expect(Number.isFinite(ceilingLean(te.league, te.p, te.league.season, peers()))).toBe(true);
  });

  it('a big projection leans down: the hype past three points over his entry overall', () => {
    const { league, p } = rookie('ceiling-hype');
    // He came into the league rated 10 across the board, whatever he has grown to since.
    p.ratingHistory = { [league.season - 1]: ATTRIBUTES.map(() => 10) };
    const at = (potential: number) => ceilingLean(league, { ...copy(p), potential }, league.season, new Map());
    expect(at(12) - at(13)).toBeCloseTo(0, 9);
    expect(at(13) - at(16)).toBeCloseTo(4.2, 9);
    // Growing fast doesn't dodge it: the same ceiling leans the same with today's ratings a point higher.
    const grown = copy(p);
    for (const a of ATTRIBUTES) grown.ratings[a] += 1;
    expect(ceilingLean(league, { ...grown, potential: 16 }, league.season, new Map())).toBeCloseTo(at(16), 9);
    // Draft-day hype is settled in his first season: a second-year player's big ceiling doesn't lean on it.
    const second = { ...copy(p), experience: 1 };
    const later = (potential: number) => ceilingLean(league, { ...second, potential }, league.season, new Map());
    expect(later(13) - later(16)).toBeCloseTo(0, 9);
  });

  it('a settle lifts a ceiling at most one swing past its lean, and can drop it further', () => {
    let low = 0;
    for (let i = 0; i < 2000; i++) {
      const shift = ceilingShift(new Rng(`cap:${i}`), 0, 0.3);
      expect(shift).toBeLessThanOrEqual(0.3 + 1.09 * CEILING_SWING[0] + 0.05);
      if (shift < 0.3 - CEILING_SWING[0] - 0.05) low++;
    }
    expect(low).toBeGreaterThan(150);
  });

  it('the cap trims the top tail without moving the average', () => {
    for (const year of [0, 1, 2]) {
      let sum = 0;
      const n = 20000;
      for (let i = 0; i < n; i++) sum += ceilingShift(new Rng(`mean:${year}:${i}`), year, 0.3);
      expect(sum / n).toBeCloseTo(0.3, 1);
    }
  });

  it('high work ethic settles above low', () => {
    const { league, p } = rookie('ceiling-we');
    const mean = (we: number) => {
      const q = { ...copy(p), traits: { ...p.traits, workEthic: we } };
      const lean = ceilingLean(league, q, league.season, new Map());
      let sum = 0;
      for (let i = 0; i < 400; i++) sum += ceilingShift(new Rng(`we:${i}`), 0, lean);
      return sum / 400;
    };
    expect(mean(18) - mean(3)).toBeGreaterThan(0.2);
  });
});

describe("when a team's season ends", () => {
  // One league played through its season in steps; each test picks up where the last left off.
  const league = createLeague({ seed: 'ceiling-season' });
  const season = league.season;
  const young = () => Object.values(league.players).filter((p) => !p.retired && settleYear(p) !== null);
  let cut: Player;

  it('week 18 settles the teams out of the playoffs, not a bye team', () => {
    simToEndOfRegularSeason(league);
    expect(league.phase).toBe('playoffs');
    const seeds = allSeeds(league);
    const inPlayoffs = new Set(seeds.flat());
    const byes = new Set(seeds.map((c) => c[0]));
    const out = young().filter((p) => p.teamId !== null && !inPlayoffs.has(p.teamId));
    const bye = young().filter((p) => p.teamId !== null && byes.has(p.teamId));
    expect(out.length).toBeGreaterThan(0);
    expect(bye.length).toBeGreaterThan(0);
    for (const p of out) expect(p.ceilingShifts?.[season]).toBeDefined();
    for (const p of bye) expect(p.ceilingShifts?.[season]).toBeUndefined();
    // A player let go by a club still playing settles at the next pass, once.
    cut = bye[0];
    cut.teamId = null;
  });

  it('a player cut after week 18 settles once', () => {
    playWeek(league);
    const once = cut.ceilingShifts?.[season];
    expect(once).toBeDefined();
    const potential = cut.potential;
    settleFinished(league);
    expect(cut.ceilingShifts![season]).toBe(once);
    expect(cut.potential).toBe(potential);
  });

  it('the playoffs settle each loser and the final settles the rest', () => {
    simToEndOfSeason(league);
    expect(young().length).toBeGreaterThan(100);
    for (const p of young()) expect(p.ceilingShifts?.[season]).toBeDefined();
  });

  it('the new league year settles anyone left', () => {
    const p = young()[0];
    p.potential -= p.ceilingShifts![season];
    delete p.ceilingShifts![season];
    beginOffseason(league);
    expect(p.ceilingShifts?.[season]).toBeDefined();
  });
});
