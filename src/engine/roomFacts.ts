/**
 * The facts a line about the room may read (`roomVoice.ts`), built from your club only: names, flags and the words
 * our staff use. What the report and the staff notes told before is read back from their `covered` keys, stamped
 * with morale's clock, so the two speak from one memory.
 */
import { moraleLevel, moraleStepOf, viewContext } from './morale';
import { personalityRead, personalityTone } from './personality';
import { starters } from './roster';
import {
  causeOf,
  countOf,
  SPECIALISTS,
  UNIT_PHRASE,
  type StandingFact,
  type UnitFact,
  type WhyFact,
} from './roomVoice';
import {
  isNewcomer,
  leadsAsCaptain,
  soundOf,
  standingView,
  unitOf,
  unitRead,
  VOICE_AT,
  weightOf,
  type StandingView,
  type Tier,
  type Unit,
  type UnitView,
  type UnitWord,
} from './standing';
import type { League, Player } from './types';

/** Memory keys name the club: a GM hired across the league starts with none of his old club's rooms. */
const UNIT_KEY = /^unit:(\d+):(\d+):(\w+):(\w+)$/;
const STANDING_KEY = /^standing:(\d+):(\d+):(\d+):(leader|voice)$/;
export const unitKey = (clock: number, teamId: number, unit: Unit, word: UnitWord) =>
  `unit:${clock}:${teamId}:${unit}:${word}`;
export const standingKey = (clock: number, teamId: number, playerId: number, tier: Tier) =>
  `standing:${clock}:${teamId}:${playerId}:${tier}`;

/** The latest told read of each of `teamId`'s units, and its leaders and voices at the latest report. */
export function lastTold(
  told: Set<string>,
  teamId: number,
): {
  units: Map<Unit, { word: UnitWord; clock: number }>;
  standing: { clock: number; tiers: Map<number, Tier> } | null;
} {
  const units = new Map<Unit, { word: UnitWord; clock: number }>();
  let standing: { clock: number; tiers: Map<number, Tier> } | null = null;
  for (const k of told) {
    const u = k.match(UNIT_KEY);
    if (u) {
      if (Number(u[2]) !== teamId) continue;
      const clock = Number(u[1]);
      const have = units.get(u[3] as Unit);
      if (!have || clock >= have.clock) units.set(u[3] as Unit, { word: u[4] as UnitWord, clock });
      continue;
    }
    const s = k.match(STANDING_KEY);
    if (!s || Number(s[2]) !== teamId) continue;
    const clock = Number(s[1]);
    if (!standing || clock > standing.clock) standing = { clock, tiers: new Map() };
    if (clock === standing.clock) standing.tiers.set(Number(s[3]), s[4] as Tier);
  }
  return { units, standing };
}

const phraseOf = (unit: Unit) => (unit === 'ST' ? SPECIALISTS : UNIT_PHRASE[unit]);

/** What a line about one of your units may read. `gone`: a leader of this unit who has since left the club. */
export function unitFact(
  league: League,
  view: UnitView,
  last: { word: UnitWord } | null,
  gone: string | null,
  ctx = viewContext(league),
): UnitFact {
  const teamId = league.userTeamId;
  const team = league.teams[teamId];
  const unit = phraseOf(view.unit);
  const setter = view.setter === null ? undefined : league.players[view.setter];
  const grievance = view.reasons.find((r) => causeOf(r.text));
  const cause = grievance ? causeOf(grievance.text) : null;
  const read = unitRead(league, teamId, view.unit, ctx);
  const men = (read?.members ?? []).map((id) => league.players[id]);

  // Split: is the happy side mostly the young guys (their first three seasons)?
  let upYoung = false;
  if (view.word === 'Split') {
    let up = 0;
    let young = 0;
    for (const p of men)
      if (moraleStepOf(moraleLevel(league, p)) >= 5) {
        const w = Math.max(weightOf(league, p, ctx), 0.3);
        up += w;
        if (p.experience <= 2) young += w;
      }
    upYoung = up > 0 && young / up >= 0.5;
  }

  // Down over snaps and not starting: the man whose job he wants.
  let rival: string | null = null;
  if (setter && view.pulling === 'down' && cause === 'snaps') {
    const ahead = starters(league, team, setter.position);
    if (!ahead.some((p) => p.id === setter.id)) rival = ahead[0]?.lastName ?? null;
  }

  // No voice: a young man close to finding his.
  let nearVoice: string | null = null;
  if (view.noVoice) {
    const near = men
      .filter((p) => p.experience <= 2)
      .map((p) => ({ p, w: weightOf(league, p, ctx) }))
      .filter((x) => x.w >= VOICE_AT - 0.1)
      .sort((a, b) => b.w - a.w || a.p.id - b.p.id)[0];
    nearVoice = near?.p.lastName ?? null;
  }

  const streak = ctx.records.get(teamId)?.streak.match(/^L(\d+)$/);
  return {
    unit,
    word: view.word,
    still: !!last && last.word === view.word,
    turned: !!last && last.word !== view.word,
    was: last?.word ?? null,
    setter: setter?.lastName ?? null,
    setterCaptain: !!setter && leadsAsCaptain(league, setter),
    setterSound: setter ? soundOf(setter) : null,
    pulling: view.pulling,
    cause,
    causeCount: grievance ? countOf(grievance.count, view.members, unit) : null,
    upYoung,
    rival,
    losingRun: streak ? Number(streak[1]) : 0,
    noVoice: view.noVoice,
    goneLeader: gone,
    nearVoice,
  };
}

/** What a line about a man who found his voice, or lost it, may read. */
export function standingFact(
  league: League,
  p: Player,
  now: Tier | null,
  was: Tier | null,
  ctx = viewContext(league),
): StandingFact {
  const view = standingView(league, p, ctx);
  return {
    name: p.lastName,
    now,
    was,
    experience: p.experience,
    // The season's-end report looks back on the season just played; the league year has already ticked over.
    yearOf: league.phase === 'resign' ? Math.max(0, p.experience - 1) : p.experience,
    newcomer: isNewcomer(league, p),
    starts: !!view?.parts.includes('starts'),
    captain: leadsAsCaptain(league, p),
    benched: !!p.morale?.jolts?.some((j) => j.kind === 'benched'),
    stirs: soundOf(p) === 'stirs',
    warn: (() => {
      const read = personalityRead(league, league.userTeamId, p);
      return !!read && personalityTone(read.name) === 'warn';
    })(),
    unit: phraseOf(unitOf(p.position)),
  };
}

/** What the screen's one-line reason may read. */
export function whyFact(_league: League, p: Player, view: StandingView): WhyFact {
  return { parts: view.parts, experience: p.experience, unit: phraseOf(unitOf(p.position)) };
}
