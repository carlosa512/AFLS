/**
 * What the broadcast view paints: the field on the camera's own projection (`broadcastView.ts`), from the same facts
 * All-22 paints with (`FieldPaint.tsx`: the surface, the end zones' words, the goalposts, the team areas). The paint is
 * the stadium: it is the same in every quarter, whichever way the teams are going. Behind it, the stand and the sky,
 * and over it whatever is falling, from the game's own weather.
 * Spec: docs/superpowers/specs/2026-11-10-broadcast-field-and-moments-design.md §2.
 */
import { memo } from 'react';
import { FIELD_W, HASH_HI, HASH_LO, MID } from '../../engine/field/ballPath';
import { Rng } from '../../engine/rng';
import type { Team } from '../../engine/types';
import type { Weather } from '../../engine/weather';
import { mix } from '../color';
import { endZoneLetter, facing, project, pt, quad, VIEW_W } from './broadcastView';
import { endZones, GREENS, POSTS, surfaceFor, TEAM_AREA, type EndZone } from './FieldPaint';

const FIELD_FONT = { fontFamily: 'var(--font-field)' };
/** Snow on the grass: every green goes this far toward white. */
const SNOWED = 0.38;
/** A crossbar is ten feet up and the uprights rise thirty-five above it, in yards. */
const BAR = 3.33;
const TOP = BAR + 11.67;
/** Men on each bench. */
const BENCH_MEN = 16;

/** One end zone: its colour, then its words a letter at a time, each flat on the grass, feet toward the field. */
function Zone({ zone, x0, side }: { zone: EndZone; x0: number; side: 'low' | 'high' }) {
  const n = zone.text.length;
  const [y0, y1] = [5, FIELD_W - 5];
  const size = Math.min(6.4, ((y1 - y0) / n) * 1.25);
  return (
    <g>
      <polygon points={quad(x0, x0 + 10)} fill={zone.fill} />
      {[...zone.text].map((ch, i) => {
        if (ch === ' ') return null;
        const along = ((i + 0.5) / n) * (y1 - y0);
        return (
          <g key={i} transform={endZoneLetter(x0 + 5, side === 'high' ? y0 + along : y1 - along)}>
            <text
              className={`ez-letter ${side}`}
              textAnchor="middle"
              dominantBaseline="central"
              fontSize={size}
              fill="#fff"
              stroke={zone.stroke}
              strokeWidth={0.4}
              paintOrder="stroke"
              style={FIELD_FONT}
            >
              {ch}
            </text>
          </g>
        );
      })}
    </g>
  );
}

/** A team's area along its sideline, and the men standing in it. */
function Bench({ team, side, y0, y1 }: { team: Team; side: 'home' | 'away'; y0: number; y1: number }) {
  return (
    <g className={`bench ${side}`}>
      <polygon
        points={quad(TEAM_AREA[0], TEAM_AREA[1], y0, y1)}
        fill={team.colors[0]}
        opacity={0.5}
        stroke="#fff"
        strokeWidth={0.4}
        strokeDasharray="1.6 1.2"
      />
      {Array.from({ length: BENCH_MEN }, (_, i) => {
        const p = project(TEAM_AREA[0] + 2 + i * 2.1, (y0 + y1) / 2 + ((i % 3) - 1) * 0.9, 0.9);
        return (
          <circle
            key={i}
            className="bench-man"
            // Each man a beat behind the last when they hop (`data-cheer` on the scene).
            style={{ animationDelay: `${(-i * 0.07).toFixed(2)}s` }}
            cx={p.x.toFixed(1)}
            cy={p.y.toFixed(1)}
            r={(1.5 * p.scale).toFixed(2)}
            fill={i % 4 ? '#e9efea' : team.colors[1]}
            stroke={team.colors[0]}
            strokeWidth={0.5}
          />
        );
      })}
    </g>
  );
}

