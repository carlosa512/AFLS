/**
 * The bowl itself: the plaza, the ground inside, the back wall, and each deck from the top down (its bank, its rows
 * and the people on them, stairs and tunnels, its front face and rail, the dark gap under it).
 */
import { Rng } from '../../engine/rng';
import { at, DECKS, type Post } from './bowl';
import { CAM, FRAME, toFrame } from './camera';
import { mix } from './colour';
import { crowdPalette, sectionFill } from './crowd';
import { byColour, type Pt } from './pen';
import { SLAB_CUT, slabReach, slabTop } from './roof';
import type { Building, Scene } from './types';

const A = (p: Post, d: number, y: number): Pt => {
  const q = at(p, d, y);
  return [q.x, q.y];
};
/** A stair runs up the bank every thirteenth post. */
const aisle = (i: number) => i % 13 === 6;
const tri = (v: number) => {
  const p = v - Math.floor(v);
  return p < 0.5 ? p * 2 : 2 - p * 2;
};

export interface Bowl {
  wall: Post[];
  /** How lit a stretch of the bowl is, by the way it faces. */
  light(p: Post): number;
  /** The posts where only the lower deck stands (an open end). */
  open(i: number): boolean;
  /** The top of the back wall at a post. */
  rim(p: Post): number;
}

export function bowlOf(b: Building, wall: Post[]): Bowl {
  const decks = b.decks ?? DECKS;
  const top = decks[decks.length - 1];
  const slab = b.roof?.kind === 'slab' ? b.roof : null;
  const { xr, zb } = slabReach(top);
  const stub = top.y1 + 2.4;
  return {
    wall,
    light: (p) => (slab ? 0.9 : Math.max(0.62, Math.min(1, 0.84 + 0.16 * (p.nx * -0.55 + p.nz * 0.75)))),
    open: (i) =>
      (b.openEnd === 'left' ? i < 74 : b.openEnd === 'right' ? i > wall.length - 75 : false) ||
      (!!b.openCorners && (wall[i].part === 'LC' || wall[i].part === 'RC')),
    rim: (p) => {
      if (slab) {
        const x = p.x + p.nx * (top.d1 + 1);
        const z = p.z + p.nz * (top.d1 + 1);
        // beyond the cut the wall runs up to the roof's underside; in front of it, it stops at the rim
        return z >= SLAB_CUT
          ? Math.max(stub, slabTop(slab, Math.max(-xr, Math.min(xr, x)), Math.min(zb, z), xr, zb) - slab.th)
          : stub;
      }
      if (b.rim.kind === 'peaks')
        return b.rim.h + b.rim.rise * tri(p.u / b.rim.every) * (0.45 + 0.55 * Math.abs(Math.sin(p.u / 26)));
      if (b.rim.kind === 'battlements') return b.rim.h + (Math.floor(p.i / 3) % 2 ? b.rim.step : 0);
      if (b.rim.kind === 'sawtooth') return b.rim.h + b.rim.rise * (p.u / b.rim.every - Math.floor(p.u / b.rim.every));
      if (b.rim.kind === 'saddle') return b.rim.h + b.rim.rise * Math.min(1, Math.abs(p.x) / 60) ** 2;
      return b.rim.h;
    },
  };
}

/** The plaza round the outside, and the ground inside the wall. */
export function paintGround(s: Scene, b: Building, bowl: Bowl) {
  const decks = b.decks ?? DECKS;
  const top = decks[decks.length - 1];
  const plaza = s.snowy ? mix(b.plaza ?? '#b4b8b4', '#eef2f4', 0.6) : (b.plaza ?? '#b4b8b4');
  const { wall } = bowl;
  for (let i = 0; i < wall.length - 1; i++)
    s.pen.poly(
      [
        A(wall[i], top.d1 + 1, 0),
        A(wall[i + 1], top.d1 + 1, 0),
        A(wall[i + 1], top.d1 + 11, 0),
        A(wall[i], top.d1 + 11, 0),
      ],
      s.tone(plaza, s.look.night ? 0.6 : 1),
    );
  s.pen.poly([...wall.map((p) => A(p, 0, 0)), [FRAME.w, FRAME.h], [0, FRAME.h]], s.tone('#1d3a27'));
}

