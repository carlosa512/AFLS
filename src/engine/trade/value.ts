/**
 * What things are worth in a trade, on one scale: draft-chart points (docs/TRADES.md, "Value v2").
 *
 * - Picks: a blend of the Jimmy Johnson (steep) and Fitzgerald-Spielberger (flat) charts by GM style,
 *   future picks discounted per year and projected from team strength, never a flat "mid-round"
 *   guess (the bad-team future-first exploit).
 * - Players: talent × control × lens and the market's pay for it, counted by the role he'd have on
 *   *this* depth chart, less the salary still owed, weighed by the club's cap room. Talent is his game as the club reads it,
 *   control the seasons it holds him (this one only for what's left of it), the lens how a contender
 *   or a rebuilder weighs a veteran. A star behind a star adds little; a starter for a team with a
 *   hole adds all of him.
 * - Market value: the same through a league-average lens, what the league would pay. Sellers hold
 *   out for most of it, so a starter never goes for a seventh-round pick.
 */
import { ageShift } from '../aging';
import { paidShare, weeksPaid } from '../finance/cap';
import { isExpired, yearsLeft } from '../finance/contract';
import { marketApy, minSalary } from '../finance/market';
import { contenderScore } from '../offseason/negotiation';
import { playerOvr, ROSTER_TEMPLATE, STARTERS } from '../positions';
import { characterRead, projectedCeiling, quirkWorth, trueQuirkWorth } from '../scouting';
import { clamp } from '../rng';
import { teamRatings } from '../roster';
import { computeRecords, winPct } from '../season/standings';
import type { DraftPick, GmTraits, League, Player, Position, Team } from '../types';
import { capRoom, rosterOf, tradeContext, type TradeContext } from './context';

// ───────── pick value ─────────

const JJ: [number, number][] = [
  [1, 3000], [2, 2600], [3, 2200], [4, 1800], [5, 1700], [10, 1300], [16, 1000], [20, 850], [24, 740], [28, 660],
  [32, 590], [33, 580], [48, 420], [64, 270], [96, 116], [141, 36], [200, 11], [257, 2],
];
const FS: [number, number][] = [[1, 3000], [32, 1244], [33, 1228], [141, 492], [200, 315], [257, 200]];

/** Log-linear interpolation between chart anchors. */
function chart(anchors: [number, number][], pick: number): number {
  const p = clamp(pick, 1, 257);
  for (let i = 1; i < anchors.length; i++) {
    const [x1, y1] = anchors[i];
    const [x0, y0] = anchors[i - 1];
    if (p <= x1) {
      const t = (p - x0) / (x1 - x0);
      return Math.exp(Math.log(y0) + t * (Math.log(y1) - Math.log(y0)));
    }
  }
  return anchors[anchors.length - 1][1];
}

export const jimmyJohnson = (pick: number) => chart(JJ, pick);
export const fitzgeraldSpielberger = (pick: number) => chart(FS, pick);

/**
 * A GM's value for a pick slot: old-school GMs lean on the steep chart, analytics GMs toward the flat
 * one. The blend is geometric, so the flat chart bends the curve without becoming another currency:
 * players are valued on the steep chart's scale, and an arithmetic blend made a seventh-round pick
 * worth a starter to an analytics GM (about 220 points). Here a seventh is about 11 points to an
 * old-school GM and 33 to an analytics one, who still prizes Day 2 (No. 48: about 1.5 times as much).
 */
export function pickChartValue(overall: number, gm: Pick<GmTraits, 'pickChart'>): number {
  const flat = gm.pickChart === 'johnson' ? 0.1 : 0.4;
  return Math.exp((1 - flat) * Math.log(jimmyJohnson(overall)) + flat * Math.log(fitzgeraldSpielberger(overall)));
}

/** The next draft to be held: this league year's until it happens, then next year's. */
export function nextDraftSeason(league: League): number {
  const before = league.phase === 'resign' || league.phase === 'freeAgency' || league.phase === 'draft';
  return before ? league.season : league.season + 1;
}

