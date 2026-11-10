/**
 * Who holds a starting job at each club, and who started this week (storylines, the benching chain). A job-holder sat
 * healthy asks where he stands (`benchWeek`), the GM answers (`answerBench`, `aiBenchReply`) and his mood follows the
 * answer. Nothing here draws from a stream or touches a rating or a result; `BENCH.on` false turns every writer off.
 *
 * A job is a place among the starters at a position, not a named spot. The men in a chart's starting spots hold the
 * jobs when the season starts, hurt or not. "Started" is read at kickoff from the chart and availability, never from
 * snap counts: a man hurt in the game still started.
 */
import { onDidNotReport } from './disputeRead';
import { employed } from './employment';
import { sittingAfterClear } from './injuries';
import { addJolt, expectedRole, liveSize, moraleClock, moraleContext, type MoraleContext } from './morale';
import { PER_CLUB } from './playerTalks';
import { isAvailable, teamPlayers } from './roster';
import { perceive } from './scouting';
import { beat, closeStory } from './stories';
import { temperamentOf, TRAIT_MEAN } from './traits';
import { STARTERS } from './positions';
import type { Game, JobQuestion, League, Player, Position, Talk, TalkReply, Team } from './types';

/** Tests turn it off to prove play is untouched. */
export const BENCH = { on: true };
/**
 * The jolts of the benching chain, in morale points: the hit the step he sits, what each answer adds, a promise kept or
 * broken, a week of not knowing where he stands, the lift of a clear word, and finding out from the depth chart. Tuned
 * with `npm run morale` (the benching's drop and recovery, band shares, asks per club) with no range moved.
 */
export const BENCH_SIZE = {
  sit: -1.25,
  backIn: 0.75,
  thisWeek: 0.5,
  earn: -0.5,
  his: -1,
  kept: 1.5,
  broken: -2.5,
  unsure: -0.5,
  settled: 0.75,
  chart: -1.25,
};
/** Your answers to the man who sat holding the job, and to the other man of the question. */
export type BenchReply = 'backIn' | 'thisWeek' | 'earn' | 'his';
export type OtherReply = 'yours' | 'compete' | 'his';
/** Weeks of not knowing he carries at once. */
const UNSURE_MAX = 3;
/** Seasons in the league that make a man a veteran to a loyal GM. */
const VETERAN = 6;
/** Starts in a row, with no holder out, that earn a job. */
export const EARN = 3;

const inGames = (league: League) => league.phase === 'regular' || league.phase === 'playoffs';

/** Could he have played this week: on the 53, healthy, not sat on the doctor's advice, not holding out. */
export function couldPlay(league: League, p: Player): boolean {
  return isAvailable(p) && !sittingAfterClear(league, p) && !onDidNotReport(p);
}

export const holdsJob = (team: Team, playerId: number): boolean => !!team.jobs?.held[playerId];

/** The men in a club's starting spots, with the position each is charted at (a man lined up elsewhere counts there). */
function startingSpots(league: League, team: Team): { id: number; pos: Position }[] {
  const out: { id: number; pos: Position }[] = [];
  for (const pos of Object.keys(team.depthChart) as Position[]) {
    for (const id of team.depthChart[pos].slice(0, STARTERS[pos])) {
      const p = league.players[id];
      if (p && p.teamId === team.id && !p.retired) out.push({ id, pos });
    }
  }
  return out;
}

function setTeamJobs(league: League, team: Team): void {
  const since = moraleClock(league);
  const held: NonNullable<Team['jobs']>['held'] = {};
  for (const { id, pos } of startingSpots(league, team)) held[id] = { pos, since };
  team.jobs = { held };
}

/** Every club: the men in the chart's starting spots hold the jobs, hurt or not. */
export function setJobs(league: League): void {
  if (!BENCH.on) return;
  for (const team of league.teams) setTeamJobs(league, team);
}

/**
 * Every club with a game still to play this week: who is in a starting spot now. A club noted already this week is
 * left alone (the games change the chart), except the two clubs of `game`, a live game being started. A league that
 * began in week 1 with no cut-down day gets its jobs here, the first time a club is noted.
 */
