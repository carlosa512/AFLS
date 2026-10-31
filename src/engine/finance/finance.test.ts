import { describe, expect, it } from 'vitest';
import { createLeague, fitPayroll, LAST_YEAR_MOST, SAVE_VERSION } from '../generate';
import { startNextSeason, simToEndOfSeason } from '../league';
import { migrateLeague } from '../migrate';
import { playerOvr, STARTERS } from '../positions';
import { teamPlayers } from '../roster';
import type { League, Position } from '../types';
import { POSITIONS } from '../types';
import { capSheet, releasePlayer, releasePreview, restructurePlayer } from './cap';
import {
  buildContract,
  capHit,
  deadMoney,
  futureProration,
  isExpired,
  prorationIn,
  restructure,
  voidProration,
  yearsLeft,
} from './contract';
import { BASE_CAP, leagueMarket, marketApy, maxBonusShare, minSalary, payTier, TOP_APY_PCT } from './market';

const deal = (over: Partial<Parameters<typeof buildContract>[0]> = {}) =>
  buildContract(
    { years: 4, total: 100_000, signingBonus: 40_000, guaranteedBase: 0, voidYears: 0, escalator: 0, ...over },
    2026,
    'veteran',
    1_000,
  );

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
    const c = buildContract(
      { years: 5, total: 5 * 46_000, signingBonus: 0, guaranteedBase: 0, voidYears: 0, escalator: 0 },
      2026,
      'veteran',
      1_000,
    );
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

  it("caps the signing bonus at 20-35% of a deal by the GM's cap style", () => {
    expect(maxBonusShare(0)).toBeCloseTo(0.2);
    expect(maxBonusShare(1)).toBeCloseTo(0.35);
    const league = createLeague({ seed: 'bonus' });
    for (const p of Object.values(league.players)) {
      const c = p.contract;
      if (!c || c.kind !== 'veteran' || p.teamId === null) continue;
      // The deal's own: an extension carries its rookie deal's bonus on, on that deal's schedule.
      const signing = c.bonuses
        .filter((b) => b.source === 'signing' && b.start >= c.signedSeason)
        .reduce((s, b) => s + b.amount, 0);
      // The 1.6 covers `fitPayroll`'s market nudge on top of the share the test pins: it scales a deal's bonus and
      // its average together (up to 1.5x), and its raises add salary, never bonus, so the share barely moves.
      const ceiling = c.apy * c.length * maxBonusShare(league.teams[p.teamId].gm.capAggression) * 1.6 + 1;
      expect(signing).toBeLessThanOrEqual(ceiling);
    }
  });
});

