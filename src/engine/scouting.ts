/**
 * What a front office believes about a player. The match engine always plays the true ratings;
 * every screen shows a team's perception instead: exact for its own players, a range for
 * everyone else that narrows with film (years in the league) and with scouting visits.
 *
 * Nothing per team is stored except the user's scouting. A view is derived from how well the team
 * knows the player plus an error seeded by (league, team, player), so a report never changes when
 * a screen refreshes, and as knowledge grows the same error shrinks toward the truth instead of
 * being re-rolled.
 */
import { ATTRIBUTE_INFO, type AgingFamily } from './attributes';
import { PEAK_END } from './development';
import { ATTRIBUTE_PROFILES, overall, OVR_WEIGHTS, POSITION_NAMES, STARTERS } from './positions';
import { clamp, Rng } from './rng';
import type { Attribute, Combine, League, Player, Position, Ratings } from './types';
import { ATTRIBUTES, POSITIONS } from './types';

/** Scouting visits a front office gets per league year. */
export const SCOUT_POINTS_PER_YEAR = 30;
/** Share of the remaining uncertainty one scouting visit removes. */
const VISIT_GAIN = 0.35;

/** Rating-point error (sd) and range half-width at zero knowledge. */
const ERROR = 2.4;
const SPREAD = 4;
/** Some things are easier to see on film: athleticism shows, the mental game hides. */
const VISIBILITY: Record<AgingFamily, number> = { physical: 0.2, technical: 0, mental: -0.1 };

/** A draft prospect who hasn't been picked yet. */
export const isProspect = (p: Player) => !!p.scouting && !p.draft && p.teamId === null;

/**
 * How well `teamId` knows a player: 0 (a name on a list) … 1 (exact). Your own players are known
 * exactly; veterans are well known from film; prospects are mostly guesswork until scouted.
 */
export function knowledge(league: League, teamId: number, p: Player): number {
  if (p.teamId === teamId) return 1;
  // Higher-graded prospects get more exposure (bowl games, TV), so start better known.
  const film = isProspect(p) ? 0.2 + 0.15 * clamp((p.scouting!.grade - 6) / 8, 0, 1) : Math.min(0.9, 0.45 + 0.08 * p.experience);
  const scouted = teamId === league.userTeamId ? (league.knowledge[p.id] ?? 0) : 0;
  return Math.max(film, scouted);
}

export interface RatingView {
  /** Best guess, rounded. */
  value: number;
  lo: number;
  hi: number;
}

export interface PlayerView {
  knowledge: number;
  /** Own player: visible ratings are exact (potential is still a judgment call). */
  exact: boolean;
  ratings: Record<Attribute, RatingView>;
  /** Best-guess overall (unrounded) and its range. */
  ovr: number;
  ovrLo: number;
  ovrHi: number;
  /** Projected ceiling, on the overall scale. Collapses to the overall once he's done growing. */
  potLo: number;
  potHi: number;
}

/** `teamId`'s view of a player. */
export function perceive(league: League, teamId: number, p: Player): PlayerView {
  const k = knowledge(league, teamId, p);
  const exact = k >= 1;
  const rng = new Rng(`${league.seed}:view:${teamId}:${p.id}`);
  // A scout who is high on a player tends to be high on all of him; each trait adds its own miss.
  const zPlayer = rng.normal();
  const zPot = rng.normal();
  const weights = OVR_WEIGHTS[p.position];
  const ratings = {} as Record<Attribute, RatingView>;
  const centers = {} as Ratings;
  let spread = 0;
  let weightSum = 0;
  for (const attr of ATTRIBUTES) {
    const z = rng.normal();
    const truth = p.ratings[attr];
    const miss = exact ? 0 : 1 - clamp(k + VISIBILITY[ATTRIBUTE_INFO[attr].aging], 0, 1);
    const center = clamp(truth + ERROR * miss * (0.6 * zPlayer + 0.8 * z), 1, 20);
    const half = SPREAD * miss;
    const value = Math.round(center);
    ratings[attr] = half < 0.5 ? { value, lo: value, hi: value } : { value, lo: clamp(Math.round(center - half), 1, 20), hi: clamp(Math.round(center + half), 1, 20) };
    centers[attr] = center;
    const w = weights[attr] ?? 0;
    spread += w * half;
    weightSum += w;
  }
  const ovr = overall(centers, p.position);
  // Misses on different traits partly cancel out in the overall.
  const ovrHalf = (0.6 * spread) / weightSum;
  const ovrLo = Math.max(1, ovr - ovrHalf);
  const ovrHi = Math.min(20, ovr + ovrHalf);

  let potLo = ovrLo;
  let potHi = ovrHi;
  if (p.age < 26) {
    // The younger he is, the more growth is left to guess at; even your own coaches can be wrong.
    const room = 26 - p.age;
    const u = (0.5 + 0.35 * room) * (1 - 0.6 * k);
    // Overrate him now and you'll overrate his ceiling too.
    const center = p.potential + (ovr - overall(p.ratings, p.position)) + 0.8 * u * zPot;
    potLo = clamp(Math.max(ovr, center - u), 1, 20);
    potHi = clamp(Math.max(potLo, center + u), 1, 20);
  }
  return { knowledge: k, exact, ratings, ovr, ovrLo, ovrHi, potLo, potHi };
}

