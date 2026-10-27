import { beforeEach, describe, expect, it } from 'vitest';
import { createLeague } from '../generate';
import { activeRoster, practiceSquad } from '../roster';
import type { Injury, League } from '../types';
import { elevationRecords, nextTeamGame } from './elevations';
import { preparePersonnelGame, staffHandlesSquad, syncPersonnel } from './flow';
import { releaseSquadPlayer } from './squads';

const template = createLeague({ seed: 'staff-squad', personnel: true, userTeamId: 0 });
const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v));
let l: League;
beforeEach(() => {
  l = copy(template);
  for (const t of l.teams) t.carryover = 100_000;
});
const hurt = (): Injury => ({
  type: 'Ankle sprain',
  severity: 'moderate',
  weeksRemaining: 2,
  estimate: [1, 2],
  season: l.season,
  week: 1,
  where: 'game',
});
/** Earlier games played (results only), so the user's game can be prepared. */
function readyFor(teamId: number) {
  const g = nextTeamGame(l, teamId)!;
  for (const other of l.games.filter((x) => x.week === g.week && x.id !== g.id)) other.result = {} as never;
  return g;
}

describe('your staff handles the practice squad', () => {
  it('is on by default and off when you say so', () => {
    expect(staffHandlesSquad(l)).toBe(true);
    l.teams[0].autoSquad = false;
    expect(staffHandlesSquad(l)).toBe(false);
  });

  it('on: open squad places are refilled', () => {
    for (const p of practiceSquad(l, 0).slice(0, 3)) releaseSquadPlayer(l, p);
    expect(practiceSquad(l, 0)).toHaveLength(13);
    syncPersonnel(l);
    expect(practiceSquad(l, 0)).toHaveLength(16);
  });

  it('off: nothing is refilled for you', () => {
    l.teams[0].autoSquad = false;
    for (const p of practiceSquad(l, 0).slice(0, 3)) releaseSquadPlayer(l, p);
    syncPersonnel(l);
    expect(practiceSquad(l, 0)).toHaveLength(13);
  });

  it('on: a short position gets your call-up at kickoff; off: it does not', () => {
    const pos = practiceSquad(l, 0).find((p) => p.position !== 'K' && p.position !== 'P')!.position;
    for (const p of activeRoster(l, 0).filter((p) => p.position === pos)) p.injury = hurt();
    const off = copy(l);
    off.teams[0].autoSquad = false;
    const g = readyFor(0);
    preparePersonnelGame(l, g);
    expect(elevationRecords(l).some((e) => e.teamId === 0 && e.status === 'active')).toBe(true);
    const g2 = off.games.find((x) => x.id === g.id)!;
    for (const other of off.games.filter((x) => x.week === g2.week && x.id !== g2.id)) other.result = {} as never;
    preparePersonnelGame(off, g2);
    expect(elevationRecords(off).some((e) => e.teamId === 0)).toBe(false);
  });
});
