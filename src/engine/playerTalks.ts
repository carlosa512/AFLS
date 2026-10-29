/**
 * Players speak up (docs/superpowers/specs/2026-10-29-morale-talks-design.md, G3). A man unhappy for three steps running,
 * with a cause his club could act on, asks; you answer his letter (`answerTalk`), an AI GM answers its own at once by
 * its tendencies (`aiReply`). A promise is then kept or broken by what happens, and remembered (`promisesScore` in
 * `morale.ts`). One talk step runs at the end of every morale step; like the rest of morale it draws nothing and fills
 * no shared cache, so it can't move play.
 */
import { employed } from './employment';
import {
  addJolt,
  DOWN_REASONS,
  expectedRole,
  moraleContext,
  moraleFactors,
  moraleLevel,
  moraleReasons,
  moraleStepOf,
  type MoraleContext,
  type MoraleFactors,
} from './morale';
import { temperamentOf, TRAIT_MEAN } from './traits';
import type { League, Player, Talk, TalkCause, TalkReply } from './types';

const YEAR = 32;
const CAMP = 7;
/** Steps in a row at Poor or worse before he asks (he asks on the third). */
const DOWN_STEPS = 3;
/** Steps after an answer before he asks again (eight, the owner's call: six filled the inbox). */
const QUIET = 8;
/** Asks a club hears in one step. */
const PER_CLUB = 2;
/** Steps a letter waits for your answer before he takes the silence as one. */
const WAIT = 2;

const CAUSE_OF: Record<string, TalkCause> = {
  'Wants more snaps': 'snaps',
  'Still stung by the benching': 'snaps',
  'Wants a new deal': 'deal',
  'Noticed who got paid': 'deal',
  'The losing is wearing on him': 'losing',
  'A feud in the room': 'feud',
};

/** Only what he asks for can be promised: snaps or a deal. The losing and a feud get an answer, not a promise. */
export const canPromise = (cause: TalkCause) => cause === 'snaps' || cause === 'deal';

/** Players talk in season, in the re-sign window and at camp; not on every free-agency day or at the draft. */
export function talksAt(league: League, week: number): boolean {
  return league.phase === 'regular' || league.phase === 'playoffs' || week === 0 || week === CAMP;
}

/** What he'd ask about: his biggest reason that weighs on him, when it's one a club could answer. */
export function talkCause(league: League, p: Player, f: MoraleFactors, clock: number): TalkCause | null {
  const top = moraleReasons(league, p, f, clock).find((r) => DOWN_REASONS.has(r));
  return top ? (CAUSE_OF[top] ?? null) : null;
}

/** An AI GM's answer, from its tendencies: a loyal one promises what it's asked, a stubborn one holds the line. */
export function aiReply(league: League, teamId: number, cause: TalkCause): TalkReply {
  const team = league.teams[teamId];
  const traits = team.gmId == null ? undefined : team.gm;
  if (!traits) return 'reassure';
  if (canPromise(cause) && traits.loyalty - traits.stubbornness >= 0.2) return 'promise';
  return traits.stubbornness >= 0.6 ? 'firm' : 'reassure';
}

/** The club whose letters you answer: yours, while you have a job. */
const yourClub = (league: League) => (employed(league) ? league.userTeamId : null);

const talkOf = (p: Player): Talk => (p.morale!.talk ??= { club: p.teamId! });

/** A talk record holding nothing is nothing in the save. */
function tidy(p: Player) {
  const t = p.morale?.talk;
  if (t && Object.keys(t).length === 1) delete p.morale!.talk;
}

/** His club's games this season and his snaps (games dressed for a kicker or punter): a snaps promise counts both. */
export function gameCount(league: League, p: Player, ctx: MoraleContext): { games: number; snaps: number } {
  const r = p.teamId === null ? undefined : ctx.records.get(p.teamId);
  const s = p.stats[league.season];
  const kicker = p.position === 'K' || p.position === 'P';
  return { games: r ? r.w + r.l + r.t : 0, snaps: (kicker ? s?.gp : s?.snaps) ?? 0 };
}

