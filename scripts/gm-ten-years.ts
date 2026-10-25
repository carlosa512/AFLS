/** Paired new-world careers: the weakest franchise, identical people, independent future outcomes. */
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLeague } from '../src/engine/generate';
import { teamRatings } from '../src/engine/roster';
import { playWeek } from '../src/engine/league';
import { beginOffseason, simOffseason } from '../src/engine/offseason';
import { advanceGmHiringRound } from '../src/engine/leadership';
import { deliverMail } from '../src/engine/inbox';
import { migrateLeague } from '../src/engine/migrate';
import { gmRecord, formatRecord } from '../src/engine/records';
import { capSheet } from '../src/engine/finance/cap';
import { teamStaff } from '../src/engine/staff';
import { CHAIRS, chairHolder, teamCoaches } from '../src/engine/coaching';
import { gmLook } from '../src/ui/gm';
import { Rng } from '../src/engine/rng';
import type { League } from '../src/engine/types';
const args = process.argv.slice(2),
  value = (key: string) => args[args.indexOf(key) + 1];
const output = resolve(args.includes('--output') ? value('--output') : '/workspace/work/gm-ten-years');
mkdirSync(output, { recursive: true });
const seasons = args.includes('--seasons') ? Number(value('--seasons')) : 10;
assert.ok(Number.isInteger(seasons) && seasons >= 1 && seasons <= 20);
const portrait = (l: League) => Object.fromEntries(Object.values(l.gms).map((g) => [g.id, gmLook(g)]));
if (args.includes('--worker')) {
  const label = value('--worker');
  let l = JSON.parse(readFileSync(resolve(output, 'baseline.json'), 'utf8')) as League;
  const originalTeam = l.userTeamId,
    userId = l.userGmId;
  l.simulationSalt = label;
  l.rngState = new Rng(`${l.seed}:future:${label}`).getState();
  for (const t of l.teams) {
    t.autoInjuries = true;
    t.training = { ...t.training, coachesDecide: true };
  }
  let shapes = portrait(l),
    checks = 0,
    hadFired = false,
    hadInterim = false;
  const years = [];
  for (let i = 0; i < seasons; i++) {
    const season = l.season,
      startTeam = l.gms[userId].teamId,
      eventStart = l.leadership.events.length;
    const kickoff = { overCap: l.teams.filter((t) => capSheet(l, t.id).space < 0).length };
    while (l.phase !== 'complete') {
      playWeek(l);
      deliverMail(l);
      if (!hadFired && l.gms[userId].teamId === null) {
        writeFileSync(resolve(output, `fired-${label}.json`), JSON.stringify(l));
        hadFired = true;
      }
      if (!hadInterim && l.leadership.events.some((e) => e.date.season === season && e.kind === 'coachInterim')) {
        writeFileSync(resolve(output, `interim-${label}.json`), JSON.stringify(l));
        hadInterim = true;
      }
    }
    const summary = l.history.at(-1)!;
    for (const t of l.teams) {
      const sum = { w: 0, l: 0, t: 0 };
      for (const g of Object.values(l.gms))
        for (const s of g.career)
          if (s.season === season && s.teamId === t.id && s.record) {
            sum.w += s.record.regular.w;
            sum.l += s.record.regular.l;
            sum.t += s.record.regular.t;
          }
      assert.deepEqual(sum, summary.records[t.id]);
      checks++;
    }
    assert.equal(
      Object.values(l.gms)
        .flatMap((g) => g.career)
        .filter((s) => s.season === season && s.record?.champion).length,
      1,
    );
    const personal = gmRecord(l, l.gms[userId])
      .seasons.filter((s) => s.season === season)
      .map((s) => ({ teamId: s.teamId, team: l.teams[s.teamId].abbrev, record: s.regular, finish: s.finish }));
    beginOffseason(l);
    deliverMail(l);
    if (!hadFired && l.gms[userId].teamId === null) {
      writeFileSync(resolve(output, `fired-${label}.json`), JSON.stringify(l));
      hadFired = true;
    }
    writeFileSync(resolve(output, `review-${label}-${season}.json`), JSON.stringify(l));
    for (let r = 0; r < 3; r++) advanceGmHiringRound(l, { autoUser: true });
    deliverMail(l);
    const events = l.leadership.events.slice(eventStart);
    const row = {
      season,
      startTeam: startTeam === null ? null : l.teams[startTeam].abbrev,
      personal,
      originalTeamRecord: summary.records[originalTeam],
      endingTeam: l.gms[userId].teamId === null ? null : l.teams[l.gms[userId].teamId!].abbrev,
      fired: events.some((e) => e.kind === 'gmDismissed' && e.gmId === userId),
      gmDismissals: events.filter((e) => e.kind === 'gmDismissed').length,
      gmHires: events.filter((e) => e.kind === 'gmHired').length,
      midseasonGmDismissals: events.filter((e) => e.kind === 'gmDismissed' && e.date.phase === 'regular').length,
      interimHeadCoaches: events.filter((e) => e.kind === 'coachInterim').length,
      newDirectorGms: events.filter(
        (e) =>
          e.kind === 'gmHired' &&
          e.gmId &&
          l.gms[e.gmId].origin === 'director' &&
          l.gms[e.gmId].appointments.length === 1,
      ).length,
      champion: l.teams[summary.championId].abbrev,
      kickoff,
    };
    years.push(row);
    for (const [id, shape] of Object.entries(shapes)) assert.deepEqual(gmLook(l.gms[Number(id)]), shape);
    for (const g of Object.values(l.gms)) {
      assert.equal(gmLook(g).garment, 'blazer');
      if (g.scouting) assert.equal(g.appearanceId, `staff:${g.scouting.id}`);
    }
    shapes = portrait(l);
    l = migrateLeague(JSON.parse(JSON.stringify(l)))!;
    assert.deepEqual(portrait(l), shapes);
    for (const t of l.teams) {
      assert.notEqual(t.gmId, null);
      assert.ok(teamStaff(l, t.id).some((s) => s.role === 'director'));
    }
    console.log(JSON.stringify({ run: label, ...row }));
    if (i < seasons - 1) {
      simOffseason(l);
      for (const t of l.teams) for (const ch of CHAIRS) assert.ok(chairHolder(teamCoaches(l, t.id), ch));
    }
  }
  const career = gmRecord(l, l.gms[userId]);
  const report = {
    label,
    startingTeam: { id: originalTeam, city: l.teams[originalTeam].city, name: l.teams[originalTeam].name },
    userId,
    years,
    totalRecord: career.regular,
    recordText: formatRecord(career.regular),
    titles: career.titles,
    playoffTrips: career.playoffTrips,
    appointments: l.gms[userId].appointments,
    finalTeam: l.gms[userId].teamId === null ? null : l.teams[l.gms[userId].teamId!].abbrev,
    recordChecks: checks,
    gmCount: Object.keys(l.gms).length,
    events: l.leadership.events.map(({ privateText, ...publicEvent }) => publicEvent),
  };
  writeFileSync(resolve(output, `save-${label}.json`), JSON.stringify(l));
  writeFileSync(resolve(output, `run-${label}.json`), JSON.stringify(report, null, 2));
  process.exit(0);
}
const seed = 'afls-gm-careers-new-world-2026';
let baseline = createLeague({ seed });
const weakest = (l: League) =>
  [...l.teams].sort((a, b) => teamRatings(l, a).overall - teamRatings(l, b).overall || a.id - b.id)[0];
