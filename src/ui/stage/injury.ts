/**
 * An injury stoppage in All-22: the man stays down where the play left him, everyone else backs off and gathers by
 * team a few yards away, the trainers jog out from his team area, and after a moment he leaves the field: walking
 * with a trainer, helped off by two, or on the cart. Pure: where everyone is at any moment of the stoppage.
 */
import { Rng } from '../../engine/rng';
import { FIELD_W } from './ballPath';
import type { Exit } from './calls';
import type { Pt } from './formations';
import { BENCH, type Mark } from './transition';

/** Everyone where the play left him, before anything moves. */
const BEAT = 0.8;
/** Men this close to him back off and gather with their team; the rest stay where they are, watching. */
const GATHER = 25;
/** How far from him each team gathers (yards), and how fast they walk there. */
const CLEAR = 11;
const WALK = 3;
/** The trainers' jog out, and the cart's drive. */
const TRAINER = 5;
const CART = 5;
/** How long the trainers tend him before he leaves. */
const TEND: Record<Exit, number> = { walk: 2.2, helped: 2.6, cart: 3.4 };
/** His pace off the field. */
const OFF: Record<Exit, number> = { walk: 2.6, helped: 2, cart: 4 };
/** The team area, between the 32-yard lines: where the trainers and the cart come from. */
const TEAM_AREA = [33, 67] as const;

export interface Figure extends Pt {
  opacity: number;
}

export interface InjuryScene {
  duration: number;
  exit: Exit;
  /** A man on the field other than the hurt one (null for an id the scene doesn't know). */
  at(id: number, t: number): Figure | null;
  hurt(t: number): Figure;
  /** The trainers (two), and the cart (null until it's called for, and for a man who walks off). */
  trainers(t: number): Figure[];
  cart(t: number): Figure | null;
  /** Where everyone else stands when it's over: the next snap's jog starts from here. */
  after: Map<number, Mark>;
}

/** A man's walk from `a` to `b`: up to speed, steady, pulling up at the end (as `transition.ts` runs them). */
function walk(a: Pt, b: Pt, t0: number, pace: number, t: number): Pt {
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  const dur = Math.max(0.3, len / pace);
  const k = Math.min(1, Math.max(0, (t - t0) / dur));
  const s = 0.15;
  const v = 1 / (1 - s);
  const g = k < s ? (0.5 * v * k * k) / s : k > 1 - s ? 1 - (0.5 * v * (1 - k) * (1 - k)) / s : v * (k - s / 2);
  return { x: a.x + (b.x - a.x) * g, y: a.y + (b.y - a.y) * g };
}
const takes = (a: Pt, b: Pt, pace: number) => Math.max(0.3, Math.hypot(b.x - a.x, b.y - a.y) / pace);

