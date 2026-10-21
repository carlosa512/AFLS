import { describe, expect, it } from 'vitest';
import { createLeague } from '../generate';
import { playWeek } from '../league';
import { migrateLeague } from '../migrate';
import type { Game, League } from '../types';
import { flexWeek } from './flex';
import { isPrimeTime, SUNDAY_NIGHT } from './kickoff';
import { REGULAR_SEASON_WEEKS } from './schedule';

describe('flexible scheduling', () => {
  const league = createLeague({ seed: 'flex' });
  const scheduled = new Map(league.games.map((g) => [g.id, { ...g.kickoff! }]));
  while (league.phase === 'regular') playWeek(league);
  const games = league.games.filter((g) => g.season === league.season && !g.playoffRound);
  const moved = (g: Game) => g.kickoff!.day !== scheduled.get(g.id)!.day || g.kickoff!.et !== scheduled.get(g.id)!.et;
  const plays = (g: Game, t: number) => g.homeId === t || g.awayId === t;

  it('moves a few games into prime time, inside the NFL’s windows and caps, remembering where they were', () => {
    const flexedIn = games.filter((g) => g.week < REGULAR_SEASON_WEEKS && moved(g) && isPrimeTime(g.kickoff!));
    expect(flexedIn.length).toBeGreaterThan(0);
    expect(flexedIn.length).toBeLessThanOrEqual(10);
    for (const g of games.filter(moved)) expect(g.flexed).toEqual(scheduled.get(g.id));
    for (const g of flexedIn) {
      if (g.kickoff!.day === 'sun') expect(g.week).toBeGreaterThanOrEqual(5);
      if (g.kickoff!.day === 'mon') expect(g.week).toBeGreaterThanOrEqual(12);
      if (g.kickoff!.day === 'thu') expect(g.week).toBeGreaterThanOrEqual(13);
    }
    expect(flexedIn.filter((g) => g.kickoff!.day === 'sun' && g.week <= 10).length).toBeLessThanOrEqual(2);
    expect(flexedIn.filter((g) => g.kickoff!.day === 'thu').length).toBeLessThanOrEqual(2);
  });

  it('never gives a team a short week, and no more than seven night games', () => {
    for (const g of games.filter((x) => x.kickoff!.day === 'thu')) {
      for (const t of [g.homeId, g.awayId])
        expect(games.find((p) => p.week === g.week - 1 && plays(p, t))?.kickoff!.day).not.toBe('mon');
    }
    for (const team of league.teams)
      expect(games.filter((g) => plays(g, team.id) && isPrimeTime(g.kickoff!)).length).toBeLessThanOrEqual(7);
  });

  it('sets week 18 once week 17 is played: Sunday night and a Saturday doubleheader', () => {
    const last = games.filter((g) => g.week === REGULAR_SEASON_WEEKS);
    expect(last.filter((g) => g.kickoff!.day === 'sun' && isPrimeTime(g.kickoff!))).toHaveLength(1);
    expect(last.filter((g) => g.kickoff!.day === 'sat')).toHaveLength(2);
  });

  it('keeps week 18 from putting a team past seven night games', () => {
    // Week 17 played: the league sets week 18. Teams in its two night games first, then the same league with
    // those teams already at seven nights through week 17 (the cap, a flex's included).
    const fresh = createLeague({ seed: 'flex-cap' });
    fresh.week = REGULAR_SEASON_WEEKS;
    const regular = (l: League) => l.games.filter((g) => g.season === l.season && !g.playoffRound);
    const nights = (l: League, id: number) =>
      regular(l).filter((g) => g.week < REGULAR_SEASON_WEEKS && plays(g, id) && isPrimeTime(g.kickoff!)).length;
    const finalGame = (l: League, id: number) =>
      regular(l).find((g) => g.week === REGULAR_SEASON_WEEKS && plays(g, id))!;

    const open = structuredClone(fresh);
    flexWeek(open);
    const lit = regular(open).filter((g) => g.week === REGULAR_SEASON_WEEKS && isPrimeTime(g.kickoff!));
    expect(lit.length).toBeGreaterThan(0);

    const capped = structuredClone(fresh);
    for (const id of lit.flatMap((g) => [g.homeId, g.awayId]))
      for (const g of regular(capped).filter(
        (g) => g.week < REGULAR_SEASON_WEEKS && plays(g, id) && !isPrimeTime(g.kickoff!),
      ))
        if (nights(capped, id) < 7) g.kickoff = { ...SUNDAY_NIGHT };
    const full = capped.teams.filter((t) => nights(capped, t.id) >= 7).map((t) => t.id);
    expect(full.length).toBeGreaterThanOrEqual(lit.length * 2);
    flexWeek(capped);
    for (const id of full) expect(isPrimeTime(finalGame(capped, id).kickoff!)).toBe(false);
    // The games still get their night slots, with the teams that have the room.
    expect(regular(capped).filter((g) => g.week === REGULAR_SEASON_WEEKS && isPrimeTime(g.kickoff!)).length).toBe(
      lit.length,
    );
  });

  it('gives the playoffs the NFL’s windows', () => {
    const wildCard = league.games.filter((g) => g.playoffRound === 'WC');
    expect(wildCard.map((g) => g.kickoff!.day).sort()).toEqual(['mon', 'sat', 'sat', 'sun', 'sun', 'sun']);
  });

  it('gives an older save this season’s kickoffs (v30)', () => {
    const old = JSON.parse(JSON.stringify(league)) as League;
    old.version = 29;
    for (const g of old.games) {
      delete g.kickoff;
      delete g.flexed;
    }
    const up = migrateLeague(old)!;
    expect(up.games.filter((g) => g.season === up.season).every((g) => g.kickoff)).toBe(true);
  });
});
