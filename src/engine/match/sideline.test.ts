import { describe, expect, it } from 'vitest';
import type { QuirkId } from '../quirks';
import {
  outOfBoundsIn,
  sidelineCall,
  sidelineOdds,
  stepReason,
  steppedCredit,
  TYPICAL,
  type SidelineFacts,
  type SidelineKind,
} from './sideline';

type Over = Partial<Omit<SidelineFacts, 'carrier' | 'chaser'>> & {
  carrier?: Partial<Omit<SidelineFacts['carrier'], 'has'>> & { habits?: QuirkId[] };
  chaser?: Partial<Omit<SidelineFacts['chaser'], 'has'>> & { habits?: QuirkId[] };
};

/** A typical starter at the sideline, four yards into it, nothing on the clock. */
function typical(kind: SidelineKind, over: Over = {}): SidelineFacts {
  const { carrier = {}, chaser = {}, ...rest } = over;
  const ch = carrier.habits ?? [];
  const dh = chaser.habits ?? [];
  return {
    kind,
    wide: 1,
    run: 4,
    free: false,
    clock: 'none',
    shortOfSticks: false,
    edge: TYPICAL.edge,
    ...rest,
    carrier: {
      position: kind === 'scramble' ? 'QB' : kind === 'run' ? 'RB' : 'WR',
      speed: TYPICAL.speed,
      build: 0,
      energy: TYPICAL.energy,
      hurt: 0,
      poise: TYPICAL.poise,
      ...carrier,
      has: (q) => ch.includes(q),
    },
    chaser: {
      pursuit: TYPICAL.pursuit,
      tackling: TYPICAL.tackling,
      ...chaser,
      has: (q) => dh.includes(q),
    },
  };
}

const KINDS: SidelineKind[] = ['catch', 'run', 'scramble'];
const odds = (kind: SidelineKind, over: Over = {}) => sidelineOdds(typical(kind, over));

