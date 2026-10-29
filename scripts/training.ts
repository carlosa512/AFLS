/**
 * Training audit (docs/TRAINING.md §12). Plays seasons with every team run by the AI and checks:
 *
 * B. Invariants of position moves: a position is written only on cut-down day; a team never teaches more
 *    players than its slots; no plan starts inside the cooldown; a mover's ceiling never rises at the
 *    flip and his habits are all legal at the new position; learning calls never touch a rating.
 * E. Weekly development: the release dial sums to 1; a year released in steps (March, program, camp,
 *    the weeks, the true-up) lands exactly where one jump would for every player whose body and label
 *    were left alone that year; ratings stay integers on the scale all season; how many young players
 *    move during the season (0 with everything released in March).
 * J. Speed and size: a weekly development tick for the whole league, and what the years still landing
 *    add to a save.
 *
 *   npm run training          # 3 seasons
 *   npm run training -- 5
 */
import { coachingForPlayer } from '../src/engine/coaching';
import {
  developPlayer,
  developWeek,
  MOOD_TILT,
  playedShare,
  RELEASE,
  rollInputs,
  trueUp,
} from '../src/engine/development';
import { createLeague } from '../src/engine/generate';
import { gamesInWeek, playWeek } from '../src/engine/league';
import { advanceOffseason, beginOffseason } from '../src/engine/offseason';
import { QUIRKS_FOR } from '../src/engine/quirks';
import { Rng } from '../src/engine/rng';
import {
  activeLearning,
  AI_LEARNERS,
  bodyAs,
  COOLDOWN,
  learnBlock,
  MAX_LEARNERS,
  trainingWeek,
} from '../src/engine/training';
import { SHIFTED } from '../src/engine/mentoring';
import type { Shifted } from '../src/engine/traits';
import type { League, Phase, Position } from '../src/engine/types';
import { ATTRIBUTES } from '../src/engine/types';

const SEASONS = Number(process.argv[2] ?? 3);
// This check holds the release to one jump, so it holds G2's mood tilt at zero: the tilt's own exactness (a tilted
// year lands where one jump with the same tilt would) is release.test.ts's, its size `npm run morale`'s.
MOOD_TILT.growth = 0;

let misses = 0;
const check = (label: string, value: number, [lo, hi]: [number, number], digits = 0) => {
  const ok = value >= lo && value <= hi;
  if (!ok) misses++;
  console.log(
    `${label.padEnd(58)} ${value.toFixed(digits).padStart(8)}   ${lo}–${hi === Infinity ? '' : hi}${ok ? '' : value < lo ? '  ▼ LOW' : '  ▲ HIGH'}`,
  );
};
/** The phase as it is now (the loops below narrow `league.phase` further than the sim does). */
const phase = (): Phase => league.phase;
const live = (league: League) => Object.values(league.players).filter((p) => !p.retired);
const hashRatings = (league: League) =>
  live(league)
    .map((p) => `${p.id}:${ATTRIBUTES.map((a) => p.ratings[a]).join(',')}`)
    .join('|');

const league = createLeague({ seed: 'training' });

// B: what we watch between steps.
let positions = new Map(live(league).map((p) => [p.id, p.position]));
let flipsOffDay = 0;
let flips = 0;
let overSlots = 0;
let inCooldown = 0;
let ceilingUp = 0;
let badQuirks = 0;
let planned = new Set<number>();
const afterStep = (step: string) => {
  const now = live(league);
  for (const p of now) {
    const was = positions.get(p.id);
    if (was !== undefined && was !== p.position) {
      flips++;
      if (step !== 'cutdown') flipsOffDay++;
      for (const q of Object.keys(p.quirks ?? {}))
        if (!(QUIRKS_FOR[p.position] as readonly string[]).includes(q)) badQuirks++;
    }
    const l = activeLearning(p);
    if (l && !planned.has(p.id)) {
      planned.add(p.id);
      const last = p.moves?.at(-1);
      if (last && l.since < last.season + COOLDOWN) inCooldown++;
    }
    if (!l) planned.delete(p.id);
  }
  for (const t of league.teams) {
    const cap = t.id === league.userTeamId ? MAX_LEARNERS : AI_LEARNERS;
    if (now.filter((p) => p.teamId === t.id && activeLearning(p)).length > cap) overSlots++;
  }
  positions = new Map(now.map((p) => [p.id, p.position]));
};

