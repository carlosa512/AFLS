/**
 * Career audit: how players grow, peak, fade and retire, measured against the real-world ranges in
 * docs/research/attributes-development-scouting-roadmap.md (and, where the research is silent,
 * design targets marked as such). Run it after any change to `development.ts`, `aging.ts`,
 * retirement or the hidden traits.
 *
 *   npm run careers            # cohort curves + four 20-season leagues (about 8 minutes on 4 cores)
 *   npm run careers -- 24      # longer league runs
 *
 * Run it after changing development.ts, aging.ts, traits.ts, coaching.ts or retirement.
 *
 * Part 1 ages a synthetic draft class of every position from 21 (full playing time, no
 * retirement), so a curve can be tuned on its own. Part 2 plays real seasons in four leagues (each
 * in its own process, `careers-league.ts`) and judges their pooled steady state (the second half of
 * each run), where the opening league's age mix has washed out. One league's path is chaotic: a
 * lucky quarterback class moves points and sacks for a decade, a couple of ageless kickers move the
 * 38+ count, so a single seed can miss a band by noise alone. ▲/▼ marks a number outside its target
 * range; "n/a" a sample too small to judge.
 */
import { bandOf } from './band';
import { fork } from 'node:child_process';
import { CHAIRS, coachingFrom, NEUTRAL, type Coaching } from '../src/engine/coaching';
import { ceilingShift, COACH_LEAN, hypeLean, SNAP_LEAN, workLean } from '../src/engine/ceiling';
import { CEILING_SWING, developPlayer, recordRatings } from '../src/engine/development';
import { retireChance } from '../src/engine/aging';
import { generatePlayer } from '../src/engine/generate';
import { DRAFT_CLASS, growthMean } from '../src/engine/offseason/draft';
import { playerOvr } from '../src/engine/positions';
import { clamp, Rng } from '../src/engine/rng';
import type { Coach, Player, Position, Traits } from '../src/engine/types';
import { POSITIONS } from '../src/engine/types';
import type { LeagueRun } from './careers-league';
import {
  AGE_BANDS,
  AGE_WIDTH,
  addFates,
  bandFor,
  NFL_EXIT_AGE,
  NFL_NEXT,
  NFL_STARTER_AGE,
  type AgeBand,
  type AgeGroup,
  type Fate,
} from './league-age-core';
import { LEADER_NORMAL, LEADER_TARGETS, overRecordAllowed } from './leaders';
import { habitsForce } from '../src/engine/gmHabits';
// A run with every GM habit off, to tell a habit's lean from the league's own luck (the gm-habits check's switch).
if (process.env.GM_HABITS_OFF === '1') habitsForce.off = true;

const seasons = Number(process.argv[2] ?? 20);
const SEEDS = ['careers-audit', 'careers-audit-2', 'careers-audit-3', 'careers-audit-4'];
/**
 * Four more leagues, read for one line only: work ethic's lean on ceiling shifts is a small gap between two noisy means,
 * and over four leagues it swung 0.10-0.19 from one change to the next with nothing touching it (the owner's call,
 * 2026-11-02: pool it over eight). They play once the first four are done, so no more run at once.
 */
const ETHIC_SEEDS = ['careers-audit-5', 'careers-audit-6', 'careers-audit-7', 'careers-audit-8'];
/** One league in its own process, reporting its run. */
const play = (seed: string): Promise<LeagueRun> =>
  new Promise((resolve, reject) => {
    const child = fork(new URL('./careers-league.ts', import.meta.url).pathname, [], {
      env: { ...process.env, CAREERS_SEED: seed, CAREERS_SEASONS: String(seasons) },
    });
    let done = false;
    child.once('message', (run) => {
      done = true;
      resolve(run as LeagueRun);
      child.kill();
    });
    child.once('error', reject);
    // A worker that dies before reporting (a crash, or the OOM killer's signal) fails the audit by name.
    child.once(
      'exit',
      (code, signal) => done || reject(new Error(`league ${seed} exited (${signal ?? code}) before reporting`)),
    );
  });
// Part 2's leagues start first, each in its own process, and play while Part 1 runs here.
const leagues: Promise<LeagueRun>[] = SEEDS.map(play);
const ethicLeagues: Promise<LeagueRun[]> = Promise.all(leagues).then(() => Promise.all(ETHIC_SEEDS.map(play)));
const COHORT = 1200;
let misses = 0;

/** Live trees swing with the league: ⚠ outside 2–5, fail outside 1–6 (the owner's call, Nov 5): the NFL had one big tree
 * at a time before 2017 and 4–5 in 2025 (spec 2026-10-28 §4.6); under 1 they've died out. */
