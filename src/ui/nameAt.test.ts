import { describe, expect, it } from 'vitest';
import { nameAt } from './nameAt';

describe('nameAt', () => {
  it('finds a name only as a whole word', () => {
    expect(nameAt("We told them Hillman's talks would open, and Hill's.", 'Hill')).toBe(45);
    expect(nameAt("Doubts about Gebre's calls", 'Gebre')).toBe(13);
    expect(nameAt('Doubts about the calls', 'Gebre')).toBe(-1);
  });
});
