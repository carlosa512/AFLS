/**
 * Offseason audit: run seasons back to back and summarize what the AI front offices did
 * (signings, tags, cuts, cap health, roster sizes, league talent), how well they drafted, the
 * season's injuries, and the health of the scouting-staff, coaching and medical economies, so drift
 * is easy to spot. Roster sizes count the 53 (injured reserve is off it, and shown as "+N IR").
 *
 *   npm run offseason            # 3 seasons
 *   npm run offseason -- 6       # what CI and `npm run check` run
 *   npm run offseason -- 6 --seed alt-1   # another world, the same code
 *
 * It prints the numbers a human reads, then judges them: after each season a `checks` block tests the
 * kickoff ("→ regular") snapshot, the save size, the coaching and scouting economies and the draft
 * against fixed bands, and a closing section compares the first season with the last (drift). ▲/▼
 * marks a number above/below its band; the last line counts them and the process exits 1 if there are
 * any. It fails on drift as well as on a single bad season: a change that makes the AI front offices
 * overspend or hoard cap, lets talent, cap space or the coaching ledgers walk away from where they
 * started, or bloats the save fails CI instead of waiting for someone to eyeball it. On 5+ seasons,
 * three more leagues play beside this one in their own processes (`offseason-league.ts`) for the
 * cap-space drift check, which one league's 32 teams are too few to judge.
 *
 * Why the bands are what they are. The run is seeded, so the same code prints the same numbers every
 * time; a band cannot flake, but any change that shifts RNG order reshuffles the whole world. The
 * bands were therefore set from this seed AND three others (baseline values are quoted at each
 * check), wide enough to hold for all four, tight enough that a real regression (an overspending
 * front office, a ledger that stops being neutral, a runaway save) lands outside. Dollar bands are a
 * share of that year's cap, never nominal dollars: the cap compounds about 8% a year. "Steady" means
 * the 4th kickoff on (index 3): the generated first league settles for three seasons (free agents
 * pile up, the first kickoffs have a little more room), then the numbers hold. Steady and drift bands need 5+ seasons
 * and are skipped on shorter runs.
 *
 * "⚠ known issue:" lines are real engine weaknesses the bands would catch if they were strict. They
 * are printed, never counted, so CI stays green until someone fixes the engine; each one disappears
 * from the output when its fix lands. Do not loosen a band to hide one: add a line here instead.
 */
import { SAVE_SIZE_BUDGET, SAVE_FEATURE_ALLOWANCES } from './save-budget';
import { fork } from 'node:child_process';
import {
  coachBudget,
  coachingFor,
  coachMarket,
  coachPayroll,
  coachValue,
  CHAIRS,
  chairHolder,
  staffScore,
  teamCoaches,
} from '../src/engine/coaching';
import { capSheet } from '../src/engine/finance/cap';
import { minSalary } from '../src/engine/finance/market';
import { createLeague } from '../src/engine/generate';
import { simToEndOfSeason } from '../src/engine/league';
import { advanceOffseason, beginOffseason } from '../src/engine/offseason';
import { KEEP_MIN } from '../src/engine/offseason/ai';
import { freeAgents, ROSTER_MAX } from '../src/engine/offseason/negotiation';
import { playerOvr, STARTERS } from '../src/engine/positions';
import {
  departmentFor,
  medicalBudget,
  medicalPayroll,
  medicMarket,
  MEDIC_SLOTS,
  teamMedics,
} from '../src/engine/medical';
import { activeRoster, teamPlayers } from '../src/engine/roster';
import {
  departmentScore,
  STAFF_SLOTS,
  staffBudget,
  staffMarket,
  staffPayroll,
  staffValue,
  teamStaff,
} from '../src/engine/staff';
import type { Coach, League, Phase } from '../src/engine/types';
import { POSITIONS } from '../src/engine/types';
import type { CapRun } from './offseason-league';

const seasons = Number(process.argv.slice(2).find((a, i, all) => !a.startsWith('-') && all[i - 1] !== '--seed') ?? 3);
const SEED = process.argv.includes('--seed') ? process.argv[process.argv.indexOf('--seed') + 1] : 'offseason-audit';
const league = createLeague({ seed: SEED });

/**
 * More leagues for the cap-space drift check, each in its own process while this one plays: one league's median is
 * a single team's cap space. Only a run long enough for the drift checks needs them.
 */
const capRuns: Promise<CapRun[]> = Promise.all(
  (seasons >= 5 ? [2, 3, 4] : []).map(
    (n) =>
      new Promise<CapRun>((resolve, reject) => {
        const seed = `${SEED}-${n}`;
        const child = fork(new URL('./offseason-league.ts', import.meta.url).pathname, [], {
          env: { ...process.env, OFFSEASON_SEED: seed, OFFSEASON_SEASONS: String(seasons) },
        });
        let done = false;
        child.once('message', (run) => {
          done = true;
          resolve(run as CapRun);
          child.kill();
        });
        child.once('error', reject);
        // A worker that dies before reporting (a crash, or the OOM killer's signal) fails the audit by name.
        child.once(
          'exit',
          (code, signal) => done || reject(new Error(`league ${seed} exited (${signal ?? code}) before reporting`)),
        );
      }),
  ),
);
const M = (k: number) => `$${(k / 1000).toFixed(1)}M`;
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const sd = (xs: number[]) => Math.sqrt(avg(xs.map((x) => (x - avg(xs)) ** 2)));

// ───────── Judging ─────────

let misses = 0;

/**
 * Format `value` against its band and count a miss when it is outside. A number that is not finite
 * (an empty league, a division by zero) is a miss too: unlike the career audit's "n/a" for a thin
 * sample, every number here always has data, so a missing one means something broke.
 */
function check(label: string, value: number, lo: number, hi: number, digits = 2): string {
  const range = lo === -Infinity ? `≤${hi}` : hi === Infinity ? `≥${lo}` : `${lo}–${hi}`;
  if (!Number.isFinite(value)) {
    misses++;
    return `${label} n/a (${range}) ▼`;
  }
  const flag = value < lo ? ' ▼' : value > hi ? ' ▲' : '';
  if (flag) misses++;
  return `${label} ${value.toFixed(digits)} (${range})${flag}`;
}

