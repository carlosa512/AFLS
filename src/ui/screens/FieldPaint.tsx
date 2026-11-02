/**
 * The field All-22 is played on, painted in field coordinates (x −10…110 goal to goal, y 0…53.3 across): the home
 * stadium's surface (grass mowed in five-yard stripes, or turf), each end zone in the colors of the team that defends
 * it with its name across it, the home side's mark at midfield, the yard numbers and their arrows, and the two team
 * areas along the sidelines. Drawn once: the field group's transform turns and moves it with the camera.
 */
import { STADIUMS, type Surface } from '../../engine/data/stadiums';
import type { Team } from '../../engine/types';
import { FIELD_W, HASH_HI, HASH_LO, MID } from '../stage/ballPath';

/** The greens: the playing surface, its alternating stripe, and the apron round it. */
const GREENS: Record<Surface, { field: string; stripe: string; apron: string; every: number }> = {
  // Natural grass: mowed in five-yard stripes, a little deeper in tone.
  grass: { field: '#3a8a3f', stripe: '#327c37', apron: '#27532c', every: 5 },
  // Turf: an even, brighter green; the stripes are barely there.
  turf: { field: '#2f9150', stripe: '#2c884b', apron: '#22573a', every: 10 },
};

/** Between the uprights: 18 feet 6 inches, in yards. */
const POSTS = 6.17;
/** The team area along each sideline: between the 32-yard lines, where the men off the field stand. */
const TEAM_AREA = [32, 68] as const;

/** The home stadium's surface (turf when the market isn't in the table, as a mod league's would be). */
export function surfaceFor(home: Team): Surface {
  return STADIUMS[home.abbrev]?.surface ?? 'turf';
}

const FIELD_FONT = { fontFamily: 'var(--font-field)' };

