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
const HIT_PACE = 8;
/** The flag lands a step off the man it's on. */
const FLAG_OFF = 1.1;
/** A hold: how long he hangs on (seconds), how much of his way the held man still makes, and the letting go. */
const HELD = 0.9;
const DRAG = 0.35;
const LET_GO = 0.5;
/** How much quicker than his own pace a man let go makes his ground back up (yards a second). */
const CATCH_UP = 2.5;
/** A man flat out, a step (yards in a twentieth of a second): as `steer.ts` caps everyone it moves. */
const MAX_STEP = 0.55;

export function stageFouls(
  s: StagedPlay,
  fouls: readonly { id: number | null; phase: FoulPhase; label?: string }[],
): FouledPlay {
  const labels = fouls.map((f) => f.label ?? '');
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
        // Interference: the contact just before the ball gets there (a kick-catch foul, as it comes down).
        return s.arrive === null ? total * 0.8 : kick ? s.arrive : Math.max(0.1, s.arrive - 0.2);
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
   * Fouler `k` gets to man `j` by `tHit` (unless he's there already), a full-speed run straight in, and stays on him:
   * through the rest of the play, or until `release` seconds from the snap, when he lets go and drifts back to his own
   * path. `behind`: he comes at him from behind (a block in the back), whatever side he started on.
   */
  const hit = (k: number, j: number, tHit: number, release = Infinity, behind = false) => {
    if (j < 0 || j === k) return;
    const sh = stepAt(tHit);
    const there = P(sh, j);
    const own = (st: number) => ({ x: s.pos[(st * n + k) * 2], y: s.pos[(st * n + k) * 2 + 1] });
    const near = Math.hypot(P(sh, k).x - there.x, P(sh, k).y - there.y) <= CONTACT * 2;
    if (near && release === Infinity && !behind) return;
    // Behind him (a block in the back): back along the way he's heading.
    const prev = P(Math.max(0, sh - 4), j);
    const hl = Math.hypot(there.x - prev.x, there.y - prev.y) || 1;
    const rear = { x: (-(there.x - prev.x) / hl) * CONTACT, y: (-(there.y - prev.y) / hl) * CONTACT };
    const aim = behind ? { x: there.x + rear.x, y: there.y + rear.y } : there;
    let s0 = Math.max(0, sh - Math.round(0.5 / s.dt));
    while (s0 > 0 && Math.hypot(P(s0, k).x - aim.x, P(s0, k).y - aim.y) / ((sh - s0) * s.dt) > HIT_PACE) s0--;
    const from = P(s0, k);
    let off: Pt;
    if (behind) off = rear;
    else {
      const d = Math.hypot(from.x - there.x, from.y - there.y) || 1;
      off = { x: ((from.x - there.x) / d) * CONTACT, y: ((from.y - there.y) / d) * CONTACT };
    }
    const sr = release === Infinity ? Infinity : stepAt(release);
    // Back onto his own path at a jog's pace at most: the further he was pulled off it, the longer it takes.
    const gap = sr === Infinity ? 0 : Math.hypot(P(sr, j).x + off.x - own(sr).x, P(sr, j).y + off.y - own(sr).y);
    const back = Math.round(Math.max(LET_GO, gap / 4) / s.dt);
    for (let st = s0 + 1; st <= last; st++) {
      const on = P(st, j);
      const to = { x: on.x + off.x, y: on.y + off.y };
      if (st < sh) {
        // Straight at the spot where he'll meet him (not at where he is: that would add his speed to the run).
        const g = (st - s0) / (sh - s0);
        const meet = { x: there.x + off.x, y: there.y + off.y };
        put(st, k, { x: from.x + (meet.x - from.x) * g, y: from.y + (meet.y - from.y) * g });
      } else if (st <= sr) put(st, k, to);
      else {
        // Letting go: from where he let go, back onto his own path.
        const g = Math.min(1, (st - sr) / back);
        const freed = { x: P(sr, j).x + off.x, y: P(sr, j).y + off.y };
        const mine = own(st);
        const e = g * g * (3 - 2 * g);
        put(st, k, { x: freed.x + (mine.x - freed.x) * e, y: freed.y + (mine.y - freed.y) * e });
      }
    }
  };
  /**
   * A man held: from `t0`, he moves at a share of his pace while the holder hangs on (`HELD` seconds), then makes the
   * ground back up over half a second. Only a man the play isn't about (his path is his own, steered).
   */
  const held = (j: number, t0: number) => {
    const s0 = stepAt(t0);
    const s1 = Math.min(last, s0 + Math.round(HELD / s.dt));
    const base = (st: number) => ({ x: s.pos[(st * n + j) * 2], y: s.pos[(st * n + j) * 2 + 1] });
    const anchor = base(s0);
    // Dragging him back: he only gets a third of the way he'd have gone.
    let lag = { x: 0, y: 0 };
    for (let st = s0 + 1; st <= s1; st++) {
      const b = base(st);
      const p = { x: anchor.x + (b.x - anchor.x) * DRAG, y: anchor.y + (b.y - anchor.y) * DRAG };
      lag = { x: p.x - b.x, y: p.y - b.y };
      put(st, j, p);
    }
    // Let go, he makes the ground back up a little quicker than his own pace (or the play's over first).
    const s2 = Math.min(last, s1 + Math.round(Math.max(LET_GO, Math.hypot(lag.x, lag.y) / CATCH_UP) / s.dt));
    for (let st = s1 + 1; st <= last; st++) {
      const b = base(st);
      const g = Math.min(1, (st - s1) / Math.max(1, s2 - s1 + (s2 === last ? 1 : 0)));
      const e = g * g * (3 - 2 * g);
      put(st, j, { x: b.x + lag.x * (1 - e), y: b.y + lag.y * (1 - e) });
    }
  };
  /** The man nearest `k` at `t` on the other side whom the play isn't about: the one he holds or blocks. */
  const victim = (k: number, t: number, pool: (j: number) => boolean = () => true) => {
    const st = stepAt(t);
    const busy = new Set(s.keys.map((id) => s.ids.indexOf(id)));
    return nearest((j) => s.offense[j] !== s.offense[k] && !busy.has(j) && pool(j), P(st, k), st);
  };

  // First every foul acted out; then the men it moved held to a man's pace; then the flags, on where they are.
  const acted = fouls.map(({ id, phase }, fi) => {
    const k = id === null ? -1 : s.ids.indexOf(id);
    let at = Math.min(total, timeOf(phase));
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
      // The punter on a punt; on a kick at the posts the kicker (the punter's holding for him).
      else if (phase === 'afterKick') hit(k, s.kind === 'punt' ? role('P', true) : role('K', true), at);
      else if (phase === 'ball') {
        // On the returner as the kick comes down; on the receiver the ball was thrown to as it arrives.
        const j =
          s.kind === 'punt' || s.kind === 'kickoff'
            ? role('RET', false)
            : nearest((x) => s.offense[x] && s.roles[x] !== 'QB', ballAt(at), stepAt(at));
        hit(k, j, at);
      } else if (phase === 'during') {
        // Holding (or a hold on a return): he grabs the man nearest him, who's slowed while he hangs on; a block in
        // the back comes from behind and shoves him on. A defensive hold is on a receiver.
        const inBack = /back/i.test(labels[fi]);
        const receiver = (x: number) => s.roles[x] === 'WR' || s.roles[x] === 'TE' || s.roles[x] === 'RB';
        const pool = !s.offense[k] && !kick ? receiver : undefined;
        // The hold comes when he's on someone: the moment, around the play's own, when he's nearest a man he could
        // hold (he doesn't run across the field to commit it).
        let j = -1;
        let best = Infinity;
        for (let t = Math.max(0.8, at - 1); t <= Math.min(total - 0.2, at + 0.8); t += s.dt * 2) {
          const v = victim(k, t, pool);
          if (v < 0) continue;
          const d = Math.hypot(P(stepAt(t), k).x - P(stepAt(t), v).x, P(stepAt(t), k).y - P(stepAt(t), v).y);
          if (d < best) [best, j, at] = [d, v, t];
        }
        // Still a step or two off him then: the grab comes once he's got there.
        if (j >= 0) at = Math.min(total - 0.1, at + Math.max(0, best - CONTACT * 2) / HIT_PACE);
        if (j >= 0) {
          if (!inBack) held(j, at - 0.15);
          hit(k, j, at, at - 0.15 + HELD, inBack);
        }
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
    return { k, at, phase };
  });
  // No step quicker than a man runs, or than the play already had him going: whoever acting out a foul moved (the
  // fouler, the man he held) is held to it, catching up over the next steps if a step asked for more.
  for (let j = 0; j < n; j++) {
    let moved = false;
    for (let i = j * 2; i < pos.length && !moved; i += n * 2)
      moved = pos[i] !== s.pos[i] || pos[i + 1] !== s.pos[i + 1];
    if (!moved) continue;
    for (let st = 1; st <= last; st++) {
      const a = (st - 1) * n + j;
      const b = st * n + j;
      const was = Math.hypot(s.pos[b * 2] - s.pos[a * 2], s.pos[b * 2 + 1] - s.pos[a * 2 + 1]);
      const lim = Math.max(MAX_STEP, was + 0.005);
      const dx = pos[b * 2] - pos[a * 2];
      const dy = pos[b * 2 + 1] - pos[a * 2 + 1];
      const d = Math.hypot(dx, dy);
      if (d > lim) {
        pos[b * 2] = pos[a * 2] + (dx / d) * lim;
        pos[b * 2 + 1] = pos[a * 2 + 1] + (dy / d) * lim;
      }
    }
  }
  const out: StagedFoul[] = acted.map(({ k, at, phase }) => {
    // A kick out of bounds is flagged where it went out; anything else, on the man who did it.
    const where =
      phase === 'out'
        ? ballAt(at)
        : k >= 0
          ? P(stepAt(at), k)
          : phase === 'early' || phase === 'snap'
            ? ballAt(0)
            : ballAt(at);
    return { id: k >= 0 ? s.ids[k] : null, at, spot: { x: where.x, y: where.y + FLAG_OFF } };
  });
  return { ...s, pos, keys, reveal, until, fouls: out };
}