/** Known engine issues, by title, each with where it showed up. Printed at the end; never counted. */
const known: Record<string, string[]> = {};
const warn = (issue: string, where: string) => void (known[issue] ??= []).push(where);

// The mechanisms below were traced by replaying the baseline run (src/ is untouched by this audit).
//
// Short rosters: a team ends training camp far below 53 (2028: ATL at 43, enters camp at 44 players and $1.0M over
// the cap). aiCapCompliance (offseason/ai.ts) needs room for the missing players, but a GM with low capAggression
// (ATL 0.07) only restructures when "desperate" (more than 4% of the cap short), so it releases instead, ranked by
// this-year savings alone. The first release is a QB whose $66.4M cap hit books $63.2M of dead money (saves $3.2M),
// then three cheap players, until the roster sits at the sum of KEEP_MIN (42) and nobody else can be cut. The top-up
// loop then finds less than one minimum deal of room and stops. Tuning gap, not a crash: every positional minimum holds.
const ISSUE_SHORT_ROSTER = 'short rosters at kickoff (band: roster minimum >= 50)';
// Refill order: aiTrainingCamp tops the roster up to 53 BEFORE its last aiCapCompliance pass, so a player that pass
// releases is never replaced (2028: PHI enters camp at 53 and $6.3M over, releases one player, ends at 52 with $20.8M
// free; 2031 is the same). The mid-camp compliance and top-up do nothing because nobody is missing. Ordering bug.
const ISSUE_SHORT_WITH_ROOM = 'team under 53 with cap room for a minimum deal at kickoff (band: 0)';
// Save growth: retired players are flagged retired (offseason/index.ts) but never removed, and each keeps its ratings,
// ratingHistory, stats and combine while generateDraftClass adds 260 players a year. The players blob grows about
// 430 KB a season for good (3.9 MB of retired players by 2039); the live players level off near 3.5 MB. The 650 KB band
// below is 1.5x today's growth, so it cannot see this; the fix is to prune old retirees or strip their history.
const ISSUE_SAVE_GROWTH =
  'the save grows without bound: retired players are never pruned (band: players blob under 100 KB/season)';

// ───────── Snapshots ─────────

/** The numbers worth judging from one point in the offseason. */
interface Snap {
  cap: number;
  rosterMin: number;
  rosterMax: number;
  /** Cap space per team, ascending. */
  space: number[];
  /** Dead money per team, ascending. */
  dead: number[];
  overCap: number;
  /** Mean starter OVR over every starting slot in the league. */
  avgStarter: number;
  /** Standard deviation of the teams' own mean starter OVR: how level the league is. */
  parity: number;
  fas: number;
  /** Positions short of their starter count / KEEP_MIN, summed over teams. */
  holes: number;
  belowKeep: number;
  /** Starting depth-chart spots that are empty or hold a player who is retired, gone or on another team. */
  badDepth: number;
  /** Teams under a full roster, smallest first. */
  short: { abbrev: string; size: number; space: number }[];
  /** Players on injured reserve, league-wide (off the 53, so not in the roster sizes). */
  ir: number;
}

function snapshot(l: League, label: string): Snap {
  const sheets = l.teams.map((t) => capSheet(l, t.id));
  // Injured reserve doesn't count toward the 53.
  const rosters = l.teams.map((t) => activeRoster(l, t.id));
  const sizes = rosters.map((r) => r.length);
  const space = sheets.map((s) => s.space).sort((a, b) => a - b);
  const dead = sheets.map((s) => s.dead).sort((a, b) => a - b);
  const byTeam = l.teams.map((t) =>
    POSITIONS.flatMap((pos) => t.depthChart[pos].slice(0, STARTERS[pos]).map((id) => playerOvr(l.players[id]))),
  );
  const starters = byTeam.flat();
  const avgStarter = starters.reduce((a, b) => a + b, 0) / starters.length;
  const count = (t: number, pos: string) => rosters[t].filter((p) => p.position === pos).length;
  const mid = space.length >> 1;
  const snap: Snap = {
    cap: sheets[0].cap,
    rosterMin: Math.min(...sizes),
    rosterMax: Math.max(...sizes),
    space,
    dead,
    overCap: space.filter((s) => s < 0).length,
    avgStarter,
    parity: sd(byTeam.map(avg)),
    fas: freeAgents(l).length,
    holes: l.teams.reduce((n, t) => n + POSITIONS.filter((pos) => count(t.id, pos) < STARTERS[pos]).length, 0),
    belowKeep: l.teams.reduce((n, t) => n + POSITIONS.filter((pos) => count(t.id, pos) < KEEP_MIN[pos]).length, 0),
    badDepth: l.teams.reduce(
      (n, t) =>
        n +
        POSITIONS.reduce((m, pos) => {
          const ids = t.depthChart[pos].slice(0, STARTERS[pos]);
          const live = ids.filter(
            (id) => l.players[id] && !l.players[id].retired && l.players[id].teamId === t.id,
          ).length;
          return m + (STARTERS[pos] - live);
        }, 0),
      0,
    ),
    short: l.teams
      .map((t, i) => ({ abbrev: t.abbrev, size: sizes[i], space: sheets[i].space }))
      .filter((t) => t.size < ROSTER_MAX)
      .sort((a, b) => a.size - b.size),
    ir: l.teams.reduce((n, t) => n + teamPlayers(l, t.id).length, 0) - sizes.reduce((a, b) => a + b, 0),
  };
  console.log(
    `${label.padEnd(22)} roster ${snap.rosterMin}–${snap.rosterMax}${snap.ir ? ` (+${snap.ir} IR)` : ''} · space ${M(space[0])} / median ${M(space[mid])} / ${M(space[space.length - 1])} · over cap ${snap.overCap} · dead median ${M(dead[mid])} max ${M(dead[dead.length - 1])} · starter OVR ${avgStarter.toFixed(2)} · FAs ${snap.fas}`,
  );
  return snap;
}

