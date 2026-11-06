/**
 * A return by yard bands (fumbles in `looseBall.ts`, picks in `defendedPass.ts`): shares of none (zero or less), 1–9,
 * 10–19 and 20+ yards; of the 20+, the share that goes the distance (a turnover run back has nobody in front of it: most
 * of the NFL's long ones score) and the mean of the rest past 20. Capped at the goal line: reaching it is the touchdown.
 * Draws nothing.
 */
export interface Bands {
  none: number;
  short: number;
  mid: number;
  go: number;
  tail: number;
}

/** How far he runs it back on draw `u`, never past the goal line `toGoal` yards away. */
export function bandReturn(r: Bands, toGoal: number, u: number): number {
  let y: number;
  if (u < r.none) y = 0;
  else if (u < r.none + r.short) y = 1 + Math.floor(((u - r.none) / r.short) * 9);
  else if (u < r.none + r.short + r.mid) y = 10 + Math.floor(((u - r.none - r.short) / r.mid) * 10);
  else {
    const f = (u - r.none - r.short - r.mid) / (1 - r.none - r.short - r.mid);
    y = f < r.go ? toGoal : Math.round(20 - r.tail * Math.log(Math.max(1e-9, 1 - (f - r.go) / (1 - r.go))));
  }
  return Math.min(y, Math.max(0, toGoal));
}
