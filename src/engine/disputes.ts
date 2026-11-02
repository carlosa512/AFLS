/**
 * Disputes (docs/superpowers/specs/2026-10-30-morale-escalations-design.md, G4): a talk that ended badly (ignored,
 * answered firm, a promise broken) and a man still Very poor four steps later, with that talk's cause still his top
 * reason, escalates: a hold-in or a holdout over a deal, a trade request over the rest. One step runs at the end of every
 * morale step, after the talks; it draws nothing, and what it does to rosters and games sits behind `MOOD_ACTS`.
 */
import { MOOD_ACTS } from './disputeRead';
import { isExpired, yearOf, yearsLeft } from './finance/contract';
import { addJolt, expectedRole, moraleContext, moraleLevel, moraleFactors, type MoraleContext } from './morale';
import { aiCutdown, aiSettle, winNow } from './offseason/ai';
import { demand, extensionBlocker, ROSTER_MAX, rosterLimit } from './offseason/negotiation';
import { aiReply, canPromise, gameCount, talkCause, talksAt } from './playerTalks';
import { TRAIT_MEAN } from './traits';
import { emptyMarket } from './trade/execute';
import { employed } from './employment';
import { playerOvr, STARTERS } from './positions';
import { activeRoster, isAvailable } from './roster';
import type { Dispute, DisputeChoice, DisputeHow, DisputeKind, League, Player, Rumor } from './types';
import { DISPUTE_LABEL, DISPUTE_PUBLIC, DISPUTE_SAID, disputeStanding } from './disputeVoice';

export { aiSettle } from './offseason/ai';
export { promisedDeal } from './disputeRead';

/** The club whose disputes you answer: yours, while you have a job. */
const yourClub = (league: League) => (employed(league) ? league.userTeamId : null);

/** Very poor steps in a row after a talk soured before he escalates. */
export const RUN_STEPS = 4;
/** The last step a contract dispute can start in: camp. */
const CAMP = 7;
/** Morale's clock: steps in a league year, and the first regular-season step (before week 1's games). */
const YEAR = 32;
const REGULAR = 8;
/** Weekly game checks in a season. */
const CHECKS = 18;
/** A veteran's camp fine: $50K a day (the 2020 CBA) over about 45 days of camp, $K. */
export const CAMP_FINE = 2250;
/** Very poor or worse, as the words read it. */
const VERY_POOR = -3;
/** Steps a trade request stays private before it leaks; an outspoken man's, fewer (G4b). */
export const LEAK_STEPS = 6;
export const LEAK_LOUD = 3;
/** Rumors the market keeps (as `trade/market.ts` does). */
const KEEP_RUMORS = 80;
/** The last step a firm club thinks a dispute over: after week 4's games (holdouts rarely run past a month in). */
const REVIEW_UNTIL = REGULAR + 4;

/** A holdout when he's a greedy veteran starter off his rookie deal (or in its option year); otherwise a hold-in. */
export function disputeKind(league: League, p: Player, ctx: MoraleContext): 'holdIn' | 'holdOut' {
  const c = p.contract;
  const offRookie =
    !!c && (c.kind !== 'rookie' || (c.fifthYearOption === 'exercised' && yearsLeft(c, league.season) === 1));
  return offRookie && expectedRole(p, ctx) === 2 && p.personality.greed >= 0.6 ? 'holdOut' : 'holdIn';
}

/** A deal he could be extended out of: two years or fewer left, past what a rookie deal blocks. */
function extendable(league: League, p: Player): boolean {
  const c = p.contract;
  return !!c && !isExpired(c, league.season) && yearsLeft(c, league.season) <= 2 && !extensionBlocker(league, p);
}

/**
 * What a soured talk escalates into now, if anything (spec Part 2): a trade request over snaps, the losing or a feud at a
 * step talks run, over a deal in season once a hold-in or holdout ended without one; a hold-in or holdout over a deal he
 * could be extended out of, from the re-sign window to camp. A promise made to end a dispute, broken, starts it again at
 * once.
 */
