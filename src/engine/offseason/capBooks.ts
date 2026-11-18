/**
 * A GM's cap books (`docs/superpowers/specs/2026-11-18-multi-year-cap-books-design.md`): the next three league years as
 * a front office keeps them, each year's projected cap, what's committed, what it still needs to field a team, and the
 * room left under the GM's own limit. Every way an AI club commits money (restructures, offers, extensions, tags)
 * reads them, so nothing is borrowed against a year that can't carry it. Before them each decision checked next year
 * at most, the years after filled up unchecked, and a league spent itself flat by its fifth season.
 *
 * A pure read of the league as it stands: nothing is stored and nothing is drawn, so a reload plans the same.
 */
import { capFor, capSheet } from '../finance/cap';
import { capHit, lastSeason } from '../finance/contract';
import { leagueMarket, marketApy, minSalary } from '../finance/market';
import { rookieContract } from '../generate';
import { teamPlayers } from '../roster';
import type { League, Player, Team } from '../types';
import { depthOutlooks, inPlans, IN_SEASON_RESERVE, nextYearCeiling, winNow } from './ai';
import { prospectiveContract, type Offer } from './negotiation';

/**
 * The books' reach and how much more of each later year a GM keeps free (`fade`, a share of that year's cap): the
 * further out, the less he knows. Tuned on `npm run cap-books`.
 */
export const BOOKS = { horizon: 3, fade: 0.03 };

/** The roster a club fields: what the books fill each later year. */
const ROSTER = 53;
/** A draft class when a year's picks aren't on file yet: seven picks at their rounds' middle slots. */
const CLASS_SLOTS = [16, 48, 80, 112, 144, 176, 208];

export interface BookYear {
  season: number;
  /** The cap as the league projects it (`capFor`). */
  cap: number;
  /** Salaries, bonus proration (void years included) and dead money already on that year (`capSheet`). */
  committed: number;
  /** Keepers' next deals, the draft class, the 53's open spots at the minimum, and the in-season reserve. */
  needed: number;
  /** The keepers counted (deals ending this league year, in the club's plans), by id, at their price on that year's cap. */
  keepers: Record<number, number>;
  /** Spots on the 53 nobody under contract, kept or drafted fills, each counted at the minimum. */
  spots: number;
  /** The most the GM lets that year carry: his next-year ceiling, less `fade` a year after the first. */
  limit: number;
  /** The same without the fade: what he stretches to for a core player he keeps. */
  softLimit: number;
  room: number;
  softRoom: number;
}

export interface CapBooks {
  teamId: number;
  /** `years[0]` is next league year. */
  years: BookYear[];
}

/** The in-season reserve a GM keeps in a given year (`inSeasonReserve`, on that year's cap). */
const reserveIn = (league: League, team: Team, season: number) =>
  capFor(league, season) * IN_SEASON_RESERVE * (1.5 - team.gm.capAggression);

/** The draft class a club pays for in `season`: the picks it owns, or a typical class when none are on file yet. */
function draftClass(league: League, teamId: number, season: number): number[] {
  const cap = capFor(league, season);
  const onFile = league.draftPicks.filter((d) => d.season === season);
  const slots = onFile.length
    ? onFile
        .filter((d) => d.ownerId === teamId && d.playerId === undefined)
        .map((d) => d.overall ?? (d.round - 1) * 32 + 16)
    : CLASS_SLOTS;
  return slots.map((slot) => capHit(rookieContract(slot, season, cap), season));
}

/** The books as they stand. One depth read a call: cheap enough for a decision, built once for a loop. */
export function capBooks(league: League, team: Team): CapBooks {
  const s = league.season;
  const depth = depthOutlooks(league, team);
  const wn = winNow(league, team);
  const ceiling = nextYearCeiling(team.gm, wn);
  const market = leagueMarket(league);
  const now = capFor(league, s);
  const roster = teamPlayers(league, team.id).filter((p) => p.contract && !p.squad && !p.waiver);
  // Who the club is about to re-sign: the players it plans to keep whose deals end this league year. A deal that ends
  // later is a decision for later, and its spot counts at the minimum, as cap analysts project a year out (Over the
  // Cap's effective cap space). Counting every starter at market by the third year put every club past its books.
  const kept = roster.filter((p) => lastSeason(p.contract!) <= s && inPlans(league, team, p, depth, wn));
  const years: BookYear[] = [];
  for (let k = 1; k <= BOOKS.horizon; k++) {
    const season = s + k;
    const cap = capFor(league, season);
    const committed = capSheet(league, team.id, season).used;
    const keepers: Record<number, number> = {};
    for (const p of kept) keepers[p.id] = (marketApy(market, p) * cap) / now;
    const contracted = roster.filter((p) => lastSeason(p.contract!) >= season).length;
    const picks = draftClass(league, team.id, season);
    const spots = Math.max(0, ROSTER - contracted - Object.keys(keepers).length - picks.length);
    const needed =
      Object.values(keepers).reduce((a, b) => a + b, 0) +
      picks.reduce((a, b) => a + b, 0) +
      spots * minSalary(1, cap) +
      reserveIn(league, team, season);
    const limit = cap * (ceiling - BOOKS.fade * (k - 1));
    const softLimit = cap * ceiling;
    years.push({
      season,
      cap,
      committed,
      needed,
      keepers,
      spots,
      limit,
      softLimit,
      room: limit - committed - needed,
      softRoom: softLimit - committed - needed,
    });
  }
  return { teamId: team.id, years };
}

