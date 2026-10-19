import { describe, expect, it } from 'vitest';
import { PLAYER_MIX, WOMEN_SHARE, type Mix } from './data/heritage';
import { HERITAGES, MEN_FIRST, RESERVED_FULL_NAMES, SURNAMES, WOMEN_FIRST, type Heritage } from './data/names';
import { createLeague } from './generate';
import { identityFrom, newIdentity, type NameFor } from './identity';
import { Rng } from './rng';
import type { League } from './types';

const sample = (who: NameFor, n: number, salt = '') => Array.from({ length: n }, (_, i) => identityFrom(new Rng(`t${salt}:${i}`), who));
const share = (m: Mix, h: Heritage) => m[h] / HERITAGES.reduce((s, x) => s + m[x], 0);

describe('name pools', () => {
  it('are plain enough for every screen: letters and apostrophes, no duplicates in a list', () => {
    const lists = [...HERITAGES.flatMap((h) => [SURNAMES[h], MEN_FIRST[h].young, MEN_FIRST[h].older, WOMEN_FIRST[h]])];
    for (const list of lists) {
      for (const [name, w] of list) {
        expect(name).toMatch(/^[A-Z][A-Za-z']*$/);
        expect(w).toBeGreaterThan(0);
      }
      expect(new Set(list.map(([n]) => n)).size).toBe(list.length);
    }
  });
});

describe('newIdentity', () => {
  it("costs the caller's stream exactly two draws, like the old picks", () => {
    const a = new Rng('s');
    const b = new Rng('s');
    newIdentity(a, { kind: 'player', position: 'QB' });
    b.next();
    b.next();
    expect(a.getState()).toEqual(b.getState());
  });
  it('is reproducible from the stream', () => {
    expect(newIdentity(new Rng('x'), { kind: 'scout', role: 'proScout' })).toEqual(newIdentity(new Rng('x'), { kind: 'scout', role: 'proScout' }));
  });
});

describe('heritage by position', () => {
  it("follows each position's mix", () => {
    for (const [position, h] of [['K', 'white'], ['P', 'international'], ['CB', 'black'], ['QB', 'white'], ['OL', 'pacific'], ['EDGE', 'african']] as const) {
      const got = sample({ kind: 'player', position }, 4000, position).filter((x) => x.heritage === h).length / 4000;
      expect(got, `${position} ${h}`).toBeCloseTo(share(PLAYER_MIX[position], h), 1);
    }
  });
  it('makes a Patel at quarterback rare but possible, and a Washington common at corner', () => {
    const qbs = sample({ kind: 'player', position: 'QB' }, 20000, 'qb');
    const asian = qbs.filter((x) => x.heritage === 'asian').length / qbs.length;
    expect(asian).toBeGreaterThan(0.003);
    expect(asian).toBeLessThan(0.02);
    const corners = sample({ kind: 'player', position: 'CB' }, 4000, 'cb').filter((x) => x.lastName === 'Washington').length;
    const kickers = sample({ kind: 'player', position: 'K' }, 4000, 'k').filter((x) => x.lastName === 'Washington').length;
    expect(corners).toBeGreaterThan(kickers * 3);
  });
  it('never hands out a reserved real name, or a first name repeated as the surname', () => {
    const reserved = new Set(RESERVED_FULL_NAMES);
    for (const x of sample({ kind: 'player', position: 'WR' }, 5000, 'r')) {
      expect(reserved.has(`${x.firstName} ${x.lastName}`)).toBe(false);
      expect(x.firstName).not.toBe(x.lastName);
    }
  });
});

describe('women on staff', () => {
  it("come at each chair's share, with women's names, and never as coaches", () => {
    for (const [kind, role] of [['scout', 'collegeScout'], ['medic', 'physio'], ['medic', 'scientist']] as const) {
      const people = sample({ kind, role } as NameFor, 4000, role);
      const women = people.filter((x) => x.woman);
      expect(women.length / people.length, role).toBeCloseTo(WOMEN_SHARE[role], 1);
      const womensNames = new Set(HERITAGES.flatMap((h) => WOMEN_FIRST[h].map(([n]) => n)));
      for (const w of women) expect(womensNames.has(w.firstName)).toBe(true);
    }
    expect(sample({ kind: 'coach', role: 'positionCoach' }, 2000, 'c').some((x) => x.woman)).toBe(false);
  });
});

describe('a new league', () => {
  const people = (l: League) => [...Object.values(l.players), ...Object.values(l.coaches), ...Object.values(l.staff), ...Object.values(l.medics)];
  it('keeps shared full names rare, so mail still links nearly everyone', () => {
    for (const seed of ['n1', 'n2']) {
      const all = people(createLeague({ seed }));
      const counts = new Map<string, number>();
      for (const p of all) counts.set(`${p.firstName} ${p.lastName}`, (counts.get(`${p.firstName} ${p.lastName}`) ?? 0) + 1);
      const shared = all.filter((p) => counts.get(`${p.firstName} ${p.lastName}`)! > 1).length / all.length;
      expect(shared, seed).toBeLessThan(0.1);
    }
  });
  it('has a few women among its scouts and medical staff', () => {
    const l = createLeague({ seed: 'n1' });
    const women = [...Object.values(l.staff), ...Object.values(l.medics)].filter((p) => p.woman).length;
    expect(women).toBeGreaterThan(10);
  });
});