/** Best-guess overall for a table cell. */
export const seenOvr = (league: League, teamId: number, p: Player) => perceive(league, teamId, p).ovr;

/** Spend a scouting visit on a player. Returns his new knowledge level. */
export function scoutPlayer(league: League, playerId: number): number {
  const p = league.players[playerId];
  if (!p || p.retired) throw new Error('No such player');
  if (p.teamId === league.userTeamId) throw new Error('He is already on your roster');
  if (league.scoutPoints <= 0) throw new Error('No scouting visits left this year');
  const k = knowledge(league, league.userTeamId, p);
  const next = Math.round((k + (1 - k) * VISIT_GAIN) * 1000) / 1000;
  league.knowledge[p.id] = next;
  league.scoutPoints--;
  return next;
}

/** New league year: a fresh scouting budget, and no notes kept on players who have retired. */
export function resetScouting(league: League): void {
  league.scoutPoints = SCOUT_POINTS_PER_YEAR;
  for (const id of Object.keys(league.knowledge)) if (!league.players[Number(id)] || league.players[Number(id)].retired) delete league.knowledge[Number(id)];
}

// ───────── stars ─────────

interface Reference {
  /** True overalls at each position, ascending: every rostered player, starters only, backups only. */
  curves: Record<Position, number[]>;
  starters: Record<Position, number[]>;
  backups: Record<Position, number[]>;
  /** Average starter rating at each position, per attribute. */
  starterAvg: Record<Position, Ratings>;
}

const refCache = new WeakMap<League, { key: string; ref: Reference }>();

/** League-wide reference distributions, rebuilt when the league moves on. */
function reference(league: League): Reference {
  const last = league.transactions.at(-1);
  const key = `${league.season}|${league.phase}|${league.week}|${league.faDay}|${league.nextPlayerId}|${league.transactions.length}|${last?.text ?? ''}`;
  const hit = refCache.get(league);
  if (hit && hit.key === key) return hit.ref;
  const empty = () => Object.fromEntries(POSITIONS.map((pos) => [pos, [] as number[]])) as Record<Position, number[]>;
  const [curves, starterCurves, backups] = [empty(), empty(), empty()];
  const starterAvg = {} as Record<Position, Ratings>;
  for (const pos of POSITIONS) {
    const starters = league.teams.flatMap((t) => t.depthChart[pos].slice(0, STARTERS[pos]).map((id) => league.players[id]).filter(Boolean));
    starterAvg[pos] = Object.fromEntries(ATTRIBUTES.map((a) => [a, starters.reduce((s, p) => s + p.ratings[a], 0) / Math.max(1, starters.length)])) as Ratings;
    for (const p of starters) starterCurves[pos].push(overall(p.ratings, pos));
  }
  const starterIds = new Set(league.teams.flatMap((t) => POSITIONS.flatMap((pos) => t.depthChart[pos].slice(0, STARTERS[pos]))));
  for (const p of Object.values(league.players)) {
    if (p.teamId === null || p.retired) continue;
    const ovr = overall(p.ratings, p.position);
    curves[p.position].push(ovr);
    if (!starterIds.has(p.id)) backups[p.position].push(ovr);
  }
  for (const c of [...Object.values(curves), ...Object.values(starterCurves), ...Object.values(backups)]) c.sort((a, b) => a - b);
  const ref = { curves, starters: starterCurves, backups, starterAvg };
  refCache.set(league, { key, ref });
  return ref;
}

/** Share of an ascending curve below `value` (0–1). */
function percentile(curve: number[], value: number): number {
  if (!curve.length) return 0.5;
  let lo = 0;
  let hi = curve.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (curve[mid] < value) lo = mid + 1;
    else hi = mid;
  }
  return lo / curve.length;
}

/** Share of the league's rostered players at `pos` rated below `value` (0–1). */
export const leaguePercentile = (league: League, pos: Position, value: number) => percentile(reference(league).curves[pos], value);

/** 0–4 in half steps: nine levels, each about an eighth of the league at the position. */
const toStars = (x: number) => clamp(Math.round(x * 2) / 2, 0, 4);