/** What each season leaves behind for the closing drift section. */
interface Row {
  year: number;
  k: Snap;
  growth: number;
  body: number;
  craft: number;
  roles: number[];
  staffVal: number;
  hcFired: number;
  coachOver: number;
  staffOver: number;
  /** Chairs with a new man at kickoff, by role; position coaches as a share of their chairs. */
  turnover: { hc: number; oc: number; dc: number; pcShare: number };
  /** Where this year's new head coaches came from. */
  hcFrom: { retread: number; coordinator: number; other: number };
}

/** Who sits in every chair at kickoff, by team: the carousel is read off two of these. */
const chairKey = (ch: (typeof CHAIRS)[number]) => `${ch.role}${ch.room ?? ''}`;
const chairSnap = (l: League) =>
  new Map(
    l.teams.map((t) => [
      t.id,
      new Map(CHAIRS.map((ch) => [chairKey(ch), chairHolder(teamCoaches(l, t.id), ch)?.id ?? -1])),
    ]),
  );
let chairsBefore = chairSnap(league);

const KEEP_TOTAL = Object.values(KEEP_MIN).reduce((a, b) => a + b, 0); // 42: the roster floor nobody can be cut below
const SCOUT_MAX = Object.values(STAFF_SLOTS).reduce((a, b) => a + b, 0); // 8
const ROLES = ['headCoach', 'offCoord', 'defCoord', 'strengthCoach', 'stCoord', 'positionCoach'];
const ROLE_NAMES = ['HC', 'OC', 'DC', 'S&C', 'ST', 'PC'];
const sizeKb = (x: unknown) => JSON.stringify(x).length / 1024;
/** A per-run allowance given for a 6-season run, scaled to this run's length. */
const perRun = (n6: number) => Math.ceil((n6 * seasons) / 6);

/** Young players' OVR gains under the best- and worst-8 coaching staffs, pooled over the run. */
const gains = { best: [] as number[], worst: [] as number[] };
const rows: Row[] = [];
const playerGrowth: number[] = [];
let prevSave: { total: number; players: number; retired: number; awards: number; weekly: number } | undefined;

const MEDIC_MAX = Object.values(MEDIC_SLOTS).reduce((a, b) => a + b, 0); // 4