function escalation(league: League, p: Player, ctx: MoraleContext, clock: number, week: number): DisputeKind | null {
  const s = p.morale!.talk!.sour!;
  if (p.injury || p.ir) return null;
  if (!s.now && s.run < RUN_STEPS) return null;
  // His grievance is still what soured the talk (a broken promise is its own cause: its jolt is the loudest thing on him).
  if (!s.now && talkCause(league, p, moraleFactors(league, p, ctx), clock) !== s.cause) return null;
  const inSeason = league.phase === 'regular' || league.phase === 'playoffs';
  if (s.now && s.after === 'trade') return 'trade';
  if (s.cause !== 'deal') return talksAt(league, week) ? 'trade' : null;
  if (s.after && !s.now && inSeason) return 'trade';
  if (!extendable(league, p)) return null;
  // A holdout goes back out whenever its promise breaks; a hold-in only before week 1 (from then he plays).
  if (s.now && s.after === 'holdOut') return week >= 0 ? 'holdOut' : null;
  if (week < 0 || week > CAMP) return null;
  return s.now && s.after === 'holdIn' ? 'holdIn' : disputeKind(league, p, ctx);
}

/** What a holdout will lose before he gives in: a calm man his camp fine, the most stubborn half his year's base. */
export function giveInLimit(league: League, p: Player): number {
  const base = (p.contract && yearOf(p.contract, league.season)?.base) ?? 0;
  const resolve = (p.personality.greed + 1 - p.personality.patience) / 2;
  return base * (0.05 + 0.45 * resolve);
}

/**
 * A dispute's end: how it went on file for the letters; rust when he comes back in season having missed camp; the talk
 * soured again when he played or gave in without a deal (a trade request can follow in season, G4b).
 */
export function endDispute(league: League, p: Player, how: DisputeHow, clock: number): void {
  const m = p.morale!;
  const d = m.dispute!;
  const start = league.season * YEAR;
  m.disputeEnd = { kind: d.kind, since: d.since, how, at: clock };
  delete m.dispute;
  const missedCamp = d.since <= start + CAMP && clock >= start + REGULAR;
  if (missedCamp && how !== 'released' && how !== 'newYear')
    m.rust = { season: league.season, week: clock - start - REGULAR + 1 };
  if (how === 'gaveIn') addJolt(p, 'gaveIn', -2, clock);
  if ((how === 'week1' || how === 'gaveIn') && p.teamId !== null) {
    const t = (m.talk ??= { club: p.teamId });
    t.sour = { cause: d.cause, at: clock, run: 0, after: d.kind };
  }
  // Back on the 53: an AI club over the limit makes room by its own cut rule. Yours never cuts for you (as with a man
  // back from reserve): he waits on the list until there's room.
  const team = p.teamId === null ? undefined : league.teams[p.teamId];
  if (d.out && team && league.phase === 'regular' && activeRoster(league, team.id).length > ROSTER_MAX) {
    if (team.id !== yourClub(league)) aiCutdown(league, team, ROSTER_MAX);
    else m.reported = true;
  }
}

