/**
 * What the painter draws on: a canvas in the game and on the owner's pages, a recorder in the tests. Coordinates are
 * frame units (360 by 188); the canvas pen scales them to its pixels.
 */
export type Pt = [number, number];
export interface Pen {
  poly(pts: Pt[], fill: string): void;
  line(pts: Pt[], stroke: string, width: number): void;
  /** A round mark: a person in a seat. */
  dot(x: number, y: number, r: number, fill: string): void;
  /** A small upright box: an empty chair, a car, a light. */
  box(x: number, y: number, w: number, h: number, fill: string): void;
  /** Draw what is waiting (see `canvasPen`). */
  flush(): void;
  /**
   * While on, what is drawn is a stand's own fabric (its bank, rows, chairs, stairs and front): it sits beside the
   * people and never in front of one. Only a pen that keeps the crowd apart (`crowdPen`) cares.
   */
  fabric?(on: boolean): void;
}

/** A dot smaller than this many pixels in radius is drawn square. */
const SQUARE_UNDER = 2.6;

type Ctx = CanvasRenderingContext2D;
const traceOn = (ctx: Pick<Ctx, 'moveTo' | 'lineTo'>, pts: Pt[], scale: number) => {
  for (let i = 0; i < pts.length; i++) {
    if (i) ctx.lineTo(pts[i][0] * scale, pts[i][1] * scale);
    else ctx.moveTo(pts[i][0] * scale, pts[i][1] * scale);
  }
};
/** Shapes sharing a path must all wind the same way, or one laid over another would cut a hole in it. */
const oneWay = (pts: Pt[]): Pt[] => {
  let area = 0;
  for (let i = 0; i < pts.length; i++) {
    const q = pts[(i + 1) % pts.length];
    area += pts[i][0] * q[1] - q[0] * pts[i][1];
  }
  return area < 0 ? pts.slice().reverse() : pts;
};

/**
 * A pen on a canvas. Dots and boxes are the bulk of a building (a seat each), so they wait in one list a colour and
 * are drawn as one path each: on `flush`, and before any polygon or line, so what is on screen is in the order drawn.
 */
export function canvasPen(ctx: CanvasRenderingContext2D, scale: number): Pen {
  const dots = new Map<string, number[]>();
  const boxes = new Map<string, number[]>();
  const flush = () => {
    endRun();
    for (const [fill, list] of boxes) {
      ctx.fillStyle = fill;
      ctx.beginPath();
      for (let i = 0; i < list.length; i += 4) ctx.rect(list[i], list[i + 1], list[i + 2], list[i + 3]);
      ctx.fill();
    }
    boxes.clear();
    for (const [fill, list] of dots) {
      ctx.fillStyle = fill;
      ctx.beginPath();
      for (let i = 0; i < list.length; i += 3) {
        ctx.moveTo(list[i] + list[i + 2], list[i + 1]);
        ctx.arc(list[i], list[i + 1], list[i + 2], 0, 6.2832);
      }
      ctx.fill();
    }
    dots.clear();
  };
  const trace = (pts: Pt[]) => traceOn(ctx, pts, scale);
  // Polygons that follow one another in the same colour (a stretch of a stand, a row of windows) share one path.
  let run: string | null = null;
  const endRun = () => {
    if (run === null) return;
    ctx.fillStyle = run;
    ctx.fill();
    run = null;
  };
  const keep = (map: Map<string, number[]>, fill: string) => {
    let list = map.get(fill);
    if (!list) map.set(fill, (list = []));
    return list;
  };
  return {
    poly(pts, fill) {
      if (run !== fill) {
        flush();
        ctx.beginPath();
        run = fill;
      }
      trace(oneWay(pts));
      ctx.closePath();
    },
    line(pts, stroke, width) {
      flush();
      ctx.beginPath();
      trace(pts);
      ctx.strokeStyle = stroke;
      ctx.lineWidth = width * scale;
      ctx.stroke();
    },
    dot(x, y, r, fill) {
      endRun();
      // a far seat is a pixel or two across: a square reads the same there and costs a fraction of a circle
      const rr = r * scale;
      if (rr < SQUARE_UNDER) keep(boxes, fill).push(x * scale - rr * 0.9, y * scale - rr * 0.9, rr * 1.8, rr * 1.8);
      else keep(dots, fill).push(x * scale, y * scale, rr);
    },
    box(x, y, w, h, fill) {
      endRun();
      keep(boxes, fill).push(x * scale, y * scale, w * scale, h * scale);
    },
    flush,
  };
}

/**
 * A pen for a picture whose crowd can get to its feet: everything but the people goes on `ground`, and the people are
 * shared among `waves`, a canvas each, neighbours on different ones, so each can rise and fall a beat apart from the
 * others. Whatever is drawn after a person does to him there what it would have on one canvas: a solid shape rubs him
 * out, a see-through one tints him (a stand's own fabric aside, which hides nobody: `Pen.fabric`). So the waves laid
 * over the ground are the picture `canvasPen` draws, and lifted a little they are the crowd jumping, with nobody
 * showing through a roof.
 */