describe('opening league', () => {
  const seeds = ['opening-a', 'opening-b', 'opening-c'];
  it('starts a quarter of its 14+ veterans in their last year, as a settled league does', () => {
    const last = seeds.map((seed) => {
      const league = createLeague({ seed });
      const stars = Object.values(league.players).filter(
        (p) => p.teamId !== null && p.contract?.kind !== 'rookie' && p.experience >= 4 && playerOvr(p) >= 14,
      );
      return stars.filter((p) => yearsLeft(p.contract!, league.season) === 1).length / stars.length;
    });
    const mean = last.reduce((a, b) => a + b, 0) / last.length;
    expect(mean).toBeGreaterThan(0.18);
    expect(mean).toBeLessThan(0.36);
  });

  it('opens every team at 85-100% of the cap, the weakest roster included', () => {
    for (const seed of seeds) {
      const league = createLeague({ seed });
      for (const t of league.teams) {
        const used = capSheet(league, t.id).used / league.caps[league.season];
        expect(used).toBeGreaterThanOrEqual(0.85);
        // The spec's range, not the 0.99 target's: `fitPayroll` raises a base that was below today's minimum to it
        // after sizing its scale, so a team aimed at 0.985-0.99 can open a touch over (0.9935 on 'opening-b').
        expect(used).toBeLessThanOrEqual(1);
      }
    }
  });

  it("fills a thin roster's room without paying anyone past his position's top of the market", () => {
    // 'physicals' opens the thinnest roster of these seeds. The 1.2 is the market's own draw on a top deal (up to
    // 1.15x) plus its structure; a front-load spread by pay alone once put a cornerback at 39.5% of the cap.
    for (const seed of [...seeds, 'physicals']) {
      const league = createLeague({ seed });
      const cap = league.caps[league.season];
      for (const p of Object.values(league.players)) {
        if (p.teamId === null || p.contract?.kind !== 'veteran') continue;
        expect(capHit(p.contract, league.season)).toBeLessThanOrEqual(1.2 * TOP_APY_PCT[p.position] * cap);
      }
    }
  });

  /** A team whose veterans are all on two-year minimum deals (a bonus on top, if any): nobody above the minimum. */
  function minimumRoster(bonus: number) {
    const league = createLeague({ seed: 'opening-a' });
    const roster = teamPlayers(league, league.teams[0].id);
    const vets = roster.filter((p) => p.contract!.kind !== 'rookie');
    for (const p of vets) {
      const min = minSalary(p.experience, BASE_CAP);
      const terms = { years: 2, total: 2 * min + bonus, signingBonus: bonus, guaranteedBase: 0, voidYears: 0 };
      p.contract = buildContract({ ...terms, escalator: 0 }, league.season, 'veteran', min);
    }
    return { league, roster, vets, market: leagueMarket(league) };
  }

  it('fills a roster of minimum-salary veterans to its target, never past a position top', () => {
    // Nobody above the minimum leaves the first raises nowhere to go, so the fill falls back to every veteran with
    // room (a team that gave up there opened at 71.7% of the cap). A bonus keeps payroll above the floor: both ways
    // into the fill, with no 0 / 0.
    for (const bonus of [0, 6_000]) {
      const { league, roster, vets, market } = minimumRoster(bonus);
      fitPayroll(roster, league.season, BASE_CAP * 0.95, market, league.teams[0].gm);
      const payroll = roster.reduce((s, p) => s + capHit(p.contract!, league.season), 0);
      expect(payroll / BASE_CAP).toBeCloseTo(0.95, 3);
      for (const p of vets) {
        for (const y of p.contract!.years) {
          const hit = capHit(p.contract!, y.season);
          expect(Number.isFinite(hit)).toBe(true);
          expect(hit).toBeLessThanOrEqual(TOP_APY_PCT[p.position] * BASE_CAP + 1);
        }
      }
    }
  });

  it('never raises a one-year deal past what a last-year deal may be paid, even when the room has nowhere else to go', () => {
    const { league, roster, vets, market } = minimumRoster(0);
    for (const p of vets) {
      const min = minSalary(p.experience, BASE_CAP);
      p.contract = buildContract(
        { years: 1, total: min, signingBonus: 0, guaranteedBase: 0, voidYears: 0, escalator: 0 },
        league.season,
        'minimum',
        min,
      );
    }
    fitPayroll(roster, league.season, BASE_CAP * 0.95, market, league.teams[0].gm);
    for (const p of vets) {
      const min = minSalary(p.experience, BASE_CAP);
      const most = Math.min(TOP_APY_PCT[p.position] * BASE_CAP, LAST_YEAR_MOST * Math.max(marketApy(market, p), min));
      expect(capHit(p.contract!, league.season)).toBeLessThanOrEqual(Math.max(most, min) + 1);
    }
  });

  it('raises a deal over all its years, and the raised deal still restructures in the offseason', () => {
    // The fill is a raise over a deal's remaining years, not this year's money alone: a front-load into the first
    // year left the next one 57-64% committed against a settled league's 73.
    const { league, roster, vets, market } = minimumRoster(0);
    fitPayroll(roster, league.season, BASE_CAP * 0.95, market, league.teams[0].gm);
    league.phase = 'resign';
    // An undrafted player's first deal stays the minimum he signed for: the fill leaves those alone.
    for (const p of vets.filter((p) => p.draft || p.experience >= 4)) {
      const [now, next] = p.contract!.years.filter((y) => !y.void);
      expect(next.base).toBeGreaterThanOrEqual(now.base);
      expect(restructurePlayer(league, p)).toBeGreaterThan(0);
    }
  });

  it('raises a last-year deal no further than a settled league pays one, and never a minimum deal', () => {
    // A settled league pays its last-year veterans past their market (1.13-1.55 times it in all at its kickoffs), so
    // part of an opening roster's room goes there, up to 1.7 times a deal's market. No further: a raise on a deal in its last year is this year's money alone,
    // room again in the spring (rev-15's team 22 opened year two with 31.7% of the cap unspent when its last-year deals
    // took every raise, at up to three and a half times their market).
    const league = createLeague({ seed: 'opening-a' });
    const s = league.season;
    const market = leagueMarket(league);
    let raisedLast = 0;
    let raisedRunning = 0;
    for (const t of league.teams) {
      const roster = teamPlayers(league, t.id);
      const before = new Map(roster.map((p) => [p, capHit(p.contract!, s)]));
      const kind = new Map(roster.map((p) => [p, p.contract!.kind]));
      fitPayroll(roster, s, BASE_CAP, market, t.gm);
      for (const p of roster) {
        const gain = capHit(p.contract!, s) - before.get(p)!;
        if (yearsLeft(p.contract!, s) > 1) {
          raisedRunning += Math.max(0, gain);
          continue;
        }
        if (gain <= 1) continue;
        raisedLast += gain;
        expect(kind.get(p), `${p.position} ${p.id}`).toBe('veteran');
        expect(capHit(p.contract!, s), `${p.position} ${p.id}`).toBeLessThanOrEqual(1.7 * marketApy(market, p) + 1);
      }
    }
    expect(raisedLast).toBeGreaterThan(0);
    expect(raisedRunning).toBeGreaterThan(0);
  });

  it('gives every veteran 1-5 real years and no fourth-year veteran a deal from before his rookie one ended', () => {
    const league = createLeague({ seed: 'opening-a' });
    for (const p of Object.values(league.players)) {
      if (p.teamId === null || p.contract?.kind === 'rookie' || p.experience < 4) continue;
      const left = yearsLeft(p.contract!, league.season);
      expect(left).toBeGreaterThanOrEqual(1);
      expect(left).toBeLessThanOrEqual(5);
      if (p.experience === 4) expect(p.contract!.signedSeason).toBe(league.season);
    }
  });
});

