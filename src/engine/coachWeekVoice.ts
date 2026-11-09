/**
 * The head coach's weekly letter in his own words (docs/superpowers/specs/2026-11-09-storylines-design.md, section 3):
 * the headline of a story, how the week ties together, what came before with a man, a man's story feeding his room,
 * a clock running down, a story closing, an ask still open, the meeting set, and how a meeting went from where each
 * man is now. Banks read through `say`: the most specific line that fits wins, and every line is true to the facts its
 * `when` reads. An NFL head coach writing to his GM: short, flat, direct, dry, never chatty. No numerals, no engine
 * words, nothing about ratings, and no line says a meeting fixed anything. Types only from the cast sheet, so this
 * file stays a leaf.
 */
import type { CoachSheet, ManSheet, MomentSheet } from './castSheet';
import { verb } from './meetings/voice';
import { CAUSE_OF } from './playerTalks';
import type { UnitWord } from './standing';
import type { Backing, BeatKind, MeetingScope, MeetingTopic, StoryKind, TalkCause, Timing } from './types';
import type { Line } from './voice';

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const poss = (name: string) => `${name}'s`;
/** "the D-line is", "the receivers are". */
const isOf = (noun: string) => verb(noun, 'is', 'are');
const wasOf = (noun: string) => verb(noun, 'was', 'were');

const WORDS = [
  'zero',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'eleven',
  'twelve',
  'thirteen',
  'fourteen',
  'fifteen',
  'sixteen',
  'seventeen',
  'eighteen',
  'nineteen',
  'twenty',
  'twenty-one',
  'twenty-two',
];
/** The cast sheet's "in week 8" as the coach says it: no numeral in a letter. */
const whenOf = (when: string) => when.replace(/week (\d+)/, (_, n) => `week ${WORDS[Number(n)] ?? 'later'}`);

/** What a man's grievance is about, in the coach's words. */
const THING: Record<TalkCause, string> = {
  deal: 'his deal',
  snaps: 'his snaps',
  losing: 'the losing',
  feud: 'the feud',
};
/** The grievance behind his top mood reason, when it is one of the four he can ask about. */
const causeOf = (man: ManSheet): TalkCause | null => (man.reason ? (CAUSE_OF[man.reason] ?? null) : null);
const FLOOR = new Set(['Poor', 'Very poor', 'Abysmal']);
/** He reads Poor or worse now. */
export const readsDown = (man: ManSheet): boolean => !!man.mood && FLOOR.has(man.mood);

// ───────── the headline: a story and its newest beat, in a few words ─────────

export interface StoryFact {
  kind: StoryKind;
  beat: BeatKind;
  /** The beat's short reason or reply (a room's word, a dispute's kind). */
  how?: string;
  man?: ManSheet;
  /** A feud's other man, by last name. */
  mate?: string;
  /** A room as the coach names it: "the D-line". */
  noun?: string;
  /** A coach, by last name. */
  coach?: string;
}

const MAN_KINDS: readonly StoryKind[] = ['deal', 'snaps', 'benched', 'losing'];
const isMan = (f: StoryFact) => MAN_KINDS.includes(f.kind) && !!f.man;
const on = (kind: StoryKind, beat: BeatKind, text: (f: StoryFact) => string): Line<StoryFact> => ({
  when: (f) => f.kind === kind && f.beat === beat && (kind === 'room' || kind === 'staff' || !!f.man),
  reads: 2,
  text,
});
const last = (f: StoryFact) => f.man!.last;
const room = (f: StoryFact) => f.noun ?? 'the room';
const coachOf = (f: StoryFact) => f.coach ?? 'The coach';

