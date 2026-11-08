import { describe, expect, it } from 'vitest';
import { createLeague } from './generate';
import { rookieRate } from './rookieReport';
import type { GameResult, League } from './types';

/** Clubs with `n` games played (results by hand). */
function played(n: number): League {
  const l = createLeague({ seed: 'rookie-rates' });
  const count = new Map<number, number>();
  for (const g of l.games) {
    if (g.playoffRound || g.season !== l.season) continue;
    const h = count.get(g.homeId) ?? 0;
    const a = count.get(g.awayId) ?? 0;
    if (h >= n || a >= n) continue;
    g.result = {} as GameResult;
    count.set(g.homeId, h + 1);
    count.set(g.awayId, a + 1);
  }
  return l;
}

describe('the rookie report reads the shared rate minimums (0.4.16)', () => {
  it("compares a rookie quarterback's rating once he's thrown 14 a team game", () => {
    const l = played(6);
    const p = Object.values(l.players).find((x) => x.position === 'QB' && x.teamId !== null)!;
    const line = { gp: 6, passAtt: 90, passCmp: 60, passYds: 700, passTd: 5, passInt: 2 };
    expect(rookieRate(l, p, line)?.label).toBe('passer rating');
    expect(rookieRate(l, p, { ...line, passAtt: 80 })).toBeNull();
  });

  it('compares a rookie back on 6.25 carries a team game', () => {
    const l = played(4);
    const p = Object.values(l.players).find((x) => x.position === 'RB' && x.teamId !== null)!;
    expect(rookieRate(l, p, { gp: 4, rushAtt: 25, rushYds: 110 })?.label).toBe('yards per carry');
    expect(rookieRate(l, p, { gp: 4, rushAtt: 24, rushYds: 110 })).toBeNull();
  });
});