/** The new league year: one kept and one broken promise forgotten, this year's reassurances cleared. */
function fadeYear(t: Talk) {
  for (const k of ['kept', 'broken'] as const) {
    const n = (t[k] ?? 0) - 1;
    if (n > 0) t[k] = n;
    else delete t[k];
  }
  delete t.reassured;
}

/** A promise's end: a lift and a remembered kept one, or a drop and a remembered broken one. */
function settle(p: Player, t: Talk, kept: boolean, clock: number) {
  addJolt(p, kept ? 'kept' : 'broken', kept ? 2 : -4, clock);
  const k = kept ? 'kept' : 'broken';
  t[k] = (t[k] ?? 0) + 1;
  delete t.promise;
}

/**
 * Has the promise been kept or broken? Snaps: his club's games since it was made (all of a new season's: what was left
 * carries over), not counting games he's hurt for; kept once, over two games or more, he's averaged the snaps of the
 * role he was promised against a league-average starter's per game; broken when the games run out. A deal: kept by a
 * raise before the re-sign window closes, broken when it closes without one.
 */
function checkPromise(league: League, p: Player, ctx: MoraleContext, clock: number, t: Talk) {
  const pr = t.promise!;
  if (pr.kind === 'deal') {
    const paid = p.morale!.jolts?.some((j) => j.kind === 'paid' && j.at === clock);
    if (paid && clock <= pr.due!) settle(p, t, true, clock);
    else if (clock >= pr.due!) settle(p, t, false, clock);
    return;
  }
  const now = gameCount(league, p, ctx);
  const same = pr.seen?.season === league.season;
  const dg = Math.max(0, now.games - (same ? pr.seen!.games : 0));
  const ds = Math.max(0, now.snaps - (same ? pr.seen!.snaps : 0));
  pr.seen = { season: league.season, ...now };
  if (p.injury || p.ir) return;
  pr.left = (pr.left ?? 0) - dg;
  pr.games = (pr.games ?? 0) + dg;
  pr.snaps = (pr.snaps ?? 0) + ds;
  const kicker = p.position === 'K' || p.position === 'P';
  const records = [...ctx.records.values()];
  const meanGames = records.reduce((s, r) => s + r.w + r.l + r.t, 0) / Math.max(1, records.length);
  const starter = ctx.live[p.position];
  const perGame = kicker ? 1 : starter && meanGames > 0 ? starter / meanGames : 0;
  const need = (pr.role ?? 0) >= 2 ? 0.6 : 0.2;
  if (pr.games >= 2 && perGame > 0 && pr.snaps / pr.games / perGame >= need) settle(p, t, true, clock);
  else if (pr.left <= 0) settle(p, t, false, clock);
}

/** An answer lands: the jolt it gives, the promise it makes, and the record of it. */
function applyReply(
  league: League,
  p: Player,
  reply: TalkReply | 'ignored',
  clock: number,
  ctx: MoraleContext,
  cause: TalkCause,
) {
  const t = talkOf(p);
  const week = clock - league.season * YEAR;
  if (reply === 'promise') {
    // Each broken promise he remembers takes a quarter off what your word is worth to him.
    const lift = 2 * Math.max(0, 1 - 0.25 * (t.broken ?? 0));
    if (lift > 0) addJolt(p, 'promised', lift, clock);
    if (cause === 'snaps') {
      const now = gameCount(league, p, ctx);
      t.promise = {
        kind: 'snaps',
        made: clock,
        role: expectedRole(p, ctx),
        left: 4,
        games: 0,
        snaps: 0,
        seen: { season: league.season, ...now },
      };
    } else t.promise = { kind: 'deal', made: clock, due: (week === 0 ? league.season : league.season + 1) * YEAR + 1 };
  } else if (reply === 'reassure') {
    addJolt(p, 'reassured', 0.5 ** (t.reassured ?? 0), clock);
    t.reassured = (t.reassured ?? 0) + 1;
  } else {
    // Firm: an even-tempered man takes it; a volatile one sulks, more the hotter he runs.
    const firm = -Math.min(1.5, Math.max(0, -0.5 * ((temperamentOf(p) - TRAIT_MEAN) / 3.5)));
    if (firm <= -0.01) addJolt(p, 'firm', firm, clock);
    if (reply === 'ignored') addJolt(p, 'ignored', -1, clock);
  }
  t.answered = { reply, at: clock, ask: t.ask?.at ?? clock };
  delete t.ask;
}

