/**
 * Morale check (docs/superpowers/specs/2026-10-29-morale-core-design.md, "Checks"). Plays seasons league-wide and
 * checks the moods look like a real league's:
 *
 * 1. Bands: most players sit between Okay and Very good; Poor or worse is a minority; Abysmal and Superb are rare.
 * 2. Underpaid final-year starters (veterans paid under 0.7× their market): half or more read Poor or worse. The angriest
 *    escalate and get paid (G4), which takes them out of the count; the owner set the floor at 0.5 (2026-11-02).
 * 3. A benching: the week it lands his mood drops by 1.5 or more; six steps later he is back within 1.5 of his target.
 * 4. Winning rooms (.650 or better) average at least a step happier than losing ones (.350 or worse).
 * 5. Nothing runs away: the league's mean at week 18 stays within ±1.0 of the first season's, and no level leaves
 *    −10…+10.
 * 6. Talks (G3): asks per club per season 4–30, every club counted alike (yours answered by the AI's rule, since nobody
 *    clicks), and 25–85% of the promises that resolve are kept (85% since AI clubs keep their promises, G4).
 * 8. Meetings (L2): meetings per club per season 3–6 (yours held by your coach, since nobody clicks); of the men in
 *    them, 35–60% take it well and 10–30% bristle; 5–20% of head coaches' word worn thin at season's end (judged over
 *    four leagues: three more play in child processes alongside, since one league read 0.16–0.21 from seed to seed),
 *    and some of those recover within a season.
 * 7. Effects (G2): the game-day edge averages out (every week's league mean within ±0.05 rating points, none past ±0.5);
 *    the growth tilt's league mean late in the season (after week 17: the year closes in week 18) within ±0.01, and young
 *    players who spent the season Good or better out-tilt those who spent it Poor or worse by 0.04 or more.
 *
 * 10. Chemistry (L3): every room's edge centred on the league (worst room, worst week within ±0.02); Clicking and Out of
 *    sync each 10–30% of read rooms; a room whose Spark reads Poor or worse sits lower than one whose Spark reads Good or
 *    better; rooms with an Anchor spread less than rooms with only Sparks.
 * 11. Backing the staff (L4): the staff edge centred on the league (worst room, worst week within ±0.02); 10–25% of
 *    rooms doubt whoever runs their side at some point in a season, and 8% or fewer have lost him; rooms with a lawyer
 *    voice doubt more often than rooms without; notices both kept and broken (kept 20–80%); AI clubs relieve
 *    coordinators in season at the NFL's rate, every one a losing club whose side ranks in the bottom quarter, never
 *    two in a club's season.
 *
 * 9. Disputes (G4): contract disputes started a season 3–12, holdouts 0.5–5, holdouts still out after week 1 at most 2,
 *    and none past the limit he gives in at (yours answered by the AI's rule, as for talks); trade requests (G4b) 3–15 a
 *    season, 40–95% going public, 15–75% of those resolved ending in a trade (the floor lowered from 25%: small samples).
 *
 *   npm run morale                        # 8 seasons, seed morale-check
 *   npm run morale -- --seasons 6 --seed x
 */
import { bandMark, bandOf } from './band';
import { fork } from 'node:child_process';
import { yearsLeft } from '../src/engine/finance/contract';
import { buildMarket, marketApy } from '../src/engine/finance/market';
import { aiReply, answerTalk } from '../src/engine/playerTalks';
import { aiAnswerDispute, aiReviewDispute, giveInLimit } from '../src/engine/disputes';
import { createLeague } from '../src/engine/generate';
import { playWeek } from '../src/engine/league';
import {
  expectedRole,
  moraleClock,
  moraleContext,
  moraleFactors,
  moraleLevel,
  moraleStepOf,
  moraleTarget,
  moodPull,
  moraleMean,
} from '../src/engine/morale';
import { advanceOffseason, beginOffseason } from '../src/engine/offseason';
import { computeRecords } from '../src/engine/season/standings';
import { activeRoster } from '../src/engine/roster';
import { isCaptain, moraleStepOf as stepOf } from '../src/engine/morale';
import { soundOf, tierOf, unitRead, unitReads, weightOf, type UnitWord } from '../src/engine/standing';
import { CHEM_ROOMS, chemistryWeek, type ChemWord } from '../src/engine/chemistry';
import { beliefOf, beliefRead, lawyerIn, runnerOf } from '../src/engine/belief';
import { staffWeek } from '../src/engine/staffEdge';
import { credibilityRead, setMeetingsByCoach } from '../src/engine/meetings';
import { membersOf } from '../src/engine/meetings/suggest';
import type { League, Phase, Player } from '../src/engine/types';

