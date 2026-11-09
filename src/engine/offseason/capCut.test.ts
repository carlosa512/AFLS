import { describe, expect, it } from 'vitest';
import { capSpace } from '../finance/cap';
import { buildContract } from '../finance/contract';
import { createLeague } from '../generate';
import { simToEndOfSeason } from '../league';
import { setTeam, teamPlayers } from '../roster';
import type { League, Player, Team } from '../types';
import { aiCapCompliance, capCut, KEEP_MIN, twoYearRoom } from './ai';
import { beginOffseason } from './index';

/** A league after one season, at the new league year. */
const base = (() => {
  const l = createLeague({ seed: 'cap-cut' });
  simToEndOfSeason(l);
  beginOffseason(l);
  return JSON.stringify(l);
})();

/** A deal of `years` from `start`, its bonus spread over `years + voids`, nothing guaranteed but `gtd`. */
const deal = (start: number, years: number, total: number, bonus = 0, gtd = 0, voids = 0) =>
  buildContract({ years, total, signingBonus: bonus, guaranteedBase: gtd, voidYears: voids }, start, 'veteran', 1_000);

/**
 * Camp (cuts are post-June 1), one AI club down to its receivers: eight of them, all but two on fully guaranteed
 * one-year deals (a cut of theirs saves nothing), so the cut is between the two the test dresses, equally rated.
 */
function camp(): { l: League; team: Team; a: Player; b: Player; wrs: Player[] } {
  const l: League = JSON.parse(base);
  l.phase = 'preseason';
  const team = l.teams.find((t) => t.id !== l.userTeamId)!;
  for (const p of teamPlayers(l, team.id)) if (p.position !== 'WR') setTeam(l, p, null);
  for (const p of Object.values(l.players).filter((x) => x.position === 'WR' && x.teamId !== null && !x.retired))
    if (teamPlayers(l, team.id).length < KEEP_MIN.WR + 3 && p.teamId !== team.id) setTeam(l, p, team.id);
  const wrs = teamPlayers(l, team.id);
  const [a, b, ...rest] = wrs;
  for (const p of rest) p.contract = deal(l.season, 1, 5_000, 0, 5_000);
  b.ratings = { ...a.ratings };
  // A plain last year: $10M this season, nothing after.
  b.contract = deal(l.season - 1, 2, 20_000);
  b.contract.years[0].base = 10_000;
  b.contract.years[1].base = 10_000;
  return { l, team, a, b, wrs };
}

/**
 * A deal whose cut saves more this year than the plain one but books next year more than it removes: a $50M bonus
 * over five years (two of them void), $15M base this season, $1M next.
 */
function burner(l: League, p: Player): void {
  p.contract = deal(l.season - 1, 3, 53_000, 50_000, 0, 2);
  p.contract.years[0].base = 1_000;
  p.contract.years[1].base = 15_000;
  p.contract.years[2].base = 1_000;
}

describe('the cap cut counts next year', () => {
  it('ranks a cut that makes next year worse below one that does not', () => {
    const { l, team, a, b } = camp();
    burner(l, a);
    // The scene as described: today's rule would take him (more saved now, same rating), two years say no.
    expect(twoYearRoom(l, a).now).toBeGreaterThan(twoYearRoom(l, b).now);
    expect(twoYearRoom(l, a).twoYear).toBeLessThan(0);
    expect(twoYearRoom(l, b).twoYear).toBeGreaterThan(0);
    expect(capCut(l, team)?.id).toBe(b.id);
  });

  it('spares a man signed this league year while anyone else frees room', () => {
    const { l, team, a, b } = camp();
    // Signed this league year at $30M for one season: the best ratio on the roster by today's rule.
    a.contract = deal(l.season, 1, 30_000);
    expect(twoYearRoom(l, a).twoYear).toBeGreaterThan(twoYearRoom(l, b).twoYear);
    expect(capCut(l, team)?.id).toBe(b.id);
  });

  it('desperate, it takes a fresh or next-year-worse man when nothing else is left', () => {
    const { l, team, a, b } = camp();
    burner(l, a);
    b.contract = deal(l.season, 1, 30_000);
    expect(capCut(l, team)).toBeNull();
    expect([a.id, b.id]).toContain(capCut(l, team, true)?.id);
  });

  it('a club over the cap with only bad cuts still gets legal', () => {
    const { l, team, a, b } = camp();
    burner(l, a);
    b.contract = deal(l.season, 1, 30_000);
    team.carryover -= capSpace(l, team.id) + 5_000;
    expect(capSpace(l, team.id)).toBeLessThan(0);
    aiCapCompliance(l, team);
    expect(capSpace(l, team.id)).toBeGreaterThanOrEqual(0);
  });
});
