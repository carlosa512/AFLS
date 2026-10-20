/**
 * Physicals (docs/TRADES.md, "Physicals"): a deal is agreed first and becomes official once each
 * player passes the buyer's doctor. Picks have no physical.
 *
 * What fails a player is his body, read through the buyer's doctor: a current injury, severe
 * injuries in his recent history and the scars they left, years past his position's physical prime,
 * and his hidden injury resistance. A sharp doctor (diagnosis) reads that close to the truth; a weak
 * one misses real problems and now and then fails a sound player. Every exam draws from its own
 * stream, so a reloaded save examines the same way. The verdict is told in words, never a number.
 */
import { declineOnset } from '../aging';
import { effectiveResistance, injuryLabel } from '../injuries';
import { departmentFor, diagnosisSpread } from '../medical';
import { Rng } from '../rng';
import { TRAIT_MEAN } from '../traits';
import type { League, Physical, Player } from '../types';
import type { TradeContext } from './context';
import type { TradeProposal } from './rules';
import { goingRate } from './value';

/** The doctor's read at or past which he has concerns, and at or past which he fails the player. */
export const CONCERNS = 1.2;
export const FAIL = 1.9;
/** How far a doctor's read strays, as a multiple of his diagnosis spread (a weak doctor: about ±0.8). */
const READ_NOISE = 1.4;

/** The years his recent history counts: what's healed long ago doesn't worry a doctor. */
const HISTORY_SEASONS = 3;

interface Findings {
  /** The body's real problems, in the doctor's units: about 0 for a sound player, 2 for one who should fail. */
  score: number;
  /** What a doctor would name first. */
  cause: 'injury' | 'history' | 'age' | 'durability';
}

/** What's really wrong with a player's body, whatever a doctor makes of it. */
export function findings(league: League, p: Player): Findings {
  const parts = bodyParts(league, p);
  const score = parts.reduce((s, [, v]) => s + v, 0);
  const cause = parts.filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'durability';
  return { score, cause };
}

/**
 * What any front office can read in his file before it calls, in the doctor's units: his injury now,
 * his recent history and his age, not the hidden durability only an exam gets at. A team taking on a
 * bad contract or a late-pick flyer doesn't call about a file that already worries a doctor.
 */
export function onFile(league: League, p: Player): number {
  return bodyParts(league, p)
    .filter(([cause]) => cause !== 'durability')
    .reduce((s, [, v]) => s + v, 0);
}

function bodyParts(league: League, p: Player): [Findings['cause'], number][] {
  const parts: [Findings['cause'], number][] = [];
  // Out now: a month and a half of rehab is about a failed physical on its own.
  if (p.injury) parts.push(['injury', p.injury.weeksRemaining / 4]);
  const recent = (p.injuries ?? []).filter((r) => r.season > league.season - HISTORY_SEASONS && !r.aggravated);
  const history = recent.reduce(
    (s, r) => s + (r.severity === 'career-threatening' ? 1 : r.severity === 'severe' ? 0.6 : 0) + (r.scar ? 0.3 : 0),
    0,
  );
  parts.push(['history', history]);
  parts.push(['age', 0.15 * Math.max(0, p.age - declineOnset(p.position, 'physical', p.traits))]);
  parts.push(['durability', 0.12 * (TRAIT_MEAN - effectiveResistance(p))]);
  return parts;
}

const name = (p: Player) => `${p.firstName} ${p.lastName}`;

function note(p: Player, result: Physical['result'], cause: Findings['cause']): string {
  const what =
    cause === 'injury' && p.injury
      ? `the ${injuryLabel(p.injury.type).toLowerCase()} hasn't healed`
      : cause === 'history'
        ? `his injury history worries the doctor`
        : cause === 'age'
          ? `his body is wearing down`
          : `he doesn't look like he holds up`;
  if (result === 'failed') return `${name(p)} failed his physical: ${what}.`;
  if (result === 'concerns') return `${name(p)} passed with concerns: ${what}.`;
  if (result === 'rehab')
    return `${name(p)} is cleared to rehab: he'll be back in about ${Math.max(1, Math.round(p.injury?.weeksRemaining ?? 1))} weeks.`;
  return `${name(p)} passed his physical.`;
}

/**
 * The buyer's doctor examines one incoming player. In the offseason a player who's hurt but sound
 * otherwise is *cleared to rehab* rather than failed: there's time for him to heal before it counts.
 * `diagnosis` stands in for his doctor's rating (the check compares a sharp doctor with a weak one).
 */
export function examine(
  league: League,
  buyerId: number,
  p: Player,
  diagnosis = departmentFor(league, buyerId).diagnosis,
): Physical {
  const truth = findings(league, p);
  const rng = new Rng(`${league.seed}:physical:${league.season}:${league.phase}:${league.week}:${p.id}:${buyerId}`);
  const read = truth.score + READ_NOISE * diagnosisSpread(diagnosis) * rng.normal();
  let result: Physical['result'] = read >= FAIL ? 'failed' : read >= CONCERNS ? 'concerns' : 'passed';
  // Hurt, but nothing else wrong with him: an offseason buyer can wait out the rehab.
  if (
    result !== 'passed' &&
    league.phase !== 'regular' &&
    p.injury &&
    truth.score - p.injury.weeksRemaining / 4 < CONCERNS
  )
    result = 'rehab';
  return { playerId: p.id, result, note: note(p, result, truth.cause) };
}

/** Every player in a deal examined by the team he'd join. */
export function physicals(league: League, proposal: TradeProposal): Physical[] {
  return proposal.sides.flatMap((side, i) =>
    side.players.map((id) => examine(league, proposal.sides[1 - i].teamId, league.players[id])),
  );
}

/** The worst result of a deal's physicals: one failure sinks it, one concern reopens the price. */
export function worstResult(exams: readonly Physical[]): Physical['result'] {
  if (exams.some((e) => e.result === 'failed')) return 'failed';
  if (exams.some((e) => e.result === 'concerns')) return 'concerns';
  return exams.some((e) => e.result === 'rehab') ? 'rehab' : 'passed';
}

/** The same deal a notch cheaper for `buyerId`: his least valuable pick out, or the seller's latest pick back. */
export function lowerPrice(ctx: TradeContext, proposal: TradeProposal, buyerId: number): TradeProposal | null {
  const { league } = ctx;
  const buys = proposal.sides.find((s) => s.teamId === buyerId)!;
  const sells = proposal.sides.find((s) => s.teamId !== buyerId)!;
  const pick = (ids: readonly number[]) =>
    ids
      .map((id) => league.draftPicks.find((p) => p.id === id)!)
      .sort((a, b) => goingRate(league, a, ctx) - goingRate(league, b, ctx))[0];
  const rebuild = (b: typeof buys, s: typeof sells): TradeProposal => ({
    sides: proposal.sides[0].teamId === buyerId ? [b, s] : [s, b],
  });
  if (buys.picks.length && buys.players.length + buys.picks.length > 1) {
    const out = pick(buys.picks);
    return rebuild({ ...buys, picks: buys.picks.filter((id) => id !== out.id) }, sells);
  }
  const back = league.draftPicks.filter(
    (p) => p.ownerId === sells.teamId && p.playerId === undefined && !sells.picks.includes(p.id),
  );
  if (!back.length) return null;
  return rebuild(buys, { ...sells, picks: [...sells.picks, pick(back.map((p) => p.id)).id] });
}
