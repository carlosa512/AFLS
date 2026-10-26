/**
 * The director of scouting's recommendations (`docs/NEWS.md`): four mails a year with two to four moves for us,
 * read through our scouts. In season the lean comes from the playoff race; in the offseason, the players about to
 * reach free agency and the free agents our cap can carry. Pure functions over the league: no randomness.
 */
import { employed } from './employment';
import { isExpired, lastSeason, yearsLeft } from './finance/contract';
import { leagueMarket, marketApy } from './finance/market';
import { freeAgents } from './offseason/negotiation';
import { STARTERS } from './positions';
import { teamPlayers } from './roster';
import { viewCache } from './scouting';
import { computeRecords, conferenceSeeds, type TeamRecord } from './season/standings';
import { spendable, tradeContext } from './trade/context';
import { stanceOf, teamNeeds, type Need } from './trade/plans';
import { salaryToTake } from './trade/rules';
import { marketValue, slotRate } from './trade/value';
import type { AdviceRow, League, Player, Position, Stance } from './types';

export type AdviceLean = 'buy' | 'targeted' | 'sell';

/** Where we stand in our conference's race: games behind the last seed (0 while we hold one) and our seed. */
export function raceFor(
  league: League,
  records: Map<number, TeamRecord> = computeRecords(league),
): { gamesBack: number; seed: number | null; record: TeamRecord } {
  const me = records.get(league.userTeamId)!;
  const seeds = conferenceSeeds(league, league.teams[league.userTeamId].conference, records);
  const at = seeds.indexOf(league.userTeamId);
  if (at >= 0) return { gamesBack: 0, seed: at + 1, record: me };
  const last = records.get(seeds[seeds.length - 1])!;
  // Games back; a tie is half a win and half a loss, so ties cancel out of the difference.
  const gamesBack = (last.w - me.w + (me.l - last.l)) / 2;
  return { gamesBack: Math.max(0, gamesBack), seed: null, record: me };
}

/** In the race or within a game: add. Two or three back: one in, one out. Further: sell. */
export const adviceLean = (gamesBack: number): AdviceLean =>
  gamesBack <= 1 ? 'buy' : gamesBack <= 3 ? 'targeted' : 'sell';

/** Our needs, most urgent first. Our own players' visible ratings are exact (`perceive`), so this is our view too. */
export function adviceNeeds(league: League): Need[] {
  if (!employed(league)) return [];
  return teamNeeds(tradeContext(league), league.teams[league.userTeamId]);
}

const ROUNDS = ['1st', '2nd', '3rd', '4th', '5th', '6th', '7th'];

/** A trade value in the words a director uses: the round of a mid-round pick it reaches. */
export function pickRoundFor(_league: League, value: number): string {
  const mark = (round: number) => slotRate(16 + 32 * round);
  if (value >= 1.5 * mark(0)) return 'a 1st and more';
  const round = ROUNDS.findIndex((_, r) => value >= mark(r));
  return round < 0 ? 'a late-round pick' : `likely a ${ROUNDS[round]}`;
}

/** Below this, our scouts don't know a player well enough to put his name in a recommendation. */
const MIN_KNOWLEDGE = 0.35;
/** An upgrade has to clear our current starter by this much on our read. */
const MIN_GAIN = 0.5;
/** The stances the market shows as selling: their players are fair game to ask about. */
const SELLING: readonly Stance[] = ['rebuild', 'retool'];
const COUNT = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine'];
const nameOf = (p: Player) => `${p.firstName} ${p.lastName}`;
const perYear = (k: number) => `$${(k / 1000).toFixed(1)}M a year`;

type Read = ReturnType<typeof viewCache>;

/** Our weakest starter's overall at a position on our read: the bar a target has to clear. */
function ourBar(league: League, view: Read, pos: Position): number {
  const mine = teamPlayers(league, league.userTeamId)
    .filter((p) => p.position === pos && !p.ir && !(p.contract && isExpired(p.contract, league.season)))
    .map((p) => view(league.userTeamId, p).ovr)
    .sort((a, b) => b - a);
  return mine[STARTERS[pos] - 1] ?? 0;
}

