/**
 * Relationships: who a player gets on with, who he doesn't, and how he feels about the clubs he has played for
 * (docs/superpowers/specs/2026-10-28-personality-relationships-design.md §3). Rapport with a coach, homecomings and
 * grudges are worked out from history whenever they're needed; friendships and feuds are stored, three at most per
 * player. They lean on habits and contracts, and the match engine never reads them.
 */
import { activeCoachQuirks } from './coachQuirks';
import { ROOM_OF, teamCoaches } from './coaching';
import { addMarbles, QUIRKS, QUIRKS_FOR, type QuirkInfo } from './quirks';
import { Rng } from './rng';
import { activeRoster, starters } from './roster';
import { characterRead, seasonRole } from './scouting';
import { temperamentOf, TRAIT_MEAN } from './traits';
import { positionIn } from './training';
import type { Coach, Departure, League, Player, Position, Tie } from './types';

const MAX_LEFT = 3;
export const MAX_TIES = 3;

// ───────── how he left ─────────

/** He left `teamId` (cut, traded, or walked as a free agent): one entry per club per season, the newest three kept. */
export function noteDeparture(league: League, p: Player, teamId: number, how: Departure['how']): void {
  const left = (p.left ??= []);
  if (!left.some((d) => d.teamId === teamId && d.season === league.season))
    left.push({ teamId, season: league.season, how });
  if (left.length > MAX_LEFT) left.splice(0, left.length - MAX_LEFT);
  // Leaving the club is leaving the room: his feuds there are over.
  for (const t of [...(p.ties ?? [])]) if (t.kind === 'feud') endTie(league, p, t.with);
}

// ───────── ties ─────────

/** Same club, same position: the men competing for the same snaps. */
export const sameRoom = (a: Player, b: Player) =>
  a.teamId !== null && a.teamId === b.teamId && a.position === b.position;

/** End whatever tie two players have, on both sides. */
export function endTie(league: League, a: Player, withId: number): void {
  const b = league.players[withId];
  a.ties = a.ties?.filter((t) => t.with !== withId);
  if (!a.ties?.length) delete a.ties;
  if (b) {
    b.ties = b.ties?.filter((t) => t.with !== a.id);
    if (!b.ties?.length) delete b.ties;
  }
}

/**
 * Tie two players, on both sides. A feud replaces a friendship between the same two; nobody holds more than three.
 * False when there was no room.
 */
export function addTie(league: League, a: Player, b: Player, kind: Tie['kind'], why?: Tie['why']): boolean {
  if (a.id === b.id) return false;
  const existing = a.ties?.find((t) => t.with === b.id);
  if (existing?.kind === kind) return false;
  if (existing) endTie(league, a, b.id);
  if ((a.ties?.length ?? 0) >= MAX_TIES || (b.ties?.length ?? 0) >= MAX_TIES) return false;
  const tie = (other: Player): Tie => ({ kind, with: other.id, since: league.season, ...(why ? { why } : {}) });
  (a.ties ??= []).push(tie(b));
  (b.ties ??= []).push(tie(a));
  return true;
}

/** A position move or a trade can take a man out of the room: his feuds with anyone no longer in it end. */
export function endFeudsOutsideRoom(league: League, p: Player): void {
  for (const t of [...(p.ties ?? [])]) {
    const q = league.players[t.with];
    if (t.kind === 'feud' && (!q || !sameRoom(p, q))) endTie(league, p, t.with);
  }
}

// ───────── coaches and clubs: worked out from history ─────────

const OFFENSE: ReadonlySet<Position> = new Set(['QB', 'RB', 'WR', 'TE', 'OL']);
const KICKERS: ReadonlySet<Position> = new Set(['K', 'P']);

/** Was `c` his head coach, his side's coordinator or his room's position coach in `season`? */
export function coachedBy(_league: League, p: Player, c: Coach, season: number): boolean {
  const clubs = p.statTeams?.[season] ?? [];
  if (!clubs.length) return false;
  const pos = positionIn(p, season);
  return (c.career ?? []).some(
    (r) =>
      r.season === season &&
      clubs.includes(r.teamId) &&
      (r.role === 'headCoach' ||
        (r.role === 'offCoord' && OFFENSE.has(pos)) ||
        (r.role === 'defCoord' && !OFFENSE.has(pos) && !KICKERS.has(pos)) ||
        (r.role === 'stCoord' && KICKERS.has(pos)) ||
        (r.role === 'positionCoach' && r.room === ROOM_OF[pos])),
  );
}

