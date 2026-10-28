/**
 * Mentoring: a veteran on the active 53 helps a young teammate grow up. What rubs off is the veteran's own work ethic,
 * temper and poise, good or bad, at most a point a year each, for players 21–24 (docs/TRAINING.md §8, and
 * docs/superpowers/specs/2026-10-28-personality-relationships-design.md §2). How much depends on how much the room
 * listens to him (his leadership and his standing) and on how much the young player lets in. Mentors are picked by
 * leadership and standing only, never by work ethic, so the league as a whole doesn't drift.
 */
import { activeRoster } from './roster';
import { characterRead, seasonRole } from './scouting';
import { formerPositions } from './training';
import { clamp } from './rng';
import { poiseOf, temperamentOf, TRAIT_MEAN, workEthicOf, type Shifted } from './traits';
import type { League, Player, Position } from './types';

export const MENTOR_MIN_AGE = 27;
export const MENTOR_MIN_SEASONS = 5;
export const YOUNG_AGES: [number, number] = [21, 24];
export const MAX_MENTEES = 2;
/** Tuned so a starting Born Leader two spreads apart on a trait reaches the point-a-year cap in a full season. */
export const RATE = 0.6;
export const POSITION_BONUS = 1.12;
export const SEASON_WEEKS = 18;
const SD = 3.5;

export const SHIFTED: readonly Shifted[] = ['workEthic', 'temperament', 'poise'];
const valueOf: Record<Shifted, (p: Player) => number> = {
  workEthic: workEthicOf,
  temperament: temperamentOf,
  poise: poiseOf,
};

/** Old enough, or long enough in the league, to have something to pass on. */
export const canMentor = (p: Player) => p.age >= MENTOR_MIN_AGE || p.experience >= MENTOR_MIN_SEASONS;

/** Young enough to still be shaped by one. */
export const canBeMentored = (p: Player) => p.age >= YOUNG_AGES[0] && p.age <= YOUNG_AGES[1];

/** How much the room listens to a man of this leadership: about ×0.3 for the quietest, ×1.5 for a Born Leader. */
export const leadFactor = (leads: number) => clamp(0.9 + (0.4 * (leads - TRAIT_MEAN)) / SD, 0.3, 1.5);

/** A starter's word carries; a backup's less. Read from last season's snaps; no line counts as a backup. */
export function standingFactor(league: League, p: Player): number {
  const role = seasonRole(league, p)?.role;
  return role === 'starter' ? 1 : role === 'rotation' ? 0.7 : 0.4;
}

/** How much sticks: a young player who stirs the room (high controversy) takes less from anyone. */
export const takes = (p: Player) => clamp(1 - (0.3 * Math.max(0, p.traits.controversy - TRAIT_MEAN)) / SD, 0.4, 1);

/** A mentor who plays, or has played, the young player's position knows his job best. */
export const positionBonus = (_league: League, mentor: Player, young: Player) =>
  mentor.position === young.position || formerPositions(mentor).includes(young.position) ? POSITION_BONUS : 1;

/** What `weeks` together move, per trait: toward the mentor's own, either way, a point at most. */
export function mentorShift(league: League, mentor: Player, young: Player, weeks: number): Record<Shifted, number> {
  const pull =
    RATE *
    (weeks / SEASON_WEEKS) *
    leadFactor(mentor.traits.leads) *
    standingFactor(league, mentor) *
    takes(young) *
    positionBonus(league, mentor, young);
  const out = {} as Record<Shifted, number>;
  for (const k of SHIFTED)
    out[k] = weeks > 0 ? clamp((pull * (valueOf[k](mentor) - valueOf[k](young))) / SD, -1, 1) : 0;
  return out;
}

// ───────── pairs ─────────

const OFFENSE: ReadonlySet<Position> = new Set(['QB', 'RB', 'WR', 'TE', 'OL']);
const sideOf = (pos: Position) => (OFFENSE.has(pos) ? 'offense' : pos === 'K' || pos === 'P' ? 'kicking' : 'defense');

/** Is the pair still a pair: the mentor around, on the young player's club, and the young player still young? */
function stillPaired(league: League, young: Player): boolean {
  const m = young.mentor === undefined ? undefined : league.players[young.mentor];
  return !!m && !m.retired && m.teamId !== null && m.teamId === young.teamId && canBeMentored(young);
}

