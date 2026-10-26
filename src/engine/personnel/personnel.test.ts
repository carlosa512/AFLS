import { beforeEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { createLeague, SAVE_VERSION } from '../generate';
import { capSheet, releasePlayer } from '../finance/cap';
import { playGame, recordResult, startLiveGame } from '../league';
import { buildLineup } from '../match/lineup';
import { simulateGame } from '../match/gameSim';
import { migrateLeague } from '../migrate';
import { freeAgents, offerProblem, signPlayer } from '../offseason/negotiation';
import { rosterOf, tradeContext } from '../trade/context';
import { playerTradeBlocker } from '../trade/rules';
import {
  activeRoster,
  buildAutoDepthChart,
  isAvailable,
  practiceSquad,
  practicingPlayers,
  rosterList,
  starters,
  syncDepthChart,
  teamPlayers,
  teamRatings,
} from '../roster';
import type { League, Player } from '../types';
import { initialPersonnelState, PERSONNEL_RULES } from './rules';
import { creditService, initialService, recordGameService, rollService, serviceSeasons } from './service';

const template = createLeague({ seed: 'personnel-foundation' });
const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v));
let league: League;
beforeEach(() => {
  league = copy(template);
});
const rookie = (): Player => ({ ...copy(template.players[1]), experience: 0, service: initialService(0, 2025) });

describe('service is one counter: seasons with six games on the 53 or IR', () => {
  it('five games is no season, six is one', () => {
    const p = rookie();
    for (let w = 1; w <= 5; w++) creditService(p, 2026, w);
    expect(serviceSeasons(p, 2027)).toBe(0);
    creditService(p, 2026, 6);
    expect(serviceSeasons(p, 2027)).toBe(1);
    expect(serviceSeasons(p, 2026)).toBe(0); // the season in progress never counts
    expect(p.experience).toBe(0);
    expect(p.stats).toEqual({});
  });

  it('IR and elevated weeks count, squad weeks and byes do not', () => {
    const l = copy(template);
    const g = l.games.find((g) => g.week === 1)!;
    const [ir, up, squad] = activeRoster(l, g.homeId).slice(-3);
    const roster = [
      { playerId: ir.id, list: 'injuredReserve' as const },
      { playerId: up.id, list: 'elevated' as const },
    ];
    for (const p of [ir, up, squad]) p.service = initialService(0, 2025);
    for (let week = 1; week <= 6; week++) {
      g.week = week;
      g.serviceRoster = copy(roster);
      recordGameService(l, g);
    }
    expect(serviceSeasons(ir, 2027)).toBe(1);
    expect(serviceSeasons(up, 2027)).toBe(1);
    expect(serviceSeasons(squad, 2027)).toBe(0);
  });

  it('the same week twice counts once, and weeks outside 1–18 throw', () => {
    const p = rookie();
    for (let i = 0; i < 6; i++) creditService(p, 2026, 1);
    expect(serviceSeasons(p, 2027)).toBe(0);
    expect(() => creditService(p, 2026, 19)).toThrow();
    expect(() => creditService(p, 2026, 1.5)).toThrow();
  });

  it('starts from experience and never counts a season already in the baseline', () => {
    const p = rookie();
    p.service = initialService(4, 2025);
    for (let w = 1; w <= 6; w++) creditService(p, 2025, w);
    expect(p.service).toEqual([2025, 4, 0]);
    expect(serviceSeasons(p, 2026)).toBe(4);
  });

  it('rollService keeps the count and clears the weeks', () => {
    const p = rookie();
    for (let w = 1; w <= 6; w++) creditService(p, 2026, w);
    rollService(p, 2026);
    expect(p.service).toEqual([2026, 1, 0]);
    expect(serviceSeasons(p, 2027)).toBe(1);
    rollService(p, 2026);
    expect(p.service).toEqual([2026, 1, 0]);
    expect(copy(p.service)).toEqual(p.service);
  });

  it('playoff games credit nothing', () => {
    const l = copy(template);
    const g = { ...l.games[0], playoffRound: 'WC' as const, week: 19 };
    const p = activeRoster(l, g.homeId)[0];
    p.service = initialService(0, 2025);
    g.serviceRoster = [{ playerId: p.id, list: 'active' }];
    recordGameService(l, g);
    expect(p.service).toEqual([2025, 0, 0]);
  });
});

