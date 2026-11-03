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
 *    them, 35–60% take it well and 10–30% bristle; 5–20% of head coaches' word worn thin at season's end, and some of
 *    those recover within a season.
 * 7. Effects (G2): the game-day edge averages out (every week's league mean within ±0.05 rating points, none past ±0.5);
 *    the growth tilt's league mean late in the season (after week 17: the year closes in week 18) within ±0.01, and young
 *    players who spent the season Good or better out-tilt those who spent it Poor or worse by 0.04 or more.
 *
 * 9. Disputes (G4): contract disputes started a season 3–12, holdouts 0.5–5, holdouts still out after week 1 at most 2,
 *    and none past the limit he gives in at (yours answered by the AI's rule, as for talks); trade requests (G4b) 4–15 a
 *    season, 40–90% going public, 25–75% of those resolved ending in a trade.
 *
 *   npm run morale                        # 8 seasons, seed morale-check
 *   npm run morale -- --seasons 6 --seed x
 */
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
import { tierOf, unitReads, weightOf, type UnitWord } from '../src/engine/standing';
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

let misses = 0;
const check = (label: string, value: number, [lo, hi]: [number, number], digits = 2) => {
  const ok = value >= lo && value <= hi;
  if (!ok) misses++;
  console.log(
    `${ok ? '✓' : '✗'} ${label.padEnd(54)} ${value.toFixed(digits).padStart(7)}   ${lo}–${hi}${ok ? '' : value < lo ? '  ▼ LOW' : '  ▲ HIGH'}`,
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

function sample(atEnd: boolean) {
  const ctx = moraleContext(league);
  sampleRoom(ctx);
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
      const outs = Object.values(r.outcomes);
      menMet += membersOf(league, t.id, r.scope).length;
      menLand += outs.filter((o) => o === 'lands').length;
      menBristle += outs.filter((o) => o === 'bristles').length;
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
check('Unit reads: Tight', shareOf('Tight'), [0.15, 0.35]);
// The ceiling is the point (spec §8: rooms cluster but don't run away); a club room averaging Poor is rare (about 2%),
// so there is no floor (the owner's call, Nov 2, 2026).
check('Club rooms at Poor or worse (ceiling)', mean(poorRooms), [0, 0.25]);

const perWindow = (m: Map<number, number>) => mean(windows.map((s) => m.get(s) ?? 0));
check(`Contract disputes started a season (${windows.length} windows)`, perWindow(started), [3, 12]);
check('Holdouts a season', perWindow(holdouts), [0.5, 5]);
check('Holdouts still out after week 1, a season', perWindow(outAfterWeek1), [0, 2]);
check('Holdouts past the limit he gives in at', pastLimit, [0, 0], 0);
// The NFL: about 5-10 public trade requests a year, roughly half traded within the year (spec Part 2).
check(`Trade requests a season (${SEASONS} seasons)`, requests / SEASONS, [4, 15]);
check(
  `Trade requests gone public (n=${requestKeys.size})`,
  requestPublic.size / Math.max(1, requestKeys.size),
  [0.4, 0.9],
);
const resolved = [...requestEnds.values()];
check(
  `Trade requests resolved by a trade (n=${resolved.length})`,
  resolved.filter((h) => h === 'traded').length / Math.max(1, resolved.length),
  [0.25, 0.75],
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
check("Head coaches worn thin at season's end", mean(wornShare), [0.05, 0.2]);
check(
  `Worn-thin coaches who recover within a season (n=${wornSeen})`,
  wornSeen ? wornRecovered / wornSeen : 0,
  [0.01, 1],
);

console.log(`\n${misses} number(s) outside target range`);
process.exit(misses ? 1 : 0);
