import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bodyAs } from './training';
import { coachingFor } from './coaching';
import {
  beginYear,
  developBlock,
  developPlayer,
  developWeek,
  MOOD_TILT,
  CEILING_SWING,
  playedShare,
  RELEASE,
  rollInputs,
  trueUp,
  unsettledSpread,
  weekWeight,
  yearTargets,
} from './development';
import { createLeague } from './generate';
import { playerOvr } from './positions';
import { Rng } from './rng';
import type { League, Player } from './types';
import { ATTRIBUTES } from './types';

const copy = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

// These test the release itself: moods seeded by `createLeague` would tilt them (G2's tilt has its own tests below).
beforeAll(() => (MOOD_TILT.growth = 0));
afterAll(() => (MOOD_TILT.growth = 0.1));

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

describe('a ceiling that settles mid-year', () => {
  const split = { newYear: 0.5, program: 0.05, camp: 0.05, season: 0.4 };

  it('a year rolled before its ceiling settles lands, in steps, where one jump would', () => {
    withSplit(split, () => {
      for (const move of [2, -2]) {
        const fresh = createLeague({ seed: 'release-settle' });
        const ps = Object.values(fresh.players)
          .filter((p) => p.teamId !== null && p.age <= 23)
          .slice(0, 40);
        for (const p of ps) {
          const { rng, ctx } = year(fresh, p);
          const once = copy(p);
          developPlayer(rng(), once, ctx);
          beginYear(fresh, rng(), p, ctx);
          p.age++;
          // The ceiling settles after the year was rolled: only next year's roll may read it.
          p.potential = Math.max(1, Math.min(20, p.potential + move));
          developBlock(fresh, 'program');
          trueUp(fresh, p);
          expect(p.ratings).toEqual(once.ratings);
        }
      }
    });
  });

  it('an open year from a v56 save reads the player ceiling', () => {
    withSplit(split, () => {
      const fresh = createLeague({ seed: 'release-settle' });
      const p = Object.values(fresh.players).find((x) => x.teamId !== null && x.age <= 22)!;
      const { rng, ctx } = year(fresh, p);
      beginYear(fresh, rng(), p, ctx);
      p.age++;
      expect(p.dev?.potential).toBe(p.potential);
      const kept = yearTargets(fresh, p);
      delete p.dev!.potential;
      expect(yearTargets(fresh, p)).toEqual(kept);
    });
  });
});

describe('unsettledSpread', () => {
  const league = createLeague({ seed: 'release' });
  const base = Object.values(league.players).find((p) => p.age <= 23)!;
  const rookie = (over: Partial<Player>) => ({
    ...copy(base),
    age: 22,
    experience: 0,
    ceilingShifts: undefined,
    ...over,
  });

  it('counts every swing still to come', () => {
    expect(CEILING_SWING).toEqual([2.2, 1.5, 0.8]);
    expect(unsettledSpread(rookie({}), league.season)).toBeCloseTo(Math.hypot(2.2, 1.5, 0.8), 9);
    expect(unsettledSpread(rookie({ ceilingShifts: { [league.season]: 0 } }), league.season)).toBeCloseTo(
      Math.hypot(1.5, 0.8),
      9,
    );
    expect(unsettledSpread(rookie({ experience: 2 }), league.season)).toBeCloseTo(0.8, 9);
  });

  it('is nothing once he is past it', () => {
    expect(unsettledSpread(rookie({ experience: 3 }), league.season)).toBe(0);
    expect(unsettledSpread(rookie({ age: 26 }), league.season)).toBe(0);
  });
});

