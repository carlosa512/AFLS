import { chairHolder, teamCoaches } from '../coaching';
import { extensionBlocker } from '../offseason/negotiation';
import {
  actualRole,
  moraleFactors,
  moraleLevel,
  moraleReasons,
  moraleStepOf,
  YEAR,
  type MoraleContext,
} from '../morale';
import { STARTERS } from '../positions';
import { activeRoster } from '../roster';
import { causeOf } from '../roomVoice';
import { REGULAR_SEASON_WEEKS } from '../season/schedule';
import { playoffRace } from '../season/standings';
import { soundOf, tierOf, unitOf, unitRead, weightOf, type UnitRead } from '../standing';
import { TRADE_DEADLINE_WEEK } from '../trade/rules';
import type {
  Approach,
  Backing,
  CoachRoom,
  League,
  MeetingScope,
  MeetingSuggestion,
  Moment,
  Player,
  TalkCause,
  Team,
  TeamMeetings,
  Timing,
} from '../types';

/**
 * When a head coach suggests a meeting, and what he offers (L2, spec §1.1–1.2). Moments come every season and don't
 * count against the cooldowns; trouble waits on them: a room every four weeks, the team every six, any trouble at all
 * every four (the spec's lower end: about four a calm season, eight a rough one), one suggestion a week.
 */
export const COOLDOWN = { room: 4, team: 6, week: 1, club: 4 };

export const ROOMS: readonly CoachRoom[] = ['QB', 'RB', 'WR', 'OL', 'DL', 'LB', 'DB'];

/** Three losses in a row is trouble. */
const LOSING_RUN = 3;

/** A club's meetings, made on first read (a save from before L2 is migrated; a test's team may not be). */
export const meetingsOf = (team: Team): TeamMeetings => (team.meetings ??= { log: [], open: [] });

/** Morale's clock for this step: meetings read and write the step the moods just took. */
export const stepClock = (league: League): number => league.moraleAt ?? league.season * YEAR;

const seasonOf = (clock: number) => Math.floor(clock / YEAR);

/** In a dispute, or his talks have soured toward one (`disputes.ts`): a meeting or its follow-through doesn't win him back. */
export const dugIn = (p: Player) => !!(p.morale?.dispute || p.morale?.talk?.sour);

/** The men a meeting speaks to: a room's, or the whole 53. */
export function membersOf(league: League, teamId: number, scope: MeetingScope): Player[] {
  const men = activeRoster(league, teamId);
  return scope === 'team' ? men : men.filter((p) => unitOf(p.position) === scope);
}

const isStarter = (league: League, p: Player) =>
  p.teamId !== null &&
  (league.teams[p.teamId].depthChart[p.position] ?? []).slice(0, STARTERS[p.position]).includes(p.id);

/** His contract could be talked about now: one of the club's own, in the last two years or run out (`talksOpen`'s rule, for any club). */
export function canTalk(league: League, p: Player): boolean {
  return !!p.contract && !p.squad && !p.waiver && !p.retired && !extensionBlocker(league, p);
}

/**
 * What he'd bring up in a meeting: his mood board's grievances in a coach's terms. A deal counts only when he's upset
 * about it (Poor or worse) and his deal can be talked about, as in the room's own read (`roomReasons`).
 */
export function grievancesOf(league: League, p: Player, ctx: MoraleContext): Set<TalkCause> {
  // Read once per man a step: a meeting's suggestion, its choices and every approach the AI weighs ask again.
  const cache = grievanceCache.get(ctx) ?? grievanceCache.set(ctx, new Map()).get(ctx)!;
  const hit = cache.get(p.id);
  if (hit) return hit;
  const out = new Set<TalkCause>();
  cache.set(p.id, out);
  if (!p.morale) return out;
  const upset = moraleStepOf(moraleLevel(league, p)) <= 3;
  for (const text of moraleReasons(league, p, moraleFactors(league, p, ctx))) {
    const cause = causeOf(text);
    if (!cause) continue;
    if (cause === 'deal' && !(upset && canTalk(league, p))) continue;
    out.add(cause);
  }
  return out;
}

/** Grievances by player, per morale context (one context a step: `meetingsStep`). */
const grievanceCache = new WeakMap<MoraleContext, Map<number, Set<TalkCause>>>();