const arg = (name: string, fallback: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
// Eight seasons: four left trade requests' outcomes to about ten cases (G4b).
const SEASONS = Number(arg('seasons', '8'));
const SEED = arg('seed', 'morale-check');
/** A child league: plays the same seasons and reports only its worn-thin shares. */
const WORKER = !!process.env.MORALE_WORN_ONLY && !!process.send;
/** Three more leagues' worn-thin shares, playing alongside this one. */
const wornPool: Promise<number[][]> = Promise.all(
  (WORKER ? [] : [2, 3, 4].map((i) => `${SEED}-${i}`)).map(
    (seed) =>
      new Promise<number[]>((resolve, reject) => {
        const child = fork(new URL(import.meta.url).pathname, ['--seed', seed, '--seasons', String(SEASONS)], {
          env: { ...process.env, MORALE_WORN_ONLY: '1' },
        });
        let done = false;
        child.once('message', (w) => {
          done = true;
          resolve(w as number[]);
          child.kill();
        });
        child.once('error', reject);
        child.once('exit', (code, sig) => done || reject(new Error(`morale league ${seed} exited (${sig ?? code})`)));
      }),
  ),
);

let misses = 0;
/** A line in range; with a normal band (a line that swings with the league, `band.ts`) outside its range it warns and
 * fails only outside the normal band. */
const check = (label: string, value: number, usual: [number, number], digits = 2, normal?: [number, number]) => {
  const band = bandOf(value, usual, normal);
  if (band === 'abnormal' || band === 'none') misses++;
  const mark = band === 'usual' ? '✓' : band === 'unusual' ? '⚠' : '✗';
  console.log(
    `${mark} ${label.padEnd(54)} ${value.toFixed(digits).padStart(7)}   ${usual[0]}–${usual[1]}${bandMark(value, usual, normal)}`,
  );
};
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);

const league = createLeague({ seed: SEED });
// Nobody clicks: your head coach holds your meetings, as an AI club's does.
setMeetingsByCoach(league, true);
const rostered = (l: League) => Object.values(l.players).filter((p) => p.teamId !== null && p.morale);

// 1, 2 and 5: samples at weeks 9 and 18.
const steps: number[] = [];
const underpaid: number[] = [];
const means: number[] = [];
const roomGap: number[] = [];
let outOfRange = 0;

// 8: the room (L1): standing per club, unit reads and rooms, read as the engine reads them.
const leadersPer: number[] = [];
const voicesPer: number[] = [];
const noLeader: number[] = [];
const reads: UnitWord[] = [];
const poorRooms: number[] = [];
function sampleRoom(ctx: ReturnType<typeof moraleContext>) {
  for (const t of league.teams) {
    const roster = activeRoster(league, t.id);
    let leaders = 0;
    let past = 0;
    let voices = 0;
    let total = 0;
    let sum = 0;
    for (const p of roster) {
      const w = weightOf(league, p, ctx);
      const tier = tierOf(league, p, w);
      if (tier === 'leader') {
        leaders++;
        if (!isCaptain(league, p)) past++;
      } else if (tier === 'voice') voices++;
      total += Math.max(w, 0.3);
      sum += Math.max(w, 0.3) * moraleLevel(league, p);
    }
    leadersPer.push(leaders);
    voicesPer.push(voices);
    noLeader.push(past ? 0 : 1);
    poorRooms.push(total && stepOf(sum / total) <= 3 ? 1 : 0);
    for (const r of unitReads(league, t.id, ctx)) reads.push(r.word);
  }
}

