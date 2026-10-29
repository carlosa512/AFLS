/**
 * Your players' letters (G3): one for each ask on your roster (`playerTalks.ts`), in his own words (`playerVoice.ts`),
 * filed by `deliverMail` like every letter. Its buttons answer through `answerTalk`; what a letter shows is worked out
 * from the league as it is (`talkCard`), so nothing about it is stored on the message.
 */
import { canPromise } from './playerTalks';
import { TALK_ANSWER, TALK_LETTER, TALK_SUBJECT } from './playerVoice';
import { playerSender, type Draft } from './senders';
import { TRAIT_MEAN } from './traits';
import type { League, Player, TalkCause } from './types';
import { recentBodies, say } from './voice';

const z = (v: number) => (v - TRAIT_MEAN) / 3.5;
/** How he talks: an outspoken man sharper, a calm one plainer. */
const manner = (p: Player) => ({ loud: z(p.traits.controversy) >= 0.5, calm: z(p.traits.temperament) >= 0.5 });

export function talkMail(league: League, have: Set<string>): Draft[] {
  const out: Draft[] = [];
  for (const p of Object.values(league.players)) {
    const ask = p.morale?.talk?.ask;
    if (!ask || p.teamId !== league.userTeamId) continue;
    const id = `talk:${league.season}:${ask.at}:${p.id}`;
    if (have.has(id)) continue;
    const sender = playerSender(p);
    out.push({
      id,
      season: league.season,
      phase: league.phase,
      week: league.phase === 'regular' || league.phase === 'playoffs' ? league.week : 0,
      ...sender,
      category: 'staff',
      subject: TALK_SUBJECT[ask.cause],
      body: say(
        TALK_LETTER,
        { name: p.lastName, cause: ask.cause, ...manner(p) },
        { key: id, slot: 'letter', recent: recentBodies(league, sender.from) },
      ),
      actions: [{ kind: 'player', playerId: p.id }],
    });
  }
  return out;
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
export function talkCard(league: League, s: { season: number; clock: number; playerId: number }): TalkCardView {
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
    { key: `talk:${s.season}:${s.clock}:${p.id}`, slot: 'answer' },
  );
  return { state: 'answered', cause, said, line };
}
