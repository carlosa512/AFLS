/**
 * The final whistle in All-22. A game won on its last play (a score that takes the lead with the clock nearly gone, or
 * in overtime) brings the winners' whole sideline onto the field to mob the man who won it, while the losers stand a
 * moment and trudge off. Any other finish: both teams meet round the ball, shake hands and head off, the winners'
 * sideline joining them for a playoff win. A title game ends in confetti. Pure: where everyone is at any moment.
 */
import { Rng } from '../../engine/rng';
import type { PlayLogEntry } from '../../engine/types';
import { FIELD_W, MID } from './ballPath';
import type { Pt } from './formations';
import { BENCH, type Mark } from './transition';

export type FinaleKind = 'walkoff' | 'win' | 'tie';

/** The last 30 seconds of regulation, or overtime: a lead taken here, on the last play, won the game on it. */
const LATE = 30;

/**
 * How a game ended, from its log: a tie; won on the last play (a score that put the winners ahead, late); or won.
 * `plays` is the whole log, `index` its last play.
 */
export function finaleKind(plays: readonly PlayLogEntry[], index: number): FinaleKind {
  const e = plays[index];
  if (e.homeScore === e.awayScore) return 'tie';
  const before = plays[index - 1] ?? { homeScore: 0, awayScore: 0 };
  const homeWon = e.homeScore > e.awayScore;
  const led = homeWon ? before.homeScore > before.awayScore : before.awayScore > before.homeScore;
  const late = e.quarter >= 5 || (e.quarter === 4 && e.clock <= LATE);
  return !led && late ? 'walkoff' : 'win';
}

export interface Figure extends Pt {
  opacity: number;
  /** A bounce: above 1 while he's jumping. */
  scale: number;
}

export interface Confetti extends Pt {
  /** Height above the turf (yards): it flutters down and lies there. */
  h: number;
  color: string;
}

export interface FinaleScene {
  duration: number;
  at(id: number, t: number): Figure | null;
  confetti(t: number): Confetti[];
}

const SPRINT = 7;
const WALK = 2.2;
/** On a walk-off the losers stand a moment before they go. */
const STUNNED = 1.4;
/** A man walking off is out of the picture after this long, whatever's left of his walk. */
const FADE_AFTER = 7;

function run(a: Pt, b: Pt, t0: number, pace: number, t: number): { p: Pt; done: boolean } {
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  const dur = Math.max(0.3, len / pace);
  const k = Math.min(1, Math.max(0, (t - t0) / dur));
  const s = 0.15;
  const v = 1 / (1 - s);
  const g = k < s ? (0.5 * v * k * k) / s : k > 1 - s ? 1 - (0.5 * v * (1 - k) * (1 - k)) / s : v * (k - s / 2);
  return { p: { x: a.x + (b.x - a.x) * g, y: a.y + (b.y - a.y) * g }, done: k >= 1 };
}

