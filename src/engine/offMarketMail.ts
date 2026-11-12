/**
 * SNN's story when free agency opens: the players whose deals had run out and whose clubs kept them in the re-sign
 * window, re-signed or tagged, best first by our scouts' read, and the best still heading to market
 * (`docs/superpowers/specs/2026-11-07-free-agency-planning-design.md` §5). Read off the transaction log (a re-signing
 * or tag names its player from save v90); our own club's re-signings are the front office's to tell. Filed once.
 */
import { freeAgents } from './offseason/negotiation';
import { dayOnFile } from './snnDays';
import { seenOvr } from './scouting';
import type { Draft } from './senders';
import type { League, MailSection, Player } from './types';

const ROWS = 12;
const name = (p: Player) => `${p.firstName} ${p.lastName}`;

export function offMarketMail(league: League, have: Set<string>): Draft[] {
  if (league.phase !== 'freeAgency') return [];
  const id = `offMarket:${league.season}`;
  if (have.has(id)) return [];
  // SNN's new-league-year edition tells who was kept and who reached the market now (`snnDays.ts`).
  if (dayOnFile(league, 'year', have)) return [];
  const user = league.userTeamId;
  // A re-signing says "re-signed" (an early extension says "extended": he was never coming to market); a tag is a tag.
  const kept = new Map<number, Player>();
  for (const t of league.transactions) {
    if (t.season !== league.season || t.phase !== 'resign' || t.playerId === undefined) continue;
    if (t.teamIds.includes(user)) continue;
    if (t.kind !== 'tag' && !(t.kind === 'resign' && t.text.includes(' re-signed '))) continue;
    const p = league.players[t.playerId];
    if (p && !p.retired && p.teamId === t.teamIds[0] && p.contract) kept.set(p.id, p);
  }
  if (!kept.size) return [];
  const read = (p: Player) => seenOvr(league, user, p);
  const all = [...kept.values()].sort((a, b) => read(b) - read(a) || a.id - b.id);
  const tagged = all.filter((p) => p.contract!.kind === 'tag').length;
  const resigned = all.length - tagged;
  const rows: MailSection['rows'] = all.slice(0, ROWS).map((p) => {
    const c = p.contract!;
    const deal = c.kind === 'tag' ? 'Franchise tag' : `${c.length} yr, $${((c.apy * c.length) / 1000).toFixed(1)}M`;
    return { playerId: p.id, cells: [name(p), p.position, league.teams[p.teamId!].abbrev, deal] };
  });
  if (all.length > ROWS) rows[rows.length - 1].note = `and ${all.length - ROWS} more`;
  // The best still heading to market: free agents whose last season was with another club.
  const still = freeAgents(league)
    .filter((p) => {
      const last = p.statTeams?.[league.season - 1]?.at(-1);
      return last !== undefined && last !== user;
    })
    .sort((a, b) => read(b) - read(a) || a.id - b.id)
    .slice(0, 3);
  const counts = [resigned ? `${resigned} re-signed` : '', tagged ? `${tagged} tagged` : ''].filter(Boolean).join(', ');
  return [
    {
      id,
      season: league.season,
      phase: 'freeAgency',
      week: 0,
      from: 'SNN league desk',
      category: 'league',
      subject: `Off the market: ${counts}`,
      body:
        "Before free agency opened, these players' teams kept them." +
        (still.length
          ? ` ${still.map((p) => `${p.position} ${name(p)}`).join(', ')} ${still.length === 1 ? 'is' : 'are'} still heading to market.`
          : ''),
      sections: [{ title: 'Kept before free agency', columns: ['Player', 'Pos', 'Club', 'Deal'], rows }],
      actions: [...still.map((p) => ({ kind: 'player' as const, playerId: p.id })), { kind: 'fa' as const }],
    },
  ];
}
