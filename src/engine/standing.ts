/**
 * Who the room listens to (docs/superpowers/specs/2026-11-01-locker-room-voices-design.md). A man's weight is how far
 * his word carries: his leadership, whether he plays, how long he's been around and here, and what he's won. Weight
 * makes him a leader, a voice, or one of the quiet majority; how he sounds (he stirs, he steadies) is his makeup.
 * Units are the position coaches' rooms plus the specialists. Nothing here is stored: it is all worked out on the
 * spot from what the league already holds, and nothing here draws from a random stream.
 *
 * `morale.ts` and this module import each other: each uses the other's exports only inside function bodies.
 */
import { ROOM_LABEL, ROOM_OF } from './coaching';
import { leadFactor } from './mentoring';
import {
  actualRole,
  isCaptain,
  MORALE_WORDS,
  moodLean,
  moraleLevel,
  moraleStepOf,
  moraleView,
  TEMPERAMENT_REASONS,
  viewContext,
  type MoraleContext,
} from './morale';
import { activeRoster, starters } from './roster';
import { seasonRole } from './scouting';
import { temperamentOf, TRAIT_MEAN } from './traits';
import type { CoachRoom, League, Player, Position } from './types';

export type Unit = CoachRoom | 'ST';
/** Spelled out, not spread from `COACH_ROOMS`: a top-level read of another module breaks on an import cycle. */
export const UNITS: readonly Unit[] = ['QB', 'RB', 'WR', 'OL', 'DL', 'LB', 'DB', 'ST'];
export type Side = 'offense' | 'defense' | 'specialTeams';

export const unitOf = (pos: Position): Unit => ROOM_OF[pos] ?? 'ST';
export const sideOf = (unit: Unit): Side =>
  unit === 'ST' ? 'specialTeams' : unit === 'DL' || unit === 'LB' || unit === 'DB' ? 'defense' : 'offense';

export type Tier = 'leader' | 'voice';
export type Sound = 'stirs' | 'steadies';

/** Weight at which the room goes to him, and at which his word carries. */
export const LEADER_AT = 1.25;
export const VOICE_AT = 0.85;

const TRAIT_SD = 3.5;
const z = (v: number) => (v - TRAIT_MEAN) / TRAIT_SD;

/** Everyone with a season award or an All-League team since `season`. */
export function honouredSince(league: League, season: number): Set<number> {
  const out = new Set<number>();
  for (const a of league.awards ?? []) {
    if (a.season < season) continue;
    for (const w of Object.values(a.winners)) if (w) out.add(w.playerId);
    for (const team of a.allLeague) for (const w of team) out.add(w.playerId);
  }
  return out;
}

/**
 * Years in the league: a rookie's word counts for little, a four-year man's in full, a long-time veteran's a little
 * more. A newcomer to the club has to earn the room first.
 */
export function seniority(experience: number, newcomer: boolean): number {
  const years = experience <= 4 ? 0.6 + 0.1 * Math.max(0, experience) : Math.min(1.15, 1 + 0.0375 * (experience - 4));
  return years * (newcomer ? 0.8 : 1);
}

/** In his first league year at this club: no earlier season with it, and not one of its own draft picks. */
export function isNewcomer(league: League, p: Player): boolean {
  if (p.teamId === null) return false;
  if (p.draft?.teamId === p.teamId) return false;
  for (const [season, teams] of Object.entries(p.statTeams ?? {}))
    if (Number(season) < league.season && teams.includes(p.teamId)) return false;
  return true;
}

const FIELD: Record<number, number> = { 2: 1, 1: 0.7, 0: 0.4 };
const ROLE_STEP = { starter: 2, rotation: 1, backup: 0 } as const;