export function benchKickoff(league: League, game?: Game): void {
  if (!BENCH.on || !inGames(league)) return;
  const noted = new Set<number>();
  for (const g of league.games) {
    if (g.season !== league.season || g.week !== league.week) continue;
    if (g.result) continue;
    noted.add(g.homeId);
    noted.add(g.awayId);
  }
  for (const id of noted) {
    const team = league.teams[id];
    const live = !!game && (game.homeId === id || game.awayId === id);
    if (team.kickoff?.week === league.week && !live) continue;
    if (!team.jobs) setTeamJobs(league, team);
    const ids: number[] = [];
    const at: Record<number, Position> = {};
    for (const pos of Object.keys(team.depthChart) as Position[]) {
      // `starters` skips the hurt and files a man where he lines up, `playingAt` included.
      for (const p of startersAt(league, team, pos)) {
        ids.push(p.id);
        at[p.id] = pos;
      }
    }
    // The holders, and the other men of open questions: who could not play at kickoff is read as he was.
    const watch = new Set(Object.keys(team.jobs?.held ?? {}).map(Number));
    for (const q of team.jobs?.questions ?? []) if (q.other !== undefined) watch.add(q.other);
    const out = [...watch].filter((pid) => {
      const p = league.players[pid];
      return !!p && p.teamId === team.id && !couldPlay(league, p);
    });
    team.kickoff = { week: league.week, ids, at, out };
  }
}

/** The men `starters` would send out at a position (a short room is filled from the chart's next men). */
function startersAt(league: League, team: Team, pos: Position): Player[] {
  const out: Player[] = [];
  for (const id of team.depthChart[pos]) {
    const p = league.players[id];
    if (p && p.teamId === team.id && couldPlay(league, p)) out.push(p);
    if (out.length === STARTERS[pos]) break;
  }
  return out;
}

/**
 * After the games: runs counted, jobs earned and lost. Returns the job-holders who sat this week, with who started
 * instead. A holder who started (hurt or not), was out at kickoff, was sat by the doctor or lined up at another
 * position is not sitting. Call it once a week; a bye (no kickoff this week) changes nothing.
 */
export function countStarts(league: League, team: Team, clock: number): { holder: Player; other?: Player }[] {
  const k = team.kickoff;
  if (!BENCH.on || !k || k.week !== league.week) return [];
  const jobs = (team.jobs ??= { held: {} });
  const here = (id: number) => {
    const p = league.players[id];
    return !!p && p.teamId === team.id && !p.retired;
  };
  // A man who left the club holds nothing and has no run.
  for (const id of Object.keys(jobs.held).map(Number)) if (!here(id)) delete jobs.held[id];
  for (const id of Object.keys(jobs.runs ?? {}).map(Number)) if (!here(id)) delete jobs.runs![id];

  const started = new Set(k.ids);
  const out = new Set(k.out ?? []);
  const at = k.at ?? {};
  const held = jobs.held;

  // Positions where a holder was hurt, held out or lined up elsewhere: no start there counts toward a job.
  const covered = new Set<Position>();
  for (const [sid, h] of Object.entries(held)) {
    const id = Number(sid);
    if (out.has(id) || (started.has(id) && at[id] !== undefined && at[id] !== h.pos)) covered.add(h.pos);
  }

  // Who sat: a holder who could have played and didn't start.
  const sat: { holder: Player; other?: Player }[] = [];
  for (const [sid, h] of Object.entries(held)) {
    const id = Number(sid);
    if (started.has(id) || out.has(id)) continue;
    const stand = k.ids
      .filter((s) => !held[s] && at[s] === h.pos)
      .sort((a, b) => team.depthChart[h.pos].indexOf(a) - team.depthChart[h.pos].indexOf(b))[0];
    sat.push({ holder: league.players[id], other: stand === undefined ? undefined : league.players[stand] });
  }

  // Runs: a non-holder's grows with each start (unless a holder at his position is out) and resets when he sits.
  const runs = (jobs.runs ??= {});
  for (const id of Object.keys(runs).map(Number)) if (!started.has(id)) delete runs[id];
  for (const id of k.ids) {
    const pos = at[id];
    if (held[id] || pos === undefined || covered.has(pos)) continue;
    runs[id] = (runs[id] ?? 0) + 1;
    if (runs[id] < EARN) continue;
    delete runs[id];
    held[id] = { pos, since: clock };
    // Too many holders for the room: the one who has held it longest without starting gives his up.
    const holders = Object.keys(held)
      .map(Number)
      .filter((h) => held[h].pos === pos);
    if (holders.length > STARTERS[pos]) {
      const gone = holders
        .filter((h) => h !== id && !started.has(h) && !out.has(h))
        .sort((a, b) => held[a].since - held[b].since)[0];
      if (gone !== undefined) delete held[gone];
    }
  }
  return sat;
}

// ───────── the question: he asks, you answer, he takes it ─────────

/** The open job question he is part of, as the man who sat holding it or the other man. */
export function questionOf(team: Team, playerId: number): JobQuestion | undefined {
  return team.jobs?.questions?.find((q) => q.holder === playerId || q.other === playerId);
}

