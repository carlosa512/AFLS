import { beforeAll, describe, expect, it } from 'vitest';
import {
  activeCoachQuirks,
  coachBag,
  coachHabitChangeText,
  coachPlayerFit,
  coachQuirkPool,
  coachQuirksOffseason,
  coachQuirksWeek,
  COACH_QUIRK_IDS,
  COACH_QUIRKS,
  roomCare,
  drawCoachMarbles,
  generateCoachQuirks,
  inheritCoachQuirk,
  reconcileCoachBag,
} from './coachQuirks';
import { assessCoachAdvice, coachOrder, coachTeachingWeek, updateCoachAdvice } from './coachDecisions';
import { coachAdviceObservation, userCoachGameObservation } from './coachReports';
import { asPromoted, coachingForPlayer, teamCoaches } from './coaching';
import { createLeague, SAVE_VERSION } from './generate';
import { recordResult } from './league';
import {
  habitCalls,
  canDeferTimeout,
  shortGoalDecision,
  fourthDownHabit,
  longKickHabit,
  twoPointHabit,
  twoPointSpot,
  upTempoEligible,
} from './match/coachHabits';
import type { Situation } from './match/coach';
import { simulateGame, startGame } from './match/gameSim';
import { migrateLeague } from './migrate';
import { syncDepthChart, teamPlayers, isAvailable } from './roster';
import { Rng } from './rng';
import type { Coach, League } from './types';

const clone = <T>(x: T): T => structuredClone(x);
let world: League;
beforeAll(() => {
  world = createLeague({ seed: 'coach-habits-tests' });
});
const example = (): Coach => ({
  id: 99,
  firstName: 'Sam',
  lastName: 'Test',
  age: 40,
  role: 'positionCoach',
  room: 'WR',
  youth: 11,
  veterans: 11,
  teamId: 0,
  contract: null,
});
const situation: Situation = {
  quarter: 1,
  clock: 600,
  down: 1,
  distance: 10,
  yardLine: 40,
  scoreDiff: 0,
  offTimeouts: 3,
  defTimeouts: 3,
  overtime: false,
  fgMakeProb: 0.1,
};

