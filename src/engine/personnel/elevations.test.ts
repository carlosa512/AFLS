import { toCurve } from '../size';
import { beforeEach, describe, expect, it } from 'vitest';
import { createLeague, generatePlayer, SAVE_VERSION } from '../generate';
import { Rng } from '../rng';
import { activeRoster, practiceSquad, syncDepthChart } from '../roster';
import { capSpace, releasePlayer } from '../finance/cap';
import { playGame, recordResult, startLiveGame } from '../league';
import { simulateGame } from '../match/gameSim';
import { buildLineup } from '../match/lineup';
import { migrateLeague } from '../migrate';
import type { Game, Injury, League, Player, Position } from '../types';
import { fileElevations, preparePersonnelGame, settleWeek } from './flow';
import { gameTime } from './calendar';
import {
  cancelElevation,
  elevationCap,
  elevationCost,
  elevationMinimum,
  elevationProblem,
  elevationRecords,
  elevationUses,
  gameElevations,
  planAIElevations,
  planElevation,
} from './elevations';
import { autoGameDay, dressingLimit, gameDayPool, gameDayPreview, gameDayProblem, setGameDayPlan } from './gameDay';
import { acceptSquadOffer, promoteSquadPlayer, releaseSquadPlayer, squadPromotionPreview } from './squads';
import { initialService } from './service';
import { settleSquadPayroll, squadPayroll } from './payroll';

const template = createLeague({ seed: 'call-up-tests', personnel: true, userTeamId: 0 });
let l: League;
let g: Game;
const injury = (week = 1): Injury => ({
  type: 'Ankle sprain',
  severity: 'moderate',
  weeksRemaining: 4,
  estimate: [3, 5],
  season: 2026,
  week,
  where: 'game',
});
beforeEach(() => {
  l = structuredClone(template);
  g = l.games.filter((g) => g.week === 1).sort((a, b) => gameTime(a) - gameTime(b) || a.id - b.id)[0];
  l.userTeamId = g.homeId;
  for (const t of l.teams) t.carryover = 100_000;
});
function player(pos?: Position): Player {
  const found = practiceSquad(l, g.homeId).find((p) => !pos || p.position === pos);
  if (found) return found;
  releaseSquadPlayer(l, practiceSquad(l, g.homeId)[0]);
  const p = generatePlayer(new Rng(`callup-${pos}`), {
    id: l.nextPlayerId++,
    position: pos!,
    quality: 10,
    age: 22,
    teamId: null,
    jerseysUsed: new Set(),
  });
  p.contract = null;
  p.experience = 0;
  p.service = initialService(0, 2025);
  l.players[p.id] = p;
  acceptSquadOffer(l, { teamId: g.homeId, playerId: p.id, weeklyPay: 13.75 });
  return p;
}
function file(p: Player) {
  planElevation(l, p, g);
  fileElevations(l, g);
}
function playWith(p: Player) {
  file(p);
  const day = gameDayPreview(l, g, g.homeId);
  const dressed = day.dressedIds.filter((id) => l.players[id].position !== p.position);
  if (!dressed.includes(p.id)) dressed.push(p.id);
  setGameDayPlan(l, g, g.homeId, { dressedIds: dressed });
  playGame(l, g);
}
function nextGame(p: Player, week: number, playoff = false) {
  const next: Game = {
    id: 9000 + week,
    season: l.season,
    week,
    homeId: p.teamId!,
    awayId: g.awayId,
    kickoff: { day: 'sun', et: 13 * 60 },
    ...(playoff ? { playoffRound: 'WC' as const } : {}),
  };
  l.games = [next];
  l.week = week;
  l.phase = playoff ? 'playoffs' : 'regular';
  l.personnel!.clock = { season: l.season, cutdown: true };
  g = next;
  return next;
}