const LIVE_TREES_NORMAL: [number, number] = [1, 6];
/** Founding trees dying out in a league swings with the league: one of the leagues losing them all warns, two fail (the
 * owner's call, Nov 6: main's fewest left was 2, 0.4.8's branch had one league at 0). */
const NO_FOUNDING_NORMAL: [number, number] = [0, 1];
/** A number against its range; with a normal band (a line that swings with the league, `band.ts`) outside the range it
 * warns (⚠) and fails only outside the normal band. */
function check(label: string, value: number, lo: number, hi: number, digits = 2, normal?: [number, number]): string {
  if (!Number.isFinite(value)) return `${label} n/a (${lo}–${hi})`;
  const band = bandOf(value, [lo, hi], normal);
  const flag = band === 'unusual' ? ' ⚠' : band === 'abnormal' ? (value < lo ? ' ▼' : ' ▲') : '';
  if (band === 'abnormal') misses++;
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
  /** Still in the league at that age: he'd have retired as a rostered player does (`retireChance`), or not. */
  alive: boolean[][];
  attr: Record<string, number[][]>;
  traits: Traits[];
}

/** A draft class at one position: the ceiling is drawn the way `generateDraftClass` draws it. */
function cohort(pos: Position, playedShare = 1, n = COHORT, coaching: Coaching = NEUTRAL): Cohort {
  const out: Cohort = {
    ovr: [],
    alive: [],
    attr: { speed: [], agility: [], throwAccShort: [], throwAccDeep: [], awareness: [] },
    traits: [],
  };
  for (let i = 0; i < n; i++) {
    const rng = new Rng(`careers:${pos}:${i}`);
    const p = generatePlayer(rng, {
      id: 900000 + i,
      position: pos,
      // As `generateDraftClass` makes him: a position that's ready sooner comes in nearer the same ceiling.
      quality:
        rng.normal(11, 1.2) - DRAFT_CLASS.raw + (1 - (DRAFT_CLASS.ready[pos] ?? 1)) * DRAFT_CLASS.lift * growthMean(),
      age: 21,
      teamId: null,
      jerseysUsed: new Set(),
    });
    const growth =
      (DRAFT_CLASS.ready[pos] ?? 1) *
      (DRAFT_CLASS.raw +
        DRAFT_CLASS.hype +
        Math.abs(rng.normal(0, 1)) * DRAFT_CLASS.spread +
        rng.float(0, 0.8) +
        (rng.chance(0.06) ? rng.float(2, 4.5) : 0));
    p.potential = clamp(playerOvr(p) + growth, 1, 20);
    const row: number[] = [];
    const alive: boolean[] = [];
    let retired = false;
    const entry = playerOvr(p);
    const attrs: Record<string, number[]> = Object.fromEntries(Object.keys(out.attr).map((a) => [a, []]));
    for (const age of AGES) {
      p.age = age;
      row.push(playerOvr(p));
      alive.push(!retired);
      recordRatings(p, 2000 + age);
      for (const a of Object.keys(attrs)) attrs[a].push(p.ratings[a as keyof Player['ratings']]);
      developPlayer(new Rng(`careers:dev:${pos}:${i}:${age}`), p, { playedShare, ...coaching });
      // A rostered player's new-league-year roll, as `beginOffseason` makes it after his year (his age just ticked).
      if (
        !retired &&
        new Rng(`careers:retire:${pos}:${i}:${age}`).chance(
          retireChance({ ...p, age: age + 1, teamId: 0 }, playerOvr(p)),
        )
      )
        retired = true;
      // His season's end settles his ceiling (`ceiling.ts`), leaned the way a league leans it: his work ethic, a
      // starter's snaps (or a bench's), his coaches.
      const year = age - 21;
      if (year < CEILING_SWING.length) {
        const snaps = playedShare >= 0.6 ? SNAP_LEAN.starter : playedShare < 0.2 ? SNAP_LEAN.idle : 0;
        const lean =
          workLean(p.traits.workEthic) +
          snaps +
          COACH_LEAN * (coaching.rate - 1) +
          (year === 0 ? hypeLean(p.potential, entry) : 0);
        p.potential = Math.min(
          20,
          p.potential + ceilingShift(new Rng(`careers:ceiling:${pos}:${i}:${age}`), year, lean),
        );
      }
    }
    out.ovr.push(row);
    out.alive.push(alive);
    for (const a of Object.keys(attrs)) out.attr[a].push(attrs[a]);
    out.traits.push(p.traits);
  }
  return out;
}

const curve = (rows: number[][]) => AGES.map((_, j) => mean(rows.map((r) => r[j])));
const at = (c: number[], age: number) => c[age - 21];
/**
 * Below their peak at a late age, read on the players still in the league then: the research measured players still
 * playing, so a curve over everyone, cliffs and all, would read a fall the research never saw. The survivors' own average
 * curve, its peak against its value at that age (each man's single best season would read a year's luck as a fall).
 */
