/**
 * Ceilings that settle in the league (docs/superpowers/specs/2026-10-27-draft-busts-design.md). A draft-day ceiling
 * is a best guess: over a player's first three league years it moves, a lot in year one and little by year three,
 * when his team's season ends. Work ethic leans it most; how he played against players rated like him, his snaps
 * and his coaches lean it a little. A bust is a ceiling that settles at or under where he already is, so he stops
 * growing (no rating is taken away); a late bloomer's jumps.
 *
 * Each settle runs on its own stream (`${seed}:ceiling:${season}:${id}`), so development, retirement and every game
 * draw exactly what they drew before.
 */
import { coachingForPlayer } from './coaching';
import { CEILING_SWING, playedShare, settleYear } from './development';
import { overall } from './positions';
import { clamp, Rng } from './rng';
import { productionRule, seasonRole } from './scouting';
import { allSeeds, playoffGames, winnerOf } from './season/playoffs';
import { TRAIT_MEAN } from './traits';
import type { League, Player, Position, Ratings } from './types';
import { ATTRIBUTES } from './types';

/** Each position's players with enough of a season: overall at its start and what they produced. */
export type PeerTable = Map<Position, { ovr: number; measure: number }[]>;

/**
 * Work ethic's lean per trait point: about ±0.2 at the trait's ends. Small, because work ethic already sets how
 * fast he grows (`growthMult`): the careers audit's work-ethic gap at 26 (0.3–1) holds only with a light lean.
 */
const WORK_LEAN = 0.02;
/** His coaches' development rate leans it a little, for the same reason (the audit's coaching gap, 0.12–0.4). */
export const COACH_LEAN = 0.1;
/** How well he played, at most, either way. */
const PLAY_LEAN = 0.4;
/** A starter's snaps lean up a little; a year that barely saw the field leans down. */
export const SNAP_LEAN = { starter: 0.05, idle: -0.05 };
/**
 * Hype: a projection far past where he is now is the scouts' best case, and the league tends to bring it down. Past
 * `HYPE_GAP` points of growth still to come, each point leans the ceiling down by `HYPE_LEAN`. It lands on the
 * class's biggest projections, so it is what lets a first-rounder fall short of his slot (docs/research/draft-outcomes.md).
 */
const HYPE_GAP = 3;
const HYPE_LEAN = 0.5;
/** The hype part of the lean for a ceiling `potential` over an overall `ovr`. */
export const hypeLean = (potential: number, ovr: number) => -HYPE_LEAN * Math.max(0, potential - ovr - HYPE_GAP);
/** Peers it takes to judge a line, and how far (overall points) the search may widen to find them. */
const PEERS = 8;
const PEER_REACH = 3;

const round1 = (x: number) => Math.round(x * 10) / 10;

/** His overall when `season` began (the ratings noted at the league year), or today's when none was noted. */
function startOvr(p: Player, season: number): number {
  const then = p.ratingHistory?.[season];
  if (!then) return overall(p.ratings, p.position);
  return overall(Object.fromEntries(ATTRIBUTES.map((a, i) => [a, then[i]])) as Ratings, p.position);
}

/** The shift one settle draws: around `lean`, as wide as year `year`'s swing, to a tenth. */
export function ceilingShift(rng: Rng, year: number, lean: number): number {
  return round1(rng.normal(lean, CEILING_SWING[year]));
}

/** Everyone's `season` with enough of a line to compare, by position. Built once per settle pass. */
export function peerTable(league: League, season: number): PeerTable {
  const table: PeerTable = new Map();
  for (const p of Object.values(league.players)) {
    const s = p.stats[season];
    const rule = productionRule(p.position);
    if (!s || !rule || !rule.enough(s)) continue;
    const row = table.get(p.position) ?? [];
    row.push({ ovr: startOvr(p, season), measure: rule.measure(s) });
    table.set(p.position, row);
  }
  return table;
}

/**
 * How well he played against players rated like him (−0.4 to 0.4): against the league, a talented rookie's numbers
 * would lift a ceiling that was high already. Nothing without a rule at his position or enough of a season to judge.
 */
