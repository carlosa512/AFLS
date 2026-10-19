/**
 * What each front office thinks it is and wants (docs/TRADES.md, "Team plans"): its stance (contend,
 * bubble, retool, rebuild), its needs, who it would move (the trade block) and who it is watching
 * (interest). Everything is read on the team's own scouting, never the truth about another club's
 * players, and the head coach's job security and the GM's temperament both lean on it.
 */
import { ageShift } from '../aging';
import { chairHolder, hotSeat, ownerTrigger, teamCoaches } from '../coaching';
import { isExpired, yearsLeft } from '../finance/contract';
import { contenderScore } from '../offseason/negotiation';
import { playerOvr, ROSTER_TEMPLATE, STARTERS } from '../positions';
import { clamp } from '../rng';
import { computeRecords, conferenceSeeds, winPct, type TeamRecord } from '../season/standings';
import type { League, Player, Position, Stance, Team, TradeMarket } from '../types';
import { POSITIONS } from '../types';
import { capRoom, rosterOf, type TradeContext } from './context';
import { freshlySigned, playerTradeBlocker, salaryToTake } from './rules';
import { POSITION_TRADE, readPlayer, salaryWeight, TRADE_BAND } from './value';

// ───────── stance ─────────

/** Regular-season games: how far into the race a team is. */
const GAMES = 17;

const recordsOf = (ctx: TradeContext): Map<number, TeamRecord> => (ctx.records ??= computeRecords(ctx.league));

/** Last season's final record, or null in a league's first year. */
function lastRecord(league: League, teamId: number) {
  return league.history.find((h) => h.season === league.season - 1)?.records[teamId] ?? null;
}

/**
 * The playoff race, −1 (out of it) … 1 (in comfortably): games ahead of or behind the conference's
 * last seed against the games left, blended with the roster's strength while few games are played.
 */
function race(ctx: TradeContext, team: Team): number {
  const { league } = ctx;
  const roster = 2 * contenderScore(league, team.id) - 1;
  if (league.phase !== 'regular') {
    const last = lastRecord(league, team.id);
    return last ? 0.25 * (2 * winPct(last.w, last.l, last.t) - 1) : 0;
  }
  const records = recordsOf(ctx);
  const me = records.get(team.id)!;
  const played = me.w + me.l + me.t;
  if (!played) return roster;
  const seeds = (ctx.seeds ??= new Map()).get(team.conference) ?? conferenceSeeds(league, team.conference, records);
  ctx.seeds.set(team.conference, seeds);
  const net = (id: number) => records.get(id)!.w - records.get(id)!.l;
  // In: the lead over the best team outside; out: the deficit to the last seed. Two games a "game".
  const outside = league.teams.filter((t) => t.conference === team.conference && !seeds.includes(t.id)).map((t) => net(t.id));
  const edge = seeds.includes(team.id) ? (net(team.id) - Math.max(...outside)) / 2 : (net(team.id) - net(seeds[seeds.length - 1])) / 2;
  const standing = clamp(edge / (1 + 0.25 * (GAMES - played)), -1, 1);
  const share = Math.min(1, played / GAMES);
  return share * standing + (1 - share) * roster;
}

/** The stance score, −1 (tear it down) … 1 (all in). */
export function stanceScore(ctx: TradeContext, team: Team): number {
  const { league } = ctx;
  const r = race(ctx, team);
  let s = 0.4 * (2 * contenderScore(league, team.id) - 1) + 0.4 * r + 0.2 * (2 * team.gm.winNow - 1);
  const hc = chairHolder(teamCoaches(league, team.id), { role: 'headCoach' });
  if (hc) {
    // A coach fighting for his job pushes to buy while there's a race to win; once it's gone, the sell-off starts.
    if (league.phase === 'regular') {
      const rec = recordsOf(ctx).get(team.id)!;
      const heat = hotSeat(rec, league.season - (hc.since ?? league.season)) * ownerTrigger(league, team.id);
      if (heat >= 0.3) s += r > -0.3 ? 0.1 : -0.1;
    }
    // A first-year head coach is building.
    if (hc.since === league.season) s -= 0.05;
  }
  const roster = rosterOf(ctx, team.id);
  const starters = POSITIONS.flatMap((pos) => team.depthChart[pos].slice(0, STARTERS[pos]).map((id) => league.players[id]).filter((p) => p && p.teamId === team.id));
  const age = starters.reduce((a, p) => a + p.age, 0) / Math.max(1, starters.length);
  if (age >= 28.5 && s < 0) s -= 0.1;
  // Without a quarterback there's nothing to push for.
  const qb = Math.max(0, ...roster.filter((p) => p.position === 'QB').map(playerOvr));
  if (qb < 12) s -= 0.1;
  return clamp(s, -1, 1);
}

