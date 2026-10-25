/** Selective public reporting. No hidden ratings, random copy, or simulation side effects. */
import { computeRecords, divisionStandings, winPct, type TeamRecord } from './season/standings';
import { isDeadlineDay } from './trade/rules';
import type { InboxMessage, League } from './types';
import { keyTradeNews, rumorNews, tradeNewsSlot } from './tradeNews';
import { teamStatContext, teamStatRows, divisionTable } from './newsContext';
export { rookieImpactMail } from './rookieReport';

type Draft = Omit<InboxMessage, 'read'>;
const teamName = (l: League, id: number) => `${l.teams[id].city} ${l.teams[id].name}`;
const record = (r: { w: number; l: number; t: number }) => `${r.w}–${r.l}${r.t ? `–${r.t}` : ''}`;
const pct = (r: { w: number; l: number; t: number }) => winPct(r.w, r.l, r.t);
const games = (l: League) => l.games.filter((g) => g.season === l.season && !g.playoffRound);
const played = (l: League, id: number) => games(l).filter((g) => g.result && (g.homeId === id || g.awayId === id));
const through = (l: League, week: number): League => ({
  ...l,
  games: l.games.filter((g) => g.season !== l.season || g.week <= week),
});

/** Exact win/loss stakes only: never turn provisional standings into a clinch claim. */
export function matchupStakes(l: League, opponent: number): { subject: string; body: string } | null {
  const team = l.teams[l.userTeamId];
  if (l.phase !== 'regular' || l.week < 10 || l.teams[opponent].division !== team.division) return null;
  const table = divisionStandings(l)[team.division].teams;
  const us = table.find((r) => r.teamId === team.id)!;
  const them = table.find((r) => r.teamId === opponent)!;
  const afterWin = { ...us, w: us.w + 1 };
  const afterLoss = { ...them, l: them.l + 1 };
  const others = table.filter((r) => r.teamId !== team.id && r.teamId !== opponent);
  const canCatch = others.some((r) => {
    const stillPlays = games(l).some(
      (g) => g.week === l.week && !g.result && (g.homeId === r.teamId || g.awayId === r.teamId),
    );
    return pct(stillPlays ? { ...r, w: r.w + 1 } : r) >= pct(afterWin);
  });
  if (pct(afterWin) <= pct(afterLoss) || canCatch) return null;
  // Only a genuine challenger gets this headline; a runaway leader's routine win is no turning point.
  if (table[0].teamId === team.id) return null;
  return {
    subject: `Beat ${l.teams[opponent].name} to take first place`,
    body: `A win puts us alone atop the ${l.divisions[team.division].name} by winning percentage. `,
  };
}

const smallCount = (n: number) =>
  ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'][n] ?? String(n);
const possessive = (name: string) => `${name}${name.endsWith('s') ? "'" : "'s"}`;

