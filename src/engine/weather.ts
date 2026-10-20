/**
 * Weather: real roofs, real climates, and what a day outdoors does to a game.
 *
 * A game's weather is a pure function of the league seed, season and game id, so nothing is stored
 * until it's played (the result keeps it for the box score) and reloading can't reroll a storm. It
 * draws from its own streams, never the game's, and forecasts from theirs, so looking at a forecast
 * changes nothing. Effects are measured against a typical NFL day (`TYPICAL`): a dome plays a little
 * better than average and a December gale a lot worse, so league totals stay where they were.
 */
import { CLIMATE, DEFAULT_ROOF_POLICY, REGIONS, STADIUMS, type ClimateMonth, type Stadium } from './data/stadiums';
import { clamp, Rng } from './rng';
import { isPrimeTime } from './season/kickoff';
import type { Game, League } from './types';

export type Roof = 'dome' | 'closed' | 'open' | 'outdoors';
export type Precip = 'none' | 'rain' | 'mixed' | 'snow';
export type Severity = 'none' | 'light' | 'moderate' | 'heavy';

export interface Weather {
  roof: Roof;
  tempF: number;
  windMph: number;
  precip: Precip;
  /** Heavy rain or heavy snow. */
  heavy?: true;
  /** The quarter rain or snow starts in when it comes after kickoff (an open roof shuts then). */
  onset?: 2 | 3 | 4;
  /** A prime-time kickoff, after dark. */
  night?: true;
  /** Thin air, feet above sea level. */
  altitudeFt?: number;
}

/** What weather costs a game. */
export interface WeatherCost {
  /** Share of a passing game's production lost. */
  pass: number;
  /** Yards every kick plays longer. */
  kick: number;
  /** Fumble odds multiplier. */
  fumble: number;
}

const INDOORS: Weather = { roof: 'dome', tempF: 72, windMph: 0, precip: 'none' };
/** Airport anemometers sit high in the open; a stadium bowl shelters the field (NFL games average about 7 mph). */
const FIELD_WIND = 0.8;
/** Day-to-day spread of the wind (lognormal), so a 9 mph month still has the odd 25 mph gale. */
const WIND_SPREAD = 0.6;
/** A wet day isn't a wet game: rain or snow falls during a three-hour window on about this share of wet days. */
const GAME_WINDOW = 0.4;
/** Share of wet games where it starts after kickoff, in the second quarter or later. */
const LATE_START = 0.35;
/** Night kickoffs run about this much colder than afternoon ones (°F). */
const NIGHT_CHILL = 8;
/**
 * A storm front sits over a region about one week in four, doubling the odds of rain or snow and
 * stiffening the wind in all its cities; quiet weeks make up the difference, so each city's season
 * still matches its climate.
 */
const STORM_CHANCE = 0.25;
const STORM_WET = 2;
const STORM_WIND = 1.25;
const calm = (storm: number) => (1 - STORM_CHANCE * storm) / (1 - STORM_CHANCE);
/** Even a blizzard leaves a passing game something: stacked conditions cost at most this share. */
const PASS_CAP = 0.4;
/**
 * The cost of a typical game day, averaged over a season's games and quarters, domes included: what
 * `npm run weather` measures (passing as the geometric mean of what's kept, since costs compound).
 */
export const TYPICAL: WeatherCost = { pass: 0.038, kick: 0.79, fumble: 1.03 };
/** A forecast shows rain or snow at this chance or more as the likely weather. */
const LIKELY = 50;
/** A retractable roof stays shut at this chance of rain or more. */
const ROOF_MAX_CHANCE = 20;

/** Climate month (0 = September … 4 = January) of a week; week 1 is about September 10. */
export const monthOf = (week: number) => [4, 9, 13, 18].filter((w) => week >= w).length;

/** The home stadium that league year; neutral sites (the title game) count as indoors. */
export function stadiumFor(league: League, game: Game): Stadium | undefined {
  if (game.neutral) return undefined;
  const s = STADIUMS[league.teams[game.homeId].abbrev];
  const change = s?.changes?.filter((c) => c.season <= game.season).pop();
  return change ? { ...s, ...change } : s;
}

/**
 * Played after dark: its kickoff (`season/kickoff.ts`: Thursday, Sunday and Monday nights, and the
 * playoffs' night windows). A game from an older save without one: three a regular-season week and
 * half of each playoff round, picked from the seed.
 */
