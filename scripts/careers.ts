/**
 * Career audit: how players grow, peak, fade and retire, measured against the real-world ranges in
 * docs/research/attributes-development-scouting-roadmap.md (and, where the research is silent,
 * design targets marked as such). Run it after any change to `development.ts`, `aging.ts`,
 * retirement or the hidden traits.
 *
 *   npm run careers            # cohort curves + four 16-season leagues (about 3 minutes on 4 cores)
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
import { fork } from 'node:child_process';
import { CHAIRS, coachingFrom, NEUTRAL, type Coaching } from '../src/engine/coaching';
import { ceilingShift, COACH_LEAN, hypeLean, SNAP_LEAN, workLean } from '../src/engine/ceiling';
import { CEILING_SWING, developPlayer } from '../src/engine/development';
import { generatePlayer } from '../src/engine/generate';
import { HYPE_ROOM, RAW } from '../src/engine/offseason/draft';
import { playerOvr } from '../src/engine/positions';
import { clamp, Rng } from '../src/engine/rng';
import type { Coach, Player, Position, Traits } from '../src/engine/types';
import { POSITIONS } from '../src/engine/types';
import type { LeagueRun } from './careers-league';
import { LEADER_TARGETS, overRecordAllowed } from './leaders';

const seasons = Number(process.argv[2] ?? 16);
const SEEDS = ['careers-audit', 'careers-audit-2', 'careers-audit-3', 'careers-audit-4'];
// Part 2's leagues start first, each in its own process, and play while Part 1 runs here.
const leagues: Promise<LeagueRun>[] = SEEDS.map(
  (seed) =>
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
    }),
);
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
function cohort(pos: Position, playedShare = 1, n = COHORT, coaching: Coaching = NEUTRAL): Cohort {
  const out: Cohort = {
    ovr: [],
    attr: { speed: [], agility: [], throwAccShort: [], throwAccDeep: [], awareness: [] },
    traits: [],
  };
  for (let i = 0; i < n; i++) {
    const rng = new Rng(`careers:${pos}:${i}`);
    const p = generatePlayer(rng, {
      id: 900000 + i,
      position: pos,
      quality: rng.normal(11, 1.2) - RAW,
      age: 21,
      teamId: null,
      jerseysUsed: new Set(),
    });
    const growth =
      RAW +
      HYPE_ROOM +
      Math.abs(rng.normal(0, 1)) * 2.1 +
      rng.float(0, 0.8) +
      (rng.chance(0.06) ? rng.float(2, 4.5) : 0);
    p.potential = clamp(playerOvr(p) + growth, 1, 20);
    const row: number[] = [];
    const entry = playerOvr(p);
    const attrs: Record<string, number[]> = Object.fromEntries(Object.keys(out.attr).map((a) => [a, []]));
    for (const age of AGES) {
      p.age = age;
      row.push(playerOvr(p));
      for (const a of Object.keys(attrs)) attrs[a].push(p.ratings[a as keyof Player['ratings']]);
      developPlayer(new Rng(`careers:dev:${pos}:${i}:${age}`), p, { playedShare, ...coaching });
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
  const late = pos === 'CB' ? 31 : 32;
  lines.push(
    `${pos}: ${check('peak age', peakAge(cohorts[pos]), 25, 28.5, 1)} · ${check('below peak at 28', below(c, 28), 0, 0.5)} · ${check(`below peak at ${late}`, below(c, late), 1.5, 4.5)}`,
  );
}
// Design targets: the front seven and safeties fade from about 30.
for (const pos of ['S', 'LB', 'EDGE', 'DT'] as const) {
  lines.push(
    `${pos}: ${check('peak age', peakAge(cohorts[pos]), 25, 30, 1)} · ${check('below peak at 33', below(curves[pos], 33), 1.5, 5.5)}`,
  );
}
// Research: long plateaus (TE still at 89% at 34, survivor-biased).
for (const pos of ['TE', 'OL'] as const) {
  const c = curves[pos];
  lines.push(
    `${pos}: ${check('peak age', peakAge(cohorts[pos]), 26, 32, 1)} · ${check('below peak at 32', below(c, 32), 0, 0.6)} · ${check('below peak at 35', below(c, 35), 0.8, 4)}`,
  );
}
{
  // Research: QB peak season 28.5 on average (pocket 30.7, dual-threat 26.1); rushing flat 27–29.
  const c = curves.QB;
  const q = cohorts.QB.attr;
  const speed = curve(q.speed);
  const acc = AGES.map((_, j) =>
    mean(q.throwAccShort.map((r, i) => (r[j] + q.throwAccDeep[i][j] + q.awareness[i][j]) / 3)),
  );
  lines.push(
    `QB: ${check('peak age', peakAge(cohorts.QB), 27, 31, 1)} · ${check('below peak at 33', below(c, 33), 0, 0.6)} · ${check('below peak at 37', below(c, 37), 1, 4)} · ${check('speed at 32 vs 25', at(speed, 32) / at(speed, 25), 0.6, 0.9)} · ${check('accuracy+awareness at 34 vs peak', at(acc, 34) / Math.max(...acc), 0.97, 1.01, 3)}`,
  );
}
for (const pos of ['K', 'P'] as const)
  lines.push(
    `${pos}: ${check('below peak at 35', below(curves[pos], 35), 0, 0.6)} · ${check('below peak at 38', below(curves[pos], 38), 0.3, 3)}`,
  );
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
// Judged on the leagues' average path, so one league's luck doesn't decide it.
const meanPath = runs[0].starterOvr.map((_, i) => mean(runs.map((r) => r.starterOvr[i])));
console.log(`starter OVR by season (mean): ${meanPath.map((v) => v.toFixed(2)).join(' ')}`);
console.log(
  check('lowest starter OVR', Math.min(...meanPath), 12.65, 13.2) +
    ' · ' +
    check('highest starter OVR', Math.max(...meanPath), 12.65, 13.2),
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
const byEthic = [...shifts].sort((a, b) => a.workEthic - b.workEthic);
const third = Math.floor(byEthic.length / 3);
const ethicGap = mean(byEthic.slice(-third).map((s) => s.shift)) - mean(byEthic.slice(0, third).map((s) => s.shift));
const shrinking = swing(0) > swing(1) && swing(1) > swing(2) ? 1 : 0;
console.log(
  `draft: ${check('first-round busts (never a high-end starter) %', rate(firsts, false), 25, 40, 1)} (${firsts.length} picks) · ${check('Day 3 solid starters %', rate(day3, true), 8, 20, 1)} (${day3.length} picks)`,
);
console.log(
  `  ceilings: mean |shift| by year ${[0, 1, 2].map((y) => swing(y).toFixed(2)).join(' / ')} · ${check('swing shrinks year by year', shrinking, 1, 1, 0)} · ${check('work ethic top vs bottom third, mean shift', ethicGap, 0.1, 0.6)}`,
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
    text: `${label} ${check('#1', rank(0), f1, f2, digits)}, ${check('#5', rank(4), v1, v2, digits)}`,
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
const starterAges = pool((r) => r.starterAges);
console.log(
  'mean starter age: ' +
    POSITIONS.map(
      (pos) => `${pos} ${mean(starterAges.filter((p) => p.position === pos).map((p) => p.age)).toFixed(1)}`,
    ).join(' · '),
);
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
  // One offseason's share is judged only where five or more clubs changed head coach (fewer is a coin flip).
  const busiest = Math.max(0, ...hires.filter((h) => h.total >= 5).map((h) => h.mostFromOne / h.total));
  console.log(
    `coaching trees: ${check('live trees', mean(all((x) => x.live)), 2, 5, 1)} · ${check('biggest (steady)', mean(t.flatMap((x) => x.biggest.slice(Math.floor(x.biggest.length / 2)))), 3, 6, 1)} · ${check('head coaches in a live tree', mean(all((x) => x.inTreeShare)), 0.15, 0.4)} · ${check('hires from a tree', fromTree, 0.1, 0.35)} · ${check('most from one tree in an offseason', busiest, 0, 0.4)} · ${check('trees born per league', mean(t.map((x) => x.born)), 1, 4, 1)} · ${check('founding trees alive at the end (fewest)', Math.min(...t.map((x) => x.foundingAlive)), 1, Infinity, 0)}`,
  );
}
console.log(`\n${misses} number(s) outside target range`);
if (misses) process.exitCode = 1;
