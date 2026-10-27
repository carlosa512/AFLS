/**
 * Players who come from outside the college draft: the International Pathway class (signing after its pro day,
 * with the undrafted) and veterans of the Canadian league (the January-February window, at the new league year).
 * Each class runs on its own stream, so no other roll moves.
 */
import { CFL_ORIGIN, PATHWAY_ORIGINS } from '../data/origins';
import { recordRatings } from '../development';
import { generatePlayer } from '../generate';
import { ensureService } from '../personnel/service';
import { playerOvr } from '../positions';
import { clamp, Rng } from '../rng';
import type { League, Player, Position } from '../types';

/** The real program's yearly class (13–14 athletes). */
export const PATHWAY_CLASS = 13;
/** CFL players who sign each window: no official count, a handful a year (AFLS estimate). */
export const CFL_ARRIVALS = 6;

/** The program's converts: mostly linemen, tight ends and backs, a kicker or punter some years. */
const PATHWAY_MIX: [Position, number][] = [
  ['DT', 3],
  ['EDGE', 2],
  ['OL', 3],
  ['TE', 2],
  ['RB', 2],
  ['LB', 1],
  ['P', 0.6],
  ['K', 0.4],
];
/** CFL arrivals follow its roster: receivers, backs and defenders, rarely a passer or a kicker. */
const CFL_MIX: [Position, number][] = [
  ['WR', 4],
  ['CB', 3],
  ['S', 2],
  ['LB', 2],
  ['EDGE', 2],
  ['DT', 1.5],
  ['OL', 1.5],
  ['RB', 1.5],
  ['TE', 0.5],
  ['QB', 0.5],
  ['K', 0.3],
  ['P', 0.3],
];

export { isPathway } from '../origin';

function arrival(league: League, rng: Rng, position: Position, quality: number, age: number): Player {
  const p = generatePlayer(rng, {
    id: league.nextPlayerId++,
    position,
    quality,
    age,
    teamId: null,
    jerseysUsed: new Set(),
  });
  p.experience = 0;
  ensureService(p, league.season);
  return p;
}

/** This year's Pathway class, into the free-agent pool: raw, with a wide ceiling. */
export function pathwayClass(league: League): Player[] {
  const rng = new Rng(`${league.seed}:pathway:${league.season}`);
  const out: Player[] = [];
  for (let i = 0; i < PATHWAY_CLASS; i++) {
    const p = arrival(league, rng, rng.weighted(PATHWAY_MIX, ([, w]) => w)[0], rng.float(5, 8), rng.int(22, 26));
    p.potential = Math.round(clamp(playerOvr(p) + rng.float(1, 5), playerOvr(p), 20) * 10) / 10;
    p.origin = rng.pick(PATHWAY_ORIGINS);
    recordRatings(p, league.season);
    league.players[p.id] = p;
    out.push(p);
  }
  return out;
}

/** This year's CFL veterans, into the free-agent pool: mostly depth, about one in six a starter (AFLS estimate). */
export function cflArrivals(league: League): Player[] {
  const rng = new Rng(`${league.seed}:cfl:${league.season}`);
  const out: Player[] = [];
  for (let i = 0; i < CFL_ARRIVALS; i++) {
    const quality = rng.chance(1 / 6) ? rng.float(10, 12.5) : rng.float(7, 10);
    const p = arrival(league, rng, rng.weighted(CFL_MIX, ([, w]) => w)[0], quality, rng.int(24, 29));
    p.potential = Math.round(Math.min(20, playerOvr(p) + rng.float(0, 0.8)) * 10) / 10;
    p.origin = CFL_ORIGIN;
    p.cflSeasons = rng.int(1, 4);
    recordRatings(p, league.season);
    league.players[p.id] = p;
    out.push(p);
  }
  return out;
}
