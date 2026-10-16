import { describe, expect, it } from 'vitest';
import { createLeague, SAVE_VERSION } from '../generate';
import { startNextSeason, simToEndOfSeason } from '../league';
import { migrateLeague } from '../migrate';
import { teamPlayers } from '../roster';
import type { League } from '../types';
import { capSheet, releasePlayer, releasePreview, restructurePlayer } from './cap';
import { buildContract, capHit, deadMoney, isExpired, prorationIn, restructure, voidProration } from './contract';
import { leagueMarket, marketApy, payTier } from './market';

const deal = (over: Partial<Parameters<typeof buildContract>[0]> = {}) =>
  buildContract({ years: 4, total: 100_000, signingBonus: 40_000, guaranteedBase: 0, voidYears: 0, escalator: 0, ...over }, 2026, 'veteran', 1_000);

describe('contract math', () => {
  it('prorates a signing bonus evenly, never over more than five years', () => {
    const c = deal();
    expect(prorationIn(c, 2026)).toBe(10_000);
    expect(capHit(c, 2026)).toBe(25_000); // 15,000 base + 10,000 proration
    const long = deal({ years: 7, total: 140_000, signingBonus: 50_000 });
    expect(long.bonuses[0].years).toBe(5);
    expect(prorationIn(long, 2030)).toBeCloseTo(10_000);
    expect(prorationIn(long, 2031)).toBe(0);
  });

  it('accelerates all remaining proration on a pre-June 1 cut, and splits it post-June 1', () => {
    const c = deal({ guaranteedBase: 15_000 }); // first year's base is guaranteed
    const pre = deadMoney(c, 2026);
    expect(pre.thisYear).toBe(40_000 + 15_000);
    expect(pre.nextYear).toBe(0);
    const post = deadMoney(c, 2026, { postJune1: true });
    expect(post.thisYear).toBe(10_000 + 15_000);
    expect(post.nextYear).toBe(30_000);
    // Either way the total pain is the same; only the timing changes.
    expect(post.thisYear + post.nextYear).toBe(pre.thisYear);
  });

  it("matches the doc's restructure formula (Watson 2026: $44.7M over 5 years saves $35.76M)", () => {
    const c = buildContract({ years: 5, total: 5 * 46_000, signingBonus: 0, guaranteedBase: 0, voidYears: 0, escalator: 0 }, 2026, 'veteran', 1_000);
    const saved = restructure(c, 2026, 44_700, 1_000);
    expect(saved).toBeCloseTo(35_760);
    expect(capHit(c, 2027)).toBeCloseTo(46_000 + 8_940);
  });

  it('parks bonus money in void years, which becomes dead money when the deal voids', () => {
    const c = deal({ years: 2, total: 50_000, signingBonus: 30_000, voidYears: 3 });
    expect(c.bonuses[0].years).toBe(5);
    expect(capHit(c, 2026)).toBe(10_000 + 6_000);
    expect(isExpired(c, 2028)).toBe(true);
    expect(voidProration(c)).toBeCloseTo(18_000);
  });

  it('lets a traded player take his salary while the bonus stays behind', () => {
    const c = deal({ guaranteedBase: 30_000 });
    const t = deadMoney(c, 2026, { trade: true });
    expect(t.thisYear).toBe(40_000);
  });
});

describe('market', () => {
  it('is flat at the top and falls away below starter level', () => {
    expect(payTier('QB', 0)).toBeCloseTo(1, 2);
    expect(payTier('QB', 9)).toBeGreaterThan(0.85);
    expect(payTier('QB', 40)).toBeLessThan(0.05);
    expect(payTier('EDGE', 20)).toBeGreaterThan(payTier('EDGE', 60) * 3);
  });

  it('prices the best QB near 21% of the cap', () => {
    const league = createLeague({ seed: 'market' });
    const market = leagueMarket(league);
    const qbs = Object.values(league.players).filter((p) => p.position === 'QB' && p.age < 30);
    const best = Math.max(...qbs.map((p) => marketApy(market, p)));
    expect(best / market.cap).toBeGreaterThan(0.17);
    expect(best / market.cap).toBeLessThan(0.22);
  });
});

describe('team cap', () => {
  it('books dead money on release and frees the rest', () => {
    const league = createLeague({ seed: 'release' });
    const team = league.teams[0];
    const star = teamPlayers(league, team.id).sort((a, b) => capHit(b.contract!, 2026) - capHit(a.contract!, 2026))[0];
    const before = capSheet(league, team.id);
    const preview = releasePreview(league, star);
    releasePlayer(league, star);
    const after = capSheet(league, team.id);
    expect(after.dead).toBeCloseTo(before.dead + preview.thisYear, 0);
    expect(after.space - before.space).toBeCloseTo(preview.savings, 0);
    expect(star.teamId).toBeNull();
    expect(team.depthChart[star.position]).not.toContain(star.id);
  });

  it('only restructures in the offseason', () => {
    const league = createLeague({ seed: 'restructure' });
    const vet = Object.values(league.players).find((p) => p.contract?.kind === 'veteran' && p.contract.years.length >= 3)!;
    expect(restructurePlayer(league, vet)).toBe(0);
    league.phase = 'resign';
    expect(restructurePlayer(league, vet)).toBeGreaterThan(0);
  });

  it('keeps every team cap-compliant and every contract current across seasons', () => {
    const league = createLeague({ seed: 'multi-season' });
    for (let s = 0; s < 2; s++) {
      simToEndOfSeason(league);
      startNextSeason(league);
      for (const p of Object.values(league.players)) {
        if (p.teamId === null) continue;
        expect(p.contract).not.toBeNull();
        expect(isExpired(p.contract!, league.season)).toBe(false);
      }
    }
    expect(league.caps[league.season]).toBeGreaterThan(league.caps[league.season - 2]! * 0.85);
  }, 30_000);
});

describe('save migration', () => {
  it('upgrades a v1 save to year-by-year contracts', () => {
    const league = createLeague({ seed: 'migrate' });
    // Rebuild the v1 shape: flat contracts, a single salaryCap, no ledgers.
    const v1 = JSON.parse(JSON.stringify(league)) as Record<string, unknown> & League;
    v1.version = 1;
    (v1 as unknown as { salaryCap: number }).salaryCap = 301_200;
    delete (v1 as Partial<League>).caps;
    for (const p of Object.values(v1.players)) (p as unknown as { contract: unknown }).contract = { salary: 5_000, years: 2 };
    const up = migrateLeague(v1)!;
    expect(up.version).toBe(SAVE_VERSION);
    expect(up.caps[up.season]).toBe(301_200);
    const p = Object.values(up.players).find((x) => x.teamId !== null)!;
    expect(capHit(p.contract!, up.season)).toBe(5_000);
    expect(up.draftPicks.length).toBe(32 * 7 * 3);
    expect(up.teams[0].deadMoney).toEqual([]);
  });

  it('refuses saves from a newer version', () => {
    const league = createLeague({ seed: 'future' });
    league.version = SAVE_VERSION + 1;
    expect(migrateLeague(league)).toBeNull();
  });
});