/** The pair in a feud inside these men, if any (ties live inside a position room). */
function feudIn(men: Player[], since?: number): [number, number] | null {
  const ids = new Set(men.map((p) => p.id));
  for (const p of men)
    for (const t of p.ties ?? [])
      if (t.kind === 'feud' && ids.has(t.with) && (since === undefined || t.since >= since))
        return [Math.min(p.id, t.with), Math.max(p.id, t.with)];
  return null;
}

/** The most-felt grievance among these men, or none. */
export function topicOf(league: League, men: Player[], ctx: MoraleContext): TalkCause | 'none' {
  const counts = new Map<TalkCause, number>();
  for (const p of men) for (const c of grievancesOf(league, p, ctx)) counts.set(c, (counts.get(c) ?? 0) + 1);
  const order: TalkCause[] = ['feud', 'deal', 'snaps', 'losing'];
  let best: TalkCause | 'none' = 'none';
  let n = 0;
  for (const c of order) if ((counts.get(c) ?? 0) > n) [best, n] = [c, counts.get(c)!];
  return best;
}

// ───────── moments ─────────

const momentKey = (league: League, key: string) => `${league.season}:${key}`;
const offered = (league: League, team: Team, key: string) =>
  (meetingsOf(team).moments ?? []).includes(momentKey(league, key));

/** The head coach in the chair, if any. */
export const headCoachOf = (league: League, teamId: number) =>
  chairHolder(teamCoaches(league, teamId), { role: 'headCoach' });

/** The club sold at the deadline: it sent players away on deadline day and took none back. */
function soldAtDeadline(league: League, teamId: number): boolean {
  return (league.market?.history ?? []).some(
    (r) =>
      r.season === league.season &&
      r.phase === 'regular' &&
      r.week === TRADE_DEADLINE_WEEK + 1 &&
      r.sides.some((s, i) => s.teamId === teamId && s.players.length > 0 && !r.sides[1 - i].players.length),
  );
}

/** It won its conference final this week: the championship game is next. */
function inTheFinal(league: League, teamId: number): boolean {
  return league.games.some((g) => {
    if (g.season !== league.season || g.playoffRound !== 'CONF' || g.week !== league.week || !g.result) return false;
    const home = g.result.homeScore > g.result.awayScore;
    return (home ? g.homeId : g.awayId) === teamId;
  });
}

/** The moment due now (spec §1.1), with its key; each comes once a league year. */
function momentDue(league: League, teamId: number): { moment: Moment; key: string } | null {
  const team = league.teams[teamId];
  const due: { moment: Moment; key: string }[] = [];
  const hc = headCoachOf(league, teamId);
  if (league.phase === 'resign') due.push({ moment: 'end', key: 'end' });
  if (league.phase === 'preseason' || league.phase === 'regular') {
    if (hc && hc.newVoice === 2) due.push({ moment: 'newCoach', key: `newCoach:${hc.id}` });
  }
  if (league.phase === 'preseason') due.push({ moment: 'camp', key: 'camp' });
  if (league.phase === 'regular') {
    const race = playoffRace(league, teamId);
    // The step after week nine's games is the Monday of deadline day.
    if (league.week === TRADE_DEADLINE_WEEK && !race.out) due.push({ moment: 'deadline', key: 'deadline' });
    if (league.week === TRADE_DEADLINE_WEEK + 1 && soldAtDeadline(league, teamId))
      due.push({ moment: 'deadline', key: 'deadline' });
    if (race.spot || (league.week === REGULAR_SEASON_WEEKS - 1 && !race.out)) due.push({ moment: 'push', key: 'push' });
  }
  if (league.phase === 'playoffs' && inTheFinal(league, teamId)) due.push({ moment: 'final', key: 'final' });
  // The rarest first: the final over the push, a new coach's first week over camp.
  const order: Moment[] = ['final', 'push', 'deadline', 'newCoach', 'camp', 'end'];
  due.sort((a, b) => order.indexOf(a.moment) - order.indexOf(b.moment));
  return due.find((d) => !offered(league, team, d.key)) ?? null;
}

export function dueMoment(league: League, teamId: number): Moment | null {
  return momentDue(league, teamId)?.moment ?? null;
}

// ───────── trouble ─────────

export interface Trouble {
  scope: MeetingScope;
  topic: TalkCause | 'none';
  driver?: number;
}

