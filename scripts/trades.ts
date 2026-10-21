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
 * 3. No cheese: every AI deal is read as it closes, for each side three ways (its own eyes, its own
 *    lens on the true ratings, the league's true scale). No side may lose in its own eyes, and both
 *    teams must be under the cap and full at every position afterwards. Bad business (a lopsided deal
 *    in the truth, a team's ledger over its run, a starter sold for a 7th) is shown, not failed, with
 *    what explains it: its scouts' misread or its own situation (stance, need, cap room, chart).
 * 4. Probes: the exploits other games shipped (junk for a star, stacked firsts, contract dumps,
 *    sign and flip, buying straight back), each of which must fail.
 * 5. Speed: one verdict with a warm cache, one week of the market.
 *
 * 6. Volume and mix: trades in season, the share on deadline day, the offseason's, what kinds, and
 *    how few go between division rivals, against the NFL's.
 *
 *   npm run trades          # 3 leagues, 3 seasons each
 *   npm run trades -- 4
 *   npm run trades -- --seasons 6
 *
 * ▲/▼ marks a number outside its band; the last line counts them and the process exits 1 if any are.
 */
import { ageShift } from '../src/engine/aging';
import { capSpace } from '../src/engine/finance/cap';
import { yearsLeft } from '../src/engine/finance/contract';
import { createLeague } from '../src/engine/generate';
import { gamesInWeek, playWeek, simToEndOfSeason } from '../src/engine/league';
import { advanceOffseason, beginOffseason } from '../src/engine/offseason';
import { freeAgents, signPlayer } from '../src/engine/offseason/negotiation';
import { playerOvr, STARTERS } from '../src/engine/positions';
import { Rng } from '../src/engine/rng';
import { teamPlayers } from '../src/engine/roster';
import {
  evaluateTrade,
  executeTrade,
  goingRate,
  isDeadlineDay,
  jimmyJohnson,
  judge,
  marketMoment,
  marketValue,
  nextDraftSeason,
  pickChartValue,
  pickOverall,
  pickValue,
  playerTradeBlocker,
  proposeTrade,
  setTradeStatus,
  teamNeeds,
  ASKS,
  CONCERNS,
  examine,
  FAIL,
  findings,
  playerValue,
  rosterOf,
  salaryToTake,
  capRoom,
  dealWatch,
  playerSwing,
  POINTS_PER_K,
  retainedBy,
  type Deal,
  tradeContext,
  type TradeContext,
  TRADE_DEADLINE_WEEK,
  type TradeProposal,
  weekMoment,
} from '../src/engine/trade';
import type { DraftPick, GmTraits, League, Player, Position, TradeOffer, TradeRecord } from '../src/engine/types';
import { POSITIONS } from '../src/engine/types';

const LEAGUES = Number(
  process.argv.slice(2).find((a, i, all) => !a.startsWith('-') && all[i - 1] !== '--seasons') ?? 3,
);
/** `--verbose`: every priced player and every AI trade, not just one example per bucket. */
const VERBOSE = process.argv.includes('--verbose');
const flag = (name: string) => process.argv[process.argv.indexOf(name) + 1];
const SEASONS = process.argv.includes('--seasons') ? Number(flag('--seasons')) : 3;
/** Each team's division (every league uses the real alignment). */
const DIVISION_OF = createLeague({ seed: 'divisions' }).teams.map((t) => t.division);

let misses = 0;
const check = (label: string, value: number, [lo, hi]: [number, number], digits = 0) => {
  const ok = Number.isFinite(value) && value >= lo && value <= hi;
  if (!ok) misses++;
  const range = lo === -Infinity ? `≤${hi}` : hi === Infinity ? `≥${lo}` : `${lo}–${hi}`;
  console.log(
    `  ${label.padEnd(52)} ${Number.isFinite(value) ? value.toFixed(digits).padStart(8) : '     n/a'}   ${range}${ok ? '' : !Number.isFinite(value) || value < lo ? '  ▼ LOW' : '  ▲ HIGH'}`,
  );
};
/** A number shown for reading, never failed: bad business that a GM's scouts or situation explain. */
const note = (label: string, value: string) => console.log(`  ${label.padEnd(52)} ${value.padStart(8)}   (info)`);
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

const prices: Record<string, Record<Bucket, number[]>> = {};
const examples: string[] = [];
let starterForSeventh = 0;
const seventhExamples: string[] = [];

function probePrices(league: League, moment: string, show: boolean) {
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
      // ...that the league itself prices at a 6th or more: an overpaid veteran's salary can eat his worth down to a 7th's, fairly.
      const underpriced = good && marketValue(ctx, league.teams[p.teamId!], p, true) >= sixth(ctx);
      const line = `${moment.padEnd(10)} ${b.padEnd(8)} ${name(p).padEnd(22)} ${playerOvr(p).toFixed(1)} age ${p.age}, ${yearsLeft(p.contract!, league.season)} yr → ${got.picks.map((pk) => `${pk.season} R${pk.round}`).join(' + ')} (${got.points.toFixed(0)} pts)`;
      if (underpriced && got.picks.every((pk) => pk.round === 7)) {
        starterForSeventh++;
        const seller = league.teams[p.teamId!];
        seventhExamples.push(
          `${line}: the seller is ${seller.stance?.mode ?? 'bubble'} (${seller.gm.archetype}), week ${league.week}`,
        );
      }
      if (VERBOSE || (show && i === 0)) examples.push(line);
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

/** Each team's run of deals in the truth, and what explains it: its scouts' misreads and its own situation. */
interface Ledger {
  truth: number;
  scouts: number;
  situation: number;
  lines: string[];
}
const fair = {
  gaps: [] as number[],
  trades: 0,
  seasons: 0,
  ledgers: new Map<string, Ledger>(),
  health: 0,
  healthy: 0,
  kinds: new Map<string, number>(),
  /** Deals over 3:1 in the truth, by what explains the losing side's part. */
  lopsided: { scouts: 0, situation: 0 },
  /** Sides that lost in their own eyes: a deal that skipped the evaluator. */
  cheese: [] as string[],
};

/** The league being played (deals in a probe's or a timing run's copy aren't read), and its label. */
let live: League | null = null;
let liveLabel = '';

/** What a side sends on the league's true scale: players at true market value, picks at the going rate, salary it keeps paying. */
function sends(ctx: TradeContext, side: TradeProposal['sides'][number]): number[] {
  const { league } = ctx;
  return [
    ...side.players.map((id) => marketValue(ctx, league.teams[side.teamId], league.players[id], true)),
    ...side.picks.map((id) => goingRate(league, league.draftPicks.find((x) => x.id === id)!, ctx)),
    POINTS_PER_K * retainedBy(side),
  ];
}

/**
 * One side of a deal as it closes. `own` is what `judge` weighed (get − give in its eyes: its scouts'
 * read, its lens, its cap room); `scouts` how much of that its scouts' misreads made up (the same
 * swing on the true ratings); `truth` what it came out with on the league's true scale. What's left,
 * own − scouts − truth, is its own situation: stance, need, cap room, its pick chart, its coaches.
 */
function sideRead(ctx: TradeContext, deal: Deal, proposal: TradeProposal, i: number) {
  const { league } = ctx;
  const mine = proposal.sides[i];
  const theirs = proposal.sides[1 - i];
  const team = league.teams[mine.teamId];
  const releasing = !!deal.releasing && mine.players.length > 0;
  const j = judge(ctx, team.id, proposal, { rosterCuts: true, releasing });
  const seen = playerSwing(ctx, team, mine.players, theirs.players);
  const real = playerSwing(ctx, team, mine.players, theirs.players, true);
  const scouts = seen.gain - real.gain - (releasing ? 0 : seen.loss - real.loss);
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
  const truth = sum(sends(ctx, theirs)) - sum(sends(ctx, mine));
  const own = j.get - j.give;
  return { team, own, scouts, truth, situation: own - scouts - truth };
}

dealWatch.onClose = (ctx, deal, proposal) => {
  if (ctx.league !== live) return;
  const { league } = ctx;
  const reads = [0, 1].map((i) => sideRead(ctx, deal, proposal, i));
  const parts = proposal.sides.map((side) => sends(ctx, side));
  const stakes = parts.flat().reduce((a, b) => a + Math.abs(b), 0);
  const gap = Math.abs(reads[0].truth) / Math.max(stakes, 100);
  fair.trades++;
  fair.gaps.push(gap);
  const where = `[${league.phase} wk${league.week}]`;
  const what = (side: TradeProposal['sides'][number]) =>
    [
      ...side.players.map(
        (id) => `${name(league.players[id])} ${playerOvr(league.players[id]).toFixed(1)}/${league.players[id].age}`,
      ),
      ...side.picks.map((id) => {
        const pk = league.draftPicks.find((x) => x.id === id)!;
        return `${pk.season} R${pk.round}`;
      }),
    ].join(' + ') || 'nothing';
  const who = (t: (typeof reads)[number]['team']) => `${t.abbrev} (${t.stance?.mode ?? 'bubble'}, ${t.gm.archetype})`;
  reads.forEach((r, i) => {
    // Every deal clears the evaluator for both sides, so neither loses in its own eyes (a point of rounding aside).
    if (r.own < -1)
      fair.cheese.push(
        `${who(r.team)} lost ${(-r.own).toFixed(0)} in its own eyes: ${what(proposal.sides[i])} for ${what(proposal.sides[1 - i])} ${where} (${deal.kind})`,
      );
    const key = `${liveLabel}:${r.team.abbrev}:${r.team.gm.archetype}`;
    const ledger = fair.ledgers.get(key) ?? { truth: 0, scouts: 0, situation: 0, lines: [] };
    ledger.truth += r.truth;
    ledger.scouts += r.scouts;
    ledger.situation += r.situation;
    if (VERBOSE)
      ledger.lines.push(
        `${r.truth.toFixed(0).padStart(5)} (scouts ${r.scouts.toFixed(0)}, situation ${r.situation.toFixed(0)}) ${where} sends ${what(proposal.sides[i])} for ${what(proposal.sides[1 - i])} to ${who(reads[1 - i].team)}`,
      );
    fair.ledgers.set(key, ledger);
  });
  if (gap >= 0.5 && stakes >= 100) {
    const loser = reads[0].truth < 0 ? reads[0] : reads[1];
    const cause = loser.scouts >= loser.situation ? 'scouts' : 'situation';
    fair.lopsided[cause]++;
    if (VERBOSE)
      console.log(
        `  LOPSIDED ${where} ${who(loser.team)} down ${(-loser.truth).toFixed(0)}: its scouts ${loser.scouts.toFixed(0)}, its situation ${loser.situation.toFixed(0)} · ${proposal.sides.map((side) => `${league.teams[side.teamId].abbrev} sends ${what(side)}`).join(' · ')}`,
      );
  }
  const kind =
    proposal.sides.some((x) => x.players.length) && proposal.sides.some((x) => x.picks.length)
      ? 'picks for players'
      : proposal.sides.every((x) => x.players.length)
        ? 'player swaps'
        : proposal.sides.some((x) => x.players.length)
          ? 'players for nothing'
          : 'picks only';
  fair.kinds.set(kind, (fair.kinds.get(kind) ?? 0) + 1);
};

function checkHealth(league: League, teamIds: number[]) {
  for (const id of teamIds) {
    fair.healthy++;
    const roster = teamPlayers(league, id);
    const short =
      league.phase === 'regular' &&
      POSITIONS.some((pos) => roster.filter((p) => p.position === pos).length < STARTERS[pos]);
    if (capSpace(league, id) < 0 || short) {
      fair.health++;
      console.log(
        `  ✗ ${league.teams[id].abbrev} after a trade: ${capSpace(league, id) < 0 ? 'over the cap' : 'short at a position'}`,
      );
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
  const best = (l: League, teamId: number) =>
    teamPlayers(l, teamId)
      .filter((p) => !playerTradeBlocker(l, p))
      .sort((a, b) => playerOvr(b) - playerOvr(a));
  const ai = base.teams.find((t) => t.id !== USER && best(base, t.id)[0] && playerOvr(best(base, t.id)[0]) >= 15)!.id;
  const picksOf = (l: League, teamId: number, round?: number) =>
    l.draftPicks.filter((p) => p.ownerId === teamId && p.playerId === undefined && (!round || p.round === round));
  const accepts = (l: League, proposal: TradeProposal) => evaluateTrade(l, proposal).accepts;
  // Room on both rosters and under your cap, so only value and policy are in play. A trade your cap forbids is a league
  // rule, refused before the GM hears it, and an opening league paid like a settled one can leave you without room:
  // on one such league every answer to the twenty proposals below was "over the cap", which the probe's check reads
  // as a GM still talking, an exploit that worked.
  const room = (l: League) => {
    for (const id of [USER, ai]) for (const p of best(l, id).slice(-3)) p.teamId = null;
    l.teams[USER].carryover = l.caps[l.season];
  };

  {
    const l = fresh();
    room(l);
    const star = best(l, ai)[0];
    const junk = best(l, USER)
      .slice(-5)
      .map((p) => p.id);
    const late = picksOf(l, USER)
      .filter((p) => p.round >= 6)
      .slice(0, 3)
      .map((p) => p.id);
    probes.push({
      label: 'junk for a star (5 backups + 3 late picks)',
      worked: accepts(l, {
        sides: [
          { teamId: USER, players: junk, picks: late },
          { teamId: ai, players: [star.id], picks: [] },
        ],
      }),
    });
  }
  {
    const l = fresh();
    room(l);
    const star = best(l, ai)[0];
    const mids = best(l, USER)
      .filter((p) => p.position !== star.position && playerOvr(p) < 13.5)
      .slice(0, 3)
      .map((p) => p.id);
    probes.push({
      label: '3-for-1 for a star (three mid starters)',
      worked: accepts(l, {
        sides: [
          { teamId: USER, players: mids, picks: [] },
          { teamId: ai, players: [star.id], picks: [] },
        ],
      }),
    });
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
    probes.push({
      label: 'dump two bad contracts for nothing',
      worked: accepts(l, {
        sides: [
          { teamId: USER, players: worst, picks: [] },
          { teamId: ai, players: [], picks: [] },
        ],
      }),
    });
  }
  {
    const l = fresh();
    room(l);
    // Ask for three of their firsts for a good starter they value below the picks' face value.
    const firsts = picksOf(l, ai, 1).slice(0, 3);
    const ctx = tradeContext(l);
    const face = firsts.reduce((s, pk) => s + pickValue(l, pk, l.teams[ai].gm, ctx), 0);
    const offer = best(l, USER).find(
      (p) =>
        playerValue(l, p, l.teams[ai], { ctx }) < face * 1.15 && playerValue(l, p, l.teams[ai], { ctx }) > face * 0.85,
    );
    probes.push({
      label: 'three firsts for a player worth about their face value',
      worked:
        !!offer &&
        accepts(l, {
          sides: [
            { teamId: USER, players: [offer.id], picks: [] },
            { teamId: ai, players: [], picks: firsts.map((p) => p.id) },
          ],
        }),
    });
  }
  {
    const l = fresh();
    room(l);
    // Sign a free agent and offer him straight to the AI for a pick it would otherwise give.
    const fa = freeAgents(l).sort((a, b) => playerOvr(b) - playerOvr(a))[0];
    signPlayer(l, fa, USER, { years: 1, apy: 1_000, bonusPct: 0, gtdPct: 0, voidYears: 0 }, 'minimum');
    const pick = picksOf(l, ai)
      .filter((p) => p.round === 7)
      .map((p) => p.id)
      .slice(0, 1);
    const v = evaluateTrade(l, {
      sides: [
        { teamId: USER, players: [fa.id], picks: [] },
        { teamId: ai, players: [], picks: pick },
      ],
    });
    probes.push({ label: 'sign a free agent and flip him at once', worked: v.accepts || !v.policy });
    probes.push({ label: 'the refusal names no week or number', worked: /\d/.test(v.message) });
  }
  {
    const l = fresh();
    room(l);
    // Sell a player for the cheapest of their picks they'd give, then try to buy him straight back for it.
    const ctx = tradeContext(l);
    const mine = best(l, USER).find((p) => playerOvr(p) >= 13 && playerOvr(p) < 15)!;
    const sale = (pk: DraftPick): TradeProposal => ({
      sides: [
        { teamId: USER, players: [mine.id], picks: [] },
        { teamId: ai, players: [], picks: [pk.id] },
      ],
    });
    const their = picksOf(l, ai)
      .sort((a, b) => pickValue(l, a, l.teams[ai].gm, ctx) - pickValue(l, b, l.teams[ai].gm, ctx))
      .reverse()
      .find((pk) => accepts(l, sale(pk)));
    let worked = false;
    if (their) {
      executeTrade(l, sale(their));
      worked = accepts(l, {
        sides: [
          { teamId: USER, players: [], picks: [their.id] },
          { teamId: ai, players: [mine.id], picks: [] },
        ],
      });
    }
    probes.push({ label: 'sell a player, then buy him straight back for the same pick', worked });
  }
  {
    // Proposing to one GM over and over: he hears about four a week, then he's done talking.
    const l = fresh();
    room(l);
    const proposal: TradeProposal = {
      sides: [
        {
          teamId: USER,
          players: best(l, USER)
            .slice(-1)
            .map((p) => p.id),
          picks: [],
        },
        { teamId: ai, players: [best(l, ai)[0].id], picks: [] },
      ],
    };
    const answers = Array.from({ length: 20 }, () => proposeTrade(l, proposal).message);
    probes.push({
      label: 'probing one GM 20 times in a week',
      worked: answers.slice(ASKS).some((m) => m !== "We're done talking this week."),
    });
  }
  {
    const l = fresh();
    const star = best(l, ai)[0];
    star.injury = {
      type: 'hamstring',
      severity: 'moderate',
      weeksRemaining: 4,
      estimate: [3, 5],
      season: l.season,
      week: l.week,
      where: 'game',
    };
    probes.push({
      label: 'trade for an injured star in season',
      worked: accepts(l, {
        sides: [
          { teamId: USER, players: [], picks: picksOf(l, USER, 1).map((p) => p.id) },
          { teamId: ai, players: [star.id], picks: [] },
        ],
      }),
    });
  }
}

// ───────── 5. Speed ─────────

const speed = { judge: NaN, week: [] as number[] };

/**
 * Milliseconds of the main thread's CPU a call takes. Wall time doubles when `npm run check` runs
 * other checks beside this one, so a busy machine could fail the budget on its own; the process's CPU
 * time counts V8's helper threads (garbage collection, compiling) as well. The main thread's is what
 * the player waits for on an idle machine. Wall time where Node has no thread timer.
 */
const threadCpu = (process as { threadCpuUsage?: (prev?: NodeJS.CpuUsage) => NodeJS.CpuUsage }).threadCpuUsage?.bind(
  process,
);
function cpuMs(fn: () => unknown): number {
  if (!threadCpu) {
    const t0 = performance.now();
    fn();
    return performance.now() - t0;
  }
  const t0 = threadCpu();
  fn();
  const t = threadCpu(t0);
  return (t.user + t.system) / 1000;
}

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
    proposals.push([
      b.id,
      {
        sides: [
          { teamId: a.id, players: [], picks: [pk.id] },
          { teamId: b.id, players: [p.id], picks: [] },
        ],
      },
    ]);
  }
  // Warm the reads the way a market pass would, then time the verdicts.
  for (const [id, pr] of proposals) judge(ctx, id, pr);
  speed.judge = cpuMs(() => proposals.forEach(([id, pr]) => judge(ctx, id, pr))) / proposals.length;
}

// ───────── 6. Volume and mix ─────────

const volume = {
  inSeason: [] as number[],
  deadline: 0,
  offseason: [] as number[],
  all: [] as TradeRecord[],
  seasons: 0,
  startingQbs: 0,
  tagTrades: 0,
};
const speedOff: number[] = [];

/**
 * Every trade a step made: value it in the truth, and check both teams after. New trades are told
 * apart by identity, not position: the history keeps five seasons, so older ones drop off its front.
 */
const audited = new WeakSet<TradeRecord>();
const readNews = new WeakSet<object>();
function audit(after: League): TradeRecord[] {
  physicalNews(after);
  // The deal's tag is in the news line, not the record.
  for (const t of after.transactions) {
    if (readNews.has(t)) continue;
    readNews.add(t);
    if (t.kind === 'trade' && t.text.includes('(tag and trade')) volume.tagTrades++;
  }
  const fresh = (after.market?.history ?? []).filter((r) => !audited.has(r));
  for (const record of fresh) {
    audited.add(record);
    if (record.physicals?.some((x) => x.result === 'concerns')) phys.flagged++;
    volume.all.push(record);
    checkHealth(
      after,
      record.sides.map((x) => x.teamId),
    );
  }
  return fresh;
}

// ───────── 7. Offers to you ─────────

const desk = {
  perYear: [] as number[],
  enquiries: 0,
  maxWeek: 0,
  maxDeadline: 0,
  afterDeadline: 0,
  untouchable: 0,
  listing: null as boolean | null,
};
const seenOffers = new Set<string>();

/** Offers that landed on your desk since the last look (offer ids are per league). */
function freshOffers(league: League, label: string): TradeOffer[] {
  const out = (league.market?.offers ?? []).filter((o) => !seenOffers.has(`${label}:${o.id}`));
  for (const o of out) {
    seenOffers.add(`${label}:${o.id}`);
    desk.untouchable += o.sides[1].players.filter((id) => league.market?.status[id] === 'untouchable').length;
    if (o.kind === 'enquiry') desk.enquiries++;
  }
  return out.filter((o) => o.kind !== 'enquiry');
}

/**
 * Put your best player at a position some team needs on the block: does an offer come within two market moments?
 * A player hurt in those two weeks fails any physical, so no bid for him can be built and he can't answer the
 * question: the next best is listed instead (up to three), on a fresh copy of the league.
 */
function listingDraws(base: League): boolean | null {
  const ctx = tradeContext(base);
  const needed = new Set(
    base.teams.filter((t) => t.id !== base.userTeamId).flatMap((t) => teamNeeds(ctx, t).map((n) => n.position)),
  );
  const shop = teamPlayers(base, base.userTeamId)
    .filter(
      (x) =>
        needed.has(x.position) &&
        x.contract &&
        yearsLeft(x.contract, base.season) >= 2 &&
        !playerTradeBlocker(base, x) &&
        base.market?.status[x.id] !== 'untouchable',
    )
    .sort((a, b) => playerOvr(b) - playerOvr(a))
    .slice(0, 3);
  for (const p of shop) {
    const l = clone(base);
    setTradeStatus(l, p.id, 'listed');
    const before = l.market?.nextOfferId ?? 1;
    let hurt = false;
    for (let w = 0; w < 2; w++) {
      playWeek(l);
      hurt ||= playerTradeBlocker(l, l.players[p.id]) !== null;
    }
    const drew = (l.market?.offers ?? []).some((o) => o.id >= before && o.sides[1].players.includes(p.id));
    if (drew || !hurt) return drew;
  }
  return null;
}

// ───────── 8. Physicals ─────────

const phys = { off: 0, flagged: 0, healthy: { failed: 0, n: 0 }, borderline: { strong: [0, 0], weak: [0, 0] } };
const seenNews = new WeakSet<object>();

/** Deals the physicals called off since the last look (the medical news line). */
function physicalNews(league: League): void {
  for (const t of league.transactions) {
    if (seenNews.has(t)) continue;
    seenNews.add(t);
    if (t.kind === 'medical' && / is off after /.test(t.text)) phys.off++;
  }
}

/**
 * Exams on demand: sound players examined by every doctor (they should almost never fail), and
 * borderline bodies by the league's sharpest and weakest doctors (the sharp ones should pass fewer).
 */
function probePhysicals(league: League): void {
  const players = Object.values(league.players).filter((p) => p.teamId !== null && !p.retired);
  const sound = players.filter(
    (p) =>
      !p.injury &&
      !(p.injuries ?? []).some(
        (r) => r.season > league.season - 3 && (r.severity === 'severe' || r.severity === 'career-threatening'),
      ),
  );
  for (const p of sound) {
    for (const t of league.teams) {
      if (t.id === p.teamId) continue;
      phys.healthy.n++;
      if (examine(league, t.id, p).result === 'failed') phys.healthy.failed++;
    }
  }
  // Players a doctor should flag (between the concerns line and the fail line): passing one is a
  // miss. The same exams by a sharp doctor (15) and a weak one (7), as the plan compares them.
  const borderline = players.filter((p) => findings(league, p).score >= CONCERNS && findings(league, p).score < FAIL);
  for (const [group, diagnosis] of [
    ['weak', 7],
    ['strong', 15],
  ] as const) {
    for (const p of borderline) {
      for (const t of league.teams) {
        if (t.id === p.teamId) continue;
        phys.borderline[group][1]++;
        if (examine(league, t.id, p, diagnosis).result === 'passed') phys.borderline[group][0]++;
      }
    }
  }
}

// ───────── run ─────────

for (let i = 0; i < LEAGUES; i++) {
  const league = createLeague({ seed: `trades-${i}` });
  const label = `L${i}`;
  live = league;
  liveLabel = label;
  // Prices in every league's first season: a bucket like deadline rentals has only a handful of players in one league.
  probePrices(league, 'preseason', i === 0);
  if (i === 0) {
    runProbes(league);
    timeJudge(league);
  }
  // Like most users, mark the two best players Untouchable: no offer may ask for them.
  for (const p of teamPlayers(league, league.userTeamId)
    .sort((a, b) => playerOvr(b) - playerOvr(a))
    .slice(0, 2))
    setTradeStatus(league, p.id, 'untouchable');
  for (let s = 0; s < SEASONS; s++) {
    fair.seasons++;
    volume.seasons++;
    // Exams on demand once the league has some injury history.
    if (s === 1) probePhysicals(league);
    const timing = i === 0 && s === 0;
    const season: TradeRecord[] = [];
    let offers = 0;
    while (league.phase === 'regular' && (league.week <= TRADE_DEADLINE_WEEK + 1 || isDeadlineDay(league))) {
      if (s === 0 && isDeadlineDay(league)) probePrices(league, 'deadline', i === 0);
      if (timing && isDeadlineDay(league)) {
        const ctx = tradeContext(league);
        futureSlots.push(...league.teams.map((t) => futureFirstSlot(league, t.gm, ctx)));
      }
      // The market alone, timed on a copy (the real week runs it again inside playWeek).
      if (timing && gamesInWeek(league).length) {
        const copy = clone(league);
        speed.week.push(cpuMs(() => marketMoment(copy, weekMoment(copy))));
      }
      if (i === 0 && s === 0 && league.week === 4) desk.listing = listingDraws(league);
      const starters = new Set(league.teams.map((t) => t.depthChart.QB[0]));
      const weekOf = league.week;
      playWeek(league);
      const landed = freshOffers(league, label).length;
      offers += landed;
      if (weekOf === TRADE_DEADLINE_WEEK) desk.maxDeadline = Math.max(desk.maxDeadline, landed);
      else desk.maxWeek = Math.max(desk.maxWeek, landed);
      const week = audit(league).filter((r) => r.phase === 'regular');
      season.push(...week);
      volume.startingQbs += week.filter((r) => r.sides.some((x) => x.players.some((id) => starters.has(id)))).length;
    }
    volume.inSeason.push(season.length);
    volume.deadline += season.filter((r) => r.week === TRADE_DEADLINE_WEEK).length;
    simToEndOfSeason(league);
    desk.afterDeadline += freshOffers(league, label).length;
    // The offseason, step by step, each step's trades audited as it goes.
    beginOffseason(league);
    let offseason = audit(league).length;
    offers += freshOffers(league, label).length;
    if (timing) {
      const copy = clone(league);
      speedOff.push(cpuMs(() => marketMoment(copy, 'leagueYear')));
    }
    for (let guard = 0; guard < 20 && league.phase !== 'regular'; guard++) {
      if (timing && (league.phase === 'freeAgency' || league.phase === 'preseason')) {
        const copy = clone(league);
        speedOff.push(cpuMs(() => marketMoment(copy, league.phase === 'freeAgency' ? 'faDay' : 'camp')));
      }
      advanceOffseason(league, { autoUser: true });
      offseason += audit(league).length;
      offers += freshOffers(league, label).length;
    }
    volume.offseason.push(offseason);
    desk.perYear.push(offers);
  }
}

console.log('\nPrices (median JJ points at projected slots, future picks 25% off a year; examples below)');
for (const [moment, buckets] of Object.entries(prices)) {
  console.log(` ${moment}:`);
  check(`star (top 3 at a premium position) n=${buckets.star.length}`, median(buckets.star), [1000, 3500]);
  check(`quality starter (top quarter, 1-2 years) n=${buckets.quality.length}`, median(buckets.quality), [400, 1300]);
  if (moment === 'deadline')
    check(`deadline rental (expiring starter) n=${buckets.rental.length}`, median(buckets.rental), [35, 150]);
  check(`depth n=${buckets.depth.length}`, median(buckets.depth), [0, 40]);
}
note('good starters in their prime, worth a 6th or more, sold for 7th-round picks only', String(starterForSeventh));
for (const e of seventhExamples) console.log(`    ${e}`);
for (const e of examples) console.log(`    ${e}`);

console.log('\nFuture picks');
check("next year's first, as a current pick (median over GMs)", median(futureSlots), [22, 45]);

console.log(
  `\nNo cheese (${fair.trades} AI deals over ${fair.seasons} seasons, each read as it closed: ${[...fair.kinds].map(([k, n]) => `${n} ${k}`).join(', ')})`,
);
check('AI deals a side lost in its own eyes', fair.cheese.length, [0, 0]);
for (const line of fair.cheese.slice(0, 10)) console.log(`    ✗ ${line}`);
check('teams over the cap or short after a trade', fair.health, [0, 0]);

console.log("\nBad business, explained (a GM's misreads and his own situation are his to live with)");
note('median truth gap between the sides (% of the stakes)', (median(fair.gaps) * 100).toFixed(0));
const lopsided = fair.lopsided.scouts + fair.lopsided.situation;
note(
  `trades over 3:1 in truth, a season (scouts ${fair.lopsided.scouts}, situation ${fair.lopsided.situation})`,
  (lopsided / Math.max(1, fair.seasons)).toFixed(2),
);
const ledgers = [...fair.ledgers].sort((x, y) => x[1].truth - y[1].truth);
const worst = ledgers.reduce<(typeof ledgers)[number] | null>(
  (w, x) => (!w || Math.abs(x[1].truth) > Math.abs(w[1].truth) ? x : w),
  null,
);
if (worst) {
  const [key, l] = worst;
  const seen = l.truth + l.scouts + l.situation;
  const share = (x: number) => `${Math.round((100 * x) / Math.max(1, l.scouts + l.situation))}%`;
  note("worst team's truth balance over its league's run", l.truth.toFixed(0));
  console.log(
    `    ${key}: ${seen >= 0 ? '+' : ''}${seen.toFixed(0)} in its own eyes; the difference ${share(l.scouts)} its scouts' misreads, ${share(l.situation)} its own situation`,
  );
}
if (VERBOSE) {
  // The biggest losers and winners, each trade with what explains it.
  for (const [key, l] of ledgers.filter((_, i, all) => i < 5 || i >= all.length - 3)) {
    console.log(
      `  balance ${key} ${l.truth.toFixed(0)} (scouts ${l.scouts.toFixed(0)}, situation ${l.situation.toFixed(0)}, ${l.lines.length} trades)`,
    );
    if (Math.abs(l.truth) > 1000) for (const line of l.lines) console.log(`      ${line}`);
  }
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
const share = (f: (r: TradeRecord) => boolean) => (100 * volume.all.filter(f).length) / Math.max(1, volume.all.length);
const kinds = new Map<string, number>();
for (const r of volume.all) kinds.set(r.kind, (kinds.get(r.kind) ?? 0) + 1);
console.log(
  `\nVolume and mix (${volume.all.length} AI trades over ${volume.seasons} seasons: ${[...kinds].map(([k, n]) => `${n} ${k}`).join(', ')})`,
);
check('trades in season (week 1 to deadline day), a season', mean(volume.inSeason), [15, 25], 1);
// The leagues' seasons in order, so a drift over a long run shows (league by league, season by season).
const byYear = Array.from({ length: SEASONS }, (_, y) => mean(volume.inSeason.filter((_, k) => k % SEASONS === y)));
console.log(`  in season, by year of the run: ${byYear.map((x) => x.toFixed(1)).join(' · ')}`);
check(
  'share of them on deadline day (%)',
  (100 * volume.deadline) /
    Math.max(
      1,
      volume.inSeason.reduce((a, b) => a + b, 0),
    ),
  [30, 50],
);
check('trades in the offseason (league year to camp), a year', mean(volume.offseason), [15, 35], 1);
check(
  'picks for players (%)',
  share((r) => r.kind !== 'swap' && r.kind !== 'dump' && r.kind !== 'futureSwap'),
  [55, 80],
);
const perYear = (kind: string) =>
  (volume.all.filter((r) => r.kind === kind).length / Math.max(1, volume.seasons)).toFixed(1);
console.log(`  next year's pick for this year's, a league year: ${perYear('futureSwap')}`);
console.log(
  `  cap casualties sold for a late pick instead of cut, a league year: ${perYear('casualty')}; cut-down deals in camp: ${perYear('cutdown')}`,
);
const extended = volume.all.filter((r) => r.extended?.length).length / Math.max(1, volume.seasons);
console.log(
  `  salary retained, a season: ${(volume.all.filter((r) => r.sides.some((x) => x.retain)).length / Math.max(1, volume.seasons)).toFixed(1)}`,
);
console.log(
  `  tag and trade, a league year: ${(volume.tagTrades / Math.max(1, volume.seasons)).toFixed(1)}; traded and extended on arrival: ${extended.toFixed(1)}`,
);
check(
  'player swaps (%)',
  share((r) => r.kind === 'swap'),
  [5, 15],
);
check(
  'cap dumps, a season',
  volume.all.filter((r) => r.kind === 'dump').length / Math.max(1, volume.seasons),
  [1, 4],
  1,
);
check(
  'a pick going each way, a late one riding back (%)',
  share((r) => r.kind !== 'futureSwap' && r.sides.every((x) => x.picks.length > 0)),
  [10, 25],
);
// Palmer (2011), Dobbs (2023) and Flacco (2025): a starting quarterback moves in season once every few years.
check(
  'starting quarterbacks traded in season, a season',
  volume.startingQbs / Math.max(1, volume.seasons),
  [0, 0.5],
  2,
);
check(
  'division rivals (%)',
  share((r) => {
    const [a, b] = r.sides.map((x) => x.teamId);
    return a < 32 && b < 32 && DIVISION_OF[a] === DIVISION_OF[b];
  }),
  [0, 5],
);

console.log(
  `\nOffers to you (autopilot, nothing listed, your two best Untouchable; ${(desk.enquiries / Math.max(1, desk.perYear.length)).toFixed(1)} enquiries a year besides)`,
);
check('offers, a league year', mean(desk.perYear), [10, 25], 1);
check('most in an ordinary week', desk.maxWeek, [0, 2]);
check('most on deadline day', desk.maxDeadline, [0, 4]);
check('after the deadline', desk.afterDeadline, [0, 0]);
check('asking for an Untouchable', desk.untouchable, [0, 0]);
check('listing a player draws an offer within two moments (1 = yes)', desk.listing === false ? 0 : 1, [1, 1]);

const rate = ([pass, n]: number[]) => (n ? pass / n : NaN);
console.log(
  `\nPhysicals (${phys.off} deals off, ${phys.flagged} through with concerns; bodies a doctor should flag: ${phys.borderline.strong[1]} exams by sharp doctors, ${phys.borderline.weak[1]} by weak)`,
);
check(
  'deals voided or through with concerns, league-wide, a season',
  (phys.off + phys.flagged) / Math.max(1, volume.seasons),
  [1, 4],
  1,
);
check('sound players failing (%)', (100 * phys.healthy.failed) / Math.max(1, phys.healthy.n), [0, 1], 2);
check(
  'bodies a doctor should flag, passed: a sharp doctor (15) against a weak one (7), ratio',
  rate(phys.borderline.strong) / rate(phys.borderline.weak),
  [0, 0.85],
  2,
);

console.log('\nProbes (each must fail)');
for (const p of probes) console.log(`  ${p.worked ? '✗ WORKED' : '✓ failed'}  ${p.label}`);
check('exploits that worked', probes.filter((p) => p.worked).length, [0, 0]);

console.log('\nSpeed');
check('one verdict, warm cache (ms)', speed.judge, [0, 0.6], 3);
check('one week of the market (ms, median)', median(speed.week), [0, 120], 1);
check('one offseason market moment (ms, median)', median(speedOff), [0, 300], 1);

console.log(`\n${misses} number(s) outside target range`);
process.exit(misses ? 1 : 0);
