/**
 * How a game's ground looks, read from what anyone can see of the game: the club's building for that season, the
 * turnout from its record, the light from the kickoff, what is falling. Screens only: nothing in the sim reads it.
 */
import type { Game, League } from '../../engine/types';
import { isNight, type Weather } from '../../engine/weather';
import { recordBefore } from '../gameRead';
import { uniformFor } from '../uniform';
import { buildingFor, roofKindOf } from './buildings';
import { FILL, turnoutOf } from './crowd';
import { outsideWeather } from './outside';
import type { Building, Look } from './types';

/** What the picture behind the field needs. */
export interface StadiumView {
  building: Building;
  look: Look;
  colors: [string, string];
  /** Keys the building's draws: the home club. */
  seed: string;
}

/** Snow lies outdoors on a freezing day from this week on (December). */
const DEEP_WINTER = 13;

/** The home club's home games played earlier in that season (regular season only). */
export function homeGamesBefore(league: League, game: Game): number {
  return league.games.filter(
    (g) => g.result && !g.playoffRound && g.season === game.season && g.week < game.week && g.homeId === game.homeId,
  ).length;
}

/**
 * The ground for a game, with the quarter's weather (`weatherAt`). Under a roof the light is the kickoff slot's and the
 * day outside is rolled for show (`outsideWeather`): the game plays such a ground as indoors.
 */
export function gameStadium(league: League, game: Game, weather: Weather): StadiumView {
  const home = league.teams[game.homeId];
  const away = league.teams[game.awayId];
  const own = home.colors as [string, string];
  const building = buildingFor(home.abbrev, game.season, own);
  const roofed = roofKindOf(building) !== 'outdoors';
  const fill = FILL[turnoutOf(recordBefore(league, home.id, game), homeGamesBefore(league, game), !!game.playoffRound)];
  const colors: [string, string] = game.neutral ? [home.colors[0], away.colors[0]] : own;
  // a colour rush or blackout night is a themed night: the crowd wears the jersey the club does
  const worn = game.neutral ? undefined : uniformFor(league, home, game);
  const theme = worn && (worn.set === 'rush' || worn.set === 'blackout') ? worn.kit.jersey : undefined;
  if (roofed) {
    const night = isNight(league, game);
    const out = outsideWeather(String(league.seed), home.abbrev, game.season, game.id, game.week);
    return {
      building,
      colors,
      seed: home.abbrev,
      look: {
        night,
        theme,
        precip: out.precip,
        lying: out.lying,
        roof: weather.roof === 'open' ? 'open' : 'closed',
        fill,
      },
    };
  }
  const snowing = weather.precip === 'snow' || weather.precip === 'mixed';
  return {
    building,
    colors,
    seed: home.abbrev,
    look: {
      night: !!weather.night,
      theme,
      precip: weather.precip,
      lying: snowing || (weather.tempF <= 32 && game.week >= DEEP_WINTER),
      roof: 'none',
      fill,
    },
  };
}

/** A stand-in for a caller with no game to read: the club's building on a clear afternoon, four seats in five taken. */
export function plainView(abbrev: string, colors: [string, string]): StadiumView {
  const building = buildingFor(abbrev, 0, colors);
  return {
    building,
    colors,
    seed: abbrev,
    look: {
      night: false,
      precip: 'none',
      roof: roofKindOf(building) === 'outdoors' ? 'none' : 'closed',
      fill: FILL.even,
    },
  };
}
