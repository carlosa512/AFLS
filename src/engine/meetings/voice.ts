import type { Approach, Backing, MeetingTopic, Moment, Timing } from '../types';
import type { Line } from '../voice';
import type { ManFact, Record3, Style, SuggestFact } from './facts';
import type { CredibilityRead } from './credibility';

/** A room's verb: "the receivers are", "the D-line is" (the plural nouns end in s). */
export const verb = (noun: string, one: string, many: string): string => (noun.endsWith('s') ? many : one);

/**
 * The head coach's words about meetings (L2, spec §5; the writing rules are L1's §6.2): a judgment with the fact behind
 * it, the man before the room, count like a coach, no digits, and nothing the engine doesn't do. A meeting buys time;
 * no line says it fixed a contract, a role or a feud. Lines vary by the coach's style: a disciplinarian terse, a
 * players' coach warmer.
 */

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
/** "Sanders's", "Hill's". */
const possessive = (name: string) => `${name}'s`;
const both = (a: ManFact, b: ManFact) => `${a.last} and ${b.last}`;
const list = (men: ManFact[]) =>
  men.length === 1
    ? men[0].last
    : `${men
        .slice(0, -1)
        .map((m) => m.last)
        .join(', ')} and ${men.at(-1)!.last}`;

// ───────── the suggestion: his read, then his ask ─────────

/** Who and what: the opening line of a trouble letter. */
export const READ_LEAD: readonly Line<SuggestFact>[] = [
  // A room turning on whoever runs its side (L4).
  {
    when: (f) => !!f.coord && !!f.driver,
    reads: 3,
    text: (f) =>
      `${f.driver!.first} ${f.driver!.last} has been stirring up ${f.noun} about ${f.coord!.last}'s calls, and ${verb(f.noun, "it's", "they're")} listening.`,
  },
  {
    when: (f) => !!f.coord?.lost,
    reads: 2,
    text: (f) => `${cap(f.noun)} ${verb(f.noun, 'has', 'have')} stopped believing in ${f.coord!.last}.`,
  },
  {
    when: (f) => !!f.coord,
    reads: 2,
    text: (f) => `${cap(f.noun)} ${verb(f.noun, 'has', 'have')} doubts about ${f.coord!.last}'s calls.`,
  },
  {
    when: (f) => !!f.driver && f.topic === 'deal',
    reads: 2,
    text: (f) =>
      `${f.driver!.first} ${f.driver!.last} is unhappy about his deal, and ${f.noun} ${verb(f.noun, 'is', 'are')} hearing about it.`,
  },
  {
    when: (f) => !!f.driver && f.topic === 'snaps',
    reads: 2,
    text: (f) =>
      `${f.driver!.first} ${f.driver!.last} wants more snaps, and he's making sure ${f.noun} ${verb(f.noun, 'knows', 'know')} it.`,
  },
  {
    when: (f) => !!f.feud,
    reads: 2,
    text: (f) =>
      `${f.feud![0].first} ${f.feud![0].last} and ${f.feud![1].first} ${f.feud![1].last} aren't getting on, and ${f.noun} ${verb(f.noun, 'is', 'are')} picking sides.`,
  },
  {
    when: (f) => f.scope === 'team' && f.losingRun,
    reads: 2,
    text: () => `We keep losing, and it is affecting the whole team.`,
  },
  {
    when: (f) => f.topic === 'losing',
    reads: 1,
    text: (f) => `The losing is getting to ${f.noun}.`,
  },
  {
    when: (f) => f.topic === 'deal' && f.dealMen.length >= 2,
    reads: 1,
    text: (f) =>
      `${cap(list(f.dealMen))} want new deals, and ${f.noun} ${verb(f.noun, 'is', 'are')} talking about little else.`,
  },
  {
    when: (f) => f.topic === 'deal' && f.dealMen.length === 1,
    reads: 1,
    text: (f) => `${f.dealMen[0].first} ${f.dealMen[0].last} wants a new deal, and the room knows it.`,
  },
  {
    when: (f) => f.topic === 'snaps' && !!f.snapsMan,
    reads: 1,
    text: (f) => `${f.snapsMan!.first} ${f.snapsMan!.last} wants more snaps, and the room knows it.`,
  },
  {
    when: (f) => f.word === 'Down',
    reads: 1,
    text: (f) => `${cap(f.noun)} ${verb(f.noun, 'is', 'are')} down.`,
  },
  {
    when: (f) => !!f.asked && f.topic === 'none' && !f.word,
    reads: 1,
    text: () => `Nothing in there needs dealing with right now.`,
  },
  // After "You asked about the secondary", the noun again would echo.
  {
    text: (f) =>
      f.asked
        ? `They've got something on their minds.`
        : `${cap(f.noun)} ${verb(f.noun, 'has something on its mind', 'have something on their minds')}.`,
  },
  {
    text: (f) =>
      f.asked ? `I don't like what I'm seeing in there.` : `I don't like what I'm seeing from ${f.noun} lately.`,
  },
  {
    text: (f) =>
      f.asked ? `There is something in there that needs saying.` : `Something with ${f.noun} needs saying.`,
  },
  {
    text: (f) =>
      f.asked ? `They need to hear from me.` : `${cap(f.noun)} ${verb(f.noun, 'needs', 'need')} to hear from me.`,
  },
];

