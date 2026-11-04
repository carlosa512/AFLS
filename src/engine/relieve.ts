/**
 * Relieving a coordinator in season (L4, spec §3.4–3.5): the one coaching move outside the re-sign window and free
 * agency. `relieveCoordinator` is the move (yours or an AI club's) and its news; `coaching.ts` holds its rules
 * (`relieveProblem`) and the move itself (`relieveMove`). The AI's call to use it is below.
 */
import { beliefOf, beliefRead, SIDE_ROOMS } from './belief';
import { coachValue } from './coachRatings';
import {
  chairHolder,
  coachName,
  coachTitle,
  COVER_COST,
  interimCandidates,
  relieveMove,
  relieveProblem,
  teamCoaches,
  VACANT,
  type Cover,
} from './coaching';
import { managesTeam } from './employment';
import { leadershipEvent } from './leadership';
import { ordinal } from './opposition';
import { heatSoFar, talentRanks } from './ownerBag';
import { clamp, Rng } from './rng';
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

// ───────── the AI's call (spec §3.5) ─────────

/**
 * When an AI club lets a coordinator go in season: a losing club whose side is among the league's worst and whose rooms
 * have turned on him, then a weekly draw leaned by its GM (win-now up, loyalty down) and the heat on its head coach.
 * The NFL does it about once or twice a year league-wide; `npm run morale` holds the rate to that.
 */
export const RELIEVE = {
  // The owner's call (2026-11-04): at 0.15 the league relieved about ten a season, against the NFL's one or two.
  chance: 0.08,
  /** The weeks it's on the table: not before a side has shown what it is, not in the last month. */
  from: 5,
  to: 14,
  games: 5,
  share: 0.4,
  /** The worst quarter of clubs on that side of the ball. */
  bottom: 0.25,
  winNow: 0.5,
  loyalty: 0.5,
  heat: 0.5,
};

const thisSeason = (league: League, teamId: number, kind: string) =>
  league.leadership.events.some((e) => e.teamId === teamId && e.date.season === league.season && e.kind === kind);

/** All three hold: the club is losing, his side is among the league's worst, and most of his rooms doubt him. */
export function onTheTable(
  league: League,
  teamId: number,
  role: 'offCoord' | 'defCoord',
  records = computeRecords(league),
): boolean {
  const c = chairHolder(teamCoaches(league, teamId), { role });
  if (!c) return false;
  if (thisSeason(league, teamId, 'coachRelieved') || thisSeason(league, teamId, 'coachInterim')) return false;
  const rec = records.get(teamId);
  const n = rec ? rec.w + rec.l + rec.t : 0;
  if (!rec || n < RELIEVE.games || (rec.w + rec.t / 2) / n > RELIEVE.share) return false;
  if (sideRank(league, teamId, role) <= Math.round(league.teams.length * (1 - RELIEVE.bottom))) return false;
  const rooms = SIDE_ROOMS[role];
  const doubting = rooms.filter((r) => {
    const read = beliefRead(beliefOf(c, r));
    return read === 'doubts' || read === 'lost';
  }).length;
  return doubting > rooms.length / 2;
}

/** Who an AI club hands the side to: the better of its head coach covering and the best position coach who'd step up. */
export function aiCover(league: League, teamId: number, role: 'offCoord' | 'defCoord'): Cover {
  const pc = interimCandidates(league, teamId, role)[0];
  const hc = chairHolder(teamCoaches(league, teamId), { role: 'headCoach' });
  const covers = hc ? Math.max(VACANT, coachValue(hc) - COVER_COST) : VACANT;
  return pc && coachValue(pc) > covers ? pc.id : 'headCoach';
}

/** An AI club relieves him now, if nothing stands in the way (one a season, the owner's mandate): whether it did. */
export function aiRelieveNow(league: League, teamId: number, coachId: number): boolean {
  // The same window and limits whether the weekly draw or a notice brings it: weeks five to fourteen, once a season,
  // and not once the owner has let the head coach go (the interim makes his own staff).
  if (league.phase !== 'regular' || league.week < RELIEVE.from || league.week > RELIEVE.to) return false;
  if (thisSeason(league, teamId, 'coachRelieved') || thisSeason(league, teamId, 'coachInterim')) return false;
  const c = league.coaches[coachId];
  if (!c || (c.role !== 'offCoord' && c.role !== 'defCoord')) return false;
  const cover = aiCover(league, teamId, c.role);
  if (relieveProblem(league, teamId, coachId, cover, false)) return false;
  relieveCoordinator(league, teamId, coachId, cover);
  return true;
}

/** The league's week, after belief's: each AI club with a coordinator on the table draws whether it lets him go. */
export function aiRelieve(league: League): void {
  if (league.phase !== 'regular' || league.week < RELIEVE.from || league.week > RELIEVE.to) return;
  let ranks: Map<number, number> | undefined;
  const records = computeRecords(league);
  for (const team of league.teams) {
    if (managesTeam(league, team.id)) continue;
    const rng = new Rng(`${league.seed}:relieve:${league.season}:${league.week}:${team.id}`);
    for (const role of ['offCoord', 'defCoord'] as const) {
      if (!onTheTable(league, team.id, role, records)) continue;
      const rec = records.get(team.id)!;
      const heat = heatSoFar(league, team, rec, (ranks ??= talentRanks(league)).get(team.id)!).coach;
      const lean =
        1 +
        RELIEVE.winNow * (team.gm.winNow - 0.5) * 2 -
        RELIEVE.loyalty * (team.gm.loyalty - 0.5) * 2 +
        (RELIEVE.heat * heat) / 4;
      if (!rng.chance(RELIEVE.chance * clamp(lean, 0.25, 2))) continue;
      const c = chairHolder(teamCoaches(league, team.id), { role })!;
      if (aiRelieveNow(league, team.id, c.id)) break;
    }
  }
}
