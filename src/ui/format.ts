import type { Attribute, Player, Position, Team } from '../engine/types';
import { OVR_WEIGHTS } from '../engine/positions';
import type { TeamRecord } from '../engine/season/standings';

export const money = (thousands: number) =>
  thousands >= 1000 ? `$${(thousands / 1000).toFixed(thousands >= 10_000 ? 1 : 2)}M` : `$${thousands}K`;

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

export const ATTR_LABELS: Record<Attribute, [short: string, long: string]> = {
  speed: ['SPD', 'Speed'],
  strength: ['STR', 'Strength'],
  agility: ['AGI', 'Agility'],
  awareness: ['AWR', 'Awareness'],
  throwPower: ['THP', 'Throw power'],
  throwAccShort: ['SAC', 'Short accuracy'],
  throwAccDeep: ['DAC', 'Deep accuracy'],
  carrying: ['CAR', 'Ball security'],
  elusiveness: ['ELU', 'Elusiveness'],
  catching: ['CTH', 'Hands'],
  routeRunning: ['RTE', 'Route running'],
  passBlock: ['PBK', 'Pass blocking'],
  runBlock: ['RBK', 'Run blocking'],
  tackling: ['TAK', 'Tackling'],
  passRush: ['PRS', 'Pass rush'],
  runStop: ['RST', 'Run stopping'],
  coverage: ['COV', 'Coverage'],
  kickPower: ['KPW', 'Kick power'],
  kickAccuracy: ['KAC', 'Kick accuracy'],
};

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

export function weekLabel(week: number): string {
  if (week <= 18) return `Week ${week}`;
  return ['Wild Card', 'Divisional', 'Conference', 'Championship'][week - 19] ?? `Week ${week}`;
}
