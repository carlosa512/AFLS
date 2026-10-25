import { impact } from './awards';
import { injuryLabel } from './injuries';
import { passerRating } from './stats';
import type { Game, InboxMessage, League, Player, RookieReportRow, StatLine } from './types';

type Draft = Omit<InboxMessage, 'read'>;
const count = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const fullName = (p: Player) => `${p.firstName} ${p.lastName}`;
function total(games: Game[], playerId: number, teamId?: number): StatLine {
  const s: StatLine = {};
  for (const g of games) {
    const r = g.result!;
    if (teamId !== undefined && r.playerTeams[playerId] !== teamId) continue;
    const line = r.playerStats[playerId];
    if (!line) continue;
    for (const key of Object.keys(line) as (keyof StatLine)[]) s[key] = (s[key] ?? 0) + (line[key] ?? 0);
  }
  return s;
}
function production(p: Player, s: StatLine): string {
  if (p.position === 'QB') return `${s.passYds ?? 0} pass yds · ${s.passTd ?? 0} TD · ${s.passInt ?? 0} INT`;
  if (p.position === 'RB') return `${s.rushYds ?? 0} rush yds · ${s.rushTd ?? 0} TD`;
  if (p.position === 'WR' || p.position === 'TE')
    return `${s.rec ?? 0} rec · ${s.recYds ?? 0} yds · ${s.recTd ?? 0} TD`;
  if (p.position === 'K') return `${s.fgMade ?? 0}/${s.fgAtt ?? 0} FG`;
  if (p.position === 'P')
    return `${s.punts ?? 0} punts${s.punts ? ` · ${((s.puntYds ?? 0) / s.punts).toFixed(1)} avg` : ''}`;
  if (p.position === 'OL')
    return `${count(s.sacksAllowed ?? 0, 'sack')} · ${count(s.pressuresAllowed ?? 0, 'pressure')} allowed`;
  if (p.position === 'CB' || p.position === 'S')
    return `${count(s.tackles ?? 0, 'tackle')} · ${s.passDef ?? 0} PD · ${s.defInt ?? 0} INT`;
  return `${count(s.tackles ?? 0, 'tackle')} · ${count(s.sacks ?? 0, 'sack')} · ${count(s.pressures ?? 0, 'pressure')}`;
}
/** Rate comparisons require a real sample and compare only rookies at the same position. */
function rate(p: Player, s: StatLine): { value: number; label: string; low?: true } | null {
  const snaps = s.snaps ?? 0;
  if (p.position === 'QB' && (s.passAtt ?? 0) >= 100) return { value: passerRating(s), label: 'passer rating' };
  if (p.position === 'RB' && (s.rushAtt ?? 0) >= 40)
    return { value: (s.rushYds ?? 0) / s.rushAtt!, label: 'yards per carry' };
  if (snaps < 200) return null;
  if (p.position === 'WR' || p.position === 'TE')
    return { value: ((s.recYds ?? 0) / snaps) * 100, label: 'receiving yards per 100 snaps' };
  if (p.position === 'OL' && s.pressuresAllowed !== undefined)
    return {
      value: ((s.pressuresAllowed + (s.sacksAllowed ?? 0)) / snaps) * 100,
      label: 'pressures and sacks allowed per 100 snaps',
      low: true,
    };
  if (p.position === 'DT' || p.position === 'EDGE')
    return { value: ((s.pressures ?? 0) / snaps) * 100, label: 'pressures per 100 snaps' };
  return null;
}
/** The same public production scale used for game awards selects offensive/defensive highlights.
 * Line and kicking reports name their narrower measure instead of claiming a universal game grade.
 */