export type StarScale = 'league' | 'roster';

export interface StarRating {
  /** Current ability, 0–4 in half stars. */
  ability: number;
  /** Projected ceiling range on the same scale. */
  potLo: number;
  potHi: number;
  /** What the stars are measured against, for the label on screen. */
  basis: string;
}

/**
 * Stars relative to a reference group. `league` compares with every rostered player at the
 * position ("is he good?"); `roster` compares with the viewing team's starters there ("does he
 * start for me?": 3 stars is your starters' level, each rating point is half a star).
 */
export function starRating(league: League, teamId: number, p: Player, view: PlayerView, scale: StarScale = 'league'): StarRating {
  const pos = p.position;
  if (scale === 'roster') {
    const team = league.teams[teamId];
    const mine = team.depthChart[pos].slice(0, STARTERS[pos]).map((id) => league.players[id]).filter(Boolean);
    const avg = mine.length ? mine.reduce((s, x) => s + overall(x.ratings, pos), 0) / mine.length : 10;
    const rel = (v: number) => toStars(3 + 0.5 * (v - avg));
    return { ability: rel(view.ovr), potLo: rel(view.potLo), potHi: rel(view.potHi), basis: `vs your starting ${pos}${STARTERS[pos] > 1 ? 's' : ''}` };
  }
  const rel = (v: number) => toStars(leaguePercentile(league, pos, v) * 4);
  return { ability: rel(view.ovr), potLo: rel(view.potLo), potHi: rel(view.potHi), basis: `vs every ${pos} in the league` };
}

// ───────── scout report ─────────

/** Where an overall would rank in the league: among its starters, or else among its backups. */
interface Tier {
  /** Verdict adjective ("A solid starting cornerback"). */
  role: string;
  /** What he could become ("he could become a solid starter"). */
  becomes: string;
}
const TIERS: Tier[] = [
  { role: 'An elite', becomes: 'an elite player' },
  { role: 'A high-end starting', becomes: 'a high-end starter' },
  { role: 'A solid starting', becomes: 'a solid starter' },
  { role: 'A fringe starting', becomes: 'a fringe starter' },
  { role: 'A quality backup', becomes: 'a quality backup' },
  { role: 'A depth', becomes: 'a depth player' },
  { role: 'A camp-body', becomes: 'a camp body' },
];

function tierOf(league: League, pos: Position, ovr: number): number {
  const ref = reference(league);
  const sp = percentile(ref.starters[pos], ovr);
  if (sp >= 0.9) return 0;
  if (sp >= 0.6) return 1;
  if (sp >= 0.3) return 2;
  if (sp >= 0.08) return 3;
  const bp = percentile(ref.backups[pos], ovr);
  return bp >= 0.5 ? 4 : bp >= 0.15 ? 5 : 6;
}

