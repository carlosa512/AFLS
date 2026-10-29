/**
 * Morale: how a player feels about where he stands (docs/superpowers/specs/2026-10-29-morale-core-design.md).
 *
 * Each step a target is worked out from his contract, his role, his team's results, his locker room and (from G3) the
 * promises made to him, around a resting level his makeup sets; the stored level moves part of the way there, and big
 * moments (a benching, a raise, the C) jolt him on top and fade. Nothing here draws from a random stream: a mood is a
 * pure function of the league and its history, and in G1 nothing reads it but the screens.
 */
import { yearsLeft } from './finance/contract';
import { leagueMarket, marketApy, type Market } from './finance/market';
import { playerOvr, STARTERS } from './positions';
import { clamp } from './rng';
import { activeRoster } from './roster';
import { seasonRole } from './scouting';
import { computeRecords, playoffRace, type TeamRecord } from './season/standings';
import { temperamentOf, TRAIT_MEAN } from './traits';
import type { League, MoraleJolt, Player, Position } from './types';

const TRAIT_SD = 3.5;
const z = (v: number) => (v - TRAIT_MEAN) / TRAIT_SD;

export interface MoraleFactors {
  contract: number;
  role: number;
  team: number;
  room: number;
  promises: number;
  rest: number;
}

/** What one pass over the league reads once, not once per player. */
export interface MoraleContext {
  season: number;
  market: Market;
  /** This season's records. */
  records: Map<number, TeamRecord>;
  /** Last season's win share by team (absent before the league's first season). */
  lastShare: Map<number, number>;
  /** Each club's position rooms on the 53: overalls, best first (`teamId:position`). */
  rooms: Map<string, number[]>;
  /** A league-average starter's scrimmage snaps at each position this season. */
  live: Partial<Record<Position, number>>;
  /** Players mentoring a teammate. */
  mentors: Set<number>;
}

const games = (r: { w: number; l: number; t: number } | undefined) => (r ? r.w + r.l + r.t : 0);
const share = (r: { w: number; l: number; t: number }) => (r.w + r.t / 2) / Math.max(1, games(r));

export function moraleContext(league: League): MoraleContext {
  const season = league.season;
  const lastShare = new Map<number, number>();
  const last = computeRecords(league, season - 1);
  const summary = league.history.find((h) => h.season === season - 1);
  for (const t of league.teams) {
    const r = games(last.get(t.id)) ? last.get(t.id) : summary?.records[t.id];
    if (r && games(r)) lastShare.set(t.id, share(r));
  }
  const rooms = new Map<string, number[]>();
  const mentors = new Set<number>();
  for (const t of league.teams)
    for (const p of activeRoster(league, t.id)) {
      const key = `${t.id}:${p.position}`;
      const room = rooms.get(key) ?? [];
      room.push(playerOvr(p));
      rooms.set(key, room);
    }
  for (const room of rooms.values()) room.sort((a, b) => b - a);
  const snaps: Partial<Record<Position, number[]>> = {};
  for (const p of Object.values(league.players)) {
    if (p.teamId !== null && p.mentor !== undefined) {
      const m = league.players[p.mentor];
      if (m?.teamId === p.teamId) mentors.add(m.id);
    }
    const s = p.stats[season]?.snaps;
    if (s) (snaps[p.position] ??= []).push(s);
  }
  // The league's starting-sized group by snaps, averaged: the same yardstick `seasonRole` uses for a finished season
  // (its live table is built once a season, so the season being played is read fresh here).
  const live: MoraleContext['live'] = {};
  for (const [pos, list] of Object.entries(snaps) as [Position, number[]][]) {
    const group = list.sort((a, b) => b - a).slice(0, league.teams.length * STARTERS[pos]);
    if (group.length >= 8) live[pos] = group.reduce((t, s) => t + s, 0) / group.length;
  }
  return {
    season,
    market: leagueMarket(league),
    records: computeRecords(league, season),
    lastShare,
    rooms,
    live,
    mentors,
  };
}

/** 2 starter, 1 rotation, 0 backup or didn't play. */
const ROLE_STEP = { starter: 2, rotation: 1, backup: 0 } as const;
const roleStep = (share: number) => (share >= 0.6 ? 2 : share >= 0.2 ? 1 : 0);

/** The role he expects: his standing in his room on the 53 by his own true overall, a step less as a rookie. */
export function expectedRole(p: Player, ctx: MoraleContext): number {
  if (p.teamId === null) return 0;
  const room = ctx.rooms.get(`${p.teamId}:${p.position}`) ?? [];
  const ovr = playerOvr(p);
  const rank = room.filter((o) => o > ovr + 1e-9).length;
  const n = STARTERS[p.position];
  const step = rank < n ? 2 : rank < Math.ceil(1.5 * n) ? 1 : 0;
  return Math.max(0, step - (p.experience === 0 ? 1 : 0));
}