/** Why the man driving it matters: his years, his job, his deal. */
export const READ_WHY: readonly Line<SuggestFact>[] = [
  {
    when: (f) => !!f.driver?.starting && !!f.driver.rookieDeal && f.topic === 'deal',
    reads: 3,
    text: (f) => `He's ${f.driver!.years} starting for us on a rookie wage, and when he talks the younger players listen.`,
  },
  {
    when: (f) => !!f.driver?.starting,
    reads: 2,
    text: (f) => `He's ${f.driver!.years} and he starts, so when he talks the room listens.`,
  },
  {
    when: (f) => !!f.driver,
    reads: 1,
    text: (f) => `He's ${f.driver!.years}, and the room listens to him.`,
  },
  { text: () => '' },
];

/** Where the room stands, and why it won't sort itself out. */
export const READ_ROOM: readonly Line<SuggestFact>[] = [
  {
    when: (f) => f.word === 'Split' && !!f.driver && f.topic === 'deal' && !!f.driver.finalYear,
    reads: 4,
    text: (f) =>
      `Half ${f.noun} ${verb(f.noun, 'is', 'are')} fine. ${f.driver!.last} and the players around him aren't, and with his deal running out it won't settle by itself.`,
  },
  {
    when: (f) => f.word === 'Split' && !!f.driver,
    reads: 3,
    text: (f) =>
      `Half ${f.noun} ${verb(f.noun, 'is', 'are')} fine. ${f.driver!.last} and the players around him aren't.`,
  },
  {
    when: (f) => f.word === 'Split',
    reads: 2,
    text: (f) =>
      `Half ${f.noun} ${verb(f.noun, "is fine and half isn't", "are fine and half aren't")}, and they know it.`,
  },
  {
    when: (f) => f.word === 'Down',
    reads: 2,
    text: () => `Nobody in that room is happy right now.`,
  },
  { text: () => '' },
];

/** His answer when you asked for the meeting: it comes first. */
export const ASKED: readonly Line<Pick<SuggestFact, 'style' | 'noun'>>[] = [
  { when: (f) => f.style === 'terse', reads: 1, text: (f) => `You asked about ${f.noun}.` },
  { when: (f) => f.style === 'warm', reads: 1, text: (f) => `Glad you asked about ${f.noun}.` },
  { reads: 0, text: (f) => `You asked about ${f.noun}.` },
];

/** A calendar moment's opening. */
export const MOMENT_LEAD: Record<Moment, string> = {
  camp: 'Camp opens this week, and I want to set the tone with the whole team before we start.',
  newCoach: 'This is my first week with this group, and I want them to hear from me before anything else.',
  deadline: "It's deadline week and we're still in it. I want the team to hear where we stand before the trade calls start.",
  push: "We've got something to play for now. I want the team together before the last stretch.",
  final: 'There is one game left, and I want a word with the team the night before.',
  end: "The season's over. I want a word with the team before they scatter.",
};

/** How he says he wants the meeting. Each line is its own sentence, so the next letter can word it another way. */
export const ASK_OPEN: readonly Line<SuggestFact>[] = [
  { when: (f) => f.style === 'terse', reads: 1, text: (f) => `I want ${f.noun} in a room this week.` },
  { text: (f) => `I want to get ${f.noun} together this week.` },
  { text: (f) => `I think I should sit down with ${f.noun} soon.` },
  { text: (f) => `${cap(f.noun)} should hear from me before the weekend.` },
  { text: (f) => `I'd like a few minutes with ${f.noun} before the next game.` },
  { text: (f) => `It is time ${f.noun} heard it from me.` },
  { text: (f) => `I want ${f.noun} in front of me for this.` },
  { text: (f) => `I'd rather talk to ${f.noun} face to face.` },
];

