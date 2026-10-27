import { describe, expect, it } from 'vitest';
import { CFL_ORIGIN, ORIGINS } from '../data/origins';
import { createLeague } from '../generate';
import { simToEndOfSeason } from '../league';
import { squadCategory } from '../personnel/eligibility';
import { beginOffseason } from '.';
import { CFL_ARRIVALS, cflArrivals, isPathway, PATHWAY_CLASS, pathwayClass } from './arrivals';
import { finishDraft } from './draft';

describe('Pathway class', () => {
  it('13 Pathway players join the free-agent pool after the draft, each with a country and no service', () => {
    const l = createLeague({ seed: 'pathway' });
    const before = l.nextPlayerId;
    finishDraft(l);
    const arrived = Object.values(l.players).filter((p) => p.id >= before);
    expect(arrived).toHaveLength(PATHWAY_CLASS);
    expect(PATHWAY_CLASS).toBe(13);
    for (const p of arrived) {
      expect(isPathway(p)).toBe(true);
      expect(ORIGINS[p.origin!].kind).toBe('pathway');
      expect(p.teamId).toBeNull();
      expect(p.contract).toBeNull();
      expect(p.experience).toBe(0);
      expect(p.age).toBeGreaterThanOrEqual(22);
      expect(p.age).toBeLessThanOrEqual(26);
      expect(squadCategory(l, p)).toBe('base');
    }
  });

  it('is deterministic per seed and season', () => {
    const names = () => {
      const l = createLeague({ seed: 'pathway-det' });
      return pathwayClass(l).map((p) => `${p.firstName} ${p.lastName} ${p.position} ${p.origin}`);
    };
    expect(names()).toEqual(names());
  });
});

describe('CFL veterans', () => {
  it('6 arrive each league year, squad-eligible with no NFL service, and lose cflSeasons after a season', () => {
    const l = createLeague({ seed: 'cfl' });
    const north = cflArrivals(l);
    expect(north).toHaveLength(CFL_ARRIVALS);
    expect(CFL_ARRIVALS).toBe(6);
    for (const p of north) {
      expect(p.origin).toBe(CFL_ORIGIN);
      expect(p.cflSeasons).toBeGreaterThanOrEqual(1);
      expect(p.cflSeasons).toBeLessThanOrEqual(4);
      expect(p.age).toBeGreaterThanOrEqual(24);
      expect(p.age).toBeLessThanOrEqual(29);
      expect(p.experience).toBe(0);
      expect(squadCategory(l, p)).toBe('base');
    }
    const kept = north[0];
    kept.retired = false;
    simToEndOfSeason(l);
    const first = l.nextPlayerId;
    beginOffseason(l);
    expect(l.players[kept.id].cflSeasons).toBeUndefined();
    const fresh = Object.values(l.players).filter((p) => p.id >= first && p.origin === CFL_ORIGIN);
    expect(fresh).toHaveLength(CFL_ARRIVALS);
  });
});