const list = (items: string[]) => (items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`);

/**
 * A short plain-language report: verdict, standout traits, concerns, projection and how sure the
 * staff is. Written only from what `teamId` can see.
 */
export function scoutReport(league: League, teamId: number, p: Player): string[] {
  const view = perceive(league, teamId, p);
  const pos = POSITION_NAMES[p.position].toLowerCase();
  const lines: string[] = [];
  const now = tierOf(league, p.position, view.ovr);
  const ceiling = tierOf(league, p.position, view.potHi);
  lines.push(`${TIERS[now].role} ${pos}.`);

  // Traits that count at his position, measured against the league's starters there.
  const avg = reference(league).starterAvg[p.position];
  const weights = OVR_WEIGHTS[p.position];
  const traits = (Object.keys(weights) as Attribute[]).map((a) => ({ a, diff: view.ratings[a].value - avg[a], w: weights[a]! }));
  const plus = traits.filter((t) => t.diff >= 2).sort((x, y) => y.diff * y.w - x.diff * x.w).slice(0, 2);
  const minus = traits.filter((t) => t.diff <= -3 && t.w >= 1).sort((x, y) => x.diff * x.w - y.diff * y.w).slice(0, 2);
  if (plus.length) lines.push(`Stands out for his ${list(plus.map((t) => `${t.diff >= 4 ? 'elite' : 'plus'} ${ATTRIBUTE_INFO[t.a].trait}`))}.`);
  if (minus.length) lines.push(`Needs work on his ${list(minus.map((t) => ATTRIBUTE_INFO[t.a].trait))}.`);
  if (!plus.length && !minus.length) lines.push('No standout trait and no glaring hole.');

  const peak = PEAK_END[p.position];
  if (p.age < 26) {
    if (ceiling < now) lines.push(`Still developing: with reps he could become ${TIERS[ceiling].becomes}.`);
    else lines.push('Close to a finished product already.');
  } else if (p.age > peak) lines.push(`At ${p.age}, his physical tools are fading.`);
  else if (p.age >= peak - 1) lines.push('At the tail end of his prime.');

  if (view.exact) lines.push(p.age < 26 ? 'We know his game; his ceiling is our coaches’ best guess.' : 'We know exactly what he is.');
  else if (view.knowledge >= 0.8) lines.push('Plenty of film on him: this read is reliable.');
  else if (view.knowledge >= 0.55) lines.push('Decent film, but these grades could be a point or two off.');
  else lines.push(`Limited looks: treat these grades as a rough range.${teamId === league.userTeamId && league.scoutPoints > 0 ? ' A scouting visit would narrow it.' : ''}`);

  // Agents and teammates talk: a well-known player's priorities are no secret.
  if (view.knowledge >= 0.7) {
    const { greed, loyalty, winning } = p.personality;
    const top = Math.max(greed, loyalty, winning);
    if (top > 0.8) lines.push(top === greed ? 'His agent drives a hard bargain.' : top === loyalty ? 'Values loyalty: open to a hometown discount.' : 'Wants to play for a contender.');
  }
  return lines;
}

// ───────── combine ─────────

/** An average NFL starter's combine at each position: [40, bench, vertical, broad, shuttle, 3-cone]. */
export const COMBINE_TYPICAL: Record<Exclude<Position, 'K' | 'P'>, [number, number, number, number, number, number]> = {
  QB: [4.8, 0, 31, 112, 4.35, 7.05],
  RB: [4.52, 20, 35, 121, 4.25, 7.0],
  WR: [4.48, 14, 36, 124, 4.2, 6.9],
  TE: [4.7, 20, 33.5, 117, 4.35, 7.15],
  OL: [5.25, 27, 28, 104, 4.65, 7.75],
  DT: [5.05, 28, 29.5, 107, 4.6, 7.65],
  EDGE: [4.75, 24, 34, 119, 4.4, 7.15],
  LB: [4.68, 22, 34.5, 119, 4.28, 7.05],
  CB: [4.47, 14, 37, 125, 4.18, 6.95],
  S: [4.55, 16, 36.5, 123, 4.2, 6.95],
};

const round = (x: number, step: number) => Math.round(x / step) * step;

/**
 * Measurables and drills, driven by the true physical ratings plus noise, so the combine is
 * evidence rather than truth. Seeded by the player himself, so it never touches the league's RNG.
 */
export function generateCombine(p: Player): Combine {
  const rng = new Rng(`combine:${p.id}:${p.firstName} ${p.lastName}:${p.heightIn}:${p.weightLb}`);
  const noise = Array.from({ length: 14 }, () => rng.normal());
  const skips = Array.from({ length: 6 }, () => rng.chance(0.08));
  const c: Combine = {
    arms: round(clamp(0.43 * p.heightIn + 0.7 * noise[0], 28.5, 36.5), 0.125),
    hands: round(clamp(9.6 + 0.03 * (p.heightIn - 74) + 0.45 * noise[1], 8, 11.25), 0.125),
  };
  if (p.position === 'K' || p.position === 'P') return c;
  // Each drill reads a rating relative to an average starter at his position.
  const typical = (a: Attribute) => 12.8 + (ATTRIBUTE_PROFILES[p.position][a] ?? -8);
  const ds = p.ratings.speed - typical('speed');
  const da = p.ratings.agility - typical('agility');
  const dst = p.ratings.strength - typical('strength');
  const burst = 0.6 * ds + 0.4 * da;
  const [forty, bench, vertical, broad, shuttle, cone] = COMBINE_TYPICAL[p.position];
  const heavy = p.weightLb - 250;
  if (!skips[0]) c.forty = round(clamp(forty - 0.035 * ds + 0.0015 * heavy + 0.035 * noise[2], 4.2, 5.7), 0.01);
  // Quarterbacks don't bench at the combine.
  if (!skips[1] && p.position !== 'QB') c.bench = Math.round(clamp(bench + 1.3 * dst + 0.03 * heavy + 1.8 * noise[3], 4, 45));
  if (!skips[2]) c.vertical = round(clamp(vertical + 0.6 * burst + 1.3 * noise[4], 22, 45), 0.5);
  if (!skips[3]) c.broad = Math.round(clamp(broad + 2 * burst + 3 * noise[5], 90, 145));
  if (!skips[4]) c.shuttle = round(clamp(shuttle - 0.025 * da + 0.05 * noise[6], 3.85, 5.1), 0.01);
  if (!skips[5]) c.cone = round(clamp(cone - 0.04 * da + 0.08 * noise[7], 6.4, 8.4), 0.01);
  return c;
}