/** His ask of you before he does it. */
export const ASK_CALL: readonly Line<SuggestFact>[] = [
  { when: (f) => f.style === 'terse', reads: 1, text: () => `How I do it is your call.` },
  { text: () => `Before I do, I need your call.` },
  { text: () => `I won't do it without your say.` },
  { text: () => `Tell me how you want it handled.` },
  { text: () => `How hard I go is up to you.` },
  { text: () => `I need to know where you stand first.` },
  { text: () => `You set the tone, and I'll follow it.` },
  { text: () => `Give me the word, and tell me what to say.` },
];

/** The same ask at a calendar moment, where the choices are several. */
export const ASK_CALL_MOMENT: readonly Line<SuggestFact>[] = [
  { text: () => `Before I do, I need your call on a couple of things.` },
  { text: () => `A couple of choices are yours before I start.` },
  { text: () => `I need you to decide a couple of things first.` },
  { text: () => `There are a couple of things only you can settle first.` },
  { text: () => `Give me your word on a couple of things, and I'll go ahead.` },
  { text: () => `Two or three calls are yours to make before I speak.` },
];

/** His read on what would reach the room, when one thing would. Nothing fits for the plain case. */
export const ASK: readonly Line<SuggestFact>[] = [
  {
    when: (f) => !!f.coord,
    reads: 3,
    text: (f) => `My read is that we either stand behind ${f.coord!.last} or tell them it changes.`,
  },
  {
    when: (f) => !!f.coord,
    reads: 3,
    text: (f) => `I think we either stand behind ${f.coord!.last} or tell them that something changes.`,
  },
  {
    when: (f) => f.advice === 'talks' && f.dealMen.length === 1,
    reads: 3,
    text: (f) =>
      `My read is that telling ${f.dealMen[0].last} we're talking to his agent is the only thing that will reach him on the money.`,
  },
  {
    when: (f) => f.advice === 'talks',
    reads: 2,
    text: () => `My read is that only talks with their agents will reach them on the money.`,
  },
  {
    when: (f) => f.advice === 'snaps' && !!f.snapsMan,
    reads: 3,
    text: (f) => `My read is that words won't do it for ${f.snapsMan!.last}, and snaps will.`,
  },
  {
    when: (f) => f.advice === 'move',
    reads: 2,
    text: () => `My read is that they want to see us do something, not hear about it.`,
  },
  {
    when: (f) => f.advice === 'move',
    reads: 2,
    text: () => `I think they need a move from us more than a speech.`,
  },
];

// ───────── the choices: a question each, short answers ─────────

export const QUESTION = {
  approach: 'How should I put it?',
  backing: 'What can I tell them?',
  timing: 'When?',
  gmApproach: 'What do you tell them?',
  gmBacking: "What's behind it?",
};

export function approachLabel(a: Approach, f: Pick<SuggestFact, 'driver' | 'leader'>): string {
  switch (a) {
    case 'leader':
      return f.leader ? `Let ${f.leader.last} say it` : 'Let a leader say it';
    case 'straight':
      return 'Say it straight';
    case 'callout':
      return f.driver ? `Call ${f.driver.last} out` : 'Call him out';
    case 'losing':
      return 'Keep it about the losing';
    case 'standard':
      return 'Talk about who we are';
    case 'ownIt':
      return 'Own it';
    case 'raiseBar':
      return 'Raise the bar';
    case 'freshStart':
      return 'A fresh start';
    case 'backHim':
      return 'Stand behind him';
  }
}

export function backingLabel(b: Backing, f: Pick<SuggestFact, 'dealMen' | 'snapsMan' | 'feud' | 'kind'>): string {
  switch (b) {
    case 'talks':
      // Named: in a room's meeting, "his agent" left the room asking whose.
      return f.dealMen.length === 1
        ? `We're talking to ${possessive(f.dealMen[0].last)} agent`
        : f.dealMen.length === 2
          ? `We're talking to ${possessive(f.dealMen[0].last)} and ${possessive(f.dealMen[1].last)} agents`
          : "We're talking to their agents";
    case 'snaps':
      return f.snapsMan ? `${f.snapsMan.last} will get his snaps` : "He'll get his snaps";
    case 'feud':
      return f.feud ? `One of ${both(f.feud[0], f.feud[1])} goes` : 'One of them goes';
    case 'move':
      return "We're making a move";
    case 'jobs':
      return "No one's job is safe";
    case 'notice':
      return "He's on notice";
    case 'words':
      return f.kind === 'gm' ? 'Words only' : 'Nothing, just words';
  }
}

