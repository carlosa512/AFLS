/** Read-only balance study of explicitly enabled personnel careers; run seeds in separate processes. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { createLeague } from '../src/engine/generate';
import { capSheet } from '../src/engine/finance/cap';
import { playWeek } from '../src/engine/league';
import { advanceOffseason, beginOffseason } from '../src/engine/offseason';
import { playerOvr, STARTERS } from '../src/engine/positions';
import { activeRoster, practiceSquad } from '../src/engine/roster';
import { perceive } from '../src/engine/scouting';
import { squadFit } from '../src/engine/personnel/eligibility';
import { squadPayroll } from '../src/engine/personnel/payroll';
import type { League } from '../src/engine/types';
import { POSITIONS } from '../src/engine/types';

const arg = (key: string, fallback: string) =>
  process.argv.includes(key) ? process.argv[process.argv.indexOf(key) + 1] : fallback;
const seed = arg('--seed', 'squad-career-a');
const seasons = Number(arg('--seasons', '10'));
const out = arg('--out', `work/squad-careers/${seed.replace(/[^a-zA-Z0-9_-]/g, '_')}.json`);
if (!Number.isInteger(seasons) || seasons < 1 || seasons > 20) throw new Error('Choose 1–20 seasons.');
const l = createLeague({ seed, personnel: true });
const initialPool = new Set(
  Object.values(l.players)
    .filter((p) => p.id > 32 * 53)
    .map((p) => p.id),
);
const initialSquad = new Set(l.teams.flatMap((t) => practiceSquad(l, t.id).map((p) => p.id)));
const everSquad = new Map<
  number,
  {
    position: string;
    experience: number;
    firstYear: number;
    firstOvr: number;
    firstPotential: number;
    peak: number;
    starterSeasons: number[];
    rosterSeasons: number[];
    startedWeeks: Record<number, number>;
  }
>();
const firstEverRoster = new Set<number>();
const firstEverStarter = new Set<number>();
const failures: { season: number; week: number; phase: string; team: string; issue: string }[] = [];
const failureKeys = new Set<string>();
const rows: Record<string, unknown>[] = [];
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const quantile = (xs: number[], q: number) => {
  const a = [...xs].sort((x, y) => x - y);
  return a.length ? a[Math.floor((a.length - 1) * q)] : 0;
};
const dist = (xs: number[]) => ({
  n: xs.length,
  mean: avg(xs),
  p50: quantile(xs, 0.5),
  p90: quantile(xs, 0.9),
  max: xs.length ? Math.max(...xs) : 0,
});
function starterIds(league: League) {
  return league.teams.flatMap((t) =>
    POSITIONS.flatMap((pos) =>
      t.depthChart[pos]
        .filter(
          (id) =>
            league.players[id]?.teamId === t.id &&
            !league.players[id].squad &&
            !league.players[id].ir &&
            !league.players[id].retired,
        )
        .slice(0, STARTERS[pos]),
    ),
  );
}
function noteSquads() {
  for (const p of Object.values(l.players)) {
    if (!p.squad || p.teamId === null || p.retired) continue;
    if (!everSquad.has(p.id))
      everSquad.set(p.id, {
        position: p.position,
        experience: p.experience,
        firstYear: l.season,
        firstOvr: playerOvr(p),
        firstPotential: p.potential,
        peak: playerOvr(p),
        starterSeasons: [],
        rosterSeasons: [],
        startedWeeks: {},
      });
  }
  for (const [id, record] of everSquad) {
    const p = l.players[id];
    if (p && !p.retired) record.peak = Math.max(record.peak, playerOvr(p));
  }
}
function observeRoles(opening = false) {
  noteSquads();
  const starters = new Set(starterIds(l));
  for (const p of Object.values(l.players)) {
    if (p.teamId === null || p.retired || p.squad) continue;
    firstEverRoster.add(p.id);
    const record = everSquad.get(p.id);
    if (record && !record.rosterSeasons.includes(l.season)) record.rosterSeasons.push(l.season);
    if (starters.has(p.id)) {
      firstEverStarter.add(p.id);
      if (record) {
        if (!record.starterSeasons.includes(l.season)) record.starterSeasons.push(l.season);
        if (!opening && l.phase === 'regular') record.startedWeeks[l.season] = (record.startedWeeks[l.season] ?? 0) + 1;
      }
    }
  }
}
function legal() {
  for (const t of l.teams) {
    const squad = practiceSquad(l, t.id);
    const sheet = capSheet(l, t.id);
    const payroll = squadPayroll(l, t.id);
    const issues = [
      ...(activeRoster(l, t.id).length > 53 ? ['over 53'] : []),
      ...(sheet.space < -0.01 ? ['over cap'] : []),
      ...(squadFit(l, squad) ? [squadFit(l, squad)!] : []),
      ...(payroll.earned < 0 || payroll.projected < 0 ? ['negative payroll'] : []),
    ];
    for (const issue of issues) {
      const key = `${l.season}:${t.id}:${issue}`;
      if (!failureKeys.has(key)) {
        failureKeys.add(key);
        failures.push({ season: l.season, week: l.week, phase: l.phase, team: t.abbrev, issue });
      }
    }
  }
}
function opening() {
  observeRoles(true);
  legal();
  const ps = l.teams.flatMap((t) => practiceSquad(l, t.id));
  const roster = l.teams.flatMap((t) => activeRoster(l, t.id));
  const starts = starterIds(l).map((id) => l.players[id]);
  const sheets = l.teams.map((t) => capSheet(l, t.id));
  const pct = (n: number, d: number) => (d ? (n / d) * 100 : 0);
  return {
    season: l.season,
    players: Object.keys(l.players).length,
    squadSize: dist(l.teams.map((t) => practiceSquad(l, t.id).length)),
    squadAbility: dist(ps.map(playerOvr)),
    squadPotential: dist(ps.map((p) => p.potential)),
    squadUpside: dist(ps.map((p) => p.potential - playerOvr(p))),
    squadScoutedCeiling: dist(ps.map((p) => perceive(l, p.teamId!, p).potMid)),
    squadAge: dist(ps.map((p) => p.age)),
    squadPositions: Object.fromEntries(POSITIONS.map((pos) => [pos, ps.filter((p) => p.position === pos).length])),
    squadRookiesPct: pct(ps.filter((p) => p.experience === 0).length, ps.length),
    squadVeteransPct: pct(ps.filter((p) => p.experience >= 4).length, ps.length),
    squadPotential14Pct: pct(ps.filter((p) => p.potential >= 14).length, ps.length),
    squadPotential16Pct: pct(ps.filter((p) => p.potential >= 16).length, ps.length),
    squadAbility12Pct: pct(ps.filter((p) => playerOvr(p) >= 12).length, ps.length),
    starterAbility: dist(starts.map(playerOvr)),
    rosterAbility: dist(roster.map(playerOvr)),
    squadAtTeamStarter: ps.filter((p) => {
      const peers = starts.filter((x) => x.teamId === p.teamId && x.position === p.position);
      return peers.length && playerOvr(p) >= Math.min(...peers.map(playerOvr));
    }).length,
    rosterSizes: dist(l.teams.map((t) => activeRoster(l, t.id).length)),
    capSpacePct: dist(sheets.map((s) => (100 * s.space) / (s.cap + s.carryover))),
    squadCapPct: dist(sheets.map((s) => (100 * (s.practiceSquad ?? 0)) / (s.cap + s.carryover))),
    initialPoolRoster: roster.filter((p) => initialPool.has(p.id)).length,
    initialPoolStarters: starts.filter((p) => initialPool.has(p.id)).length,
    formerSquadStarters: starts.filter((p) => everSquad.has(p.id)).length,
  };
}
function nextOffseason(scan: () => void) {
  beginOffseason(l);
  scan();
  for (let guard = 0; guard < 256 && l.phase !== 'regular'; guard++) {
    advanceOffseason(l, { autoUser: true });
    scan();
  }
  if (l.phase !== 'regular') throw new Error('Offseason did not settle.');
  noteSquads();
}
function save() {
  mkdirSync(dirname(out), { recursive: true });
  const cohort = [...everSquad].map(([id, r]) => ({
    ...r,
    id,
    initialPool: initialPool.has(id),
    initialSquad: initialSquad.has(id),
    retired: !!l.players[id]?.retired,
    finalOvr: l.players[id] ? playerOvr(l.players[id]) : null,
  }));
  writeFileSync(
    out,
    JSON.stringify(
      {
        seed,
        seasonsRequested: seasons,
        completed: rows.length,
        profile: l.personnel?.profile,
        limits: [
          'Temporary elevations are enabled; automatic poaching remains a later lifecycle step.',
          'Starter weeks are depth-chart snapshots, not official game starts.',
          'Personnel is enabled; user club uses the same AI during offseasons.',
        ],
        rows,
        cohort,
        initialPool: {
          n: initialPool.size,
          everRoster: [...initialPool].filter((id) => firstEverRoster.has(id)).length,
          everStarter: [...initialPool].filter((id) => firstEverStarter.has(id)).length,
        },
        failures,
      },
      null,
      2,
    ),
  );
}
for (let year = 0; year < seasons; year++) {
  const start = opening();
  const txSeen = new Set(l.transactions);
  const moves: Record<string, number> = {};
  const scanTransactions = () => {
    for (const tx of l.transactions)
      if (!txSeen.has(tx)) {
        txSeen.add(tx);
        const key = tx.kind === 'sign' && tx.text.includes('practice squad') ? 'squadSign' : tx.kind;
        moves[key] = (moves[key] ?? 0) + 1;
      }
  };
  while (l.phase !== 'complete') {
    observeRoles();
    playWeek(l);
    scanTransactions();
    legal();
  }
  observeRoles();
  // Include the complete next offseason in this year's move counts; final observation still follows ten played seasons.
  const leagueYear = l.season;
  if (year < seasons - 1) nextOffseason(scanTransactions);
  rows.push({ ...start, moves, nextOpeningSeason: l.season, finishedSeason: leagueYear });
  save();
  console.log(
    `${seed} ${leagueYear}: starter OVR ${(start.starterAbility as { mean: number }).mean.toFixed(2)}, PS OVR ${(start.squadAbility as { mean: number }).mean.toFixed(2)}, PS ceiling ${(start.squadPotential as { mean: number }).mean.toFixed(2)}, initial-pool starters ${start.initialPoolStarters}; moves ${JSON.stringify(moves)}; failures ${failures.length}`,
  );
}
console.log(`${seed}: ${rows.length} seasons completed; ${failures.length} distinct legality findings; results ${out}`);

if (failures.length) process.exitCode = 1;
