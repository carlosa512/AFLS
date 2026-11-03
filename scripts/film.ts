/**
 * All-22 against the NFL's tracking numbers (spec: docs/superpowers/specs/2026-11-02-all-22-passing-game-design.md
 * §6). Stages every dropback from simulated games, measures what a viewer would see (when the ball leaves the
 * quarterback, how deep he sets, when the rush gets to him, whether he leaves the pocket) and holds it to the NFL's
 * ranges. Measured off the dots, not the staging's own plan, wherever the dots can say it.
 *
 *   npm run film [-- <games>]     (200 by default; 50 is enough to see which way a change moves)
 *
 * Each ✓/✗ line is one number against its range; the last line counts the misses, and any miss fails the run.
 */
import { createLeague } from '../src/engine/generate';
import { simulateGame } from '../src/engine/match/gameSim';
import { actorsIn } from '../src/engine/playActors';
import type { PlayLogEntry } from '../src/engine/types';
import { snapYFor } from '../src/ui/stage/ballPath';
import type { Drop } from '../src/ui/stage/pocket';
import type { Role } from '../src/ui/stage/cast';
import type { RouteId } from '../src/ui/stage/routes';
import { SPEED } from '../src/ui/stage/steer';
import { asRan, stagePlay, type StagedPlay } from '../src/ui/stage/stage';

const GAMES = Number(process.argv[2] ?? 200);
const DROPBACKS: ReadonlySet<string> = new Set(['pass', 'incomplete', 'int', 'sack', 'scramble']);
const THROWS: ReadonlySet<string> = new Set(['pass', 'incomplete', 'int']);
/** Out of the pocket: this far across the field from the ball (past where the tackles set). */
const BOX = 4.5;
/** The rush has got to him: this close (pressure), or on him (a sack). */
const PRESSURE_AT = 2;
const SACK_AT = 1.2;

let misses = 0;
const check = (label: string, value: number, [lo, hi]: readonly [number, number], nfl: string, digits = 2) => {
  const ok = Number.isFinite(value) && value >= lo && value <= hi;
  if (!ok) misses++;
  const shown = Number.isFinite(value) ? value.toFixed(digits) : 'none';
  const range = [lo, hi].map((x) => (Number.isInteger(x) ? String(x) : x.toFixed(2))).join('–');
  console.log(
    `${ok ? '✓' : '✗'} ${label.padEnd(40)} ${shown.padStart(7)}   ${range.padEnd(11)} NFL ${nfl}${ok ? '' : !Number.isFinite(value) ? '  ✗ NOT MEASURED' : value < lo ? '  ▼ LOW' : '  ▲ HIGH'}`,
  );
};
const info = (label: string, value: string, nfl: string) =>
  console.log(`  ${label.padEnd(40)} ${value.padStart(7)}   NFL ${nfl}`);
const mean = (xs: readonly number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const pct = (xs: readonly number[], q: number) => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
};
const share = (n: number, of: number) => (of ? n / of : NaN);

// ───────── measuring a staged dropback ─────────

interface Seen {
  e: PlayLogEntry;
  p: StagedPlay;
  gun: boolean;
  /** Air yards past the line (throws that have them). */
  air: number | null;
  pressured: boolean;
  /** When the ball left him (a throw), or null. */
  release: number | null;
  /** When the named rusher got within `PRESSURE_AT` (a pressured throw) or `SACK_AT` (a sack) of him. */
  rushAt: number | null;
  /** When he left the pocket, or null. */
  left: number | null;
  /** The deepest he set before the throw (or the sack, the scramble), in yards behind the ball. */
  setDepth: number;
  /** The nearest defender to the target as the ball gets there (a throw to a receiver). */
  separation: number | null;
  /** Each wide receiver's nearest defender at the snap. */
  cushions: number[];
  /** Every dot's top speed on the play, by role, the ball carrier after the catch aside (yards a second). */
  speeds: [string, number][];
}