const lateBelow = (pos: Position, age: number) => {
  const c = cohorts[pos];
  const j = age - 21;
  const left = c.ovr.filter((_, i) => c.alive[i][j]);
  const curveLeft = AGES.slice(0, j + 1).map((_, k) => mean(left.map((r) => r[k])));
  return { value: Math.max(...curveLeft) - curveLeft[j], n: left.length };
};
const late = (label: string, pos: Position, age: number, lo: number, hi: number) => {
  const { value, n } = lateBelow(pos, age);
  return `${check(label, value, lo, hi)} (survivors ${n})`;
};
/** Median age of each player's own best season (the research's "peak season"). */
const peakAge = (c: Cohort) => median(c.ovr.map((r) => AGES[r.indexOf(Math.max(...r))]));

console.log(
  `Part 1 — cohort curves (${COHORT} draftees per position from 21, full playing time; lines past 31 read the players a league would still roster)\n`,
);
const curves = {} as Record<Position, number[]>;
const cohorts = {} as Record<Position, Cohort>;
for (const pos of POSITIONS) {
  cohorts[pos] = cohort(pos);
  curves[pos] = curve(cohorts[pos].ovr);
}
console.log(
  'pos   ' +
    AGES.filter((a) => a % 2 === 1)
      .map((a) => String(a).padStart(6))
      .join(''),
);
for (const pos of POSITIONS) {
  const c = curves[pos];
  console.log(
    pos.padEnd(6) +
      AGES.filter((a) => a % 2 === 1)
        .map((a) => at(c, a).toFixed(1).padStart(6))
        .join(''),
  );
}
console.log('');

const below = (c: number[], age: number) => Math.max(...c) - at(c, age);
const lines: string[] = [];
const RB = curves.RB;
// Research: RB peak 21–26 by method (26 per Football Perspective); −25% production from 28 to 29.
lines.push(
  `RB: ${check('peak age', peakAge(cohorts.RB), 24, 27, 1)} · ${check('loss 28→29', at(RB, 28) - at(RB, 29), 1.0, 2.5)} · ${check('below peak at 30', below(RB, 30), 3.0, 6.0)}`,
);
// Research: WR and CB peak 25–28.
for (const pos of ['WR', 'CB'] as const) {
  const c = curves[pos];
  const lateAge = pos === 'CB' ? 31 : 32;
  lines.push(
    `${pos}: ${check('peak age', peakAge(cohorts[pos]), 25, 28.5, 1)} · ${check('below peak at 28', below(c, 28), 0, 0.5)} · ${lateAge >= 32 ? late(`below peak at ${lateAge}`, pos, lateAge, 1.5, 4.5) : check(`below peak at ${lateAge}`, below(c, lateAge), 1.5, 4.5)}`,
  );
}
// Design targets: the front seven and safeties fade from about 30.
for (const pos of ['S', 'LB', 'EDGE', 'DT'] as const) {
  lines.push(
    `${pos}: ${check('peak age', peakAge(cohorts[pos]), 25, 30, 1)} · ${late('below peak at 33', pos, 33, 1.5, 5.5)}`,
  );
}
// Research: long plateaus (TE still at 89% at 34, survivor-biased).
for (const pos of ['TE', 'OL'] as const) {
  lines.push(
    `${pos}: ${check('peak age', peakAge(cohorts[pos]), 26, 32, 1)} · ${late('below peak at 32', pos, 32, 0, 0.6)} · ${late('below peak at 35', pos, 35, 0.8, 4)}`,
  );
}
{
  // Research: QB peak season 28.5 on average (pocket 30.7, dual-threat 26.1); rushing flat 27–29.
  const q = cohorts.QB.attr;
  const speed = curve(q.speed);
  // Accuracy and reads at 34 against his own best, for the quarterbacks still playing then (as the research read them).
  const accOf = (i: number, j: number) => (q.throwAccShort[i][j] + q.throwAccDeep[i][j] + q.awareness[i][j]) / 3;
  const j34 = 34 - 21;
  const left34 = cohorts.QB.alive.map((alive, i) => (alive[j34] ? i : -1)).filter((i) => i >= 0);
  const accLeft = AGES.slice(0, j34 + 1).map((_, j) => mean(left34.map((i) => accOf(i, j))));
  const acc34 = accLeft[j34] / Math.max(...accLeft);
  lines.push(
    `QB: ${check('peak age', peakAge(cohorts.QB), 27, 31, 1)} · ${late('below peak at 33', 'QB', 33, 0, 0.6)} · ${late('below peak at 37', 'QB', 37, 1, 4)} · ${check('speed at 32 vs 25', at(speed, 32) / at(speed, 25), 0.6, 0.9)} · ${check('accuracy+awareness at 34 vs peak (survivors)', acc34, 0.97, 1.01, 3)}`,
  );
}
for (const pos of ['K', 'P'] as const)
  lines.push(`${pos}: ${late('below peak at 35', pos, 35, 0, 0.6)} · ${late('below peak at 38', pos, 38, 0.3, 3)}`);
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
  const bench = mean(
    ['WR', 'CB', 'OL', 'LB'].map(
      (pos) => mean(at26(cohorts[pos as Position])) - mean(at26(cohort(pos as Position, 0, 400))),
    ),
  );
  console.log(
    `\nTraits: ${check('work ethic top vs bottom third, OVR at 26', weGrowth, 0.3, 1.0)} · ${check('…at 32', weLate, 0.5, 2.0)} · ${check('durability top vs bottom third, OVR at 32', durLate, 0.5, 2.0)} · ${check('starter vs never plays, growth to 26', bench, 0.25, 0.9)}`,
  );
}