/** Each team's draft-order score from record and roster strength: the lower, the earlier it picks. */
function draftScores(league: League): number[] {
  const records = computeRecords(league);
  const played = [...records.values()].some((r) => r.w + r.l + r.t > 0);
  return league.teams.map((t) => {
    const r = records.get(t.id)!;
    const s = (teamRatings(league, t).overall - 12.5) / 2;
    return played && league.phase === 'regular' ? 0.6 * (winPct(r.w, r.l, r.t) - 0.5) * 4 + 0.4 * s : s;
  });
}

/**
 * Scores for callers without a context (pick labels on a screen), kept until the calendar moves or a
 * roster move is logged. AI decisions always bring their own context, so they never read this.
 */
const scoreCache = new WeakMap<League, { key: string; scores: number[] }>();
function scoresFor(league: League, ctx?: TradeContext): number[] {
  if (ctx) return (ctx.slotScores ??= draftScores(league));
  const last = league.transactions[league.transactions.length - 1];
  const key = `${league.season}:${league.phase}:${league.week}:${league.faDay}:${league.transactions.length}:${last?.text ?? ''}`;
  const hit = scoreCache.get(league);
  if (hit && hit.key === key) return hit.scores;
  const scores = draftScores(league);
  scoreCache.set(league, { key, scores });
  return scores;
}

/** Where a team's pick is expected to land in each round (1 = first), from record and roster strength. */
export function projectedSlot(league: League, teamId: number, draftSeason: number, ctx?: TradeContext): number {
  const scores = scoresFor(league, ctx);
  const rank = scores.filter((s) => s < scores[teamId]).length + 1;
  // Further-out drafts regress toward the middle: rosters change.
  const yearsOut = Math.max(0, draftSeason - nextDraftSeason(league));
  return Math.round(16.5 + (rank - 16.5) * 0.6 ** yearsOut);
}

export function pickOverall(league: League, pick: DraftPick, ctx?: TradeContext): number {
  return pick.overall ?? (pick.round - 1) * 32 + projectedSlot(league, pick.originalTeamId, pick.season, ctx);
}

/** A pick's value to `gm`: chart value at its (projected) slot, discounted per year out. */
export function pickValue(league: League, pick: DraftPick, gm: GmTraits, ctx?: TradeContext): number {
  const yearsOut = Math.max(0, pick.season - nextDraftSeason(league));
  return pickChartValue(pickOverall(league, pick, ctx), gm) * (1 - gm.futureDiscount) ** yearsOut;
}

export const pickLabel = (league: League, pick: DraftPick) =>
  `${pick.season} round ${pick.round}${pick.overall ? ` (No. ${pick.overall})` : ` (proj. No. ${pickOverall(league, pick)})`}${pick.originalTeamId !== pick.ownerId ? ` · via ${league.teams[pick.originalTeamId].abbrev}` : ''}`;

// ───────── player value ─────────

const POSITION_TRADE: Record<Position, number> = { QB: 1, EDGE: 0.75, WR: 0.7, CB: 0.65, DT: 0.65, OL: 0.6, LB: 0.45, S: 0.45, TE: 0.45, RB: 0.4, K: 0.1, P: 0.08 };
/**
 * Pick-chart points per $1K of contract surplus: $40K ≈ one point, so a dead $16M contract costs about
 * a second-round pick to move (the Texans paid one, plus a sixth, to send Brock Osweiler to Cleveland).
 */
const POINTS_PER_K = 1 / 40;
/**
 * A front office trusts its read of another team's player halfway, and never by more than this many
 * overall points either way. Shopping a player to 31 teams finds the one that likes him most, as it
 * should, but for at most about 20% more value, not a fantasy price.
 */
