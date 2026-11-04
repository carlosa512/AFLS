/**
 * Parity's arithmetic, shared by `npm run parity` and `npm run parity-fit`: each moment resolved on the open field
 * several times on its own seeds, then every row the spec names (league, matchup, spatial-only reads) against today's
 * engine on the same moments and the NFL ranges `npm run sim` uses.
 */
import { playYards } from '../src/engine/field/play';
import { runField } from '../src/engine/field/run';
import { KNOBS } from '../src/engine/field/tuning';
import { runPocket, type PocketStart } from '../src/engine/field/pocketField';
import type { FieldPlayer, FieldResult, FieldStart } from '../src/engine/field/types';
import { Rng } from '../src/engine/rng';
import { groupOf, type Group, type MomentRow, type PocketRow, type Totals } from './field-moments';
import { TARGETS } from './targets';

export const SEEDS = 3;
const GROUPS: Group[] = ['DL', 'LB', 'DB'];

/** One moment resolved: today's numbers and the open field's means over its seeds. */
export interface Resolved {
  kind: MomentRow['kind'];
  kick?: MomentRow['kick'];
  rb: boolean;
  stood: boolean;
  air: number;
  f: MomentRow['f'];
  today: MomentRow['today'];
  sp: {
    yards: number;
    td: number;
    oob: number;
    duration: number;
    groups: [number, number, number];
    tackled: number;
    misses: number;
    y10: number;
    y20: number;
    y40: number;
    /** The film ends at the credited spot (within a yard and a half; a touchdown scores). */
    film: number;
  };
  /** The open field's own times (ms), one a seed. */
  ms: number[];
}

/** Where a start's yards count from, in the carrier's own terms (his goal line at 0). */
const ownLine = (s: FieldStart) => (s.dir === 1 ? s.yardLine : 100 - s.yardLine);

export function spatialYards(s: FieldStart, r: FieldResult): { yards: number; td: boolean } {
  const p = playYards(r, ownLine(s));
  return { yards: p.yards, td: p.touchdown };
}

export function resolve(row: MomentRow, key: string, seeds = SEEDS): Resolved {
  const sp: Resolved['sp'] = {
    yards: 0,
    td: 0,
    oob: 0,
    duration: 0,
    groups: [0, 0, 0],
    tackled: 0,
    misses: 0,
    y10: 0,
    y20: 0,
    y40: 0,
    film: 0,
  };
  const ms: number[] = [];
  // The owner's call H: the yards, touchdowns and out-of-bounds are today's (credited); the open field plays out how
  // he got there, so what it decides is who tackles, who misses, the time, and whether the film ends at the spot.
  const credited = row.today.yards;
  const gain = row.kind === 'catch' ? credited - row.air : credited;
  // With the switch on, today's out-of-bounds call reaches the field first: he goes out at his spot.
  const start =
    row.today.oob && row.start.target && row.kind !== 'return' && row.kind !== 'turnover'
      ? { ...row.start, target: { ...row.start.target, out: true } }
      : row.start;
  for (let k = 0; k < seeds; k++) {
    const t = performance.now();
    const r = runField(start, new Rng(`${key}:${k}`));
    ms.push(performance.now() - t);
    const film = spatialYards(start, r);
    sp.yards += credited / seeds;
    sp.td += (row.today.td ? 1 : 0) / seeds;
    sp.oob += (row.today.oob ? 1 : 0) / seeds;
    const atSpot = row.today.td ? film.td : !film.td && Math.abs(film.yards - credited) <= 1.5;
    sp.film += (atSpot ? 1 : 0) / seeds;
    sp.duration +=
      Math.max(3, Math.round(row.start.t0 + r.duration + KNOBS.pad + (row.kind === 'catch' ? KNOBS.padCatch : 0))) /
      seeds;
    sp.misses += r.misses.length / seeds;
    sp.y10 += (gain >= 10 ? 1 : 0) / seeds;
    sp.y20 += (gain >= 20 ? 1 : 0) / seeds;
    sp.y40 += (gain >= 40 ? 1 : 0) / seeds;
    if (r.tackler !== null) {
      sp.tackled += 1 / seeds;
      const g = groupOf(row.start.players.find((p) => p.id === r.tackler)?.s.pos);
      if (g) sp.groups[GROUPS.indexOf(g)] += 1 / seeds;
    }
  }
  const { start: _start, ...rest } = row;
  void _start;
  return { ...rest, sp, ms };
}

