import { describe, expect, it } from 'vitest';
import { buildPath } from '../../engine/field/ballPath';
import { stagePlay } from '../../engine/field/stage';
import { createLeague } from '../../engine/generate';
import { simulateGame } from '../../engine/match/gameSim';
import { actorsIn } from '../../engine/playActors';
import type { GameResult, PlayLogEntry } from '../../engine/types';

/** The first play in a league's games that `want` picks, with its game. */
function findPlay(want: (e: PlayLogEntry) => boolean, games = 60) {
  const league = createLeague({ seed: 'situations-film' });
  for (const g of league.games.filter((x) => !x.playoffRound).slice(0, games)) {
    const r: GameResult = simulateGame(league, g, { keepPlays: true });
    const i = r.plays!.findIndex(want);
    if (i >= 0) return { r, i, homeId: g.homeId };
  }
  return null;
}
const stage = (r: GameResult, plays: PlayLogEntry[], i: number, homeId: number) =>
  stagePlay({ plays, index: i, record: r.field!, homeId, seed: 'film', snapY: 26.65 });
const TRY = /^Two-point try: /;

describe('a two-point try on film', () => {
  const found = findPlay(
    (e) => TRY.test(e.text) && / — GOOD\.$/.test(e.text) && (e.kind === 'run' || e.kind === 'pass'),
  );

  it('stages as the same snap from the 2, its men read as without the words', () => {
    expect(found).not.toBeNull();
    const { r, i, homeId } = found!;
    const e = r.plays![i];
    expect(e.yardLine).toBe(98);
    const bare = { ...e, text: e.text.replace(TRY, '').replace(/ — GOOD\.$/, '') };
    expect(actorsIn(e)).toEqual(actorsIn(bare));
    const p = stage(r, r.plays!, i, homeId);
    const q = stage(
      r,
      r.plays!.map((x, k) => (k === i ? bare : x)),
      i,
      homeId,
    );
    expect(Array.from(p.ball)).toEqual(Array.from(q.ball));
  });
});

describe('a long return on film', () => {
  const found = findPlay((e) => e.kind === 'kickoff' && returned(e) >= 40);

  it('is drawn the whole way: the ball ends where the return did', () => {
    expect(found).not.toBeNull();
    const { r, i, homeId } = found!;
    const e = r.plays![i];
    const p = stage(r, r.plays!, i, homeId);
    const segs = buildPath(e, homeId, 26.65);
    const last = segs[segs.length - 1];
    expect(Math.abs(p.ball[(p.steps - 1) * 3] - last.x1)).toBeLessThan(1.5);
  });
});

/**
 * A kickoff's return yards from its log line ("returns to the ABC 45"), from the 3. A spot in the kicking side's half
 * reads short here, so a return this finds at 40+ is at least that long.
 */
function returned(e: PlayLogEntry): number {
  const m = /returns to the \w+ (\d+)/.exec(e.text);
  return m ? Number(m[1]) - 3 : 0;
}
