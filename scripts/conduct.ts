/**
 * Conduct check (spec `docs/superpowers/specs/2026-11-23-discipline-design.md`, "Numbers and tolerance"; the NFL's
 * counts and the bands are in `docs/research/discipline.md`, "Targets for AFLS"). Plays leagues for several seasons
 * (the others in child processes) and judges, with `band.ts`:
 *
 * - ejections a league season, the fight share of them and the flagrant-hit ones (fail above 8);
 * - league suspensions a season and the share that are one game;
 * - the share of off-field trouble that comes from the bottom fifth of the trait that drives it (fail under half);
 * - a first league suspension longer than one game (never).
 *
 * It also prints, unjudged: trouble by personality, how AI head coaches answer by their discipline, the ladder, and
 * team-rules trouble on a team a season with and without a Hothead or a Coaster on the roster.
 *
 *   npm run conduct                          # 3 leagues, 8 seasons, seed conduct-check
 *   npm run conduct -- --leagues 2 --seasons 4 --seed x     # a fast probe, for steering
 */
import { fork } from 'node:child_process';
import { bandMark, bandOf } from './band';
import { traitLean, traitOf } from '../src/engine/coachTraits';
import { setConductByCoach } from '../src/engine/conduct';
import { teamCoaches } from '../src/engine/coaching';
import { createLeague } from '../src/engine/generate';
import { playWeek } from '../src/engine/league';
import { setMeetingsByCoach } from '../src/engine/meetings';
import { advanceOffseason, beginOffseason } from '../src/engine/offseason';
import { personalityOf, trueCharacter } from '../src/engine/personality';
import { activeRoster } from '../src/engine/roster';
import { temperamentOf, workEthicOf } from '../src/engine/traits';
import type { ConductKind, Phase, Player } from '../src/engine/types';

