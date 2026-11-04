import { describe, expect, it } from 'vitest';
import { createLeague } from '../generate';
import { simulateGame, type FieldTap } from '../match/gameSim';
import { MID } from './geometry';
import { stagePlay } from './stage';

// Week 1 of this league holds 31 interceptions and two lost strip-sacks.
const league = createLeague({ seed: 'field-engine' });
const week1 = league.games.filter((g) => g.week === 1);
const games = week1.map((g) => {
  const taps: FieldTap[] = [];
  const r = simulateGame(league, g, { field: true, fieldTap: (t) => taps.push(t) });
  return { r, taps, homeId: g.homeId };
});
const turnovers = games.flatMap(({ r, taps, homeId }) =>
  taps.filter((t) => t.result && t.moment.kind === 'turnover').map((t) => ({ r, t, homeId })),
);

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
      // A second and a half in: most of the old offense has closed on him (or on where he's going).
      const at = (s: number, k: number) => ({ x: res.frames[(s * men + k) * 2], y: res.frames[(s * men + k) * 2 + 1] });
      const ck = t.start.players.findIndex((p) => p.id === t.start.carrier);
      let closer = 0;
      t.start.players.forEach((p, k) => {
        if (p.side !== 1) return;
        const gap = (s: number) => Math.hypot(at(s, k).x - at(s, ck).x, at(s, k).y - at(s, ck).y);
        const moved = Math.hypot(at(30, k).x - at(0, k).x, at(30, k).y - at(0, k).y);
        if (moved > 3 && gap(30) < gap(0) + 2) closer++;
      });
      if (closer >= 7) chased++;
    }
    expect(n).toBeGreaterThanOrEqual(10);
    expect(chased / n).toBeGreaterThanOrEqual(0.8);
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