/** Bands with a dead zone: a contender stays one until it slips below 0.2, a rebuilder until it climbs above −0.2. */
export function stanceFor(score: number, prev?: Stance): Stance {
  if (score >= 0.3 || (prev === 'contend' && score >= 0.2)) return 'contend';
  if (score < -0.3 || (prev === 'rebuild' && score <= -0.2)) return 'rebuild';
  return score >= 0 ? 'bubble' : 'retool';
}

/** Re-read every AI team's stance for this market moment, keeping the dead band's memory. */
export function updateStances(ctx: TradeContext): void {
  const { league } = ctx;
  for (const team of league.teams) {
    if (team.id === league.userTeamId) continue;
    const mode = stanceFor(stanceScore(ctx, team), team.stance?.mode);
    if (team.stance?.mode !== mode) team.stance = { mode, since: league.season };
  }
}

export const stanceOf = (team: Team): Stance => team.stance?.mode ?? 'bubble';
export const isBuyer = (team: Team) => stanceOf(team) === 'contend' || stanceOf(team) === 'bubble';
export const isSeller = (team: Team) => !isBuyer(team);

// ───────── needs ─────────

export interface Need {
  position: Position;
  /** 0 … 1: a hole in the lineup is 1. */
  urgency: number;
  reason: 'hole' | 'upgrade' | 'nextYear';
}

/** How much a need at a position weighs: quarterbacks and pass rushers most, specialists least. */
const NEED_WEIGHT = Object.fromEntries(POSITIONS.map((p) => [p, Math.sqrt(POSITION_TRADE[p])])) as Record<Position, number>;

/** Healthy enough to count in the lineup: not on reserve, not out a month. */
const healthy = (league: League, p: Player) => !p.ir && !(league.phase === 'regular' && p.injury && p.injury.estimate[0] >= 4);

/** The league's median starter at each position: the bar a team's weakest starter is measured against. */
export function starterLine(ctx: TradeContext): Record<Position, number> {
  if (ctx.starterLine) return ctx.starterLine;
  const line = {} as Record<Position, number>;
  for (const pos of POSITIONS) {
    const all = ctx.league.teams.flatMap((t) =>
      rosterOf(ctx, t.id)
        .filter((p) => p.position === pos)
        .map(playerOvr)
        .sort((a, b) => b - a)
        .slice(0, STARTERS[pos]),
    );
    all.sort((a, b) => a - b);
    line[pos] = all[all.length >> 1] ?? 10;
  }
  return (ctx.starterLine = line);
}

const underContract = (league: League, p: Player) => !!p.contract && !isExpired(p.contract, league.season);

/** What a team needs, most urgent first, on its own (exact) knowledge of its roster. */
export function teamNeeds(ctx: TradeContext, team: Team): Need[] {
  const memo = (ctx.needs ??= new Map()).get(team.id);
  if (memo) return memo;
  const { league } = ctx;
  const line = starterLine(ctx);
  const out: Need[] = [];
  const lookAhead = league.phase !== 'regular' || league.week >= 6;
  for (const pos of POSITIONS) {
    const room = rosterOf(ctx, team.id).filter((p) => p.position === pos && underContract(league, p));
    const fit = room.filter((p) => healthy(league, p)).sort((a, b) => playerOvr(b) - playerOvr(a));
    const S = STARTERS[pos];
    let need: Need | null = null;
    if (fit.length < S) need = { position: pos, urgency: 1, reason: 'hole' };
    else {
      const gap = line[pos] + 0.5 - playerOvr(fit[S - 1]);
      if (gap > 0) need = { position: pos, urgency: clamp(gap / 3, 0, 1) * NEED_WEIGHT[pos], reason: 'upgrade' };
    }
    // Starters whose deals end this year are next year's holes.
    if (!need && lookAhead && fit.slice(0, S).some((p) => yearsLeft(p.contract!, league.season) <= 1)) need = { position: pos, urgency: 0.3 * NEED_WEIGHT[pos], reason: 'nextYear' };
    if (need && need.urgency > 0.1) out.push(need);
  }
  out.sort((a, b) => b.urgency - a.urgency);
  ctx.needs.set(team.id, out);
  return out;
}