describe('out of bounds as the carrier’s choice', () => {
  it('a free carrier in normal play rarely steps out', () => {
    expect(odds('catch', { free: true, run: 12 }).stepped).toBeLessThan(0.02);
    // On the ground the pursuit is still there at the end of a long run (NFL outside runs of 10+ yards: 5.8% step out),
    // and most long runs in the engine broke a tackle: free only leans him to keep going.
    expect(odds('run', { free: true, run: 15 }).stepped).toBeLessThan(odds('run', { run: 15 }).stepped);
  });

  it('the sideline raises both odds over the middle', () => {
    for (const kind of ['catch', 'run'] as const) {
      expect(odds(kind).pushed).toBeGreaterThan(odds(kind, { wide: 0 }).pushed);
      expect(odds(kind).stepped).toBeGreaterThan(odds(kind, { wide: 0 }).stepped);
    }
  });

  it('long gains get pushed out more', () => {
    expect(odds('run', { run: 20 }).pushed).toBeGreaterThan(odds('run', { run: 0 }).pushed);
    expect(odds('catch', { run: 12 }).pushed).toBeGreaterThan(odds('catch', { run: 1 }).pushed);
  });

  it('the clock orders stepping out', () => {
    for (const kind of KINDS) {
      const s = (clock: SidelineFacts['clock']) => odds(kind, { clock }).stepped;
      expect(s('in')).toBeLessThan(s('none'));
      expect(s('none')).toBeLessThan(s('out'));
    }
  });

  it('protecting a lead, he cuts back inside', () => {
    expect(odds('catch', { clock: 'in' }).pushed).toBeLessThan(odds('catch').pushed);
  });

  it('short of the sticks he fights for the marker', () => {
    expect(odds('catch', { shortOfSticks: true }).stepped).toBeLessThan(odds('catch').stepped);
  });

  it('each habit leans its way', () => {
    const base = odds('catch');
    for (const q of ['contactAverse', 'hearsFootsteps', 'runsEastWest'] as QuirkId[])
      expect(odds('catch', { carrier: { habits: [q] } }).stepped).toBeGreaterThan(base.stepped);
    for (const q of ['finishesForward', 'yacSlasher', 'highKnee'] as QuirkId[])
      expect(odds('catch', { carrier: { habits: [q] } }).stepped).toBeLessThan(base.stepped);
    expect(odds('scramble', { carrier: { habits: ['bailsEarly'] } }).stepped).toBeGreaterThan(odds('scramble').stepped);
    expect(odds('catch', { carrier: { habits: ['runsEastWest'] } }).pushed).toBeGreaterThan(base.pushed);
    expect(odds('run', { carrier: { habits: ['bouncesExternal'] } }).pushed).toBeGreaterThan(odds('run').pushed);
    for (const q of ['alleyCrusher', 'scraper', 'businessDecision'] as QuirkId[])
      expect(odds('catch', { chaser: { habits: [q] } }).pushed).toBeGreaterThan(base.pushed);
    expect(odds('catch', { chaser: { habits: ['thumper'] } }).pushed).toBeLessThan(base.pushed);
  });

  it('ratings lean their way', () => {
    const base = odds('run');
    expect(odds('run', { chaser: { pursuit: 17 } }).pushed).toBeGreaterThan(base.pushed);
    expect(odds('run', { chaser: { tackling: 17 } }).pushed).toBeLessThan(base.pushed);
    expect(odds('run', { edge: 17 }).pushed).toBeLessThan(base.pushed);
    expect(odds('run', { carrier: { speed: 17 } }).pushed).toBeGreaterThan(base.pushed);
    expect(odds('run', { carrier: { build: 2 } }).stepped).toBeLessThan(base.stepped);
    expect(odds('run', { carrier: { energy: 60 } }).stepped).toBeGreaterThan(base.stepped);
    expect(odds('run', { carrier: { hurt: 2 } }).stepped).toBeGreaterThan(base.stepped);
    const wr = odds('catch').stepped;
    expect(odds('catch', { carrier: { position: 'TE' } }).stepped).toBeLessThan(wr);
    expect(odds('catch', { carrier: { position: 'RB' } }).stepped).toBeLessThan(wr);
  });

  it('poise sharpens the clock read', () => {
    const at = (poise: number, clock: SidelineFacts['clock']) => odds('catch', { clock, carrier: { poise } }).stepped;
    const none = odds('catch').stepped;
    expect(at(18, 'out') - none).toBeGreaterThan(at(4, 'out') - none);
    expect(none - at(18, 'in')).toBeGreaterThan(none - at(4, 'in'));
  });

  it('a typical starter sits on the base odds', () => {
    const o = odds('catch', { wide: 0, run: 4 });
    const again = sidelineOdds(typical('catch', { wide: 0, run: 4 }));
    expect(o).toEqual(again);
    // Nothing above typical: every rating and habit term is zero, so the odds are the kind's own.
    expect(odds('catch', { chaser: { pursuit: TYPICAL.pursuit } })).toEqual(odds('catch'));
  });

  it('odds stay in bounds', () => {
    const wild = odds('scramble', {
      clock: 'out',
      run: 40,
      carrier: {
        habits: ['contactAverse', 'hearsFootsteps', 'runsEastWest', 'bailsEarly'],
        energy: 0,
        hurt: 3,
        poise: 20,
      },
      chaser: { habits: ['alleyCrusher', 'scraper', 'businessDecision'], pursuit: 20, tackling: 1 },
    });
    expect(wild.pushed).toBeLessThanOrEqual(0.6);
    expect(wild.stepped).toBeLessThanOrEqual(0.65);
    const meek = odds('run', { wide: 0, run: -3, free: true, clock: 'in', shortOfSticks: true, edge: 20 });
    expect(meek.pushed).toBeGreaterThanOrEqual(0.002);
    expect(meek.stepped).toBeGreaterThanOrEqual(0.001);
  });

  it('one draw makes the call', () => {
    const o = { pushed: 0.2, stepped: 0.5 };
    expect(sidelineCall(o, 0.1)).toBe('pushed');
    expect(sidelineCall(o, 0.5)).toBe('stepped'); // 0.2 + 0.8 * 0.5 = 0.6
    expect(sidelineCall(o, 0.7)).toBe('in');
  });

  it('credit on a stepped-out play', () => {
    expect(steppedCredit(typical('run'))).toBe(1);
    expect(steppedCredit(typical('scramble'))).toBe(1);
    expect(steppedCredit(typical('catch', { free: true }))).toBeLessThan(steppedCredit(typical('catch')));
  });
});

describe('why he stepped out', () => {
  it('reads the clock first, then a man closing, else nothing', () => {
    expect(stepReason(typical('catch', { clock: 'out' }))).toBe('clock');
    expect(stepReason(typical('catch', { clock: 'out', free: false }))).toBe('clock');
    expect(stepReason(typical('run', { clock: 'none', free: false }))).toBe('hit');
    expect(stepReason(typical('run', { clock: 'none', free: true }))).toBeNull();
  });

  it('reads every out-of-bounds wording, old and new', () => {
    expect(outOfBoundsIn('A rush left for 4 yards (B), pushed out of bounds')).toBe('pushed');
    expect(outOfBoundsIn('A rush left for 4 yards (B), steps out of bounds')).toBe('stepped');
    expect(outOfBoundsIn('A pass complete for 9 yards (B), steps out of bounds to stop the clock')).toBe('stepped');
    expect(outOfBoundsIn('A rush right for 6 yards (B), gets out of bounds before the hit')).toBe('stepped');
    expect(outOfBoundsIn('K kicks off out of bounds')).toBeNull();
    expect(outOfBoundsIn('A rush up the middle for 3 yards (B)')).toBeNull();
  });
});
