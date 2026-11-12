/**
 * The director of scouting's recommendations (`docs/NEWS.md`): four mails a year with two to four moves for us,
 * read through our scouts. In season the lean comes from the playoff race; in the offseason, the players about to
 * reach free agency and the free agents our cap can carry. Pure functions over the league: no randomness.
 */
import { employed } from './employment';
import { isExpired, lastSeason, yearsLeft } from './finance/contract';
import { leagueMarket, marketApy } from './finance/market';
import { availableProspects, availableRanks, boardOf, boardScore, positionDepth } from './offseason/draft';
import { demand, freeAgents } from './offseason/negotiation';
import { STARTERS } from './positions';
import { teamPlayers } from './roster';
import { perceive, viewCache } from './scouting';
import { computeRecords, conferenceSeeds, type TeamRecord } from './season/standings';
import { spendable, tradeContext } from './trade/context';
import { stanceOf, teamNeeds, type Need } from './trade/plans';
import { salaryToTake, TRADE_DEADLINE_WEEK } from './trade/rules';
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
export const MIN_KNOWLEDGE = 0.35;
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
    const rival = league.teams[p.teamId!].division === us.division;
    return [{ p, need, gain, rank, left, rival, score: need.urgency * Math.min(gain, 4) * (1 + left / 3) }];
  });
  // A division rival's player is the last call: only where no one outside the division clears the bar.
  const clear = new Set(scored.filter((x) => !x.rival).map((x) => x.p.position));
  return bestPerPosition(
    scored.filter((x) => !x.rival || !clear.has(x.p.position)),
    opts.max,
  ).map(({ p, need, rank, left }) =>
    row(
      p,
      'buy',
      left <= 1
        ? `He is a rental. His deal ends this season, and he'd start for us at ${p.position}.`
        : need.reason === 'hole'
          ? `We're short at ${p.position}, and he'd start, signed through ${lastSeason(p.contract!)}.`
          : rank === 0
            ? `He would start at our weakest spot (${p.position}), signed through ${lastSeason(p.contract!)}.`
            : `He is an upgrade at ${p.position}, signed through ${lastSeason(p.contract!)}.`,
      pickRoundFor(league, marketValue(ctx, us, p)),
    ),
  );
}

/** Who we'd call to sell: a club the market shows buying, outside our division if there is one. */
function buyer(league: League) {
  const us = league.teams[league.userTeamId];
  const others = league.teams.filter((t) => t.id !== us.id);
  const outside = others.filter((t) => t.division !== us.division);
  return (
    outside.find((t) => stanceOf(t) === 'contend') ??
    others.find((t) => stanceOf(t) === 'contend') ??
    outside[0] ??
    others[0]
  );
}

