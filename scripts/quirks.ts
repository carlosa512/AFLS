/**
 * Quirk audit, two parts.
 *
 * 1. Churn: the marble bag run season after season on a fresh league (development, rosters and
 *    games left out, so it's quick): how often each quirk is carried, gained and lost, and how many
 *    players carry four. Checked against the targets in docs/QUIRKS.md.
 * 2. Effects (`--effects`): for each quirk, give it to every player at its positions (and nobody
 *    anything else), replay the same games, and check its stat moves the way the registry says.
 *
 *   npm run quirks                        # churn, 10 seasons
 *   npm run quirks -- --effects           # also the effects, 3 seasons per quirk (9 for close calls, 18 for the closest)
 *   npm run quirks -- --effects --only=gunslinger,anchor
 */
import { createLeague } from '../src/engine/generate';
import { simulateGame } from '../src/engine/match/gameSim';
import {
  activeQuirks,
  QUIRK_IDS,
  QUIRKS,
  QUIRKS_FOR,
  quirkOffseason,
  recordForm,
  quirkWeek,
  type QuirkId,
} from '../src/engine/quirks';
import { REGULAR_SEASON_WEEKS } from '../src/engine/season/schedule';
import type { GameResult, League, StatKey } from '../src/engine/types';

const args = process.argv.slice(2);
const effects = args.includes('--effects');
const seasons = Number(args.find((a) => /^\d+$/.test(a)) ?? 3);
const churnSeasons = 10;
/** `--only=gunslinger,anchor`: audit just these quirks' effects. */
const only = args
  .find((a) => a.startsWith('--only='))
  ?.slice(7)
  .split(',');
let failed = false;

// ───────── churn ─────────

/**
 * Targets from docs/QUIRKS.md §2, per quirk so they hold however many quirks a position has: with
 * twelve a position, 9% each puts about 60% of players on at least one.
 */
const TARGETS: Record<string, [number, number]> = {
  'carried %': [6, 12],
  'gained %': [0.8, 1.8],
  'lost %': [0.5, 1.5],
};

function churn() {
  const league = createLeague({ seed: 'quirks' });
  const rostered = () => Object.values(league.players).filter((p) => !p.retired && p.teamId !== null);
  const rows: Record<string, number>[] = [];
  console.log(
    `\nQuirk churn: ${churnSeasons} seasons, rostered players only. Per quirk: share of the players at its positions\n`,
  );
  for (let s = 0; s < churnSeasons; s++) {
    const before = new Map(rostered().map((p) => [p.id, new Set(activeQuirks(p))]));
    for (let w = 1; w <= REGULAR_SEASON_WEEKS; w++) {
      league.week = w;
      quirkWeek(league);
    }
    league.season++;
    for (const p of rostered()) {
      p.age++;
      p.experience++;
      quirkOffseason(league, p);
    }
    const players = rostered();
    // Player-quirk slots: each player times the quirks his position can draw.
    const slots = players.reduce((a, p) => a + QUIRKS_FOR[p.position].length, 0);
    let gained = 0;
    let lost = 0;
    let carried = 0;
    for (const p of players) {
      const was = before.get(p.id) ?? new Set();
      const now = new Set(activeQuirks(p));
      carried += now.size;
      gained += [...now].filter((q) => !was.has(q)).length;
      lost += [...was].filter((q) => !now.has(q)).length;
    }
    const carriedShare = carried / slots;
    rows.push({
      'carried %': 100 * carriedShare,
      'gained %': (100 * gained) / slots,
      'lost %': (100 * lost) / slots,
      'with ≥1 %': (100 * players.filter((p) => activeQuirks(p).length > 0).length) / players.length,
      // What a full list (twelve a position) would give at the same per-quirk rate.
      'at 12: ≥1 %': 100 * (1 - (1 - carriedShare) ** 12),
      'at 12: avg': 12 * carriedShare,
      'carry four %': (100 * players.filter((p) => activeQuirks(p).length === 4).length) / players.length,
    });
  }
  const keys = Object.keys(rows[0]);
  console.log('season' + keys.map((k) => k.padStart(14)).join(''));
  rows.forEach((r, i) =>
    console.log(`${String(i + 1).padStart(6)}` + keys.map((k) => r[k].toFixed(2).padStart(14)).join('')),
  );
  console.log();
  for (const [k, [lo, hi]] of Object.entries(TARGETS)) {
    const avg = rows.reduce((a, r) => a + r[k], 0) / rows.length;
    const ok = avg >= lo && avg <= hi;
    if (!ok) failed = true;
    console.log(
      `${ok ? '  ' : avg < lo ? '▼ ' : '▲ '}${k.padEnd(12)} ${avg.toFixed(2).padStart(7)}   target ${lo}–${hi}`,
    );
  }
  // Every quirk shows up somewhere.
  const counts = Object.fromEntries(QUIRK_IDS.map((q) => [q, 0])) as Record<QuirkId, number>;
  for (const p of rostered()) for (const q of activeQuirks(p)) counts[q]++;
  // Kickers and punters are 32 a side: one of their quirks can sit at zero by luck alone.
  const eligible = (q: QuirkId) =>
    rostered().filter((p) => (QUIRKS[q].positions as readonly string[]).includes(p.position)).length;
  const missing = QUIRK_IDS.filter((q) => !counts[q] && eligible(q) >= 100);
  if (missing.length) failed = true;
  console.log(
    '\nCarried at the end: ' +
      QUIRK_IDS.map((q) => `${q} ${counts[q]}`).join(', ') +
      (missing.length ? `\n▼ Nobody carries: ${missing.join(', ')}` : ''),
  );
}

