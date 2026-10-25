/** A small briefing from current scouting reads and completed regular-season games. */
import { keyMatchups, type Matchup } from './inbox';
import type { League } from './types';

type Totals = {
  games: number;
  pass: number;
  attempts: number;
  dropbacks: number;
  sacks: number;
  rush: number;
  carries: number;
  allowedPass: number;
  facedPass: number;
  facedDropbacks: number;
  madeSacks: number;
  allowedRush: number;
  facedRush: number;
};
export interface MatchupFact {
  teamId: number;
  label: string;
  value: string;
  rank: number | null;
  games: number;
}
export interface MatchupFocus {
  side: 'attack' | 'defend';
  matchup: Matchup;
  offenseId: number;
  defenseId: number;
  advantage: 'ours' | 'theirs' | null;
  label: string;
  why: string;
  facts: MatchupFact[];
}
function totals(l: League): Map<number, Totals> {
  const out = new Map(
    l.teams.map((t) => [
      t.id,
      {
        games: 0,
        pass: 0,
        attempts: 0,
        dropbacks: 0,
        sacks: 0,
        rush: 0,
        carries: 0,
        allowedPass: 0,
        facedPass: 0,
        facedDropbacks: 0,
        madeSacks: 0,
        allowedRush: 0,
        facedRush: 0,
      },
    ]),
  );
  for (const g of l.games) {
    if (g.season !== l.season || g.playoffRound || !g.result || g.week >= l.week) continue;
    for (const home of [true, false]) {
      const s = out.get(home ? g.homeId : g.awayId)!;
      const us = home ? g.result.home : g.result.away;
      const them = home ? g.result.away : g.result.home;
      s.games++;
      s.pass += us.passYds;
      s.attempts += us.passAtt;
      s.dropbacks += us.passAtt + us.sacked;
      s.sacks += us.sacked;
      s.rush += us.rushYds;
      s.carries += us.rushAtt;
      s.allowedPass += them.passYds;
      s.facedPass += them.passAtt;
      s.facedDropbacks += them.passAtt + them.sacked;
      s.madeSacks += them.sacked;
      s.allowedRush += them.rushYds;
      s.facedRush += them.rushAtt;
    }
  }
  return out;
}
function evidence(all: Map<number, Totals>, teamId: number, title: string, offense: boolean): MatchupFact | null {
  const s = all.get(teamId)!;
  const denominator = (x: Totals) =>
    title === 'Trenches'
      ? offense
        ? x.dropbacks
        : x.facedDropbacks
      : title === 'Run game'
        ? offense
          ? x.carries
          : x.facedRush
        : offense
          ? x.attempts
          : x.facedPass;
  const valid = (x: Totals) => x.games >= 3 && denominator(x) >= 30;
  if (!valid(s)) return null;
  const measure = (x: Totals) =>
    title === 'Trenches'
      ? (offense ? x.sacks : x.madeSacks) / denominator(x)
      : title === 'Run game'
        ? (offense ? x.rush : x.allowedRush) / denominator(x)
        : (offense ? x.pass : x.allowedPass) / denominator(x);
  const low = title === 'Trenches' ? offense : !offense;
  const value = measure(s);
  const qualified = [...all.values()].every(valid);
  const rank = qualified
    ? 1 + [...all.values()].filter((x) => (low ? measure(x) < value : measure(x) > value)).length
    : null;
  const label =
    title === 'Trenches'
      ? offense
        ? 'Sacks allowed'
        : 'Sacks made'
      : title === 'Run game'
        ? offense
          ? 'Rushing'
          : 'Rushing allowed'
        : offense
          ? 'Passing'
          : 'Passing allowed';
  return {
    teamId,
    label,
    value:
      title === 'Trenches'
        ? `${(value * 100).toFixed(1)}% of dropbacks`
        : `${value.toFixed(1)} yards per ${title === 'Run game' ? 'carry' : 'attempt'}`,
    rank,
    games: s.games,
  };
}
const ordinal = (n: number) =>
  `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] ?? 'th')}`;