export const HEADLINE: readonly Line<StoryFact>[] = [
  on('deal', 'asked', (f) => `${poss(last(f))} deal`),
  on('deal', 'answered', (f) => `${poss(last(f))} deal: your answer`),
  on('deal', 'promised', (f) => `${poss(last(f))} deal: your word`),
  on('deal', 'commitment', (f) => `${poss(last(f))} deal: the talks`),
  on('deal', 'kept', (f) => `${poss(last(f))} deal: kept`),
  on('deal', 'broken', (f) => `${poss(last(f))} deal: broken`),
  on('deal', 'settled', (f) => `${last(f)} signed`),
  on('snaps', 'asked', (f) => `${poss(last(f))} snaps`),
  on('snaps', 'answered', (f) => `${poss(last(f))} snaps: your answer`),
  on('snaps', 'promised', (f) => `${poss(last(f))} snaps: your word`),
  on('snaps', 'commitment', (f) => `${poss(last(f))} snaps: the plan`),
  on('snaps', 'kept', (f) => `${last(f)} got his snaps`),
  on('snaps', 'broken', (f) => `${poss(last(f))} snaps: broken`),
  on('snaps', 'swapped', (f) => `${poss(last(f))} job`),
  on('benched', 'sat', (f) => `${last(f)} benched`),
  on('benched', 'satAgain', (f) => `${last(f)} sits again`),
  on('benched', 'backIn', (f) => `${last(f)} is back in`),
  on('benched', 'swapped', (f) => `${poss(last(f))} job`),
  on('benched', 'asked', (f) => `Am I benched? ${last(f)} wants to know`),
  on('losing', 'asked', (f) => `${last(f)} on the losing`),
  on('losing', 'answered', (f) => `${last(f)} on the losing: your answer`),
  on('losing', 'lifted', (f) => `${last(f)} is past the losing`),
  // A dispute is the man's, whichever of his stories it landed on.
  {
    when: (f) => isMan(f) && f.beat === 'dispute' && f.how === 'holdIn',
    reads: 3,
    text: (f) => `${last(f)} is holding in`,
  },
  {
    when: (f) => isMan(f) && f.beat === 'dispute' && f.how === 'holdOut',
    reads: 3,
    text: (f) => `${last(f)} is holding out`,
  },
  {
    when: (f) => isMan(f) && f.beat === 'dispute' && f.how === 'trade',
    reads: 3,
    text: (f) => `${last(f)} wants out`,
  },
  { when: (f) => isMan(f) && f.beat === 'leaked', reads: 2, text: (f) => `${poss(last(f))} request is out` },
  { when: (f) => isMan(f) && f.beat === 'disputeEnd', reads: 2, text: (f) => `${poss(last(f))} dispute is over` },
  { when: (f) => isMan(f) && f.beat === 'left', reads: 2, text: (f) => `${last(f)} is gone` },
  on('feud', 'started', (f) => `${last(f)} and ${f.mate ?? 'a teammate'}`),
  on('feud', 'asked', (f) => `${last(f)} and ${f.mate ?? 'a teammate'}: the feud`),
  on('feud', 'ended', (f) => `${last(f)} and ${f.mate ?? 'a teammate'}: over`),
  on('feud', 'left', (f) => `${last(f)} and ${f.mate ?? 'a teammate'}: one is gone`),
  on('room', 'turned', (f) => cap(room(f))),
  on('room', 'eased', (f) => `${cap(room(f))}: easing`),
  on('room', 'recovered', (f) => `${cap(room(f))} ${isOf(room(f))} back`),
  on('room', 'suggested', (f) => `A word with ${room(f)}`),
  on('room', 'held', (f) => `${cap(room(f))}: we met`),
  on('room', 'passed', (f) => `${cap(room(f))}: not now`),
  on('room', 'commitment', (f) => `${cap(room(f))}: what we told them`),
  on('room', 'kept', (f) => `${cap(room(f))}: we kept our word`),
  on('room', 'broken', (f) => `${cap(room(f))}: our word broke`),
  on('room', 'ended', (f) => `${cap(room(f))}: quiet now`),
  { when: (f) => f.kind === 'staff' && f.beat === 'worn', reads: 3, text: () => 'My word with the players' },
  {
    when: (f) => f.kind === 'staff' && f.beat === 'doubt' && f.how === 'lost',
    reads: 3,
    text: (f) => `${coachOf(f)} has lost the room`,
  },
  on('staff', 'doubt', (f) => `${coachOf(f)}: the room doubts him`),
  on('staff', 'warned', (f) => `${coachOf(f)}: a warning`),
  on('staff', 'notice', (f) => `${coachOf(f)}: on notice`),
  on('staff', 'stood', (f) => `${coachOf(f)}: we stood behind him`),
  on('staff', 'recovered', (f) => `${coachOf(f)} has the room back`),
  on('staff', 'relieved', (f) => `${coachOf(f)} relieved`),
  on('staff', 'left', (f) => `${coachOf(f)} has left`),
  // The plainest thing that names the subject, for a beat no line above knows.
  { when: (f) => isMan(f), reads: 1, text: (f) => `${poss(last(f))} ${f.kind === 'deal' ? 'deal' : 'situation'}` },
  { when: (f) => f.kind === 'feud' && !!f.man, reads: 1, text: (f) => `${last(f)} and ${f.mate ?? 'a teammate'}` },
  { when: (f) => f.kind === 'room', reads: 1, text: (f) => cap(room(f)) },
  { when: (f) => f.kind === 'staff', reads: 1, text: (f) => `${coachOf(f)} and the staff` },
  { text: () => 'This week' },
];