// Coaching (design targets: about half of what work ethic does, and symmetric around a typical staff).
// The same draftees on the same random streams, coached by a strong staff (every coach 13) or a weak
// one (every coach 8), so the gap is the coaches' alone.
{
  const N = 400;
  const staffOf = (rating: number): Coach[] =>
    CHAIRS.map((ch, i) => ({
      id: -i - 1,
      firstName: '',
      lastName: '',
      ...ch,
      age: 50,
      youth: rating,
      veterans: rating,
      teamId: 0,
      contract: null,
    }));
  const all = POSITIONS.filter((p) => p !== 'K' && p !== 'P');
  const gap = (age: number, a: number, b: number) => (rows: Record<number, Cohort>) =>
    mean(
      all.map((pos) =>
        mean(
          rows[a * 100 + all.indexOf(pos)].ovr.map(
            (r, i) => r[age - 21] - rows[b * 100 + all.indexOf(pos)].ovr[i][age - 21],
          ),
        ),
      ),
    );
  const rows: Record<number, Cohort> = {};
  all.forEach((pos, j) => {
    rows[j] = { ...cohorts[pos], ovr: cohorts[pos].ovr.slice(0, N) };
    rows[100 + j] = cohort(pos, 1, N, coachingFrom(staffOf(13), pos));
    rows[200 + j] = cohort(pos, 1, N, coachingFrom(staffOf(8), pos));
  });
  const at26 = gap(26, 1, 2)(rows);
  const at32 = gap(32, 1, 2)(rows);
  const tilt = (gap(26, 1, 0)(rows) + gap(26, 2, 0)(rows)) / 2;
  const byTrait = (key: keyof Traits, age: number) =>
    mean(
      all.map((pos) => {
        const c = cohorts[pos];
        const r = c.ovr.map((o, i) => ({ v: o[age - 21], t: c.traits[i][key] })).sort((a, b) => a.t - b.t);
        const third = Math.floor(r.length / 3);
        return mean(r.slice(-third).map((x) => x.v)) - mean(r.slice(0, third).map((x) => x.v));
      }),
    );
  console.log(
    `Coaching: ${check('strong vs weak staff, OVR at 26', at26, 0.12, 0.4)} · ${check('…at 32', at32, 0.3, 0.9)} · ${check('vs work ethic, at 26', at26 / byTrait('workEthic', 26), 0.3, 0.95)} · ${check('…at 32', at32 / byTrait('workEthic', 32), 0.3, 0.95)} · ${check('tilt at 26 (strong+weak vs typical)', tilt, -0.04, 0.04)}`,
  );
}

// ───────── Part 2: four leagues ─────────

const steadyFrom = Math.floor(seasons / 2);
console.log(
  `\nPart 2 — league runs (${seasons} seasons each, seeds ${SEEDS.join(', ')}, pooled; steady state = seasons ${steadyFrom + 1}–${seasons})\n`,
);
const runs = await Promise.all(leagues);
const pool = <T>(pick: (r: LeagueRun) => T[]) => runs.flatMap(pick);
const deltas = Object.fromEntries(Object.keys(runs[0].deltas).map((k) => [k, pool((r) => r.deltas[k])]));
const steady = Object.fromEntries(
  (Object.keys(runs[0].steady) as (keyof LeagueRun['steady'])[]).map((k) => [k, pool((r) => r.steady[k])]),
) as LeagueRun['steady'];
const ledger = {
  growth: pool((r) => r.ledger.growth),
  body: pool((r) => r.ledger.body),
  craft: pool((r) => r.ledger.craft),
  kpGrowth: pool((r) => r.ledger.kpGrowth),
  kpCraft: pool((r) => r.ledger.kpCraft),
};
const coached = {
  all: pool((r) => r.coached.all),
  best: pool((r) => r.coached.best),
  worst: pool((r) => r.coached.worst),
};
const retiredAt: Record<string, number[]> = {};
for (const r of runs) for (const [group, ages] of Object.entries(r.retiredAt)) (retiredAt[group] ??= []).push(...ages);

