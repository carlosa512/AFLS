/**
 * Trade market audit (docs/TRADES.md, "Checks"). Plays leagues and checks:
 *
 * 1. Prices: before the season and on deadline day, what a buyer pays for each kind of player. For
 *    every sampled player the buyer is the team that values him most among those he'd start for and
 *    that can take his salary; the price is the cheapest package of its picks that both GMs accept
 *    (`judge`), in Jimmy Johnson points at the picks' projected slots, future picks discounted 25% a
 *    year. Medians by bucket, against the NFL's prices.
 * 2. Future picks: the current pick a typical team's first next year is worth, GM by GM (the NFL's
 *    rule of thumb: a round later, so a late first to an early second).
 * 3. Fairness and health: every AI trade the leagues make, valued in the truth for both sides, and
 *    both teams under the cap and full at every position afterwards.
 * 4. Probes: the exploits other games shipped (junk for a star, stacked firsts, contract dumps,
 *    sign and flip, buying straight back), each of which must fail.
 * 5. Speed: one verdict with a warm cache, one week of the market.
 *
 *   npm run trades          # 2 leagues, 3 seasons each
 *   npm run trades -- 4
 *
 * ▲/▼ marks a number outside its band; the last line counts them and the process exits 1 if any are.
 */
import { ageShift } from '../src/engine/aging';
import { capSpace } from '../src/engine/finance/cap';
import { yearsLeft } from '../src/engine/finance/contract';
import { createLeague } from '../src/engine/generate';
import { gamesInWeek, playWeek, simToEndOfSeason } from '../src/engine/league';
import { simOffseason } from '../src/engine/offseason';
import { freeAgents, signPlayer } from '../src/engine/offseason/negotiation';
import { playerOvr, STARTERS } from '../src/engine/positions';
import { Rng } from '../src/engine/rng';
import { teamPlayers } from '../src/engine/roster';
import {
  aiTradeWeek,
  evaluateTrade,
  executeTrade,
  fitzgeraldSpielberger,
  isDeadlineDay,
  jimmyJohnson,
  judge,
  marketValue,
  nextDraftSeason,
  pickChartValue,
  pickOverall,
  pickValue,
  playerTradeBlocker,
  playerValue,
  rosterOf,
  salaryToTake,
  capRoom,
  tradeContext,
  type TradeContext,
  type TradeProposal,
} from '../src/engine/trade';
import type { DraftPick, GmTraits, League, Player, Position } from '../src/engine/types';
import { POSITIONS } from '../src/engine/types';

const LEAGUES = Number(process.argv.slice(2).find((a) => !a.startsWith('-')) ?? 2);
/** `--verbose`: every priced player and every AI trade, not just one example per bucket. */
const VERBOSE = process.argv.includes('--verbose');
const SEASONS = 3;

let misses = 0;
const check = (label: string, value: number, [lo, hi]: [number, number], digits = 0) => {
  const ok = Number.isFinite(value) && value >= lo && value <= hi;
  if (!ok) misses++;
  const range = lo === -Infinity ? `≤${hi}` : hi === Infinity ? `≥${lo}` : `${lo}–${hi}`;
  console.log(`  ${label.padEnd(52)} ${Number.isFinite(value) ? value.toFixed(digits).padStart(8) : '     n/a'}   ${range}${ok ? '' : !Number.isFinite(value) || value < lo ? '  ▼ LOW' : '  ▲ HIGH'}`);
};
const median = (xs: number[]) => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
const clone = (l: League): League => JSON.parse(JSON.stringify(l));
const name = (p: Player) => `${p.position} ${p.firstName[0]}. ${p.lastName}`;

// ───────── 1. Prices ─────────

type Bucket = 'star' | 'quality' | 'rental' | 'depth';
const PREMIUM: ReadonlySet<Position> = new Set(['QB', 'EDGE', 'WR', 'CB', 'DT', 'OL']);

/** Each rostered player's true rank at his position (0 = the league's best). */
function ranks(league: League): Map<number, number> {
  const out = new Map<number, number>();
  for (const pos of POSITIONS) {
    const list = Object.values(league.players).filter((p) => p.teamId !== null && p.position === pos && p.contract);
    list.sort((a, b) => playerOvr(b) - playerOvr(a)).forEach((p, i) => out.set(p.id, i));
  }
  return out;
}