export function finaleScene(opts: {
  kind: FinaleKind;
  /** Everyone on the field at the whistle. */
  spots: ReadonlyMap<number, Mark>;
  /** The winners' kit (home or away); null for a tie. */
  winnersHome: boolean | null;
  /** Where it ended, and the man who won it (on a walk-off). */
  at: Pt;
  hero?: number;
  /** The winners' men off the field, who run on from their team area. */
  sideline: readonly number[];
  /** A playoff win: the sideline comes on whatever the finish. A title: confetti too. */
  playoff: boolean;
  title: boolean;
  colors: readonly string[];
  seed: string;
}): FinaleScene {
  const rng = new Rng(opts.seed);
  const { kind, spots, winnersHome } = opts;
  const celebrate = kind === 'walkoff' || (kind === 'win' && opts.playoff);
  // Where the winners gather: round the hero on a walk-off, else round the ball, where the handshakes are.
  const centre = kind === 'walkoff' && opts.hero !== undefined ? (spots.get(opts.hero) ?? opts.at) : opts.at;
  const middle = { x: centre.x, y: Math.max(6, Math.min(FIELD_W - 6, centre.y)) };
  type Plan = { from: Pt; to: Pt; start: number; pace: number; off?: Pt; offAt?: number; bounce: boolean };
  const plan = new Map<number, Plan>();
  let ring = 0;
  const seat = (): Pt => {
    const i = ring++;
    // A pile on a walk-off (packed tight, no neat ring); a looser crowd round the ball otherwise.
    const r = kind === 'walkoff' ? 0.9 + Math.sqrt(i) * 0.7 + rng.next() * 0.6 : 3 + Math.sqrt(i) * 0.95;
    const a = i * 2.4 + rng.next() * 0.3;
    return { x: middle.x + Math.cos(a) * r, y: Math.max(1, Math.min(FIELD_W - 1, middle.y + Math.sin(a) * r)) };
  };
  /** Off toward his own sideline, the nearest way, angling a little toward the team area. */
  const sidelineFor = (m: Mark): Pt => ({
    x: m.x + (Math.max(32, Math.min(68, m.x)) - m.x) * 0.4,
    y: m.home ? -BENCH : FIELD_W + BENCH,
  });

  for (const [id, m] of spots) {
    const from = { x: m.x, y: m.y };
    const winner = winnersHome !== null && m.home === winnersHome;
    if (id === opts.hero && kind === 'walkoff') {
      plan.set(id, { from, to: from, start: 0, pace: SPRINT, bounce: true });
      continue;
    }
    if (winner && celebrate) {
      plan.set(id, { from, to: seat(), start: 0.1 + rng.next() * 0.5, pace: SPRINT, bounce: true });
      continue;
    }
    if (!winner && kind === 'walkoff') {
      // Stunned a moment, then off.
      plan.set(id, {
        from,
        to: from,
        start: 0,
        pace: WALK,
        off: sidelineFor(m),
        offAt: STUNNED + rng.next() * 1.2,
        bounce: false,
      });
      continue;
    }
    // A handshake round the ball, then off to his own sideline.
    const meet = {
      x: middle.x + (rng.next() * 2 - 1) * 6,
      y: Math.max(2, Math.min(FIELD_W - 2, middle.y + (rng.next() * 2 - 1) * 8)),
    };
    const meetAt = 0.4 + rng.next() * 0.6;
    const there = meetAt + Math.hypot(meet.x - from.x, meet.y - from.y) / WALK;
    plan.set(id, {
      from,
      to: meet,
      start: meetAt,
      pace: WALK,
      off: winner && celebrate ? undefined : sidelineFor({ ...meet, home: m.home }),
      offAt: there + 1.2 + rng.next() * 1.2,
      bounce: false,
    });
  }
  // The winners' sideline floods on.
  if (celebrate && winnersHome !== null)
    for (const id of opts.sideline) {
      const from = {
        x: 32 + rng.next() * 36,
        y: winnersHome ? -BENCH - rng.next() * 1.5 : FIELD_W + BENCH + rng.next() * 1.5,
      };
      plan.set(id, {
        from,
        to: seat(),
        start: 0.2 + rng.next() * 0.9,
        pace: SPRINT * (0.85 + rng.next() * 0.2),
        bounce: true,
      });
    }

  let duration = 0;
  for (const p of plan.values()) {
    const arrive = p.start + Math.hypot(p.to.x - p.from.x, p.to.y - p.from.y) / p.pace;
    const gone =
      p.off && p.offAt !== undefined
        ? p.offAt + Math.min(FADE_AFTER + 1.5, Math.hypot(p.off.x - p.to.x, p.off.y - p.to.y) / WALK)
        : 0;
    duration = Math.max(duration, arrive + 2, gone);
  }
  duration = Math.min(Math.max(duration, 6), 16);

  // A title: confetti in the winners' colors over the field, fluttering down.
  const pieces: { x: number; y: number; h: number; drop: number; t0: number; color: string; drift: number }[] = [];
  if (opts.title && winnersHome !== null) {
    const colors = [...opts.colors, '#ffffff'];
    for (let i = 0; i < 140; i++)
      pieces.push({
        x: middle.x + (rng.next() * 2 - 1) * 30,
        y: rng.next() * FIELD_W,
        h: 6 + rng.next() * 6,
        drop: 1.2 + rng.next() * 1.4,
        t0: rng.next() * 3,
        color: colors[i % colors.length],
        drift: (rng.next() * 2 - 1) * 1.5,
      });
  }

  return {
    duration,
    at(id, t) {
      const p = plan.get(id);
      if (!p) return null;
      if (p.off && p.offAt !== undefined && t >= p.offAt) {
        const { p: q, done } = run(p.to, p.off, p.offAt, WALK, t);
        // Fading as he reaches the sideline, or after a few seconds' walk (the far side of the field is a long way).
        const left = Math.hypot(p.off.x - q.x, p.off.y - q.y);
        const walked = t - p.offAt;
        const fade = Math.min(left / 3, 1 - (walked - FADE_AFTER) / 1.5);
        return { ...q, opacity: done ? 0 : Math.max(0, Math.min(1, fade)), scale: 1 };
      }
      const { p: q, done } = run(p.from, p.to, p.start, p.pace, t);
      // Jumping for joy once he's in: a quick bounce each, out of step with each other.
      const scale = p.bounce && done ? 1 + 0.16 * Math.max(0, Math.sin(t * 9 + id)) : 1;
      return { ...q, opacity: 1, scale };
    },
    confetti(t) {
      return pieces
        .filter((c) => t >= c.t0)
        .map((c) => {
          const s = t - c.t0;
          return {
            x: c.x + c.drift * s + Math.sin(s * 3 + c.x) * 0.4,
            y: c.y + Math.cos(s * 2.5 + c.y) * 0.4,
            h: Math.max(0, c.h - c.drop * s),
            color: c.color,
          };
        });
    },
  };
}

/** The banner at the final whistle. */
export function finaleBanner(opts: {
  kind: FinaleKind;
  winner?: string;
  score: string;
  /** What won it on a walk-off ("field goal", "touchdown"). */
  how?: string;
  playoff: boolean;
  title: boolean;
}): string {
  if (opts.kind === 'tie') return `Final · ${opts.score} · a tie`;
  if (opts.title) return `Final · ${opts.score} · ${opts.winner} are champions!`;
  const walk = opts.kind === 'walkoff' && opts.how ? ` · won on a last-gasp ${opts.how}` : '';
  const on = opts.playoff ? ` · ${opts.winner} advance` : '';
  return `Final · ${opts.score}${walk}${on}`;
}

/** The middle of the field, for a finish with nobody to centre on. */
export const MIDFIELD: Pt = { x: 50, y: MID };
