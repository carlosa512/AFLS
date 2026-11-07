import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createLeague } from '../generate';
import type { Game, League } from '../types';
import { EARLY, isPrimeTime } from './kickoff';
import { assignUniforms } from './uniforms';
import { UNIFORMS } from '../data/uniforms';

const league = createLeague({ seed: 'uniforms' });
const season = (l: League) => l.games.filter((g) => g.season === l.season && !g.playoffRound);
const slot = (g: Game) => g.flexed ?? g.kickoff!;
const homeOf = (l: League, id: number) => season(l).filter((g) => g.homeId === id);

describe('assignUniforms', () => {
  it('gives every club two alternates at most, in primetime home games, Thursday first', () => {
    for (const t of league.teams) {
      const games = homeOf(league, t.id);
      const alts = games.filter((g) => g.uniform === 'rush' || g.uniform === 'blackout');
      expect(alts.length, t.abbrev).toBeLessThanOrEqual(2);
      for (const g of alts) {
        expect(g.week).toBeLessThanOrEqual(17);
        expect(isPrimeTime(slot(g))).toBe(true);
      }
      const thursday = games.filter((g) => g.week <= 17 && slot(g).day === 'thu');
      if (thursday.length) expect(alts).toContain(thursday[0]);
      const prime = games.filter((g) => g.week <= 17 && isPrimeTime(slot(g)));
      expect(alts.length).toBe(Math.min(2, prime.length));
    }
  });
  it("puts a blackout club's blackout in its second alternate", () => {
    let checked = 0;
    for (const t of league.teams) {
      if (!(t.uniforms ?? UNIFORMS[t.abbrev])?.blackout) continue;
      const order = homeOf(league, t.id)
        .filter((g) => g.week <= 17 && isPrimeTime(slot(g)))
        .sort((a, b) => Number(slot(b).day === 'thu') - Number(slot(a).day === 'thu') || a.week - b.week)
        .slice(0, 2)
        .map((g) => g.uniform);
      if (order.length === 2) {
        expect(order, t.abbrev).toEqual(['rush', 'blackout']);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(0);
  });
  it('gives one or two classics, division games first, never in back-to-back weeks, four specials at most', () => {
    for (const t of league.teams) {
      const games = homeOf(league, t.id);
      const classics = games.filter((g) => g.uniform === 'classic');
      expect(classics.length, t.abbrev).toBeGreaterThanOrEqual(1);
      expect(classics.length).toBeLessThanOrEqual(2);
      if (classics.length === 2) expect(Math.abs(classics[0].week - classics[1].week)).toBeGreaterThan(1);
      expect(games.filter((g) => g.uniform).length).toBeLessThanOrEqual(4);
      const divisionLeft = games.filter(
        (g) => g.week <= 17 && !g.uniform && league.teams[g.awayId].division === t.division,
      );
      // a non-division classic only once the division games are used up (or sit next to a picked classic)
      if (classics.some((g) => league.teams[g.awayId].division !== t.division))
        for (const d of divisionLeft) expect(classics.some((x) => Math.abs(x.week - d.week) <= 1)).toBe(true);
    }
  });
  it('leaves a club with no primetime home game its classics', () => {
    const l = createLeague({ seed: 'uniforms' });
    const games = season(l);
    for (const g of games) {
      delete g.uniform;
      if (g.homeId === 0) g.kickoff = EARLY;
    }
    assignUniforms(l, games, l.season);
    const mine = homeOf(l, 0);
    expect(mine.some((g) => g.uniform === 'rush' || g.uniform === 'blackout')).toBe(false);
    expect(mine.some((g) => g.uniform === 'classic')).toBe(true);
  });
  it('never dresses a playoff game or week 18, and gives the same seed the same uniforms', () => {
    expect(league.games.filter((g) => g.week === 18 || g.playoffRound).every((g) => !g.uniform)).toBe(true);
    const again = createLeague({ seed: 'uniforms' });
    expect(again.games.map((g) => g.uniform)).toEqual(league.games.map((g) => g.uniform));
  });
  it('leaves the schedule as it was', () => {
    const a = createLeague({ seed: 'same' });
    const hash = createHash('sha1')
      .update(JSON.stringify(a.games.map((g) => [g.week, g.homeId, g.awayId, g.kickoff])))
      .digest('hex');
    expect(hash).toBe('a8eb733391bd61b522971b6d074675bea890232e'); // the schedule for this seed, taken again when GM habits (0.4.5) added GM archetypes to the pool
  });
});