const arg = (name: string, fallback: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const SEASONS = Number(arg('seasons', '8'));
const LEAGUES = Number(arg('leagues', '3'));
const SEED = arg('seed', 'conduct-check');
/** A child league: plays the same seasons and sends its tally home. */
const WORKER = !!process.env.CONDUCT_WORKER && !!process.send;

/** What one league counted; plain numbers and maps so a child can send it. */
interface Tally {
  seasons: number;
  ejections: number;
  fights: number;
  flagrant: number;
  unsportsmanlike: number;
  /** League suspensions by what brought them. */
  byCause: Record<string, number>;
  suspensions: number;
  /** League suspensions by games. */
  byGames: Record<number, number>;
  /** League suspensions by which one in the last two league years (1, 2, 3+). */
  byRung: Record<number, Record<number, number>>;
  firstOverOne: number;
  /** Off-field trouble driven by temperament or work ethic: all of it, and the bottom fifth's part. */
  driven: number;
  drivenBottom: number;
  /** Team-rules trouble by personality: events, and player-seasons sampled. */
  byPersonality: Record<string, { events: number; players: number }>;
  /** AI head coaches' answers by discipline: strict, middling, lenient. */
  answers: Record<string, { sat: number; fine: number; letGo: number }>;
  /** Team-rules trouble by whether the roster has a Hothead or a Coaster: events and team-seasons. */
  rooms: Record<'with' | 'without', { events: number; teams: number }>;
}

const TEAM_RULES: ReadonlySet<ConductKind> = new Set([
  'curfew',
  'meeting',
  'late',
  'teamEvent',
  'spat',
  'practiceScuffle',
]);
/** Which hidden trait drives each kind of trouble (`TROUBLE` in conduct.ts); a spat or a skipped event is controversy's. */
const DRIVER: Partial<Record<ConductKind, (p: Player) => number>> = {
  curfew: workEthicOf,
  meeting: workEthicOf,
  late: workEthicOf,
  practiceScuffle: temperamentOf,
  fight: temperamentOf,
};

function playLeague(seed: string): Tally {
  const league = createLeague({ seed });
  // Nobody clicks: your head coach holds your meetings and answers your discipline, as an AI club's does.
  setMeetingsByCoach(league, true);
  setConductByCoach(league, true);
  const t: Tally = {
    seasons: SEASONS,
    ejections: 0,
    fights: 0,
    flagrant: 0,
    unsportsmanlike: 0,
    byCause: {},
    suspensions: 0,
    byGames: {},
    byRung: {},
    firstOverOne: 0,
    driven: 0,
    drivenBottom: 0,
    byPersonality: {},
    answers: {},
    rooms: { with: { events: 0, teams: 0 }, without: { events: 0, teams: 0 } },
  };
  // The bottom fifth of each trait, among the players the league starts with (the league's makeup holds still).
  const all = Object.values(league.players).filter((p) => p.teamId !== null);
  const fifth = (f: (p: Player) => number) => {
    const xs = all.map(f).sort((a, b) => a - b);
    return xs[Math.floor(xs.length * 0.2)];
  };
  const cut = new Map<(p: Player) => number, number>([
    [workEthicOf, fifth(workEthicOf)],
    [temperamentOf, fifth(temperamentOf)],
  ]);

  const gamesSeen = new Set<number>();
  const entriesSeen = new Set<string>();
  const suspendedIn = new Map<number, number[]>();
  let teamsWithHot = new Set<number>();
  const teamEvents = new Map<number, number>();

  const scanGames = () => {
    for (const g of league.games) {
      if (!g.result || gamesSeen.has(g.id)) continue;
      gamesSeen.add(g.id);
      for (const e of g.result.ejections ?? []) {
        t.ejections++;
        if (e.why === 'fight') t.fights++;
        if (e.why === 'flagrant') t.flagrant++;
        if (e.why === 'twoUnsportsmanlike') t.unsportsmanlike++;
      }
    }
  };
  const scanPlayers = () => {
    for (const p of Object.values(league.players)) {
      for (const e of p.discipline?.entries ?? []) {
        const key = `${p.id}:${e.season}:${e.week}:${e.kind}:${e.outcome}`;
        if (entriesSeen.has(key)) continue;
        entriesSeen.add(key);
        if (e.outcome === 'suspended') {
          t.suspensions++;
          t.byCause[e.kind] = (t.byCause[e.kind] ?? 0) + 1;
          const games = e.games ?? 1;
          t.byGames[games] = (t.byGames[games] ?? 0) + 1;
          const prior = (suspendedIn.get(p.id) ?? []).filter((s) => s >= e.season - 1).length;
          const rung = Math.min(prior + 1, 3);
          (t.byRung[rung] ??= {})[games] = (t.byRung[rung][games] ?? 0) + 1;
          if (prior === 0 && games > 1) t.firstOverOne++;
          suspendedIn.set(p.id, [...(suspendedIn.get(p.id) ?? []), e.season]);
        }
        const driver = DRIVER[e.kind];
        if (driver) {
          t.driven++;
          if (driver(p) <= cut.get(driver)!) t.drivenBottom++;
        }
        if (TEAM_RULES.has(e.kind)) {
          const who = personalityOf(trueCharacter(p));
          (t.byPersonality[who] ??= { events: 0, players: 0 }).events++;
          if (e.teamId !== undefined) teamEvents.set(e.teamId, (teamEvents.get(e.teamId) ?? 0) + 1);
          // An AI head coach's answer, by how strict he is.
          if (e.teamId !== undefined && e.teamId !== league.userTeamId && e.outcome !== 'leagueFine') {
            const hc = teamCoaches(league, e.teamId).find((c) => c.role === 'headCoach');
            if (hc) {
              const lean = traitLean(traitOf(hc, 'discipline'));
              const band = lean < -0.25 ? 'lenient' : lean > 0.25 ? 'strict' : 'middling';
              const a = (t.answers[band] ??= { sat: 0, fine: 0, letGo: 0 });
              if (e.outcome === 'sat' || e.outcome === 'fine' || e.outcome === 'letGo') a[e.outcome]++;
            }
          }
        }
      }
    }
  };
  /** Week 9: who is on the rosters, for personalities and for the rooms with a Hothead or a Coaster. */
  const sample = () => {
    teamsWithHot = new Set();
    for (const team of league.teams)
      for (const p of activeRoster(league, team.id)) {
        const who = personalityOf(trueCharacter(p));
        (t.byPersonality[who] ??= { events: 0, players: 0 }).players++;
        if (who === 'Hothead' || who === 'Coaster') teamsWithHot.add(team.id);
      }
  };
  const closeSeason = () => {
    for (const team of league.teams) {
      const r = t.rooms[teamsWithHot.has(team.id) ? 'with' : 'without'];
      r.teams++;
      r.events += teamEvents.get(team.id) ?? 0;
    }
    teamEvents.clear();
  };

  for (let s = 0; s < SEASONS; s++) {
    while (league.phase === 'regular' || league.phase === 'playoffs') {
      const week = league.week;
      const regular = league.phase === 'regular';
      playWeek(league);
      scanGames();
      scanPlayers();
      if (regular && week === 9) sample();
    }
    beginOffseason(league);
    scanPlayers();
    while ((league.phase as Phase) !== 'regular') {
      advanceOffseason(league, { autoUser: true });
      scanPlayers();
    }
    closeSeason();
  }
  return t;
}

if (WORKER) {
  process.send!(playLeague(process.env.CONDUCT_WORKER!));
  await new Promise(() => {});
}

const pool: Promise<Tally>[] = [];
for (let i = 2; i <= LEAGUES; i++) {
  const seed = `${SEED}-${i}`;
  pool.push(
    new Promise<Tally>((resolve, reject) => {
      const child = fork(new URL(import.meta.url).pathname, ['--seasons', String(SEASONS)], {
        env: { ...process.env, CONDUCT_WORKER: seed },
      });
      let done = false;
      child.once('message', (m) => {
        done = true;
        resolve(m as Tally);
        child.kill();
      });
      child.once('error', reject);
      child.once('exit', (code, sig) => done || reject(new Error(`conduct league ${seed} exited (${sig ?? code})`)));
    }),
  );
}
const t0 = Date.now();
const tallies = [playLeague(SEED), ...(await Promise.all(pool))];

// Pool the leagues.
const sum = (f: (t: Tally) => number) => tallies.reduce((a, t) => a + f(t), 0);
const seasons = sum((t) => t.seasons);
const nest = <T>(f: (t: Tally) => Record<string, T>, add: (a: T | undefined, b: T) => T) => {
  const out: Record<string, T> = {};
  for (const t of tallies) for (const [k, v] of Object.entries(f(t))) out[k] = add(out[k], v);
  return out;
};
const byGames: Record<string, number> = nest(
  (t) => t.byGames,
  (a, b) => (a ?? 0) + b,
);
const suspensions = sum((t) => t.suspensions);

let misses = 0;
const check = (label: string, value: number, usual: [number, number], digits = 2, normal?: [number, number]) => {
  const band = bandOf(value, usual, normal);
  if (band === 'abnormal' || band === 'none') misses++;
  const mark = band === 'usual' ? '✓' : band === 'unusual' ? '⚠' : '✗';
  console.log(
    `${mark} ${label.padEnd(58)} ${value.toFixed(digits).padStart(7)}   ${usual[0]}–${usual[1]}${bandMark(value, usual, normal)}`,
  );
};

console.log(`Conduct: ${LEAGUES} leagues, ${SEASONS} seasons each (${seasons} league seasons), seed ${SEED}\n`);
// The bands are the owner's, from the research table (docs/research/discipline.md, "Targets for AFLS").
check('Ejections a league season', sum((t) => t.ejections) / seasons, [10, 20], 1, [6, 26]);
check(
  `Fight share of ejections (n=${sum((t) => t.ejections)})`,
  sum((t) => t.fights) /
    Math.max(
      1,
      sum((t) => t.ejections),
    ),
  [0.45, 0.7],
  2,
  [0.3, 0.85],
);
check('Flagrant-hit ejections a league season', sum((t) => t.flagrant) / seasons, [1, 6], 1, [0, 8]);
check('League suspensions a season', suspensions / seasons, [3, 10], 1, [1, 14]);
check(
  `One-game share of suspensions (n=${suspensions})`,
  (byGames['1'] ?? 0) / Math.max(1, suspensions),
  [0.6, 0.95],
  2,
  [0.45, 1],
);
check(
  `Off-field trouble from the bottom fifth of its trait (n=${sum((t) => t.driven)})`,
  sum((t) => t.drivenBottom) /
    Math.max(
      1,
      sum((t) => t.driven),
    ),
  [0.5, 1],
);
check(
  'First league suspensions longer than one game',
  sum((t) => t.firstOverOne),
  [0, 0],
  0,
);

console.log(
  'Ejections by reason, a season: ' +
    `fight ${(sum((t) => t.fights) / seasons).toFixed(1)}, flagrant ${(sum((t) => t.flagrant) / seasons).toFixed(1)}, two unsportsmanlike ${(sum((t) => t.unsportsmanlike) / seasons).toFixed(1)}`,
);
console.log(
  'League suspensions by cause, a season: ' +
    Object.entries(
      nest(
        (t) => t.byCause,
        (a, b) => (a ?? 0) + b,
      ),
    )
      .map(([k, n]) => `${k} ${(n / seasons).toFixed(1)}`)
      .join(', '),
);
const pct = (a: number, b: number) => (b ? `${((100 * a) / b).toFixed(0)}%` : '-');
console.log(
  '\nSuspensions by games: ' +
    Object.entries(byGames)
      .map(([g, n]) => `${g} game${g === '1' ? '' : 's'} ${n}`)
      .join(', '),
);
console.log('The ladder (his league suspensions in the last two league years):');
const rungs = nest(
  (t) => Object.fromEntries(Object.entries(t.byRung).map(([r, g]) => [r, JSON.stringify(g)])),
  (a, b) => {
    const m: Record<string, number> = a ? JSON.parse(a) : {};
    for (const [g, n] of Object.entries(JSON.parse(b) as Record<string, number>)) m[g] = (m[g] ?? 0) + n;
    return JSON.stringify(m);
  },
);
for (const r of ['1', '2', '3']) {
  const m = rungs[r] ? (JSON.parse(rungs[r]) as Record<string, number>) : {};
  const n = Object.values(m).reduce((a, b) => a + b, 0);
  console.log(
    `  ${r === '3' ? 'third and after' : r === '1' ? 'first' : 'second'}: ${n}` +
      (n
        ? `  (${Object.entries(m)
            .map(([g, k]) => `${g} game${g === '1' ? '' : 's'} ${k}`)
            .join(', ')})`
        : ''),
  );
}

console.log('\nTrouble by personality (team-rules trouble per 100 player-seasons):');
const personalities = nest(
  (t) => t.byPersonality,
  (a, b) => ({ events: (a?.events ?? 0) + b.events, players: (a?.players ?? 0) + b.players }),
);
for (const [name, v] of Object.entries(personalities).sort(
  (a, b) => b[1].events / b[1].players - a[1].events / a[1].players,
))
  console.log(
    `  ${name.padEnd(20)} ${(((100 * v.events) / Math.max(1, v.players)) * 1).toFixed(1).padStart(6)}  (${v.events} in ${v.players})`,
  );

console.log("\nAI head coaches' answers to team-rules trouble, by discipline:");
const answers = nest(
  (t) => t.answers,
  (a, b) => ({ sat: (a?.sat ?? 0) + b.sat, fine: (a?.fine ?? 0) + b.fine, letGo: (a?.letGo ?? 0) + b.letGo }),
);
for (const band of ['strict', 'middling', 'lenient']) {
  const a = answers[band] ?? { sat: 0, fine: 0, letGo: 0 };
  const n = a.sat + a.fine + a.letGo;
  console.log(`  ${band.padEnd(9)} sit ${pct(a.sat, n)}, fine ${pct(a.fine, n)}, let go ${pct(a.letGo, n)}  (n=${n})`);
}

const rooms = {
  with: { events: sum((t) => t.rooms.with.events), teams: sum((t) => t.rooms.with.teams) },
  without: { events: sum((t) => t.rooms.without.events), teams: sum((t) => t.rooms.without.teams) },
};
console.log('\nTeam-rules trouble on a team a season:');
for (const k of ['with', 'without'] as const)
  console.log(
    `  ${k === 'with' ? 'with a Hothead or a Coaster' : 'with neither'}: ${(rooms[k].events / Math.max(1, rooms[k].teams)).toFixed(2)}  (${rooms[k].teams} team-seasons)`,
  );

console.log(`\n${misses} number(s) outside target range  (${((Date.now() - t0) / 60000).toFixed(1)} min)`);
process.exit(misses ? 1 : 0);
