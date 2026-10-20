/**
 * Weather audit, three parts.
 *
 * 1. Climate: roll every game of many seasons and check the league's weather looks like the NFL's
 *    (wind, how often it rains or snows, roofs, night games, storm fronts), and that TYPICAL in
 *    weather.ts is still the season's average cost by quarter (the engine measures every quarter
 *    against it, so league totals hold).
 * 2. Forecasts: shown rain chances come true about as often as they say, storm fronts included.
 * 3. Effects: replay the same games under one condition at a time and check passing production falls
 *    by the condition's cost (Covers' splits, see `weatherCost`) and kicks by the research's share.
 *
 *   npm run weather
 */
import { createLeague } from '../src/engine/generate';
import { simulateGame } from '../src/engine/match/gameSim';
import type { League } from '../src/engine/types';
import { forecast, gameWeather, TYPICAL, weatherAt, weatherCost, type Weather } from '../src/engine/weather';

let misses = 0;
const check = (label: string, value: number, [lo, hi]: [number, number], digits = 2) => {
  const ok = value >= lo && value <= hi;
  if (!ok) misses++;
  console.log(
    `${label.padEnd(34)} ${value.toFixed(digits).padStart(8)}   ${lo}–${hi}${ok ? '' : value < lo ? '  ▼ LOW' : '  ▲ HIGH'}`,
  );
};
const info = (label: string, value: string) => console.log(`${label.padEnd(34)} ${value.padStart(8)}`);

const league = createLeague({ seed: 'weather' });
const games = league.games.filter((g) => !g.playoffRound);

// ───────── climate ─────────

const ROLLS = 200;
const sum = {
  kept: 0,
  kick: 0,
  fumble: 0,
  games: 0,
  outdoor: 0,
  wind: 0,
  windy: 0,
  wet: 0,
  late: 0,
  snow: 0,
  heavySnow: 0,
  retract: 0,
  open: 0,
  night: 0,
};
const gbDec: number[] = [];
const decTemps = { day: [0, 0], night: [0, 0] };
/** A game's cost averaged over its four quarters (rain that starts late costs only the quarters it falls in). */
const QUARTERS = [1, 2, 3, 4];
const byQuarter = (w: Weather) => QUARTERS.map((q) => weatherCost(weatherAt(w, q)));
for (let i = 0; i < ROLLS; i++) {
  league.seed = `weather-${i}`;
  for (const g of games) {
    const w = gameWeather(league, g);
    for (const c of byQuarter(w)) {
      sum.kept += Math.log(1 - c.pass) / 4;
      sum.kick += c.kick / 4;
      sum.fumble += c.fumble / 4;
    }
    sum.games++;
    const abbrev = league.teams[g.homeId].abbrev;
    if (['HOU', 'IND', 'DAL', 'ATL', 'ARI'].includes(abbrev)) {
      sum.retract++;
      if (w.roof === 'open') sum.open++;
    }
    if (w.roof !== 'outdoors') continue;
    sum.outdoor++;
    if (w.night) sum.night++;
    if (g.week >= 13 && g.week <= 17) {
      const t = decTemps[w.night ? 'night' : 'day'];
      t[0] += w.tempF;
      t[1]++;
    }
    sum.wind += w.windMph;
    if (w.windMph >= 20) sum.windy++;
    if (w.precip !== 'none') sum.wet++;
    if (w.onset) sum.late++;
    if (w.precip === 'snow') sum.snow++;
    if (w.precip === 'snow' && w.heavy) sum.heavySnow++;
    if (abbrev === 'GB' && g.week >= 13 && g.week <= 17) gbDec.push(w.tempF);
  }
}
console.log(`\nClimate: ${ROLLS} rolls of a ${games.length}-game season\n`);
check('outdoor games %', (100 * sum.outdoor) / sum.games, [60, 70], 1);
check('avg outdoor wind (mph)', sum.wind / sum.outdoor, [6.5, 9]);
check('outdoor games with 20+ mph wind %', (100 * sum.windy) / sum.outdoor, [2, 7], 1);
check('outdoor games with rain or snow %', (100 * sum.wet) / sum.outdoor, [8, 16], 1);
info('  of which snow %', ((100 * sum.snow) / sum.wet).toFixed(1));
info('  of which start after kickoff %', ((100 * sum.late) / sum.wet).toFixed(1));
check('outdoor games at night %', (100 * sum.night) / sum.outdoor, [15, 25], 1);
info(
  'December kickoff, day / night (°F)',
  `${(decTemps.day[0] / decTemps.day[1]).toFixed(1)} / ${(decTemps.night[0] / decTemps.night[1]).toFixed(1)}`,
);
info('heavy-snow games per season', (sum.heavySnow / ROLLS).toFixed(2));
// Roofs open only in mild, calm, dry weather, which costs nothing either way: the share is for show.
info('retractable roofs open %', ((100 * sum.open) / sum.retract).toFixed(1));
info('Green Bay December kickoff (°F)', (gbDec.reduce((a, b) => a + b, 0) / gbDec.length).toFixed(1));
// TYPICAL must stay the season's average, or every game shifts by the difference.
check('TYPICAL.pass − season average', TYPICAL.pass - (1 - Math.exp(sum.kept / sum.games)), [-0.003, 0.003], 4);
check('TYPICAL.kick − season average', TYPICAL.kick - sum.kick / sum.games, [-0.1, 0.1], 3);
check('TYPICAL.fumble − season average', TYPICAL.fumble - sum.fumble / sum.games, [-0.01, 0.01], 3);