function bucketOf(league: League, p: Player, rank: number): Bucket | null {
  if (p.position === 'K' || p.position === 'P' || !p.contract || playerTradeBlocker(league, p)) return null;
  const S = STARTERS[p.position];
  const left = yearsLeft(p.contract, league.season);
  if (rank < 3 && PREMIUM.has(p.position) && p.age <= 28 && left >= 2) return 'star';
  if (rank < 8 * S && left <= 2 && p.age <= 30) return 'quality';
  if (rank < 32 * S && left <= 1 && playerOvr(p) >= 12 && playerOvr(p) < 14) return 'rental';
  if (rank >= 48 * S && p.age <= 30) return 'depth';
  return null;
}

/**
 * A package in today's terms: Jimmy Johnson points at the picks' (projected) slots, a future pick
 * discounted 25% a year (the NFL's "a round later" rule of thumb), so two firsts next year read as
 * about a first and a half now.
 */
const chartPoints = (ctx: TradeContext, picks: DraftPick[]) =>
  picks.reduce((s, pk) => s + jimmyJohnson(pickOverall(ctx.league, pk, ctx)) * 0.75 ** Math.max(0, pk.season - nextDraftSeason(ctx.league)), 0);

/** The cheapest package of the buyer's picks both GMs accept, or null if none of up to three picks does. */
function price(ctx: TradeContext, p: Player, starter: boolean): { points: number; buyer: number; picks: DraftPick[] } | null {
  const { league } = ctx;
  const seller = league.teams[p.teamId!];
  const room = salaryToTake(league, p);
  const buyers = league.teams
    .filter((t) => t.id !== seller.id && t.id !== league.userTeamId && capRoom(ctx, t.id) >= room)
    .filter((t) => !starter || rosterOf(ctx, t.id).filter((x) => x.position === p.position && playerOvr(x) >= ctx.view(t.id, p).ovr).length < STARTERS[p.position])
    .map((t) => ({ t, v: playerValue(league, p, t, { ctx }) }))
    .sort((a, b) => b.v - a.v);
  const buyer = buyers[0]?.t;
  if (!buyer) return null;
  const picks = league.draftPicks.filter((pk) => pk.ownerId === buyer.id && pk.playerId === undefined).sort((a, b) => pickValue(league, b, seller.gm, ctx) - pickValue(league, a, seller.gm, ctx));
  const top = picks.slice(0, 8);
  const combos: DraftPick[][] = [
    ...picks.map((a) => [a]),
    ...top.flatMap((a, i) => top.slice(i + 1).map((b) => [a, b])),
    ...top.slice(0, 6).flatMap((a, i) => top.slice(i + 1, 6).flatMap((b, j) => top.slice(i + j + 2, 6).map((c) => [a, b, c]))),
  ];
  const ask = judge(ctx, seller.id, { sides: [{ teamId: buyer.id, players: [], picks: [] }, { teamId: seller.id, players: [p.id], picks: [] }] }).need;
  const ranked = combos
    .map((combo) => ({ combo, value: combo.reduce((s, pk) => s + pickValue(league, pk, seller.gm, ctx), 0) }))
    .filter((x) => x.value >= ask)
    .sort((a, b) => a.value - b.value);
  for (const { combo } of ranked.slice(0, 12)) {
    const proposal: TradeProposal = { sides: [{ teamId: buyer.id, players: [], picks: combo.map((pk) => pk.id) }, { teamId: seller.id, players: [p.id], picks: [] }] };
    if (judge(ctx, seller.id, proposal, { rosterCuts: true }).accepts && judge(ctx, buyer.id, proposal, { rosterCuts: true }).accepts) return { points: chartPoints(ctx, combo), buyer: buyer.id, picks: combo };
  }
  return null;
}

const prices: Record<string, Record<Bucket, number[]>> = {};
const examples: string[] = [];
let starterForSeventh = 0;