describe('temporary call-ups and durable history', () => {
  it('a kickoff refused for roster size leaves your call-up plans editable', () => {
    const p = player();
    planElevation(l, p, g);
    const extra = structuredClone(activeRoster(l, g.homeId)[0]);
    extra.id = l.nextPlayerId++;
    l.players[extra.id] = extra; // 54 on the 53
    expect(() => preparePersonnelGame(l, g)).toThrow(/cut down to 53/);
    expect(g.personnel?.elevationsFiled).toBeUndefined();
    cancelElevation(l, p, g);
    expect(elevationRecords(l).find((e) => e.playerId === p.id)!.status).toBe('cancelled');
  });
  it('reserves a single-game cap charge, never a 53 place or a second squad check; cancellation is free', () => {
    const p = player();
    const ids = activeRoster(l, g.homeId).map((p) => p.id);
    const space = capSpace(l, g.homeId);
    const pay = squadPayroll(l, g.homeId);
    planElevation(l, p, g);
    expect(capSpace(l, g.homeId)).toBeCloseTo(space - elevationCost(l, p, g));
    expect(squadPayroll(l, g.homeId)).toEqual(pay);
    expect(activeRoster(l, g.homeId).map((p) => p.id)).toEqual(ids);
    expect(practiceSquad(l, g.homeId)).toContain(p);
    expect(elevationUses(l, p)).toBe(0);
    cancelElevation(l, p, g);
    expect(capSpace(l, g.homeId)).toBeCloseTo(space);
    expect(elevationCap(l, g.homeId)).toBe(0);
  });
  it('permits only two call-ups and validates health, club, deadline and cap before mutation', () => {
    const [a, b, c] = practiceSquad(l, g.homeId);
    planElevation(l, a, g);
    planElevation(l, b, g);
    const snapshot = JSON.stringify(l);
    expect(() => planElevation(l, c, g)).toThrow(/two/);
    expect(JSON.stringify(l)).toBe(snapshot);
    cancelElevation(l, b, g);
    c.injury = injury();
    expect(elevationProblem(l, c, g)).toMatch(/cleared/);
    delete c.injury;
    l.teams[g.homeId].carryover -= capSpace(l, g.homeId);
    expect(elevationProblem(l, c, g)).toMatch(/cap room/);
    expect(elevationProblem(l, practiceSquad(l, g.awayId)[0], { ...g, awayId: 31 })).toBeTruthy();
    l.teams[g.homeId].carryover += 100_000;
    preparePersonnelGame(l, g);
    expect(elevationProblem(l, c, g)).toMatch(/locked/);
  });
  it('filing earns pay and consumes a use even when the player is inactive; repeat settlement and reload are stable', () => {
    const p = player();
    file(p);
    expect(elevationUses(l, p)).toBe(1);
    expect(() => releaseSquadPlayer(l, p)).toThrow(/call-up/);
    expect(() => promoteSquadPlayer(l, p)).toThrow(/call-up/);
    const day = gameDayPreview(l, g, g.homeId);
    setGameDayPlan(l, g, g.homeId, { dressedIds: day.dressedIds.filter((id) => id !== p.id) });
    const charged = elevationCap(l, g.homeId);
    playGame(l, g);
    expect(g.result!.playerStats[p.id]?.snaps ?? 0).toBe(0);
    expect(p.service![2]).toBe(1 << (g.week - 1)); // a filed call-up earns the week, dressed or not
    expect(elevationCap(l, g.homeId)).toBe(charged);
    expect(elevationRecords(l).find((e) => e.playerId === p.id)!.status).toBe('reverted');
    expect(practiceSquad(l, g.homeId)).toContain(p);
    expect(activeRoster(l, g.homeId)).toHaveLength(53);
    const restored = JSON.parse(JSON.stringify(l));
    settleWeek(restored);
    const before = JSON.stringify(restored);
    settleWeek(restored);
    expect(JSON.stringify(restored)).toBe(before);
  });
  it('rejects a fourth regular use, keeps postseason uses separate and cannot erase history through a same-club re-sign', () => {
    const p = player('QB');
    for (let week = 1; week <= 3; week++) {
      if (week > 1) nextGame(p, week);
      playWith(p);
    }
    nextGame(p, 4);
    expect(elevationProblem(l, p, g)).toMatch(/three/);
    nextGame(p, 19, true);
    expect(elevationProblem(l, p, g)).toBeNull();
    playWith(p);
    expect(elevationUses(l, p)).toBe(3);
    nextGame(p, 5);
    delete p.injury; // this test is about call-up history; injured squad players cannot be released
    releaseSquadPlayer(l, p);
    acceptSquadOffer(l, { teamId: g.homeId, playerId: p.id, weeklyPay: 13.75 });
    expect(elevationProblem(l, p, g)).toMatch(/re-sign/);
    releaseSquadPlayer(l, p);
    releaseSquadPlayer(l, practiceSquad(l, g.awayId)[0]);
    acceptSquadOffer(l, { teamId: g.awayId, playerId: p.id, weeklyPay: 13.75 });
    expect(elevationUses(l, p)).toBe(0);
    expect(elevationProblem(l, p, g)).toBeNull();
  });
  it('a call-up files at its game and is back on the squad before the next week', () => {
    const p = player();
    planElevation(l, p, g);
    const record = () => elevationRecords(l).find((e) => e.playerId === p.id)!;
    expect(record().status).toBe('planned');
    expect(elevationUses(l, p)).toBe(0);
    playGame(l, g);
    expect(record().status).toBe('reverted');
    expect(elevationUses(l, p)).toBe(1);
    expect(practiceSquad(l, g.homeId)).toContain(p);
    expect(activeRoster(l, g.homeId).map((x) => x.id)).not.toContain(p.id);
  });
  it('a planned call-up can be cancelled until its game is prepared, not after', () => {
    const p = player();
    planElevation(l, p, g);
    cancelElevation(l, p, g);
    expect(elevationRecords(l).find((e) => e.playerId === p.id)!.status).toBe('cancelled');
    planElevation(l, p, g);
    preparePersonnelGame(l, g);
    expect(() => cancelElevation(l, p, g)).toThrow(/filed/);
  });
  it('an injured squad member keeps his weekly pay and his place', () => {
    const p = player();
    file(p);
    p.injury = injury();
    expect(elevationUses(l, p)).toBe(1);
    expect(gameDayPreview(l, g, g.homeId).dressedIds).not.toContain(p.id);
    settleSquadPayroll(l);
    const earned = squadPayroll(l, g.homeId).earned;
    l.week = 3;
    settleSquadPayroll(l);
    const weekly = practiceSquad(l, g.homeId).reduce((sum, x) => sum + x.squad!.agreement!.weeklyPay, 0);
    expect(practiceSquad(l, g.homeId)).toContain(p);
    // Two more weeks of the whole squad's checks, his at his usual rate: no injury top-up.
    expect(squadPayroll(l, g.homeId).earned).toBeCloseTo(earned + 2 * weekly, 3);
    expect(p.squad!.kind).toBe('practiceSquad');
    expect(JSON.stringify(p.squad)).not.toContain('continuation');
  });
  it('upgrades a prepared v44 development game to a legal active list without inventing finished-game history', () => {
    g.serviceRoster = activeRoster(l, g.homeId).map((p) => ({ playerId: p.id, list: 'active' }));
    preparePersonnelGame(l, g);
    expect(g.personnel?.lists?.[g.homeId].dressedIds.length).toBeLessThanOrEqual(48);
  });
  it('uses credited salary service for current and future pay tables', () => {
    const p = player();
    p.service = initialService(0, 2025);
    expect(elevationMinimum(l, p)).toBeCloseTo(885 / 18, 2);
    p.service = initialService(7, 2025);
    l.season = 2027;
    expect(elevationMinimum(l, p)).toBeCloseTo(1345 / 18, 2);
  });
  it('rechecks a saved plan at filing, cancelling an unavailable player without earning pay or a use', () => {
    const p = player();
    const before = capSpace(l, g.homeId);
    planElevation(l, p, g);
    p.injury = injury();
    fileElevations(l, g);
    expect(elevationUses(l, p)).toBe(0);
    expect(elevationCap(l, g.homeId)).toBe(0);
    expect(capSpace(l, g.homeId)).toBeCloseTo(before);
    expect(elevationRecords(l).find((e) => e.playerId === p.id)!.reason).toMatch(/cleared/);
  });
  it('a same-week permanent promotion absorbs the call-up check instead of charging it twice', () => {
    const p = player('QB');
    playWith(p);
    delete p.injury;
    releasePlayer(
      l,
      activeRoster(l, g.homeId)
        .filter((p) => p.position === 'QB')
        .at(-1)!,
    );
    const before = capSpace(l, g.homeId);
    const preview = squadPromotionPreview(l, p);
    expect(preview.problem).toBeNull();
    promoteSquadPlayer(l, p);
    expect(capSpace(l, g.homeId)).toBeCloseTo(before - preview.additionalCap);
    expect(elevationCap(l, g.homeId)).toBe(0);
    expect(elevationRecords(l).find((e) => e.playerId === p.id)!.creditedToContract).toBe(true);
  });
  it('a playoff call-up charges no cap and records no pay', () => {
    const p = player('QB');
    nextGame(p, 21, true);
    g.playoffRound = 'CONF';
    playWith(p);
    const entry = elevationRecords(l).find((e) => e.playerId === p.id)!;
    expect(entry.additionalCap).toBe(0);
    expect(elevationCap(l, g.homeId)).toBe(0);
    expect(Object.keys(entry)).not.toContain('postseasonPay');
  });
  it('migrates old careers without turning on personnel or inventing prior game-day lists', () => {
    const old = createLeague({ seed: 'elevation-migration' });
    old.version = 46;
    // v55 moves builds onto the curves; nothing else about a player changes.
    const curved = JSON.parse(JSON.stringify(old.players)) as typeof old.players;
    for (const p of Object.values(curved)) toCurve(p);
    const before = JSON.stringify(curved);
    const m = migrateLeague(old)!;
    expect(m.version).toBe(SAVE_VERSION);
    expect(m.personnel?.enabled).toBe(false);
    expect(m.personnel?.elevations).toBeUndefined();
    expect(JSON.stringify(m.players)).toBe(before);
    expect(m.games.every((g) => !g.personnel)).toBe(true);
  });
});

