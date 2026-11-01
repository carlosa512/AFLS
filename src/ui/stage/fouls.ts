/**
 * The fouls on a staged play, acted out: when each happens and where (which is when and where its flag flies), and
 * what the man who did it does to earn it. A false start is one man moving early while everyone else holds; offside, a
 * man across the line at the snap; roughing the passer or the kicker, a hit on him just after the ball's away; a late
 * or a dirty hit, the man on the carrier at the whistle; interference, the man on the receiver (or the returner) as
 * the ball arrives. Holding and the return's blocks need no acting: the flag finds the man where he is. Pure: a staged
 * play in, a staged play out.
 */
import type { FoulPhase } from './calls';
import type { Pt } from './formations';
import type { StagedPlay } from './stage';

/** A foul on the play: who (null when he isn't on the field), when (seconds from the snap) and where. */
export interface StagedFoul {
  id: number | null;
  at: number;
  spot: Pt;
}

export type FouledPlay = StagedPlay & { fouls: StagedFoul[] };

/** A false start: he's set, then lurches forward, then stands up, as the whistle goes. */
const FLINCH = { set: 0.25, lurch: 0.2, yards: 0.9, standAt: 0.9, stand: 0.45, back: 0.55 };
/** Offside: how far across the line he is at the snap, and how soon the play has him back in its flow. */
const ACROSS = 0.9;
const ACROSS_FADE = 1;
/** A hit: the closest he comes (yards), and the quickest he runs to it. */
const CONTACT = 0.8;
const HIT_PACE = 8.5;
/** The flag lands a step off the man it's on. */
const FLAG_OFF = 1.1;

