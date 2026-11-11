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
import { paintLayers, WAVES } from './layers';
import { paintStadium } from './paint';
import { canvasPen, type Pen, type Pt } from './pen';
import type { Look } from './types';

declare const GROUP: string;
const WIDTH = 1440;
/** The widest canvas a phone paints: 390 points across at three pixels a point. `--time` paints at this. */
const PHONE_WIDTH = 1170;

interface Spec {
  abbrev: string;
  season: number;
  /** A look this tile keeps whatever the switches say, and what to say under it. */
  over?: Partial<Look>;
  note?: string;
  /** Draw a sample play over it; `phone` shows it at a phone's width. */
  play?: boolean;
  phone?: boolean;
}
const club = (abbrev: string): Spec => ({ abbrev, season: 2026 });
export const GROUPS: Record<string, { title: string; intro?: string; tiles: Spec[] }> = {
  agreed: { title: 'The five agreed', tiles: ['DEN', 'BUF', 'CIN', 'MIN', 'ATL'].map(club) },
  'liberty-east': { title: 'Liberty East', tiles: ['BUF', 'MIA', 'NE', 'NYK'].map(club) },
  'liberty-north': { title: 'Liberty North', tiles: ['BAL', 'CIN', 'CLE', 'PIT'].map(club) },
  'liberty-south': { title: 'Liberty South', tiles: ['HOU', 'IND', 'JAX', 'TEN'].map(club) },
  'liberty-west': { title: 'Liberty West', tiles: ['DEN', 'KC', 'LV', 'LAC'].map(club) },
  'frontier-east': { title: 'Frontier East', tiles: ['DAL', 'NYE', 'PHI', 'WAS'].map(club) },
  'frontier-north': { title: 'Frontier North', tiles: ['CHI', 'DET', 'GB', 'MIN'].map(club) },
  'frontier-south': { title: 'Frontier South', tiles: ['ATL', 'CAR', 'NO', 'TB'].map(club) },
  'frontier-west': { title: 'Frontier West', tiles: ['ARI', 'LAS', 'SF', 'SEA'].map(club) },
  later: {
    title: 'Coming later in a career',
    tiles: [
      { abbrev: 'TEN', season: 2027, note: 'From 2027.' },
      { abbrev: 'JAX', season: 2028, note: 'From 2028.' },
      { abbrev: 'CLE', season: 2029, note: 'From 2029.' },
      { abbrev: 'WAS', season: 2030, note: 'From 2030.' },
      { abbrev: 'KC', season: 2031, note: 'From 2031.' },
    ],
  },
  checks: {
    title: 'Three things not seen yet',
    intro:
      'Drawn by the code the game will use, connected to nothing yet. A play on the smaller field at a phone’s width; night; and weather with no sky. The switches above still change the crowd.',
    tiles: [
      {
        ...club('DEN'),
        play: true,
        phone: true,
        note: 'A play at a phone’s width. The dashed outline is where the field sits today.',
      },
      { ...club('ATL'), play: true, phone: true, over: { night: true }, note: 'The same play under a roof, at night.' },
      {
        ...club('DEN'),
        over: { night: true },
        note: 'Night: the ground is floodlit and the land round it goes dark, with windows lit.',
      },
      { ...club('BUF'), over: { night: true }, note: 'Night, out of town.' },
      { ...club('DEN'), over: { precip: 'rain' }, note: 'Rain, with no sky to show it: only what falls.' },
      {
        ...club('BUF'),
        over: { precip: 'snow' },
        note: 'Snow falling: it lies on the roof and the land while it does.',
      },
      {
        ...club('BUF'),
        over: { lying: true },
        note: 'A clear day in deep winter: snow lying, none falling. On any other clear day there is none.',
      },
      { ...club('ATL'), over: { roof: 'open' }, note: 'The roof open.' },
      { ...club('ATL'), over: { roof: 'closed' }, note: 'The roof shut: one seam where the leaves meet.' },
    ],
  },
};

