/** A GM's cap books (`docs/superpowers/specs/2026-11-18-multi-year-cap-books-design.md`): three years ahead. */
import { describe, expect, it } from 'vitest';
import { capFor, capSheet } from '../finance/cap';
import { lastSeason } from '../finance/contract';
import { leagueMarket, marketApy } from '../finance/market';
import { createLeague } from '../generate';
import { teamPlayers } from '../roster';
import type { League, Player, Team } from '../types';
import { inPlans } from './ai';
import { BOOKS, capBooks, fits, minRoom } from './capBooks';

const base = JSON.stringify(createLeague({ seed: 'cap-books' }));
const fresh = (): League => JSON.parse(base);
const AI = 9;

/** A starter the club plans to keep whose deal runs past `s+1`, cut back to end at `end`. */
function keeperEnding(l: League, team: Team, end: number): Player {
  const s = l.season;
  const p = teamPlayers(l, team.id).find(
    (x) => x.contract && lastSeason(x.contract) >= s + 2 && x.contract.kind !== 'rookie' && inPlans(l, team, x),
  )!;
  p.contract!.years = p.contract!.years.filter((y) => y.season <= end);
  p.contract!.bonuses = [];
  return p;
}

describe('a GM’s cap books', () => {
  it('commits what the cap sheet says each year', () => {
    const l = fresh();
    const books = capBooks(l, l.teams[AI]);
    expect(books.years).toHaveLength(BOOKS.horizon);
    books.years.forEach((y, i) => {
      expect(y.season).toBe(l.season + 1 + i);
      expect(y.committed).toBe(capSheet(l, AI, l.season + 1 + i).used);
      expect(y.cap).toBe(capFor(l, l.season + 1 + i));
    });
  });

  it('keeps more of each later year free, and the soft limit does not fade', () => {
    const books = capBooks(fresh(), fresh().teams[AI]);
    const share = (i: number) => books.years[i].limit / books.years[i].cap;
    expect(share(1)).toBeCloseTo(share(0) - BOOKS.fade, 6);
    expect(share(2)).toBeCloseTo(share(0) - 2 * BOOKS.fade, 6);
    for (const y of books.years) expect(y.softLimit / y.cap).toBeCloseTo(share(0), 6);
  });

  it('counts a keeper whose deal ends this year in every year, at his price on that year’s cap', () => {
    const l = fresh();
    const team = l.teams[AI];
    const p = keeperEnding(l, team, l.season);
    const books = capBooks(l, team);
    const price = marketApy(leagueMarket(l), p);
    books.years.forEach((y) => expect(y.keepers[p.id]).toBeCloseTo((price * y.cap) / capFor(l, l.season), 0));
  });

  it('leaves a deal that ends later to later: his spot counts at the minimum, not his price', () => {
    const l = fresh();
    const team = l.teams[AI];
    const p = keeperEnding(l, team, l.season + 1);
    for (const y of capBooks(l, team).years) expect(y.keepers[p.id]).toBeUndefined();
  });

  it('counts every spot on the 53 once: under contract, kept, drafted, or a minimum deal', () => {
    const l = fresh();
    const team = l.teams[AI];
    keeperEnding(l, team, l.season);
    const roster = teamPlayers(l, AI).filter((p) => p.contract && !p.squad && !p.waiver);
    for (const y of capBooks(l, team).years) {
      const contracted = roster.filter((p) => lastSeason(p.contract!) >= y.season).length;
      const picks = l.draftPicks.filter(
        (d) => d.season === y.season && d.ownerId === AI && d.playerId === undefined,
      ).length;
      const kept = Object.keys(y.keepers).length;
      expect(y.spots).toBe(Math.max(0, 53 - contracted - kept - picks));
      for (const id of Object.keys(y.keepers))
        expect(lastSeason(l.players[Number(id)].contract!)).toBeLessThan(y.season);
    }
  });

  it('counts a typical class for a year with no picks on file, and none for a club that traded its own', () => {
    const l = fresh();
    const team = l.teams[AI];
    const s3 = l.season + 3;
    const before = capBooks(l, team).years[2].needed;
    const theirs = l.draftPicks.filter((d) => d.season === s3 && d.ownerId === AI);
    for (const d of theirs) d.ownerId = (AI + 1) % 32;
    const traded = capBooks(l, team).years[2].needed;
    expect(traded).toBeLessThan(before);
    l.draftPicks = l.draftPicks.filter((d) => d.season !== s3);
    expect(capBooks(l, team).years[2].needed).toBeCloseTo(before, -2);
  });

  it('lands money past the horizon on its last year', () => {
    const l = fresh();
    // Room in every year of the books (a generated league's clubs open with next year spoken for).
    for (let k = 1; k <= 3; k++)
      l.teams[AI].deadMoney.push({
        season: l.season + k,
        amount: -Math.round(0.3 * capFor(l, l.season + k)),
        playerId: -1,
        note: 'test',
      });
    const books = capBooks(l, l.teams[AI]);
    const last = books.years[2].room;
    expect(books.years[0].room).toBeGreaterThan(0);
    expect(books.years[1].room).toBeGreaterThan(0);
    for (const x of [last + 1, last - 1]) expect(fits(books, [0, 0, 0, x])).toBe(fits(books, [0, 0, x]));
    expect(fits(books, [0, 0, 0, last + 1])).toBe(false);
    expect(fits(books, [0, 0, 0, last - 1])).toBe(true);
  });

  it('reads a club past its books as having no room, and adds nothing to it', () => {
    const l = fresh();
    const team = l.teams[AI];
    team.deadMoney.push({
      season: l.season + 1,
      amount: Math.round(1.2 * capFor(l, l.season + 1)),
      playerId: -1,
      note: 'test',
    });
    const books = capBooks(l, team);
    expect(minRoom(books)).toBeLessThan(0);
    expect(fits(books, [1])).toBe(false);
    expect(fits(books, [])).toBe(true);
  });
});