for (const r of runs)
  console.log(`starter OVR by season (${r.seed}): ` + r.starterOvr.map((v) => v.toFixed(2)).join(' '));
// The league must neither drain nor inflate (v4 on careers-audit slid from 12.92 to 12.60 over 16 seasons).
// Judged on the leagues' average path, so one league's luck doesn't decide it. The ceiling sits 0.35 over a lived-in
// league's level (its seasons 7-10): 12.85 + 0.35 = 13.2 while about a tenth of last season's starters fell out of
// football; once good veterans stay (0.2.36, the late market and front offices) a lived-in league holds 12.94, so 13.3
// (owner's call, 2026-11-01). A new league's young starters growing into their prime peak it at 13.22 in year three.
const STARTER_OVR_CEILING = 13.3;
const meanPath = runs[0].starterOvr.map((_, i) => mean(runs.map((r) => r.starterOvr[i])));
console.log(`starter OVR by season (mean): ${meanPath.map((v) => v.toFixed(2)).join(' ')}`);
console.log(
  check('lowest starter OVR', Math.min(...meanPath), 12.65, STARTER_OVR_CEILING) +
    ' · ' +
    check('highest starter OVR', Math.max(...meanPath), 12.65, STARTER_OVR_CEILING),
);
console.log(
  `starter awareness: ${runs.map((r) => `${r.awareness[0].toFixed(2)} → ${r.awareness[1].toFixed(2)}`).join(', ')} (informational: the mental game rises with age, the league shouldn't)`,
);
console.log(
  'mean yearly OVR change, rostered: ' +
    Object.entries(deltas)
      .map(([k, v]) => `${k} ${mean(v).toFixed(2)}`)
      .join(' · '),
);
// Coaching must move players, not the league: a typical staff is neutral and the market keeps the average staff typical.
console.log(
  `coaching: ${check('mean growth rate (under 26)', mean(ledger.growth), 0.985, 1.015, 3)} · ${check('mean body decline (28+)', mean(ledger.body), 0.985, 1.015, 3)} · ${check('mean technique decline (28+)', mean(ledger.craft), 0.985, 1.015, 3)} · K/P growth x${mean(ledger.kpGrowth).toFixed(3)}, technique decline x${mean(ledger.kpCraft).toFixed(3)} (informational)`,
);
// Paired: the same players' same years with a typical staff and with their own. Neutral on average,
// and worth about a tenth of a point a year more under the best staffs than under the worst.
console.log(
  `  ${check('yearly OVR from coaching at 21-25, league mean', mean(coached.all), -0.02, 0.02, 3)} · ${check('…best-8 minus worst-8 staffs', mean(coached.best) - mean(coached.worst), 0.05, 0.2, 3)}`,
);
// Research: 13.9% of QB peak seasons came at 35+ (recent leagues have had 3–7 QB1s that old, up to
// 22%); a few kickers and punters play to 40. Across four leagues the engine before coaching sat at
// 18.5% and 7.4 (the old 16% and 7 ceilings were fit to one seed, which happened to read 14.1 and 6.6).
// Draft outcomes (docs/research/draft-outcomes.md): about a third of first-rounders never reach a solid starter's
// overall by 27; a Day 3 pick sometimes does. Ceilings settle over three years, the swing shrinking, makeup leaning.
const drafts = pool((r) => r.drafts);
const rate = (picks: { hit: boolean }[], hit: boolean) =>
  (100 * picks.filter((d) => d.hit === hit).length) / Math.max(1, picks.length);
