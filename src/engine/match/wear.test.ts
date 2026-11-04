import { describe, expect, it } from 'vitest';
import type { Player } from '../types';
import { collisions, StatBuffer } from './gameSim';

const man = (id: number) => ({ id }) as Player;

describe('collisions a play records', () => {
  const qb = man(1);
  const carrier = man(2);
  const defender = man(3);
  const buf = new StatBuffer();
  buf.add(carrier, 'rushAtt');
  buf.add(carrier, 'rushYds', 7);
  buf.add(defender, 'tackles');

  it('a tackled carrier and his tackler both take a hit', () => {
    expect(collisions(buf.entries, qb, false)).toEqual([
      [carrier, 'carrier'],
      [defender, 'tackler'],
    ]);
  });

  it('a man who steps out is credited a tackle but takes no hit', () => {
    expect(collisions(buf.entries, qb, true)).toEqual([[carrier, 'free']]);
  });
});