/** The role he is playing: this season's snaps once his club has three games in, else last season's (null: no read). */
export function actualRole(league: League, p: Player, ctx: MoraleContext): number | null {
  if (p.teamId === null) return null;
  const played = games(ctx.records.get(p.teamId));
  if (played >= 3) {
    // Hurt, he isn't being kept off the field: no grievance to read.
    if (p.injury || p.ir) return null;
    const s = p.stats[ctx.season];
    const kicker = p.position === 'K' || p.position === 'P';
    if (kicker) return roleStep((s?.gp ?? 0) / played);
    const ref = ctx.live[p.position];
    return ref ? roleStep((s?.snaps ?? 0) / ref) : null;
  }
  if (!p.stats[ctx.season - 1]) return null;
  const last = seasonRole(league, p, ctx.season - 1);
  return last ? ROLE_STEP[last.role] : 0;
}

function contractScore(league: League, p: Player, ctx: MoraleContext): number {
  const c = p.contract;
  if (!c || p.teamId === null) return 0;
  const ratio = c.apy / Math.max(1, marketApy(ctx.market, p));
  let score = clamp(3 * Math.log2(ratio) * (0.6 + 0.8 * p.personality.greed), -4, 2);
  if (score < 0 && yearsLeft(c, league.season) <= 1) score = Math.max(-4, score * 1.5);
  // A rookie deal is what it is until the extension window opens in his third season.
  if (c.kind === 'rookie' && p.experience < 3) score = Math.max(0, score);
  return score;
}

function roleScore(league: League, p: Player, ctx: MoraleContext): number {
  const expected = expectedRole(p, ctx);
  const actual = actualRole(league, p, ctx) ?? expected;
  return clamp(1.5 * (actual - expected) * (p.experience >= 6 ? 1.3 : 1), -3, 1.5);
}

function teamScore(p: Player, ctx: MoraleContext): number {
  if (p.teamId === null) return 0;
  const now = ctx.records.get(p.teamId);
  const s = now && games(now) >= 4 ? share(now) : (ctx.lastShare.get(p.teamId) ?? 0.5);
  return clamp((s - 0.5) * 4 * (0.5 + p.personality.winning), -2, 2);
}

/** Whether he is one of his club's captains this season. */
export function isCaptain(league: League, p: Player): boolean {
  if (p.teamId === null) return false;
  const c = league.teams[p.teamId].captains;
  return c?.season === league.season && (c.offense === p.id || c.defense === p.id || c.specialTeams === p.id);
}

function roomScore(league: League, p: Player, ctx: MoraleContext): number {
  if (p.teamId === null) return 0;
  let friends = 0;
  let feud = false;
  for (const t of p.ties ?? []) {
    if (league.players[t.with]?.teamId !== p.teamId) continue;
    if (t.kind === 'friend') friends++;
    else feud = true;
  }
  const score =
    Math.min(1, 0.5 * friends) -
    (feud ? 1 : 0) +
    (isCaptain(league, p) ? 0.75 : 0) +
    (ctx.mentors.has(p.id) ? 0.25 : 0);
  return clamp(score, -1.5, 1.5);
}

/** A calm, patient, loyal man rests above Okay; a volatile, impatient one below. */
function restScore(p: Player): number {
  const { patience, loyalty } = p.personality;
  return 1.5 * clamp(0.4 * z(temperamentOf(p)) + (patience - 0.5) + 0.6 * (loyalty - 0.5), -1, 1);
}

export function moraleFactors(league: League, p: Player, ctx = moraleContext(league)): MoraleFactors {
  return {
    contract: contractScore(league, p, ctx),
    role: roleScore(league, p, ctx),
    team: teamScore(p, ctx),
    room: roomScore(league, p, ctx),
    promises: 0,
    rest: restScore(p),
  };
}

export function moraleTarget(f: MoraleFactors): number {
  return clamp(f.contract + f.role + f.team + f.room + f.promises + f.rest, -10, 10);
}

// ───────── the clock and the jolts ─────────

/** Morale steps in a league year: the offseason's calendar steps, then camp, then each week played. */
const YEAR = 32;
const REGULAR = 8;

/**
 * Where the league year stands on morale's clock, counting each offseason step as one week: the re-sign window 0,
 * free-agency days 1–5, the draft 6, camp 7, then each week played (`played`: the week now being finished).
 */
export function moraleClock(league: League, played = false): number {
  const step =
    league.phase === 'resign'
      ? 0
      : league.phase === 'freeAgency'
        ? league.faDay
        : league.phase === 'draft'
          ? 6
          : league.phase === 'preseason'
            ? 7
            : league.phase === 'complete'
              ? YEAR - 1
              : Math.min(YEAR - 1, REGULAR + league.week - (played ? 0 : 1));
  return league.season * YEAR + step;
}

