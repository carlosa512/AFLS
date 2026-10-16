/**
 * Career audit: how players grow, peak, fade and retire, measured against the real-world ranges in
 * docs/research/attributes-development-scouting-roadmap.md. Run it after any change to
 * `development.ts`, `aging.ts`, retirement or the hidden traits.
 *
 *   npm run careers            # cohort curves + an 8-season league run
 *   npm run careers -- 12      # a longer league run
 *
 * Part 1 ages a synthetic cohort of every position from 21 (full playing time, no retirement), so a
 * curve can be tuned on its own. Part 2 plays real seasons and checks the league stays balanced.
 * ▲/▼ marks a number above/below its target range.
 */
import { developPlayer } from '../src/engine/development';
import { createLeague, generatePlayer } from '../src/engine/generate';
import { simToEndOfSeason } from '../src/engine/league';
import { advanceOffseason, beginOffseason } from '../src/engine/offseason';
import { playerOvr, STARTERS } from '../src/engine/positions';
import { Rng } from '../src/engine/rng';
import type { Player, Position } from '../src/engine/types';
import { POSITIONS } from '../src/engine/types';

const seasons = Number(process.argv[2] ?? 8);
const COHORT = 1200;
let misses = 0;

function check(label: string, value: number, lo: number, hi: number, digits = 2): string {
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
type Traits = { workEthic: number; durability: number; temperament: number };
const traitsOf = (p: Player): Traits | undefined => (p as Player & { traits?: Traits }).traits;

// ───────── Part 1: cohort curves ─────────

const AGES = Array.from({ length: 19 }, (_, i) => 21 + i); // 21 … 39

interface Cohort {
  ovr: number[][]; // [player][age index]
  attr: Record<string, number[][]>;
  traits: (Traits | undefined)[];
}

function cohort(pos: Position, playedShare = 1, n = COHORT): Cohort {
  const out: Cohort = { ovr: [], attr: { speed: [], agility: [], throwAccShort: [], throwAccDeep: [], awareness: [] }, traits: [] };
  for (let i = 0; i < n; i++) {
    const rng = new Rng(`careers:${pos}:${i}`);
    const p = generatePlayer(rng, { id: 900000 + i, position: pos, quality: rng.normal(11.5, 1.2), age: 21, teamId: null, jerseysUsed: new Set() });
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
    out.traits.push(traitsOf(p));
  }
  return out;
}

const curve = (rows: number[][]) => AGES.map((_, j) => mean(rows.map((r) => r[j])));
const at = (c: number[], age: number) => c[age - 21];

console.log(`Part 1 — cohort curves (${COHORT} per position from 21, full playing time, no retirement)\n`);
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

const peakAge = (c: number[]) => AGES[c.indexOf(Math.max(...c))];
const below = (c: number[], age: number) => Math.max(...c) - at(c, age);
const lines: string[] = [];
const RB = curves.RB;
lines.push(`RB: ${check('peak age', peakAge(RB), 24, 27, 0)} · ${check('loss 28→29', at(RB, 28) - at(RB, 29), 1.0, 2.5)} · ${check('below peak at 30', below(RB, 30), 3.0, 6.0)}`);
for (const pos of ['WR', 'CB'] as const) {
  const c = curves[pos];
  const late = pos === 'CB' ? 31 : 32;
  lines.push(`${pos}: ${check('peak age', peakAge(c), 25, 29, 0)} · ${check('below peak at 28', below(c, 28), 0, 0.5)} · ${check(`below peak at ${late}`, below(c, late), 1.5, 4.5)}`);
}
for (const pos of ['S', 'LB', 'EDGE', 'DT'] as const) {
  const c = curves[pos];
  lines.push(`${pos}: ${check('peak age', peakAge(c), 25, 30, 0)} · ${check('below peak at 33', below(c, 33), 1.5, 5.5)}`);
}
for (const pos of ['TE', 'OL'] as const) {
  const c = curves[pos];
  lines.push(`${pos}: ${check('peak age', peakAge(c), 26, 32, 0)} · ${check('below peak at 32', below(c, 32), 0, 0.6)} · ${check('below peak at 35', below(c, 35), 0.8, 4)}`);
}
{
  const c = curves.QB;
  const q = cohorts.QB.attr;
  const speed = curve(q.speed);
  const acc = AGES.map((_, j) => mean(q.throwAccShort.map((r, i) => (r[j] + q.throwAccDeep[i][j] + q.awareness[i][j]) / 3)));
  lines.push(
    `QB: ${check('peak age', peakAge(c), 27, 33, 0)} · ${check('below peak at 33', below(c, 33), 0, 0.6)} · ${check('below peak at 37', below(c, 37), 1, 4)} · ${check('speed at 32 vs 25', at(speed, 32) / at(speed, 25), 0.6, 0.9)} · ${check('accuracy+awareness at 34 vs peak', at(acc, 34) / Math.max(...acc), 0.97, 1.01, 3)}`,
  );
}
for (const pos of ['K', 'P'] as const) lines.push(`${pos}: ${check('below peak at 35', below(curves[pos], 35), 0, 0.6)} · ${check('below peak at 38', below(curves[pos], 38), 0.3, 3)}`);
for (const l of lines) console.log(l);

// Hidden traits and playing time, measured as the overall a player has reached by 26.
if (cohorts.WR.traits[0]) {
  const at26 = (c: Cohort) => c.ovr.map((r) => r[26 - 21] - r[0]);
  const byTrait = (c: Cohort, key: keyof Traits, age: number) => {
    const rows = c.ovr.map((r, i) => ({ v: r[age - 21], t: c.traits[i]![key] })).sort((a, b) => a.t - b.t);
    const third = Math.floor(rows.length / 3);
    return mean(rows.slice(-third).map((r) => r.v)) - mean(rows.slice(0, third).map((r) => r.v));
  };
  const all = POSITIONS.filter((p) => p !== 'K' && p !== 'P');
  const weGrowth = mean(all.map((pos) => byTrait(cohorts[pos], 'workEthic', 26)));
  const weLate = mean(all.map((pos) => byTrait(cohorts[pos], 'workEthic', 32)));
  const durLate = mean(all.map((pos) => byTrait(cohorts[pos], 'durability', 32)));
  const bench = mean(['WR', 'CB', 'OL', 'LB'].map((pos) => mean(at26(cohorts[pos as Position])) - mean(at26(cohort(pos as Position, 0, 400)))));
  console.log(
    `\nTraits: ${check('work ethic top vs bottom third, OVR at 26', weGrowth, 0.4, 1.1)} · ${check('…at 32', weLate, 0.8, 2.2)} · ${check('durability top vs bottom third, OVR at 32', durLate, 0.5, 2.0)} · ${check('starter vs never plays, growth to 26', bench, 0.3, 0.9)}`,
  );
}

// ───────── Part 2: a league ─────────

console.log(`\nPart 2 — league run (${seasons} seasons, seed careers-audit)\n`);
const league = createLeague({ seed: 'careers-audit' });
const retiredAt: Record<Position, number[]> = Object.fromEntries(POSITIONS.map((p) => [p, []])) as unknown as Record<Position, number[]>;
const deltas: Record<string, number[]> = { '21-25': [], '26-29': [], '30-33': [], '34+': [] };
let qb35 = 0;
let qbAll = 0;
let rb30 = 0;
let rbAll = 0;
const starterOvr: number[] = [];

for (let s = 0; s < seasons; s++) {
  simToEndOfSeason(league);
  const before = new Map(Object.values(league.players).filter((p) => !p.retired).map((p) => [p.id, { ovr: playerOvr(p), age: p.age, rostered: p.teamId !== null }]));
  beginOffseason(league);
  for (const [id, b] of before) {
    const p = league.players[id];
    if (p.retired) {
      if (b.rostered) retiredAt[p.position].push(p.age);
      continue;
    }
    if (!b.rostered) continue;
    const bucket = b.age <= 25 ? '21-25' : b.age <= 29 ? '26-29' : b.age <= 33 ? '30-33' : '34+';
    deltas[bucket].push(playerOvr(p) - b.ovr);
  }
  while (league.phase !== 'regular') advanceOffseason(league, { autoUser: true });
  const starters = league.teams.flatMap((t) => POSITIONS.flatMap((pos) => t.depthChart[pos].slice(0, STARTERS[pos]).map((id) => league.players[id])));
  starterOvr.push(mean(starters.map(playerOvr)));
  for (const t of league.teams) {
    const qb = league.players[t.depthChart.QB[0]];
    const rb = league.players[t.depthChart.RB[0]];
    qbAll++;
    rbAll++;
    if (qb.age >= 35) qb35++;
    if (rb.age >= 30) rb30++;
  }
}

console.log('starter OVR by season: ' + starterOvr.map((v) => v.toFixed(2)).join(' '));
// v4 on this seed: 12.75–12.92. The league must neither drain nor inflate.
console.log(check('lowest starter OVR', Math.min(...starterOvr), 12.7, 13.15) + ' · ' + check('highest starter OVR', Math.max(...starterOvr), 12.7, 13.15));
console.log('mean yearly OVR change, rostered: ' + Object.entries(deltas).map(([k, v]) => `${k} ${mean(v).toFixed(2)}`).join(' · '));
console.log(`${check('QB1s aged 35+', (100 * qb35) / qbAll, 3, 14, 1)}% · ${check('RB1s aged 30+', (100 * rb30) / rbAll, 0, 8, 1)}%`);
const RETIRE: Partial<Record<Position, [number, number]>> = { RB: [29, 32], WR: [31, 35], CB: [30, 34], OL: [32, 36], TE: [32, 36], QB: [35, 40], K: [36, 42], P: [36, 42] };
console.log(
  'median retirement age (rostered): ' +
    POSITIONS.map((pos) => {
      const r = RETIRE[pos];
      const m = median(retiredAt[pos]);
      return r ? check(pos, m, r[0], r[1], 1) + ` n=${retiredAt[pos].length}` : `${pos} ${m.toFixed(1)} n=${retiredAt[pos].length}`;
    }).join(' · '),
);
// Starters' ages by position (the league's age pyramid).
const startersNow = league.teams.flatMap((t) => POSITIONS.flatMap((pos) => t.depthChart[pos].slice(0, STARTERS[pos]).map((id) => league.players[id])));
console.log('mean starter age: ' + POSITIONS.map((pos) => `${pos} ${mean(startersNow.filter((p) => p.position === pos).map((p) => p.age)).toFixed(1)}`).join(' · '));
console.log(`\n${misses} number(s) outside target range`);
