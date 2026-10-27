/**
 * Where a player came from (`data/origins.ts`), and what that does: nothing to his ratings, only to how much film
 * the league has seen of him (`filmScale`, read by `knowledge` in `scouting.ts`).
 *
 * The draw reads a seed, an id and a rank band, never a name or a heritage, and runs on its own stream, so no other
 * roll moves. Tier odds by band reproduce the real draft (2025: 87% power conferences, 10% Group of 5, 3% FCS) and
 * opening-day rosters (FBS 88%, FCS 8%, Division II 2.4%): small schools come in mostly undrafted.
 */
import { CFL_ORIGIN, COLLEGES_BY_TIER, ORIGINS, PATHWAY_ORIGINS, type Origin, type OriginTier } from './data/origins';
import { Rng } from './rng';
import { playerOvr } from './positions';
import type { League, Player } from './types';
import { POSITIONS } from './types';

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

/** Positions the Pathway's converts play (`offseason/arrivals.ts` weighs them for new classes). */
const PATHWAY_POSITIONS = new Set(['DT', 'EDGE', 'OL', 'TE', 'RB', 'LB', 'P', 'K']);
/**
 * A league already has the players the Pathway and the CFL sent in earlier years, so they don't all arrive at once:
 * about 0.5% Pathway (young depth at the program's positions) and 1% CFL (veterans, rarely a top pick). The odds
 * are per eligible player (AFLS estimates, tuned to those shares in tests).
 */
const PATHWAY_ODDS = 0.025;
const CFL_ODDS = 0.016;

/** A Pathway country or the CFL for a player already in the league, or undefined for a college. */
function outsideOrigin(seed: string, p: Player, band: RankBand): number | undefined {
  const rng = new Rng(`${seed}:origin-kind:${p.id}`);
  const x = rng.next();
  if (band >= 2 && p.age <= 26 && (!p.draft || p.draft.round >= 4) && PATHWAY_POSITIONS.has(p.position)) {
    if (x < PATHWAY_ODDS) return rng.pick(PATHWAY_ORIGINS);
  }
  if (band >= 1 && p.age >= 24 && x >= 0.5 && x < 0.5 + CFL_ODDS) return CFL_ORIGIN;
  return undefined;
}

/**
 * An origin for every player who has none (a new league, an older save), on his own streams: a drafted player's band
 * from his round, anyone else's from where he stands among his position's players.
 */
export function fillOrigins(league: League): void {
  const players = Object.values(league.players);
  for (const position of POSITIONS) {
    const group = players
      .filter((p) => p.position === position)
      .sort((a, b) => playerOvr(b) - playerOvr(a) || a.id - b.id);
    group.forEach((p, i) => {
      if (p.origin !== undefined) return;
      const band = p.draft ? bandForDraftRound(p.draft.round) : bandForShare(i / group.length);
      p.origin = outsideOrigin(league.seed, p, band) ?? collegeOrigin(league.seed, p.id, band);
    });
  }
}