export function crowdPen(ground: Ctx, waves: readonly Ctx[], scale: number): Pen {
  const base = canvasPen(ground, scale);
  /** Each wave's people waiting to be drawn, by colour: squares (three numbers each) and circles. */
  const square = waves.map(() => new Map<string, number[]>());
  const round = waves.map(() => new Map<string, number[]>());
  let people = 0;
  /**
   * The open path, traced once and laid on every wave: `CUT` for solid shapes, which share one whatever their colour,
   * else a see-through colour.
   */
  const CUT = '';
  let run: string | null = null;
  let path = new Path2D();
  let fabric = false;
  /** Whether a shape drawn now can hide nobody: no person has been drawn yet, or it is the stand's own fabric. */
  const harmless = () => fabric || !people || !waves.length;
  const how = (fill: string) => (fill.startsWith('rgba(') ? 'source-atop' : 'destination-out');
  /** Does to the people already drawn what a shape laid over them would. */
  const over = (fill: string, draw: (ctx: Ctx) => void) => {
    for (const ctx of waves) {
      ctx.globalCompositeOperation = how(fill);
      draw(ctx);
      ctx.globalCompositeOperation = 'source-over';
    }
  };
  const endRun = () => {
    if (run === null) return;
    const fill = run === CUT ? '#000' : run;
    over(fill, (ctx) => {
      ctx.fillStyle = fill;
      ctx.fill(path);
    });
    run = null;
  };
  /** Opens the path for a shape of this colour, unless the one open will take it. */
  const runOf = (fill: string) => {
    const key = how(fill) === 'destination-out' ? CUT : fill;
    if (run === key) return;
    flush();
    path = new Path2D();
    run = key;
  };
  const keep = (map: Map<string, number[]>, fill: string) => {
    let list = map.get(fill);
    if (!list) map.set(fill, (list = []));
    return list;
  };
  const flush = () => {
    endRun();
    waves.forEach((ctx, k) => {
      for (const [fill, list] of square[k]) {
        ctx.fillStyle = fill;
        ctx.beginPath();
        for (let i = 0; i < list.length; i += 3) ctx.rect(list[i], list[i + 1], list[i + 2], list[i + 2]);
        ctx.fill();
      }
      square[k].clear();
      for (const [fill, list] of round[k]) {
        ctx.fillStyle = fill;
        ctx.beginPath();
        for (let i = 0; i < list.length; i += 3) {
          ctx.moveTo(list[i] + list[i + 2], list[i + 1]);
          ctx.arc(list[i], list[i + 1], list[i + 2], 0, 6.2832);
        }
        ctx.fill();
      }
      round[k].clear();
    });
  };
  return {
    poly(pts, fill) {
      base.poly(pts, fill);
      if (harmless()) return;
      runOf(fill);
      traceOn(path, oneWay(pts), scale);
      path.closePath();
    },
    line(pts, stroke, width) {
      base.line(pts, stroke, width);
      if (harmless()) return;
      flush();
      const along = new Path2D();
      traceOn(along, pts, scale);
      over(stroke, (ctx) => {
        ctx.strokeStyle = stroke;
        ctx.lineWidth = width * scale;
        ctx.stroke(along);
      });
    },
    dot(x, y, r, fill) {
      // with no canvas to keep the crowd on, it stays in the one picture
      if (!waves.length) return base.dot(x, y, r, fill);
      endRun();
      const k = people++ % waves.length;
      const rr = r * scale;
      if (rr < SQUARE_UNDER) keep(square[k], fill).push(x * scale - rr * 0.9, y * scale - rr * 0.9, rr * 1.8);
      else keep(round[k], fill).push(x * scale, y * scale, rr);
    },
    box(x, y, w, h, fill) {
      base.box(x, y, w, h, fill);
      if (harmless()) return;
      runOf(fill);
      path.rect(x * scale, y * scale, w * scale, h * scale);
    },
    flush() {
      base.flush();
      flush();
    },
    fabric(on) {
      fabric = on;
    },
  };
}

export interface Shape {
  kind: 'poly' | 'line' | 'dot' | 'box';
  fill: string;
}
/** A pen that only writes down what it was asked to draw, in order. */
export function recorder(): Pen & { shapes: Shape[] } {
  const shapes: Shape[] = [];
  return {
    shapes,
    poly: (_pts, fill) => void shapes.push({ kind: 'poly', fill }),
    line: (_pts, stroke) => void shapes.push({ kind: 'line', fill: stroke }),
    dot: (_x, _y, _r, fill) => void shapes.push({ kind: 'dot', fill }),
    box: (_x, _y, _w, _h, fill) => void shapes.push({ kind: 'box', fill }),
    flush: () => {},
  };
}

/**
 * Draws shapes that do not overlap one another a colour at a time, so each colour is one path: a row of windows or a
 * deck's ribbon board in alternating colours would otherwise be a path a shape.
 */
export function byColour(pen: Pen, shapes: [Pt[], string][]): void {
  const groups = new Map<string, Pt[][]>();
  for (const [pts, fill] of shapes) {
    const g = groups.get(fill);
    if (g) g.push(pts);
    else groups.set(fill, [pts]);
  }
  for (const [fill, list] of groups) for (const pts of list) pen.poly(pts, fill);
}