// ───────── the opening: the week tied together ─────────

export interface OpeningFact {
  moment: MomentSheet;
  coach: CoachSheet;
  /** Items the letter tells besides its asks. */
  items: number;
  /** Asks in it that wait on your answer. */
  asks: number;
  /** Two of the week's stories are linked: a room and the man feeding it. */
  link?: { noun: string; man: string; word: 'Down' | 'Split' };
  /** The top story's kind and the man or room it is about. */
  top?: { kind: StoryKind; man?: string; noun?: string };
  /** Last step's meeting is told in this letter. */
  result: boolean;
  /** A story closed this week. */
  closing: boolean;
}

const lowerWord = (w: 'Down' | 'Split') => w.toLowerCase();

export const OPENING: readonly Line<OpeningFact>[] = [
  {
    when: (f) => !!f.link,
    reads: 4,
    text: (f) =>
      `${cap(f.link!.noun)} ${isOf(f.link!.noun)} ${lowerWord(f.link!.word)}, and part of it is ${f.link!.man}.`,
  },
  {
    when: (f) => !!f.link,
    reads: 4,
    text: (f) =>
      `${f.link!.man} is part of why ${f.link!.noun} ${isOf(f.link!.noun)} ${lowerWord(f.link!.word)}. I'd start there.`,
  },
  {
    when: (f) => !!f.link && f.moment.streak?.kind === 'lost',
    reads: 5,
    text: (f) =>
      `We have lost ${f.moment.streak!.games} straight, and ${f.link!.noun} ${isOf(f.link!.noun)} ${lowerWord(f.link!.word)}. Part of the room's trouble is ${f.link!.man}.`,
  },
  {
    when: (f) => f.moment.week === 'deadline' && f.top?.kind === 'deal' && !!f.top.man,
    reads: 3,
    text: (f) => `It's deadline week, and ${poss(f.top!.man!)} deal can't wait.`,
  },
  {
    when: (f) => f.moment.week === 'deadline' && f.asks > 0,
    reads: 2,
    text: () => `Deadline week. Some of this needs an answer from you.`,
  },
  {
    when: (f) => f.moment.week === 'deadline',
    reads: 1,
    text: () => `It's deadline week.`,
  },
  {
    when: (f) => f.moment.seasonOver,
    reads: 2,
    text: () => `The season's over. Before we turn the page, here is where my people are.`,
  },
  {
    when: (f) => f.result && f.moment.streak?.kind === 'lost',
    reads: 3,
    text: (f) => `We have lost ${f.moment.streak!.games} straight. I held the meeting, and here is how it went.`,
  },
  {
    when: (f) => f.result,
    reads: 2,
    text: () => `The meeting is behind us. Here is how it went.`,
  },
  {
    when: (f) => f.result,
    reads: 2,
    text: () => `I held the meeting. Here is how it went.`,
  },
  {
    when: (f) => f.moment.streak?.kind === 'lost',
    reads: 2,
    text: (f) => `We have lost ${f.moment.streak!.games} straight.`,
  },
  {
    when: (f) => f.moment.streak?.kind === 'won',
    reads: 2,
    text: (f) => `We have won ${f.moment.streak!.games} straight.`,
  },
  {
    when: (f) => f.closing && f.items <= 2,
    reads: 2,
    text: () => `Something closed this week.`,
  },
  {
    when: (f) => f.moment.week === 'push',
    reads: 2,
    text: () => `The push is on. Here is where my rooms are.`,
  },
  {
    when: (f) => f.moment.week === 'camp',
    reads: 2,
    text: () => `Camp. Here is where things stand.`,
  },
  {
    when: (f) => f.moment.week === 'bye',
    reads: 2,
    text: () => `It's the bye. Here is where things stand.`,
  },
  {
    when: (f) => f.moment.rival,
    reads: 1,
    text: () => `We play a division rival next.`,
  },
  { when: (f) => f.items + f.asks === 1, reads: 1, text: () => `One thing from me this week.` },
  { when: (f) => f.items + f.asks === 1, reads: 1, text: () => `Short one this week.` },
  { text: () => `Here is where things stand with my people.` },
  { when: (f) => f.items + f.asks >= 2, text: () => `A few things from me this week.` },
  { when: (f) => f.asks > 0 && f.items > 0, text: () => `Some of this needs you, and some is for your information.` },
];

