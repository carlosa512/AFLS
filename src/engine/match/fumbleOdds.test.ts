import { describe, expect, it } from 'vitest';
import type { QuirkId } from '../quirks';
import { createLeague } from '../generate';
import { skill } from '../attributes';
import { forcedOdds, fumbleOdds, fumbleWhy, PEER_SECURITY, TYPICAL, type ContactFacts } from './fumbleOdds';

type Over = Partial<Omit<ContactFacts, 'carrier' | 'tackler'>> & {
  carrier?: Partial<Omit<ContactFacts['carrier'], 'has'>> & { habits?: QuirkId[] };
  tackler?: Partial<Omit<ContactFacts['tackler'], 'has'>> & { habits?: QuirkId[] };
};

/** A typical run tackled in bounds: 1st and 10, nothing on the clock, typical men, no habits. */
function typical(over: Over = {}): ContactFacts {
  const { carrier = {}, tackler = {}, ...rest } = over;
  const { habits: ch = [], ...c } = carrier;
  const { habits: th = [], ...t } = tackler;
  return {
    kind: 'run',
    down: 1,
    toGo: 10,
    trailingLate: false,
    leadingLate: false,
    weather: 1,
    size: 0,
    ...rest,
    carrier: {
      position: 'RB',
      ballSecurity: PEER_SECURITY.RB!,
      energy: TYPICAL.energy,
      ...c,
      has: (q) => ch.includes(q),
    },
    tackler: { tackling: TYPICAL.tackling, ...t, has: (q) => th.includes(q) },
  };
}
const odds = (over: Over = {}) => fumbleOdds(typical(over));

describe('a fumble on contact', () => {
  it('sits on its base for a typical tackle, whatever the early down', () => {
    expect(odds()).toBeCloseTo(odds({ down: 2 }), 12);
    for (const kind of ['run', 'catch', 'scramble'] as const) expect(odds({ kind })).toBeGreaterThan(0.005);
  });

  it('stays in bounds', () => {
    const wild = typical({
      down: 4,
      toGo: 10,
      trailingLate: true,
      weather: 1.5,
      size: 2,
      carrier: {
        ballSecurity: 1,
        energy: 0,
        habits: ['looseCarriage', 'highKnee', 'finishesForward'],
      },
      tackler: { tackling: 20, habits: ['ballStripper', 'thumper'] },
    });
    const meek = typical({
      leadingLate: true,
      size: -2,
      carrier: { ballSecurity: 20, habits: ['contactAverse'] },
      tackler: { tackling: 1, habits: ['armTackler'] },
    });
    for (const f of [typical(), typical({ kind: 'catch' }), typical({ kind: 'scramble' }), wild, meek]) {
      expect(fumbleOdds(f)).toBeGreaterThanOrEqual(0.001);
      expect(fumbleOdds(f)).toBeLessThanOrEqual(0.08);
    }
  });

  it('each factor leans its way', () => {
    const base = odds();
    const up: Over[] = [
      { carrier: { ballSecurity: 6 } },
      { carrier: { energy: 60 } },
      { tackler: { tackling: 17 } },
      { size: 1.5 },
      { carrier: { habits: ['looseCarriage'] } },
      { carrier: { habits: ['highKnee'] } },
      { tackler: { habits: ['ballStripper'] } },
      { tackler: { habits: ['thumper'] } },
      { down: 3, toGo: 7 },
      { down: 4, toGo: 2 },
      { trailingLate: true },
      { carrier: { habits: ['finishesForward'] } },
      { weather: 1.3 },
    ];
    for (const o of up) expect(odds(o), JSON.stringify(o)).toBeGreaterThan(base);
    const down: Over[] = [
      { carrier: { habits: ['contactAverse'] } },
      { tackler: { habits: ['armTackler'] } },
      { leadingLate: true },
    ];
    for (const o of down) expect(odds(o), JSON.stringify(o)).toBeLessThan(base);
  });

  it("reads ball security against his position's typical man: a median quarterback runs as safely as a median back", () => {
    for (const kind of ['run', 'catch', 'scramble'] as const) {
      const at = (position: 'QB' | 'RB' | 'WR' | 'TE') =>
        odds({ kind, carrier: { position, ballSecurity: PEER_SECURITY[position]! } });
      expect(at('QB')).toBeCloseTo(at('RB'), 12);
      expect(at('WR')).toBeCloseTo(at('TE'), 12);
      // Below his position's median, more.
      expect(odds({ kind, carrier: { position: 'QB', ballSecurity: 5 } })).toBeGreaterThan(at('QB'));
    }
  });

  it("keeps each position's typical ball security where a new league builds it", () => {
    const league = createLeague({ seed: 'peer-security' });
    for (const [pos, typical] of Object.entries(PEER_SECURITY)) {
      const v = Object.values(league.players)
        .filter((p) => p.position === pos)
        .map((p) => skill(p, 'ballSecurity'))
        .sort((a, b) => a - b);
      expect(Math.abs(v[v.length >> 1] - typical!), pos).toBeLessThanOrEqual(1);
    }
  });

  it('is forced half the time on a run, nearly always on a catch or a scramble', () => {
    expect(forcedOdds('run')).toBe(0.5);
    expect(forcedOdds('catch')).toBe(0.95);
    expect(forcedOdds('scramble')).toBe(0.95);
  });

  it('names the reason the leans point to', () => {
    const tally = (f: ContactFacts) => {
      const n = { strip: 0, hit: 0, fight: 0 };
      for (let u = 0.005; u < 1; u += 0.01) n[fumbleWhy(f, u)]++;
      return n;
    };
    const most = (n: Record<string, number>) => Object.entries(n).sort((a, b) => b[1] - a[1])[0][0];
    const plain = tally(typical());
    expect(plain.strip > 0 && plain.hit > 0 && plain.fight > 0).toBe(true);
    expect(most(tally(typical({ leadingLate: true, tackler: { habits: ['ballStripper'] } })))).toBe('strip');
    expect(most(tally(typical({ down: 4, toGo: 7, carrier: { habits: ['finishesForward'] } })))).toBe('fight');
    expect(most(tally(typical({ size: 2, tackler: { habits: ['thumper'] } })))).toBe('hit');
  });
});
