/** Matched experiments, not a pass/fail calibration target. Existing audits keep their ranges. */
import {
  activeCoachQuirks,
  COACH_QUIRK_IDS,
  COACH_QUIRKS,
  coachPlayerFit,
  coachQuirksOffseason,
} from '../src/engine/coachQuirks';
import { coachOrder } from '../src/engine/coachDecisions';
import { positionCoachFor } from '../src/engine/coachQuirks';
import { coachValue, teamCoaches } from '../src/engine/coaching';
import { createLeague } from '../src/engine/generate';
import { simulateGame } from '../src/engine/match/gameSim';
import { slotOvr } from '../src/engine/familiarity';
import { teamPlayers } from '../src/engine/roster';
import { POSITIONS } from '../src/engine/types';

const population = process.argv.includes('--population');
const n = Number(process.argv.slice(2).find((arg) => /^\d+$/.test(arg)) ?? (population ? 20 : 100));
if (!Number.isInteger(n) || n <= 0) throw new Error('Supply a positive integer game count.');
if (population) {
  let total = 0,
    active = 0,
    established = 0,
    forming = 0,
    minQuality = Infinity;
  const perLeague: number[] = [];
  const byQuality: Record<string, { coaches: number; active: number }> = {};
  for (let i = 0; i < n; i++) {
    const world = createLeague({ seed: `coach-rarity-${i}` });
    let held = 0;
    for (const c of Object.values(world.coaches).filter((c) => c.teamId !== null && c.role === 'offCoord')) {
      total++;
      const quality = coachValue(c);
      const band = quality >= 12 ? 'strong (12+)' : quality >= 9.5 ? 'typical (9.5-12)' : 'below typical (<9.5)';
      const bucket = (byQuality[band] ??= { coaches: 0, active: 0 });
      bucket.coaches++;
      forming += Number(c.quirks?.shotPlayArchitect === 1);
      established += Number((c.quirks?.shotPlayArchitect ?? 0) >= 2);
      if (activeCoachQuirks(c).includes('shotPlayArchitect')) {
        active++;
        bucket.active++;
        held++;
        minQuality = Math.min(minQuality, coachValue(c));
      }
    }
    perLeague.push(held);
  }
  console.log(
    JSON.stringify(
      {
        leagues: n,
        offensiveCoordinators: total,
        established,
        active,
        forming,
        activePercent: (100 * active) / total,
        perLeague,
        byQuality,
        minHolderQuality: Number.isFinite(minQuality) ? minQuality : null,
      },
      null,
      2,
    ),
  );
  process.exit(0);
}
const league = createLeague({ seed: 'coach-quirks-audit' });
const generated = structuredClone(league);
for (const c of Object.values(league.coaches)) c.quirks = {};
const games = Array.from({ length: n }, (_, i) => league.games[i % league.games.length]);
const baseline = games.map((g, i) => simulateGame(league, g, { seed: `coach-paired-${i}`, keepPlays: false }));
console.log(`${n} fixed-roster matched games per game-day quirk; both teams carry that quirk alone.`);
const fgAtt = (r: ReturnType<typeof simulateGame>) =>
  Object.values(r.playerStats).reduce((sum, line) => sum + (line.fgAtt ?? 0), 0);
console.log(
  'Quirk                     opportunities uses   pts/game Δ  pass att Δ  sacks Δ  FG att Δ  changed winners',
);
for (const id of COACH_QUIRK_IDS.filter((id) => COACH_QUIRKS[id].role !== 'positionCoach')) {
  for (const c of Object.values(league.coaches)) c.quirks = c.role === COACH_QUIRKS[id].role ? { [id]: 2 } : {};
  let opportunities = 0,
    uses = 0,
    points = 0,
    attempts = 0,
    sacks = 0,
    kicks = 0,
    changed = 0;
  for (let i = 0; i < n; i++) {
    const r = simulateGame(league, games[i], { seed: `coach-paired-${i}`, keepPlays: false }),
      b = baseline[i];
    for (const report of r.coaching ?? []) {
      opportunities += report.opportunities[id] ?? 0;
      uses += report.uses[id] ?? 0;
      if ((report.uses.shotPlayArchitect ?? 0) > 2) throw new Error('Shot budget exceeded.');
    }
    points += r.homeScore + r.awayScore - b.homeScore - b.awayScore;
    attempts += r.home.passAtt + r.away.passAtt - b.home.passAtt - b.away.passAtt;
    sacks += r.home.sacked + r.away.sacked - b.home.sacked - b.away.sacked;
    kicks += fgAtt(r) - fgAtt(b);
    changed += Number(Math.sign(r.homeScore - r.awayScore) !== Math.sign(b.homeScore - b.awayScore));
  }
  console.log(
    `${COACH_QUIRKS[id].label.padEnd(26)} ${String(opportunities).padStart(6)} ${String(uses).padStart(6)} ${(points / (n * 2)).toFixed(3).padStart(11)} ${(attempts / (n * 2)).toFixed(3).padStart(11)} ${(sacks / (n * 2)).toFixed(3).padStart(8)} ${(kicks / (n * 2)).toFixed(3).padStart(9)} ${changed}/${n}`,
  );
}

let fit = 0,
  players = 0,
  lo = 0,
  hi = 0,
  reordered = 0;
for (const team of generated.teams) {
  const staff = teamCoaches(generated, team.id),
    roster = teamPlayers(generated, team.id);
  for (const p of roster) {
    const f = coachPlayerFit(positionCoachFor(staff, p.position), p);
    fit += f;
    players++;
    lo = Math.min(lo, f);
    hi = Math.max(hi, f);
  }
  for (const pos of POSITIONS) {
    const pool = roster.filter((p) => p.position === pos);
    const base = [...pool].sort((a, b) => slotOvr(b, pos) - slotOvr(a, pos));
    const order = coachOrder(pool, pos, staff);
    reordered += order.filter((p, i) => p.id !== base[i]?.id).length;
  }
}
console.log(
  `Generated-staff fit: mean ${((fit / players) * 100).toFixed(3)}%, range ${(lo * 100).toFixed(2)}% to ${(hi * 100).toFixed(2)}%; reordered depth entries ${reordered}.`,
);
const employed = Object.values(generated.coaches).filter(
  (c) => c.teamId !== null && COACH_QUIRK_IDS.some((id) => COACH_QUIRKS[id].role === c.role),
);
console.log('Synthetic annual-only persistence (no roster, result, or weekly exposure feedback):');
for (let year = 0; year <= 30; year++) {
  if (year % 10 === 0) {
    const active = employed.reduce((sum, c) => sum + activeCoachQuirks(c).length, 0);
    const ingrained = employed.reduce((sum, c) => sum + Object.values(c.quirks ?? {}).filter((g) => g === 3).length, 0);
    console.log(`  year ${year}: ${(active / employed.length).toFixed(2)} active/coach; ${ingrained} ingrained habits`);
  }
  if (year === 30) break;
  generated.season++;
  for (const c of employed) {
    coachQuirksOffseason(generated, c);
    c.age++;
  }
}
console.log(
  'Changed winners illustrate seed divergence; this experiment is not evidence of long-save balance. Use careers/offseason audits for that.',
);
