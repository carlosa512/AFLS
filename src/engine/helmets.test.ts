import { describe, expect, it } from 'vitest';
import { TEAM_SEEDS } from './data/teams';
import { createLeague, SAVE_VERSION } from './generate';
import { migrateLeague } from './migrate';

describe('club helmet designs', () => {
  it('gives every default club a helmet design', () => {
    for (const s of TEAM_SEEDS) expect(s.helmet, s.abbrev).toBeDefined();
  });
  it("copies each club's design into a new league", () => {
    const league = createLeague({ seed: 'helmets' });
    league.teams.forEach((t, i) => {
      expect(t.helmet).toEqual(TEAM_SEEDS[i].helmet);
      expect(t.helmet).not.toBe(TEAM_SEEDS[i].helmet); // a copy: editing a save never edits the seeds
    });
  });
  it("gives an older save its clubs' designs by abbreviation, and leaves a mod's club without one", () => {
    const league = createLeague({ seed: 'helmets' });
    for (const t of league.teams) delete t.helmet;
    league.teams[3].abbrev = 'XYZ';
    league.version = 74;
    const out = migrateLeague(league)!;
    expect(out.version).toBe(SAVE_VERSION);
    expect(out.teams[0].helmet).toEqual(TEAM_SEEDS[0].helmet);
    expect(out.teams[0].helmet).not.toBe(TEAM_SEEDS[0].helmet);
    expect(out.teams[3].helmet).toBeUndefined();
  });
});