/** Keep the record of who mentored him (the last two pairs), extending a pair that runs on. */
function remember(young: Player, mentorId: number, season: number): void {
  const log = (young.mentoredBy ??= []);
  const last = log.find((e) => e.id === mentorId && e.to >= season - 1);
  if (last) last.to = Math.max(last.to, season);
  else log.push({ id: mentorId, from: season, to: season });
  if (log.length > 2) log.splice(0, log.length - 2);
}

/** Bank what `weeks` together taught him; it lands at the new league year (`settleMentoring`). */
function bank(league: League, young: Player, mentor: Player, weeks: number): void {
  if (weeks <= 0) return;
  const s = mentorShift(league, mentor, young, weeks);
  const b = (young.mentorBank ??= {});
  for (const k of SHIFTED) b[k] = (b[k] ?? 0) + s[k];
}

/**
 * End a pair: what they managed together is banked and remembered. Development already rolled this year off his
 * traits as they stood, so nothing moves before the new league year.
 */
export function endPair(league: League, young: Player): void {
  const m = young.mentor === undefined ? undefined : league.players[young.mentor];
  if (m && (young.mentorWeeks ?? 0) > 0) {
    bank(league, young, m, young.mentorWeeks!);
    remember(young, m.id, league.season);
  }
  delete young.mentor;
  delete young.mentorWeeks;
  delete young.mentorSetByYou;
}

/**
 * How highly a club's staff rate a veteran as a mentor: their read of his leadership times his standing. Both only move
 * season to season (standing is last season's snaps), so the rating is kept for the season.
 */
const ratings = new WeakMap<League, Map<string, number>>();
function staffRating(league: League, teamId: number, m: Player): number {
  let cache = ratings.get(league);
  if (!cache) ratings.set(league, (cache = new Map()));
  const key = `${league.season}:${teamId}:${m.id}`;
  let r = cache.get(key);
  if (r === undefined) {
    r = leadFactor(characterRead(league, teamId, m)?.leads ?? TRAIT_MEAN) * standingFactor(league, m);
    cache.set(key, r);
  }
  return r;
}

/**
 * Pair a club's young players with mentors: valid pairs and pairs you set stay; the rest go youngest first to the free
 * mentor the staff rate highest (leadership read times standing), same position first, then the same side of the
 * ball. Your club's staff do this unless you've taken it on (`Team.mentoringByYou`). Never picks by work ethic.
 */
export function planMentors(league: League, teamId: number): void {
  const roster = activeRoster(league, teamId);
  const team = league.teams[teamId];
  const load = new Map<number, number>();
  for (const p of roster) if (p.mentor !== undefined) load.set(p.mentor, (load.get(p.mentor) ?? 0) + 1);
  if (teamId === league.userTeamId && team.mentoringByYou) return;
  const young = roster
    .filter((p) => canBeMentored(p) && p.mentor === undefined && !p.mentorSetByYou)
    .sort((a, b) => a.age - b.age || a.id - b.id);
  // Most weeks nobody new needs a mentor: don't rate the room for nothing.
  if (!young.length) return;
  const score = new Map<number, number>();
  const mentors = roster.filter(canMentor);
  for (const m of mentors) score.set(m.id, staffRating(league, teamId, m));
  for (const y of young) {
    const pick = mentors
      .filter((m) => m.id !== y.id && (load.get(m.id) ?? 0) < MAX_MENTEES)
      .sort(
        (a, b) =>
          Number(b.position === y.position) - Number(a.position === y.position) ||
          Number(sideOf(b.position) === sideOf(y.position)) - Number(sideOf(a.position) === sideOf(y.position)) ||
          score.get(b.id)! - score.get(a.id)! ||
          a.id - b.id,
      )[0];
    if (!pick) continue;
    y.mentor = pick.id;
    y.mentorWeeks = 0;
    load.set(pick.id, (load.get(pick.id) ?? 0) + 1);
  }
}

/** A regular-season week: broken pairs end, empty places fill, and every pair on the active 53 banks a week. */
export function mentoringWeek(league: League): void {
  for (const p of Object.values(league.players)) {
    if (p.mentor !== undefined && !stillPaired(league, p)) {
      const m = league.players[p.mentor];
      // He left the club (a trade, a release): the young player's coaches will want you to know.
      if (m && !m.retired && m.teamId !== p.teamId)
        p.lostMentor = { id: m.id, season: league.season, week: league.week };
      endPair(league, p);
    }
    // Your choice for him leaves with him: a club that trades for him pairs him its own way.
    if (p.mentorSetByYou && p.teamId !== league.userTeamId) delete p.mentorSetByYou;
  }
  for (const team of league.teams) {
    planMentors(league, team.id);
    const active = new Set(activeRoster(league, team.id).map((p) => p.id));
    for (const id of active) {
      const p = league.players[id];
      // IR pauses a pair: the week only counts with both on the 53.
      if (p.mentor !== undefined && active.has(p.mentor)) p.mentorWeeks = (p.mentorWeeks ?? 0) + 1;
    }
  }
}

