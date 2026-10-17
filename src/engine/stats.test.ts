import { describe, expect, it } from 'vitest';
import { createLeague } from './generate';
import { careerLine, leaders, LEADER_CATEGORIES, seasonRecords, statLine, statSeasons } from './stats';
import type { Player } from './types';

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
