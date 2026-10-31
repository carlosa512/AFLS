/**
 * Between plays in All-22: everyone jogs from where the last play left him to his spot in the next formation, men
 * coming off jog to their sideline and fade, men coming on jog in from theirs, and the formation sets for a beat before
 * the snap. Pure: where each man is at any moment of the gap.
 */
import { Rng } from '../../engine/rng';
import type { PlayLogEntry } from '../../engine/types';
import { FIELD_W, offenseSide } from './ballPath';
import type { Pt } from './formations';

/** A jog, in yards a second. */
export const JOG = 4.5;
/** Getting set against the clock: a hurry-up offense, a sub racing on before a delay of game. */
export const SPRINT = 7.5;
/** Yards outside the sideline where each team's bench stands (home on the near side, away on the far). */
export const BENCH = 3;
/** The longest a change-over may take: past this the whole field hustles. */
const MAX_JOG = 6.5;
/** The formation, set, before the snap. */
const SET = 0.8;
/** After the whistle: everyone where the play left him for a moment, before anyone heads back. */
const WHISTLE = 0.7;
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
/** Before a kickoff: off the field at a run, a moment on the sideline, and the kick units on (yards a second). */
const CHANGE = 6;
/** The longest anyone takes to get off, or on: past it, the whole change-over picks up. */
const CHANGE_MAX = 7;
/** A man coming off stands on the sideline this long (a range) before a man in both units goes back on. */
const SIDELINE = [0.6, 1.4] as const;

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
  /** His own reaction: seconds before he sets off to the line, and to the huddle. */
  delay: number;
  /** Seconds after the celebration when his last leg (to his spot, or off) begins: the huddle breaking, or his turn. */
  start: number;
  gdelay: number;
  /** How far his path bows off a straight line (−1…1, of a few yards), to the line and to the huddle. */
  bow: number;
  gbow: number;
}

export interface Transition {
  duration: number;
  /** Seconds after the whistle before anyone moves (none when a big play is celebrated: they run to him at once). */
  beat: number;
  /** Seconds of celebration before the jog (0 for none). */
  celebrate: number;
  /** Seconds in the huddle, from the end of the celebration until it breaks (0 for none). */
  huddle: number;
  moves: Move[];
  at(m: Move, t: number): Pt & { opacity: number };
  /**
   * Everyone at `t`, with the men coming on and going off kept `room` yards from everyone else (no two dots run
   * through each other); the rest are where `at` puts them.
   */
  frame(t: number, room: number): (Pt & { m: Move; opacity: number })[];
}

const benchY = (home: boolean) => (home ? -BENCH : FIELD_W + BENCH);
/** Where a man reaches his sideline: drifting toward his team's bench area, each by his own line. */
const benchAt = (x: number, rng: Rng, toward = 0.25, lo = -5, hi = 105) =>
  Math.max(lo, Math.min(hi, x + (50 - x) * toward + (rng.next() * 2 - 1) * 4));

/** `k` of the way from `a` to `b` on a gentle bend: off the straight line by `bow` of a few yards at the middle. */
function along(a: Pt, b: Pt, k: number, bow: number): Pt {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  const off = len > 0 ? bow * Math.min(2.5, len * 0.12) * 4 * k * (1 - k) : 0;
  return { x: a.x + dx * k - (dy / (len || 1)) * off, y: a.y + dy * k + (dx / (len || 1)) * off };
}
/**
 * How far a man going off has faded: over the second half of his walk, or a couple of seconds after he sets off,
 * whichever comes first, so a whole unit going off doesn't crowd the field while the next one comes on.
 */
