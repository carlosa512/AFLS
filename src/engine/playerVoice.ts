/**
 * A player's own words when he speaks up (`talkMail.ts`, G3). Short and direct, the way a player talks to his GM: an
 * outspoken man (`loud`) says it sharper, a calm one (`calm`) plainer. His ask in his terms, never a number about his
 * mood; nothing here is a trait or a marble.
 */
import type { TalkCause, TalkReply } from './types';
import type { ManSheet, MomentSheet } from './castSheet';
import { say, type Line } from './voice';

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

// ───────── asks, written from the cast sheet ─────────
//
// An ask is four slots (history, core, one color, close), each chosen by `say` from what the sheet holds, so two men
// with the same grievance rarely say the same thing. The sheet carries words and booleans only (`castSheet.ts`), so a
// line can't leak a number or a trait; every line is conditioned on the facts it states.

export interface AskFact {
  man: ManSheet;
  moment: MomentSheet;
  cause: TalkCause;
}

const veteranOf = (f: AskFact) => /veteran/.test(f.man.years);
const youngOf = (f: AskFact) => /rookie|year man/.test(f.man.years);

/** What you told him last time, or that you never kept or never meant it. Only a man who has been here before. */
export const ASK_HISTORY: readonly Line<AskFact>[] = [
  {
    when: (f) => f.man.broken,
    reads: 2,
    text: () => "You've broken your word to me once already.",
  },
  {
    when: (f) => f.man.broken,
    reads: 2,
    text: () => 'I took you at your word before, and it did not hold.',
  },
  {
    when: (f) => f.man.lastAnswer?.reply === 'promise',
    reads: 2,
    text: (f) => `You made me a promise ${f.man.lastAnswer!.when}, and I'm still waiting on it.`,
  },
  {
    when: (f) => f.man.lastAnswer?.reply === 'promise',
    reads: 2,
    text: (f) => `You told me ${f.man.lastAnswer!.when} you would make it right.`,
  },
  {
    when: (f) => f.man.lastAnswer?.reply === 'reassure',
    reads: 2,
    text: (f) => `You told me ${f.man.lastAnswer!.when} that it would be fine. It isn't yet.`,
  },
  {
    when: (f) => f.man.lastAnswer?.reply === 'reassure',
    reads: 2,
    text: (f) => `${cap(f.man.lastAnswer!.when)} you said to be patient. I have been.`,
  },
  {
    when: (f) => f.man.lastAnswer?.reply === 'firm',
    reads: 2,
    text: (f) => `You were firm with me ${f.man.lastAnswer!.when}, and I took it. Nothing has changed.`,
  },
  {
    when: (f) => f.man.lastAnswer?.reply === 'firm',
    reads: 2,
    text: (f) => `You gave it to me straight ${f.man.lastAnswer!.when}. I'm coming back anyway.`,
  },
  {
    when: (f) => f.man.lastAnswer?.reply === 'ignored',
    reads: 2,
    text: (f) => `I wrote to you ${f.man.lastAnswer!.when} and never heard back.`,
  },
  {
    when: (f) => f.man.lastAnswer?.reply === 'ignored',
    reads: 2,
    text: (f) => `I came to you ${f.man.lastAnswer!.when} and got silence.`,
  },
  {
    when: (f) => f.man.kept && !f.man.broken,
    reads: 1,
    text: () => 'You kept your word to me before, and I have not forgotten that.',
  },
  {
    when: (f) => f.man.asks === 'again',
    reads: 1,
    text: () => "This isn't the first time I've had to bring this up.",
  },
  {
    when: (f) => f.man.asks === 'second',
    reads: 1,
    text: () => "I'm back, because this is the second time I've had to say it.",
  },
];

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** The grievance itself. Plain lines read only the cause; the rest also read what the sheet knows about him. */
export const ASK_CORE: readonly Line<AskFact>[] = [
  // snaps
  {
    when: (f) => f.cause === 'snaps',
    reads: 1,
    text: () => "I want to play more, and I'd like to know what is standing in my way.",
  },
  {
    when: (f) => f.cause === 'snaps',
    reads: 1,
    text: () => "I'm not getting on the field enough. I'd like a straight answer on why.",
  },
  { when: (f) => f.cause === 'snaps', reads: 1, text: () => "I've put in the work and I'm still on the sideline." },
  { when: (f) => f.cause === 'snaps', reads: 1, text: () => 'I need to know where I stand with the coaches.' },
  { when: (f) => f.cause === 'snaps', reads: 1, text: () => "I don't feel like I'm part of the plan on Sundays." },
  {
    when: (f) => f.cause === 'snaps' && f.man.loud,
    reads: 2,
    text: () => "I didn't come here to hold a clipboard. Put me on the field.",
  },
  {
    when: (f) => f.cause === 'snaps' && f.man.calm,
    reads: 2,
    text: () => "I'm not one to complain, but I think I should be playing more.",
  },
  {
    when: (f) => f.cause === 'snaps' && f.man.role === 'depth',
    reads: 2,
    text: () => "I know I'm down the depth chart. I don't think that's where I belong.",
  },
  {
    when: (f) => f.cause === 'snaps' && f.man.role === 'rotation',
    reads: 2,
    text: () => "I'm in the rotation, and I think I'm worth more than that.",
  },
  {
    when: (f) => f.cause === 'snaps' && veteranOf(f),
    reads: 2,
    text: () => "I've been around a while, and I know what I can still do.",
  },
  {
    when: (f) => f.cause === 'snaps' && youngOf(f),
    reads: 2,
    text: () => "I'm young, and I need to play to get better.",
  },
  {
    when: (f) => f.cause === 'snaps' && f.man.backFromInjury,
    reads: 2,
    text: () => "I'm healthy again, and I want my spot back.",
  },
  {
    when: (f) => f.cause === 'snaps' && f.man.draftedHere,
    reads: 2,
    text: () => 'You drafted me to play, not to watch.',
  },
  {
    when: (f) => f.cause === 'snaps' && f.moment.record === 'losing',
    reads: 2,
    text: () => "We aren't winning with this lineup. Give me a look.",
  },
  // deal
  { when: (f) => f.cause === 'deal', reads: 1, text: () => 'I want to talk about my contract.' },
  { when: (f) => f.cause === 'deal', reads: 1, text: () => "My deal doesn't match what I do for this team." },
  { when: (f) => f.cause === 'deal', reads: 1, text: () => 'I want to be here, and I need the contract to say so.' },
  { when: (f) => f.cause === 'deal', reads: 1, text: () => "I think it's time we talked money." },
  { when: (f) => f.cause === 'deal', reads: 1, text: () => "I'm not asking for a favor. I'm asking for what's fair." },
  {
    when: (f) => f.cause === 'deal' && f.man.loud,
    reads: 2,
    text: () => 'Pay me. I have earned it and everybody in this building knows it.',
  },
  {
    when: (f) => f.cause === 'deal' && f.man.calm,
    reads: 2,
    text: () => "I'd rather do this quietly. I think my contract is behind.",
  },
  {
    when: (f) => f.cause === 'deal' && f.man.role === 'starter',
    reads: 2,
    text: () => 'I start for you. My deal should say that.',
  },
  {
    when: (f) => f.cause === 'deal' && veteranOf(f),
    reads: 2,
    text: () => "I've been in this league long enough to know my worth.",
  },
  {
    when: (f) => f.cause === 'deal' && youngOf(f),
    reads: 2,
    text: () => "I'm not asking for the moon. I want my deal to match what I do.",
  },
  {
    when: (f) => f.cause === 'deal' && f.moment.record === 'winning',
    reads: 2,
    text: () => "We're winning, and I'm part of why. I'd like my deal to say so.",
  },
  {
    when: (f) => f.cause === 'deal' && f.man.draftedHere,
    reads: 2,
    text: () => "You drafted me. I'd like to be here a long time, on paper too.",
  },
  // losing
  { when: (f) => f.cause === 'losing', reads: 1, text: () => "I'm tired of losing." },
  { when: (f) => f.cause === 'losing', reads: 1, text: () => 'I need to know we are headed somewhere.' },
  { when: (f) => f.cause === 'losing', reads: 1, text: () => "I don't know how much more of this I can take." },
  { when: (f) => f.cause === 'losing', reads: 1, text: () => 'Losing wears on a man. It is wearing on me.' },
  {
    when: (f) => f.cause === 'losing',
    reads: 1,
    text: () => 'I came here to win games, and that is not what is happening.',
  },
  {
    when: (f) => f.cause === 'losing' && f.man.loud,
    reads: 2,
    text: () => 'This is not acceptable, and the whole room knows it. Fix it.',
  },
  {
    when: (f) => f.cause === 'losing' && f.man.calm,
    reads: 2,
    text: () => "I'm not one to raise my voice, but this losing has to stop.",
  },
  {
    when: (f) => f.cause === 'losing' && f.moment.streak?.kind === 'lost',
    reads: 2,
    text: (f) => `We've lost ${f.moment.streak!.games} in a row. I need to hear a plan.`,
  },
  {
    when: (f) => f.cause === 'losing' && f.moment.record === 'losing',
    reads: 2,
    text: () => "Look at the standings. We aren't good enough yet.",
  },
  { when: (f) => f.cause === 'losing' && youngOf(f), reads: 2, text: () => 'I came up to learn how to win.' },
  {
    when: (f) => f.cause === 'losing' && veteranOf(f),
    reads: 2,
    text: () => "I don't have unlimited seasons, and I'd like to spend them winning.",
  },
  {
    when: (f) => f.cause === 'losing' && f.moment.seasonOver,
    reads: 2,
    text: () => "The season is gone, and I don't want to start the next one like this.",
  },
  // feud
  {
    when: (f) => f.cause === 'feud',
    reads: 1,
    text: () => "There's a problem in my room, and I'd rather you heard it from me.",
  },
  { when: (f) => f.cause === 'feud', reads: 1, text: () => "I can't keep ignoring what's going on in my room." },
  { when: (f) => f.cause === 'feud', reads: 1, text: () => 'Something has to be done about my room.' },
  { when: (f) => f.cause === 'feud', reads: 1, text: () => "It isn't about football. It's about the guys around me." },
  {
    when: (f) => f.cause === 'feud',
    reads: 1,
    text: () => "I'm trying to stay out of it, but it follows me in every day.",
  },
  { when: (f) => f.cause === 'feud' && f.man.loud, reads: 2, text: () => "I'm about done being patient with it." },
  {
    when: (f) => f.cause === 'feud' && f.man.calm,
    reads: 2,
    text: () => "I'd rather keep the peace, but I'm running out of ways to.",
  },
  {
    when: (f) => f.cause === 'feud' && !!f.man.feud,
    reads: 2,
    text: (f) => `${f.man.feud!.with} and I can't get on the same page.`,
  },
  {
    when: (f) => f.cause === 'feud' && f.man.captain,
    reads: 2,
    text: () => "I'm a captain. I'm supposed to hold this room together, and I can't right now.",
  },
  {
    when: (f) => f.cause === 'feud' && veteranOf(f),
    reads: 2,
    text: () => "I've seen rooms go bad before. This one is heading there.",
  },
];

