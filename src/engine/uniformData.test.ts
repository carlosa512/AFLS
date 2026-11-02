import { describe, expect, it } from 'vitest';
import { contrast } from '../ui/color';
import { TEAM_SEEDS } from './data/teams';
import { UNIFORMS } from './data/uniforms';

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
});