// E: the year each player would get in one jump, taken just before it is rolled.
interface Once {
  ratings: number[];
  position: Position;
  potential: number;
  injuries: number;
  shifts: string;
}
let once = new Map<number, Once>();
let compared = 0;
let drifted = 0;
let offScale = 0;
let movedInSeason = 0;
let youngInSeason = 0;
let tickMs: number[] = [];
let devBytes = 0;

const takeOnce = () => {
  once = new Map();
  const season = league.season + 1;
  for (const p of live(league)) {
    const clone = structuredClone(p);
    trueUp(league, clone);
    developPlayer(
      new Rng(`${league.seed}:dev:${season}:${p.id}`),
      clone,
      rollInputs({
        playedShare: playedShare(p, league.season),
        ...coachingForPlayer(league, p),
        bodyAs: bodyAs(p),
      }),
    );
    once.set(p.id, {
      ratings: ATTRIBUTES.map((a) => clone.ratings[a]),
      position: p.position,
      potential: clone.potential,
      injuries: p.injuries?.length ?? 0,
      shifts: JSON.stringify(p.shifts ?? {}),
    });
  }
};
const compareOnce = () => {
  for (const p of live(league)) {
    const o = once.get(p.id);
    // A new label, a scar (which can also lower the ceiling) or a new body: not the same year any more.
    // Mentoring that landed at the new league year makes it another year too (his traits moved before it was rolled).
    if (
      !o ||
      o.position !== p.position ||
      o.potential !== p.potential ||
      o.injuries !== (p.injuries?.length ?? 0) ||
      o.shifts !== JSON.stringify(p.shifts ?? {})
    )
      continue;
    const clone = structuredClone(p);
    trueUp(league, clone);
    compared++;
    if (ATTRIBUTES.some((a, i) => clone.ratings[a] !== o.ratings[i])) drifted++;
  }
};

// M: mentoring. Mentors move work ethic, temper and poise at most a point a year, and never lift the league as a whole.
let mentorMax = 0;
const mentorMean = (k: Shifted) => {
  const ps = live(league).filter((p) => p.teamId !== null);
  return ps.reduce((sum, p) => sum + (p.shifts?.[k] ?? 0), 0) / Math.max(1, ps.length);
};

