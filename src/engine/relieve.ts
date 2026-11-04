/**
 * Relieving a coordinator in season (L4, spec §3.4–3.5): the one coaching move outside the re-sign window and free
 * agency. `relieveCoordinator` is the move (yours or an AI club's) and its news; `coaching.ts` holds its rules
 * (`relieveProblem`) and the move itself (`relieveMove`). The AI's call to use it is below.
 */
import { coachName, coachTitle, relieveMove, type Cover } from './coaching';
import { leadershipEvent } from './leadership';
import { ordinal } from './opposition';
import { computeRecords } from './season/standings';
import type { Coach, League } from './types';

/** His side's rank in the league this regular season: points scored for an offense, allowed for a defense (1 = best). */
export function sideRank(league: League, teamId: number, role: 'offCoord' | 'defCoord'): number {
  const per = new Map<number, { pts: number; n: number }>();
  for (const t of league.teams) per.set(t.id, { pts: 0, n: 0 });
  for (const g of league.games) {
    if (g.season !== league.season || g.playoffRound || !g.result) continue;
    for (const [id, pts, opp] of [
      [g.homeId, g.result.homeScore, g.result.awayScore],
      [g.awayId, g.result.awayScore, g.result.homeScore],
    ] as const) {
      const s = per.get(id)!;
      s.pts += role === 'offCoord' ? pts : opp;
      s.n++;
    }
  }
  const avg = (id: number) => {
    const s = per.get(id)!;
    return s.n ? s.pts / s.n : 0;
  };
  // More points is better for an offense, fewer for a defense; a stable tie-break by club.
  const order = league.teams
    .map((t) => t.id)
    .sort((a, b) => (role === 'offCoord' ? avg(b) - avg(a) : avg(a) - avg(b)) || a - b);
  return order.indexOf(teamId) + 1;
}

/** The news line: the record and how the side ranks, never the room's belief. */
export function relievedReport(league: League, teamId: number, c: Coach): string {
  const role = c.role === 'defCoord' ? 'defCoord' : 'offCoord';
  const rec = computeRecords(league).get(teamId);
  const record = rec ? `${rec.w}–${rec.l}${rec.t ? `–${rec.t}` : ''}` : '0–0';
  const rank = sideRank(league, teamId, role);
  return `${league.teams[teamId].abbrev} relieved ${coachTitle(c).toLowerCase()} ${coachName(c)} of his duties (${record}; ${ordinal(rank)} of ${league.teams.length} in points ${role === 'offCoord' ? 'scored' : 'allowed'})`;
}

/** Relieve your (or an AI club's) coordinator now: the move, then the news. Throws on a `relieveProblem`. */
export function relieveCoordinator(league: League, teamId: number, coachId: number, cover: Cover = 'headCoach'): void {
  const c = league.coaches[coachId];
  const report = c ? relievedReport(league, teamId, c) : '';
  relieveMove(league, teamId, coachId, cover);
  leadershipEvent(league, { teamId, kind: 'coachRelieved', coachId, report });
}
