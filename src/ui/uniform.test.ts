import { describe, expect, it } from 'vitest';
import { createLeague } from '../engine/generate';
import type { Game, League, Team } from '../engine/types';
import { contrast } from './color';
import { helmetDesignOf } from './helmet';
import { clubUniforms, numberOutline, uniformFor, wearsWhite } from './uniform';

const league = createLeague({ seed: 'dress' });
const club = (l: League, abbrev: string) => l.teams.find((t) => t.abbrev === abbrev)!;
/** A regular-season home game of `abbrev`'s, its stamp set to `uniform` (cleared for undefined). */
function homeGame(l: League, abbrev: string, uniform?: Game['uniform']): Game {
  const t = club(l, abbrev);
  const g = l.games.find((x) => x.homeId === t.id && !x.playoffRound && x.week <= 17)!;
  if (uniform) g.uniform = uniform;
  else delete g.uniform;
  return g;
}

describe('uniformFor', () => {
  it("dresses the home team in its game's set, and the visitors opposite", () => {
    const g = homeGame(league, 'KC', 'classic');
    expect(uniformFor(league, club(league, 'KC'), g).set).toBe('classic');
    expect(uniformFor(league, league.teams[g.awayId], g).set).toBe('away');
  });
  it('puts the visitors in colours against a home whiteout', () => {
    const g = homeGame(league, 'PIT', 'rush');
    const home = uniformFor(league, club(league, 'PIT'), g);
    expect(home.set).toBe('rush');
    expect(home.kit.jersey).toBe('#F2F4F6');
    expect(uniformFor(league, league.teams[g.awayId], g).set).toBe('home');
  });
  it('lets a special beat the hot-day white', () => {
    // a game whose home team would wear white for the heat
    let found: { l: League; g: Game } | null = null;
    for (let i = 0; i < 12 && !found; i++) {
      const l = createLeague({ seed: `hot${i}` });
      const g = l.games.find((x) => !x.playoffRound && x.week <= 17 && wearsWhite(l, x.homeId, x));
      if (g) found = { l, g };
    }
    expect(found).not.toBeNull();
    const { l, g } = found!;
    g.uniform = 'rush';
    const home = uniformFor(l, l.teams[g.homeId], g);
    expect(home.set).toBe('rush');
    expect(uniformFor(l, l.teams[g.awayId], g).set).toBe(home.kit.jersey === '#F2F4F6' ? 'home' : 'away');
  });
  it("wears the classic's helmet only in a classic game, the usual otherwise", () => {
    const atl = club(league, 'ATL');
    expect(uniformFor(league, atl, homeGame(league, 'ATL', 'classic')).helmet.shell).toBe('#a71930');
    expect(uniformFor(league, atl, homeGame(league, 'ATL')).helmet).toEqual(helmetDesignOf(atl));
  });
  it("dresses a mod's club from its colours", () => {
    const mod = { id: 99, colors: ['#5b2a86', '#f4c430'] } as unknown as Team;
    const u = clubUniforms(mod);
    expect(u.rush.jersey).toBe('#5b2a86');
    expect(u.classic.sleeves).toBe('three');
    expect(u.blackout).toBeUndefined();
    expect(u.font).toBe('standard');
    for (const set of [u.rush, u.classic]) {
      const o = set.outline ?? numberOutline(set.jersey, set.ink, '#f4c430');
      expect(Math.max(contrast(set.ink, set.jersey), contrast(o.color, set.jersey))).toBeGreaterThanOrEqual(3);
    }
  });
  it('outlines every number', () => {
    expect(numberOutline('#e31837', '#F8FAFC', '#ffb81c')).toEqual({ color: '#ffb81c', width: 2.4 }); // KC: gold
    expect(numberOutline('#0b162a', '#F8FAFC', '#c83803')).toEqual({ color: '#c83803', width: 2.4 }); // CHI: orange
    expect(numberOutline('#008e97', '#0F172A', '#fc4c02')).toEqual({ color: '#F8FAFC', width: 2 }); // MIA: an edge
    expect(numberOutline('#203731', '#ffb612', '#ffb612')).toEqual({ color: '#0F172A', width: 2 }); // GB: gold is the ink
  });
  it('dresses home colours in a bye week and the offseason', () => {
    const kc = club(league, 'KC');
    expect(uniformFor({ ...league, phase: 'freeAgency' } as League, kc).set).toBe('home'); // the offseason
    expect(uniformFor(null, kc).set).toBe('home');
  });
});
