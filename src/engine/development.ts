/**
 * Player development. Young players grow toward their ceiling, faster with reps and a work ethic;
 * veterans hold through their prime, then fade family by family (physical tools first, the mental
 * game last) on their position's curve, shaped by their body clock (`aging.ts`).
 *
 * A player's year is **rolled once**, at the new league year, on his own stream (so breakout years
 * and busts survive, and tuning never reshuffles a draft), and **released in steps** (docs/TRAINING.md
 * §3): a share in March, a share over the spring program and camp, the rest week by week through the
 * season, a week he plays releasing more than a week he sits. Each step lands `round(start + share ×
 * target)`, so ratings stay integers, never jitter, and a year released in steps ends exactly where
 * one jump would. Whatever hasn't landed by the next new league year lands then (the true-up), before
 * the next roll. With everything released in March (`RELEASE` at 1/0/0/0) this is the game as it was.
 */
import { agingFamily, AGING, declineOnset } from './aging';
import type { AgingFamily } from './attributes';
import { ATTRIBUTE_PROFILES, OVR_WEIGHTS, overall } from './positions';
import { clamp, Rng } from './rng';
import { REGULAR_SEASON_WEEKS } from './season/schedule';
import { declineMult, growthMult } from './traits';
import type { Attribute, DevYear, Game, League, Player, Position } from './types';
import { ATTRIBUTES } from './types';

export { PEAK_END } from './aging';

// ───────── settling ceilings ─────────

/**
 * How far a young player's true ceiling can still move, 1 sd, in each of his first three league years: a
 * draft-day ceiling is a best guess, and the league settles it (`ceiling.ts`), a lot in year one, little by
 * year three.
 */
export const CEILING_SWING: readonly number[] = [1.6, 1.1, 0.6];

/** Which of his settling years this league year is (an index into `CEILING_SWING`), or null once he is 26 or past his third. */
export function settleYear(p: Pick<Player, 'age' | 'experience'>): number | null {
  return p.age < 26 && p.experience >= 0 && p.experience < CEILING_SWING.length ? p.experience : null;
}

/**
 * The spread his ceiling still has to settle, 1 sd: the swings of the years to come (this season's while it
 * hasn't settled), combined as independent draws are. A scout's ceiling range widens by it (`perceive`).
 */
export function unsettledSpread(p: Pick<Player, 'age' | 'experience' | 'ceilingShifts'>, season: number): number {
  const year = settleYear(p);
  if (year === null) return 0;
  const from = p.ceilingShifts?.[season] !== undefined ? year + 1 : year;
  return Math.hypot(...CEILING_SWING.slice(from));
}

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
  const teamGames =
    p.teamId === null
      ? SEASON_GAMES
      : league.games.filter(
          (g) => g.season === season && !g.playoffRound && g.result && (g.homeId === p.teamId || g.awayId === p.teamId),
        ).length;
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

/** What the roll reads of a player: his ratings as they stood when the year was rolled. */
type Rolled = Pick<Player, 'age' | 'position' | 'potential' | 'traits' | 'ratings'>;

/**
 * Roll one year of development: the change each rating is headed for (in `ATTRIBUTES` order, 0 for a
 * rating his position doesn't carry), dither included. `rng` is the player's own stream for the year;
 * the draws, and their order, are the same whatever the release split.
 */
export function rollYear(rng: Rng, player: Rolled, ctx: DevContext): number[] {
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
    const gap = Math.max(0, player.potential - overall(player.ratings, pos));
    delta =
      gap * clamp(rng.float(0.15, 0.5) * growthMult(traits) * reps(age, ctx.playedShare) * rate * GROWTH_NORM, 0, 0.8);
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
  const targets = ATTRIBUTES.map(() => 0);
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
    targets[ATTRIBUTES.indexOf(attr)] = d + rng.normal(0, 0.35);
  }
  return targets;
}

/**
 * Land a share `s` (0–1) of the year: each rating becomes `round(start + s × target)`, where `start` is
 * what he had when the year was rolled (today's rating less what this year has applied). Integers only,
 * and monotone in `s`, so steps never jitter and the whole year lands exactly where one jump would.
 */
function applyShare(player: Player, targets: number[], applied: number[], s: number): void {
  for (let i = 0; i < ATTRIBUTES.length; i++) {
    const t = targets[i];
    if (!t) continue;
    const attr = ATTRIBUTES[i];
    const start = player.ratings[attr] - (applied[i] ?? 0);
    const want = Math.round(clamp(start + s * t, 1, 20)) - start;
    player.ratings[attr] = start + want;
    applied[i] = want;
  }
  // Trailing zeros carry nothing (a missing entry reads as 0): a save keeps the array short.
  while (applied.length && !applied[applied.length - 1]) applied.pop();
}

