import { describe, expect, it } from 'vitest';
import { bodyAs } from './training';
import { coachingFor } from './coaching';
import {
  beginYear,
  developBlock,
  developPlayer,
  developWeek,
  playedShare,
  RELEASE,
  rollInputs,
  trueUp,
  weekWeight,
} from './development';
import { createLeague } from './generate';
import { Rng } from './rng';
import type { League, Player } from './types';
import { ATTRIBUTES } from './types';

const copy = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

/** Run `fn` with the release split set to `split`, then put the dial back. */
function withSplit(split: Partial<typeof RELEASE>, fn: () => void) {
  const was = { ...RELEASE };
  Object.assign(RELEASE, split);
  try {
    fn();
  } finally {
    Object.assign(RELEASE, was);
  }
}

/** His year on the stream `beginOffseason` rolls it on (the league year at the roll), with the same inputs. */
function year(league: League, p: Player) {
  return {
    rng: () => new Rng(`${league.seed}:dev:${league.season}:${p.id}`),
    ctx: rollInputs({
      playedShare: playedShare(p, league.season),
      ...coachingFor(league, p.teamId, p.position),
      bodyAs: bodyAs(p),
    }),
  };
}

describe('roll once, release in steps', () => {
  const league = createLeague({ seed: 'release' });
  const sample = Object.values(league.players)
    .filter((p) => p.teamId !== null && (p.age <= 24 || p.age >= 30))
    .slice(0, 120);

  it('with everything released in March is one jump, with nothing kept', () => {
    withSplit({ newYear: 1, program: 0, camp: 0, season: 0 }, () => {
      for (const p of sample) {
        const { rng, ctx } = year(league, p);
        const once = copy(p);
        developPlayer(rng(), once, ctx);
        const steps = copy(p);
        beginYear(league, rng(), steps, ctx);
        expect(steps.ratings).toEqual(once.ratings);
        expect(steps.dev).toBeUndefined();
      }
    });
  });

  it('released in steps lands exactly where one jump would, without jitter on the way', () => {
    withSplit({ newYear: 0.5, program: 0.05, camp: 0.05, season: 0.4 }, () => {
      const once = new Map<number, Player>();
      const before = new Map<number, Player>();
      for (const p of sample) {
        const { rng, ctx } = year(league, p);
        const o = copy(p);
        developPlayer(rng(), o, ctx);
        once.set(p.id, o);
        before.set(p.id, copy(p));
        beginYear(league, rng(), p, ctx);
        p.age++; // as `beginOffseason` does right after the roll
        // A year whose rest rounds to nothing is done early, and keeps no record.
        if (p.dev) expect(p.dev.done).toBe(0.5);
        else expect(p.ratings).toEqual(o.ratings);
      }
      // Each step moves every rating toward its year's end, or leaves it: never back.
      const seen = new Map<number, number[]>(sample.map((p) => [p.id, ATTRIBUTES.map((a) => p.ratings[a])]));
      const check = () => {
        for (const p of sample) {
          const end = once.get(p.id)!;
          const last = seen.get(p.id)!;
          ATTRIBUTES.forEach((a, i) => {
            const dir = Math.sign(end.ratings[a] - before.get(p.id)!.ratings[a]);
            if (dir > 0) expect(p.ratings[a]).toBeGreaterThanOrEqual(last[i]);
            if (dir < 0) expect(p.ratings[a]).toBeLessThanOrEqual(last[i]);
            if (dir === 0) expect(p.ratings[a]).toBe(last[i]);
            expect(Number.isInteger(p.ratings[a])).toBe(true);
            last[i] = p.ratings[a];
          });
        }
      };
      developBlock(league, 'program');
      check();
      developBlock(league, 'camp');
      check();
      // Nobody plays (no games), so every rostered player is on his bye: a full week's share each week.
      for (let w = 0; w < 18; w++) {
        developWeek(league, []);
        check();
      }
      for (const p of sample) {
        expect(p.ratings).toEqual(once.get(p.id)!.ratings);
        expect(p.dev).toBeUndefined();
      }
    });
  });

  it('trues up whatever is still to come', () => {
    withSplit({ newYear: 0.5, program: 0.05, camp: 0.05, season: 0.4 }, () => {
      const fresh = createLeague({ seed: 'release' });
      const ps = Object.values(fresh.players)
        .filter((p) => p.teamId !== null && p.age <= 24)
        .slice(0, 60);
      for (const p of ps) {
        const { rng, ctx } = year(fresh, p);
        const once = copy(p);
        developPlayer(rng(), once, ctx);
        beginYear(fresh, rng(), p, ctx);
        p.age++;
        // Half a season of sitting out, then the true-up.
        for (let w = 0; w < 9; w++)
          developWeek(fresh, [
            { id: 1, season: fresh.season, week: w + 1, homeId: 30, awayId: 31, result: { playerStats: {} } } as never,
          ]);
        if (p.dev) expect(p.dev.done).toBeLessThan(1);
        trueUp(fresh, p);
        expect(p.ratings).toEqual(once.ratings);
        expect(p.dev).toBeUndefined();
      }
    });
  });

  it('weights a week he played in full, and a week he sat at the bench share of a starter', () => {
    expect(weekWeight(24, true)).toBe(1);
    expect(weekWeight(24, false)).toBeCloseTo(0.65 / 1.2, 5);
    expect(weekWeight(21, false)).toBeGreaterThan(0.85);
    expect(weekWeight(30, false)).toBeLessThan(0.6);
  });
});
