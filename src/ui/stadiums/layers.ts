/**
 * A building as a game shows it: the ground on one canvas, and its crowd shared among a few more laid over it, so the
 * people can jump when the home side gives them something to cheer (`data-cheer` on the scene, in the stylesheet)
 * while the building stays where it is. At rest the canvases together are the one picture `canvasPen` paints.
 */
import { FRAME } from './camera';
import { paintStadium } from './paint';
import { crowdPen } from './pen';
import type { Building, Look } from './types';

/** The canvases a crowd is shared among: each jumps a beat behind the last, so the stand ripples and doesn't slide. */
export const WAVES = 3;

export function paintLayers(
  ground: HTMLCanvasElement,
  waves: readonly HTMLCanvasElement[],
  width: number,
  b: Building,
  colors: [string, string],
  look: Look,
  seed: string,
): void {
  for (const c of [ground, ...waves]) {
    c.width = width;
    c.height = Math.round((width * FRAME.h) / FRAME.w);
  }
  const g = ground.getContext('2d');
  if (!g) return;
  const on = waves.map((c) => c.getContext('2d')).filter((c): c is CanvasRenderingContext2D => !!c);
  paintStadium(crowdPen(g, on, width / FRAME.w), b, colors, look, seed);
}
