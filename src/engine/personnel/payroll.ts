import type { League, Player } from '../types';

/** AFLS reserves a full regular-season week on signing, even between payroll ticks. */
export const squadPayWeek = (league: League) =>
  league.phase === 'regular' ? Math.min(18, league.week) : ['playoffs', 'complete'].includes(league.phase) ? 18 : 1;
const cents = (n: number) => Math.round(n * 1000) / 1000;
const key = (teamId: number, playerId: number) => `${teamId}:${playerId}`;
type Payroll = { earned: number; projected: number; total: number };
const cache = new WeakMap<League, { key: string; state: League['personnel']; totals: Map<number, Payroll> }>();

/** All squad membership/pay writers invalidate this read-only cache; NFL trades need no squad scan. */
export const invalidateSquadPayroll = (league: League) => cache.delete(league);

export function ensureSquads(league: League) {
  if (!league.personnel?.enabled) throw new Error('Personnel transactions are not active.');
  if (league.personnel.squads?.season !== league.season)
    league.personnel.squads = {
      season: league.season,
      offers: [],
      returns: [],
      results: [],
      payroll: { week: squadPayWeek(league), earned: {}, receipts: {} },
    };
  return league.personnel.squads;
}

/** Pure cap query: settled earnings stay after release; unposted checks and future salary remain reserved. */
export function squadPayroll(league: League, teamId: number, season = league.season) {
  if (!league.personnel?.enabled || season !== league.season) return { earned: 0, projected: 0, total: 0 };
  const cacheKey = `${season}:${league.phase}:${league.week}`;
  const hit = cache.get(league);
  if (hit?.key === cacheKey && hit.state === league.personnel)
    return { ...(hit.totals.get(teamId) ?? { earned: 0, projected: 0, total: 0 }) };
  const state = league.personnel.squads;
  const totals = new Map<number, Payroll>(
    league.teams.map((t) => [
      t.id,
      { earned: state?.season === season ? (state.payroll.earned[t.id] ?? 0) : 0, projected: 0, total: 0 },
    ]),
  );
  const week = squadPayWeek(league);
  for (const p of Object.values(league.players)) {
    const a = p.squad?.agreement;
    if (p.teamId === null || !a || a.season !== season) continue;
    const total = totals.get(p.teamId)!;
    total.earned += Math.max(0, week - Math.max(a.paidThrough, a.startWeek - 1)) * a.weeklyPay;
    total.projected += (18 - Math.max(week, a.startWeek - 1)) * a.weeklyPay;
    const continuation = p.squad?.continuation;
    if (p.injury && continuation?.season === season) {
      const extra = Math.max(0, continuation.weeklyPay - a.weeklyPay);
      total.earned += Math.max(0, week - Math.max(continuation.paidThrough, continuation.fromWeek - 1)) * extra;
      total.projected += Math.max(0, 18 - Math.max(week, continuation.fromWeek - 1)) * extra;
    }
  }
  for (const pay of totals.values()) {
    pay.total = cents(pay.earned + pay.projected);
    pay.earned = cents(pay.earned);
    pay.projected = cents(pay.projected);
  }
  cache.set(league, { key: cacheKey, state: league.personnel, totals });
  return { ...(totals.get(teamId) ?? { earned: 0, projected: 0, total: 0 }) };
}

/** One cumulative team ledger plus this week's receipts, rather than thousands of weekly save records. */
export function settleSquadPayroll(league: League): void {
  if (!league.personnel?.enabled) return;
  invalidateSquadPayroll(league);
  const { payroll } = ensureSquads(league);
  const week = squadPayWeek(league);
  if (payroll.week !== week) {
    payroll.week = week;
    payroll.receipts = {};
    delete payroll.credits;
  }
  for (const p of Object.values(league.players)) {
    const a = p.squad?.agreement;
    if (p.teamId === null || !a || a.season !== league.season) continue;
    const count = Math.max(0, week - Math.max(a.paidThrough, a.startWeek - 1));
    if (count) {
      payroll.earned[p.teamId] = cents((payroll.earned[p.teamId] ?? 0) + count * a.weeklyPay);
      payroll.receipts[key(p.teamId, p.id)] = a.weeklyPay;
      a.paidThrough = week;
    }
    const continuation = p.squad?.continuation;
    if (continuation?.season === league.season) {
      if (!p.injury) delete p.squad!.continuation;
      else {
        const checks = Math.max(0, week - Math.max(continuation.paidThrough, continuation.fromWeek - 1));
        payroll.earned[p.teamId] = cents(
          (payroll.earned[p.teamId] ?? 0) + checks * Math.max(0, continuation.weeklyPay - a.weeklyPay),
        );
        continuation.paidThrough = week;
      }
    }
  }
}

/** A same-team re-sign within the week owes only a raise, never a second copy of the same check. */
export function startSquadPay(league: League, p: Player, weeklyPay: number): void {
  settleSquadPayroll(league);
  const { payroll } = ensureSquads(league);
  const id = p.teamId!;
  const receipt = payroll.receipts[key(id, p.id)] ?? 0;
  const due = Math.max(0, weeklyPay - receipt);
  payroll.earned[id] = cents((payroll.earned[id] ?? 0) + due);
  payroll.receipts[key(id, p.id)] = Math.max(receipt, weeklyPay);
  const week = squadPayWeek(league);
  p.squad = {
    kind: 'practiceSquad',
    agreement: { season: league.season, weeklyPay, startWeek: week, paidThrough: week },
  };
  invalidateSquadPayroll(league);
}

/** The NFL check replaces this week's squad check; its guarantee preserves the already-earned amount. */
export function promotionCredit(league: League, p: Player, settle = false): number {
  if (settle) settleSquadPayroll(league);
  const payroll = league.personnel?.squads?.payroll;
  const receipt = payroll?.week === squadPayWeek(league) ? (payroll.receipts[key(p.teamId!, p.id)] ?? 0) : 0;
  const a = p.squad?.agreement;
  const alreadyCredited = payroll?.week === squadPayWeek(league) ? (payroll.credits?.[key(p.teamId!, p.id)] ?? 0) : 0;
  const credit = Math.max(
    0,
    Math.max(receipt, a && a.paidThrough < squadPayWeek(league) ? a.weeklyPay : 0) - alreadyCredited,
  );
  if (settle && payroll) {
    payroll.earned[p.teamId!] = cents((payroll.earned[p.teamId!] ?? 0) - credit);
    if (credit) (payroll.credits ??= {})[key(p.teamId!, p.id)] = cents(alreadyCredited + credit);
    invalidateSquadPayroll(league);
    // Keep the receipt so release/re-sign inside this week cannot duplicate pay.
  }
  return credit;
}

/** Current injury-continuation rate for contract displays; call-up top-ups are shown separately. */
export const weeklySquadPay = (p: Player) =>
  p.injury && p.squad?.continuation ? p.squad.continuation.weeklyPay : (p.squad?.agreement?.weeklyPay ?? 0);