// 10: chemistry (L3), read as the lineup reads it, at the same samples.
const chemWords: ChemWord[] = [];
let chemOffCentre = 0;
const sparkSour: number[] = [];
const sparkHappy: number[] = [];
const anchorSd: number[] = [];
const sparkOnlySd: number[] = [];
const sd = (xs: number[]) => {
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
};
function chemistrySample(ctx: ReturnType<typeof moraleContext>) {
  const week = chemistryWeek(league);
  for (const unit of CHEM_ROOMS) {
    const edges = league.teams.map((t) => week.get(`${t.id}:${unit}`)?.edge ?? 0);
    chemOffCentre = Math.max(chemOffCentre, Math.abs(mean(edges)));
  }
  for (const t of league.teams)
    for (const unit of CHEM_ROOMS) {
      const read = unitRead(league, t.id, unit, ctx);
      if (!read) continue;
      chemWords.push(week.get(`${t.id}:${unit}`)!.word);
      const setter = read.setter === null ? undefined : league.players[read.setter];
      if (setter && soundOf(setter) === 'stirs') {
        const step = stepOf(moraleLevel(league, setter));
        if (step <= 3) sparkSour.push(read.level);
        else if (step >= 5) sparkHappy.push(read.level);
      }
      const sounds = (ctx.voices.get(`${t.id}:${unit}`) ?? []).map((v) => v.sound);
      const spread = sd(read.members.map((id) => moraleLevel(league, league.players[id])));
      if (sounds.includes('steadies')) anchorSd.push(spread);
      else if (sounds.includes('stirs')) sparkOnlySd.push(spread);
    }
}

// 11: backing the staff (L4), read every regular-season week.
let staffOffCentre = 0;
/** Each room's season (`season:team:room`): its worst read, and whether a lawyer voice was in it. */
const roomSeasons = new Map<string, { worst: 'steady' | 'doubts' | 'lost'; lawyer: boolean }>();
/** Open notices as of the last week, by `team:opened:coord`, and how they ended. */
let openNotices = new Map<string, { team: number; scope: string; coord: number }>();
let noticesKept = 0;
let noticesBroken = 0;
function staffSample() {
  const week = staffWeek(league);
  for (const unit of CHEM_ROOMS) {
    const edges = league.teams.map((t) => week.get(`${t.id}:${unit}`)?.edge ?? 0);
    staffOffCentre = Math.max(staffOffCentre, Math.abs(mean(edges)));
  }
  const ctx = moraleContext(league);
  for (const t of league.teams)
    for (const room of CHEM_ROOMS) {
      const key = `${league.season}:${t.id}:${room}`;
      const read = beliefRead(beliefOf(runnerOf(league, t.id, room), room));
      const was = roomSeasons.get(key) ?? { worst: 'steady' as const, lawyer: false };
      const worst =
        read === 'lost' || was.worst === 'lost'
          ? 'lost'
          : read === 'doubts' || was.worst === 'doubts'
            ? 'doubts'
            : 'steady';
      roomSeasons.set(key, { worst, lawyer: was.lawyer || !!lawyerIn(league, t.id, room, ctx) });
    }
  // Notices that closed since last week: kept if the man is gone or the room climbed out, as `isKept` reads it.
  const now = new Map<string, { team: number; scope: string; coord: number }>();
  for (const t of league.teams)
    for (const c of t.meetings?.open ?? [])
      if (c.backing === 'notice' && c.coord !== undefined && c.scope !== 'team')
        now.set(`${t.id}:${c.opened}:${c.coord}`, { team: t.id, scope: c.scope, coord: c.coord });
  for (const [k, n] of openNotices) {
    if (now.has(k)) continue;
    const runner = runnerOf(league, n.team, n.scope as (typeof CHEM_ROOMS)[number]);
    const read = beliefRead(beliefOf(runner, n.scope as (typeof CHEM_ROOMS)[number]));
    if (runner?.id !== n.coord || read === 'steady' || read === 'believes') noticesKept++;
    else noticesBroken++;
  }
  openNotices = now;
}