const TRADE_TRUST = 0.5;
const TRADE_BAND = 0.35;
/** Seasons of control, weighted: next year counts less than this one, the year after less again. */
const CONTROL = [1, 0.75, 0.55];
const CONTROL_FULL = CONTROL.reduce((a, b) => a + b, 0);
/** The exclusive re-sign window on a deal that ends this league year, in shares of full control. */
const RIGHTS = 0.15;
/** How a room counts its players, best first: starters in full, the top backup at 0.35, the rest of a normal room at 0.2, extras barely. */
const BACKUP = 0.35;
const DEPTH = 0.2;
const CLUTTER = 0.05;

/** Talent plus half the room left to grow, for a player 25 or younger. */
const effective = (age: number, ovr: number, pot: number) => ovr + (age <= 25 ? Math.max(0, pot - ovr) * 0.5 : 0);

function ageMultiplier(p: Player): number {
  const a = p.age - ageShift(p.position);
  if (a <= 25) return 1.15;
  if (a <= 28) return 1;
  return Math.max(0.3, 1 - (a - 28) * 0.15);
}

/** Share of this league year's football still to be played: all of it in the offseason, none once the regular season is done. */
export function seasonShare(league: League): number {
  if (league.phase === 'regular') return clamp(1 - weeksPaid(league) / 18, 0, 1);
  if (league.phase === 'playoffs' || league.phase === 'complete') return 0;
  return 1;
}

/**
 * The control a contract gives, as a share of three full seasons: this one only for what's left of
 * it, and an expiring deal adds the re-sign window. A full offseason reads about 0.6 for one year
 * left, 0.76 for two and 1 for three or more; an expiring veteran at the deadline about 0.37.
 */
export function control(league: League, p: Player): number {
  const c = p.contract;
  if (!c || isExpired(c, league.season)) return 0;
  const left = Math.min(CONTROL.length, yearsLeft(c, league.season));
  let w = CONTROL[0] * seasonShare(league);
  for (let i = 1; i < left; i++) w += CONTROL[i];
  return w / CONTROL_FULL + (left <= 1 ? RIGHTS : 0);
}

/** Effective contention focus: the GM's temperament nudged by where the roster actually is. */
const winNowOf = (league: League, team: Team) => clamp(team.gm.winNow * 0.6 + contenderScore(league, team.id) * 0.4, 0, 1);

/** A player as one front office reads him. */
export interface PlayerRead {
  id: number;
  /** The overall it ranks him at: exact for its own players, its bounded read of anyone else's. */
  ovr: number;
  /** Talent × control: what his play is worth over the seasons it would hold him. */
  base: number;
  /** The contender's premium on a veteran, or the rebuilder's discount. */
  lens: number;
  /** His contract (`contractTerms`): the market's pay for a player of his rank, and the salary still owed. */
  pay: number;
  cost: number;
}

/**
 * `team`'s read of a player. `truth` reads his real ratings instead (for tests and analysis, never
 * for AI decisions). Memoized in the context: a read doesn't change within a pass.
 */
export function readPlayer(ctx: TradeContext, team: Team, p: Player, truth = false): PlayerRead {
  const key = p.id * 128 + team.id * 2 + (truth ? 1 : 0);
  const memo = (ctx.reads ??= new Map()).get(key);
  if (memo) return memo;
  const { league } = ctx;
  const own = playerOvr(p);
  const young = p.age <= 25;
  // His real game: today's overall, half the growth his work ethic will really get out of him, his habits.
  const real = effective(p.age, own, young ? projectedCeiling(own, p.potential, p.traits.workEthic) : p.potential) + trueQuirkWorth(p);
  let seen = real;
  let ovr = own;
  if (!truth) {
    // What this front office sees: exact for its own players (bar their ceilings), its scouts' read for anyone else.
    const view = ctx.view(team.id, p);
    const readWork = young ? characterRead(league, team.id, p)?.workEthic : undefined;
    const misread = effective(p.age, view.ovr, young ? projectedCeiling(view.ovr, view.potMid, readWork) : view.potMid) + quirkWorth(league, team.id, p) - real;
    seen = real + clamp(TRADE_TRUST * misread, -TRADE_BAND, TRADE_BAND);
    // His place on its depth chart is judged the same bounded way.
    ovr = own + clamp(TRADE_TRUST * (view.ovr - own), -TRADE_BAND, TRADE_BAND);
  }
  const base = 3000 * Math.exp((seen - 18.5) * 0.55) * POSITION_TRADE[p.position] * ageMultiplier(p) * control(league, p);
  // Contenders pay for proven veterans; rebuilders don't.
  const lens = p.age >= 27 ? 1 + 0.4 * (winNowOf(league, team) - 0.5) : 1;
  const read = { id: p.id, ovr, base, lens, ...contractTerms(ctx, p) };
  ctx.reads.set(key, read);
  return read;
}

