/**
 * Between plays in All-22: everyone jogs from where the last play left him to his spot in the next formation, men
 * coming off jog to their sideline and fade, men coming on jog in from theirs, and the formation sets for a beat before
 * the snap. Pure: where each man is at any moment of the gap.
 */
import { FIELD_W } from './ballPath';
import type { Pt } from './formations';

/** A jog, in yards a second. */
export const JOG = 5;
/** Yards outside the sideline where each team's bench stands (home on the near side, away on the far). */
export const BENCH = 3;
/** The longest a change-over may take: past this the whole field hustles. */
const MAX_JOG = 6.5;
/** The formation, set, before the snap. */
const SET = 0.8;

export interface Mark extends Pt {
  home: boolean;
}

export interface Move {
  id: number;
  home: boolean;
  from: Pt;
  to: Pt;
  /** Seconds to get there. */
  arrive: number;
  /** Coming on from the sideline, or going off to it. */
  enter: boolean;
  leave: boolean;
}

export interface Transition {
  duration: number;
  moves: Move[];
  at(m: Move, t: number): Pt & { opacity: number };
}

const benchY = (home: boolean) => (home ? -BENCH : FIELD_W + BENCH);
/** Ease in and out: a man accelerates into his jog and pulls up at his spot. */
const smooth = (k: number) => k * k * (3 - 2 * k);

export function transition(
  prev: ReadonlyMap<number, Mark>,
  next: { ids: readonly number[]; home: readonly boolean[]; pos: Float32Array },
): Transition {
  const moves: Move[] = [];
  const onNext = new Set(next.ids);
  next.ids.forEach((id, k) => {
    const to = { x: next.pos[k * 2], y: next.pos[k * 2 + 1] };
    const was = prev.get(id);
    const from = was ?? { x: Math.max(-8, Math.min(108, to.x)), y: benchY(next.home[k]) };
    moves.push({ id, home: next.home[k], from: { x: from.x, y: from.y }, to, arrive: 0, enter: !was, leave: false });
  });
  for (const [id, was] of prev)
    if (!onNext.has(id))
      moves.push({
        id,
        home: was.home,
        from: { x: was.x, y: was.y },
        to: { x: was.x, y: benchY(was.home) },
        arrive: 0,
        enter: false,
        leave: true,
      });

  const dist = (m: Move) => Math.hypot(m.to.x - m.from.x, m.to.y - m.from.y);
  const longest = Math.max(0, ...moves.map(dist));
  // A jog, unless the longest trip couldn't make it in time (a change of possession): then everyone hustles.
  const pace = Math.max(JOG, longest / MAX_JOG);
  for (const m of moves) m.arrive = dist(m) / pace;
  const duration = Math.max(0.6, ...moves.filter((m) => !m.leave).map((m) => m.arrive)) + SET;

  return {
    duration,
    moves,
    at(m, t) {
      const k = m.arrive > 0 ? smooth(Math.min(1, Math.max(0, t / m.arrive))) : 1;
      const x = m.from.x + (m.to.x - m.from.x) * k;
      const y = m.from.y + (m.to.y - m.from.y) * k;
      // Fading in from the bench, fading out on the way to it.
      const opacity = m.enter ? Math.min(1, 0.2 + k * 1.6) : m.leave ? Math.max(0, 1 - Math.max(0, k - 0.5) * 2) : 1;
      return { x, y, opacity };
    },
  };
}