/** The ground: everything painted on it, under the ball. */
export const FieldGround = memo(function FieldGround({
  home,
  away,
  neutral,
  snow,
}: {
  home: Team;
  away: Team;
  neutral?: boolean;
  /** Snow is falling: the greens pale. */
  snow?: boolean;
}) {
  const base = GREENS[surfaceFor(home)];
  const tone = (c: string) => (snow ? mix(c, '#ffffff', SNOWED) : c);
  const [low, high] = endZones(home, away, neutral);
  const stripes: number[] = [];
  for (let x = 0; x < 100; x += base.every) if ((x / base.every) % 2 === 1) stripes.push(x);
  const ticks: string[] = [];
  for (let x = 1; x < 100; x++) {
    if (x % 5 === 0) continue;
    for (const [a, b] of [
      [0.3, 1],
      [FIELD_W - 1, FIELD_W - 0.3],
      [HASH_LO - 0.4, HASH_LO + 0.4],
      [HASH_HI - 0.4, HASH_HI + 0.4],
    ])
      ticks.push(`M${pt(x, a)}L${pt(x, b)}`);
  }
  const yardLine = (x: number) => {
    const a = project(x, 0);
    const b = project(x, FIELD_W);
    const width = x === 0 || x === 100 ? 1.4 : x % 10 ? 0.5 : 0.8;
    return (
      <line
        key={x}
        x1={a.x.toFixed(1)}
        y1={a.y.toFixed(1)}
        x2={b.x.toFixed(1)}
        y2={b.y.toFixed(1)}
        stroke="rgba(255,255,255,0.78)"
        strokeWidth={width}
        strokeLinecap="round"
      />
    );
  };
  return (
    <g className="ground">
      <polygon points={quad(-14, 114, -9, FIELD_W + 9)} fill={tone(base.apron)} />
      {/* The benches never move: away along the far sideline, home along the near one. */}
      <Bench team={away} side="away" y0={FIELD_W + 1.8} y1={FIELD_W + 7.5} />
      <Bench team={home} side="home" y0={-7.5} y1={-1.8} />
      <polygon points={quad(-10, 110)} fill={tone(base.field)} />
      {stripes.map((x) => (
        <polygon key={x} className="stripe" points={quad(x, x + base.every)} fill={tone(base.stripe)} />
      ))}
      <Zone zone={low} x0={-10} side="low" />
      <Zone zone={high} x0={100} side="high" />
      {Array.from({ length: 21 }, (_, i) => i * 5).map(yardLine)}
      <path d={ticks.join('')} stroke="rgba(255,255,255,0.55)" strokeWidth={0.45} />
      {Array.from({ length: 9 }, (_, i) => (i + 1) * 10).flatMap((x) =>
        [8.5, FIELD_W - 8.5].map((y) => (
          <g key={`${x}:${y}`} transform={facing(x, y)}>
            <text
              textAnchor="middle"
              dominantBaseline="central"
              fontSize={4.2}
              fill="#fff"
              opacity={0.9}
              style={FIELD_FONT}
            >
              {x <= 50 ? x : 100 - x}
            </text>
          </g>
        )),
      )}
      {/* The home side's mark at midfield. */}
      <g transform={facing(50, MID)}>
        <circle r={4.6} fill={home.colors[0]} stroke="#fff" strokeWidth={0.4} />
        <text
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={3.3}
          fill="#fff"
          stroke={home.colors[1]}
          strokeWidth={0.28}
          paintOrder="stroke"
          style={FIELD_FONT}
        >
          {home.abbrev}
        </text>
      </g>
      <polygon points={quad(-10, 110)} fill="none" stroke="#fff" strokeWidth={1.3} />
    </g>
  );
});

/** The goalposts, standing over each end line: drawn over the ball, which passes under or between them. */
export const FieldPosts = memo(function FieldPosts() {
  const bar = (x0: number, y0: number, h0: number, x1: number, y1: number, h1: number, color: string, w: number) => {
    const a = project(x0, y0, h0);
    const b = project(x1, y1, h1);
    return (
      <line
        x1={a.x.toFixed(1)}
        y1={a.y.toFixed(1)}
        x2={b.x.toFixed(1)}
        y2={b.y.toFixed(1)}
        stroke={color}
        strokeWidth={w}
        strokeLinecap="round"
      />
    );
  };
  const [lo, hi] = [MID - POSTS / 2, MID + POSTS / 2];
  return (
    <>
      {[110, -10].map((x) => {
        // The base stands behind the end line and goosenecks forward to the crossbar.
        const base = x + (x > 50 ? 2.2 : -2.2);
        return (
          <g key={x} className="posts">
            {bar(base, MID, 0, base, MID, BAR - 0.6, '#c9a300', 1.3)}
            {bar(base, MID, BAR - 0.6, x, MID, BAR, '#ffd21f', 1.2)}
            {bar(x, lo, BAR, x, hi, BAR, '#ffd21f', 1.3)}
            {bar(x, lo, BAR, x, lo, TOP, '#ffd21f', 1.1)}
            {bar(x, hi, BAR, x, hi, TOP, '#ffd21f', 1.1)}
          </g>
        );
      })}
    </>
  );
});

