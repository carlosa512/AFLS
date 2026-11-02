import { describe, expect, it } from 'vitest';
import { contrast } from '../ui/color';
import { TEAM_SEEDS } from './data/teams';
import { UNIFORMS } from './data/uniforms';
import { createLeague, SAVE_VERSION } from './generate';
import { migrateLeague } from './migrate';
import { EARLY, isPrimeTime } from './season/kickoff';

describe('uniform data', () => {
  it('dresses every default club', () => {
    for (const s of TEAM_SEEDS) {
      const u = UNIFORMS[s.abbrev];
      expect(u, s.abbrev).toBeDefined();
      expect(!!u.blackout, s.abbrev).toBe(['PIT', 'CHI', 'LV', 'NO', 'HOU', 'ATL', 'CAR', 'ARI'].includes(s.abbrev));
    }
  });
  it('makes every number read on its jersey', () => {
    for (const [ab, u] of Object.entries(UNIFORMS))
      for (const [name, set] of Object.entries({ rush: u.rush, blackout: u.blackout, classic: u.classic }))
        if (set) {
          const best = Math.max(
            contrast(set.ink, set.jersey),
            set.outline ? contrast(set.outline.color, set.jersey) : 0,
          );
          expect(best, `${ab} ${name}`).toBeGreaterThanOrEqual(3);
        }
  });
  it('gives the fonts as set', () => {
    for (const ab of ['MIN', 'TEN', 'LAS', 'JAX', 'NYK']) expect(UNIFORMS[ab].font).toBe('tall');
    for (const ab of ['NYE', 'IND', 'NE', 'BAL', 'CLE']) expect(UNIFORMS[ab].font).toBe('wide');
    expect(UNIFORMS.SEA.font).toBe('squared');
    expect(UNIFORMS.KC.font).toBe('standard');
  });
  it('keeps the helmet count to three: the colour rush wears the usual helmet', () => {
    for (const u of Object.values(UNIFORMS)) expect(u.rush.helmet).toBeUndefined();
    expect(UNIFORMS.ATL.classic.helmet?.shell).toBe('#a71930');
    expect(UNIFORMS.SEA.classic.helmet?.shell).toBe('#a5acaf');
    expect(UNIFORMS.KC.classic.helmet?.finish).toBe('matte');
  });
  it("copies each club's uniforms into a new league", () => {
    const league = createLeague({ seed: 'v76' });
    for (const t of league.teams) {
      expect(t.uniforms, t.abbrev).toEqual(UNIFORMS[t.abbrev]);
      expect(t.uniforms).not.toBe(UNIFORMS[t.abbrev]);
    }
  });
  it('dresses an older save: clubs by abbreviation, this season from the slots it was scheduled in', () => {
    const league = createLeague({ seed: 'v76' });
    const before = league.games.map((g) => g.uniform);
    for (const t of league.teams) delete t.uniforms;
    for (const g of league.games) delete g.uniform;
    const g = league.games.find((x) => x.kickoff && isPrimeTime(x.kickoff) && x.week <= 17)!;
    g.flexed = g.kickoff;
    g.kickoff = EARLY; // flexed out of primetime since
    league.teams[5].abbrev = 'XYZ'; // a mod's club
    league.version = 75;
    const out = migrateLeague(league)!;
    expect(out.version).toBe(SAVE_VERSION);
    expect(out.teams[0].uniforms).toEqual(UNIFORMS[out.teams[0].abbrev]);
    expect(out.teams[5].uniforms).toBeUndefined();
    // the mod's club has no blackout to wear, so only its own alternates can differ
    const changed = out.games.filter((x, i) => x.uniform !== before[i]);
    expect(changed.every((x) => x.homeId === 5)).toBe(true);
    expect(g.uniform).toBe(before[league.games.indexOf(g)]);
  });
});