/** How a room counts a player at a (fractional) depth-chart rank: in full as a starter, 0.35 as the top backup, 0.2 deeper in a normal room, barely past it. */
function roleAt(rank: number, pos: Position): number {
  const at = (k: number) => (k < STARTERS[pos] ? 1 : k === STARTERS[pos] ? BACKUP : k < ROSTER_TEMPLATE[pos] ? DEPTH : CLUTTER);
  const k = Math.floor(rank);
  return at(k) + (at(k + 1) - at(k)) * (rank - k);
}

/**
 * Overall points over which a depth-chart battle is a coin flip. Two players a fraction of a point
 * apart share the job in proportion, so a misread of a few tenths moves a player's value a little,
 * never across a cliff: shopping him to 31 teams can't find one that thinks he's a starter by a hair.
 */
const RANK_SPREAD = 0.75;

/**
 * What a room of players at one position is worth to its team: each player's play and the market's
 * pay for it in the role he'd have (his soft rank on its own read), less the salary owed whatever
 * his role, weighed by the team's `salaryWeight`. A starter on a cheap deal is a bargain; the same
 * deal on the bench is money spent on a backup.
 */
function roomValue(reads: readonly PlayerRead[], pos: Position, w: number): number {
  let value = 0;
  for (const r of reads) {
    let rank = 0;
    for (const o of reads) if (o !== r) rank += 1 / (1 + Math.exp((r.ovr - o.ovr) / RANK_SPREAD));
    value += roleAt(rank, pos) * (r.base * r.lens + w * r.pay) - w * r.cost;
  }
  return value;
}

/** A team's players at a position who are under contract, as it reads them. */
export function roomOf(ctx: TradeContext, team: Team, pos: Position, truth = false): PlayerRead[] {
  const season = ctx.league.season;
  return rosterOf(ctx, team.id)
    .filter((p) => p.position === pos && p.contract && !isExpired(p.contract, season))
    .map((p) => readPlayer(ctx, team, p, truth));
}

/**
 * A contract in points over (at most) the next four years, discounted 10% a year: `pay` is what the
 * market pays a player of his rank, `cost` the base salary still owed (the bonus stays behind in a
 * trade), both above the league minimum, this year only for what's left of it.
 */
