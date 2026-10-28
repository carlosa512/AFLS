import { activeCoachQuirks, coachPlayerFit, positionCoachFor } from './coachQuirks';
import { workEthicOf } from './traits';
import { slotOvr } from './familiarity';
import { STARTERS } from './positions';
import { QUIRKS, type QuirkId } from './quirks';
import { Rng } from './rng';
import type { Coach, CoachAdvice, InboxMessage, League, Player, Position, StatKey, StatLine, Team } from './types';
import { POSITIONS } from './types';

export type AdviceStage = 'offer' | 'followup' | 'revisit';
export const adviceKey = (a: CoachAdvice, stage: AdviceStage) =>
  `coach-advice:${a.season}:${a.week}:${a.coachId}:${a.playerId}:${stage}`;
export const advicePublishedWeek = (league: League, a: CoachAdvice, stage: AdviceStage): number | undefined =>
  a.noted?.[stage] ?? league.inbox?.find((m) => m.coachNoteKey === adviceKey(a, stage))?.week;
/** Only delivery commits a publication; merely reading a report is pure. */
export function recordAdvicePublications(
  league: League,
  messages: readonly Pick<InboxMessage, 'coachNoteKey' | 'week'>[],
): void {
  for (const a of league.teams[league.userTeamId].coachAdvice ?? [])
    for (const stage of ['offer', 'followup', 'revisit'] as const) {
      const m = messages.find((m) => m.coachNoteKey === adviceKey(a, stage));
      if (m) (a.noted ??= {})[stage] ??= m.week;
    }
}
const pairKey = (a: number, b: number) => `${Math.min(a, b)}:${Math.max(a, b)}`;
function adviceMemory(league: League, team: Team): NonNullable<Team['coachAdviceMemory']> {
  const saved = team.coachAdviceMemory?.season === league.season ? team.coachAdviceMemory : undefined;
  const memory = {
    season: league.season,
    players: [...(saved?.players ?? [])],
    pairs: [...(saved?.pairs ?? [])],
    positions: { ...saved?.positions },
  };
  for (const a of team.coachAdvice ?? []) {
    if (a.season !== league.season) continue;
    for (const id of [a.playerId, a.aheadId]) if (!memory.players.includes(id)) memory.players.push(id);
    const pair = pairKey(a.playerId, a.aheadId);
    if (!memory.pairs.includes(pair)) memory.pairs.push(pair);
    memory.positions[a.position] = Math.max(memory.positions[a.position] ?? -Infinity, a.week);
  }
  return memory;
}

