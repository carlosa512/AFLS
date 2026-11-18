/** A GM's cap books (`docs/superpowers/specs/2026-11-18-multi-year-cap-books-design.md`): three years ahead. */
import { describe, expect, it } from 'vitest';
import { capFor, capSheet, restructureOptions } from '../finance/cap';
import { lastSeason, yearsLeft } from '../finance/contract';
import { leagueMarket, marketApy } from '../finance/market';
import { createLeague } from '../generate';
import { setTeam, teamPlayers } from '../roster';
import { simToEndOfSeason } from '../league';
import type { League, Player, Team } from '../types';
import {
  aiExtendEarly,
  applyFranchiseTag,
  clubDeals,
  depthOutlooks,
  expiringPlayers,
  fillReserve,
  inPlans,
  inSeasonReserve,
  restructurePlan,
  SPEND_FIRST,
  spendable,
  tagValue,
  tryTag,
} from './ai';
import { beginOffseason } from './index';
import { playerOvr } from '../positions';
import { BOOKS, capBooks, commit, dealAdds, fits, minRoom, shapeToBooks } from './capBooks';
import type { Offer } from './negotiation';

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

describe('restructures read the books', () => {
  /** A club in its re-sign window with room next year and `later` of each later year's cap free. */
  function squeezedLater(later: number) {
    const l = fresh();
    l.phase = 'resign';
    const team = l.teams[AI];
    const set = (k: number, share: number) => {
      const y = capBooks(l, team).years[k - 1];
      team.deadMoney.push({ season: y.season, amount: Math.round(y.room - share * y.cap), playerId: -1, note: 'test' });
    };
    set(1, 0.15);
    set(2, later);
    set(3, later);
    return { l, team };
  }

  /** The books after a plan's steps, each spreading its added charge over its deal's later years. */
  function afterPlan(l: League, team: Team, plan: ReturnType<typeof restructurePlan>) {
    const books = capBooks(l, team);
    for (const { p, amount } of plan.steps) {
      const o = restructureOptions(l, p, amount);
      commit(books, new Array(Math.max(0, o.years - 1)).fill(o.addedPerYear));
    }
    return books;
  }

  it('never leaves a year of the books short', () => {
    const { l, team } = squeezedLater(0.01);
    const plan = restructurePlan(l, team, 1e9);
    expect(plan.steps.length).toBeGreaterThan(0);
    for (const y of afterPlan(l, team, plan).years) expect(y.room).toBeGreaterThanOrEqual(-1);
  });

  it('restructures nothing for a club past its books in a later year', () => {
    const l = fresh();
    l.phase = 'resign';
    const team = l.teams[AI];
    const y2 = l.season + 2;
    team.deadMoney.push({ season: y2, amount: Math.round(1.2 * capFor(l, y2)), playerId: -1, note: 'test' });
    expect(restructurePlan(l, team, 1e9).steps).toEqual([]);
  });

  it('reads a plan without spending the books it read', () => {
    const { l, team } = squeezedLater(0.05);
    const books = capBooks(l, team);
    const before = JSON.stringify(books);
    restructurePlan(l, team, 1e9, { room: { deals: clubDeals(l, team), books } });
    expect(JSON.stringify(books)).toBe(before);
  });
});