type Jolt = NonNullable<Player['morale']>['jolts'][number];

/** What's left of a jolt: it halves every two weeks. */
export function liveSize(j: Jolt, clock: number): number {
  const since = Math.max(0, clock - (j.season * YEAR + j.week));
  return j.size * 0.5 ** (since / 2);
}

/** His mood as the words read it: the slow level plus what's left of his jolts. */
export function moraleLevel(league: League, p: Player, clock = league.moraleAt ?? moraleClock(league)): number {
  const m = p.morale;
  if (!m) return 0;
  return clamp(m.level + m.jolts.reduce((t, j) => t + liveSize(j, clock), 0), -10, 10);
}

// ───────── words ─────────

export type MoraleStep = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export const MORALE_WORDS: Record<MoraleStep, string> = {
  1: 'Abysmal',
  2: 'Very poor',
  3: 'Poor',
  4: 'Okay',
  5: 'Good',
  6: 'Very good',
  7: 'Superb',
};

export function moraleStepOf(level: number): MoraleStep {
  return level >= 6 ? 7 : level >= 3 ? 6 : level >= 1 ? 5 : level > -1 ? 4 : level > -3 ? 3 : level > -6 ? 2 : 1;
}

const FACTOR_WORDS: Record<Exclude<keyof MoraleFactors, 'rest' | 'promises'>, [string, string]> = {
  contract: ['Wants a new deal', 'Happy with his deal'],
  role: ['Wants more snaps', 'Enjoying his role'],
  team: ['The losing is wearing on him', 'Loving the winning'],
  room: ['A feud in the room', 'Close with his teammates'],
};

const JOLT_WORDS: Record<MoraleJolt, string> = {
  benched: 'Still stung by the benching',
  snubbed: 'Noticed who got paid',
  friendGone: 'Misses a friend who left',
  paid: 'Just got paid',
  captain: 'Proud to wear the C',
  playoffs: 'Fired up for the playoffs',
};

/** Why he feels the way he does: up to three plain phrases, the biggest first. */
export function moraleReasons(
  league: League,
  p: Player,
  f: MoraleFactors,
  clock = league.moraleAt ?? moraleClock(league),
): string[] {
  const out: { text: string; size: number }[] = [];
  for (const [k, [down, up]] of Object.entries(FACTOR_WORDS) as [keyof typeof FACTOR_WORDS, [string, string]][])
    if (Math.abs(f[k]) >= 0.75) out.push({ text: f[k] < 0 ? down : up, size: Math.abs(f[k]) });
  for (const j of p.morale?.jolts ?? []) {
    const size = Math.abs(liveSize(j, clock));
    if (size >= 0.75 && !out.some((o) => o.text === JOLT_WORDS[j.kind])) out.push({ text: JOLT_WORDS[j.kind], size });
  }
  return out
    .sort((a, b) => b.size - a.size)
    .slice(0, 3)
    .map((o) => o.text);
}

// ───────── what a screen sees ─────────

export interface MoraleView {
  step: MoraleStep;
  word: string;
  reasons: string[];
  /** For sorting only: never shown. */
  level: number;
}

const viewCache = new WeakMap<League, { key: string; ctx: MoraleContext }>();

/** Your own players' mood in words, or null for anyone else's (the fog of war) and for a man with no mood yet. */
export function moraleView(league: League, p: Player): MoraleView | null {
  if (p.teamId !== league.userTeamId || !p.morale) return null;
  const key = `${league.season}:${league.phase}:${league.week}:${league.faDay}:${league.moraleAt}`;
  let hit = viewCache.get(league);
  if (!hit || hit.key !== key) viewCache.set(league, (hit = { key, ctx: moraleContext(league) }));
  const level = moraleLevel(league, p);
  const step = moraleStepOf(level);
  return {
    step,
    word: MORALE_WORDS[step],
    reasons: moraleReasons(league, p, moraleFactors(league, p, hit.ctx)),
    level,
  };
}

// ───────── the step ─────────

// `|| 0`: no −0 in the save (it reads back as 0, and a copy should equal its original).
const round = (v: number) => Math.round(v * 1000) / 1000 || 0;

/** How far a week moves him toward his target: volatile men swing faster. */
const rateOf = (p: Player) => clamp(0.25 - 0.05 * z(temperamentOf(p)), 0.15, 0.4);

/** Every rostered player at his target with no jolts: a new league, or a save from before morale. */
export function seedMorale(league: League): void {
  const ctx = moraleContext(league);
  for (const p of Object.values(league.players))
    if (p.teamId !== null && !p.retired && !p.morale)
      p.morale = { level: round(moraleTarget(moraleFactors(league, p, ctx))), jolts: [] };
  league.moraleAt = moraleClock(league);
}