/** Whose move it was: the depth chart is the staff's while they sort it, yours otherwise. */
export const movedBy = (team: Team): 'you' | 'staff' => (team.autoDepth ? 'staff' : 'you');

/** The club whose letters you answer: yours, while you have a job. */
const yourClub = (league: League) => (employed(league) ? league.userTeamId : null);

const storyOn = (team: Team, q: JobQuestion) => ({ kind: 'benched' as const, teamId: team.id, playerId: q.holder });

const talkOf = (p: Player): Talk => (p.morale!.talk ??= { club: p.teamId! });

/** The nearest of the three talk replies, for what reads a talk's record (the quiet after it, the letters). */
const TALK_OF: Record<BenchReply | OtherReply, TalkReply> = {
  backIn: 'promise',
  yours: 'promise',
  thisWeek: 'reassure',
  earn: 'firm',
  compete: 'firm',
  his: 'firm',
};

function closeQuestion(team: Team, q: JobQuestion): void {
  const qs = team.jobs?.questions;
  if (!qs) return;
  qs.splice(qs.indexOf(q), 1);
  if (!qs.length) delete team.jobs!.questions;
}

/** His weeks of not knowing, taken back: a clear word replaces them. */
function clearUnsure(p: Player): void {
  const m = p.morale;
  if (!m?.jolts) return;
  m.jolts = m.jolts.filter((j) => j.kind !== 'unsure');
  if (!m.jolts.length) delete m.jolts;
}

/** An honest answer's cost to the man who lost out: half when he can see the man ahead is better, by his temper. */
function honest(p: Player, size: number, ctx: MoraleContext): number {
  const plain = expectedRole(p, ctx) < 2 ? 0.5 : 1;
  // A calm, professional man takes it better; a volatile one worse (one sd either way is as far as it goes).
  const temper = Math.min(1.5, Math.max(0.5, 1 + 0.5 * ((temperamentOf(p) - TRAIT_MEAN) / 3.5)));
  return size * plain * temper;
}

/** His ask, filed in your letters when the club has room for it this step (two asks a step; a third waits a week). */
function fileAsk(league: League, team: Team, q: JobQuestion, p: Player, clock: number): boolean {
  const t = p.morale?.talk;
  if (!p.morale || t?.ask || q.asked?.includes(p.id)) return false;
  const filed = teamPlayers(league, team.id).filter((m) => m.morale?.talk?.ask?.at === clock).length;
  if (filed >= PER_CLUB) return false;
  talkOf(p).ask = { cause: 'benched', at: clock };
  (q.asked ??= []).push(p.id);
  return true;
}

/**
 * An answer lands on a question: both men know where they stand (their weeks of not knowing cleared, the same lift
 * each), then the answer's own meaning on the man it was given to (`man`).
 */
function applyBench(
  league: League,
  team: Team,
  q: JobQuestion,
  man: Player,
  reply: BenchReply | OtherReply,
  clock: number,
  ctx: MoraleContext,
): void {
  const pair = [q.holder, q.other].filter((id): id is number => id !== undefined).map((id) => league.players[id]);
  for (const p of pair) {
    clearUnsure(p);
    addJolt(p, 'settled', BENCH_SIZE.settled, clock);
  }
  const winner = pair.find((p) => p.id !== man.id);
  if (reply === 'backIn' || reply === 'yours') {
    q.promise = { to: man.id, at: clock };
    addJolt(man, 'promised', BENCH_SIZE.backIn, clock);
  } else if (reply === 'thisWeek') {
    q.soft = { to: man.id, at: clock };
    addJolt(man, 'reassured', BENCH_SIZE.thisWeek, clock);
  } else if (reply === 'earn' || reply === 'compete') {
    addJolt(man, 'benched', honest(man, BENCH_SIZE.earn, ctx), clock);
  } else {
    // His job now: the other man of the two holds it from today, and this one takes the full hit.
    const jobs = team.jobs!;
    delete jobs.held[man.id];
    if (jobs.runs) for (const p of pair) delete jobs.runs[p.id];
    if (winner) jobs.held[winner.id] = { pos: q.pos, since: clock };
    addJolt(man, 'benched', honest(man, BENCH_SIZE.his, ctx), clock);
  }
  q.answered = { reply, at: clock, by: man.id };
  // His talk record: the answer, and the quiet after it; a man of the pair still waiting is answered by the same word.
  for (const p of pair) {
    if (!p.morale) continue;
    const t = talkOf(p);
    if (p.id !== man.id && t.ask?.cause !== 'benched') continue;
    t.answered = { reply: TALK_OF[reply], at: clock, ask: t.ask?.at ?? clock, cause: 'benched', bench: reply };
    if (t.ask?.cause === 'benched') delete t.ask;
  }
  // The final word sours his talk as a firm no does: a veteran may want out by the rules disputes have (over snaps).
  if (reply === 'his' && man.morale) talkOf(man).sour = { cause: 'snaps', at: clock, run: 0 };
  beat(league, storyOn(team, q), 'answered', clock, { how: reply });
  if (reply === 'his') {
    closeStory(league, storyOn(team, q), 'settled', clock, 'his');
    closeQuestion(team, q);
  }
}