/** The last trouble meeting this scope had this league year, as a clock. */
function lastTrouble(league: League, team: Team, scope: MeetingScope): number | null {
  const hits = meetingsOf(team).log.filter(
    (r) => r.scope === scope && r.kind !== 'moment' && seasonOf(r.clock) === league.season,
  );
  return hits.length ? Math.max(...hits.map((r) => r.clock)) : null;
}

/**
 * It's been long enough since this room (or the team) last met about trouble, or was last offered a meeting about it
 * (saying no spends the turn too, or the coach would ask every week).
 */
export function offCooldown(league: League, teamId: number, scope: MeetingScope): boolean {
  const team = league.teams[teamId];
  const offered = meetingsOf(team).offeredAt?.[scope];
  const last = Math.max(
    lastTrouble(league, team, scope) ?? -Infinity,
    offered !== undefined && seasonOf(offered) === league.season ? offered : -Infinity,
  );
  return last === -Infinity || stepClock(league) - last >= (scope === 'team' ? COOLDOWN.team : COOLDOWN.room);
}

/** Trouble is the season's (camp through the regular season): the winter's rooms are in flux, the playoffs have moments. */
const troubleSeason = (league: League) => league.phase === 'preseason' || league.phase === 'regular';

/** Mark a trouble meeting offered to this scope now. */
export function markOffered(league: League, teamId: number, scope: MeetingScope): void {
  const m = meetingsOf(league.teams[teamId]);
  m.offeredAt = { ...m.offeredAt, [scope]: stepClock(league) };
}

/** A stirring voice who reads Poor or worse among these men: the man driving it. */
export function driverIn(league: League, men: Player[], ctx: MoraleContext): number | undefined {
  return men
    .filter(
      (p) =>
        soundOf(p) === 'stirs' &&
        tierOf(league, p, weightOf(league, p, ctx)) !== null &&
        moraleStepOf(moraleLevel(league, p)) <= 3,
    )
    .sort((a, b) => moraleLevel(league, a) - moraleLevel(league, b) || a.id - b.id)[0]?.id;
}

/** Benched this step (a fresh `benched` jolt) and a man his room listens to. */
const benchedVoice = (league: League, p: Player, ctx: MoraleContext, clock: number) =>
  (p.morale?.jolts ?? []).some((j) => j.kind === 'benched' && j.at === clock) &&
  tierOf(league, p, weightOf(league, p, ctx)) !== null;

/** A leader or voice the club traded away this week, by the room he left. */
function tradedVoiceRooms(league: League, teamId: number, ctx: MoraleContext): Set<CoachRoom> {
  const out = new Set<CoachRoom>();
  for (const r of league.market?.history ?? []) {
    if (r.season !== league.season || r.phase !== league.phase || r.week !== league.week) continue;
    for (const side of r.sides) {
      if (side.teamId !== teamId) continue;
      for (const id of side.players) {
        const p = league.players[id];
        const unit = p && unitOf(p.position);
        if (p && unit !== 'ST' && tierOf(league, p, weightOf(league, p, ctx)) !== null) out.add(unit);
      }
    }
  }
  return out;
}

/**
 * Every trouble on the club right now, the worst first: a room reading Split or Down (Down first, then the lower mood),
 * three losses in a row (the team), a feud started this season the room hasn't met about, a leader or voice benched
 * or traded this week.
 */
export function troubles(league: League, teamId: number, ctx: MoraleContext): Trouble[] {
  const out: Trouble[] = [];
  const clock = stepClock(league);
  const team = league.teams[teamId];
  const was = meetingsOf(team).reads ?? {};
  // A room turning Split or Down is trouble; one that stays that way was already told.
  const reads = roomTrouble(league, teamId, ctx)
    .filter((r) => !was[r.unit as CoachRoom])
    .sort((a, b) => (a.word === 'Down' ? 0 : 1) - (b.word === 'Down' ? 0 : 1) || a.mood - b.mood);
  for (const r of reads) {
    const men = membersOf(league, teamId, r.unit as CoachRoom);
    out.push({ scope: r.unit as CoachRoom, topic: topicOf(league, men, ctx), driver: driverIn(league, men, ctx) });
  }
  const streak = ctx.records.get(teamId)?.streak ?? '';
  if (league.phase === 'regular' && streak[0] === 'L' && Number(streak.slice(1)) >= LOSING_RUN)
    out.push({ scope: 'team', topic: 'losing', driver: driverIn(league, membersOf(league, teamId, 'team'), ctx) });
  const seen = new Set(meetingsOf(team).feuds ?? []);
  for (const room of ROOMS) {
    const pair = feudIn(membersOf(league, teamId, room), league.season);
    if (pair && !seen.has(feudKey(league, pair))) out.push({ scope: room, topic: 'feud' });
  }
  const traded = tradedVoiceRooms(league, teamId, ctx);
  for (const room of ROOMS) {
    const men = membersOf(league, teamId, room);
    if (traded.has(room) || men.some((p) => benchedVoice(league, p, ctx, clock)))
      out.push({ scope: room, topic: topicOf(league, men, ctx), driver: driverIn(league, men, ctx) });
  }
  // One per scope: the worst reason it's on the list.
  return out.filter((t, i) => out.findIndex((o) => o.scope === t.scope) === i);
}