// ───────── forecasts ─────────

const buckets = new Map<number, { n: number; wet: number }>();
let inTemp = 0;
let shown = 0;
/** Outdoor games and wet ones, in weeks with a storm front over the region and without. */
const fronts = { storm: [0, 0], quiet: [0, 0] };
for (let i = 0; i < ROLLS; i++) {
  league.seed = `weather-${i}`;
  for (const g of games) {
    const w = gameWeather(league, g);
    if (w.roof !== 'outdoors') continue;
    for (const out of [0, 1]) {
      league.week = g.week - out;
      const f = forecast(league, g)!;
      const b = buckets.get(f.chance) ?? { n: 0, wet: 0 };
      b.n++;
      if (w.precip !== 'none') b.wet++;
      buckets.set(f.chance, b);
      shown++;
      if (w.tempF >= f.tempF[0] && w.tempF <= f.tempF[1]) inTemp++;
      if (out === 1) {
        const t = fronts[f.storm ? 'storm' : 'quiet'];
        t[0]++;
        if (w.precip !== 'none') t[1]++;
      }
    }
  }
}
league.week = 1;
console.log('\nForecasts: how often each shown rain chance came true (buckets of 300+)\n');
for (const [chance, b] of [...buckets].sort((a, b) => a[0] - b[0])) {
  if (b.n < 300) continue;
  check(`  shown ${chance}% (${b.n})`, (100 * b.wet) / b.n, [chance - 8, chance + 8], 1);
}
info('true temp inside the shown range %', ((100 * inTemp) / shown).toFixed(1));
check(
  'outdoor games under a storm front %',
  (100 * fronts.storm[0]) / (fronts.storm[0] + fronts.quiet[0]),
  [20, 30],
  1,
);
// By construction a front makes a wet game STORM_WET / calm(STORM_WET) = 3 times as likely as a quiet week.
check(
  'wet games, storm ÷ quiet weeks',
  fronts.storm[1] / fronts.storm[0] / (fronts.quiet[1] / fronts.quiet[0]),
  [2.5, 3.5],
);

// ───────── effects ─────────

const day = (w: Partial<Weather>): Weather => ({ roof: 'outdoors', tempF: 70, windMph: 4, precip: 'none', ...w });
/** Each condition alone (plus a blizzard, to see the cap), and the research's own share where it gives one. */
const CONDITIONS: [string, Weather, string][] = [
  ['wind 12 mph', day({ windMph: 12 }), 'noticeable'],
  ['wind 17 mph', day({ windMph: 17 }), 'a second step'],
  ['wind 23 mph', day({ windMph: 23 }), '1.5–2× that step'],
  ['rain', day({ tempF: 60, precip: 'rain' }), '−12%'],
  ['heavy snow', day({ tempF: 30, precip: 'snow', heavy: true }), '−25% (+cold)'],
  ['cold 40°F', day({ tempF: 40 }), '−5%'],
  ['cold 15°F', day({ tempF: 15 }), '−8%'],
  ['heat 92°F', day({ tempF: 92 }), '−8%'],
  ['blizzard (capped)', day({ tempF: 20, windMph: 25, precip: 'snow', heavy: true }), '−40% cap'],
  ['rain from the 3rd', day({ tempF: 60, precip: 'rain', onset: 3 }), 'half of rain'],
  ['mile-high air', day({ altitudeFt: 5280 }), 'kicks carry'],
];
const leagues: League[] = [0, 1, 2].map((i) => createLeague({ seed: `weather-fx-${i}` }));

