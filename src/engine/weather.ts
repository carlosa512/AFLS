/**
 * Weather: real roofs, real climates, and what a day outdoors does to a game.
 *
 * A game's weather is a pure function of the league seed, season and game id, so nothing is stored
 * until it's played (the result keeps it for the box score) and reloading can't reroll a storm. It
 * draws from its own streams, never the game's, and forecasts from theirs, so looking at a forecast
 * changes nothing. Effects are measured against a typical NFL day (`TYPICAL`): a dome plays a little
 * better than average and a December gale a lot worse, so league totals stay where they were.
 */
import { CLIMATE, DEFAULT_ROOF_POLICY, STADIUMS, type ClimateMonth, type Stadium } from './data/stadiums';
import { clamp, Rng } from './rng';
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
/** Even a blizzard leaves a passing game something: stacked conditions cost at most this share. */
const PASS_CAP = 0.4;
/**
 * The cost of a typical game day, averaged over a season's games, domes included: what `npm run weather`
 * measures (passing as the geometric mean of what's kept, since costs compound).
 */
export const TYPICAL: WeatherCost = { pass: 0.038, kick: 0.81, fumble: 1.03 };
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

const climateOf = (stadium: Stadium, game: Game): ClimateMonth => CLIMATE[stadium.climate!][monthOf(game.week)];
/** Most games kick off in the afternoon, near the day's high. */
const kickoffTemp = ([hi, lo]: ClimateMonth) => lo + 0.75 * (hi - lo);
// shortcut: one spread from the temperature (cold months swing more); maritime SEA and SF swing less in reality, give each city its own if it shows.
const tempSpread = (mean: number) => clamp(13 - 0.1 * mean, 4, 10);
const meanWind = (stadium: Stadium, c: ClimateMonth) => c[4] * FIELD_WIND * (stadium.windShelter ?? 1);
/** Chance of rain or snow during a game, from the month's wet days. */
const wetChance = (c: ClimateMonth) => (c[2] / 30.4) * GAME_WINDOW;
const precipAt = (tempF: number): Precip => (tempF <= 34 ? 'snow' : tempF <= 38 ? 'mixed' : 'rain');

/** The open-air weather over the stadium at kickoff (a closed roof shuts it out). */
function openAir(league: League, game: Game, stadium: Stadium): Weather {
  const rng = new Rng(`${league.seed}:${game.season}:${game.id}:weather`);
  const c = climateOf(stadium, game);
  const mean = kickoffTemp(c);
  const tempF = Math.round(rng.normal(mean, tempSpread(mean)));
  const windMph = Math.round(meanWind(stadium, c) * Math.exp(rng.normal(-(WIND_SPREAD ** 2) / 2, WIND_SPREAD)));
  const wet = rng.chance(wetChance(c));
  const precip = wet ? precipAt(tempF) : 'none';
  // Rain intensity barely matters; snowy cities get heavy snow far more often.
  const heavy = wet && rng.chance(precip === 'snow' ? clamp(c[3] / 25, 0.1, 0.6) : 0.3);
  return { roof: stadium.roof === 'retractable' ? 'open' : 'outdoors', tempF, windMph, precip, ...(heavy ? { heavy: true as const } : {}) };
}

export function gameWeather(league: League, game: Game): Weather {
  const stadium = stadiumFor(league, game);
  if (!stadium?.climate || stadium.roof === 'dome') return INDOORS;
  const air = openAir(league, game, stadium);
  if (stadium.roof === 'outdoors') return air;
  // The home team declares on the short-range forecast; rain on an open roof closes it.
  // shortcut: the whole game counts as closed, not just the drives after it shuts.
  return roofOpens(stadium, predict(league, game, stadium, air, 'short')) && air.precip === 'none' ? air : { ...INDOORS, roof: 'closed' };
}

function roofOpens(stadium: Stadium, f: Forecast): boolean {
  const p = stadium.policy ?? DEFAULT_ROOF_POLICY;
  const temp = (f.tempF[0] + f.tempF[1]) / 2;
  return f.chance < ROOF_MAX_CHANCE && temp >= p.minF && temp <= p.maxF && (f.windMph[0] + f.windMph[1]) / 2 <= p.maxWind;
}