function contractTerms(ctx: TradeContext, p: Player): { pay: number; cost: number } {
  const { league } = ctx;
  const c = p.contract;
  if (!c || isExpired(c, league.season)) return { pay: 0, cost: 0 };
  const market = marketApy(ctx.market, p);
  const min = minSalary(p.experience, ctx.market.cap);
  const share = seasonShare(league);
  let pay = 0;
  let cost = 0;
  for (let i = 0; i < Math.min(4, yearsLeft(c, league.season)); i++) {
    const base = c.years.find((y) => y.season === league.season + i)?.base ?? 0;
    const d = 0.9 ** i;
    pay += (market - min) * (i === 0 ? share : 1) * d;
    cost += (i === 0 ? base * (1 - paidShare(league, c)) - min * share : base - min) * d;
  }
  return { pay: pay * POINTS_PER_K, cost: cost * POINTS_PER_K };
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

/**
 * How much a dollar of salary weighs for a team, from its cap room this year and next against the
 * league's median: 1 for a typical team, down to 0.5 for one with room to burn, up to 2 for one
 * squeezed against the cap. A team in cap trouble pays to move a contract; a rich one takes it on for
 * a pick (the Osweiler trade).
 */
export function salaryWeight(ctx: TradeContext, teamId: number): number {
  if (!ctx.salaryWeights) {
    const { league } = ctx;
    const now = league.teams.map((t) => capRoom(ctx, t.id));
    const next = league.teams.map((t) => capRoom(ctx, t.id, league.season + 1));
    const [mNow, mNext] = [median(now), median(next)];
    const scale = 0.08 * league.caps[league.season];
    ctx.salaryWeights = league.teams.map((_, i) => clamp(1 - (0.5 * (now[i] - mNow) + 0.5 * (next[i] - mNext)) / scale, 0.5, 2));
  }
  return ctx.salaryWeights[teamId];
}

/**
 * What a player is worth to `team` in pick-chart points, as its front office sees him: the room at
 * his position with him against without him, plus his contract. `truth` values him on his real
 * ratings instead (for tests and analysis, never for AI decisions).
 */
export function playerValue(league: League, player: Player, team: Team, opts: { truth?: boolean; ctx?: TradeContext } = {}): number {
  if (!player.contract || isExpired(player.contract, league.season)) return 0;
  const ctx = opts.ctx ?? tradeContext(league);
  const truth = !!opts.truth;
  const others = roomOf(ctx, team, player.position, truth).filter((r) => r.id !== player.id);
  const me = readPlayer(ctx, team, player, truth);
  const w = salaryWeight(ctx, team.id);
  return roomValue([...others, me], player.position, w) - roomValue(others, player.position, w);
}

/**
 * A player's stakes to `team`: his play as a starter and what the market would pay for it, before his
 * own salary (a fixed bill whoever reads him). The scale a misread of him is measured against.
 */
export function grossWorth(ctx: TradeContext, team: Team, player: Player, truth = false): number {
  const r = readPlayer(ctx, team, player, truth);
  return r.base * r.lens + salaryWeight(ctx, team.id) * r.pay;
}

/** How a team's player moves change its rooms and books: what it loses by sending `out`, and gains by taking `inc` in their place. */
export function playerSwing(ctx: TradeContext, team: Team, out: readonly number[], inc: readonly number[], truth = false): { loss: number; gain: number } {
  const { league } = ctx;
  const gone = new Set(out);
  const incoming = inc.map((id) => league.players[id]);
  const positions = new Set<Position>([...out.map((id) => league.players[id].position), ...incoming.map((p) => p.position)]);
  const w = salaryWeight(ctx, team.id);
  let before = 0;
  let kept = 0;
  let after = 0;
  for (const pos of positions) {
    const room = roomOf(ctx, team, pos, truth);
    const stay = room.filter((r) => !gone.has(r.id));
    const arrive = incoming.filter((p) => p.position === pos).map((p) => readPlayer(ctx, team, p, truth));
    before += roomValue(room, pos, w);
    kept += roomValue(stay, pos, w);
    after += roomValue([...stay, ...arrive], pos, w);
  }
  return { loss: before - kept, gain: after - kept };
}

/**
 * What the league would pay for a player, on `team`'s read of him (`truth`: on his real ratings): no
 * need, no contender's premium, a typical team's cap. A player good enough to start for most teams
 * counts as a starter; a backup anywhere counts as one.
 */
export function marketValue(ctx: TradeContext, team: Team, p: Player, truth = false): number {
  if (!p.contract || isExpired(p.contract, ctx.league.season)) return 0;
  const read = readPlayer(ctx, team, p, truth);
  const S = STARTERS[p.position];
  const rank = ctx.market.ovrs[p.position].filter((o) => o > read.ovr + 1e-9).length;
  const role = BACKUP + (1 - BACKUP) * clamp((40 * S - rank) / (16 * S), 0, 1);
  return role * (read.base + read.pay) - read.cost;
}