function measure(e: PlayLogEntry, p: StagedPlay): Seen {
  const n = p.ids.length;
  const qb = p.roles.findIndex((r, k) => r === 'QB' && p.offense[k]);
  const at = (k: number, step: number) => ({ x: p.pos[(step * n + k) * 2], y: p.pos[(step * n + k) * 2 + 1] });
  const ball = { x: p.ball[0], y: p.ball[1] };
  const depth = (step: number) => (ball.x - at(qb, step).x) * p.dir;
  const who = actorsIn(e);
  const throws = THROWS.has(e.kind ?? '');
  const release = throws ? p.release : null;
  const until = Math.min(p.steps - 1, Math.round((release ?? (p.steps - 1) * p.dt) / p.dt));
  const rusher = who.rush === undefined ? -1 : p.ids.indexOf(who.rush);
  let rushAt: number | null = null;
  if (rusher >= 0 && (e.kind === 'sack' || throws)) {
    const near = e.kind === 'sack' ? SACK_AT : PRESSURE_AT;
    for (let st = 0; st < p.steps; st++) {
      const a = at(qb, st);
      const b = at(rusher, st);
      if (Math.hypot(a.x - b.x, a.y - b.y) < near) {
        rushAt = st * p.dt;
        break;
      }
    }
  }
  let left: number | null = null;
  let setDepth = 0;
  for (let st = 0; st <= until; st++) {
    const q = at(qb, st);
    setDepth = Math.max(setDepth, depth(st));
    if (left === null && (Math.abs(q.y - ball.y) > BOX || (q.x - ball.x) * p.dir > 0)) left = st * p.dt;
  }
  // The target at the ball's arrival, and the nearest man on the other side to him.
  let separation: number | null = null;
  const target = who.ball === undefined ? -1 : p.ids.indexOf(who.ball);
  if (throws && target >= 0 && p.arrive !== null) {
    const st = Math.min(p.steps - 1, Math.round(p.arrive / p.dt));
    const t = at(target, st);
    separation = Math.min(
      ...p.ids.map((_, k) => (p.offense[k] ? Infinity : Math.hypot(at(k, st).x - t.x, at(k, st).y - t.y))),
    );
  }
  const cushions = p.ids.flatMap((_, k) => {
    if (!p.offense[k] || p.roles[k] !== 'WR' || Math.abs(at(k, 0).y - ball.y) < 12) return [];
    const r = at(k, 0);
    return [
      Math.min(...p.ids.map((_, j) => (p.offense[j] ? Infinity : Math.hypot(at(j, 0).x - r.x, at(j, 0).y - r.y)))),
    ];
  });
  /** A man's quickest half-second on the play. */
  const top = (k: number) => {
    let best = 0;
    for (let st = half; st < p.steps; st++) {
      const a = at(k, st);
      const b = at(k, st - half);
      best = Math.max(best, Math.hypot(a.x - b.x, a.y - b.y) / (half * p.dt));
    }
    return best;
  };
  // Top speeds: each man's quickest half-second, on his feet (not the man carrying the ball after the catch, who rides
  // the engine's run).
  const half = Math.round(0.5 / p.dt);
  const speeds: [string, number][] = p.ids.flatMap((id, k) => {
    // The carrier after the catch rides the engine's run; the tackler's chase to the tackle is the open field's
    // (Pass B), reported apart.
    if (id === p.carrier && throws) return [];
    if (id === who.tackle) return [[`tackler`, top(k)]];
    return [[p.roles[k], top(k)]];
  });
  return {
    e,
    p,
    separation,
    cushions,
    speeds,
    gun: depth(0) > 3,
    air: throws && e.air !== undefined && e.from !== undefined ? (e.air - e.from) * p.dir : null,
    pressured: throws && who.rush !== undefined,
    release,
    rushAt,
    left,
    setDepth,
  };
}

// ───────── stage the games ─────────

// ───────── measuring a staged run (and every play's dead stops) ─────────

interface RunSeen {
  /** When the carrier crossed the line (s), or null. */
  tlos: number | null;
  /** Yards past the line when a defender first got within `CONTACT` of him, or null. */
  contact: number | null;
  move: string | undefined;
}
/** First contact: a defender this close to the carrier (yd). */
const CONTACT = 1.2;
const at = (p: StagedPlay, st: number, k: number) => ({
  x: p.pos[(st * p.ids.length + k) * 2],
  y: p.pos[(st * p.ids.length + k) * 2 + 1],
});

function measureRun(e: PlayLogEntry, p: StagedPlay): RunSeen {
  const c = p.carrier === null ? -1 : p.ids.indexOf(p.carrier);
  let tlos: number | null = null;
  let contact: number | null = null;
  for (let st = Math.round(p.release / p.dt); c >= 0 && st < p.steps; st++) {
    const b = at(p, st, c);
    if (tlos === null && (b.x - e.from!) * p.dir > 0) tlos = st * p.dt;
    if (contact === null)
      for (let k = 0; k < p.ids.length; k++) {
        if (p.offense[k]) continue;
        const d = at(p, st, k);
        if (Math.hypot(d.x - b.x, d.y - b.y) < CONTACT) {
          contact = (b.x - e.from!) * p.dir;
          break;
        }
      }
  }
  return { tlos, contact, move: p.move?.kind };
}