function probePrices(league: League, moment: string) {
  const ctx = tradeContext(league);
  const rank = ranks(league);
  const out = (prices[moment] ??= { star: [], quality: [], rental: [], depth: [] });
  const byBucket = new Map<Bucket, Player[]>();
  for (const p of Object.values(league.players)) {
    if (p.teamId === null || p.teamId === league.userTeamId) continue;
    const b = bucketOf(league, p, rank.get(p.id) ?? 999);
    if (b) byBucket.set(b, [...(byBucket.get(b) ?? []), p]);
  }
  for (const [b, list] of byBucket) {
    // An even spread of each bucket, the same players every run.
    const step = Math.max(1, Math.floor(list.length / 24));
    for (let i = 0; i < list.length; i += step) {
      const p = list[i];
      const got = price(ctx, p, b !== 'depth');
      // A backup nobody will spend a pick and a roster spot on is worth nothing in a trade.
      if (!got && b === 'depth') out[b].push(0);
      if (!got) continue;
      out[b].push(got.points);
      // A good starter in his prime: the top half of the league's starters, not past his position's decline.
      const good = (rank.get(p.id) ?? 999) < 16 * STARTERS[p.position] && p.age - ageShift(p.position) <= 29;
      if (good && got.picks.every((pk) => pk.round === 7)) starterForSeventh++;
      if (VERBOSE || i === 0) examples.push(`${moment.padEnd(10)} ${b.padEnd(8)} ${name(p).padEnd(22)} ${playerOvr(p).toFixed(1)} age ${p.age}, ${yearsLeft(p.contract!, league.season)} yr → ${got.picks.map((pk) => `${pk.season} R${pk.round}`).join(' + ')} (${got.points.toFixed(0)} pts)`);
    }
  }
}

// ───────── 2. Future picks ─────────

const futureSlots: number[] = [];

/** The slot in the next draft whose value to `gm` equals a typical team's first in the draft after it. */
function futureFirstSlot(league: League, gm: GmTraits, ctx: TradeContext): number {
  const next = league.draftPicks.filter((pk) => pk.round === 1 && pk.season === nextDraftSeason(league) + 1);
  const value = median(next.map((pk) => pickValue(league, pk, gm, ctx)));
  let slot = 1;
  while (slot < 224 && pickChartValue(slot, gm) > value) slot++;
  return slot;
}

// ───────── 3. Fairness and health ─────────

/** A pick on a neutral chart, between the two GM styles' (a quarter of the way to the flat one) and discounted 25% a year. */
function neutralPick(league: League, pk: DraftPick, ctx: TradeContext): number {
  const slot = pickOverall(league, pk, ctx);
  const years = Math.max(0, pk.season - nextDraftSeason(league));
  return Math.exp(0.75 * Math.log(jimmyJohnson(slot)) + 0.25 * Math.log(fitzgeraldSpielberger(slot))) * 0.75 ** years;
}

/** The trades made between two snapshots, read off where players and picks went. */
function tradesBetween(before: League, after: League): TradeProposal[] {
  const deals = new Map<string, TradeProposal>();
  const deal = (a: number, b: number) => {
    const [x, y] = a < b ? [a, b] : [b, a];
    const key = `${x}:${y}`;
    if (!deals.has(key)) deals.set(key, { sides: [{ teamId: x, players: [], picks: [] }, { teamId: y, players: [], picks: [] }] });
    const d = deals.get(key)!;
    return d.sides[0].teamId === a ? d.sides[0] : d.sides[1];
  };
  for (const p of Object.values(before.players)) {
    const later = after.players[p.id];
    const now = later?.teamId;
    // A traded player keeps his deal; one released and signed elsewhere in the same week has a new one.
    const same = !!p.contract && !!later?.contract && later.contract.signedSeason === p.contract.signedSeason && later.contract.signedWeek === p.contract.signedWeek && later.contract.apy === p.contract.apy;
    if (p.teamId !== null && now !== null && now !== undefined && now !== p.teamId && same) deal(p.teamId, now).players.push(p.id);
  }
  for (const pk of before.draftPicks) {
    const now = after.draftPicks.find((x) => x.id === pk.id);
    if (now && now.ownerId !== pk.ownerId && pk.playerId === undefined) deal(pk.ownerId, now.ownerId).picks.push(pk.id);
  }
  return [...deals.values()];
}

const fair = { gaps: [] as number[], lopsided: 0, trades: 0, seasons: 0, balance: new Map<string, number>(), health: 0, healthy: 0, kinds: new Map<string, number>() };