/** A globally bounded score avoids non-transitive pairwise "near tie" comparisons. */
export function selectionPreference(c: Coach | undefined, p: Player): number {
  if (!c) return 0;
  const q = activeCoachQuirks(c);
  let n = q.includes('earnYourReps') ? (0.15 * (workEthicOf(p) - 10.5)) / 9.5 : 0;
  if (q.includes('trustsVeterans')) n += p.experience >= 5 ? 0.12 : p.experience <= 1 ? -0.06 : 0;
  if (q.includes('patientTeacher') && p.age <= 25) n += 0.04;
  return Math.max(-0.2, Math.min(0.2, n));
}
export function coachOrder(players: Player[], position: Position, staff: readonly Coach[]): Player[] {
  const c = positionCoachFor(staff, position);
  const scored = players.map((p) => ({ p, score: slotOvr(p, position) + selectionPreference(c, p) }));
  return scored.sort((a, b) => b.score - a.score).map((x) => x.p);
}
export function selectionReason(c: Coach, p: Player, ahead: Player): string {
  const q = activeCoachQuirks(c);
  if (q.includes('earnYourReps') && workEthicOf(p) > workEthicOf(ahead))
    return 'trusts his preparation in a close selection decision';
  if (q.includes('trustsVeterans') && p.experience > ahead.experience)
    return 'favors his experience in a close selection decision';
  return 'wants to give the younger player an opportunity';
}
/** A short trial can justify another look, never a permanent starting job. Only judge recorded opportunities. */
function reviewTrial(a: CoachAdvice, p: Player, season: number, games: number): { text: string; promising: boolean } {
  if (!a.applied)
    return {
      text: 'The suggested change is not in place, so we cannot judge it as a starting trial.',
      promising: false,
    };
  const delta = (key: StatKey) => (p.stats[season]?.[key] ?? 0) - (a.baselineStats?.[key] ?? 0);
  let verdict: 'promising' | 'poor' | 'unclear' = 'unclear';
  if (p.position === 'WR' || p.position === 'TE') {
    const targets = delta('targets'),
      yards = delta('recYds'),
      catches = delta('rec');
    if (targets >= 4 && catches / targets >= 0.4 && (yards / games >= 35 || delta('recTd') > 0)) verdict = 'promising';
    else if (targets >= 6 && yards / targets < 4 && catches / targets < 0.5) verdict = 'poor';
  } else if (p.position === 'RB') {
    const carries = delta('rushAtt'),
      average = delta('rushYds') / Math.max(1, carries);
    if (carries >= 12 && average >= 4 && delta('fumblesLost') < 2) verdict = 'promising';
    else if (carries >= 16 && (average < 3 || delta('fumblesLost') >= 2)) verdict = 'poor';
  } else if (p.position === 'QB') {
    const attempts = delta('passAtt');
    if (
      attempts >= 30 &&
      delta('passCmp') / attempts >= 0.6 &&
      delta('passYds') / attempts >= 6.5 &&
      delta('passInt') <= 1
    )
      verdict = 'promising';
    else if (attempts >= 30 && (delta('passYds') / attempts < 5 || delta('passInt') >= 3)) verdict = 'poor';
  }
  if (verdict === 'promising')
    return {
      text: 'The early return is encouraging; we should consider keeping the change for another week.',
      promising: true,
    };
  if (verdict === 'poor')
    return {
      text: `The early return has been poor; we should consider moving back to ${a.aheadName} while we review the position.`,
      promising: false,
    };
  return {
    text: 'There is not enough clear evidence yet to settle the position; we should review the trial again after more opportunities.',
    promising: false,
  };
}
/** A single later revisit, based on three consecutive opportunity-bearing games after a promising trial. */
function revisitTrial(league: League, team: Team, a: CoachAdvice, available: Player[]): void {
  if (a.revisit || !a.review?.promising || !a.review.adopted || a.season !== league.season) return;
  const published = advicePublishedWeek(league, a, 'followup');
  if (published === undefined || league.week - published < 4 || league.coaches[a.coachId]?.teamId !== team.id) return;
  const p = available.find((p) => p.id === a.playerId),
    veteran = available.find((p) => p.id === a.aheadId);
  if (
    !p ||
    !veteran ||
    !team.depthChart[a.position].slice(0, STARTERS[a.position]).includes(p.id) ||
    (team.playingAt?.[p.id]?.pos ?? p.position) !== a.position
  )
    return;
  const recent = league.games
    .filter(
      (g) =>
        g.season === league.season &&
        g.week > a.review!.week &&
        g.week <= league.week &&
        g.result &&
        (g.homeId === team.id || g.awayId === team.id),
    )
    .sort((a, b) => b.week - a.week)
    .slice(0, 3);
  if (recent.length < 3) return;
  const lines = recent.map((g) => (g.result!.playerTeams[p.id] === team.id ? g.result!.playerStats[p.id] : undefined));
  if (lines.some((s) => !s?.gp)) return;
  const stats = lines as StatLine[];
  const sum = (key: StatKey) => stats.reduce((n, s) => n + (s[key] ?? 0), 0);
  let poor = false,
    production = '';
  if (p.position === 'WR' || p.position === 'TE') {
    poor =
      sum('targets') >= 12 &&
      stats.every(
        (s) => (s.targets ?? 0) >= 3 && (s.rec ?? 0) / (s.targets ?? 1) < 0.5 && (s.recYds ?? 0) / (s.targets ?? 1) < 4,
      );
    production = `${sum('rec')} catches for ${sum('recYds')} yards from ${sum('targets')} targets`;
  } else if (p.position === 'RB') {
    poor =
      sum('rushAtt') >= 24 &&
      stats.every(
        (s) => (s.rushAtt ?? 0) >= 6 && ((s.rushYds ?? 0) / (s.rushAtt ?? 1) < 3 || (s.fumblesLost ?? 0) > 0),
      );
    production = `${sum('rushYds')} rushing yards on ${sum('rushAtt')} carries`;
  } else if (p.position === 'QB') {
    poor =
      sum('passAtt') >= 60 &&
      stats.every((s) => (s.passAtt ?? 0) >= 15 && ((s.passYds ?? 0) / (s.passAtt ?? 1) < 5 || (s.passInt ?? 0) >= 2));
    production = `${sum('passYds')} passing yards and ${sum('passInt')} interceptions on ${sum('passAtt')} attempts`;
  }
  if (poor)
    a.revisit = {
      week: league.week,
      text: `The early trial was encouraging, but ${a.playerName}'s last three games have produced ${production}. We should reconsider the change and review ${a.aheadName} as an option again.`,
    };
}
/** Pure: generating or opening a report never changes a chart or draws a marble. */
export function assessCoachAdvice(
  league: League,
  team: Team,
  staff: readonly Coach[],
  available: Player[],
): Omit<CoachAdvice, 'applied'> | undefined {
  const memory = adviceMemory(league, team);
  if (memory.pairs.length >= 6 || team.coachAdvice?.some((a) => a.season === league.season && !a.resolved)) return;
  for (const position of POSITIONS) {
    if (position === 'OL') continue; // Its positional ordering is a distinct football decision.
    if (league.week - (memory.positions[position] ?? -Infinity) < 6) continue;
    const c = positionCoachFor(staff, position);
    if (!c || !activeCoachQuirks(c).length) continue;
    const pool = available.filter((p) => (team.playingAt?.[p.id]?.pos ?? p.position) === position);
    const ranked = [...pool].sort((a, b) => slotOvr(b, position) - slotOvr(a, position));
    const preferred = coachOrder(pool, position, staff).slice(0, STARTERS[position]);
    const usual = ranked.slice(0, STARTERS[position]);
    const p = preferred.find((p) => !usual.includes(p));
    const ahead = usual.find((p) => !preferred.includes(p));
    if (!p || !ahead || slotOvr(ahead, position) - slotOvr(p, position) > 0.5) continue;
    if (
      memory.players.includes(p.id) ||
      memory.players.includes(ahead.id) ||
      memory.pairs.includes(pairKey(p.id, ahead.id))
    )
      continue;
    return {
      season: league.season,
      week: league.week,
      coachId: c.id,
      coachName: `${c.firstName} ${c.lastName}`,
      position,
      playerId: p.id,
      playerName: `${p.firstName} ${p.lastName}`,
      aheadId: ahead.id,
      aheadName: `${ahead.firstName} ${ahead.lastName}`,
      reason: selectionReason(c, p, ahead),
      baselineStats: { ...p.stats[league.season] },
      baselineGames: p.stats[league.season]?.gp ?? 0,
    };
  }
  return undefined;
}
export function updateCoachAdvice(league: League, team: Team, staff: readonly Coach[], available: Player[]): void {
  for (const a of team.coachAdvice ?? []) {
    if (a.resolved) {
      revisitTrial(league, team, a, available);
      continue;
    }
    const p = league.players[a.playerId];
    const c = staff.find((c) => c.id === a.coachId);
    if (!p || p.teamId !== team.id || !c || a.season !== league.season) {
      a.resolved = 'The recommendation is no longer current after a personnel or season change.';
      continue;
    }
    a.applied = team.depthChart[a.position].slice(0, STARTERS[a.position]).includes(p.id);
    const games = (p.stats[league.season]?.gp ?? 0) - a.baselineGames;
    if (games >= 2) {
      const delta = (key: keyof NonNullable<typeof a.baselineStats>) =>
        (p.stats[league.season]?.[key] ?? 0) - (a.baselineStats?.[key] ?? 0);
      const production = a.baselineStats
        ? p.position === 'WR' || p.position === 'TE'
          ? `, catching ${delta('rec')} passes for ${delta('recYds')} yards`
          : p.position === 'RB'
            ? `, carrying ${delta('rushAtt')} times for ${delta('rushYds')} yards`
            : p.position === 'QB'
              ? `, throwing ${delta('passTd')} touchdowns and ${delta('passInt')} interceptions`
              : ''
        : '';
      const review = reviewTrial(a, p, league.season, games);
      a.review = { week: league.week, promising: review.promising, adopted: a.applied };
      a.resolved = `${a.playerName} has appeared in ${games} more games since the recommendation${production}. ${review.text}`;
    } else if (league.week - a.week >= 4)
      a.resolved = `${a.playerName} has not yet earned two more game appearances; the staff will review the position again when circumstances change.`;
  }
  const pick = assessCoachAdvice(league, team, staff, available);
  if (pick && !(team.coachAdvice ?? []).some((a) => !a.resolved && a.season === league.season)) {
    const log = (team.coachAdvice ??= []);
    log.push({
      ...pick,
      applied: team.depthChart[pick.position].slice(0, STARTERS[pick.position]).includes(pick.playerId),
    });
    team.coachAdviceMemory = adviceMemory(league, team);
    if (log.length > 6) log.splice(0, log.length - 6);
  }
}
/** Bounded interventions use existing fix marbles; the draw, rather than the email, decides. */
export function coachTeachingWeek(league: League, staff: readonly Coach[], available: Player[]): void {
  for (const c of staff) {
    if (c.role !== 'positionCoach') continue;
    const stamp = `${league.season}:${Math.floor((league.week - 1) / 4)}`;
    if (c.teachingBlock === stamp) continue;
    c.teachingBlock = stamp;
    const members = available.filter((p) => positionCoachFor(staff, p.position)?.id === c.id);
    const evidence = (c.quirkEvidence ??= {});
    const add = (id: 'patientTeacher' | 'earnYourReps' | 'trustsVeterans' | 'techniqueStickler') => {
      evidence[id] = Math.min(32, (evidence[id] ?? 0) + 1);
    };
    if (members.some((p) => p.age <= 25 && p.learning)) add('patientTeacher');
    const team = c.teamId === null ? undefined : league.teams[c.teamId];
    if (team)
      for (const p of members) {
        if (!team.depthChart[p.position].slice(0, STARTERS[p.position]).includes(p.id)) continue;
        const peer = members.find(
          (other) =>
            other.id !== p.id &&
            other.position === p.position &&
            Math.abs(slotOvr(other, p.position) - slotOvr(p, p.position)) <= 0.5,
        );
        if (!peer) continue;
        if (workEthicOf(p) > workEthicOf(peer) + 3) add('earnYourReps');
        if (p.experience > peer.experience + 3) add('trustsVeterans');
      }
    if (!activeCoachQuirks(c).includes('techniqueStickler')) continue;
    const candidates = available.flatMap((p) =>
      positionCoachFor(staff, p.position)?.id !== c.id
        ? []
        : (Object.entries(p.quirks ?? {}) as [QuirkId, number][])
            .filter(([id, grip]) => grip >= 2 && QUIRKS[id]?.tone === 'bad')
            .map(([id]) => ({ p, id })),
    );
    if (!candidates.length) continue;
    const rng = new Rng(`${league.seed}:coach-teaching:${c.id}:${stamp}`);
    const { p, id } = rng.pick(candidates);
    if (!rng.chance(0.35 + 0.15 * (workEthicOf(p) / 20))) continue;
    // fillBag is handled by the player's existing weekly/offseason path; an empty bag here
    // would remove all ordinary draws, so only intervene once a bag exists.
    if (!p.quirkBag) continue;
    p.quirkBag[`fix:${id}`] = Math.min(16, (p.quirkBag[`fix:${id}`] ?? 0) + 1);
    add('techniqueStickler');
    c.teachingNote = {
      season: league.season,
      week: league.week,
      playerId: p.id,
      playerName: `${p.firstName} ${p.lastName}`,
      habit: id,
      coachName: `${c.firstName} ${c.lastName}`,
      receptive: coachPlayerFit(c, p) >= 0 && workEthicOf(p) >= 10.5,
    };
  }
}
