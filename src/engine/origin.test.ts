import { describe, expect, it } from 'vitest';
import { CFL_ORIGIN, ORIGINS, PATHWAY_ORIGINS, type OriginTier } from './data/origins';
import {
  bandForDraftRound,
  bandForRank,
  bandForShare,
  collegeOrigin,
  FILM,
  filmScale,
  originOf,
  type RankBand,
} from './origin';
import type { Player } from './types';

const tierOf = (id: number) => ORIGINS[id].tier as OriginTier;
function shares(draws: number[]): Record<OriginTier, number> {
  const out = { power: 0, group5: 0, fcs: 0, small: 0 };
  for (const id of draws) out[tierOf(id)]++;
  for (const t of Object.keys(out) as OriginTier[]) out[t] /= draws.length;
  return out;
}

describe('origin draw', () => {
  it('is deterministic per seed and id, and differs across ids', () => {
    expect(collegeOrigin('s', 7, 2)).toBe(collegeOrigin('s', 7, 2));
    const many = new Set(Array.from({ length: 50 }, (_, i) => collegeOrigin('s', i, 0)));
    expect(many.size).toBeGreaterThan(10);
  });

  it('always draws a college', () => {
    for (let i = 0; i < 400; i++) expect(ORIGINS[collegeOrigin('k', i, (i % 4) as RankBand)].kind).toBe('college');
  });

  it('a class of 224 drafted lands on the real draft mix (2025: 87% power, 10% Group of 5, 3% FCS)', () => {
    const draws: number[] = [];
    for (let c = 0; c < 200; c++) for (let r = 1; r <= 224; r++) draws.push(collegeOrigin(`c${c}`, r, bandForRank(r)));
    const s = shares(draws);
    expect(s.power).toBeGreaterThan(0.83);
    expect(s.power).toBeLessThan(0.89);
    expect(s.group5).toBeGreaterThan(0.08);
    expect(s.group5).toBeLessThan(0.12);
    expect(s.fcs).toBeGreaterThan(0.02);
    expect(s.fcs).toBeLessThan(0.05);
    expect(s.small).toBeLessThan(0.02);
  });

  it('a roster (70% drafted, 30% undrafted) lands near FBS 88%, FCS 8%, small 2.4%', () => {
    const draws: number[] = [];
    for (let i = 0; i < 40000; i++) {
      const band = i % 10 < 3 ? 3 : bandForRank(1 + (i % 224));
      draws.push(collegeOrigin('r', i, band));
    }
    const s = shares(draws);
    expect(s.power + s.group5).toBeGreaterThan(0.86);
    expect(s.power + s.group5).toBeLessThan(0.92);
    expect(s.fcs).toBeGreaterThan(0.06);
    expect(s.fcs).toBeLessThan(0.1);
    expect(s.small).toBeGreaterThan(0.015);
    expect(s.small).toBeLessThan(0.045);
  });

  it('maps ranks, rounds and position shares to bands', () => {
    expect([1, 32, 33, 100, 101, 224, 225, 260].map(bandForRank)).toEqual([0, 0, 1, 1, 2, 2, 3, 3]);
    expect([1, 2, 3, 4, 7].map(bandForDraftRound)).toEqual([0, 1, 1, 2, 2]);
    expect([0, 0.19, 0.2, 0.44, 0.45, 0.79, 0.8, 1].map(bandForShare)).toEqual([0, 0, 1, 1, 2, 2, 3, 3]);
  });

  it('reads no player at all: the draw takes only a seed, an id and a band', () => {
    expect(collegeOrigin.length).toBe(3);
  });
});

describe('film by origin', () => {
  const withOrigin = (origin?: number) => ({ origin }) as Player;
  it('follows the tier, and is 1 for the CFL, no origin or an unknown id', () => {
    expect(FILM).toEqual({ power: 1, group5: 0.85, fcs: 0.7, small: 0.55, pathway: 0.4 });
    expect(filmScale(withOrigin(0))).toBe(1);
    expect(filmScale(withOrigin(PATHWAY_ORIGINS[0]))).toBe(0.4);
    expect(filmScale(withOrigin(CFL_ORIGIN))).toBe(1);
    expect(filmScale(withOrigin())).toBe(1);
    expect(filmScale(withOrigin(99999))).toBe(1);
    expect(originOf(withOrigin(99999))).toBeUndefined();
  });
});
