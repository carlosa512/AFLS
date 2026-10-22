/**
 * Prices for the trade market audit (`scripts/trades.ts`, section 1): before the season and on deadline day, what
 * a buyer pays for each kind of player. For every eligible player the buyer is the team that values him most among
 * those he'd start for and that can take his salary; the price is the cheapest package of its picks that both GMs
 * accept (`judge`), in Jimmy Johnson points at the picks' projected slots, future picks discounted 25% a year.
 *
 * A league has only about ten stars and a few dozen rentals, and only one star in seven is cheap enough for three
 * picks, so the audit prices every eligible player and pools the first season of many leagues: its own, priced as
 * they play, and the rest here, each in a child process (`priceLeagues`) that plays its league to deadline day while
 * the audit runs. With three leagues a bucket's median moved with any change that reshuffled the world: over six
 * seeds deadline-day stars ran 855-1431 (three under the band), rentals 40-88; over 48 leagues, 1202-1408 and 62-67.
 */
import { fork } from 'node:child_process';
import { availableParallelism } from 'node:os';
import { ageShift } from '../src/engine/aging';
import { yearsLeft } from '../src/engine/finance/contract';
import { createLeague } from '../src/engine/generate';
import { playWeek } from '../src/engine/league';
import { playerOvr, STARTERS } from '../src/engine/positions';
import { teamPlayers } from '../src/engine/roster';
import {
  capRoom,
  goingRate,
  isDeadlineDay,
  jimmyJohnson,
  judge,
  marketValue,
  nextDraftSeason,
  pickOverall,
  pickValue,
  playerTradeBlocker,
  playerValue,
  rosterOf,
  salaryToTake,
  setTradeStatus,
  tradeContext,
  type TradeContext,
  type TradeProposal,
} from '../src/engine/trade';
import type { DraftPick, League, Player, Position } from '../src/engine/types';
import { POSITIONS } from '../src/engine/types';

export type Bucket = 'star' | 'quality' | 'rental' | 'depth';
export const BUCKETS: Bucket[] = ['star', 'quality', 'rental', 'depth'];
const PREMIUM: ReadonlySet<Position> = new Set(['QB', 'EDGE', 'WR', 'CB', 'DT', 'OL']);

export const median = (xs: number[]) => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
export const name = (p: Player) => `${p.position} ${p.firstName[0]}. ${p.lastName}`;

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
  picks.reduce(
    (s, pk) =>
      s + jimmyJohnson(pickOverall(ctx.league, pk, ctx)) * 0.75 ** Math.max(0, pk.season - nextDraftSeason(ctx.league)),
    0,
  );

/** The cheapest package of the buyer's picks both GMs accept, or null if none of up to three picks does. */
function price(
  ctx: TradeContext,
  p: Player,
  starter: boolean,
): { points: number; buyer: number; picks: DraftPick[] } | null {
  const { league } = ctx;
  const seller = league.teams[p.teamId!];
  const room = salaryToTake(league, p);
  const buyers = league.teams
    .filter((t) => t.id !== seller.id && t.id !== league.userTeamId && capRoom(ctx, t.id) >= room)
    .filter(
      (t) =>
        !starter ||
        rosterOf(ctx, t.id).filter((x) => x.position === p.position && playerOvr(x) >= ctx.view(t.id, p).ovr).length <
          STARTERS[p.position],
    )
    .map((t) => ({ t, v: playerValue(league, p, t, { ctx }) }))
    .sort((a, b) => b.v - a.v);
  const buyer = buyers[0]?.t;
  if (!buyer) return null;
  const picks = league.draftPicks
    .filter((pk) => pk.ownerId === buyer.id && pk.playerId === undefined)
    .sort((a, b) => pickValue(league, b, seller.gm, ctx) - pickValue(league, a, seller.gm, ctx));
  const top = picks.slice(0, 8);
  const combos: DraftPick[][] = [
    ...picks.map((a) => [a]),
    ...top.flatMap((a, i) => top.slice(i + 1).map((b) => [a, b])),
    ...top
      .slice(0, 6)
      .flatMap((a, i) => top.slice(i + 1, 6).flatMap((b, j) => top.slice(i + j + 2, 6).map((c) => [a, b, c]))),
  ];
  const ask = judge(ctx, seller.id, {
    sides: [
      { teamId: buyer.id, players: [], picks: [] },
      { teamId: seller.id, players: [p.id], picks: [] },
    ],
  }).need;
  const ranked = combos
    .map((combo) => ({ combo, value: combo.reduce((s, pk) => s + pickValue(league, pk, seller.gm, ctx), 0) }))
    .filter((x) => x.value >= ask)
    .sort((a, b) => a.value - b.value);
  for (const { combo } of ranked.slice(0, 12)) {
    const proposal: TradeProposal = {
      sides: [
        { teamId: buyer.id, players: [], picks: combo.map((pk) => pk.id) },
        { teamId: seller.id, players: [p.id], picks: [] },
      ],
    };
    if (
      judge(ctx, seller.id, proposal, { rosterCuts: true }).accepts &&
      judge(ctx, buyer.id, proposal, { rosterCuts: true }).accepts
    )
      return { points: chartPoints(ctx, combo), buyer: buyer.id, picks: combo };
  }
  return null;
}

/** What a 6th-round pick in the next draft goes for (the median of the round, at the league's going rate). */
const sixth = (ctx: TradeContext) =>
  median(
    ctx.league.draftPicks
      .filter((pk) => pk.round === 6 && pk.season === nextDraftSeason(ctx.league))
      .map((pk) => goingRate(ctx.league, pk, ctx)),
  );