const headCoachOf = (c: Coach, teamId: number, season: number) =>
  (c.career ?? []).some((r) => r.season === season && r.teamId === teamId && r.role === 'headCoach');

const played = (league: League, p: Player, season: number) => {
  const role = seasonRole(league, p, season)?.role;
  return role === 'starter' || role === 'rotation';
};

/**
 * How a player feels about a coach, from their seasons together. Sour if the coach ran a club that cut or traded him,
 * or benched him (a starter one year, a backup the next, healthy); good after two or more seasons under him in which he
 * played; otherwise nothing. Never stored: worked out from careers whenever it's needed.
 */
export function rapport(league: League, p: Player, c: Coach): 'good' | 'sour' | null {
  for (const d of p.left ?? [])
    if (d.how !== 'walked' && (headCoachOf(c, d.teamId, d.season) || headCoachOf(c, d.teamId, d.season - 1)))
      return 'sour';
  const seasons = Object.keys(p.statTeams ?? {})
    .map(Number)
    .filter((s) => coachedBy(league, p, c, s));
  for (const s of seasons) {
    const before = seasonRole(league, p, s - 1)?.role;
    const now = seasonRole(league, p, s);
    if (before === 'starter' && now?.role === 'backup' && (p.stats[s]?.gp ?? 0) >= 10) return 'sour';
  }
  return seasons.filter((s) => played(league, p, s)).length >= 2 ? 'good' : null;
}

/** Seasons a grudge lasts. */
export const GRUDGE_SEASONS = 3;

/**
 * How he feels about a club he left: a grudge for three seasons if it cut or traded him; home if he walked away after
 * playing there (a starter or a rotation player in his last season). Null for anywhere else.
 */
export function clubFeeling(league: League, p: Player, teamId: number): 'home' | 'grudge' | null {
  const d = [...(p.left ?? [])].reverse().find((x) => x.teamId === teamId);
  if (!d) return null;
  if (d.how !== 'walked') return league.season - d.season <= GRUDGE_SEASONS ? 'grudge' : null;
  return played(league, p, d.season - 1) ? 'home' : null;
}

// ───────── friendships and feuds ─────────

/** Starting odds (tuned against `npm run offseason`: about one feud a team, a few friendships). */
export const FEUD_BASE = 0.01;
export const FRIEND_BASE = 0.25;
export const SETTLE_BASE = 0.35;
const SD = 3.5;

const z = (x: number) => (x - TRAIT_MEAN) / SD;
const pairKey = (a: Player, b: Player) => (a.id < b.id ? `${a.id}:${b.id}` : `${b.id}:${a.id}`);

/** The habits a short fuse feeds at his position (`temper: true`). */
const temperHabits = (p: Player) => QUIRKS_FOR[p.position].filter((id) => (QUIRKS[id] as QuirkInfo).temper);

/** Leaders in a room calm it: each man the staff read as one (leadership a spread up) takes 15% off, to 40% at most. */
function leaderCalm(league: League, room: Player[]): number {
  const teamId = room[0]?.teamId;
  if (teamId === null || teamId === undefined) return 1;
  const leaders = room.filter((x) => z(characterRead(league, teamId, x)?.leads ?? TRAIT_MEAN) >= 1).length;
  return Math.max(0.4, 1 - 0.15 * leaders);
}

/** A position coach with the Patient Teacher habit keeps his room calmer. */
function teacherCalm(league: League, p: Player): number {
  if (p.teamId === null) return 1;
  const c = teamCoaches(league, p.teamId).find((x) => x.role === 'positionCoach' && x.room === ROOM_OF[p.position]);
  return c && activeCoachQuirks(c).includes('patientTeacher') ? 0.7 : 1;
}

/** A year's odds that two men in a room fall out: controversy and short fuses on either side, calmed by leaders. */
export function feudOdds(league: League, a: Player, b: Player, room: Player[]): number {
  const stir = 0.5 * (z(a.traits.controversy) + z(b.traits.controversy));
  const fuse = 0.4 * (z(temperamentOf(a)) + z(temperamentOf(b)));
  return FEUD_BASE * Math.exp(stir - fuse) * leaderCalm(league, room) * teacherCalm(league, a);
}

