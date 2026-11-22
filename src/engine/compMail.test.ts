import { describe, expect, it } from 'vitest';
import { createLeague } from './generate';
import { deliverMail } from './inbox';
import { compMail } from './compMail';
import { letterBreaks } from './letterRules';
import type { DraftPick, League } from './types';

/** An awarded pick by hand: the user's team earned it for a player now at another team. */
const award = (l: League, teamId: number, round: 3 | 4 | 5 | 6 | 7, playerId: number, apy = 1000): DraftPick => {
  const p: DraftPick = {
    id: l.nextPickId++,
    season: l.season,
    round,
    originalTeamId: teamId,
    ownerId: teamId,
    comp: true,
    compFor: playerId,
    compApy: apy,
  };
  l.draftPicks.push(p);
  return p;
};
/** A player of another team, found rather than pinned. */
const elsewhere = (l: League, n: number) =>
  Object.values(l.players).filter((p) => p.teamId !== null && p.teamId !== l.userTeamId && !p.retired)[n];

describe('compMail', () => {
  it('lists one sentence a pick, in order, from the director, once a league year', () => {
    const l = createLeague({ seed: 'comp-mail' });
    l.phase = 'resign';
    const a = elsewhere(l, 0);
    const b = elsewhere(l, 1);
    award(l, l.userTeamId, 4, a.id);
    award(l, l.userTeamId, 6, b.id);
    const [m] = compMail(l, new Set());
    expect(m.id).toBe(`comp:${l.season}`);
    expect(m.category).toBe('contracts');
    expect(m.from).toContain('Director of scouting');
    expect(m.subject).toBe('Two compensatory picks');
    const team = (id: number) => `${l.teams[id].city} ${l.teams[id].name}`;
    expect(m.body).toContain(
      `A 4th-round compensatory pick for ${a.firstName[0]}. ${a.lastName}, who signed with the ${team(a.teamId!)}.`,
    );
    expect(m.body).toContain(`A 6th-round compensatory pick for ${b.firstName[0]}. ${b.lastName}`);
    expect(m.body.indexOf('4th-round')).toBeLessThan(m.body.indexOf('6th-round'));
    expect(letterBreaks(m.body)).toEqual([]);
    expect(compMail(l, new Set([m.id]))).toEqual([]);
  });

  it('files nothing when the team got none, and ignores a rival’s or another year’s', () => {
    const l = createLeague({ seed: 'comp-mail-none' });
    l.phase = 'resign';
    const other = l.teams.find((t) => t.id !== l.userTeamId)!.id;
    award(l, other, 3, elsewhere(l, 0).id);
    expect(compMail(l, new Set())).toEqual([]);
    const old = award(l, l.userTeamId, 5, elsewhere(l, 1).id);
    old.season -= 1;
    expect(compMail(l, new Set())).toEqual([]);
  });

  it('files through deliverMail at the new league year only', () => {
    const l = createLeague({ seed: 'comp-mail-deliver' });
    l.phase = 'resign';
    award(l, l.userTeamId, 7, elsewhere(l, 0).id);
    deliverMail(l);
    expect(l.inbox!.filter((m) => m.id === `comp:${l.season}`)).toHaveLength(1);
    deliverMail(l);
    expect(l.inbox!.filter((m) => m.id === `comp:${l.season}`)).toHaveLength(1);
  });
});