describe('offers fit the books', () => {
  /** A club in its re-sign window whose books show `rooms[k]` of each later year's cap free (hard room). */
  function withRooms(rooms: [number, number, number]) {
    const l = fresh();
    l.phase = 'resign';
    const team = l.teams[AI];
    rooms.forEach((share, k) => {
      const y = capBooks(l, team).years[k];
      team.deadMoney.push({ season: y.season, amount: Math.round(y.room - share * y.cap), playerId: -1, note: 'test' });
    });
    return { l, team, books: capBooks(l, team) };
  }
  /** Another club's starter, as a free agent to this one. */
  const outsider = (l: League) => teamPlayers(l, (AI + 1) % 32).find((p) => p.contract && p.position === 'WR')!;
  const star = (l: League): Offer => ({
    years: 3,
    apy: Math.round(0.06 * l.caps[l.season]),
    bonusPct: 0.5,
    gtdPct: 0.5,
    voidYears: 1,
  });

  it('leaves an offer that fits as it is', () => {
    const { l, team, books } = withRooms([0.3, 0.3, 0.3]);
    const offer = star(l);
    expect(shapeToBooks(l, team, outsider(l), offer, books)).toEqual(offer);
  });

  it('gives up the void year first, then years, until the deal fits', () => {
    // The void year's bonus money lands on s+3 alone: with no room there, it goes and the rest is untouched.
    let x = withRooms([0.3, 0.3, 0.0005]);
    expect(shapeToBooks(x.l, x.team, outsider(x.l), star(x.l), x.books)).toMatchObject({ voidYears: 0, years: 3 });
    // No room in s+2 either: a two-year deal.
    x = withRooms([0.3, 0.0005, 0.0005]);
    const two = shapeToBooks(x.l, x.team, outsider(x.l), star(x.l), x.books)!;
    expect(two).toMatchObject({ voidYears: 0, years: 2 });
    expect(fits(x.books, dealAdds(x.l, outsider(x.l), x.team.id, two, x.books))).toBe(true);
    // None anywhere: one year, which lands nothing on the books.
    x = withRooms([0.0005, 0.0005, 0.0005]);
    expect(shapeToBooks(x.l, x.team, outsider(x.l), star(x.l), x.books)).toMatchObject({
      years: 1,
      voidYears: 0,
      bonusPct: 0,
    });
  });

  it('lets a keeper the club wants stretch to the GM’s full ceiling where a free agent can’t', () => {
    // s+3's hard room gone; its soft room (no fade) still has two fades of the cap.
    const { l, team, books } = withRooms([0.3, 0.3, 0.0005]);
    const offer = { ...star(l), voidYears: 0, years: 4 };
    expect(shapeToBooks(l, team, outsider(l), offer, books)!.years).toBeLessThan(4);
    expect(shapeToBooks(l, team, outsider(l), offer, books, true)!.years).toBe(4);
  });

  it('makes no early extension a later year of the books can’t carry', () => {
    const l = fresh();
    l.phase = 'resign';
    // A starter an AI club would extend early today, found in the world rather than pinned.
    const scene = (() => {
      for (const team of l.teams.filter((t) => t.id !== l.userTeamId))
        for (const p of teamPlayers(l, team.id).filter(
          (x) => x.contract && x.contract.kind !== 'rookie' && yearsLeft(x.contract, l.season) === 2,
        )) {
          const copy: League = JSON.parse(JSON.stringify(l));
          if (aiExtendEarly(copy, copy.teams[team.id], copy.players[p.id])) return { teamId: team.id, playerId: p.id };
        }
      return null;
    })();
    expect(scene).not.toBeNull();
    const team = l.teams[scene!.teamId];
    const y2 = l.season + 2;
    team.deadMoney.push({ season: y2, amount: Math.round(1.2 * capFor(l, y2)), playerId: -1, note: 'test' });
    expect(aiExtendEarly(l, team, l.players[scene!.playerId])).toBe(false);
  });
});

/** A league at its re-sign window after one played season, built once. */
let windowJson: string | undefined;
const windowWorld = (): League => {
  if (!windowJson) {
    const l = createLeague({ seed: 'cap-books' });
    simToEndOfSeason(l);
    beginOffseason(l);
    windowJson = JSON.stringify(l);
  }
  return JSON.parse(windowJson);
};

describe('tags and early spending', () => {
  it('counts a tagged player next year even when the club doesn’t list him as a keeper', () => {
    const l = fresh();
    const team = l.teams[AI];
    const s = l.season;
    // A backup, out of the club's plans, whose deal ends this year: tagged, he is owed his price next year.
    const p = teamPlayers(l, AI).find((x) => x.contract && !inPlans(l, team, x) && x.contract.kind !== 'rookie')!;
    p.contract!.years = p.contract!.years.filter((y) => y.season <= s);
    expect(capBooks(l, team).years[0].keepers[p.id]).toBeUndefined();
    applyFranchiseTag(l, p);
    expect(capBooks(l, team).years[0].keepers[p.id]).toBeGreaterThan(0);
  });

  it('tags no one next year’s books can’t carry', () => {
    const l = windowWorld();
    // A tag an AI club would make today, with all the room this year could give: found in the world, not pinned.
    const scene = (() => {
      for (const team of l.teams.filter((t) => t.id !== l.userTeamId))
        for (const p of expiringPlayers(l, team.id)) {
          const copy: League = JSON.parse(JSON.stringify(l));
          const t = copy.teams[team.id];
          const q = copy.players[p.id];
          const offer: Offer = { years: 4, apy: tagValue(copy, q) * 2, bonusPct: 0, gtdPct: 0, voidYears: 0 };
          if (tryTag(copy, t, q, depthOutlooks(copy, t), playerOvr(q) + 5, offer, () => 1e9))
            return { teamId: team.id, playerId: p.id };
        }
      return null;
    })();
    expect(scene).not.toBeNull();
    const team = l.teams[scene!.teamId];
    const p = l.players[scene!.playerId];
    const y1 = l.season + 1;
    team.deadMoney.push({ season: y1, amount: Math.round(1.2 * capFor(l, y1)), playerId: -1, note: 'test' });
    const offer: Offer = { years: 4, apy: tagValue(l, p) * 2, bonusPct: 0, gtdPct: 0, voidYears: 0 };
    expect(tryTag(l, team, p, depthOutlooks(l, team), playerOvr(p) + 5, offer, () => 1e9)).toBe(false);
  });

  it('keeps the money that fills the 53 in free agency’s first days, and spends only the cushion', () => {
    const l = fresh();
    const team = l.teams[AI];
    // Five open spots on the 53, so there is fill money to keep.
    for (const p of teamPlayers(l, AI).slice(0, 5)) setTeam(l, p, null);
    expect(fillReserve(l, team.id)).toBeGreaterThan(0);
    l.phase = 'freeAgency';
    l.faDay = SPEND_FIRST.days + 1;
    const later = spendable(l, team.id);
    l.faDay = 1;
    expect(spendable(l, team.id) - later).toBeCloseTo(inSeasonReserve(l, team.id), 0);
  });
});
