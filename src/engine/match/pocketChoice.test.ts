import { describe, expect, it } from 'vitest';
import type { QuirkId } from '../quirks';
import {
  groundingOdds,
  OPEN,
  outsideOdds,
  pocketCall,
  pocketOdds,
  TYPICAL,
  type PocketFacts,
  type PocketPasser,
} from './pocketChoice';

type Over = Partial<Omit<PocketFacts, 'passer'>> & {
  passer?: Partial<Omit<PocketPasser, 'has'>> & { habits?: QuirkId[] };
};

/** A typical starter, 1st and 10 at midfield, a clean pocket and his read just open. */
function typical(over: Over = {}): PocketFacts {
  const { passer = {}, ...rest } = over;
  const { habits = [], ...ratings } = passer;
  return {
    pressured: false,
    sep: OPEN,
    depth: 'short',
    down: 1,
    toGo: 10,
    toGoal: 50,
    trailingLate: false,
    ...rest,
    passer: { ...TYPICAL, hurt: 0, rattled: 0, ...ratings, has: (q) => habits.includes(q) },
  };
}
const odds = (over: Over = {}) => pocketOdds(typical(over));
const P = { pressured: true } as const;

describe('the passer’s choice', () => {
  it('odds sum to 1 and stay in bounds', () => {
    const wild = typical({
      pressured: true,
      sep: -6,
      down: 3,
      toGo: 15,
      passer: {
        scrambling: 20,
        decisions: 1,
        poise: 1,
        rattled: 1,
        energy: 0,
        hurt: 3,
        habits: ['bailsEarly', 'seesGhosts'],
      },
    });
    const meek = typical({
      sep: 8,
      down: 4,
      toGo: 1,
      passer: { scrambling: 1, pocket: 20, habits: ['gunslinger', 'muddyPockets'] },
    });
    for (const f of [typical(), typical(P), wild, meek]) {
      const o = pocketOdds(f);
      expect(Math.abs(o.throw + o.away + o.run - 1)).toBeLessThan(1e-12);
      expect(o.away).toBeGreaterThanOrEqual(0.002);
      expect(o.away).toBeLessThanOrEqual(0.45);
      expect(o.run).toBeGreaterThanOrEqual(0.002);
      expect(o.run).toBeLessThanOrEqual(0.5);
      expect(o.throw).toBeGreaterThan(0);
    }
  });

  it('pressure raises both', () => {
    expect(odds(P).away).toBeGreaterThan(odds().away);
    expect(odds(P).run).toBeGreaterThan(odds().run);
  });

  it('a covered read raises both, an open one lowers them', () => {
    for (const pressured of [false, true]) {
      const at = (sep: number) => odds({ pressured, sep });
      expect(at(OPEN - 3).away).toBeGreaterThan(at(OPEN).away);
      expect(at(OPEN - 3).run).toBeGreaterThan(at(OPEN).run);
      expect(at(OPEN + 3).away).toBeLessThan(at(OPEN).away);
      expect(at(OPEN + 3).run).toBeLessThan(at(OPEN).run);
    }
  });

  it('the down leans its way', () => {
    for (const pressured of [false, true]) {
      const first = odds({ pressured });
      const third = odds({ pressured, down: 3, toGo: 7 });
      const fourth = odds({ pressured, down: 4, toGo: 7 });
      expect(third.away).toBeLessThan(first.away);
      expect(third.run).toBeGreaterThan(first.run);
      expect(fourth.away).toBeLessThan(third.away);
    }
  });

  it('red zone raises away; backed up lowers a clean run; trailing late lowers run', () => {
    expect(odds({ toGoal: 15 }).away).toBeGreaterThan(odds().away);
    expect(odds({ ...P, toGoal: 15 }).away).toBeGreaterThan(odds(P).away);
    expect(odds({ toGoal: 95 }).run).toBeLessThan(odds().run);
    expect(odds({ ...P, trailingLate: true }).run).toBeLessThan(odds(P).run);
  });

  it('a typical spot adds nothing', () => {
    for (const pressured of [false, true]) {
      const base = odds({ pressured });
      expect(odds({ pressured, down: 2 })).toEqual(base);
      expect(odds({ pressured, toGoal: 60 })).toEqual(base);
      expect(odds({ pressured, passer: { ...TYPICAL } })).toEqual(base);
    }
  });

  it('ratings lean their way', () => {
    expect(odds({ passer: { scrambling: 17 } }).run).toBeGreaterThan(odds().run);
    expect(odds({ ...P, passer: { pocket: 17 } }).run).toBeLessThan(odds(P).run);
    expect(odds({ ...P, passer: { decisions: 17 } }).away).toBeGreaterThan(odds(P).away);
    expect(odds({ ...P, passer: { poise: 17 } }).away).toBeLessThan(odds(P).away);
    expect(odds({ passer: { energy: 60 } }).run).toBeLessThan(odds().run);
    expect(odds({ passer: { hurt: 2 } }).run).toBeLessThan(odds().run);
  });

  it('decision-making sharpens the read of the situation', () => {
    const fourth = (decisions: number) => odds({ down: 4, toGo: 7, passer: { decisions } }).away;
    const first = (decisions: number) => odds({ passer: { decisions } }).away;
    // How far 4th down takes his throwaways down, against 1st: further for a sharp man.
    expect(Math.log(first(18) / fourth(18))).toBeGreaterThan(Math.log(first(4) / fourth(4)));
  });

  it('each habit leans its way', () => {
    const ratio = (o: ReturnType<typeof odds>) => o.away / o.throw;
    expect(ratio(odds({ ...P, passer: { habits: ['gunslinger'] } })) / ratio(odds(P))).toBeCloseTo(1 / 3, 6);
    expect(odds({ passer: { habits: ['bailsEarly'] } }).run).toBeGreaterThan(odds().run);
    const lift = (depth: 'short' | 'deep') =>
      odds({ depth, passer: { habits: ['bailsEarly'] } }).run / odds({ depth }).run;
    expect(lift('deep')).toBeGreaterThan(lift('short'));
    expect(odds({ ...P, passer: { habits: ['muddyPockets'] } }).away).toBeLessThan(odds(P).away);
    expect(odds({ ...P, passer: { habits: ['muddyPockets'] } }).run).toBeLessThan(odds(P).run);
    expect(odds({ passer: { rattled: 1, habits: ['seesGhosts'] } }).away).toBeGreaterThan(odds().away);
    expect(odds({ passer: { rattled: 1, habits: ['seesGhosts'] } }).run).toBeGreaterThan(odds().run);
    expect(odds({ passer: { rattled: 0, habits: ['seesGhosts'] } })).toEqual(odds());
  });

  it('one draw makes the call', () => {
    const o = { throw: 0.7, away: 0.2, run: 0.1 };
    expect(pocketCall(o, 0.1)).toBe('away');
    expect(pocketCall(o, 0.25)).toBe('run');
    expect(pocketCall(o, 0.5)).toBe('throw');
  });

  it('a throwaway from outside the pocket', () => {
    const base = outsideOdds(typical());
    expect(base).toBeGreaterThan(0);
    expect(base).toBeLessThan(1);
    expect(outsideOdds(typical({ passer: { scrambling: 17 } }))).toBeGreaterThan(base);
    expect(outsideOdds(typical({ passer: { habits: ['bailsEarly'] } }))).toBeGreaterThan(base);
    expect(outsideOdds(typical(P))).toBeGreaterThan(base);
  });

  it('grounding is called most inside the pocket under pressure', () => {
    expect(groundingOdds(true, false)).toBeGreaterThan(groundingOdds(true, true));
    expect(groundingOdds(true, true)).toBeGreaterThan(groundingOdds(false, false));
    expect(groundingOdds(false, false)).toBeLessThanOrEqual(0.02);
  });
});
