/**
 * Parity (spec: docs/superpowers/specs/2026-11-03-spatial-open-field-design.md §3): the same moments of possession
 * resolved by today's engine and by the spatial open field, held together at the league, the matchup and the season,
 * plus the speed budget. Every ✓/✗ line is one number against its range; any miss fails the run.
 *
 *   npm run parity
 *
 * Four leagues' moments are harvested and resolved in child processes; the season's fairness proof (your team on each
 * engine, the same leagues around it, eight salts) runs in four more.
 */
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createLeague } from '../src/engine/generate';
import { simulateGame } from '../src/engine/match/gameSim';
import { FIELD_W, snapYFor } from '../src/engine/field/ballPath';
import { asRan, stagePlay } from '../src/engine/field/stage';
import { playWeek } from '../src/engine/league';
import { STAFF_ON } from '../src/engine/staffEdge';
import { runField } from '../src/engine/field/run';
import { KNOBS } from '../src/engine/field/tuning';
import type { FieldStart } from '../src/engine/field/types';
import { Rng } from '../src/engine/rng';
import { harvest, type Totals } from './field-moments';
import {
  judge,
  judgePocket,
  missCount,
  print,
  resolve,
  resolvePocket,
  spatialYards,
  type Resolved,
  type ResolvedPocket,
} from './parity-core';

const MOMENT_WORKERS = 4;
const GAMES = 75;
const SALTS = 8;
const SEASON_WORKERS = 4;
/** Games the film check plays with the field on (out of bounds on film, 0.4.3). */
const FILM_GAMES = 40;
/** Moments a worker bumps for the spatial-only reads. */
const BUMPED = 1500;

type Bumps = Record<'carrierBurst' | 'carrierReads' | 'defenseBurst' | 'defenseReads', number>;
interface MomentsDone {
  type: 'moments';
  rows: Resolved[];
  pockets: ResolvedPocket[];
  totals: Totals;
  bumps: Bumps;
  bumpN: number;
}
interface SeasonLine {
  wins: number;
  pf: number;
  pa: number;
  ypc: number;
  ypr: number;
  kr: number;
}
interface FilmDone {
  type: 'film';
  /** Stepped out in normal play: nobody within 5 yd in the last second, of how many. */
  steppedAlone: number;
  stepped: number;
  /** Pushed out: the nearest defender within 2 yd as he crosses, of how many. */
  pushedClose: number;
  pushed: number;
}
interface SeasonDone {
  type: 'season';
  lines: { salt: number; spatial: boolean; line: SeasonLine }[];
}

/** One start with a skill raised by five for the carrier or the whole defense. */
function bumped(s: FieldStart, who: 'carrier' | 'defense', skill: 'burst' | 'reads'): FieldStart {
  return {
    ...s,
    players: s.players.map((p) =>
      (who === 'carrier' ? p.id === s.carrier : p.side === 1) ? { ...p, s: { ...p.s, [skill]: p.s[skill] + 5 } } : p,
    ),
  };
}

function momentsWorker(n: number): MomentsDone {
  const { rows, pockets, totals } = harvest(`parity:${n}`, GAMES);
  const resolved = rows.map((r, i) => resolve(r, `parity:${n}:${i}`));
  const pocketsResolved = pockets.map((p, i) => resolvePocket(p, `parity:${n}:pocket:${i}`));
  const bumps: Bumps = { carrierBurst: 0, carrierReads: 0, defenseBurst: 0, defenseReads: 0 };
  const take = rows.slice(0, BUMPED);
  for (const [i, r] of take.entries()) {
    const yards = (s: FieldStart) => {
      let y = 0;
      for (let k = 0; k < 2; k++) y += spatialYards(s, runField(s, new Rng(`bump:${n}:${i}:${k}`))).yards / 2;
      return y;
    };
    const base = yards(r.start);
    bumps.carrierBurst += yards(bumped(r.start, 'carrier', 'burst')) - base;
    bumps.carrierReads += yards(bumped(r.start, 'carrier', 'reads')) - base;
    bumps.defenseBurst += yards(bumped(r.start, 'defense', 'burst')) - base;
    bumps.defenseReads += yards(bumped(r.start, 'defense', 'reads')) - base;
  }
  return { type: 'moments', rows: resolved, pockets: pocketsResolved, totals, bumps, bumpN: take.length };
}