export function playLean(p: Player, season: number, peers: PeerTable): number {
  const s = p.stats[season];
  const rule = productionRule(p.position);
  if (!s || !rule || !rule.enough(s)) return 0;
  const ovr = startOvr(p, season);
  const all = peers.get(p.position) ?? [];
  for (let reach = 1; reach <= PEER_REACH; reach += 0.5) {
    const near = all.filter((x) => Math.abs(x.ovr - ovr) <= reach);
    if (near.length < PEERS) continue;
    const avg = near.reduce((sum, x) => sum + x.measure, 0) / near.length;
    const gap = ((rule.measure(s) - avg) / rule.step) * (rule.lowIsGood ? -1 : 1);
    return (clamp(gap, -2, 2) / 2) * PLAY_LEAN;
  }
  return 0;
}

/** Work ethic's part of the lean: the biggest, and the one a scout who knows his makeup can see coming. */
export const workLean = (workEthic: number) => WORK_LEAN * (workEthic - TRAIT_MEAN);

/** Which way his `season` leans his ceiling, in overall points: work ethic, play, snaps, coaching. */
export function ceilingLean(league: League, p: Player, season: number, peers: PeerTable): number {
  const work = workLean(p.traits.workEthic);
  // Snaps where the position keeps a measure (no role: he didn't play); games suited up for where it doesn't.
  let snaps: number;
  if (productionRule(p.position)) {
    const role = seasonRole(league, p, season)?.role;
    snaps = role === 'starter' ? SNAP_LEAN.starter : role === 'rotation' ? 0 : SNAP_LEAN.idle;
  } else {
    const share = playedShare(p, season);
    snaps = share >= 0.6 ? SNAP_LEAN.starter : share < 0.2 ? SNAP_LEAN.idle : 0;
  }
  const coached = COACH_LEAN * (coachingForPlayer(league, p).rate - 1);
  return work + playLean(p, season, peers) + snaps + coached + hypeLean(p.potential, overall(p.ratings, p.position));
}

/**
 * Settle a young player's ceiling for `season`, once: true when it settled. Capped at 20; it may fall under his
 * overall, and then he simply stops growing. The change is kept (`ceilingShifts`) for the mail, the scout report
 * and the careers audit.
 */
export function settleCeiling(league: League, p: Player, season: number, peers: PeerTable): boolean {
  const year = settleYear(p);
  if (year === null || p.retired || p.ceilingShifts?.[season] !== undefined) return false;
  const shift = ceilingShift(
    new Rng(`${league.seed}:ceiling:${season}:${p.id}`),
    year,
    ceilingLean(league, p, season, peers),
  );
  const before = p.potential;
  p.potential = Math.max(1, Math.min(20, round1(before + shift)));
  (p.ceilingShifts ??= {})[season] = round1(p.potential - before);
  return true;
}

/** Teams still playing this postseason: the seeds, less every loser of a playoff game played. */
function stillPlaying(league: League): Set<number> {
  const alive = new Set(allSeeds(league).flat());
  for (const g of playoffGames(league)) {
    const won = g.result ? winnerOf(g) : null;
    if (won !== null) alive.delete(won === g.homeId ? g.awayId : g.homeId);
  }
  return alive;
}

/**
 * Settle everyone whose season is over: nobody during the regular season; in the playoffs, every player whose team
 * is out (or who has no team); once the final is played (and at the new league year, for anyone a pass missed),
 * everyone. Each player once a season, so it runs after every week that could end a team's year.
 */
export function settleFinished(league: League): void {
  if (league.phase !== 'playoffs' && league.phase !== 'complete') return;
  const season = league.season;
  const alive = league.phase === 'playoffs' ? stillPlaying(league) : new Set<number>();
  let peers: PeerTable | undefined;
  for (const p of Object.values(league.players)) {
    if (p.retired || settleYear(p) === null || p.ceilingShifts?.[season] !== undefined) continue;
    if (p.teamId !== null && alive.has(p.teamId)) continue;
    settleCeiling(league, p, season, (peers ??= peerTable(league, season)));
  }
}
