/**
 * What the coaching screens say about a staff, in plain words: the UI side of engine/coaching.ts.
 * Coach ratings are public, as staff ratings are in Football Manager. What a staff does for players is said in
 * words on one scale (`verdict`), with the percentages against a typical staff one tap away; never as a
 * player's ratings, potential or traits (see ui/scouting.tsx for what the fog allows).
 */
import {
  CHAIRS,
  chairHolder,
  chairOf,
  COACH_ROOMS,
  coachingFrom,
  DECLINE_RANGE,
  coachingParts,
  coachName,
  coachResignForecast,
  coachTitle,
  effectOf,
  isCoachExpiring,
  ROOM_LABEL,
  ROOM_OF,
  ROOM_POSITIONS,
  RATE_RANGE,
  roomEffect,
  sameChair,
  teamCoaches,
  TYPICAL,
  type Chair,
  type Effect,
  type RoomChange,
  type Source,
} from '../engine/coaching';
import { declineOnset } from '../engine/aging';
import { ROSTER_TEMPLATE } from '../engine/positions';
import { teamPlayers } from '../engine/roster';
import type { Coach, CoachRole, CoachRoom, League, Player, Position } from '../engine/types';
import { verdict, type Verdict } from './format';

/** A position room, or null for kickers and punters (nobody coaches them but the head coach and S&C coach). */
export type Room = CoachRoom | null;
export const ALL_ROOMS: Room[] = [...COACH_ROOMS, null];
export const roomLabel = (r: Room) => (r ? ROOM_LABEL[r] : 'Kickers & punters');
const OFFENSE_ROOMS: ReadonlySet<Room> = new Set<Room>(['QB', 'RB', 'WR', 'OL']);

/** Young players still grow; the old are the ones coaches keep going. The same cut-offs everywhere on these screens. */
export const YOUNG_UNDER = 26;
/**
 * Old for his position: at or past the age his body starts to decline. A back is there at 26 and a
 * quarterback at 29, so one age for everybody would miscount both. Calendar age only (no traits), which
 * is public knowledge; a player's own durability is hidden.
 */
export const isPastPrime = (p: Pick<Player, 'age' | 'position'>) => p.age >= declineOnset(p.position, 'physical');
/** How the screens say it, after "N players": "...are at or past the age their position starts to decline". */
export const PAST_PRIME_WORDS = 'at or past the age their position starts to decline';
/**
 * What each chair does, true to the engine: every coach has a hand in development (the position coach
 * most in his room, a coordinator for his side, the head coach a little for everyone, the S&C coach
 * most for the body), and the leadership chairs each own a call.
 */
export const ROLE_LINE: Record<CoachRole, string> = {
  headCoach: 'Sets the tone for the whole roster: a hand in how every player develops and holds up, and the call on fourth downs. Around the league, a bad season can cost him his job.',
  offCoord: 'Runs the offense: the scheme and personnel, the call on run or pass, and how the offensive players develop.',
  defCoord: 'Runs the defense: the front, the coverage, how often he sends extra rushers, and how the defensive players develop.',
  positionCoach: 'Does most of the teaching in his room: the biggest say in how its players grow and keep their technique.',
  strengthCoach: 'Keeps bodies going: the biggest say in how slowly speed and strength fade, in every room.',
};