// ───────── what came before with a man ─────────

export interface BeforeFact {
  man: ManSheet;
}

/** The callback: what you told him last time, whether it held, and that he has been here before. */
export const BEFORE: readonly Line<BeforeFact>[] = [
  {
    when: (f) => f.man.broken,
    reads: 3,
    text: () => `You went back on your word to him once already, and he has not forgotten.`,
  },
  {
    when: (f) => f.man.broken,
    reads: 3,
    text: () => `The last promise to him did not hold. He remembers.`,
  },
  {
    when: (f) => f.man.broken,
    reads: 3,
    text: () => `He has a promise on file that we did not keep.`,
  },
  {
    when: (f) => f.man.dispute,
    reads: 3,
    text: () => `He is already in a dispute with us, so this is not a small thing.`,
  },
  {
    when: (f) => f.man.dispute,
    reads: 3,
    text: () => `He is in a dispute with the club right now.`,
  },
  {
    when: (f) => f.man.lastAnswer?.reply === 'promise' && !f.man.kept && !f.man.broken,
    reads: 3,
    text: (f) => `${cap(whenOf(f.man.lastAnswer!.when))} you gave him your word. He is still waiting on it.`,
  },
  {
    when: (f) => f.man.lastAnswer?.reply === 'promise' && !f.man.kept && !f.man.broken,
    reads: 3,
    text: (f) => `You told him ${whenOf(f.man.lastAnswer!.when)} you would make it right. Nothing yet.`,
  },
  {
    when: (f) => f.man.lastAnswer?.reply === 'promise' && f.man.kept && !f.man.broken,
    reads: 4,
    text: () => `You have kept your word to him this year.`,
  },
  {
    when: (f) => f.man.lastAnswer?.reply === 'reassure',
    reads: 3,
    text: (f) => `You told him to be patient ${whenOf(f.man.lastAnswer!.when)}. He is back about it.`,
  },
  {
    when: (f) => f.man.lastAnswer?.reply === 'reassure',
    reads: 3,
    text: (f) => `${cap(whenOf(f.man.lastAnswer!.when))} you told him to hang in there. He is back.`,
  },
  {
    when: (f) => f.man.lastAnswer?.reply === 'firm',
    reads: 3,
    text: (f) => `You told him no ${whenOf(f.man.lastAnswer!.when)}. He is back anyway.`,
  },
  {
    when: (f) => f.man.lastAnswer?.reply === 'firm',
    reads: 3,
    text: (f) => `${cap(whenOf(f.man.lastAnswer!.when))} you turned him down. That did not settle it.`,
  },
  {
    when: (f) => f.man.lastAnswer?.reply === 'ignored',
    reads: 3,
    text: (f) => `He never got an answer ${whenOf(f.man.lastAnswer!.when)}, and he is back.`,
  },
  {
    when: (f) => f.man.kept && !f.man.broken,
    reads: 2,
    text: () => `You kept your word to him before.`,
  },
  {
    when: (f) => f.man.asks === 'again',
    reads: 2,
    text: () => `He has been to me about this more than once now.`,
  },
  {
    when: (f) => f.man.asks === 'second',
    reads: 2,
    text: () => `He has been to me about this before.`,
  },
  {
    when: (f) => f.man.asks === 'second',
    reads: 2,
    text: () => `He has raised it before.`,
  },
  { text: () => `He came to me with it.` },
];

// ───────── a man's story feeds his room ─────────

export interface LinkFact {
  man: ManSheet;
  share: 'part' | 'most';
  kind: StoryKind;
  /** The room as the coach names it. */
  noun: string;
  word: 'Down' | 'Split';
}

