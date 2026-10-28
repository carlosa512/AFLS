/**
 * Draft day (docs/TRADES.md, section 6 and Phase 4). Teams trade picks on the clock for the reasons NFL front offices
 * give: a team trades up when the player it wants most won't last to its own pick and nobody it would take there is
 * as good (a tier break); the team on the clock trades down when it would get a player about as good later (it sees
 * a tier), when its flat chart prizes the extra pick, when it has holes to fill, or when its GM hoards picks.
 *
 * Covet is that wish in trade points: how much better a team's man at the earlier pick is, on its own board, than the
 * best it expects at the later one, as a share of the earlier pick's value on its own chart. `judge` adds it to both
 * sides' stakes in the draft, so every draft deal (the AI's, offers to you, your own proposals, counters) goes
 * through the one evaluator. Boards are each team's own (`boardOf`: its scouts' read leaned on the consensus).
 */
import { sizeBias } from '../gmTraits';
import {
  availableProspects,
  availableRanks,
  boardOf,
  boardScore,
  nextPick,
  positionDepth,
  type BoardMemo,
} from '../offseason/draft';
import { clamp } from '../rng';
import type { DraftPick, League, Player, Position } from '../types';
import { pickOf, type TradeContext } from './context';
import { teamNeeds } from './plans';
import type { TradeProposal } from './rules';
import { pickValue } from './value';

/** A switch for the checks and tests: with it on, the draft runs with no trades and covet is zero. */
export const draftTrades: { off?: boolean } = {};

/** Board points that make a full share of covet (about a round's drop in grade), and the most a pick's value grows by it. */
export const COVET_SCALE = 2;
export const COVET_MAX = 0.6;
/** The tier break a team needs before it calls about moving up: its man must stand this far above its best later. */
export const COVET_MIN = 0.8;
/** What a Pick Hoarder adds to every pick coming in, and a team with three or more holes. */
export const HOARDER_PICKS = 0.1;
export const MANY_HOLES = 0.05;
/** A need this urgent is a hole a second pick would fill. */
const HOLE = 0.6;

interface DraftMemo {
  season: number;
  /** The pick on the clock the cached reads are for: a pick made changes the board and a roster. */
  clock: number | undefined;
  boards: BoardMemo;
  ranks: Map<number, number>;
  pool: Player[];
  depth: Map<number, Record<Position, number[]>>;
  expected: Map<string, { best: Player | null; score: number }>;
}
const memos = new WeakMap<League, DraftMemo>();

/** This draft's reads, kept while the same pick is on the clock (boards for the whole draft: a view doesn't move). */
function memoOf(league: League): DraftMemo {
  const clock = nextPick(league)?.id;
  let m = memos.get(league);
  if (!m || m.season !== league.season) {
    m = {
      season: league.season,
      clock: undefined,
      boards: new Map(),
      ranks: new Map(),
      pool: [],
      depth: new Map(),
      expected: new Map(),
    };
    memos.set(league, m);
  }
  if (m.clock !== clock || !m.pool.length) {
    m.clock = clock;
    m.ranks = availableRanks(league);
    m.pool = availableProspects(league);
    m.depth.clear();
    m.expected.clear();
  }
  return m;
}

/** A front office's board score for a prospect with no pick-day noise: its own read, its depth, its GM's taste. */
export function boardBase(league: League, teamId: number, p: Player, round: number): number {
  const m = memoOf(league);
  let mine = m.boards.get(teamId);
  if (!mine) m.boards.set(teamId, (mine = new Map()));
  let board = mine.get(p.id);
  if (!board) mine.set(p.id, (board = boardOf(league, teamId, p)));
  let depth = m.depth.get(teamId);
  if (!depth) m.depth.set(teamId, (depth = positionDepth(league, teamId)));
  const gmId = league.teams[teamId].gmId;
  const bias = gmId == null || teamId === league.userTeamId ? 0 : sizeBias(league.seed, gmId);
  return boardScore(depth, p, board, null, round, bias);
}

