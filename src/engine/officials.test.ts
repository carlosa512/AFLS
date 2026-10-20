import { describe, expect, it } from 'vitest';
import { createLeague, SAVE_VERSION } from './generate';
import { gamesInWeek, playWeek } from './league';
import { simulateGame } from './match/gameSim';
import { migrateLeague } from './migrate';
import type { AwardWinner } from './awards';
import {
  CREW_COUNT,
  crewAssignments,
  crewMult,
  crewsNewYear,
  crewStanding,
  crewTable,
  gameCrew,
  MAX_DRIFT,
  RANK_MIN_GAMES,
  STAR_LEAN,
  starLean,
} from './officials';
import { FOUL_KINDS } from './penalties';
import type { Crew, League } from './types';

const TENDENCIES = ['flagVolume', 'holding', 'coverage', 'qbProtection'] as const;
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

describe('officiating crews', () => {
  it('turns a tendency into a multiplier from 0.8 to 1.2, 1 at the centre', () => {
    expect(crewMult(1)).toBeCloseTo(0.8, 9);
    expect(crewMult(20)).toBeCloseTo(1.2, 9);
    expect(crewMult(10.5)).toBeCloseTo(1, 9);
  });

  it('generates seventeen named crews, centred on every tendency', () => {
    const league = createLeague({ seed: 'crews-gen' });
    expect(league.crews).toHaveLength(CREW_COUNT);
    expect(new Set(league.crews.map((c) => c.lastName)).size).toBe(CREW_COUNT);
    league.crews.forEach((c, i) => expect(c.id).toBe(i));
    for (const t of TENDENCIES) {
      const values = league.crews.map((c) => c[t]);
      expect(Math.min(...values)).toBeGreaterThanOrEqual(1);
      expect(Math.max(...values)).toBeLessThanOrEqual(20);
      expect(mean(values)).toBeGreaterThanOrEqual(10);
      expect(mean(values)).toBeLessThanOrEqual(11);
      // Strict and lenient crews both, never a league of one kind.
      expect(Math.max(...values) - Math.min(...values)).toBeGreaterThanOrEqual(10);
    }
    expect(createLeague({ seed: 'crews-gen' }).crews).toEqual(league.crews);
  });

  it('nudges each tendency by at most two points a year and keeps the crews centred', () => {
    const league = createLeague({ seed: 'crews-drift' });
    let moved = 0;
    for (let y = 0; y < 20; y++) {
      const before = league.crews.map((c) => ({ ...c }));
      league.season++;
      crewsNewYear(league);
      for (const t of TENDENCIES) {
        league.crews.forEach((c, i) => {
          expect(Math.abs(c[t] - before[i][t])).toBeLessThanOrEqual(MAX_DRIFT);
          expect(c[t]).toBeGreaterThanOrEqual(1);
          expect(c[t]).toBeLessThanOrEqual(20);
          if (c[t] !== before[i][t]) moved++;
        });
        expect(mean(league.crews.map((c) => c[t]))).toBeGreaterThanOrEqual(10);
        expect(mean(league.crews.map((c) => c[t]))).toBeLessThanOrEqual(11);
      }
    }
    expect(moved).toBeGreaterThan(0);
  });

  it('rotates the crews: sixteen games each, never two in a week, shown the same every time', () => {
    const league = createLeague({ seed: 'crews-rotation' });
    const assigned = crewAssignments(league, league.season);
    const regular = league.games.filter((g) => g.season === league.season);
    expect(assigned.size).toBe(regular.length);
    const worked = new Map<number, number>();
    for (const week of new Set(regular.map((g) => g.week))) {
      const crews = gamesInWeek(league, week).map((g) => assigned.get(g.id)!);
      expect(new Set(crews).size).toBe(crews.length);
      for (const id of crews) worked.set(id, (worked.get(id) ?? 0) + 1);
    }
    expect(Math.max(...worked.values()) - Math.min(...worked.values())).toBeLessThanOrEqual(1);
    expect(gameCrew(league, regular[0])).toBe(league.crews[assigned.get(regular[0].id)!]);
  });

  it('records the crew and every flag by kind, and a strict crew calls more than a lenient one', () => {
    const league = createLeague({ seed: 'crews-sim' });
    const games = league.games.filter((g) => g.week <= 3);
    const crew = (n: number): Crew => ({
      id: 0,
      firstName: 'Test',
      lastName: 'Crew',
      flagVolume: n,
      holding: n,
      coverage: n,
      qbProtection: n,
    });
    let strict = 0;
    let lenient = 0;
    for (const g of games) {
      const own = simulateGame(league, g);
      expect(own.crewId).toBe(gameCrew(league, g)!.id);
      for (const side of [own.home, own.away])
        expect(FOUL_KINDS.reduce((s, f) => s + (side.flags?.[f] ?? 0), 0)).toBe(side.penalties);
      for (const [n, add] of [
        [20, (x: number) => (strict += x)],
        [1, (x: number) => (lenient += x)],
      ] as const) {
        const r = simulateGame(league, g, { crew: crew(n) });
        add(r.home.penalties + r.away.penalties);
      }
    }
    // Both ends of every tendency: 1.2 × 1.2 on holding and coverage against 0.8 × 0.8.
    expect(strict / lenient).toBeGreaterThan(1.3);
    expect(simulateGame(league, games[0], { crew: null }).crewId).toBeUndefined();
  });

  it('ranks crews only once they have worked enough games', () => {
    const league = createLeague({ seed: 'crews-ranks' });
    for (let w = 1; w < RANK_MIN_GAMES; w++) playWeek(league);
    expect(crewTable(league, league.season).ranked).toBe(0);
    expect(crewStanding(league, league.crews[0], league.season)).toBeNull();
    playWeek(league);
    const { rows, ranked } = crewTable(league, league.season);
    expect(ranked).toBeGreaterThan(0);
    for (const r of rows) {
      if (r.games < RANK_MIN_GAMES) expect(r.ranks).toBeNull();
      else expect(r.ranks!.flags).toBeGreaterThanOrEqual(1);
    }
    const first = rows.find((r) => r.ranks?.flags === 1)!;
    expect(first.perGame.flags).toBe(Math.max(...rows.filter((r) => r.ranks).map((r) => r.perGame.flags)));
    expect(crewStanding(league, first.crew, league.season)).toEqual({ rank: 1, of: ranked, season: league.season });
  });

  it('leans toward the most decorated quarterbacks, from their public record only', () => {
    const league = createLeague({ seed: 'crews-stars' });
    const qb = league.teams[0].depthChart.QB[0];
    expect(starLean(league, qb)).toBe(1);
    const season = (mvp: boolean, team: 0 | 1 | null) => ({
      season: 2000 + league.awards.length,
      winners: mvp ? { mvp: { playerId: qb, teamId: 0 } } : {},
      allLeague: [team === 0 ? [{ playerId: qb, teamId: 0 }] : [], team === 1 ? [{ playerId: qb, teamId: 0 }] : []] as [
        AwardWinner[],
        AwardWinner[],
      ],
    });
    league.awards.push(season(false, 1));
    expect(starLean(league, qb)).toBeCloseTo(1 + STAR_LEAN / 10, 9);
    // Two MVPs with first-team nods: a Mahomes, as protected as anyone gets.
    league.awards.push(season(true, 0), season(true, 0));
    expect(starLean(league, qb)).toBeCloseTo(1 + STAR_LEAN, 9);
    league.awards.push(season(true, 0));
    expect(starLean(league, qb)).toBeCloseTo(1 + STAR_LEAN, 9);
  });

  it('gives a v16 save QB Protection as a new league from its seed would roll it', () => {
    const league = createLeague({ seed: 'crews-qb-protection' });
    const v16 = JSON.parse(JSON.stringify(league)) as League;
    v16.version = 16;
    for (const c of v16.crews) delete (c as Partial<Crew>).qbProtection;
    const up = migrateLeague(v16)!;
    expect(up.version).toBe(SAVE_VERSION);
    expect(up.crews).toEqual(league.crews);
  });

  it('gives an old save the crews a new league would get, starting with its next game', () => {
    const league = createLeague({ seed: 'crews-migrate' });
    const v14 = JSON.parse(JSON.stringify(league)) as League;
    v14.version = 14;
    delete (v14 as Partial<League>).crews;
    const up = migrateLeague(v14)!;
    expect(up.version).toBe(SAVE_VERSION);
    expect(up.crews).toEqual(league.crews);
  });
});