const ABOUT: Partial<Record<StoryKind, string>> = {
  deal: 'his deal',
  snaps: 'his snaps',
  benched: 'the benching',
  losing: 'the losing',
  feud: 'the feud',
};
const aboutOf = (f: LinkFact) => ABOUT[f.kind] ?? 'his grievance';

/** The room's row when a man's story feeds it: who, how much of the room, and what it is about. */
export const LINK: readonly Line<LinkFact>[] = [
  {
    when: (f) => f.share === 'most' && f.man.tier === 'leader',
    reads: 3,
    text: (f) =>
      `${f.man.last} leads ${f.noun}, and ${aboutOf(f)} is most of what is wrong in there. They follow his mood.`,
  },
  {
    when: (f) => f.share === 'most',
    reads: 2,
    text: (f) => `${f.man.last} is most of why ${f.noun} ${isOf(f.noun)} ${lowerWord(f.word)}. It is ${aboutOf(f)}.`,
  },
  {
    when: (f) => f.share === 'most',
    reads: 2,
    text: (f) => `${cap(aboutOf(f))} is hurting ${f.noun}, and ${f.man.last} carries more of it than anyone.`,
  },
  {
    when: (f) => f.share === 'part' && f.man.tier === 'voice',
    reads: 3,
    text: (f) => `${f.man.last} is a voice in ${f.noun}, and ${aboutOf(f)} is wearing on the room through him.`,
  },
  {
    when: (f) => f.share === 'part' && f.man.sound === 'stirs',
    reads: 3,
    text: (f) => `${f.man.last} stirs ${f.noun} up, and right now that is ${aboutOf(f)}.`,
  },
  {
    when: (f) => f.share === 'part',
    reads: 2,
    text: (f) => `Part of it is ${f.man.last}. ${cap(aboutOf(f))} is feeding the room.`,
  },
  {
    when: (f) => f.share === 'part',
    reads: 2,
    text: (f) =>
      `${f.man.last} is not all of it, but ${aboutOf(f)} is part of why ${f.noun} ${isOf(f.noun)} ${lowerWord(f.word)}.`,
  },
  { text: (f) => `${f.man.last} is feeding ${f.noun}.` },
];

// ───────── a clock: halfway and due ─────────

export interface ClockFact {
  kind: StoryKind;
  at: 'half' | 'due';
  man?: ManSheet;
  /** The room, for a promise made to it. */
  noun?: string;
}

const clockOn = (kind: StoryKind, at: ClockFact['at'], text: (f: ClockFact) => string): Line<ClockFact> => ({
  when: (f) => f.kind === kind && f.at === at && (kind === 'room' || !!f.man),
  reads: 2,
  text,
});

export const CLOCK: readonly Line<ClockFact>[] = [
  clockOn('deal', 'half', (f) => `We are halfway through the time we gave on ${poss(f.man!.last)} deal.`),
  clockOn('deal', 'half', (f) => `We are halfway on ${poss(f.man!.last)} deal, and nothing has closed it.`),
  clockOn('deal', 'due', (f) => `${poss(f.man!.last)} deal comes due this week.`),
  clockOn('deal', 'due', (f) => `This is the week for ${poss(f.man!.last)} deal.`),
  clockOn('snaps', 'half', (f) => `We are halfway on ${poss(f.man!.last)} snaps.`),
  clockOn('snaps', 'due', (f) => `${poss(f.man!.last)} snaps come due this week. The depth chart is the answer.`),
  clockOn('room', 'half', (f) => `We are halfway on what I told ${f.noun ?? 'the room'}.`),
  clockOn('room', 'half', (f) => `Half the time I gave ${f.noun ?? 'the room'} is gone.`),
  clockOn('room', 'due', (f) => `What I told ${f.noun ?? 'the room'} comes due this week.`),
  clockOn(
    'room',
    'due',
    (f) => `This is the week ${f.noun ?? 'the room'} ${isOf(f.noun ?? 'the room')} owed an answer.`,
  ),
  { when: (f) => f.at === 'half', reads: 1, text: () => `We are halfway on a promise.` },
  { when: (f) => f.at === 'due', reads: 1, text: () => `A promise comes due this week.` },
  { text: () => `A promise is running down.` },
];