/** An open dispute's step: off to Did Not Report at camp, the fine as camp ends, the game checks, giving in. */
function runDispute(
  league: League,
  p: Player,
  ctx: MoraleContext,
  clock: number,
  week: number,
  newYear: boolean,
): void {
  const m = p.morale!;
  const d = m.dispute!;
  if (p.teamId !== d.club) return endDispute(league, p, p.teamId === null ? 'released' : 'traded', clock);
  // A raise answers a dispute over a deal.
  if (d.cause === 'deal' && m.jolts?.some((j) => j.kind === 'paid' && j.at === clock))
    return endDispute(league, p, 'signed', clock);
  // Still unanswered at a club that isn't yours (you lost the job, or never answered and left it): the club answers.
  if (!d.answered && p.teamId !== yourClub(league)) {
    aiAnswerDispute(league, p, clock);
    if (!m.dispute) return;
  }
  if (d.kind === 'trade') return runRequest(league, p, ctx, clock, week, newYear);
  if (newYear && d.since < league.season * YEAR) return endDispute(league, p, 'newYear', clock);
  // A club that isn't yours thinks again (yours is your letter's call). Settled before camp ends, his fine is waived.
  if (p.teamId !== yourClub(league)) {
    aiReviewDispute(league, p, clock, week);
    if (!m.dispute) return;
  }
  if (d.kind === 'holdIn') {
    if (week >= REGULAR) endDispute(league, p, 'week1', clock);
    return;
  }
  if (week >= CAMP) d.out = true;
  if (week === REGULAR) {
    d.fined = (d.fined ?? 0) + CAMP_FINE;
    d.lost = (d.lost ?? 0) + CAMP_FINE;
    p.lostAccrual = league.season;
  }
  // After each regular-season week's games, a game check he didn't earn.
  const y = p.contract && yearOf(p.contract, league.season);
  if (week > REGULAR && week <= REGULAR + CHECKS && y && (y.withheld ?? 0) < CHECKS) {
    y.withheld = (y.withheld ?? 0) + 1;
    d.lost = (d.lost ?? 0) + Math.round(y.base / CHECKS);
  }
  if (week >= REGULAR && (d.lost ?? 0) >= giveInLimit(league, p)) endDispute(league, p, 'gaveIn', clock);
}

/** Outspoken: he says it to anyone who'll listen (`controversy` well above the mean). */
export const outspoken = (p: Player): boolean => (p.traits.controversy - TRAIT_MEAN) / 3.5 >= 0.5;

/** A trade request goes public: every club knows he wants out, and the market hears it (one rumor). */
function leak(league: League, p: Player, clock: number): void {
  const d = p.morale!.dispute!;
  d.public = clock;
  const team = league.teams[p.teamId!];
  const market = (league.market ??= emptyMarket());
  const rumor: Rumor = {
    id: `wants-out:${d.since}:${p.id}`,
    kind: 'wantsOut',
    season: league.season,
    phase: league.phase,
    week: league.week,
    teamIds: [team.id],
    playerId: p.id,
    text: `${p.position} ${p.firstName} ${p.lastName} has asked the ${team.city} ${team.name} to trade him, league sources say.`,
  };
  market.rumors = [...market.rumors, rumor].slice(-KEEP_RUMORS);
}

/** His club turns a trade request down: he stays, and an outspoken man doesn't keep it to himself. */
function refuse(league: League, p: Player, clock: number): void {
  const d = p.morale!.dispute!;
  d.answered = { choice: 'refuse', at: clock };
  d.refused = true;
  if (outspoken(p) && d.public === undefined) leak(league, p, clock);
}

/**
 * A trade request's step (G4b): withdrawn when his snaps come or he's been Poor or better four steps; at the new league
 * year it stands only while he's Very poor with a cause; private until it leaks; refused, it hardens into a hold-in at the
 * next camp while he's still Very poor and a deal is in reach. A trade ends it (`runDispute`).
 */
