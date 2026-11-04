/**
 * Chemistry on Sunday (L3, docs/superpowers/specs/2026-11-03-chemistry-on-sunday-design.md): each room's mood and its time
 * together, as one edge in rating points that the lineup adds to every man it sends out from that room. Centred on the
 * league each week, so however happy or settled the league runs, its totals hold. Nothing stored, nothing drawn.
 */
import { moodPull } from './moodScale';
import { moraleClock, moraleContext, moraleMean } from './morale';
import { clamp } from './rng';
import { isAvailable, starters as startersOf } from './roster';
import { unitRead, type Unit } from './standing';
import { isDriven } from './meetings/react';
import type { League, Player, Position, Team } from './types';

export type ChemRoom = Exclude<Unit, 'ST'>;
export type ChemWord = 'Clicking' | 'Gelling' | 'Still learning each other' | 'Out of sync';

export const CHEM_ROOMS: readonly ChemRoom[] = ['QB', 'RB', 'WR', 'OL', 'DL', 'LB', 'DB'];
/** Every room's edge held at zero (`SimOptions.chemistry`, `buildLineup`): for tests that read something else. */
export const NO_CHEM: Readonly<Record<ChemRoom, number>> = { QB: 0, RB: 0, WR: 0, OL: 0, DL: 0, LB: 0, DB: 0 };

export const CHEM = {
  /** A room at its best or worst, in rating points: subtle (the owner's call), against a man's own mood's 0.5. */
  cap: 0.3,
  /** The mood part's reach, and what a divided room loses inside it. */
  mood: 0.2,
  split: 0.05,
  /** The time-together part's reach; a pair counts at most this many seasons (gains flatten). */
  together: 0.1,
  maxSeasons: 3,
  /** A room's mood runs far narrower than a man's: this far from the league's mood is the whole mood part. */
  roomSpan: 1.3,
  clicking: 0.15,
  outOfSync: -0.15,
  /** A time part this low, with the edge in between, reads as a room still learning each other. */
  learning: -0.05,
};

/** Where time together counts: protection calls, a passer's timing, a secondary's communication. */
const TOGETHER: ReadonlySet<ChemRoom> = new Set(['OL', 'DB', 'QB', 'WR']);

/** The weeks of a season played so far, as a share: this season counts in part. */
function seasonShare(league: League): number {
  if (league.phase === 'playoffs') return 1;
  if (league.phase !== 'regular') return 0;
  return clamp(league.week / 18, 0, 1);
}

/** Seasons two men have played together for `teamId`: past ones whole, this one in part; three at most. */
export function seasonsTogether(league: League, a: Player, b: Player, teamId: number): number {
  const sa = a.statTeams;
  const sb = b.statTeams;
  if (!sa || !sb) return 0;
  let n = 0;
  for (const key of Object.keys(sa)) {
    const s = Number(key);
    if (s < league.season && sa[s]?.includes(teamId) && sb[s]?.includes(teamId)) n++;
  }
  if (sa[league.season]?.includes(teamId) && sb[league.season]?.includes(teamId)) n += seasonShare(league);
  return Math.min(CHEM.maxSeasons, n);
}

/** The pairs whose time together a room reads, from the depth chart as it is now. */
function pairsOf(league: League, team: Team, unit: ChemRoom): [Player, Player][] {
  // Only men who can play: `starters` falls back to hurt ones for strength reads when nobody healthy is left.
  const starters = (l: League, t: Team, pos: Position) => startersOf(l, t, pos).filter(isAvailable);
  const all = (men: Player[]) => men.flatMap((a, i) => men.slice(i + 1).map((b): [Player, Player] => [a, b]));
  if (unit === 'OL') return all(starters(league, team, 'OL'));
  if (unit === 'DB') return all([...starters(league, team, 'CB'), ...starters(league, team, 'S')]);
  if (unit === 'QB' || unit === 'WR') {
    const qb = starters(league, team, 'QB')[0];
    if (!qb) return [];
    const targets = [...starters(league, team, 'WR').slice(0, 2), ...starters(league, team, 'TE').slice(0, 1)];
    return targets.map((t): [Player, Player] => [qb, t]);
  }
  return [];
}