/**
 * What fifty new leagues (rev-0..rev-49, createLeague only) carry into their first two league years, read once
 * and shared by the tests below. The targets are a settled league's at kickoff (the 4th to 6th kickoffs of eight
 * six-season runs of the offseason loop): a new league should already look like one, next year included, or its
 * front offices spend year two on what generation left out.
 */
interface OpeningDeal {
  kind: string;
  position: Position;
  age: number;
  experience: number;
  left: number;
  hit: number;
  next: number;
  apy: number;
  market: number;
  min: number;
  /** Players better than him at his position on the league's rosters (0 = the best). */
  rank: number;
  /** Ranked below the league's starters at his position. */
  depth: boolean;
  round?: number;
  pick?: number;
  option?: string;
}
interface Opening {
  leagues: number;
  /** Per team: share of this year's cap used; of next year's committed, all of it, rookie deals' and the rest's. */
  used: number[];
  next: number[];
  nextRookie: number[];
  nextVets: number[];
  /** Per team: bonus proration still to charge after this league year, as a share of next year's cap. */
  prorated: number[];
  /** Per team: its players on rookie deals drafted in the top 3 of their draft. */
  topThree: number[];
  /** Per team: veterans the market prices at the minimum whose charge this year is over 3x it. */
  floorRaised: number[];
  deals: OpeningDeal[];
  cap: number;
}
const OPENING_SEEDS = Array.from({ length: 50 }, (_, i) => `rev-${i}`);
let opening: Opening | undefined;
function openings(): Opening {
  if (opening) return opening;
  const o: Opening = {
    leagues: 0,
    used: [],
    next: [],
    nextRookie: [],
    nextVets: [],
    prorated: [],
    topThree: [],
    floorRaised: [],
    deals: [],
    cap: BASE_CAP,
  };
  for (const seed of OPENING_SEEDS) {
    const league = createLeague({ seed });
    const market = leagueMarket(league);
    const s = league.season;
    const rank = new Map<number, number>();
    for (const pos of POSITIONS)
      Object.values(league.players)
        .filter((p) => p.teamId !== null && p.position === pos)
        .sort((a, b) => playerOvr(b) - playerOvr(a))
        .forEach((p, i) => rank.set(p.id, i));
    o.leagues++;
    for (const t of league.teams) {
      const roster = teamPlayers(league, t.id);
      const nextCap = capSheet(league, t.id, s + 1).cap;
      o.used.push(capSheet(league, t.id).used / league.caps[s]);
      o.next.push(capSheet(league, t.id, s + 1).used / nextCap);
      const nextOf = (rookie: boolean) =>
        roster
          .filter((p) => (p.contract!.kind === 'rookie') === rookie)
          .reduce((sum, p) => sum + capHit(p.contract!, s + 1), 0) / nextCap;
      o.nextRookie.push(nextOf(true));
      o.nextVets.push(nextOf(false));
      o.prorated.push(roster.reduce((sum, p) => sum + futureProration(p.contract!, s), 0) / nextCap);
      const first = o.deals.length;
      for (const p of roster) {
        const c = p.contract!;
        o.deals.push({
          kind: c.kind,
          position: p.position,
          age: p.age,
          experience: p.experience,
          left: yearsLeft(c, s),
          hit: capHit(c, s),
          next: capHit(c, s + 1),
          apy: c.apy,
          market: marketApy(market, p),
          min: minSalary(p.experience, league.caps[s]),
          rank: rank.get(p.id)!,
          depth: rank.get(p.id)! >= 32 * STARTERS[p.position],
          round: p.draft?.round,
          pick: p.draft?.pick,
          option: c.fifthYearOption,
        });
      }
      const mine = o.deals.slice(first);
      o.topThree.push(mine.filter((d) => d.kind === 'rookie' && d.pick !== undefined && d.pick <= 3).length);
      o.floorRaised.push(mine.filter((d) => d.kind !== 'rookie' && d.market <= d.min && d.hit > 3 * d.min).length);
    }
  }
  return (opening = o);
}
const quantile = (xs: number[], q: number) => {
  const sorted = [...xs].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
};
const share = <T>(xs: T[], test: (x: T) => boolean) => xs.filter(test).length / xs.length;

