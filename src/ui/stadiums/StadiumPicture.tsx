/**
 * The club's building behind the field: painted once, and again only when what it shows changes (the quarter's
 * weather, a roof opening or shutting). The building is one canvas and its crowd a few more over it (`layers.ts`), so
 * the people can jump for a home score. The field's own paint and the play are the SVG drawn over them, through the
 * same camera. Spec: docs/superpowers/specs/2026-11-11-stadiums-design.md.
 */
import { memo, useEffect, useRef } from 'react';
import { FRAME } from './camera';
import type { StadiumView } from './gameLook';
import { paintLayers, WAVES } from './layers';

/** The widest the canvas is made, in pixels. */
const MAX_WIDTH = 1440;

export const lookKey = ({ look }: StadiumView): string =>
  `${look.night ? 'night' : 'day'}${look.theme ? `@${look.theme}` : ''}:${look.precip}${look.lying ? '+lying' : ''}:${look.roof}:${look.fill}`;

/** Everything the picture shows: the same key, the same picture. */
const viewKey = (view: StadiumView): string =>
  `${view.building.id}|${view.colors.join()}|${view.seed}|${lookKey(view)}`;

/** The canvas's width in pixels for the box it sits in. */
const pixelsFor = (canvas: HTMLCanvasElement): number =>
  Math.round(Math.min(MAX_WIDTH, (canvas.clientWidth || FRAME.w) * (window.devicePixelRatio || 1)));

/**
 * The last picture painted, kept for a moment after its canvases leave the page. At the kickoff the pregame card's
 * field gives way to the play's (another component, so new canvases): they take the picture already painted, and
 * the same building is not painted a second time just as the first play starts.
 */
let kept: { key: string; canvases: HTMLCanvasElement[] } | null = null;
const KEEP_MS = 2000;

/** Puts the kept picture on these canvases, when it is this picture at this size. */
function takeKept(key: string, width: number, canvases: HTMLCanvasElement[]): boolean {
  const from = kept?.canvases;
  if (!kept || !from || kept.key !== key || from.length !== canvases.length || from[0].width !== width) return false;
  if (from[0] === canvases[0]) return true;
  canvases.forEach((c, i) => {
    c.width = from[i].width;
    c.height = from[i].height;
    c.getContext('2d')?.drawImage(from[i], 0, 0);
  });
  return true;
}

export const StadiumPicture = memo(
  function StadiumPicture({ view }: { view: StadiumView }) {
    const ref = useRef<HTMLCanvasElement>(null);
    const waves = useRef<(HTMLCanvasElement | null)[]>([]);
    const key = viewKey(view);
    useEffect(() => {
      const canvas = ref.current;
      if (!canvas?.getContext('2d')) return;
      const crowd = waves.current.filter((c): c is HTMLCanvasElement => !!c);
      const all = [canvas, ...crowd];
      const paint = () => {
        paintLayers(canvas, crowd, pixelsFor(canvas), view.building, view.colors, view.look, view.seed);
        kept = { key, canvases: all };
      };
      if (takeKept(key, pixelsFor(canvas), all)) kept = { key, canvases: all };
      else paint();
      // A box that grew (a phone turned, a window widened, a first measure of nothing) would leave a soft picture:
      // paint again when the canvas wants a fifth more pixels or fewer than it has.
      const watch =
        typeof ResizeObserver === 'undefined'
          ? null
          : new ResizeObserver(() => {
              const want = pixelsFor(canvas);
              if (Math.abs(want - canvas.width) > canvas.width * 0.2) paint();
            });
      watch?.observe(canvas);
      return () => {
        watch?.disconnect();
        // gone from the page: the picture is let go unless other canvases took it up meanwhile
        setTimeout(() => {
          if (kept?.canvases === all) kept = null;
        }, KEEP_MS);
      };
      // the key is everything the picture shows
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [key]);
    return (
      <>
        <canvas
          ref={ref}
          className="stadium-picture"
          aria-hidden="true"
          data-building={view.building.id}
          data-look={lookKey(view)}
        />
        {Array.from({ length: WAVES }, (_, k) => (
          <canvas
            key={k}
            ref={(c) => void (waves.current[k] = c)}
            className="stadium-crowd"
            aria-hidden="true"
            // each a beat behind the last when they jump (`data-cheer` on the scene)
            style={{ animationDelay: `${(-k * 0.17).toFixed(2)}s` }}
          />
        ))}
      </>
    );
  },
  (a, b) => viewKey(a.view) === viewKey(b.view),
);