const P = (X: number, Y: number, Z: number): Pt => {
  const p = toFrame(X, Y, Z);
  return [p.x, p.y];
};
/** The field, sketched: in the game the field's own paint and the play are drawn over the picture instead. */
function sketchField(pen: Pen, colors: [string, string], night: boolean) {
  const k = night ? '#2c7637' : '#2f7d3a';
  const k2 = night ? '#33823e' : '#368a41';
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

/** Roughly where a roof's cut edge crosses the picture: weather is drawn above it only. */
const ROOF_LINE = 21;
/** What is falling, over the picture (the game has its own layer for this). */
function sketchFall(ctx: CanvasRenderingContext2D, look: Look, scale: number) {
  if (look.precip === 'none') return;
  // Under a roof nothing falls inside: what falls outside is shown, and stops at the roof (the owner, Nov 11).
  if (look.roof !== 'none') {
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, FRAME.w * scale, ROOF_LINE * scale);
    ctx.clip();
  }
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
  if (look.roof !== 'none') ctx.restore();
}

/** A sample play, drawn the way the game's own layer would: the drive's band, both lines, a pass and a banner. */
function sketchPlay(ctx: CanvasRenderingContext2D, scale: number, abbrev: string, colors: [string, string]) {
  const S = (X: number, Y: number, Z: number): Pt => {
    const p = toFrame(X, Y, Z);
    return [p.x * scale, p.y * scale];
  };
  const path = (pts: Pt[]) => {
    ctx.beginPath();
    pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
  };
  // where the field sits today (far sideline at 68 and 226 wide, near at 168 and 346)
  ctx.setLineDash([3 * scale, 2.4 * scale]);
  path(
    [
      [67, 68],
      [293, 68],
      [353, 168],
      [7, 168],
      [67, 68],
    ].map(([x, y]) => [x * scale, y * scale] as Pt),
  );
  ctx.strokeStyle = 'rgba(255,255,255,.8)';
  ctx.lineWidth = 1.3 * scale;
  ctx.stroke();
  ctx.setLineDash([]);
  // the drive began at the 25; the ball is at the 30 with ten to go (the home side attacks to the left)
  path([S(25, 0, 0), S(20, 0, 0), S(20, 0, 53.33), S(25, 0, 53.33)]);
  ctx.fillStyle = 'rgba(255,255,255,.14)';
  ctx.fill();
  for (const [x, col] of [
    [20, '#5aa9ff'],
    [10, '#ffd43b'],
  ] as [number, string][]) {
    path([S(x, 0, 0), S(x, 0, 53.33)]);
    ctx.strokeStyle = col;
    ctx.lineWidth = 0.9 * scale;
    ctx.stroke();
  }
  const arc: Pt[] = [];
  for (let k = 0; k <= 24; k++) arc.push(S(20 - (22 * k) / 24, 12 * 4 * (k / 24) * (1 - k / 24), 26 + (14 * k) / 24));
  path(arc);
  ctx.strokeStyle = 'rgba(255,255,255,.9)';
  ctx.lineWidth = 0.6 * scale;
  ctx.stroke();
  const ball = toFrame(-2, 1, 40);
  ctx.fillStyle = '#7a3f1d';
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 0.35 * scale;
  ctx.beginPath();
  ctx.ellipse(ball.x * scale, ball.y * scale, 2.6 * scale, 1.6 * scale, 0, 0, 6.3);
  ctx.fill();
  ctx.stroke();
  // the banner, as the game draws one
  const y = 150 * scale;
  ctx.fillStyle = 'rgba(12,16,15,.9)';
  ctx.fillRect(10 * scale, y, 340 * scale, 28 * scale);
  ctx.fillStyle = colors[0];
  ctx.fillRect(10 * scale, y, 46 * scale, 28 * scale);
  ctx.fillStyle = '#fff';
  ctx.font = `900 ${15 * scale}px 'Arial Narrow', Arial, sans-serif`;
  ctx.textBaseline = 'middle';
  ctx.fillText(abbrev, 17 * scale, y + 14 * scale);
  ctx.fillText('TOUCHDOWN', 64 * scale, y + 10 * scale);
  ctx.font = `400 ${8 * scale}px Arial, sans-serif`;
  ctx.fillStyle = '#c9d2cc';
  ctx.fillText('A 22-yard pass', 64 * scale, y + 22 * scale);
}