/**
 * The new league year, before anyone's year is rolled: every pair's season is banked, then the whole league's banks
 * are re-centred so that, trait by trait, they sum to zero. Mentors move players against each other, never the league
 * as a whole: without it a season's noise, and young hotheads taking less from their mentors (controversy runs against
 * temper), would walk the league's averages away over a long save (`npm run training` holds them within ±0.02).
 */
export function mentoringYearEnd(league: League): void {
  const last = league.season - 1;
  const banked: Player[] = [];
  for (const p of Object.values(league.players)) {
    if (p.retired) continue;
    const m = p.mentor === undefined ? undefined : league.players[p.mentor];
    if (m && (p.mentorWeeks ?? 0) > 0) {
      bank(league, p, m, p.mentorWeeks!);
      remember(p, m.id, last);
    }
    if (p.mentor !== undefined) p.mentorWeeks = 0;
    if (p.mentorBank) banked.push(p);
  }
  if (!banked.length) return;
  for (const k of SHIFTED) {
    // A point a year at most, then the year's average taken back out (twice, in case the cap bit).
    for (const p of banked) p.mentorBank![k] = clamp(p.mentorBank![k] ?? 0, -1, 1);
    for (let pass = 0; pass < 2; pass++) {
      const mean = banked.reduce((sum, p) => sum + p.mentorBank![k]!, 0) / banked.length;
      for (const p of banked) p.mentorBank![k] = clamp(p.mentorBank![k]! - mean, -1, 1);
    }
  }
  // Two decimals is all a trait needs, and a long save keeps every shift: no 0.12345678901 in the file.
  for (const p of banked) for (const k of SHIFTED) p.mentorBank![k] = Math.round(p.mentorBank![k]! * 100) / 100;
}

/** The new league year, for one player, before his year is rolled: what he learned lands; past 24 he's on his own. */
export function settleMentoring(league: League, p: Player): void {
  delete p.shiftedLast;
  delete p.lostMentor;
  if (p.mentorBank) {
    const shifts = (p.shifts ??= {});
    const landed: Player['shiftedLast'] = { season: league.season };
    for (const k of SHIFTED) {
      const d = p.mentorBank[k] ?? 0;
      if (!d) continue;
      shifts[k] = Math.round(((shifts[k] ?? 0) + d) * 100) / 100;
      landed[k] = d;
    }
    delete p.mentorBank;
    // Only your own club's letters read it, so other clubs' players don't carry it in the save.
    if (Object.keys(landed).length > 1 && p.teamId === league.userTeamId) p.shiftedLast = landed;
  }
  if (p.age + 1 > YOUNG_AGES[1]) {
    delete p.mentor;
    delete p.mentorWeeks;
    delete p.mentorSetByYou;
  }
}

/** You pick a mentor for one of your young players (null: none). A pair you set is left alone by your staff. */
export function setMentor(league: League, youngId: number, mentorId: number | null): void {
  const y = league.players[youngId];
  const m = mentorId === null ? undefined : league.players[mentorId];
  if (!y || !canBeMentored(y)) throw new Error('Only a player 21 to 24 can have a mentor.');
  if (m) {
    if (m.id === y.id || !canMentor(m)) throw new Error('A mentor needs to be 27, or five years in the league.');
    if (m.teamId !== y.teamId) throw new Error('A mentor has to be on the same club.');
    const load = Object.values(league.players).filter((p) => p.mentor === m.id && p.id !== y.id).length;
    if (load >= MAX_MENTEES) throw new Error('He already has two players to look after.');
  }
  if (y.mentor !== m?.id) endPair(league, y);
  if (m) {
    y.mentor = m.id;
    y.mentorWeeks ??= 0;
  }
  y.mentorSetByYou = true;
}

/** Take on pairing your own mentors, or hand it back to your position coaches. */
export function setMentoringByYou(league: League, on: boolean): void {
  const team = league.teams[league.userTeamId];
  if (on) team.mentoringByYou = true;
  else delete team.mentoringByYou;
}
