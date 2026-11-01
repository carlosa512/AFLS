import { describe, expect, it } from 'vitest';
import type { Position } from '../engine/types';
import { POSITIONS } from '../engine/types';
import { GEAR_MAX, GEAR_RATES, gearOf, type Gear } from './playerGear';

const N = 3000;
const players = (position: Position) => Array.from({ length: N }, (_, i) => ({ id: i + 1, position }));
const share = (position: Position, has: (g: Gear) => boolean, cold = false) =>
  players(position).filter((p) => has(gearOf(p, cold))).length / N;
const pieces = (g: Gear) =>
  [g.sleeve, g.undershirt, g.band, g.elbowPads, g.shoulderBrace].filter((x) => x !== undefined).length;

describe('gearOf', () => {
  it('gives a player the same gear every time', () => {
    for (const position of POSITIONS) expect(gearOf({ id: 42, position })).toEqual(gearOf({ id: 42, position }));
  });
  it('wears each piece about as often as its position does', () => {
    // a sleeve, elbow pads and a brace are drawn before the two-piece limit can bite, so they land on their rates
    expect(share('WR', (g) => !!g.sleeve)).toBeCloseTo(GEAR_RATES.WR.sleeve!, 1);
    expect(share('CB', (g) => !!g.sleeve)).toBeCloseTo(GEAR_RATES.CB.sleeve!, 1);
    expect(share('QB', (g) => !!g.sleeve)).toBeCloseTo(GEAR_RATES.QB.sleeve!, 1);
    expect(share('OL', (g) => !!g.elbowPads)).toBeCloseTo(GEAR_RATES.OL.elbowPads!, 1);
    expect(share('OL', (g) => !!g.shoulderBrace)).toBeCloseTo(GEAR_RATES.OL.brace!, 1);
    // most skill players wear something, most quarterbacks and kickers nothing
    expect(share('WR', (g) => pieces(g) > 0)).toBeGreaterThan(0.6);
    expect(share('QB', (g) => pieces(g) > 0)).toBeLessThan(0.6);
    expect(share('K', (g) => pieces(g) > 0)).toBeLessThan(0.4);
    // sleeves in the trenches: edge rushers most, then tackles, then the offensive line
    const sleeved = (position: Position) => share(position, (g) => !!g.sleeve);
    expect(sleeved('EDGE')).toBeGreaterThan(sleeved('DT'));
    expect(sleeved('DT')).toBeGreaterThan(sleeved('OL'));
    expect(sleeved('OL')).toBeGreaterThan(0);
  });
  it('never dresses a position in what it would not wear', () => {
    for (const position of ['OL', 'DT', 'EDGE'] as const)
      for (const p of players(position)) expect(gearOf(p).band).toBeUndefined();
    for (const position of ['QB', 'WR', 'CB', 'S', 'K', 'P'] as const)
      for (const p of players(position)) {
        const g = gearOf(p);
        expect(g.elbowPads ?? g.shoulderBrace).toBeUndefined();
      }
  });
  it('wears two pieces at most, and a cold game adds only its sleeves', () => {
    for (const position of POSITIONS)
      for (const p of players(position)) {
        expect(pieces(gearOf(p))).toBeLessThanOrEqual(GEAR_MAX);
        expect(pieces(gearOf(p, true))).toBeLessThanOrEqual(GEAR_MAX + 1);
      }
  });
  it('puts bands on both biceps, a single band on the forearm', () => {
    const bands = players('WR')
      .map((p) => gearOf(p).band)
      .filter((b) => b !== undefined);
    const biceps = bands.filter((b) => b.at === 'biceps');
    expect(biceps.filter((b) => b.side === 'both').length / biceps.length).toBeGreaterThan(0.75);
    for (const b of bands.filter((x) => x.at === 'forearm')) expect(b.side).not.toBe('both');
  });
  it('makes shooter sleeves usual for quarterbacks, receivers and the secondary, on both arms mostly in the secondary', () => {
    const shooters = (position: Position) => {
      const sleeves = players(position)
        .map((p) => gearOf(p).sleeve)
        .filter((s) => s !== undefined);
      const all = sleeves.filter((s) => s.length === 'shooter');
      return { share: all.length / sleeves.length, both: all.filter((s) => s.side === 'both').length / all.length };
    };
    for (const position of ['QB', 'WR', 'CB', 'S'] as const)
      expect(shooters(position).share, position).toBeGreaterThan(0.2);
    expect(shooters('QB').both).toBeLessThan(0.1);
    expect(shooters('WR').both).toBeLessThan(0.25);
    expect(shooters('CB').both).toBeGreaterThan(0.4);
    expect(shooters('S').both).toBeGreaterThan(0.4);
    // rarer elsewhere
    expect(shooters('LB').share).toBeLessThan(0.15);
  });
  it("hangs a quarterback's single sleeve on his throwing arm", () => {
    const single = players('QB')
      .map((p) => gearOf(p).sleeve)
      .filter((s) => s && s.side !== 'both');
    expect(single.length).toBeGreaterThan(0);
    for (const s of single) expect(s!.side).toBe('right');
  });
  it('pulls full sleeves onto most players in the cold, half the tackles, never the offensive line', () => {
    const full = (g: Gear) => g.sleeve?.length === 'full' && g.sleeve.side === 'both';
    expect(share('WR', full, true)).toBeGreaterThan(0.8);
    expect(share('LB', full, true)).toBeGreaterThan(0.8);
    expect(share('DT', full, true)).toBeCloseTo(0.5, 1);
    // the offensive line keeps whatever it wears and pulls nothing on for the cold
    for (const p of players('OL')) expect(gearOf(p, true)).toEqual(gearOf(p));
    // the cold changes nothing else he wears
    for (const p of players('TE').slice(0, 500)) {
      const [warm, cold] = [gearOf(p), gearOf(p, true)];
      expect(cold.elbowPads).toEqual(warm.elbowPads);
      expect(cold.band).toEqual(warm.band);
      expect(cold.shoulderBrace).toEqual(warm.shoulderBrace);
    }
  });
});
