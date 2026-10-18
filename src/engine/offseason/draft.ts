/**
 * The draft: a generated class with scouting grades (true ratings stay hidden), an order
 * from last season's standings and playoff exits, AI boards that blend talent, position
 * value and need, and slotted rookie contracts.
 */
import { recordRatings } from '../development';
import { logTransaction } from '../finance/cap';
import { createDraftPicks, DRAFT_ROUNDS, freeJersey, generatePlayer, MAX_FUTURE_DRAFT_YEARS, rookieContract } from '../generate';
import { playerOvr, ROSTER_TEMPLATE, STARTERS } from '../positions';
import { clamp, type Rng } from '../rng';
import { syncDepthChart, teamPlayers } from '../roster';
import { characterRead, perceive, projectedCeiling, quirkWorth } from '../scouting';
import { computeRecords, winPct } from '../season/standings';
import type { DraftPick, League, Player, Position } from '../types';
import { POSITIONS } from '../types';

export const DRAFT_CLASS_SIZE = 260;
/** How far the league consensus sits from the truth (sd of its grade and of its ceiling). */
export const CONSENSUS_SD = { grade: 1, ceiling: 1.4 };

/** Share of a draft class at each position (kickers and punters are rare). */
const CLASS_MIX: [Position, number][] = POSITIONS.map((p) => [p, p === 'K' || p === 'P' ? 0.6 : ROSTER_TEMPLATE[p]]);

export function generateDraftClass(league: League, rng: Rng): void {
  league.draftClass = [];
  for (let i = 0; i < DRAFT_CLASS_SIZE; i++) {
    // A steep top, a long flat middle: a few day-one starters, many projects.
    const quality = clamp(13.5 - 7.4 * (i / (DRAFT_CLASS_SIZE - 1)) ** 0.6 + rng.normal(0, 0.9), 4, 16);
    const position = rng.weighted(CLASS_MIX, ([, w]) => w)[0];
    const p = generatePlayer(rng, { id: league.nextPlayerId++, position, quality, age: rng.int(21, 23), teamId: null, jerseysUsed: new Set() });
    p.experience = 0;
    // Most prospects grow a point or three; a few boom, some never move.
    const growth = Math.abs(rng.normal(0, 1)) * 2.1 + rng.float(0, 0.8) + (rng.chance(0.06) ? rng.float(2, 4.5) : 0);
    p.potential = Math.round(clamp(playerOvr(p) + growth, playerOvr(p), 20) * 10) / 10;
    // Scouts see a noisy grade and an even noisier ceiling.
    p.scouting = { grade: Math.round((playerOvr(p) + rng.normal(0, CONSENSUS_SD.grade)) * 2) / 2, ceiling: Math.round((p.potential + rng.normal(0, CONSENSUS_SD.ceiling)) * 2) / 2 };
    recordRatings(p, league.season);
    league.players[p.id] = p;
    league.draftClass.push(p.id);
  }
}

/** How far each team got in `season`'s playoffs (0 = missed them; 6 = champion). */
function playoffDepth(league: League, season: number): Map<number, number> {
  const depth = new Map<number, number>();
  const tier = { WC: 2, DIV: 3, CONF: 4, FINAL: 5 } as const;
  for (const g of league.games) {
    if (g.season !== season || !g.playoffRound || !g.result) continue;
    const r = g.result;
    const loser = r.homeScore > r.awayScore ? g.awayId : g.homeId;
    const winner = loser === g.homeId ? g.awayId : g.homeId;
    depth.set(loser, tier[g.playoffRound]);
    if (g.playoffRound === 'FINAL') depth.set(winner, 6);
    else depth.set(winner, Math.max(depth.get(winner) ?? 0, tier[g.playoffRound] + 1));
  }
  return depth;
}

