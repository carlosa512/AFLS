/**
 * Disputes (docs/superpowers/specs/2026-10-30-morale-escalations-design.md, G4): a talk that ended badly (ignored,
 * answered firm, a promise broken) and a man still Very poor four steps later, with that talk's cause still his top
 * reason, escalates: a hold-in or a holdout over a deal, a trade request over the rest. One step runs at the end of every
 * morale step, after the talks; it draws nothing, and what it does to rosters and games sits behind `MOOD_ACTS`.
 */
import { MOOD_ACTS } from './disputeRead';
import { isExpired, yearOf, yearsLeft } from './finance/contract';
import { addJolt, expectedRole, moraleLevel, moraleFactors, type MoraleContext } from './morale';
import { aiCutdown } from './offseason/ai';
import { extensionBlocker, ROSTER_MAX } from './offseason/negotiation';
import { talkCause } from './playerTalks';
import { activeRoster } from './roster';
import type { DisputeHow, League, Player } from './types';

/** Very poor steps in a row after a talk soured before he escalates. */
export const RUN_STEPS = 4;
/** The last step a contract dispute can start in: camp. */
const CAMP = 7;
/** Morale's clock: steps in a league year, and the first regular-season step (before week 1's games). */
const YEAR = 32;
const REGULAR = 8;
/** Weekly game checks in a season. */
const CHECKS = 18;
/** A veteran's camp fine: $50K a day (the 2020 CBA) over about 45 days of camp, $K. */
export const CAMP_FINE = 2250;
/** Very poor or worse, as the words read it. */
const VERY_POOR = -3;

/** A holdout when he's a greedy veteran starter off his rookie deal (or in its option year); otherwise a hold-in. */
export function disputeKind(league: League, p: Player, ctx: MoraleContext): 'holdIn' | 'holdOut' {
  const c = p.contract;
  const offRookie =
    !!c && (c.kind !== 'rookie' || (c.fifthYearOption === 'exercised' && yearsLeft(c, league.season) === 1));
  return offRookie && expectedRole(p, ctx) === 2 && p.personality.greed >= 0.6 ? 'holdOut' : 'holdIn';
}

/** A deal he could be extended out of: two years or fewer left, past what a rookie deal blocks. */
function extendable(league: League, p: Player): boolean {
  const c = p.contract;
  return !!c && !isExpired(c, league.season) && yearsLeft(c, league.season) <= 2 && !extensionBlocker(league, p);
}

/** Whether a soured talk can start a dispute now: the cause, the calendar and his deal. */
function canStart(league: League, p: Player, ctx: MoraleContext, clock: number, week: number): boolean {
  const s = p.morale!.talk!.sour!;
  if (p.injury || p.ir) return false;
  if (!s.now && s.run < RUN_STEPS) return false;
  if (talkCause(league, p, moraleFactors(league, p, ctx), clock) !== s.cause) return false;
  // Trade requests are G4b's; until then only a deal escalates.
  if (s.cause !== 'deal') return false;
  return week >= 0 && week <= CAMP && extendable(league, p);
}

/** What a holdout will lose before he gives in: a calm man his camp fine, the most stubborn half his year's base. */
export function giveInLimit(league: League, p: Player): number {
  const base = (p.contract && yearOf(p.contract, league.season)?.base) ?? 0;
  const resolve = (p.personality.greed + 1 - p.personality.patience) / 2;
  return base * (0.05 + 0.45 * resolve);
}

/**
 * A dispute's end: how it went on file for the letters; rust when he comes back in season having missed camp; the talk
 * soured again when he played or gave in without a deal (a trade request can follow in season, G4b).
 */
