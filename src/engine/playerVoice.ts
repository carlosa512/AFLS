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
}

export const TALK_SUBJECT: Record<TalkCause, string> = {
  snaps: 'About my snaps',
  deal: 'About my contract',
  losing: 'About the losing',
  feud: 'About the room',
};

export const TALK_LETTER: readonly Line<LetterFact>[] = [
  {
    when: (f) => f.cause === 'snaps' && f.loud,
    reads: 2,
    text: () => "I'm not going to pretend I'm fine. I want to be out there on Sundays, and right now I'm watching.",
  },
  {
    when: (f) => f.cause === 'snaps' && f.calm,
    reads: 2,
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
    reads: 2,
    text: () => "I've earned a new deal, and everybody in this building knows it. I'm tired of waiting.",
  },
  {
    when: (f) => f.cause === 'deal' && f.calm,
    reads: 2,
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
    reads: 2,
    text: () => "I didn't sign up to lose. Something has to change, and soon.",
  },
  {
    when: (f) => f.cause === 'losing' && f.calm,
    reads: 2,
    text: () => "The losing is getting to me. I'd like to know we're building something.",
  },
  {
    when: (f) => f.cause === 'losing',
    reads: 1,
    text: () => "I hate losing, and we're doing a lot of it. Where is this going?",
  },
  {
    when: (f) => f.cause === 'feud' && f.loud,
    reads: 2,
    text: () => "I can't keep sharing a room with him. Either it gets handled or I'll handle it.",
  },
  {
    when: (f) => f.cause === 'feud' && f.calm,
    reads: 2,
    text: () => "Things aren't right between me and one of the guys in my room. I thought you should hear it from me.",
  },
  {
    when: (f) => f.cause === 'feud',
    reads: 1,
    text: () => "There's a problem in my room, and it isn't going away on its own.",
  },
  { text: () => "I need a word. Something isn't right, and I'd rather say so than sit on it." },
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
  { when: (f) => f.reply === 'reassure', reads: 1, text: () => "Good to hear. I'll keep working." },
  { when: (f) => f.reply === 'reassure', reads: 1, text: () => 'Thanks. That means something.' },
  { when: (f) => f.reply === 'firm' && f.calm, reads: 2, text: () => "Fair enough. I'll earn it." },
  {
    when: (f) => f.reply === 'firm' && f.loud,
    reads: 2,
    text: () => "Got it. Don't expect me to like it.",
  },
  { when: (f) => f.reply === 'firm', reads: 1, text: () => "If that's how it is, that's how it is." },
  { when: (f) => f.reply === 'firm', reads: 1, text: () => 'Understood. I heard you.' },
  { when: (f) => f.reply === 'ignored', reads: 1, text: () => 'No answer is an answer, I guess.' },
  {
    when: (f) => f.reply === 'ignored',
    reads: 1,
    text: () => "I asked a straight question. I'll take the silence as a no.",
  },
  { text: () => 'Alright. We talked.' },
];