function sample(atEnd: boolean) {
  const ctx = moraleContext(league);
  sampleRoom(ctx);
  chemistrySample(ctx);
  // Built, not read from `leagueMarket`: filling that cache would change the AI's pay reads, and so the league.
  const market = buildMarket(league);
  const levels = new Map<number, number[]>();
  for (const p of rostered(league)) {
    const level = moraleLevel(league, p);
    steps.push(moraleStepOf(level));
    (levels.get(p.teamId!) ?? levels.set(p.teamId!, []).get(p.teamId!)!).push(level);
    const c = p.contract;
    if (
      c &&
      p.experience >= 3 &&
      yearsLeft(c, league.season) <= 1 &&
      expectedRole(p, ctx) === 2 &&
      c.apy < 0.7 * marketApy(market, p)
    )
      underpaid.push(moraleStepOf(level) <= 3 ? 1 : 0);
  }
  if (!atEnd) return;
  means.push(mean([...levels.values()].flat()));
  const records = computeRecords(league);
  const share = (id: number) => {
    const r = records.get(id)!;
    return (r.w + r.t / 2) / Math.max(1, r.w + r.l + r.t);
  };
  const room = (id: number) => mean(levels.get(id) ?? []);
  const winners = league.teams.filter((t) => share(t.id) >= 0.65).map((t) => room(t.id));
  const losers = league.teams.filter((t) => share(t.id) <= 0.35).map((t) => room(t.id));
  if (winners.length && losers.length) roomGap.push(mean(winners) - mean(losers));
}

// 3: every benching followed for six steps from the step it lands.
interface Watch {
  p: Player;
  before: number;
  after?: number;
  steps: number;
  gap?: number;
}
const watching: Watch[] = [];
const done: Watch[] = [];
let before = new Map<number, number>();

// 6: talks, counted the step they happen.
const asks = new Map<string, number>();
let promisesMade = 0;
let kept = 0;
let broken = 0;
/** Players with an open promise before the step: only theirs are promises kept or broken (a meeting's commitment
 * lands the same jolts on the men who bought in, `meetings/commitments.ts`). */
let promised = new Set<number>();
function talks(clock: number) {
  for (const p of rostered(league)) {
    const t = p.morale!.talk;
    const key = `${league.season}:${p.teamId}`;
    // An AI club answers the step he asks; yours is answered here by the same rule.
    if (t?.answered?.at === clock && t.answered.ask === clock) asks.set(key, (asks.get(key) ?? 0) + 1);
    else if (t?.ask?.at === clock) {
      asks.set(key, (asks.get(key) ?? 0) + 1);
      answerTalk(league, p.id, aiReply(league, p.teamId!, t.ask.cause));
    }
    if (p.morale!.talk?.answered?.at === clock && p.morale!.talk.answered.reply === 'promise') promisesMade++;
    for (const j of p.morale!.jolts ?? [])
      if (j.at === clock && promised.has(p.id)) {
        if (j.kind === 'kept') kept++;
        if (j.kind === 'broken') broken++;
      }
  }
}