export function FieldPaint({ home, away }: { home: Team; away: Team }) {
  const g = GREENS[surfaceFor(home)];
  const stripes: number[] = [];
  for (let x = 0; x < 100; x += g.every) if ((x / g.every) % 2 === 1) stripes.push(x);
  /** An end zone: the team that defends it, its color and its name across it, letters toward the goal line. */
  const endZone = (team: Team, x0: number, turn: number) => {
    const name = team.name.toUpperCase();
    return (
      <g>
        <rect x={x0} y={0} width={10} height={FIELD_W} fill={team.colors[0]} />
        <text
          x={x0 + 5}
          y={MID}
          transform={`rotate(${turn} ${x0 + 5} ${MID})`}
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={5}
          fill="#fff"
          stroke={team.colors[1]}
          strokeWidth={0.35}
          paintOrder="stroke"
          letterSpacing={0.5}
          {...(name.length > 9 ? { textLength: 46, lengthAdjust: 'spacingAndGlyphs' } : {})}
          style={FIELD_FONT}
        >
          {name}
        </text>
      </g>
    );
  };
  /** A yard number and its arrow toward the nearer goal, read from the sideline it's painted by. */
  const number = (x: number, y: number, turn: number) => {
    const n = x <= 50 ? x : 100 - x;
    const toward = x < 50 ? -1 : x > 50 ? 1 : 0;
    return (
      <g key={`${x}:${y}`} transform={`rotate(${turn} ${x} ${y})`} opacity={0.88}>
        <text x={x} y={y} textAnchor="middle" dominantBaseline="central" fontSize={2.6} fill="#fff" style={FIELD_FONT}>
          {n}
        </text>
        {toward !== 0 && (
          <polygon
            points={
              // Rotated with the number, so it points the same way on the field from either sideline.
              turn === 180
                ? `${x - toward * 3.1},${y} ${x - toward * 2.2},${y - 0.55} ${x - toward * 2.2},${y + 0.55}`
                : `${x + toward * 3.1},${y} ${x + toward * 2.2},${y - 0.55} ${x + toward * 2.2},${y + 0.55}`
            }
            fill="#fff"
          />
        )}
      </g>
    );
  };
  return (
    <g>
      <rect x={-14} y={-9} width={128} height={FIELD_W + 18} fill={g.apron} />
      {/* The team areas: home on the near sideline, away on the far. */}
      {[
        [home, -7.5],
        [away, FIELD_W + 1.8],
      ].map(([team, y]) => (
        <rect
          key={(team as Team).id}
          x={TEAM_AREA[0]}
          y={y as number}
          width={TEAM_AREA[1] - TEAM_AREA[0]}
          height={5.7}
          fill={(team as Team).colors[0]}
          opacity={0.32}
          stroke="#fff"
          strokeWidth={0.15}
          strokeDasharray="0.8 0.6"
        />
      ))}
      <rect x={-10} y={0} width={120} height={FIELD_W} fill={g.field} />
      {stripes.map((x) => (
        <rect key={x} x={x} y={0} width={g.every} height={FIELD_W} fill={g.stripe} />
      ))}
      {endZone(home, -10, -90)}
      {endZone(away, 100, 90)}
      {/* Yard lines, the goal lines heavier. */}
      {Array.from({ length: 21 }, (_, i) => i * 5).map((x) => (
        <line
          key={x}
          x1={x}
          y1={0}
          x2={x}
          y2={FIELD_W}
          stroke="rgba(255,255,255,0.75)"
          strokeWidth={x === 0 || x === 100 ? 0.4 : x % 10 ? 0.12 : 0.2}
        />
      ))}
      {/* Hash marks, and the yard ticks along each sideline. */}
      {Array.from({ length: 99 }, (_, i) => i + 1)
        .filter((x) => x % 5)
        .map((x) => (
          <g key={x} stroke="rgba(255,255,255,0.55)" strokeWidth={0.1}>
            <line x1={x} y1={HASH_LO - 0.4} x2={x} y2={HASH_LO + 0.4} />
            <line x1={x} y1={HASH_HI - 0.4} x2={x} y2={HASH_HI + 0.4} />
            <line x1={x} y1={0.3} x2={x} y2={1} />
            <line x1={x} y1={FIELD_W - 1} x2={x} y2={FIELD_W - 0.3} />
          </g>
        ))}
      {/* The numbers: upright from the near sideline, upside down from the far one, as on a real field. */}
      {Array.from({ length: 9 }, (_, i) => (i + 1) * 10).flatMap((x) => [number(x, 9, 180), number(x, FIELD_W - 9, 0)])}
      {/* The home side's mark at midfield. */}
      <g transform={`rotate(180 50 ${MID})`}>
        <circle cx={50} cy={MID} r={4.3} fill={home.colors[0]} stroke="#fff" strokeWidth={0.35} />
        <text
          x={50}
          y={MID}
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={3}
          fill="#fff"
          stroke={home.colors[1]}
          strokeWidth={0.25}
          paintOrder="stroke"
          style={FIELD_FONT}
        >
          {home.abbrev}
        </text>
      </g>
      <rect x={-10} y={0} width={120} height={FIELD_W} fill="none" stroke="#fff" strokeWidth={0.35} />
      {/* The goalposts over each end line: the crossbar and uprights, and the gooseneck back to the base. */}
      {[-10, 110].map((x) => {
        const back = x < 50 ? -1 : 1;
        return (
          <g key={x} stroke="#ffd21f" strokeLinecap="round">
            <line x1={x + back * 2.2} y1={MID} x2={x} y2={MID} strokeWidth={0.45} />
            <line x1={x} y1={MID - POSTS / 2} x2={x} y2={MID + POSTS / 2} strokeWidth={0.5} />
            <circle cx={x} cy={MID - POSTS / 2} r={0.45} fill="#ffd21f" strokeWidth={0} />
            <circle cx={x} cy={MID + POSTS / 2} r={0.45} fill="#ffd21f" strokeWidth={0} />
            <circle cx={x + back * 2.2} cy={MID} r={0.55} fill="#c9a300" strokeWidth={0} />
          </g>
        );
      })}
    </g>
  );
}
