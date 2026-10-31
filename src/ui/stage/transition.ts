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
  moves: Move[];
  at(m: Move, t: number): Pt & { opacity: number };
}

const benchY = (home: boolean) => (home ? -BENCH : FIELD_W + BENCH);
/** Ease in and out: a man accelerates into his jog and pulls up at his spot. */
const smooth = (k: number) => k * k * (3 - 2 * k);

export function transition(
  prev: ReadonlyMap<number, Mark>,
  next: { ids: readonly number[]; home: readonly boolean[]; pos: Float32Array },
  /** The man who made a big play, whose teammates gather round him first. */
  party?: Mark,
): Transition {
  const moves: Move[] = [];
  const onNext = new Set(next.ids);
  next.ids.forEach((id, k) => {
    const to = { x: next.pos[k * 2], y: next.pos[k * 2 + 1] };
    const was = prev.get(id);
    const from = was ?? { x: Math.max(-8, Math.min(108, to.x)), y: benchY(next.home[k]) };
    const at = { x: from.x, y: from.y };
    moves.push({ id, home: next.home[k], from: at, mid: at, to, arrive: 0, enter: !was, leave: false });
  });
  for (const [id, was] of prev)
    if (!onNext.has(id))
      moves.push({
        id,
        home: was.home,
        from: { x: was.x, y: was.y },
        mid: { x: was.x, y: was.y },
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
  const dist = (m: Move) => Math.hypot(m.to.x - m.mid.x, m.to.y - m.mid.y);
  const longest = Math.max(0, ...moves.map(dist));
  // A jog, unless the longest trip couldn't make it in time (a change of possession): then everyone hustles.
  const pace = Math.max(JOG, longest / MAX_JOG);
  for (const m of moves) m.arrive = dist(m) / pace;
  const duration = celebrate + Math.max(0.6, ...moves.filter((m) => !m.leave).map((m) => m.arrive)) + SET;

  return {
    duration,
    celebrate,
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
      const k = m.arrive > 0 ? smooth(Math.min(1, Math.max(0, t / m.arrive))) : 1;
      const x = m.mid.x + (m.to.x - m.mid.x) * k;
      const y = m.mid.y + (m.to.y - m.mid.y) * k;
      // Fading in from the bench, fading out on the way to it.
      const opacity = m.enter ? Math.min(1, 0.2 + k * 1.6) : m.leave ? Math.max(0, 1 - Math.max(0, k - 0.5) * 2) : 1;
      return { x, y, opacity };
    },
  };
}