export const TIMING_LABEL: Record<Timing, string> = {
  afterGame: 'After the game',
  monday: 'Monday, in film',
  wednesday: "Before Wednesday's practice",
};

// ───────── the result: what I told them, how it went, where that leaves us ─────────

export interface ToldFact {
  style: Style;
  approach: Approach;
  backing: Backing;
  topic: MeetingTopic;
  noun: string;
  speaker?: ManFact;
  named: ManFact[];
  moment?: Moment;
}

/** The line he used, in quotes: what the room heard. */
export const TOLD: readonly Line<ToldFact>[] = [
  {
    when: (f) => f.approach === 'straight' && f.backing === 'talks' && f.named.length === 1,
    reads: 3,
    text: (f) =>
      `We know about ${f.named[0].first}'s deal, and the front office is on it. Until then, it stays in-house and off the field.`,
  },
  {
    when: (f) => f.approach === 'straight' && f.backing === 'talks',
    reads: 2,
    text: () =>
      `We know about the deals, and the front office is on them. Until then, it stays in-house and off the field.`,
  },
  {
    when: (f) => f.approach === 'callout' && !!f.speaker && f.topic === 'deal',
    reads: 3,
    text: (f) =>
      `${f.speaker!.first}, if you've got something to say about your deal, you say it to me, not to this room.`,
  },
  {
    when: (f) => f.approach === 'callout' && !!f.speaker,
    reads: 2,
    text: (f) => `${f.speaker!.first}, whatever this is, it stops here. You bring it to me.`,
  },
  {
    when: (f) => f.approach === 'leader' && !!f.speaker,
    reads: 2,
    text: (f) =>
      `I let ${f.speaker!.first} do the talking. He told them to keep it in-house and play for each other.`,
  },
  {
    when: (f) => f.approach === 'straight' && f.backing === 'snaps' && f.named.length === 1,
    reads: 3,
    text: (f) => `${f.named[0].first} is getting his chance. For everybody else, nothing about your job changes.`,
  },
  {
    when: (f) => f.approach === 'straight' && f.backing === 'feud',
    reads: 2,
    text: () => `Whatever's between you two ends here, or one of you won't be here to finish it.`,
  },
  {
    when: (f) => f.approach === 'losing' && f.backing === 'move',
    reads: 2,
    text: () =>
      `We're better than our record, and the front office is working on it. Help is coming.`,
  },
  {
    when: (f) => f.approach === 'losing',
    reads: 1,
    text: () => `We're better than our record. Nobody gets to quit on the season in this room.`,
  },
  {
    when: (f) => f.approach === 'standard' && f.moment === 'camp',
    reads: 2,
    text: () => `Nobody's job is promised. Earn it every day and we'll be fine.`,
  },
  {
    when: (f) => f.approach === 'standard' && f.moment === 'final',
    reads: 2,
    text: () => `Nothing changes tomorrow. Do your job, and do it like you've done it all year.`,
  },
  {
    when: (f) => f.approach === 'standard',
    reads: 1,
    text: () => `Who we are doesn't change with the week. Do your job and trust the player next to you.`,
  },
  {
    when: (f) => f.approach === 'straight',
    reads: 1,
    text: () => `Nobody is going to fix this for us, so keep it in this room and work.`,
  },
  {
    when: (f) => f.approach === 'straight',
    reads: 1,
    text: () =>
      `I'll say it plainly. Some of you are unhappy, and I know it. Say it to me, not to each other.`,
  },
  {
    when: (f) => f.approach === 'straight',
    reads: 1,
    text: () => `You know what's bothering you, and so do I. Bring it to me and we'll deal with it.`,
  },
  {
    when: (f) => f.approach === 'straight',
    reads: 1,
    text: () => `What's said in this room stays in this room. What's done on Sunday is what counts.`,
  },
  {
    when: (f) => f.approach === 'callout' && !!f.speaker,
    reads: 2,
    text: (f) => `${f.speaker!.first}, I'm talking to you. Whatever's on your mind, you bring it to me first.`,
  },
  {
    when: (f) => f.approach === 'callout' && !!f.speaker,
    reads: 2,
    text: (f) => `${f.speaker!.first}, you've said enough to everyone but me. Come see me.`,
  },
  {
    when: (f) => f.approach === 'callout' && !!f.speaker,
    reads: 2,
    text: (f) => `Everybody here knows what ${f.speaker!.first} has been saying. It ends today.`,
  },
  {
    when: (f) => f.approach === 'callout' && !f.speaker,
    reads: 2,
    text: () => `Somebody in this room has been talking everywhere but to me. It ends today.`,
  },
  {
    when: (f) => f.approach === 'callout' && !f.speaker,
    reads: 2,
    text: () => `If you've got something to say, I'm the one you say it to.`,
  },
  {
    when: (f) => f.approach === 'callout' && !f.speaker,
    reads: 2,
    text: () => `I'm not naming anyone. You know who you are, and you know what to do.`,
  },
  {
    when: (f) => f.approach === 'callout' && !f.speaker,
    reads: 2,
    text: () => `It stops with this meeting. I'm not going to say it twice.`,
  },
  {
    when: (f) => f.approach === 'leader' && !!f.speaker,
    reads: 2,
    text: (f) => `I asked ${f.speaker!.last} to say it, and he has earned the right.`,
  },
  {
    when: (f) => f.approach === 'leader' && !!f.speaker,
    reads: 2,
    text: (f) => `${f.speaker!.last} spoke for me today, and he said it better than I would have.`,
  },
  {
    when: (f) => f.approach === 'leader' && !!f.speaker,
    reads: 2,
    text: (f) => `${f.speaker!.last} has been through this before. Hear how it goes from him.`,
  },
  {
    when: (f) => f.approach === 'leader' && !f.speaker,
    reads: 2,
    text: () => `One of your own is doing the talking. Take it from him as you'd take it from me.`,
  },
  {
    when: (f) => f.approach === 'leader' && !f.speaker,
    reads: 2,
    text: () => `The room's leaders spoke today. They said what I'd have said.`,
  },
  {
    when: (f) => f.approach === 'leader' && !f.speaker,
    reads: 2,
    text: () => `This one comes from inside the room. Listen to the ones you follow.`,
  },
  {
    when: (f) => f.approach === 'leader' && !f.speaker,
    reads: 2,
    text: () => `I stepped back and let the leaders talk. It means more from them.`,
  },
  {
    when: (f) => f.approach === 'losing',
    reads: 1,
    text: () => `Losing is on all of us, me first. Nobody in here gets to hide from it.`,
  },
  {
    when: (f) => f.approach === 'losing',
    reads: 1,
    text: () => `The record is what it is. The next game is the only one we can change.`,
  },
  {
    when: (f) => f.approach === 'losing',
    reads: 1,
    text: () => `I've seen teams quit in a spot like this, and this one won't.`,
  },
  {
    when: (f) => f.approach === 'losing',
    reads: 1,
    text: () => `We're losing, and you all know it. Stop looking for someone to blame and play.`,
  },
  {
    when: (f) => f.approach === 'standard',
    reads: 1,
    text: () => `This is how we do things here, and it doesn't change when the results do.`,
  },
  {
    when: (f) => f.approach === 'standard',
    reads: 1,
    text: () => `The standard does not change. Meet it, or the player behind you will.`,
  },
  {
    when: (f) => f.approach === 'standard',
    reads: 1,
    text: () => `We know what's expected at this club. Nothing about the week changes that.`,
  },
  {
    when: (f) => f.approach === 'standard',
    reads: 1,
    text: () => `Do it the way we've always done it. Everything else follows.`,
  },
  {
    when: (f) => f.approach === 'ownIt',
    reads: 1,
    text: () => `This one is on me. If it's wrong, I'll fix it, and nobody else carries it.`,
  },
  {
    when: (f) => f.approach === 'ownIt',
    reads: 1,
    text: () => `I put us here, and I'll take the blame for it. Your job is to play.`,
  },
  {
    when: (f) => f.approach === 'ownIt',
    reads: 1,
    text: () => `If you want to blame somebody, blame me. Then get back to work.`,
  },
  {
    when: (f) => f.approach === 'ownIt',
    reads: 1,
    text: () => `That mistake is mine. I should have seen it sooner.`,
  },
  {
    when: (f) => f.approach === 'raiseBar',
    reads: 1,
    text: () => `The bar just went up. I expect more from every one of you starting today.`,
  },
  {
    when: (f) => f.approach === 'raiseBar',
    reads: 1,
    text: () => `What was good enough last week isn't good enough now.`,
  },
  {
    when: (f) => f.approach === 'raiseBar',
    reads: 1,
    text: () => `I'm asking for more, and I'm asking it of everyone, starters included.`,
  },
  {
    when: (f) => f.approach === 'raiseBar',
    reads: 1,
    text: () => `You can do more than you've been doing. I'm not going to ask politely again.`,
  },
  {
    when: (f) => f.approach === 'freshStart',
    reads: 1,
    text: () => `Everybody starts clean today. What happened before is over.`,
  },
  {
    when: (f) => f.approach === 'freshStart',
    reads: 1,
    text: () => `It's a new week and a clean slate. Show me something I haven't seen.`,
  },
  {
    when: (f) => f.approach === 'freshStart',
    reads: 1,
    text: () => `I'm leaving the past behind. Nobody here is judged by it.`,
  },
  {
    when: (f) => f.approach === 'freshStart',
    reads: 1,
    text: () => `Whatever was said before, forget it. We start over here.`,
  },
  {
    when: (f) => f.approach === 'backHim',
    reads: 1,
    text: () => `I stand behind my coordinator, and so will you. He has my full backing.`,
  },
  {
    when: (f) => f.approach === 'backHim',
    reads: 1,
    text: () => `The plan is sound. Run it the way he drew it.`,
  },
  {
    when: (f) => f.approach === 'backHim',
    reads: 1,
    text: () => `If you've got a problem with the calls, bring it to me. He's not going anywhere this week.`,
  },
  {
    when: (f) => f.approach === 'backHim',
    reads: 1,
    text: () => `He works harder than anyone at this club. Give him your attention.`,
  },
  {
    when: (f) => f.style === 'terse',
    reads: 1,
    text: () => `Whatever it is, it stays in-house. Do your job.`,
  },
  { text: () => `I know what's on your minds. It stays in-house and off the field.` },
];

