/**
 * The head coach's reminder at the season's end (G4, the owner's ask): one letter, a row for each open promise to your
 * players, so a deal promised in October isn't forgotten by March. A deal's row offers Negotiate; the letter asks while
 * any deal on it is still open, read from the league as it is (nothing stored on the message).
 */
import { headCoach, type Draft } from './senders';
import { PROMISES_LEAD, PROMISES_SUBJECT } from './lockerVoice';
import type { InboxMessage, League, MailSection, Player } from './types';
import { say } from './voice';

const COUNT = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];

/** What a promise to him says, the season over. */
function promiseNote(p: Player): string {
  const pr = p.morale!.talk!.promise!;
  if (pr.kind === 'deal') return 'A new deal by the end of the re-sign window.';
  const left = Math.max(1, pr.left ?? 1);
  return `More snaps: ${COUNT[left] ?? left} game${left === 1 ? '' : 's'} left, carried into next season.`;
}

const open = (league: League) =>
  Object.values(league.players)
    .filter((p) => p.teamId === league.userTeamId && p.morale?.talk?.promise)
    .sort((a, b) => a.lastName.localeCompare(b.lastName) || a.id - b.id);

/** The reminder, once a season, the day the season is complete. */
export function promiseMail(league: League, have: Set<string>): Draft[] {
  if (league.phase !== 'complete') return [];
  const id = `promises:${league.season}`;
  if (have.has(id)) return [];
  const players = open(league);
  if (!players.length) return [];
  const rows: MailSection['rows'] = players.map((p) => ({
    playerId: p.id,
    cells: [`${p.firstName} ${p.lastName}`, p.morale!.talk!.promise!.kind === 'deal' ? 'A new deal' : 'More snaps'],
    note: promiseNote(p),
    ...(p.morale!.talk!.promise!.kind === 'deal' ? { negotiate: { playerId: p.id } } : {}),
  }));
  const n = players.length;
  return [
    {
      id,
      season: league.season,
      phase: league.phase,
      week: 0,
      ...headCoach(league),
      category: 'staff',
      subject: say(PROMISES_SUBJECT, { n }, { key: id, slot: 'subject' }),
      body: say(PROMISES_LEAD, { n }, { key: id, slot: 'lead' }),
      sections: [{ title: 'Promises to keep', rows }],
      actions: [{ kind: 'locker' }],
    },
  ];
}

/** It asks while a deal it lists is still promised to a man still yours. */
export function promisesNeedYou(league: League, m: Pick<InboxMessage, 'sections'>): boolean {
  return !!m.sections?.some((s) =>
    s.rows.some((r) => {
      const p = r.negotiate && league.players[r.negotiate.playerId];
      return !!p && p.teamId === league.userTeamId && p.morale?.talk?.promise?.kind === 'deal';
    }),
  );
}