export function isNight(league: League, game: Game): boolean {
  if (game.kickoff) return isPrimeTime(game.kickoff);
  const draw = (g: Game) => new Rng(`${league.seed}:${g.season}:${g.id}:slot`).next();
  const week = league.games
    .filter((g) => g.season === game.season && g.week === game.week)
    .map(draw)
    .sort((a, b) => b - a);
  const slots = game.playoffRound ? Math.ceil(week.length / 2) : 3;
  return week.length > 0 && draw(game) >= week[Math.min(slots, week.length) - 1];
}

/** Most games kick off in the afternoon, near the day's high. */
const kickoffTemp = ([hi, lo]: ClimateMonth) => lo + 0.75 * (hi - lo);
// shortcut: one spread from the temperature (cold months swing more); maritime SEA and SF swing less in reality, give each city its own if it shows.
const tempSpread = (mean: number) => clamp(13 - 0.1 * mean, 4, 10);
const precipAt = (tempF: number): Precip => (tempF <= 34 ? 'snow' : tempF <= 38 ? 'mixed' : 'rain');

/**
 * What the day holds before the dice: the month's climate at kickoff time, and the same with the
 * week's storm front (or quiet) in it. Kickoff time is public; the front shows up a week out.
 */
function setup(league: League, game: Game, stadium: Stadium) {
  const c = CLIMATE[stadium.climate!][monthOf(game.week)];
  const night = isNight(league, game);
  const storm = new Rng(`${league.seed}:${game.season}:${game.week}:storm:${REGIONS[stadium.climate!]}`).chance(
    STORM_CHANCE,
  );
  const wind = c[4] * FIELD_WIND * (stadium.windShelter ?? 1);
  const wet = (c[2] / 30.4) * GAME_WINDOW;
  return {
    c,
    night,
    storm,
    temp: kickoffTemp(c) - (night ? NIGHT_CHILL : 0),
    wind,
    wet,
    stormWind: wind * (storm ? STORM_WIND : calm(STORM_WIND)),
    stormWet: wet * (storm ? STORM_WET : calm(STORM_WET)),
  };
}

/** The open-air weather over the stadium (a closed roof shuts it out). */
function openAir(league: League, game: Game, stadium: Stadium): Weather {
  const rng = new Rng(`${league.seed}:${game.season}:${game.id}:weather`);
  const d = setup(league, game, stadium);
  const tempF = Math.round(rng.normal(d.temp, tempSpread(d.temp)));
  const windMph = Math.round(d.stormWind * Math.exp(rng.normal(-(WIND_SPREAD ** 2) / 2, WIND_SPREAD)));
  const wet = rng.chance(d.stormWet);
  const precip = wet ? precipAt(tempF) : 'none';
  // Rain intensity barely matters; snowy cities get heavy snow far more often.
  const heavy = wet && rng.chance(precip === 'snow' ? clamp(d.c[3] / 25, 0.1, 0.6) : 0.3);
  const onset = wet && rng.chance(LATE_START) ? (rng.int(2, 4) as 2 | 3 | 4) : undefined;
  return {
    roof: stadium.roof === 'retractable' ? 'open' : 'outdoors',
    tempF,
    windMph,
    precip,
    ...(heavy ? { heavy: true as const } : {}),
    ...(onset ? { onset } : {}),
    ...(d.night ? { night: true as const } : {}),
    ...(stadium.altitudeFt ? { altitudeFt: stadium.altitudeFt } : {}),
  };
}

export function gameWeather(league: League, game: Game): Weather {
  const stadium = stadiumFor(league, game);
  if (!stadium?.climate || stadium.roof === 'dome') return INDOORS;
  const air = openAir(league, game, stadium);
  if (stadium.roof === 'outdoors') return air;
  // The home team declares on the short-range forecast; it stays shut if it's already wet at kickoff
  // and shuts when rain comes later. shortcut: a 4th-quarter shower closes it too (the NFL keeps it open after 5:00).
  return roofOpens(stadium, predict(league, game, stadium, air, 'short')) && (air.precip === 'none' || air.onset)
    ? air
    : { ...INDOORS, roof: 'closed' };
}

