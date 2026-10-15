/**
 * Contract arithmetic (2020 CBA rules, simplified). Pure functions over the plain-JSON
 * Contract so the UI can preview any move before it happens. Money is in $K.
 *
 * - Bonus money is prorated evenly over at most five league years.
 * - Releasing or trading a player accelerates his remaining proration into dead money;
 *   a post-June 1 move splits it: this year's share now, the rest next league year.
 * - Guaranteed base salary is still owed after a release.
 * - A restructure converts base salary to bonus: cap room now, more dead money later.
 */
import type { Contract, ContractYear, Proration } from '../types';

export const MAX_PRORATION_YEARS = 5;
export const REGULAR_SEASON_WEEKS_PAID = 18;

export function yearOf(c: Contract, season: number): ContractYear | undefined {
  return c.years.find((y) => y.season === season);
}

/** Bonus proration charged to `season`. */
export function prorationIn(c: Contract, season: number): number {
  let sum = 0;
  for (const b of c.bonuses) if (season >= b.start && season < b.start + b.years) sum += b.amount / b.years;
  return sum;
}

/** Cap charge for a league year while the player is on the roster. */
export function capHit(c: Contract, season: number): number {
  return (yearOf(c, season)?.base ?? 0) + prorationIn(c, season);
}

/** Real (non-void) seasons left, counting `season`. */
export function yearsLeft(c: Contract, season: number): number {
  return c.years.filter((y) => !y.void && y.season >= season).length;
}

/** The last league year the player is actually under contract. */
export function lastSeason(c: Contract): number {
  const real = c.years.filter((y) => !y.void);
  return real.length ? real[real.length - 1].season : -Infinity;
}

export const isExpired = (c: Contract, season: number) => lastSeason(c) < season;

/** Proration still to be charged after `season` (including void years). */
export function futureProration(c: Contract, season: number): number {
  let sum = 0;
  for (const b of c.bonuses) {
    const per = b.amount / b.years;
    for (let y = b.start; y < b.start + b.years; y++) if (y > season) sum += per;
  }
  return sum;
}

/** Proration parked in void years, which accelerates as dead money when the deal voids. */
export function voidProration(c: Contract): number {
  return c.years.filter((y) => y.void).reduce((sum, y) => sum + prorationIn(c, y.season), 0);
}

export function guaranteedFrom(c: Contract, season: number): number {
  return c.years.filter((y) => y.season >= season).reduce((sum, y) => sum + y.guaranteed, 0);
}

export interface DeadMoneySplit {
  thisYear: number;
  nextYear: number;
  /** Cap room gained this league year (cap hit removed minus dead money added). */
  savings: number;
}

/**
 * Dead money if the player leaves the team in `season`.
 * @param paid  fraction of this season's base already paid (weeks elapsed / 18); 0 in the offseason
 * @param postJune1  post-June 1 accounting (automatic once training camp opens)
 * @param trade  traded players take their remaining salary (guaranteed or not) with them
 */
export function deadMoney(c: Contract, season: number, opts: { paid?: number; postJune1?: boolean; trade?: boolean } = {}): DeadMoneySplit {
  const paid = opts.paid ?? 0;
  const year = yearOf(c, season);
  const base = year?.base ?? 0;
  const paidBase = base * paid;
  const current = prorationIn(c, season);
  const future = futureProration(c, season);
  // Salary already paid stays on this year's cap; unpaid guarantees are owed unless traded.
  const gtdNow = opts.trade ? 0 : Math.max(0, (year?.guaranteed ?? 0) - paidBase);
  const gtdLater = opts.trade ? 0 : c.years.filter((y) => y.season > season).reduce((s, y) => s + y.guaranteed, 0);
  const thisYear = opts.postJune1 ? current + paidBase + gtdNow : current + future + paidBase + gtdNow + gtdLater;
  const nextYear = opts.postJune1 ? future + gtdLater : 0;
  return { thisYear, nextYear, savings: capHit(c, season) - thisYear };
}