/** How far his word carries in the room. True traits, as mentoring reads them; a screen only ever sees words. */
export function weightOf(league: League, p: Player, ctx: MoraleContext): number {
  if (p.teamId === null) return 0;
  // The role morale's grievance reads; hurt in season (null), last season's role; with no snaps to read at all (a new
  // league, a rookie), the depth chart.
  const team = league.teams[p.teamId];
  const last = seasonRole(league, p, ctx.season - 1);
  const role =
    actualRole(league, p, ctx) ??
    (last ? ROLE_STEP[last.role] : starters(league, team, p.position).some((s) => s.id === p.id) ? 2 : 0);
  let stature = ctx.honoured.has(p.id) ? 1.2 : 1;
  if (p.position === 'QB' && starters(league, team, 'QB')[0]?.id === p.id) stature *= 1.15;
  return leadFactor(p.traits.leads) * FIELD[role] * seniority(p.experience, isNewcomer(league, p)) * stature;
}

/** A captain always leads; otherwise his weight decides. */
export function tierOf(league: League, p: Player, weight: number): Tier | null {
  if (isCaptain(league, p)) return 'leader';
  return weight >= LEADER_AT ? 'leader' : weight >= VOICE_AT ? 'voice' : null;
}

/** How his mood travels: a man who stirs says it out loud; a calm leader keeps a bad week to himself. */
export function soundOf(p: Player): Sound | null {
  if (z(p.traits.controversy) >= 1) return 'stirs';
  if (z(p.traits.leads) >= 1 && z(temperamentOf(p)) >= 0.5) return 'steadies';
  return null;
}

// ───────── a voice's mood rubs off on his unit ─────────

/** A leader or voice as one pass of the league reads him. */
export interface VoiceRef {
  id: number;
  weight: number;
  sound: Sound | null;
}

/** The pull's size (spec §2.1): its share of the room score, the floor under the weights, friends' moods. */
export const TONE = { weight: 0.5, floor: 2.0, friend: 0.15, friends: 2 };

/** Each club's leaders and voices by unit, and each side's captain, for one pass over the league. */
export function roomVoices(
  league: League,
  ctx: MoraleContext,
): { voices: Map<string, VoiceRef[]>; sideCaptains: Map<string, VoiceRef> } {
  const voices = new Map<string, VoiceRef[]>();
  const sideCaptains = new Map<string, VoiceRef>();
  for (const team of league.teams) {
    const c = team.captains?.season === league.season ? team.captains : undefined;
    const captainOf = new Map<number, Side>(
      c
        ? [
            [c.offense, 'offense'],
            [c.defense, 'defense'],
            [c.specialTeams, 'specialTeams'],
          ]
        : [],
    );
    for (const p of activeRoster(league, team.id)) {
      const weight = weightOf(league, p, ctx);
      if (!tierOf(league, p, weight)) continue;
      const ref: VoiceRef = { id: p.id, weight, sound: soundOf(p) };
      const key = `${team.id}:${unitOf(p.position)}`;
      (voices.get(key) ?? voices.set(key, []).get(key)!).push(ref);
      const side = captainOf.get(p.id);
      if (side) sideCaptains.set(`${team.id}:${side}`, ref);
    }
  }
  return { voices, sideCaptains };
}

/** How far his mood travels: a stirrer's bad mood half again as far and his good one a quarter less; a steady man's bad mood half as far. */
export function loudness(sound: Sound | null, lean: number): number {
  if (sound === 'stirs') return lean < 0 ? 1.5 : 0.75;
  if (sound === 'steadies' && lean < 0) return 0.5;
  return 1;
}

/** The pull of the voices around him on his room: his unit's leaders and voices and his side's captain, never himself. */
export function toneOf(p: Player, ctx: MoraleContext): number {
  if (p.teamId === null) return 0;
  const unit = unitOf(p.position);
  const around = [...(ctx.voices.get(`${p.teamId}:${unit}`) ?? [])];
  const captain = ctx.sideCaptains.get(`${p.teamId}:${sideOf(unit)}`);
  if (captain && !around.some((v) => v.id === captain.id)) around.push(captain);
  let sum = 0;
  let weights = 0;
  for (const v of around) {
    if (v.id === p.id) continue;
    const lean = ctx.leans.get(v.id) ?? 0;
    sum += v.weight * loudness(v.sound, lean) * lean;
    weights += v.weight;
  }
  if (!weights) return 0;
  return Math.max(-1, Math.min(1, sum / Math.max(weights, TONE.floor)));
}