/** One league's prices at one moment. */
export interface Prices {
  /** JJ points by bucket; a backup nobody will pay for counts as 0. */
  prices: Record<Bucket, number[]>;
  /** Good starters in their prime, worth a 6th or more, sold for 7th-round picks only: one line each. */
  seventh: string[];
  /** Every priced player (`verbose`), or the first of each bucket (`show`). */
  examples: string[];
}

export function probePrices(league: League, moment: string, show: boolean, verbose: boolean): Prices {
  const ctx = tradeContext(league);
  const rank = ranks(league);
  const out: Prices = { prices: { star: [], quality: [], rental: [], depth: [] }, seventh: [], examples: [] };
  const byBucket = new Map<Bucket, Player[]>();
  for (const p of Object.values(league.players)) {
    if (p.teamId === null || p.teamId === league.userTeamId) continue;
    const b = bucketOf(league, p, rank.get(p.id) ?? 999);
    if (b) byBucket.set(b, [...(byBucket.get(b) ?? []), p]);
  }
  for (const [b, list] of byBucket) {
    // Every eligible player, but only an even spread of the depth (the same 24 every run): a league has about 500
    // backups, nearly none of whom anyone will spend a pick on, so its median is 0 however many are priced.
    const step = b === 'depth' ? Math.max(1, Math.floor(list.length / 24)) : 1;
    for (let i = 0; i < list.length; i += step) {
      const p = list[i];
      const got = price(ctx, p, b !== 'depth');
      // A backup nobody will spend a pick and a roster spot on is worth nothing in a trade.
      if (!got && b === 'depth') out.prices[b].push(0);
      if (!got) continue;
      out.prices[b].push(got.points);
      // A good starter in his prime: the top half of the league's starters, not past his position's decline.
      const good = (rank.get(p.id) ?? 999) < 16 * STARTERS[p.position] && p.age - ageShift(p.position) <= 29;
      // ...that the league itself prices at a 6th or more: an overpaid veteran's salary can eat his worth down to a 7th's, fairly.
      const underpriced = good && marketValue(ctx, league.teams[p.teamId!], p, true) >= sixth(ctx);
      const line = `${moment.padEnd(10)} ${b.padEnd(8)} ${name(p).padEnd(22)} ${playerOvr(p).toFixed(1)} age ${p.age}, ${yearsLeft(p.contract!, league.season)} yr → ${got.picks.map((pk) => `${pk.season} R${pk.round}`).join(' + ')} (${got.points.toFixed(0)} pts)`;
      if (underpriced && got.picks.every((pk) => pk.round === 7)) {
        const seller = league.teams[p.teamId!];
        out.seventh.push(
          `${line}: the seller is ${seller.stance?.mode ?? 'bubble'} (${seller.gm.archetype}), week ${league.week}`,
        );
      }
      if (verbose || (show && i === 0)) out.examples.push(line);
    }
  }
  return out;
}

/** Like most users, mark the two best players Untouchable: no offer may ask for them. */
export function guardBest(league: League) {
  for (const p of teamPlayers(league, league.userTeamId)
    .sort((a, b) => playerOvr(b) - playerOvr(a))
    .slice(0, 2))
    setTradeStatus(league, p.id, 'untouchable');
}

/** A league's first season priced as the audit prices its own: before it, and on deadline day. */
export interface PriceRun {
  seed: string;
  preseason: Prices;
  deadline: Prices;
}

function priceLeague(seed: string, verbose: boolean): PriceRun {
  const league = createLeague({ seed });
  const preseason = probePrices(league, 'preseason', false, verbose);
  guardBest(league);
  while (league.phase === 'regular' && !isDeadlineDay(league)) playWeek(league);
  return { seed, preseason, deadline: probePrices(league, 'deadline', false, verbose) };
}

/**
 * Price these leagues in child processes, one core each beside the audit's own, and resolve when the last one
 * reports. A worker that dies before reporting fails the audit by name.
 */
export function priceLeagues(seeds: string[], verbose: boolean): Promise<PriceRun[]> {
  const workers = Math.max(1, Math.min(seeds.length, availableParallelism() - 1));
  const shares = Array.from({ length: workers }, (_, w) => seeds.filter((_, i) => i % workers === w));
  return Promise.all(
    shares
      .filter((share) => share.length)
      .map(
        (share) =>
          new Promise<PriceRun[]>((resolve, reject) => {
            const runs: PriceRun[] = [];
            const child = fork(new URL(import.meta.url).pathname, [], {
              env: { ...process.env, TRADE_PRICE_SEEDS: share.join(','), TRADE_PRICE_VERBOSE: verbose ? '1' : '' },
            });
            child.on('message', (run) => {
              runs.push(run as PriceRun);
              if (runs.length < share.length) return;
              resolve(runs);
              child.kill();
            });
            child.once('error', reject);
            child.once(
              'exit',
              (code, signal) =>
                runs.length === share.length ||
                reject(new Error(`price leagues ${share.join(', ')} exited (${signal ?? code}) before reporting`)),
            );
          }),
      ),
  ).then((all) => all.flat());
}

// A worker: price each league it was handed and report each as it finishes (the parent ends it).
if (process.env.TRADE_PRICE_SEEDS && process.send) {
  for (const seed of process.env.TRADE_PRICE_SEEDS.split(','))
    process.send(priceLeague(seed, process.env.TRADE_PRICE_VERBOSE === '1'));
}
