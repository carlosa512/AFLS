/** Game-time appointments and their durable career results. No simulation randomness is consumed. */
import type { Game, GameManagement, League, ServiceRecord } from './types';

export function captureManagement(league: League, game: Game): GameManagement {
  if (game.management) return game.management;
  const side = (teamId: number): GameManagement['home'] => ({
    gmId: league.teams[teamId]?.gmId ?? null,
    coaches: Object.values(league.coaches)
      .filter((c) => c.teamId === teamId)
      .map((c) => ({ id: c.id, role: c.role, ...(c.room ? { room: c.room } : {}) })),
  });
  return (game.management = { home: side(game.homeId), away: side(game.awayId) });
}

function emptyRecord(week: number): ServiceRecord {
  return { fromWeek: week, throughWeek: week, regular: { w: 0, l: 0, t: 0 }, playoffs: null, champion: false };
}

/** Called only after recordResult's duplicate-result guard, including live and simulated games. */
export function creditManagement(league: League, game: Game): void {
  const result = game.result;
  if (!result || !Number.isFinite(result.homeScore) || !Number.isFinite(result.awayScore)) return;
  const management = captureManagement(league, game);
  const credit = (record: ServiceRecord, won: boolean, tied: boolean) => {
    record.fromWeek = Math.min(record.fromWeek, game.week);
    record.throughWeek = Math.max(record.throughWeek, game.week);
    if (game.playoffRound) {
      const po = (record.playoffs ??= { w: 0, l: 0, round: game.playoffRound });
      po.round = game.playoffRound;
      if (won) po.w++;
      else po.l++;
      if (game.playoffRound === 'FINAL' && won) record.champion = true;
    } else if (tied) record.regular.t++;
    else if (won) record.regular.w++;
    else record.regular.l++;
  };
  for (const [teamId, people, won] of [
    [game.homeId, management.home, result.homeScore > result.awayScore],
    [game.awayId, management.away, result.awayScore > result.homeScore],
  ] as const) {
    const tied = result.homeScore === result.awayScore;
    const gm = people.gmId === null ? undefined : league.gms[people.gmId];
    if (gm) {
      let row = gm.career.find((s) => s.season === game.season && s.teamId === teamId);
      if (!row) gm.career.push((row = { season: game.season, teamId }));
      credit((row.record ??= emptyRecord(game.week)), won, tied);
    }
    for (const held of people.coaches) {
      const coach = league.coaches[held.id] ?? league.retiredCoaches[held.id];
      if (!coach) continue;
      const career = (coach.career ??= []);
      let row = career.find(
        (s) => s.season === game.season && s.teamId === teamId && s.role === held.role && s.room === held.room,
      );
      if (!row)
        career.push(
          (row = { season: game.season, teamId, role: held.role, ...(held.room ? { room: held.room } : {}) }),
        );
      credit((row.record ??= emptyRecord(game.week)), won, tied);
    }
  }
  // Results now live in durable career rows. Keeping the same staff snapshot on every finished
  // game would duplicate that history and push a season's save past its size budget.
  delete game.management;
}