const row = (p: Player, kind: AdviceRow['kind'], why: string, price: string, extra: Partial<AdviceRow> = {}) =>
  ({
    kind,
    playerId: p.id,
    teamId: p.teamId,
    name: nameOf(p),
    position: p.position,
    why,
    price,
    ...extra,
  }) as AdviceRow;

/** The best-scoring candidate per position, then the best of those. */
function bestPerPosition<T extends { p: Player; score: number }>(xs: T[], max: number): T[] {
  const best = new Map<Position, T>();
  for (const x of xs) if ((best.get(x.p.position)?.score ?? -1) < x.score) best.set(x.p.position, x);
  return [...best.values()].sort((a, b) => b.score - a.score).slice(0, max);
}

/** Candidates at our needs who clear our bar on our read, with the gain over our starter. */
function upgrades(league: League, pool: Player[], view: Read) {
  const out: { p: Player; need: Need; gain: number; rank: number }[] = [];
  const needs = adviceNeeds(league);
  needs.forEach((need, rank) => {
    const bar = ourBar(league, view, need.position);
    for (const p of pool) {
      if (p.position !== need.position) continue;
      const v = view(league.userTeamId, p);
      if (v.knowledge < MIN_KNOWLEDGE || v.ovr - bar < MIN_GAIN) continue;
      out.push({ p, need, gain: v.ovr - bar, rank });
    }
  });
  return out;
}

/**
 * Players we could trade for, from what the market makes public: a club the market shows selling, or a player named
 * in a shopping rumor this season. Never another club's private trade block.
 */
export function buyTargets(league: League, opts: { rentals: boolean; max: number; room?: number }): AdviceRow[] {
  if (!employed(league)) return [];
  const ctx = tradeContext(league),
    us = league.teams[league.userTeamId];
  const room = opts.room ?? spendable(ctx, us.id);
  const shopped = new Set(
    (league.market?.rumors ?? [])
      .filter((r) => r.kind === 'shopping' && r.season === league.season)
      .map((r) => r.playerId),
  );
  const pool = Object.values(league.players).filter(
    (p) =>
      p.teamId !== null &&
      p.teamId !== us.id &&
      !p.retired &&
      !!p.contract &&
      !isExpired(p.contract, league.season) &&
      (shopped.has(p.id) || SELLING.includes(stanceOf(league.teams[p.teamId]))),
  );
  const scored = upgrades(league, pool, viewCache(league)).flatMap(({ p, need, gain, rank }) => {
    const left = yearsLeft(p.contract!, league.season);
    if (left <= 1 && !opts.rentals) return [];
    if (salaryToTake(league, p) > room) return [];
    // A division rival's player is the last call, as for AI buyers.
    const rival = league.teams[p.teamId!].division === us.division ? 0.3 : 1;
    return [{ p, need, gain, rank, left, score: need.urgency * Math.min(gain, 4) * (1 + left / 3) * rival }];
  });
  return bestPerPosition(scored, opts.max).map(({ p, need, rank, left }) =>
    row(
      p,
      'buy',
      left <= 1
        ? `Rental: his deal ends this season, and he'd start for us at ${p.position}.`
        : need.reason === 'hole'
          ? `We're short at ${p.position}; he'd start, signed through ${lastSeason(p.contract!)}.`
          : rank === 0
            ? `A starter at our weakest spot (${p.position}), signed through ${lastSeason(p.contract!)}.`
            : `An upgrade at ${p.position}, signed through ${lastSeason(p.contract!)}.`,
      pickRoundFor(league, marketValue(ctx, us, p)),
    ),
  );
}

/** The first club the market shows buying: who we'd call to sell. */
const buyer = (league: League) =>
  league.teams.find((t) => t.id !== league.userTeamId && stanceOf(t) === 'contend') ??
  league.teams.find((t) => t.id !== league.userTeamId)!;

/** Clubs that asked about each of our players this season: offers and enquiries made to us, and interest rumors. */
function askedAbout(league: League): Map<number, number[]> {
  const asked = new Map<number, number[]>();
  const add = (playerId: number, club: number) => {
    const clubs = asked.get(playerId) ?? [];
    if (!clubs.includes(club)) asked.set(playerId, [...clubs, club]);
  };
  for (const o of league.market?.offers ?? []) {
    if (o.season !== league.season) continue;
    for (const id of o.sides.find((s) => s.teamId === league.userTeamId)?.players ?? []) add(id, o.teamId);
  }
  for (const r of league.market?.rumors ?? [])
    if (r.kind === 'interest' && r.season === league.season && league.players[r.playerId]?.teamId === league.userTeamId)
      add(r.playerId, r.teamIds[0]);
  return asked;
}