interface Tally {
  passYds: number;
  teamGames: number;
  rushYds: number;
  rushAtt: number;
  /** Field goals by distance: attempts and makes. */
  fg: Map<number, [number, number]>;
}
function play(w: Weather): Tally {
  const t: Tally = { passYds: 0, teamGames: 0, rushYds: 0, rushAtt: 0, fg: new Map() };
  for (const l of leagues) {
    for (const g of l.games.filter((g) => !g.playoffRound)) {
      const r = simulateGame(l, g, { weather: w, keepPlays: true });
      for (const side of [r.home, r.away]) {
        t.passYds += side.passYds;
        t.rushYds += side.rushYds;
        t.rushAtt += side.rushAtt;
        t.teamGames++;
      }
      for (const p of r.plays ?? []) {
        const m = p.text.match(/(\d+)-yard field goal is (GOOD|NO GOOD)/);
        if (!m) continue;
        const d = Number(m[1]);
        const f = t.fg.get(d) ?? [0, 0];
        f[0]++;
        if (m[2] === 'GOOD') f[1]++;
        t.fg.set(d, f);
      }
    }
  }
  return t;
}
/** Kicks made against what the calm day's kickers made from the same distances (five-yard bands). */
function kickRatio(t: Tally, calm: Tally): number {
  const band = (d: number) => Math.floor(d / 5);
  const rate = new Map<number, [number, number]>();
  for (const [d, [a, m]] of calm.fg) {
    const r = rate.get(band(d)) ?? [0, 0];
    rate.set(band(d), [r[0] + a, r[1] + m]);
  }
  let made = 0;
  let expected = 0;
  for (const [d, [a, m]] of t.fg) {
    const r = rate.get(band(d));
    if (!r || r[0] < 20) continue;
    made += m;
    expected += (a * r[1]) / r[0];
  }
  return made / expected;
}

const calm = play(day({}));
const per = (t: Tally) => t.passYds / t.teamGames;
console.log(`\nEffects: ${calm.teamGames / 2} games replayed per condition. Passing yards against a calm 70°F day,`);
console.log(
  'target = 1 − weatherCost(w).pass (by quarter) ± 0.03; field goals made against calm-day rates from the same distances\n',
);
console.log(
  `${'condition'.padEnd(20)} ${'research'.padEnd(17)} ${'pass'.padStart(6)}  ${'target'.padStart(11)}   ${'rush ypc'.padStart(8)}  ${'kicks'.padStart(6)}`,
);
const KICK_TARGETS: Record<string, [number, number]> = {
  // 77% made on kicks expected at ~89%, 76% at ~88%, ~2% below expected in rain; the coaches' shorter tries fold in.
  'wind 23 mph': [0.82, 0.92],
  'heavy snow': [0.82, 0.92],
  rain: [0.95, 1.0],
  // A mile up kicks carry about four yards: more of them go in from the same spots.
  'mile-high air': [1.01, 1.08],
};
for (const [label, w, research] of CONDITIONS) {
  const t = play(w);
  const ratio = per(t) / per(calm);
  const target = Math.exp(byQuarter(w).reduce((a, c) => a + Math.log(1 - c.pass), 0) / 4);
  const lo = target - 0.03;
  const hi = target + 0.03;
  const ok = ratio >= lo && ratio <= hi;
  const kicks = kickRatio(t, calm);
  const kt = KICK_TARGETS[label];
  const kickOk = !kt || (kicks >= kt[0] && kicks <= kt[1]);
  if (!ok) misses++;
  if (!kickOk) misses++;
  console.log(
    `${label.padEnd(20)} ${research.padEnd(17)} ${ratio.toFixed(3).padStart(6)}  ${`${lo.toFixed(2)}–${hi.toFixed(2)}`.padStart(11)}   ${(t.rushYds / t.rushAtt / (calm.rushYds / calm.rushAtt)).toFixed(3).padStart(8)}  ${kicks.toFixed(3).padStart(6)}${kt ? ` (${kt[0]}–${kt[1]})` : ''}${ok ? '' : ratio < lo ? '  ▼ PASS LOW' : '  ▲ PASS HIGH'}${kickOk ? '' : '  ✗ KICKS'}`,
  );
}

console.log(`\n${misses} number(s) outside target range`);
process.exit(misses ? 1 : 0);
