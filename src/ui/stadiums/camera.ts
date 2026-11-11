/**
 * The stadium's camera: one pinhole for the building, the land outside, the field's paint and the play. It sits high
 * over the near side and looks down, so there is no sky in the frame. Stadium space is in yards: X to the right of
 * midfield, Y up from the grass, Z beyond the near sideline. Spec: docs/superpowers/specs/2026-11-11-stadiums-design.md.
 */
export const FRAME = { w: 360, h: 188 };
/** Fitted so the field sits where the owner approved it: the far sideline at y 90, the near one at y 172. */
export const CAM = { H: 102, D: 100, pitch: 0.11, f: 272.668, cy: -50.919 };

const SIN = Math.sin(CAM.pitch);
const COS = Math.cos(CAM.pitch);

/** A spot in stadium space to the frame; `depth` is its distance down the camera's line of sight. */
export function toFrame(X: number, Y: number, Z: number): { x: number; y: number; depth: number } {
  const vy = Y - CAM.H;
  const vz = Z + CAM.D;
  const up = vy * COS + vz * SIN;
  const depth = -vy * SIN + vz * COS;
  return { x: FRAME.w / 2 + (CAM.f * X) / depth, y: CAM.cy - (CAM.f * up) / depth, depth };
}
