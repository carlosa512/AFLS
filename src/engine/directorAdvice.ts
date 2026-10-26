/**
 * The director of scouting's recommendations (`docs/NEWS.md`): four mails a year with two to four moves for us,
 * read through our scouts. In season the lean comes from the playoff race; in the offseason, the players about to
 * reach free agency and the free agents our cap can carry. Pure functions over the league: no randomness.
 */
import { employed } from './employment';
import { computeRecords, conferenceSeeds, type TeamRecord } from './season/standings';
import { tradeContext } from './trade/context';
import { teamNeeds, type Need } from './trade/plans';
import { slotRate } from './trade/value';
import type { League } from './types';

export type AdviceLean = 'buy' | 'targeted' | 'sell';

/** Where we stand in our conference's race: games behind the last seed (0 while we hold one) and our seed. */
export function raceFor(
  league: League,
  records: Map<number, TeamRecord> = computeRecords(league),
): { gamesBack: number; seed: number | null; record: TeamRecord } {
  const me = records.get(league.userTeamId)!;
  const seeds = conferenceSeeds(league, league.teams[league.userTeamId].conference, records);
  const at = seeds.indexOf(league.userTeamId);
  if (at >= 0) return { gamesBack: 0, seed: at + 1, record: me };
  const last = records.get(seeds[seeds.length - 1])!;
  // Games back; a tie is half a win and half a loss, so ties cancel out of the difference.
  const gamesBack = (last.w - me.w + (me.l - last.l)) / 2;
  return { gamesBack: Math.max(0, gamesBack), seed: null, record: me };
}

/** In the race or within a game: add. Two or three back: one in, one out. Further: sell. */
export const adviceLean = (gamesBack: number): AdviceLean =>
  gamesBack <= 1 ? 'buy' : gamesBack <= 3 ? 'targeted' : 'sell';

/** Our needs, most urgent first. Our own players' visible ratings are exact (`perceive`), so this is our view too. */
export function adviceNeeds(league: League): Need[] {
  if (!employed(league)) return [];
  return teamNeeds(tradeContext(league), league.teams[league.userTeamId]);
}

const ROUNDS = ['1st', '2nd', '3rd', '4th', '5th', '6th', '7th'];

/** A trade value in the words a director uses: the round of a mid-round pick it reaches. */
export function pickRoundFor(_league: League, value: number): string {
  const mark = (round: number) => slotRate(16 + 32 * round);
  if (value >= 1.5 * mark(0)) return 'a 1st and more';
  const round = ROUNDS.findIndex((_, r) => value >= mark(r));
  return round < 0 ? 'a late-round pick' : `likely a ${ROUNDS[round]}`;
}
