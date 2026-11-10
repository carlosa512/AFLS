/**
 * Your players' asks (G3), in his own words (`playerVoice.ts`): the rows of the head coach's weekly letter
 * (`coachWeek.ts`, "Who came to see me"). Its buttons answer through `answerTalk`; what a row shows is worked out
 * from the league as it is (`talkCard`), so nothing about it is stored on the message. Letters filed as `talk:` ids
 * by older saves still read through `talkNeedsYou`.
 */
import { benchFact } from './benching';
import { employed } from './employment';
import { canPromise } from './playerTalks';
import { askWords, TALK_ANSWER, TALK_SUBJECT } from './playerVoice';
import { manSheet, momentSheet } from './castSheet';
import { moraleContext } from './morale';
import { manner } from './manner';
import type { League, MailSection, TalkCause } from './types';
import { say } from './voice';

export { manner };

/**
 * A row for each of your players whose open ask was filed at `clock`: his name, what it is about and his words, written
 * from the cast sheet. `said` is what the sender has already said this league year (`seasonSaid`); each row's sentences
 * join it, so no man repeats another's, in this letter or an earlier one.
 */
export function talkRows(league: League, clock: number, said: string[]): MailSection['rows'] {
  const ctx = moraleContext(league);
  const moment = momentSheet(league);
  const recent = [...said];
  const rows: MailSection['rows'] = [];
  for (const p of Object.values(league.players)) {
    const ask = p.morale?.talk?.ask;
    if (!ask || ask.at !== clock || p.teamId !== league.userTeamId) continue;
    const man = manSheet(league, p, ctx);
    if (!man) continue;
    const key = `talk:${league.season}:${clock}:${p.id}`;
    // A benched ask is about his job question, and his row answers it (`benchCard`), not through the talks.
    const bench = ask.cause === 'benched' ? benchFact(league, p, ctx) : null;
    if (ask.cause === 'benched' && !bench) continue;
    const words = askWords({ man, moment, cause: ask.cause, ...(bench ? { bench } : {}) }, { key, recent });
    rows.push({
      playerId: p.id,
      cells: [`${p.firstName} ${p.lastName}`, TALK_SUBJECT[ask.cause]],
      note: `“${words}”`,
      ...(bench ? { bench: { playerId: p.id, clock } } : { talk: { playerId: p.id, clock } }),
    });
  }
  return rows;
}

export interface TalkCardView {
  /** Open: it needs your answer. Answered: what you said and his reply. Closed: no longer on file (he left, or a later talk). */
  state: 'open' | 'answered' | 'closed';
  cause?: TalkCause;
  canPromise?: boolean;
  /** What you told him, in a few words. */
  said?: string;
  /** His reply to it. */
  line?: string;
}

const SAID: Record<string, string> = {
  'promise:snaps': 'You promised him more snaps within four games.',
  'promise:deal': 'You promised him a new deal by the end of the re-sign window.',
  reassure: 'You reassured him.',
  firm: 'You were firm with him.',
  ignored: 'You left his letter unanswered.',
  'losing:reassure': "You told him we'll turn this around.",
  'losing:lead': 'You asked him to lead the room through it.',
  'losing:firm': "You told him that's on the coach and the players.",
};

/** What a player's letter shows now, read off the league: your players only. */
export function talkCard(league: League, s: { clock: number; playerId: number }): TalkCardView {
  const p = league.players[s.playerId];
  const t = p?.morale?.talk;
  // Between jobs nothing you'd press would answer him (`answerTalk` reads the same rule): the letter is closed.
  if (!p || !employed(league) || p.teamId !== league.userTeamId || !t) return { state: 'closed' };
  if (t.ask?.at === s.clock) return { state: 'open', cause: t.ask.cause, canPromise: canPromise(t.ask.cause) };
  const a = t.answered;
  if (!a || a.ask !== s.clock) return { state: 'closed' };
  // A promise still open says what it was for; once it's settled the letter just says you made one.
  const cause = t.promise?.kind;
  const losing = a.cause === 'losing' ? SAID[`losing:${a.lead ? 'lead' : a.reply}`] : undefined;
  const said =
    a.reply !== 'promise' ? (losing ?? SAID[a.reply]) : cause ? SAID[`promise:${cause}`] : 'You made him a promise.';
  const line = say(
    TALK_ANSWER,
    { cause: cause ?? 'losing', reply: a.reply, losing: a.cause === 'losing', lead: !!a.lead, ...manner(p) },
    { key: `talk:${Math.floor(s.clock / 32)}:${s.clock}:${p.id}`, slot: 'answer' },
  );
  return { state: 'answered', cause, said, line };
}

/** Does a players' letter still ask something: any of its men still waiting on your answer? */
export function talkNeedsYou(
  league: League,
  m: { id: string; sections?: { rows: { talk?: { playerId: number; clock: number } }[] }[] },
): boolean {
  const [, , clock, playerId] = m.id.split(':');
  if (playerId !== undefined)
    return talkCard(league, { clock: Number(clock), playerId: Number(playerId) }).state === 'open';
  return !!m.sections?.some((sec) => sec.rows.some((r) => r.talk && talkCard(league, r.talk).state === 'open'));
}