// ───────── a story closing ─────────

export interface ClosingFact {
  kind: StoryKind;
  beat: BeatKind;
  man?: ManSheet;
  mate?: string;
  noun?: string;
  coach?: string;
}

const closes = (kind: StoryKind, beat: BeatKind, text: (f: ClosingFact) => string): Line<ClosingFact> => ({
  // A line about a man names him, and one about a coach names him: no line says "He" for nobody.
  when: (f) => f.kind === kind && f.beat === beat && (kind === 'room' || (kind === 'staff' ? !!f.coach : !!f.man)),
  reads: 2,
  text,
});
const who = (f: ClosingFact) => f.man!.last;
const roomOf = (f: ClosingFact) => f.noun ?? 'the room';

export const CLOSING: readonly Line<ClosingFact>[] = [
  closes('deal', 'kept', (f) => `We kept our word on ${poss(who(f))} deal.`),
  closes('deal', 'broken', (f) => `We missed on ${poss(who(f))} deal.`),
  closes('deal', 'settled', (f) => `${who(f)} is signed. That one is closed.`),
  closes('deal', 'left', (f) => `${who(f)} is gone, so his deal is closed.`),
  closes('snaps', 'kept', (f) => `${who(f)} got the snaps we promised.`),
  closes('snaps', 'broken', (f) => `${who(f)} did not get the snaps we promised.`),
  closes('snaps', 'left', (f) => `${who(f)} is gone, and so is the snaps question.`),
  closes('benched', 'backIn', (f) => `${who(f)} is back in, and the benching is behind us.`),
  closes('benched', 'left', (f) => `${who(f)} is gone, so the benching is closed.`),
  closes('losing', 'lifted', (f) => `${who(f)} is past the losing.`),
  closes('losing', 'left', (f) => `${who(f)} is gone, so the losing is no longer his to carry here.`),
  closes('feud', 'ended', (f) => `The feud between ${who(f)} and ${f.mate ?? 'his teammate'} is over.`),
  closes('feud', 'left', (f) => `One of ${who(f)} and ${f.mate ?? 'his teammate'} is gone, and so is the feud.`),
  closes('room', 'recovered', (f) => `${cap(roomOf(f))} ${isOf(roomOf(f))} out of trouble.`),
  closes('room', 'recovered', (f) => `${cap(roomOf(f))} ${isOf(roomOf(f))} steady again. That one is closed.`),
  closes('room', 'ended', (f) => `Nothing is left open on ${roomOf(f)}.`),
  closes('staff', 'recovered', (f) => `${f.coach} has the room back.`),
  closes('staff', 'relieved', (f) => `${f.coach} is out. That one is closed.`),
  closes('staff', 'left', (f) => `${f.coach} has left us.`),
  { text: () => `That one is closed.` },
];

// ───────── an ask still open ─────────

export interface StillFact {
  man: ManSheet;
}

export const STILL_WAITING: readonly Line<StillFact>[] = [
  {
    when: (f) => f.man.dispute,
    reads: 3,
    text: (f) => `${f.man.last} is still waiting on you, and he is already in a dispute with us.`,
  },
  {
    when: (f) => f.man.asks !== 'first',
    reads: 2,
    text: (f) => `${f.man.last} has come to me before. Now he is waiting on you again.`,
  },
  {
    when: (f) => f.man.asks !== 'first',
    reads: 2,
    text: (f) => `This is not the first time for ${f.man.last}, and he still has no answer.`,
  },
  { text: (f) => `${f.man.last} is still waiting on your answer.` },
  { text: (f) => `${f.man.last} asked earlier and has heard nothing from you.` },
  { text: (f) => `Nothing from you to ${f.man.last} yet.` },
];

// ───────── after Go ahead ─────────

export interface SetFact {
  timing: Timing;
  scope: MeetingScope;
  noun: string;
  backing: Backing;
}

const TIMING: Record<Timing, string> = {
  afterGame: 'after the game',
  monday: 'Monday, in film',
  wednesday: 'Wednesday, before practice',
};

