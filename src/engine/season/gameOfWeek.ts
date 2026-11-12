/**
 * The game of the week: the best two records meeting, among a week's games still to play that are not the reader's own
 * and not playoff games, once there are records to go on. One pick for Home's strip (`ui/strip.tsx`) and SNN's edition
 * (`snnWeek.ts`), so the two cannot disagree.
 */
import type { Game, League } from '../types';
import { computeRecords, type TeamRecord } from './standings';

export function gameOfWeek(
  league: League,
  week: number,
  records: Map<number, TeamRecord> = computeRecords(league),
): Game | undefined {
  const user = league.userTeamId;
  const share = (id: number) => {
    const r = records.get(id);
    const n = r ? r.w + r.l + r.t : 0;
    return r && n ? (r.w + 0.5 * r.t) / n : null;
  };
  const both = (g: Game) => (share(g.homeId) ?? NaN) + (share(g.awayId) ?? NaN);
  return league.games
    .filter((g) => g.season === league.season && g.week === week)
    .filter((g) => !g.result && !g.playoffRound && g.homeId !== user && g.awayId !== user && !Number.isNaN(both(g)))
    .sort((a, b) => both(b) - both(a))[0];
}
