/**
 * The draft: a generated class with scouting grades (true ratings stay hidden), an order
 * from last season's standings and playoff exits, AI boards that blend talent, position
 * value and need, and slotted rookie contracts.
 */
import { logTransaction } from '../finance/cap';
import { createDraftPicks, DRAFT_ROUNDS, freeJersey, generatePlayer, MAX_FUTURE_DRAFT_YEARS, rookieContract } from '../generate';
import { playerOvr, ROSTER_TEMPLATE, STARTERS } from '../positions';
import { clamp, type Rng } from '../rng';
import { syncDepthChart, teamPlayers } from '../roster';
import { computeRecords, winPct } from '../season/standings';
import type { DraftPick, League, Player, Position } from '../types';
import { POSITIONS } from '../types';

export const DRAFT_CLASS_SIZE = 260;

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
    p.scouting = { grade: Math.round((playerOvr(p) + rng.normal(0, 1)) * 2) / 2, ceiling: Math.round((p.potential + rng.normal(0, 1.4)) * 2) / 2 };
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

const POSITION_PREMIUM: Record<Position, number> = { QB: 1.2, EDGE: 0.6, OL: 0.3, CB: 0.3, WR: 0.3, DT: 0.3, LB: 0, S: 0, TE: 0, RB: -0.1, K: -2.5, P: -2.8 };

/** A team's overalls by position, best first. */
export function positionDepth(league: League, teamId: number): Record<Position, number[]> {
  const out = Object.fromEntries(POSITIONS.map((pos) => [pos, [] as number[]])) as Record<Position, number[]>;
  for (const p of teamPlayers(league, teamId)) out[p.position].push(playerOvr(p));
  for (const list of Object.values(out)) list.sort((a, b) => b - a);
  return out;
}

/** An AI front office's board score for a prospect: talent, upside, position value, need. */
export function boardScore(depth: Record<Position, number[]>, p: Player, rng: Rng, round: number): number {
  const s = p.scouting!;
  let score = 0.6 * s.grade + 0.4 * s.ceiling + POSITION_PREMIUM[p.position] + rng.normal(0, 0.6);
  const mine = depth[p.position];
  if (mine.length < STARTERS[p.position] + 1) score += 1;
  else if ((mine[STARTERS[p.position] - 1] ?? 0) < Math.min(11, s.grade)) score += 0.8;
  if (mine.length >= ROSTER_TEMPLATE[p.position] + 1) score -= 1.5;
  if ((p.position === 'K' || p.position === 'P') && round < 5) score -= 3;
  return score;
}

export function aiDraftChoice(league: League, teamId: number, rng: Rng, round: number): Player {
  const pool = availableProspects(league);
  const depth = positionDepth(league, teamId);
  let best = pool[0];
  let bestScore = -Infinity;
  for (const p of pool) {
    const score = boardScore(depth, p, rng, round);
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
  for (let pick = nextPick(league); pick; pick = nextPick(league)) {
    if (opts.stopAtUser && pick.ownerId === league.userTeamId) break;
    draftPlayer(league, pick, aiDraftChoice(league, pick.ownerId, rng, pick.round));
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
