/**
 * What the coaching screens say about a staff, in plain words: the UI side of engine/coaching.ts.
 * Coach ratings are public. What they do for players is shown only as percentages against a typical
 * staff, never as a player's ratings, potential or traits (see ui/scouting.tsx for what the fog allows).
 */
import {
  CHAIRS,
  chairHolder,
  chairOf,
  COACH_ROOMS,
  coachingFrom,
  coachingParts,
  coachName,
  coachResignForecast,
  coachTitle,
  effectOf,
  isCoachExpiring,
  ROOM_LABEL,
  ROOM_OF,
  ROOM_POSITIONS,
  roomEffect,
  sameChair,
  teamCoaches,
  TYPICAL,
  type Chair,
  type Effect,
  type RoomChange,
  type Source,
} from '../engine/coaching';
import { ROSTER_TEMPLATE } from '../engine/positions';
import { teamPlayers } from '../engine/roster';
import type { Coach, CoachRoom, League, Player, Position } from '../engine/types';

/** A position room, or null for kickers and punters (nobody coaches them but the head coach and S&C coach). */
export type Room = CoachRoom | null;
export const ALL_ROOMS: Room[] = [...COACH_ROOMS, null];
export const roomLabel = (r: Room) => (r ? ROOM_LABEL[r] : 'Kickers & punters');
const OFFENSE_ROOMS: ReadonlySet<Room> = new Set<Room>(['QB', 'RB', 'WR', 'OL']);

/** Young players still grow; veterans are the ones coaches keep going. The same cut-offs everywhere on these screens. */
export const YOUNG_UNDER = 26;
export const VETERAN_FROM = 28;

// ───────── who is on the staff ─────────

/**
 * The coaches who will still be on the staff when the re-sign window closes: everyone under contract,
 * plus the expiring deals forecast to re-sign. This is what next year's development will use, so it is
 * what every effect on these screens is computed from.
 */
export function stayingCoaches(league: League, teamId: number): Coach[] {
  const forecast = coachResignForecast(league, teamId);
  return teamCoaches(league, teamId).filter((c) => !isCoachExpiring(league, c) || forecast.get(c.id) === 'stays');
}

export const withArticle = (noun: string) => `${/^[aeiou]/i.test(noun) ? 'an' : 'a'} ${noun}`;
/** "receivers coach", "head coach": a chair as it reads mid-sentence. */
export const chairNoun = (chair: Chair) => coachTitle(chair).toLowerCase();

export interface RoomCount {
  total: number;
  young: number;
  old: number;
}
/** How many of the user's players each room coaches, and how many of them are young or veterans (by age only). */
export function roomCounts(league: League, teamId: number): Map<Room, RoomCount> {
  const out = new Map<Room, RoomCount>(ALL_ROOMS.map((r) => [r, { total: 0, young: 0, old: 0 }]));
  for (const p of teamPlayers(league, teamId)) {
    if (p.retired) continue;
    const n = out.get(ROOM_OF[p.position])!;
    n.total++;
    if (p.age < YOUNG_UNDER) n.young++;
    if (p.age >= VETERAN_FROM) n.old++;
  }
  return out;
}

// ───────── numbers in words ─────────

const whole = (x: number) => Math.round(x * 100);
const signedWhole = (n: number) => (n > 0 ? `+${n}%` : n < 0 ? `−${-n}%` : '0%');
/** +0.12 → "+12%", −0.05 → "−5%". */
export const signedPct = (x: number) => signedWhole(whole(x));
/** Growth up is good; decline (aging) down is good. */
export const growthTone = (x: number) => (whole(x) > 0 ? 'tone-good' : whole(x) < 0 ? 'tone-bad' : 'muted');
export const agingTone = (x: number) => (whole(x) < 0 ? 'tone-good' : whole(x) > 0 ? 'tone-bad' : 'muted');

// ───────── how a room's effect adds up ─────────

export interface RoomPart {
  source: Source;
  chair: Chair;
  coach: Coach | null;
  growth: number;
  aging: number;
}
/**
 * Each chair's part of a room's growth and aging, from the engine's own `coachingParts`, averaged over the
 * room's positions by roster spots like `roomEffect` does, so the parts add up to what the room shows.
 */
export function roomParts(coaches: readonly Coach[], room: Room): RoomPart[] {
  const positions: Position[] = room ? ROOM_POSITIONS[room] : ['K', 'P'];
  const parts = new Map<Source, RoomPart>();
  let spots = 0;
  for (const pos of positions) {
    const w = ROSTER_TEMPLATE[pos];
    spots += w;
    for (const part of coachingParts(coaches, pos)) {
      // Put this one chair's share through the engine's own aging blend for the position.
      const e = effectOf({ rate: 1 + part.growth, decline: { physical: 1 + part.body, technical: 1 + part.craft, mental: 1 + part.craft } }, pos);
      const sum = parts.get(part.source) ?? { source: part.source, chair: part.chair, coach: part.coach, growth: 0, aging: 0 };
      sum.growth += e.growth * w;
      sum.aging += e.aging * w;
      parts.set(part.source, sum);
    }
  }
  return [...parts.values()].map((p) => ({ ...p, growth: p.growth / spots, aging: p.aging / spots }));
}

