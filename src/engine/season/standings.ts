import { Rng } from '../rng';
import type { Game, League } from '../types';

export interface TeamRecord {
  teamId: number;
  w: number;
  l: number;
  t: number;
  pf: number;
  pa: number;
  div: [number, number, number];
  conf: [number, number, number];
  home: [number, number, number];
  away: [number, number, number];
  /** e.g. "W3" or "L1" */
  streak: string;
}

export const winPct = (w: number, l: number, t: number) => (w + l + t === 0 ? 0 : (w + t / 2) / (w + l + t));
const pctOf = ([w, l, t]: [number, number, number]) => winPct(w, l, t);

export function regularSeasonGames(league: League, season = league.season): Game[] {
  return league.games.filter((g) => g.season === season && !g.playoffRound && g.result);
}

export function computeRecords(league: League, season = league.season): Map<number, TeamRecord> {
  const records = new Map<number, TeamRecord>();
  for (const t of league.teams) {
    records.set(t.id, { teamId: t.id, w: 0, l: 0, t: 0, pf: 0, pa: 0, div: [0, 0, 0], conf: [0, 0, 0], home: [0, 0, 0], away: [0, 0, 0], streak: '' });
  }
  const games = regularSeasonGames(league, season).sort((a, b) => a.week - b.week);
  for (const g of games) {
    const r = g.result!;
    const home = league.teams[g.homeId];
    const away = league.teams[g.awayId];
    const sameDiv = home.division === away.division;
    const sameConf = home.conference === away.conference;
    const sides: [number, number, number, boolean][] = [
      [g.homeId, r.homeScore, r.awayScore, true],
      [g.awayId, r.awayScore, r.homeScore, false],
    ];
    for (const [id, pf, pa, isHome] of sides) {
      const rec = records.get(id)!;
      rec.pf += pf;
      rec.pa += pa;
      const idx = pf > pa ? 0 : pf < pa ? 1 : 2;
      if (idx === 0) rec.w++;
      else if (idx === 1) rec.l++;
      else rec.t++;
      if (sameDiv) rec.div[idx]++;
      if (sameConf) rec.conf[idx]++;
      (isHome ? rec.home : rec.away)[idx]++;
      const letter = ['W', 'L', 'T'][idx];
      const n = rec.streak.startsWith(letter) ? Number(rec.streak.slice(1)) + 1 : 1;
      rec.streak = `${letter}${n}`;
    }
  }
  return records;
}

/**
 * Order teams using simplified NFL tiebreakers: win %, head-to-head among the
 * tied group, division record (same division only), conference record,
 * point differential, points scored, then a seeded coin flip.
 */
export function sortTeams(league: League, ids: number[], records: Map<number, TeamRecord>): number[] {
  const coin = new Map(ids.map((id) => [id, new Rng(`${league.seed}:${league.season}:coin:${id}`).next()]));
  const games = regularSeasonGames(league);
  const pct = (id: number) => {
    const r = records.get(id)!;
    return winPct(r.w, r.l, r.t);
  };

  const groups = new Map<number, number[]>();
  for (const id of ids) {
    const key = Math.round(pct(id) * 10000);
    groups.set(key, [...(groups.get(key) ?? []), id]);
  }
  const ordered: number[] = [];
  for (const key of [...groups.keys()].sort((a, b) => b - a)) {
    const group = groups.get(key)!;
    if (group.length === 1) {
      ordered.push(group[0]);
      continue;
    }
    const members = new Set(group);
    const h2h = new Map<number, [number, number, number]>(group.map((id) => [id, [0, 0, 0]]));
    const met = new Map<number, Set<number>>(group.map((id) => [id, new Set<number>()]));
    for (const g of games) {
      if (!members.has(g.homeId) || !members.has(g.awayId)) continue;
      const r = g.result!;
      const homeIdx = r.homeScore > r.awayScore ? 0 : r.homeScore < r.awayScore ? 1 : 2;
      const awayIdx = homeIdx === 2 ? 2 : 1 - homeIdx;
      h2h.get(g.homeId)![homeIdx]++;
      h2h.get(g.awayId)![awayIdx]++;
      met.get(g.homeId)!.add(g.awayId);
      met.get(g.awayId)!.add(g.homeId);
    }
    // Head-to-head only counts when every tied team has played every other one.
    const allMet = group.every((id) => group.every((other) => other === id || met.get(id)!.has(other)));
    const sameDivision = group.every((id) => league.teams[id].division === league.teams[group[0]].division);
    const keyOf = (id: number): number[] => {
      const r = records.get(id)!;
      return [
        allMet ? pctOf(h2h.get(id)!) : 0,
        sameDivision ? pctOf(r.div) : 0,
        pctOf(r.conf),
        r.pf - r.pa,
        r.pf,
        coin.get(id)!,
      ];
    };
    group.sort((a, b) => {
      const ka = keyOf(a);
      const kb = keyOf(b);
      for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return kb[i] - ka[i];
      return 0;
    });
    ordered.push(...group);
  }
  return ordered;
}

export function divisionStandings(league: League, records = computeRecords(league)) {
  return league.divisions.map((division, d) => {
    const ids = league.teams.filter((t) => t.division === d).map((t) => t.id);
    return { division, index: d, teams: sortTeams(league, ids, records).map((id) => records.get(id)!) };
  });
}

/** Seven playoff seeds for a conference: four division winners, then three wild cards. */
export function conferenceSeeds(league: League, conference: number, records = computeRecords(league)): number[] {
  const divisions = divisionStandings(league, records).filter((d) => d.division.conference === conference);
  const winners = divisions.map((d) => d.teams[0].teamId);
  const others = divisions.flatMap((d) => d.teams.slice(1).map((r) => r.teamId));
  return [...sortTeams(league, winners, records), ...sortTeams(league, others, records).slice(0, 3)];
}