/** Picks made before `pick` comes up, counting the one on the clock (0 for the pick on the clock). */
export function picksBefore(league: League, pick: DraftPick): number {
  const clock = nextPick(league);
  return clock && pick.overall !== undefined ? pick.overall - clock.overall! : Infinity;
}

/**
 * The best a team expects at a pick: its top board score among the prospects likely still there, those the
 * consensus ranks past the picks before it (everyone, for the pick on the clock).
 */
export function expectedAt(
  league: League,
  teamId: number,
  pick: DraftPick,
  skip?: ReadonlySet<number>,
): { best: Player | null; score: number } {
  const m = memoOf(league);
  const key = `${teamId}:${pick.id}${skip?.size ? `:${[...skip].join(',')}` : ''}`;
  const hit = m.expected.get(key);
  if (hit) return hit;
  const before = picksBefore(league, pick);
  let best: Player | null = null;
  let score = -Infinity;
  for (const p of m.pool) {
    if ((m.ranks.get(p.id) ?? Infinity) <= before || skip?.has(p.id)) continue;
    const s = boardBase(league, teamId, p, pick.round);
    if (s > score) {
      best = p;
      score = s;
    }
  }
  const out = { best, score };
  m.expected.set(key, out);
  return out;
}

const NONE = { get: 0, give: 0 };

/** This draft's unused picks among `ids`, earliest first. */
const current = (ctx: TradeContext, ids: readonly number[]) =>
  ids
    .map((id) => pickOf(ctx, id)!)
    .filter((pk) => pk && pk.season === ctx.league.season && pk.overall !== undefined && pk.playerId === undefined)
    .sort((a, b) => a.overall! - b.overall!);

/**
 * Covet for an AI team in a draft deal, in its own trade points: `get` for moving up to its man (and for picks a
 * Pick Hoarder or a team full of holes wants), `give` for passing on its man now. Zero outside the draft and for you.
 */
export function draftCovet(ctx: TradeContext, teamId: number, proposal: TradeProposal): { get: number; give: number } {
  const { league } = ctx;
  if (draftTrades.off || league.phase !== 'draft' || teamId === league.userTeamId) return NONE;
  const mine = proposal.sides.find((s) => s.teamId === teamId);
  const theirs = proposal.sides.find((s) => s.teamId !== teamId);
  if (!mine || !theirs) return NONE;
  const ins = current(ctx, theirs.picks);
  const outs = current(ctx, mine.picks);
  if (!ins.length && !outs.length) return NONE;
  const team = league.teams[teamId];
  const kept = league.draftPicks
    .filter(
      (pk) =>
        pk.ownerId === teamId &&
        pk.season === league.season &&
        pk.overall !== undefined &&
        pk.playerId === undefined &&
        !mine.picks.includes(pk.id),
    )
    .sort((a, b) => a.overall! - b.overall!)[0];
  // What its man at the earlier pick is worth over its best at the pick it would use otherwise.
  const points = (early: DraftPick, later: DraftPick | undefined) => {
    if (!later) return 0;
    const gap = expectedAt(league, teamId, early).score - expectedAt(league, teamId, later).score;
    return pickValue(league, early, team.gm, ctx) * clamp(gap / COVET_SCALE, 0, COVET_MAX);
  };
  const [eIn, eOut] = [ins[0], outs[0]];
  let get = 0;
  let give = 0;
  if (eIn && (!eOut || eIn.overall! < eOut.overall!)) get += points(eIn, eOut ?? kept);
  if (eOut && (!eIn || eOut.overall! < eIn.overall!)) give += points(eOut, eIn ?? kept);
  const coming = theirs.picks.reduce((s, id) => s + pickValue(league, pickOf(ctx, id)!, team.gm, ctx), 0);
  if (team.gm.archetype === 'Pick Hoarder') get += HOARDER_PICKS * coming;
  if (teamNeeds(ctx, team).filter((n) => n.urgency >= HOLE).length >= 3) get += MANY_HOLES * coming;
  return { get, give };
}