export interface NextFact {
  backing: Backing;
  noun: string;
  named: ManFact[];
  /** Words for the window: "four weeks", "the deadline". */
  window: string;
}

/** Where that leaves us: the commitment and its window, or what a speech can't do. Never a fix. */
export const NEXT: readonly Line<NextFact>[] = [
  {
    when: (f) => f.backing === 'talks' && f.named.length === 1,
    reads: 2,
    text: (f) =>
      `It buys us a few weeks, not more. ${cap(f.noun)} ${verb(f.noun, 'expects', 'expect')} us to open talks with ${f.named[0].last}'s agent ${f.window}. If we don't, he'll take it worse than if I'd said nothing.`,
  },
  {
    when: (f) => f.backing === 'talks',
    reads: 1,
    text: (f) =>
      `It buys us a few weeks, not more. ${cap(f.noun)} ${verb(f.noun, 'expects', 'expect')} talks with ${list(f.named)}'s agents ${f.window}. If they don't happen, it'll go worse than if I'd said nothing.`,
  },
  {
    when: (f) => f.backing === 'snaps' && f.named.length === 1,
    reads: 2,
    text: (f) =>
      `${f.named[0].last} expects more snaps ${f.window}. That's on the depth chart now, and the room will be watching.`,
  },
  {
    when: (f) => f.backing === 'feud' && f.named.length === 2,
    reads: 2,
    text: (f) =>
      `They expect one of ${both(f.named[0], f.named[1])} to be gone ${f.window}. If they're both still here, the room will notice.`,
  },
  {
    when: (f) => f.backing === 'move',
    reads: 1,
    text: (f) => `They expect a starter brought in before ${f.window}. If nobody comes, they'll remember what I said.`,
  },
  {
    when: (f) => f.backing === 'jobs',
    reads: 1,
    text: (f) => `They expect the depth chart to move ${f.window}. If it doesn't, they won't believe the next one.`,
  },
  { text: () => `It buys us a little time. It doesn't change what's bothering them.` },
  { text: () => `That gets us some patience. It does not fix what is wrong.` },
  { text: () => `They will give us a little room, and no more than that.` },
  { text: (f) => `What is bothering ${f.noun} has not gone away because I said a few words.` },
  { text: () => `It was worth saying. It was never going to be enough alone.` },
  { text: () => `A speech settles a room for a while. The trouble underneath is still there.` },
  { text: () => `We have gained a little time, and we should use it.` },
];