function judgeFairness(before: League, proposal: TradeProposal, label: string) {
  const ctx = tradeContext(before);
  // What each side sends, on one neutral scale: the players' true market value, picks on a neutral chart.
  const worth = proposal.sides.map((side) => {
    const team = before.teams[side.teamId];
    const players = side.players.reduce((s, id) => s + marketValue(ctx, team, before.players[id], true), 0);
    const picks = side.picks.reduce((s, id) => s + neutralPick(before, before.draftPicks.find((x) => x.id === id)!, ctx), 0);
    return Math.max(1, players + picks);
  });
  const [a, b] = worth;
  fair.trades++;
  fair.gaps.push(Math.abs(a - b) / Math.max(a, b));
  if (Math.max(a, b) / Math.min(a, b) >= 3) fair.lopsided++;
  proposal.sides.forEach((side, i) => {
    const key = `${label}:${side.teamId}`;
    fair.balance.set(key, (fair.balance.get(key) ?? 0) + worth[1 - i] - worth[i]);
  });
  const kind = proposal.sides.some((s) => s.players.length) && proposal.sides.some((s) => s.picks.length) ? 'picks for players' : proposal.sides.every((s) => s.players.length) ? 'player swaps' : proposal.sides.some((s) => s.players.length) ? 'players for nothing' : 'picks only';
  if (VERBOSE) {
    const what = (side: TradeProposal['sides'][number]) => [...side.players.map((id) => `${name(before.players[id])} ${playerOvr(before.players[id]).toFixed(1)} (${before.players[id].age}, ${yearsLeft(before.players[id].contract!, before.season)} yr)`), ...side.picks.map((id) => { const pk = before.draftPicks.find((x) => x.id === id)!; return `${pk.season} R${pk.round}`; })].join(' + ') || 'nothing';
    console.log(`  ${before.season} wk${before.week} ${before.teams[proposal.sides[0].teamId].abbrev} sends ${what(proposal.sides[0])} · ${before.teams[proposal.sides[1].teamId].abbrev} sends ${what(proposal.sides[1])} · truth ${worth[0].toFixed(0)} vs ${worth[1].toFixed(0)}`);
  }
  fair.kinds.set(kind, (fair.kinds.get(kind) ?? 0) + 1);
}

function checkHealth(league: League, teamIds: number[]) {
  for (const id of teamIds) {
    fair.healthy++;
    const roster = teamPlayers(league, id);
    const short = league.phase === 'regular' && POSITIONS.some((pos) => roster.filter((p) => p.position === pos).length < STARTERS[pos]);
    if (capSpace(league, id) < 0 || short) {
      fair.health++;
      console.log(`  ✗ ${league.teams[id].abbrev} after a trade: ${capSpace(league, id) < 0 ? 'over the cap' : 'short at a position'}`);
    }
  }
}

// ───────── 4. Probes ─────────

interface Probe {
  label: string;
  /** True when the exploit worked (the probe fails). */
  worked: boolean;
}
const probes: Probe[] = [];

