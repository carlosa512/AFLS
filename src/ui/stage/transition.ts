/**
 * Between plays in All-22: everyone jogs from where the last play left him to his spot in the next formation, men
 * coming off jog to their sideline and fade, men coming on jog in from theirs, and the formation sets for a beat before
 * the snap. Pure: where each man is at any moment of the gap.
 */
import type { PlayLogEntry } from '../../engine/types';
import { FIELD_W, offenseSide } from './ballPath';
import type { Pt } from './formations';

/** A jog, in yards a second. */
export const JOG = 5;
/** Getting set against the clock: a hurry-up offense, a sub racing on before a delay of game. */
export const SPRINT = 7.5;
/** Yards outside the sideline where each team's bench stands (home on the near side, away on the far). */
export const BENCH = 3;
/** The longest a change-over may take: past this the whole field hustles. */
const MAX_JOG = 6.5;
/** The formation, set, before the snap. */
const SET = 0.8;
/** A celebration: the gather round the man who made the play, and the moment together. */
const CELEBRATE = 1.6;
/** Teammates closer than this to him join in; the rest head for the next play. */
const JOIN = 25;
/** How long a huddle stays together once everyone's in, before it breaks. */
const HUDDLE_HOLD = 1.0;
/** The offense's huddle is tight round the quarterback; the defense's looser round its play-caller. */
const OFFENSE_RING = 1.9;
const DEFENSE_RING = 2.6;
/** The scoring plays long enough to earn one (yards from scrimmage). */
const BIG_SCORE = 20;

/**
 * Whether the play at `index` earns a celebration: a touchdown from 20 yards or more, any return score, an
 * interception, a fumble the other side came up with. Nothing for a short score or an ordinary play.
 */
export function celebrates(plays: readonly PlayLogEntry[], index: number, homeId: number): boolean {
  const e = plays[index];
  if (!e?.kind) return false;
  if (e.kind === 'int') return true;
  if (/TOUCHDOWN/.test(e.text)) {
    if (e.kind === 'kickoff' || e.kind === 'punt' || /returns/.test(e.text)) return true;
    const dir = offenseSide(e, homeId) === 0 ? 1 : -1;
    return e.from !== undefined && e.to !== undefined && (e.to - e.from) * dir >= BIG_SCORE;
  }
  // A fumble: only when the next snap is the other side's.
  const next = plays.slice(index + 1).find((x) => x.down > 0);
  return /FUMBLE/.test(e.text) && !!next && next.offense !== e.offense;
}

export interface Mark extends Pt {
  home: boolean;
}

export interface Move {
  id: number;
  home: boolean;
  from: Pt;
  /** Where he celebrates (his `from` when he doesn't). */
  mid: Pt;
  /** His spot in the huddle (his `mid` when there's none). */
  hud: Pt;
  /** Seconds from the end of the celebration to his spot in the huddle. */
  gather: number;
  to: Pt;
  /** Seconds to get there. */
  arrive: number;
  /** Coming on from the sideline, or going off to it. */
  enter: boolean;
  leave: boolean;
}

export interface Transition {
  duration: number;
  /** Seconds of celebration before the jog (0 for none). */
  celebrate: number;
  /** Seconds in the huddle, from the end of the celebration until it breaks (0 for none). */
  huddle: number;
  moves: Move[];
  at(m: Move, t: number): Pt & { opacity: number };
}

const benchY = (home: boolean) => (home ? -BENCH : FIELD_W + BENCH);
/** Ease in and out: a man accelerates into his jog and pulls up at his spot. */
const smooth = (k: number) => k * k * (3 - 2 * k);

/** Where each side huddles, and who stands at the front: the quarterback, and the defense's play-caller. */
export interface Huddle {
  offense: Pt;
  defense: Pt;
  offenseHome: boolean;
  qb?: number;
  caller?: number;
}