export const SET_FOR: readonly Line<SetFact>[] = [
  { when: (f) => f.timing === 'afterGame', reads: 1, text: () => `Set for after the game. I'll tell you how it went.` },
  {
    when: (f) => f.timing === 'afterGame',
    reads: 1,
    text: (f) => `I will talk to ${f.noun} after the game. You will hear how it went.`,
  },
  { when: (f) => f.timing === 'monday', reads: 1, text: () => `Set for Monday, in film. I'll tell you how it went.` },
  {
    when: (f) => f.timing === 'monday',
    reads: 1,
    text: (f) => `${cap(f.noun)}, Monday, in the film room. You will hear how it went.`,
  },
  {
    when: (f) => f.timing === 'wednesday',
    reads: 1,
    text: () => `Set for Wednesday, before practice. I'll tell you how it went.`,
  },
  {
    when: (f) => f.timing === 'wednesday',
    reads: 1,
    text: (f) => `${cap(f.noun)}, Wednesday, before practice. You will hear how it went.`,
  },
  { text: (f) => `Set for ${TIMING[f.timing]}. I'll tell you how it went.` },
];

// ───────── the result, a week on ─────────

export interface ResultFact {
  man: ManSheet;
  outcome: 'lands' | 'bristles' | 'none';
  /** The commitment named him. */
  named: boolean;
  /** He reads Poor or worse now. */
  nowDown: boolean;
  topic: MeetingTopic;
}

const thing = (f: ResultFact) => {
  const c = causeOf(f.man);
  return c ? THING[c] : null;
};
const hasThing = (f: ResultFact) => f.nowDown && causeOf(f.man) !== null;

/** One man, by where he is now against how he took it then, and why. */
export const RESULT_MAN: readonly Line<ResultFact>[] = [
  {
    when: (f) => f.outcome === 'lands' && f.nowDown && hasThing(f),
    reads: 4,
    text: (f) => `${f.man.last} heard it, but he is down now. It is ${thing(f)}, and a speech does not fix that.`,
  },
  {
    when: (f) => f.outcome === 'lands' && f.nowDown && hasThing(f),
    reads: 4,
    text: (f) => `${f.man.last} took it well and he is down now. That is ${thing(f)}, not the meeting.`,
  },
  {
    when: (f) => f.outcome === 'lands' && f.nowDown && hasThing(f) && f.named,
    reads: 5,
    text: (f) => `${f.man.last} knows what we promised. He is down over ${thing(f)} now, and he is waiting on us.`,
  },
  {
    when: (f) => f.outcome === 'lands' && f.nowDown,
    reads: 3,
    text: (f) => `${f.man.last} took it well, but he is down now.`,
  },
  {
    when: (f) => f.outcome === 'lands' && f.named && f.topic === 'deal' && !f.nowDown,
    reads: 4,
    text: (f) => `${f.man.last} heard what we are doing about his deal, and he is in a better place for it.`,
  },
  {
    when: (f) => f.outcome === 'lands' && f.named && !f.nowDown,
    reads: 3,
    text: (f) => `${f.man.last} heard what we are going to do, and he is in a better place.`,
  },
  {
    when: (f) => f.outcome === 'lands' && !f.nowDown,
    reads: 2,
    text: (f) => `${f.man.last} heard it, and he is in a better place.`,
  },
  {
    when: (f) => f.outcome === 'lands' && !f.nowDown,
    reads: 2,
    text: (f) => `${f.man.last} took it well. He is fine now.`,
  },
  {
    when: (f) => f.outcome === 'bristles' && f.nowDown && hasThing(f),
    reads: 4,
    text: (f) => `${f.man.last} did not like it, and he is down now. It is ${thing(f)}, not the room.`,
  },
  {
    when: (f) => f.outcome === 'bristles' && f.nowDown && hasThing(f),
    reads: 4,
    text: (f) => `${f.man.last} bristled, and ${thing(f)} is what is eating him now.`,
  },
  {
    when: (f) => f.outcome === 'bristles' && f.nowDown,
    reads: 3,
    text: (f) => `${f.man.last} did not like it, and he is down now.`,
  },
  {
    when: (f) => f.outcome === 'bristles' && !f.nowDown,
    reads: 2,
    text: (f) => `${f.man.last} bristled at the time, but he has come round.`,
  },
  {
    when: (f) => f.outcome === 'bristles' && !f.nowDown,
    reads: 2,
    text: (f) => `${f.man.last} did not like it then. He is all right now.`,
  },
  {
    when: (f) => f.outcome === 'none' && f.nowDown && hasThing(f),
    reads: 4,
    text: (f) => `${f.man.last} did not move either way. He is down over ${thing(f)} now.`,
  },
  {
    when: (f) => f.outcome === 'none' && f.nowDown,
    reads: 3,
    text: (f) => `${f.man.last} sat through it. He is down now.`,
  },
  {
    when: (f) => f.outcome === 'none' && f.named,
    reads: 2,
    text: (f) => `${f.man.last} took it without a word. We still owe him.`,
  },
  {
    when: (f) => f.outcome === 'none' && !f.nowDown,
    reads: 1,
    text: (f) => `${f.man.last} took it without a word. He is all right.`,
  },
  { text: (f) => `Nothing more on ${f.man.last}.` },
];

