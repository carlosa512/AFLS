/**
 * The club's building behind the field: painted once on a canvas, and again only when what it shows changes (the
 * quarter's weather, a roof opening or shutting). The field's own paint and the play are the SVG drawn over it, through
 * the same camera. Spec: docs/superpowers/specs/2026-11-11-stadiums-design.md.
 */
import { memo, useEffect, useRef } from 'react';
import { FRAME } from './camera';
import type { StadiumView } from './gameLook';
import { paintStadium } from './paint';
import { canvasPen } from './pen';

/** The widest the canvas is made, in pixels. */
const MAX_WIDTH = 1440;

export const lookKey = ({ look }: StadiumView): string =>
  `${look.night ? 'night' : 'day'}:${look.precip}${look.lying ? '+lying' : ''}:${look.roof}:${look.fill}`;

export const StadiumPicture = memo(
  function StadiumPicture({ view }: { view: StadiumView }) {
    const ref = useRef<HTMLCanvasElement>(null);
    const key = `${view.building.id}|${view.colors.join()}|${lookKey(view)}`;
    useEffect(() => {
      const canvas = ref.current;
      const ctx = canvas?.getContext('2d');
      if (!canvas || !ctx) return;
      const width = Math.round(Math.min(MAX_WIDTH, (canvas.clientWidth || FRAME.w) * (window.devicePixelRatio || 1)));
      canvas.width = width;
      canvas.height = Math.round((width * FRAME.h) / FRAME.w);
      paintStadium(canvasPen(ctx, width / FRAME.w), view.building, view.colors, view.look, view.seed);
      // the key is everything the picture shows
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [key]);
    return (
      <canvas
        ref={ref}
        className="stadium-picture"
        aria-hidden="true"
        data-building={view.building.id}
        data-look={lookKey(view)}
      />
    );
  },
  (a, b) =>
    a.view.building.id === b.view.building.id &&
    a.view.colors.join() === b.view.colors.join() &&
    lookKey(a.view) === lookKey(b.view),
);
