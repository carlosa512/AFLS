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
/**
 * The team area along each sideline: between the 32-yard lines, as the NFL marks it. Subs come on from it and men
 * coming off go back to it, spread along it, wherever the ball is.
 */
const TEAM_AREA = [33, 67] as const;
/** The longest a change-over may take: past this the whole field hustles. */
const MAX_JOG = 6.5;
/** Men going off get off: yards a second. */
const OFF_PACE = 6.5;
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
}

const benchY = (home: boolean) => (home ? -BENCH : FIELD_W + BENCH);
/** A spot in his team's area: near where he is, if the area reaches that far, each his own. */
const benchAt = (x: number, rng: Rng) => Math.max(TEAM_AREA[0], Math.min(TEAM_AREA[1], x + (rng.next() * 2 - 1) * 4));

/** `k` of the way from `a` to `b` on a gentle bend: off the straight line by `bow` of a few yards at the middle. */
function along(a: Pt, b: Pt, k: number, bow: number): Pt {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  // A gentle bend on a long jog, next to none on a short step: short hops that curve read as circling.
  const off = len > 0 ? bow * Math.min(1.2, Math.max(0, len - 4) * 0.06) * 4 * k * (1 - k) : 0;
  return { x: a.x + dx * k - (dy / (len || 1)) * off, y: a.y + dy * k + (dx / (len || 1)) * off };
}
/**
 * A man going off: dimmed as he heads for his sideline, so a unit going off never crowds the one coming on, and gone
 * as he gets there. He's seen all the way off, never vanishing mid-field.
 */
const leaving = (k: number, since: number) => {
  const dim = Math.max(0.5, 1 - Math.max(0, since) * 0.25);
  return k < 0.85 ? dim : dim * Math.max(0, (1 - k) / 0.15);
};
/** Room between two men standing side by side on the sideline, in yards. */
const SIDE_BY_SIDE = 2.4;
/** Spots along a sideline, nudged apart to `SIDE_BY_SIDE` in their order along it, keeping their middle. */
function spreadOut(spots: Pt[]) {
  if (spots.length < 2) return;
  const order = [...spots].sort((a, b) => a.x - b.x);
  const was = order.reduce((sum, p) => sum + p.x, 0) / order.length;
  for (let i = 1; i < order.length; i++) order[i].x = Math.max(order[i].x, order[i - 1].x + SIDE_BY_SIDE);
  const shift = was - order.reduce((sum, p) => sum + p.x, 0) / order.length;
  for (const p of order) p.x += shift;
}
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
      x: benchAt(to.x, rng),
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
      // Off at his own sideline, angling toward the team area when it's near; from far off (the end zone after a score)
      // he just goes off the nearest way. Only men coming on come from the team area itself.
      const area = benchAt(was.x, rng);
      const far = Math.abs(area - was.x);
      const lean = Math.max(0.1, Math.min(0.7, 1 - (far - 8) / 25));
      const benchX = Math.max(-5, Math.min(105, was.x + (area - was.x) * lean));
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

  // On the sideline, side by side: the men waiting to come on, and the spots the men going off head for, are spread
  // along it a couple of yards apart (each team on its own sideline), not stacked on one spot.
  for (const home of [true, false]) {
    spreadOut(moves.filter((m) => m.enter && m.home === home).map((m) => m.from));
    spreadOut(moves.filter((m) => m.leave && m.home === home).map((m) => m.to));
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
  // Men going off hustle (a twelfth man on the field at the snap is a flag); everyone else at the pace above.
  for (const m of moves) m.arrive = dist(m) / ((m.leave ? Math.max(pace, OFF_PACE) : pace) * paceOf.get(m.id)!);
  const beat = party ? 0 : WHISTLE;
  const duration =
    beat + celebrate + Math.max(0.6, ...moves.map((m) => m.start + m.delay + m.arrive - (m.leave ? SET : 0))) + SET;

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
        return { ...p, opacity: 1 };
      }
      // The men going off head for the bench straight away; everyone else breaks the huddle, or takes his turn.
      t -= m.start;
      const k = m.arrive > 0 ? smooth(Math.min(1, Math.max(0, (t - m.delay) / m.arrive))) : 1;
      const { x, y } = along(m.hud, m.to, k, m.bow);
      // Coming on from his sideline in full view; going off, dimmed and gone at the sideline.
      const opacity = m.leave ? leaving(k, t - m.delay) : 1;
      return { x, y, opacity };
    },
  };
  return tr;
}