describe('roster boundaries', () => {
  it('keeps employment broad while separating the 53, squad and practice participants', () => {
    const [a, b, c] = teamPlayers(league, 0);
    a.squad = { kind: 'practiceSquad' };
    b.squad = { kind: 'practiceSquadInjured' };
    c.ir = { season: 2026, week: 1, weeks: 0 };
    expect(teamPlayers(league, 0)).toHaveLength(53);
    expect(activeRoster(league, 0)).toHaveLength(50);
    expect(practiceSquad(league, 0).map((p) => p.id)).toEqual([a.id]);
    expect(practicingPlayers(league, 0)).toContain(a);
    expect(practicingPlayers(league, 0)).not.toContain(b);
    expect(practicingPlayers(league, 0)).not.toContain(c);
    expect(capSheet(league, 0).rosterSize).toBe(50);
    expect(rosterList(c)).toBe('injuredReserve');
    expect(isAvailable(a)).toBe(false);
    expect(isAvailable(b)).toBe(false);
    expect(isAvailable(c)).toBe(false);
  });

  it.each([true, false])('removes squad entries from charts while retaining order (auto=%s)', (auto) => {
    const t = league.teams[0];
    t.autoDepth = auto;
    t.depthChart.WR.reverse();
    const before = [...t.depthChart.WR];
    const p = league.players[before[1]];
    p.squad = { kind: 'practiceSquad' };
    syncDepthChart(league, t);
    expect(t.depthChart.WR).not.toContain(p.id);
    if (!auto) expect(t.depthChart.WR).toEqual(before.filter((id) => id !== p.id));
    expect(buildAutoDepthChart(teamPlayers(league, 0)).WR).not.toContain(p.id);
    expect(starters(league, t, 'WR')).not.toContain(p);
  });

  it('rejects trade and extension shortcuts, even with a stale ordinary contract', () => {
    const p = teamPlayers(league, 0)[0];
    p.squad = { kind: 'practiceSquad' };
    expect(playerTradeBlocker(league, p)).toMatch(/squad/);
    expect(rosterOf(tradeContext(league), 0)).not.toContain(p);
    const snapshot = copy(league);
    expect(() => releasePlayer(league, p)).toThrow(/personnel/);
    expect(() => signPlayer(league, p, 0, { years: 1, apy: 1000, bonusPct: 0, gtdPct: 0, voidYears: 0 })).toThrow(
      /promotion/,
    );
    expect(league).toEqual(snapshot);
    expect(offerProblem(league, p, 0, { years: 1, apy: 1000, bonusPct: 0, gtdPct: 0, voidYears: 0 })).toMatch(
      /promotion/,
    );
    p.teamId = null;
    expect(freeAgents(league)).not.toContain(p);
    expect(isAvailable(p)).toBe(false);
    p.retired = true;
    expect(rosterList(p)).toBe('retired');
  });

  it('excludes squad players from dirty charts, returner picks and hurt fallback selection', () => {
    const t = league.teams[0];
    const p = league.players[t.depthChart.QB[0]];
    p.squad = { kind: 'practiceSquad' };
    t.returners = { kr: p.id, pr: p.id };
    // The remaining QB is marked hurt, forcing the emergency path rather than ordinary selection.
    for (const id of t.depthChart.QB.slice(1)) league.players[id].ir = { season: 2026, week: 1, weeks: 0 };
    const lineup = buildLineup(league, t);
    const selected = Object.values(lineup).flatMap((v) => (Array.isArray(v) ? v : [v]));
    expect(selected).not.toContain(p);
  });

  it('does not let a squad prospect change perceived roster strength', () => {
    const t = league.teams[0];
    const p = league.players[t.depthChart.WR.at(-1)!];
    p.squad = { kind: 'practiceSquad' };
    syncDepthChart(league, t);
    const before = teamRatings(league, t);
    for (const key of Object.keys(p.ratings) as (keyof Player['ratings'])[]) p.ratings[key] = 20;
    expect(teamRatings(league, t)).toEqual(before);
  });
});