function gameHighlight(l: League, p: Player, games: Game[]): string {
  const candidates = games
    .flatMap((g) => {
      if (g.result!.playerTeams[p.id] !== l.userTeamId) return [];
      const s = g.result!.playerStats[p.id];
      if (!s) return [];
      let score = impact(p, s);
      if (p.position === 'OL') {
        if ((s.snaps ?? 0) < 20 || s.sacksAllowed === undefined || s.pressuresAllowed === undefined) return [];
        score = -((s.sacksAllowed + s.pressuresAllowed) / s.snaps!);
      } else if (p.position === 'K') {
        if (!(s.fgMade ?? 0)) return [];
        score = s.fgMade!;
      } else if (p.position === 'P') {
        if ((s.punts ?? 0) < 3) return [];
        score = (s.puntYds ?? 0) / s.punts!;
      } else if (score <= 0) return [];
      return [{ g, s, score }];
    })
    .sort((a, b) => b.score - a.score || (b.s.snaps ?? 0) - (a.s.snaps ?? 0) || a.g.week - b.g.week);
  const best = candidates[0];
  if (!best) return '';
  const opponent = l.teams[best.g.homeId === l.userTeamId ? best.g.awayId : best.g.homeId];
  const label =
    p.position === 'OL'
      ? 'Best pass-protection outing'
      : p.position === 'K'
        ? 'Most field goals'
        : p.position === 'P'
          ? 'Best punting average'
          : 'Best game';
  return `${label}: ${production(p, best.s)} against the ${opponent.name} in Week ${best.g.week}.`;
}

function assessment(l: League, p: Player, s: StatLine, ours: Game[], all: Game[], peers: Player[]): string {
  const snaps = s.snaps ?? 0;
  // An increased workload after a documented teammate injury is evidence; a guessed preseason role is not.
  for (const g of ours)
    for (const injury of g.result!.injuries ?? []) {
      const mate = l.players[injury.playerId];
      if (
        injury.teamId !== l.userTeamId ||
        !mate ||
        mate.id === p.id ||
        mate.position !== p.position ||
        injury.estimate[0] < 2
      )
        continue;
      const before = ours.filter((x) => x.week < g.week);
      const after = ours.filter((x) => x.week > g.week);
      if (before.length < 2 || after.length < 2) continue;
      const prior = (total(before, p.id, l.userTeamId).snaps ?? 0) / before.length;
      const later = (total(after, p.id, l.userTeamId).snaps ?? 0) / after.length;
      const established = (total(before, mate.id, l.userTeamId).snaps ?? 0) / before.length >= 25;
      if (established && prior <= 15 && later >= 25 && later >= prior * 2)
        return `Workload rose from ${prior.toFixed(0)} to ${later.toFixed(0)} snaps per game after ${fullName(mate)}'s ${injuryLabel(injury.type).replace(/^[A-Z][a-z]/, (s) => s[0].toLowerCase() + s[1])} in Week ${g.week}.`;
    }
  const metric = rate(p, s);
  if (metric) {
    const values = peers
      .filter((x) => x.id !== p.id && x.position === p.position)
      .flatMap((x) => {
        const r = rate(x, total(all, x.id));
        return r ? [r.value] : [];
      })
      .sort((a, b) => a - b);
    if (values.length >= 3) {
      const median =
        values.length % 2
          ? values[Math.floor(values.length / 2)]
          : (values[values.length / 2 - 1] + values[values.length / 2]) / 2;
      const better = metric.low ? metric.value < values[0] : metric.value > values.at(-1)!;
      const worse = metric.low ? metric.value > values.at(-1)! : metric.value < values[0];
      if ((p.draft!.pick >= 100 && better) || (p.draft!.pick <= 64 && worse))
        return `Pick ${p.draft!.pick}: ${metric.value.toFixed(1)} ${metric.label}, ${better ? 'better' : 'worse'} than the other qualifying rookie ${p.position}s (median ${median.toFixed(1)}; ${values.length} peers).`;
    }
  }
  if (snaps < ours.length * 10 && p.position !== 'K' && p.position !== 'P') {
    const leaders = Object.values(l.players)
      .filter((x) => x.id !== p.id && x.position === p.position)
      .map((x) => ({ p: x, snaps: total(ours, x.id, l.userTeamId).snaps ?? 0 }))
      .sort((a, b) => b.snaps - a.snaps);
    const ahead = leaders[0];
    if (ahead && ahead.snaps >= ours.length * 25) {
      const highlight = snaps ? gameHighlight(l, p, ours) : '';
      return `${snaps ? 'Spot work so far. ' : ''}${fullName(ahead.p)} has carried more of the load at ${p.position} (${ahead.snaps} snaps).${highlight ? ` ${highlight}` : ''}`;
    }
  }
  const highlight = gameHighlight(l, p, ours);
  if (p.teamId !== l.userTeamId) return `Work for us before leaving the roster.${highlight ? ` ${highlight}` : ''}`;
  if (p.position === 'K' || p.position === 'P') return highlight || 'No recorded kicking work for us yet.';
  if (!snaps) return 'No recorded scrimmage snaps for us yet.';
  if (highlight) return `${snaps < ours.length * 10 ? 'Spot work so far. ' : ''}${highlight}`;
  const busiest = ours
    .filter((g) => g.result!.playerTeams[p.id] === l.userTeamId)
    .map((g) => ({ g, snaps: g.result!.playerStats[p.id]?.snaps ?? 0 }))
    .sort((a, b) => b.snaps - a.snaps || a.g.week - b.g.week)[0]!;
  const opponent = l.teams[busiest.g.homeId === l.userTeamId ? busiest.g.awayId : busiest.g.homeId];
  return `${snaps < ours.length * 10 ? 'Spot work so far. ' : ''}Most work: ${busiest.snaps} snaps against the ${opponent.name} in Week ${busiest.g.week}.`;
}

