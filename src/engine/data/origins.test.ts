import { describe, expect, it } from 'vitest';
import { RESERVED_NICKNAMES } from './teams';
import { CFL_ORIGIN, COLLEGES_BY_TIER, ORIGINS, PATHWAY_ORIGINS, type OriginTier } from './origins';

describe('origins table', () => {
  it('pins the first entries: an index is a saved id, so the table only grows at the end', () => {
    expect(ORIGINS.slice(0, 3).map((o) => o.name)).toEqual(['Alabama', 'Georgia', 'Ohio State']);
  });

  it('gives every college a tier and a positive weight, and nothing else either', () => {
    for (const o of ORIGINS) {
      if (o.kind === 'college') {
        expect(o.tier).toBeDefined();
        expect(o.weight).toBeGreaterThan(0);
      } else {
        expect(o.tier ?? o.weight).toBeUndefined();
      }
    }
  });

  it('has one CFL entry, at least 12 Pathway countries and every tier', () => {
    expect(ORIGINS.filter((o) => o.kind === 'cfl')).toHaveLength(1);
    expect(ORIGINS[CFL_ORIGIN].kind).toBe('cfl');
    expect(PATHWAY_ORIGINS.length).toBeGreaterThanOrEqual(12);
    for (const i of PATHWAY_ORIGINS) expect(ORIGINS[i].kind).toBe('pathway');
    for (const t of ['power', 'group5', 'fcs', 'small'] as OriginTier[]) {
      expect(COLLEGES_BY_TIER[t].length).toBeGreaterThan(5);
      for (const i of COLLEGES_BY_TIER[t]) expect(ORIGINS[i].tier).toBe(t);
    }
  });

  it('has unique names and no reserved nickname', () => {
    expect(new Set(ORIGINS.map((o) => o.name)).size).toBe(ORIGINS.length);
    for (const o of ORIGINS) for (const n of RESERVED_NICKNAMES) expect(o.name).not.toContain(n);
  });
});
