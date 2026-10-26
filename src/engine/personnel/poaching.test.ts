import { beforeEach, describe, expect, it } from 'vitest';
import { createLeague } from '../generate';
import { practiceSquad } from '../roster';
import { perceive } from '../scouting';
import type { League } from '../types';
import { lockProtections, protectedIds, protectionPicks, setPin } from './poaching';
import { promoteSquadPlayer } from './squads';

const template = createLeague({ seed: 'poaching-tests', personnel: true, userTeamId: 0 });
const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v));
let l: League;
beforeEach(() => {
  l = copy(template);
  for (const t of l.teams) t.carryover = 100_000;
});
/** The club's own read of its squad, best ceiling first, the way the automatic picks rank them. */
const ranked = (teamId: number) =>
  practiceSquad(l, teamId)
    .map((p) => ({ id: p.id, pot: perceive(l, teamId, p).potMid }))
    .sort((a, b) => b.pot - a.pot || a.id - b.id)
    .map((x) => x.id);

describe('two protections a week', () => {
  it('auto protection takes the two best scouted ceilings', () => {
    expect(protectionPicks(l, 0)).toEqual(ranked(0).slice(0, 2));
    lockProtections(l);
    expect(protectedIds(l, 0)).toEqual(ranked(0).slice(0, 2));
    expect(protectedIds(l, 5)).toEqual(ranked(5).slice(0, 2));
  });

  it('a pin replaces the lower auto pick', () => {
    const pick = ranked(0).at(-1)!;
    setPin(l, 0, pick, true);
    expect(protectionPicks(l, 0)).toEqual([pick, ranked(0)[0]]);
  });

  it('a pin after the lock waits until next week', () => {
    lockProtections(l);
    const before = protectedIds(l, 0);
    const pick = ranked(0).at(-1)!;
    setPin(l, 0, pick, true);
    expect(protectedIds(l, 0)).toEqual(before);
    l.week = 2;
    lockProtections(l);
    expect(protectedIds(l, 0)).toContain(pick);
  });

  it('a protected player who leaves frees no slot this week', () => {
    lockProtections(l);
    const [first, second] = protectedIds(l, 0);
    const room = practiceSquad(l, 0).length; // promotion needs a 53 place: open one
    expect(room).toBeGreaterThan(2);
    const cut = l.teams[0].depthChart.WR.at(-1)!;
    l.players[cut].teamId = null;
    l.players[cut].contract = null;
    promoteSquadPlayer(l, l.players[first]);
    lockProtections(l);
    expect(protectedIds(l, 0)).toEqual([second]);
  });

  it('locking twice in a week and after a JSON reload changes nothing', () => {
    lockProtections(l);
    const locked = copy(l.personnel!.poaching!.locked);
    setPin(l, 0, ranked(0).at(-1)!, true);
    lockProtections(l);
    expect(l.personnel!.poaching!.locked).toEqual(locked);
    const loaded = copy(l);
    lockProtections(loaded);
    expect(loaded.personnel!.poaching!.locked).toEqual(locked);
  });

  it('a third pin is refused, and only your own squad players can be pinned', () => {
    const [a, b, c] = ranked(0);
    setPin(l, 0, a, true);
    setPin(l, 0, b, true);
    expect(() => setPin(l, 0, c, true)).toThrow(/two/);
    expect(() => setPin(l, 0, practiceSquad(l, 3)[0].id, true)).toThrow(/your practice squad/);
    setPin(l, 0, a, false);
    setPin(l, 0, c, true);
    expect(l.personnel!.poaching!.pins[0]).toEqual([b, c]);
  });
});
