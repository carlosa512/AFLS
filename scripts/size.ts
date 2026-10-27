/**
 * Player size (docs/superpowers/specs/2026-10-27-player-size-design.md): builds come out of each position's bell
 * curve, the rare gem turns up in about a quarter of the outliers, no edge leaves its cap, and each lever, replayed
 * on the same games with one group's builds pushed two sd out, moves its own stat the right way. Then the whole
 * league at its medians against the league as built: the edges are centred, so league totals hold.
 *
 *   npm run size
 */
import { createLeague, generatePlayer } from '../src/engine/generate';
import { simulateGame } from '../src/engine/match/gameSim';
import { Rng } from '../src/engine/rng';
import { EDGE_CAP, isOutlier, rollSize, SIZE, sizeEdge, sizeLimits, type Lever } from '../src/engine/size';
import { POSITIONS, type League, type Player, type Position } from '../src/engine/types';

let misses = 0;
const flag = (ok: boolean) => {
  if (!ok) misses++;
  return ok ? '' : '  ✗';
};
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const sd = (xs: number[]) => Math.sqrt(mean(xs.map((x) => (x - mean(xs)) ** 2)));

// ── The curves ──
console.log('Builds: 20,000 rolls a position against the table (mean ±0.2 in / ±2 lb, sd within 10%)\n');
const rng = new Rng('size-check');
for (const pos of POSITIONS) {
  const rolls = Array.from({ length: 20_000 }, () => rollSize(rng, pos));
  const h = rolls.map((r) => r.heightIn);
  const w = rolls.map((r) => r.weightLb);
  const lim = sizeLimits(pos);
  const ok =
    Math.abs(mean(h) - SIZE[pos].h[0]) <= 0.2 &&
    Math.abs(mean(w) - SIZE[pos].w[0]) <= 2 &&
    Math.abs(sd(h) / SIZE[pos].h[1] - 1) <= 0.1 &&
    Math.min(...h) >= lim.h[0] &&
    Math.max(...h) <= lim.h[1] &&
    Math.min(...w) >= lim.w[0] &&
    Math.max(...w) <= lim.w[1];
  console.log(
    `  ${pos.padEnd(5)} ${mean(h).toFixed(2)} ± ${sd(h).toFixed(2)} in (${SIZE[pos].h.join(' ± ')}) · ${mean(w).toFixed(1)} ± ${sd(w).toFixed(1)} lb (${SIZE[pos].w.join(' ± ')})${flag(ok)}`,
  );
}

// ── The rare gem ──
const made = Array.from({ length: 6_000 }, (_, i) =>
  generatePlayer(new Rng(`size-check-gem:${i}`), {
    id: 9_000_000 + i,
    position: POSITIONS[i % 10],
    quality: 11,
    age: 22,
    teamId: null,
    jerseysUsed: new Set(),
  }),
);
const outliers = made.filter((p) => isOutlier(p));
const gems = outliers.filter((p) => p.playsBig).length / outliers.length;
const strays = made.filter((p) => p.playsBig && !isOutlier(p)).length;
console.log(
  `\nRare gem: ${(100 * gems).toFixed(1)}% of ${outliers.length} outliers (20–30%), ${strays} outside the tails (0)${flag(gems >= 0.2 && gems <= 0.3 && !strays)}`,
);

// ── The cap ──
const leagues: League[] = [0, 1, 2, 3].map((i) => createLeague({ seed: `size-fx-${i}` }));
const everyone = leagues.flatMap((l) => Object.values(l.players));
const pairs: [Lever, Position[], Position[]][] = [
  ['contested', ['WR', 'TE', 'RB'], ['CB', 'S', 'LB']],
  ['press', ['WR'], ['CB']],
  ['contact', ['RB', 'WR', 'TE'], ['LB', 'S', 'CB']],
  ['edgeLength', ['EDGE'], ['OL']],
  ['leverage', ['DT'], ['OL']],
];
let worst = 0;
const pick = new Rng('size-check-pairs');
for (const [lever, mine, theirs] of pairs) {
  const a = everyone.filter((p) => mine.includes(p.position));
  const b = everyone.filter((p) => theirs.includes(p.position));
  for (let i = 0; i < 5_000; i++) {
    const e = sizeEdge(pick.pick(a), lever, pick.pick(b));
    worst = Math.max(worst, Math.abs(e));
  }
}
for (const p of everyone.filter((x) => x.position === 'QB')) worst = Math.max(worst, Math.abs(sizeEdge(p, 'lanes')));
console.log(`Largest edge over 25,000 pairs: ${worst.toFixed(2)} (≤ ${EDGE_CAP})${flag(worst <= EDGE_CAP + 1e-9)}`);

