/**
 * Career audit: how players grow, peak, fade and retire, measured against the real-world ranges in
 * docs/research/attributes-development-scouting-roadmap.md (and, where the research is silent,
 * design targets marked as such). Run it after any change to `development.ts`, `aging.ts`,
 * retirement or the hidden traits.
 *
 *   npm run careers            # cohort curves + a 16-season league run (about 2 minutes)
 *   npm run careers -- 24      # a longer league run
 *
 * Part 1 ages a synthetic draft class of every position from 21 (full playing time, no
 * retirement), so a curve can be tuned on its own. Part 2 plays real seasons and judges the
 * league's steady state (the second half of the run), where the opening league's age mix has
 * washed out. ▲/▼ marks a number outside its target range; "n/a" a sample too small to judge.
 */
import { developPlayer } from '../src/engine/development';
import { createLeague, generatePlayer } from '../src/engine/generate';
import { simToEndOfSeason } from '../src/engine/league';
import { advanceOffseason, beginOffseason } from '../src/engine/offseason';
import { playerOvr, STARTERS } from '../src/engine/positions';
import { clamp, Rng } from '../src/engine/rng';
import type { Player, Position, Traits } from '../src/engine/types';
import { POSITIONS } from '../src/engine/types';

const seasons = Number(process.argv[2] ?? 16);
const COHORT = 1200;
let misses = 0;

function check(label: string, value: number, lo: number, hi: number, digits = 2): string {
  if (!Number.isFinite(value)) return `${label} n/a (${lo}–${hi})`;
  const flag = value < lo ? ' ▼' : value > hi ? ' ▲' : '';
  if (flag) misses++;
  return `${label} ${value.toFixed(digits)} (${lo}–${hi})${flag}`;
}
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const median = (xs: number[]) => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

// ───────── Part 1: cohort curves ─────────

const AGES = Array.from({ length: 19 }, (_, i) => 21 + i); // 21 … 39

interface Cohort {
  ovr: number[][]; // [player][age index]
  attr: Record<string, number[][]>;
  traits: Traits[];
}

/** A draft class at one position: the ceiling is drawn the way `generateDraftClass` draws it. */
function cohort(pos: Position, playedShare = 1, n = COHORT): Cohort {
  const out: Cohort = { ovr: [], attr: { speed: [], agility: [], throwAccShort: [], throwAccDeep: [], awareness: [] }, traits: [] };
  for (let i = 0; i < n; i++) {
    const rng = new Rng(`careers:${pos}:${i}`);
    const p = generatePlayer(rng, { id: 900000 + i, position: pos, quality: rng.normal(11, 1.2), age: 21, teamId: null, jerseysUsed: new Set() });
    const growth = Math.abs(rng.normal(0, 1)) * 2.1 + rng.float(0, 0.8) + (rng.chance(0.06) ? rng.float(2, 4.5) : 0);
    p.potential = clamp(playerOvr(p) + growth, 1, 20);
    const row: number[] = [];
    const attrs: Record<string, number[]> = Object.fromEntries(Object.keys(out.attr).map((a) => [a, []]));
    for (const age of AGES) {
      p.age = age;
      row.push(playerOvr(p));
      for (const a of Object.keys(attrs)) attrs[a].push(p.ratings[a as keyof Player['ratings']]);
      developPlayer(new Rng(`careers:dev:${pos}:${i}:${age}`), p, { playedShare });
    }
    out.ovr.push(row);
    for (const a of Object.keys(attrs)) out.attr[a].push(attrs[a]);
    out.traits.push(p.traits);
  }
  return out;
}

const curve = (rows: number[][]) => AGES.map((_, j) => mean(rows.map((r) => r[j])));
const at = (c: number[], age: number) => c[age - 21];
/** Median age of each player's own best season (the research's "peak season"). */
const peakAge = (c: Cohort) => median(c.ovr.map((r) => AGES[r.indexOf(Math.max(...r))]));

console.log(`Part 1 — cohort curves (${COHORT} draftees per position from 21, full playing time, no retirement)\n`);
const curves = {} as Record<Position, number[]>;
const cohorts = {} as Record<Position, Cohort>;
for (const pos of POSITIONS) {
  cohorts[pos] = cohort(pos);
  curves[pos] = curve(cohorts[pos].ovr);
}
console.log('pos   ' + AGES.filter((a) => a % 2 === 1).map((a) => String(a).padStart(6)).join(''));
for (const pos of POSITIONS) {
  const c = curves[pos];
  console.log(pos.padEnd(6) + AGES.filter((a) => a % 2 === 1).map((a) => at(c, a).toFixed(1).padStart(6)).join(''));
}
console.log('');