/** `adds` folded onto the horizon: index i lands on `years[i]`, anything past the last year lands on it. */
function folded(books: CapBooks, adds: readonly number[]): number[] {
  const n = books.years.length;
  const out = new Array<number>(n).fill(0);
  adds.forEach((x, i) => (out[Math.min(i, n - 1)] += x));
  return out;
}

/** Whether the books carry `adds` (a year with nothing added is never judged: a club already past it can still sign a one-year deal). */
export function fits(books: CapBooks, adds: readonly number[], soft = false): boolean {
  return folded(books, adds).every((x, i) => x <= 0 || (soft ? books.years[i].softRoom : books.years[i].room) >= x);
}

/** The smallest room across the horizon. */
export function minRoom(books: CapBooks, soft = false): number {
  return Math.min(...books.years.map((y) => (soft ? y.softRoom : y.room)));
}

/** The books after a commitment: each year's room falls by what lands on it. Mutates and returns `books`. */
export function commit(books: CapBooks, adds: readonly number[]): CapBooks {
  folded(books, adds).forEach((x, i) => {
    const y = books.years[i];
    y.committed += x;
    y.room -= x;
    y.softRoom -= x;
  });
  return books;
}

/**
 * What signing `offer` adds to each year after this one (`[s+1, s+2, …]`, to the new deal's end, void years included):
 * the new deal's charge less the one it replaces. With `books`, net of what the books already counted for him: his
 * price as a keeper, or the minimum deal for the open spot a new player fills.
 */
export function dealAdds(league: League, player: Player, teamId: number, offer: Offer, books?: CapBooks): number[] {
  const s = league.season;
  const next = prospectiveContract(league, player, teamId, offer);
  const old = player.teamId === teamId ? player.contract : null;
  const end = Math.max(...next.years.map((y) => y.season), ...next.bonuses.map((b) => b.start + b.years - 1));
  const adds: number[] = [];
  for (let season = s + 1; season <= end; season++) {
    let x = capHit(next, season) - (old ? capHit(old, season) : 0);
    const y = books?.years[season - s - 1];
    if (y) {
      const kept = y.keepers[player.id];
      if (kept !== undefined) x -= kept;
      else if (!old || lastSeason(old) < season) x -= y.spots > 0 ? minSalary(1, y.cap) : 0;
    }
    adds.push(x);
  }
  return adds;
}

/**
 * The offer as a GM can carry it on his books, shaped before he walks away from it: the void years go first (their
 * bonus money lands on years the deal doesn't even cover), then the bonus share, then years, down to one. Null when
 * even one year with no bonus doesn't fit (it lands nothing on later years, so that is rare: a club re-signing a man
 * whose old bonus still runs). `soft` reads the GM's full ceiling (`softRoom`): a core player he means to keep.
 */
export function shapeToBooks(
  league: League,
  team: Team,
  player: Player,
  offer: Offer,
  books: CapBooks,
  soft = false,
): Offer | null {
  const ok = (o: Offer) => fits(books, dealAdds(league, player, team.id, o, books), soft);
  let o = { ...offer };
  if (ok(o)) return o;
  if (o.voidYears) {
    o = { ...o, voidYears: 0 };
    if (ok(o)) return o;
  }
  if (o.bonusPct > 0) {
    o = { ...o, bonusPct: 0 };
    if (ok(o)) return o;
  }
  while (o.years > 1) {
    o = { ...o, years: o.years - 1 };
    if (ok(o)) return o;
  }
  return null;
}
