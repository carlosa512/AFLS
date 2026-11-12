import { describe, expect, it } from 'vitest';
import { referrer } from './refer';
import type { League } from './types';

const man = (id: number, firstName: string, lastName: string) => [id, { id, firstName, lastName }] as const;
const league = {
  players: Object.fromEntries([
    man(1, 'Jamison', 'Reed'),
    man(2, 'Marcus', 'Reed'),
    man(3, "D'Andre", 'Smith-Jones'),
    man(4, 'Ty', 'Moore'),
  ]),
  teams: [
    { id: 0, city: 'Minnesota', name: 'Voyageurs' },
    { id: 1, city: 'New York', name: 'Knights' },
    { id: 2, city: 'New York', name: 'Empire' },
    { id: 3, city: 'Seattle', name: 'Squall' },
  ],
} as unknown as League;

describe('how a story names people and clubs', () => {
  it('gives the full name once, then the surname', () => {
    const r = referrer(league, { playerIds: [1, 4] });
    expect([r.man(1), r.man(1), r.man(1)]).toEqual(['Jamison Reed', 'Reed', 'Reed']);
    expect(r.man(4)).toBe('Ty Moore');
  });

  it('keeps the full name when two men in the story share a surname', () => {
    const r = referrer(league, { playerIds: [1, 2] });
    expect([r.man(1), r.man(1), r.man(2), r.man(2)]).toEqual([
      'Jamison Reed',
      'Jamison Reed',
      'Marcus Reed',
      'Marcus Reed',
    ]);
  });

  it('keeps a hyphen and an apostrophe whole', () => {
    const r = referrer(league, { playerIds: [3] });
    expect([r.man(3), r.man(3)]).toEqual(["D'Andre Smith-Jones", 'Smith-Jones']);
  });

  it('names a club by its nickname first, then by its city', () => {
    const r = referrer(league, { playerIds: [] });
    expect([r.club(0), r.club(0), r.club(3)]).toEqual(['the Voyageurs', 'Minnesota', 'the Squall']);
    expect(r.city(3)).toBe('Seattle');
  });

  it('never shortens a club to a city two clubs share', () => {
    const r = referrer(league, { playerIds: [] });
    expect([r.club(1), r.club(1), r.city(2)]).toEqual(['the Knights', 'the Knights', 'the Empire']);
  });

  it('knows who it has named, for the rules to check', () => {
    const r = referrer(league, { playerIds: [1, 4] });
    r.man(4);
    expect(r.named()).toEqual([4]);
  });
});