// ───────── the stadium and the weather ─────────

export type Sky = 'night' | 'day' | 'overcast' | 'roof';
/** What is over the field: a roof for a dome or a closed one, cloud when anything is falling, else the hour. */
export const skyOf = (w: Weather): Sky =>
  w.roof === 'dome' || w.roof === 'closed' ? 'roof' : w.precip !== 'none' ? 'overcast' : w.night ? 'night' : 'day';

/** The sky's top and bottom colours. */
function skyColors(w: Weather): [string, string] {
  const sky = skyOf(w);
  if (sky === 'roof') return ['#11161a', '#1b2227'];
  if (sky === 'night') return ['#05080f', '#101b33'];
  if (sky === 'day') return ['#6ea6d6', '#cfe2ee'];
  return w.night ? ['#1b2026', '#39424a'] : ['#7d8791', '#b9c1c8'];
}
/** How bright the crowd reads: daylight, a roof's lamps, or floodlights. */
const crowdLight = (w: Weather) => (skyOf(w) === 'roof' ? 0.7 : w.night ? 0.55 : 0.85);
/** The stand: nine rows of ninety-two, top to bottom between these heights. */
const ROWS = 9;
const SEATS = 92;
const STAND = { top: 22, bottom: 60 };
/** How far a flag leans a mile an hour of wind, and the most it can. */
const LEAN = 0.4;
const MAX_LEAN = 10;

/**
 * Behind the far sideline: the sky, a stand with its crowd in the home club's colours (both clubs' at a neutral
 * site), the lights of a night game, two flags on the rim that lean with the wind, and a wall along the field. The
 * crowd is drawn from a fixed pattern, the same every time for a club.
 */
