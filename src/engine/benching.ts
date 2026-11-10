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
import { sittingAfterClear } from './injuries';
import { addJolt, expectedRole, liveSize, moraleClock, moraleContext, type MoraleContext } from './morale';
import { isAvailable, teamPlayers } from './roster';
import { perceive } from './scouting';
import { REGULAR_SEASON_WEEKS } from './season/schedule';
import { beat, closeStory, COACH, markTold, openStory } from './stories';
import { PER_CLUB, talkOf, yourClub } from './talkBasics';
import { temperamentOf, TRAIT_MEAN } from './traits';
import { STARTERS } from './positions';
import type { Game, JobQuestion, League, Player, Position, TalkReply, Team } from './types';

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

const storyOn = (team: Team, q: JobQuestion) => ({ kind: 'benched' as const, teamId: team.id, playerId: q.holder });

/** The nearest of the three talk replies, for what reads a talk's record (the quiet after it, the letters). */
const TALK_OF: Record<BenchReply | OtherReply, TalkReply> = {
  backIn: 'promise',
  yours: 'promise',
  thisWeek: 'reassure',
  earn: 'firm',
  compete: 'firm',
  his: 'firm',
};

/** A question closed, whatever closed it: an ask about it still waiting on you goes with it. */
function closeQuestion(league: League, team: Team, q: JobQuestion): void {
  for (const id of [q.holder, q.other]) {
    const t = id === undefined ? undefined : league.players[id]?.morale?.talk;
    if (t?.ask?.cause === 'benched') delete t.ask;
  }
  const qs = team.jobs?.questions;
  if (!qs) return;
  qs.splice(qs.indexOf(q), 1);
  if (!qs.length) delete team.jobs!.questions;
}

