import { activeCoachQuirks, coachPlayerFit, positionCoachFor } from './coachQuirks';
import { QUIRKS } from './quirks';
import { adviceKey, advicePublishedWeek } from './coachDecisions';
import type { CoachGameReport, Game, League, Player, Position } from './types';

/** These facts were recorded after penalties resolved. A blitz mention never implies a quirk caused the play. */
function defensiveHighlight(game: Game, report: CoachGameReport): { text: string; priority: number } | undefined {
  if (!game.result || report.role !== 'defCoord') return;
  const won =
    report.teamId === game.homeId
      ? game.result.homeScore > game.result.awayScore
      : game.result.awayScore > game.result.homeScore;
  const choices = (report.defensiveDecisions ?? [])
    .filter((e) => e.quarter >= 4 && (e.quarter > 4 || e.clock <= 180) && Math.abs(e.marginBefore) <= 8)
    .map((e) => ({
      e,
      priority:
        e.outcome === 'fourthDownStop'
          ? won
            ? 110
            : 85
          : e.outcome === 'turnover'
            ? won
              ? 100
              : 80
            : !won && e.marginBefore >= 0 && e.marginAfter < 0
              ? 105
              : 0,
    }))
    .filter((x) => x.priority > 0)
    .sort((a, b) => b.priority - a.priority || a.e.clock - b.e.clock);
  const pick = choices[0];
  if (!pick) return;
  const e = pick.e;
  const call =
    e.call === 'blitz'
      ? 'sent pressure'
      : e.call === 'passD'
        ? 'leaned on coverage'
        : e.call === 'runD'
          ? 'played the run'
          : 'stayed with his base defense';
  const down = ['first', 'second', 'third', 'fourth'][e.down - 1] ?? `${e.down}th`;
  const when =
    e.quarter > 4 ? 'in overtime' : `with ${Math.floor(e.clock / 60)}:${String(e.clock % 60).padStart(2, '0')} left`;
  const play = e.text.replace(/^Designed shot:\s*/, '').replace(/[.!]+$/, '');
  const consequence =
    e.outcome === 'touchdownAllowed'
      ? ', giving them a late lead'
      : `${e.outcome === 'fourthDownStop' ? ', forcing a turnover on downs' : ', securing a takeaway'}${won && e.marginBefore > 0 ? ' that helped protect our late lead' : ' and giving us the ball back late'}`;
  return { text: `${call} on ${down}-and-${e.distance} ${when}; ${play}${consequence}.`, priority: pick.priority };
}

/** Routine shots stay in the play log. A recap needs a large gain in a live game, or a late scoring-drive role. */
function shotHighlight(game: Game, report: CoachGameReport): string | undefined {
  const plays = game.result?.plays ?? [];
  const home = report.teamId === game.homeId;
  const margin = (p: { homeScore: number; awayScore: number }) =>
    home ? p.homeScore - p.awayScore : p.awayScore - p.homeScore;
  for (const event of report.events.filter((e) => e.quirk === 'shotPlayArchitect')) {
    const index = plays.findIndex(
      (p) =>
        p.offense === report.teamId &&
        p.quarter === event.quarter &&
        p.clock === event.clock &&
        p.kind === 'pass' &&
        p.text.startsWith('Designed shot:'),
    );
    if (index < 0) continue;
    const play = plays[index];
    const yards = Math.round(Math.abs(Math.min(100, Math.max(0, play.to ?? 0)) - (play.from ?? 0)));
    if (play.to === undefined || play.from === undefined || yards < 20) continue;
    const before = index > 0 ? margin(plays[index - 1]) : 0;
    // Stop at the first possession change: later scores cannot make this shot look decisive.
    const drive = plays.slice(index).slice(
      0,
      (() => {
        const end = plays.slice(index).findIndex((p) => p.offense !== report.teamId || p.kind === 'kickoff');
        return end < 0 ? plays.length - index : end;
      })(),
    );
    const late = play.quarter >= 4 && (play.quarter > 4 || play.clock <= 180);
    if (late && before <= 0 && before >= -8 && drive.some((p) => p.scoring && margin(p) > 0))
      return `designed a ${yards}-yard completion on our late go-ahead scoring drive.`;
    if (yards >= 45 && Math.abs(before) <= 16) {
      const lead = play.scoring && before <= 0 && margin(play) > 0 ? ' to put us ahead' : '';
      return `designed a ${yards}-yard ${play.scoring ? 'touchdown' : 'completion'}${lead}${play.quarter > 4 ? ' in overtime' : ` in the ${['first', 'second', 'third', 'fourth'][play.quarter - 1]} quarter`}.`;
    }
  }
  return undefined;
}

