import { beforeAll, describe, expect, it } from 'vitest';
import { createLeague } from '../generate';
import { gamesInWeek, playWeek } from '../league';
import { gameOfWeek } from './gameOfWeek';
import { computeRecords } from './standings';

describe('the game of the week', () => {
  const league = createLeague({ seed: 'game-of-week' });
  const user = league.userTeamId;
  const ours = (g: { homeId: number; awayId: number }) => g.homeId === user || g.awayId === user;

  it('is nobody’s before anyone has a record', () => {
    expect(gameOfWeek(league, 1)).toBeUndefined();
  });

  describe('once the season is under way', () => {
    beforeAll(() => {
      while (league.week < 8) playWeek(league);
    }, 120_000);

    it('is the best two records meeting, among games still to play that are not ours', () => {
      const records = computeRecords(league);
      const share = (id: number) => {
        const r = records.get(id)!;
        return (r.w + 0.5 * r.t) / (r.w + r.l + r.t);
      };
      const best = gameOfWeek(league, league.week, records)!;
      expect(best.result).toBeUndefined();
      expect(ours(best)).toBe(false);
      for (const g of gamesInWeek(league, league.week))
        if (!ours(g))
          expect(share(g.homeId) + share(g.awayId)).toBeLessThanOrEqual(share(best.homeId) + share(best.awayId));
    });

    it('is never a game already played', () => {
      expect(gameOfWeek(league, league.week - 1)).toBeUndefined();
    });
  });
});