/** A room's mean seasons together, and its starters with none alongside any other; null outside the three rooms. */
function timeOf(league: League, team: Team, unit: ChemRoom): { years: number; newStarters: number } | null {
  if (!TOGETHER.has(unit)) return null;
  const pairs = pairsOf(league, team, unit);
  if (!pairs.length) return null;
  const shared = new Map<number, number>();
  let sum = 0;
  for (const [a, b] of pairs) {
    const n = seasonsTogether(league, a, b, team.id);
    sum += n;
    for (const p of [a, b]) shared.set(p.id, Math.max(shared.get(p.id) ?? 0, n));
  }
  return { years: sum / pairs.length, newStarters: [...shared.values()].filter((n) => n === 0).length };
}

/** The mood part: the room's level against the league's, less a divided room's cost, inside its reach. */
export function moodPart(level: number, mean: number, split: boolean): number {
  // Read through the one scale every mood effect reads (`moodScale.ts`): a test that holds the effects at zero holds this
  // too. `moodPull` spans six levels either side; a room's span is narrower, so it's widened back out here.
  const pull = moodPull(level, mean) * (6 / CHEM.roomSpan);
  const divided = split ? CHEM.split * Math.abs(moodPull(6, 0)) : 0;
  return clamp(CHEM.mood * clamp(pull, -1, 1) - divided, -CHEM.mood, CHEM.mood);
}

/**
 * Complacency: a winning club's happy rooms get comfortable (letdowns, trap games, a room that stops grinding). It eats
 * into the good side of the mood part only, from a .500 record to `full`, where it takes `max` of it; a room with a
 * driven leader or voice stays hungry. It's also the brake on a loop: winning lifts moods and moods lift play, and
 * without it good teams pulled away from the league (win spread past the NFL's).
 */
export const COMPLACENCY = { from: 0.5, full: 0.8, max: 1 };

export function complacent(mood: number, winShare: number, hungry: boolean): number {
  if (mood <= 0 || hungry) return mood;
  const how = clamp((winShare - COMPLACENCY.from) / (COMPLACENCY.full - COMPLACENCY.from), 0, 1);
  return mood * (1 - COMPLACENCY.max * how);
}

export function wordOf(edge: number, together: number | null): ChemWord {
  if (edge >= CHEM.clicking) return 'Clicking';
  if (edge <= CHEM.outOfSync) return 'Out of sync';
  return together !== null && together <= CHEM.learning ? 'Still learning each other' : 'Gelling';
}

export interface Chemistry {
  teamId: number;
  unit: ChemRoom;
  /** The mood part, ±`CHEM.mood`. */
  mood: number;
  /** The time part, ±`CHEM.together`; null outside the line, the secondary and the passing game, or short of men. */
  together: number | null;
  /** The room's mean seasons together (for words). */
  years: number | null;
  /** Starters with no season together with any other starter here (for words). */
  newStarters: number;
  /** Winning took some of the good mood off it (complacency): the room is comfortable. */
  comfortable: boolean;
  /** Centred on the league, ±`CHEM.cap`. */
  edge: number;
  word: ChemWord;
}

/**
 * The week's moods and the league's yardsticks: worked out once, since a mood reads a whole league's context. Time
 * together is read fresh from the depth chart at each call, so a starter changed after the cache filled counts.
 */
interface Week {
  key: string;
  mood: Map<string, number>;
  /** Rooms whose mood part complacency trimmed (`teamId:unit`). */
  comfortable: Set<string>;
  /** Each room's league-typical seasons together, and its mean raw edge (what centring takes off). */
  typical: Map<ChemRoom, number>;
  centre: Map<ChemRoom, number>;
}
const weeks = new WeakMap<League, Week>();

/**
 * The week's read, keyed on the week. It's dropped (`freshChemistry`) at game day (`playWeek`, a live game's kickoff)
 * and whenever you act in the app (`store.mutate`), so a trade, a signing or a talk you answered counts; the sim's own
 * moves between games of one week (an injury signing) don't rebuild it, and those games share one read.
 */
function weekKey(league: League): string {
  return [league.season, league.phase, league.week, league.moraleAt ?? moraleClock(league)].join(':');
}