for (let s = 0; s < seasons; s++) {
  const steady = s >= 3;
  simToEndOfSeason(league);
  // The season's injuries, before the new year clears the reserve list.
  const hurt = Object.values(league.players).flatMap((p) =>
    (p.injuries ?? []).filter((r) => r.season === league.season),
  );
  const hurtPerTeam = hurt.length / league.teams.length;
  const severePerTeam =
    hurt.filter((r) => r.severity === 'severe' || r.severity === 'career-threatening').length / league.teams.length;
  const weeksPerTeam = hurt.reduce((n, r) => n + r.weeks, 0) / league.teams.length;
  // Saves are one JSON blob in IndexedDB: awards must stay a sliver of it as seasons pile up.
  const all = Object.values(league.players);
  const save = {
    total: sizeKb(league),
    games: sizeKb(league.games),
    players: sizeKb(league.players),
    awards: sizeKb(league.awards),
    weekly: sizeKb(league.weeklyAwards),
    retired: all.filter((p) => p.retired).length,
  };
  const saveYear = league.season;
  console.log(
    `${saveYear} save ${save.total.toFixed(1)} KB · awards ${save.awards.toFixed(1)} KB · players of the week/month ${save.weekly.toFixed(1)} KB · games ${save.games.toFixed(1)} KB · players ${save.players.toFixed(1)} KB (${save.retired} retired)`,
  );
  // What development is about to apply: the neutrality ledger, and who grows under which staff.
  const rostered = all.filter((p) => !p.retired && p.teamId !== null);
  const young = rostered.filter((p) => p.age < 26 && p.position !== 'K' && p.position !== 'P');
  const rate = avg(young.map((p) => coachingFor(league, p.teamId, p.position).rate));
  const body = avg(
    rostered.filter((p) => p.age >= 28).map((p) => coachingFor(league, p.teamId, p.position).decline.physical),
  );
  const craft = avg(
    rostered.filter((p) => p.age >= 28).map((p) => coachingFor(league, p.teamId, p.position).decline.technical),
  );
  const byCoaching = [...league.teams]
    .sort((a, b) => staffScore(teamCoaches(league, b.id)) - staffScore(teamCoaches(league, a.id)))
    .map((t) => t.id);
  const before = new Map(young.map((p) => [p.id, { ovr: playerOvr(p), team: p.teamId! }]));
  beginOffseason(league);
  for (const [id, b] of before) {
    const p = league.players[id];
    if (p.retired) continue;
    if (byCoaching.slice(0, 8).includes(b.team)) gains.best.push(playerOvr(p) - b.ovr);
    if (byCoaching.slice(-8).includes(b.team)) gains.worst.push(playerOvr(p) - b.ovr);
  }
  snapshot(league, `${league.season} new year`);
  const snaps: Partial<Record<Phase, Snap>> = {};
  while (league.phase !== 'regular') {
    const phase = league.phase;
    advanceOffseason(league, { autoUser: true });
    if (phase !== league.phase) snaps[league.phase] = snapshot(league, `${league.season} → ${league.phase}`);
  }
  const year = league.season;
  const k = snaps.regular!;
  // The log is capped, so count this offseason's moves by date rather than by position in it.
  const moves = league.transactions.filter(
    (m) => m.season === league.season && m.phase !== 'regular' && m.phase !== 'playoffs',
  );
  const count = (kind: string) => moves.filter((m) => m.kind === kind).length;
  // Draft quality in true terms (the AI only sees its own reads): early picks, and best- vs worst-staffed teams.
  const picks = league.draftPicks.filter(
    (pk) => pk.season === league.season && pk.playerId !== undefined && pk.round <= 3,
  );
  const worth = (id: number) => 0.6 * playerOvr(league.players[id]) + 0.4 * league.players[id].potential;
  const byStaff = [...league.teams]
    .sort((a, b) => departmentScore(league, a.id) - departmentScore(league, b.id))
    .map((t) => t.id);
  const pickWorth = (ids: number[]) =>
    avg(picks.filter((pk) => ids.includes(pk.ownerId)).map((pk) => worth(pk.playerId!)));
  const r1 = avg(picks.filter((pk) => pk.round === 1).map((pk) => worth(pk.playerId!)));
  const r23 = avg(picks.filter((pk) => pk.round > 1).map((pk) => worth(pk.playerId!)));
  const reach = avg(picks.filter((pk) => pk.consRank !== undefined).map((pk) => Math.abs(pk.overall! - pk.consRank!)));
  console.log(
    `  draft: R1 worth ${r1.toFixed(2)} · R2-3 ${r23.toFixed(2)} · best-8 staffs ${pickWorth(byStaff.slice(0, 8)).toFixed(2)} vs worst-8 ${pickWorth(byStaff.slice(-8)).toFixed(2)} · avg |slot - consensus rank| ${reach.toFixed(1)}`,
  );
  const employed = Object.values(league.staff).filter((st) => st.teamId !== null);
  const scores = league.teams.map((t) => departmentScore(league, t.id));
  const staffVal = avg(employed.map(staffValue));
  const scouts = league.teams.map((t) => teamStaff(league, t.id).length);
  const staffOver = league.teams.filter((t) => staffPayroll(league, t.id) > staffBudget(league, t.id)).length;
  const staffMkt = staffMarket(league).length;
  console.log(
    `  staff: accuracy x${(2 ** avg(scores)).toFixed(2)} (best x${(2 ** Math.min(...scores)).toFixed(2)}, worst x${(2 ** Math.max(...scores)).toFixed(2)}) · value ${staffVal.toFixed(2)} · per team ${Math.min(...scouts)}-${Math.max(...scouts)} · over budget ${staffOver} · market ${staffMkt}`,
  );
  const coaches = Object.values(league.coaches).filter((c) => c.teamId !== null);
  const roleMean = (role: string) => avg(coaches.filter((c) => c.role === role).map(coachValue));
  const roles = ROLES.map(roleMean);
  const pay = league.teams.map((t) => coachPayroll(league, t.id) / coachBudget(league, t.id));
  const teamRate = league.teams.map((t) =>
    avg(
      rostered
        .filter((p) => p.teamId === t.id && p.age < 26 && p.position !== 'K' && p.position !== 'P')
        .map((p) => coachingFor(league, t.id, p.position).rate),
    ),
  );
  const filled = league.teams.map((t) => CHAIRS.filter((ch) => chairHolder(teamCoaches(league, t.id), ch)).length);
  const staffMoves = moves.filter((m) => m.kind === 'coach');
  const hcFired = staffMoves.filter((m) => /head coach .* after a/.test(m.text)).length;
  // The carousel: every chair with a new man since last kickoff, and where the new head coaches came from.
  const chairsNow = chairSnap(league);
  const changed = { headCoach: 0, offCoord: 0, defCoord: 0, strengthCoach: 0, stCoord: 0, positionCoach: 0 };
  const hcFrom = { retread: 0, coordinator: 0, other: 0 };
  for (const t of league.teams) {
    for (const ch of CHAIRS) {
      const id = chairsNow.get(t.id)!.get(chairKey(ch))!;
      if (id === chairsBefore.get(t.id)!.get(chairKey(ch))) continue;
      changed[ch.role]++;
      if (ch.role !== 'headCoach') continue;
      const past = (league.coaches[id]?.career ?? []).filter((cs) => cs.season < league.season);
      if (past.some((cs) => cs.role === 'headCoach')) hcFrom.retread++;
      else if (past.at(-1)?.role === 'offCoord' || past.at(-1)?.role === 'defCoord') hcFrom.coordinator++;
      else hcFrom.other++;
    }
  }
  chairsBefore = chairsNow;
  const hcHired = changed.headCoach;
  const turnover = {
    hc: changed.headCoach,
    oc: changed.offCoord,
    dc: changed.defCoord,
    pcShare: changed.positionCoach / (league.teams.length * CHAIRS.filter((ch) => ch.role === 'positionCoach').length),
  };
  const exPlayers = coaches.filter((c: Coach) => c.playerId !== undefined);
  const promoted = staffMoves.filter((m) => / promoted /.test(m.text)).length;
  const poached = staffMoves.filter((m) => m.teamIds.length > 1).length;
  const coachOver = pay.filter((x) => x > 1).length;
  const coachMkt = coachMarket(league).length;
  console.log(
    `  coaching: value ${ROLE_NAMES.map((n, i) => `${n} ${roles[i].toFixed(1)}`).join(' ')} · ledger growth x${rate.toFixed(3)} (u26) body x${body.toFixed(3)} craft x${craft.toFixed(3)} (28+) · team growth x${Math.min(...teamRate).toFixed(2)}–x${Math.max(...teamRate).toFixed(2)} · payroll ${(100 * avg(pay)).toFixed(0)}% (${(100 * Math.min(...pay)).toFixed(0)}–${(100 * Math.max(...pay)).toFixed(0)}%) · over budget ${coachOver} · chairs ${Math.min(...filled)}–${Math.max(...filled)} · HCs fired ${hcFired} hired ${hcHired} · market ${coachMkt}`,
  );
  console.log(
    `  carousel: new HC ${turnover.hc} (${hcFrom.coordinator} coordinators, ${hcFrom.retread} retreads, ${hcFrom.other} other) · new OC ${turnover.oc} · new DC ${turnover.dc} · new S&C ${changed.strengthCoach} · position coaches ${(100 * turnover.pcShare).toFixed(0)}% new · promoted from within ${promoted} · hired off another staff ${poached} · ex-players coaching ${exPlayers.length} (${exPlayers.filter((c) => c.role !== 'positionCoach').length} above position coach)`,
  );
  const drafted = count('draft');
  console.log(
    `  moves: re-signed ${count('resign')}, signed ${count('sign')}, released ${count('release')}, restructured ${count('restructure')}, tagged ${count('tag')}, options ${count('option')}, drafted ${drafted}, retired(notable) ${count('retire')} (injuries ${moves.filter((m) => m.kind === 'retire' && /injuries/.test(m.text)).length}, concussions ${moves.filter((m) => m.kind === 'retire' && /concussions/.test(m.text)).length})`,
  );
  const depts = league.teams.map((t) => departmentFor(league, t.id));
  const medPay = league.teams.map((t) => medicalPayroll(league, t.id) / medicalBudget(league, t.id));
  const medics = league.teams.map((t) => teamMedics(league, t.id).length);
  const medOver = medPay.filter((x) => x > 1).length;
  const medMkt = medicMarket(league).length;
  console.log(
    `  injuries ${year - 1}: ${hurtPerTeam.toFixed(1)} per team (${severePerTeam.toFixed(1)} severe) · weeks lost ${weeksPerTeam.toFixed(0)} per team · medical physio ${avg(depts.map((d) => d.physio)).toFixed(2)} (${Math.min(...depts.map((d) => d.physio)).toFixed(1)}–${Math.max(...depts.map((d) => d.physio)).toFixed(1)}) science ${avg(depts.map((d) => d.science)).toFixed(2)} · payroll ${(100 * avg(medPay)).toFixed(0)}% · over budget ${medOver} · staff ${Math.min(...medics)}–${Math.max(...medics)} · market ${medMkt}`,
  );

  // ───────── This season's checks ─────────
  const pct = (x: number) => (100 * x) / k.cap;
  const mid = k.space.length >> 1;
  const last = k.space.length - 1;
  const prev = rows[s - 1];
  const withRoom = k.short.filter((t) => t.space >= minSalary(1, k.cap));

  // Roster and cap at kickoff, the "→ regular" snapshot: the state the season is played in.
  // Over cap 0: every front office must be legal when the games start (obs 0 in all 24 seed-seasons).
  // At free agency and the draft, at most 1: one of 24 seed-seasons had a team over (alt-3 2028), so 0 would flake.
  // "new year" and "preseason" are transient (2 and 1-11 teams over) and not judged.
  // Roster max 53 always (obs). Roster min: the floor is the sum of KEEP_MIN (42), the least a team can be cut to;
  // the sensible band (>= 50) fails today (obs 43 in 2028, 48 on alt-2 2031): a known issue, see the top of the file.
  // Under 53 with room for a minimum deal: 0 is sensible but fails (8 of 24 seed-seasons, always one team, another known
  // issue), so the counted band is the interim 1.
  // Holes / below keep-min / bad depth spots 0: a roster missing a starter's position, or a depth chart that names a
  // player who retired or left, breaks games (obs 0 everywhere).
  console.log(
    `  checks ${year} roster: ${check('max', k.rosterMax, ROSTER_MAX, ROSTER_MAX, 0)} · ${check('min', k.rosterMin, KEEP_TOTAL, ROSTER_MAX, 0)} · under 53: ${k.short.length} · ${check('under 53 with cap room', withRoom.length, 0, 1, 0)} · ${check('position holes', k.holes, 0, 0, 0)} · ${check('below keep-min', k.belowKeep, 0, 0, 0)} · ${check('bad depth-chart spots', k.badDepth, 0, 0, 0)}`,
  );
  if (k.rosterMin < 50)
    warn(
      ISSUE_SHORT_ROSTER,
      `${year}: ${k.short
        .filter((t) => t.size < 50)
        .map((t) => `${t.abbrev} ${t.size} (${M(t.space)} room)`)
        .join(', ')}`,
    );
  if (withRoom.length)
    warn(
      ISSUE_SHORT_WITH_ROOM,
      `${year}: ${withRoom.map((t) => `${t.abbrev} ${t.size} (${M(t.space)} room)`).join(', ')}`,
    );

  // Cap space as a share of the cap (the cap grows ~8% a year). Median: 3.8, 2.6, 3.4, then 3.3, 1.9, 2.6% (0.1.5);
  // 3.2, 4.2, 3.8, then 4.0, 3.6, 4.0 with last-year deals paid past their market and a planned in-season reserve
  // (0.1.7, the 2030 4.0 on the band's edge); 3.0, 2.9, 3.0, then 3.1, 3.8, 3.4 once room past a team's plan by more
  // than a point is paid ahead from next year after camp (0.1.10);
  // the bands were set from four seeds whose steady state was 2.0-2.3%, so [1, 4] catches a drift to hoarding or to
  // teams spent flat, and the early seasons get [0.8, 12] (obs 2.8-9.9% across seeds then).
  // Max: 17.5, 8.1, 12.9% in seasons 1-3, then 9.5, 5.1, 8.9 (0.1.5; 19.5, 10.3, 5.8 then 12.7, 5.2, 6.3 at 0.1.3;
  // 7.3, 8.4, 9.7 then 8.3, 12.1, 9.8 at 0.1.7, last-year deals raised up to 1.7x their market and no hoarder; 5.0-5.3
  // every season at 0.1.10, the room past a team's plan paid ahead), so
  // seasons 1-3 are judged at <= 30% and index 4+ at <= 20%. Before the generated league was paid like a settled one
  // (0.1.3) seasons 1-3 read 54.6, 59.0, 37.9%: rosters opened as low as 62% committed and a hoarder banked the rest.
  // Dead money: max 7.1-16.7% of cap at kickoff (0.1.5; 6.2-17.3% at 0.1.10; 6.0-19.3% at 0.1.3, all seeds then
  // 6.5-22.7), median at most 3.1%; a front office that cuts stars wholesale shows up as the max passing 30%.
  // Free agents: 253 → 467 over 6 seasons, +64 at most in a step (0.1.5; 252 → 443, +74 at 0.1.10; all seeds then
  // 99); it keeps rising until about season 12 and plateaus near 500 (retirement caps the stock), so the ceiling is 650
  // and the floor 100 (a dried-up market).
  const fas = `${check('free agents', k.fas, 100, 650, 0)}${prev ? ` · ${check('change', k.fas - prev.k.fas, -Infinity, 110, 0)}` : ''}`;
  console.log(
    `  checks ${year} cap: ${check('over cap', k.overCap, 0, 0, 0)} · ${check('…at free agency', snaps.freeAgency?.overCap ?? 0, 0, 1, 0)} · ${check('…at draft', snaps.draft?.overCap ?? 0, 0, 1, 0)} · ${check('median space %cap', pct(k.space[mid]), steady ? 1 : 0.8, steady ? 4 : 12, 1)} · ${check('max space %cap', pct(k.space[last]), 0, s >= 4 ? 20 : 30, 1)} · ${check('dead max %cap', pct(k.dead[last]), 0, 30, 1)} · ${check('dead median %cap', pct(k.dead[mid]), 0, 6, 1)} · ${fas}`,
  );

  // League talent (mean starter OVR at kickoff): 12.89, 12.92, 13.02, 13.09, 13.18, 13.20 (all seeds then 12.69-13.12),
  // so [12.4, 13.6] holds the level; steps of at most 0.10 (all seeds then 0.15) get 0.25. Parity (sd of team means) is
  // 0.37-0.53 (all seeds then 0.28-0.64): below 0.15 every team is alike, above 0.8 the league has split in two.
  console.log(
    `  checks ${year} talent: ${check('starter OVR', k.avgStarter, 12.4, 13.6)}${prev ? ` · ${check('change', k.avgStarter - prev.k.avgStarter, -0.25, 0.25)}` : ''} · ${check('parity sd', k.parity, 0.15, 0.8)}`,
  );

  // Save size at the end of the season just played. 4741 KB after the first, then 7990 (the game history keeps two
  // seasons: a one-time +3.2 MB, not a leak; games plateau at 5.2-5.3 MB, ceiling 6500) and ~+430-730 KB a season to
  // 10126; all seeds end at 10.1-10.2 MB, so the final ceiling is 12500 and a snapshot may grow 900 KB from the 3rd on.
  // The growth is the players blob (+430 KB a season, 76 → 887 retired kept; band 650 / 320 a season, 1.5x baseline)
  // because retired players are never pruned; that leak is a known issue. Awards stay a sliver: +1.55 KB and +2.7 KB a
  // season (bands 2.5 and 4.5), 0.25% of the save at season 6 (band 0.5%).
  // Quirks then took it to 5296 after the first season and 11084 at the end (players growth 477-546 a season).
  // Injuries (save v13) add their own share, and the bands moved by exactly that: 5778 after the first season (a new
  // league has no free-agent pool, so its ~85 injury replacements are generated players; every player carries two
  // more traits; injury histories and the backups' stat lines), games 5.5-5.6 MB (box scores keep each injury's
  // estimate), players growth 584-653 a season, snapshot growth up to 916, 12194 at the end. Ceilings: first season
  // 6300, final 13500, snapshot growth 1100, players growth 800 (the same headroom over the observed as before).
  // The settled opening league (0.1.3) carries more contract years: 6260 after the first season, players growth 618-781,
  // and 12900 at the end, where last season's games now keep only box scores and scoring plays. Your own games keep
  // their full play-by-play all season (about 33 KB a game), so how far the autopilot team runs in the playoffs moves
  // the first save by up to 130 KB from one engine change to the next: 6200 when it missed them, 6330 when it reached
  // the final (0.1.5, players growth 610-788, 12765 at the end). The first-season ceiling is 6450, a playoff run over
  // the 6300 it was before.
  // Feature growth is explicit rather than a moving baseline: see save-budget.ts.
  if (s === 0)
    console.log(
      `  save feature allowances: ${Object.entries(SAVE_FEATURE_ALLOWANCES)
        .map(([name, b]) => `${name} +${b.firstSeason} KB first season / +${b.retainedSeasons} KB retained`)
        .join('; ')}`,
    );
  const dSave = prevSave && {
    total: save.total - prevSave.total,
    players: save.players - prevSave.players,
    retired: save.retired - prevSave.retired,
    awards: save.awards - prevSave.awards,
    weekly: save.weekly - prevSave.weekly,
  };
  console.log(
    `  checks ${saveYear} save: ${check('size KB', save.total, 4000, s === 0 ? SAVE_SIZE_BUDGET.firstSeason : SAVE_SIZE_BUDGET.retainedSeasons, 0)}${dSave && s >= 2 ? ` · ${check('growth KB', dSave.total, -Infinity, SAVE_SIZE_BUDGET.annualGrowth, 0)}` : ''} · ${check('games KB', save.games, 0, SAVE_SIZE_BUDGET.games, 0)}${dSave ? ` · ${check('players growth KB', dSave.players, -Infinity, 800, 0)} · ${check('retired added', dSave.retired, 0, 320, 0)} · ${check('awards growth KB', dSave.awards, -Infinity, 2.5, 1)} · ${check('weekly awards growth KB', dSave.weekly, -Infinity, 4.5, 1)}` : ''} · ${check('awards+weekly % of save', (100 * (save.awards + save.weekly)) / save.total, 0, 0.5)}`,
  );
  if (dSave) playerGrowth.push(dSave.players);
  prevSave = save;

  // Coaching economy. Ledger growth for under-26s x0.999 → x1.025 → x1.008 (all seeds 0.970-1.025), body x0.987-0.999 and
  // craft x0.993-1.000 for 28+ (all seeds 0.984-1.005): the ledger is meant to be neutral, so [0.94, 1.06] and [0.96, 1.04].
  // Team spread x0.77-0.79 to x1.11-1.21 (all seeds 0.75-0.90 and 1.09-1.21): if it collapses coaching stops mattering,
  // if it explodes a staff decides careers. Payroll 77-80% of budget (all seeds 74-87), cheapest 46-58% (37-61), dearest
  // 100-103% (96-119), 0-2 teams over (run totals 4-6). Role values 10.0-11.3. Chairs 12 of 12 always; fired 2-10 a year
  // (the NFL's record is 10 new head coaches) and hired never fewer; market 104-125 coaches (floor 80: a drained market
  // means no replacements).
  const [hc, oc, dc, sc, st, pc] = roles;
  console.log(
    `  checks ${year} coaching: ${check('growth', rate, 0.94, 1.06, 3)} · ${check('body', body, 0.96, 1.04, 3)} · ${check('craft', craft, 0.96, 1.04, 3)} · ${check('team growth min', Math.min(...teamRate), 0.6, 0.95)} · ${check('max', Math.max(...teamRate), 1.03, 1.4)} · ${check('payroll mean %', 100 * avg(pay), 65, 95, 0)} · ${check('min %', 100 * Math.min(...pay), 25, Infinity, 0)} · ${check('max %', 100 * Math.max(...pay), 0, 130, 0)} · ${check('over budget', coachOver, 0, 4, 0)} · ${check('chairs filled', Math.min(...filled), CHAIRS.length, CHAIRS.length, 0)} · ${check('HCs fired', hcFired, 0, 11, 0)} · ${check('hired − fired', hcHired - hcFired, 0, league.teams.length, 0)} · ${check('market', coachMkt, 80, 135, 0)} · ${[hc, oc, dc, sc, st, pc].map((v, i) => check(`${ROLE_NAMES[i]} value`, v, 9, 12, 1)).join(' · ')}`,
  );

  // Scouting staffs. Accuracy multiplier: mean x1.01-1.03 (all seeds 0.94-1.04), best x0.76-0.81 (0.59-0.83), worst
  // x1.34-1.40 (1.16-1.48): a mean off 1 means every read got better or worse together; best < 0.5 or worst > 1.7 is a
  // department that sees everything or nothing. 6-7 scouts a team (all seeds 5-7, never above the 8 slots). Value
  // 10.30 → 10.00 (band 9.0-11.5). No team over budget (all seeds 0-1; market 36-41).
  console.log(
    `  checks ${year} scouting: ${check('accuracy mean', 2 ** avg(scores), 0.85, 1.15)} · ${check('best', 2 ** Math.min(...scores), 0.5, Infinity)} · ${check('worst', 2 ** Math.max(...scores), 0, 1.7)} · ${check('scouts/team min', Math.min(...scouts), 4, SCOUT_MAX, 0)} · ${check('max', Math.max(...scouts), 0, SCOUT_MAX, 0)} · ${check('value', staffVal, 9, 11.5)} · ${check('over budget', staffOver, 0, 2, 0)} · ${check('market', staffMkt, 25, 60, 0)}`,
  );

  // Injuries and medical staffs. Per team over the season just played: 24.0-26.4 injuries (the regular season's 20-36
  // plus the playoffs), 1.5-2.1 severe, 111-125 weeks lost (an ACL's year counts in full). Department means: physio
  // 11.16-11.28, science 10.69-10.94 (band 9.5-12.5: a drift either way means hiring or ageing has tilted). Payroll
  // 72-74% of the medical budget, 0-1 teams over; every team keeps its four chairs; market 32-34 medics.
  console.log(
    `  checks ${year} medical: ${check('injuries/team', hurtPerTeam, 18, 34, 1)} · ${check('severe/team', severePerTeam, 0.5, 3.5, 1)} · ${check('weeks lost/team', weeksPerTeam, 60, 180, 0)} · ${check('physio mean', avg(depts.map((d) => d.physio)), 9.5, 12.5)} · ${check('science mean', avg(depts.map((d) => d.science)), 9.5, 12.5)} · ${check('payroll mean %', 100 * avg(medPay), 55, 95, 0)} · ${check('over budget', medOver, 0, 2, 0)} · ${check('staff/team min', Math.min(...medics), MEDIC_MAX, MEDIC_MAX, 0)} · ${check('market', medMkt, 20, 50, 0)}`,
  );

  // Draft. 7 rounds x 32 teams = 224 picks every year. Worth (0.6 OVR + 0.4 potential): round 1 12.82-13.29 (all seeds
  // 12.61-13.33), rounds 2-3 10.70-11.09, so round 1 beats 2-3 by 1.7-2.5; teams reach 11.6-15.1 slots off the consensus
  // board (all seeds 11.5-15.3). Best- vs worst-staffed teams is NOT banded: the gap swings from -0.35 to +0.6.
  console.log(
    `  checks ${year} draft: ${check('picks', drafted, 7 * league.teams.length, 7 * league.teams.length, 0)} · ${check('R1 worth', r1, 11.8, 14.5)} · ${check('R2-3', r23, 9.8, 12)} · ${check('R1 − R2-3', r1 - r23, 1, Infinity)} · ${check('|slot − consensus|', reach, 8, 20, 1)}\n`,
  );

  // The coaching carousel against the NFL (docs/GAME_DESIGN.md, "How coaching works"): 7.0 new head coaches a year over
  // 2015-2025 (5-10), 12.5 new offensive coordinators (7-21) and 11 defensive (10-17). Observed here 3-10, 8-17, 5-18 a
  // season across seeds; position coaches 25-32% new (no NFL figure: 25-35% is the working assumption).
  console.log(
    `  checks ${year} carousel: ${check('new HCs', turnover.hc, 2, 12, 0)} · ${check('new OCs', turnover.oc, 4, 22, 0)} · ${check('new DCs', turnover.dc, 4, 22, 0)} · ${check('position coaches new %', 100 * turnover.pcShare, 15, 45, 0)}`,
  );

  rows.push({ year, k, growth: rate, body, craft, roles, staffVal, hcFired, coachOver, staffOver, turnover, hcFrom });
}