/**
 * Dead stops: a defender going from 5 yd/s to under 1.2 within 0.3 s with nobody within 2.2 yd of him, away from the
 * ball, before the whistle (a man who stops dead in the open for no reason reads as a glitch).
 */
function deadStops(p: StagedPlay): number {
  const n = p.ids.length;
  const v = (st: number, k: number) => {
    const a = at(p, st - 1, k);
    const b = at(p, st, k);
    return Math.hypot(b.x - a.x, b.y - a.y) / p.dt;
  };
  const window = Math.round(0.3 / p.dt);
  const whistle = p.steps - 1 - window;
  let stops = 0;
  for (let k = 0; k < n; k++) {
    if (p.offense[k]) continue;
    for (let st = 1; st < whistle; st++) {
      if (v(st, k) < 5) continue;
      let stopped = -1;
      for (let s2 = st + 1; s2 <= Math.min(whistle, st + window); s2++)
        if (v(s2, k) < 1.2) {
          stopped = s2;
          break;
        }
      if (stopped < 0) continue;
      const me = at(p, stopped, k);
      const ball = { x: p.ball[stopped * 3], y: p.ball[stopped * 3 + 1] };
      const alone = p.ids.every(
        (_, j) => j === k || Math.hypot(at(p, stopped, j).x - me.x, at(p, stopped, j).y - me.y) > 2.2,
      );
      if (alone && Math.hypot(ball.x - me.x, ball.y - me.y) > 3) {
        stops++;
        break;
      }
    }
  }
  return stops;
}

const league = createLeague({ seed: 'film' });
const seen: Seen[] = [];
const runs: RunSeen[] = [];
let plays = 0;
let stops = 0;
let passPlays = 0;
let passStops = 0;
const started = Date.now();
for (let i = 0; i < GAMES; i++) {
  const g = league.games[i % league.games.length];
  const r = simulateGame(league, g, { keepPlays: true, seed: `film-${i}` });
  let lastY = 26.65;
  r.plays!.forEach((raw, index) => {
    const e = asRan(raw);
    const snapY = snapYFor(raw, lastY);
    if (raw.down > 0 && DROPBACKS.has(e.kind ?? '')) {
      const p = stagePlay({
        plays: r.plays!,
        index,
        record: r.field!,
        homeId: g.homeId,
        seed: `film:${i}:${index}`,
        snapY,
      });
      seen.push(measure(e, p));
      passPlays++;
      passStops += deadStops(p);
      lastY = p.ball[(p.steps - 1) * 3 + 1];
    } else if (raw.kind) {
      if (raw.down > 0 && e.kind === 'run' && e.from !== undefined) {
        const p = stagePlay({
          plays: r.plays!,
          index,
          record: r.field!,
          homeId: g.homeId,
          seed: `film:${i}:${index}`,
          snapY,
        });
        const role = p.carrier === null ? undefined : p.roles[p.ids.indexOf(p.carrier)];
        // Handed off: a back or a receiver carries it.
        if (role === 'RB' || role === 'WR' || role === 'TE') runs.push(measureRun(e, p));
        plays++;
        stops += deadStops(p);
      }
      lastY = 26.65;
    }
  });
}
const secs = (Date.now() - started) / 1000;

// ───────── the quarterback (§6) ─────────