/** One whole year of development in one step (the cohort scripts and tests). `rng` is the player's own stream for the year. */
export function developPlayer(rng: Rng, player: Player, ctx: DevContext): void {
  applyShare(player, rollYear(rng, player, ctx), [], 1);
}

// ───────── roll once, release in steps ─────────

/**
 * Where a player's year lands (docs/TRAINING.md §3): the share released at the new league year, over the
 * spring program, in camp, and across the season's weeks. They sum to 1. At 1/0/0/0 the whole year lands
 * in March, the game as it was: every number below is a dial walked away from that one step at a time.
 */
export const RELEASE = { newYear: 0.6, program: 0.05, camp: 0.05, season: 0.3 };

/**
 * The inputs a year is rolled with. When the year is kept to land in steps, the coaching numbers are
 * rounded to four places first, so the stored year is short and the roll comes back exactly from it (the
 * one-jump replays in the scripts round the same way); with everything released in March nothing is
 * stored and the inputs are used as they come, the game as it was.
 */
export function rollInputs(ctx: DevContext): DevContext {
  if (RELEASE.newYear >= 1) return ctx;
  const r4 = (x: number) => Math.round(x * 1e4) / 1e4;
  const decline =
    ctx.decline &&
    (Object.fromEntries(Object.entries(ctx.decline).map(([f, v]) => [f, r4(v)])) as Partial<
      Record<AgingFamily, number>
    >);
  return { ...ctx, ...(ctx.rate !== undefined ? { rate: r4(ctx.rate) } : {}), ...(decline ? { decline } : {}) };
}

/** The stream a player's year is rolled on. */
const yearStream = (league: League, season: number, id: number) => new Rng(`${league.seed}:dev:${season}:${id}`);

/**
 * Roll a player's year and release the new-league-year share. What is still to come is kept as the
 * roll's inputs (`Player.dev`), never the targets: they come back from the seed whenever a step lands,
 * so `rng` must be his year's stream (`yearStream` for `league.season`) at its start, as `beginOffseason`
 * passes it (the retirement roll that follows draws from the same stream).
 */
export function beginYear(league: League, rng: Rng, p: Player, ctx: DevContext): void {
  ctx = rollInputs(ctx);
  const targets = rollYear(rng, p, ctx);
  const applied: number[] = [];
  if (RELEASE.newYear >= 1) {
    applyShare(p, targets, applied, 1);
    return;
  }
  // Only what the roll read: the coaching rate feeds growth (under 26), the decline effects a fading family.
  const fading = FAMILIES.some(
    (f) => p.age > declineOnset(f === 'physical' && ctx.bodyAs ? ctx.bodyAs : p.position, f, p.traits),
  );
  const games = Math.round(ctx.playedShare * SEASON_GAMES);
  p.dev = {
    season: league.season,
    ...(Math.abs(games / SEASON_GAMES - ctx.playedShare) < 1e-9 ? { games } : { share: ctx.playedShare }),
    ...(p.age < 26 && ctx.rate !== undefined ? { rate: ctx.rate } : {}),
    ...(fading && ctx.decline ? { decline: FAMILIES.map((f) => ctx.decline![f] ?? 1) } : {}),
    ...(ctx.bodyAs ? { bodyAs: ctx.bodyAs } : {}),
    // His ceiling can settle before the year has landed (`ceiling.ts`): the year keeps the one it was rolled with.
    ...(p.age < 26 ? { potential: p.potential } : {}),
    done: 0,
    applied,
  };
  releaseTo(p, targets, RELEASE.newYear);
}
/** The aging families, in the order `DevYear.decline` keeps them. */
const FAMILIES: AgingFamily[] = ['physical', 'technical', 'mental'];

/** This year's targets again, from the seed and the roll's inputs, on the ratings he had when it was rolled. */
export function yearTargets(league: League, p: Player): number[] {
  const d = p.dev!;
  const ratings = { ...p.ratings };
  ATTRIBUTES.forEach((a, i) => (ratings[a] -= d.applied[i] ?? 0));
  // His age ticks over right after the roll, so all year he is a year older than he was rolled at.
  // A year from before v57 kept no ceiling: nothing settled under it, so the player's is the one it was rolled with.
  const potential = d.potential ?? p.potential;
  const rolled: Rolled = { age: p.age - 1, position: p.position, potential, traits: p.traits, ratings };
  const decline = d.decline && Object.fromEntries(FAMILIES.map((f, i) => [f, d.decline![i]]));
  return rollYear(yearStream(league, d.season, p.id), rolled, {
    playedShare: d.share ?? Math.min(1, (d.games ?? 0) / SEASON_GAMES),
    rate: d.rate,
    decline,
    bodyAs: d.bodyAs,
  });
}