const firsts = drafts.filter((d) => d.round === 1);
const day3 = drafts.filter((d) => d.round >= 4);
const shifts = pool((r) => r.shifts);
const swing = (year: number) => mean(shifts.filter((s) => s.year === year).map((s) => Math.abs(s.shift)));
const ethicShifts = [...shifts, ...(await ethicLeagues).flatMap((r) => r.shifts)];
const byEthic = [...ethicShifts].sort((a, b) => a.workEthic - b.workEthic);
const third = Math.floor(byEthic.length / 3);
const ethicGap = mean(byEthic.slice(-third).map((s) => s.shift)) - mean(byEthic.slice(0, third).map((s) => s.shift));
const shrinking = swing(0) > swing(1) && swing(1) > swing(2) ? 1 : 0;
console.log(
  // First-round busts to 45% (the owner's call, Nov 8): the bar is relative, a high-end starter's overall, and once good
  // free agents stopped sitting unsigned (0.4.13) starters read 0.15-0.2 better all league long (main 37.3%, 41.2-41.8%
  // after); NFL first-round bust rates are commonly put at 40-50% by definitions like this one.
  `draft: ${check('first-round busts (never a high-end starter) %', rate(firsts, false), 25, 45, 1)} (${firsts.length} picks) · ${check('Day 3 solid starters %', rate(day3, true), 8, 20, 1)} (${day3.length} picks)`,
);
console.log(
  `  ceilings: mean |shift| by year ${[0, 1, 2].map((y) => swing(y).toFixed(2)).join(' / ')} · ${check('swing shrinks year by year', shrinking, 1, 1, 0)} · ${check(`work ethic top vs bottom third, mean shift (${SEEDS.length + ETHIC_SEEDS.length} leagues)`, ethicGap, 0.1, 0.6)}`,
);
console.log(
  `${check('QB1s aged 35+ %', mean(steady.qb35), 4, 22, 1)} · ${check('RB1s aged 30+ %', mean(steady.rb30), 0, 8, 1)} · ${check('K/P starters aged 38+ (of 64)', mean(steady.k38), 1, 8, 1)}`,
);
// Long-run play: development must not quietly change the game. Fresh-league targets are in `npm run sim`;
// an aged league sits a little off them even on the v4 engine (careers-audit: 21.99 points, 5.22 penalties,
// 2.19 sacks), so the bands here are a little wider. Points run to the NFL's record season (24.8 a team-game
// in 2020): an aged league scores about 24.3 (its veterans' Awareness, docs/PENALTIES.md), a run swings
// about half a point either way, and the old ceiling of 24 flipped from run to run (owner's call, Oct 19 2026).
console.log(
  `${check('points per team-game', mean(steady.points), 21, 25)} · ${check('penalties', mean(steady.penalties), 5, 7)} · ${check('sacks', mean(steady.sacks), 2, 2.7)}`,
);
// A long league's spread of records, against a fresh league's in the sim check: reported until the NFL figure for a
// league that has built its own rosters is agreed.
console.log(
  `win spread, SD of team wins (steady): ${mean(steady.winSpread).toFixed(2)} (NFL 3.0–3.3; reported, not judged)`,
);
// How long a record lasts: a club's win share against its own one and three seasons on, from season 3 (a new league's
// first two are its making). nflverse 2002–24: 0.34 and 0.18.
const corr = (a: number[], b: number[]) => {
  const ma = mean(a),
    mb = mean(b);
  const c = a.reduce((t, x, i) => t + (x - ma) * (b[i] - mb), 0);
  return c / Math.sqrt(a.reduce((t, x) => t + (x - ma) ** 2, 0) * b.reduce((t, y) => t + (y - mb) ** 2, 0));
};
const carry = (lag: number) =>
  mean(runs.flatMap((r) => r.records.slice(2, r.records.length - lag).map((w, i) => corr(w, r.records[i + 2 + lag]))));
console.log(
  `record carryover: 1 season ${carry(1).toFixed(2)}, 3 seasons ${carry(3).toFixed(2)} (NFL 0.34 and 0.18; reported)`,
);
// Grown-up stars must still lead the league like the NFL's do: the average #1 and #5 are held to the
// ranges `npm run sim` uses for a fresh league. How often a leader passes the record is printed but not
// judged: four leagues hold a handful of star careers, one elite quarterback and receiver can break it
// three years running, and the count swings on that luck (passing yards went 0 → 8 of 32 between two merges
// while the average leader moved 4982 → 5213, inside the NFL range). Like points and sacks above, an aged
// league sits a little off the fresh-league targets, so these bands are 5% wider than `npm run sim`'s: on
// the schemes engine the #5s ran 2-3% high (passing TD 36.2 against 35, receiving yds 1529 against 1500).
// The two leaders a veteran quarterback denies run lower still: an aged league sacks and picks him less than a
// fresh one (#5 sacker about 13.5 → 11.7, #5 interceptor 6.1 → 4.8: his Awareness grows with age,
// docs/PENALTIES.md). The owner accepts that drift with its higher scoring (Oct 19 2026), so their floors sit
// 12% under the NFL's instead of 5%; the ceilings don't move.
const AGED_FLOOR: Record<string, number> = { sacks: 0.88, interceptions: 0.88 };
const leaderSeasons = runs.reduce((n, r) => n + (Object.values(r.leaders)[0]?.length ?? 0), 0);
const leaders = LEADER_TARGETS.map(({ label, first, fifth, ceiling }) => {
  const tops = pool((r) => r.leaders[label] ?? []);
  const rank = (i: number) => mean(tops.map((t) => t[i] ?? 0));
  const digits = ceiling >= 100 ? 0 : 1;
  const round = (x: number) => Number(x.toFixed(digits));
  const wider = ([lo, hi]: [number, number]) => [round(lo * (AGED_FLOOR[label] ?? 0.95)), round(hi * 1.05)] as const;
  const [f1, f2] = wider(first);
  const [v1, v2] = wider(fifth);
  return {
    label,
    over: tops.filter((t) => t[0] > ceiling).length,
    text: `${label} ${check('#1', rank(0), f1, f2, digits, LEADER_NORMAL[label]?.first)}, ${check('#5', rank(4), v1, v2, digits, LEADER_NORMAL[label]?.fifth)}`,
  };
});
console.log(
  `season leaders, average #1 and #5 (of ${leaderSeasons} seasons): ` + leaders.map((l) => l.text).join(' · '),
);
const maxOver = overRecordAllowed(leaderSeasons);
console.log(
  `seasons with a leader past the record (an NFL-like league shows at most ${maxOver}): ` +
    leaders.map((l) => `${l.label} ${l.over}`).join(' · '),
);
const outliers = leaders.filter((l) => l.over > maxOver);
if (outliers.length)
  console.log(
    `⚠ outlier seasons (warning only): ${outliers.map((l) => `${l.label} ${l.over} past the record`).join(', ')}`,
  );