export interface Tile extends Spec {
  canvas: HTMLCanvasElement;
}
const state = {
  turnout: 'winning' as Turnout,
  night: false,
  precip: 'none' as Look['precip'],
  lying: false,
  open: true,
};

/** Paints a tile and says how long its stadium took. `asGame`: time the game's own paint, crowd layers and all. */
export function paintTile(t: Tile, width = WIDTH, asGame = false): number {
  const club = TEAM_SEEDS.find((c) => c.abbrev === t.abbrev)!;
  const colors = club.colors as [string, string];
  const b = buildingFor(t.abbrev, t.season, colors);
  const kind = roofKindOf(b);
  const look: Look = {
    night: state.night,
    precip: state.precip,
    roof: kind === 'outdoors' ? 'none' : kind === 'dome' || !state.open ? 'closed' : 'open',
    fill: FILL[state.turnout],
    lying: state.lying,
    ...t.over,
  };
  const scale = width / FRAME.w;
  t.canvas.width = width;
  t.canvas.height = FRAME.h * scale;
  const ctx = t.canvas.getContext('2d')!;
  let ms = 0;
  if (asGame) {
    const fresh = () => document.createElement('canvas');
    const [ground, waves] = [fresh(), Array.from({ length: WAVES }, fresh)];
    const g0 = performance.now();
    paintLayers(ground, waves, width, b, colors, look, t.abbrev);
    ms = performance.now() - g0;
  }
  const t0 = performance.now();
  const pen = canvasPen(ctx, scale);
  paintStadium(pen, b, colors, look, t.abbrev);
  if (!asGame) ms = performance.now() - t0;
  sketchField(pen, colors, look.night);
  if (t.play) sketchPlay(ctx, scale, t.abbrev, colors);
  sketchFall(ctx, look, scale);
  return ms;
}

function mount() {
  const group = GROUPS[GROUP];
  const root = document.getElementById('root')!;
  document.getElementById('title')!.textContent = group.title;
  document.getElementById('notes')!.textContent = group.intro ?? '';
  const tiles: Tile[] = group.tiles.map((spec) => {
    const team = TEAM_SEEDS.find((c) => c.abbrev === spec.abbrev)!;
    const fig = document.createElement('figure');
    if (spec.phone) fig.className = 'phone';
    const canvas = document.createElement('canvas');
    const cap = document.createElement('figcaption');
    cap.textContent = spec.note ? `${team.city}. ${spec.note}` : `${team.city} ${team.name}`;
    fig.append(canvas, cap);
    root.append(fig);
    return { ...spec, canvas };
  });
  const paint = () => tiles.forEach((t) => paintTile(t));
  document.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('button[data-set]') as HTMLButtonElement | null;
    if (!b) return;
    const [key, value] = b.dataset.set!.split(':');
    if (key === 'turnout') state.turnout = value as Turnout;
    if (key === 'light') state.night = value === 'night';
    if (key === 'precip') {
      state.lying = value === 'lying';
      state.precip = value === 'lying' ? 'none' : (value as Look['precip']);
    }
    if (key === 'roof') state.open = value === 'open';
    for (const o of document.querySelectorAll(`button[data-set^="${key}:"]`))
      o.setAttribute('aria-pressed', String(o === b));
    paint();
  });
  paint();
  // for `--time`: milliseconds to paint each building as a game does, the stadium alone
  (window as unknown as { timeAll: () => Record<string, number> }).timeAll = () => {
    const ms = Object.fromEntries(tiles.map((t) => [t.abbrev, Math.round(paintTile(t, PHONE_WIDTH, true))]));
    paint();
    return ms;
  };
}
if (typeof document !== 'undefined') mount();
