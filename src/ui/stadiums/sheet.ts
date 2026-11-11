/**
 * The owner's review pages (`npm run stadiums -- <group>`): each building of a group painted on a canvas, with the
 * field sketched over it, and switches for the crowd, the light, the weather and the roof. Nothing in the app imports
 * this: it is bundled into a page of its own.
 */
import { TEAM_SEEDS } from '../../engine/data/teams';
import { buildingFor, roofKindOf } from './buildings';
import { CAM, FRAME, toFrame } from './camera';
import { lift, lum } from './colour';
import { FILL, type Turnout } from './crowd';
import { paintStadium } from './paint';
import { canvasPen, type Pen, type Pt } from './pen';
import type { Look } from './types';

declare const GROUP: string;
const WIDTH = 1440;

export const GROUPS: Record<string, { title: string; clubs: [string, number][] }> = {
  agreed: { title: 'The five agreed', clubs: ['DEN', 'BUF', 'CIN', 'MIN', 'ATL'].map((a) => [a, 2026]) },
  checks: { title: 'What has not been seen yet', clubs: [] },
};

const P = (X: number, Y: number, Z: number): Pt => {
  const p = toFrame(X, Y, Z);
  return [p.x, p.y];
};
/** The field, sketched: in the game the field's own paint and the play are drawn over the picture instead. */
function sketchField(pen: Pen, colors: [string, string], night: boolean) {
  const k = night ? '#1f5a2b' : '#2f7d3a';
  const k2 = night ? '#246331' : '#368a41';
  for (let x = -50; x < 50; x += 5)
    pen.poly([P(x, 0, 0), P(x + 5, 0, 0), P(x + 5, 0, 53.33), P(x, 0, 53.33)], (x / 5) % 2 ? k : k2);
  for (const x of [-60, 50]) pen.poly([P(x, 0, 0), P(x + 10, 0, 0), P(x + 10, 0, 53.33), P(x, 0, 53.33)], colors[0]);
  for (let x = -50; x <= 50; x += 5)
    pen.line([P(x, 0, 0), P(x, 0, 53.33)], `rgba(255,255,255,${x % 10 ? 0.35 : 0.8})`, 0.28);
  pen.line([P(-60, 0, 0), P(60, 0, 0), P(60, 0, 53.33), P(-60, 0, 53.33), P(-60, 0, 0)], 'rgba(255,255,255,.85)', 0.5);
  const ring: Pt[] = [];
  for (let a = 0; a < 6.3; a += 0.2) ring.push(P(Math.cos(a) * 5.5, 0, 26.665 + Math.sin(a) * 5.5));
  pen.poly(ring, lum(colors[1]) < 0.1 ? colors[0] : colors[1]);
  pen.line([...ring, ring[0]], '#fff', 0.3);
  for (const [z, cols] of [
    [53.33 + 3.6, [lift(colors[0]), '#f4f4f0']],
    [-3.8, ['#e9e9e6', '#8b9399']],
  ] as [number, string[]][]) {
    pen.poly([P(-17, 0, z - 0.5), P(17, 0, z - 0.5), P(17, 0, z + 0.5), P(-17, 0, z + 0.5)], '#cfd3d4');
    for (let x = -16.5, n = 0; x <= 16.5; x += 1.15, n++) {
      const p = toFrame(x, 0.9, z);
      pen.dot(p.x, p.y, (CAM.f * 0.5) / p.depth, cols[n % 3 ? 0 : 1]);
    }
  }
  for (const x of [-60, 60]) {
    pen.line([P(x, 0, 26.665), P(x, 3.33, 26.665)], '#ffd43b', 0.45);
    pen.line([P(x, 11.6, 23.58), P(x, 3.33, 23.58), P(x, 3.33, 29.75), P(x, 11.6, 29.75)], '#ffd43b', 0.45);
  }
  pen.flush();
}

/** What is falling, over the picture (the game has its own layer for this). */
function sketchFall(ctx: CanvasRenderingContext2D, look: Look, scale: number) {
  if (look.precip === 'none' || look.roof === 'closed') return;
  let n = 7;
  const next = () => (n = (n * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 520; i++) {
    const x = next() * FRAME.w * scale;
    const y = next() * FRAME.h * scale;
    if (look.precip === 'rain') {
      ctx.strokeStyle = 'rgba(210,225,240,.45)';
      ctx.lineWidth = 0.35 * scale;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x - 1.2 * scale, y + 4.5 * scale);
      ctx.stroke();
    } else {
      ctx.fillStyle = 'rgba(255,255,255,.8)';
      ctx.beginPath();
      ctx.arc(x, y, (0.35 + next() * 0.4) * scale, 0, 6.3);
      ctx.fill();
    }
  }
}

export interface Tile {
  abbrev: string;
  season: number;
  canvas: HTMLCanvasElement;
}
const state = { turnout: 'winning' as Turnout, night: false, precip: 'none' as Look['precip'], open: true };

export function paintTile(t: Tile, over?: Partial<Look>): number {
  const club = TEAM_SEEDS.find((c) => c.abbrev === t.abbrev)!;
  const colors = club.colors as [string, string];
  const b = buildingFor(t.abbrev, t.season, colors);
  const kind = roofKindOf(b);
  const look: Look = {
    night: state.night,
    precip: state.precip,
    roof: kind === 'outdoors' ? 'none' : kind === 'dome' || !state.open ? 'closed' : 'open',
    fill: FILL[state.turnout],
    ...over,
  };
  const scale = WIDTH / FRAME.w;
  t.canvas.width = WIDTH;
  t.canvas.height = FRAME.h * scale;
  const ctx = t.canvas.getContext('2d')!;
  const t0 = performance.now();
  const pen = canvasPen(ctx, scale);
  paintStadium(pen, b, colors, look, t.abbrev);
  const ms = performance.now() - t0;
  sketchField(pen, colors, look.night);
  sketchFall(ctx, look, scale);
  return ms;
}

function mount() {
  const group = GROUPS[GROUP];
  const root = document.getElementById('root')!;
  document.getElementById('title')!.textContent = group.title;
  const tiles: Tile[] = group.clubs.map(([abbrev, season]) => {
    const club = TEAM_SEEDS.find((c) => c.abbrev === abbrev)!;
    const fig = document.createElement('figure');
    const canvas = document.createElement('canvas');
    const cap = document.createElement('figcaption');
    cap.textContent = `${club.city} ${club.name}`;
    fig.append(canvas, cap);
    root.append(fig);
    return { abbrev, season, canvas };
  });
  const paint = () => tiles.forEach((t) => paintTile(t));
  document.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('button[data-set]') as HTMLButtonElement | null;
    if (!b) return;
    const [key, value] = b.dataset.set!.split(':');
    if (key === 'turnout') state.turnout = value as Turnout;
    if (key === 'light') state.night = value === 'night';
    if (key === 'precip') state.precip = value as Look['precip'];
    if (key === 'roof') state.open = value === 'open';
    for (const o of document.querySelectorAll(`button[data-set^="${key}:"]`))
      o.setAttribute('aria-pressed', String(o === b));
    paint();
  });
  paint();
  // for `--time`: milliseconds to paint each building, the stadium alone
  (window as unknown as { timeAll: () => Record<string, number> }).timeAll = () =>
    Object.fromEntries(tiles.map((t) => [t.abbrev, Math.round(paintTile(t))]));
}
if (typeof document !== 'undefined') mount();