describe("mood tilts a young player's year (G2)", () => {
  beforeAll(() => (MOOD_TILT.growth = 0.1));
  afterAll(() => (MOOD_TILT.growth = 0));

  /** A league whose moods are all Okay but 20 Superb and 20 Abysmal growers (mean 0), and ten happy veterans. */
  function setup() {
    const league = createLeague({ seed: 'tilt' });
    for (const p of Object.values(league.players)) p.morale = { level: 0, jolts: [] };
    const rostered = Object.values(league.players).filter((p) => p.teamId !== null);
    const growers = rostered.filter((p) => p.age <= 23 && p.potential > playerOvr(p) + 1).slice(0, 40);
    const happy = growers.slice(0, 20);
    const sad = growers.slice(20);
    const veterans = rostered.filter((p) => p.age >= 30).slice(0, 10);
    for (const p of [...happy, ...veterans]) p.morale = { level: 10, jolts: [] };
    for (const p of sad) p.morale = { level: -10, jolts: [] };
    const before = new Map<number, Player>();
    const inputs = new Map<number, ReturnType<typeof year>>();
    for (const p of [...growers, ...veterans]) {
      const y = year(league, p);
      before.set(p.id, copy(p));
      inputs.set(p.id, y);
      beginYear(league, y.rng(), p, y.ctx);
      p.age++;
    }
    /** The one jump from where he stood before the roll, with a tilt of `mood`. */
    const jump = (p: Player, mood: number) => {
      const o = copy(before.get(p.id)!);
      const { rng, ctx } = inputs.get(p.id)!;
      developPlayer(rng(), o, { ...ctx, mood });
      return o;
    };
    return { league, happy, sad, veterans, growers, before, jump };
  }

  it('lands a Superb year where one jump with a +0.10 tilt would, an Abysmal one at −0.10', () => {
    const { league, happy, sad, jump } = setup();
    developBlock(league, 'program');
    developBlock(league, 'camp');
    for (let w = 0; w < 18; w++) developWeek(league, []);
    for (const p of happy) expect(p.ratings).toEqual(jump(p, 0.1).ratings);
    for (const p of sad) expect(p.ratings).toEqual(jump(p, -0.1).ratings);
    // The tilt did something: some Superb year ends above where it would have without one.
    expect(happy.some((p) => ATTRIBUTES.some((a) => p.ratings[a] > jump(p, 0).ratings[a]))).toBe(true);
  });

  it('tilts only the ratings he was gaining', () => {
    const { growers, before, jump } = setup();
    for (const p of growers)
      for (const a of ATTRIBUTES) {
        const flat = jump(p, 0).ratings[a] - before.get(p.id)!.ratings[a];
        // A falling rating lands as rolled; a rising one (even a hair that rounds to nothing) only tilts his way.
        if (flat < 0) {
          expect(jump(p, 0.1).ratings[a]).toBe(jump(p, 0).ratings[a]);
          expect(jump(p, -0.1).ratings[a]).toBe(jump(p, 0).ratings[a]);
        }
        expect(jump(p, 0.1).ratings[a]).toBeGreaterThanOrEqual(jump(p, 0).ratings[a]);
        expect(jump(p, -0.1).ratings[a]).toBeLessThanOrEqual(jump(p, 0).ratings[a]);
      }
  });

  it('keeps no tilt for a year rolled at 26 or older', () => {
    const { league, veterans } = setup();
    developBlock(league, 'program');
    developBlock(league, 'camp');
    for (const p of veterans) expect(p.dev?.mood).toBeUndefined();
    for (let w = 0; w < 9; w++) developWeek(league, []);
    for (const p of veterans) expect(p.dev?.mood).toBeUndefined();
  });

  it('never steps a rating back, though his mood turns mid-season', () => {
    const { league, happy, growers } = setup();
    const seen = new Map<number, number[][]>(growers.map((p) => [p.id, [ATTRIBUTES.map((a) => p.ratings[a])]]));
    const record = () => {
      for (const p of growers) seen.get(p.id)!.push(ATTRIBUTES.map((a) => p.ratings[a]));
    };
    developBlock(league, 'program');
    record();
    developBlock(league, 'camp');
    record();
    for (let w = 0; w < 18; w++) {
      if (w === 9) for (const p of happy) p.morale = { level: -10, jolts: [] };
      developWeek(league, []);
      record();
    }
    for (const p of growers) {
      const steps = seen.get(p.id)!;
      const end = steps[steps.length - 1];
      ATTRIBUTES.forEach((_, i) => {
        const dir = Math.sign(end[i] - steps[0][i]);
        for (let k = 1; k < steps.length; k++) {
          expect(Number.isInteger(steps[k][i])).toBe(true);
          if (dir >= 0) expect(steps[k][i]).toBeGreaterThanOrEqual(steps[k - 1][i]);
          if (dir <= 0) expect(steps[k][i]).toBeLessThanOrEqual(steps[k - 1][i]);
        }
      });
    }
  });

  it('measures the tilt against the young players growing, so a room of sulking rookies grows as rolled', () => {
    const { league, growers, jump } = setup();
    // Every grower Very poor, the rest of the league Okay: against each other, none of them tilts.
    for (const p of growers) p.morale = { level: -5, jolts: [] };
    developBlock(league, 'program');
    developBlock(league, 'camp');
    for (let w = 0; w < 18; w++) developWeek(league, []);
    for (const p of growers) expect(p.ratings).toEqual(jump(p, 0).ratings);
  });

  it('tilts nobody who has no mood on record', () => {
    const { league, growers, jump } = setup();
    // The young players' mean is −10 among these, so a man with no mood would otherwise read as happy.
    const [none] = growers;
    for (const p of growers) p.morale = { level: -10, jolts: [] };
    delete none.morale;
    developBlock(league, 'program');
    developBlock(league, 'camp');
    for (let w = 0; w < 18; w++) developWeek(league, []);
    expect(none.ratings).toEqual(jump(none, 0).ratings);
  });

  it('closes a growth year early only once no tilt could still move a rating', () => {
    // Every rostered young player, so some have a year that's all but landed in March.
    const league = createLeague({ seed: 'tilt-close' });
    for (const p of Object.values(league.players)) p.morale = { level: 0, jolts: [] };
    const young = Object.values(league.players).filter((p) => p.teamId !== null && p.age <= 25);
    const jumps = new Map<number, [Player, Player]>();
    for (const p of young) {
      const { rng, ctx } = year(league, p);
      const up = copy(p);
      const down = copy(p);
      developPlayer(rng(), up, { ...ctx, mood: 0.1 });
      developPlayer(rng(), down, { ...ctx, mood: -0.1 });
      jumps.set(p.id, [up, down]);
      beginYear(league, rng(), p, ctx);
      p.age++;
    }
    const closed = young.filter((p) => !p.dev);
    // Closed early only when the most a mood could tilt it lands it where it stands, either way.
    expect(closed.length).toBeGreaterThan(0);
    for (const p of closed) {
      const [up, down] = jumps.get(p.id)!;
      expect(p.ratings).toEqual(up.ratings);
      expect(p.ratings).toEqual(down.ratings);
    }
  });
});