/** One more thing about him, at most one a letter: whatever the sheet knows that the grievance doesn't say. */
export const ASK_COLOR: readonly Line<AskFact>[] = [
  { when: (f) => f.man.lean === 'money', reads: 1, text: () => "I'll be honest, money matters to me too." },
  { when: (f) => f.man.lean === 'winning', reads: 1, text: () => 'Winning is what I play for. It always has been.' },
  {
    when: (f) => f.man.lean === 'loyal',
    reads: 1,
    text: () => "I'd like to stay here. This place means something to me.",
  },
  { when: (f) => f.man.tier === 'leader', reads: 1, text: () => "The guys look to me, so I can't just let it slide." },
  {
    when: (f) => f.man.tier === 'voice',
    reads: 1,
    text: () => 'People in the room listen to me, and I owe them an honest word.',
  },
  {
    when: (f) => f.man.sound === 'stirs',
    reads: 1,
    text: () => "I know I stir a room up when I'm angry, so I'm telling you before it spreads.",
  },
  {
    when: (f) => f.man.sound === 'steadies',
    reads: 1,
    text: () => "I'm usually the one calming the room down, and I'm running low on that.",
  },
  {
    when: (f) => !!f.man.habit,
    reads: 1,
    text: () => "I know what the film says about how I play. That isn't what this is about.",
  },
  { when: (f) => f.man.finalYear, reads: 1, text: () => 'My deal is up after this year, so I have to ask now.' },
  {
    when: (f) => f.man.underpaid,
    reads: 1,
    text: () => "I look at what the market pays a man at my spot, and I'm below it.",
  },
  {
    when: (f) => f.man.captain,
    reads: 1,
    text: () => "As a captain, I hear what the room says, and I'm passing it on.",
  },
  { when: (f) => f.man.homecoming, reads: 1, text: () => 'We play the club I came up with, and that has me thinking.' },
  {
    when: (f) => f.man.grudgeGame,
    reads: 1,
    text: () => 'We face a club that let me go, and I have not forgotten it.',
  },
  {
    when: (f) => f.man.feud !== null && f.cause !== 'feud',
    reads: 1,
    text: (f) => `Things with ${f.man.feud!.with} haven't made it easier.`,
  },
  {
    when: (f) => f.man.mentor !== null,
    reads: 1,
    text: (f) => `${f.man.mentor} has been showing me the ropes, so I'm not saying this lightly.`,
  },
  {
    when: (f) => f.man.mentee !== null,
    reads: 1,
    text: (f) => `${f.man.mentee} looks up to me, and I can't ask him to stay quiet when I won't.`,
  },
  { when: (f) => f.man.friends.length > 0, reads: 1, text: (f) => `${f.man.friends[0]} sees it the same way I do.` },
  {
    when: (f) => f.man.backFromInjury,
    reads: 1,
    text: () => 'I fought my way back from an injury, and I want it to count for something.',
  },
  {
    when: (f) => f.man.rookieDeal,
    reads: 1,
    text: () => "I'm still on my first deal, and I know how little say that gives me.",
  },
  {
    when: (f) => f.man.draftedHere,
    reads: 1,
    text: () => "This is the club that drafted me. I'd rather work it out here.",
  },
  { when: (f) => f.man.dispute, reads: 1, text: () => "This is on top of everything else I've told you." },
  {
    when: (f) => f.moment.streak?.kind === 'won',
    reads: 1,
    text: () => "Don't read this as a complaint about the team. It's about me.",
  },
  {
    when: (f) => f.moment.week === 'deadline',
    reads: 1,
    text: () => "With the deadline here, I'd rather you hear it now.",
  },
  { when: (f) => f.moment.week === 'camp', reads: 1, text: () => "I'd rather say it at camp than let it sit." },
  {
    when: (f) => f.moment.week === 'playoffs',
    reads: 1,
    text: () => "I didn't want to bring it up in the playoffs, but I can't hold it.",
  },
  {
    when: (f) => f.moment.rival,
    reads: 1,
    text: () => "We play a division rival next, and I'd rather clear my head first.",
  },
];