/** The rooms reading Split or Down now, read once a club a step (`troubles` and `noteRooms` both ask). */
function roomTrouble(league: League, teamId: number, ctx: MoraleContext): UnitRead[] {
  const cache = roomCache.get(ctx) ?? roomCache.set(ctx, new Map()).get(ctx)!;
  const hit = cache.get(teamId);
  if (hit) return hit;
  const reads = ROOMS.flatMap((u): UnitRead[] => {
    const r = unitRead(league, teamId, u, ctx);
    return r && (r.word === 'Split' || r.word === 'Down') ? [r] : [];
  });
  cache.set(teamId, reads);
  return reads;
}
const roomCache = new WeakMap<MoraleContext, Map<number, UnitRead[]>>();

const feudKey = (league: League, [a, b]: [number, number]) => `${league.season}:${a}-${b}`;

/** What the coach has now seen: the rooms' reads and this season's feuds (each is trouble once). */
function noteRooms(league: League, teamId: number, ctx: MoraleContext): void {
  const m = meetingsOf(league.teams[teamId]);
  const reads: NonNullable<TeamMeetings['reads']> = {};
  for (const r of roomTrouble(league, teamId, ctx)) reads[r.unit as CoachRoom] = r.word as 'Split' | 'Down';
  if (Object.keys(reads).length) m.reads = reads;
  else delete m.reads;
  const feuds = new Set((m.feuds ?? []).filter((k) => k.startsWith(`${league.season}:`)));
  for (const room of ROOMS) {
    const pair = feudIn(membersOf(league, teamId, room), league.season);
    if (pair) feuds.add(feudKey(league, pair));
  }
  if (feuds.size) m.feuds = [...feuds].sort();
  else delete m.feuds;
}

/** The club's last trouble meeting offered, any scope, this league year. */
function lastClubTrouble(league: League, teamId: number): number {
  const at = Object.values(meetingsOf(league.teams[teamId]).offeredAt ?? {}).filter(
    (c) => seasonOf(c) === league.season,
  );
  return at.length ? Math.max(...at) : -Infinity;
}

/** The trouble to meet about now: the worst one off its cooldown, and none within four weeks of the last. */
export function troubleScope(league: League, teamId: number, ctx: MoraleContext): Trouble | null {
  if (stepClock(league) - lastClubTrouble(league, teamId) < COOLDOWN.club) return null;
  return troubles(league, teamId, ctx).find((t) => offCooldown(league, teamId, t.scope)) ?? null;
}

// ───────── the choices offered ─────────

const losing = (ctx: MoraleContext, teamId: number) => {
  const r = ctx.records.get(teamId);
  return !!r && r.l > r.w;
};

/** A leader or voice in these men reading Good or better: the one who could say it. */
function leaderIn(league: League, men: Player[], ctx: MoraleContext): number | undefined {
  return men
    .map((p) => ({ p, w: weightOf(league, p, ctx) }))
    .filter((x) => tierOf(league, x.p, x.w) !== null && moraleStepOf(moraleLevel(league, x.p)) >= 5)
    .sort((a, b) => b.w - a.w || a.p.id - b.p.id)[0]?.p.id;
}