const thrown = seen.filter((s) => s.release !== null);
const tt = (xs: readonly Seen[]) => mean(xs.map((s) => s.release!));
console.log(`All-22 film: ${GAMES} games, ${seen.length} dropbacks staged, ${secs.toFixed(0)}s\n\nThe quarterback`);
check('time to throw (s)', tt(thrown), [2.45, 2.95], '2.82 (NGS 2024); 2.63 a play');
check(
  'under center minus shotgun (s)',
  tt(thrown.filter((s) => !s.gun)) - tt(thrown.filter((s) => s.gun)),
  [0.25, 1],
  '3.05 − 2.55',
);
check(
  'pressured minus clean (s)',
  tt(thrown.filter((s) => s.pressured)) - tt(thrown.filter((s) => !s.pressured)),
  [0.5, 1.5],
  '3.27 − 2.42',
);
const AIR: readonly [string, number, number, number][] = [
  ['behind the line', -Infinity, 0, 2.19],
  ['0–4 air yards', 0, 5, 2.62],
  ['5–9 air yards', 5, 10, 2.58],
  ['10–19 air yards', 10, 20, 3.12],
  ['20+ air yards', 20, Infinity, 3.37],
];
for (const [label, lo, hi, nfl] of AIR) {
  const xs = thrown.filter((s) => s.air !== null && s.air >= lo && s.air < hi);
  check(`  time to throw, ${label} (s)`, tt(xs), [nfl - 0.35, nfl + 0.35], `${nfl} (2022)`);
}
const pressured = thrown.filter((s) => s.pressured);
check(
  'time to pressure (s)',
  mean(pressured.filter((s) => s.rushAt !== null).map((s) => s.rushAt!)),
  [2.4, 3.3],
  '2.9 (NGS 2023)',
);
check(
  'pressured throws the rush reaches (share)',
  share(pressured.filter((s) => s.rushAt !== null).length, pressured.length),
  [0.8, 1],
  'every one',
  2,
);
const sacks = seen.filter((s) => s.e.kind === 'sack' && s.rushAt !== null).map((s) => s.rushAt!);
check('time to sack, mean (s)', mean(sacks), [3.0, 3.7], '3.35 (2023–25)');
check('time to sack, 10th percentile (s)', pct(sacks, 0.1), [1.5, 2.4], '2.1');
check('time to sack, 90th percentile (s)', pct(sacks, 0.9), [4.5, 6.5], '5.3');
const openless = seen.filter((s) => s.e.kind === 'scramble' && actorsIn(s.e).rush === undefined && s.left !== null);
check(
  'a scramble with nothing open leaves at (s)',
  mean(openless.map((s) => s.left!)),
  [3.5, 5.0],
  'about 4.4 (2023–25)',
);
check(
  'dropbacks leaving the pocket (share)',
  share(seen.filter((s) => s.left !== null).length, seen.length),
  [0.14, 0.24],
  '17–21% (FTN 2023–25)',
);
const early = seen.filter((s) => s.e.down <= 2);
const pa = (xs: readonly Seen[]) => share(xs.filter((s) => s.p.pocket?.playAction).length, xs.length);
check('play action (share of dropbacks)', pa(seen), [0.17, 0.27], '22% (FTN 2023–25)');
check('  on first and second down', pa(early), [0.24, 0.35], '30%');
const SET: Record<Drop, readonly [number, number]> = { 1: [1.5, 6], 3: [4, 6.5], 5: [6.5, 8.5], 7: [8.5, 11] };
const AIR_BY_DROP: Record<Drop, readonly [number, number]> = {
  1: [3.2, 4.9],
  3: [8.3, 9.4],
  5: [11.5, 12.3],
  7: [13.3, 15.1],
};
for (const drop of [1, 3, 5, 7] as const) {
  const xs = thrown.filter((s) => s.p.pocket?.drop === drop);
  check(
    `  ${drop}-step drop: set depth (yd)`,
    mean(xs.map((s) => s.setDepth)),
    SET[drop],
    `${SET[drop][0]}–${SET[drop][1]} (PFF)`,
  );
  for (const gun of [false, true]) {
    const nfl = AIR_BY_DROP[drop][gun ? 1 : 0];
    const air = xs.filter((s) => s.gun === gun && s.air !== null).map((s) => s.air!);
    check(
      `  ${drop}-step drop: air yards, ${gun ? 'shotgun' : 'under center'}`,
      mean(air),
      [nfl - 2.5, nfl + 2.5],
      `${nfl} (2018–19)`,
    );
  }
}

// ───────── receivers and coverage (§6) ─────────

console.log('\nReceivers and coverage');
const sepOf = (kind: string) =>
  thrown.filter((s) => s.e.kind === kind && s.separation !== null).map((s) => s.separation!);
const allSep = thrown.filter((s) => s.separation !== null && s.e.kind !== 'int').map((s) => s.separation!);
check('separation at the target (yd)', mean(allSep), [2.6, 3.6], '3.10 (NGS 2024)');
check('  catches minus misses (yd)', mean(sepOf('pass')) - mean(sepOf('incomplete')), [0.5, 3], 'catches wider');
check('  picks (yd)', mean(sepOf('int')), [0, 1], 'on him');
check('cushion at the snap (yd)', mean(seen.flatMap((s) => s.cushions)), [5, 7], '6.1 (NGS 2024)');
const BY_ROUTE: readonly [RouteId, number, number][] = [
  ['screen', -2.8, 3],
  ['slant', 6.1, 3],
  ['curl', 7.4, 3],
  ['out', 7.3, 3],
  ['dig', 10.6, 3],
  ['post', 21, 5],
  ['corner', 21.3, 5],
  ['go', 23.4, 5],
];
const onRoute = (r: RouteId) => thrown.filter((s) => s.p.pattern?.route === r && s.air !== null);
for (const [r, nfl, within] of BY_ROUTE)
  check(`  air yards, ${r}`, mean(onRoute(r).map((s) => s.air!)), [nfl - within, nfl + within], `${nfl} (2022)`, 1);