/** A friend's mood rubs off too: his first two friends at the club. */
export function friendLean(league: League, p: Player, ctx: MoraleContext): number {
  let out = 0;
  let n = 0;
  for (const t of p.ties ?? []) {
    if (n >= TONE.friends) break;
    if (t.kind !== 'friend' || league.players[t.with]?.teamId !== p.teamId) continue;
    out += TONE.friend * (ctx.leans.get(t.with) ?? 0);
    n++;
  }
  return out;
}

// ───────── who the room follows ─────────

function byTier(league: League, teamId: number, want: Tier, ctx = viewContext(league)): Player[] {
  return activeRoster(league, teamId)
    .map((p) => ({ p, w: weightOf(league, p, ctx) }))
    .filter((x) => tierOf(league, x.p, x.w) === want && !(want === 'leader' && isCaptain(league, x.p)))
    .sort((a, b) => b.w - a.w || a.p.id - b.p.id)
    .map((x) => x.p);
}

/** The leaders past the captains, heaviest first. */
export const leadersOf = (league: League, teamId: number): Player[] => byTier(league, teamId, 'leader');
export const voicesOf = (league: League, teamId: number): Player[] => byTier(league, teamId, 'voice');

// ───────── a unit's read ─────────

export type UnitWord = 'Tight' | 'Settled' | 'Restless' | 'Down' | 'Split';
/** A unit is split when this share of its weight sits at Good or better and this share at Poor or worse. */
export const SPLIT_SHARE = 0.3;
/** Fewer men than this and a room has no read of its own (a two-man quarterback room). */
export const READ_MIN = 3;
/** A quiet man still counts in his unit's read. */
const READ_FLOOR = 0.3;
/** A lean this far either side of Okay is a pull one way. */
const PULL_AT = 0.17;

export interface UnitRead {
  teamId: number;
  unit: Unit;
  word: UnitWord;
  members: number[];
  /** Who sets the tone: the unit's heaviest leader or voice, else its side's captain. */
  setter: number | null;
  pulling: 'up' | 'down' | 'even' | null;
  /** No leader or voice of its own (its side's captain is elsewhere, or there is none). */
  noVoice: boolean;
}

const pullOf = (lean: number) => (lean >= PULL_AT ? 'up' : lean <= -PULL_AT ? 'down' : 'even');

/** How one unit is feeling: its men's moods, the voices counting more. Null for the specialists and a tiny room. */
export function unitRead(league: League, teamId: number, unit: Unit, ctx: MoraleContext): UnitRead | null {
  if (unit === 'ST') return null;
  const men = activeRoster(league, teamId).filter((p) => unitOf(p.position) === unit);
  if (men.length < READ_MIN) return null;
  let total = 0;
  let sum = 0;
  let up = 0;
  let down = 0;
  let setter: { p: Player; w: number } | null = null;
  for (const p of men) {
    const weight = weightOf(league, p, ctx);
    const w = Math.max(weight, READ_FLOOR);
    const level = moraleLevel(league, p);
    const step = moraleStepOf(level);
    total += w;
    sum += w * level;
    if (step >= 5) up += w;
    if (step <= 3) down += w;
    if (tierOf(league, p, weight) && (!setter || weight > setter.w || (weight === setter.w && p.id < setter.p.id)))
      setter = { p, w: weight };
  }
  const noVoice = !setter;
  const captain = ctx.sideCaptains.get(`${teamId}:${sideOf(unit)}`);
  const lead = setter?.p ?? (captain ? league.players[captain.id] : undefined);
  const mean = moraleStepOf(sum / total);
  const word: UnitWord =
    up / total >= SPLIT_SHARE && down / total >= SPLIT_SHARE
      ? 'Split'
      : mean >= 5
        ? 'Tight'
        : mean === 4
          ? 'Settled'
          : mean === 3
            ? 'Restless'
            : 'Down';
  return {
    teamId,
    unit,
    word,
    members: men.map((p) => p.id),
    setter: lead?.id ?? null,
    pulling: lead ? pullOf(moodLean(moraleLevel(league, lead))) : null,
    noVoice,
  };
}