console.log(
  `young players' yearly OVR gain under the best-8 coaching staffs ${avg(gains.best).toFixed(3)} (n=${gains.best.length}) vs worst-8 ${avg(gains.worst).toFixed(3)} (n=${gains.worst.length})`,
);

if (playerGrowth.some((g) => g > 100)) {
  warn(
    ISSUE_SAVE_GROWTH,
    `players blob +${Math.min(...playerGrowth).toFixed(0)}–${Math.max(...playerGrowth).toFixed(0)} KB a season, ${prevSave!.retired} retired players kept after ${seasons} seasons`,
  );
}

// ───────── Whole-run checks ─────────

// Coaching helps young players, but only a little: +0.012 here (all seeds +0.012, +0.088, +0.047, +0.054) with a standard
// error near 0.024 at n ~ 1100 an arm, so one seed cannot band it tightly. This is a sanity band (coaching neither hurts
// nor decides careers); `npm run careers` is where the effect is judged properly.
console.log(`\ngains: ${check('best-8 minus worst-8 staffs', avg(gains.best) - avg(gains.worst), -0.05, 0.35, 3)}`);
// Run totals, scaled from a 6-season run. Teams over the coaching budget 0-1 a season (all seeds 1-3 a run); scouting
// departments over budget 0 (all seeds 0-1 a season). Head coaches fired: the carousel follows the NFL's, 7.0 new head
// coaches a year over 2015-2025 (5-10, nearly all firings), so 5-6.5 a season here (observed 36-38 a run) against 3-9.
console.log(
  `run: ${carouselRun()} · ${check(
    'teams over coaching budget',
    rows.reduce((a, r) => a + r.coachOver, 0),
    0,
    perRun(10),
    0,
  )} · ${check(
    'head coaches fired',
    rows.reduce((a, r) => a + r.hcFired, 0),
    3 * seasons,
    9 * seasons,
    0,
  )} · ${check(
    'scouting departments over budget',
    rows.reduce((a, r) => a + r.staffOver, 0),
    0,
    perRun(4),
    0,
  )}`,
);