const below = (c: number[], age: number) => Math.max(...c) - at(c, age);
const lines: string[] = [];
const RB = curves.RB;
// Research: RB peak 21–26 by method (26 per Football Perspective); −25% production from 28 to 29.
lines.push(`RB: ${check('peak age', peakAge(cohorts.RB), 24, 27, 1)} · ${check('loss 28→29', at(RB, 28) - at(RB, 29), 1.0, 2.5)} · ${check('below peak at 30', below(RB, 30), 3.0, 6.0)}`);
// Research: WR and CB peak 25–28.
for (const pos of ['WR', 'CB'] as const) {
  const c = curves[pos];
  const late = pos === 'CB' ? 31 : 32;
  lines.push(`${pos}: ${check('peak age', peakAge(cohorts[pos]), 25, 28.5, 1)} · ${check('below peak at 28', below(c, 28), 0, 0.5)} · ${check(`below peak at ${late}`, below(c, late), 1.5, 4.5)}`);
}
// Design targets: the front seven and safeties fade from about 30.
for (const pos of ['S', 'LB', 'EDGE', 'DT'] as const) {
  lines.push(`${pos}: ${check('peak age', peakAge(cohorts[pos]), 25, 30, 1)} · ${check('below peak at 33', below(curves[pos], 33), 1.5, 5.5)}`);
}
// Research: long plateaus (TE still at 89% at 34, survivor-biased).
for (const pos of ['TE', 'OL'] as const) {
  const c = curves[pos];
  lines.push(`${pos}: ${check('peak age', peakAge(cohorts[pos]), 26, 32, 1)} · ${check('below peak at 32', below(c, 32), 0, 0.6)} · ${check('below peak at 35', below(c, 35), 0.8, 4)}`);
}
{
  // Research: QB peak season 28.5 on average (pocket 30.7, dual-threat 26.1); rushing flat 27–29.
  const c = curves.QB;
  const q = cohorts.QB.attr;
  const speed = curve(q.speed);
  const acc = AGES.map((_, j) => mean(q.throwAccShort.map((r, i) => (r[j] + q.throwAccDeep[i][j] + q.awareness[i][j]) / 3)));
  lines.push(
    `QB: ${check('peak age', peakAge(cohorts.QB), 27, 31, 1)} · ${check('below peak at 33', below(c, 33), 0, 0.6)} · ${check('below peak at 37', below(c, 37), 1, 4)} · ${check('speed at 32 vs 25', at(speed, 32) / at(speed, 25), 0.6, 0.9)} · ${check('accuracy+awareness at 34 vs peak', at(acc, 34) / Math.max(...acc), 0.97, 1.01, 3)}`,
  );
}
for (const pos of ['K', 'P'] as const) lines.push(`${pos}: ${check('below peak at 35', below(curves[pos], 35), 0, 0.6)} · ${check('below peak at 38', below(curves[pos], 38), 0.3, 3)}`);
for (const l of lines) console.log(l);

// Hidden traits and playing time (design targets: felt, never decisive).
{
  const byTrait = (c: Cohort, key: keyof Traits, age: number) => {
    const rows = c.ovr.map((r, i) => ({ v: r[age - 21], t: c.traits[i][key] })).sort((a, b) => a.t - b.t);
    const third = Math.floor(rows.length / 3);
    return mean(rows.slice(-third).map((r) => r.v)) - mean(rows.slice(0, third).map((r) => r.v));
  };
  const at26 = (c: Cohort) => c.ovr.map((r) => r[26 - 21] - r[0]);
  const all = POSITIONS.filter((p) => p !== 'K' && p !== 'P');
  const weGrowth = mean(all.map((pos) => byTrait(cohorts[pos], 'workEthic', 26)));
  const weLate = mean(all.map((pos) => byTrait(cohorts[pos], 'workEthic', 32)));
  const durLate = mean(all.map((pos) => byTrait(cohorts[pos], 'durability', 32)));
  const bench = mean(['WR', 'CB', 'OL', 'LB'].map((pos) => mean(at26(cohorts[pos as Position])) - mean(at26(cohort(pos as Position, 0, 400)))));
  console.log(
    `\nTraits: ${check('work ethic top vs bottom third, OVR at 26', weGrowth, 0.3, 1.0)} · ${check('…at 32', weLate, 0.5, 2.0)} · ${check('durability top vs bottom third, OVR at 32', durLate, 0.5, 2.0)} · ${check('starter vs never plays, growth to 26', bench, 0.25, 0.9)}`,
  );
}

// ───────── Part 2: a league ─────────

const steadyFrom = Math.floor(seasons / 2);
console.log(`\nPart 2 — league run (${seasons} seasons, seed careers-audit; steady state = seasons ${steadyFrom + 1}–${seasons})\n`);
const league = createLeague({ seed: 'careers-audit' });
const retiredAt: Record<string, number[]> = {};
const deltas: Record<string, number[]> = { '21-25': [], '26-29': [], '30-33': [], '34+': [] };
const steady = { qb35: [] as number[], k38: [] as number[], rb30: [] as number[], points: [] as number[], penalties: [] as number[], sacks: [] as number[] };
const starterOvr: number[] = [];
const starters = () => league.teams.flatMap((t) => POSITIONS.flatMap((pos) => t.depthChart[pos].slice(0, STARTERS[pos]).map((id) => league.players[id])));
const awareness = () => mean(starters().map((p) => p.ratings.awareness));
const awareStart = awareness();