/** Match facts retain event-time identities, including after a coach leaves. */
function observationFrom(
  game: Game,
  reports: NonNullable<NonNullable<Game['result']>['coaching']>,
  senderId?: number,
): string {
  const role = (r: (typeof reports)[number]) =>
    r.coachId === senderId
      ? 'I'
      : `Our ${r.role === 'headCoach' ? 'head coach' : r.role === 'offCoord' ? 'offensive coordinator' : r.role === 'positionCoach' ? 'position coach' : 'defensive coordinator'}, ${r.name},`;
  const say = (r: (typeof reports)[number], text: string) => {
    let words = text[0].toLowerCase() + text.slice(1);
    if (r.coachId === senderId) words = words.replace(/^wants /, 'want ');
    return `${role(r)} ${words}`;
  };
  const defense = reports
    .map((r) => ({ r, highlight: defensiveHighlight(game, r) }))
    .filter((x) => x.highlight)
    .sort((a, b) => b.highlight!.priority - a.highlight!.priority)[0];
  if (defense) return `${role(defense.r)} ${defense.highlight!.text}`;
  for (const r of reports) {
    const shot = shotHighlight(game, r);
    if (shot) return `${role(r)} ${shot}`;
  }
  for (const r of reports) {
    const event = r.events.find(
      (e) =>
        e.quirk === 'clingsToTimeouts' ||
        e.quirk === 'stopsTheClock' ||
        e.quirk === 'takesThePoints' ||
        e.quirk === 'backsHisOffense',
    );
    if (event) return say(r, event.text);
  }
  for (const r of reports) {
    const reaction = r.events.find((e) => e.quirk === 'patientTeacher' || e.quirk === 'earnYourReps');
    if (reaction) return say(r, reaction.text);
  }
  for (const r of reports) {
    const shell = r.uses.goesIntoShell ?? 0;
    if (shell >= 3) return `${role(r)} favored safer calls while protecting our fourth-quarter lead.`;
  }
  return '';
}
export function userCoachGameObservation(league: League, game: Game, senderId?: number): string {
  return observationFrom(
    game,
    (game.result?.coaching ?? []).filter((r) => r.teamId === league.userTeamId),
    senderId,
  );
}
export function coachAdviceObservation(league: League):
  | {
      text: string;
      key: string;
      playerId: number;
      coachId: number;
      coachName: string;
      kind: 'recommendation' | 'followup' | 'revisit';
    }
  | undefined {
  const log = league.teams[league.userTeamId].coachAdvice ?? [];
  for (const stage of ['followup', 'revisit', 'offer'] as const)
    for (const a of log) {
      if (a.season !== league.season) continue;
      if (
        !a.resolved &&
        (league.coaches[a.coachId]?.teamId !== league.userTeamId ||
          league.players[a.playerId]?.teamId !== league.userTeamId)
      )
        continue;
      const key = adviceKey(a, stage);
      if (advicePublishedWeek(league, a, stage) !== undefined) continue;
      if (stage === 'offer' && a.resolved) continue;
      if (
        stage === 'followup' &&
        (!a.resolved || league.week - a.week < 2 || advicePublishedWeek(league, a, 'offer') === undefined)
      )
        continue;
      if (
        stage === 'revisit' &&
        (!a.revisit ||
          advicePublishedWeek(league, a, 'followup') === undefined ||
          league.coaches[a.coachId]?.teamId !== league.userTeamId ||
          league.players[a.playerId]?.teamId !== league.userTeamId)
      )
        continue;
      return {
        key,
        playerId: a.playerId,
        coachId: a.coachId,
        coachName: a.coachName,
        kind: stage === 'offer' ? 'recommendation' : stage,
        text:
          stage === 'revisit'
            ? a.revisit!.text
            : a.resolved
              ? `${a.coachName}'s earlier recommendation: ${a.resolved}`
              : `${a.coachName} recommends trying ${a.playerName} ahead of ${a.aheadName} at ${a.position}; he ${a.reason}.${a.applied ? ' He is in that slot for now; we can review the trial after a couple of games.' : league.teams[league.userTeamId].autoDepth ? ' That preference will be considered in delegated selection.' : ' The depth-chart decision remains yours.'}`,
      };
    }
  return undefined;
}
export function teachingObservation(league: League): string {
  for (const c of Object.values(league.coaches)) {
    const n = c.teachingNote;
    if (c.teamId !== league.userTeamId || !n || n.season !== league.season || league.week - n.week > 1) continue;
    return `${n.coachName} has focused coaching attention on ${n.playerName}'s ${QUIRKS[n.habit].label} habit; ${n.receptive ? 'his preparation gives that work a better chance to stick.' : 'the staff expects progress to take time.'}`;
  }
  return '';
}

/** A real teaching tradeoff in a conversion proposal, rather than a randomly invented dispute. */
export function positionTeachingNote(league: League, p: Player, to: Position): string {
  const staff = Object.values(league.coaches).filter((c) => c.teamId === p.teamId);
  const from = positionCoachFor(staff, p.position),
    target = positionCoachFor(staff, to);
  if (!target) return '';
  const name = `${target.firstName} ${target.lastName}`;
  if (from && from.id !== target.id && coachPlayerFit(from, p) - coachPlayerFit(target, p) >= 0.015)
    return `${from.firstName} ${from.lastName}'s teaching approach suits him better than the destination room's; that is a tradeoff against the football case for moving him. `;
  if (p.age <= 25 && activeCoachQuirks(target).includes('patientTeacher'))
    return `${name}'s patient teaching approach should help him learn the new position. `;
  return '';
}