/** Forget the week's read: game day's first lineup reads the league as it stands. */
export function freshChemistry(league: League): void {
  weeks.delete(league);
}

/** A club's win share from the weeks before this one (three games at least, else .500): what complacency reads. */
function shareBefore(league: League, teamId: number): number {
  let w = 0;
  let n = 0;
  for (const g of league.games) {
    if (g.season !== league.season || g.playoffRound || !g.result) continue;
    if (league.phase === 'regular' && g.week >= league.week) continue;
    if (g.homeId !== teamId && g.awayId !== teamId) continue;
    const mine = g.homeId === teamId ? g.result.homeScore : g.result.awayScore;
    const theirs = g.homeId === teamId ? g.result.awayScore : g.result.homeScore;
    w += mine > theirs ? 1 : mine === theirs ? 0.5 : 0;
    n++;
  }
  return n >= 3 ? w / n : 0.5;
}

function week(league: League): Week {
  const key = weekKey(league);
  const hit = weeks.get(league);
  if (hit?.key === key) return hit;
  const ctx = moraleContext(league);
  const mean = moraleMean(league);
  const mood = new Map<string, number>();
  const comfortable = new Set<string>();
  const years = new Map<ChemRoom, number[]>();
  for (const team of league.teams) {
    // From the weeks before this one: a result played this week doesn't change this week's read.
    const share = shareBefore(league, team.id);
    for (const unit of CHEM_ROOMS) {
      const key = `${team.id}:${unit}`;
      const read = unitRead(league, team.id, unit, ctx);
      const part = read ? moodPart(read.level, mean, read.word === 'Split') : 0;
      const hungry = (ctx.voices.get(key) ?? []).some((v) => league.players[v.id] && isDriven(league.players[v.id]));
      const kept = complacent(part, share, hungry);
      if (kept < part) comfortable.add(key);
      mood.set(key, kept);
      const time = timeOf(league, team, unit);
      if (time) (years.get(unit) ?? years.set(unit, []).get(unit)!).push(time.years);
    }
  }
  const typical = new Map<ChemRoom, number>();
  for (const [unit, list] of years) typical.set(unit, list.reduce((a, b) => a + b, 0) / list.length);
  const w: Week = { key, mood, comfortable, typical, centre: new Map() };
  for (const unit of CHEM_ROOMS) {
    const raws = league.teams.map((t) => raw(league, w, t, unit).edge);
    w.centre.set(unit, raws.reduce((a, b) => a + b, 0) / Math.max(1, raws.length));
  }
  weeks.set(league, w);
  return w;
}

function raw(league: League, w: Week, team: Team, unit: ChemRoom) {
  const mood = w.mood.get(`${team.id}:${unit}`) ?? 0;
  const time = timeOf(league, team, unit);
  const together = time ? CHEM.together * clamp(time.years - (w.typical.get(unit) ?? 0), -1, 1) : null;
  return { mood, time, together, edge: clamp(mood + (together ?? 0), -CHEM.cap, CHEM.cap) };
}

/** One room's chemistry this week (null for a club that isn't in the league). */
export function chemistryOf(league: League, teamId: number, unit: ChemRoom): Chemistry | null {
  const team = league.teams[teamId];
  if (!team) return null;
  const w = week(league);
  const r = raw(league, w, team, unit);
  // Centred, then held to the cap: the clamp can only bite past ±0.3, which centring almost never reaches.
  const edge = clamp(r.edge - (w.centre.get(unit) ?? 0), -CHEM.cap, CHEM.cap);
  return {
    teamId,
    unit,
    mood: r.mood,
    together: r.together,
    years: r.time?.years ?? null,
    newStarters: r.time?.newStarters ?? 0,
    comfortable: w.comfortable.has(`${teamId}:${unit}`),
    edge,
    word: wordOf(edge, r.together),
  };
}

/** Every club's rooms this week, keyed `${teamId}:${unit}`. */
export function chemistryWeek(league: League): Map<string, Chemistry> {
  const out = new Map<string, Chemistry>();
  for (const team of league.teams)
    for (const unit of CHEM_ROOMS) {
      const c = chemistryOf(league, team.id, unit);
      if (c) out.set(`${team.id}:${unit}`, c);
    }
  return out;
}