describe('opening league, read across fifty seeds', () => {
  it('opens every team at 85-100% of the cap', () => {
    // The weakest rosters set this: a team whose veterans all hit their raise limits once opened at 71.7% of
    // the cap (rev-22) and kept 54% of it unspent at the next kickoff.
    const { used } = openings();
    expect(Math.min(...used)).toBeGreaterThanOrEqual(0.85);
    expect(Math.max(...used)).toBeLessThanOrEqual(1);
  }, 60_000);

  it("commits about three-quarters of next year's cap, as a settled league does at kickoff", () => {
    // Settled: median 73.2% (71.7-75.8 by seed), p10 54.4% (49.6-58.1), p90 88.8%; rookie deals 16.0% of it, the
    // rest 56.0% (p10 39.6%). A new league that commits ~61% (its rookie deals 7%) leaves its front offices a
    // year-two market with too little to buy for the room they have; one whose room all goes on deals with years to
    // run commits 77.6% (its veterans 62.6%) and has too few buyers in season (trades' salary weight reads two years
    // of room: 13.8 in-season trades a season against main's 17.8).
    const { next, nextRookie, nextVets } = openings();
    expect(quantile(next, 0.5)).toBeGreaterThanOrEqual(0.68);
    expect(quantile(next, 0.5)).toBeLessThanOrEqual(0.76);
    expect(quantile(next, 0.1)).toBeGreaterThanOrEqual(0.5);
    expect(quantile(next, 0.9)).toBeLessThanOrEqual(0.92);
    expect(quantile(nextRookie, 0.5)).toBeGreaterThanOrEqual(0.14);
    expect(quantile(nextRookie, 0.5)).toBeLessThanOrEqual(0.18);
    expect(quantile(nextVets, 0.5)).toBeGreaterThanOrEqual(0.53);
    expect(quantile(nextVets, 0.5)).toBeLessThanOrEqual(0.59);
    expect(quantile(nextVets, 0.1)).toBeGreaterThanOrEqual(0.35);
  }, 60_000);

  it('keeps about two in five veteran deals in their last year, as a settled league does', () => {
    // Settled: 45.6% of veteran deals, 32.1% of payroll (32.7-35.5% later on). A settled league's last-year
    // veterans hold about what a new league's do of its veterans' market value (20-31% at the 4th-6th kickoffs of
    // rev-0..3, against 25-28% at their openings), but are paid past it: their charge is 1.13-1.55 times their
    // market (by apy 1.08-1.38), where a new league's market-priced deals sit at 0.95 and make 24% of payroll.
    const { deals } = openings();
    const pay = deals.reduce((s, d) => s + d.hit, 0);
    const lastPay = deals.filter((d) => d.left === 1).reduce((s, d) => s + d.hit, 0) / pay;
    expect(lastPay).toBeGreaterThanOrEqual(0.29);
    expect(lastPay).toBeLessThanOrEqual(0.35);
    const vets = deals.filter((d) => d.kind !== 'rookie');
    expect(share(vets, (d) => d.left === 1)).toBeGreaterThanOrEqual(0.38);
    expect(share(vets, (d) => d.left === 1)).toBeLessThanOrEqual(0.48);
    // Paid past their market as a settled league's are (1.13-1.55 times it at the 4th-6th kickoffs), no further.
    const last = vets.filter((d) => d.left === 1);
    const paid = last.reduce((s, d) => s + d.hit, 0) / last.reduce((s, d) => s + d.market, 0);
    expect(paid).toBeGreaterThanOrEqual(1.1);
    expect(paid).toBeLessThanOrEqual(1.55);
  }, 60_000);

  it('signs each veteran for the years a player his age signs for', () => {
    // Settled veteran deals by age: years left average 4.4 at 26 and under (just signed his second deal), 2.7 at
    // 27-29, 1.5 at 30-32 and 1.3 from 33, and next year's charges are 0.77 of this year's. Drawn by talent alone,
    // a new league's averaged 2.1-2.3 at every age and its front-loads made next year 0.66 of this one.
    const { deals } = openings();
    // The deals the market table draws: veterans past their rookie deal whom the market prices above the minimum
    // (a minimum player a thin roster raised is on a market deal now, for the years he signed at the minimum).
    const vets = deals.filter(
      (d) => d.kind === 'veteran' && d.experience >= 4 && d.market > minSalary(d.experience, BASE_CAP),
    );
    const bands: [number, number, number][] = [
      [0, 26, 4.4],
      [27, 29, 2.7],
      [30, 32, 1.5],
      [33, 99, 1.3],
    ];
    for (const [lo, hi, mean] of bands) {
      const band = vets.filter((d) => d.age >= lo && d.age <= hi);
      const avg = band.reduce((s, d) => s + Math.min(d.left, 5), 0) / band.length;
      expect(avg, `ages ${lo}-${hi}`).toBeGreaterThanOrEqual(mean - 0.2);
      expect(avg, `ages ${lo}-${hi}`).toBeLessThanOrEqual(mean + 0.2);
    }
    // Minimum deals: the old take a year at a time (75% from 30 here; a settled league's 78% counts a cohort of
    // OVR 13+ players on one-year minimums that its glutted market leaves, which a new league doesn't copy), and
    // young depth signs for three to five like an undrafted rookie.
    const mins = deals.filter((d) => d.kind === 'minimum');
    expect(
      share(
        mins.filter((d) => d.age >= 30),
        (d) => d.left === 1,
      ),
    ).toBeGreaterThanOrEqual(0.7);
    expect(
      share(
        mins.filter((d) => d.age <= 26),
        (d) => d.left >= 3,
      ),
    ).toBeGreaterThanOrEqual(0.25);
    const all = deals.filter((d) => d.kind !== 'rookie');
    expect(all.reduce((s, d) => s + d.next, 0) / all.reduce((s, d) => s + d.hit, 0)).toBeGreaterThanOrEqual(0.75);
  }, 60_000);

  it('pays few veterans past twice their market into next year', () => {
    // Settled: 5.3 a league over twice the market with next year's charge past 3% of the cap; a raise scaled up to
    // 2.5x left 10 a league. Pay against the market: a settled league's 90th percentile is 1.53, a new league's
    // 1.60, as its thin rosters top up their own veterans where a settled league's overpay free agents.
    const { deals, leagues, cap } = openings();
    const vets = deals.filter((d) => d.kind !== 'rookie');
    const rich = vets.filter((d) => d.apy > 2 * d.market && d.next > 0.03 * cap);
    expect(rich.length / leagues).toBeLessThanOrEqual(6);
    expect(
      quantile(
        vets.map((d) => d.apy / d.market),
        0.9,
      ),
    ).toBeLessThanOrEqual(1.7);
  }, 60_000);

  it('drafts a full first round in each of the last four drafts and pays it like a settled league', () => {
    // Settled: 148 first-round rookie deals a league (4 classes of 32 plus 20 on an exercised fifth-year option; a
    // few more have been extended by then), rookie deals 19.7% of payroll, and undrafted players on minimum deals.
    // Picks drawn from each player's quality alone left 34 first-rounders a league, rookie deals 10.9% of payroll and
    // 210 undrafted players on rookie deals.
    const { deals, leagues } = openings();
    const rookies = deals.filter((d) => d.kind === 'rookie');
    const firsts = rookies.filter((d) => d.round === 1).length / leagues;
    expect(firsts).toBeGreaterThanOrEqual(128);
    expect(firsts).toBeLessThanOrEqual(155);
    expect(rookies.filter((d) => d.round === undefined)).toEqual([]);
    expect(rookies.filter((d) => d.option === 'exercised').length / leagues).toBeGreaterThan(10);
    const pay = deals.reduce((s, d) => s + d.hit, 0);
    const rookiePay = rookies.reduce((s, d) => s + d.hit, 0) / pay;
    expect(rookiePay).toBeGreaterThanOrEqual(0.18);
    expect(rookiePay).toBeLessThanOrEqual(0.21);
  }, 60_000);

  it("opens no team far over next year's cap, as a settled league's kickoffs don't", () => {
    // Settled kickoffs: 0.8-1.5% of teams over next year's cap, the most at 107.9%. Restructuring an over-target
    // opening roster as far as this year needed put 49 teams in fifty leagues over, the most at 144.6%.
    const { next, prorated } = openings();
    expect(Math.max(...next)).toBeLessThanOrEqual(1.08);
    expect(share(next, (x) => x > 1)).toBeLessThanOrEqual(0.015);
    // Bonus money still to charge after this year: a settled league's kickoffs carry a median 38-46% of next year's
    // cap (its 4th to 6th, on four seeds); a new league with full rookie classes and settled deal lengths, about 35%.
    expect(quantile(prorated, 0.5)).toBeLessThanOrEqual(0.42);
  }, 60_000);

  it('drafts kickers and punters late, as every front office does', () => {
    // Settled: 0.1-0.2 kickers and punters a league on first-round rookie deals, as many on an option year, and no
    // rookie deal over his position's top of the market. Drafted by overall alone, a new league had 11.5 a league in
    // the first round (4.4 on options) and 5.3 rookies paid over a kicker's or punter's top.
    const { deals, leagues, cap } = openings();
    const rookies = deals.filter((d) => d.kind === 'rookie');
    const specialists = rookies.filter((d) => d.position === 'K' || d.position === 'P');
    expect(specialists.filter((d) => d.round === 1).length / leagues).toBeLessThanOrEqual(0.3);
    expect(specialists.filter((d) => d.option === 'exercised').length / leagues).toBeLessThanOrEqual(0.3);
    expect(rookies.filter((d) => d.hit > TOP_APY_PCT[d.position] * cap)).toEqual([]);
  }, 60_000);

  it("spreads each draft's top picks over the weak teams, as a season's luck does", () => {
    // Settled: 0.3-0.5 teams a league hold three or more top-3 picks still on rookie deals, and 3.4% of the top-10
    // picks on rookie deals are below a starter. One order for every class, weakest first, gave the same three
    // franchises the top three picks of every class (3.0 teams a league) and made 12.4% of top-10 picks depth.
    const { topThree, deals, leagues } = openings();
    expect(topThree.filter((n) => n >= 3).length / leagues).toBeLessThanOrEqual(1);
    const top10 = deals.filter((d) => d.kind === 'rookie' && d.pick !== undefined && d.pick <= 10);
    expect(share(top10, (d) => d.depth)).toBeLessThanOrEqual(0.07);
  }, 60_000);

  it("signs quarterbacks and specialists for the years their position's clock gives", () => {
    // A quarterback, kicker or punter signs his second deal at 26 for five years (`preferredYears`, four years later
    // on his clock than a receiver), so at 30-32 a settled league's top 32 at those positions are about a third in
    // their last year (QB 35%, K and P 32%). Years drawn by age alone put them at 57% and 60%, a receiver's.
    const { deals } = openings();
    const vets = deals.filter((d) => d.kind !== 'rookie' && d.rank < 32 && d.age >= 30 && d.age <= 32);
    const qbs = vets.filter((d) => d.position === 'QB');
    const specialists = vets.filter((d) => d.position === 'K' || d.position === 'P');
    expect(share(qbs, (d) => d.left === 1)).toBeGreaterThanOrEqual(0.2);
    expect(share(qbs, (d) => d.left === 1)).toBeLessThanOrEqual(0.45);
    expect(share(specialists, (d) => d.left === 1)).toBeGreaterThanOrEqual(0.2);
    expect(share(specialists, (d) => d.left === 1)).toBeLessThanOrEqual(0.45);
  }, 60_000);

  it('keeps payroll raises off minimum-salary players and undrafted rookies', () => {
    // Settled: at most 3-4 veterans on a team whom the market prices at the minimum charge over 3x it, and an
    // undrafted player's first deal is a minimum one. A thin roster's room spread by pay once reached 15 on a team
    // (an offensive lineman ranked 255th at 5.9x the minimum) and relabelled 16 undrafted rookies a league veterans.
    const { floorRaised, deals } = openings();
    expect(Math.max(...floorRaised)).toBeLessThanOrEqual(4);
    const undrafted = deals.filter((d) => d.kind !== 'rookie' && d.round === undefined && d.experience < 4);
    expect(undrafted.length).toBeGreaterThan(0);
    expect(undrafted.filter((d) => d.kind !== 'minimum')).toEqual([]);
  }, 60_000);
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
    // Paid above the minimum this year: an opening roster over its target has already restructured its biggest deals.
    const vet = Object.values(league.players).find(
      (p) =>
        p.contract?.kind === 'veteran' &&
        p.contract.years.length >= 3 &&
        p.contract.years[0].base > minSalary(p.experience, BASE_CAP),
    )!;
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
  });
});

describe('save migration', () => {
  it('upgrades a v1 save to year-by-year contracts', () => {
    const league = createLeague({ seed: 'migrate' });
    // Rebuild the v1 shape: flat contracts, a single salaryCap, no ledgers.
    const v1 = JSON.parse(JSON.stringify(league)) as Record<string, unknown> & League;
    v1.version = 1;
    (v1 as unknown as { salaryCap: number }).salaryCap = 301_200;
    delete (v1 as Partial<League>).caps;
    for (const p of Object.values(v1.players))
      (p as unknown as { contract: unknown }).contract = { salary: 5_000, years: 2 };
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
