import { isCaptain } from '../engine/morale';
import type { League, Player } from '../engine/types';
import { contrast, readableOn, type TeamColors } from './color';

// The captain's patch, shown close up on his card beside his name: a "C" in a team colour, four tiny stars under it
// lit one per season in a row as captain, and the whole patch gold once he's led the room longer than the stars count.

/** Stars on the patch; one lights for each season in a row as captain. */
export const PATCH_STARS = 4;
/** Seasons in a row as captain from which the patch is solid gold. */
export const GOLD_AFTER = PATCH_STARS + 1;
const GOLD = '#D9A93A';
const GOLD_LIGHT = '#F3D27A';
const DARK = '#0F172A';

/** How many seasons in a row, this one included, he's been a captain: 0 if he isn't one this season. */
export function captainStreak(league: League | null, p: Player): number {
  if (!league || !isCaptain(league, p)) return 0;
  const seasons = p.captainSeasons ?? [];
  let n = 0;
  for (let i = seasons.length - 1, want = league.season; i >= 0 && seasons[i] === want; i--, want--) n++;
  return Math.max(1, n);
}

/** What the patch says, for its label and tooltip. */
export function patchText(streak: number): string {
  return streak > 1 ? `Captain · ${streak} seasons in a row` : 'Captain';
}

/** A five-point star of radius `r` at (x, y). */
function star(x: number, y: number, r: number): string {
  const pts: string[] = [];
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 ? r * 0.45 : r;
    pts.push(`${+(x + rr * Math.cos(a)).toFixed(2)},${+(y + rr * Math.sin(a)).toFixed(2)}`);
  }
  return pts.join(' ');
}

/** The patch on `background` (the card's header, in the team's primary), `height` px tall. */
export function CaptainPatch({
  streak,
  colors,
  background,
  height = 64,
}: {
  streak: number;
  colors: TeamColors;
  background: string;
  height?: number;
}) {
  const gold = streak >= GOLD_AFTER;
  // the secondary when it stands off the header, else white or dark, whichever does
  const fill = gold
    ? GOLD
    : contrast(background, colors.secondary) >= 1.6
      ? colors.secondary
      : contrast(background, '#FFFFFF') >= contrast(background, DARK)
        ? '#FFFFFF'
        : DARK;
  const ink = readableOn(fill, colors.primary);
  const label = patchText(streak);
  return (
    <svg
      className="captain-patch"
      viewBox="0 0 40 50"
      height={height}
      width={(height * 40) / 50}
      fontFamily="var(--font-display)"
      role="img"
      aria-label={label}
    >
      <title>{label}</title>
      {/* a shield: square shoulders, a point at the bottom */}
      <path
        d="M4 3 H36 Q38 3 38 5 V33 Q38 38 33 41 L20 48 L7 41 Q2 38 2 33 V5 Q2 3 4 3 Z"
        fill={fill}
        stroke={gold ? '#8A6A1E' : DARK}
        strokeOpacity={gold ? 0.9 : 0.5}
        strokeWidth={1.4}
      />
      {/* a stitched border, like an embroidered patch */}
      <path
        d="M6 6 H34 V32.5 Q34 36 30.5 38 L20 43.8 L9.5 38 Q6 36 6 32.5 Z"
        fill="none"
        stroke={gold ? GOLD_LIGHT : ink}
        strokeOpacity={gold ? 0.9 : 0.45}
        strokeWidth={0.8}
        strokeDasharray="1.6 1.2"
      />
      <text x="20" y="21" textAnchor="middle" dominantBaseline="central" fontSize={24} fontWeight={900} fill={ink}>
        C
      </text>
      {Array.from({ length: PATCH_STARS }, (_, i) => {
        const lit = gold || i < streak;
        return (
          <polygon
            key={i}
            points={star(10.6 + i * 6.25, 35.4, 2.5)}
            fill={lit ? (gold ? ink : GOLD) : 'none'}
            stroke={lit ? (gold ? 'none' : '#8A6A1E') : ink}
            strokeOpacity={lit ? 0.9 : 0.5}
            strokeWidth={0.6}
          />
        );
      })}
    </svg>
  );
}