export function injuryScene(spots: ReadonlyMap<number, Mark>, hurtId: number, exit: Exit, seed: string): InjuryScene {
  const rng = new Rng(seed);
  const down = spots.get(hurtId)!;
  const sideline = down.home ? -BENCH : FIELD_W + BENCH;

  // Each team gathers on its own side of him (toward where its men are), in a loose knot.
  const centre = (home: boolean): Pt => {
    const mine = [...spots].filter(([id, m]) => id !== hurtId && m.home === home);
    const cx = mine.reduce((s, [, m]) => s + m.x, 0) / Math.max(1, mine.length);
    const cy = mine.reduce((s, [, m]) => s + m.y, 0) / Math.max(1, mine.length);
    let dx = cx - down.x;
    let dy = cy - down.y;
    const d = Math.hypot(dx, dy);
    if (d < 1) [dx, dy] = [home ? -1 : 1, 0];
    const n = Math.hypot(dx, dy);
    return {
      x: down.x + (dx / n) * CLEAR,
      y: Math.max(3, Math.min(FIELD_W - 3, down.y + (dy / n) * CLEAR)),
    };
  };
  const knots = { true: centre(true), false: centre(false) };
  const moves = new Map<number, { from: Pt; to: Pt; start: number }>();
  const seat = { true: 0, false: 0 };
  for (const [id, m] of spots) {
    if (id === hurtId) continue;
    const from = { x: m.x, y: m.y };
    if (Math.hypot(m.x - down.x, m.y - down.y) > GATHER) {
      moves.set(id, { from, to: from, start: 0 });
      continue;
    }
    const k = knots[`${m.home}`];
    const i = seat[`${m.home}`]++;
    const angle = i * 2.4;
    const r = 1.4 + Math.sqrt(i) * 0.9;
    moves.set(id, {
      from,
      to: { x: k.x + Math.cos(angle) * r, y: Math.max(1, Math.min(FIELD_W - 1, k.y + Math.sin(angle) * r)) },
      start: BEAT + rng.next() * 0.8,
    });
  }

  // The trainers: out of his team area to either side of him.
  const area = { x: Math.max(TEAM_AREA[0], Math.min(TEAM_AREA[1], down.x)), y: sideline };
  const beside = [
    { x: down.x - 1.1, y: down.y + 0.4 },
    { x: down.x + 1.1, y: down.y - 0.4 },
  ];
  const outs = beside.map((b, i) => ({
    from: { x: area.x + (i ? 1.5 : -1.5), y: area.y },
    to: b,
    start: BEAT + 0.3 + i * 0.25,
  }));
  const arrived = Math.max(...outs.map((o) => o.start + takes(o.from, o.to, TRAINER)));

  // The cart, called once the trainers have seen him: it pulls up alongside.
  const cartFrom = { x: area.x, y: sideline };
  const cartTo = { x: down.x, y: down.y + (down.home ? -2.2 : 2.2) };
  const cartOut = arrived + 0.6;
  const cartIn = cartOut + takes(cartFrom, cartTo, CART);

  // Off the field: toward his sideline, angling a little toward the team area.
  const tended = Math.max(arrived, exit === 'cart' ? cartIn : 0) + TEND[exit];
  const gate = { x: down.x + (area.x - down.x) * 0.5, y: down.home ? -1.5 : FIELD_W + 1.5 };
  const leaveFrom = exit === 'cart' ? cartTo : { x: down.x, y: down.y };
  // On the cart he's helped up and on first.
  const boarding = exit === 'cart' ? 0.8 : 0;
  const offAt = tended + boarding;
  const offFor = takes(leaveFrom, gate, OFF[exit]);
  const gone = offAt + offFor;
  const duration = gone + 0.6;

  /** Fading as he crosses the sideline. */
  const fade = (t: number) => Math.max(0, Math.min(1, 1 - (t - (gone - 0.5)) / 0.5));
  const leaving = (t: number) => walk(leaveFrom, gate, offAt, OFF[exit], t);

  const after = new Map<number, Mark>();
  for (const [id, mv] of moves) after.set(id, { ...mv.to, home: spots.get(id)!.home });

  return {
    duration,
    exit,
    after,
    at(id, t) {
      const mv = moves.get(id);
      if (!mv) return null;
      return { ...walk(mv.from, mv.to, mv.start, WALK, t), opacity: 1 };
    },
    hurt(t) {
      if (t < tended) return { x: down.x, y: down.y, opacity: 1 };
      if (exit === 'cart') {
        // Helped up onto the cart, then gone with it.
        if (t < offAt) {
          const k = (t - tended) / boarding;
          return { x: down.x + (cartTo.x - down.x) * k, y: down.y + (cartTo.y - down.y) * k, opacity: 1 - k * 0.6 };
        }
        return { ...leaving(t), opacity: 0.4 * fade(t) };
      }
      return { ...leaving(t), opacity: fade(t) };
    },
    trainers(t) {
      return outs.map((o, i) => {
        if (t < o.start) return { ...o.from, opacity: 0 };
        if (t < tended)
          return { ...walk(o.from, o.to, o.start, TRAINER, t), opacity: Math.min(1, (t - o.start) / 0.3) };
        const p = exit === 'cart' && t >= offAt ? leaving(t) : t < offAt ? o.to : leaving(t);
        if (exit === 'cart' && t >= offAt) return { x: p.x + (i ? 1.2 : -1.2), y: p.y, opacity: fade(t) };
        // At his side on the way off: one trainer under each arm when he's helped, else one beside and one behind.
        const side = exit === 'helped' ? (i ? 1 : -1) * 1.1 : i ? 1.1 : 0;
        const back = exit === 'walk' && !i ? 1.4 : 0;
        const toward = down.home ? 1 : -1;
        return { x: p.x + side, y: p.y + back * toward, opacity: fade(t) };
      });
    },
    cart(t) {
      if (exit !== 'cart' || t < cartOut) return null;
      if (t < offAt) return { ...walk(cartFrom, cartTo, cartOut, CART, t), opacity: Math.min(1, (t - cartOut) / 0.4) };
      return { ...leaving(t), opacity: fade(t) };
    },
  };
}
