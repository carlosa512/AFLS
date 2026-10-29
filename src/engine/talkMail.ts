/**
 * Your players' letters (G3): one for each ask on your roster (`playerTalks.ts`), in his own words (`playerVoice.ts`),
 * filed by `deliverMail` like every letter. Its buttons answer through `answerTalk`; what a letter shows is worked out
 * from the league as it is (`talkCard`), so nothing about it is stored on the message.
 */
import { canPromise } from './playerTalks';
import {
  TALK_ANSWER,
  TALK_CLOSE,
  TALK_GROUP_LEAD,
  TALK_GROUP_SUBJECT,
  TALK_LETTER,
  TALK_SUBJECT,
  type LetterFact,
} from './playerVoice';
import { yearsLeft } from './finance/contract';
import { STARTERS } from './positions';
import { computeRecords } from './season/standings';
import { playerSender, type Draft } from './senders';
import { TRAIT_MEAN } from './traits';
import type { League, Player, TalkCause } from './types';
import { say } from './voice';

const z = (v: number) => (v - TRAIT_MEAN) / 3.5;
/** How he talks: an outspoken man sharper, a calm one plainer. */
const manner = (p: Player) => ({ loud: z(p.traits.controversy) >= 0.5, calm: z(p.traits.temperament) >= 0.5 });

/** What his staff can see about where he stands: the things his letter talks about. */
function letterFact(league: League, p: Player, cause: TalkCause, record: LetterFact['record']): LetterFact {
  const spot = league.teams[p.teamId!].depthChart[p.position].indexOf(p.id);
  return {
    name: p.lastName,
    cause,
    ...manner(p),
    veteran: p.experience >= 6,
    young: p.experience <= 2,
    finalYear: !!p.contract && yearsLeft(p.contract, league.season) <= 1,
    record,
    starter: spot >= 0 && spot < STARTERS[p.position],
  };
}

/** His past letters, alone or in a step's group: what he'd rather not say again. */
function pastLetters(league: League, playerId?: number, n = 6): string[] {
  const out: string[] = [];
  for (const m of league.inbox ?? []) {
    if (!m.id.startsWith('talk:')) continue;
    if (m.sections) {
      for (const r of m.sections[0]?.rows ?? [])
        if (r.note && (playerId === undefined || r.talk?.playerId === playerId)) out.push(r.note);
    } else if (playerId === undefined || m.id.endsWith(`:${playerId}`)) out.push(m.body);
  }
  return out.slice(-n);
}

/**
 * Your players' letters: one message a step. A man alone writes his own letter; when two speak up the same step they
 * come as one message, a row each with his words and his own answers, so a busy week is one thing to read.
 */
export function talkMail(league: League, have: Set<string>): Draft[] {
  const askers = Object.values(league.players).filter((p) => p.morale?.talk?.ask && p.teamId === league.userTeamId);
  const steps = new Map<number, Player[]>();
  for (const p of askers) {
    const at = p.morale!.talk!.ask!.at;
    steps.set(at, [...(steps.get(at) ?? []), p]);
  }
  const idOf = (at: number, group: Player[]) =>
    group.length === 1 ? `talk:${league.season}:${at}:${group[0].id}` : `talk:${league.season}:${at}`;
  const due = [...steps].filter(([at, group]) => !have.has(idOf(at, group)));
  if (!due.length) return [];
  const r = computeRecords(league).get(league.userTeamId);
  const share = r && r.w + r.l + r.t >= 3 ? (r.w + r.t / 2) / (r.w + r.l + r.t) : 0.5;
  const record = share >= 0.6 ? 'winning' : share <= 0.4 ? 'losing' : 'even';
  // The last few letters, any player's: two letters side by side never say the same thing.
  const recent = pastLetters(league);
  const letter = (p: Player) => {
    const ask = p.morale!.talk!.ask!;
    const key = `talk:${league.season}:${ask.at}:${p.id}`;
    const fact = letterFact(league, p, ask.cause, record);
    // Nor does a man repeat his own last letters.
    const avoid = [...recent, ...pastLetters(league, p.id, 3)];
    const opening = say(TALK_LETTER, fact, { key, slot: 'letter', recent: avoid });
    const close = say(TALK_CLOSE, fact, {
      key,
      slot: 'close',
      recent: avoid.map((b) => b.split(/(?<=[.?!]) /).at(-1)!),
    });
    const body = `${opening} ${close}`;
    recent.push(body);
    if (recent.length > 6) recent.shift();
    return body;
  };
  const base = {
    season: league.season,
    phase: league.phase,
    week: league.phase === 'regular' || league.phase === 'playoffs' ? league.week : 0,
    category: 'staff' as const,
  };
  return due.map(([at, group]): Draft => {
    if (group.length === 1) {
      const p = group[0];
      return {
        ...base,
        id: idOf(at, group),
        ...playerSender(p),
        subject: TALK_SUBJECT[p.morale!.talk!.ask!.cause],
        body: letter(p),
        actions: [{ kind: 'player', playerId: p.id }],
      };
    }
    const rows = group.map((p) => ({
      playerId: p.id,
      cells: [`${p.firstName} ${p.lastName}`, TALK_SUBJECT[p.morale!.talk!.ask!.cause]],
      note: letter(p),
      talk: { playerId: p.id, clock: at },
    }));
    return {
      ...base,
      id: idOf(at, group),
      from: 'Your players',
      subject: say(TALK_GROUP_SUBJECT, { n: group.length }, { key: idOf(at, group), slot: 'subject' }),
      body: say(TALK_GROUP_LEAD, { n: group.length }, { key: idOf(at, group), slot: 'lead' }),
      sections: [{ title: 'Who wants a word', rows }],
      actions: [{ kind: 'locker' }],
    };
  });
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
};

/** What a player's letter shows now, read off the league: your players only. */
export function talkCard(league: League, s: { clock: number; playerId: number }): TalkCardView {
  const p = league.players[s.playerId];
  const t = p?.morale?.talk;
  if (!p || p.teamId !== league.userTeamId || !t) return { state: 'closed' };
  if (t.ask?.at === s.clock) return { state: 'open', cause: t.ask.cause, canPromise: canPromise(t.ask.cause) };
  const a = t.answered;
  if (!a || a.ask !== s.clock) return { state: 'closed' };
  // A promise still open says what it was for; once it's settled the letter just says you made one.
  const cause = t.promise?.kind;
  const said = a.reply !== 'promise' ? SAID[a.reply] : cause ? SAID[`promise:${cause}`] : 'You made him a promise.';
  const line = say(
    TALK_ANSWER,
    { cause: cause ?? 'losing', reply: a.reply, ...manner(p) },
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