/** Worst record picks first; playoff teams follow in order of elimination, the champion last. */
export function setDraftOrder(league: League, lastSeason: number): void {
  const records = computeRecords(league, lastSeason);
  const depth = playoffDepth(league, lastSeason);
  const order = [...league.teams]
    .map((t) => {
      const r = records.get(t.id)!;
      return { id: t.id, depth: depth.get(t.id) ?? 0, pct: winPct(r.w, r.l, r.t), diff: r.pf - r.pa };
    })
    .sort((a, b) => a.depth - b.depth || a.pct - b.pct || a.diff - b.diff || a.id - b.id)
    .map((x) => x.id);
  for (const pick of league.draftPicks) {
    if (pick.season !== league.season) continue;
    pick.overall = (pick.round - 1) * 32 + order.indexOf(pick.originalTeamId) + 1;
  }
}

export function draftOrder(league: League): DraftPick[] {
  return league.draftPicks.filter((p) => p.season === league.season && p.overall !== undefined).sort((a, b) => a.overall! - b.overall!);
}

export const nextPick = (league: League) => draftOrder(league).find((p) => p.playerId === undefined);

export function availableProspects(league: League): Player[] {
  return league.draftClass.map((id) => league.players[id]).filter((p) => p && p.teamId === null);
}

export const POSITION_PREMIUM: Record<Position, number> = { QB: 1.2, EDGE: 0.6, OL: 0.3, CB: 0.3, WR: 0.3, DT: 0.3, LB: 0, S: 0, TE: 0, RB: -0.1, K: -2.5, P: -2.8 };

/** A team's overalls by position, best first. */
export function positionDepth(league: League, teamId: number): Record<Position, number[]> {
  const out = Object.fromEntries(POSITIONS.map((pos) => [pos, [] as number[]])) as Record<Position, number[]>;
  for (const p of teamPlayers(league, teamId)) out[p.position].push(playerOvr(p));
  for (const list of Object.values(out)) list.sort((a, b) => b - a);
  return out;
}

/** The league consensus's need-blind board value: talent, upside and positional value. */
export const boardValue = (p: Player) => 0.6 * p.scouting!.grade + 0.4 * p.scouting!.ceiling + POSITION_PREMIUM[p.position];

/** Where the consensus ranks a prospect in his class (1 = best), which is roughly where he'll go. */
export function consensusRank(league: League, p: Player): number {
  const mine = boardValue(p);
  let rank = 1;
  for (const id of league.draftClass) {
    const x = league.players[id];
    if (x?.scouting && x.id !== p.id && boardValue(x) > mine) rank++;
  }
  return rank;
}

export interface Board {
  grade: number;
  ceiling: number;
}

/**
 * A team's own board entry: the consensus, moved toward its scouts' read by how far it trusts
 * them. Trust follows precision: a sharp department that watched a prospect closely leans on its
 * own read, a poor one leans on the consensus. So no front office drafts worse than the consensus
 * would, but each disagrees with it in its own places, and good scouts find the sleepers.
 */
export function boardOf(league: League, teamId: number, p: Player): Board {
  const v = perceive(league, teamId, p);
  const c = p.scouting!;
  const trustGrade = CONSENSUS_SD.grade ** 2 / (CONSENSUS_SD.grade ** 2 + v.ovrSd ** 2);
  const trustCeiling = CONSENSUS_SD.ceiling ** 2 / (CONSENSUS_SD.ceiling ** 2 + v.potSd ** 2);
  // Habits are the team's own homework too: only the ones its scouts have seen on film count.
  const grade = c.grade + trustGrade * (v.ovr - c.grade) + quirkWorth(league, teamId, p);
  const ceiling = c.ceiling + trustCeiling * (v.potMid - c.ceiling);
  // Makeup is the team's own homework (the consensus doesn't rate it): a grinder it has sat down
  // with gets more of his ceiling, a coaster less.
  return { grade, ceiling: projectedCeiling(grade, ceiling, characterRead(league, teamId, p)?.workEthic) };
}