describe('coaching habit identity and persistence', () => {
  it('has exactly six types for every initial role, without extending excluded departments', () => {
    for (const role of ['headCoach', 'offCoord', 'defCoord', 'positionCoach'] as const)
      expect(coachQuirkPool(role)).toHaveLength(6);
    expect(COACH_QUIRK_IDS).toHaveLength(24);
    expect(coachQuirkPool('strengthCoach')).toEqual([]);
    expect(coachQuirkPool('stCoord')).toEqual([]);
  });
  it('keeps forming and role-ineligible habits inactive, and activates them on promotion', () => {
    const c = example();
    c.quirks = { shotPlayArchitect: 3, patientTeacher: 1, earnYourReps: 2 };
    expect(activeCoachQuirks(c)).toEqual(['earnYourReps']);
    const promoted = asPromoted(world, c, { role: 'offCoord' });
    expect(activeCoachQuirks(promoted)).toEqual(['shotPlayArchitect']);
    expect(c.role).toBe('positionCoach');
    expect(promoted.quirks).toEqual(c.quirks);
  });
  it('generates stable bounded histories independently and preserves a loaded bag', () => {
    const a = example(),
      b = example();
    const rng = clone(world.rngState);
    generateCoachQuirks(world.seed, a);
    generateCoachQuirks(world.seed, b);
    expect(a).toEqual(b);
    expect(Object.keys(a.quirks ?? {}).length).toBeLessThanOrEqual(4);
    expect(activeCoachQuirks(a).length).toBeLessThanOrEqual(2);
    const loaded = clone(a);
    generateCoachQuirks(world.seed, loaded);
    expect(loaded).toEqual(a);
    expect(world.rngState).toEqual(rng);
  });
  it('does not refill a drawn promotion marble by changing chairs again', () => {
    const c = example();
    c.youth = c.veterans = 14;
    c.quirkBag = coachBag(c);
    c.role = 'offCoord';
    reconcileCoachBag(c);
    expect(c.quirkBag.shotPlayArchitect).toBe(1);
    delete c.quirkBag.shotPlayArchitect;
    c.role = 'headCoach';
    reconcileCoachBag(c);
    c.role = 'offCoord';
    reconcileCoachBag(c);
    expect(c.quirkBag.shotPlayArchitect).toBeUndefined();
  });
  it('lets ordinary coaches develop a schematic strength without a hard teaching-rating cutoff', () => {
    const c = example();
    c.role = 'offCoord';
    expect(coachBag(c).shotPlayArchitect).toBeGreaterThan(0);
    c.quirkBag = { shotPlayArchitect: 2 };
    drawCoachMarbles(c, new Rng('ordinary-schemer'), 2);
    expect(c.quirks?.shotPlayArchitect).toBe(2);
    c.youth = c.veterans = 8;
    expect(activeCoachQuirks(c)).toContain('shotPlayArchitect');
    c.quirkBag = { 'fix:shotPlayArchitect': 1 };
    drawCoachMarbles(c, new Rng('still-can-fade'), 1);
    expect(activeCoachQuirks(c)).not.toContain('shotPlayArchitect');
  });
  it('biases formation toward stronger coaches while letting experience reinforce the habit', () => {
    const c = example();
    c.role = 'offCoord';
    c.youth = c.veterans = 8;
    expect(coachBag(c).shotPlayArchitect).toBe(1);
    c.youth = c.veterans = 11;
    expect(coachBag(c).shotPlayArchitect).toBe(2);
    c.youth = c.veterans = 14;
    expect(coachBag(c).shotPlayArchitect).toBe(3);
    c.quirkEvidence = { shotPlayArchitect: 32, scriptedOpening: 32 };
    expect(coachBag(c).shotPlayArchitect).toBe(4);
    // Two marbles of its own (good habits are a minority's trait too), plus experience's two.
    expect(coachBag(c).scriptedOpening).toBe(4);
  });
  it('builds initial habit histories from final budget-fitted ratings', () => {
    for (const seed of ['coach-rarity-14', 'coach-rarity-16']) {
      const l = createLeague({ seed });
      for (const c of Object.values(l.coaches).filter((c) => c.teamId !== null && c.role === 'offCoord')) {
        const replay = clone(c);
        delete replay.quirks;
        delete replay.quirkBag;
        generateCoachQuirks(l.seed, replay);
        expect(replay.quirks).toEqual(c.quirks);
        expect(replay.quirkBag).toEqual(c.quirkBag);
      }
    }
  });
  it('makes annual progression idempotent and gradually changes bounded grips', () => {
    const l = clone(world),
      c = example();
    c.quirks = { earnYourReps: 2 };
    c.quirkBag = { 'fix:earnYourReps': 1, blank: 1 };
    coachQuirksOffseason(l, c);
    const once = clone(c);
    coachQuirksOffseason(l, c);
    expect(c).toEqual(once);
    for (let i = 0; i < 30; i++) {
      l.season++;
      coachQuirksOffseason(l, c);
    }
    expect(Object.values(c.quirks ?? {}).every((g) => g >= 1 && g <= 3)).toBe(true);
    expect(c.quirkLog!.length).toBeLessThanOrEqual(12);
  });
  it('forms and loses a habit gradually, draws without replacement, and resists ingrained fixes', () => {
    const c = example();
    c.role = 'offCoord';
    c.youth = c.veterans = 14;
    c.quirkBag = { shotPlayArchitect: 1 };
    drawCoachMarbles(c, new Rng('first'), 10);
    expect(c.quirks?.shotPlayArchitect).toBe(1);
    expect(activeCoachQuirks(c)).toEqual([]);
    c.quirkBag = { shotPlayArchitect: 1 };
    drawCoachMarbles(c, new Rng('second'), 1);
    expect(activeCoachQuirks(c)).toContain('shotPlayArchitect');
    c.quirkBag = { 'fix:shotPlayArchitect': 1 };
    drawCoachMarbles(c, new Rng('fix'), 1);
    expect(c.quirks?.shotPlayArchitect).toBe(1);
    let resisted = 0;
    for (let i = 0; i < 100; i++) {
      c.quirks = { shotPlayArchitect: 3 };
      c.quirkBag = { 'fix:shotPlayArchitect': 1 };
      drawCoachMarbles(c, new Rng(`ingrained-${i}`), 1);
      resisted += Number(c.quirks.shotPlayArchitect === 3);
    }
    expect(resisted).toBeGreaterThan(30);
    expect(resisted).toBeLessThan(70);
  });
  it('keeps dated gains, weakening and complete losses after the habit disappears', () => {
    const c = example();
    for (const [week, key] of ['earnYourReps', 'earnYourReps', 'fix:earnYourReps', 'fix:earnYourReps'].entries()) {
      c.quirkBag = { [key]: 1 };
      drawCoachMarbles(c, new Rng(`history-${week}`), 1, { season: 2028, week: week + 1 });
    }
    expect(c.quirks?.earnYourReps).toBeUndefined();
    const saved = JSON.parse(JSON.stringify(c)) as Coach;
    expect(saved.quirkLog?.map((e) => [e.from, e.grip, e.season, e.week])).toEqual([
      [0, 1, 2028, 1],
      [1, 2, 2028, 2],
      [2, 1, 2028, 3],
      [1, 0, 2028, 4],
    ]);
    expect(saved.quirkLog?.map(coachHabitChangeText)).toEqual([
      'Earn Your Reps began forming',
      'Gained Earn Your Reps',
      'Earn Your Reps faded to a forming habit',
      'Lost Earn Your Reps',
    ]);
    expect(coachHabitChangeText({ id: 'earnYourReps', grip: 1, season: 2026, week: 2 })).toContain('was forming');
  });
  it('inherits selectively, at most once, without changing entry probabilities', () => {
    const p = clone(Object.values(world.players).find((p) => p.position === 'QB')!);
    p.quirks = { gunslinger: 3 };
    let inherited = 0;
    for (let i = 0; i < 50; i++) {
      const c = example();
      inheritCoachQuirk(`inherit-${i}`, c, p);
      if (!c.quirkOrigin) continue;
      inherited++;
      expect(c.quirkOrigin.id).toBe('shotPlayArchitect');
      expect(c.quirks?.shotPlayArchitect).toBeGreaterThanOrEqual(1);
      expect(c.quirks?.shotPlayArchitect).toBeLessThanOrEqual(2);
      expect(activeCoachQuirks(c)).not.toContain('shotPlayArchitect');
      const once = clone(c);
      inheritCoachQuirk('another-seed', c, p);
      expect(c).toEqual(once);
    }
    expect(inherited).toBeGreaterThan(0);
    expect(inherited).toBeLessThan(50);
  });
  it('migrates existing coaches once without altering completed games', () => {
    const l = clone(world);
    l.version = 40;
    for (const c of Object.values(l.coaches)) {
      delete c.quirks;
      delete c.quirkBag;
    }
    const games = clone(l.games);
    expect(migrateLeague(l)?.version).toBe(SAVE_VERSION);
    const once = clone(l);
    migrateLeague(l);
    expect(l).toEqual(once);
    expect(l.games).toEqual(games);
  });
});

