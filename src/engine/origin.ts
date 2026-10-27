/**
 * Where a player came from (`data/origins.ts`), and what that does: nothing to his ratings, only to how much film
 * the league has seen of him (`filmScale`, read by `knowledge` in `scouting.ts`).
 *
 * The draw reads a seed, an id and a rank band, never a name or a heritage, and runs on its own stream, so no other
 * roll moves. Tier odds by band reproduce the real draft (2025: 87% power conferences, 10% Group of 5, 3% FCS) and
 * opening-day rosters (FBS 88%, FCS 8%, Division II 2.4%): small schools come in mostly undrafted.
 */
import { COLLEGES_BY_TIER, ORIGINS, type Origin, type OriginTier } from './data/origins';
import { Rng } from './rng';
import type { Player } from './types';

/** Rows of the tier table: ranks 1–32, 33–100, 101–224, then 225 and undrafted. */
export type RankBand = 0 | 1 | 2 | 3;

const TIERS: readonly OriginTier[] = ['power', 'group5', 'fcs', 'small'];
/** Odds of power, group5, fcs, small by band (starting odds from the spec, checked against the targets in tests). */
const TIER_ODDS: readonly (readonly number[])[] = [
  [0.97, 0.03, 0, 0],
  [0.9, 0.08, 0.02, 0],
  [0.8, 0.13, 0.05, 0.02],
  [0.55, 0.2, 0.17, 0.08],
];

export const bandForRank = (rank: number): RankBand => (rank <= 32 ? 0 : rank <= 100 ? 1 : rank <= 224 ? 2 : 3);
export const bandForDraftRound = (round: number): RankBand => (round <= 1 ? 0 : round <= 3 ? 1 : 2);
/** `share`: where his overall sits among his position's players, 0 = the best. */
export const bandForShare = (share: number): RankBand => (share < 0.2 ? 0 : share < 0.45 ? 1 : share < 0.8 ? 2 : 3);

/** A college for player `playerId`, from his band's tier odds, then the tier's schools by NFL output. */
export function collegeOrigin(seed: string, playerId: number, band: RankBand): number {
  const rng = new Rng(`${seed}:origin:${playerId}`);
  const tier = rng.weighted(TIERS, (t) => TIER_ODDS[band][TIERS.indexOf(t)]);
  return rng.weighted(COLLEGES_BY_TIER[tier], (i) => ORIGINS[i].weight!);
}

export const originOf = (p: Player): Origin | undefined => (p.origin === undefined ? undefined : ORIGINS[p.origin]);

/** Share of a big program's film the league has on a prospect (AFLS estimate). */
export const FILM: Record<OriginTier | 'pathway', number> = {
  power: 1,
  group5: 0.85,
  fcs: 0.7,
  small: 0.55,
  pathway: 0.4,
};

/** 1 for a big program, the CFL (its film is counted in seasons instead) or an unknown origin. */
export function filmScale(p: Player): number {
  const o = originOf(p);
  if (!o || o.kind === 'cfl') return 1;
  return o.kind === 'pathway' ? FILM.pathway : FILM[o.tier!];
}