/**
 * Your answer on either man's row. Nothing happens (false) unless he is yours, of an open question nobody has answered,
 * and the reply is one for his side of it (the holder's four, the other man's three). It lands at the clock of the last
 * morale step.
 */
export function answerBench(league: League, playerId: number, reply: BenchReply | OtherReply): boolean {
  const p = league.players[playerId];
  const yours = yourClub(league);
  if (!p || p.teamId === null || p.teamId !== yours || !p.morale) return false;
  const team = league.teams[yours];
  const q = questionOf(team, p.id);
  if (!q || q.answered) return false;
  const holder = q.holder === p.id;
  if (holder ? reply === 'yours' || reply === 'compete' : reply !== 'yours' && reply !== 'compete' && reply !== 'his')
    return false;
  applyBench(league, team, q, p, reply, league.moraleAt ?? moraleClock(league), moraleContext(league));
  return true;
}

/**
 * An AI GM's answer, at once: the job is the other man's when its own read has him better, a loyal GM promises a
 * veteran he's back in, and otherwise he earns it back.
 */
export function aiBenchReply(league: League, teamId: number, holder: Player, other: Player | undefined): BenchReply {
  if (other && perceive(league, teamId, other).ovr > perceive(league, teamId, holder).ovr) return 'his';
  const team = league.teams[teamId];
  const gm = team.gmId == null ? undefined : team.gm;
  if (gm && holder.experience >= VETERAN && gm.loyalty - gm.stubbornness >= 0.2) return 'backIn';
  return 'earn';
}

/** Did he sit this week: he could play at kickoff and was not in a starting spot. */
const satThisWeek = (k: NonNullable<Team['kickoff']>, id: number) => !k.ids.includes(id) && !(k.out ?? []).includes(id);

/**
 * The week's benchings at every club, after the games, before the talks (in-season morale steps only): what was owed
 * settled, the starts counted, questions settled by the chart, new ones opened (your club files the ask, an AI club
 * answers at once), and at your club the man left not knowing feels it.
 */