/** Every read unit of a club, in `UNITS` order. */
export function unitReads(league: League, teamId: number, ctx: MoraleContext): UnitRead[] {
  return UNITS.flatMap((u) => unitRead(league, teamId, u, ctx) ?? []);
}

// ───────── your club, in words ─────────

/** The parts of his weight a coach would name, biggest first. */
export type WhyPart = 'captain' | 'quarterback' | 'veteran' | 'starts' | 'honoured' | 'leads' | 'newcomer';

export interface StandingView {
  tier: Tier | null;
  sound: Sound | null;
  parts: WhyPart[];
}

/** Where one of your players stands in the room, or null for anyone else's (the fog of war). */
export function standingView(league: League, p: Player, ctx = viewContext(league)): StandingView | null {
  if (p.teamId !== league.userTeamId) return null;
  const tier = tierOf(league, p, weightOf(league, p, ctx));
  const team = league.teams[p.teamId];
  const parts: WhyPart[] = [];
  if (isCaptain(league, p)) parts.push('captain');
  if (p.position === 'QB' && starters(league, team, 'QB')[0]?.id === p.id) parts.push('quarterback');
  if (p.experience >= 6) parts.push('veteran');
  if (actualRole(league, p, ctx) === 2 || starters(league, team, p.position).some((s) => s.id === p.id))
    parts.push('starts');
  if (ctx.honoured.has(p.id)) parts.push('honoured');
  if (z(p.traits.leads) >= 1) parts.push('leads');
  if (isNewcomer(league, p)) parts.push('newcomer');
  return { tier, sound: soundOf(p), parts };
}

export interface UnitView extends Omit<UnitRead, 'teamId' | 'members'> {
  label: string;
  members: number;
  /** What the unit is feeling, most-felt first: the mood board's phrases, with how many feel each. */
  reasons: { text: string; count: number }[];
}

export interface RoomView {
  /** The room's mood: the 53's, the voices counting more. */
  word: string;
  units: UnitView[];
  /** Leaders past the captains, and voices, heaviest first. */
  leaders: number[];
  voices: number[];
  /** The vets and the young guys two mood steps or more apart, and which of them is down. */
  apart: 'young down' | 'vets down' | null;
}

/** Your room as your staff see it: every read unit, who it follows, and its shape. Words and ids only. */
export function roomView(league: League, ctx = viewContext(league)): RoomView {
  const teamId = league.userTeamId;
  const units = unitReads(league, teamId, ctx).map((r): UnitView => {
    const counts = new Map<string, number>();
    for (const id of r.members)
      for (const text of moraleView(league, league.players[id], ctx)?.reasons ?? [])
        if (!TEMPERAMENT_REASONS.has(text)) counts.set(text, (counts.get(text) ?? 0) + 1);
    const reasons = [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 2)
      .map(([text, count]) => ({ text, count }));
    const { teamId: _t, members, ...rest } = r;
    return { ...rest, label: ROOM_LABEL[r.unit as CoachRoom], members: members.length, reasons };
  });
  const mean = (ps: Player[]) => {
    let t = 0;
    let s = 0;
    for (const p of ps) {
      const w = Math.max(weightOf(league, p, ctx), READ_FLOOR);
      t += w;
      s += w * moraleLevel(league, p);
    }
    return t ? s / t : 0;
  };
  const roster = activeRoster(league, teamId);
  const vets = roster.filter((p) => p.experience >= 6);
  const young = roster.filter((p) => p.experience <= 2);
  let apart: RoomView['apart'] = null;
  if (vets.length && young.length) {
    const gap = moraleStepOf(mean(vets)) - moraleStepOf(mean(young));
    apart = gap >= 2 ? 'young down' : gap <= -2 ? 'vets down' : null;
  }
  return {
    word: MORALE_WORDS[moraleStepOf(mean(roster))],
    units,
    leaders: byTier(league, teamId, 'leader', ctx).map((p) => p.id),
    voices: byTier(league, teamId, 'voice', ctx).map((p) => p.id),
    apart,
  };
}