/** Boards built during one draft, by team then prospect: a view doesn't change while picks are made. */
export type BoardMemo = Map<number, Map<number, Board>>;

function boardFrom(memo: BoardMemo, league: League, teamId: number, p: Player): Board {
  let mine = memo.get(teamId);
  if (!mine) memo.set(teamId, (mine = new Map()));
  let b = mine.get(p.id);
  if (!b) mine.set(p.id, (b = boardOf(league, teamId, p)));
  return b;
}

/** A front office's board score for a prospect: its read of talent and upside, position value, need. */
export function boardScore(depth: Record<Position, number[]>, p: Player, board: Board, rng: Rng, round: number): number {
  let score = 0.6 * board.grade + 0.4 * board.ceiling + POSITION_PREMIUM[p.position] + rng.normal(0, 0.6);
  const mine = depth[p.position];
  if (mine.length < STARTERS[p.position] + 1) score += 1;
  else if ((mine[STARTERS[p.position] - 1] ?? 0) < Math.min(11, board.grade)) score += 0.8;
  if (mine.length >= ROSTER_TEMPLATE[p.position] + 1) score -= 1.5;
  if ((p.position === 'K' || p.position === 'P') && round < 5) score -= 3;
  return score;
}

export function aiDraftChoice(league: League, teamId: number, rng: Rng, round: number, boards: BoardMemo = new Map()): Player {
  const pool = availableProspects(league);
  const depth = positionDepth(league, teamId);
  let best = pool[0];
  let bestScore = -Infinity;
  for (const p of pool) {
    const score = boardScore(depth, p, boardFrom(boards, league, teamId, p), rng, round);
    if (score > bestScore) {
      best = p;
      bestScore = score;
    }
  }
  return best;
}

export function draftPlayer(league: League, pick: DraftPick, player: Player): void {
  if (pick.playerId !== undefined || player.teamId !== null) throw new Error('Pick already used or player taken');
  const team = league.teams[pick.ownerId];
  pick.playerId = player.id;
  pick.consRank = consensusRank(league, player);
  player.teamId = team.id;
  player.contract = rookieContract(pick.overall!, league.season, league.caps[league.season]);
  player.draft = { season: league.season, round: pick.round, pick: pick.overall!, teamId: team.id };
  player.jersey = freeJersey(player.position, new Set(teamPlayers(league, team.id).filter((p) => p.id !== player.id).map((p) => p.jersey)), player.jersey);
  syncDepthChart(league, team);
  logTransaction(league, 'draft', [team.id], `${team.abbrev} drafted ${player.position} ${player.firstName} ${player.lastName} (round ${pick.round}, No. ${pick.overall})`);
}

/** Make picks until it's the user's turn (or the draft ends). Returns the picks made. */
export function simDraft(league: League, rng: Rng, opts: { stopAtUser: boolean }): DraftPick[] {
  const made: DraftPick[] = [];
  const boards: BoardMemo = new Map();
  for (let pick = nextPick(league); pick; pick = nextPick(league)) {
    if (opts.stopAtUser && pick.ownerId === league.userTeamId) break;
    draftPlayer(league, pick, aiDraftChoice(league, pick.ownerId, rng, pick.round, boards));
    made.push(pick);
  }
  return made;
}

export const draftComplete = (league: League) => !nextPick(league);

/** Undrafted prospects join the free-agent pool; the next far-future draft's picks are created. */
export function finishDraft(league: League): void {
  for (const id of league.draftClass) {
    const p = league.players[id];
    if (p && p.teamId === null) delete p.scouting;
  }
  league.draftClass = [];
  if (!league.draftPicks.some((p) => p.season === league.season + MAX_FUTURE_DRAFT_YEARS)) createDraftPicks(league, league.season + MAX_FUTURE_DRAFT_YEARS);
  league.draftPicks = league.draftPicks.filter((p) => p.season > league.season - 2);
}

export const ROUNDS = DRAFT_ROUNDS;
