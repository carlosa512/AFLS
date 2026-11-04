/**
 * A spatial play's yards as the engine keeps them: whole yards, a touchdown only when he crossed the goal line, never
 * past his own goal line (a tackle there is the engine's safety, as today).
 */
export function playYards(
  r: { yards: number; touchdown: boolean },
  yardLine: number,
): { yards: number; touchdown: boolean } {
  if (r.touchdown) return { yards: 100 - yardLine, touchdown: true };
  let yards = Math.round(r.yards);
  if (yardLine + yards >= 100) yards = 99 - yardLine;
  if (yardLine + yards < 0) yards = -yardLine;
  return { yards, touchdown: false };
}
