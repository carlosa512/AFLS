/**
 * Your players' letters (G3): one for each ask on your roster (`playerTalks.ts`), in his own words (`playerVoice.ts`),
 * filed by `deliverMail` like every letter. Its buttons answer through `answerTalk`; what a letter shows is worked out
 * from the league as it is (`talkCard`), so nothing about it is stored on the message.
 */
import { canPromise } from './playerTalks';
import { TALK_ANSWER, TALK_CLOSE, TALK_LETTER, TALK_SUBJECT, type LetterFact } from './playerVoice';
import { yearsLeft } from './finance/contract';
import { STARTERS } from './positions';
import { computeRecords } from './season/standings';
import { playerSender, type Draft } from './senders';
import { TRAIT_MEAN } from './traits';
import type { League, Player, TalkCause } from './types';
import { recentBodies, say } from './voice';

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

export function talkMail(league: League, have: Set<string>): Draft[] {
  const askers = Object.values(league.players).filter((p) => p.morale?.talk?.ask && p.teamId === league.userTeamId);
  const ids = askers.map((p) => `talk:${league.season}:${p.morale!.talk!.ask!.at}:${p.id}`);
  if (ids.every((id) => have.has(id))) return [];
  const r = computeRecords(league).get(league.userTeamId);
  const share = r && r.w + r.l + r.t >= 3 ? (r.w + r.t / 2) / (r.w + r.l + r.t) : 0.5;
  const record = share >= 0.6 ? 'winning' : share <= 0.4 ? 'losing' : 'even';
  // The last few players' letters, any player's: two letters side by side never say the same thing.
  const recent = (league.inbox ?? [])
    .filter((m) => m.id.startsWith('talk:'))
    .slice(-6)
    .map((m) => m.body);
  const out: Draft[] = [];
  askers.forEach((p, i) => {
    const id = ids[i];
    if (have.has(id)) return;
    const ask = p.morale!.talk!.ask!;
    const sender = playerSender(p);
    const fact = letterFact(league, p, ask.cause, record);
    // Nor does a man repeat his own last letters.
    const avoid = [...recent, ...recentBodies(league, sender.from, 3)];
    const opening = say(TALK_LETTER, fact, { key: id, slot: 'letter', recent: avoid });
    const close = say(TALK_CLOSE, fact, {
      key: id,
      slot: 'close',
      recent: avoid.map((b) => b.split(/(?<=[.?!]) /).at(-1)!),
    });
    const body = `${opening} ${close}`;
    recent.push(body);
    if (recent.length > 6) recent.shift();
    out.push({
      id,
      season: league.season,
      phase: league.phase,
      week: league.phase === 'regular' || league.phase === 'playoffs' ? league.week : 0,
      ...sender,
      category: 'staff',
      subject: TALK_SUBJECT[ask.cause],
      body,
      actions: [{ kind: 'player', playerId: p.id }],
    });
  });
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