for (let s = 0; s < seasons; s++) {
  simToEndOfSeason(league);
  if (s >= steadyFrom) {
    for (const g of league.games) {
      if (g.season !== league.season || g.playoffRound || !g.result) continue;
      const r = g.result;
      steady.points.push((r.homeScore + r.awayScore) / 2);
      steady.penalties.push((r.home.penalties + r.away.penalties) / 2);
      steady.sacks.push((r.home.sacked + r.away.sacked) / 2);
    }
  }
  const before = new Map(Object.values(league.players).filter((p) => !p.retired).map((p) => [p.id, { ovr: playerOvr(p), age: p.age, rostered: p.teamId !== null }]));
  beginOffseason(league);
  for (const [id, b] of before) {
    const p = league.players[id];
    if (p.retired) {
      const group = p.position === 'K' || p.position === 'P' ? 'K/P' : p.position;
      if (b.rostered && s >= steadyFrom) (retiredAt[group] ??= []).push(p.age);
      continue;
    }
    if (!b.rostered) continue;
    const bucket = b.age <= 25 ? '21-25' : b.age <= 29 ? '26-29' : b.age <= 33 ? '30-33' : '34+';
    deltas[bucket].push(playerOvr(p) - b.ovr);
  }
  while (league.phase !== 'regular') advanceOffseason(league, { autoUser: true });
  starterOvr.push(mean(starters().map(playerOvr)));
  if (s >= steadyFrom) {
    const first = (pos: Position) => league.teams.map((t) => league.players[t.depthChart[pos][0]]);
    steady.qb35.push((100 * first('QB').filter((p) => p.age >= 35).length) / 32);
    steady.rb30.push((100 * first('RB').filter((p) => p.age >= 30).length) / 32);
    steady.k38.push(first('K').filter((p) => p.age >= 38).length + first('P').filter((p) => p.age >= 38).length);
  }
}

console.log('starter OVR by season: ' + starterOvr.map((v) => v.toFixed(2)).join(' '));
// The league must neither drain nor inflate (v4 on this seed slid from 12.92 to 12.60 over 16 seasons).
console.log(check('lowest starter OVR', Math.min(...starterOvr), 12.65, 13.2) + ' · ' + check('highest starter OVR', Math.max(...starterOvr), 12.65, 13.2));
console.log(`starter awareness: ${awareStart.toFixed(2)} → ${awareness().toFixed(2)} (informational: the mental game rises with age, the league shouldn't)`);
console.log('mean yearly OVR change, rostered: ' + Object.entries(deltas).map(([k, v]) => `${k} ${mean(v).toFixed(2)}`).join(' · '));
// Research: 13.9% of QB peak seasons came at 35+ (recent leagues have had 3–7 QB1s that old); a few
// kickers and punters play to 40.
console.log(`${check('QB1s aged 35+ %', mean(steady.qb35), 4, 16, 1)} · ${check('RB1s aged 30+ %', mean(steady.rb30), 0, 8, 1)} · ${check('K/P starters aged 38+ (of 64)', mean(steady.k38), 1, 7, 1)}`);
// Long-run play: development must not quietly change the game. Fresh-league targets are in `npm run sim`;
// an aged league sits a little off them even on the v4 engine (this seed: 21.99 points, 5.22 penalties,
// 2.19 sacks), so the bands here are a little wider.
console.log(`${check('points per team-game', mean(steady.points), 21, 24)} · ${check('penalties', mean(steady.penalties), 5, 7)} · ${check('sacks', mean(steady.sacks), 2, 2.7)}`);
// Design targets (the research has no retirement ages); judged only with 8+ retirements.
const RETIRE: Record<string, [number, number]> = { RB: [29, 33], WR: [31, 35], CB: [30, 34], OL: [32, 36], TE: [32, 36], QB: [35, 40], 'K/P': [36, 42] };
console.log(
  'median retirement age (rostered, steady state): ' +
    Object.entries(retiredAt)
      .sort()
      .map(([group, ages]) => {
        const r = RETIRE[group];
        const m = ages.length >= 8 ? median(ages) : NaN;
        return (r ? check(group, m, r[0], r[1], 1) : `${group} ${Number.isFinite(m) ? m.toFixed(1) : 'n/a'}`) + ` n=${ages.length}`;
      })
      .join(' · '),
);
const now = starters();
console.log('mean starter age: ' + POSITIONS.map((pos) => `${pos} ${mean(now.filter((p) => p.position === pos).map((p) => p.age)).toFixed(1)}`).join(' · '));
console.log(`\n${misses} number(s) outside target range`);
