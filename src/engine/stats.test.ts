import { describe, expect, it } from 'vitest';
import { createLeague } from './generate';
import { careerLine, leaders, LEADER_CATEGORIES, seasonRecords, statLine, statSeasons } from './stats';
import { qualifies, RATES } from './qualify';
import type { GameResult, Player } from './types';

const passYds = LEADER_CATEGORIES.find((c) => c.key === 'passYds')!;

describe('stats across seasons', () => {
  const league = createLeague({ seed: 'stats-history' });
  const players = Object.values(league.players);
  const [a, b] = players;
  // Two made-up seasons, so the test doesn't need to play a whole league.
  a.stats = { 2024: { gp: 17, passYds: 4000, rushLong: 30 }, 2025: { gp: 16, passYds: 3500, rushLong: 55 } };
  b.stats = { 2025: { gp: 17, passYds: 4200, rushLong: 12 } };
  for (const p of players.slice(2)) p.stats = {};

  it('sum a career, keeping the longest play rather than adding them', () => {
    expect(careerLine(a)).toEqual({ gp: 33, passYds: 7500, rushLong: 55 });
    expect(statLine(a, 'career')).toEqual(careerLine(a));
    expect(statLine(a, 2024)?.passYds).toBe(4000);
    expect(statLine(players[2], 'career')).toBeUndefined();
  });

  it('list the seasons on record, newest first', () => {
    expect(statSeasons(league)).toEqual([2025, 2024]);
  });

  it('rank a season, a career, and the best single seasons', () => {
    const names = (rows: { player: Player }[]) => rows.map((r) => r.player.id);
    expect(names(leaders(league, passYds, 5, 2025))).toEqual([b.id, a.id]);
    expect(names(leaders(league, passYds, 5, 'career'))).toEqual([a.id, b.id]);
    expect(seasonRecords(league, passYds, 5).map((r) => [r.player.id, r.season])).toEqual([
      [b.id, 2025],
      [a.id, 2024],
      [a.id, 2025],
    ]);
  });
});

describe('rate boards (0.4.16)', () => {
  /** A league whose clubs have played two games each, results written by hand, every stat line cleared. */
  function weekTwo() {
    const l = createLeague({ seed: 'rate-boards' });
    const count = new Map<number, number>();
    for (const g of l.games) {
      if (g.playoffRound || g.season !== l.season) continue;
      const h = count.get(g.homeId) ?? 0;
      const a = count.get(g.awayId) ?? 0;
      if (h >= 2 || a >= 2) continue;
      g.result = {} as GameResult;
      count.set(g.homeId, h + 1);
      count.set(g.awayId, a + 1);
    }
    for (const p of Object.values(l.players)) p.stats = {};
    const qbs = Object.values(l.players).filter((p) => p.position === 'QB' && p.teamId !== null);
    return { l, starter: qbs[0], backup: qbs[1], third: qbs[2] };
  }
  const rateCats = () => LEADER_CATEGORIES.filter((c) => c.rate);

  it('has a board for each common rate', () => {
    const keys = LEADER_CATEGORIES.map((c) => c.key);
    for (const k of ['rating', 'cmpPct', 'ypa', 'ypc', 'ypr', 'fgPct', 'puntAvg']) expect(keys).toContain(k);
  });

  it('lists no 2-for-2 backup on any rate board', () => {
    const { l, starter, backup } = weekTwo();
    starter.stats[l.season] = { gp: 2, passAtt: 60, passCmp: 38, passYds: 450, passTd: 3, passInt: 1 };
    backup.stats[l.season] = { gp: 1, passAtt: 2, passCmp: 2, passYds: 60, passTd: 1 };
    for (const cat of rateCats()) expect(leaders(l, cat, 10).map((r) => r.player.id)).not.toContain(backup.id);
    expect(leaders(l, LEADER_CATEGORIES.find((c) => c.key === 'rating')!, 10)[0].player.id).toBe(starter.id);
  });

  it("lists only men who qualify against their team's games", () => {
    const { l, starter } = weekTwo();
    const others = Object.values(l.players).filter((p) => p.teamId !== null);
    starter.stats[l.season] = { gp: 1, passAtt: 20, passCmp: 15, passYds: 200 };
    others[5].stats[l.season] = { gp: 2, rushAtt: 12, rushYds: 90 };
    others[6].stats[l.season] = { gp: 2, rushAtt: 13, rushYds: 60 };
    others[7].stats[l.season] = { gp: 2, rec: 4, recYds: 70 };
    for (const cat of rateCats())
      for (const r of leaders(l, cat, 10))
        expect(qualifies(l, r.player, r.line, l.season, RATES[cat.rate!])).toBe(true);
    // 20 attempts in two team games is short of 28, though he played only one.
    expect(leaders(l, LEADER_CATEGORIES.find((c) => c.key === 'ypa')!, 10)).toHaveLength(0);
  });

  it('reads each past season against a full season', () => {
    const { l, starter, backup } = weekTwo();
    const past = l.season - 3;
    starter.stats[past] = { gp: 17, passAtt: 300, passCmp: 200, passYds: 2400, passTd: 18 };
    backup.stats[past] = { gp: 17, passAtt: 100, passCmp: 80, passYds: 1200, passTd: 12 };
    const rows = seasonRecords(l, LEADER_CATEGORIES.find((c) => c.key === 'rating')!);
    expect(rows.map((r) => r.player.id)).toEqual([starter.id]);
  });

  it('breaks a tie by player id', () => {
    const { l, starter, backup } = weekTwo();
    const line = { gp: 2, passAtt: 40, passCmp: 25, passYds: 300, passTd: 2 };
    starter.stats[l.season] = { ...line };
    backup.stats[l.season] = { ...line };
    const ids = leaders(l, LEADER_CATEGORIES.find((c) => c.key === 'rating')!, 10).map((r) => r.player.id);
    expect(ids).toEqual([starter.id, backup.id].sort((a, b) => a - b));
  });
});

describe('records in the first weeks (0.4.16 review)', () => {
  it("measures the season under way against a full one: a one-game line isn't an all-time record", () => {
    const l = createLeague({ seed: 'rate-records' });
    for (const g of l.games) if (!g.playoffRound && g.season === l.season && g.week === 1) g.result = {} as GameResult;
    for (const p of Object.values(l.players)) p.stats = {};
    const [deep, oneGame] = Object.values(l.players).filter((p) => p.position === 'WR' && p.teamId !== null);
    deep.stats[l.season - 3] = { gp: 17, rec: 60, recYds: 960 };
    oneGame.stats[l.season] = { gp: 1, rec: 2, recYds: 82 };
    const rows = seasonRecords(l, LEADER_CATEGORIES.find((c) => c.key === 'ypr')!);
    expect(rows.map((r) => r.player.id)).toEqual([deep.id]);
  });
});
