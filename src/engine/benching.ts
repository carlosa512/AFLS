/**
 * Who holds a starting job at each club, and who started this week (storylines, the benching chain). Record-keeping
 * only at this stage: nothing here draws from a stream or touches a rating, mood or result, and `BENCH.on` false turns
 * every writer off so a test can prove it.
 *
 * A job is a place among the starters at a position, not a named spot. The men in a chart's starting spots hold the
 * jobs when the season starts, hurt or not. "Started" is read at kickoff from the chart and availability, never from
 * snap counts: a man hurt in the game still started.
 */
import { onDidNotReport } from './disputeRead';
import { sittingAfterClear } from './injuries';
import { moraleClock } from './morale';
import { isAvailable } from './roster';
import { STARTERS } from './positions';
import type { Game, League, Player, Position, Team } from './types';

/** Tests turn it off to prove play is untouched. */
export const BENCH = { on: true };
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
    const out = Object.keys(team.jobs?.held ?? {})
      .map(Number)
      .filter((pid) => {
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