export interface RestructurePreview {
  /** Max base salary that can be converted this year (all but the league minimum). */
  max: number;
  years: number;
  savings: number;
  /** Extra cap charge added to each later league year. */
  addedPerYear: number;
}

/** Converting `amount` of this year's base into a bonus spread over the remaining years (max 5). */
export function restructurePreview(c: Contract, season: number, amount: number, minSalary: number): RestructurePreview {
  const year = yearOf(c, season);
  const max = Math.max(0, (year?.base ?? 0) - minSalary);
  const years = Math.min(MAX_PRORATION_YEARS, c.years.filter((y) => y.season >= season).length);
  const x = Math.max(0, Math.min(amount, max));
  return { max, years, savings: years > 1 ? x - x / years : 0, addedPerYear: years > 1 ? x / years : 0 };
}

/** Apply a restructure; returns cap savings this league year. */
export function restructure(c: Contract, season: number, amount: number, minSalary: number): number {
  const p = restructurePreview(c, season, amount, minSalary);
  const x = Math.min(amount, p.max);
  if (x <= 0 || p.years <= 1) return 0;
  const year = yearOf(c, season)!;
  year.base -= x;
  // The converted salary is paid as a bonus now, so it is no longer at risk either way.
  year.guaranteed = Math.min(year.guaranteed, year.base);
  c.bonuses.push({ amount: x, start: season, years: p.years, source: 'restructure' });
  return p.savings;
}

/** Drop past league years; bonuses keep their own schedule. */
export function trimPast(c: Contract, season: number): void {
  c.years = c.years.filter((y) => y.season >= season);
}

export interface ContractTerms {
  /** Real seasons. */
  years: number;
  /** Total new money over the real seasons, $K. */
  total: number;
  /** Paid up front and prorated. */
  signingBonus: number;
  /** Fully guaranteed base salary, applied to the earliest years first. */
  guaranteedBase: number;
  /** Dummy years appended to spread the bonus further (proration still capped at 5). */
  voidYears: number;
  /** Yearly raise on base salary, e.g. 0.05. */
  escalator?: number;
}

/** Build a contract from negotiated terms, starting in league year `start`. */
export function buildContract(terms: ContractTerms, start: number, kind: Contract['kind'], minSalary: number, signedWeek = 0): Contract {
  const n = Math.max(1, Math.round(terms.years));
  const esc = terms.escalator ?? 0.04;
  const bonus = Math.max(0, Math.min(terms.signingBonus, terms.total - n * minSalary));
  const baseTotal = terms.total - bonus;
  // Escalating base salaries that sum to baseTotal.
  const weights = Array.from({ length: n }, (_, i) => (1 + esc) ** i);
  const wsum = weights.reduce((a, b) => a + b, 0);
  const years: ContractYear[] = weights.map((w, i) => ({ season: start + i, base: Math.max(minSalary, Math.round((baseTotal * w) / wsum)), guaranteed: 0 }));
  let gtd = Math.max(0, terms.guaranteedBase);
  for (const y of years) {
    const g = Math.min(gtd, y.base);
    y.guaranteed = g;
    gtd -= g;
  }
  const voids = Math.max(0, Math.min(terms.voidYears, MAX_PRORATION_YEARS - Math.min(n, MAX_PRORATION_YEARS)));
  for (let i = 0; i < voids; i++) years.push({ season: start + n + i, base: 0, guaranteed: 0, void: true });
  const bonuses: Proration[] = bonus > 0 ? [{ amount: Math.round(bonus), start, years: Math.min(MAX_PRORATION_YEARS, n + voids), source: 'signing' }] : [];
  return { kind, signedSeason: start, signedWeek, apy: Math.round(terms.total / n), length: n, years, bonuses };
}

/** Total guaranteed at signing: the bonus plus guaranteed base. */
export function totalGuaranteed(c: Contract): number {
  return c.bonuses.filter((b) => b.source === 'signing').reduce((s, b) => s + b.amount, 0) + c.years.reduce((s, y) => s + y.guaranteed, 0);
}
