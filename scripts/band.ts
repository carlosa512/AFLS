/**
 * Two bands for the lines that swing with the league. A league is a world of its own (the owner, Nov 5: "I'm ok with the
 * butterfly effect in my game … diverge in maybe interesting ways, but not abnormal"), so a few lines judge it in two:
 * outside the usual band (each line's range before this) a run warns (⚠: this league drifted), and only outside the
 * normal band does it fail (abnormal). The lines: trade requests, rooms in doubt and rooms reading Tight (`morale.ts`), live
 * coaching trees and leagues whose founding trees all died out (`careers.ts`), head-coach retreads (`offseason.ts`), win
 * spread (`calibrate.ts`). Both bands are the owner's call; neither is moved to get a run green.
 */
export type Band = 'usual' | 'unusual' | 'abnormal' | 'none';

const inside = (v: number, [lo, hi]: [number, number]) => v >= lo && v <= hi;

/** Which band a value sits in; without a normal band, outside the usual one is abnormal (as before). */
export function bandOf(value: number, usual: [number, number], normal?: [number, number]): Band {
  if (!Number.isFinite(value)) return 'none';
  if (inside(value, usual)) return 'usual';
  return normal && inside(value, normal) ? 'unusual' : 'abnormal';
}

/** What a line carries after its range: nothing, a warning (no arrow: it isn't a miss), the miss's direction, or that
 * it wasn't measured (a script counts that as a miss: say so on the line). */
export function bandMark(value: number, usual: [number, number], normal?: [number, number]): string {
  const band = bandOf(value, usual, normal);
  if (band === 'unusual') return `  ⚠ unusual for a league (fails outside ${normal![0]}–${normal![1]})`;
  if (band === 'abnormal') return value < usual[0] ? '  ▼ LOW' : '  ▲ HIGH';
  if (band === 'none') return '  ✗ NOT MEASURED';
  return '';
}