function seasonWorker(n: number): SeasonDone {
  // The field engine against today's on your team's season: the coaches' Sunday edge (L4) held at zero, since belief
  // would feed the field's own head start back into the season (the owner's call, 2026-11-04).
  STAFF_ON.on = false;
  const lines: SeasonDone['lines'] = [];
  for (let salt = n; salt < SALTS; salt += SEASON_WORKERS)
    for (const spatial of [false, true]) {
      const l = createLeague({ seed: 'parity:season' });
      l.simulationSalt = `p${salt}`;
      l.settings = { spatialField: spatial };
      while (l.phase === 'regular') playWeek(l);
      const me = l.userTeamId;
      const mine = l.games.filter((g) => g.result && !g.playoffRound && (g.homeId === me || g.awayId === me));
      const line: SeasonLine = { wins: 0, pf: 0, pa: 0, ypc: 0, ypr: 0, kr: 0 };
      let att = 0;
      let rushYds = 0;
      let rec = 0;
      let recYds = 0;
      let kr = 0;
      let krYds = 0;
      for (const g of mine) {
        const r = g.result!;
        const home = g.homeId === me;
        const [f, a] = home ? [r.homeScore, r.awayScore] : [r.awayScore, r.homeScore];
        line.wins += f > a ? 1 : f === a ? 0.5 : 0;
        line.pf += f / mine.length;
        line.pa += a / mine.length;
        const t = home ? r.home : r.away;
        att += t.rushAtt;
        rushYds += t.rushYds;
        rec += t.passCmp;
        recYds += t.passYds;
        for (const [id, s] of Object.entries(r.playerStats))
          if (r.playerTeams[Number(id)] === me) {
            kr += s.krAtt ?? 0;
            krYds += s.krYds ?? 0;
          }
      }
      line.ypc = rushYds / att;
      line.ypr = recYds / rec;
      line.kr = krYds / Math.max(1, kr);
      lines.push({ salt, spatial, line });
    }
  return { type: 'season', lines };
}

/**
 * Out of bounds on film (spec: docs/superpowers/specs/2026-11-04-out-of-bounds-choice-design.md §6): games with the
 * field on, every run or catch that went out read off its staged film. A man who steps out in normal play does it with
 * someone closing; a man pushed out has his man on him as he crosses.
 */
function filmWorker(): FilmDone {
  const done: FilmDone = { type: 'film', steppedAlone: 0, stepped: 0, pushedClose: 0, pushed: 0 };
  for (const seed of ['oob-a', 'oob-b']) {
    const league = createLeague({ seed });
    for (let gi = 0; gi < FILM_GAMES / 2; gi++) {
      const g = league.games[gi];
      const r = simulateGame(league, g, { keepPlays: true, field: true, seed: `oob-${gi}` });
      r.plays!.forEach((raw, i) => {
        const e = asRan(raw);
        if (raw.down <= 0 || (e.kind !== 'pass' && e.kind !== 'run') || !/out of bounds/.test(e.text)) return;
        const p = stagePlay({
          plays: r.plays!,
          index: i,
          record: r.field!,
          homeId: g.homeId,
          seed: `${g.id}:${i}`,
          snapY: snapYFor(e, 26),
        });
        if (!p.spatial || p.carrier === null) return;
        const c = p.ids.indexOf(p.carrier);
        const at = (st: number, k: number) => ({
          x: p.pos[(st * p.ids.length + k) * 2],
          y: p.pos[(st * p.ids.length + k) * 2 + 1],
        });
        let cross = p.steps - 1;
        for (let st = 0; st < p.steps; st++) {
          const y = at(st, c).y;
          if (y <= 0 || y >= FIELD_W) {
            cross = st;
            break;
          }
        }
        const nearAt = (st: number) =>
          Math.min(
            ...p.ids.map((_, k) =>
              p.offense[k] === p.offense[c]
                ? Infinity
                : Math.hypot(at(st, k).x - at(st, c).x, at(st, k).y - at(st, c).y),
            ),
          );
        if (/steps out of bounds/.test(e.text)) {
          if (e.field?.out || e.field?.stay) return;
          done.stepped++;
          let near = Infinity;
          for (let st = Math.max(0, cross - Math.round(1 / p.dt)); st <= cross; st++) near = Math.min(near, nearAt(st));
          if (near >= 5) done.steppedAlone++;
        } else {
          done.pushed++;
          if (nearAt(cross) < 2) done.pushedClose++;
        }
      });
    }
  }
  return done;
}

const role = process.argv[2];
// A trial's knobs without editing tuning.ts: `FIELD_KNOBS='{"shed":1}' npm run parity` (workers read it too).
if (process.env.FIELD_KNOBS) Object.assign(KNOBS, JSON.parse(process.env.FIELD_KNOBS));
if (role === 'moments' || role === 'season' || role === 'film') {
  const n = Number(process.argv[3]);
  process.send!(role === 'moments' ? momentsWorker(n) : role === 'season' ? seasonWorker(n) : filmWorker(), () =>
    process.exit(0),
  );
}

