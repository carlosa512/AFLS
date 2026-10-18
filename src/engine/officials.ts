/**
 * Officiating crews. Seventeen of them, each known by its head referee, with three hidden tendencies
 * that nudge how often flags fly: Flag Volume (every penalty), Holding (offensive holding) and
 * Coverage (pass interference and defensive holding). A crew changes a game's texture, never who it
 * favors: both teams get the same multipliers. The crews are kept centred, so the league as a whole
 * calls what it always did and only individual crews drift.
 *
 * Hidden inputs, readable outcomes: every tendency shows up in a stat a player can see (`crewTable`),
 * never as a number. Spec and what's built: docs/OFFICIALS.md.
 */
import { FIRST_NAMES, LAST_NAMES } from './data/names';
import { clamp, Rng } from './rng';
import type { Crew, Foul, Game, League } from './types';

export const CREW_COUNT = 17;
type Tendency = 'flagVolume' | 'holding' | 'coverage';
const TENDENCIES: readonly Tendency[] = ['flagVolume', 'holding', 'coverage'];
/** The tendency that multiplies a penalty roll by exactly 1: the crews average it. */
const CENTRE = 10.5;
/** Most a tendency moves in an offseason. */
export const MAX_DRIFT = 2;
/**
 * New crews spread evenly between these, one per slice of the range, so a league always has strict
 * and lenient crews (FM's unresearched leagues could come out all lenient). Narrower than 1–20: sixteen
 * games a season add their own luck, and together they give the NFL's spread between crews.
 */
const SPREAD: [number, number] = [4, 17];
/**
 * The yearly pull back toward the centre, per point away from it: without it the yearly drift would
 * be a random walk and the crews would spread further apart every season.
 */
const REVERT = 1 / 12;
/** Games a crew must work before screens rank it: fewer is mostly luck. */
export const RANK_MIN_GAMES = 3;

/** Every foul the engine calls, and the tendency besides Flag Volume that moves it. */
export const FOULS: Record<Foul, { label: string; tendency: 'holding' | 'coverage' | null }> = {
  falseStart: { label: 'False start', tendency: null },
  offside: { label: 'Offside', tendency: null },
  holding: { label: 'Offensive holding', tendency: 'holding' },
  passInterference: { label: 'Pass interference', tendency: 'coverage' },
  defHolding: { label: 'Defensive holding', tendency: 'coverage' },
};
export const FOUL_KINDS = Object.keys(FOULS) as Foul[];

/** A tendency as a multiplier on penalty rolls: 0.8 at 1, 1.2 at 20, 1 at the centre. */
export const crewMult = (rating: number) => 0.8 + (0.4 * (rating - 1)) / 19;

/** The multipliers a crew puts on the engine's penalty rolls. No crew: the league's average one. */
export interface CrewCalls {
  /** Every penalty roll (Flag Volume). */
  all: number;
  /** Offensive holding, on top of `all`. */
  holding: number;
  /** Pass interference and defensive holding, on top of `all`. */
  coverage: number;
}

export function crewCalls(crew: Crew | undefined): CrewCalls {
  if (!crew) return { all: 1, holding: 1, coverage: 1 };
  return { all: crewMult(crew.flagVolume), holding: crewMult(crew.holding), coverage: crewMult(crew.coverage) };
}

/** "R. Halvorsen", or the full name. */
export const refName = (crew: Crew, full = false) => (full ? `${crew.firstName} ${crew.lastName}` : `${crew.firstName[0]}. ${crew.lastName}`);

// ───────── the crews ─────────

/** The league's crews, from their own stream: the players and schedule are unchanged by them. */
export function generateCrews(league: League): void {
  const rng = new Rng(`${league.seed}:crews`);
  const used = new Set<string>();
  const crews: Crew[] = [];
  for (let id = 0; id < CREW_COUNT; id++) {
    let lastName = rng.pick(LAST_NAMES);
    while (used.has(lastName)) lastName = rng.pick(LAST_NAMES);
    used.add(lastName);
    crews.push({ id, firstName: rng.pick(FIRST_NAMES), lastName, flagVolume: 0, holding: 0, coverage: 0 });
  }
  for (const t of TENDENCIES) {
    const [lo, hi] = SPREAD;
    const values = rng.shuffle(crews.map((_, i) => Math.round(lo + ((hi - lo) * (i + rng.next())) / CREW_COUNT)));
    crews.forEach((c, i) => (c[t] = values[i]));
    centre(crews, t, rng);
  }
  league.crews = crews;
}

/**
 * Nudge a tendency a point at a time until the crews average the centre (to the nearest point of
 * their total), so the league's flags stay where they were. After an offseason's drift (`before`),
 * only crews that stay within MAX_DRIFT of last year are nudged.
 */
function centre(crews: Crew[], t: Tendency, rng: Rng, before?: number[]) {
  const target = Math.round(CENTRE * crews.length);
  let total = crews.reduce((sum, c) => sum + c[t], 0);
  while (total !== target) {
    const step = Math.sign(target - total);
    const fits = crews.filter((c) => c[t] + step >= 1 && c[t] + step <= 20);
    const within = before ? fits.filter((c) => Math.abs(c[t] + step - before[crews.indexOf(c)]) <= MAX_DRIFT) : fits;
    rng.pick(within.length ? within : fits)[t] += step;
    total += step;
  }
}

/**
 * The new league year: every tendency moves up to MAX_DRIFT points, leaning a little back toward the
 * centre, then the crews are centred again. Fixed for the season after that.
 */