// 8: meetings (L2), counted the step they're held; the re-sign window's belongs to the season it ends.
const YEAR = 32;
const meetingsBy = new Map<string, number>();
let menMet = 0;
let menLand = 0;
let menBristle = 0;
const wornShare: number[] = [];
let wornBefore = new Set<number>();
let wornSeen = 0;
let wornRecovered = 0;
function meetings(clock: number) {
  for (const t of league.teams)
    for (const r of t.meetings?.log ?? []) {
      if (r.clock !== clock) continue;
      const year = Math.floor(clock / YEAR) - (clock % YEAR === 0 ? 1 : 0);
      const key = `${year}:${t.id}`;
      meetingsBy.set(key, (meetingsBy.get(key) ?? 0) + 1);
      menMet += membersOf(league, t.id, r.scope).length;
      menLand += r.outcomes.lands.length;
      menBristle += r.outcomes.bristles.length;
    }
}
function credibilitySample() {
  const heads = Object.values(league.coaches).filter((c) => c.role === 'headCoach' && c.teamId !== null);
  const worn = new Set(heads.filter((c) => credibilityRead(c) === 'wornThin').map((c) => c.id));
  wornShare.push(worn.size / heads.length);
  for (const id of wornBefore) {
    const c = league.coaches[id];
    if (!c || c.role !== 'headCoach' || c.teamId === null) continue;
    wornSeen++;
    if (!worn.has(id)) wornRecovered++;
  }
  wornBefore = worn;
}
// 9: disputes, counted by the league year they start in.
const disputeSeen = new Set<string>();
const started = new Map<number, number>();
const holdouts = new Map<number, number>();
const outAfterWeek1 = new Map<number, number>();
let pastLimit = 0;
// Trade requests (G4b): how many start, how many go public, how the ones that end, end.
let requests = 0;
const requestKeys = new Set<string>();
const requestPublic = new Set<string>();
const requestEnds = new Map<string, string>();
function disputes(clock: number) {
  const bump = (m: Map<number, number>, season: number) => m.set(season, (m.get(season) ?? 0) + 1);
  for (const p of rostered(league)) {
    const m = p.morale!;
    // Started this step: one still open, or one an AI club settled the step it started.
    for (const x of [m.dispute, m.disputeEnd])
      if (x && x.since === clock && !disputeSeen.has(`${p.id}:${x.since}`)) {
        disputeSeen.add(`${p.id}:${x.since}`);
        if (x.kind === 'trade') {
          requests++;
          requestKeys.add(`${p.id}:${x.since}`);
        } else bump(started, Math.floor(x.since / 32));
        if (x.kind === 'holdOut') bump(holdouts, Math.floor(x.since / 32));
      }
    if (m.dispute?.kind === 'trade' && m.dispute.public !== undefined) requestPublic.add(`${p.id}:${m.dispute.since}`);
    const e = m.disputeEnd;
    if (e?.kind === 'trade' && requestKeys.has(`${p.id}:${e.since}`)) requestEnds.set(`${p.id}:${e.since}`, e.how);
    // Your club's are answered, and thought over, by the AI's rules.
    if (m.dispute && p.teamId === league.userTeamId) {
      if (!m.dispute.answered) aiAnswerDispute(league, p, clock);
      else if (m.dispute.since < clock) aiReviewDispute(league, p, clock, clock - league.season * 32);
    }
    const d = p.morale!.dispute;
    if (d?.kind === 'holdOut' && (d.lost ?? 0) >= giveInLimit(league, p)) pastLimit++;
    // The step after week 1's games.
    if (d?.kind === 'holdOut' && d.out && league.phase === 'regular' && league.week === 2)
      bump(outAfterWeek1, Math.floor(d.since / 32));
  }
}
/** League years whose re-sign window to camp the run played: the ones a dispute can start in. */
const windows: number[] = [];

function step(run: () => void) {
  before = new Map(rostered(league).map((p) => [p.id, moraleLevel(league, p)]));
  promised = new Set(
    rostered(league)
      .filter((p) => p.morale!.talk?.promise)
      .map((p) => p.id),
  );
  run();
  const clock = league.moraleAt ?? moraleClock(league);
  talks(clock);
  disputes(clock);
  meetings(clock);
  for (const p of Object.values(league.players)) {
    const m = p.morale;
    if (m && (Math.abs(m.level) > 10 || Math.abs(moraleLevel(league, p)) > 10)) outOfRange++;
  }
  const ctx = moraleContext(league);
  for (const w of watching) {
    w.steps++;
    if (w.steps === 6 && w.p.teamId !== null && w.p.morale)
      w.gap = Math.abs(moraleLevel(league, w.p) - moraleTarget(moraleFactors(league, w.p, ctx)));
  }
  done.push(...watching.filter((w) => w.steps >= 6));
  const still = watching.filter((w) => w.steps < 6);
  watching.length = 0;
  watching.push(...still);
  for (const p of rostered(league)) {
    const fresh = (p.morale!.jolts ?? []).some((j) => j.kind === 'benched' && j.at === clock);
    if (fresh && before.has(p.id))
      watching.push({ p, before: before.get(p.id)!, after: moraleLevel(league, p), steps: 0 });
  }
}

// 7: the effects (G2), read as the engine reads them.
const edgeMeans: number[] = [];
let edgeMax = 0;
const tilts: number[] = [];
const tiltUp: number[] = [];
const tiltDown: number[] = [];
let seasonLevels = new Map<number, number[]>();
function effects() {
  const m = moraleMean(league);
  const edges = rostered(league).map((p) => 0.5 * moodPull(moraleLevel(league, p), m));
  edgeMeans.push(mean(edges));
  edgeMax = Math.max(edgeMax, ...edges.map(Math.abs));
  for (const p of rostered(league))
    if (p.dev?.potential !== undefined)
      (seasonLevels.get(p.id) ?? seasonLevels.set(p.id, []).get(p.id)!).push(moraleLevel(league, p));
}
function readTilts() {
  for (const p of rostered(league)) {
    if (p.dev?.potential === undefined) continue;
    const t = p.dev.mood ?? 0;
    tilts.push(t);
    const avg = mean(seasonLevels.get(p.id) ?? []);
    if (avg >= 1) tiltUp.push(t);
    else if (avg <= -1) tiltDown.push(t);
  }
  seasonLevels = new Map();
}

