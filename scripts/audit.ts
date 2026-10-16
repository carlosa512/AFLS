/**
 * Engine attribute audit: does each rating actually move what happens on the field?
 *
 * For every (position, attribute) pair that counts toward that position's overall, raise the
 * attribute by 5 for every player at the position on every team, replay the same schedule with
 * the same game seeds, and compare league-wide outcomes with the untouched league. A pair whose
 * every outcome stays inside noise is cosmetic: the overall says it matters, the engine ignores it.
 *
 *   npm run audit              # 2 seasons per pair, pairs that count toward the overall
 *   npm run audit -- 4         # more seasons per pair (less noise)
 *   npm run audit -- 2 --all   # every attribute at every position
 *   npm run audit -- 2 QB      # one position only
 */
import { OVR_WEIGHTS } from '../src/engine/positions';
import { createLeague } from '../src/engine/generate';
import { simulateGame } from '../src/engine/match/gameSim';
import type { Attribute, GameResult, League, Position, StatKey } from '../src/engine/types';
import { ATTRIBUTES, POSITIONS } from '../src/engine/types';

const args = process.argv.slice(2);
const seasons = Number(args.find((a) => /^\d+$/.test(a)) ?? 2);
const all = args.includes('--all');
const only = args.find((a) => (POSITIONS as readonly string[]).includes(a)) as Position | undefined;
const BUMP = 5;

/** A ratio metric summed over team-games: value = Σnum / Σden. */
interface Metric {
  label: string;
  /** Numerator and denominator one team-game contributes (side 0 = home). */
  take: (r: GameResult, side: 0 | 1) => [number, number];
  digits: number;
}

/** The game being scored: its league and team ids (home, away), so player stats can be split by side. */
let currentLeague: League;
let currentTeams: [number, number] = [0, 0];
const ps = (r: GameResult, side: 0 | 1, key: StatKey, pos?: Position) => {
  let s = 0;
  for (const [id, line] of Object.entries(r.playerStats)) {
    if (r.playerTeams[Number(id)] !== currentTeams[side]) continue;
    if (pos && currentLeague.players[Number(id)].position !== pos) continue;
    s += line[key] ?? 0;
  }
  return s;
};
const team = (r: GameResult, side: 0 | 1) => (side === 0 ? r.home : r.away);

const METRICS: Metric[] = [
  { label: 'points', take: (r, s) => [s === 0 ? r.homeScore : r.awayScore, 1], digits: 2 },
  { label: 'cmp%', take: (r, s) => [team(r, s).passCmp * 100, team(r, s).passAtt], digits: 1 },
  { label: 'yds/att', take: (r, s) => [team(r, s).passYds + ps(r, s, 'sackYds'), team(r, s).passAtt], digits: 2 },
  { label: 'sack%', take: (r, s) => [team(r, s).sacked * 100, team(r, s).passAtt + team(r, s).sacked], digits: 2 },
  { label: 'int%', take: (r, s) => [ps(r, s, 'passInt') * 100, team(r, s).passAtt], digits: 2 },
  { label: 'yds/carry', take: (r, s) => [team(r, s).rushYds, team(r, s).rushAtt], digits: 2 },
  { label: 'yac/rec', take: (r, s) => [team(r, s).passYds, team(r, s).passCmp], digits: 2 },
  { label: 'fumbles%', take: (r, s) => [ps(r, s, 'fumbles') * 100, team(r, s).rushAtt + team(r, s).passCmp], digits: 2 },
  { label: 'WR yds/tgt', take: (r, s) => [ps(r, s, 'recYds', 'WR'), ps(r, s, 'targets', 'WR')], digits: 2 },
  { label: 'TE yds/tgt', take: (r, s) => [ps(r, s, 'recYds', 'TE'), ps(r, s, 'targets', 'TE')], digits: 2 },
  { label: 'RB yds/tgt', take: (r, s) => [ps(r, s, 'recYds', 'RB'), ps(r, s, 'targets', 'RB')], digits: 2 },
  { label: 'fg%', take: (r, s) => [ps(r, s, 'fgMade') * 100, ps(r, s, 'fgAtt')], digits: 1 },
  { label: 'fg+xp pts', take: (r, s) => [ps(r, s, 'fgMade') * 3 + ps(r, s, 'xpMade'), 1], digits: 2 },
  { label: 'punt avg', take: (r, s) => [ps(r, s, 'puntYds'), ps(r, s, 'punts')], digits: 1 },
  { label: 'kr avg', take: (r, s) => [ps(r, s, 'krYds'), ps(r, s, 'krAtt')], digits: 1 },
  // Return yards the *other* side gains per punt this side kicks: punt placement.
  { label: 'ret yds/punt', take: (r, s) => [ps(r, (1 - s) as 0 | 1, 'prYds'), ps(r, s, 'punts')], digits: 2 },
  { label: 'penalties', take: (r, s) => [team(r, s).penalties, 1], digits: 2 },
];