// ───────── judging ─────────

export interface Line {
  label: string;
  value: number;
  range: [number, number];
  note: string;
  /** Reported, not judged. */
  info?: boolean;
}

const mean = (xs: readonly number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const share = (xs: readonly Resolved[], f: (r: Resolved) => number) => mean(xs.map(f));
const near = (today: number, tol: number): [number, number] => [today - tol, today + tol];

/** Least squares: y on [1, ...x]; the coefficients and their standard errors. */
export function ols(x: number[][], y: number[]): { b: number[]; se: number[] } {
  const k = x[0].length + 1;
  const xtx = Array.from({ length: k }, () => new Array(k).fill(0));
  const xty = new Array(k).fill(0);
  for (let i = 0; i < y.length; i++) {
    const r = [1, ...x[i]];
    for (let a = 0; a < k; a++) {
      xty[a] += r[a] * y[i];
      for (let b = 0; b < k; b++) xtx[a][b] += r[a] * r[b];
    }
  }
  const inv = invert(xtx);
  const b = inv.map((row) => row.reduce((s, v, j) => s + v * xty[j], 0));
  let rss = 0;
  for (let i = 0; i < y.length; i++) {
    const r = [1, ...x[i]];
    rss += (y[i] - r.reduce((s, v, j) => s + v * b[j], 0)) ** 2;
  }
  const s2 = rss / Math.max(1, y.length - k);
  return { b, se: inv.map((row, i) => Math.sqrt(Math.max(0, row[i] * s2))) };
}

function invert(m: number[][]): number[][] {
  const n = m.length;
  const a = m.map((row, i) => [...row, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(a[r][c]) > Math.abs(a[p][c])) p = r;
    [a[c], a[p]] = [a[p], a[c]];
    const d = a[c][c] || 1e-12;
    for (let j = 0; j < 2 * n; j++) a[c][j] /= d;
    for (let r = 0; r < n; r++)
      if (r !== c) {
        const f = a[r][c];
        for (let j = 0; j < 2 * n; j++) a[r][j] -= f * a[c][j];
      }
  }
  return a.map((row) => row.slice(n));
}

/** Every league and matchup row. */
/** Every league and matchup row; without `totals` (the fit's sample), the rows rebuilt from the whole league are left out. */
export function judge(all: Resolved[], totals?: Totals): Line[] {
  const lines: Line[] = [];
  const add = (label: string, value: number, range: [number, number], note: string, info = false) =>
    lines.push({ label, value, range, note, info });
  // Against the NFL, reported only (the owner's call): under call H a rebuilt league number is today's engine's, which
  // `npm run sim` judges against the same targets over 60 seasons; parity's own rows judge the field against today.
  const nfl = (label: string, value: number, range: readonly [number, number]) =>
    add(label, value, [range[0], range[1]], `NFL ${range[0]}–${range[1]} (sim judges it)`, true);
  const runs = all.filter((r) => r.kind === 'run');
  const catches = all.filter((r) => r.kind === 'catch');
  const kicks = all.filter((r) => r.kick === 'kickoff');
  const punts = all.filter((r) => r.kick === 'punt');
  const returns = [...kicks, ...punts];
  const tg = (totals?.games ?? 0) * 2;

  // The film ends where the play is credited (call H).
  add('the film ends at the credited spot (share)', mean(all.map((r) => r.sp.film)), [0.9, 1], 'call H');
  // Picks and strip-sacks run back on the field, held to the same spot (a few dozen a run: their own row, so a miss
  // there can't hide in the share above).
  const turnovers = all.filter((r) => r.kind === 'turnover');
  if (turnovers.length)
    add(
      'turnover returns: the film ends at the credited spot (share)',
      mean(turnovers.map((r) => r.sp.film)),
      [0.9, 1],
      `${turnovers.length} picks and strip-sacks`,
    );

  // After the catch.
  const yac = (r: Resolved, y: number) => y - r.air;
  const todayYac = mean(catches.map((r) => yac(r, r.today.yards)));
  add(
    'yards after the catch (mean)',
    mean(catches.map((r) => yac(r, r.sp.yards))),
    near(todayYac, 0.4),
    `today ${todayYac.toFixed(2)}`,
  );
  const t10 = share(catches, (r) => (yac(r, r.today.yards) >= 10 ? 1 : 0));
  const t20 = share(catches, (r) => (yac(r, r.today.yards) >= 20 ? 1 : 0));
  add(
    'catches 10+ after the catch (share)',
    share(catches, (r) => r.sp.y10),
    near(t10, 0.02),
    `today ${t10.toFixed(3)}`,
  );
  add(
    'catches 20+ after the catch (share)',
    share(catches, (r) => r.sp.y20),
    near(t20, 0.01),
    `today ${t20.toFixed(3)}`,
  );

  // Runs past the line.
  const tRun = mean(runs.map((r) => r.today.yards));
  add('yards a carry, moments', mean(runs.map((r) => r.sp.yards)), near(tRun, 0.3), `today ${tRun.toFixed(2)}`);
  const sum = (xs: Resolved[], f: (r: Resolved) => number) => xs.reduce((n, r) => n + f(r), 0);
  if (totals) {
    const stoodRuns = runs.filter((r) => r.stood);
    const stoodCatches = catches.filter((r) => r.stood);
    const ypcToday = totals.rushYds / totals.rushAtt;
    const ypc =
      (totals.rushYds - sum(stoodRuns, (r) => r.today.yards) + sum(stoodRuns, (r) => r.sp.yards)) / totals.rushAtt;
    add("the league's yards a carry, rebuilt", ypc, near(ypcToday, 0.15), `today ${ypcToday.toFixed(2)}`);
    nfl("the league's yards a carry, rebuilt (NFL)", ypc, TARGETS.ypc);
    const r10t = sum(runs, (r) => (r.today.yards >= 10 ? 1 : 0)) / totals.rushAtt;
    const r20t = sum(runs, (r) => (r.today.yards >= 20 ? 1 : 0)) / totals.rushAtt;
    add(
      'runs of 10+ (share of carries)',
      sum(runs, (r) => r.sp.y10) / totals.rushAtt,
      near(r10t, 0.015),
      `today ${r10t.toFixed(3)}`,
    );
    add(
      'runs of 20+ (share of carries)',
      sum(runs, (r) => r.sp.y20) / totals.rushAtt,
      near(r20t, 0.006),
      `today ${r20t.toFixed(3)}; NFL 0.64 a team-game`,
    );
    const rtdToday = totals.rushTd / tg;
    const rtd = (totals.rushTd - sum(stoodRuns, (r) => (r.today.td ? 1 : 0)) + sum(stoodRuns, (r) => r.sp.td)) / tg;
    add('rushing TDs a team-game, rebuilt', rtd, near(rtdToday, 0.08), `today ${rtdToday.toFixed(2)}`);
    nfl('rushing TDs a team-game, rebuilt (NFL)', rtd, TARGETS.rushTd);
    const ypaToday = totals.passYds / totals.passAtt;
    const ypa =
      (totals.passYds - sum(stoodCatches, (r) => r.today.yards) + sum(stoodCatches, (r) => r.sp.yards)) /
      totals.passAtt;
    add('yards an attempt, rebuilt', ypa, near(ypaToday, 0.15), `today ${ypaToday.toFixed(2)}`);
    nfl('yards an attempt, rebuilt (NFL)', ypa, TARGETS.ypa);
    const ptdToday = totals.passTd / tg;
    const ptd =
      (totals.passTd - sum(stoodCatches, (r) => (r.today.td ? 1 : 0)) + sum(stoodCatches, (r) => r.sp.td)) / tg;
    add('passing TDs a team-game, rebuilt', ptd, near(ptdToday, 0.1), `today ${ptdToday.toFixed(2)}`);
    nfl('passing TDs a team-game, rebuilt (NFL)', ptd, TARGETS.passTd);
  }

  // Returns.
  for (const [label, xs, tol, tol20, tol40] of [
    ['kick', kicks, 1.2, 0.04, 0.015],
    ['punt', punts, 0.8, 0.02, 0.01],
  ] as const) {
    const t = mean(xs.map((r) => r.today.yards));
    add(`${label} return yards`, mean(xs.map((r) => r.sp.yards)), near(t, tol), `today ${t.toFixed(2)}`);
    const a = share(xs, (r) => (r.today.yards >= 20 ? 1 : 0));
    const b = share(xs, (r) => (r.today.yards >= 40 ? 1 : 0));
    add(
      `${label} returns of 20+ (share)`,
      share(xs, (r) => r.sp.y20),
      near(a, tol20),
      `today ${a.toFixed(3)}`,
    );
    add(
      `${label} returns of 40+ (share)`,
      share(xs, (r) => r.sp.y40),
      near(b, tol40),
      `today ${b.toFixed(3)}`,
    );
  }
  const rtdShare = share(returns, (r) => (r.today.td ? 1 : 0));
  add(
    'return TDs (share of returns)',
    share(returns, (r) => r.sp.td),
    near(rtdShare, 0.003),
    `today ${rtdShare.toFixed(4)}`,
  );

  // Missed tackles a back's touch: judged against the NFL (today's engine counts at most one, on breakaways).
  const backs = runs.filter((r) => r.rb);
  if (totals)
    add(
      "missed tackles a back's touch",
      sum(backs, (r) => r.sp.misses) / totals.rbCarries,
      [0.12, 0.24],
      `NFL 0.18 (SIS 2021); today ${(sum(backs, (r) => (r.today.broke ? 1 : 0)) / totals.rbCarries).toFixed(3)}`,
    );

  // Out of bounds.
  for (const [label, xs] of [
    ['runs', runs],
    ['catches', catches],
  ] as const) {
    const t = share(xs, (r) => (r.today.oob ? 1 : 0));
    add(
      `out of bounds, ${label} (share)`,
      share(xs, (r) => r.sp.oob),
      near(t, 0.03),
      `today ${t.toFixed(3)}`,
    );
  }

  // Tackles by group, scrimmage moments.
  const scrim = [...runs, ...catches];
  const todayTackled = scrim.filter((r) => r.today.group);
  const spTackled = sum(scrim, (r) => r.sp.groups[0] + r.sp.groups[1] + r.sp.groups[2]);
  GROUPS.forEach((g, i) => {
    const t = todayTackled.filter((r) => r.today.group === g).length / todayTackled.length;
    add(
      `tackles by ${g} (share)`,
      sum(scrim, (r) => r.sp.groups[i]) / spTackled,
      near(t, 0.05),
      `today ${t.toFixed(3)}`,
    );
  });

  // Seconds from the snap to the whistle.
  for (const [label, xs] of [
    ['runs', runs],
    ['catches', catches],
  ] as const) {
    const t = mean(xs.map((r) => r.today.duration));
    add(
      `seconds from the snap to the whistle, ${label}`,
      mean(xs.map((r) => r.sp.duration)),
      near(t, 0.6),
      `today ${t.toFixed(2)}`,
    );
  }

  // ── Matchups: bins, then slopes ──
  const cut3 = (v: number, lo: number, hi: number) => (v < lo ? 0 : v <= hi ? 1 : 2);
  for (const [label, xs, withZ] of [
    ['runs', runs, true],
    ['catches', catches, false],
    ['returns', returns, false],
  ] as const) {
    const bins = new Map<string, Resolved[]>();
    for (const r of xs) {
      const key = `${cut3(r.f.carrier, 10, 14)}${cut3(r.f.defense, 10, 14)}${withZ ? (r.f.z < 0 ? 0 : r.f.z <= 1 ? 1 : 2) : ''}`;
      bins.set(key, [...(bins.get(key) ?? []), r]);
    }
    let judged = 0;
    let off = 0;
    for (const [key, b] of bins) {
      if (b.length < 300) continue;
      judged++;
      const t = mean(b.map((r) => r.today.yards));
      const s = mean(b.map((r) => r.sp.yards));
      if (Math.abs(s - t) > Math.max(0.6, 0.15 * Math.abs(t))) {
        off++;
        add(
          `  ${label} bin ${key} (${b.length})`,
          s,
          near(t, Math.max(0.6, 0.15 * Math.abs(t))),
          `today ${t.toFixed(2)}`,
        );
      }
    }
    add(`${label}: matchup bins off today's (of ${judged})`, off, [0, 0], 'none');
  }
  for (const [label, xs, feats, names] of [
    ['runs', runs, (r: Resolved) => [r.f.carrier, r.f.defense, r.f.z], ['carrier skill', 'defense', 'line state z']],
    ['catches', catches, (r: Resolved) => [r.f.carrier, r.f.defense], ['carrier skill', 'defense']],
    ['returns', returns, (r: Resolved) => [r.f.carrier, r.f.edge], ['return skill', 'coaching edge']],
  ] as const) {
    const x = xs.map((r) => [...feats(r)]);
    const today = ols(
      x,
      xs.map((r) => r.today.yards),
    );
    const sp = ols(
      x,
      xs.map((r) => r.sp.yards),
    );
    names.forEach((name, i) => {
      const bt = today.b[i + 1];
      const bs = sp.b[i + 1];
      // Judged only where today's engine has a slope to match (three standard errors from flat).
      const real = Math.abs(bt) > 3 * today.se[i + 1];
      add(
        `${label}: slope on ${name}, spatial ÷ today`,
        bs / bt,
        [0.6, 1.5],
        `today ${bt.toFixed(3)} (se ${today.se[i + 1].toFixed(3)}), spatial ${bs.toFixed(3)}`,
        !real,
      );
    });
  }
  return lines;
}

let misses = 0;
/** Print a line the way the repo's checks do; returns whether it's in range. */
export function print(l: Line): boolean {
  const ok = l.info || (Number.isFinite(l.value) && l.value >= l.range[0] && l.value <= l.range[1]);
  if (!ok) misses++;
  const shown = Number.isFinite(l.value) ? l.value.toFixed(3) : 'none';
  const range = l.info ? 'reported' : l.range.map((x) => x.toFixed(3)).join('–');
  const mark = l.info ? ' ' : ok ? '✓' : '✗';
  const why = ok ? '' : !Number.isFinite(l.value) ? '  ✗ NOT MEASURED' : l.value < l.range[0] ? '  ▼ LOW' : '  ▲ HIGH';
  console.log(`${mark} ${l.label.padEnd(58)} ${shown.padStart(9)}   ${range.padEnd(13)} ${l.note}${why}`);
  return ok;
}
export const missCount = () => misses;

/** How far off a set of lines is, for the fit: each row's miss in tolerances, squared; slopes by their ratio. */
export function loss(lines: Line[]): number {
  let s = 0;
  for (const l of lines) {
    if (l.info || !Number.isFinite(l.value)) continue;
    const mid = (l.range[0] + l.range[1]) / 2;
    const half = Math.max(1e-6, (l.range[1] - l.range[0]) / 2);
    if (l.label.includes('slope')) s += ((l.value - 1) / 0.25) ** 2;
    else if (l.label.includes('bins off')) s += l.value;
    else s += ((l.value - mid) / half) ** 2;
  }
  return s;
}

// ───────── the pocket (slice two) ─────────

/** Who got home, by where he rushed from. */
type RushGroup = 'edge' | 'interior' | 'linebacker' | 'secondary';
const RUSH_GROUPS: RushGroup[] = ['edge', 'interior', 'linebacker', 'secondary'];
const rushGroup = (role: string): RushGroup =>
  role === 'EDGE' ? 'edge' : role === 'DT' ? 'interior' : role === 'LB' ? 'linebacker' : 'secondary';
/** Who lost him, by his spot: the line by alignment, a back or a tight end kept in. */
type Spot = 'tackle' | 'guard' | 'center' | 'back';
const SPOTS: Spot[] = ['tackle', 'guard', 'center', 'back'];

export interface ResolvedPocket {
  outcome: PocketStart['outcome'];
  /** Today's credit: the rusher's group, the blocker's spot. */
  today: { group: RushGroup | null; spot: Spot | null; rusher: number | null; beat: number | null; duration: number };
  /** The field's, averaged over the seeds. */
  sp: {
    groups: number[];
    spots: number[];
    rusher: Record<number, number>;
    beat: Record<number, number>;
    at: number[];
    duration: number;
  };
  /** Each rusher's rush and each blocker's protection, centred on the play's own men. */
  rush: Record<number, number>;
  pro: Record<number, number>;
  ms: number[];
}

/** One dropback's pocket, played on parity's own streams (its first `seeds`). */
export function resolvePocket(row: PocketRow, key: string, seeds = SEEDS): ResolvedPocket {
  const { start, today } = row;
  const role = new Map(start.players.map((p) => [p.id, p.role]));
  const across = start.players
    .filter((p) => p.role === 'OL')
    .sort((a, b) => a.y - b.y)
    .map((p) => p.id);
  const spotOf = (id: number | null): Spot | null => {
    if (id === null) return null;
    const k = across.indexOf(id);
    if (k < 0) return 'back';
    const n = across.length;
    return k === 0 || k === n - 1 ? 'tackle' : k === 1 || k === n - 2 ? 'guard' : 'center';
  };
  const groupOfId = (id: number | null) => (id === null ? null : rushGroup(role.get(id) ?? 'S'));
  // Today's credit by position (today credits men off the field too): an edge or a tackle by his position.
  const todayGroup: RushGroup | null =
    row.rusherPos === null ? null : rushGroup(row.rusherPos === 'CB' ? 'S' : row.rusherPos);
  const todaySpot: Spot | null =
    !today.blamed || today.beat === null ? null : row.beatPos === 'OL' ? spotOf(today.beat) : 'back';
  const centred = (ids: number[], f: (s: FieldPlayer['s']) => number) => {
    const xs = ids.map((id) => f(start.players.find((p) => p.id === id)!.s));
    const m = mean(xs);
    return Object.fromEntries(ids.map((id, k) => [id, xs[k] - m])) as Record<number, number>;
  };
  const sp: ResolvedPocket['sp'] = {
    groups: RUSH_GROUPS.map(() => 0),
    spots: SPOTS.map(() => 0),
    rusher: {},
    beat: {},
    at: [],
    duration: 0,
  };
  const ms: number[] = [];
  for (let k = 0; k < seeds; k++) {
    const t = performance.now();
    const r = runPocket(start, new Rng(`${key}:${k}`));
    ms.push(performance.now() - t);
    const g = groupOfId(r.rusher);
    if (g) sp.groups[RUSH_GROUPS.indexOf(g)] += 1 / seeds;
    const s = spotOf(r.beat);
    if (s) sp.spots[SPOTS.indexOf(s)] += 1 / seeds;
    if (r.rusher !== null) sp.rusher[r.rusher] = (sp.rusher[r.rusher] ?? 0) + 1 / seeds;
    if (r.beat !== null) sp.beat[r.beat] = (sp.beat[r.beat] ?? 0) + 1 / seeds;
    if (start.outcome === 'sack' && r.at !== null) {
      sp.at.push(r.at);
      sp.duration += Math.max(3, Math.round(r.at + KNOBS.padSack)) / seeds;
    }
  }
  return {
    outcome: start.outcome,
    today: {
      group: todayGroup,
      spot: todaySpot,
      rusher: today.rusher,
      beat: today.blamed ? today.beat : null,
      duration: today.duration,
    },
    sp,
    rush: centred(
      start.rushers.filter((id) => role.has(id)),
      (s) => s.rush,
    ),
    pro: centred(
      start.blockers.filter((id) => role.has(id)),
      (s) => s.pro,
    ),
    ms,
  };
}

const quantile = (xs: number[], q: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))] : NaN;
};