export interface RepNote {
  label: string;
  tone: 'good' | 'warn';
  line: string;
}
/** The word around the league on a coach as a teacher: only the ends of the scale earn a tag. */
export function coachRep(c: Pick<Coach, 'youth' | 'veterans'>): RepNote[] {
  const notes: RepNote[] = [];
  const y = c.youth;
  const v = c.veterans;
  if (y >= 15) notes.push({ label: 'Teacher', tone: 'good', line: 'Young players grow under him.' });
  else if (y <= 6) notes.push({ label: 'Not a teacher', tone: 'warn', line: 'Young players stall under him.' });
  if (v >= 15) notes.push({ label: 'Keeps vets going', tone: 'good', line: 'Veterans hold up longer under him.' });
  else if (v <= 6) notes.push({ label: 'Hard on vets', tone: 'warn', line: 'Veterans fade sooner under him.' });
  return notes;
}

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
/** How many of the user's players each room coaches, and how many of them are young or past their prime (by age only). */
export function roomCounts(league: League, teamId: number): Map<Room, RoomCount> {
  const out = new Map<Room, RoomCount>(ALL_ROOMS.map((r) => [r, { total: 0, young: 0, old: 0 }]));
  for (const p of teamPlayers(league, teamId)) {
    if (p.retired) continue;
    const n = out.get(ROOM_OF[p.position])!;
    n.total++;
    if (p.age < YOUNG_UNDER) n.young++;
    if (isPastPrime(p)) n.old++;
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

/** How a staff does by young players (growth) and by veterans (decline), on the shared scale. */
export const growthVerdict = (growth: number): Verdict => verdict(growth, RATE_RANGE[1] - 1);
export const agingVerdict = (aging: number): Verdict => verdict(-aging, DECLINE_RANGE[1] - 1);
/** The exact figures behind the words, for the tap: "growth +4%, decline −2% against a typical staff". */
export const effectNumbers = (e: Effect) => `growth ${signedPct(e.growth)}, decline ${signedPct(e.aging)} against a typical staff`;

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

/** "receivers and tight ends develop noticeably slower and fade a little sooner than with a typical coach" */
export function vacancyClause(staying: readonly Coach[], chair: Chair): string {
  const cost = vacancyCost(staying, chair);
  const subject = chair.role === 'positionCoach' && chair.room ? ROOM_SUBJECT[chair.room] : chair.role === 'offCoord' ? 'your offensive players' : chair.role === 'defCoord' ? 'your defensive players' : 'your players';
  // The cost is positive when it hurts: flip it onto the shared scale.
  const g = growthVerdict(-cost.growth).much;
  const a = agingVerdict(cost.aging).much;
  const bits = [g ? `develop ${g} slower` : '', a ? `fade ${a} sooner` : ''].filter(Boolean);
  return bits.length ? `${subject} ${bits.join(' and ')} than with a typical coach` : `${subject} lose almost nothing without him`;
}
/** The same as a sentence. */
export const vacancyText = (staying: readonly Coach[], chair: Chair) => `${capital(vacancyClause(staying, chair))}.`;

// ───────── what a hire would do ─────────

/**
 * How much a change is worth to the user's actual roster: each room's growth gain counts for its players
 * under 26, its aging gain for its players past their prime (`isPastPrime`). Ages only; never potential
 * or true ratings.
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

export interface PreviewLine {
  /** "Receivers & tight ends: young players Average → Strong, veterans a touch better." */
  words: string;
  /** "growth +4% → +16%, decline −1% → −3%" */
  numbers: string;
}

/**
 * What a hire does to each room, in words on the shared scale with the percentages alongside. Up to three
 * rooms get a line each; a hire who changes more (a head coach, a coordinator) is summed up by the average
 * over those rooms. A figure that doesn't move is left out.
 */
export function previewLines(changes: RoomChange[]): PreviewLine[] {
  const moves = changes.filter((ch) => whole(ch.from.growth) !== whole(ch.to.growth) || whole(ch.from.aging) !== whole(ch.to.aging));
  if (!moves.length) return [{ words: 'No change to how your players develop.', numbers: '' }];
  // Same word both sides: say which way it went rather than "Average → Average".
  const step = (who: string, a: Verdict, b: Verdict, up: boolean) => (a.word === b.word ? `${who} a touch ${up ? 'better' : 'worse'}` : `${who} ${a.word} → ${b.word}`);
  const line = (label: string, from: Effect, to: Effect): PreviewLine => {
    const g = whole(from.growth) !== whole(to.growth);
    const a = whole(from.aging) !== whole(to.aging);
    const words = [
      g ? step('young players', growthVerdict(from.growth), growthVerdict(to.growth), to.growth > from.growth) : '',
      a ? step('veterans', agingVerdict(from.aging), agingVerdict(to.aging), to.aging < from.aging) : '',
    ].filter(Boolean);
    const numbers = [g ? `growth ${signedPct(from.growth)} → ${signedPct(to.growth)}` : '', a ? `decline ${signedPct(from.aging)} → ${signedPct(to.aging)}` : ''].filter(Boolean);
    return { words: `${label}: ${words.join(', ')}.`, numbers: numbers.join(', ') };
  };
  if (moves.length <= 3) return moves.map((m) => line(roomLabel(m.room), m.from, m.to));
  const side = moves.every((m) => OFFENSE_ROOMS.has(m.room)) ? 'Offensive rooms' : moves.every((m) => m.room !== null && !OFFENSE_ROOMS.has(m.room)) ? 'Defensive rooms' : 'Every room';
  return [line(`${side} (average)`, avgEffect(moves.map((m) => m.from)), avgEffect(moves.map((m) => m.to)))];
}

// ───────── a player's own coaches ─────────

const youthVeteran = (c: Coach) => `${coachName(c)}: youth ${c.youth}, veteran care ${c.veterans}`;

/**
 * One line for a player card: his coaches and what the whole staff does to how he grows and ages, in words,
 * with the percentages and his coaches' ratings for the tap. The effect combines four chairs (his position
 * coach, his side's coordinator, the head coach and the S&C coach), so the line names who leads rather than
 * implying one man does it all. Under 26 it leads with growth; past that only aging matters. Empty chair?
 * It says so.
 */
export function playerCoachLine(league: League, p: Player): { text: string; numbers: string } {
  const staff = stayingCoaches(league, p.teamId!);
  const pos = p.position;
  const room = ROOM_OF[pos];
  let who: string;
  let named: Coach[];
  if (room) {
    const chair: Chair = { role: 'positionCoach', room };
    const c = chairHolder(staff, chair);
    who = c ? `led by ${coachName(c)}, his ${chairNoun(chair)}` : `your ${chairNoun(chair)} chair is empty`;
    named = c ? [c] : [];
  } else {
    const hc = chairHolder(staff, { role: 'headCoach' });
    const sc = chairHolder(staff, { role: 'strengthCoach' });
    who = 'the head coach and the S&C coach, who share the kickers and punters';
    named = [hc, sc].filter((c): c is Coach => !!c);
  }
  const e = effectOf(coachingFrom(staff, pos), pos);
  const g = growthVerdict(e.growth).much;
  const a = agingVerdict(e.aging).much;
  const growth = g ? `develop ${g} ${e.growth > 0 ? 'faster' : 'slower'}` : '';
  const aging = a ? (e.aging < 0 ? `hold up ${a} longer` : `fade ${a} sooner`) : '';
  const clauses = (p.age < YOUNG_UNDER ? [growth, aging] : [aging]).filter(Boolean);
  // "than with a typical staff" closes the whole sentence, so it covers both clauses.
  const effect = clauses.length ? `he should ${clauses.join(' and ')} than with a typical staff` : `he should ${p.age < YOUNG_UNDER ? 'develop' : 'hold up'} about as he would with a typical staff`;
  return { text: `His coaches (${who}): ${effect}.`, numbers: [effectNumbers(e), ...named.map(youthVeteran)].join(' · ') };
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