// ───────── the staff notes: a commitment coming due, his word ─────────

export interface DueFact {
  backing: Exclude<Backing, 'words'>;
  noun: string;
  named: ManFact[];
  /** When it comes due, as words: "next week", "in two weeks", or "soon" away from the season's weeks. */
  when: string;
  /** You made it, in your own address to the club: the head coach says "you told", not "I told". */
  you?: boolean;
}

/** Who made the promise, as the head coach says it. */
const told = (f: DueFact) => (f.you ? 'you told' : 'I told');
const What = (f: DueFact) => `What ${told(f)} ${f.noun}`;

/** A commitment still open, one or two steps before it is judged (`coachWeek.ts`): nothing has kept it yet. */
export const DUE: readonly Line<DueFact>[] = [
  {
    when: (f) => f.backing === 'talks' && f.named.length === 1,
    reads: 2,
    text: (f) => `${What(f)} comes due ${f.when}. It was talks with ${f.named[0].last}'s agent, and nothing has opened yet.`,
  },
  {
    when: (f) => f.backing === 'talks',
    reads: 1,
    text: (f) => `${What(f)} comes due ${f.when}. It was talks with ${list(f.named)}'s agents, and nothing has opened yet.`,
  },
  {
    when: (f) => f.backing === 'snaps' && f.named.length === 1,
    reads: 2,
    text: (f) => `${What(f)} comes due ${f.when}. It was ${f.named[0].last}'s snaps, and he's still not getting them.`,
  },
  {
    when: (f) => f.backing === 'feud' && f.named.length === 2,
    reads: 2,
    text: (f) =>
      `${What(f)} comes due ${f.when}. It was one of ${both(f.named[0], f.named[1])} going, and they're both still here.`,
  },
  {
    when: (f) => f.backing === 'move',
    reads: 1,
    text: (f) => `The deadline's close, and ${told(f)} them we'd bring someone in.`,
  },
  {
    when: (f) => f.backing === 'jobs',
    reads: 1,
    text: (f) =>
      `${cap(told(f))} them nobody's job was safe. The depth chart hasn't moved, and it comes due ${f.when}.`,
  },
  { text: (f) => `${What(f)} comes due ${f.when}.` },
];