function runRequest(
  league: League,
  p: Player,
  ctx: MoraleContext,
  clock: number,
  week: number,
  newYear: boolean,
): void {
  const m = p.morale!;
  const d = m.dispute!;
  if (d.cause === 'snaps' && m.jolts?.some((j) => j.kind === 'kept' && j.at === clock))
    return endDispute(league, p, 'withdrawn', clock);
  const level = moraleLevel(league, p, clock);
  if (clock > d.since) {
    if (level > VERY_POOR) d.calm = (d.calm ?? 0) + 1;
    else delete d.calm;
  }
  if ((d.calm ?? 0) >= RUN_STEPS) return endDispute(league, p, 'withdrawn', clock);
  if (newYear && d.since < league.season * YEAR) {
    const cause = talkCause(league, p, moraleFactors(league, p, ctx), clock);
    if (level > VERY_POOR || !cause) return endDispute(league, p, 'withdrawn', clock);
  }
  if (d.public === undefined && clock - d.since >= (outspoken(p) ? LEAK_LOUD : LEAK_STEPS)) leak(league, p, clock);
  // A club that turned him down thinks it over once the league knows (as with a holdout, `aiReviewDispute`): keeping him
  // is worth his edge over the man who'd start in his place, as much as this season matters, and its GM's pride; a man
  // who wants out and says so costs it more each week. Once he's not worth keeping, it shops him. Yours is your call.
  if (d.refused && d.public !== undefined && p.teamId !== yourClub(league)) {
    const team = league.teams[p.teamId!];
    const keep = 2 * team.gm.stubbornness + edgeOverReplacement(league, p) * (0.5 + winNow(league, team));
    if (0.5 * (clock - d.public) >= keep) {
      d.answered = { choice: 'shop', at: clock };
      delete d.refused;
    }
  }
  const refusedAt = d.answered?.choice === 'refuse' ? d.answered.at : clock;
  if (d.refused && week === CAMP && refusedAt < clock && level <= VERY_POOR && extendable(league, p)) {
    // Hardened: the request becomes a hold-in, a new dispute with its own letter.
    m.dispute = { kind: 'holdIn', cause: 'deal', since: clock, club: d.club };
    if (p.teamId !== yourClub(league)) aiAnswerDispute(league, p, clock);
  }
}

/**
 * An AI club's answer, by the rule it answers talks with: a GM who'd promise negotiates, and settles when it would keep
 * him and can fit his walk-away (`aiSettle`); anyone else holds firm. The checks answer your club's by it too.
 */
export function aiAnswerDispute(league: League, p: Player, clock: number): void {
  const d = p.morale!.dispute!;
  const reply = aiReply(league, p.teamId!, d.cause);
  // A deal settles a dispute over one; nothing else does.
  if (reply === 'promise' && d.cause === 'deal' && aiSettle(league, league.teams[p.teamId!], p))
    return endDispute(league, p, 'signed', clock);
  // A trade request: a stubborn GM turns it down, the rest shop him.
  if (d.kind === 'trade') {
    if (reply === 'firm') refuse(league, p, clock);
    else d.answered = { choice: 'shop', at: clock };
    return;
  }
  d.answered = { choice: 'firm', at: clock };
}

/** What a dispute costs his club at a step: nothing before camp; a hold-in camp's work; a holdout camp, then each game. */
function stakes(kind: DisputeKind, week: number): number {
  if (week < CAMP || week > REVIEW_UNTIL) return 0;
  if (kind === 'holdIn') return week === CAMP ? 0.5 : 0;
  return week === CAMP ? 1 : 2 + 0.5 * (week - REGULAR);
}

/** How much better he is today than the man who'd start in his place, in rating points (0 if he wouldn't start). */
function edgeOverReplacement(league: League, p: Player): number {
  const others = activeRoster(league, p.teamId!)
    .filter((x) => x.position === p.position && x.id !== p.id && isAvailable(x))
    .map(playerOvr)
    .sort((a, b) => b - a);
  return Math.max(0, playerOvr(p) - (others[STARTERS[p.position] - 1] ?? 0));
}

/**
 * A club thinks an answered dispute over at each step from camp to a month into the season, as holdouts end in the NFL:
 * most by late August, a few weeks in when a deal comes. Against what playing without him costs (his edge over the man
 * who'd start in his place, what's at stake by now, how much this season matters to the club) it weighs what giving in
 * costs (his walk-away past his market, its GM's stubbornness). Worth it, it settles if it would keep him and can fit him
 * (`aiSettle`). `runDispute` asks it for every club but yours; the morale check asks it for yours, standing in for you.
 */
export function aiReviewDispute(league: League, p: Player, clock: number, week: number): void {
  const d = p.morale?.dispute;
  if (!d?.answered || d.kind === 'trade' || p.teamId === null || p.teamId !== d.club) return;
  const stake = stakes(d.kind, week);
  const edge = stake ? edgeOverReplacement(league, p) : 0;
  if (!edge) return;
  const team = league.teams[p.teamId];
  const ask = demand(league, p, team.id);
  const premium = ask.market > 0 ? Math.max(0, ask.walkAway / ask.market - 1) : 0;
  const without = edge * stake * (0.5 + winNow(league, team));
  const givingIn = 0.5 + 2 * team.gm.stubbornness + 4 * premium;
  if (without >= givingIn && aiSettle(league, team, p)) endDispute(league, p, 'signed', clock);
}