// Design targets (the research has no retirement ages); judged only with 8+ retirements.
const RETIRE: Record<string, [number, number]> = {
  RB: [29, 33],
  WR: [31, 35],
  CB: [30, 34],
  OL: [32, 36],
  TE: [32, 36],
  QB: [35, 40],
  'K/P': [36, 42],
};
console.log(
  'median retirement age (rostered, steady state): ' +
    Object.entries(retiredAt)
      .sort()
      .map(([group, ages]) => {
        const r = RETIRE[group];
        const m = ages.length >= 8 ? median(ages) : NaN;
        return (
          (r ? check(group, m, r[0], r[1], 1) : `${group} ${Number.isFinite(m) ? m.toFixed(1) : 'n/a'}`) +
          ` n=${ages.length}`
        );
      })
      .join(' · '),
);
// Starters' ages the NFL's way (docs/research/league-age.md, spec 2026-11-14-league-age-design.md): by position, and what
// happens to a starter the next season, pooled over the leagues' steady seasons. Shown as a known issue until the
// aging work lands (soft: never counted).
{
  const known: string[] = [];
  const soft = (label: string, value: number, target: number, width: number, digits = 1) => {
    const { normal } = bandFor(target, width);
    const out = !Number.isFinite(value) || value < normal[0] || value > normal[1];
    if (out) known.push(label);
    return `${label} ${Number.isFinite(value) ? value.toFixed(digits) : 'n/a'} (NFL ${target.toFixed(digits)}, ${normal[0].toFixed(digits)}–${normal[1].toFixed(digits)})${out ? ' ⚠' : ''}`;
  };
  const all = runs.flatMap((r) => r.age.starters);
  const pct = (xs: number[], f: (a: number) => boolean) => (100 * xs.filter(f).length) / Math.max(1, xs.length);
  console.log("\nstarters' ages, the NFL's way (top N by snaps; seasons " + (steadyFrom + 1) + `–${seasons})`);
  for (const pos of [...POSITIONS, 'ALL'] as const) {
    const ages = all.filter((x) => pos === 'ALL' || x.pos === pos).map((x) => x.age);
    const nfl = NFL_STARTER_AGE[pos];
    const kp = pos === 'K' || pos === 'P';
    const wide = kp || pos === 'QB';
    const mw = pos === 'ALL' ? AGE_WIDTH.allMean : kp ? AGE_WIDTH.meanKP : AGE_WIDTH.mean;
    const sw = pos === 'ALL' ? AGE_WIDTH.allShare : wide ? AGE_WIDTH.shareWide : AGE_WIDTH.share;
    console.log(
      `  ${pos.padEnd(4)} n=${ages.length} · ${soft(`${pos} mean age`, mean(ages), nfl.mean, mw, 2)} · ${soft(
        `${pos} 24 or younger %`,
        pct(ages, (a) => a <= 24),
        nfl.young,
        sw,
      )} · ${soft(
        `${pos} 31 or older %`,
        pct(ages, (a) => a >= 31),
        nfl.old,
        sw,
      )}`,
    );
  }
  const fates: Record<AgeGroup, Partial<Record<AgeBand, Fate>>> = { all: {}, long: {}, short: {} };
  for (const r of runs) addFates(fates, r.age.fates);
  console.log('  a starter next season (still starting / gone, %):');
  for (const g of ['all', 'long', 'short'] as AgeGroup[])
    for (const b of AGE_BANDS) {
      const f = fates[g][b];
      if (!f) continue;
      const nfl = NFL_NEXT[g][b];
      console.log(
        `    ${g.padEnd(5)} ${b.padEnd(5)} n=${f.n} · ${soft(`${g} ${b} still starting %`, (100 * f.keep) / f.n, nfl.keep, AGE_WIDTH.keep)} · ${soft(`${g} ${b} gone %`, (100 * f.gone) / f.n, nfl.gone, AGE_WIDTH.gone)}`,
      );
    }
  const exits: Partial<Record<Position, number[]>> = {};
  for (const r of runs)
    for (const [pos, xs] of Object.entries(r.age.exits)) (exits[pos as Position] ??= []).push(...xs!);
  console.log(
    '  the age a starter left for good, median (informational): ' +
      POSITIONS.map(
        (pos) => `${pos} ${exits[pos]?.length ? median(exits[pos]!).toFixed(1) : 'n/a'} (NFL ${NFL_EXIT_AGE[pos]})`,
      ).join(' · '),
  );
  const gapLine = (pick: (r: LeagueRun) => Record<number, number>) =>
    Array.from({ length: 16 }, (_, i) => 21 + i)
      .map(
        (a) =>
          `${a} ${mean(
            runs
              .map(pick)
              .map((g) => g[a])
              .filter(Number.isFinite),
          ).toFixed(2)}`,
      )
      .join(' · ');
  console.log(`  overall below a starter by age, first kickoff (informational): ${gapLine((r) => r.age.gap.first)}`);
  console.log(`  overall below a starter by age, settled (informational): ${gapLine((r) => r.age.gap.settled)}`);
  if (known.length)
    console.log(`⚠ known issue: leagues grow older than the NFL's (${known.length} lines outside the owner's bands)`);
}
// Coaching trees against the NFL (spec §4.6, docs/research/coaching-trees.md).
{
  const t = runs.map((r) => r.trees);
  const all = (f: (x: LeagueRun['trees']) => number[]) => t.flatMap(f);
  const hires = t.flatMap((x) => x.hires);
  const fromTree =
    hires.reduce((n, h) => n + h.fromTree, 0) /
    Math.max(
      1,
      hires.reduce((n, h) => n + h.total, 0),
    );
  // One offseason's share is judged only where five or more clubs changed head coach (fewer is a coin flip). The NFL's
  // 0.4 is one cycle's peak (2026: 4 of 10) in a decade; four leagues' 60-odd offseasons will meet a peak like it by
  // chance, so the check reads the busy offseason (the 90th percentile), not the single busiest.
  const shares = hires
    .filter((h) => h.total >= 5)
    .map((h) => h.mostFromOne / h.total)
    .sort((x, y) => x - y);
  const busiest = shares.length ? shares[Math.min(shares.length - 1, Math.floor(0.9 * shares.length))] : 0;
  // Live trees are read in the steady state, as the biggest tree is: a new league starts with none, and a tree needs a
  // head coach's three seasons and two disciples hired before it counts, so the early seasons only dragged the mean
  // (the owner's call, 0.2.24: G2 read 1.9 over all sixteen seasons, against main's 2.2).
  // Trees born is a count a league's sixteen seasons swing from 0 to 7 with the same founding staffs (main's four
  // careers leagues read 4, 2, 1 and 0; the real-heights world's 4, 1, 7 and 6): it's judged over the work-ethic
  // leagues' trees too, eight leagues, as they're played anyway.
  const born = [...t, ...(await ethicLeagues).map((r) => r.trees)].map((x) => x.born);
  console.log(
    `coaching trees: ${check('live trees (steady)', mean(t.flatMap((x) => x.live.slice(Math.floor(x.live.length / 2)))), 2, 5, 1, LIVE_TREES_NORMAL)} · ${check('biggest (steady)', mean(t.flatMap((x) => x.biggest.slice(Math.floor(x.biggest.length / 2)))), 3, 6, 1)} · ${check('head coaches in a live tree', mean(all((x) => x.inTreeShare)), 0.15, 0.4)} · ${check('hires from a tree', fromTree, 0.1, 0.35)} · ${check('most from one tree in a busy offseason (90th pct)', busiest, 0, 0.4)} · ${check(`trees born per league in 16 seasons (${born.length} leagues)`, mean(born), 1, 4, 1)} · ${check(`leagues with no founding tree alive at the end (of ${t.length})`, t.filter((x) => x.foundingAlive === 0).length, 0, 0, 0, NO_FOUNDING_NORMAL)}`,
  );
}
console.log(`\n${misses} number(s) outside target range`);
if (misses) process.exitCode = 1;
