/**
 * The free-agency market measured the NFL's way (`docs/research/free-agency-market.md`): good deals that just ended
 * (stayed, moved, no deal), good outside signings (how many, how spread over the clubs, how many for one year) and
 * the owner's rule: no player 28 or younger the market prices at 5%+ of the cap left unsigned at kickoff. Read from
 * the league at the re-sign window's start and at kickoff; nothing is stored.
 */
import { capSpace } from '../src/engine/finance/cap';
import { lastSeason } from '../src/engine/finance/contract';
import { leagueMarket, marketApy } from '../src/engine/finance/market';
import { STARTERS } from '../src/engine/positions';
import { POSITIONS, type League } from '../src/engine/types';

/** A good deal: 2% of the cap or more the year it was signed (the research doc's line). */
export const GOOD = 0.02;
/** The owner's elite: priced at 5% of the cap or more. */
export const ELITE = 0.05;
/** Young, as the NFL tables split it. */
const YOUNG = 28;

export interface WindowStart {
  /** The new league year. */
  season: number;
  /** Cap space over the cap, per club, ascending. */
  room: number[];
  /** Good deals that ended last season, with the club each ended with. */
  ending: { id: number; teamId: number; young: boolean }[];
  /** Every player's club at the window's start. */
  teamAt: Record<number, number | null>;
}

/** A good deal ending, with the club it ends with. */
export type GoodEnd = { id: number; teamId: number };

/** The good deals whose last real year is `ended` (void years aren't played: a deal with one ends where its play does). */
function goodEndsOf(l: League, ended: number): GoodEnd[] {
  const out: GoodEnd[] = [];
  for (const p of Object.values(l.players)) {
    const c = p.contract;
    if (p.retired || p.teamId === null || !c || lastSeason(c) !== ended) continue;
    if (c.apy / (l.caps[c.signedSeason] ?? l.caps[l.season]) < GOOD) continue;
    out.push({ id: p.id, teamId: p.teamId });
  }
  return out;
}

/**
 * Call just before `beginOffseason`: the good deals ending with the season just played, read before the new league
 * year's retirements, so a man who retires counts as no deal. The NFL's 25% counts him so (the research doc: injuries
 * and retirements all land in "no deal"); read after the roll, the ~12 a league year who retire left the count.
 */
export const goodEnds = (l: League): GoodEnd[] => goodEndsOf(l, l.season);

/** Call right after `beginOffseason`: the re-sign window's start, its good deals ending from `goodEnds` before it. */
export function windowStart(l: League, ends: readonly GoodEnd[] = goodEndsOf(l, l.season - 1)): WindowStart {
  const cap = l.caps[l.season];
  const teamAt: Record<number, number | null> = {};
  for (const p of Object.values(l.players)) teamAt[p.id] = p.teamId;
  const ending = ends.map((e) => ({ ...e, young: l.players[e.id].age <= YOUNG }));
  const room = l.teams.map((t) => capSpace(l, t.id) / cap).sort((a, b) => a - b);
  return { season: l.season, room, ending, teamAt };
}

export interface FaMeasures {
  ends: number;
  /** Shares (0–1) of the good deals that ended. */
  stayed: number;
  moved: number;
  none: number;
  /** Counts, for a caller to pool over seasons: a season has too few young ends to judge. */
  youngEnds: number;
  youngNone: number;
  /** Good outside signings this league year, clubs with three or more, and the share on one-year deals. */
  outside: number;
  clubs3: number;
  oneYear: number;
  /** The share (0–1) of good outside signings his last club cut this league year (the NFL's: 20–27%). */
  released: number;
  eliteYoungUnsigned: number;
  /** Reported only: room at the window's start. */
  roomMedian: number;
  roomClubs10: number;
  overCap: number;
}

/** Call at kickoff (phase 'regular', week 1). */
export function faMeasures(start: WindowStart, l: League): FaMeasures {
  const cap = l.caps[l.season];
  let stayed = 0;
  let moved = 0;
  let youngEnds = 0;
  let youngNone = 0;
  for (const e of start.ending) {
    const p = l.players[e.id];
    const signed = !!p && !p.retired && p.teamId !== null && !p.squad && !!p.contract;
    if (signed && p.teamId === e.teamId) stayed++;
    else if (signed) moved++;
    if (e.young) {
      youngEnds++;
      if (!signed) youngNone++;
    }
  }
  const n = start.ending.length;
  const outside = Object.values(l.players).filter(
    (p) =>
      p.teamId !== null &&
      !p.squad &&
      p.contract?.kind === 'veteran' &&
      p.contract.signedSeason === l.season &&
      p.contract.apy / cap >= GOOD &&
      start.teamAt[p.id] !== p.teamId,
  );
  const perClub = new Map<number, number>();
  for (const p of outside) perClub.set(p.teamId!, (perClub.get(p.teamId!) ?? 0) + 1);
  const market = leagueMarket(l);
  const eliteYoungUnsigned = Object.values(l.players).filter(
    (p) =>
      !p.retired &&
      // Hurt, he isn't one the market failed: nobody pays market price for a man who'll miss the start.
      !p.injury &&
      (p.teamId === null || p.squad) &&
      !l.draftClass.includes(p.id) &&
      p.age <= YOUNG &&
      marketApy(market, p) >= ELITE * cap,
  ).length;
  return {
    ends: n,
    stayed: stayed / n,
    moved: moved / n,
    none: (n - stayed - moved) / n,
    youngEnds,
    youngNone,
    outside: outside.length,
    clubs3: [...perClub.values()].filter((c) => c >= 3).length,
    oneYear: outside.length ? outside.filter((p) => p.contract!.years.length === 1).length / outside.length : 0,
    released: outside.length
      ? outside.filter((p) => p.left?.some((d) => d.how === 'cut' && d.season === l.season)).length / outside.length
      : 0,
    eliteYoungUnsigned,
    roomMedian: start.room[Math.floor(start.room.length / 2)],
    roomClubs10: start.room.filter((r) => r >= 0.1).length,
    overCap: start.room.filter((r) => r < 0).length,
  };
}