describe('football boundaries and recorded facts', () => {
  it('limits calling effects to their situations, including forced endings', () => {
    const o = new Set<'settlesForThree' | 'goesIntoShell'>(['settlesForThree', 'goesIntoShell']);
    expect(habitCalls(situation, o, new Set(), 1).passShift).toBe(0);
    expect(habitCalls({ ...situation, fgMakeProb: 0.9 }, o, new Set(), 1).passShift).toBe(-0.05);
    expect(
      habitCalls({ ...situation, quarter: 4, clock: 20, scoreDiff: -7, fgMakeProb: 0.9 }, o, new Set(), 1).passShift,
    ).toBe(0);
    expect(
      habitCalls({ ...situation, quarter: 4, clock: 500, scoreDiff: 3, fgMakeProb: 0.9 }, o, new Set(), 1).passShift,
    ).toBe(-0.1);
    expect(canDeferTimeout({ ...situation, quarter: 4, clock: 100, scoreDiff: 7 })).toBe(true);
    expect(canDeferTimeout({ ...situation, quarter: 4, clock: 30, scoreDiff: 7 })).toBe(false);
    expect(shortGoalDecision({ ...situation, down: 4, yardLine: 98, distance: 2, fgMakeProb: 0.9 })).toBe(true);
    expect(
      shortGoalDecision({ ...situation, quarter: 4, clock: 20, down: 4, yardLine: 98, distance: 2, fgMakeProb: 0.9 }),
    ).toBe(false);
  });
  it('can trigger either rare goal-line habit without changing forced decisions', () => {
    const s = { ...situation, down: 4, yardLine: 98, distance: 2, fgMakeProb: 0.9 };
    const rng = new Rng('rare-hc-decisions');
    let takes = 0,
      backs = 0;
    for (let i = 0; i < 2000; i++) {
      takes += Number(fourthDownHabit(s, 'go', new Set(['takesThePoints']), rng).takes);
      backs += Number(fourthDownHabit(s, 'fg', new Set(['backsHisOffense']), rng).backs);
    }
    expect(takes).toBeGreaterThan(50);
    expect(takes).toBeLessThan(150);
    expect(backs).toBeGreaterThan(50);
    expect(backs).toBeLessThan(150);
    expect(fourthDownHabit({ ...s, quarter: 4, clock: 10 }, 'go', new Set(['takesThePoints']), rng).decision).toBe(
      'go',
    );
  });
  it('preserves baseline football exactly when no applicable quirks are active', () => {
    const l = clone(world);
    for (const c of Object.values(l.coaches)) c.quirks = {};
    const on = simulateGame(l, l.games[0], { seed: 'no-habits', keepPlays: true });
    const off = simulateGame(l, l.games[0], { seed: 'no-habits', keepPlays: true, coachQuirks: false });
    delete on.coaching;
    expect(on).toEqual(off);
  });
  it('preserves live/batch and logging parity, and limits designed shots', () => {
    const l = clone(world),
      g = l.games[0];
    for (const c of teamCoaches(l, g.homeId))
      if (c.role === 'offCoord') c.quirks = { shotPlayArchitect: 3, scriptedOpening: 2 };
    // Player habits can amplify the opportunity, but cannot create extra coaching tokens.
    l.players[l.teams[g.homeId].depthChart.QB[0]].quirks = { gunslinger: 3, safetyEyes: 2 };
    const before = clone(l);
    const batch = simulateGame(l, g, { seed: 'shots', keepPlays: true });
    const live = startGame(l, g, { seed: 'shots' });
    while (!live.over) live.next();
    expect(live.result()).toEqual(batch);
    const quiet = simulateGame(l, g, { seed: 'shots', keepPlays: false });
    expect(quiet.coaching).toEqual(batch.coaching);
    expect(quiet.home).toEqual(batch.home);
    expect(quiet.playerStats).toEqual(batch.playerStats);
    expect(l).toEqual(before);
    let attempts = 0;
    for (let i = 0; i < 12; i++) {
      const r = simulateGame(l, g, { seed: `shot-budget-${i}` });
      const report = r.coaching?.find((r) => r.teamId === g.homeId && r.role === 'offCoord');
      const shots = report?.uses.shotPlayArchitect ?? 0;
      attempts += shots;
      expect(shots).toBeLessThanOrEqual(2);
    }
    expect(attempts).toBeGreaterThan(0);
  });
  it('records progression evidence once, including playoff games, and weekly draws once', () => {
    const l = clone(world),
      g = l.games[0];
    g.playoffRound = 'FINAL';
    const r = simulateGame(l, g);
    recordResult(l, g, r);
    const evidence = clone(Object.values(l.coaches).map((c) => c.quirkEvidence));
    recordResult(l, g, r);
    expect(Object.values(l.coaches).map((c) => c.quirkEvidence)).toEqual(evidence);
    l.week = g.week;
    coachQuirksWeek(l);
    const once = clone(l.coaches);
    coachQuirksWeek(l);
    expect(l.coaches).toEqual(once);
  });
  it('attributes self-reactions correctly and preserves departed coaches in game facts', () => {
    const l = clone(world),
      g = clone(l.games.find((g) => g.homeId === l.userTeamId)!);
    const c = teamCoaches(l, l.userTeamId).find((c) => c.role === 'headCoach')!;
    g.result = simulateGame(l, g);
    g.result.coaching = [
      {
        coachId: c.id,
        name: `${c.firstName} ${c.lastName}`,
        role: 'headCoach',
        teamId: l.userTeamId,
        opportunities: {},
        choices: {},
        uses: {},
        events: [
          { quirk: 'clingsToTimeouts', quarter: 4, clock: 100, text: 'Held a defensive timeout through another snap.' },
        ],
      },
    ];
    expect(userCoachGameObservation(l, g, c.id)).toBe('I held a defensive timeout through another snap.');
    const name = `${c.firstName} ${c.lastName}`;
    c.firstName = 'Changed';
    expect(userCoachGameObservation(l, g, -1)).toContain(name);
  });
  it('mentions designed shots only when the recorded gain or scoring-drive context warrants it', () => {
    const l = clone(world),
      g = clone(l.games.find((g) => g.homeId === l.userTeamId)!);
    g.result = simulateGame(l, g);
    const c = teamCoaches(l, l.userTeamId).find((c) => c.role === 'offCoord')!;
    g.result.coaching = [
      {
        coachId: c.id,
        name: 'Sam Caller',
        role: 'offCoord',
        teamId: l.userTeamId,
        opportunities: {},
        choices: {},
        uses: { shotPlayArchitect: 1 },
        events: [{ quirk: 'shotPlayArchitect', quarter: 1, clock: 500, text: 'Designed a deep shot.' }],
      },
    ];
    g.result.plays = [
      {
        quarter: 1,
        clock: 500,
        offense: l.userTeamId,
        down: 1,
        distance: 10,
        yardLine: 25,
        kind: 'pass',
        from: 25,
        to: 61,
        text: 'Designed shot: 36-yard completion.',
        homeScore: 0,
        awayScore: 0,
      },
    ];
    expect(userCoachGameObservation(l, g)).toBe('');
    const play = g.result.plays[0];
    play.to = 75;
    expect(userCoachGameObservation(l, g)).toContain('50-yard completion in the first quarter');
    play.scoring = true;
    play.homeScore = 6;
    play.to = 102;
    play.from = 52;
    expect(userCoachGameObservation(l, g)).toContain('48-yard touchdown to put us ahead');
    play.scoring = false;
    play.homeScore = 0;
    play.to = 75;
    play.from = 25;
    g.result.plays.unshift({ ...play, clock: 550, homeScore: 28, awayScore: 0 });
    expect(userCoachGameObservation(l, g)).toBe('');
    g.result.plays.shift();
    play.to = 61;
    play.quarter = 4;
    play.clock = 100;
    g.result.coaching[0].events[0].quarter = 4;
    g.result.coaching[0].events[0].clock = 100;
    g.result.plays.push({ ...play, clock: 60, text: 'Touchdown!', homeScore: 6, awayScore: 0, scoring: true, to: 100 });
    expect(userCoachGameObservation(l, g)).toContain('36-yard completion on our late go-ahead scoring drive');
    g.result.plays.splice(1, 0, { ...play, clock: 80, offense: g.awayId, kind: 'run', text: 'Opponent possession.' });
    expect(userCoachGameObservation(l, g)).toBe('');
    delete g.result.plays;
    expect(userCoachGameObservation(l, g)).toBe('');
  });
});

