import { describe, expect, it } from 'vitest';
import { CFL_ORIGIN, ORIGINS, PATHWAY_ORIGINS, type Origin, type OriginTier } from './data/origins';
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
import { createLeague, SAVE_VERSION } from './generate';
import { migrateLeague } from './migrate';
import { playerOvr } from './positions';
import { generateDraftClass } from './offseason/draft';
import { Rng } from './rng';
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

describe('every new player has an origin', () => {
  const hash = (ps: Player[]) => {
    let h = 0;
    for (const p of ps)
      for (const v of Object.values(p.ratings)) h = (h * 31 + Math.round(v * 1000) + p.id) % 1000000007;
    return h;
  };
  // Taken on main before origins: an origin draw runs on its own stream, so no rating moves. The class's was taken
  // again when prospects came in rawer, with a stronger top (`RAW`, `HYPE_ROOM`, draft busts), and again when the
  // class's top went from 13.95 to 14.1 (taken on main with only that change): origins still move none of its ratings.
  const MAIN_LEAGUE = 44280957;
  const MAIN_CLASS = 203098958;

  it('gives every player of a new league and a draft class a college, without moving a rating', () => {
    const l = createLeague({ seed: 'fp-origins' });
    expect(hash(Object.values(l.players))).toBe(MAIN_LEAGUE);
    generateDraftClass(l, new Rng('fp-class'));
    expect(hash(l.draftClass.map((id) => l.players[id]))).toBe(MAIN_CLASS);
    for (const p of Object.values(l.players)) expect(ORIGINS[p.origin!]?.kind).not.toBeUndefined();
  });

  it('starts a league with a few Pathway and CFL players already in it, and colleges for everyone else', () => {
    const l = createLeague({ seed: 'start-mix' });
    const all = Object.values(l.players);
    const kind = (k: string) => all.filter((p) => ORIGINS[p.origin!].kind === k);
    // About 0.5% and 1% of the league (AFLS estimates): no flood of arrivals later to catch up.
    expect(kind('pathway').length).toBeGreaterThanOrEqual(3);
    expect(kind('pathway').length).toBeLessThanOrEqual(16);
    expect(kind('cfl').length).toBeGreaterThanOrEqual(10);
    expect(kind('cfl').length).toBeLessThanOrEqual(32);
    expect(kind('college').length).toBe(all.length - kind('pathway').length - kind('cfl').length);
    // Pathway players are young depth, never a top-round pick.
    for (const p of kind('pathway')) {
      expect(p.age).toBeLessThanOrEqual(26);
      expect(p.draft?.round ?? 7).toBeGreaterThanOrEqual(4);
    }
    for (const p of kind('cfl')) expect(p.age).toBeGreaterThanOrEqual(24);
  });

  it('a top-32 prospect is almost always from a power school', () => {
    const l = createLeague({ seed: 'top32' });
    let power = 0;
    let n = 0;
    for (let c = 0; c < 6; c++) {
      generateDraftClass(l, new Rng(`top32:${c}`));
      for (const id of l.draftClass.slice(0, 32)) {
        n++;
        if (originOf(l.players[id])?.tier === 'power') power++;
      }
    }
    expect(power / n).toBeGreaterThan(0.93);
  });

  it('small-school prospects get a noisier consensus grade', () => {
    const l = createLeague({ seed: 'noise' });
    const miss: Record<string, number[]> = { power: [], small: [] };
    for (let c = 0; c < 30; c++) {
      generateDraftClass(l, new Rng(`noise:${c}`));
      for (const id of l.draftClass) {
        const p = l.players[id];
        const t = originOf(p)!.tier!;
        if (t === 'power' || t === 'small') miss[t].push(Math.abs(p.scouting!.grade - playerOvr(p)));
      }
    }
    const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
    expect(mean(miss.small)).toBeGreaterThan(mean(miss.power) * 1.15);
  });
});

describe('v54 migration', () => {
  const old = () => {
    const l = createLeague({ seed: 'mig-origins' });
    for (const p of Object.values(l.players)) delete p.origin;
    l.personnel!.profile = 'afls-2026-v1';
    l.version = 53;
    return l;
  };

  it('gives every player an origin, the same one every time', () => {
    const a = migrateLeague(old())!;
    const b = migrateLeague(old())!;
    expect(a.version).toBe(SAVE_VERSION);
    for (const p of Object.values(a.players)) {
      expect(ORIGINS[p.origin!]).toBeDefined();
      expect(b.players[p.id].origin).toBe(p.origin);
    }
  });

  it('migrates a retired player with no draft record', () => {
    const l = old();
    const p = Object.values(l.players)[0];
    delete p.draft;
    p.retired = true;
    p.teamId = null;
    expect(ORIGINS[migrateLeague(l)!.players[p.id].origin!]).toBeDefined();
  });

  it('keeps an existing career on afls-2026-v1', () => {
    expect(migrateLeague(old())!.personnel!.profile).toBe('afls-2026-v1');
  });
});

describe('review follow-ups', () => {
  it('a save migrated during the draft gives prospects colleges by class rank, never the Pathway', () => {
    const l = createLeague({ seed: 'mig-draft' });
    generateDraftClass(l, new Rng('mig-draft-class'));
    for (const p of Object.values(l.players)) delete p.origin;
    l.version = 53;
    const up = migrateLeague(l)!;
    const prospects = up.draftClass.map((id) => up.players[id]);
    for (const p of prospects) expect(ORIGINS[p.origin!].kind).toBe('college');
    const byConsensus = [...prospects].sort(
      (a, b) =>
        0.6 * b.scouting!.grade + 0.4 * b.scouting!.ceiling - (0.6 * a.scouting!.grade + 0.4 * a.scouting!.ceiling),
    );
    for (const [i, p] of byConsensus.entries()) expect(p.origin).toBe(collegeOrigin(up.seed, p.id, bandForRank(i + 1)));
  });

  it('a mod college with no tier reads as a big program, not NaN', () => {
    const table = ORIGINS as Origin[];
    table.push({ name: 'Mod State', kind: 'college' });
    try {
      expect(filmScale({ origin: table.length - 1 } as Player)).toBe(1);
    } finally {
      table.pop();
    }
  });
});