export function paintBowl(s: Scene, b: Building, bowl: Bowl, seed: string) {
  const { pen, look } = s;
  const { wall, light, open, rim } = bowl;
  const N = wall.length;
  const decks = b.decks ?? DECKS;
  const top = decks[decks.length - 1];
  const crowd = new Rng(`${seed}:crowd`);
  const wear = crowdPalette(s.colors);
  const chair = b.chair ?? mix(b.seat, '#93a3b3', 0.3);
  const mood = new Map<number, number>();
  const lean = (key: number) => {
    let m = mood.get(key);
    if (m === undefined) mood.set(key, (m = new Rng(`${seed}:sec:${key}`).next() - 0.5));
    return m;
  };
  const dark = 'rgba(8,11,13,.92)';

  // the back wall under the rim
  const wallFill = (k: number) => (b.wallGlass ? glass(s.tone(b.wall, k)) : s.tone(b.wall, k));
  for (let i = 0; i < N - 1; i++) {
    if (open(i)) continue;
    const a = wall[i];
    const c = wall[i + 1];
    pen.poly(
      [A(a, top.d1 + 1, top.y1), A(c, top.d1 + 1, top.y1), A(c, top.d1 + 1, rim(c)), A(a, top.d1 + 1, rim(a))],
      wallFill(light(a)),
    );
  }
  if (b.windows)
    for (let i = 2; i < N - 3; i += 3) {
      if (open(i)) continue;
      const a = wall[i];
      const c = wall[i + 2];
      const y0 = top.y1 + 0.5;
      const y1 = Math.min(rim(a), rim(c)) - 0.5;
      const lit = look.night ? s.lamp('#f3d37a') : s.tone(b.windows);
      pen.poly([A(a, top.d1 + 0.9, y0), A(c, top.d1 + 0.9, y0), A(c, top.d1 + 0.9, y1), A(a, top.d1 + 0.9, y1)], lit);
    }

  for (let ti = decks.length - 1; ti >= 0; ti--) {
    const T = decks[ti];
    const rowD = (r: number) => T.d0 + ((T.d1 - T.d0) * r) / T.rows;
    const rowY = (r: number) => T.y0 + ((T.y1 - T.y0) * r) / T.rows;
    const gone = (i: number) => ti > 0 && open(i);
    // where a deck stops at an open end, its cut side shows
    for (let i = 1; i < N - 1; i++)
      if (ti > 0 && gone(i) !== gone(i - 1)) {
        const p = wall[i];
        pen.poly(
          [
            A(p, T.d0, T.y0 - T.face),
            A(p, T.d0, T.y0),
            A(p, T.d1, T.y1),
            A(p, T.d1 + 1, T.y1),
            A(p, T.d1 + 1, 0),
            A(p, T.d0, 0),
          ],
          s.tone(b.wall, 0.8),
        );
      }
    for (let i = 0; i < N - 1; i++) {
      if (gone(i)) continue;
      const a = wall[i];
      const c = wall[i + 1];
      pen.poly(
        [A(a, T.d0, T.y0), A(c, T.d0, T.y0), A(c, T.d1, T.y1), A(a, T.d1, T.y1)],
        s.tone(b.seat, light(a) * (ti === decks.length - 1 ? 1.08 : 1)),
      );
    }
    for (let r = T.rows - 1; r >= 0; r--) {
      const d = rowD(r + 0.5);
      const y = rowY(r + 0.5);
      let run: Pt[] = [];
      const end = () => {
        if (run.length > 1) pen.line(run, 'rgba(0,0,0,.28)', 0.22);
        run = [];
      };
      wall.forEach((p, i) => (gone(i) ? end() : run.push(A(p, rowD(r), rowY(r)))));
      end();
      // back rows under the deck above sit in its shade
      const under = ti < decks.length - 1 ? Math.max(0, Math.min(1, (d - (decks[ti + 1].d0 - 5)) / 5)) : 0;
      for (let i = 0; i < N - 1; i++) {
        if (gone(i) || aisle(i)) continue;
        const a = wall[i];
        const c = wall[i + 1];
        const ax = a.x + a.nx * d;
        const az = a.z + a.nz * d;
        const bx = c.x + c.nx * d;
        const bz = c.z + c.nz * d;
        const n = Math.max(1, Math.round(Math.hypot(bx - ax, bz - az) / 1.02));
        const k = light(a) * (1 - 0.45 * (open(i) ? 0 : under));
        const here = sectionFill(look.fill, ti, a.part, lean(ti * 100 + Math.floor(i / 13)));
        const empty = s.tone(chair, k);
        const worn = wear.map((c0) => s.tone(c0, k));
        for (let q = 0; q < n; q++) {
          const f = (q + 0.5) / n;
          const came = crowd.next() < here;
          const pick = crowd.next();
          const p = toFrame(ax + (bx - ax) * f, y + (came ? 0.55 : 0.3), az + (bz - az) * f);
          const rad = Math.max(0.125, (CAM.f * (came ? 0.36 : 0.27)) / p.depth);
          if (!came) pen.box(p.x - rad, p.y - rad * 0.7, rad * 2, rad * 1.4, empty);
          else pen.dot(p.x, p.y, rad, worn[pick < 0.5 ? 0 : pick < 0.66 ? 1 : pick < 0.8 ? 2 : pick < 0.9 ? 3 : 4]);
        }
      }
    }
    pen.flush();
    // the stairs between sections, and the tunnels into them
    for (let i = 0; i < N - 1; i++) {
      if (!aisle(i) || gone(i)) continue;
      const a = wall[i];
      const c = wall[i + 1];
      pen.poly(
        [A(a, T.d0, T.y0), A(c, T.d0, T.y0), A(c, T.d1, T.y1), A(a, T.d1, T.y1)],
        s.tone('#9aa1a4', light(a) * 0.9),
      );
      if (T.rows > 8 && i % 26 === 6) {
        const r0 = Math.floor(T.rows * 0.42);
        const a2 = wall[Math.max(0, i - 1)];
        const c2 = wall[Math.min(N - 1, i + 2)];
        pen.poly(
          [
            A(a2, rowD(r0), rowY(r0)),
            A(c2, rowD(r0), rowY(r0)),
            A(c2, rowD(r0 + 2), rowY(r0 + 2) + 0.4),
            A(a2, rowD(r0 + 2), rowY(r0 + 2) + 0.4),
          ],
          '#0b0e10',
        );
      }
    }
    // the deck's front: a face with a ribbon board and a rail; under it, the dark gap where the concourse runs.
    // Gathered first and drawn a colour at a time: none of them overlaps another of its kind.
    const gaps: [Pt[], string][] = [];
    const faces: [Pt[], string][] = [];
    const boards: [Pt[], string][] = [];
    const front = ti ? (b.face ?? wear[1]) : mix(s.colors[0], '#000000', 0.45);
    for (let i = 0; i < N - 1; i++) {
      if (gone(i)) continue;
      const a = wall[i];
      const c = wall[i + 1];
      const k = light(a);
      if (ti) {
        const U = decks[ti - 1];
        gaps.push([[A(a, U.d1, U.y1), A(c, U.d1, U.y1), A(c, T.d0, T.y0 - T.face), A(a, T.d0, T.y0 - T.face)], dark]);
        const board = i % 9 < 5 ? s.colors[0] : '#f4f4f0';
        boards.push([
          [
            A(a, T.d0, T.y0 - T.face * 0.62),
            A(c, T.d0, T.y0 - T.face * 0.62),
            A(c, T.d0, T.y0 - T.face * 0.3),
            A(a, T.d0, T.y0 - T.face * 0.3),
          ],
          look.night ? s.lamp(board) : s.tone(board, k),
        ]);
      }
      faces.push([
        [A(a, T.d0, T.y0 - T.face), A(c, T.d0, T.y0 - T.face), A(c, T.d0, T.y0), A(a, T.d0, T.y0)],
        s.tone(front, k),
      ]);
    }
    byColour(pen, gaps);
    byColour(pen, faces);
    byColour(pen, boards);
    let rail: Pt[] = [];
    const endRail = () => {
      if (rail.length > 1) pen.line(rail, 'rgba(240,244,246,.75)', 0.2);
      rail = [];
    };
    wall.forEach((p, i) => (gone(i) ? endRail() : rail.push(A(p, T.d0, T.y0 + 0.35))));
    endRail();
  }
  // lights along the rim of an open-air ground with no roof
  if (!b.roof)
    for (let i = 4; i < N - 4; i += 6) {
      if (open(i)) continue;
      const p = at(wall[i], top.d1 + 1, rim(wall[i]));
      pen.box(p.x - 1.4, p.y - 0.5, 2.8, 0.7, s.lamp('#f7f7f2'));
    }
  pen.flush();
}

/** A colour as glass: mostly see-through. */
function glass(hex: string): string {
  const n = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return `rgba(${n[0]},${n[1]},${n[2]},.55)`;
}