describe('player fit, recommendations and teaching', () => {
  it.each([
    { targets: 6, rec: 4, yards: 101, applied: true, phrase: 'consider keeping the change' },
    { targets: 8, rec: 1, yards: 8, applied: true, phrase: 'consider moving back to Veteran Test' },
    { targets: 2, rec: 1, yards: 8, applied: true, phrase: 'not enough clear evidence' },
    { targets: 6, rec: 4, yards: 101, applied: false, phrase: 'cannot judge it as a starting trial' },
  ])('reviews the trial from actual opportunities: $phrase', ({ targets, rec, yards, applied, phrase }) => {
    const l = clone(world),
      t = l.teams[l.userTeamId],
      p = teamPlayers(l, t.id).find((p) => p.position === 'WR')!,
      c = teamCoaches(l, t.id).find((c) => c.room === 'WR')!;
    const baseline = { ...p.stats[l.season] };
    t.coachAdvice = [
      {
        season: l.season,
        week: 1,
        coachId: c.id,
        coachName: 'Sam Coach',
        position: 'WR',
        playerId: p.id,
        playerName: 'Rookie Test',
        aheadId: -1,
        aheadName: 'Veteran Test',
        reason: 'trusts his preparation',
        applied: false,
        baselineGames: baseline.gp ?? 0,
        baselineStats: baseline,
      },
    ];
    t.autoDepth = false;
    t.depthChart.WR = t.depthChart.WR.filter((id) => id !== p.id);
    t.depthChart.WR.splice(applied ? 0 : t.depthChart.WR.length, 0, p.id);
    p.stats[l.season] = {
      ...baseline,
      gp: (baseline.gp ?? 0) + 2,
      targets: (baseline.targets ?? 0) + targets,
      rec: (baseline.rec ?? 0) + rec,
      recYds: (baseline.recYds ?? 0) + yards,
    };
    updateCoachAdvice(l, t, teamCoaches(l, t.id), teamPlayers(l, t.id).filter(isAvailable));
    expect(t.coachAdvice[0].resolved).toContain(phrase);
    expect(t.coachAdvice[0].resolved).not.toContain('holds a starting place');
    const chart = clone(t.depthChart);
    updateCoachAdvice(l, t, teamCoaches(l, t.id), teamPlayers(l, t.id).filter(isAvailable));
    expect(t.depthChart).toEqual(chart);
  });
  it('changes coaching effectiveness in both directions without rewriting makeup', () => {
    const l = clone(world),
      p = teamPlayers(l, 0).find((p) => p.position === 'WR')!;
    const c = teamCoaches(l, 0).find((c) => c.room === 'WR')!;
    c.quirks = { earnYourReps: 2 };
    p.traits.workEthic = 20;
    const good = coachingForPlayer(l, p).rate;
    p.traits.workEthic = 2;
    p.traits.temperament = 2;
    const bad = coachingForPlayer(l, p).rate;
    expect(good).toBeGreaterThan(bad);
    expect(coachPlayerFit(c, p)).toBeGreaterThanOrEqual(-0.05);
    const traits = clone(p.traits);
    coachingForPlayer(l, p);
    expect(p.traits).toEqual(traits);
  });
  it('swings a near tie but never a clear ability gap, and preserves manual charts', () => {
    const l = clone(world),
      t = l.teams[0];
    const pool = teamPlayers(l, 0).filter((p) => p.position === 'WR');
    const c = teamCoaches(l, 0).find((c) => c.room === 'WR')!;
    c.quirks = { earnYourReps: 2 };
    const a = clone(pool[0]),
      b = clone(pool[1]);
    a.ratings = clone(b.ratings);
    a.traits.workEthic = 1;
    b.traits.workEthic = 20;
    expect(coachOrder([a, b], 'WR', [c])[0].id).toBe(b.id);
    for (const key of Object.keys(a.ratings) as (keyof typeof a.ratings)[]) a.ratings[key] = 20;
    expect(coachOrder([a, b], 'WR', [c])[0].id).toBe(a.id);
    t.autoDepth = false;
    syncDepthChart(l, t);
    const chart = clone(t.depthChart);
    syncDepthChart(l, t);
    expect(t.depthChart).toEqual(chart);
  });
  it('keeps recommendation reports pure and suppresses already published thread notes', () => {
    const l = clone(world),
      t = l.teams[l.userTeamId],
      p = teamPlayers(l, t.id)[0],
      c = teamCoaches(l, t.id)[0];
    const before = clone(l);
    assessCoachAdvice(l, t, teamCoaches(l, t.id), teamPlayers(l, t.id).filter(isAvailable));
    expect(l).toEqual(before);
    t.coachAdvice = [
      {
        season: l.season,
        week: 1,
        coachId: c.id,
        coachName: 'Sam Coach',
        position: p.position,
        playerId: p.id,
        playerName: 'Rookie Test',
        aheadId: -1,
        aheadName: 'Veteran Test',
        reason: 'trusts his preparation',
        applied: false,
        baselineGames: 0,
      },
    ];
    const note = coachAdviceObservation(l)!;
    expect(note.text).toContain('Rookie Test');
    l.inbox = [{ coachNoteKey: note.key, week: l.week } as NonNullable<League['inbox']>[number]];
    expect(coachAdviceObservation(l)).toBeUndefined();
    p.teamId = null;
    updateCoachAdvice(l, t, teamCoaches(l, t.id), []);
    expect(t.coachAdvice[0].resolved).toContain('personnel');
  });
  it('bounds technique interventions per coach/block without changing player grip directly', () => {
    const l = clone(world),
      c = teamCoaches(l, 0).find((c) => c.room === 'RB')!,
      p = teamPlayers(l, 0).find((p) => p.position === 'RB')!;
    c.quirks = { techniqueStickler: 3 };
    p.quirks = { looseCarriage: 2 };
    p.quirkBag = { blank: 30, 'fix:looseCarriage': 5 };
    for (let i = 0; i < 20; i++) coachTeachingWeek(l, [c], [p]);
    expect(p.quirkBag['fix:looseCarriage']).toBeLessThanOrEqual(6);
    expect(p.quirks.looseCarriage).toBe(2);
  });
});