export interface ResultRoomFact {
  noun: string;
  /** The room's word when the meeting was held, when it was in trouble. */
  then: 'Split' | 'Down' | null;
  /** Its read now. */
  now: UnitWord | null;
}

const bad = (w: UnitWord | 'Split' | 'Down' | null) => w === 'Down' || w === 'Split';

/** "it" for a room named in the singular, "they" for a plural one. */
const they = (noun: string) => (isOf(noun) === 'is' ? 'it' : 'they');

/** The room by its read now against its read then. */
export const RESULT_ROOM: readonly Line<ResultRoomFact>[] = [
  {
    when: (f) => bad(f.then) && f.now === 'Tight',
    reads: 3,
    text: (f) =>
      `${cap(f.noun)} ${isOf(f.noun)} tight now. ${cap(they(f.noun))} ${wasOf(f.noun)} ${lowerWord(f.then!)} when we met.`,
  },
  {
    when: (f) => bad(f.then) && f.now !== null && !bad(f.now),
    reads: 3,
    text: (f) => `${cap(f.noun)} ${isOf(f.noun)} steadier than ${they(f.noun)} ${wasOf(f.noun)} when we met.`,
  },
  {
    when: (f) => bad(f.then) && f.now !== null && !bad(f.now),
    reads: 3,
    text: (f) =>
      `${cap(f.noun)} ${wasOf(f.noun)} ${lowerWord(f.then!)} when we met, and ${they(f.noun)} ${isOf(f.noun)} not now.`,
  },
  {
    when: (f) => f.then === 'Down' && f.now === 'Split',
    reads: 3,
    text: (f) =>
      `${cap(f.noun)} ${wasOf(f.noun)} down when we met. Now ${they(f.noun)} ${isOf(f.noun)} split, which is a different problem.`,
  },
  {
    when: (f) => f.then === 'Split' && f.now === 'Down',
    reads: 3,
    text: (f) =>
      `${cap(f.noun)} ${wasOf(f.noun)} split when we met. Now ${they(f.noun)} ${isOf(f.noun)} down, which is worse.`,
  },
  {
    when: (f) => bad(f.then) && f.now === f.then,
    reads: 3,
    text: (f) => `Nothing moved. ${cap(f.noun)} ${isOf(f.noun)} still ${lowerWord(f.then!)}.`,
  },
  {
    when: (f) => bad(f.then) && f.now === f.then,
    reads: 3,
    text: (f) => `${cap(f.noun)} ${isOf(f.noun)} where ${they(f.noun)} started, ${lowerWord(f.then!)}..`,
  },
  {
    when: (f) => !bad(f.then) && bad(f.now),
    reads: 2,
    text: (f) =>
      `${cap(f.noun)} ${isOf(f.noun)} ${lowerWord(f.now as 'Down' | 'Split')} now, and ${they(f.noun)} ${wasOf(f.noun)} not when we met. I am watching it.`,
  },
  {
    when: (f) => f.now === 'Tight' || f.now === 'Settled',
    reads: 1,
    text: (f) => `${cap(f.noun)} ${isOf(f.noun)} ${f.now === 'Tight' ? 'tight' : 'settled'}. Nothing to add.`,
  },
  {
    when: (f) => f.now === 'Restless',
    reads: 1,
    text: (f) => `${cap(f.noun)} ${isOf(f.noun)} restless. Not trouble yet.`,
  },
  {
    when: (f) => f.now !== null,
    text: (f) => `${cap(f.noun)} ${isOf(f.noun)} ${f.now!.toLowerCase()} now.`,
  },
];