/** A feud begins: each man picks up a temper marble on top of the odds. */
function startFeud(league: League, a: Player, b: Player, why?: Tie['why']): void {
  if (!addTie(league, a, b, 'feud', why)) return;
  addMarbles(league, a, temperHabits(a));
  addMarbles(league, b, temperHabits(b));
}

/** Seasons two men have shared a position room (same club, same position, by `statTeams` and their moves). */
function seasonsTogether(a: Player, b: Player): number {
  let n = 0;
  for (const [season, clubs] of Object.entries(a.statTeams ?? {})) {
    const s = Number(season);
    const theirs = b.statTeams?.[s] ?? [];
    if (clubs.some((t) => theirs.includes(t)) && positionIn(a, s) === positionIn(b, s)) n++;
  }
  return n;
}

/** Was he benched last season: a starter the season before, a backup last season, with a full season played? */
function benched(league: League, p: Player): boolean {
  const last = league.season - 1;
  return (
    seasonRole(league, p, last - 1)?.role === 'starter' &&
    seasonRole(league, p, last)?.role === 'backup' &&
    (p.stats[last]?.gp ?? 0) >= 10
  );
}

/**
 * The new league year, once rosters are settled: feuds where the two no longer share a room end; the rest may settle
 * (likelier with calm tempers, leaders in the room, and time); then each room rolls for new feuds (a benching last
 * season triples the odds) and for friendships between men four seasons or more in it together.
 */
export function tiesOffseason(league: League): void {
  const season = league.season;
  for (const p of Object.values(league.players)) if (!p.retired && p.ties) endFeudsOutsideRoom(league, p);
  for (const team of league.teams) {
    const byPos = new Map<Position, Player[]>();
    for (const p of activeRoster(league, team.id)) byPos.set(p.position, [...(byPos.get(p.position) ?? []), p]);
    for (const room of byPos.values()) {
      const calm = leaderCalm(league, room);
      for (let i = 0; i < room.length; i++)
        for (let j = i + 1; j < room.length; j++) {
          const [a, b] = [room[i], room[j]];
          const rng = new Rng(`${league.seed}:ties:${season}:${pairKey(a, b)}`);
          const tie = a.ties?.find((t) => t.with === b.id);
          if (tie?.kind === 'feud') {
            const cool = Math.max(0, z(temperamentOf(a))) + Math.max(0, z(temperamentOf(b)));
            const settle = Math.min(
              0.9,
              SETTLE_BASE + 0.1 * cool + 0.05 * Math.round((1 - calm) / 0.15) + 0.1 * (season - tie.since),
            );
            if (rng.chance(settle)) endTie(league, a, b.id);
            continue;
          }
          const sat = benched(league, a) && seasonRole(league, b, season - 1)?.role === 'starter';
          const satB = benched(league, b) && seasonRole(league, a, season - 1)?.role === 'starter';
          const odds = feudOdds(league, a, b, room) * (sat || satB ? 3 : 1);
          if (rng.chance(odds)) {
            startFeud(league, sat ? a : b, sat ? b : a, sat || satB ? 'benched' : undefined);
            continue;
          }
          if (!tie && seasonsTogether(a, b) >= 4) {
            const friendly =
              FRIEND_BASE * (1 + 0.5 * ((a.personality.loyalty - 0.5) / 0.22 + (b.personality.loyalty - 0.5) / 0.22));
            if (rng.chance(Math.min(0.6, Math.max(0.05, friendly)))) addTie(league, a, b, 'friend');
          }
        }
    }
  }
}

/**
 * A man signs a new deal: a roommate who starts, still on an older deal and now paid less than him, may take it
 * personally (a feud at triple the odds, remembered as a snub).
 */
export function snubCheck(league: League, signed: Player): void {
  if (signed.teamId === null || !signed.contract) return;
  const team = league.teams[signed.teamId];
  const room = activeRoster(league, team.id).filter((x) => x.position === signed.position);
  for (const r of starters(league, team, signed.position)) {
    if (r.id === signed.id || !r.contract || r.contract.signedSeason >= league.season) continue;
    if (r.contract.apy >= signed.contract.apy || r.ties?.some((t) => t.with === signed.id)) continue;
    const rng = new Rng(`${league.seed}:ties:${league.season}:${pairKey(signed, r)}:snub`);
    if (rng.chance(3 * feudOdds(league, signed, r, room))) startFeud(league, r, signed, 'snubbed');
  }
}
