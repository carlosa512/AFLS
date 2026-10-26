/** Reproducible real-app gallery states. Controlled cases are explicitly marked in the manifest. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createLeague } from '../src/engine/generate';
import { activeCoachQuirks, drawCoachMarbles, inheritCoachQuirk } from '../src/engine/coachQuirks';
import { Rng } from '../src/engine/rng';
import { teamCoaches, coachName, promoteCoach, releaseCoach, promotionProblem } from '../src/engine/coaching';
import { playWeek, recordResult, userGame } from '../src/engine/league';
import { simulateGame } from '../src/engine/match/gameSim';
import { deliverMail } from '../src/engine/inbox';
import { teamPlayers, isAvailable, placeAt, syncDepthChart } from '../src/engine/roster';
import { updateCoachAdvice } from '../src/engine/coachDecisions';
import { userCoachGameObservation } from '../src/engine/coachReports';
import { ATTRIBUTES, type League } from '../src/engine/types';

const out = resolve(process.argv[2] ?? 'work/coach-gallery');
mkdirSync(out, { recursive: true });
const manifest: Record<string, unknown>[] = [];
function save(id: string, league: League, meta: Record<string, unknown>) {
  writeFileSync(resolve(out, `${id}.json`), JSON.stringify(league));
  manifest.push({ id, seed: league.seed, season: league.season, week: league.week, ...meta });
}
const natural = createLeague({ seed: 'coach-gallery-natural-0' });
const oc = Object.values(natural.coaches).find(
  (c) => c.teamId !== null && c.role === 'offCoord' && activeCoachQuirks(c).includes('shotPlayArchitect'),
)!;
if (!oc) throw new Error('Seed no longer supplies a naturally generated shot architect.');
natural.userTeamId = oc.teamId!;
deliverMail(natural);
save('natural-coach', natural, {
  provenance: 'simulated',
  coach: coachName(oc),
  route: '#/office/coaches',
  team: natural.teams[oc.teamId!].name,
});
let highlighted = false;
for (let i = 0; i < 17; i++) {
  playWeek(natural);
  deliverMail(natural);
  if (natural.week === 4) {
    const routine = natural.inbox!.find((m) => m.id === `recap:${natural.season}:39`)!;
    if (!routine) throw new Error('Routine-play comparison no longer matches this seed.');
    save('routine-recap', natural, {
      provenance: 'simulated',
      route: `#/inbox/${encodeURIComponent(routine.id)}`,
      subject: routine.subject,
      body: routine.body,
    });
  }
  if (!highlighted) {
    const originalTeam = natural.userTeamId;
    for (const game of natural.games.filter((g) => g.week === natural.week - 1 && g.result)) {
      for (const teamId of [game.homeId, game.awayId]) {
        const perspective: League = { ...natural, userTeamId: teamId, inbox: [] };
        if (!/designed a \d+-yard/.test(userCoachGameObservation(perspective, game))) continue;
        deliverMail(perspective);
        const mail = perspective.inbox!.find((m) => m.id === `recap:${natural.season}:${game.id}`)!;
        save('natural-recap', perspective, {
          provenance: 'simulated',
          route: `#/inbox/${encodeURIComponent(mail.id)}`,
          subject: mail.subject,
          body: mail.body,
          note: 'Another club in the same seeded league, with unchanged staff and simulated results.',
        });
        highlighted = true;
        break;
      }
      if (highlighted) break;
    }
    natural.userTeamId = originalTeam;
  }
  if (highlighted && natural.week >= 4) break;
}
if (!highlighted) throw new Error('No naturally simulated shot highlight in this seed.');
const advice = createLeague({ seed: 'coach-gallery-advice-0', userTeamId: 0 });
const team = advice.teams[0],
  staff = teamCoaches(advice, 0);
for (const c of staff) if (c.role === 'positionCoach') c.quirks = {};
const wrCoach = staff.find((c) => c.room === 'WR')!;
if (!wrCoach) throw new Error('Missing WR coach');
wrCoach.quirks = { earnYourReps: 3 };
const wrs = teamPlayers(advice, 0).filter((p) => p.position === 'WR');
for (const [i, p] of wrs.entries()) {
  for (const key of ATTRIBUTES) p.ratings[key] = i < 2 ? 16 : i < 4 ? 12 : 9;
  p.quirks = {};
  p.injury = undefined;
  delete p.ir;
}
const veteran = wrs[2],
  rookie = wrs[3];
Object.assign(veteran, { age: 30, experience: 8, quirks: {} });
Object.assign(rookie, { age: 22, experience: 0, quirks: {} });
veteran.traits.workEthic = 6;
rookie.traits.workEthic = 18;
team.autoDepth = false;
team.depthChart.WR = wrs.map((p) => p.id);
updateCoachAdvice(advice, team, staff, teamPlayers(advice, 0).filter(isAvailable));
deliverMail(advice);
const offer = advice.inbox?.find((m) => m.coachNoteKey?.endsWith(':offer'));
if (!offer) throw new Error('Expected engine-generated recommendation');
save('recommendation', advice, {
  provenance: 'controlled',
  route: `#/inbox/${encodeURIComponent(offer.id)}`,
  coach: coachName(wrCoach),
  rookie: `${rookie.firstName} ${rookie.lastName}`,
  veteran: `${veteran.firstName} ${veteran.lastName}`,
  body: offer.body,
});
placeAt(advice, rookie.id, 'WR', 2);
for (let i = 0; i < 2; i++) {
  playWeek(advice);
  deliverMail(advice);
}
const followup = advice.inbox?.find((m) => m.coachNoteKey?.endsWith(':followup'));
if (!followup) throw new Error('Expected two-game engine follow-up');
save('followup', advice, {
  provenance: 'controlled',
  route: `#/inbox/${encodeURIComponent(followup.id)}`,
  body: followup.body,
});

// A reproducible stress case for the rare later revisit, separate from frequency/calibration audits.
const slump = structuredClone(advice),
  trial = slump.teams[0].coachAdvice![0],
  receiver = slump.players[rookie.id];
receiver.ratings.catching = 1;
receiver.ratings.speed = 6;
receiver.ratings.routeRunning = 16;
const selectedSeeds: string[] = [];
while (slump.week <= 7) {
  const game = userGame(slump);
  if (game && slump.week >= 4) {
    let chosen = false;
    for (let attempt = 0; attempt < 500; attempt++) {
      const seed = `gallery-slump-${slump.week}-${attempt}`;
      const result = simulateGame(slump, game, { seed, keepPlays: true });
      const line = result.playerStats[receiver.id];
      if (
        (line?.targets ?? 0) >= 4 &&
        (line?.rec ?? 0) / (line?.targets ?? 1) < 0.5 &&
        (line?.recYds ?? 0) / (line?.targets ?? 1) < 4
      ) {
        recordResult(slump, game, result);
        selectedSeeds.push(seed);
        chosen = true;
        break;
      }
    }
    if (!chosen) throw new Error('No qualifying controlled slump game in the bounded search.');
  }
  playWeek(slump);
  deliverMail(slump);
}
const revisit = slump.inbox!.find((m) => m.coachNoteKey?.endsWith(':revisit'));
if (!revisit) throw new Error('Expected the engine to file a sustained-slump revisit.');
save('slump-revisit', slump, {
  provenance: 'controlled',
  route: `#/inbox/${encodeURIComponent(revisit.id)}`,
  body: revisit.body,
  note: 'Receiving ratings lowered and deterministic match seeds selected to exercise a sustained slump. All match results and report text are engine-generated; this is not a natural-frequency sample.',
  matchSeeds: selectedSeeds,
});
receiver.ratings.catching = 20;
receiver.ratings.speed = 18;
receiver.ratings.routeRunning = 20;
playWeek(slump);
deliverMail(slump);
const quiet = slump.inbox!.find((m) => m.id === `matchup:${slump.season}:${slump.week}`);
if (quiet?.coachNoteKey === adviceKeyForRevisit()) throw new Error('Revisit repeated.');
function adviceKeyForRevisit() {
  return `coach-advice:${trial.season}:${trial.week}:${trial.coachId}:${trial.playerId}:revisit`;
}
if (quiet)
  save('quiet-after-review', slump, {
    provenance: 'controlled',
    route: `#/inbox/${encodeURIComponent(quiet.id)}`,
    body: quiet.body,
    note: 'Next simulated week after the one allowed revisit; receiving ratings restored. The original discussion stays closed.',
  });

for (const sample of [
  { id: 'dc-blitz-stop', index: 324, teamId: 20 },
  { id: 'dc-coverage-stop', index: 2, teamId: 11 },
  { id: 'dc-costly-blitz', index: 24, teamId: 13 },
]) {
  const match = createLeague({ seed: 'coach-stories-parity' }),
    game = match.games[sample.index % match.games.length];
  match.userTeamId = sample.teamId;
  const matchSeed = `story-parity-${sample.index}`;
  recordResult(match, game, simulateGame(match, game, { seed: matchSeed, keepPlays: true }));
  match.week = game.week + 1;
  deliverMail(match);
  const recap = match.inbox!.find((m) => m.id === `recap:${match.season}:${game.id}`)!;
  save(sample.id, match, {
    provenance: 'simulated',
    route: `#/inbox/${encodeURIComponent(recap.id)}`,
    body: recap.body,
    matchSeed,
    note: 'Isolated seeded match with unedited rosters and tactics; recorded through normal result/inbox functions. Other scheduled matches have not been played in this snapshot.',
  });
}

const legacy = createLeague({ seed: 'coach-gallery-legacy-0', userTeamId: 0 });
const qb = teamPlayers(legacy, 0).find((p) => p.position === 'QB')!;
const tutor = teamCoaches(legacy, 0).find((c) => c.room === 'QB')!;
qb.quirks = { gunslinger: 3 };
qb.teamId = null;
qb.contract = null;
qb.retired = true;
tutor.playerId = qb.id;
tutor.firstName = qb.firstName;
tutor.lastName = qb.lastName;
tutor.age = 38;
let found = false;
for (let i = 0; i < 100; i++) {
  tutor.quirks = { patientTeacher: 2 };
  delete tutor.quirkOrigin;
  inheritCoachQuirk(`gallery-inheritance-${i}`, tutor, qb);
  if (tutor.quirks.shotPlayArchitect === 2) {
    found = true;
    break;
  }
}
if (!found) throw new Error('Inheritance fixture failed');
syncDepthChart(legacy, legacy.teams[0]);
save('inherited-dormant', legacy, { provenance: 'controlled', coach: coachName(tutor), route: '#/office/coaches' });
legacy.phase = 'freeAgency';
legacy.teams[0].staffBudgetMult = 2;
const holder = teamCoaches(legacy, 0).find((c) => c.role === 'offCoord')!;
releaseCoach(legacy, 0, holder.id);
tutor.career = [{ season: legacy.season - 1, teamId: 0, role: 'positionCoach', room: 'QB' }];
const problem = promotionProblem(legacy, 0, tutor);
if (problem) throw new Error(`Promotion fixture: ${problem}`);
promoteCoach(legacy, 0, tutor.id);
save('inherited-active', legacy, { provenance: 'controlled', coach: coachName(tutor), route: '#/office/coaches' });
const history = structuredClone(legacy);
const changed = history.coaches[tutor.id];
for (const [i, key] of [
  'fix:shotPlayArchitect',
  'fix:shotPlayArchitect',
  'scriptedOpening',
  'scriptedOpening',
].entries()) {
  changed.quirkBag = { [key]: 1 };
  drawCoachMarbles(changed, new Rng(`gallery-history-${i}`), 1, { season: history.season, week: i + 2 });
}
history.phase = 'regular';
history.week = 6;
save('habit-history', history, {
  provenance: 'controlled',
  coach: coachName(changed),
  route: '#/office/coaches',
  note: 'Controlled dated marble draws show weakening, loss, formation and gain; not a simulated six-week career.',
});
writeFileSync(resolve(out, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log(manifest.map((m) => `${m.id}: ${m.provenance}`).join('\n'));