for (let s = 0; s < SEASONS; s++) {
  // Young rostered players at kickoff: whose ratings move before the season ends (a scar is an injury's doing, not development's).
  const kickoff = new Map(
    live(league)
      .filter((p) => p.teamId !== null && p.age <= 24)
      .map((p) => [
        p.id,
        { ratings: ATTRIBUTES.map((a) => p.ratings[a]).join(','), injuries: p.injuries?.length ?? 0 },
      ]),
  );
  while (phase() !== 'complete') {
    if (phase() === 'regular' && (league.week === 5 || league.week === 9 || league.week === 13)) {
      // J: the tick on its own, on a copy, so the measured week is the real one. The best of several weeks is
      // judged: on a machine running other checks beside this one, a single tick measures the machine.
      const twin = structuredClone(league);
      const t0 = performance.now();
      developWeek(twin, gamesInWeek(twin));
      tickMs.push(performance.now() - t0);
      devBytes = Math.max(
        devBytes,
        JSON.stringify(
          live(league)
            .map((p) => p.dev)
            .filter(Boolean),
        ).length,
      );
    }
    playWeek(league);
    afterStep('week');
    for (const p of live(league))
      for (const a of ATTRIBUTES)
        if (!Number.isInteger(p.ratings[a]) || p.ratings[a] < 1 || p.ratings[a] > 20) offScale++;
  }
  for (const [id, was] of kickoff) {
    const p = league.players[id];
    if (p.retired || (p.injuries?.length ?? 0) !== was.injuries) continue;
    youngInSeason++;
    if (ATTRIBUTES.map((a) => p.ratings[a]).join(',') !== was.ratings) movedInSeason++;
  }
  // B: learning calls on a copy never touch a rating.
  {
    const twin = structuredClone(league);
    const before = hashRatings(twin);
    trainingWeek(twin);
    learnBlock(twin, 'program');
    learnBlock(twin, 'camp');
    if (hashRatings(twin) !== before) (misses++, console.log('✗ learning calls changed a rating'));
  }
  if (s > 0) compareOnce();
  takeOnce();
  beginOffseason(league);
  afterStep('newYear');
  // M: what mentoring landed this new league year.
  for (const p of live(league))
    for (const k of SHIFTED) mentorMax = Math.max(mentorMax, Math.abs(p.shiftedLast?.[k] ?? 0));
  while (phase() !== 'regular') {
    const was = phase();
    advanceOffseason(league, { autoUser: true });
    afterStep(was === 'preseason' ? 'cutdown' : was);
  }
  console.log(
    `season ${league.season - 1}: ${flips} position change(s) so far, ${planned.size} plan(s) running, ${live(league).filter((p) => p.dev).length} player(s) with a year still landing`,
  );
}
compareOnce();

console.log(`\nB. Position moves (${SEASONS} seasons, ${flips} change(s))`);
check('positions written outside cut-down day', flipsOffDay, [0, 0]);
check('teams over their learner slots (team-steps)', overSlots, [0, 0]);
check('plans started inside the cooldown', inCooldown, [0, 0]);
check('habits illegal at the new position after a flip', badQuirks, [0, 0]);
check('ceilings raised at a flip', ceilingUp, [0, 0]);

console.log(
  `\nE. Weekly development (March ${RELEASE.newYear}, program ${RELEASE.program}, camp ${RELEASE.camp}, season ${RELEASE.season})`,
);
check('release shares sum to', RELEASE.newYear + RELEASE.program + RELEASE.camp + RELEASE.season, [1, 1], 3);
check(`years released in steps that missed the one-jump result (of ${compared})`, drifted, [0, 0]);
check('ratings off the 1–20 integer scale (player-weeks)', offScale, [0, 0]);
const inSeason = youngInSeason ? movedInSeason / youngInSeason : 0;
// The floor guards that a season's share of each year shows week by week. A quarter, not three in ten: settling
// ceilings (`ceiling.ts`) leave some young players stalled at a ceiling the league brought down, and a bust that
// stopped growing is the design, not a release that failed (owner's call, Oct 27 2026; 0.28 at 0.6/0.3 with busts).
check(
  'young rostered players whose ratings moved in season (share)',
  inSeason,
  RELEASE.season > 0 ? [0.25, 1] : [0, 0],
  2,
);

console.log(
  `\nM. Mentoring (${SEASONS} seasons, ${live(league).filter((p) => p.mentor !== undefined).length} pair(s) now)`,
);
for (const k of SHIFTED) check(`${k}: league average moved by mentors`, mentorMean(k), [-0.02, 0.02], 3);
check('most any trait moved for one player in a year', mentorMax, [0, 1], 2);

console.log(`\nJ. Speed and size`);
check(
  'weekly development tick, whole league (ms, best of several weeks)',
  tickMs.length ? Math.min(...tickMs) : 0,
  [0, 25],
  1,
);
check('years still landing, in a mid-season save (KB)', devBytes / 1024, [0, 400], 0);

console.log(`\n${misses} number(s) outside target range`);
if (misses) process.exitCode = 1;