/** The pocket's rows: the field against today's engine on the same dropbacks (spec §5). */
export function judgePocket(all: ResolvedPocket[]): Line[] {
  const lines: Line[] = [];
  const add = (label: string, value: number, range: [number, number], note: string, info = false) =>
    lines.push({ label, value, range, note, info });
  const sacks = all.filter((r) => r.outcome === 'sack');
  // Who got home: each group's share of the sacks.
  RUSH_GROUPS.forEach((g, i) => {
    const t = sacks.filter((r) => r.today.group === g).length / Math.max(1, sacks.length);
    const f = sacks.reduce((n, r) => n + r.sp.groups[i], 0) / Math.max(1, sacks.length);
    add(`pocket: sacks by the ${g} (share)`, f, near(t, 0.05), `today ${t.toFixed(3)}`);
  });
  // Who lost him: each spot's share of the sacks and pressures charged.
  const charged = all.filter((r) => r.outcome === 'sack' || r.outcome === 'pressure' || r.outcome === 'hit');
  const tAll = charged.filter((r) => r.today.spot).length;
  const fAll = charged.reduce((n, r) => n + r.sp.spots.reduce((a, b) => a + b, 0), 0);
  SPOTS.forEach((s, i) => {
    const t = charged.filter((r) => r.today.spot === s).length / Math.max(1, tAll);
    const f = charged.reduce((n, r) => n + r.sp.spots[i], 0) / Math.max(1, fAll);
    add(`pocket: sacks and pressures allowed, ${s} (share)`, f, near(t, 0.05), `today ${t.toFixed(3)}`);
  });
  // The ratings: a rusher's sacks against his rush, a blocker's against his protection (the field's slope over today's).
  const slope = (
    rows: ResolvedPocket[],
    skill: (r: ResolvedPocket) => Record<number, number>,
    who: 'rusher' | 'beat',
  ) => {
    const x: number[][] = [];
    const yt: number[] = [];
    const yf: number[] = [];
    for (const r of rows)
      for (const [k, v] of Object.entries(skill(r))) {
        const id = Number(k);
        x.push([v]);
        yt.push(r.today[who] === id ? 1 : 0);
        yf.push((who === 'rusher' ? r.sp.rusher : r.sp.beat)[id] ?? 0);
      }
    if (x.length < 3) return { t: NaN, f: NaN, st: NaN, sf: NaN };
    const t = ols(x, yt);
    const f = ols(x, yf);
    return { t: t.b[1], f: f.b[1], st: t.se[1], sf: f.se[1] };
  };
  /**
   * The field's slope over today's in 0.6–1.5; when today's can't be told from zero (|t| < 2: today barely reads the
   * rating there), the field's within 2.5 standard errors of today's, as the season rows judge.
   */
  const slopeRow = (label: string, x: { t: number; f: number; st: number; sf: number }) => {
    const note = `today ${x.t.toFixed(4)} (se ${x.st.toFixed(4)}), spatial ${x.f.toFixed(4)} (se ${x.sf.toFixed(4)})`;
    if (Math.abs(x.t) >= 2 * x.st) add(`${label}, spatial ÷ today`, x.f / x.t, [0.6, 1.5], note);
    else {
      const band = 2.5 * Math.hypot(x.st, x.sf);
      add(`${label}, spatial − today (today ~0)`, x.f - x.t, [-band, band], note);
    }
  };
  slopeRow(
    "pocket: a rusher's sacks on his rush",
    slope(sacks, (r) => r.rush, 'rusher'),
  );
  slopeRow(
    "pocket: a blocker's sacks allowed on his protection",
    slope(
      sacks.filter((r) => r.today.beat !== null),
      (r) => r.pro,
      'beat',
    ),
  );
  // When: the NFL's snap to sack, and the play's clock on a sack.
  const at = sacks.flatMap((r) => r.sp.at);
  add('pocket: seconds from the snap to a sack, median', quantile(at, 0.5), [2.6, 3.2], 'NFL 2.9 (NGS 2023–25)');
  add(
    'pocket: seconds from the snap to a sack, 90th percentile',
    quantile(at, 0.9),
    [4.8, 5.8],
    'NFL 5.3 (NGS 2023–25)',
  );
  const td = mean(sacks.map((r) => r.today.duration));
  add(
    'pocket: seconds from the snap to the whistle, sacks',
    mean(sacks.map((r) => r.sp.duration)),
    near(td, 0.6),
    `today ${td.toFixed(2)}`,
  );
  // Today's by construction: reported.
  const share = (o: string) => all.filter((r) => r.outcome === o).length / Math.max(1, all.length);
  for (const o of ['sack', 'pressure', 'hit', 'scramble', 'escape', 'away'] as const)
    add(`pocket: ${o} (share of dropbacks)`, share(o), [0, 1], "today's, by construction", true);
  const ms = all.flatMap((r) => r.ms);
  add('pocket: median ms a dropback', quantile(ms, 0.5), [0, 5], `p90 ${quantile(ms, 0.9).toFixed(2)} ms`);
  return lines;
}
