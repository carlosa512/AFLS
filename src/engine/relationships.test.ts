import { beforeAll, describe, expect, it } from 'vitest';
import { releasePlayer } from './finance/cap';
import { createLeague } from './generate';
import { signPlayer } from './offseason/negotiation';
import { askOffer, demand } from './offseason/negotiation';
import { addTie, clubFeeling, coachedBy, endFeudsOutsideRoom, noteDeparture, rapport } from './relationships';
import { simToEndOfSeason } from './league';
import { advanceOffseason, beginOffseason } from './offseason';
import { seasonRole } from './scouting';
import { teamCoaches } from './coaching';
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

describe('rapport, homecomings and grudges, read off history', () => {
  let l: League;
  beforeAll(() => {
    l = fresh('rapport');
    for (let i = 0; i < 2; i++) {
      simToEndOfSeason(l);
      beginOffseason(l);
      while (l.phase !== 'regular') advanceOffseason(l, { autoUser: true });
    }
  }, 240_000);

  /** A player who started both seasons on one club, and the head coach there both seasons. */
  const twoYearStarter = () => {
    const [a, b] = [l.season - 2, l.season - 1];
    for (const p of Object.values(l.players)) {
      const t = p.statTeams?.[a]?.at(-1);
      if (t === undefined || p.statTeams?.[b]?.at(-1) !== t) continue;
      if (seasonRole(l, p, a)?.role !== 'starter' || seasonRole(l, p, b)?.role !== 'starter') continue;
      const hc = Object.values(l.coaches).find(
        (c) =>
          c.role === 'headCoach' &&
          [a, b].every((s) => c.career?.some((r) => r.season === s && r.teamId === t && r.role === 'headCoach')),
      );
      if (hc) return { p, hc, teamId: t };
    }
    throw new Error('no two-year starter found');
  };

  it('builds rapport over two good seasons under a coach, and not one', () => {
    const { p, hc } = twoYearStarter();
    expect(coachedBy(l, p, hc, l.season - 1)).toBe(true);
    expect(rapport(l, p, hc)).toBe('good');
    const once = { ...p, statTeams: { [l.season - 1]: p.statTeams![l.season - 1] } };
    expect(rapport(l, once, hc)).toBeNull();
  });

  it('sours on the head coach whose club cut him', () => {
    const { p, hc, teamId } = twoYearStarter();
    const cut = { ...p, left: [{ teamId, season: l.season - 1, how: 'cut' as const }] };
    expect(rapport(l, cut, hc)).toBe('sour');
  });

  it('holds a grudge three seasons against a club that cut or traded him, and feels at home where he walked from', () => {
    const { p, teamId } = twoYearStarter();
    expect(clubFeeling(l, { ...p, left: [{ teamId, season: l.season - 2, how: 'traded' }] }, teamId)).toBe('grudge');
    expect(clubFeeling(l, { ...p, left: [{ teamId, season: l.season - 4, how: 'cut' }] }, teamId)).toBeNull();
    expect(clubFeeling(l, { ...p, left: [{ teamId, season: l.season, how: 'walked' }] }, teamId)).toBe('home');
    expect(clubFeeling(l, p, (teamId + 1) % 32)).toBeNull();
  });

  it('never counts a coach who was on another club', () => {
    const { p, teamId } = twoYearStarter();
    const other = teamCoaches(l, (teamId + 1) % 32).find((c) => c.role === 'headCoach')!;
    expect(rapport(l, p, other)).toBeNull();
  });
});
