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

/**
 * A pen on a canvas. Dots and boxes are the bulk of a building (a seat each), so they wait in one list a colour and
 * are drawn as one path each: on `flush`, and before any polygon or line, so what is on screen is in the order drawn.
 */
export function canvasPen(ctx: CanvasRenderingContext2D, scale: number): Pen {
  const dots = new Map<string, number[]>();
  const boxes = new Map<string, number[]>();
  const flush = () => {
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
    ctx.beginPath();
    pts.forEach((p, i) => (i ? ctx.lineTo(p[0] * scale, p[1] * scale) : ctx.moveTo(p[0] * scale, p[1] * scale)));
  };
  const keep = (map: Map<string, number[]>, fill: string) => {
    let list = map.get(fill);
    if (!list) map.set(fill, (list = []));
    return list;
  };
  return {
    poly(pts, fill) {
      flush();
      trace(pts);
      ctx.closePath();
      ctx.fillStyle = fill;
      ctx.fill();
    },
    line(pts, stroke, width) {
      flush();
      trace(pts);
      ctx.strokeStyle = stroke;
      ctx.lineWidth = width * scale;
      ctx.stroke();
    },
    dot(x, y, r, fill) {
      keep(dots, fill).push(x * scale, y * scale, r * scale);
    },
    box(x, y, w, h, fill) {
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