const leaving = (k: number, since: number) => Math.min(1, Math.max((k - 0.5) * 2, (since - 1) / 1.5, 0));
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
    /** No two men move alike, the same way every time this gap is shown. */
    seed?: string;
    /** A kickoff next: everyone comes off to his sideline, and the kick units come on. */
    change?: boolean;
  } = {},
): Transition {
  const { party, huddle } = opts;
  const run = opts.hurry ? SPRINT : JOG;
  const rng = new Rng(opts.seed ?? 'gap');
  /** Each man's own way of getting there: when he reacts, his pace, the bend in his path. */
  const style = () => ({
    delay: rng.next() * (opts.hurry ? 0.2 : 0.55),
    gdelay: rng.next() * (opts.hurry ? 0.15 : 0.5),
    pace: 0.8 + rng.next() * 0.4,
    // Every path bends a little, one way or the other: nobody runs a ruler line.
    bow: (rng.next() < 0.5 ? -1 : 1) * (0.35 + rng.next() * 0.65),
    gbow: (rng.next() < 0.5 ? -1 : 1) * (0.35 + rng.next() * 0.65),
  });
  const paceOf = new Map<number, number>();
  const moves: Move[] = [];
  const onNext = new Set(next.ids);
  next.ids.forEach((id, k) => {
    const to = { x: next.pos[k * 2], y: next.pos[k * 2 + 1] };
    const was = prev.get(id);
    const from = was ?? {
      // From the bench: on a change-over the kick units come from the team area, otherwise level with his spot.
      x: opts.change ? benchAt(to.x, rng) : Math.max(-8, Math.min(108, to.x)),
      y: benchY(next.home[k]),
    };
    const at = { x: from.x, y: from.y };
    const { pace, ...way } = style();
    paceOf.set(id, pace);
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
      start: 0,
      ...way,
    });
  });
  for (const [id, was] of prev)
    if (!onNext.has(id)) {
      const { pace, ...way } = style();
      paceOf.set(id, pace);
      // Off toward his bench area (between the 30s), each by his own line, not straight across in a row.
      const benchX = opts.change ? benchAt(was.x, rng, 0.4, 20, 80) : benchAt(was.x, rng);
      moves.push({
        id,
        home: was.home,
        from: { x: was.x, y: was.y },
        mid: { x: was.x, y: was.y },
        hud: { x: was.x, y: was.y },
        gather: 0,
        to: { x: benchX, y: benchY(was.home) },
        arrive: 0,
        enter: false,
        leave: true,
        start: 0,
        ...way,
      });
    }

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
      const loose = () => (rng.next() - 0.5) * 0.6;
      for (const m of side)
        if (m.id === lead) m.hud = { x: center.x + front * ring * 0.8 + loose(), y: center.y + loose() };
      rest.forEach((m, i) => {
        // Round the back of the ring, away from the front: a loose ring, nobody on a mark.
        const angle = Math.PI * (0.35 + (1.3 * (i + 0.5 + (rng.next() - 0.5) * 0.6)) / Math.max(1, rest.length));
        const r = ring + (rng.next() - 0.5) * 0.7;
        m.hud = { x: center.x + front * Math.cos(angle) * r, y: center.y + Math.sin(angle) * r };
      });
    }
    // A jog in (a sprint against the clock); the huddle waits for a sub coming from the bench.
    for (const m of moves)
      if (!m.leave) m.gather = Math.hypot(m.hud.x - m.mid.x, m.hud.y - m.mid.y) / (run * paceOf.get(m.id)!);
    huddleTime = Math.max(0, ...moves.filter((m) => !m.leave).map((m) => m.gdelay + m.gather)) + HUDDLE_HOLD;
  }

  const dist = (m: Move) => Math.hypot(m.to.x - m.hud.x, m.to.y - m.hud.y);
  let pace: number;
  if (opts.change) {
    // The change-over: the men going off head for their sideline, the units coming on run out as the field clears,
    // not all at once; a man in both units goes straight to his new spot (no trip to the sideline and back to wait on).
    for (const m of moves) {
      if (m.leave) continue;
      m.start = m.enter ? 1.2 + rng.next() * 1.8 : SIDELINE[0] + rng.next() * (SIDELINE[1] - SIDELINE[0]);
    }
    pace = Math.max(CHANGE, Math.max(0, ...moves.filter((m) => !m.leave).map(dist)) / (CHANGE_MAX * 0.8));
    huddleTime = 0;
  } else {
    // Only men staying on can force a hustle (a change of possession): a sub coming from the bench jogs in at his own
    // pace, and men going off walk off at theirs.
    const longest = Math.max(0, ...moves.filter((m) => !m.enter && !m.leave).map(dist));
    // A jog, unless the longest trip couldn't make it in time (a change of possession): then everyone hustles.
    // Sized so the slowest of them (the pace below is scaled by each man's own, 0.8 at the least) still makes it.
    pace = Math.max(run, longest / (MAX_JOG * 0.8));
    for (const m of moves) if (!m.leave) m.start = huddleTime;
  }
  for (const m of moves) m.arrive = dist(m) / (pace * paceOf.get(m.id)!);
  const beat = party ? 0 : WHISTLE;
  const duration =
    beat + celebrate + Math.max(0.6, ...moves.filter((m) => !m.leave).map((m) => m.start + m.delay + m.arrive)) + SET;

  /** How much a man on his way on or off gives way: fully in transit, easing off as he settles or fades. */
  const giving = (m: Move, t: number, opacity: number) => {
    if (m.leave) return opacity > 0.15 ? opacity : 0;
    if (!m.enter) return 0;
    const into = Math.max(0, t - beat - celebrate - m.start - m.delay);
    const k = m.arrive > 0 ? Math.min(1, into / m.arrive) : 1;
    return Math.min(1, (1 - k) * 4);
  };
  const tr: Transition = {
    duration,
    beat,
    celebrate,
    huddle: huddleTime,
    moves,
    at(m, t) {
      t = Math.max(0, t - beat);
      if (t < celebrate) {
        // Gathering round him, then a moment together.
        const g = smooth(Math.min(1, t / (celebrate * 0.6)));
        const x = m.from.x + (m.mid.x - m.from.x) * g;
        const y = m.from.y + (m.mid.y - m.from.y) * g;
        return { x, y, opacity: m.enter ? 0.2 : 1 };
      }
      t -= celebrate;
      if (t < m.start) {
        // Into the huddle (or off to the sideline), then the call (or his turn to go back on).
        const g = m.gather > 0 ? smooth(Math.min(1, Math.max(0, (t - m.gdelay) / m.gather))) : 1;
        const p = along(m.mid, m.hud, g, m.gbow);
        return { ...p, opacity: m.enter && huddleTime ? Math.min(1, 0.2 + g * 1.6) : m.enter ? 0.2 : 1 };
      }
      // The men going off head for the bench straight away; everyone else breaks the huddle, or takes his turn.
      t -= m.start;
      const k = m.arrive > 0 ? smooth(Math.min(1, Math.max(0, (t - m.delay) / m.arrive))) : 1;
      const { x, y } = along(m.hud, m.to, k, m.bow);
      // Fading in from the bench, fading out on the way to it.
      const opacity =
        m.enter && !huddleTime ? Math.min(1, 0.2 + k * 1.6) : m.leave ? Math.max(0, 1 - leaving(k, t - m.delay)) : 1;
      return { x, y, opacity };
    },
    frame(t, room) {
      const out = moves.map((m) => ({ m, ...tr.at(m, t) }));
      const give = out.map((p) => giving(p.m, t, p.opacity));
      // A few passes of pushing apart: only men in transit move, each by his share of the overlap.
      for (let pass = 0; pass < 4; pass++)
        for (let i = 0; i < out.length; i++)
          for (let j = i + 1; j < out.length; j++) {
            const gi = give[i];
            const gj = give[j];
            if (gi + gj === 0 || out[i].opacity < 0.15 || out[j].opacity < 0.15) continue;
            const dx = out[j].x - out[i].x;
            const dy = out[j].y - out[i].y;
            const d = Math.hypot(dx, dy);
            if (d >= room) continue;
            const ux = d > 1e-6 ? dx / d : 0;
            const uy = d > 1e-6 ? dy / d : 1;
            const over = room - d;
            const wi = gi / (gi + gj);
            out[i].x -= ux * over * wi * gi;
            out[i].y -= uy * over * wi * gi;
            out[j].x += ux * over * (1 - wi) * gj;
            out[j].y += uy * over * (1 - wi) * gj;
          }
      return out;
    },
  };
  return tr;
}