/**
 * Release the year up to share `s`; at 1 the year is done and nothing is kept. A year whose remainder
 * would round to nothing on every rating is done early too: the record goes, and the player's later
 * steps cost nothing (most of a prime-age player's drift lands in March).
 */
function releaseTo(p: Player, targets: number[], s: number): void {
  const d = p.dev!;
  const to = Math.min(1, s);
  applyShare(p, targets, d.applied, to);
  d.done = to;
  if (
    to >= 1 ||
    !ATTRIBUTES.some(
      (a, i) =>
        targets[i] && Math.round(clamp(p.ratings[a] - (d.applied[i] ?? 0) + targets[i], 1, 20)) !== p.ratings[a],
    )
  )
    delete p.dev;
}

/** Whatever of his year hasn't landed yet lands now: the next new league year, or a position change. */
export function trueUp(league: League, p: Player): void {
  if (p.dev) releaseTo(p, yearTargets(league, p), 1);
}

/** The spring program's share (as the draft closes) or camp's (cut-down day), for everyone with a year still landing. */
export function developBlock(league: League, block: 'program' | 'camp'): void {
  const share = RELEASE[block];
  if (share <= 0) return;
  for (const p of Object.values(league.players)) if (p.dev) releaseTo(p, yearTargets(league, p), p.dev.done + share);
}

/**
 * How much of a season week's share a player releases: a week he played, all of it; a week he sat
 * (benched, hurt, unsigned), the bench's reps against a starter's (`reps`), so about half by 24. What a
 * benched player doesn't release in season lands at the true-up: playing time moves *when* his year
 * lands, never how much. His team's bye is nobody's fault and counts as a week played.
 */
export function weekWeight(age: number, played: boolean): number {
  return played ? 1 : reps(age, 0) / reps(age, 1);
}

/** A regular-season week's share for everyone with a year still landing, by whether he played in `games`. */
export function developWeek(league: League, games: readonly Game[]): void {
  const share = RELEASE.season / REGULAR_SEASON_WEEKS;
  if (share <= 0) return;
  const played = new Set<number>();
  const busy = new Set<number>();
  for (const g of games) {
    if (!g.result) continue;
    busy.add(g.homeId).add(g.awayId);
    for (const [id, line] of Object.entries(g.result.playerStats)) if (line.gp) played.add(Number(id));
  }
  for (const p of Object.values(league.players)) {
    if (!p.dev) continue;
    const bye = p.teamId !== null && !busy.has(p.teamId);
    releaseTo(p, yearTargets(league, p), p.dev.done + share * weekWeight(p.age, played.has(p.id) || bye));
  }
}

/** This year's change so far in a rating, for his own team's screens (`dev` absent: the year has landed). */
export function appliedThisYear(p: Player, attr: Attribute): number {
  return p.dev?.applied[ATTRIBUTES.indexOf(attr)] ?? 0;
}

/** The average body's year (`year` above runs 0.3–1.4). */
const TYPICAL_YEAR = 0.85;
const agingMemo = new Map<Position, number[]>();

/**
 * The overall a typical body gains or loses, on average, in the offseason he spends at `age` once
 * growth is done: the prime's mental gains, then the decline above with a middling year and no
 * coaching. Calendar age only, a public judgment: front offices read it to see a veteran's fade
 * coming (`outlook.ts`), whatever his body clock really says.
 */
export function expectedAging(pos: Position, age: number): number {
  let table = agingMemo.get(pos);
  if (!table) agingMemo.set(pos, (table = []));
  const memo = table[age];
  if (memo !== undefined) return memo;
  const weights = OVR_WEIGHTS[pos];
  const fade = AGING[pos].slope;
  let sum = 0;
  let total = 0;
  for (const attr of ATTRIBUTES) {
    const w = weights[attr];
    if (!w) continue;
    const family = agingFamily(pos, attr);
    const past = age - declineOnset(pos, family);
    const d =
      past > 0
        ? -TYPICAL_YEAR * fade * FAMILY_LOSS[family] * Math.min(1, past) * (1 + 0.25 * Math.max(0, past - 1) + 0.25)
        : family === 'mental' && age >= 26
          ? MENTAL_GROWTH
          : 0;
    sum += w * d;
    total += w;
  }
  const out = total ? sum / total : 0;
  table[age] = out;
  return out;
}

export type { DevYear };
