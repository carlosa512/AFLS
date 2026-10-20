/**
 * Where a player is headed: the overall a front office expects from him over the next three seasons,
 * not just today's. A young player climbs toward the ceiling it reads in him, a veteran fades on his
 * position's aging curve, and a body its doctors (or, for another team's player, the injury reports)
 * say breaks down counts for less in the years ahead. A lineup is set on today's play; who a club
 * builds around, pays and keeps is set on this: free agency, fifth-year options and the trade
 * market's rooms all read it, so a 15.0 who is about done doesn't push out a 15.0 who is climbing.
 */
import { expectedAging } from './development';
import { injuryRisk, type RiskTier } from './injuries';
import { playerOvr } from './positions';
import { characterRead, perceive, projectedCeiling, type PlayerView } from './scouting';
import type { League, Player, Position } from './types';

/** This season, next and the one after, each a little less certain (the trade market's control weights). */
const HORIZON = [1, 0.75, 0.55];
/** Share of the gap to his ceiling a young player closes in a typical offseason (`developPlayer`'s average). */
const GROWTH = 0.36;
/** Growth is done by 26 (`developPlayer`): from then on it's the prime and the fade. */
const GROWS_UNTIL = 26;
/**
 * What a body's injury risk is worth in each future season, in overall points: a fragile one misses
 * about a fifth more football and plays some of the rest hurt, a sturdy one is there every week.
 */
const RISK: Record<RiskTier, number> = { Low: 0.15, Medium: 0, High: -0.5 };

/**
 * The outlook from its parts: today's overall (`ovr`), the room to his ceiling a front office reads
 * (`gap`), the injury risk it reads, and how much it cares about the years after this one (`future`:
 * 1 for a typical GM, less for an All-In one who wants it now, more for a rebuilder).
 */
export function outlookOf(
  pos: Position,
  age: number,
  ovr: number,
  gap: number,
  risk: RiskTier = 'Medium',
  future = 1,
): number {
  let now = ovr;
  let left = Math.max(0, gap);
  let sum = ovr;
  let total = 1;
  for (let k = 1; k < HORIZON.length; k++) {
    // He develops at his age this offseason, then turns a year older.
    const at = age + k - 1;
    if (at < GROWS_UNTIL) {
      const step = left * GROWTH;
      now += step;
      left -= step;
    } else now += expectedAging(pos, at);
    const w = HORIZON[k] * future;
    sum += w * (now + RISK[risk]);
    total += w;
  }
  return sum / total;
}

/** How much a GM weighs the seasons after this one: a little less the more he plays for now. */
export const futureWeight = (winNow: number) => 1 - 0.3 * (winNow - 0.5);

/**
 * `teamId`'s outlook for a player: his game it knows exactly if he's its own (its scouts' read if
 * not, `view`), his ceiling its scouts' read with the work ethic they see in him, his body its
 * doctors' read or the injury reports.
 */
export function teamOutlook(league: League, teamId: number, p: Player, winNow: number, view?: PlayerView): number {
  const own = p.teamId === teamId;
  const young = p.age < GROWS_UNTIL;
  const seen = !own || young ? (view ?? perceive(league, teamId, p)) : null;
  const ovr = own ? playerOvr(p) : seen!.ovr;
  const gap = young ? projectedCeiling(ovr, seen!.potMid, characterRead(league, teamId, p)?.workEthic) - ovr : 0;
  return outlookOf(p.position, p.age, ovr, gap, injuryRisk(league, teamId, p).tier, futureWeight(winNow));
}
