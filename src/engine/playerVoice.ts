/**
 * A player's own words when he speaks up (`talkMail.ts`, G3). Short and direct, the way a player talks to his GM: an
 * outspoken man (`loud`) says it sharper, a calm one (`calm`) plainer. His ask in his terms, never a number about his
 * mood; nothing here is a trait or a marble.
 */
import type { TalkCause, TalkReply } from './types';
import type { Line } from './voice';

export interface LetterFact {
  name: string;
  cause: TalkCause;
  loud: boolean;
  calm: boolean;
  /** Six seasons or more in the league; two or fewer. */
  veteran: boolean;
  young: boolean;
  /** In the last year of his deal. */
  finalYear: boolean;
  /** His club's season so far. */
  record: 'winning' | 'losing' | 'even';
  /** A starter on the depth chart. */
  starter: boolean;
}

export const TALK_SUBJECT: Record<TalkCause, string> = {
  snaps: 'About my snaps',
  deal: 'About my contract',
  losing: 'About the losing',
  feud: 'About the room',
};

// Every line that fits his ask is equally likely (one specificity, fallback aside): what the staff can see about him
// widens the pool, so two men asking for the same thing rarely write the same letter.
export const TALK_LETTER: readonly Line<LetterFact>[] = [
  {
    when: (f) => f.cause === 'snaps' && f.loud,
    reads: 1,
    text: () => "I'm not going to pretend I'm fine. I want to be out there on Sundays, and right now I'm watching.",
  },
  {
    when: (f) => f.cause === 'snaps' && f.calm,
    reads: 1,
    text: () => "I'll keep it short. I want to be out there on Sundays. I think I've shown I can help this team.",
  },
  {
    when: (f) => f.cause === 'snaps',
    reads: 1,
    text: () =>
      "I want to be out there on Sundays. I'm putting the work in and I'm not getting the snaps. I'd like to know where I stand.",
  },
  {
    when: (f) => f.cause === 'snaps',
    reads: 1,
    text: () => 'I came here to play, not to stand on the sideline. What do I have to do to get on the field?',
  },
  {
    when: (f) => f.cause === 'deal' && f.loud,
    reads: 1,
    text: () => "I've earned a new deal, and everybody in this building knows it. I'm tired of waiting.",
  },
  {
    when: (f) => f.cause === 'deal' && f.calm,
    reads: 1,
    text: () => "I've earned a new deal. I'd like us to talk about it before it turns into a distraction.",
  },
  {
    when: (f) => f.cause === 'deal',
    reads: 1,
    text: () => "I've earned a new deal. I look at what guys at my spot are getting, and I'm not close.",
  },
  {
    when: (f) => f.cause === 'deal',
    reads: 1,
    text: () => 'I want to be here. I need my contract to say you want me here too.',
  },
  {
    when: (f) => f.cause === 'losing' && f.loud,
    reads: 1,
    text: () => "I didn't sign up to lose. Something has to change, and soon.",
  },
  {
    when: (f) => f.cause === 'losing' && f.calm,
    reads: 1,
    text: () => "The losing is getting to me. I'd like to know we're building something.",
  },
  {
    when: (f) => f.cause === 'losing',
    reads: 1,
    text: () => "I hate losing, and we're doing a lot of it. Where is this going?",
  },
  {
    when: (f) => f.cause === 'feud' && f.loud,
    reads: 1,
    text: () => "I can't keep sharing a room with him. Either it gets handled or I'll handle it.",
  },
  {
    when: (f) => f.cause === 'feud' && f.calm,
    reads: 1,
    text: () => "Things aren't right between me and one of the guys in my room. I thought you should hear it from me.",
  },
  {
    when: (f) => f.cause === 'feud',
    reads: 1,
    text: () => "There's a problem in my room, and it isn't going away on its own.",
  },
  {
    when: (f) => f.cause === 'snaps' && f.veteran,
    reads: 1,
    text: () => "I've been doing this a long time. I know I can still help this team, if you'll let me.",
  },
  {
    when: (f) => f.cause === 'snaps' && f.young,
    reads: 1,
    text: () => "I know I'm young, but I'm ready. All I'm asking for is a real shot.",
  },
  {
    when: (f) => f.cause === 'snaps' && f.record === 'winning',
    reads: 1,
    text: () => "We're winning, and I want to be part of it, not watching it from the sideline.",
  },
  {
    when: (f) => f.cause === 'snaps' && f.record === 'losing',
    reads: 1,
    text: () => "We're losing anyway. Why not find out what I can do out there?",
  },
  {
    when: (f) => f.cause === 'deal' && f.finalYear && f.veteran,
    reads: 1,
    text: () =>
      "I've given this club a lot of years. I'm in the last one of my deal, and I'd like to know I'm in your plans.",
  },
  {
    when: (f) => f.cause === 'deal' && f.finalYear,
    reads: 1,
    text: () => "This is the last year of my deal, and nobody has called my agent. I've earned a new one.",
  },
  {
    when: (f) => f.cause === 'deal' && f.veteran,
    reads: 1,
    text: () => "I've been around long enough to know what I'm worth. I've earned a new deal.",
  },
  {
    when: (f) => f.cause === 'deal' && f.young,
    reads: 1,
    text: () => "I'm not asking for the moon. I want my contract to match what I'm doing on the field.",
  },
  {
    when: (f) => f.cause === 'deal' && f.starter,
    reads: 1,
    text: () => "I start for this team every week. My contract doesn't look like it.",
  },
  {
    when: (f) => f.cause === 'deal' && f.record === 'winning',
    reads: 1,
    text: () => "We're winning, and I'm a big part of why. I'd like my deal to say so.",
  },
  {
    when: (f) => f.cause === 'deal' && f.record === 'losing',
    reads: 1,
    text: () => "I've kept playing hard through all this losing. I think I've earned a new deal.",
  },
  {
    when: (f) => f.cause === 'losing' && f.veteran,
    reads: 1,
    text: () => "I don't have that many seasons left. I don't want to spend them losing.",
  },
  {
    when: (f) => f.cause === 'losing' && f.young,
    reads: 1,
    text: () => "I came here to learn how to win. Right now we're learning how to lose.",
  },
  {
    when: (f) => f.cause === 'losing' && f.finalYear,
    reads: 1,
    text: () => 'My deal is up after this year. Losing like this makes it hard to picture staying.',
  },
  {
    when: (f) => f.cause === 'feud' && f.veteran,
    reads: 1,
    text: () => "I've been in a lot of locker rooms. This one has a problem, and I'm in the middle of it.",
  },
  {
    when: (f) => f.cause === 'feud' && f.young,
    reads: 1,
    text: () => "I don't want to cause trouble, but something has to give in my room.",
  },
  { text: () => "I need a word. Something isn't right, and I'd rather say so than sit on it." },
];