export function crewsNewYear(league: League): void {
  const rng = new Rng(`${league.seed}:crews:${league.season}`);
  for (const t of TENDENCIES) {
    const before = league.crews.map((c) => c[t]);
    for (const c of league.crews) {
      const lean = (CENTRE - c[t]) * REVERT;
      const step = rng.int(-MAX_DRIFT, MAX_DRIFT) + (rng.chance(Math.abs(lean)) ? Math.sign(lean) : 0);
      c[t] = clamp(c[t] + clamp(step, -MAX_DRIFT, MAX_DRIFT), 1, 20);
    }
    centre(league.crews, t, rng, before);
  }
}

// ───────── who works which game ─────────

/**
 * Which crew works each game of a season (game id → crew id). Week by week the crews who have worked
 * the fewest games take the field, ties broken by a seeded draw, so every crew works about sixteen
 * games and none works two in a week. A pure function of the seed and the schedule, like weather:
 * nothing is stored until a game is played (`GameResult.crewId`).
 */
export function crewAssignments(league: League, season: number): Map<number, number> {
  const out = new Map<number, number>();
  if (!league.crews?.length) return out;
  const worked = new Map(league.crews.map((c) => [c.id, 0]));
  const weeks = new Map<number, Game[]>();
  for (const g of league.games) if (g.season === season) (weeks.get(g.week) ?? weeks.set(g.week, []).get(g.week)!).push(g);
  for (const week of [...weeks.keys()].sort((a, b) => a - b)) {
    const rng = new Rng(`${league.seed}:crews:${season}:${week}`);
    const order = rng.shuffle(league.crews.map((c) => c.id)).sort((a, b) => worked.get(a)! - worked.get(b)!);
    weeks.get(week)!.forEach((g, i) => {
      const id = order[i % order.length];
      out.set(g.id, id);
      worked.set(id, worked.get(id)! + 1);
    });
  }
  return out;
}

/** The crew that worked a game, or the one down to work it. Games played before crews have none. */
export function gameCrew(league: League, game: Game): Crew | undefined {
  const id = game.result ? game.result.crewId : crewAssignments(league, game.season).get(game.id);
  return id === undefined ? undefined : league.crews?.[id];
}

// ───────── what the crews call ─────────

/** What a crew called over the games it worked, both teams together. */
export interface CrewLine {
  games: number;
  fouls: Record<Foul, number>;
}

/** The three numbers a crew is known by, per game: every flag, offensive holding, coverage fouls. */
export type CrewStat = 'flags' | 'holding' | 'coverage';
export const CREW_STATS: readonly CrewStat[] = ['flags', 'holding', 'coverage'];

/** Seasons with games a crew worked, newest first (box scores older than last season are gone). */
export function crewSeasons(league: League): number[] {
  return [...new Set(league.games.filter((g) => g.result?.crewId !== undefined).map((g) => g.season))].sort((a, b) => b - a);
}

/** Every crew's calls in a season's played games, by crew id. Read from the box scores: there is no other ledger. */
export function crewSeason(league: League, season: number): Map<number, CrewLine> {
  const out = new Map<number, CrewLine>();
  for (const g of league.games) {
    const r = g.result;
    if (g.season !== season || r?.crewId === undefined) continue;
    let line = out.get(r.crewId);
    if (!line) out.set(r.crewId, (line = { games: 0, fouls: Object.fromEntries(FOUL_KINDS.map((f) => [f, 0])) as Record<Foul, number> }));
    line.games++;
    for (const side of [r.home, r.away]) for (const f of FOUL_KINDS) line.fouls[f] += side.flags?.[f] ?? 0;
  }
  return out;
}

export function perGame(line: CrewLine): Record<CrewStat, number> {
  const n = Math.max(1, line.games);
  const sum = (fouls: Foul[]) => fouls.reduce((s, f) => s + line.fouls[f], 0) / n;
  return {
    flags: sum(FOUL_KINDS),
    holding: sum(FOUL_KINDS.filter((f) => FOULS[f].tendency === 'holding')),
    coverage: sum(FOUL_KINDS.filter((f) => FOULS[f].tendency === 'coverage')),
  };
}

export interface CrewRow {
  crew: Crew;
  games: number;
  perGame: Record<CrewStat, number>;
  /** League rank on each stat, 1 = most per game; null until the crew has worked RANK_MIN_GAMES games. */
  ranks: Record<CrewStat, number> | null;
}

/** Every crew's season, ranked: what the crews page shows. `ranked` is how many crews have ranks. */
export function crewTable(league: League, season: number): { rows: CrewRow[]; ranked: number } {
  const lines = crewSeason(league, season);
  const rows: CrewRow[] = (league.crews ?? []).map((crew) => {
    const line = lines.get(crew.id);
    return { crew, games: line?.games ?? 0, perGame: line ? perGame(line) : { flags: 0, holding: 0, coverage: 0 }, ranks: null };
  });
  const ranked = rows.filter((r) => r.games >= RANK_MIN_GAMES);
  for (const row of ranked) {
    row.ranks = Object.fromEntries(CREW_STATS.map((s) => [s, 1 + ranked.filter((o) => o.perGame[s] > row.perGame[s]).length])) as Record<CrewStat, number>;
  }
  return { rows, ranked: ranked.length };
}

/**
 * Where a crew ranks in flags per game: this season once it has worked enough games to rank, else
 * last season (its tendencies move at most two points a year, so last year's habits still read).
 */
export function crewStanding(league: League, crew: Crew, season: number): { rank: number; of: number; season: number } | null {
  for (const s of [season, season - 1]) {
    const { rows, ranked } = crewTable(league, s);
    const ranks = rows.find((r) => r.crew.id === crew.id)?.ranks;
    if (ranks) return { rank: ranks.flags, of: ranked, season: s };
  }
  return null;
}