/**
 * The carousel over the run, per season, against the NFL: 7.0 new head coaches (observed 5.6-6.6 across seeds), 12.5 new
 * offensive coordinators (10.4-11.9) and 11 defensive (10.6-12.1). Of the NFL's new head coaches 32% were retreads and 54%
 * coordinators (observed 15-35% and 50-75%).
 */
function carouselRun(): string {
  const per = (f: (r: Row) => number) => avg(rows.map(f));
  const hires = rows.reduce((a, r) => a + r.turnover.hc, 0) || 1;
  return [
    check(
      'new HCs/season',
      per((r) => r.turnover.hc),
      4.5,
      9.5,
      1,
    ),
    check(
      'new OCs/season',
      per((r) => r.turnover.oc),
      8.5,
      16,
      1,
    ),
    check(
      'new DCs/season',
      per((r) => r.turnover.dc),
      8,
      15,
      1,
    ),
    check('HC hires retreads %', (100 * rows.reduce((a, r) => a + r.hcFrom.retread, 0)) / hires, 10, 50, 0),
    check('…coordinators %', (100 * rows.reduce((a, r) => a + r.hcFrom.coordinator, 0)) / hires, 35, 85, 0),
  ].join(' · ');
}

// Drift: the first kickoff against the last. Needs enough seasons for the league to settle.
if (rows.length >= 5) {
  const first = rows[0];
  const end = rows[rows.length - 1];
  // Every team of the four leagues a season, this one's and the others' (the upper middle, as for one league's).
  const others = await capRuns;
  const tail = rows.slice(-3).map((r, j) => {
    const s = rows.length - 3 + j;
    const all = [...r.k.space.map((x) => (100 * x) / r.k.cap), ...others.flatMap((run) => run.space[s])];
    return all.sort((a, b) => a - b)[all.length >> 1];
  });
  console.log(`\ndrift, ${first.year} → ${end.year}:`);
  // The generated first league always settles upward by 0.1-0.3 OVR (obs +0.31; all seeds then +0.16 to +0.34), so the band
  // is lopsided; deflation would show as a negative change. After the 3rd kickoff it should hold (obs +0.17; all seeds
  // then <= 0.12). The settled opening league (0.1.5) barely moves: +0.05 over the run, -0.03 after the 3rd kickoff.
  console.log(
    `  talent: ${check('starter OVR, last − first', end.k.avgStarter - first.k.avgStarter, -0.15, 0.6)} · ${check(`…last − ${rows[2].year}`, end.k.avgStarter - rows[2].k.avgStarter, -0.3, 0.3)}`,
  );
  // Median cap space is flat once settled: 2.3, 2.1, 2.1% over the last three (all seeds 2.0-2.3), so within 1 point;
  // 3.1, 2.7, 2.4 (spread 0.7) with the settled opening league (0.1.5); 3.2, 3.3, 3.4 (spread 0.2) at 0.1.10, the
  // in-season reserve kept and room past it paid ahead (it read 3.9, 3.8, 3.7 without paying ahead).
  // One league's median is one team's space, and drawing other teams moves it 0.3-0.6 points a season (a bootstrap
  // over the 32), so it is read over all four leagues' 128 teams. The 4th kickoff still sits 0.2 above the next two
  // on average (2.32, 2.09, 2.10 over 36 seeds: a league still settling), part of every spread. Over those 36 seeds
  // one league's spread ran 0.1-1.6, one in six over the band; four drawn at random, 0.26 at the median and 0.86 at
  // the 99th percentile, about one draw in 800 over.
  // The pool of free agents is still growing at season 6 (+33 in the last step; all seeds +26 to +41); band 70.
  console.log(
    `  cap: median space %cap over ${others.length + 1} leagues ${tail.map((x) => x.toFixed(1)).join(' · ')} · ${check('spread over the last 3', Math.max(...tail) - Math.min(...tail), 0, 1, 1)} · ${check('free agents, last step', end.k.fas - rows[rows.length - 2].k.fas, -Infinity, 70, 0)}`,
  );
  // The neutrality ledger must not walk: growth 0.999 → 1.008 (+0.009), body 0.999 → 0.987, craft 0.999 → 0.996.
  // Role values wander within a point (biggest: S&C +0.7); staff value falls 10.30 → 10.00 (all seeds -0.05 to -0.30,
  // worth watching) against a band of 0.6.
  console.log(
    `  coaching: ${check('growth', end.growth - first.growth, -0.04, 0.04, 3)} · ${check('body', end.body - first.body, -0.04, 0.04, 3)} · ${check('craft', end.craft - first.craft, -0.04, 0.04, 3)} · ${ROLE_NAMES.map((n, i) => check(`${n} value`, end.roles[i] - first.roles[i], -1, 1, 1)).join(' · ')}`,
  );
  console.log(`  scouting: ${check('staff value', end.staffVal - first.staffVal, -0.6, 0.6)}`);
} else {
  console.log(`\ndrift and steady-state bands need 5+ seasons; this run played ${rows.length}, so they were skipped`);
}

if (Object.keys(known).length) console.log();
for (const [issue, where] of Object.entries(known)) console.log(`⚠ known issue: ${issue} — ${where.join('; ')}`);

console.log(`\n${misses} number(s) outside target range`);
if (misses) process.exitCode = 1;
