import { describe, expect, it } from 'vitest';
import { releasePlayer } from './finance/cap';
import { createLeague } from './generate';
import { signPlayer } from './offseason/negotiation';
import { askOffer, demand } from './offseason/negotiation';
import { addTie, endFeudsOutsideRoom, noteDeparture } from './relationships';
import { activeRoster } from './roster';
import type { League, Player } from './types';

const fresh = (seed = 'relationships') => createLeague({ seed });
const roomOf = (l: League, teamId: number, p: Player) =>
  activeRoster(l, teamId).filter((x) => x.position === p.position && x.id !== p.id);

describe('how a player left', () => {
  it('records a release as a cut, once per club per season, newest three kept', () => {
    const l = fresh();
    const p = activeRoster(l, 5).find((x) => x.contract && !x.squad)!;
    releasePlayer(l, p);
    expect(p.left).toEqual([{ teamId: 5, season: l.season, how: 'cut' }]);
    noteDeparture(l, p, 5, 'cut');
    expect(p.left).toHaveLength(1);
    noteDeparture(l, p, 6, 'traded');
    noteDeparture(l, p, 7, 'walked');
    l.season++;
    noteDeparture(l, p, 8, 'cut');
    expect(p.left!.map((d) => d.teamId)).toEqual([6, 7, 8]);
  });

  it('records a free agent who signs elsewhere as having walked from his last club', () => {
    const l = fresh();
    const p = activeRoster(l, 4).find((x) => x.contract && !x.squad)!;
    p.statTeams = { [l.season - 1]: [4] };
    p.teamId = null;
    p.contract = null;
    signPlayer(l, p, 9, askOffer(demand(l, p, 9)));
    expect(p.left).toEqual([{ teamId: 4, season: l.season, how: 'walked' }]);
  });

  it('ends a feud the moment either man leaves the room, and it stays ended', () => {
    const l = fresh();
    const p = activeRoster(l, 2).find((x) => x.position === 'CB')!;
    const q = roomOf(l, 2, p)[0];
    addTie(l, p, q, 'feud');
    expect(p.ties).toHaveLength(1);
    noteDeparture(l, p, 2, 'traded');
    expect(p.ties ?? []).toHaveLength(0);
    expect(q.ties ?? []).toHaveLength(0);
    addTie(l, p, q, 'feud');
    p.position = 'S';
    endFeudsOutsideRoom(l, p);
    expect(q.ties ?? []).toHaveLength(0);
  });
});