export interface CandidFact {
  read: CredibilityRead;
  /** His word got better since he last said. */
  better: boolean;
}

export const CANDID: readonly Line<CandidFact>[] = [
  {
    when: (f) => f.read === 'believes',
    reads: 1,
    text: () =>
      `The players believe what I tell them right now, so a team meeting from me will land. That's worth spending carefully.`,
  },
  {
    when: (f) => f.read === 'steady' && f.better,
    reads: 2,
    text: () =>
      `The players are taking me at my word again, so a team meeting from me should land. Keep the promises we make them and it stays that way.`,
  },
  {
    when: (f) => f.read === 'heardBefore',
    reads: 1,
    text: () =>
      `The players have heard enough speeches from me. A team meeting with nothing behind it won't land now. The next one needs a promise we keep.`,
  },
  {
    when: (f) => f.read === 'wornThin',
    reads: 1,
    text: () =>
      `My word has worn thin with the players. Another team meeting won't fix it, and something has to change.`,
  },
  {
    when: (f) => f.read === 'believes',
    reads: 1,
    text: () => `The players are listening to me right now. I'd rather not waste that on a meeting we don't need.`,
  },
  {
    when: (f) => f.read === 'steady' && f.better,
    reads: 2,
    text: () => `The players have started to take my word again. Another promise kept and it holds.`,
  },
  {
    when: (f) => f.read === 'heardBefore',
    reads: 1,
    text: () =>
      `The players have sat through enough talks from me. If I call another, it needs something real behind it.`,
  },
  {
    when: (f) => f.read === 'wornThin',
    reads: 1,
    text: () =>
      `My word has worn thin with the players. Another team meeting won't bring it back, but something we do will.`,
  },
];

// ───────── the season's end: a paragraph on the year's meetings ─────────

export interface YearFact {
  held: number;
  /** `you`: the promise was yours, from your address to the team, not the coach's. */
  kept?: { noun: string; month: string; promise: string; named?: string; you?: boolean };
  broken?: { when: string; promise: string; you?: boolean };
}