const t0 = Date.now();
for (let s = 0; s < SEASONS; s++) {
  while (league.phase === 'regular' || league.phase === 'playoffs') {
    const week = league.week;
    const regular = league.phase === 'regular';
    if (regular) effects();
    step(() => playWeek(league));
    if (regular) staffSample();
    if (regular && week === 17) readTilts();
    if (regular && week === 9) sample(false);
    if (regular && week === 18) {
      sample(true);
      credibilitySample();
    }
  }
  if (s === SEASONS - 1) break;
  step(() => beginOffseason(league));
  windows.push(league.season);
  while ((league.phase as Phase) !== 'regular') step(() => advanceOffseason(league, { autoUser: true }));
}

if (WORKER) {
  process.send!(wornShare);
  await new Promise(() => {});
}
const share = (f: (s: number) => boolean) => steps.filter(f).length / steps.length;
console.log(
  `Morale: ${SEASONS} season(s), seed ${SEED}, ${steps.length} samples, ${((Date.now() - t0) / 1000).toFixed(0)}s\n`,
);
check(
  'Okay through Very good (share of samples)',
  share((s) => s >= 4 && s <= 6),
  [0.6, 1],
);
check(
  'Poor or worse',
  share((s) => s <= 3),
  [0.1, 0.3],
);
check(
  'Abysmal',
  share((s) => s === 1),
  [0, 0.03],
);
check(
  'Superb',
  share((s) => s === 7),
  [0, 0.08],
);
// 0.6 until G4 (the owner, 2026-11-02): the men who escalate get paid and leave the count, and main sat on the floor.
check(`Underpaid final-year starters, Poor or worse (n=${underpaid.length})`, mean(underpaid), [0.5, 1]);
const drops = done.filter((w) => w.after !== undefined).map((w) => w.before - w.after!);
check(`Benched: drop the week it lands (n=${drops.length})`, mean(drops), [1.5, 20]);
const gaps = done.filter((w) => w.gap !== undefined).map((w) => w.gap!);
check(`Benched: six steps on, gap to his target (n=${gaps.length})`, mean(gaps), [0, 1.5]);
check('Winning rooms minus losing rooms (mean of seasons)', mean(roomGap), [1, 20]);
for (let i = 1; i < means.length; i++)
  check(`League mean at week 18, season ${i + 1} vs the first`, means[i] - means[0], [-1, 1]);
check('Levels outside −10…+10', outOfRange, [0, 0], 0);
check(`Talks: asks per club per season (${asks.size} club-seasons)`, mean([...asks.values()]), [4, 30]);
check(
  `Talks: promises kept, of those resolved (made ${promisesMade}, kept ${kept}, broken ${broken})`,
  kept / Math.max(1, kept + broken),
  // 0.75 until G4 (the owner, 2026-11-02): it was set when no club acted on its promises; AI clubs now keep them.
  [0.25, 0.85],
);
check('Game-day edge: league mean (worst week)', Math.max(...edgeMeans.map(Math.abs)), [0, 0.05], 3);
check('Game-day edge: largest', edgeMax, [0, 0.5], 3);
const chemShare = (w: ChemWord) => chemWords.filter((x) => x === w).length / Math.max(1, chemWords.length);
check('Chemistry: league mean edge (worst room, worst week)', chemOffCentre, [0, 0.02], 3);
check('Chemistry: Clicking share of read rooms', chemShare('Clicking'), [0.1, 0.3]);
check('Chemistry: Out of sync share of read rooms', chemShare('Out of sync'), [0.1, 0.3]);
console.log(
  `  (Gelling ${chemShare('Gelling').toFixed(2)}, Still learning each other ${chemShare('Still learning each other').toFixed(2)}, n=${chemWords.length})`,
);
check(
  `Sparks: a sour Spark's room below a happy one's (n=${sparkSour.length}/${sparkHappy.length})`,
  mean(sparkSour) - mean(sparkHappy),
  [-6, -0.1],
);
check(
  `Anchors calm a room: spread with an Anchor ÷ with only Sparks (n=${anchorSd.length}/${sparkOnlySd.length})`,
  mean(anchorSd) / mean(sparkOnlySd),
  [0, 0.98],
);
const rs = [...roomSeasons.values()];
const ofRooms = (f: (r: (typeof rs)[number]) => boolean, among = rs) =>
  among.filter(f).length / Math.max(1, among.length);
