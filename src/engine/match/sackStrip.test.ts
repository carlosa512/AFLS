import { describe, expect, it } from 'vitest';
import type { QuirkId } from '../quirks';
import { forcedOdds, PEER_SECURITY, rushSpot, sackStripOdds, TYPICAL, type SackFacts } from './fumbleOdds';

type Over = Partial<Omit<SackFacts, 'qb' | 'rusher'>> & {
  qb?: Partial<Omit<SackFacts['qb'], 'has'>> & { habits?: QuirkId[] };
  rusher?: Partial<Omit<SackFacts['rusher'], 'has'>> & { habits?: QuirkId[] };
};

/** A typical sack: 1st and 10, an edge rusher of typical tackling, a typical quarterback, even builds. */
function typical(over: Over = {}): SackFacts {
  const { qb = {}, rusher = {}, ...rest } = over;
  const { habits: qh = [], ...q } = qb;
  const { habits: rh = [], ...r } = rusher;
  return {
    down: 1,
    toGo: 10,
    trailingLate: false,
    leadingLate: false,
    weather: 1,
    size: 0,
    ...rest,
    qb: { ballSecurity: PEER_SECURITY.QB!, energy: TYPICAL.energy, ...q, has: (x) => qh.includes(x) },
    rusher: { spot: 'edge', tackling: TYPICAL.tackling, ...r, has: (x) => rh.includes(x) },
  };
}
const odds = (o: Over = {}) => sackStripOdds(typical(o));

describe('a strip-sack', () => {
  it('sits on its base for a typical sack, and an interior rusher strips less', () => {
    expect(odds()).toBeCloseTo(0.172, 3);
    expect(odds({ rusher: { spot: 'interior' } })).toBeLessThan(odds());
  });

  it('each factor leans its way, and stays in bounds', () => {
    const base = odds();
    const up: Over[] = [
      { qb: { ballSecurity: 4 } },
      { qb: { energy: 60 } },
      { qb: { habits: ['patsTheBall'] } },
      { rusher: { tackling: 17 } },
      { size: 1.5 },
      { rusher: { habits: ['thumper'] } },
      { rusher: { habits: ['ballStripper'] } },
      { trailingLate: true },
      { weather: 1.3 },
    ];
    for (const o of up) expect(odds(o), JSON.stringify(o)).toBeGreaterThan(base);
    for (const o of [{ down: 3, toGo: 7 }, { rusher: { habits: ['armTackler'] as QuirkId[] } }] as Over[])
      expect(odds(o), JSON.stringify(o)).toBeLessThan(base);
    const wild = odds({
      trailingLate: true,
      weather: 1.5,
      size: 2,
      qb: { ballSecurity: 1, energy: 0, habits: ['patsTheBall'] },
      rusher: { tackling: 20, habits: ['ballStripper', 'thumper'] },
    });
    const meek = odds({
      down: 3,
      size: -2,
      qb: { ballSecurity: 20 },
      rusher: { spot: 'interior', tackling: 1, habits: ['armTackler'] },
    });
    for (const p of [wild, meek, base]) {
      expect(p).toBeGreaterThanOrEqual(0.02);
      expect(p).toBeLessThanOrEqual(0.3);
    }
  });

  it('is nearly always forced, and reads the rusher’s spot from his position', () => {
    expect(forcedOdds('sack')).toBe(0.92);
    expect(rushSpot('EDGE')).toBe('edge');
    expect(rushSpot('CB')).toBe('edge');
    expect(rushSpot('S')).toBe('edge');
    expect(rushSpot('DT')).toBe('interior');
    expect(rushSpot('LB')).toBe('interior');
  });
});