export function endDispute(league: League, p: Player, how: DisputeHow, clock: number): void {
  const m = p.morale!;
  const d = m.dispute!;
  const start = league.season * YEAR;
  m.disputeEnd = { kind: d.kind, since: d.since, how, at: clock };
  delete m.dispute;
  const missedCamp = d.since <= start + CAMP && clock >= start + REGULAR;
  if (missedCamp && how !== 'released' && how !== 'newYear')
    m.rust = { season: league.season, week: clock - start - REGULAR + 1 };
  if (how === 'gaveIn') addJolt(p, 'gaveIn', -2, clock);
  if ((how === 'week1' || how === 'gaveIn') && p.teamId !== null) {
    const t = (m.talk ??= { club: p.teamId });
    t.sour = { cause: d.cause, at: clock, run: 0, after: d.kind };
  }
  // Back on the 53: an AI club over the limit makes room by its own cut rule.
  const team = p.teamId === null ? undefined : league.teams[p.teamId];
  if (d.out && team && team.id !== league.userTeamId && league.phase === 'regular')
    if (activeRoster(league, team.id).length > ROSTER_MAX) aiCutdown(league, team, ROSTER_MAX);
}

/** An open dispute's step: off to Did Not Report at camp, the fine as camp ends, the game checks, giving in. */
function runDispute(league: League, p: Player, clock: number, week: number, newYear: boolean): void {
  const m = p.morale!;
  const d = m.dispute!;
  if (p.teamId !== d.club) return endDispute(league, p, p.teamId === null ? 'released' : 'traded', clock);
  if (m.jolts?.some((j) => j.kind === 'paid' && j.at === clock)) return endDispute(league, p, 'signed', clock);
  if (d.kind === 'trade') return;
  if (newYear && d.since < league.season * YEAR) return endDispute(league, p, 'newYear', clock);
  if (d.kind === 'holdIn') {
    if (week >= REGULAR) endDispute(league, p, 'week1', clock);
    return;
  }
  if (week >= CAMP) d.out = true;
  if (week === REGULAR) {
    d.fined = (d.fined ?? 0) + CAMP_FINE;
    d.lost = (d.lost ?? 0) + CAMP_FINE;
    p.lostAccrual = league.season;
  }
  // After each regular-season week's games, a game check he didn't earn.
  const y = p.contract && yearOf(p.contract, league.season);
  if (week > REGULAR && week <= REGULAR + CHECKS && y && (y.withheld ?? 0) < CHECKS) {
    y.withheld = (y.withheld ?? 0) + 1;
    d.lost = (d.lost ?? 0) + Math.round(y.base / CHECKS);
  }
  if (week >= REGULAR && (d.lost ?? 0) >= giveInLimit(league, p)) endDispute(league, p, 'gaveIn', clock);
}

/**
 * One dispute step: open disputes run (and end), then the runs of Very poor steps since a talk soured, then new
 * disputes, one a club a step, the unhappiest first.
 */
export function disputeStep(league: League, ctx: MoraleContext, clock: number, week: number, newYear: boolean): void {
  if (!MOOD_ACTS.on) return;
  for (const p of Object.values(league.players)) if (p.morale?.dispute) runDispute(league, p, clock, week, newYear);
  const ready = new Map<number, { p: Player; level: number }[]>();
  for (const p of Object.values(league.players)) {
    const m = p.morale;
    const s = m?.talk?.sour;
    if (!m || !s || p.teamId === null || m.dispute) continue;
    const level = moraleLevel(league, p, clock);
    // The step it soured isn't one of the steps since.
    if (s.at < clock) s.run = level <= VERY_POOR ? s.run + 1 : 0;
    if (level > VERY_POOR && !s.now) continue;
    if (!canStart(league, p, ctx, clock, week)) continue;
    const list = ready.get(p.teamId) ?? [];
    list.push({ p, level });
    ready.set(p.teamId, list);
  }
  for (const list of ready.values()) {
    const { p } = list.sort((a, b) => a.level - b.level || a.p.id - b.p.id)[0];
    const m = p.morale!;
    m.dispute = { kind: disputeKind(league, p, ctx), cause: m.talk!.sour!.cause, since: clock, club: p.teamId! };
    // A holdout who starts at camp is out at once.
    if (m.dispute.kind === 'holdOut' && week >= CAMP) m.dispute.out = true;
    delete m.talk!.sour;
  }
}