function roofOpens(stadium: Stadium, f: Forecast): boolean {
  const p = stadium.policy ?? DEFAULT_ROOF_POLICY;
  const temp = (f.tempF[0] + f.tempF[1]) / 2;
  return (
    f.chance < ROOF_MAX_CHANCE && temp >= p.minF && temp <= p.maxF && (f.windMph[0] + f.windMph[1]) / 2 <= p.maxWind
  );
}

/** The conditions in a quarter: dry until the rain or snow starts, and an open roof shuts when it does. */
export function weatherAt(w: Weather, quarter: number): Weather {
  if (!w.onset) return w;
  if (quarter < w.onset) return { ...w, precip: 'none' };
  return w.roof === 'open' ? { ...INDOORS, roof: 'closed' } : w;
}

/**
 * Covers' splits against a calm, mild, dry day: passing falls in steps from 10 mph of wind and
 * faster past 20, about 12% in rain whatever its intensity, 2% in light snow and 25% in heavy, 5% in
 * the cold (8% below 25°F) and 8% in the heat. An 89% kick makes about 77% in 20+ mph wind or heavy
 * snow (six yards longer), about 2% less in the rain; a mile up it carries about four yards farther.
 * Conditions stack, up to PASS_CAP.
 */
export function weatherCost(w: Weather): WeatherCost {
  if (w.roof === 'dome' || w.roof === 'closed') return { pass: 0, kick: 0, fumble: 1 };
  const { tempF: t, windMph: v } = w;
  const wet = w.precip === 'rain' || w.precip === 'mixed';
  const snow = w.precip === 'snow';
  const parts = [
    0.008 * Math.max(0, v - 7) + 0.006 * Math.max(0, v - 18),
    wet ? 0.12 : snow ? (w.heavy ? 0.25 : 0.02) : 0,
    t < 25 ? 0.08 : t < 55 ? 0.05 : t > 85 ? 0.08 : 0,
  ];
  return {
    pass: Math.min(PASS_CAP, 1 - parts.reduce((keep, p) => keep * (1 - p), 1)),
    kick:
      0.8 * Math.max(0, v - 10) +
      (wet ? 2 : snow ? (w.heavy ? 9 : 0.5) : 0) +
      (t < 25 ? 2 : t < 55 ? 0.5 : 0) -
      (w.altitudeFt ?? 0) / 1300,
    fumble: (wet || snow ? (w.heavy ? 1.5 : 1.25) : 1) * (t < 25 ? 1.15 : 1),
  };
}

/**
 * What the match engine applies, against a typical day (a dome comes out a little better): passing as
 * the log of the production ratio, so stacked conditions add up the way the engine's levers do; kicks
 * in yards; fumbles as a ratio. Pass it the conditions of the quarter (`weatherAt`).
 */
export function weatherEffects(w: Weather): WeatherCost {
  const c = weatherCost(w);
  return {
    pass: Math.log((1 - TYPICAL.pass) / (1 - c.pass)),
    kick: c.kick - TYPICAL.kick,
    fumble: c.fumble / TYPICAL.fumble,
  };
}

/**
 * Each snap's energy cost (1 = normal): heat past 85°F drains both sides, thin air the visitors (the
 * home side lives in it). Tired bodies get hurt more, so heat reaches injuries through fatigue.
 */
export function staminaDrain(w: Weather, home: boolean): number {
  const open = w.roof === 'outdoors' || w.roof === 'open';
  return 1 + (open ? 0.02 * Math.max(0, w.tempF - 85) : 0) + (home ? 0 : (w.altitudeFt ?? 0) / 33_000);
}

/** Injury odds on every snap and hit: a little higher on frozen (below 25°F) or waterlogged (heavy rain or snow) turf. */
export function turfRisk(w: Weather): number {
  const open = w.roof === 'outdoors' || w.roof === 'open';
  return open && (w.tempF < 25 || (w.heavy && w.precip !== 'none')) ? 1.1 : 1;
}

const SEVERITIES: Severity[] = ['none', 'light', 'moderate', 'heavy'];
/**
 * The research scale: only 20+ mph wind and heavy snow are heavy. The worst stretch of the game counts,
 * so a storm that blows in late still shows. Cutoffs sit just under each band (costs compound in floating point).
 */