// ───────── the trade block ─────────

export interface BlockEntry {
  playerId: number;
  reason: 'surplus' | 'expiring' | 'veteran' | 'overpaid';
  /** 0 … 1: how keen the team is to move him. */
  keenness: number;
}

/**
 * Players a team won't discuss: a contender's starting quarterback, and its best young players (by
 * the overall it knows exactly) for a loyal GM, the most loyal keeping four, the least one. Worked
 * out once per team and pass.
 */
export function untouchables(ctx: TradeContext, team: Team): Set<number> {
  const memo = (ctx.untouchables ??= new Map()).get(team.id);
  if (memo) return memo;
  const { league } = ctx;
  const roster = rosterOf(ctx, team.id);
  const out = new Set<number>();
  const qbs = roster.filter((p) => p.position === 'QB').sort((a, b) => playerOvr(b) - playerOvr(a));
  if (qbs[0] && isBuyer(team) && playerOvr(qbs[0]) >= 14) out.add(qbs[0].id);
  if (team.gm.loyalty >= 0.5) {
    roster
      .filter((q) => q.age <= 25 && underContract(league, q))
      .map((q) => ({ q, v: playerOvr(q) }))
      .sort((a, b) => b.v - a.v)
      .slice(0, Math.round(1 + 3 * team.gm.loyalty))
      .forEach((x) => out.add(x.q.id));
  }
  ctx.untouchables.set(team.id, out);
  return out;
}

export const untouchable = (ctx: TradeContext, team: Team, p: Player) => untouchables(ctx, team).has(p.id);

/** Who a team would move and how keenly, on its own exact read of its roster. */
export function tradeBlock(ctx: TradeContext, team: Team): BlockEntry[] {
  const memo = (ctx.blocks ??= new Map()).get(team.id);
  if (memo) return memo;
  const { league } = ctx;
  const mode = stanceOf(team);
  const inSeason = league.phase === 'regular';
  const line = starterLine(ctx);
  const tight = salaryWeight(ctx, team.id) >= 1.15;
  const roster = rosterOf(ctx, team.id).filter((p) => underContract(league, p) && !playerTradeBlocker(league, p) && !freshlySigned(league, p, team.id));
  const rank = new Map<number, number>();
  for (const pos of POSITIONS) roster.filter((p) => p.position === pos).sort((a, b) => playerOvr(b) - playerOvr(a)).forEach((p, i) => rank.set(p.id, i));
  const out: BlockEntry[] = [];
  const keep = untouchables(ctx, team);
  for (const p of roster) {
    if (keep.has(p.id)) continue;
    const r = rank.get(p.id)!;
    const S = STARTERS[p.position];
    const left = yearsLeft(p.contract!, league.season);
    const add = (reason: BlockEntry['reason'], keenness: number) => {
      const had = out.find((e) => e.playerId === p.id);
      if (!had) out.push({ playerId: p.id, reason, keenness });
      else if (keenness > had.keenness) Object.assign(had, { reason, keenness });
    };
    if (left <= 1 && p.age >= 26 && (mode === 'retool' || mode === 'rebuild')) add('expiring', inSeason ? 0.8 : 0.45);
    if (mode === 'rebuild' && p.age - ageShift(p.position) >= 28) add('veteran', 0.6);
    if (r >= ROSTER_TEMPLATE[p.position] || (p.position === 'QB' && r >= 2)) add('surplus', 0.4);
    else if (r >= S && playerOvr(p) >= line[p.position]) add('surplus', 0.5);
    // Only a big salary can be a burden worth paying to move: one well above what the market pays a player of his rank.
    if (tight && salaryToTake(league, p) > 0.015 * league.caps[league.season]) {
      const read = readPlayer(ctx, team, p);
      if (salaryWeight(ctx, team.id) * (read.pay - read.cost) < -80) add('overpaid', 0.75);
    }
  }
  out.sort((a, b) => b.keenness - a.keenness);
  ctx.blocks.set(team.id, out);
  return out;
}