interface Sample {
  /** Per metric, per team-game [num, den]. */
  rows: [number, number][][];
}

function run(league: League, from = 0, to = seasons): Sample {
  currentLeague = league;
  const rows: [number, number][][] = METRICS.map(() => []);
  const regular = league.games.filter((g) => !g.playoffRound);
  for (let s = from; s < to; s++) {
    for (const g of regular) {
      const r = simulateGame(league, g, { seed: `audit:${s}:${g.id}` });
      currentTeams = [g.homeId, g.awayId];
      for (const side of [0, 1] as const) METRICS.forEach((m, i) => rows[i].push(m.take(r, side)));
    }
  }
  return { rows };
}

/** Ratio of sums and its standard error (linearization). */
function ratio(rows: [number, number][]): [number, number] {
  const num = rows.reduce((a, [n]) => a + n, 0);
  const den = rows.reduce((a, [, d]) => a + d, 0);
  if (!den) return [0, 0];
  const R = num / den;
  const v = rows.reduce((a, [n, d]) => a + (n - R * d) ** 2, 0);
  return [R, Math.sqrt(v) / den];
}

function bumped(pos: Position, attr: Attribute): League {
  const league = createLeague({ seed: 'audit' });
  for (const p of Object.values(league.players)) if (p.position === pos) p.ratings[attr] = Math.min(20, p.ratings[attr] + BUMP);
  return league;
}

const t0 = Date.now();
const baseLeague = createLeague({ seed: 'audit' });
const base = run(baseLeague);
let extraBase: Sample | null = null;

/** Each metric's change against the untouched league, biggest z first. */
function compare(test: Sample, against: Sample) {
  return METRICS.map((m, i) => {
    const [b, bse] = ratio(against.rows[i]);
    const [t, tse] = ratio(test.rows[i]);
    const se = Math.sqrt(bse ** 2 + tse ** 2) || 1;
    return { m, delta: t - b, z: (t - b) / se };
  }).sort((a, b) => Math.abs(b.z) - Math.abs(a.z));
}

const merge = (a: Sample, b: Sample): Sample => ({ rows: a.rows.map((r, i) => [...r, ...b.rows[i]]) });

console.log(`\nAttribute audit: +${BUMP} to every player at the position, ${seasons} season(s) per pair (${seasons * 3} for close calls)\n`);
console.log('pos  attribute        weight  verdict      biggest moves (Δ, z)');

const flagged: string[] = [];
for (const pos of POSITIONS) {
  if (only && pos !== only) continue;
  const weights = OVR_WEIGHTS[pos];
  const attrs = all ? [...ATTRIBUTES] : (Object.keys(weights) as Attribute[]).sort((a, b) => weights[b]! - weights[a]!);
  for (const attr of attrs) {
    const league = bumped(pos, attr);
    let test = run(league);
    let moves = compare(test, base);
    // Close calls get more seasons before a verdict, so small-but-real effects aren't called cosmetic.
    if (Math.abs(moves[0].z) < 3) {
      extraBase ??= merge(base, run(baseLeague, seasons, seasons * 3));
      test = merge(test, run(league, seasons, seasons * 3));
      moves = compare(test, extraBase);
    }
    const top = Math.abs(moves[0].z);
    const verdict = top >= 3 ? 'moves play' : top >= 2 ? 'weak' : 'NO EFFECT';
    const w = weights[attr] ?? 0;
    // Cosmetic: the overall counts it but play doesn't. Underpowered: it counts a lot but barely moves play.
    if (w > 0 && (verdict === 'NO EFFECT' || (verdict === 'weak' && w >= 1.5))) flagged.push(`${pos} ${attr} (${verdict.toLowerCase()})`);
    const detail = moves
      .filter((x) => Math.abs(x.z) >= 2)
      .slice(0, 3)
      .map((x) => `${x.m.label} ${x.delta >= 0 ? '+' : ''}${x.delta.toFixed(x.m.digits)} (z ${x.z.toFixed(1)})`)
      .join(', ');
    console.log(`${pos.padEnd(4)} ${attr.padEnd(16)} ${w ? w.toFixed(2).padStart(6) : '     –'}  ${verdict.padEnd(11)}  ${detail}`);
  }
}

console.log(`\n${((Date.now() - t0) / 1000).toFixed(0)}s`);
if (flagged.length) {
  console.log(`\nNeeds attention (${flagged.length}): ${flagged.join(', ')}`);
  process.exitCode = 1;
} else console.log('\nEvery attribute that counts toward an overall moves play.');