/** Report the result and its consequence as a short article. Tables carry the statistical detail. */
function divisionArticle(l: League, week: number, before: TeamRecord[], after: TeamRecord[]): string {
  const lead = after[0];
  const runner = after[1];
  const former = before[0];
  const old = after.find((r) => r.teamId === former.teamId)!;
  const club = l.teams[lead.teamId];
  const oldClub = l.teams[old.teamId];
  const division = l.divisions[club.division].name;
  const latest = played(l, lead.teamId).find((g) => g.week === week);
  let opening = `The ${teamName(l, lead.teamId)} moved into first place in the ${division} after Week ${week}.`;
  if (latest) {
    const home = latest.homeId === lead.teamId;
    const us = home ? latest.result!.homeScore : latest.result!.awayScore;
    const them = home ? latest.result!.awayScore : latest.result!.homeScore;
    const opponent = home ? latest.awayId : latest.homeId;
    const result =
      us > them
        ? `with a ${us}–${them} win over`
        : us < them
          ? `despite a ${them}–${us} loss to`
          : `after a ${us}–${them} tie with`;
    opening = `The ${teamName(l, lead.teamId)} took over first place in the ${division} ${result} the ${teamName(l, opponent)}.`;
  }
  const samePct = pct(lead) === pct(runner);
  const sameRecord = lead.w === runner.w && lead.l === runner.l && lead.t === runner.t;
  const tied = after.filter((r) => pct(r) === pct(lead));
  const meetings = games(l).filter(
    (g) =>
      g.result &&
      g.week <= week &&
      ((g.homeId === lead.teamId && g.awayId === runner.teamId) ||
        (g.awayId === lead.teamId && g.homeId === runner.teamId)),
  );
  const headToHead = meetings.reduce((edge, g) => {
    const difference =
      g.homeId === lead.teamId ? g.result!.homeScore - g.result!.awayScore : g.result!.awayScore - g.result!.homeScore;
    return edge + Math.sign(difference);
  }, 0);
  const edge = tied.length === 2 && headToHead > 0 ? 'the head-to-head edge' : 'the edge on the current tiebreakers';
  const position =
    samePct && sameRecord
      ? `Both the ${club.name} and ${l.teams[runner.teamId].name} are ${record(lead)}, but the ${club.name} hold ${edge}.`
      : samePct
        ? `At ${record(lead)}, the ${club.name} hold first on the current tiebreakers ahead of the ${l.teams[runner.teamId].name} (${record(runner)}).`
        : `The ${club.name} are now ${record(lead)}, ahead of the ${l.teams[runner.teamId].name} at ${record(runner)}.`;
  const formerGame = played(l, former.teamId).find((g) => g.week === week);
  if (
    !latest &&
    formerGame &&
    !games(l).some((g) => g.week === week && (g.homeId === club.id || g.awayId === club.id))
  ) {
    const home = formerGame.homeId === former.teamId;
    const own = home ? formerGame.result!.homeScore : formerGame.result!.awayScore;
    const against = home ? formerGame.result!.awayScore : formerGame.result!.homeScore;
    if (own < against) {
      const opponent = l.teams[home ? formerGame.awayId : formerGame.homeId];
      opening = `The ${teamName(l, lead.teamId)} emerged from their bye week in first place in the ${division}, after the ${oldClub.name} lost ${against}–${own} to the ${opponent.name}.`;
    }
  }
  const paragraphs = [`${opening} ${position}`];
  const losses = old.streak.startsWith('L') ? Number(old.streak.slice(1)) : 0;
  if (losses >= 2) {
    const was = { ...old, l: old.l - losses };
    paragraphs.push(
      was.w > 0 && was.l === 0 && was.t === 0
        ? `The ${possessive(oldClub.name)} ${record(was)} start has given way to ${smallCount(losses)} straight defeats, and the lead they carried into the week is gone.`
        : `The ${oldClub.name} have dropped ${smallCount(losses)} in a row, slipping from ${record(was)} to ${record(old)} and out of first place.`,
    );
  } else if (old.streak === 'L1' && former.streak.startsWith('W') && Number(former.streak.slice(1)) >= 3) {
    paragraphs.push(
      `The ${possessive(oldClub.name)} ${smallCount(Number(former.streak.slice(1)))}-game winning streak is over, along with their stay at the top of the division.`,
    );
  } else if (lead.streak.startsWith('W') && Number(lead.streak.slice(1)) >= 3) {
    const wins = Number(lead.streak.slice(1));
    paragraphs.push(
      `The ${club.name} have won ${smallCount(wins)} straight, climbing from ${record({ ...lead, w: lead.w - wins })} to ${record(lead)}.`,
    );
  }
  const us = after.find((r) => r.teamId === l.userTeamId)!;
  const behind = (lead.w - us.w + us.l - lead.l) / 2;
  let closing =
    lead.teamId === l.userTeamId
      ? ''
      : `Elsewhere in the race, the ${l.teams[l.userTeamId].name} sit ${after.indexOf(us) === 1 ? 'second' : after.indexOf(us) === 2 ? 'third' : 'fourth'} at ${record(us)}${behind > 0 ? `, ${behind} ${behind === 1 ? 'game' : 'games'} behind` : pct(us) === pct(lead) ? ', behind on the current tiebreakers' : ', behind on winning percentage'}.`;
  const next = l.games
    .filter(
      (g) =>
        g.season === l.season &&
        !g.playoffRound &&
        !g.result &&
        g.week > week &&
        (g.homeId === club.id || g.awayId === club.id),
    )
    .sort((a, b) => a.week - b.week)[0];
  if (next) {
    const opponent = l.teams[next.homeId === club.id ? next.awayId : next.homeId];
    const nextLine =
      opponent.division === club.division
        ? `Another division game awaits the ${club.name}: ${next.homeId === club.id ? 'a home meeting with' : 'a trip to face'} the ${opponent.name} in Week ${next.week}.`
        : `Next for the ${club.name} is ${next.homeId === club.id ? 'a home game against' : 'a trip to face'} the ${opponent.name} in Week ${next.week}.`;
    closing += `${closing ? ' ' : ''}${nextLine}`;
  }
  if (closing) paragraphs.push(closing);
  return paragraphs.join('\n\n');
}

