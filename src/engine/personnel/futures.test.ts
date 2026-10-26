import { beforeEach, describe, expect, it } from 'vitest';
import { createLeague } from '../generate';
import { deliverMail } from '../inbox';
import { activeRoster, practiceSquad } from '../roster';
import { perceive } from '../scouting';
import type { League } from '../types';
import { futuresKept, futuresPicks, futuresWindowOpen, setFuturesKeep } from './futures';
import { expireSquadContracts } from './squads';

const template = createLeague({ seed: 'futures-tests', personnel: true, userTeamId: 0 });
const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v));
let l: League;
beforeEach(() => {
  l = copy(template);
  l.phase = 'complete';
});
/** What beginOffseason does around the expiry: the new league year, then squads end. */
function newLeagueYear() {
  l.season++;
  l.caps[l.season] = l.caps[l.season - 1];
  l.phase = 'resign';
  expireSquadContracts(l);
}
const bar = (teamId: number, pos: string) => {
  const on = new Set(activeRoster(l, teamId).map((p) => p.id));
  const depth = l.teams[teamId].depthChart[pos as 'QB'].filter((id) => on.has(id));
  const last = depth.at(-1);
  return last === undefined ? 0 : perceive(l, teamId, l.players[last]).ovr;
};

describe('futures deals', () => {
  it('the window opens when the season is over, not before', () => {
    expect(futuresWindowOpen(l, 3)).toBe(true);
    l.phase = 'regular';
    expect(futuresWindowOpen(l, 3)).toBe(false);
  });

  it('AI picks reach the club’s backup level by its own read, best first, at most 10', () => {
    for (const t of l.teams) {
      const picks = futuresPicks(l, t.id);
      expect(picks.length).toBeLessThanOrEqual(10);
      for (const id of picks) {
        const p = l.players[id];
        expect(p.teamId).toBe(t.id);
        expect(perceive(l, t.id, p).potMid).toBeGreaterThanOrEqual(bar(t.id, p.position));
      }
      const pots = picks.map((id) => perceive(l, t.id, l.players[id]).potMid);
      expect(pots).toEqual([...pots].sort((a, b) => b - a));
    }
  });

  it('your marks survive a reload and become minimum deals for next season; the rest become free agents', () => {
    const [keep, also, drop] = practiceSquad(l, 0);
    setFuturesKeep(l, 0, keep.id, true);
    setFuturesKeep(l, 0, also.id, true);
    for (const id of futuresKept(l, 0)) if (![keep.id, also.id].includes(id)) setFuturesKeep(l, 0, id, false);
    l = copy(l);
    expect(futuresKept(l, 0).sort()).toEqual([keep.id, also.id].sort());
    newLeagueYear();
    const k = l.players[keep.id];
    expect(k.teamId).toBe(0);
    expect(k.squad).toBeUndefined();
    expect(k.contract!.kind).toBe('minimum');
    expect(k.contract!.years[0].season).toBe(l.season);
    expect(k.contract!.years).toHaveLength(1);
    expect(activeRoster(l, 0)).toContain(k);
    expect(l.players[drop.id].teamId).toBeNull();
  });

  it('a kept player who has left the squad gets nothing', () => {
    const [keep] = practiceSquad(l, 0);
    setFuturesKeep(l, 0, keep.id, true);
    keep.squad = undefined;
    keep.teamId = null;
    newLeagueYear();
    expect(keep.contract).toBeNull();
  });

  it('AI clubs keep their picks at the new league year', () => {
    const picks = futuresPicks(l, 5);
    newLeagueYear();
    for (const id of picks) expect(l.players[id].teamId).toBe(5);
  });

  it('your director writes once when the window opens, and once at the new league year', () => {
    deliverMail(l);
    deliverMail(l);
    expect((l.inbox ?? []).filter((m) => m.id.startsWith('futures:'))).toHaveLength(1);
    newLeagueYear();
    deliverMail(l);
    deliverMail(l);
    expect((l.inbox ?? []).filter((m) => m.id.startsWith('futuresKept:'))).toHaveLength(1);
  });
});