/** Clubs that asked us about each of our players this season: the offers and enquiries made to us. */
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
    (p) =>
      !p.ir && !!p.contract && !isExpired(p.contract, league.season) && league.market?.status[p.id] !== 'untouchable',
  );
  const us = league.teams[league.userTeamId];
  // Our read of our own player (exact), never the buyer's private one.
  const price = (p: Player) => pickRoundFor(league, marketValue(ctx, us, p));
  const out: AdviceRow[] = [];
  for (const [id, clubs] of askedAbout(league)) {
    const p = league.players[id];
    if (!ours.includes(p)) continue;
    const n = clubs.length;
    out.push(
      row(p, 'sell', `${n === 1 ? 'A team has' : `${COUNT[n] ?? n} teams have`} asked about him.`, price(p), {
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
        row(
          p,
          'sell',
          `He is ${p.age} and out of contract after the season, so he is worth more to a contender now.`,
          price(p),
          {
            partnerId: to.id,
          },
        ),
      );
    if (lean === 'targeted' && at === STARTERS[p.position] && room.length > STARTERS[p.position] + 1)
      out.push(
        row(
          p,
          'sell',
          `We can spare him at ${p.position}, where he's behind our starters and would start elsewhere.`,
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
    row(p, 'sign', `He would start for us at ${p.position}.`, `about ${perYear(marketApy(market, p))}`),
  );
}

/** How far ahead of his consensus rank a prospect can go and still be called there for us. */
const REACH = 2;
const PLACE = ['first', 'second', 'third', 'fourth'];

/**
 * The draft, on our scouts' board (`boardOf`, the board our own pick would be made from): at each of our first picks,
 * the players they like best of those who should still be there. Who is there is the consensus's guess (public);
 * the order is ours, need included.
 */
export function draftTargets(league: League, picksMax = 3, each = 3): AdviceRow[] {
  if (!employed(league) || !league.draftClass?.length) return [];
  const user = league.userTeamId;
  const picks = league.draftPicks
    .filter(
      (p) => p.season === league.season && p.ownerId === user && p.playerId === undefined && p.overall !== undefined,
    )
    .sort((a, b) => a.overall! - b.overall!)
    .slice(0, picksMax);
  if (!picks.length) return [];
  const ranks = availableRanks(league);
  const depth = positionDepth(league, user);
  const needs = new Set(adviceNeeds(league).map((n) => n.position));
  const pool = availableProspects(league).map((p) => ({ p, board: boardOf(league, user, p) }));
  const taken = new Set<number>();
  const out: AdviceRow[] = [];
  for (const pick of picks) {
    const there = pool
      .filter((x) => !taken.has(x.p.id) && (ranks.get(x.p.id) ?? Infinity) >= pick.overall! - REACH)
      .map((x) => ({ ...x, score: boardScore(depth, x.p, x.board, null, pick.round) }))
      .sort((a, b) => b.score - a.score || a.p.id - b.p.id)
      .slice(0, each);
    there.forEach(({ p }, i) => {
      taken.add(p.id);
      out.push(
        row(
          p,
          'draft',
          `He is ${PLACE[i]} on our board at No. ${pick.overall}${needs.has(p.position) ? `, and ${p.position} is a need` : ''}.`,
          `consensus No. ${ranks.get(p.id)}`,
          { pick: { overall: pick.overall!, round: pick.round } },
        ),
      );
    });
  }
  return out;
}

/** The best free agents at our needs whose asking price fits our room. */
export function faTargets(league: League, max: number, room?: number): AdviceRow[] {
  if (!employed(league)) return [];
  const space = room ?? spendable(tradeContext(league), league.userTeamId);
  // The agent's ask, not the market rate: it's what we'd have to find room for.
  const ask = (p: Player) => demand(league, p, league.userTeamId).askApy;
  const pool = freeAgents(league).filter((p) => ask(p) <= space);
  const scored = upgrades(league, pool, viewCache(league)).map((x) => ({
    ...x,
    score: x.need.urgency * Math.min(x.gain, 4),
  }));
  return bestPerPosition(scored, max).map(({ p, need }) =>
    row(
      p,
      'sign',
      need.reason === 'hole' ? `We're short at ${p.position}, and he'd start.` : `He'd start for us at ${p.position}.`,
      `asking about ${perYear(ask(p))}`,
    ),
  );
}

export type AdviceMoment = 'w6' | 'w9' | 'resign' | 'fa';

/** The moment the league is at, if it's one the director writes at. Never a moment already gone by. */
export function adviceMoment(league: League): AdviceMoment | null {
  if (league.phase === 'regular' && league.week === TRADE_DEADLINE_WEEK - 3) return 'w6';
  if (league.phase === 'regular' && league.week === TRADE_DEADLINE_WEEK) return 'w9';
  if (league.phase === 'resign') return 'resign';
  if (league.phase === 'freeAgency' && league.faDay === 1) return 'fa';
  return null;
}

export interface Advice {
  moment: AdviceMoment;
  subject: string;
  body: string;
  lean?: AdviceLean;
  rows: AdviceRow[];
}

const ORDINALS = ['', 'top', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh'];
const games = (n: number) => (n === 0.5 ? 'half a game' : n === 1 ? 'a game' : `${n} games`);

/** Where we stand, in the director's words, and what that means given what he found: the mail's opening line. */
function standing(race: ReturnType<typeof raceFor>, lean: AdviceLean, rows: AdviceRow[]): string {
  const r = race.record;
  const rec = `${r.w}–${r.l}${r.t ? `–${r.t}` : ''}`;
  const where = race.seed
    ? `We're ${rec} and hold the ${ORDINALS[race.seed]} seed`
    : race.gamesBack === 0
      ? `At ${rec} we're level with the last playoff spot`
      : `At ${rec} we're ${games(race.gamesBack)} out of the last playoff spot`;
  if (!rows.length) return `${where}. Nothing is worth chasing, so we hold.`;
  if (lean === 'buy') return `${where}. It is time to add.`;
  if (lean === 'sell') return `${where}. I'd sell.`;
  const buys = rows.some((x) => x.kind === 'buy'),
    sells = rows.some((x) => x.kind === 'sell');
  return `${where}: ${buys && sells ? 'one upgrade, and one player we can spare' : buys ? 'one upgrade worth making' : 'one player we can spare'}.`;
}

/**
 * What the director writes at this moment, or null: nothing outside the four moments, nothing while we have no job,
 * and no offseason mail without a name in it. `room` overrides our cap room (tests).
 */
export function adviceFor(league: League, room?: number): Advice | null {
  const moment = adviceMoment(league);
  if (!moment || !employed(league)) return null;
  if (moment === 'resign' || moment === 'fa') {
    const named =
      moment === 'resign'
        ? [...expiringTargets(league, 2), ...buyTargets(league, { rentals: false, max: 1, room })]
        : faTargets(league, 4, room);
    if (!named.length) return null;
    // The draft on our scouts' board, at each of our first picks.
    const draft = draftTargets(league);
    const rows = [...named, ...draft];
    // Said once, not under every name: early in the year our scouts have seen little of the class.
    const thin = draft.filter(
      (r) => perceive(league, league.userTeamId, league.players[r.playerId]).knowledge < MIN_KNOWLEDGE,
    );
    const also = !draft.length
      ? ''
      : ' For the draft, these are the players our scouts like best at each of our first picks.' +
        (thin.length * 2 >= draft.length
          ? ' We have seen little of this class so far, so the board is going to move.'
          : '');
    const n = named.length;
    return moment === 'resign'
      ? {
          moment,
          rows,
          subject: "Before free agency: who's available",
          body: `Free agency opens after the re-sign window. These are the names I would watch.${also}`,
        }
      : {
          moment,
          rows,
          subject: `Free agency: ${n === 1 ? 'one fit' : `${COUNT[n].toLowerCase()} fits`}`,
          body: `Free agency is open. These fit our needs and our cap.${also}`,
        };
  }
  const race = raceFor(league);
  const lean = adviceLean(race.gamesBack);
  const rows =
    lean === 'buy'
      ? buyTargets(league, { rentals: true, max: 3, room })
      : lean === 'targeted'
        ? [...buyTargets(league, { rentals: false, max: 1, room }), ...sellCandidates(league, 'targeted', 1)]
        : sellCandidates(league, 'sell', 3);
  const prefix = moment === 'w6' ? 'Three weeks to the deadline' : 'Deadline week';
  const buys = rows.filter((r) => r.kind === 'buy').length;
  const subject = !rows.length
    ? `${prefix}: we hold`
    : lean === 'sell'
      ? `${prefix}: what we could sell`
      : lean === 'targeted' && buys && buys < rows.length
        ? `${prefix}: one in, one out`
        : buys === rows.length
          ? `${prefix}: ${buys === 1 ? 'one upgrade' : `${COUNT[buys].toLowerCase()} upgrades`}`
          : `${prefix}: ${rows.length === 1 ? 'one move' : `${COUNT[rows.length].toLowerCase()} moves`}`;
  const deadline = moment === 'w6' ? ` The deadline is the day after week ${TRADE_DEADLINE_WEEK}.` : '';
  const body = `${standing(race, lean, rows)}${deadline}`;
  return { moment, lean, rows, subject, body };
}