describe('migration and collection', () => {
  it('defaults to disabled with the versioned two-protection house rule', () => {
    expect(league.personnel).toEqual(initialPersonnelState());
    expect(PERSONNEL_RULES.weeklyProtections).toBe(2);
    expect(PERSONNEL_RULES.automaticProtection).toBe('scoutedCeiling');
    expect(league.version).toBe(SAVE_VERSION);
  });

  it('upgrades a main v46 save to v47 without modifying roster, contract, ratings, chart or RNG data', () => {
    league.version = 46;
    delete league.personnel;
    for (const p of Object.values(league.players)) delete p.service;
    const t = league.teams[0];
    t.autoDepth = false;
    t.depthChart.WR.reverse();
    const p = league.players[t.depthChart.QB[0]];
    p.ir = { season: 2026, week: 1, weeks: 0 };
    const before = copy(league);
    expect(migrateLeague(league)).toBe(league);
    const stripped = copy(league);
    delete stripped.personnel;
    for (const p of Object.values(stripped.players)) delete p.service;
    stripped.version = 46;
    expect(stripped).toEqual(before);
    expect(migrateLeague(league)).toEqual(copy(league));
    const loaded = copy(league);
    expect(migrateLeague(loaded)).toEqual(league);
  });

  it('collects membership once on game completion without changing experience or statistical appearances', () => {
    const g = league.games[0];
    const p = activeRoster(league, g.homeId).at(-1)!;
    const before = p.experience;
    playGame(league, g);
    const service = copy(p.service);
    expect(p.service![2]).toBe(1 << (g.week - 1));
    expect(p.experience).toBe(before);
    recordResult(league, g, g.result!);
    expect(p.service).toEqual(service);
    expect(g.serviceRoster).toBeUndefined();
    const roundtrip = copy(league);
    expect(migrateLeague(roundtrip)).toEqual(league);
  });

  it('uses kickoff membership for live games and excludes playoffs from regular-season service', () => {
    const g = league.games[0];
    startLiveGame(league, g);
    const p = activeRoster(league, g.homeId)[0];
    p.teamId = null;
    // Settlement uses the saved kickoff snapshot, even if the employer changed while viewing the game.
    const result = simulateGame(copy(template), copy(template.games[0]), { keepPlays: false });
    recordResult(league, g, result);
    expect(p.service![2]).toBe(1 << (g.week - 1));
    const before = copy(p.service);
    const playoff = { ...g, id: -1, week: 19, playoffRound: 'WC' as const, result: undefined };
    recordResult(league, playoff, result);
    expect(p.service).toEqual(before);
  });

  it('leaves unrelated seeded generation and match results unchanged', () => {
    const l = createLeague({ seed: 'personnel-compat' });
    const result = simulateGame(l, l.games[0], { keepPlays: false });
    const hash = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
    for (const p of Object.values(l.players)) delete p.service;
    // Filled from origin/main's own output (no personnel code), not regenerated from the implementation under test.
    expect({
      players: hash(l.players),
      rng: l.rngState,
      games: hash(l.games),
      result: hash(result),
      charts: hash(l.teams.map((t) => t.depthChart)),
    }).toEqual(BASELINE);
  });
});

const BASELINE = {
  players: '28fd53b408d3f6c415517e0733384a39c24e095ef830a96df83790cefb6ca5dc',
  rng: [666865279, 3079305262, 4039765455, 1664101998],
  games: '7d434cad09545c5d832fe11048921e57ab49f1d9807d05ae5b65df3aaa0a9978',
  result: '15634f0bebbf77470387a01e6baf205aafd4b530715a20c8c80a583dc9508dc2',
  charts: '23d56b1d1217c25f425b5454c0fd4e579639aa7a1dbf7753d52c180d7905ff1e',
};
