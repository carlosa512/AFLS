/**
 * Jersey numbers: what the NFL's rules allow at each position, and what players there actually wear. Every player
 * has a favourite, drawn from his own seeded stream (stored nowhere; no other stream moves): he wears it when it's
 * free on his club, a number close to it when it isn't (the way players settle: its digits flipped, its other decade,
 * doubled), and otherwise one like his position's. Numbers are cosmetic: nothing in the sim reads one.
 */
import { Rng } from './rng';
import { teamPlayers } from './roster';
import type { League, Player, Position } from './types';

type Band = readonly [lo: number, hi: number];

/**
 * What a number may be at each position, by the NFL's rules since 2023. An edge rusher plays by a linebacker's or a
 * defensive lineman's (both line up there); kickers and punters by theirs (0–49, 90–99).
 */
export const JERSEY_RULES: Record<Position, readonly Band[]> = {
  QB: [[0, 19]],
  RB: [
    [0, 49],
    [80, 89],
  ],
  WR: [
    [0, 49],
    [80, 89],
  ],
  TE: [
    [0, 49],
    [80, 89],
  ],
  OL: [[50, 79]],
  DT: [
    [50, 79],
    [90, 99],
  ],
  EDGE: [
    [0, 79],
    [90, 99],
  ],
  LB: [
    [0, 59],
    [90, 99],
  ],
  CB: [[0, 49]],
  S: [[0, 49]],
  K: [
    [0, 49],
    [90, 99],
  ],
  P: [
    [0, 49],
    [90, 99],
  ],
};

/**
 * What players at each position wear: bands and their shares (percent), even within a band. From the NFL's rosters
 * for 2024 and 2025 (nflverse: active, reserve and inactive players, each once a season; edge rushers are the ends
 * and outside linebackers by depth chart). A band under one percent is left out: he may still land there when his
 * club's numbers are full.
 */
export const JERSEY_TASTE: Record<Position, readonly (readonly [lo: number, hi: number, share: number])[]> = {
  QB: [
    [1, 9, 46],
    [10, 19, 54],
  ],
  RB: [
    [0, 9, 13],
    [10, 19, 3],
    [20, 29, 39],
    [30, 39, 34],
    [40, 49, 10],
  ],
  WR: [
    [0, 9, 23],
    [10, 19, 46],
    [20, 49, 1],
    [80, 89, 29],
  ],
  TE: [
    [0, 19, 6],
    [30, 49, 7],
    [80, 89, 87],
  ],
  OL: [
    [50, 59, 9],
    [60, 69, 39],
    [70, 79, 52],
  ],
  DT: [
    [50, 59, 10],
    [60, 79, 9],
    [90, 99, 81],
  ],
  EDGE: [
    [0, 9, 7],
    [10, 19, 4],
    [20, 39, 4],
    [40, 49, 14],
    [50, 59, 31],
    [60, 79, 3],
    [90, 99, 37],
  ],
  LB: [
    [0, 9, 9],
    [10, 19, 4],
    [20, 39, 10],
    [40, 49, 35],
    [50, 59, 41],
  ],
  CB: [
    [0, 9, 17],
    [10, 19, 4],
    [20, 29, 45],
    [30, 39, 28],
    [40, 49, 6],
  ],
  S: [
    [0, 9, 15],
    [10, 19, 4],
    [20, 29, 41],
    [30, 39, 30],
    [40, 49, 10],
  ],
  K: [
    [0, 9, 49],
    [10, 19, 25],
    [20, 49, 24],
    [90, 99, 2],
  ],
  P: [
    [0, 9, 44],
    [10, 19, 46],
    [30, 49, 10],
  ],
};

/** At the new league year, a player whose favourite has come free on his club takes it this often. */
const SWITCH = 0.6;

export const jerseyAllowed = (position: Position, n: number): boolean =>
  JERSEY_RULES[position].some(([lo, hi]) => n >= lo && n <= hi);

/** His own stream for a number at a position: the favourite is its first pick, and it goes on if he needs another. */
const streamFor = (seed: string, p: Pick<Player, 'id' | 'position'>) => new Rng(`${seed}:jersey:${p.id}:${p.position}`);

