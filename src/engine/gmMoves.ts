/**
 * A general manager's notable moves, kept on his record as they happen: a trade with a first-round pick in it and a
 * signing that took a real share of the cap. The league forgets both within two seasons (`League.draftPicks` drops a
 * traded pick, the transaction log rolls over), and SNN's Column tells a GM's work across several
 * (`gmFindings.ts`). Record-keeping only: nothing in the sim reads it and writing it draws nothing, so play is the
 * same with it on or off (`MOVES.on`, for the test that proves it).
 */
import { capFor } from './finance/cap';
import type { GeneralManager, GmMove, League, MoveSide, Player, TradeRecord } from './types';

export const MOVES = {
  on: true,
  /** A trade is kept when either side gives a pick of this round. */
  round: 1,
  /** A signing is kept when its total value is this share of the year's cap or more. */
  signShare: 0.08,
  /** Moves kept per GM: the oldest goes first. */
  keep: 40,
};

const gmOf = (league: League, teamId: number): GeneralManager | undefined => {
  const id = league.teams[teamId]?.gmId;
  return id == null ? undefined : league.gms[id];
};

function file(gm: GeneralManager | undefined, move: GmMove): void {
  if (!gm) return;
  const moves = (gm.deals ??= []);
  moves.push(move);
  if (moves.length > MOVES.keep) moves.splice(0, moves.length - MOVES.keep);
}

/** A trade's two sides with each pick's year and round, or null when a pick can no longer be read. */
function sidesOf(league: League, record: TradeRecord): [MoveSide, MoveSide] | null {
  const byId = new Map(league.draftPicks.map((p) => [p.id, p]));
  const out: MoveSide[] = [];
  for (const side of record.sides) {
    const picks = side.picks.map((id) => byId.get(id));
    if (picks.some((p) => !p)) return null;
    out.push({ players: [...side.players], picks: picks.map((p) => ({ season: p!.season, round: p!.round })) });
  }
  return out as [MoveSide, MoveSide];
}

/** What each GM files for a trade, from his own side: nothing unless a pick of `MOVES.round` changed hands. */
function tradeMoves(league: League, record: TradeRecord): GmMove[] {
  const sides = sidesOf(league, record);
  if (!sides || !sides.some((s) => s.picks.some((p) => p.round === MOVES.round))) return [];
  return record.sides.map((side, i) => ({
    kind: 'trade' as const,
    season: record.season,
    phase: record.phase,
    week: record.week,
    teamId: side.teamId,
    otherId: record.sides[1 - i].teamId,
    gave: sides[i],
    got: sides[1 - i],
  }));
}

/** A trade as it closes: on both GMs' records when it is a notable one. */
export function noteTrade(league: League, record: TradeRecord): void {
  if (!MOVES.on) return;
  for (const move of tradeMoves(league, record)) file(gmOf(league, move.teamId), move);
}

/** A player signed from outside: on the GM's record when the deal is big enough. `total` is in $K. */
export function noteSigning(league: League, player: Player, teamId: number, years: number, total: number): void {
  if (!MOVES.on || total < MOVES.signShare * capFor(league, league.season)) return;
  file(gmOf(league, teamId), {
    kind: 'sign',
    season: league.season,
    phase: league.phase,
    week: league.week,
    teamId,
    playerId: player.id,
    years,
    total,
  });
}

/** His moves at one team, oldest first: a GM on his second team is judged there on what he did there. */
export function movesAt(gm: GeneralManager, teamId: number): GmMove[] {
  return (gm.deals ?? []).filter((m) => m.teamId === teamId);
}

/**
 * An older save: the trades its history still holds whose picks can still be read, filed for the one GM whose career
 * has that season at that team. Signings are not filled in (their terms lived only in the log's text).
 */
export function backfillMoves(league: League): void {
  const gms = Object.values(league.gms);
  for (const record of league.market?.history ?? [])
    for (const move of tradeMoves(league, record)) {
      const then = gms.filter((g) => g.career.some((c) => c.season === move.season && c.teamId === move.teamId));
      if (then.length === 1) file(then[0], move);
    }
}