describe('second-wave habits', () => {
  it('keeps every habit a minority trait: no habit in more than three chairs in ten', () => {
    const held: Record<string, number> = {};
    const chairs: Record<string, number> = {};
    // Four leagues: one league's 32 chairs per role are too few to read a share from.
    const leagues = [world, ...[1, 2, 3].map((i) => createLeague({ seed: `coach-share-${i}` }))];
    for (const c of leagues.flatMap((l) => Object.values(l.coaches))) {
      if (c.teamId === null) continue;
      chairs[c.role] = (chairs[c.role] ?? 0) + 1;
      for (const q of activeCoachQuirks(c)) held[q] = (held[q] ?? 0) + 1;
    }
    for (const id of COACH_QUIRK_IDS) expect((held[id] ?? 0) / chairs[COACH_QUIRKS[id].role]).toBeLessThan(0.3);
  });
  it('never forms both habits of an opposed pair', () => {
    const c = example();
    c.role = 'offCoord';
    c.quirks = { settlesForThree: 2 };
    c.quirkBag = { attacksEndZone: 5 };
    drawCoachMarbles(c, new Rng('opposed'), 5);
    expect(c.quirks.attacksEndZone).toBeUndefined();
    const p = example();
    p.quirks = { keepsThemFresh: 1 };
    p.quirkBag = { runsHardPractices: 5 };
    drawCoachMarbles(p, new Rng('opposed-room'), 5);
    expect(p.quirks.runsHardPractices).toBeUndefined();
  });
  it('goes for two only in the chart spots the default call leaves to the kick', () => {
    const third = { ...situation, quarter: 3, clock: 400 };
    expect(twoPointSpot({ ...third, scoreDiff: -8 })).toBe(true);
    expect(twoPointSpot({ ...third, scoreDiff: -2 })).toBe(true);
    expect(twoPointSpot({ ...third, scoreDiff: -7 })).toBe(false);
    expect(twoPointSpot({ ...situation, quarter: 2, scoreDiff: -8 })).toBe(false);
    // The fourth quarter's chart already goes for two at -2: nothing for the habit to add there.
    expect(twoPointSpot({ ...third, quarter: 4, scoreDiff: -2 })).toBe(false);
    expect(twoPointSpot({ ...third, quarter: 4, scoreDiff: -8 })).toBe(true);
    const rng = new Rng('two');
    expect(twoPointHabit({ ...third, scoreDiff: -8 }, new Set(), rng).goes).toBe(false);
    let goes = 0;
    for (let i = 0; i < 500; i++)
      goes += Number(twoPointHabit({ ...third, scoreDiff: -8 }, new Set(['goesForTwo']), rng).goes);
    expect(goes).toBeGreaterThan(350);
  });
  it('passes on a long kick only for a kicker he does not trust, and never on a forced one', () => {
    const s = { ...situation, down: 4, distance: 6, yardLine: 66, fgMakeProb: 0.62 };
    const habit = new Set(['distrustsLongKick'] as const);
    const rng = new Rng('long');
    let passes = 0;
    for (let i = 0; i < 500; i++) passes += Number(longKickHabit(s, 'fg', habit, false, rng).passes);
    expect(passes).toBeGreaterThan(250);
    expect(passes).toBeLessThan(350);
    for (let i = 0; i < 200; i++) expect(longKickHabit(s, 'fg', habit, true, rng).decision).toBe('fg');
    expect(longKickHabit({ ...s, fgMakeProb: 0.9 }, 'fg', habit, false, rng).eligible).toBe(false);
    expect(longKickHabit({ ...s, quarter: 4, clock: 60 }, 'fg', habit, false, rng).eligible).toBe(false);
    expect(longKickHabit({ ...s, quarter: 2, clock: 30 }, 'fg', habit, false, rng).eligible).toBe(false);
    const short = { ...s, distance: 2 };
    for (let i = 0; i < 50; i++) {
      const d = longKickHabit(short, 'fg', habit, false, rng).decision;
      expect(d === 'go' || d === 'fg').toBe(true);
    }
  });
  it('limits the new calling effects to their situations', () => {
    expect(upTempoEligible({ ...situation, quarter: 2, clock: 140 })).toBe(true);
    expect(upTempoEligible({ ...situation, quarter: 2, clock: 400 })).toBe(false);
    expect(upTempoEligible({ ...situation, quarter: 3, clock: 200, scoreDiff: -10 })).toBe(true);
    expect(upTempoEligible({ ...situation, quarter: 3, clock: 200, scoreDiff: -4 })).toBe(false);
    expect(upTempoEligible({ ...situation, quarter: 4, clock: 600, scoreDiff: -4 })).toBe(true);
    expect(upTempoEligible({ ...situation, quarter: 4, clock: 600, scoreDiff: 4 })).toBe(false);
    expect(upTempoEligible({ ...situation, quarter: 1, scoreDiff: -10 })).toBe(false);
    const attack = new Set(['attacksEndZone'] as const);
    expect(habitCalls({ ...situation, yardLine: 85 }, attack, new Set(), 10).passShift).toBeCloseTo(0.03);
    expect(habitCalls({ ...situation, yardLine: 50 }, attack, new Set(), 10).passShift).toBe(0);
    const prevent = new Set(['playsPrevent'] as const);
    expect(
      habitCalls({ ...situation, quarter: 4, clock: 200, scoreDiff: -10 }, new Set(), prevent, 10).preventShell,
    ).toBe(true);
    expect(
      habitCalls({ ...situation, quarter: 4, clock: 200, scoreDiff: -4 }, new Set(), prevent, 10).preventShell,
    ).toBe(false);
    const disguise = new Set(['disguisesCoverages'] as const);
    expect(habitCalls({ ...situation, down: 3, distance: 9 }, new Set(), disguise, 10).disguise).toBe(true);
    expect(habitCalls({ ...situation, down: 1, distance: 10 }, new Set(), disguise, 10).disguise).toBe(false);
  });
  it('changes a room’s practice risk and recovery mildly, in opposite directions', () => {
    const fresh = { ...example(), quirks: { keepsThemFresh: 2 } };
    const hard = { ...example(), quirks: { runsHardPractices: 2 } };
    expect(roomCare(undefined)).toEqual({ practice: 1, recovery: 0 });
    expect(roomCare(fresh).practice).toBeLessThan(1);
    expect(roomCare(fresh).recovery).toBeGreaterThan(0);
    expect(roomCare(hard).practice).toBeGreaterThan(1);
    expect(roomCare(hard).practice).toBeLessThan(1.2);
    const p = teamPlayers(world, 0).find((x) => x.position === 'WR')!;
    expect(coachPlayerFit(hard, p)).toBeGreaterThan(coachPlayerFit(example(), p));
  });
});