/** The chair's name for a part, short enough for a phone: "Receivers coach", "Offensive coordinator", "S&C coach". */
export const partLabel = (p: RoomPart) => (p.source === 'strengthCoach' ? 'S&C coach' : coachTitle(p.chair));

// ───────── what a vacancy costs ─────────

/** A coach of exactly typical quality: the yardstick an empty chair is measured against. */
const typicalIn = (chair: Chair): Coach => ({ id: -1, firstName: '', lastName: '', ...chair, age: 45, youth: TYPICAL, veterans: TYPICAL, teamId: 0, contract: null });

/** What leaving a chair empty costs the rooms it covers, against a typical coach in it (positive = worse). */
export function vacancyCost(staying: readonly Coach[], chair: Chair): { growth: number; aging: number; rooms: Room[] } {
  const without = staying.filter((c) => !sameChair(chairOf(c), chair));
  const filled = [...without, typicalIn(chair)];
  const rooms: Room[] = [];
  let growth = 0;
  let aging = 0;
  for (const room of ALL_ROOMS) {
    const a = roomEffect(without, room);
    const b = roomEffect(filled, room);
    if (Math.abs(b.growth - a.growth) < 0.0005 && Math.abs(a.aging - b.aging) < 0.0005) continue;
    rooms.push(room);
    growth += b.growth - a.growth;
    aging += a.aging - b.aging;
  }
  return rooms.length ? { growth: growth / rooms.length, aging: aging / rooms.length, rooms } : { growth: 0, aging: 0, rooms };
}

const ROOM_SUBJECT: Record<CoachRoom, string> = {
  QB: 'quarterbacks',
  RB: 'running backs',
  WR: 'receivers and tight ends',
  OL: 'offensive linemen',
  DL: 'defensive linemen',
  LB: 'linebackers',
  DB: 'defensive backs',
};
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** "receivers and tight ends grow 13% slower and decline 4% faster than with a typical coach" */
export function vacancyClause(staying: readonly Coach[], chair: Chair): string {
  const cost = vacancyCost(staying, chair);
  const subject = chair.role === 'positionCoach' && chair.room ? ROOM_SUBJECT[chair.room] : chair.role === 'offCoord' ? 'your offensive players' : chair.role === 'defCoord' ? 'your defensive players' : 'your players';
  const g = whole(cost.growth);
  const a = whole(cost.aging);
  const bits = [g > 0 ? `grow ${g}% slower` : '', a > 0 ? `decline ${a}% faster` : ''].filter(Boolean);
  return bits.length ? `${subject} ${bits.join(' and ')} than with a typical coach` : `${subject} lose almost nothing without him`;
}
/** The same as a sentence. */
export const vacancyText = (staying: readonly Coach[], chair: Chair) => `${capital(vacancyClause(staying, chair))}.`;

// ───────── what a hire would do ─────────

/**
 * How much a change is worth to the user's actual roster: each room's growth gain counts for its players
 * under 26, its aging gain for its players 28 and over. Ages only; never potential or true ratings.
 */
