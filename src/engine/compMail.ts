/**
 * The director's letter at the new league year: the compensatory picks our team was awarded for free agents it lost
 * (`awardComp`), one sentence a pick. Words only: the round and who it is for, never a pay or a cap share. Nothing
 * when none came.
 */
import { ROUND, short } from './compView';
import { director, type Draft } from './senders';
import type { League } from './types';

const COUNT = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight'];

/** What we were awarded for this draft, filed once. */
export function compMail(league: League, have: Set<string>): Draft[] {
  const id = `comp:${league.season}`;
  const user = league.userTeamId;
  if (have.has(id)) return [];
  const mine = league.draftPicks
    .filter((p) => p.comp && p.season === league.season && p.originalTeamId === user)
    .sort((a, b) => a.round - b.round || (b.compApy ?? 0) - (a.compApy ?? 0) || a.id - b.id);
  if (!mine.length) return [];
  const n = mine.length;
  const lines = mine.map((pk) => {
    const p = pk.compFor === undefined ? undefined : league.players[pk.compFor];
    const to = pk.compTo === undefined || pk.compTo === user ? null : league.teams[pk.compTo];
    // Without the clause the sentence would end on an initialed name, which reads as a clipped sentence: say it in full.
    const name = to || !p ? short(p) : `${p.firstName} ${p.lastName}`;
    return `A ${ROUND[pk.round]}-round compensatory pick for ${name}${to ? `, who signed with the ${to.city} ${to.name}` : ''}.`;
  });
  const count = COUNT[n] ?? String(n);
  return [
    {
      id,
      season: league.season,
      phase: league.phase,
      week: 0,
      ...director(league),
      category: 'contracts',
      subject: n === 1 ? 'A compensatory pick' : `${count[0].toUpperCase()}${count.slice(1)} compensatory picks`,
      body: `We earned ${count} compensatory pick${n === 1 ? '' : 's'} in this year's draft for players we lost in free agency. ${lines.join(' ')}`,
      actions: mine
        .slice(0, 3)
        .flatMap((pk) =>
          pk.compFor !== undefined && league.players[pk.compFor]
            ? [{ kind: 'player' as const, playerId: pk.compFor }]
            : [],
        ),
    },
  ];
}