/**
 * Your answer to his letter. Nothing happens (false) unless he's yours, his ask is still open, and a promise is for what
 * he asked (snaps or a deal). It lands at the clock of the last morale step, the one his letter came from or after.
 */
export function answerTalk(league: League, playerId: number, reply: TalkReply): boolean {
  const p = league.players[playerId];
  const ask = p?.morale?.talk?.ask;
  if (!p || p.teamId === null || p.teamId !== yourClub(league) || !ask) return false;
  if (reply === 'promise' && !canPromise(ask.cause)) return false;
  applyReply(league, p, reply, league.moraleAt ?? ask.at, moraleContext(league), ask.cause);
  return true;
}

/**
 * One talk step, after the moods have moved: who left his club, his run of bad steps, your letters left unanswered,
 * then the new asks (two a club, the unhappiest first), answered at once at an AI club.
 */
export function talkStep(league: League, ctx: MoraleContext, clock: number, week: number, newYear: boolean): void {
  const yours = yourClub(league);
  const candidates = new Map<number, { p: Player; level: number; cause: TalkCause }[]>();
  const asking = talksAt(league, week);
  for (const p of Object.values(league.players)) {
    const m = p.morale;
    if (!m) continue;
    // A new club is a clean slate; leaving with a promise open breaks it.
    if (m.talk && m.talk.club !== p.teamId) {
      // The club that broke it is the one he left: arriving at yours, it isn't yours to answer for on your screens; a
      // free agent keeps no jolts (G1), so one who walked carries nothing of it to whoever signs him.
      if (m.talk.promise && p.teamId !== null && p.teamId !== yourClub(league)) addJolt(p, 'broken', -4, clock);
      delete m.talk;
    }
    if (p.teamId === null) continue;
    if (m.talk && newYear) fadeYear(m.talk);
    if (m.talk?.promise) checkPromise(league, p, ctx, clock, m.talk);
    const level = moraleLevel(league, p, clock);
    if (moraleStepOf(level) <= 3) talkOf(p).downSince ??= clock;
    else if (m.talk) delete m.talk.downSince;
    const t = m.talk;
    if (t?.ask && clock >= t.ask.at + WAIT) applyReply(league, p, 'ignored', clock, ctx, t.ask.cause);
    tidy(p);
    const now = m.talk;
    if (
      !asking ||
      !now ||
      now.downSince === undefined ||
      clock - now.downSince < DOWN_STEPS - 1 ||
      now.ask ||
      now.promise ||
      (now.answered && clock < now.answered.at + QUIET)
    )
      continue;
    const cause = talkCause(league, p, moraleFactors(league, p, ctx), clock);
    if (!cause) continue;
    const list = candidates.get(p.teamId) ?? [];
    list.push({ p, level, cause });
    candidates.set(p.teamId, list);
  }
  for (const [teamId, list] of candidates) {
    list.sort((a, b) => a.level - b.level || a.p.id - b.p.id);
    for (const { p, cause } of list.slice(0, PER_CLUB)) {
      if (teamId === yours) talkOf(p).ask = { cause, at: clock };
      else applyReply(league, p, aiReply(league, teamId, cause), clock, ctx, cause);
    }
  }
}
