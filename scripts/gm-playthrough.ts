/** Two independent continuations of a save, with durable GM records and portrait identity checks. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { capSheet } from '../src/engine/finance/cap';
import { simToEndOfSeason } from '../src/engine/league';
import { migrateLeague } from '../src/engine/migrate';
import { simOffseason } from '../src/engine/offseason';
import { gmRecord, teamSeasonRecord } from '../src/engine/records';
import { activeRoster } from '../src/engine/roster';
import { Rng } from '../src/engine/rng';
import type { League } from '../src/engine/types';
import { gmLook, gmName } from '../src/ui/gm';

interface PlaythroughYear {
  season: number;
  regular: { w: number; l: number; t: number };
  finish: string;
  playoffs: { w: number; l: number } | null;
  title: boolean;
  headCoach: string;
  headCoachId?: number;
  champion: string;
  games: number;
  kickoff: { overCap: number; shortRosters: number };
}

const args = process.argv.slice(2);
const option = (name: string): string | undefined => {
  const at = args.indexOf(name);
  return at < 0 ? undefined : args[at + 1];
};
const output = resolve(option('--output') || 'work/gm-playthrough');
const seasons = args.includes('--seasons') ? Number(option('--seasons')) : 5;
assert.ok(Number.isInteger(seasons) && seasons > 0 && seasons <= 20, 'Choose 1–20 seasons.');
mkdirSync(output, { recursive: true });
const shape = (league: League) =>
  Object.fromEntries(
    Object.values(league.gms).map((gm) => {
      const look = gmLook(gm);
      assert.equal(look.garment, 'blazer');
      return [gm.id, { appearanceId: gm.appearanceId, head: look.head, hair: look.hair, woman: look.woman }];
    }),
  );

if (args.includes('--worker')) {
  const label = option('--worker')!;
  let league = JSON.parse(readFileSync(resolve(output, 'baseline.json'), 'utf8')) as League;
  const identity = shape(league);
  const previous = gmRecord(league);
  const before = previous.regular;
  const user = league.gms[league.userGmId];
  // Fork only future simulation streams; both worlds retain the identical roster, people and history.
  league.seed = `${league.seed}:gm-playthrough:${label}`;
  league.rngState = new Rng(`${league.seed}:future`).getState();
  for (const team of league.teams) {
    team.autoInjuries = true;
    team.training = { ...team.training, coachesDecide: true };
  }
  const years: PlaythroughYear[] = [];
  let checks = 0;
  for (let i = 0; i < seasons; i++) {
    simOffseason(league);
    assert.equal(league.phase, 'regular');
    const kickoff = {
      overCap: league.teams.filter((t) => capSheet(league, t.id).space < 0).length,
      shortRosters: league.teams.filter((t) => activeRoster(league, t.id).length < 53).length,
    };
    const coach = Object.values(league.coaches).find((c) => c.teamId === league.userTeamId && c.role === 'headCoach');
    simToEndOfSeason(league);
    const summary = league.history.at(-1)!;
    assert.equal(summary.season, league.season);
    for (const team of league.teams) {
      assert.notEqual(team.gmId, null);
      const gm = league.gms[team.gmId!];
      const service = gm.career.find((s) => s.season === league.season && s.teamId === team.id);
      assert.deepEqual(service?.record?.regular, summary.records[team.id]);
      checks++;
    }
    const season = teamSeasonRecord(summary, league.userTeamId)!;
    const entry = {
      season: summary.season,
      regular: season.regular,
      finish: season.finish,
      playoffs: season.playoffs,
      title: season.champion,
      headCoach: coach ? `${coach.firstName} ${coach.lastName}` : 'Vacant',
      headCoachId: coach?.id,
      champion: `${league.teams[summary.championId].city} ${league.teams[summary.championId].name}`,
      games: league.games.filter((g) => g.season === league.season && g.result).length,
      kickoff,
    };
    years.push(entry);
    assert.deepEqual(shape(league), identity);
    const record = gmRecord(league);
    // Exercise a genuine save/load boundary every season, not a shallow in-memory copy.
    league = migrateLeague(JSON.parse(JSON.stringify(league)))!;
    assert.deepEqual(gmRecord(league), record);
    assert.deepEqual(shape(league), identity);
    console.log(JSON.stringify({ run: label, ...entry }));
  }
  const total = gmRecord(league);
  const report = {
    label,
    seed: league.seed,
    gm: gmName(user),
    team: `${league.teams[league.userTeamId].city} ${league.teams[league.userTeamId].name}`,
    years,
    delta: { w: total.regular.w - before.w, l: total.regular.l - before.l, t: total.regular.t - before.t },
    playoffTrips: total.playoffTrips - previous.playoffTrips,
    titles: total.titles - previous.titles,
    career: total,
    gmRecordChecks: checks,
    gmIdentities: Object.keys(league.gms).length,
    appearanceChecks: Object.keys(identity).length * seasons * 2,
    contractThrough: user.appointments.at(-1)?.through,
    headCoachChanges: years.slice(1).filter((y, i) => y.headCoachId !== years[i].headCoachId).length,
  };
  writeFileSync(resolve(output, `run-${label}.json`), JSON.stringify(report, null, 2));
  writeFileSync(resolve(output, `save-${label}.json`), JSON.stringify(league));
} else {
  assert.ok(args.includes('--save'), 'Pass --save /path/to/save.json.');
  const league = migrateLeague(JSON.parse(readFileSync(resolve(option('--save')!), 'utf8'))) as League;
  assert.ok(league, 'The save cannot be migrated.');
  // The supplied save is partway through 2037. Finish it once, then test five complete subsequent seasons.
  if (league.phase !== 'complete') simToEndOfSeason(league);
  writeFileSync(resolve(output, 'baseline.json'), JSON.stringify(league));
  console.log(`Shared baseline: completed ${league.season}; running two parallel ${seasons}-season continuations.`);
  const script = fileURLToPath(import.meta.url);
  await Promise.all(
    ['A', 'B'].map(
      (label) =>
        new Promise<void>((done, reject) => {
          const child = spawn(
            process.execPath,
            [...process.execArgv, script, '--worker', label, '--output', output, '--seasons', String(seasons)],
            { stdio: 'inherit' },
          );
          child.once('error', reject);
          child.once('exit', (code) => (code === 0 ? done() : reject(new Error(`Run ${label} exited ${code}.`))));
        }),
    ),
  );
  const runs = ['A', 'B'].map((label) => JSON.parse(readFileSync(resolve(output, `run-${label}.json`), 'utf8')));
  writeFileSync(
    resolve(output, 'comparison.json'),
    JSON.stringify({ baselineSeason: league.season, seasons, runs }, null, 2),
  );
  console.log('Both continuations finished; results are in comparison.json.');
}