export function benchWeek(league: League, ctx: MoraleContext, clock: number): void {
  if (!BENCH.on || !inGames(league)) return;
  const yours = yourClub(league);
  for (const team of league.teams) {
    const k = team.kickoff;
    // A bye, or a season over: no game, so nothing counts.
    if (!k || k.week !== league.week) continue;
    const mine = team.id === yours;
    const here = (id: number | undefined) => {
      const p = id === undefined ? undefined : league.players[id];
      return !!p && p.teamId === team.id && !p.retired;
    };
    // A man gone from the club takes his question with him.
    for (const q of [...(team.jobs?.questions ?? [])])
      if (!here(q.holder) || (q.other !== undefined && !here(q.other))) {
        closeStory(league, storyOn(team, q), 'left', clock);
        closeQuestion(team, q);
      }

    // (1) What is owed: his next game he could play decides a promise or a soft word.
    for (const q of [...(team.jobs?.questions ?? [])]) {
      const owed = q.promise ?? q.soft;
      if (!owed || (k.out ?? []).includes(owed.to)) continue;
      const p = league.players[owed.to];
      if (k.ids.includes(owed.to)) {
        if (q.promise) addJolt(p, 'kept', BENCH_SIZE.kept, clock);
        closeStory(league, storyOn(team, q), 'backIn', clock);
        closeQuestion(team, q);
        continue;
      }
      // Broken: he sat again, and he is back to not knowing where he stands.
      const t = p.morale ? talkOf(p) : undefined;
      if (q.promise) {
        addJolt(p, 'broken', BENCH_SIZE.broken, clock);
        if (t) t.broken = (t.broken ?? 0) + 1;
      } else addJolt(p, 'broken', BENCH_SIZE.chart, clock);
      if (t) t.sour = { cause: 'snaps', at: clock, run: 0 };
      beat(league, storyOn(team, q), q.promise ? 'broken' : 'satAgain', clock);
      delete q.promise;
      delete q.soft;
      delete q.answered;
    }

    // While either man can't play the question rests: no start counts toward three in a row.
    const qs = team.jobs?.questions ?? [];
    const paused = new Set(
      qs.filter((q) => [q.holder, q.other].some((id) => id !== undefined && !couldAtKickoff(k, id))),
    );
    for (const q of qs) {
      if (paused.has(q)) q.paused = true;
      else delete q.paused;
    }
    const frozen = new Map<number, number | undefined>();
    for (const q of paused) if (q.other !== undefined) frozen.set(q.other, team.jobs?.runs?.[q.other]);
    const heldBefore = new Set(Object.keys(team.jobs?.held ?? {}).map(Number));
    const sat = countStarts(league, team, clock);
    const jobs = team.jobs;
    if (!jobs) continue;
    for (const [id, run] of frozen) {
      if (run === undefined) delete jobs.runs?.[id];
      else (jobs.runs ??= {})[id] = run;
    }

    // (4) Three starts in a row settle a question: the other man earned the job, or the holder kept it.
    for (const q of [...(jobs.questions ?? [])]) {
      if (paused.has(q)) continue;
      if (k.ids.includes(q.holder)) q.back = (q.back ?? 0) + 1;
      else delete q.back;
      const otherWon = q.other !== undefined && !heldBefore.has(q.other) && !!jobs.held[q.other];
      const holderWon = (q.back ?? 0) >= EARN;
      if (!otherWon && !holderWon) continue;
      const loserId = otherWon ? q.holder : q.other;
      const loser = loserId === undefined ? undefined : league.players[loserId];
      // Nobody told them: the one who lost out hears it from the depth chart, and it sours.
      if (!q.answered && loser) {
        clearUnsure(loser);
        addJolt(loser, 'benched', BENCH_SIZE.chart, clock);
        if (loser.morale) {
          const t = talkOf(loser);
          t.sour = { cause: 'snaps', at: clock, run: 0 };
          if (t.ask?.cause === 'benched') delete t.ask;
        }
      }
      for (const id of [q.holder, q.other]) {
        const p = id === undefined ? undefined : league.players[id];
        if (p?.morale?.talk?.ask?.cause === 'benched') delete p.morale.talk.ask;
      }
      closeStory(league, storyOn(team, q), 'settled', clock, q.answered ? 'earned' : 'chart');
      closeQuestion(team, q);
    }

    // (3) At your club, a question nobody has answered: whichever of the two sat this week doesn't know where he
    // stands, and a man of it who hasn't asked yet asks now.
    if (mine)
      for (const q of jobs.questions ?? []) {
        if (q.answered || paused.has(q) || q.since === clock) continue;
        for (const id of [q.holder, q.other]) {
          if (id === undefined || !satThisWeek(k, id)) continue;
          const p = league.players[id];
          const live = (p.morale?.jolts ?? []).filter((j) => j.kind === 'unsure' && liveSize(j, clock) <= -0.25);
          if (live.length < UNSURE_MAX) addJolt(p, 'unsure', BENCH_SIZE.unsure, clock);
          if (fileAsk(league, team, q, p, clock))
            beat(league, storyOn(team, q), id === q.holder ? 'asked' : 'swapped', clock, { other: q.other });
        }
      }

    // (2) A holder who sat healthy with no question open: the hit lands, and he asks.
    for (const { holder, other } of sat) {
      if (questionOf(team, holder.id) || !holder.morale) continue;
      const held = jobs.held[holder.id];
      if (!held) continue;
      const q: JobQuestion = { pos: held.pos, holder: holder.id, since: clock };
      if (other) q.other = other.id;
      (jobs.questions ??= []).push(q);
      addJolt(holder, 'benched', BENCH_SIZE.sit, clock);
      beat(league, storyOn(team, q), 'sat', clock, other ? { pub: true, other: other.id } : { pub: true });
      if (mine) fileAsk(league, team, q, holder, clock);
      else applyBench(league, team, q, holder, aiBenchReply(league, team.id, holder, other), clock, ctx);
    }
    // An AI club answers again at once when a word it gave was broken.
    if (!mine)
      for (const q of [...(jobs.questions ?? [])])
        if (!q.answered && q.since !== clock) {
          const holder = league.players[q.holder];
          const other = q.other === undefined ? undefined : league.players[q.other];
          applyBench(league, team, q, holder, aiBenchReply(league, team.id, holder, other), clock, ctx);
        }
  }
}

/** Could he play at kickoff (in a starting spot or not): read from the week's note, as `countStarts` reads it. */
const couldAtKickoff = (k: NonNullable<Team['kickoff']>, id: number) => !(k.out ?? []).includes(id);
