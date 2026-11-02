import { describe, expect, it } from 'vitest';
import { createLeague } from './generate';
import { playWeek } from './league';
import { advanceOffseason, beginOffseason } from './offseason';
import { addPlayer, setTeam, teamIndexHeals, teamPlayers } from './roster';
import type { League, Player } from './types';

/** Every club's players as a full pass over the league reads them: what `teamPlayers` must always return. */
const scan = (l: League, teamId: number) =>
  Object.values(l.players)
    .filter((p) => p.teamId === teamId)
    .map((p) => p.id);
const ids = (l: League, teamId: number) => teamPlayers(l, teamId).map((p) => p.id);
const allMatch = (l: League) => l.teams.every((t) => JSON.stringify(ids(l, t.id)) === JSON.stringify(scan(l, t.id)));

describe("a club's players", () => {
  it('follow a player moved between clubs, in the same order a full pass reads them', () => {
    const l = createLeague({ seed: 'team-index' });
    const p = teamPlayers(l, 3)[5];
    setTeam(l, p, 7);
    expect(ids(l, 3)).not.toContain(p.id);
    expect(ids(l, 7)).toContain(p.id);
    setTeam(l, p, null);
    expect(ids(l, 7)).not.toContain(p.id);
    expect(allMatch(l)).toBe(true);
  });

  it('take in a new player on his club', () => {
    const l = createLeague({ seed: 'team-index' });
    teamPlayers(l, 2);
    const p: Player = { ...structuredClone(teamPlayers(l, 2)[0]), id: l.nextPlayerId++, teamId: 2 };
    addPlayer(l, p);
    expect(ids(l, 2)).toContain(p.id);
    expect(allMatch(l)).toBe(true);
  });

  it("drop a player whose club was cleared by hand, as a test or an old save's upgrade might", () => {
    const l = createLeague({ seed: 'team-index' });
    const p = teamPlayers(l, 4)[0];
    p.teamId = null;
    expect(ids(l, 4)).not.toContain(p.id);
    expect(allMatch(l)).toBe(true);
  });

  it("hand out a copy: sorting it leaves the club's list alone", () => {
    const l = createLeague({ seed: 'team-index' });
    teamPlayers(l, 1).reverse();
    expect(ids(l, 1)).toEqual(scan(l, 1));
  });

  it('match a full pass over every player through a season and an offseason', () => {
    // Every move the game makes (signings, releases, trades, the draft, waivers, practice squads, retirements) goes
    // through `setTeam` and `addPlayer`; a write that went around them would show here as a club list out of date.
    const l = createLeague({ seed: 'team-index' });
    const heals = teamIndexHeals();
    while (l.phase !== 'complete') {
      playWeek(l);
      expect(allMatch(l), `${l.phase} week ${l.week}`).toBe(true);
    }
    beginOffseason(l);
    expect(allMatch(l), 'new league year').toBe(true);
    // Read through a function: TypeScript would otherwise hold the phase at 'complete' from the loop above.
    const phase = (): string => l.phase;
    for (let i = 0; i < 400 && phase() !== 'regular'; i++) {
      advanceOffseason(l, { autoUser: true });
      expect(allMatch(l), phase()).toBe(true);
    }
    expect(phase()).toBe('regular');
    // And none was put right by reading the club again: every write went through them.
    expect(teamIndexHeals()).toBe(heals);
  });
});