/**
 * Covers' splits against a calm, mild, dry day: passing falls in steps from 10 mph of wind and
 * faster past 20, about 12% in rain whatever its intensity, 2% in light snow and 25% in heavy, 5% in
 * the cold (8% below 25°F) and 8% in the heat. An 89% kick makes about 77% in 20+ mph wind or heavy
 * snow (six yards longer), about 2% less in the rain. Conditions stack, up to PASS_CAP.
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
    kick: 0.8 * Math.max(0, v - 10) + (wet ? 1 : snow ? (w.heavy ? 9 : 0.5) : 0) + (t < 25 ? 2 : t < 55 ? 0.5 : 0),
    fumble: (wet || snow ? (w.heavy ? 1.5 : 1.25) : 1) * (t < 25 ? 1.15 : 1),
  };
}

/**
 * What the match engine applies, against a typical day (a dome comes out a little better): passing as
 * the log of the production ratio, so stacked conditions add up the way the engine's levers do; kicks
 * in yards; fumbles as a ratio.
 */
export function weatherEffects(w: Weather): WeatherCost {
  const c = weatherCost(w);
  return { pass: Math.log((1 - TYPICAL.pass) / (1 - c.pass)), kick: c.kick - TYPICAL.kick, fumble: c.fumble / TYPICAL.fumble };
}

/** The research scale: only 20+ mph wind and heavy snow are heavy. Cutoffs sit just under each band (costs compound in floating point). */
export function severity(w: Weather): Severity {
  const { pass, kick } = weatherCost(w);
  return pass >= 0.199 || kick >= 7.5 ? 'heavy' : pass >= 0.079 ? 'moderate' : pass >= 0.029 ? 'light' : 'none';
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
  /** What would fall, and the shown chance it does (0–100, in tens). */
  precip: Precip;
  chance: number;
  /** How hard the likely weather hits play. */
  severity: Severity;
}

/** How far each stage sees: temperature and wind error (one sd), and the noise on its read of rain. */
const STAGES = { extended: { temp: 8, wind: 6, noise: 1 }, short: { temp: 3, wind: 3, noise: 0.45 } };

/**
 * The shown chance is the true posterior of a noisy read of the day (Bayes on the climate odds), so
 * a 70% forecast comes true about 70% of the time and the rest stay dry.
 */
function precipChance(prior: number, wet: boolean, noise: number, rng: Rng): number {
  const read = (wet ? 1 : 0) + rng.normal(0, noise);
  const like = (d: number) => Math.exp(-(d * d) / (2 * noise * noise));
  const p = (prior * like(read - 1)) / (prior * like(read - 1) + (1 - prior) * like(read));
  return Math.round(p * 10) * 10;
}

function predict(league: League, game: Game, stadium: Stadium, air: Weather, stage: ForecastStage): Forecast {
  const c = climateOf(stadium, game);
  let temp = kickoffTemp(c);
  let wind = meanWind(stadium, c);
  let tempErr = 0;
  let windErr = 0;
  let chance = Math.round(wetChance(c) * 10) * 10;
  if (stage !== 'outlook') {
    const s = STAGES[stage];
    const rng = new Rng(`${league.seed}:${game.season}:${game.id}:forecast:${stage}`);
    [temp, wind, tempErr, windErr] = [air.tempF + rng.normal(0, s.temp), Math.max(0, air.windMph + rng.normal(0, s.wind)), s.temp, s.wind];
    chance = precipChance(wetChance(c), air.precip !== 'none', s.noise, rng);
  }
  const likely: Weather = { roof: 'outdoors', tempF: Math.round(temp), windMph: Math.round(wind), precip: chance >= LIKELY ? precipAt(temp) : 'none' };
  return {
    stage,
    roof: stadium.roof === 'retractable' ? 'tbd' : 'outdoors',
    tempF: [Math.round(temp - tempErr), Math.round(temp + tempErr)],
    windMph: [Math.max(0, Math.round(wind - windErr)), Math.round(wind + windErr)],
    precip: precipAt(temp),
    chance,
    severity: severity(likely),
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
  // The declared roof; rain that comes anyway still closes it at kickoff.
  return roofOpens(stadium, f) ? { ...f, roof: 'open' } : { ...f, roof: 'closed', severity: 'none' };
}