/** Your answers to each kind of dispute (a trade request's are G4b's). */
const CHOICES: Record<DisputeKind, readonly DisputeChoice[]> = {
  holdIn: ['negotiate', 'promise', 'firm', 'shop'],
  holdOut: ['negotiate', 'promise', 'firm', 'shop'],
  trade: ['shop', 'refuse', 'promise'],
};

/** What a promise could answer: a deal for a hold-in or holdout; for a trade request, what he asked about (snaps or a deal). */
const promiseFor = (d: Dispute): 'snaps' | 'deal' | null =>
  d.kind !== 'trade' ? 'deal' : canPromise(d.cause) ? (d.cause as 'snaps' | 'deal') : null;

/** Whether he'd take your word: past four broken promises he remembers, he won't. */
export const takesYourWord = (p: Player): boolean => (p.morale?.talk?.broken ?? 0) < 4;

/** Your player's open dispute, while you can answer it: your club's, while you have a job. */
function yourDispute(league: League, p: Player | undefined): Dispute | undefined {
  const d = p?.morale?.dispute;
  if (!p || !d || !MOOD_ACTS.on || p.teamId === null || p.teamId !== yourClub(league) || d.club !== p.teamId) return;
  return d;
}

/**
 * Your answer to a dispute's letter. A promise of a deal (by week 1, or two weeks on in season) ends it, and broken
 * starts it again at once; negotiate, firm and shop are recorded (negotiate opens his contract talks on the screen; the shop
 * button puts him on your trade block). False unless he's yours, it's open and unanswered, and the answer fits: a promise needs
 * his trust, and refusing is for a trade request.
 */
export function answerDispute(league: League, playerId: number, choice: DisputeChoice): boolean {
  const p = league.players[playerId];
  const d = yourDispute(league, p);
  if (!d || d.answered || !CHOICES[d.kind].includes(choice)) return false;
  if (choice === 'promise' && !takesYourWord(p)) return false;
  const clock = league.moraleAt ?? league.season * YEAR;
  if (choice === 'promise') {
    const kind = promiseFor(d);
    if (!kind) return false;
    const talk = (p.morale!.talk ??= { club: p.teamId! });
    if (kind === 'snaps') {
      // The snaps he asked for, over his next four games (as a talk's promise is kept).
      const ctx = moraleContext(league);
      talk.promise = {
        kind: 'snaps',
        made: clock,
        role: expectedRole(p, ctx),
        left: 4,
        games: 0,
        snaps: 0,
        seen: { season: league.season, ...gameCount(league, p, ctx) },
        dispute: d.kind,
      };
    } else {
      const week = clock - league.season * YEAR;
      const due = week < REGULAR ? league.season * YEAR + REGULAR : clock + 2;
      talk.promise = { kind: 'deal', made: clock, due, dispute: d.kind };
    }
    endDispute(league, p, 'promise', clock);
    return true;
  }
  if (choice === 'refuse') {
    refuse(league, p, clock);
    return true;
  }
  // Shop him: the letter's button lists him too (`answerDisputeLetter` in `ui/mail.tsx`); the trade market isn't
  // imported here, so this module loads before it.
  d.answered = { choice, at: clock };
  return true;
}

export interface DisputeCardView {
  /** Open: it waits on your answer. Answered: what you said. Closed: no longer yours to answer (ended, he left, your job). */
  state: 'open' | 'answered' | 'closed';
  kind?: DisputeKind;
  choices?: readonly DisputeChoice[];
  /** He'd take your word: a promise is on offer. */
  trust?: boolean;
  /** What a promise would be: a deal, or (a trade request over snaps) the snaps he wants. */
  promise?: 'snaps' | 'deal';
  /** What you told him, and in words. */
  choice?: DisputeChoice;
  said?: string;
  /** What it has cost him so far: camp fines, withheld game checks. */
  lost?: string;
}