export function stageFouls(s: StagedPlay, fouls: readonly { id: number | null; phase: FoulPhase }[]): FouledPlay {
  if (!fouls.length) return { ...s, fouls: [] };
  const n = s.ids.length;
  const last = s.steps - 1;
  const total = last * s.dt;
  const pos = s.pos.slice();
  const keys = s.keys.slice();
  const reveal = s.reveal.slice();
  const until = s.until.slice();
  const P = (st: number, k: number): Pt => ({ x: pos[(st * n + k) * 2], y: pos[(st * n + k) * 2 + 1] });
  const put = (st: number, k: number, p: Pt) => {
    pos[(st * n + k) * 2] = p.x;
    pos[(st * n + k) * 2 + 1] = p.y;
  };
  const stepAt = (t: number) => Math.max(0, Math.min(last, Math.round(t / s.dt)));
  const ballAt = (t: number): Pt => ({ x: s.ball[stepAt(t) * 3], y: s.ball[stepAt(t) * 3 + 1] });
  const role = (r: string, offense: boolean) => s.roles.findIndex((x, k) => x === r && s.offense[k] === offense);
  const nearest = (pool: (k: number) => boolean, to: Pt, st: number) => {
    let best = -1;
    let d = Infinity;
    for (let k = 0; k < n; k++) {
      if (!pool(k)) continue;
      const p = P(st, k);
      const dd = Math.hypot(p.x - to.x, p.y - to.y);
      if (dd < d) [d, best] = [dd, k];
    }
    return best;
  };
  const kick = s.kind === 'kickoff' || s.kind === 'punt' || s.kind === 'fg' || s.kind === 'xp';

  /** When the foul happens, by its phase and the play's own beats. */
  const timeOf = (phase: FoulPhase): number => {
    switch (phase) {
      case 'early':
        return s.kind === 'penalty' ? FLINCH.set + FLINCH.lurch : 0.1;
      case 'snap':
        return s.kind === 'kickoff' ? Math.max(0.1, s.release - 0.2) : 0.15;
      case 'during':
        // A return's block, halfway through the return; a hold on a run once the back has it; on a dropback, in the
        // pocket (or, downfield, as the ball goes).
        if (kick && s.arrive !== null) return s.arrive + (total - s.arrive) * 0.5;
        return s.kind === 'run' ? s.release + 0.5 : Math.min(1.4, s.release);
      case 'ball':
        return s.arrive ?? total * 0.8;
      case 'afterThrow':
      case 'afterKick':
        return s.release + 0.3;
      case 'whistle':
        return total;
      case 'out':
        return s.arrive ?? total;
    }
  };

  /**
   * Fouler `k` gets to man `j` by `tHit` (unless he's there already), a full-speed run straight in, and stays on him
   * through the rest of the play.
   */
  const hit = (k: number, j: number, tHit: number) => {
    if (j < 0 || j === k) return;
    const sh = stepAt(tHit);
    const there = P(sh, j);
    if (Math.hypot(P(sh, k).x - there.x, P(sh, k).y - there.y) <= CONTACT * 2) return;
    let s0 = Math.max(0, sh - Math.round(0.5 / s.dt));
    while (s0 > 0 && Math.hypot(P(s0, k).x - there.x, P(s0, k).y - there.y) / ((sh - s0) * s.dt) > HIT_PACE) s0--;
    const from = P(s0, k);
    const d = Math.hypot(from.x - there.x, from.y - there.y) || 1;
    const off = { x: ((from.x - there.x) / d) * CONTACT, y: ((from.y - there.y) / d) * CONTACT };
    for (let st = s0 + 1; st <= last; st++) {
      const on = P(st, j);
      const to = { x: on.x + off.x, y: on.y + off.y };
      if (st >= sh) put(st, k, to);
      else {
        const g = (st - s0) / (sh - s0);
        put(st, k, { x: from.x + (to.x - from.x) * g, y: from.y + (to.y - from.y) * g });
      }
    }
  };

  const out: StagedFoul[] = fouls.map(({ id, phase }) => {
    const k = id === null ? -1 : s.ids.indexOf(id);
    const at = Math.min(total, timeOf(phase));
    if (k >= 0) {
      // Toward the other side of the ball: the offense's way for an offensive foul, back at it for a defensive one.
      const across = s.offense[k] ? s.dir : -s.dir;
      if (phase === 'early' && s.kind === 'penalty') {
        // Everyone holds; he alone moves: set, a lurch forward, then up out of his stance as the whistle goes.
        const p0 = P(0, k);
        for (let st = 0; st <= last; st++) {
          const t = st * s.dt;
          const lurch = Math.min(1, Math.max(0, (t - FLINCH.set) / FLINCH.lurch)) * FLINCH.yards;
          const stand = Math.min(1, Math.max(0, (t - FLINCH.standAt) / FLINCH.stand)) * FLINCH.back;
          put(st, k, { x: p0.x + across * (lurch - stand), y: p0.y });
        }
      } else if (phase === 'snap') {
        // Across the line at the snap; the play takes him back into its flow.
        for (let st = 0; st <= last; st++) {
          const g = Math.max(0, 1 - (st * s.dt) / ACROSS_FADE);
          if (g <= 0) break;
          const p = P(st, k);
          put(st, k, { x: p.x + across * ACROSS * g, y: p.y });
        }
      } else if (phase === 'afterThrow') hit(k, role('QB', true), at);
      else if (phase === 'afterKick') hit(k, Math.max(role('P', true), role('K', true)), at);
      else if (phase === 'ball') {
        // On the returner as the kick comes down; on the receiver the ball was thrown to as it arrives.
        const j =
          s.kind === 'punt' || s.kind === 'kickoff'
            ? role('RET', false)
            : nearest((x) => s.offense[x] && s.roles[x] !== 'QB', ballAt(at), stepAt(at));
        hit(k, j, at);
      } else if (phase === 'whistle') {
        const c = s.carrier === null ? -1 : s.ids.indexOf(s.carrier);
        hit(k, c >= 0 ? c : nearest((x) => s.offense[x] !== s.offense[k], ballAt(at), last), at);
      }
      // Ringed as the flag flies: he's the man it's on.
      const i = keys.indexOf(s.ids[k]);
      const show = Math.max(0, at - 0.15);
      if (i < 0) {
        keys.push(s.ids[k]);
        reveal.push(show);
        until.push(Infinity);
      } else {
        reveal[i] = Math.min(reveal[i], show);
        until[i] = Infinity;
      }
    }
    const where = k >= 0 ? P(stepAt(at), k) : phase === 'early' || phase === 'snap' ? ballAt(0) : ballAt(at);
    return { id: k >= 0 ? s.ids[k] : null, at, spot: { x: where.x, y: where.y + FLAG_OFF } };
  });
  return { ...s, pos, keys, reveal, until, fouls: out };
}