function runProbes(base: League) {
  const USER = base.userTeamId;
  const fresh = () => clone(base);
  const best = (l: League, teamId: number) => teamPlayers(l, teamId).filter((p) => !playerTradeBlocker(l, p)).sort((a, b) => playerOvr(b) - playerOvr(a));
  const ai = base.teams.find((t) => t.id !== USER && best(base, t.id)[0] && playerOvr(best(base, t.id)[0]) >= 15)!.id;
  const picksOf = (l: League, teamId: number, round?: number) => l.draftPicks.filter((p) => p.ownerId === teamId && p.playerId === undefined && (!round || p.round === round));
  const accepts = (l: League, proposal: TradeProposal) => evaluateTrade(l, proposal).accepts;
  // Room on both rosters, so only value and policy are in play.
  const room = (l: League) => {
    for (const id of [USER, ai]) for (const p of best(l, id).slice(-3)) p.teamId = null;
  };

  {
    const l = fresh();
    room(l);
    const star = best(l, ai)[0];
    const junk = best(l, USER).slice(-5).map((p) => p.id);
    const late = picksOf(l, USER).filter((p) => p.round >= 6).slice(0, 3).map((p) => p.id);
    probes.push({ label: 'junk for a star (5 backups + 3 late picks)', worked: accepts(l, { sides: [{ teamId: USER, players: junk, picks: late }, { teamId: ai, players: [star.id], picks: [] }] }) });
  }
  {
    const l = fresh();
    room(l);
    const star = best(l, ai)[0];
    const mids = best(l, USER).filter((p) => p.position !== star.position && playerOvr(p) < 13.5).slice(0, 3).map((p) => p.id);
    probes.push({ label: '3-for-1 for a star (three mid starters)', worked: accepts(l, { sides: [{ teamId: USER, players: mids, picks: [] }, { teamId: ai, players: [star.id], picks: [] }] }) });
  }
  {
    const l = fresh();
    room(l);
    const ctx = tradeContext(l);
    // The user's two worst contracts, as the AI values them.
    const worst = best(l, USER)
      .map((p) => ({ p, v: playerValue(l, p, l.teams[ai], { ctx }) }))
      .sort((a, b) => a.v - b.v)
      .slice(0, 2)
      .map((x) => x.p.id);
    probes.push({ label: 'dump two bad contracts for nothing', worked: accepts(l, { sides: [{ teamId: USER, players: worst, picks: [] }, { teamId: ai, players: [], picks: [] }] }) });
  }
  {
    const l = fresh();
    room(l);
    // Ask for three of their firsts for a good starter they value below the picks' face value.
    const firsts = picksOf(l, ai, 1).slice(0, 3);
    const ctx = tradeContext(l);
    const face = firsts.reduce((s, pk) => s + pickValue(l, pk, l.teams[ai].gm, ctx), 0);
    const offer = best(l, USER).find((p) => playerValue(l, p, l.teams[ai], { ctx }) < face * 1.15 && playerValue(l, p, l.teams[ai], { ctx }) > face * 0.85);
    probes.push({ label: 'three firsts for a player worth about their face value', worked: !!offer && accepts(l, { sides: [{ teamId: USER, players: [offer.id], picks: [] }, { teamId: ai, players: [], picks: firsts.map((p) => p.id) }] }) });
  }
  {
    const l = fresh();
    room(l);
    // Sign a free agent and offer him straight to the AI for a pick it would otherwise give.
    const fa = freeAgents(l).sort((a, b) => playerOvr(b) - playerOvr(a))[0];
    signPlayer(l, fa, USER, { years: 1, apy: 1_000, bonusPct: 0, gtdPct: 0, voidYears: 0 }, 'minimum');
    const pick = picksOf(l, ai).filter((p) => p.round === 7).map((p) => p.id).slice(0, 1);
    const v = evaluateTrade(l, { sides: [{ teamId: USER, players: [fa.id], picks: [] }, { teamId: ai, players: [], picks: pick }] });
    probes.push({ label: 'sign a free agent and flip him at once', worked: v.accepts || !v.policy });
    probes.push({ label: 'the refusal names no week or number', worked: /\d/.test(v.message) });
  }
  {
    const l = fresh();
    room(l);
    // Sell a player for the cheapest of their picks they'd give, then try to buy him straight back for it.
    const ctx = tradeContext(l);
    const mine = best(l, USER).find((p) => playerOvr(p) >= 13 && playerOvr(p) < 15)!;
    const sale = (pk: DraftPick): TradeProposal => ({ sides: [{ teamId: USER, players: [mine.id], picks: [] }, { teamId: ai, players: [], picks: [pk.id] }] });
    const their = picksOf(l, ai)
      .sort((a, b) => pickValue(l, a, l.teams[ai].gm, ctx) - pickValue(l, b, l.teams[ai].gm, ctx))
      .reverse()
      .find((pk) => accepts(l, sale(pk)));
    let worked = false;
    if (their) {
      executeTrade(l, sale(their));
      worked = accepts(l, { sides: [{ teamId: USER, players: [], picks: [their.id] }, { teamId: ai, players: [mine.id], picks: [] }] });
    }
    probes.push({ label: 'sell a player, then buy him straight back for the same pick', worked });
  }
  {
    const l = fresh();
    const star = best(l, ai)[0];
    star.injury = { type: 'hamstring', severity: 'moderate', weeksRemaining: 4, estimate: [3, 5], season: l.season, week: l.week, where: 'game' };
    probes.push({ label: 'trade for an injured star in season', worked: accepts(l, { sides: [{ teamId: USER, players: [], picks: picksOf(l, USER, 1).map((p) => p.id) }, { teamId: ai, players: [star.id], picks: [] }] }) });
  }
}

// ───────── 5. Speed ─────────

const speed = { judge: NaN, week: [] as number[] };