export function gainScore(changes: RoomChange[], counts: Map<Room, RoomCount>): number {
  let score = 0;
  for (const ch of changes) {
    const n = counts.get(ch.room);
    if (n) score += (ch.to.growth - ch.from.growth) * n.young + (ch.from.aging - ch.to.aging) * n.old;
  }
  return score;
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const avgEffect = (xs: Effect[]): Effect => ({ growth: mean(xs.map((e) => e.growth)), aging: mean(xs.map((e) => e.aging)) });

/**
 * "Receivers & tight ends: growth +4% → +16%, decline −1% → −3%." Up to three rooms get a line each; a
 * hire who changes more (a head coach, a coordinator) is summed up by the average over those rooms.
 * Whole percents only, and a number that doesn't move is left out.
 */
export function previewLines(changes: RoomChange[]): string[] {
  const moves = changes
    .map((ch) => ({ room: ch.room, from: ch.from, to: ch.to, g: [whole(ch.from.growth), whole(ch.to.growth)], a: [whole(ch.from.aging), whole(ch.to.aging)] }))
    .filter((m) => m.g[0] !== m.g[1] || m.a[0] !== m.a[1]);
  if (!moves.length) return ['No change to how your players develop.'];
  const line = (label: string, g: number[], a: number[]) => {
    const bits = [g[0] !== g[1] ? `growth ${signedWhole(g[0])} → ${signedWhole(g[1])}` : '', a[0] !== a[1] ? `decline ${signedWhole(a[0])} → ${signedWhole(a[1])}` : ''].filter(Boolean);
    return `${label}: ${bits.join(', ')}.`;
  };
  if (moves.length <= 3) return moves.map((m) => line(roomLabel(m.room), m.g, m.a));
  const from = avgEffect(moves.map((m) => m.from));
  const to = avgEffect(moves.map((m) => m.to));
  const side = moves.every((m) => OFFENSE_ROOMS.has(m.room)) ? 'Offensive rooms' : moves.every((m) => m.room !== null && !OFFENSE_ROOMS.has(m.room)) ? 'Defensive rooms' : 'Every room';
  return [line(`${side} (average)`, [whole(from.growth), whole(to.growth)], [whole(from.aging), whole(to.aging)])];
}

// ───────── a player's own coaches ─────────

const youthVeteran = (c: Coach) => `Youth ${c.youth} · Veteran care ${c.veterans}`;

/**
 * One line for a player card: who coaches him and what that does to how he grows and ages. Under 26 it
 * leads with growth; past that only aging matters, so it says that. Empty chair? It says so.
 */
export function playerCoachLine(league: League, p: Player): string {
  const staff = stayingCoaches(league, p.teamId!);
  const pos = p.position;
  const room = ROOM_OF[pos];
  let who: string;
  if (room) {
    const chair: Chair = { role: 'positionCoach', room };
    const c = chairHolder(staff, chair);
    who = c ? `Coached by ${coachName(c)}, ${chairNoun(chair)} (${youthVeteran(c)})` : `Your ${chairNoun(chair)} chair is empty`;
  } else {
    const hc = chairHolder(staff, { role: 'headCoach' });
    const sc = chairHolder(staff, { role: 'strengthCoach' });
    const named = (c: Coach | null, noun: string) => (c ? `${noun} ${coachName(c)} (${youthVeteran(c)})` : `no ${noun}`);
    who = `Coached by ${named(hc, 'head coach')} and ${named(sc, 'S&C coach')}, who share the kickers and punters`;
  }
  const e = effectOf(coachingFrom(staff, pos), pos);
  const g = whole(e.growth);
  const a = whole(e.aging);
  const growth = g === 0 ? '' : `grows about ${Math.abs(g)}% ${g > 0 ? 'faster' : 'slower'}`;
  const aging = a === 0 ? '' : `declines about ${Math.abs(a)}% ${a < 0 ? 'more slowly' : 'faster'}`;
  const clauses = (p.age < YOUNG_UNDER ? [growth, aging] : [aging]).filter(Boolean);
  if (!clauses.length) return `${who}: develops about as he would with a typical staff.`;
  clauses[0] += ' than with a typical staff';
  return `${who}: ${clauses.join('; ')}.`;
}

// ───────── what needs attention ─────────

export interface CoachAttention {
  /** Deals that ran out last league year (the re-sign window only). */
  due: Coach[];
  /** Of those, the ones who leave when the window closes. */
  leaving: Coach[];
  /** Chairs nobody holds right now. */
  empty: Chair[];
}
export function coachAttention(league: League, teamId: number): CoachAttention {
  const mine = teamCoaches(league, teamId);
  const forecast = coachResignForecast(league, teamId);
  const due = mine.filter((c) => isCoachExpiring(league, c));
  return {
    due,
    leaving: due.filter((c) => forecast.get(c.id) !== 'stays'),
    empty: CHAIRS.filter((ch) => !chairHolder(mine, ch)),
  };
}

/**
 * A calm line or two for a notice: the deals that are up and what happens to them, then any chair that is
 * empty and what that costs. Empty when there is nothing to say.
 */
export function attentionText(league: League, teamId: number, att: CoachAttention = coachAttention(league, teamId)): string {
  const out: string[] = [];
  const n = att.due.length;
  if (n > 0) {
    out.push(n === 1 ? '1 coaching deal is up.' : `${n} coaching deals are up.`);
    const one = n === 1;
    if (att.leaving.length === 0) out.push(`${one ? 'He re-signs' : 'They re-sign'} automatically unless you let ${one ? 'him' : 'them'} go.`);
    else {
      const rest = n - att.leaving.length;
      out.push(`${att.leaving.map(coachName).join(' and ')} will leave (no chair or budget for ${att.leaving.length === 1 ? 'him' : 'them'}); ${rest === 0 ? 'nobody else is up' : 'the rest re-sign automatically'}.`);
    }
  }
  if (att.empty.length === 1) out.push(`Your ${chairNoun(att.empty[0])} chair is empty: ${vacancyClause(stayingCoaches(league, teamId), att.empty[0])}.`);
  else if (att.empty.length > 1) out.push(`${att.empty.length} coaching chairs are empty.`);
  return out.join(' ');
}