const COUNT = [
  'no',
  'once',
  'twice',
  'three times',
  'four times',
  'five times',
  'six times',
  'seven times',
  'eight times',
];

export function yearParagraph(f: YearFact): string {
  if (!f.held) return '';
  const times = f.held < COUNT.length ? COUNT[f.held] : 'more times than I can count';
  const out = [`We held a team meeting ${times} this year.`];
  if (f.kept)
    out.push(
      f.kept.you
        ? `When you talked to the team in ${f.kept.month}, you told them ${f.kept.promise}, and we did. They noticed.`
        : `Talking to ${f.kept.noun} in ${f.kept.month} worked. I told them ${f.kept.promise}, we did, and ${f.kept.named ? `${f.kept.named} still listens to me for it` : 'they still listen to me for it'}.`,
    );
  const first = out.join(' ');
  if (!f.broken) return first;
  const said = f.broken.you ? 'You told them' : 'I said';
  return `${first}\n\n${cap(f.broken.when)} was another story. ${said} ${f.broken.promise}, it didn't happen, and a couple of the veterans haven't let it go.`;
}

/** A kept or broken commitment as the coach tells it: "we'd open Mitchell's talks". */
export function promisePhrase(backing: Exclude<Backing, 'words'>, named: ManFact[]): string {
  switch (backing) {
    case 'talks':
      return named.length === 1
        ? `we'd open ${named[0].last}'s talks`
        : named.length === 2
          ? `we'd open talks with ${both(named[0], named[1])}'s agents`
          : 'we would open talks with their agents';
    case 'snaps':
      return named.length === 1 ? `${named[0].last} would get his snaps` : 'the snaps would come';
    case 'feud':
      return named.length === 2 ? `one of ${both(named[0], named[1])} would go` : 'one of them would go';
    case 'move':
      return 'we were buying';
    case 'jobs':
      return "nobody's job was safe";
    case 'notice':
      return 'things would change';
  }
}

// ───────── after your address: a captain, for the room ─────────

export interface CaptainFact {
  approach: Approach;
  backing: Backing;
  /** How it went with the room. */
  went: 'landed' | 'mixed' | 'flopped';
  record: Record3;
}

export const CAPTAIN_OPEN: readonly Line<CaptainFact>[] = [
  {
    when: (f) => f.went === 'landed' && f.approach === 'ownIt',
    reads: 2,
    text: () =>
      `The players took what you said seriously. Owning it went over well with the veterans, because nobody in the front office had done that before.`,
  },
  {
    when: (f) => f.went === 'landed' && f.approach === 'raiseBar',
    reads: 2,
    text: () => `The players heard you. The ones who want it took it as a challenge, and that's most of this room.`,
  },
  { when: (f) => f.went === 'landed', reads: 1, text: () => `The players took what you said seriously.` },
  {
    when: (f) => f.went === 'mixed' && f.approach === 'raiseBar',
    reads: 2,
    text: () => `Some of the players took it as a challenge. A few took it personally.`,
  },
  {
    when: (f) => f.went === 'mixed',
    reads: 1,
    text: () => `Some of the players believed it. A few think it should have come from the coach.`,
  },
  {
    when: (f) => f.went === 'flopped',
    reads: 1,
    text: () => `It didn't work. The players have heard promises before.`,
  },
];

export const CAPTAIN_CLOSE: Record<Backing, string> = {
  jobs: "They'll come around if the depth chart moves like you said it would.",
  move: "If a starter comes in before the deadline, they'll believe the next one.",
  words: '',
  talks: '',
  snaps: '',
  feud: '',
  notice: '',
};

// ───────── SNN: a rumor, now and then ─────────

export interface RumorFact {
  city: string;
  nickname: string;
  coach: string;
  winless: boolean;
  /** Losses in a row, in words. */
  run: string;
}

export const SNN_RUMOR: readonly Line<RumorFact>[] = [
  {
    when: (f) => f.winless,
    reads: 2,
    text: (f) =>
      `Word out of ${f.city} is that ${f.coach}'s message isn't landing any more. The ${f.nickname} are winless and have lost ${f.run} straight, and people close to the team say the players have heard it all before.`,
  },
  {
    text: (f) =>
      `Word out of ${f.city} is that ${f.coach}'s message isn't landing any more. The ${f.nickname} have lost ${f.run} straight, and people close to the team say the players have heard it all before.`,
  },
];
