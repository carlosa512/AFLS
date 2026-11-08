/**
 * The free-agency market measured the NFL's way (`docs/research/free-agency-market.md`): good deals that just ended
 * (stayed, moved, no deal), good outside signings (how many, how spread over the clubs, how many for one year) and
 * the owner's rule: no player 28 or younger the market prices at 5%+ of the cap left unsigned at kickoff. Read from
 * the league at the re-sign window's start and at kickoff; nothing is stored.
 */
import { capSpace } from '../src/engine/finance/cap';
import { leagueMarket, marketApy } from '../src/engine/finance/market';
import type { League } from '../src/engine/types';

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

/** Call right after `beginOffseason`: the re-sign window's start. */
export function windowStart(l: League): WindowStart {
  const cap = l.caps[l.season];
  const ending: WindowStart['ending'] = [];
  const teamAt: Record<number, number | null> = {};
  for (const p of Object.values(l.players)) {
    teamAt[p.id] = p.teamId;
    const c = p.contract;
    if (p.teamId === null || !c || c.years.at(-1)!.season !== l.season - 1) continue;
    if (c.apy / (l.caps[c.signedSeason] ?? cap) < GOOD) continue;
    ending.push({ id: p.id, teamId: p.teamId, young: p.age <= YOUNG });
  }
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
    eliteYoungUnsigned,
    roomMedian: start.room[Math.floor(start.room.length / 2)],
    roomClubs10: start.room.filter((r) => r >= 0.1).length,
    overCap: start.room.filter((r) => r < 0).length,
  };
}
