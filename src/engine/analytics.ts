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
 * Expected points on first and ten by field position: the next score in the half, fitted to this engine's own
 * games (about 40,000 plays). With fourth down valued as the punt or kick that follows (`fourthDownValue`), a league
 * of average offenses adds about nothing a play, as the NFL's does (`npm run sim` prints the league's numbers).
 */
const FIRST_DOWN: readonly [number, number][] = [
  [1, -0.3],
  [15, 0.65],
  [25, 0.97],
  [35, 1.63],
  [45, 2.43],
  [55, 2.87],
  [65, 3.49],
  [75, 4.17],
  [85, 4.4],
  [99, 5.4],
];
/** A later down costs points, more with distance to go (fitted the same way); never more than a punt's worth. */
const DOWN_CAP = 3.4;

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
      ? 0.2 + 0.07 * Math.max(0, distance - 4)
      : down === 3
        ? 0.55 + 0.12 * Math.max(0, distance - 1)
        : down >= 4
          ? 2.2 + 0.2 * Math.max(0, distance - 1)
          : 0;
  return firstAndTen(yardLine) - Math.min(DOWN_CAP, cost);
}

/** A punt's net: the opponent takes over about this far downfield, at its own 20 on a touchback. */
const PUNT_NET = 40;

/**
 * Fourth down, valued as what usually follows: a punt (the opponent's ball where it lands), a field-goal try, or going
 * for it (the table). Punts and kicks never pass the counting point (`countAdvanced`), so a failed third down ends its
 * drive here: valuing this spot as a near-turnover would charge every punt drive an interception's worth.
 */
export function fourthDownValue(s: PlayState): number {
  // Going for it: the first down it earns, or the ball over on downs, by the odds of converting at this distance.
  const convert = Math.min(0.75, Math.max(0.15, 0.75 - 0.05 * (s.distance - 1)));
  const goFor =
    convert * expectedPoints(1, 10, Math.min(99, s.yardLine + s.distance)) -
    (1 - convert) * expectedPoints(1, 10, Math.max(1, 100 - s.yardLine));
  const punt = -expectedPoints(1, 10, Math.max(20, 100 - (s.yardLine + PUNT_NET)));
  const kick = 100 - s.yardLine + 17;
  if (kick > 58) return Math.max(goFor, punt);
  // Make odds by distance, about the NFL's: nine in ten from 40, seven in ten from 50.
  const make = Math.min(0.97, Math.max(0.3, 1.65 - 0.019 * kick));
  const fg =
    make * (3 - expectedPoints(1, 10, 25)) - (1 - make) * expectedPoints(1, 10, Math.max(20, 100 - s.yardLine + 7));
  return Math.max(goFor, punt, fg);
}

const ep = (s: PlayState) => (s.down >= 4 ? fourthDownValue(s) : expectedPoints(s.down, s.distance, s.yardLine));

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

/** A run of 10 yards or more, or a completion of 20 or more, that the offense kept. */
export function isExplosive(kind: 'run' | 'pass', gained: number, complete: boolean, turnover = false): boolean {
  if (turnover) return false;
  return kind === 'run' ? gained >= 10 : complete && gained >= 20;
}