describe('frozen game-day lists and every match path', () => {
  it('permits 48 only with eight primary-position linemen; duplicate/foreign/IR and invalid emergency selections fail atomically', () => {
    const day = gameDayPreview(l, g, g.homeId);
    expect(gameDayProblem(l, g, g.homeId, day)).toBeNull();
    const eight = gameDayPool(l, g, g.homeId)
      .filter((p) => p.position === 'OL' && !p.injury)
      .slice(0, 8)
      .map((p) => p.id);
    const others = gameDayPool(l, g, g.homeId)
      .filter((p) => p.position !== 'OL' && !p.injury)
      .map((p) => p.id);
    const dressed = [...eight, ...others.slice(0, 40)];
    expect(dressed).toHaveLength(48);
    expect(dressingLimit(l, dressed)).toBe(48);
    setGameDayPlan(l, g, g.homeId, { dressedIds: dressed });
    const replacement = others.find((id) => !dressed.includes(id))!;
    const seven = [...dressed.slice(1), replacement];
    const before = JSON.stringify(l);
    expect(() => setGameDayPlan(l, g, g.homeId, { dressedIds: seven })).toThrow(/47/);
    expect(JSON.stringify(l)).toBe(before);
    expect(() => setGameDayPlan(l, g, g.homeId, { dressedIds: [dressed[0], dressed[0]] })).toThrow(/once/);
    expect(() => setGameDayPlan(l, g, g.homeId, { dressedIds: [l.teams[g.awayId].depthChart.QB[0]] })).toThrow(
      /unavailable/,
    );
    expect(() => setGameDayPlan(l, g, g.homeId, { dressedIds: dressed, emergencyQbId: player('QB').id })).toThrow(
      /emergency/,
    );
  });
  it('freezes both lists when the game is prepared and keeps a late-injured player off every unit', () => {
    const day = gameDayPreview(l, g, g.homeId);
    const target = l.players[day.dressedIds[0]];
    preparePersonnelGame(l, g);
    expect(g.personnel?.lists).toBeDefined();
    expect(() => setGameDayPlan(l, g, g.homeId, { dressedIds: day.dressedIds })).toThrow(/locked/);
    target.injury = injury();
    preparePersonnelGame(l, g);
    const lineup = buildLineup(l, l.teams[g.homeId], new Set(), g);
    expect(lineup.qb.id).not.toBe(target.id);
    expect(lineup.st.map((p) => p.id)).not.toContain(target.id);
  });
  it('refreshes an obsolete saved list for a pregame injury without requiring a roster transaction', () => {
    const day = gameDayPreview(l, g, g.homeId);
    setGameDayPlan(l, g, g.homeId, { dressedIds: day.dressedIds });
    const target = l.players[day.dressedIds[0]];
    target.injury = injury();
    preparePersonnelGame(l, g);
    expect(g.personnel!.lists![g.homeId].dressedIds).not.toContain(target.id);
    expect(activeRoster(l, g.homeId)).toHaveLength(53);
    expect(() => setGameDayPlan(l, { ...g, personnel: { plans: {} } }, g.homeId, { dressedIds: [] })).toThrow();
  });
  it('a selected squad QB plays with stats and service; its original depth chart and 53 never change', () => {
    const p = player('QB');
    syncDepthChart(l, l.teams[g.homeId]); // the coach-ordered chart main keeps, before any game
    const chart = JSON.stringify(l.teams[g.homeId].depthChart);
    playWith(p);
    expect(g.result!.playerStats[p.id].snaps).toBeGreaterThan(0);
    expect(g.result!.playerTeams[p.id]).toBe(g.homeId);
    expect(p.service![2]).toBe(1 << (g.week - 1));
    expect(activeRoster(l, g.homeId)).toHaveLength(53);
    expect(p.contract).toBeNull();
    expect(JSON.stringify(l.teams[g.homeId].depthChart)).toBe(chart);
    for (const id of Object.keys(g.result!.playerStats).map(Number))
      expect(g.personnel!.lists![g.result!.playerTeams[id]].dressedIds).toContain(id);
  });
  it('inactive players cannot sneak into starters, defensive rotation, kick units, returner overrides or injury fallbacks', () => {
    const p = player('WR');
    file(p);
    const day = gameDayPreview(l, g, g.homeId);
    const held = l.teams[g.homeId].depthChart.WR[0];
    setGameDayPlan(l, g, g.homeId, { dressedIds: day.dressedIds.filter((id) => id !== held && id !== p.id) });
    l.teams[g.homeId].returners = { kr: held, pr: p.id };
    preparePersonnelGame(l, g);
    const lineup = buildLineup(l, l.teams[g.homeId], new Set(), g);
    const ids = Object.values(lineup).flatMap((v) =>
      Array.isArray(v)
        ? v.filter((x) => x && typeof x === 'object' && 'id' in x).map((x) => x.id)
        : v && typeof v === 'object' && 'position' in v
          ? [v.id]
          : [],
    );
    expect(ids).not.toContain(held);
    expect(ids).not.toContain(p.id);
    const heldSet = new Set(
      day.dressedIds.filter((id) => l.players[id].position === 'K' || l.players[id].position === 'P'),
    );
    const emergency = buildLineup(l, l.teams[g.homeId], heldSet, g);
    expect(emergency.k.id).not.toBe(held);
    expect(emergency.p.id).not.toBe(p.id);
    const player53 = l.players[l.teams[g.homeId].depthChart.RB[0]];
    expect(() => releasePlayer(l, player53)).toThrow(/Finish/);
  });
  it('only a QB on the 53 may be emergency QB, and only enters once both active QBs are out', () => {
    const qbs = activeRoster(l, g.homeId).filter((p) => p.position === 'QB');
    expect(qbs.length).toBeGreaterThanOrEqual(3);
    const day = gameDayPreview(l, g, g.homeId);
    const regular = qbs.slice(0, 2);
    const emergency = qbs[2];
    const ids = day.dressedIds.filter((id) => l.players[id].position !== 'QB');
    ids.splice(-2);
    ids.push(...regular.map((p) => p.id));
    setGameDayPlan(l, g, g.homeId, { dressedIds: ids, emergencyQbId: emergency.id });
    preparePersonnelGame(l, g);
    expect(buildLineup(l, l.teams[g.homeId], new Set(), g).qb.id).not.toBe(emergency.id);
    expect(buildLineup(l, l.teams[g.homeId], new Set([regular[0].id]), g).qb.id).toBe(regular[1].id);
    const lineup = buildLineup(l, l.teams[g.homeId], new Set(regular.map((p) => p.id)), g);
    expect(lineup.qb.id).toBe(emergency.id);
    expect(lineup.st.map((p) => p.id)).not.toContain(emergency.id);
  });
  it('names no emergency QB when a third QB dresses at another position', () => {
    // A staff "Play at…" can line a spare QB up at RB; dressed there he is still a third active QB.
    const team = l.teams[g.homeId];
    const roster = activeRoster(l, g.homeId);
    const qbs = roster.filter((p) => p.position === 'QB');
    for (const p of roster.filter((p) => p.position === 'K').slice(0, 4 - qbs.length)) p.position = 'QB';
    const spare = activeRoster(l, g.homeId).filter((p) => p.position === 'QB')[2];
    team.playingAt = {
      ...team.playingAt,
      [spare.id]: { pos: 'RB', by: 'staff', since: { season: l.season, week: 1 } },
    };
    syncDepthChart(l, team);
    team.autoDepth = false;
    team.depthChart.RB = [spare.id, ...team.depthChart.RB.filter((id) => id !== spare.id)];
    const day = gameDayPreview(l, g, g.homeId);
    expect(day.dressedIds).toContain(spare.id);
    expect(gameDayProblem(l, g, g.homeId, day)).toBeNull();
    expect(() => preparePersonnelGame(l, g)).not.toThrow();
  });
  it('live and batch games share the same lineup, pay and results after reload', () => {
    const p = player('QB');
    planElevation(l, p, g);
    const saved = JSON.stringify(l);
    const batch = JSON.parse(saved) as League;
    const bg = batch.games.find((x) => x.id === g.id)!;
    playGame(batch, bg);
    const liveLeague = JSON.parse(saved) as League;
    const lg = liveLeague.games.find((x) => x.id === g.id)!;
    const live = startLiveGame(liveLeague, lg);
    let n = 0;
    while (!live.over && n++ < 10000) live.next();
    expect(live.over).toBe(true);
    recordResult(liveLeague, lg, live.result());
    expect(lg.result).toEqual(bg.result);
    expect(liveLeague.personnel).toEqual(batch.personnel);
    expect(liveLeague.players[p.id].service).toEqual(batch.players[p.id].service);
    expect(() => autoGameDay(liveLeague, lg, lg.homeId)).toThrow(/locked/);
  });
  it('direct match entry requires chronological play and freezes a legal roster too', () => {
    const later = l.games
      .filter((x) => x.week === 1)
      .sort((a, b) => gameTime(a) - gameTime(b))
      .at(-1)!;
    expect(() => simulateGame(l, later)).toThrow(/earlier/);
    simulateGame(l, g);
    expect(g.personnel?.lists).toBeDefined();
    expect(g.serviceRoster).toBeDefined();
  });
  it('AI never calls up for the user implicitly, and chooses immediate cover without seeing true rival ceilings', () => {
    const p = player('QB');
    for (const x of activeRoster(l, g.homeId).filter((x) => x.position === 'QB')) x.injury = injury();
    planAIElevations(l, g);
    expect(gameElevations(l, g, g.homeId)).toHaveLength(0);
    planAIElevations(l, g, true);
    expect(gameElevations(l, g, g.homeId).map((e) => e.playerId)).toContain(p.id);
  });
});