/**
 * Our players worth moving: first anyone clubs have asked about; then, selling, a veteran starter whose deal ends this
 * season; or, with one in and one out, depth we can spare.
 */
export function sellCandidates(league: League, lean: AdviceLean, max: number): AdviceRow[] {
  if (!employed(league)) return [];
  const ctx = tradeContext(league),
    view = viewCache(league),
    to = buyer(league);
  const ours = teamPlayers(league, league.userTeamId).filter(
    (p) => !p.ir && !!p.contract && !isExpired(p.contract, league.season),
  );
  const price = (p: Player) => pickRoundFor(league, marketValue(ctx, to, p));
  const out: AdviceRow[] = [];
  for (const [id, clubs] of askedAbout(league)) {
    const p = league.players[id];
    if (!ours.includes(p)) continue;
    const n = clubs.length;
    out.push(
      row(p, 'sell', `${n === 1 ? 'A club has' : `${COUNT[n] ?? n} clubs have`} asked about him.`, price(p), {
        partnerId: clubs[0],
      }),
    );
  }
  const starters = (pos: Position) =>
    ours
      .filter((p) => p.position === pos)
      .sort((a, b) => view(league.userTeamId, b).ovr - view(league.userTeamId, a).ovr);
  for (const p of ours) {
    if (out.some((r) => r.playerId === p.id)) continue;
    const room = starters(p.position);
    const at = room.indexOf(p);
    if (lean === 'sell' && p.age >= 29 && yearsLeft(p.contract!, league.season) <= 1 && at < STARTERS[p.position])
      out.push(
        row(p, 'sell', `${p.age} and out of contract after the season: worth more to a contender now.`, price(p), {
          partnerId: to.id,
        }),
      );
    if (lean === 'targeted' && at === STARTERS[p.position] && room.length > STARTERS[p.position] + 1)
      out.push(
        row(
          p,
          'sell',
          `Depth we can spare at ${p.position}: he's behind our starters and would start elsewhere.`,
          price(p),
          {
            partnerId: to.id,
          },
        ),
      );
  }
  return out.slice(0, max);
}

/** Other clubs' players whose deals have run out and who'd start for us: free agency opens soon. */
export function expiringTargets(league: League, max: number): AdviceRow[] {
  if (!employed(league)) return [];
  const market = leagueMarket(league);
  const pool = Object.values(league.players).filter(
    (p) =>
      p.teamId !== null &&
      p.teamId !== league.userTeamId &&
      !p.retired &&
      !!p.contract &&
      isExpired(p.contract, league.season),
  );
  const scored = upgrades(league, pool, viewCache(league)).map((x) => ({
    ...x,
    score: x.need.urgency * Math.min(x.gain, 4),
  }));
  return bestPerPosition(scored, max).map(({ p }) =>
    row(
      p,
      'sign',
      `Free agency opens soon: he'd start for us at ${p.position}.`,
      `about ${perYear(marketApy(market, p))}`,
    ),
  );
}

/** The best free agents at our needs whose asking price fits our room. */
export function faTargets(league: League, max: number, room?: number): AdviceRow[] {
  if (!employed(league)) return [];
  const market = leagueMarket(league);
  const space = room ?? spendable(tradeContext(league), league.userTeamId);
  const pool = freeAgents(league).filter((p) => marketApy(market, p) <= space);
  const scored = upgrades(league, pool, viewCache(league)).map((x) => ({
    ...x,
    score: x.need.urgency * Math.min(x.gain, 4),
  }));
  return bestPerPosition(scored, max).map(({ p, need }) =>
    row(
      p,
      'sign',
      need.reason === 'hole' ? `We're short at ${p.position}; he'd start.` : `He'd start for us at ${p.position}.`,
      `asking about ${perYear(marketApy(market, p))}`,
    ),
  );
}