/** How he signs off: a second sentence, so two letters about the same thing still read differently. */
export const TALK_CLOSE: readonly Line<LetterFact>[] = [
  { when: (f) => f.loud, text: () => "I'd like an answer soon." },
  { when: (f) => f.loud, text: () => "Don't leave me hanging on this." },
  { when: (f) => f.loud, text: () => "I'm done keeping quiet about it." },
  { when: (f) => f.calm, text: () => 'Whenever you have a minute.' },
  { when: (f) => f.calm, text: () => 'No rush. I just wanted it said.' },
  { when: (f) => f.veteran, text: () => "I think I've earned that much." },
  { when: (f) => f.young, text: () => 'Thanks for hearing me out.' },
  { text: () => 'Let me know where you stand.' },
  { text: () => "I'd appreciate a straight answer." },
  { text: () => "I'm around if you want to talk." },
  { text: () => 'I wanted you to hear it from me first.' },
];

export interface AnswerFact {
  cause: TalkCause;
  reply: TalkReply | 'ignored';
  loud: boolean;
  calm: boolean;
}

export const TALK_ANSWER: readonly Line<AnswerFact>[] = [
  {
    when: (f) => f.reply === 'promise' && f.cause === 'snaps',
    reads: 2,
    text: () => "Four games. I'll hold you to that.",
  },
  {
    when: (f) => f.reply === 'promise' && f.cause === 'snaps',
    reads: 2,
    text: () => "Alright. Four games, and I'll be watching the snap count.",
  },
  {
    when: (f) => f.reply === 'promise' && f.cause === 'deal',
    reads: 2,
    text: () => "Then let's get it done by the re-sign window. I'll take you at your word.",
  },
  {
    when: (f) => f.reply === 'promise' && f.cause === 'deal',
    reads: 2,
    text: () => "Good. I'll tell my agent to expect a call.",
  },
  {
    when: (f) => f.reply === 'reassure' && f.loud,
    reads: 2,
    text: () => 'I appreciate it. Words are nice, though.',
  },
  { when: (f) => f.reply === 'reassure', text: () => "Good to hear. I'll keep working." },
  { when: (f) => f.reply === 'reassure', text: () => 'Thanks. That means something.' },
  { when: (f) => f.reply === 'firm' && f.calm, reads: 2, text: () => "Fair enough. I'll earn it." },
  {
    when: (f) => f.reply === 'firm' && f.loud,
    reads: 2,
    text: () => "Got it. Don't expect me to like it.",
  },
  { when: (f) => f.reply === 'firm', text: () => "If that's how it is, that's how it is." },
  { when: (f) => f.reply === 'firm', text: () => 'Understood. I heard you.' },
  { when: (f) => f.reply === 'ignored', text: () => 'No answer is an answer, I guess.' },
  {
    when: (f) => f.reply === 'ignored',
    reads: 1,
    text: () => "I asked a straight question. I'll take the silence as a no.",
  },
  { text: () => 'Alright. We talked.' },
];

const TWO_TO_NINE = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine'];

/** A step's letters gathered into one message: its subject and the line above the rows. */
export const TALK_GROUP_SUBJECT: readonly Line<{ n: number }>[] = [
  { text: (f) => `${TWO_TO_NINE[f.n] ?? 'Some'} players want a word` },
];

export const TALK_GROUP_LEAD: readonly Line<{ n: number }>[] = [
  {
    text: (f) =>
      `${TWO_TO_NINE[f.n] ?? 'Some'} of your players asked for a word this week. Each one is below, with his own answer.`,
  },
];
