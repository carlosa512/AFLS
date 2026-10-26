/**
 * The open measures the Arena Gazette writes about (`docs/NEWS.md`): expected points, EPA per play, success rate and
 * explosive plays. They only measure what the match engine already did: nothing here moves play. DVOA and QBR are
 * proprietary; EPA per play and per dropback are the open numbers they stand for.
 */

/** A scrimmage play's state: yard line from the offense's own goal line, score by side. */
export interface PlayState {
  down: number;
  distance: number;
  yardLine: number;
  offense: 0 | 1;
  score: [number, number];
}

/**
 * Expected points on first and ten by field position, shaped on the NFL's averages (nflfastR-style curves): a
 * touchback is worth a little under half a point, midfield two, the opponent's 1 about six.
 */
const FIRST_DOWN: readonly [number, number][] = [
  [1, -1.2],
  [20, 0.4],
  [50, 2.0],
  [80, 3.9],
  [90, 4.6],
  [99, 6.0],
];
/** A later down costs points, more with distance to go; never more than this. */
const DOWN_CAP = 2.5;

function firstAndTen(yardLine: number): number {
  const y = Math.min(99, Math.max(1, yardLine));
  for (let i = 1; i < FIRST_DOWN.length; i++) {
    const [x1, v1] = FIRST_DOWN[i];
    if (y <= x1) {
      const [x0, v0] = FIRST_DOWN[i - 1];
      return v0 + ((v1 - v0) * (y - x0)) / (x1 - x0);
    }
  }
  return FIRST_DOWN[FIRST_DOWN.length - 1][1];
}

/** Points the offense can expect from this spot before the other side scores next. */
export function expectedPoints(down: number, distance: number, yardLine: number): number {
  const cost =
    down === 2
      ? 0.25 + 0.05 * Math.max(0, distance - 3)
      : down === 3
        ? 0.6 + 0.12 * Math.max(0, distance - 1)
        : down >= 4
          ? 1.2 + 0.15 * distance
          : 0;
  return firstAndTen(yardLine) - Math.min(DOWN_CAP, cost);
}

const ep = (s: PlayState) => expectedPoints(s.down, s.distance, s.yardLine);

/**
 * Expected points added by a play, from the offense's side. Points scored on it (either way) end the reckoning; else
 * the offense's new spot, or, when the ball changed hands, the other side's spot counted against it.
 */
export function playEpa(before: PlayState, after: PlayState): number {
  const off = before.offense,
    def = (1 - off) as 0 | 1;
  const points = after.score[off] - before.score[off] - (after.score[def] - before.score[def]);
  if (points !== 0) return points - ep(before);
  return (after.offense === off ? ep(after) : -ep(after)) - ep(before);
}

/** The NFL's success rule: 40% of the distance on first down, 60% on second, all of it on third and fourth. */
export function isSuccess(down: number, distance: number, gained: number, touchdown: boolean): boolean {
  if (touchdown) return true;
  const share = down === 1 ? 0.4 : down === 2 ? 0.6 : 1;
  return gained >= share * distance;
}

/** A run of 10 yards or more, or a completion of 20 or more. */
export function isExplosive(kind: 'run' | 'pass', gained: number, complete: boolean): boolean {
  return kind === 'run' ? gained >= 10 : complete && gained >= 20;
}