function timeJudge(league: League) {
  const ctx = tradeContext(league);
  const rng = new Rng('judge-timing');
  const teams = league.teams.filter((t) => t.id !== league.userTeamId);
  const proposals: [number, TradeProposal][] = [];
  for (let i = 0; i < 300; i++) {
    const [a, b] = [rng.pick(teams), rng.pick(teams)];
    if (a.id === b.id) continue;
    const p = rng.pick(rosterOf(ctx, b.id));
    const pk = rng.pick(league.draftPicks.filter((x) => x.ownerId === a.id && x.playerId === undefined));
    proposals.push([b.id, { sides: [{ teamId: a.id, players: [], picks: [pk.id] }, { teamId: b.id, players: [p.id], picks: [] }] }]);
  }
  // Warm the reads the way a market pass would, then time the verdicts.
  for (const [id, pr] of proposals) judge(ctx, id, pr);
  const t0 = performance.now();
  for (const [id, pr] of proposals) judge(ctx, id, pr);
  speed.judge = (performance.now() - t0) / proposals.length;
}

// ───────── run ─────────

for (let i = 0; i < LEAGUES; i++) {
  const league = createLeague({ seed: `trades-${i}` });
  const label = `L${i}`;
  if (i === 0) {
    probePrices(league, 'preseason');
    runProbes(league);
    timeJudge(league);
  }
  for (let s = 0; s < SEASONS; s++) {
    fair.seasons++;
    while (league.phase === 'regular' && (league.week <= 10 || isDeadlineDay(league))) {
      if (i === 0 && s === 0 && isDeadlineDay(league)) {
        probePrices(league, 'deadline');
        const ctx = tradeContext(league);
        futureSlots.push(...league.teams.map((t) => futureFirstSlot(league, t.gm, ctx)));
      }
      const before = clone(league);
      // The market alone, timed on a copy (the real week runs it again inside playWeek).
      if (gamesInWeek(league).length) {
        const copy = clone(league);
        const t0 = performance.now();
        aiTradeWeek(copy, new Rng(`${copy.seed}:market:${copy.season}:${copy.phase}:${copy.week}`));
        speed.week.push(performance.now() - t0);
      }
      playWeek(league);
      const logged = league.transactions.filter((t) => t.kind === 'trade' && t.season === before.season && t.week === before.week).map((t) => [...t.teamIds].sort((a, b) => a - b).join(':'));
      for (const proposal of tradesBetween(before, league).filter((d) => logged.includes(d.sides.map((x) => x.teamId).sort((a, b) => a - b).join(':')))) {
        judgeFairness(before, proposal, label);
        checkHealth(league, proposal.sides.map((x) => x.teamId));
      }
    }
    simToEndOfSeason(league);
    simOffseason(league);
  }
}

console.log('\nPrices (median JJ points at projected slots, future picks 25% off a year; examples below)');
for (const [moment, buckets] of Object.entries(prices)) {
  console.log(` ${moment}:`);
  check(`star (top 3 at a premium position) n=${buckets.star.length}`, median(buckets.star), [1000, 3500]);
  check(`quality starter (top quarter, 1-2 years) n=${buckets.quality.length}`, median(buckets.quality), [400, 1300]);
  if (moment === 'deadline') check(`deadline rental (expiring starter) n=${buckets.rental.length}`, median(buckets.rental), [35, 150]);
  check(`depth n=${buckets.depth.length}`, median(buckets.depth), [0, 40]);
}
check('good starters in their prime sold for 7th-round picks only', starterForSeventh, [0, 0]);
for (const e of examples) console.log(`    ${e}`);

console.log('\nFuture picks');
check("next year's first, as a current pick (median over GMs)", median(futureSlots), [22, 45]);

console.log(`\nFairness and health (${fair.trades} AI trades over ${fair.seasons} seasons: ${[...fair.kinds].map(([k, n]) => `${n} ${k}`).join(', ')})`);
check('median truth gap between the sides (%)', median(fair.gaps) * 100, [0, 35]);
check('trades over 3:1 in truth, a season', fair.lopsided / fair.seasons, [0, 1], 2);
check("any team's truth balance over its league's run (|points|)", Math.max(0, ...[...fair.balance.values()].map(Math.abs)), [0, 1000]);
check('teams over the cap or short after a trade', fair.health, [0, 0]);

console.log('\nProbes (each must fail)');
for (const p of probes) console.log(`  ${p.worked ? '✗ WORKED' : '✓ failed'}  ${p.label}`);
check('exploits that worked', probes.filter((p) => p.worked).length, [0, 0]);

console.log('\nSpeed');
check('one verdict, warm cache (ms)', speed.judge, [0, 0.6], 3);
check('one week of the market (ms, median)', median(speed.week), [0, 120], 1);

console.log(`\n${misses} number(s) outside target range`);
process.exit(misses ? 1 : 0);