/** A benching sours his talk (over snaps, so disputes' rules apply); an escalation already running keeps its count. */
function sour(p: Player, clock: number): void {
  if (!p.morale) return;
  const t = talkOf(p);
  const was = t.sour;
  t.sour = { cause: 'snaps', at: clock, run: was?.run ?? 0, ...(was?.after ? { after: was.after } : {}) };
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
    // His job now: the other man of the two holds it (the holder told it's the other's, or the other told it's the
    // holder's, who keeps it as he held it), and this one takes the full hit.
    const jobs = team.jobs!;
    delete jobs.held[man.id];
    if (jobs.runs) for (const p of pair) delete jobs.runs[p.id];
    if (winner && !jobs.held[winner.id]) jobs.held[winner.id] = { pos: q.pos, since: clock };
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
  if (reply === 'his') sour(man, clock);
  beat(league, storyOn(team, q), 'answered', clock, { how: reply });
  if (reply === 'his') {
    closeStory(league, storyOn(team, q), 'settled', clock, 'his');
    closeQuestion(league, team, q);
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

/** Weeks a season has in all: the regular season and up to four rounds of playoffs. */
const SEASON_WEEKS = REGULAR_SEASON_WEEKS + 4;

/** Out for the rest of the season: a layoff longer than the weeks still to play (the playoffs only once they have begun). */
export function outForSeason(league: League, p: Player): boolean {
  const left = (league.phase === 'playoffs' ? SEASON_WEEKS : REGULAR_SEASON_WEEKS) - league.week;
  return !!p.injury && p.injury.weeksRemaining > Math.max(0, left);
}

/**
 * Men gone from the club (traded, cut, claimed, retired) take what they held with them, game week or not: no job, no run,
 * and a question they were part of closes with "left". The man who stays is not told anything, so his weeks of not knowing
 * clear with no lift. A holder who leaves leaves his job empty; whoever starts three in a row earns it.
 */
function settleGone(league: League, team: Team, clock: number): void {
  const jobs = team.jobs;
  if (!jobs) return;
  const here = (id: number | undefined) => {
    const p = id === undefined ? undefined : league.players[id];
    return !!p && p.teamId === team.id && !p.retired;
  };
  for (const id of Object.keys(jobs.held).map(Number)) if (!here(id)) delete jobs.held[id];
  for (const id of Object.keys(jobs.runs ?? {}).map(Number)) if (!here(id)) delete jobs.runs![id];
  for (const q of [...(jobs.questions ?? [])]) {
    if (here(q.holder) && (q.other === undefined || here(q.other))) continue;
    const stays = [q.holder, q.other].find((id) => id !== undefined && here(id));
    if (stays !== undefined) clearUnsure(league.players[stays]);
    closeStory(league, storyOn(team, q), 'left', clock);
    closeQuestion(league, team, q);
  }
}

/**
 * A man of an open question is out for the rest of the season: it closes with no hit to anyone, and the job is the other
 * man's until the new league year (a hurt holder's job moves only here; otherwise he keeps it). Nobody was told, so no lift.
 */
function settleOut(league: League, team: Team, clock: number): void {
  const jobs = team.jobs;
  for (const q of [...(jobs?.questions ?? [])]) {
    const out = [q.holder, q.other].find((id) => id !== undefined && outForSeason(league, league.players[id]));
    if (out === undefined) continue;
    const other = q.other === undefined || out === q.other ? undefined : league.players[q.other];
    if (other && !outForSeason(league, other)) {
      delete jobs!.held[q.holder];
      if (!jobs!.held[other.id]) jobs!.held[other.id] = { pos: q.pos, since: clock };
      if (jobs!.runs) delete jobs!.runs[other.id];
    }
    for (const id of [q.holder, q.other]) if (id !== undefined) clearUnsure(league.players[id]);
    closeStory(league, storyOn(team, q), 'settled', clock, 'out');
    closeQuestion(league, team, q);
  }
}

/**
 * The new league year: jobs and the week's note clear and are set again on cut-down day. An open question closes quietly
 * (its asks with it) and its story ends told: the coach has nothing to say about a question the year only ended.
 */
export function endJobs(league: League): void {
  for (const team of league.teams) {
    for (const q of [...(team.jobs?.questions ?? [])]) {
      for (const id of [q.holder, q.other]) if (id !== undefined && league.players[id]) clearUnsure(league.players[id]);
      const open = openStory(league, storyOn(team, q));
      // Closed at the story's own last beat: the old year's, not the new one's.
      const s = closeStory(league, storyOn(team, q), 'ended', open?.beats.at(-1)?.at ?? q.since);
      if (s) markTold(s, COACH);
      closeQuestion(league, team, q);
    }
    delete team.jobs;
    delete team.kickoff;
  }
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
    // A bye, or a season over: no game, so nothing counts (but a man who left is still gone).
    if (!k || k.week !== league.week) {
      settleGone(league, team, clock);
      continue;
    }
    const mine = team.id === yours;
    // A man gone from the club takes his question with him.
    settleGone(league, team, clock);
    // One of the two out for the rest of the season settles it with no hit.
    settleOut(league, team, clock);

    // (1) What is owed: his next game he could play decides a promise or a soft word.
    for (const q of [...(team.jobs?.questions ?? [])]) {
      const owed = q.promise ?? q.soft;
      if (!owed || (k.out ?? []).includes(owed.to)) continue;
      const p = league.players[owed.to];
      if (k.ids.includes(owed.to)) {
        if (q.promise) addJolt(p, 'kept', BENCH_SIZE.kept, clock);
        closeStory(league, storyOn(team, q), 'backIn', clock);
        closeQuestion(league, team, q);
        continue;
      }
      // Broken: he sat again, and he is back to not knowing where he stands. At your club he asks again; an AI club
      // answers again at once (below).
      if (q.promise) {
        addJolt(p, 'broken', BENCH_SIZE.broken, clock);
        if (p.morale) talkOf(p).broken = (talkOf(p).broken ?? 0) + 1;
      } else addJolt(p, 'broken', BENCH_SIZE.chart, clock);
      sour(p, clock);
      beat(league, storyOn(team, q), q.promise ? 'broken' : 'satAgain', clock);
      delete q.promise;
      delete q.soft;
      delete q.answered;
      if (q.asked) q.asked = q.asked.filter((id) => id !== p.id);
      if (mine) fileAsk(league, team, q, p, clock);
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

    // (4) Three starts in a row settle a question: the other man earned the job, or the holder kept it. Both men's
    // weeks of not knowing end. Nobody told them and the holder lost the job: he hears it from the depth chart, and it
    // sours; the other man only covered, so the holder winning it back costs him nothing.
    for (const q of [...(jobs.questions ?? [])]) {
      if (paused.has(q)) continue;
      if (k.ids.includes(q.holder)) q.back = (q.back ?? 0) + 1;
      else delete q.back;
      const otherWon = q.other !== undefined && !heldBefore.has(q.other) && !!jobs.held[q.other];
      const holderWon = (q.back ?? 0) >= EARN;
      if (!otherWon && !holderWon) continue;
      for (const id of [q.holder, q.other]) if (id !== undefined) clearUnsure(league.players[id]);
      const holder = league.players[q.holder];
      if (otherWon && !q.answered) {
        addJolt(holder, 'benched', BENCH_SIZE.chart, clock);
        sour(holder, clock);
      }
      closeStory(league, storyOn(team, q), 'settled', clock, q.answered ? 'earned' : 'chart');
      closeQuestion(league, team, q);
    }

    // (3) At your club, a question nobody has answered: whichever of the two sat this week doesn't know where he
    // stands, and a man of it who hasn't asked yet asks now (the holder whether he sat again or not: his ask was only
    // held back by the club's two a step).
    if (mine)
      for (const q of jobs.questions ?? []) {
        if (q.answered || q.since === clock) continue;
        for (const id of [q.holder, q.other]) {
          if (id === undefined) continue;
          const sat = !paused.has(q) && satThisWeek(k, id);
          const p = league.players[id];
          if (sat) {
            const live = (p.morale?.jolts ?? []).filter((j) => j.kind === 'unsure' && liveSize(j, clock) <= -0.25);
            if (live.length < UNSURE_MAX) addJolt(p, 'unsure', BENCH_SIZE.unsure, clock);
          }
          if ((sat || id === q.holder) && fileAsk(league, team, q, p, clock))
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