/** How he signs off. */
export const ASK_CLOSE: readonly Line<AskFact>[] = [
  { when: (f) => f.man.loud, reads: 1, text: () => "I'd like an answer soon." },
  { when: (f) => f.man.loud, reads: 1, text: () => "Don't leave me hanging on this." },
  { when: (f) => f.man.loud, reads: 1, text: () => "I'm done keeping quiet about it." },
  { when: (f) => f.man.calm, reads: 1, text: () => 'Whenever you have a minute.' },
  { when: (f) => f.man.calm, reads: 1, text: () => 'No rush. I just wanted it said.' },
  { when: (f) => f.man.calm, reads: 1, text: () => "I'll be here when you're ready." },
  { when: (f) => veteranOf(f), reads: 1, text: () => "I think I've earned that much." },
  { when: (f) => youngOf(f), reads: 1, text: () => 'Thanks for hearing me out.' },
  { when: (f) => f.man.asks !== 'first', reads: 1, text: () => "I'd like an answer this time." },
  { when: (f) => f.man.asks !== 'first', reads: 1, text: () => "I'm asking you to follow through." },
  { text: () => 'Let me know where you stand.' },
  { text: () => "I'd appreciate a straight answer." },
  { text: () => "I'm around if you want to talk." },
  { text: () => 'I wanted you to hear it from me first.' },
];

/**
 * His whole ask: history (when he's been here before), the grievance, at most one more thing about him, and a close.
 * Every sentence it uses goes onto `recent`, so the next man in the same letter can't say it.
 */
export function askWords(f: AskFact, at: { key: string; recent: string[] }): string {
  const out: string[] = [];
  const slot = (bank: readonly Line<AskFact>[], name: string) => {
    // Lines already said are set aside first, so a narrow fit never falls back on a sentence the letter already holds;
    // only when every line that fits has been said does one come round again.
    const fits = bank.filter((l) => !l.when || l.when(f));
    const unused = fits.filter((l) => !at.recent.some((b) => b.includes(l.text(f))));
    const s = say(unused.length ? unused : fits, f, { key: at.key, slot: name, recent: at.recent });
    if (s) out.push(s);
  };
  if (f.man.asks !== 'first' || f.man.kept || f.man.broken) slot(ASK_HISTORY, 'history');
  slot(ASK_CORE, 'core');
  slot(ASK_COLOR, 'color');
  slot(ASK_CLOSE, 'close');
  at.recent.push(...out);
  return out.join(' ');
}
