/**
 * The weather outside a roofed ground, for show only. The game plays such a ground as indoors and says nothing of the
 * day outside, so the picture rolls its own from the place and the month: it falls on the land and the roof and stops
 * there. Nothing in the sim reads it (the owner, Nov 11: "it has no bearing anyway").
 */
import { CLIMATE, STADIUMS } from '../../engine/data/stadiums';
import { Rng } from '../../engine/rng';
import { monthOf } from '../../engine/weather';

/** Grounds the game gives no climate (always under a roof): the nearest place it does know. */
const NEAREST: Record<string, string> = { MIN: 'GB', DET: 'CLE', NO: 'HOU', LV: 'ARI', LAC: 'ARI', LAS: 'ARI' };

export interface Outside {
  precip: 'none' | 'rain' | 'snow';
  lying: boolean;
}

/** A day's weather outside, from the place's month: its wet days, and snow when the month is cold enough for it. */
export function outsideWeather(seed: string, abbrev: string, season: number, gameId: number, week: number): Outside {
  const month = CLIMATE[STADIUMS[abbrev]?.climate ?? NEAREST[abbrev] ?? '']?.[monthOf(week)];
  if (!month) return { precip: 'none', lying: false };
  const [hi, lo, wetDays, snowIn] = month;
  const rng = new Rng(`${seed}:${season}:${gameId}:outside`);
  const wet = rng.next() < wetDays / 30;
  const cold = (hi + lo) / 2 <= 36 && snowIn > 0;
  return { precip: wet ? (cold ? 'snow' : 'rain') : 'none', lying: cold && (wet || rng.next() < 0.5) };
}