const ttRoute = (r: RouteId) => tt(onRoute(r));
const order = [
  ttRoute('screen'),
  ttRoute('slant'),
  Math.max(ttRoute('curl'), ttRoute('out')),
  Math.min(ttRoute('dig'), ttRoute('post'), ttRoute('corner')),
];
check(
  'time to throw rises screen < slant < curl, out < dig, post, corner',
  order.every((x, i) => i === 0 || x > order[i - 1]) ? 1 : 0,
  [1, 1],
  'screen 1.91, slant 2.14, curl 2.68, dig 3.12',
  0,
);
const concepts = new Map<string, number>();
for (const s of thrown)
  if (s.p.pattern) concepts.set(s.p.pattern.concept, (concepts.get(s.p.pattern.concept) ?? 0) + 1);
info(
  'concepts',
  [...concepts]
    .sort((a, b) => b[1] - a[1])
    .map(([c, n]) => `${c} ${Math.round((100 * n) / thrown.length)}%`)
    .join(', '),
  'ours',
);

console.log('\nSpeed');
const tops = new Map<string, number[]>();
for (const s of seen) for (const [role, v] of s.speeds) tops.set(role, [...(tops.get(role) ?? []), v]);
for (const role of ['WR', 'CB', 'S', 'RB', 'LB', 'TE', 'QB', 'EDGE', 'DT', 'OL'])
  check(
    `  ${role}: top speed, 99th percentile (yd/s)`,
    pct(tops.get(role) ?? [], 0.99),
    [0, Math.min(10.5, SPEED[role as Role] + 1)],
    `${SPEED[role as Role]} (steer)`,
  );
info(
  'the tackler, his run to the tackle (99th pct)',
  pct(tops.get('tackler') ?? [], 0.99).toFixed(2),
  'the open field: Pass B',
);

// ───────── the run game (Pass B) ─────────

console.log(`\nThe run game (${runs.length} handed-off runs)`);
check(
  "a back's time to the line (s)",
  mean(runs.flatMap((r) => (r.tlos === null ? [] : [r.tlos]))),
  [2.5, 3.1],
  '2.78 (NGS RBs 2022–24)',
);
check(
  'yards before first contact a run',
  mean(runs.flatMap((r) => (r.contact === null ? [] : [r.contact]))),
  [1.3, 2.6],
  'about half the gain',
);
const caught = seen.filter((s) => s.e.kind === 'pass');
const moves = [...runs.map((r) => r.move), ...caught.map((s) => s.p.move?.kind)].filter((m): m is string => !!m);
info(
  'the move mix',
  '',
  ['juke', 'jumpCut', 'spin', 'runThrough', 'stiffArm']
    .map((k) => `${k} ${Math.round((100 * moves.filter((m) => m === k).length) / Math.max(1, moves.length))}%`)
    .join(', '),
);
info(
  'broken tackles a handed-off run',
  share(runs.filter((r) => r.move).length, runs.length).toFixed(3),
  'about 0.18 missed tackles a RB touch (SIS 2021); the engine sets it',
);
info(
  'broken tackles a catch',
  share(caught.filter((s) => s.p.move).length, caught.length).toFixed(3),
  'the engine sets it',
);
check('dead stops in the open, per 50 runs', (stops * 50) / Math.max(1, plays), [0, 1], 'none');
check('dead stops in the open, per 50 dropbacks', (passStops * 50) / Math.max(1, passPlays), [0, 1], 'none');

// ───────── reported only: the engine decides these ─────────

console.log('\nThe engine decides (reported)');
const drops = seen.length;
const rate = (f: (s: Seen) => boolean) => `${((100 * seen.filter(f).length) / drops).toFixed(1)}%`;
info(
  'pressured',
  rate((s) => s.pressured || s.e.kind === 'sack'),
  '26–31% of dropbacks',
);
info(
  'sacks',
  rate((s) => s.e.kind === 'sack'),
  '6.4–6.8%',
);
info(
  'scrambles',
  rate((s) => s.e.kind === 'scramble'),
  '4.5–5.5%',
);
info(
  'screens (thrown behind the line)',
  rate((s) => s.air !== null && s.air < 0),
  '8–10%',
);
info(
  'throwaways',
  rate((s) => /throws it away/.test(s.e.text)),
  '3.5%',
);
const rushers = (s: Seen) => 4 + s.p.blitz.length;
info(
  'four rushers',
  rate((s) => rushers(s) === 4),
  '64–69%',
);

console.log(`\n${misses} number(s) outside target range`);
process.exit(misses ? 1 : 0);