// ───────── interest ─────────

/** Market moments before interest nobody acts on fades a level. */
const FADE = 3;
/** Most players one team watches at a time. */
const WATCH = 3;

export interface Wanted {
  team: Team;
  player: Player;
  score: number;
}

/**
 * The block players a team would want, best first: at a position it needs (its two most pressing
 * needs, and nobody it's merely carrying as depth, when it's shopping the whole league), an upgrade
 * on its own bounded read, known well enough to judge (its pro scouts have film on him) and a salary
 * it can take on.
 */
export function wanted(ctx: TradeContext, team: Team, from: readonly { team: Team; entry: BlockEntry }[], opts: { memo?: boolean } = {}): Wanted[] {
  if (opts.memo) {
    const hit = (ctx.wanted ??= new Map()).get(team.id);
    if (hit) return hit;
  }
  const { league } = ctx;
  const room = capRoom(ctx, team.id);
  const out: Wanted[] = [];
  const needs = teamNeeds(ctx, team);
  for (const need of opts.memo ? needs.slice(0, 2) : needs) {
    const mine = rosterOf(ctx, team.id)
      .filter((p) => p.position === need.position && healthy(league, p))
      .map(playerOvr)
      .sort((a, b) => b - a);
    const bar = mine[STARTERS[need.position] - 1] ?? 0;
    for (const { team: seller, entry } of from) {
      if (seller.id === team.id || (opts.memo && entry.keenness <= 0.4)) continue;
      const p = league.players[entry.playerId];
      if (p.position !== need.position || salaryToTake(league, p) > room) continue;
      // Its read of him is bounded within TRADE_BAND of the truth (`readPlayer`): no read can make an
      // upgrade of a player this far short of the bar, so skip the scouting pass.
      if (playerOvr(p) + TRADE_BAND - bar < 0.5) continue;
      if (ctx.view(team.id, p).knowledge < 0.35) continue;
      const gain = readPlayer(ctx, team, p).ovr - bar;
      if (gain < 0.5) continue;
      out.push({ team: seller, player: p, score: need.urgency * Math.min(gain, 4) * (0.5 + entry.keenness) });
    }
  }
  out.sort((a, b) => b.score - a.score);
  if (opts.memo) ctx.wanted!.set(team.id, out);
  return out;
}

/** Raise buyers' interest in what each wants most this moment; let the rest fade (sellers do their selling by calling buyers). */
export function updateInterest(ctx: TradeContext, market: TradeMarket, teams: readonly Team[], from: readonly { team: Team; entry: BlockEntry }[]): void {
  for (const team of teams.filter(isBuyer)) {
    for (const { player } of wanted(ctx, team, from, { memo: true }).slice(0, WATCH)) {
      const had = market.interest.find((x) => x.teamId === team.id && x.playerId === player.id);
      if (had) Object.assign(had, { level: Math.min(3, had.level + 1), at: market.moment });
      else market.interest.push({ teamId: team.id, playerId: player.id, level: 1, at: market.moment });
    }
  }
  for (const x of market.interest) if (market.moment - x.at >= FADE) Object.assign(x, { level: x.level - 1, at: market.moment });
  market.interest = market.interest.filter((x) => x.level > 0 && ctx.league.players[x.playerId]?.teamId !== x.teamId).slice(-300);
}

export const interestIn = (market: TradeMarket, teamId: number, playerId: number) => market.interest.find((x) => x.teamId === teamId && x.playerId === playerId)?.level ?? 0;