/** Pay bands by APY as a share of the cap the year signed (`docs/research/free-agency-market.md`, project B). */
export const PAY_BAND = {
  min: [0, 0.008],
  mid: [0.008, 0.02],
  good: [0.02, 0.05],
  big: [0.05, 0.1],
  star: [0.1, Infinity],
} as const;
export type PayBand = keyof typeof PAY_BAND;
/** The NFL's veteran deals signed 2018–2021: mean years and the one-year share (0–1), by pay band. */
export const NFL_DEAL_LENGTH: Record<PayBand, { mean: number; oneYear: number }> = {
  min: { mean: 1.17, oneYear: 0.84 },
  mid: { mean: 1.38, oneYear: 0.7 },
  good: { mean: 2.26, oneYear: 0.31 },
  big: { mean: 3.11, oneYear: 0.2 },
  star: { mean: 3.83, oneYear: 0.11 },
};

/** The years of every veteran deal (not a rookie deal or a tag) signed in `signedSeason`, on a team now, by pay band. */
export function dealYearsByBand(l: League, signedSeason: number): Record<PayBand, number[]> {
  const cap = l.caps[signedSeason] ?? l.caps[l.season];
  const years: Record<PayBand, number[]> = { min: [], mid: [], good: [], big: [], star: [] };
  for (const p of Object.values(l.players)) {
    const c = p.contract;
    if (p.teamId === null || !c || c.signedSeason !== signedSeason || c.kind === 'rookie' || c.kind === 'tag') continue;
    const share = c.apy / cap;
    const band = (Object.keys(PAY_BAND) as PayBand[]).find((b) => share >= PAY_BAND[b][0] && share < PAY_BAND[b][1])!;
    years[band].push(c.length);
  }
  return years;
}

/** How many deals, their mean years and the one-year share (0–1). */
export function lengthSummary(ys: readonly number[]): { n: number; mean: number; oneYear: number } {
  const n = ys.length;
  return {
    n,
    mean: n ? ys.reduce((a, y) => a + y, 0) / n : NaN,
    oneYear: n ? ys.filter((y) => y === 1).length / n : NaN,
  };
}

/** `dealYearsByBand`, summarized. */
export function dealLengths(
  l: League,
  signedSeason: number,
): Record<PayBand, { n: number; mean: number; oneYear: number }> {
  const years = dealYearsByBand(l, signedSeason);
  return Object.fromEntries((Object.keys(years) as PayBand[]).map((b) => [b, lengthSummary(years[b])])) as Record<
    PayBand,
    { n: number; mean: number; oneYear: number }
  >;
}

/** The market lines pooled: each the mean over seasons `from..to` (0-based) of every league. */
export interface PooledMarket {
  outside: number;
  oneYear: number;
  clubs3: number;
  none: number;
  released: number;
}

const meanOver = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);

/** Seasons 2–6 by default: a generated league's first contracts aren't a market's, and one league's season is luck. */
export function pooledMarket(runs: readonly FaMeasures[][], from = 1, to = 5): PooledMarket {
  const all = runs.flatMap((r) => r.slice(from, to + 1));
  const of = (k: keyof PooledMarket) => meanOver(all.map((m) => m[k]));
  return {
    outside: of('outside'),
    oneYear: of('oneYear'),
    clubs3: of('clubs3'),
    none: of('none'),
    released: of('released'),
  };
}

/** Starters out of football (%), pooled the same way. */
export function pooledOutOfFootball(runs: readonly number[][], from = 1, to = 5): number {
  return meanOver(runs.flatMap((r) => r.slice(from, to + 1)));
}

/** Every club's starters on its depth chart at kickoff. */
export const kickoffStarters = (l: League): number[] =>
  l.teams.flatMap((t) => POSITIONS.flatMap((pos) => t.depthChart[pos].slice(0, STARTERS[pos])));

/** Last kickoff's starters out of football at this one (%): unsigned or retired. */
export const outOfFootball = (l: League, last: readonly number[]): number =>
  (100 * last.filter((id) => l.players[id].retired || l.players[id].teamId === null).length) / Math.max(1, last.length);
