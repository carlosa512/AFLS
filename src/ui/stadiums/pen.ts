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
}

/** A dot smaller than this many pixels in radius is drawn square. */
const SQUARE_UNDER = 2.6;

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
  const trace = (pts: Pt[]) => {
    for (let i = 0; i < pts.length; i++) {
      if (i) ctx.lineTo(pts[i][0] * scale, pts[i][1] * scale);
      else ctx.moveTo(pts[i][0] * scale, pts[i][1] * scale);
    }
  };
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
      // shapes sharing a path must all wind the same way, or one laid over another would cut a hole in it
      let area = 0;
      for (let i = 0; i < pts.length; i++) {
        const q = pts[(i + 1) % pts.length];
        area += pts[i][0] * q[1] - q[0] * pts[i][1];
      }
      trace(area < 0 ? pts.slice().reverse() : pts);
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
