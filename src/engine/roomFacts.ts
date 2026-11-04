/**
 * The facts a line about the room may read (`roomVoice.ts`), built from your club only: names, flags and the words
 * our staff use. What the report and the staff notes told before is read back from their `covered` keys, stamped
 * with morale's clock, so the two speak from one memory.
 */
import { moraleLevel, moraleStepOf, viewContext, type MoraleContext } from './morale';
import type { Chemistry, ChemRoom, ChemWord } from './chemistry';
import { personalityRead, personalityTone } from './personality';
import { starters } from './roster';
import {
  causeOf,
  countOf,
  SPECIALISTS,
  UNIT_PHRASE,
  type ChemFact,
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
import { beliefOf, beliefRead, lawyerIn, runnerOf, sideRoleOf, type BeliefRead } from './belief';
import type { BeliefFact } from './roomVoice';
import type { CoachRoom, League, Player } from './types';

/** Memory keys name the club: a GM hired across the league starts with none of his old club's rooms. */
const UNIT_KEY = /^unit:(\d+):(\d+):(\w+):(\w+)$/;
const STANDING_KEY = /^standing:(\d+):(\d+):(\d+):(leader|voice)$/;
export const unitKey = (clock: number, teamId: number, unit: Unit, word: UnitWord) =>
  `unit:${clock}:${teamId}:${unit}:${word}`;
const CHEM_KEY = /^chem:(\d+):(\d+):(\w+):(.+)$/;
/** What the report told of a room's chemistry (L3): club-named, like the rest. */
export const chemKey = (clock: number, teamId: number, unit: ChemRoom, word: ChemWord) =>
  `chem:${clock}:${teamId}:${unit}:${word}`;
const BELIEF_KEY = /^belief:(\d+):(\d+):(\w+):(\w+)(?::(\d+))?$/;
/** What the report told of a room's belief in whoever runs its side (L4): club-named, like the rest. */
export const beliefKey = (clock: number, teamId: number, unit: CoachRoom, read: BeliefRead, coachId: number) =>
  `belief:${clock}:${teamId}:${unit}:${read}:${coachId}`;
/** A position coach's warning that his room is slipping on its coordinator (L4), once a fall. */
export const beliefWarnKey = (clock: number, teamId: number, unit: CoachRoom) =>
  `belief-warn:${clock}:${teamId}:${unit}`;
export const standingKey = (clock: number, teamId: number, playerId: number, tier: Tier) =>
  `standing:${clock}:${teamId}:${playerId}:${tier}`;

/** The latest told read of each of `teamId`'s units, and its leaders and voices at the latest report. */
export function lastTold(
  told: Set<string>,
  teamId: number,
): {
  units: Map<Unit, { word: UnitWord; clock: number }>;
  standing: { clock: number; tiers: Map<number, Tier> } | null;
  chem: Map<ChemRoom, { word: ChemWord; clock: number }>;
  belief: Map<CoachRoom, { read: BeliefRead; clock: number; coach?: number }>;
} {
  const belief = new Map<CoachRoom, { read: BeliefRead; clock: number; coach?: number }>();
  const units = new Map<Unit, { word: UnitWord; clock: number }>();
  const chem = new Map<ChemRoom, { word: ChemWord; clock: number }>();
  let standing: { clock: number; tiers: Map<number, Tier> } | null = null;
  for (const k of told) {
    const b = k.match(BELIEF_KEY);
    if (b) {
      if (Number(b[2]) !== teamId) continue;
      const clock = Number(b[1]);
      const have = belief.get(b[3] as CoachRoom);
      if (!have || clock >= have.clock)
        belief.set(b[3] as CoachRoom, { read: b[4] as BeliefRead, clock, ...(b[5] ? { coach: Number(b[5]) } : {}) });
      continue;
    }
    const c = k.match(CHEM_KEY);
    if (c) {
      if (Number(c[2]) !== teamId) continue;
      const clock = Number(c[1]);
      const have = chem.get(c[3] as ChemRoom);
      if (!have || clock >= have.clock) chem.set(c[3] as ChemRoom, { word: c[4] as ChemWord, clock });
      continue;
    }
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
  return { units, standing, chem, belief };
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

/** What a chemistry line may read about one of our rooms (L3): the word, and what's behind it that our staff see. */
export function chemFact(league: League, c: Chemistry, ctx: MoraleContext): ChemFact {
  const read = unitRead(league, c.teamId, c.unit, ctx);
  const setter = read?.setter === null || read?.setter === undefined ? undefined : league.players[read.setter];
  const anchor = (ctx.voices.get(`${c.teamId}:${c.unit}`) ?? [])
    .filter((v) => v.sound === 'steadies')
    .map((v) => league.players[v.id])
    .find((p) => p && p.teamId === c.teamId);
  return {
    // The QB room's time together is his with his targets: the passing game, not the quarterbacks.
    unit: c.unit === 'QB' ? 'the passing game' : UNIT_PHRASE[c.unit],
    word: c.word,
    years: c.years,
    // New starters only count where time together costs the room: in a new league nobody has history, so nobody's new.
    newStarters: c.together !== null && c.together < 0 ? c.newStarters : 0,
    split: read?.word === 'Split',
    comfortable: c.comfortable,
    ...(setter && soundOf(setter) === 'stirs'
      ? { spark: { last: setter.lastName, sour: moraleStepOf(moraleLevel(league, setter)) <= 3 } }
      : {}),
    ...(anchor ? { anchor: anchor.lastName } : {}),
  };
}

/**
 * What a line about one of our rooms' belief in whoever runs its side may read (L4): the read, the man, and a lawyer
 * voice stirring it, when our staff can see one. Null when nobody runs the side.
 */
export function beliefFact(league: League, teamId: number, unit: CoachRoom, ctx: MoraleContext): BeliefFact | null {
  const runner = runnerOf(league, teamId, unit);
  if (!runner) return null;
  const lawyer = lawyerIn(league, teamId, unit, ctx);
  return {
    unit: UNIT_PHRASE[unit],
    read: beliefRead(beliefOf(runner, unit)),
    coach: runner.lastName,
    side: sideRoleOf(unit) === 'offCoord' ? 'offense' : 'defense',
    ...(lawyer ? { lawyer: lawyer.lastName } : {}),
  };
}
