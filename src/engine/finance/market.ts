/**
 * The contract market: what a player is worth as a share of the cap, the rookie wage scale,
 * minimum salaries and franchise-tag values. Anchored to 2021–2026 NFL deals (see
 * docs/research): elite QBs ≈ 20% of the cap, elite non-QBs 13–17%.
 */
import { playerOvr, STARTERS } from '../positions';
import { clamp } from '../rng';
import type { League, Player, Position } from '../types';
import { POSITIONS } from '../types';
import { capHit } from './contract';

/** 2026 salary cap, in $K. */
export const BASE_CAP = 301_200;

/** Top-of-market APY as a share of the cap, by position. */
export const TOP_APY_PCT: Record<Position, number> = {
  QB: 0.21,
  EDGE: 0.155,
  WR: 0.14,
  DT: 0.13,
  OL: 0.095,
  CB: 0.11,
  LB: 0.075,
  S: 0.075,
  TE: 0.065,
  RB: 0.055,
  K: 0.02,
  P: 0.013,
};

/** 2026 minimum salaries by credited seasons (0, 1, 2, 3, 4–6, 7+), in $K. */
const MIN_BY_EXPERIENCE = [885, 1030, 1105, 1170, 1255, 1255, 1255, 1415];

/** League minimum for a player with `experience` seasons, scaled with the cap. */
export function minSalary(experience: number, cap: number): number {
  const base = MIN_BY_EXPERIENCE[Math.min(experience, MIN_BY_EXPERIENCE.length - 1)];
  return Math.round((base * cap) / BASE_CAP);
}

/**
 * The market is relative: pay follows where a player ranks among everyone at his position,
 * measured in "starting jobs" (rank / number of starters league-wide). It is flat at the top
 * (the 10th-best QB earns close to the best) and falls off a cliff below starter level.
 */
export function payTier(position: Position, rank: number): number {
  const q = rank / (32 * STARTERS[position]);
  const [mid, width] = position === 'QB' ? [0.72, 0.12] : [0.27, 0.26];
  const logistic = (x: number) => 1 / (1 + Math.exp((x - mid) / width));
  return 0.88 * (logistic(q) / logistic(0)) + 0.12 * Math.exp(-1.6 * q);
}

/** Sorted overalls (best first) of every active player at each position: the comps. */
export interface Market {
  cap: number;
  ovrs: Record<Position, number[]>;
}

const marketCache = new WeakMap<League, { key: string; market: Market }>();

export function leagueMarket(league: League): Market {
  const key = `${league.season}:${league.phase}:${league.nextPlayerId}:${league.transactions.length}`;
  const hit = marketCache.get(league);
  if (hit && hit.key === key) return hit.market;
  const ovrs = Object.fromEntries(POSITIONS.map((p) => [p, [] as number[]])) as Record<Position, number[]>;
  const prospects = new Set(league.draftClass);
  for (const p of Object.values(league.players)) if (!p.retired && !prospects.has(p.id)) ovrs[p.position].push(playerOvr(p));
  for (const list of Object.values(ovrs)) list.sort((a, b) => b - a);
  const market = { cap: league.caps[league.season], ovrs };
  marketCache.set(league, { key, market });
  return market;
}

/** How many players at the position are better (0 = the best). */
export function positionRank(market: Market, player: Player): number {
  const list = market.ovrs[player.position];
  const ovr = playerOvr(player);
  let lo = 0;
  let hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid] > ovr + 1e-9) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Ageing veterans get shorter, cheaper deals; quarterbacks and kickers age later. */
export function ageFactor(position: Position, age: number): number {
  const shift = position === 'QB' || position === 'K' || position === 'P' ? 4 : position === 'RB' ? -2 : 0;
  const a = age - shift;
  if (a <= 29) return 1;
  return Math.max(0.45, 1 - (a - 29) * 0.11);
}

/** Expected APY on the open market, in $K. */
export function marketApy(market: Market, player: Player): number {
  const tier = payTier(player.position, positionRank(market, player));
  const value = TOP_APY_PCT[player.position] * market.cap * tier * ageFactor(player.position, player.age);
  return Math.max(minSalary(player.experience, market.cap), Math.round(value));
}

/** Years a player wants: young players lock in long deals, veterans take what they can get. */
export function preferredYears(player: Player): number {
  const a = player.age - (player.position === 'QB' ? 3 : 0);
  if (a <= 25) return 5;
  if (a <= 27) return 4;
  if (a <= 29) return 3;
  if (a <= 31) return 2;
  return 1;
}

/** Share of the total value a player's agent wants guaranteed. Stars push hardest. */
export function guaranteeAsk(market: Market, player: Player): number {
  const tier = payTier(player.position, positionRank(market, player));
  return clamp(0.12 + 0.55 * tier * ageFactor(player.position, player.age), 0.1, 0.7);
}

// ───────── rookie wage scale ─────────

/** Slotted APY for an overall pick (2026-ish: No. 1 ≈ $11M, end of round 1 ≈ $3.6M, Day 3 near the minimum). */
export function rookieApy(overall: number, cap: number): number {
  const v = 10_200 * Math.exp(-(overall - 1) / 21) + 1_050;
  return Math.round((v * cap) / BASE_CAP);
}

/** Share of a rookie deal paid as signing bonus: two-thirds at the top, a sliver late. */
export function rookieBonusShare(overall: number): number {
  return clamp(0.66 - (overall - 1) * 0.0035, 0.04, 0.66);
}

// ───────── tags & options ─────────

/** Current cap hits at a position, highest first. */
export function positionCapHits(league: League, position: Position): number[] {
  const season = league.season;
  const hits: number[] = [];
  for (const p of Object.values(league.players)) {
    if (p.position === position && p.contract && p.teamId !== null) hits.push(capHit(p.contract, season));
  }
  return hits.sort((a, b) => b - a);
}

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

/**
 * Non-exclusive franchise tag: the average of the five largest cap hits at the position
 * (a one-year stand-in for the five-year formula), never below 120% of the player's prior
 * cap hit. A second tag pays 120% of the prior; a third the greater of 144% or the QB tag.
 */
export function franchiseTagValue(league: League, player: Player, priorCapHit: number): number {
  const top5 = avg(positionCapHits(league, player.position).slice(0, 5));
  const tags = player.tagCount ?? 0;
  if (tags === 1) return Math.round(Math.max(top5, priorCapHit * 1.2));
  if (tags >= 2) return Math.round(Math.max(priorCapHit * 1.44, avg(positionCapHits(league, 'QB').slice(0, 5))));
  return Math.round(Math.max(top5, priorCapHit * 1.2));
}

/** Fifth-year option salary tier for a first-round pick after three seasons (no Pro Bowls yet: rank stands in). */
export function fifthYearOptionValue(league: League, player: Player): number {
  const hits = positionCapHits(league, player.position);
  const ovr = playerOvr(player);
  const peers = Object.values(league.players)
    .filter((p) => p.position === player.position && p.teamId !== null && !p.retired)
    .map(playerOvr)
    .sort((a, b) => b - a);
  const rank = peers.findIndex((v) => v <= ovr);
  if (rank < 5) return Math.round(avg(hits.slice(0, 5)));
  if (rank < 12) return Math.round(avg(hits.slice(0, 10)));
  if (rank < 32) return Math.round(avg(hits.slice(2, 20)));
  return Math.round(avg(hits.slice(2, 25)));
}