/** The choices that fit (spec §1.2): two to four approaches, the possible commitments, the timings. */
export function choicesFor(
  league: League,
  teamId: number,
  scope: MeetingScope,
  kind: 'moment' | 'trouble',
  topic: TalkCause | 'none',
  driver: number | undefined,
  ctx: MoraleContext,
): Pick<MeetingSuggestion, 'approaches' | 'backings' | 'timings' | 'named' | 'namedFor' | 'leader' | 'driver'> {
  const men = membersOf(league, teamId, scope);
  const leader = leaderIn(league, men, ctx);
  const losingNow = losing(ctx, teamId);
  const approaches: Approach[] = [];
  if (leader !== undefined) approaches.push('leader');
  approaches.push('straight');
  if (driver !== undefined) approaches.push('callout');
  if (losingNow && (topic === 'losing' || men.some((p) => grievancesOf(league, p, ctx).has('losing'))))
    approaches.push('losing');
  if (kind === 'moment' || topic === 'none' || approaches.length < 2) approaches.push('standard');

  const backings: Backing[] = [];
  const named: number[] = [];
  const dealMen = men.filter((p) => grievancesOf(league, p, ctx).has('deal') && !league.negotiations[p.id]);
  if (dealMen.length) backings.push('talks');
  const snapsMan = men
    .filter(
      (p) =>
        grievancesOf(league, p, ctx).has('snaps') && !isStarter(league, p) && (actualRole(league, p, ctx) ?? 0) < 2,
    )
    .sort((a, b) => moraleLevel(league, a) - moraleLevel(league, b) || a.id - b.id)[0];
  if (snapsMan) backings.push('snaps');
  const feud = feudIn(men);
  if (feud) backings.push('feud');
  if (league.phase === 'regular' && league.week <= TRADE_DEADLINE_WEEK && losingNow) backings.push('move');
  backings.push('words');
  // The men each commitment would name, in the order the commitments are offered.
  const namedFor: NonNullable<MeetingSuggestion['namedFor']> = {};
  if (dealMen.length) namedFor.talks = dealMen.map((p) => p.id);
  if (snapsMan) namedFor.snaps = [snapsMan.id];
  if (feud) namedFor.feud = [...feud];
  for (const ids of Object.values(namedFor)) named.push(...ids);

  const timings: Timing[] =
    kind === 'moment'
      ? []
      : league.phase === 'regular' || league.phase === 'playoffs'
        ? ['afterGame', 'monday', 'wednesday']
        : ['monday', 'wednesday'];
  return {
    approaches,
    backings,
    timings,
    named: [...new Set(named)],
    ...(Object.keys(namedFor).length ? { namedFor } : {}),
    ...(leader !== undefined ? { leader } : {}),
    ...(driver !== undefined ? { driver } : {}),
  };
}

/**
 * The head coach's suggestion this step, or none: a moment first, then the worst trouble off its cooldown; one a week
 * at most. Records the moment as offered and the step's offer (held or not, it's spent).
 */
export function suggestMeeting(league: League, teamId: number, ctx: MoraleContext): MeetingSuggestion | null {
  const team = league.teams[teamId];
  const m = meetingsOf(team);
  const clock = stepClock(league);
  if (m.lastOffer !== undefined && clock - m.lastOffer < COOLDOWN.week) return null;
  if (!headCoachOf(league, teamId)) return null;
  const moment = momentDue(league, teamId);
  let s: MeetingSuggestion | null = null;
  if (moment) {
    const keys = [momentKey(league, moment.key)];
    // A new coach's first camp is camp's meeting too.
    if (moment.moment === 'newCoach' && league.phase === 'preseason') keys.push(momentKey(league, 'camp'));
    m.moments = [...(m.moments ?? []).filter((k) => k.startsWith(`${league.season}:`)), ...keys];
    const topic = topicOf(league, membersOf(league, teamId, 'team'), ctx);
    s = {
      clock,
      scope: 'team',
      kind: 'moment',
      moment: moment.moment,
      topic,
      ...choicesFor(league, teamId, 'team', 'moment', topic, undefined, ctx),
    };
  } else if (troubleSeason(league)) {
    const t = troubleScope(league, teamId, ctx);
    noteRooms(league, teamId, ctx);
    if (t) markOffered(league, teamId, t.scope);
    if (t)
      s = {
        clock,
        scope: t.scope,
        kind: 'trouble',
        topic: t.topic,
        ...choicesFor(league, teamId, t.scope, 'trouble', t.topic, t.driver, ctx),
      };
  }
  if (s) m.lastOffer = clock;
  return s;
}
