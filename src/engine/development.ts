/**
 * Player development between seasons. Young players grow toward their ceiling, faster with reps
 * and a work ethic; veterans hold through their prime, then fade family by family (physical tools
 * first, the mental game last) on their position's curve, shaped by their body clock (`aging.ts`).
 */
import { agingFamily, AGING, declineOnset } from './aging';
import type { AgingFamily } from './attributes';
import { ATTRIBUTE_PROFILES, OVR_WEIGHTS, playerOvr } from './positions';
import { clamp, type Rng } from './rng';
import { declineMult, growthMult } from './traits';
import type { Attribute, League, Player, Position } from './types';
import { ATTRIBUTES } from './types';

export { PEAK_END } from './aging';

/** Note a player's ratings at the start of a league year, for his development history. */
export function recordRatings(player: Player, season: number): void {
  (player.ratingHistory ??= {})[season] = ATTRIBUTES.map((a) => player.ratings[a]);
}

export interface DevContext {
  /** Share of last season's games he played in (0–1). Young players grow with reps. */
  playedShare: number;
  /** Growth multiplier from his coaches (1 = typical; `coachingFor` in coaching.ts). */
  rate?: number;
  /** Decline multiplier per family of ratings from his coaches (1 = typical, below 1 ages more gently). */
  decline?: Partial<Record<AgingFamily, number>>;
  /**
   * The position his body ages as, when he has changed positions (`bodyPosition` in training.ts): his
   * physical tools keep that position's clock, so a move can't buy a younger body.
   */
  bodyAs?: Position;
}

/** Regular-season games: a full season of reps. */
const SEASON_GAMES = 17;

/** Share of `season`'s games a player suited up for. */
export function playedShare(p: Player, season: number): number {
  return Math.min(1, (p.stats[season]?.gp ?? 0) / SEASON_GAMES);
}

/**
 * Share of his team's games so far in `season` that a player suited up for, or null before four
 * games, too early to tell.
 */
export function repsSoFar(league: League, p: Player, season: number): number | null {
  const played = p.stats[season]?.gp ?? 0;
  const teamGames = p.teamId === null ? SEASON_GAMES : league.games.filter((g) => g.season === season && !g.playoffRound && g.result && (g.homeId === p.teamId || g.awayId === p.teamId)).length;
  return teamGames < 4 ? null : Math.min(1, played / teamGames);
}

/**
 * Reps matter more as a player ages: at 21 practice carries most of his growth, by 24 game snaps
 * do (FM testers put it near 50–50 at 18 and match-dominated by 23). By then a starter grows about
 * 20% faster than average, a player who never sees the field about 35% slower.
 */
function reps(age: number, share: number): number {
  const weight = clamp((age - 20) / 4, 0.25, 1);
  return 1 + weight * (-0.35 + 0.55 * share);
}
/** Keeps league-wide growth where it was before reps counted (most young players are backups). */
const GROWTH_NORM = 1.1;

/** Where growth lands: physical tools are about done by 25; late gains are technique and the mental game. */
function growthShare(family: AgingFamily, age: number): number {
  if (family === 'physical') return clamp((26 - age) / 3, 0, 1);
  return family === 'mental' ? 1.2 : 1;
}
/** Physical tools fall fastest; the mental game barely moves. */
const FAMILY_LOSS: Record<AgingFamily, number> = { physical: 1.2, technical: 1, mental: 0.3 };
/** The mental game keeps sharpening through the prime. */
const MENTAL_GROWTH = 0.06;

/** One offseason of development. `rng` is the player's own stream for the year. */
export function developPlayer(rng: Rng, player: Player, ctx: DevContext): void {
  const age = player.age;
  const pos = player.position;
  const traits = player.traits;
  const rate = ctx.rate ?? 1;
  const profile = ATTRIBUTE_PROFILES[pos];
  const weights = OVR_WEIGHTS[pos];
  const attrs = ATTRIBUTES.filter((a) => profile[a] !== undefined);

  // Growth (or prime-years drift), in overall points.
  let delta: number;
  if (age < 26) {
    const gap = Math.max(0, player.potential - playerOvr(player));
    delta = gap * clamp(rng.float(0.15, 0.5) * growthMult(traits) * reps(age, ctx.playedShare) * rate * GROWTH_NORM, 0, 0.8);
  } else delta = rng.normal(0, 0.4);
  // Spread it so the overall moves by `delta`: weighted toward the families still growing.
  let shareSum = 0;
  let weightSum = 0;
  for (const a of attrs) {
    const w = weights[a] ?? 0;
    shareSum += w * growthShare(agingFamily(pos, a), age);
    weightSum += w;
  }
  const norm = shareSum > 0 ? weightSum / shareSum : 1;

  // A good or bad year for the body, shared by everything that is declining.
  const year = rng.float(0.3, 1.4);
  for (const attr of attrs) {
    const family = agingFamily(pos, attr);
    // Technique and the mental game age with the job; the body keeps the clock of the position it grew up in.
    const clock = family === 'physical' && ctx.bodyAs ? ctx.bodyAs : pos;
    const past = age - declineOnset(clock, family, traits);
    let d: number;
    if (past > 0) {
      // Within a year of the turn the decline phases in; after that it speeds up every season.
      const coached = ctx.decline?.[family] ?? 1;
      const fade = AGING[clock].slope * declineMult(traits);
      d = -year * fade * coached * FAMILY_LOSS[family] * Math.min(1, past) * (1 + 0.25 * Math.max(0, past - 1) + 0.25);
    } else {
      d = delta * Math.min(2, growthShare(family, age) * norm);
      if (family === 'mental' && age >= 26) d += MENTAL_GROWTH;
    }
    player.ratings[attr as Attribute] = Math.round(clamp(player.ratings[attr] + d + rng.normal(0, 0.35), 1, 20));
  }
}
