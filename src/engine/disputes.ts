/**
 * Disputes (docs/superpowers/specs/2026-10-30-morale-escalations-design.md, G4): a talk that ended badly (ignored,
 * answered firm, a promise broken) and a man still Very poor four steps later, with that talk's cause still his top
 * reason, escalates: a hold-in or a holdout over a deal, a trade request over the rest. One step runs at the end of every
 * morale step, after the talks; it draws nothing, and what it does to rosters and games sits behind `MOOD_ACTS`.
 */
import { MOOD_ACTS } from './disputeRead';
import { isExpired, yearsLeft } from './finance/contract';
import { expectedRole, moraleLevel, moraleFactors, type MoraleContext } from './morale';
import { extensionBlocker } from './offseason/negotiation';
import { talkCause } from './playerTalks';
import type { League, Player } from './types';

/** Very poor steps in a row after a talk soured before he escalates. */
export const RUN_STEPS = 4;
/** The last step a contract dispute can start in: camp. */
const CAMP = 7;
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

/**
 * One dispute step: the runs of Very poor steps since a talk soured, then new disputes, one a club a step, the
 * unhappiest first.
 */
export function disputeStep(league: League, ctx: MoraleContext, clock: number, week: number, _newYear: boolean): void {
  if (!MOOD_ACTS.on) return;
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
    m.dispute = { kind: disputeKind(league, p, ctx), cause: m.talk!.sour!.cause, since: clock };
    delete m.talk!.sour;
  }
}
