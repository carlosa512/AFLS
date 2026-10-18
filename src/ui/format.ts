import type { Attribute, League, Player, Position, Team } from '../engine/types';
import { ATTRIBUTES, OFFSEASON_PHASES } from '../engine/types';
import { ATTRIBUTE_INFO } from '../engine/attributes';
import { OVR_WEIGHTS } from '../engine/positions';
import type { TeamRecord } from '../engine/season/standings';

/** $K → "$46.8M", "$885K", "-$2.3M". */
export const money = (thousands: number): string => {
  if (thousands < 0) return `-${money(-thousands)}`;
  if (thousands === 0) return '$0';
  return thousands >= 1000 ? `$${(thousands / 1000).toFixed(thousands >= 10_000 ? 1 : 2)}M` : `$${Math.round(thousands)}K`;
};

export const heightFt = (inches: number) => `${Math.floor(inches / 12)}'${inches % 12}"`;

export const gameClock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

export const recordText = (r: Pick<TeamRecord, 'w' | 'l' | 't'>) => (r.t ? `${r.w}-${r.l}-${r.t}` : `${r.w}-${r.l}`);

export const pct = (r: Pick<TeamRecord, 'w' | 'l' | 't'>) => {
  const g = r.w + r.l + r.t;
  return g ? ((r.w + r.t / 2) / g).toFixed(3).replace(/^0/, '') : '.000';
};

export const teamName = (t: Team) => `${t.city} ${t.name}`;
export const playerName = (p: Player) => `${p.firstName} ${p.lastName}`;
export const shortName = (p: Player) => `${p.firstName[0]}. ${p.lastName}`;

/** Rating band for colour-coding on the 1–20 scale. */
export function band(value: number): 'b1' | 'b2' | 'b3' | 'b4' {
  if (value >= 16) return 'b4';
  if (value >= 11) return 'b3';
  if (value >= 6) return 'b2';
  return 'b1';
}

/**
 * One scale for every "better or worse than typical" effect (coaching, medical, a hire), measured as a share
 * of how big that effect can get, so "Strong" means the same thing on every screen. `much` is the adverb a
 * sentence uses ("develop noticeably faster"); empty for Average, which a sentence says as "the usual".
 */
const VERDICTS: [at: number, word: string, much: string][] = [
  [0.5, 'Elite', 'much'],
  [0.2, 'Strong', 'noticeably'],
  [0.07, 'Above average', 'a little'],
  [-0.07, 'Average', ''],
  [-0.2, 'Below average', 'a little'],
  [-0.5, 'Weak', 'noticeably'],
  [-Infinity, 'Liability', 'much'],
];
export interface Verdict {
  word: string;
  much: string;
  tone: 'tone-good' | 'tone-bad' | 'muted';
}
/** `good` is the effect signed so that positive helps; `max` is the biggest it can get. */
export function verdict(good: number, max: number): Verdict {
  const i = VERDICTS.findIndex(([at]) => good / max >= at);
  const [, word, much] = VERDICTS[i];
  return { word, much, tone: i < 3 ? 'tone-good' : i > 3 ? 'tone-bad' : 'muted' };
}

/** [short, long] label for each attribute, from the attribute registry. */
export const ATTR_LABELS = Object.fromEntries(ATTRIBUTES.map((a) => [a, [ATTRIBUTE_INFO[a].short, ATTRIBUTE_INFO[a].label]])) as Record<Attribute, [short: string, long: string]>;

/** The attributes that matter most at a position, heaviest first. */
export function keyAttributes(position: Position, count = 4): Attribute[] {
  return (Object.entries(OVR_WEIGHTS[position]) as [Attribute, number][])
    .sort((a, b) => b[1] - a[1])
    .slice(0, count)
    .map(([a]) => a);
}

export const ordinal = (n: number) => {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
};

/** During the offseason the league year has already rolled over; results screens show the season just played. */
export const resultsSeason = (league: League) => (OFFSEASON_PHASES.includes(league.phase) ? league.season - 1 : league.season);

export const isOffseasonPhase = (league: League) => OFFSEASON_PHASES.includes(league.phase);

export const PHASE_LABELS: Record<League['phase'], string> = {
  regular: 'Regular season',
  playoffs: 'Playoffs',
  complete: 'Season complete',
  resign: 'Re-sign window',
  freeAgency: 'Free agency',
  draft: 'Draft',
  preseason: 'Training camp',
};

export function weekLabel(week: number): string {
  if (week <= 18) return `Week ${week}`;
  return ['Wild Card', 'Divisional', 'Conference', 'Championship'][week - 19] ?? `Week ${week}`;
}