// ── The levers, replayed ──
interface Tally {
  att: number;
  cmp: number;
  passYds: number;
  sacked: number;
  rushAtt: number;
  rushYds: number;
  points: number;
  teamGames: number;
}
/** One regular season of every league, each with the builds `shape` gives it (the league itself is never touched). */
function play(shape: (l: League) => void): Tally {
  const t: Tally = { att: 0, cmp: 0, passYds: 0, sacked: 0, rushAtt: 0, rushYds: 0, points: 0, teamGames: 0 };
  for (const base of leagues) {
    const l: League = structuredClone(base);
    shape(l);
    for (const g of l.games.filter((x) => !x.playoffRound)) {
      const r = simulateGame(l, g, { keepPlays: false });
      for (const [side, pts] of [
        [r.home, r.homeScore],
        [r.away, r.awayScore],
      ] as const) {
        t.att += side.passAtt;
        t.cmp += side.passCmp;
        t.passYds += side.passYds;
        t.sacked += side.sacked;
        t.rushAtt += side.rushAtt;
        t.rushYds += side.rushYds;
        t.points += pts;
        t.teamGames++;
      }
    }
  }
  return t;
}
const cmpPct = (t: Tally) => (100 * t.cmp) / t.att;
const sackPct = (t: Tally) => (100 * t.sacked) / (t.att + t.sacked);
const ypc = (t: Tally) => t.rushYds / t.rushAtt;
const ppg = (t: Tally) => t.points / t.teamGames;

/** Push a group's builds `z` sd from their position's median (height, weight or both). */
const push =
  (pos: Position, z: { h?: number; w?: number }, only?: (team: League['teams'][number], p: Player) => boolean) =>
  (l: League) => {
    for (const team of l.teams)
      for (const id of team.depthChart[pos]) {
        const p = l.players[id];
        if (!p || p.position !== pos || (only && !only(team, p))) continue;
        if (z.h !== undefined) p.heightIn = Math.round(SIZE[pos].h[0] + z.h * SIZE[pos].h[1]);
        if (z.w !== undefined) p.weightLb = Math.round(SIZE[pos].w[0] + z.w * SIZE[pos].w[1]);
      }
  };
const tackles = (team: League['teams'][number], p: Player) => {
  const i = team.depthChart.OL.indexOf(p.id);
  return i === 0 || i === 4;
};

const asBuilt = play(() => {});
console.log(`\nLevers: ${asBuilt.teamGames / 2} games replayed per probe, one group's builds 2 sd out\n`);
const PROBES: [string, (l: League) => void, string, (t: Tally) => number, 1 | -1][] = [
  ['short corners', push('CB', { h: -2 }), 'cmp%', cmpPct, 1],
  ['heavy corners', push('CB', { w: 2 }), 'cmp%', cmpPct, -1],
  ['short passers', push('QB', { h: -2 }), 'cmp%', cmpPct, -1],
  ['short tackles', push('OL', { h: -2 }, tackles), 'sack%', sackPct, 1],
  ['short DTs', push('DT', { h: -2 }), 'sack%', sackPct, 1],
  ['heavy lines', push('OL', { w: 2 }), 'yds/carry', ypc, 1],
  ['heavy backs', push('RB', { w: 2 }), 'yds/carry', ypc, 1],
];
for (const [label, shape, stat, read, sign] of PROBES) {
  const t = play(shape);
  const d = read(t) - read(asBuilt);
  console.log(
    `  ${label.padEnd(15)} ${stat.padEnd(10)} ${read(asBuilt).toFixed(2)} → ${read(t).toFixed(2)} (${d >= 0 ? '+' : ''}${d.toFixed(2)}, should go ${sign > 0 ? 'up' : 'down'})${flag(d * sign > 0)}`,
  );
}

// ── Centred ──
const medians = play((l) => {
  for (const p of Object.values(l.players)) {
    p.heightIn = SIZE[p.position].h[0];
    p.weightLb = SIZE[p.position].w[0];
  }
});
console.log(`\nCentred: the league at its medians against the league as built\n`);
const HOLD: [string, (t: Tally) => number, number][] = [
  ['cmp%', cmpPct, 0.8],
  ['sack%', sackPct, 0.4],
  ['yds/carry', ypc, 0.08],
  ['points/game', ppg, 0.6],
];
for (const [label, read, tol] of HOLD) {
  const d = read(asBuilt) - read(medians);
  console.log(
    `  ${label.padEnd(12)} ${read(medians).toFixed(2)} → ${read(asBuilt).toFixed(2)} (±${tol})${flag(Math.abs(d) <= tol)}`,
  );
}

console.log(`\n${misses} number(s) outside target range`);
process.exit(misses ? 1 : 0);
