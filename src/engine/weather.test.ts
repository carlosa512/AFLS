import { describe, expect, it } from 'vitest';
import { createLeague } from './generate';
import { simulateGame } from './match/gameSim';
import type { Game } from './types';
import { forecast, gameWeather, severity, weatherCost, type Weather } from './weather';

const league = createLeague({ seed: 'test-weather' });
const teamId = (abbrev: string) => league.teams.find((t) => t.abbrev === abbrev)!.id;
const game = (home: string, week: number, season = league.season, id = 9000 + week): Game => ({ id, season, week, homeId: teamId(home), awayId: teamId('SEA') });
const day = (w: Partial<Weather>): Weather => ({ roof: 'outdoors', tempF: 70, windMph: 4, precip: 'none', ...w });

describe('weather', () => {
  it('rolls the same weather for a game every time, and none under a fixed roof or at a neutral site', () => {
    const g = game('GB', 15);
    expect(gameWeather(league, g)).toEqual(gameWeather(league, g));
    expect(gameWeather(league, game('DET', 15)).roof).toBe('dome');
    expect(gameWeather(league, { ...g, neutral: true }).roof).toBe('dome');
    // A mod league's unknown markets play indoors rather than break.
    const mod = { ...league, teams: league.teams.map((t) => ({ ...t, abbrev: `X${t.id}` })) };
    expect(gameWeather(mod, g).roof).toBe('dome');
  });

  it('follows announced stadium changes by season', () => {
    expect(gameWeather(league, game('TEN', 15, 2026)).roof).toBe('outdoors');
    expect(gameWeather(league, game('TEN', 15, 2027)).roof).toBe('dome');
    expect(gameWeather(league, game('KC', 15, 2030)).roof).toBe('outdoors');
    expect(gameWeather(league, game('KC', 15, 2031)).roof).toBe('dome');
  });

  it('makes Green Bay in December cold and Miami in September hot', () => {
    const temps = (home: string, week: number) => Array.from({ length: 60 }, (_, i) => gameWeather(league, game(home, week, league.season, i + 1)).tempF);
    const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    expect(avg(temps('GB', 15))).toBeLessThan(35);
    expect(avg(temps('MIA', 2))).toBeGreaterThan(80);
  });

  it('costs what the research says, stacks, and caps', () => {
    expect(weatherCost(day({ precip: 'rain' })).pass).toBeCloseTo(0.12);
    expect(weatherCost(day({ precip: 'snow', heavy: true })).pass).toBeCloseTo(0.25);
    expect(weatherCost(day({ tempF: 40, precip: 'rain' })).pass).toBeCloseTo(1 - 0.88 * 0.95);
    expect(weatherCost(day({ tempF: 15, windMph: 30, precip: 'snow', heavy: true })).pass).toBe(0.4);
    expect(weatherCost({ ...day({ windMph: 30 }), roof: 'closed' })).toEqual({ pass: 0, kick: 0, fumble: 1 });
    expect(severity(day({ windMph: 22 }))).toBe('heavy');
    expect(severity(day({ precip: 'rain' }))).toBe('moderate');
    expect(severity(day({ tempF: 34, precip: 'snow' }))).toBe('light');
    expect(severity(day({ windMph: 8 }))).toBe('none');
    expect(severity(day({ windMph: 18 }))).toBe('moderate');
    expect(severity(day({ windMph: 20 }))).toBe('heavy');
    expect(severity(day({ tempF: 15 }))).toBe('moderate');
    expect(severity(day({ tempF: 40, precip: 'rain' }))).toBe('moderate');
  });

  it('records the conditions with the result, and a gale shortens the coaches’ field-goal range', () => {
    const g = league.games[0];
    const calm = simulateGame(league, g, { weather: day({}) });
    expect(calm.weather).toEqual(day({}));
    expect(simulateGame(league, g).weather).toEqual(gameWeather(league, g));
    // Coaches read the make chance the engine hands them, so in a gale the long tries dry up.
    const longTries = (w: Weather) =>
      league.games.slice(0, 60).reduce((n, g) => n + (simulateGame(league, g, { weather: w, keepPlays: true }).plays ?? []).filter((p) => /\b(5\d|6\d)-yard field goal/.test(p.text)).length, 0);
    const calmTries = longTries(day({}));
    expect(calmTries).toBeGreaterThan(5);
    expect(longTries(day({ windMph: 25 }))).toBeLessThan(calmTries / 2);
  });

  it('forecasts by weeks out without leaking the truth early', () => {
    const g = game('BUF', 15, league.season, 1234);
    const at = (week: number) => forecast({ ...league, week }, g)!;
    expect(at(10).stage).toBe('outlook');
    expect(at(14).stage).toBe('extended');
    expect(at(15).stage).toBe('short');
    // The offseason belongs to next year's calendar, but its games are months away.
    expect(forecast({ ...league, week: 15, phase: 'draft' }, g)!.stage).toBe('outlook');
    expect(forecast(league, game('DET', 15))).toBeNull();
    // The outlook is the city's averages: another league's truth for the same game shows the same.
    expect(forecast({ ...league, week: 10, seed: 'other' }, g)).toEqual(at(10));
    expect(at(15).tempF[1] - at(15).tempF[0]).toBeLessThan(at(14).tempF[1] - at(14).tempF[0]);
    // A retractable roof is declared only in the week of the game.
    const atl = game('ATL', 6);
    expect(forecast({ ...league, week: 3 }, atl)!.roof).toBe('tbd');
    expect(['open', 'closed']).toContain(forecast({ ...league, week: 6 }, atl)!.roof);
  });
});