const withLawyer = rs.filter((r) => r.lawyer);
const noLawyer = rs.filter((r) => !r.lawyer);
const relieved = league.leadership.events.filter((e) => e.kind === 'coachRelieved' && e.teamId !== league.userTeamId);
const fair = relieved.filter((e) => {
  const m = e.report.match(/\((\d+)–(\d+)(?:–(\d+))?; (\d+)\w+ of (\d+)/);
  if (!m) return false;
  const [w, l, t, rank, n] = [m[1], m[2], m[3] ?? '0', m[4], m[5]].map(Number);
  return (w + t / 2) / Math.max(1, w + l + t) <= 0.4 && rank > n * 0.75;
});
const perClubSeason = new Map<string, number>();
for (const e of relieved) {
  const k = `${e.date.season}:${e.teamId}`;
  perClubSeason.set(k, (perClubSeason.get(k) ?? 0) + 1);
}
check('Staff edge: league mean (worst room, worst week)', staffOffCentre, [0, 0.02], 3);
// Swings with the league: ⚠ outside the usual band, fails outside the normal (the owner's call, Nov 5).
check(
  `Belief: rooms in doubt at some point in a season (n=${rs.length})`,
  ofRooms((r) => r.worst !== 'steady'),
  [0.1, 0.25],
  2,
  [0.05, 0.35],
);
check(
  'Belief: rooms that lost him',
  ofRooms((r) => r.worst === 'lost'),
  [0, 0.08],
);
check(
  `Belief: rooms with a lawyer doubt more (n=${withLawyer.length}/${noLawyer.length})`,
  ofRooms((r) => r.worst !== 'steady', withLawyer) - ofRooms((r) => r.worst !== 'steady', noLawyer),
  [0.01, 1],
);
check(
  `Notice: kept share (kept ${noticesKept}, broken ${noticesBroken})`,
  noticesKept / Math.max(1, noticesKept + noticesBroken),
  [0.2, 0.8],
);
check(`AI clubs relieved coordinators a season (${relieved.length} in ${SEASONS})`, relieved.length / SEASONS, [1, 3]);
check(
  '…every one a losing club whose side ranks in the bottom quarter',
  fair.length / Math.max(1, relieved.length),
  [1, 1],
);
check('…most in one club’s season', Math.max(0, ...perClubSeason.values()), [0, 1], 0);
check(`Growth tilt: league mean late in the season (n=${tilts.length})`, mean(tilts), [-0.01, 0.01], 4);
check(
  `Growth tilt: Good or better minus Poor or worse (n=${tiltUp.length}, ${tiltDown.length})`,
  mean(tiltUp) - mean(tiltDown),
  [0.04, 0.2],
  3,
);

const shareOf = (w: UnitWord) => reads.filter((r) => r === w).length / Math.max(1, reads.length);
check(`Leaders per club, captains included (n=${leadersPer.length})`, mean(leadersPer), [3, 6]);
check('Voices per club', mean(voicesPer), [6, 12]);
// 0.1 until G4b (the owner, 2026-11-02): main itself read 0.09 over eight seasons; the line only sets how often the report
// says nobody past the captains steps up (L1 moves no moods).
check('Clubs with no leader past the captains', mean(noLeader), [0.05, 0.3]);
check(`Unit reads: Split (n=${reads.length})`, shareOf('Split'), [0.05, 0.15]);
// Down means a room reads Poor or worse, the word the screen shows: rare in a happy league, so only its ceiling counts
// (the owner's call, Nov 2, 2026).
check('Unit reads: Down (ceiling)', shareOf('Down'), [0, 0.2]);
// Tight swings with the league (`band.ts`): ⚠ outside 0.15–0.35, fail outside 0.12–0.40 (the owner's call, Nov 6: main
// read 0.32–0.34 over three seeds and 0.4.8's branch 0.31–0.36, the gap flipping with the seed).
check('Unit reads: Tight', shareOf('Tight'), [0.15, 0.35], 2, [0.12, 0.4]);
// The ceiling is the point (spec §8: rooms cluster but don't run away); a club room averaging Poor is rare (about 2%),
// so there is no floor (the owner's call, Nov 2, 2026).
check('Club rooms at Poor or worse (ceiling)', mean(poorRooms), [0, 0.25]);

const perWindow = (m: Map<number, number>) => mean(windows.map((s) => m.get(s) ?? 0));
check(`Contract disputes started a season (${windows.length} windows)`, perWindow(started), [3, 12]);
check('Holdouts a season', perWindow(holdouts), [0.5, 5]);
check('Holdouts still out after week 1, a season', perWindow(outAfterWeek1), [0, 2]);
check('Holdouts past the limit he gives in at', pastLimit, [0, 0], 0);
// The NFL: about 5-10 public trade requests a year, roughly half traded within the year (spec Part 2).
// The floor is 3, not 4 (the owner's call, Nov 3): this line swings with the world, and naming captains when a
// league is created moved it across three worlds from main's 4.0-6.0 to 3.4-4.9 (one world higher than main), with
// main itself on the old floor in one.
// Swings with the league: ⚠ outside the usual band, fails outside the normal (the owner's call, Nov 5).
check(`Trade requests a season (${SEASONS} seasons)`, requests / SEASONS, [3, 15], 2, [1.5, 20]);
// The ceiling is 0.95, not 0.9 (the owner's call, Nov 3): a run sees 30-60 requests, and main read 0.82, 0.89 and 0.95
// across three worlds. With L3's voices lifting a room's sour men, the requests left are the stubborn ones, which leak
// (0.90 on the check's world).
// Swings with the league (the owner's call, Nov 8): with 30-60 requests one moves it 2-3 points, and the front-office
// work read it 0.89, 0.95, 0.95 and 0.98 run to run (main 0.92). ⚠ outside 0.4-0.95, fails outside 0.3-1.
check(
  `Trade requests gone public (n=${requestKeys.size})`,
  requestPublic.size / Math.max(1, requestKeys.size),
  [0.4, 0.95],
  2,
  [0.3, 1],
);
const resolved = [...requestEnds.values()];
// The floor is 0.15, not 0.25 (the owner's call, Nov 3): a run sees 15-37 requests end, so one or two deals swing it,
// and across three worlds main read 0.33-0.42 and the meetings branch 0.18-0.47. It still flags a market where requests
// almost never end in a trade; the NFL's "roughly half" stays the target.
check(
  `Trade requests resolved by a trade (n=${resolved.length})`,
  resolved.filter((h) => h === 'traded').length / Math.max(1, resolved.length),
  [0.15, 0.75],
);
// 8: meetings (L2). A season counts once its re-sign window is in (the last season played has none).
const lastYear = league.season;
const counts = league.teams.flatMap((t) => {
  const out: number[] = [];
  for (let y = league.season - SEASONS + 1; y < lastYear; y++) out.push(meetingsBy.get(`${y}:${t.id}`) ?? 0);
  return out;
});
check(`Meetings per club per season (${counts.length} club-seasons)`, mean(counts), [3, 6]);
check(`Reactions: lands (n=${menMet})`, menLand / menMet, [0.35, 0.6]);
check('Reactions: bristles', menBristle / menMet, [0.1, 0.3]);
const wornAll = [wornShare, ...(await wornPool)];
check(`Head coaches worn thin at season's end (${wornAll.length} leagues)`, mean(wornAll.map(mean)), [0.05, 0.2]);
check(
  `Worn-thin coaches who recover within a season (n=${wornSeen})`,
  wornSeen ? wornRecovered / wornSeen : 0,
  [0.01, 1],
);

console.log(`\n${misses} number(s) outside target range`);
process.exit(misses ? 1 : 0);
