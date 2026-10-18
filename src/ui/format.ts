import type { Attribute, League, Player, Position, Team } from '../engine/types';
import { ATTRIBUTES, OFFSEASON_PHASES } from '../engine/types';
import { ATTRIBUTE_INFO } from '../engine/attributes';
import { OVR_WEIGHTS } from '../engine/positions';
import type { TeamRecord } from '../engine/season/standings';
import { severity, type Forecast, type Severity, type Weather } from '../engine/weather';

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

const PRECIP = { none: 'Dry', rain: 'Rain', mixed: 'Sleet', snow: 'Snow' } as const;
const SEVERITY: Record<Severity, string> = { none: '', light: 'Light weather', moderate: 'Moderate weather', heavy: 'Heavy weather' };

/** How hard the conditions hit play, in words ('' when they don't). */
export const severityText = (s: Severity) => SEVERITY[s];

/** What a game was played in: "Heavy snow · 28°F · wind 14 mph", "Indoors", "Roof closed". */
export function weatherText(w: Weather): string {
  if (w.roof === 'dome') return 'Indoors';
  if (w.roof === 'closed') return 'Roof closed';
  const sky = w.precip === 'none' ? [] : [w.heavy ? `Heavy ${PRECIP[w.precip].toLowerCase()}` : PRECIP[w.precip]];
  return [...sky, `${w.tempF}°F`, `wind ${w.windMph} mph`, ...(w.roof === 'open' ? ['roof open'] : [])].join(' · ');
}

/** The weather line for a game: what it was played in, or what the forecast says. */
export function gameWeatherText(w: Weather | undefined, f: Forecast | null): { text: string; severity: Severity; outlook?: boolean } {
  if (w) return { text: weatherText(w), severity: severity(w) };
  if (!f) return { text: 'Indoors', severity: 'none' };
  if (f.roof === 'closed') return { text: 'Roof closed', severity: 'none' };
  const sky = f.chance ? `${PRECIP[f.precip]} ${f.chance}%` : 'Dry';
  const roof = f.roof === 'tbd' ? ['roof TBD'] : f.roof === 'open' ? ['roof open'] : [];
  if (f.stage === 'outlook') return { text: [`Avg ${f.tempF[0]}°F`, sky, ...roof].join(' · '), severity: 'none', outlook: true };
  const range = ([lo, hi]: [number, number]) => (lo === hi ? `${lo}` : `${lo}–${hi}`);
  return { text: [sky, `${range(f.tempF)}°F`, `wind ${range(f.windMph)} mph`, ...roof].join(' · '), severity: f.severity };
}