export function severity(w: Weather): Severity {
  const level = (x: Weather) => {
    // Thin air helps kicks; it doesn't make a gale any milder.
    const { pass, kick } = weatherCost({ ...x, altitudeFt: 0 });
    return pass >= 0.199 || kick >= 7.5 ? 3 : pass >= 0.079 ? 2 : pass >= 0.029 ? 1 : 0;
  };
  return SEVERITIES[Math.max(level(weatherAt(w, 1)), level(weatherAt(w, 4)))];
}

// ───────────────────────── forecasts ─────────────────────────

/** outlook: city and month averages (two weeks or more out); extended: next week's game; short: this week's. */
export type ForecastStage = 'outlook' | 'extended' | 'short';

export interface Forecast {
  stage: ForecastStage;
  /** 'tbd' until a retractable roof is declared, this week. */
  roof: Roof | 'tbd';
  tempF: [number, number];
  windMph: [number, number];
  /** What would fall, and the shown chance it does at any point in the game (0–100, in tens). */
  precip: Precip;
  chance: number;
  /** How hard the likely weather hits play. */
  severity: Severity;
  night?: true;
  /** A storm front over the region that week (forecasters see it a week out). */
  storm?: true;
}

/** How far each stage sees: temperature and wind error (one sd), and the noise on its read of rain. */
const STAGES = { extended: { temp: 8, wind: 6, noise: 1 }, short: { temp: 3, wind: 3, noise: 0.45 } };

/**
 * The shown chance is the true posterior of a noisy read of the day (Bayes on the odds the forecaster
 * knows), so a 70% forecast comes true about 70% of the time and the rest stay dry.
 */
function precipChance(prior: number, wet: boolean, noise: number, rng: Rng): number {
  const read = (wet ? 1 : 0) + rng.normal(0, noise);
  const like = (d: number) => Math.exp(-(d * d) / (2 * noise * noise));
  const p = (prior * like(read - 1)) / (prior * like(read - 1) + (1 - prior) * like(read));
  return Math.round(p * 10) * 10;
}

function predict(league: League, game: Game, stadium: Stadium, air: Weather, stage: ForecastStage): Forecast {
  const d = setup(league, game, stadium);
  let temp = d.temp;
  let wind = d.wind;
  let tempErr = 0;
  let windErr = 0;
  let chance = Math.round(d.wet * 10) * 10;
  if (stage !== 'outlook') {
    const s = STAGES[stage];
    const rng = new Rng(`${league.seed}:${game.season}:${game.id}:forecast:${stage}`);
    [temp, wind, tempErr, windErr] = [
      air.tempF + rng.normal(0, s.temp),
      Math.max(0, air.windMph + rng.normal(0, s.wind)),
      s.temp,
      s.wind,
    ];
    chance = precipChance(d.stormWet, air.precip !== 'none', s.noise, rng);
  }
  const likely: Weather = {
    roof: 'outdoors',
    tempF: Math.round(temp),
    windMph: Math.round(wind),
    precip: chance >= LIKELY ? precipAt(temp) : 'none',
  };
  return {
    stage,
    roof: stadium.roof === 'retractable' ? 'tbd' : 'outdoors',
    tempF: [Math.round(temp - tempErr), Math.round(temp + tempErr)],
    windMph: [Math.max(0, Math.round(wind - windErr)), Math.round(wind + windErr)],
    precip: precipAt(temp),
    chance,
    severity: severity(likely),
    ...(d.night ? { night: true as const } : {}),
    ...(stage !== 'outlook' && d.storm ? { storm: true as const } : {}),
  };
}

/** What the user's staff can tell about an unplayed game's weather; null indoors. */
export function forecast(league: League, game: Game): Forecast | null {
  const stadium = stadiumFor(league, game);
  if (!stadium?.climate || stadium.roof === 'dome') return null;
  // Only a season under way has forecasts: in the offseason next year's week 1 is months away.
  const inSeason = game.season === league.season && (league.phase === 'regular' || league.phase === 'playoffs');
  const weeksOut = inSeason ? game.week - league.week : 2;
  const stage: ForecastStage = weeksOut <= 0 ? 'short' : weeksOut === 1 ? 'extended' : 'outlook';
  const f = predict(league, game, stadium, openAir(league, game, stadium), stage);
  if (stage !== 'short' || stadium.roof !== 'retractable') return f;
  // The declared roof; rain that comes anyway still closes it.
  return roofOpens(stadium, f) ? { ...f, roof: 'open' } : { ...f, roof: 'closed', severity: 'none' };
}