let chosen = weakest(baseline).id;
baseline = createLeague({ seed, userTeamId: chosen });
assert.equal(weakest(baseline).id, chosen, 'Selected franchise must be the weakest in the final starting save.');
const ranking = [...baseline.teams]
  .map((t) => ({ teamId: t.id, team: t.city + ' ' + t.name, overall: teamRatings(baseline, t).overall }))
  .sort((a, b) => a.overall - b.overall);
writeFileSync(resolve(output, 'baseline.json'), JSON.stringify(baseline));
writeFileSync(resolve(output, 'starting-ranking.json'), JSON.stringify(ranking, null, 2));
console.log(JSON.stringify({ startingTeam: ranking[0], seed, seasons }));
await Promise.all(
  ['A', 'B'].map(
    (label) =>
      new Promise<void>((resolveWorker, reject) => {
        const child = fork(
          fileURLToPath(import.meta.url),
          ['--worker', label, '--seasons', String(seasons), '--output', output],
          { stdio: 'inherit' },
        );
        child.once('error', reject);
        child.once('exit', (code) => (code === 0 ? resolveWorker() : reject(new Error(`Run ${label} exited ${code}`))));
      }),
  ),
);
writeFileSync(
  resolve(output, 'comparison.json'),
  JSON.stringify(
    {
      seed,
      seasons,
      startingRanking: ranking,
      runs: ['A', 'B'].map((label) => JSON.parse(readFileSync(resolve(output, `run-${label}.json`), 'utf8'))),
    },
    null,
    2,
  ),
);
console.log('Two parallel careers complete.');