export function focusMatchups(l: League, opponent: number): MatchupFocus[] {
  const { attack, defend } = keyMatchups(l, opponent);
  const all = totals(l);
  const rows = [
    ...attack.map((matchup) => ({ side: 'attack' as const, matchup })),
    ...defend.map((matchup) => ({ side: 'defend' as const, matchup })),
  ].map((r) => ({ ...r, gap: (r.matchup.offense.score - r.matchup.defense.score) * (r.side === 'attack' ? 1 : -1) }));
  const sorted = [...rows].sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap));
  let chosen = [sorted[0]];
  if (Math.abs(sorted[0].gap) >= 0.2) {
    const next =
      sorted.find((r) => r !== sorted[0] && r.side !== sorted[0].side && Math.abs(r.gap) >= 0.12) ??
      sorted.find((r) => r !== sorted[0] && Math.abs(r.gap) >= 0.2);
    if (next) chosen.push(next);
  } else {
    const opportunity = [...rows].sort((a, b) => b.gap - a.gap)[0];
    if (opportunity.gap >= 0.08) chosen = [opportunity];
    else {
      const results = rows.map((r) => {
        const off = evidence(all, r.side === 'attack' ? l.userTeamId : opponent, r.matchup.title, true);
        const def = evidence(all, r.side === 'attack' ? opponent : l.userTeamId, r.matchup.title, false);
        return { r, gap: off?.rank && def?.rank ? (def.rank - off.rank) * (r.side === 'attack' ? 1 : -1) : 0 };
      });
      const opening = [...results].sort((a, b) => b.gap - a.gap)[0];
      const danger = [...results].sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap))[0];
      if (opening.gap >= 4) chosen = [opening.r];
      else if (Math.abs(danger.gap) >= 4) chosen = [danger.r];
    }
  }
  return chosen.map(({ side, matchup, gap }) => {
    const offenseId = side === 'attack' ? l.userTeamId : opponent;
    const defenseId = side === 'attack' ? opponent : l.userTeamId;
    const off = evidence(all, offenseId, matchup.title, true);
    const def = evidence(all, defenseId, matchup.title, false);
    const facts = off && def ? [off, def] : [];
    const statGap = off?.rank && def?.rank ? (def.rank - off.rank) * (side === 'attack' ? 1 : -1) : 0;
    const film = gap >= 0.08 ? 'ours' : gap <= -0.08 ? 'theirs' : null;
    const advantage = film ?? (Math.abs(statGap) >= 4 ? (statGap > 0 ? 'ours' : 'theirs') : null);
    const label = film
      ? `${Math.abs(gap) >= 0.4 ? 'Clear' : 'Small'} scouted edge: ${film === 'ours' ? 'ours' : 'theirs'}`
      : advantage
        ? `Results edge: ${advantage === 'ours' ? 'ours' : 'theirs'}`
        : 'Fine margins';
    const offName = `${side === 'attack' ? 'our' : 'their'} ${matchup.offense.title.toLowerCase().replace(/^qb/, 'quarterback')}`;
    const defName = `${side === 'attack' ? 'their' : 'our'} ${matchup.defense.title.toLowerCase()}`;
    const read = `Our scouts place ${offName} in the ${ordinal(Math.round(matchup.offense.score * 100))} percentile and ${defName} in the ${ordinal(Math.round(matchup.defense.score * 100))}.`;
    const conclusion = film
      ? `${Math.abs(gap) >= 0.4 ? 'That is a clear opening' : 'There is a small opening'} for ${film === 'ours' ? 'us' : 'them'} on this read.`
      : advantage
        ? `The grades are close, but the season results offer a stronger case for ${advantage === 'ours' ? 'us' : 'them'} here.`
        : 'Neither group has a clear advantage on film.';
    const caution =
      film && statGap * gap < 0 && Math.abs(statGap) >= 4
        ? ' The season results point the other way, so treat the film edge cautiously.'
        : Math.abs(gap) >= 0.4 && off?.rank && def?.rank && Math.abs(statGap) <= 4
          ? ' The team results are more evenly matched than the scouting grades suggest.'
          : '';

    return { side, matchup, offenseId, defenseId, advantage, label, why: `${read} ${conclusion}${caution}`, facts };
  });
}
