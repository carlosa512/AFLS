import { describe, expect, it } from 'vitest';
import { createLeague } from './generate';
import { CAREER_GAMES, minimumText, periodQualifies, qualifies, RATES, teamGames } from './qualify';
import type { GameResult, League, Player, StatLine } from './types';

/** A fresh league whose clubs have played `n` games each, results written by hand. */
function played(n: number): League {
  const l = createLeague({ seed: 'qualify' });
  const count = new Map<number, number>();
  for (const g of l.games) {
    if (g.playoffRound || g.season !== l.season) continue;
    const h = count.get(g.homeId) ?? 0;
    const a = count.get(g.awayId) ?? 0;
    if (h >= n || a >= n) continue;
    g.result = {} as GameResult;
    count.set(g.homeId, h + 1);
    count.set(g.awayId, a + 1);
  }
  return l;
}
const qb = (l: League): Player => Object.values(l.players).find((p) => p.position === 'QB' && p.teamId !== null)!;
const passing = (l: League, p: Player, line: StatLine) => qualifies(l, p, line, l.season, RATES.passing);

describe('rate-stat minimums', () => {
  it('a 2-for-2 passer never qualifies', () => {
    for (const n of [2, 17]) {
      const l = played(n);
      expect(passing(l, qb(l), { passAtt: 2, passCmp: 2, gp: 1 })).toBe(false);
    }
  });

  it('early season: 28 attempts after two team games, not 27', () => {
    const l = played(2);
    const p = qb(l);
    expect(teamGames(l, p, l.season)).toBe(2);
    expect(passing(l, p, { passAtt: 28, gp: 2 })).toBe(true);
    expect(passing(l, p, { passAtt: 27, gp: 2 })).toBe(false);
  });

  it("is measured against his team's games, not his own", () => {
    const l = played(5);
    expect(passing(l, qb(l), { passAtt: 20, gp: 1 })).toBe(false);
  });

  it('a traded player is measured against the club he finished with', () => {
    const l = played(4);
    const p = qb(l);
    const [a, b] = l.teams.filter((t) => t.id !== p.teamId).map((t) => t.id);
    // Club b has played one game fewer.
    const bGame = l.games.filter((g) => g.result && (g.homeId === b || g.awayId === b)).at(-1)!;
    delete bGame.result;
    p.statTeams = { [l.season]: [a, b] };
    expect(teamGames(l, p, l.season)).toBe(teamGames(l, { ...p, statTeams: { [l.season]: [b] } }, l.season));
    const games = teamGames(l, p, l.season);
    expect(passing(l, p, { passAtt: 14 * games, gp: games })).toBe(true);
    expect(passing(l, p, { passAtt: 14 * games - 1, gp: games })).toBe(false);
  });

  it('a free agent with no club is measured against 17', () => {
    const l = played(3);
    const p = qb(l);
    p.teamId = null;
    delete p.statTeams;
    expect(teamGames(l, p, l.season)).toBe(17);
  });

  it('career needs the total and 64 games', () => {
    const l = played(0);
    const p = qb(l);
    const career = (passAtt: number, gp: number) => qualifies(l, p, { passAtt, gp }, 'career', RATES.passing);
    expect(CAREER_GAMES).toBe(64);
    expect(career(1499, 80)).toBe(false);
    expect(career(1500, 63)).toBe(false);
    expect(career(1500, 64)).toBe(true);
  });

  it('zero volume never qualifies', () => {
    const l = played(0);
    expect(passing(l, qb(l), {})).toBe(false);
  });

  it('a stretch of games asks the per-game minimum for each game he played', () => {
    expect(periodQualifies({ passAtt: 14 }, 1, RATES.passing)).toBe(true);
    expect(periodQualifies({ passAtt: 13 }, 1, RATES.passing)).toBe(false);
    expect(periodQualifies({ passAtt: 56 }, 4, RATES.passing)).toBe(true);
    expect(periodQualifies({}, 0, RATES.passing)).toBe(false);
  });

  it('says its minimum', () => {
    expect(minimumText(RATES.passing, 2026)).toBe('14 att. per team game');
    expect(minimumText(RATES.passing, 'career')).toBe('1,500 att. career');
    expect(minimumText(RATES.rushing, 2026)).toBe('6.25 carries per team game');
    expect(minimumText(RATES.receiving, 'career')).toBe('200 catches career');
  });
});