/** One chosen headline for the latest completed week; never backfill a skipped weekly feed. */
export function leagueNews(l: League, have: Set<string>): Draft[] {
  if (!['regular', 'playoffs', 'complete'].includes(l.phase)) return [];
  if (isDeadlineDay(l) && ![...have].some((id) => id.startsWith(tradeNewsSlot(l, l.week)))) {
    const deadline = keyTradeNews(l, l.week);
    if (deadline.length) return deadline;
  }
  const completed = games(l).filter((g) => g.result);
  const week = Math.max(0, ...completed.map((g) => g.week));
  if (!week || games(l).some((g) => g.week === week && !g.result)) return [];
  const slot = `press:${l.season}:${week}:`;
  if ([...have].some((id) => id.startsWith(slot))) return [];
  const now = through(l, week);
  const records = computeRecords(now);
  const division = l.teams[l.userTeamId].division;
  if (week >= 10) {
    const previous = through(l, week - 1);
    const before = divisionStandings(previous)[division].teams;
    const after = divisionStandings(now)[division].teams;
    const lead = after[0];
    if (lead.teamId !== before[0].teamId) {
      return [
        {
          id: `${slot}division:${lead.teamId}`,
          season: l.season,
          phase: 'regular',
          week,
          from: 'SNN — Sports News Network',
          category: 'league',
          subject: `${l.teams[lead.teamId].name} take first in the ${l.divisions[division].name}`,
          body: divisionArticle(l, week, before, after),
          leagueReport: {
            division: l.divisions[division].name,
            table: divisionTable(now, lead.teamId, week),
            teamId: lead.teamId,
            season: l.season,
            standings: after.map((r) => ({
              teamId: r.teamId,
              name: teamName(l, r.teamId),
              w: r.w,
              l: r.l,
              t: r.t,
              gap: (lead.w - r.w + r.l - lead.l) / 2,
              streak: r.streak,
            })),
            stats: teamStatRows(now, lead.teamId),
          },
          actions: [{ kind: 'standings' }, { kind: 'team', teamId: lead.teamId }],
        },
      ];
    }
  }
  const trade = keyTradeNews(now, week);
  if (trade.length) return trade;
  // Fixed team-game checkpoints keep features occasional, and handle byes without calling week 9 eight games.
  const candidates = l.teams.flatMap((t) => {
    const count = played(now, t.id).length;
    const last = l.history.find((h) => h.season === l.season - 1)?.records[t.id];
    if (![8, 12, 17].includes(count) || !last) return [];
    // A checkpoint is news only in the week this club reached it, not after a later bye.
    if (!played(now, t.id).some((g) => g.week === week)) return [];
    const r = records.get(t.id)!;
    const up = last.w <= 6 && pct(r) >= 0.75;
    const down = last.w >= 10 && pct(r) <= 0.375;
    if (!up && !down) return [];
    return [{ t, count, last, r, up }];
  });
  candidates.sort(
    (a, b) =>
      Number(b.t.division === division) - Number(a.t.division === division) ||
      Math.abs(pct(b.r) - pct(b.last)) - Math.abs(pct(a.r) - pct(a.last)) ||
      a.t.id - b.t.id,
  );
  const c = candidates[0];
  if (!c) return rumorNews(now, week);
  const checkpoint = played(now, c.t.id).sort((a, b) => a.week - b.week);
  const earlier = c.count === 12 ? computeRecords(through(l, checkpoint[7].week)).get(c.t.id)! : null;
  const recent = earlier
    ? ` They went ${record({ w: c.r.w - earlier.w, l: c.r.l - earlier.l, t: c.r.t - earlier.t })} over their last four games.`
    : '';
  const subject =
    c.count === 17
      ? `${c.t.name} finish ${record(c.r)} after last year's ${record(c.last)}`
      : c.count === 12
        ? `${c.t.name}: ${record(c.r)} with five games left`
        : `${c.t.name}: ${record(c.r)} after a ${record(c.last)} season`;
  return [
    {
      id: `${slot}trajectory:${c.t.id}:${c.count}`,
      season: l.season,
      phase: 'regular',
      week,
      from: 'The Arena Gazette',
      category: 'league',
      subject,
      body: `${teamName(l, c.t.id)} ${c.count === 17 ? `finish the regular season ${record(c.r)}` : `are ${record(c.r)} through ${c.count} games`}, after finishing last season ${record(c.last)}.${recent}${c.count === 8 ? (c.up ? ' The results have turned sharply upward.' : ' Last year’s winning record has given way to a difficult season.') : ''} ${teamStatContext(now, c.t.id, c.up ? 'up' : 'down')}`.trim(),
      actions: [{ kind: 'team', teamId: c.t.id }, { kind: 'standings' }],
    },
  ];
}
