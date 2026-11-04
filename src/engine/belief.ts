/**
 * Backing the staff (L4, docs/superpowers/specs/2026-11-04-backing-the-staff-design.md): each room's belief in whoever
 * runs its side of the ball (its coordinator, or the head coach covering an empty chair), a hidden number in −1…1 read
 * only in words. Bad games wear it down, a Locker-Room Lawyer louder; good games, streaks and meetings move it; it
 * drifts back toward the middle. The staff edge on Sunday reads it (`staffEdge.ts`).
 */
import { sideCoach, teamCoaches } from './coaching';
import { moraleClock, moraleContext, moraleLevel, moraleStepOf, type MoraleContext } from './morale';
import { personalityOf, trueCharacter } from './personality';
import { computeRecords } from './season/standings';
import { unitOf, weightOf } from './standing';
import type { CoachRoom, Coach, League, MeetingRecord, Player } from './types';

export const BELIEF = {
  drift: 0.975,
  badGame: -0.06,
  goodGame: 0.03,
  loseStreak: -0.04,
  winStreak: 0.02,
  /** A lawyer who's a voice in the room makes a bad game's drop this many times as big; sour, half again. */
  lawyer: 3,
  sour: 1.5,
  /** A meeting: by the share of the room's weight that took it well, and that bristled. */
  lands: 0.04,
  bristles: 0.08,
  /** A notice kept or broken. */
  kept: 0.15,
  broken: -0.15,
  /** Past this after a bad game, the position coach says so (before the room reads in doubt). */
  warn: -0.1,
};

export type BeliefRead = 'believes' | 'steady' | 'doubts' | 'lost';
export type SideRole = 'offCoord' | 'defCoord';

export const SIDE_ROOMS: Record<SideRole, readonly CoachRoom[]> = {
  offCoord: ['QB', 'RB', 'WR', 'OL'],
  defCoord: ['DL', 'LB', 'DB'],
};
export const sideRoleOf = (room: CoachRoom): SideRole => (SIDE_ROOMS.offCoord.includes(room) ? 'offCoord' : 'defCoord');

const round = (v: number) => Math.round(v * 10000) / 10000;

export const beliefOf = (c: Coach | null | undefined, room: CoachRoom): number => c?.belief?.[room] ?? 0;

/** The same thresholds as a head coach's word (`credibilityRead`). */
export function beliefRead(v: number): BeliefRead {
  if (v >= 0.4) return 'believes';
  if (v <= -0.5) return 'lost';
  if (v <= -0.2) return 'doubts';
  return 'steady';
}

export function shiftBelief(c: Coach, room: CoachRoom, by: number): void {
  const v = round(Math.max(-1, Math.min(1, beliefOf(c, room) + by)));
  c.belief = { ...c.belief, [room]: v };
}

/** A man taking a side, or leaving one: every room starts in the middle with him. */
export function startCoordinator(c: Coach): void {
  delete c.belief;
}

/** A head coach's cover of a side ending: his rooms there forget him. */
export function dropSide(c: Coach, role: SideRole): void {
  if (!c.belief) return;
  for (const room of SIDE_ROOMS[role]) delete c.belief[room];
  if (!Object.keys(c.belief).length) delete c.belief;
}

/** Who runs this room's side of the ball: the coordinator, the head coach covering, or nobody. */
export const runnerOf = (league: League, teamId: number, room: CoachRoom): Coach | null =>
  sideCoach(teamCoaches(league, teamId), sideRoleOf(room));

export const isLawyer = (p: Player): boolean => personalityOf(trueCharacter(p)) === 'Locker-Room Lawyer';

/** A loss scoring this few is a bad day for the offense; allowing this many, for the defense; losing by this, for both. */
const BAD = { scored: 13, allowed: 30, margin: 21 };
/** A win scoring this many is a good day for the offense; allowing this few, for the defense. */
const GOOD = { scored: 28, allowed: 14 };
/** A streak this long moves belief each week it runs, as it moves a head coach's word. */
const STREAK = 3;

/** How a game went for one side of the ball. */
export function sideGame(forPts: number, againstPts: number, side: 'offense' | 'defense'): 'bad' | 'good' | null {
  if (forPts < againstPts) {
    if (againstPts - forPts >= BAD.margin) return 'bad';
    return (side === 'offense' ? forPts <= BAD.scored : againstPts >= BAD.allowed) ? 'bad' : null;
  }
  if (forPts > againstPts)
    return (side === 'offense' ? forPts >= GOOD.scored : againstPts <= GOOD.allowed) ? 'good' : null;
  return null;
}

