import { describe, expect, it } from 'vitest';
import { developCoaches } from './coaching';
import { createLeague } from './generate';
import { developMedics } from './medical';
import { developStaff, IDLE_MAX } from './staff';

/** The staff markets shed everyone who sits unhired through `IDLE_MAX` league years, and only them for certain. */
describe('time on the market', () => {
  const league = createLeague({ seed: 'idle-market' });
  league.season++; // a new league year's ageing pass

  it('lets a coach go after three years unhired, and keeps the count off anyone on a staff', () => {
    const market = Object.values(league.coaches).filter((c) => c.teamId === null);
    const hired = Object.values(league.coaches).filter((c) => c.teamId !== null);
    expect(market.length).toBeGreaterThan(5);
    for (const c of market) c.idle = IDLE_MAX - 1;
    hired[0].idle = IDLE_MAX;
    developCoaches(league);
    for (const c of market) expect(league.coaches[c.id]).toBeUndefined();
    expect(league.coaches[hired[0].id]).toBeDefined();
    expect(league.coaches[hired[0].id].idle).toBeUndefined();
    // Fresh candidates start their own count.
    expect(Object.values(league.coaches).filter((c) => c.teamId === null).every((c) => c.idle === undefined)).toBe(true);
  });

  it('does the same for scouts and medics', () => {
    const scouts = Object.values(league.staff).filter((s) => s.teamId === null);
    const medics = Object.values(league.medics).filter((m) => m.teamId === null);
    expect(scouts.length).toBeGreaterThan(5);
    expect(medics.length).toBeGreaterThan(5);
    for (const s of scouts) s.idle = IDLE_MAX - 1;
    for (const m of medics) m.idle = IDLE_MAX - 1;
    developStaff(league);
    developMedics(league);
    for (const s of scouts) expect(league.staff[s.id]).toBeUndefined();
    for (const m of medics) expect(league.medics[m.id]).toBeUndefined();
  });

  it('counts a year on the market each new league year', () => {
    const l = createLeague({ seed: 'idle-count' });
    l.season++;
    const before = Object.values(l.coaches).filter((c) => c.teamId === null).map((c) => c.id);
    developCoaches(l);
    const still = before.filter((id) => l.coaches[id]);
    expect(still.length).toBeGreaterThan(0);
    for (const id of still) expect(l.coaches[id].idle).toBe(1);
  });
});