export function transition(
  prev: ReadonlyMap<number, Mark>,
  next: { ids: readonly number[]; home: readonly boolean[]; pos: Float32Array },
  opts: {
    /** The man who made a big play, whose teammates gather round him first. */
    party?: Mark;
    /** The huddles before this snap (none in a two-minute drill or before a kick). */
    huddle?: Huddle;
    /** A clock to beat: everyone sprints into place. */
    hurry?: boolean;
  } = {},
): Transition {
  const { party, huddle } = opts;
  const run = opts.hurry ? SPRINT : JOG;
  const moves: Move[] = [];
  const onNext = new Set(next.ids);
  next.ids.forEach((id, k) => {
    const to = { x: next.pos[k * 2], y: next.pos[k * 2 + 1] };
    const was = prev.get(id);
    const from = was ?? { x: Math.max(-8, Math.min(108, to.x)), y: benchY(next.home[k]) };
    const at = { x: from.x, y: from.y };
    moves.push({
      id,
      home: next.home[k],
      from: at,
      mid: at,
      hud: at,
      gather: 0,
      to,
      arrive: 0,
      enter: !was,
      leave: false,
    });
  });
  for (const [id, was] of prev)
    if (!onNext.has(id))
      moves.push({
        id,
        home: was.home,
        from: { x: was.x, y: was.y },
        mid: { x: was.x, y: was.y },
        hud: { x: was.x, y: was.y },
        gather: 0,
        to: { x: was.x, y: benchY(was.home) },
        arrive: 0,
        enter: false,
        leave: true,
      });

  // The celebration: teammates within reach gather in a loose ring round him; nobody else joins in.
  const celebrate = party ? CELEBRATE : 0;
  if (party) {
    let ring = 0;
    for (const m of moves) {
      if (m.enter || m.home !== party.home) continue;
      const d = Math.hypot(m.from.x - party.x, m.from.y - party.y);
      if (d < 0.5 || d > JOIN) continue;
      const angle = ring * 2.4;
      const r = 1.6 + (ring % 2) * 0.6;
      m.mid = { x: party.x + Math.cos(angle) * r, y: party.y + Math.sin(angle) * r };
      ring++;
    }
  }
  for (const m of moves) m.hud = m.mid;

  // The huddles: each side in a ring, the quarterback (or the play-caller) at the front, facing the others.
  let huddleTime = 0;
  if (huddle) {
    const toBall = Math.sign(huddle.defense.x - huddle.offense.x) || 1;
    for (const offense of [true, false]) {
      const center = offense ? huddle.offense : huddle.defense;
      const front = offense ? toBall : -toBall;
      const lead = offense ? huddle.qb : huddle.caller;
      const ring = offense ? OFFENSE_RING : DEFENSE_RING;
      const side = moves.filter((m) => !m.leave && m.home === (offense ? huddle.offenseHome : !huddle.offenseHome));
      const rest = side.filter((m) => m.id !== lead);
      for (const m of side) if (m.id === lead) m.hud = { x: center.x + front * ring * 0.8, y: center.y };
      rest.forEach((m, i) => {
        // Round the back of the ring, away from the front.
        const angle = Math.PI * (0.35 + (1.3 * (i + 0.5)) / Math.max(1, rest.length));
        m.hud = { x: center.x + front * Math.cos(angle) * ring, y: center.y + Math.sin(angle) * ring };
      });
    }
    // A jog in (a sprint against the clock); the huddle waits for a sub coming from the bench.
    for (const m of moves) if (!m.leave) m.gather = Math.hypot(m.hud.x - m.mid.x, m.hud.y - m.mid.y) / run;
    huddleTime = Math.max(0, ...moves.map((m) => m.gather)) + HUDDLE_HOLD;
  }

  const dist = (m: Move) => Math.hypot(m.to.x - m.hud.x, m.to.y - m.hud.y);
  const longest = Math.max(0, ...moves.map(dist));
  // A jog, unless the longest trip couldn't make it in time (a change of possession): then everyone hustles.
  const pace = Math.max(run, longest / MAX_JOG);
  for (const m of moves) m.arrive = dist(m) / pace;
  const duration = celebrate + huddleTime + Math.max(0.6, ...moves.filter((m) => !m.leave).map((m) => m.arrive)) + SET;

  return {
    duration,
    celebrate,
    huddle: huddleTime,
    moves,
    at(m, t) {
      if (t < celebrate) {
        // Gathering round him, then a moment together.
        const g = smooth(Math.min(1, t / (celebrate * 0.6)));
        const x = m.from.x + (m.mid.x - m.from.x) * g;
        const y = m.from.y + (m.mid.y - m.from.y) * g;
        return { x, y, opacity: m.enter ? 0.2 : 1 };
      }
      t -= celebrate;
      if (t < huddleTime && !m.leave) {
        // Into the huddle, then the call.
        const g = m.gather > 0 ? smooth(Math.min(1, t / m.gather)) : 1;
        const x = m.mid.x + (m.hud.x - m.mid.x) * g;
        const y = m.mid.y + (m.hud.y - m.mid.y) * g;
        return { x, y, opacity: m.enter ? Math.min(1, 0.2 + g * 1.6) : 1 };
      }
      // The men going off head for the bench straight away; everyone else breaks the huddle.
      if (!m.leave) t -= huddleTime;
      const k = m.arrive > 0 ? smooth(Math.min(1, Math.max(0, t / m.arrive))) : 1;
      const x = m.hud.x + (m.to.x - m.hud.x) * k;
      const y = m.hud.y + (m.to.y - m.hud.y) * k;
      // Fading in from the bench, fading out on the way to it.
      const opacity =
        m.enter && !huddleTime ? Math.min(1, 0.2 + k * 1.6) : m.leave ? Math.max(0, 1 - Math.max(0, k - 0.5) * 2) : 1;
      return { x, y, opacity };
    },
  };
}