export const Stadium = memo(function Stadium({
  home,
  away,
  neutral,
  weather,
}: {
  home: Team;
  away: Team;
  neutral?: boolean;
  weather: Weather;
}) {
  const sky = skyOf(weather);
  const [top, bottom] = skyColors(weather);
  const rng = new Rng(`stand:${home.abbrev}:${neutral ? away.abbrev : ''}`);
  const light = crowdLight(weather);
  const fans = [];
  for (let row = 0; row < ROWS; row++)
    for (let i = 0; i < SEATS; i++) {
      const r = rng.next();
      // A neutral crowd is split down the middle of the stand.
      const club = neutral && i >= SEATS / 2 ? away : home;
      const fill =
        r < 0.34 ? club.colors[0] : r < 0.46 ? club.colors[1] : r < 0.62 ? '#e8ece9' : r < 0.8 ? '#5f6b65' : '#27302c';
      fans.push(
        <circle
          key={`${row}:${i}`}
          className="fan"
          cx={(i * 4 + (row % 2) * 2 + rng.next() * 1.2).toFixed(1)}
          cy={(STAND.top + 3.5 + row * 3.9).toFixed(1)}
          r={1.25}
          fill={fill}
          opacity={(light * (0.6 + rng.next() * 0.4)).toFixed(2)}
        />,
      );
    }
  const lean = sky === 'roof' ? 0 : Math.min(MAX_LEAN, weather.windMph * LEAN);
  return (
    <g className={`stadium sky-${sky}`}>
      <defs>
        <linearGradient id="bf-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={top} />
          <stop offset="1" stopColor={bottom} />
        </linearGradient>
        <radialGradient id="bf-glow">
          <stop offset="0" stopColor="rgba(255,250,220,0.9)" />
          <stop offset="1" stopColor="rgba(255,250,220,0)" />
        </radialGradient>
      </defs>
      <rect width={VIEW_W} height={STAND.top + 8} fill="url(#bf-sky)" />
      {sky === 'roof' &&
        Array.from({ length: 12 }, (_, i) => i * 36 - 40).map((x) => (
          <path
            key={x}
            d={`M${x},30L${x + 60},0M${x + 60},30L${x},0`}
            stroke="rgba(255,255,255,0.08)"
            strokeWidth={1.1}
          />
        ))}
      <rect y={STAND.top} width={VIEW_W} height={STAND.bottom - STAND.top} fill="#0e1513" />
      <g className="crowd">{fans}</g>
      <rect y={STAND.bottom - 1} width={VIEW_W} height={4} fill="#1a2420" />
      {Array.from({ length: 9 }, (_, i) => 6 + i * 44).map((x, i) => (
        <rect
          key={x}
          x={x}
          y={STAND.bottom - 0.2}
          width={30}
          height={2.4}
          rx={0.5}
          fill={i % 2 ? '#2c3833' : home.colors[0]}
        />
      ))}
      <g className="flags" data-lean={lean.toFixed(1)}>
        {[70, 290].map((x) => (
          <g key={x}>
            <line x1={x} y1={STAND.top} x2={x} y2={STAND.top - 11} stroke="#9aa6a0" strokeWidth={0.7} />
            <path
              d={`M${x},${STAND.top - 11}q${lean / 2},${1 + lean / 6} ${lean + 2},${lean / 5}l0,3.4q${-lean / 2},${-lean / 8} ${-lean - 2},0.6z`}
              fill={home.colors[1]}
            />
          </g>
        ))}
      </g>
      {sky !== 'roof' && weather.night && (
        <g className="lights">
          {[36, 132, 228, 324].map((x) => (
            <g key={x}>
              <circle cx={x} cy={STAND.top - 6} r={15} fill="url(#bf-glow)" opacity={sky === 'overcast' ? 0.35 : 0.5} />
              {[-2, -1, 0, 1, 2].map((k) => (
                <rect key={k} x={x + k * 2.6 - 1} y={STAND.top - 8} width={2} height={3.2} rx={0.4} fill="#fffbe0" />
              ))}
            </g>
          ))}
        </g>
      )}
    </g>
  );
});

/** Drops and flakes a game: half each when it is both, twice as many when it is heavy. */
const DROPS = 70;
const FLAKES = 90;

/** What is falling, over everything: rain as streaks, snow as flakes, both for a mix. Nothing under a roof. */
export const WeatherFall = memo(function WeatherFall({ weather }: { weather: Weather }) {
  if (skyOf(weather) === 'roof' || weather.precip === 'none') return null;
  const rng = new Rng(`fall:${weather.precip}`);
  const hard = weather.heavy ? 2 : 1;
  const share = weather.precip === 'mixed' ? 0.5 : 1;
  const drops = weather.precip === 'snow' ? 0 : Math.round(DROPS * share) * hard;
  const flakes = weather.precip === 'rain' ? 0 : Math.round(FLAKES * share) * hard;
  const timing = (seconds: number) => ({
    animationDuration: `${seconds.toFixed(2)}s`,
    animationDelay: `-${(rng.next() * seconds).toFixed(2)}s`,
  });
  return (
    <g className="weather-fall" aria-hidden="true">
      {Array.from({ length: drops }, (_, i) => {
        const x = rng.next() * (VIEW_W + 40) - 20;
        return (
          <line
            key={`d${i}`}
            className="drop"
            x1={x.toFixed(1)}
            y1={0}
            x2={(x - 2.4).toFixed(1)}
            y2={9}
            style={timing(0.55 + rng.next() * 0.5)}
          />
        );
      })}
      {Array.from({ length: flakes }, (_, i) => (
        <circle
          key={`f${i}`}
          className="flake"
          cx={(rng.next() * (VIEW_W + 20) - 10).toFixed(1)}
          cy={0}
          r={(0.5 + rng.next() * 0.8).toFixed(2)}
          style={timing(3.5 + rng.next() * 4)}
        />
      ))}
    </g>
  );
});
