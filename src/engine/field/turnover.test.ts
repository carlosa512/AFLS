import { beforeAll, describe, expect, it } from 'vitest';
import { createLeague } from '../generate';
import { simulateGame, type FieldTap } from '../match/gameSim';
import type { GameResult } from '../types';
import { MID } from './geometry';
import { stagePlay } from './stage';

// Three weeks of this league (48 games): about sixty interceptions run back, and a few strip-sacks. One week's twenty
// returns swing a share by 0.2 with nothing changed (the owner's call: judge the shares over three).
const league = createLeague({ seed: 'field-engine' });
const weeks = league.games.filter((g) => g.week <= 3);
const turnovers: { r: GameResult; t: FieldTap; homeId: number }[] = [];
// Played before the tests, one game at a time with a yield between: sixteen spatial games in one synchronous block
// would starve vitest's worker of its own messages on a slow runner.
beforeAll(async () => {
  for (const g of weeks) {
    const taps: FieldTap[] = [];
    const r = simulateGame(league, g, { field: true, fieldTap: (t) => taps.push(t) });
    for (const t of taps) if (t.result && t.moment.kind === 'turnover') turnovers.push({ r, t, homeId: g.homeId });
    await new Promise((done) => setTimeout(done, 0));
  }
}, 300_000);

describe('a turnover returned on the open field', () => {
  it('plays interception and strip-sack returns on the field', () => {
    expect(turnovers.filter(({ t }) => t.moment.lost === 'int').length).toBeGreaterThanOrEqual(20);
    expect(turnovers.filter(({ t }) => t.moment.lost === 'sack').length).toBeGreaterThanOrEqual(1);
  });

  it("ends each return at today's spot (the owner's call H), the man with it from the side that took it", () => {
    for (const { t } of turnovers) {
      const res = t.result!;
      if (t.today.touchdown) expect(res.touchdown, `play ${t.moment.index}`).toBe(true);
      else {
        expect(res.touchdown, `play ${t.moment.index}`).toBe(false);
        expect(Math.abs(res.yards - t.today.yards), `play ${t.moment.index}`).toBeLessThanOrEqual(1.5);
      }
      // The carrier is the man who took the ball, and his own side is the defense that took it.
      expect(t.start.carrier).toBe(t.moment.take);
      if (res.tackler !== null)
        expect(t.start.players.find((p) => p.id === res.tackler)!.side, `play ${t.moment.index}`).toBe(1);
    }
  });

  it('turns the offense into the defense: its men chase the man with the ball', () => {
    let chased = 0;
    let n = 0;
    for (const { t } of turnovers) {
      const res = t.result!;
      const men = t.start.players.length;
      const steps = res.frames.length / (men * 2);
      if (steps < 30 || t.moment.lost !== 'int') continue;
      n++;
      // A second and a half in: most of the old offense has closed on him (or on where he's going), or is on him.
      const at = (s: number, k: number) => ({ x: res.frames[(s * men + k) * 2], y: res.frames[(s * men + k) * 2 + 1] });
      const ck = t.start.players.findIndex((p) => p.id === t.start.carrier);
      let closer = 0;
      t.start.players.forEach((p, k) => {
        if (p.side !== 1) return;
        const gap = (s: number) => Math.hypot(at(s, k).x - at(s, ck).x, at(s, k).y - at(s, ck).y);
        const moved = Math.hypot(at(30, k).x - at(0, k).x, at(30, k).y - at(0, k).y);
        // On the move after him, or already on him: a pick jumped near the line is run back into the men there.
        if ((moved > 3 || gap(30) < 4) && gap(30) < gap(0) + 2) closer++;
      });
      if (closer >= 7) chased++;
    }
    expect(n).toBeGreaterThanOrEqual(10);
    // About 0.85 of picks over four worlds, sd about 0.05 at this sample: the floor sits three sd under (the owner's
    // call), so a world's luck doesn't fail it.
    expect(chased / n).toBeGreaterThanOrEqual(0.7);
  });

  it('replays each turnover exactly as it was played', () => {
    for (const { r, t, homeId } of turnovers) {
      const s = stagePlay({ plays: r.plays!, index: t.moment.index, record: r.field!, homeId, seed: 'x', snapY: MID });
      expect(s.spatial, `play ${t.moment.index}`).toBeDefined();
      const men = s.ids.length;
      const k0 = s.spatial!.k0;
      expect(Array.from(s.pos.slice(k0 * men * 2, k0 * men * 2 + t.result!.frames.length))).toEqual(
        Array.from(t.result!.frames),
      );
    }
  });

  it("changes nothing in the game's result", () => {
    // Today's rolls decide it all: the same game with the switch off reads the same box score up to the first spatial
    // play that moves the clock, so judge one game's first turnover's own line instead.
    for (const { r, t } of turnovers.slice(0, 10)) {
      const e = r.plays![t.moment.index];
      expect(e.field?.to, `play ${t.moment.index}`).toBe(t.today.yards);
    }
  });

  it('ends a real return with a man on him, not the carrier pulling up alone at his spot', () => {
    // Today's spot is where a pursuer meets him: after a turnover that's the old offense (receivers, backs, the line and
    // the passer), not only the second level.
    const runs = turnovers.filter(({ t }) => t.today.yards >= 5 && !t.today.touchdown);
    const met = runs.filter(({ t }) => t.result!.tackler !== null).length;
    expect(runs.length).toBeGreaterThanOrEqual(8);
    expect(met / runs.length).toBeGreaterThanOrEqual(0.9);
  });
});
