import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createLeague } from '../engine/generate';
import type { GameResult, League } from '../engine/types';
import { NavContext, type Nav } from './nav';
import { Leaders, rankStatRows, STAT_TABLES } from './screens/Stats';

const nav = {
  openPlayer: () => {},
  openTeam: () => {},
  go: () => {},
  openStaff: () => {},
  compareIds: [],
} as unknown as Nav;

/** Clubs with two games played (results by hand), a starter at 60 attempts and a 2-for-2 backup. */
function scene() {
  const l: League = createLeague({ seed: 'rate-stats-ui' });
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
  const [starter, backup] = Object.values(l.players).filter((p) => p.position === 'QB' && p.teamId !== null);
  starter.stats[l.season] = { gp: 2, passAtt: 60, passCmp: 38, passYds: 450, passTd: 3, passInt: 1 };
  backup.stats[l.season] = { gp: 1, passAtt: 2, passCmp: 2, passYds: 60, passTd: 1 };
  return { l, starter, backup };
}
const render = (l: League, scope: number | 'career') =>
  renderToStaticMarkup(
    <NavContext.Provider value={nav}>
      <Leaders league={l} scope={scope} />
    </NavContext.Provider>,
  );

describe('rate stats on the Stats screen (0.4.16)', () => {
  it("says each rate board's minimum, a season's and a career's", () => {
    const { l } = scene();
    expect(render(l, l.season)).toContain('14 att. per team game');
    expect(render(l, 'career')).toContain('1,500 att. career');
  });

  it('sorts a 2-for-2 backup below qualified passers on a rate, either way', () => {
    const { l, starter, backup } = scene();
    const passing = STAT_TABLES.find((t) => t.key === 'passing')!;
    const rows = [starter, backup].map((p) => ({ p, s: p.stats[l.season] }));
    for (const desc of [true, false]) {
      const ids = rankStatRows(l, l.season, passing, rows, { key: 'rating', desc }).map((r) => r.p.id);
      expect(ids).toEqual([starter.id, backup.id]);
    }
  });
});