/** Freeze every row when filed: later trades, games and history pruning cannot rewrite this report. */
export function rookieImpactMail(l: League, picks: Player[], sender: Pick<InboxMessage, 'from' | 'fromCard'>): Draft[] {
  if (!picks.length || !['regular', 'playoffs', 'complete'].includes(l.phase)) return [];
  const all = l.games.filter((g) => g.season === l.season && !g.playoffRound && g.result);
  const ours = all
    .filter((g) => g.homeId === l.userTeamId || g.awayId === l.userTeamId)
    .sort((a, b) => a.week - b.week);
  if (ours.length < 8) return [];
  const final = !l.games.some(
    (g) =>
      g.season === l.season && !g.playoffRound && !g.result && (g.homeId === l.userTeamId || g.awayId === l.userTeamId),
  );
  if (!final && ours.length !== 8) return [];
  const id = `rookies:${l.season}:${final ? 'year' : 'mid'}`;
  if (l.inbox?.some((m) => m.id === id)) return [];
  const peers = Object.values(l.players).filter((p) => p.scouting && p.draft?.season === l.season);
  const hasSnaps = ours.every((g) => Object.values(g.result!.playerStats).some((s) => s.snaps !== undefined));
  const rows: RookieReportRow[] = [...picks]
    .sort((a, b) => a.draft!.pick - b.draft!.pick)
    .map((p) => {
      const s = total(ours, p.id, l.userTeamId);
      return {
        playerId: p.id,
        name: fullName(p),
        position: p.position,
        pick: p.draft!.pick,
        round: p.draft!.round,
        snaps: p.position === 'K' || p.position === 'P' ? null : (s.snaps ?? (hasSnaps ? 0 : null)),
        production:
          (s.snaps ?? 0) > 0 || p.position === 'K' || p.position === 'P'
            ? production(p, s)
            : 'No recorded scrimmage production',
        context: assessment(l, p, s, ours, all, peers),
        contributed: (s.snaps ?? 0) > 0 || (s.fgAtt ?? 0) + (s.punts ?? 0) > 0,
      };
    });
  if (!rows.some((r) => r.snaps !== null || r.contributed)) return [];
  const contributing = rows.filter((r) => r.contributed).length;
  return [
    {
      id,
      season: l.season,
      phase: 'regular',
      week: ours.at(-1)!.week,
      ...sender,
      category: 'scouting',
      subject: `Our rookie class: ${final ? 'the season in review' : 'eight games in'}`,
      body: `We drafted ${picks.length} players this year; ${contributing} have contributed scrimmage snaps or kicking work for us through ${ours.length} regular-season games. Here is each pick's work so far, with the opportunities behind the numbers.`,
      rookieReport: { teamId: l.userTeamId, games: ours.length, rows },
      actions: [{ kind: 'team', teamId: l.userTeamId }],
    },
  ];
}