/** What a dispute's letter shows now, read off the league: your players only. */
export function disputeCard(league: League, s: { since: number; playerId: number }): DisputeCardView {
  const p = league.players[s.playerId];
  const d = yourDispute(league, p);
  if (!d || d.since !== s.since) return { state: 'closed' };
  const lost = d.lost ? `It has cost him $${(d.lost / 1000).toFixed(1)}M so far.` : undefined;
  if (d.answered)
    return { state: 'answered', kind: d.kind, choice: d.answered.choice, said: DISPUTE_SAID[d.answered.choice], lost };
  const promise = promiseFor(d) ?? undefined;
  const choices = CHOICES[d.kind].filter((c) => c !== 'promise' || promise);
  return { state: 'open', kind: d.kind, choices, trust: takesYourWord(p), promise, lost };
}

/**
 * A player's dispute as a screen may show it (G4): your players' in full words; anyone else's only what's public (a
 * hold-in, a holdout; G4b: a trade request once it leaks). Null with none, or with moods not acting.
 */
export function disputeView(league: League, p: Player): { kind: DisputeKind; label: string; text: string } | null {
  const d = MOOD_ACTS.on ? p.morale?.dispute : undefined;
  if (!d || p.teamId === null || d.club !== p.teamId) return null;
  const yours = p.teamId === yourClub(league);
  if (d.kind === 'trade' && !yours && d.public === undefined) return null;
  return { kind: d.kind, label: DISPUTE_LABEL[d.kind], text: yours ? disputeStanding(d) : DISPUTE_PUBLIC[d.kind] };
}

/**
 * One dispute step: open disputes run (and end), then the runs of Very poor steps since a talk soured, then new
 * disputes, one a club a step, the unhappiest first.
 */
export function disputeStep(league: League, ctx: MoraleContext, clock: number, week: number, newYear: boolean): void {
  if (!MOOD_ACTS.on) return;
  for (const p of Object.values(league.players)) {
    if (p.morale?.dispute) runDispute(league, p, ctx, clock, week, newYear);
    // Reported to a full 53: on it once there's room (or he's gone).
    const m = p.morale;
    if (m?.reported && (p.teamId === null || activeRoster(league, p.teamId).length < rosterLimit(league)))
      delete m.reported;
  }
  const ready = new Map<number, { p: Player; level: number; kind: DisputeKind }[]>();
  for (const p of Object.values(league.players)) {
    const m = p.morale;
    const s = m?.talk?.sour;
    if (!m || !s || p.teamId === null || m.dispute) continue;
    const level = moraleLevel(league, p, clock);
    // The step it soured isn't one of the steps since.
    if (s.at < clock) s.run = level <= VERY_POOR ? s.run + 1 : 0;
    if (level > VERY_POOR && !s.now) continue;
    const kind = escalation(league, p, ctx, clock, week);
    if (!kind) {
      // A broken promise restarts a dispute at once or not at all: past its window (a hold-in from week 1, a hurt man) it
      // is a soured talk like any other, counted from here.
      delete s.now;
      continue;
    }
    const list = ready.get(p.teamId) ?? [];
    list.push({ p, level, kind });
    ready.set(p.teamId, list);
  }
  for (const list of ready.values()) {
    const { p, kind } = list.sort((a, b) => a.level - b.level || a.p.id - b.p.id)[0];
    const m = p.morale!;
    const s = m.talk!.sour!;
    m.dispute = { kind, cause: s.cause, since: clock, club: p.teamId! };
    // A holdout who starts at camp is out at once.
    if (m.dispute.kind === 'holdOut' && week >= CAMP) m.dispute.out = true;
    delete m.talk!.sour;
    // An AI club answers at once (your club's answer is your letter's).
    if (p.teamId !== yourClub(league)) aiAnswerDispute(league, p, clock);
  }
}