const draw = (rng: Rng, position: Position): number => {
  const [lo, hi] = rng.weighted(JERSEY_TASTE[position], (b) => b[2]);
  return rng.int(lo, hi);
};

/** The number he'd wear at his position if it were up to him alone. */
export function favoriteJersey(seed: string, p: Pick<Player, 'id' | 'position'>): number {
  return draw(streamFor(seed, p), p.position);
}

/**
 * Numbers close to a favourite, in the order players reach for them when theirs is taken: its digits flipped (13 →
 * 31), its other decade (7 → 17, 17 → 7), doubled (4 → 44), then one either side.
 */
export function nearJerseys(n: number): number[] {
  const tens = Math.floor(n / 10);
  const ones = n % 10;
  const out = [
    n >= 10 ? ones * 10 + tens : n * 10,
    tens === 0 ? 10 + ones : tens === 1 ? ones : n - 10,
    n < 10 ? n * 11 : n + 10,
    n + 1,
    n - 1,
  ];
  return out.filter((x, i) => x !== n && x >= 0 && x <= 99 && out.indexOf(x) === i);
}

/**
 * His number among `used` (his club's, without his own): his favourite, else the one he wears (`current`), else one
 * close to the favourite, else another of his position's choosing, else any his position allows, else any free.
 */
export function chooseJersey(
  seed: string,
  p: Pick<Player, 'id' | 'position'>,
  used: ReadonlySet<number>,
  current?: number,
): number {
  const ok = (n: number) => jerseyAllowed(p.position, n) && !used.has(n);
  const rng = streamFor(seed, p);
  const favorite = draw(rng, p.position);
  for (const n of [favorite, ...(current === undefined ? [] : [current]), ...nearJerseys(favorite)])
    if (ok(n)) return n;
  for (let tries = 0; tries < 40; tries++) {
    const n = draw(rng, p.position);
    if (ok(n)) return n;
  }
  for (const [lo, hi] of JERSEY_RULES[p.position]) for (let n = lo; n <= hi; n++) if (ok(n)) return n;
  for (let n = 0; n < 100; n++) if (!used.has(n)) return n;
  return current ?? favorite;
}

/** Longest-serving first: a veteran keeps his number, the newcomer finds another. */
const bySeniority = (a: Player, b: Player) => b.experience - a.experience || a.id - b.id;

/** A whole squad numbered from scratch (a league as built): favourites first, by seniority. */
export function numberSquad(seed: string, squad: readonly Player[]): void {
  const used = new Set<number>();
  for (const p of [...squad].sort(bySeniority)) {
    p.jersey = chooseJersey(seed, p, used);
    used.add(p.jersey);
  }
}

/**
 * His number on joining a club (a signing, a trade, a claim, the draft): a number the user gave him elsewhere stays
 * behind with that club.
 */
export function numberOnArrival(league: League, p: Player): void {
  if (p.teamId === null) return;
  const used = new Set(
    teamPlayers(league, p.teamId)
      .filter((x) => x.id !== p.id)
      .map((x) => x.jersey),
  );
  p.jersey = chooseJersey(league.seed, p, used, p.jersey);
  delete p.numberEdited;
}

/** After a position change: he keeps his number if the rules allow it there, else picks one like his new position's. */
export function numberAfterMove(league: League, p: Player): void {
  if (jerseyAllowed(p.position, p.jersey)) return;
  if (p.teamId === null) p.jersey = favoriteJersey(league.seed, p);
  else numberOnArrival(league, p);
}

/**
 * The new league year, when NFL players change numbers: a player whose favourite has come free on his club (a
 * veteran gone, a teammate moved on) may take it, longest-serving first. A number the user chose is kept.
 */
export function numberSwitches(league: League): void {
  for (const team of league.teams) {
    const squad = [...teamPlayers(league, team.id)].sort(bySeniority);
    const used = new Set(squad.map((p) => p.jersey));
    for (const p of squad) {
      if (p.numberEdited) continue;
      const favorite = favoriteJersey(league.seed, p);
      if (favorite === p.jersey || used.has(favorite)) continue;
      if (!new Rng(`${league.seed}:jersey:${league.season}:${p.id}`).chance(SWITCH)) continue;
      used.delete(p.jersey);
      p.jersey = favorite;
      used.add(favorite);
    }
  }
}