// ───────── effects ─────────

interface Metric {
  label: string;
  take: (r: GameResult, side: 0 | 1) => [number, number];
}
const ps = (r: GameResult, side: 0 | 1, key: StatKey, league: League, teams: [number, number]) => {
  let s = 0;
  for (const [id, line] of Object.entries(r.playerStats))
    if (r.playerTeams[Number(id)] === teams[side] && league.players[Number(id)]) s += line[key] ?? 0;
  return s;
};

function effectAudit() {
  let league: League;
  let teams: [number, number] = [0, 0];
  const team = (r: GameResult, side: 0 | 1) => (side === 0 ? r.home : r.away);
  const st = (r: GameResult, side: 0 | 1, key: StatKey) => ps(r, side, key, league, teams);
  const other = (s: 0 | 1) => (1 - s) as 0 | 1;
  const qbStat = (r: GameResult, side: 0 | 1, key: StatKey) => {
    let n = 0;
    for (const [id, line] of Object.entries(r.playerStats))
      if (r.playerTeams[Number(id)] === teams[side] && league.players[Number(id)]?.position === 'QB')
        n += line[key] ?? 0;
    return n;
  };
  const posStat = (r: GameResult, side: 0 | 1, key: StatKey) => {
    let n = 0;
    for (const [id, line] of Object.entries(r.playerStats)) {
      const p = league.players[Number(id)];
      if (r.playerTeams[Number(id)] === teams[side] && (p?.position === 'RB' || p?.position === 'TE'))
        n += line[key] ?? 0;
    }
    return n;
  };
  const METRICS: Record<string, Metric> = {
    'sack%': { label: 'sack%', take: (r, s) => [team(r, s).sacked * 100, team(r, s).passAtt + team(r, s).sacked] },
    'int%': { label: 'int%', take: (r, s) => [st(r, s, 'passInt') * 100, team(r, s).passAtt] },
    'cmp%': { label: 'cmp%', take: (r, s) => [team(r, s).passCmp * 100, team(r, s).passAtt] },
    'yds/att': { label: 'yds/att', take: (r, s) => [team(r, s).passYds + st(r, s, 'sackYds'), team(r, s).passAtt] },
    'yds/carry': { label: 'yds/carry', take: (r, s) => [team(r, s).rushYds, team(r, s).rushAtt] },
    // Runs stopped behind the line: tackles for loss on the other side, sacks taken out.
    'stuff%': {
      label: 'stuff%',
      take: (r, s) => [(st(r, other(s), 'tfl') - st(r, other(s), 'sacks')) * 100, team(r, s).rushAtt],
    },
    // Throws to backs and tight ends: the ones linebackers cover.
    'RB+TE yds/tgt': { label: 'RB+TE yds/tgt', take: (r, s) => [posStat(r, s, 'recYds'), posStat(r, s, 'targets')] },
    'yds/rec': { label: 'yds/rec', take: (r, s) => [team(r, s).passYds, team(r, s).passCmp] },
    'fumbles%': {
      label: 'fumbles%',
      take: (r, s) => [st(r, s, 'fumbles') * 100, team(r, s).rushAtt + team(r, s).passCmp],
    },
    'pressure%': {
      label: 'pressure%',
      take: (r, s) => [st(r, other(s), 'pressures') * 100, team(r, s).passAtt + team(r, s).sacked],
    },
    penalties: { label: 'penalties', take: (r, s) => [team(r, s).penalties, 1] },
    'fg%': { label: 'fg%', take: (r, s) => [st(r, s, 'fgMade') * 100, st(r, s, 'fgAtt')] },
    'opp kr/g': { label: 'opp kr/g', take: (r, s) => [st(r, other(s), 'krAtt'), 1] },
    'punt avg': { label: 'punt avg', take: (r, s) => [st(r, s, 'puntYds'), st(r, s, 'punts')] },
    'ret yds/punt': { label: 'ret yds/punt', take: (r, s) => [st(r, other(s), 'prYds'), st(r, s, 'punts')] },
    'blocked%': {
      label: 'blocked%',
      take: (r, s) => [st(r, s, 'puntsBlocked') * 100, st(r, s, 'punts') + st(r, s, 'puntsBlocked')],
    },
    // Quarterback runs (designed runs and scrambles): how often, and how far.
    'QB runs/g': { label: 'QB runs/g', take: (r, s) => [qbStat(r, s, 'rushAtt'), 1] },
    'QB ypc': { label: 'QB ypc', take: (r, s) => [qbStat(r, s, 'rushYds'), qbStat(r, s, 'rushAtt')] },
  };
  /** Each quirk's stat and which way it should move. Defensive quirks move the other side's offense, so league totals carry them either way. */
  const EXPECT: Record<QuirkId, [string, 1 | -1]> = {
    muddyPockets: ['sack%', -1],
    staresDown: ['int%', 1],
    gunslinger: ['int%', 1],
    finishesForward: ['yds/carry', 1],
    looseCarriage: ['fumbles%', 1],
    dwellsInHole: ['stuff%', 1],
    yacSlasher: ['yds/rec', 1],
    goesUpForIt: ['yds/att', 1],
    hearsFootsteps: ['cmp%', -1],
    anchor: ['pressure%', -1],
    handPlacement: ['penalties', 1],
    pancakePreacher: ['stuff%', 1],
    firstStep: ['pressure%', 1],
    bitesOnPlayAction: ['yds/att', 1],
    bullRush: ['pressure%', 1],
    zoneHawk: ['int%', 1],
    manDeficit: ['RB+TE yds/tgt', 1],
    gapShooter: ['stuff%', 1],
    fluidHips: ['yds/att', -1],
    bitesOnDoubleMoves: ['yds/rec', 1],
    playsTheBall: ['int%', 1],
    iceWater: ['fg%', 1],
    boomerLeg: ['opp kr/g', -1],
    coffinCorner: ['ret yds/punt', -1],
    outkicksCoverage: ['ret yds/punt', 1],
    // Step 2.
    seesGhosts: ['int%', 1],
    yips: ['fg%', -1],
    safetyEyes: ['yds/att', 1],
    noHuddle: ['yds/att', 1],
    bailsEarly: ['QB runs/g', 1],
    patsTheBall: ['sack%', 1],
    hardCount: ['penalties', 1],
    patientPresser: ['yds/carry', 1],
    blitzPickup: ['sack%', -1],
    softHands: ['RB+TE yds/tgt', 1],
    highKnee: ['fumbles%', 1],
    jumpCutter: ['stuff%', 1],
    bouncesExternal: ['stuff%', 1],
    shortArm: ['cmp%', -1],
    contactAverse: ['yds/carry', -1],
    lateHands: ['cmp%', 1],
    stemsDB: ['yds/att', 1],
    getsJammed: ['yds/att', -1],
    bodyCatcher: ['cmp%', -1],
    runsEastWest: ['yds/rec', -1],
    secondLevel: ['yds/carry', 1],
    finishedToDirt: ['yds/carry', 1],
    heavyPunch: ['sack%', -1],
    stuntCommunicator: ['pressure%', -1],
    waistBender: ['pressure%', 1],
    heavyFeet: ['pressure%', 1],
    lungesAtStunts: ['pressure%', 1],
    pullsSoft: ['yds/carry', -1],
    twoTapSet: ['pressure%', -1],
    planAdjuster: ['pressure%', 1],
    unblockable: ['yds/carry', -1],
    highMotor: ['yds/carry', -1],
    battenDown: ['yds/carry', -1],
    losesContainment: ['QB ypc', 1],
    armTackler: ['yds/carry', 1],
    gassed: ['pressure%', -1],
    jumpHappy: ['penalties', 1],
    bendsArc: ['sack%', 1],
    diagnoses: ['yds/carry', -1],
    scraper: ['yds/carry', -1],
    thumper: ['yds/carry', -1],
    greenDog: ['pressure%', 1],
    stuckOnBlocks: ['yds/carry', 1],
    slowFlow: ['yds/carry', 1],
    misreadsKeys: ['yds/att', 1],
    spotDrop: ['cmp%', -1],
    baitsQB: ['int%', 1],
    physicalJammer: ['yds/att', -1],
    alleyCrusher: ['yds/carry', -1],
    ballStripper: ['fumbles%', 1],
    handsy: ['penalties', 1],
    businessDecision: ['yds/rec', 1],
    peeks: ['yds/att', 1],
    catchPoint: ['cmp%', 1],
    offMan: ['yds/rec', -1],
    quickRelease: ['blocked%', -1],
    slingFoot: ['blocked%', 1],
    highArc: ['ret yds/punt', -1],
  };

  const make = (q: QuirkId | null) => {
    const l = createLeague({ seed: 'audit' });
    for (const p of Object.values(l.players)) {
      delete p.quirks;
      if (q && (QUIRKS[q].positions as readonly string[]).includes(p.position)) p.quirks = { [q]: 2 };
    }
    return l;
  };
  type Rows = Record<string, [number, number][]>;
  const run = (l: League, from: number, to: number): Rows => {
    league = l;
    const rows: Rows = Object.fromEntries(Object.keys(METRICS).map((k) => [k, []]));
    for (let s = from; s < to; s++) {
      // Form carries from game to game (a slump, a beating), as in a real season; each replay starts fresh.
      for (const p of Object.values(l.players)) delete p.form;
      for (const g of l.games.filter((g) => !g.playoffRound).sort((a, b) => a.week - b.week)) {
        const r = simulateGame(l, g, { seed: `audit:${s}:${g.id}` });
        for (const [id, line] of Object.entries(r.playerStats))
          recordForm(l, l.players[Number(id)], g.week, line, r.form?.[Number(id)]);
        teams = [g.homeId, g.awayId];
        for (const side of [0, 1] as const) for (const [k, m] of Object.entries(METRICS)) rows[k].push(m.take(r, side));
      }
    }
    return rows;
  };
  const ratio = (rows: [number, number][]): [number, number] => {
    const num = rows.reduce((a, [n]) => a + n, 0);
    const den = rows.reduce((a, [, d]) => a + d, 0);
    if (!den) return [0, 0];
    const R = num / den;
    return [R, Math.sqrt(rows.reduce((a, [n, d]) => a + (n - R * d) ** 2, 0)) / den];
  };
  const z = (t: [number, number][], b: [number, number][]) => {
    const [tv, ts] = ratio(t);
    const [bv, bs] = ratio(b);
    return { delta: tv - bv, z: (tv - bv) / (Math.sqrt(ts ** 2 + bs ** 2) || 1) };
  };

  const merge = (a: Rows, b: Rows): Rows => Object.fromEntries(Object.entries(a).map(([k, v]) => [k, [...v, ...b[k]]]));
  console.log(
    `\nQuirk effects: each quirk on every player at its positions, ${seasons} season(s) (${seasons * 3} for close calls, ${seasons * 6} for the closest)\n`,
  );
  const baseLeague = make(null);
  const base = run(baseLeague, 0, seasons);
  let wideBase: Rows | null = null;
  let widerBase: Rows | null = null;
  const flagged: string[] = [];
  for (const q of QUIRK_IDS.filter((id) => !only || only.includes(id))) {
    const [metric, dir] = EXPECT[q];
    const l = make(q);
    let test = run(l, 0, seasons);
    let m = z(test[metric], base[metric]);
    if (m.z * dir < 3) {
      wideBase ??= merge(base, run(baseLeague, seasons, seasons * 3));
      test = merge(test, run(l, seasons, seasons * 3));
      m = z(test[metric], wideBase[metric]);
    }
    // Still short of "weak": a rare trigger (Sees Ghosts needs two sacks in a game) needs more games to show, not a lower bar.
    if (m.z * dir < 2) {
      widerBase ??= merge(wideBase!, run(baseLeague, seasons * 3, seasons * 6));
      test = merge(test, run(l, seasons * 3, seasons * 6));
      m = z(test[metric], widerBase[metric]);
    }
    const verdict =
      m.z * dir >= 3 ? 'moves play' : m.z * dir >= 2 ? 'weak' : m.z * dir <= -2 ? 'WRONG WAY' : 'NO EFFECT';
    if (verdict === 'NO EFFECT' || verdict === 'WRONG WAY') flagged.push(q);
    console.log(
      `${q.padEnd(20)} ${metric.padEnd(13)} ${(m.delta >= 0 ? '+' : '') + m.delta.toFixed(2)}`.padEnd(44) +
        `z ${m.z.toFixed(1).padStart(5)}  ${verdict}`,
    );
  }
  if (flagged.length) {
    failed = true;
    console.log(`\nNeeds attention: ${flagged.join(', ')}`);
  } else console.log('\nEvery quirk moves its stat the right way.');
}

churn();
if (effects) effectAudit();
if (failed) process.exitCode = 1;