/** The room's loudest Locker-Room Lawyer among its voices, or null. */
export function lawyerIn(league: League, teamId: number, room: CoachRoom, ctx: MoraleContext): Player | null {
  return (
    (ctx.voices.get(`${teamId}:${room}`) ?? [])
      .map((v) => league.players[v.id])
      .filter((p): p is Player => !!p && p.teamId === teamId && isLawyer(p))
      .map((p) => ({ p, w: weightOf(league, p, ctx) }))
      .sort((a, b) => b.w - a.w || a.p.id - b.p.id)[0]?.p ?? null
  );
}

/**
 * The league's week (after its moods and the head coaches' word): every room of every club drifts toward the middle,
 * then moves by its side's game this week, then by the club's streak. Nothing drawn.
 */
export function beliefWeek(league: League): void {
  const clock = league.moraleAt ?? moraleClock(league);
  const records = computeRecords(league);
  let ctx: MoraleContext | undefined;
  for (const team of league.teams) {
    const g = league.games.find(
      (x) =>
        x.season === league.season &&
        x.week === league.week &&
        x.result &&
        (x.homeId === team.id || x.awayId === team.id),
    );
    const home = g?.homeId === team.id;
    const pts = g?.result ? (home ? g.result.homeScore : g.result.awayScore) : 0;
    const opp = g?.result ? (home ? g.result.awayScore : g.result.homeScore) : 0;
    const streak = records.get(team.id)?.streak ?? '';
    const run = Number(streak.slice(1)) >= STREAK ? streak[0] : '';
    const fell: CoachRoom[] = [];
    for (const role of ['offCoord', 'defCoord'] as const) {
      const c = sideCoach(teamCoaches(league, team.id), role);
      if (!c) continue;
      const day = g?.result ? sideGame(pts, opp, role === 'offCoord' ? 'offense' : 'defense') : null;
      for (const room of SIDE_ROOMS[role]) {
        const was = beliefOf(c, room);
        let by = was * BELIEF.drift - was;
        if (day === 'good') by += BELIEF.goodGame;
        if (day === 'bad') {
          ctx ??= moraleContext(league);
          const lawyer = lawyerIn(league, team.id, room, ctx);
          const sour = lawyer && moraleStepOf(moraleLevel(league, lawyer)) <= 3;
          by += BELIEF.badGame * (lawyer ? BELIEF.lawyer : 1) * (sour ? BELIEF.sour : 1);
        }
        if (run === 'L') by += BELIEF.loseStreak;
        if (run === 'W') by += BELIEF.winStreak;
        if (by) shiftBelief(c, room, by);
        if (day === 'bad' && was > BELIEF.warn && beliefOf(c, room) <= BELIEF.warn) fell.push(room);
      }
    }
    if (fell.length) team.beliefFell = { clock, rooms: fell };
    else delete team.beliefFell;
  }
}

/** The new league year: a fresh start, not a clean one. Every stored belief halves. */
export function beliefNewYear(league: League): void {
  for (const c of Object.values(league.coaches)) {
    if (!c.belief) continue;
    for (const room of Object.keys(c.belief) as CoachRoom[]) c.belief[room] = round(c.belief[room]! / 2);
  }
}

const ROOMS: readonly CoachRoom[] = [...SIDE_ROOMS.offCoord, ...SIDE_ROOMS.defCoord];

/**
 * A meeting held (L2) moves each room it reached by how its men took it: the share of the room's weight that took it
 * well, less the share that bristled. Standing behind him (L4) moves it twice as far. A team meeting counts for every
 * room, each by its own men.
 */
export function meetingBelief(
  league: League,
  teamId: number,
  record: MeetingRecord,
  weights: Map<number, number>,
): void {
  const lands = new Set(record.outcomes.lands);
  const bristles = new Set(record.outcomes.bristles);
  const rooms = record.scope === 'team' ? ROOMS : [record.scope];
  for (const room of rooms) {
    const runner = runnerOf(league, teamId, room);
    if (!runner) continue;
    let all = 0;
    let up = 0;
    let down = 0;
    for (const [id, w] of weights) {
      const p = league.players[id];
      if (!p || unitOf(p.position) !== room) continue;
      all += w;
      if (lands.has(id)) up += w;
      if (bristles.has(id)) down += w;
    }
    if (!all) continue;
    const by = (BELIEF.lands * up - BELIEF.bristles * down) / all;
    if (by) shiftBelief(runner, room, by * (record.approach === 'backHim' ? 2 : 1));
  }
}

/** The rooms in doubt about whoever runs their side now, the worst first. */
export function doubtRooms(league: League, teamId: number): { room: CoachRoom; read: BeliefRead; v: number }[] {
  return ROOMS.flatMap((room) => {
    const v = beliefOf(runnerOf(league, teamId, room), room);
    const read = beliefRead(v);
    return read === 'doubts' || read === 'lost' ? [{ room, read, v }] : [];
  }).sort((a, b) => a.v - b.v);
}