/** The big moments since his last step, each felt once a league year (`seen`). */
function newJolts(league: League, p: Player, ctx: MoraleContext, week: number, spot: (teamId: number) => boolean) {
  const m = p.morale!;
  const season = league.season;
  const seen = (m.seen ??= []);
  const out: Jolt[] = [];
  const add = (key: string, kind: MoraleJolt, size: number) => {
    const k = `${season}:${key}`;
    if (seen.includes(k)) return;
    seen.push(k);
    out.push({ kind, size: Math.round(size * 100) / 100, season, week });
  };
  const teamId = p.teamId!;
  const wasStarter = () => !!p.stats[season - 1] && seasonRole(league, p, season - 1)?.role === 'starter';
  // Benched: a starter last season who isn't one now, by his snaps once his club has three games in (while he's been
  // dressing), or at the new league year when his room has passed him.
  const played = games(ctx.records.get(teamId));
  if (played >= 3 && (p.stats[season]?.gp ?? 0) >= played - 1) {
    const now = actualRole(league, p, ctx);
    if (now !== null && now < 2 && wasStarter()) add('benched', 'benched', -3);
  } else if (week === 0 && expectedRole(p, ctx) < 2 && wasStarter()) add('benched', 'benched', -3);
  for (const t of p.ties ?? []) {
    const b = league.players[t.with];
    if (!b) continue;
    // Snubbed: a roommate on a bigger new deal, the feud `relationships.ts` remembers; the lower-paid side feels it.
    if (
      t.kind === 'feud' &&
      t.why === 'snubbed' &&
      t.since === season &&
      b.teamId === teamId &&
      (p.contract?.apy ?? 0) < (b.contract?.apy ?? 0)
    )
      add(`snub:${b.id}`, 'snubbed', -2 * (0.5 + p.personality.greed));
    // A friend cut or traded away from this club this league year: the one left behind feels it.
    if (
      t.kind === 'friend' &&
      b.teamId !== teamId &&
      b.left?.some((d) => d.teamId === teamId && d.season === season && d.how !== 'walked')
    )
      add(`gone:${b.id}`, 'friendGone', -2);
  }
  const c = p.contract;
  if (c && c.signedSeason === season && m.apy !== undefined && c.apy > m.apy) add('paid', 'paid', 3);
  if (isCaptain(league, p)) add('captain', 'captain', 2);
  if (league.phase === 'regular' && spot(teamId)) add('playoffs', 'playoffs', 2);
  return out;
}

/**
 * One step of the league's moods at a point on morale's clock: new jolts, old ones faded (the four biggest kept), and
 * the level moved part of the way to its target. A step already taken (`moraleAt`) is not taken again.
 */
export function moraleAdvance(league: League, clock: number): void {
  if (league.moraleAt !== undefined && clock <= league.moraleAt) return;
  league.moraleAt = clock;
  const ctx = moraleContext(league);
  const prospects = new Set(league.draftClass);
  const week = clock - league.season * YEAR;
  const spots = new Map<number, boolean>();
  const spot = (teamId: number) => {
    if (!spots.has(teamId)) spots.set(teamId, playoffRace(league, teamId).spot);
    return spots.get(teamId)!;
  };
  for (const p of Object.values(league.players)) {
    if (p.retired || prospects.has(p.id)) {
      delete p.morale;
      continue;
    }
    if (p.teamId === null) {
      // A free agent wants a job, and carries nothing else with him.
      if (!p.morale) continue;
      p.morale.jolts = [];
      p.morale.level = round(p.morale.level + rateOf(p) * (-1 - p.morale.level));
      continue;
    }
    const target = moraleTarget(moraleFactors(league, p, ctx));
    // A new arrival (a draft pick, a first deal) starts where he stands.
    const m = (p.morale ??= { level: round(target), jolts: [] });
    if (m.seen) m.seen = m.seen.filter((k) => k.startsWith(`${league.season}:`));
    m.jolts.push(...newJolts(league, p, ctx, week, spot));
    const live = m.jolts
      .map((j) => ({ j, size: Math.abs(liveSize(j, clock)) }))
      .filter((x) => x.size >= 0.25)
      .sort((a, b) => b.size - a.size)
      .slice(0, 4)
      .map((x) => x.j);
    m.jolts = m.jolts.filter((j) => live.includes(j));
    if (!m.seen?.length) delete m.seen;
    m.level = round(m.level + rateOf(p) * (target - m.level));
    if (p.contract) m.apy = p.contract.apy;
  }
}

/** A regular-season or playoff week, after its games. */
export const moraleWeek = (league: League) => moraleAdvance(league, moraleClock(league, true));

/** An offseason calendar step (the new league year, each free-agency day, the draft, camp), after it has run. */
export const moraleStep = (league: League) => moraleAdvance(league, moraleClock(league));