async function main() {
  const self = fileURLToPath(import.meta.url);
  const run = (args: string[]) =>
    new Promise<MomentsDone | SeasonDone | FilmDone>((done, fail) => {
      const child = fork(self, args, { execArgv: process.execArgv });
      child.on('message', (m) => done(m as MomentsDone | SeasonDone | FilmDone));
      child.on('exit', (code) => code && fail(new Error(`worker ${args.join(' ')} exited ${code}`)));
    });

  const t0 = Date.now();
  const results = await Promise.all([
    ...Array.from({ length: MOMENT_WORKERS }, (_, n) => run(['moments', String(n)])),
    ...Array.from({ length: SEASON_WORKERS }, (_, n) => run(['season', String(n)])),
    run(['film', '0']),
  ]);
  const film = results.find((r): r is FilmDone => r.type === 'film')!;
  const moments = results.filter((r): r is MomentsDone => r.type === 'moments');
  const seasons = results.filter((r): r is SeasonDone => r.type === 'season').flatMap((r) => r.lines);
  const rows = moments.flatMap((m) => m.rows);
  const totals = moments.reduce<Totals>(
    (t, m) => {
      for (const k of Object.keys(t) as (keyof Totals)[]) t[k] += m.totals[k];
      return t;
    },
    { games: 0, rushAtt: 0, rushYds: 0, rushTd: 0, rbCarries: 0, passAtt: 0, passYds: 0, passTd: 0 },
  );
  const counts = (k: Resolved['kind']) => rows.filter((r) => r.kind === k).length;
  console.log(
    `Parity: ${rows.length} moments from ${totals.games} games (${counts('run')} runs, ${counts('catch')} catches, ${counts('return')} returns, ${counts('turnover')} turnovers), ${moments.length ? rows[0].ms.length : 0} seeds each\n`,
  );

  console.log('── League and matchups (spatial against today, on the same moments) ──');
  for (const l of judge(rows, totals)) print(l);

  console.log(`\n── The pocket (${moments.reduce((n, m) => n + m.pockets.length, 0)} dropbacks) ──`);
  for (const l of judgePocket(moments.flatMap((m) => m.pockets))) print(l);

  console.log('\n── Spatial-only reads (+5, yards a touch, Decision 2) ──');
  const n = moments.reduce((s, m) => s + m.bumpN, 0);
  for (const [key, label] of [
    ['carrierBurst', "carriers' agility"],
    ['carrierReads', "carriers' awareness"],
    ['defenseBurst', "defenders' agility"],
    ['defenseReads', "defenders' awareness"],
  ] as const) {
    const moved = moments.reduce((s, m) => s + m.bumps[key], 0) / n;
    print({
      label: `${label} moves yards a touch by`,
      value: Math.abs(moved),
      range: [0, 0.3],
      note: `${moved >= 0 ? '+' : ''}${moved.toFixed(3)}`,
    });
  }

  console.log('\n── Season: your team on each engine, everything else the same (8 salts) ──');
  for (const key of ['wins', 'pf', 'pa', 'ypc', 'ypr', 'kr'] as const) {
    const off = seasons.filter((s) => !s.spatial).map((s) => s.line[key]);
    const on = seasons.filter((s) => s.spatial).map((s) => s.line[key]);
    const m = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    const v = (xs: number[]) => xs.reduce((a, b) => a + (b - m(xs)) ** 2, 0) / Math.max(1, xs.length - 1);
    const se = Math.sqrt(v(off) / off.length + v(on) / on.length);
    const d = m(on) - m(off);
    print({
      label: `${{ wins: 'wins', pf: 'points for a game', pa: 'points against a game', ypc: 'yards a carry', ypr: 'yards a catch', kr: 'kick return average' }[key]}: spatial − today`,
      value: d,
      range: [-2.5 * se, 2.5 * se],
      note: `today ${m(off).toFixed(2)}, spatial ${m(on).toFixed(2)}`,
    });
  }

  console.log(`\n── Out of bounds on film (${FILM_GAMES} games, the field on) ──`);
  print({
    label: 'stepped out in normal play with nobody within 5 yd',
    value: film.steppedAlone / Math.max(1, film.stepped),
    range: [0, 0.03],
    note: `${film.steppedAlone} of ${film.stepped}`,
  });
  print({
    label: 'pushed out with a defender within 2 yd as he crosses',
    value: film.pushedClose / Math.max(1, film.pushed),
    range: [0.8, 1],
    note: `${film.pushedClose} of ${film.pushed}`,
  });

  console.log('\n── Speed ──');
  const ms = rows.flatMap((r) => r.ms).sort((a, b) => a - b);
  print({
    label: 'the open field, median ms a play',
    value: ms[ms.length >> 1],
    range: [0, 5],
    note: `p90 ${ms[Math.floor(ms.length * 0.9)].toFixed(2)} ms`,
  });

  console.log(`\n${missCount()} number(s) outside target range (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
  process.exit(missCount() ? 1 : 0);
}

if (role !== 'moments' && role !== 'season' && role !== 'film') await main();
