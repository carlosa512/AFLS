import type { Approach, Backing, Moment, Outcome, TalkCause, Timing } from '../types';
import type { Line } from '../voice';
import type { ManFact, Reason, Record3, Style, SuggestFact } from './facts';
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
    text: () => `We keep losing, and you can feel it in the building.`,
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
    text: () => `Nothing's boiling over in there right now.`,
  },
  // After "You asked about the secondary", the noun again would echo.
  {
    text: (f) =>
      f.asked
        ? `They've got something on their minds.`
        : `${cap(f.noun)} ${verb(f.noun, 'has something on its mind', 'have something on their minds')}.`,
  },
];

/** Why the man driving it matters: his years, his job, his deal. */
export const READ_WHY: readonly Line<SuggestFact>[] = [
  {
    when: (f) => !!f.driver?.starting && !!f.driver.rookieDeal && f.topic === 'deal',
    reads: 3,
    text: (f) => `He's ${f.driver!.years} starting for us on a rookie wage, and when he talks the young guys listen.`,
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
      `Half ${f.noun} ${verb(f.noun, 'is', 'are')} in a good place. ${f.driver!.last} and the guys around him aren't, and with his deal running out it won't sort itself out.`,
  },
  {
    when: (f) => f.word === 'Split' && !!f.driver,
    reads: 3,
    text: (f) =>
      `Half ${f.noun} ${verb(f.noun, 'is', 'are')} in a good place. ${f.driver!.last} and the guys around him aren't.`,
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
    text: () => `Nobody in that room is in a good place right now.`,
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
  deadline: "It's deadline week and we're still in it. I want the team to hear where we stand before the phones start.",
  push: "We've got something to play for now. I want the team together before the push.",
  final: 'One game left. I want a word with the team the night before.',
  end: "The season's over. I want a word with the team before they scatter.",
};

/** His ask, and his read on what would reach the room when one thing would. */
export const ASK: readonly Line<SuggestFact>[] = [
  {
    when: (f) => f.advice === 'talks' && f.dealMen.length === 1,
    reads: 3,
    text: (f) =>
      `I want to get ${f.noun} together this week. Before I do, I need your call. If you want my read: telling ${f.dealMen[0].last} we're talking to his agent is the only thing that reaches him on the money.`,
  },
  {
    when: (f) => f.advice === 'talks',
    reads: 2,
    text: (f) =>
      `I want to get ${f.noun} together this week. Before I do, I need your call. If you want my read: only talks with their agents will reach them on the money.`,
  },
  {
    when: (f) => f.advice === 'snaps' && !!f.snapsMan,
    reads: 3,
    text: (f) =>
      `I want to get ${f.noun} together this week. Before I do, I need your call. My read: words won't do it for ${f.snapsMan!.last}. Snaps will.`,
  },
  {
    when: (f) => f.advice === 'move',
    reads: 2,
    text: () =>
      `I want them together this week. Before I do, I need your call. My read: they want to see us do something, not hear about it.`,
  },
  {
    when: (f) => f.kind === 'moment',
    reads: 1,
    text: () => `Before I do, I need your call on a couple of things.`,
  },
  {
    when: (f) => f.style === 'terse',
    reads: 1,
    text: (f) => `I want ${f.noun} in a room this week. Your call on how.`,
  },
  { text: (f) => `I want to get ${f.noun} together this week. Before I do, I need your call.` },
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
  }
}

export function backingLabel(b: Backing, f: Pick<SuggestFact, 'dealMen' | 'snapsMan' | 'feud' | 'kind'>): string {
  switch (b) {
    case 'talks':
      return f.dealMen.length === 1 ? "We're talking to his agent" : "We're talking to their agents";
    case 'snaps':
      return f.snapsMan ? `${f.snapsMan.last} will get his snaps` : "He'll get his snaps";
    case 'feud':
      return f.feud ? `One of ${both(f.feud[0], f.feud[1])} goes` : 'One of them goes';
    case 'move':
      return "We're making a move";
    case 'jobs':
      return "No one's job is safe";
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
  topic: TalkCause | 'none';
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
      `We know about ${f.named[0].first}'s deal, and the front office is on it. Until then, it stays in this building and off the field.`,
  },
  {
    when: (f) => f.approach === 'straight' && f.backing === 'talks',
    reads: 2,
    text: () =>
      `We know about the deals, and the front office is on them. Until then, it stays in this building and off the field.`,
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
      `I let ${f.speaker!.first} do the talking. He told them to keep it in the building and play for each other.`,
  },
  {
    when: (f) => f.approach === 'straight' && f.backing === 'snaps' && f.named.length === 1,
    reads: 3,
    text: (f) => `${f.named[0].first} is getting his chance. Everybody else, the job is still the job.`,
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
      `We're better than our record, and the front office isn't sitting on its hands. Help is coming. Play like it.`,
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
    text: () => `Who we are doesn't change with the week. Do your job and trust the man next to you.`,
  },
  {
    when: (f) => f.style === 'terse',
    reads: 1,
    text: () => `Whatever it is, it stays in this building. Do your job.`,
  },
  { text: () => `I know what's on your minds. It stays in this building and off the field.` },
];

export interface WentFact {
  man: ManFact;
  outcome: Exclude<Outcome, 'shrug'>;
  reason: Reason;
  topic: TalkCause | 'none';
}

/** One man's reaction, always with its reason. */
export const WENT: readonly Line<WentFact>[] = [
  {
    when: (f) => f.outcome === 'lands' && f.reason === 'answered' && f.topic === 'deal',
    reads: 3,
    text: (f) => `${f.man.last} took it well. He heard the part about his agent, and that's what he needed.`,
  },
  {
    when: (f) => f.outcome === 'lands' && f.reason === 'answered',
    reads: 2,
    text: (f) => `${f.man.last} took it well. He heard what we're going to do about it.`,
  },
  {
    when: (f) => f.outcome === 'lands' && f.reason === 'heard',
    reads: 2,
    text: (f) => `${f.man.last} took it well; it was the thing on his mind.`,
  },
  {
    when: (f) => f.outcome === 'lands' && f.reason === 'leader',
    reads: 2,
    text: (f) => `${f.man.last} bought in. It meant more coming from a teammate.`,
  },
  {
    when: (f) => f.outcome === 'lands' && f.reason === 'content',
    reads: 1,
    text: (f) => `${f.man.last} nodded along; he didn't need the speech.`,
  },
  {
    when: (f) => f.outcome === 'bristles' && f.reason === 'calledOut',
    reads: 3,
    text: (f) => `${f.man.last} didn't like being called out in front of the room.`,
  },
  {
    when: (f) => f.outcome === 'bristles' && f.reason === 'friendCalledOut',
    reads: 3,
    text: (f) => `${f.man.last} didn't like seeing his friend called out.`,
  },
  {
    when: (f) => f.outcome === 'bristles' && f.reason === 'money',
    reads: 2,
    text: (f) => `${f.man.last} wanted to hear about money, not speeches.`,
  },
  {
    when: (f) => f.outcome === 'bristles' && f.reason === 'dugIn',
    reads: 2,
    text: (f) => `${f.man.last} has dug in; nothing I said was going to reach him.`,
  },
  {
    when: (f) => f.outcome === 'bristles' && f.reason === 'again',
    reads: 2,
    text: (f) => `${f.man.last} rolled his eyes. He's heard this one from me before.`,
  },
  {
    when: (f) => f.outcome === 'bristles' && f.reason === 'tone',
    reads: 2,
    text: (f) => `${f.man.last} took the tone personally.`,
  },
  {
    when: (f) => f.outcome === 'bristles',
    reads: 1,
    text: (f) => `${f.man.last} didn't like being kept late over somebody else's problem.`,
  },
];

/** The rest of the room, counted like a coach. */
export function restLine(shrugs: number, noun: string): string {
  if (shrugs <= 0) return '';
  if (shrugs === 1) return 'One of them just shrugged.';
  if (shrugs <= 4) return `${cap(['', '', 'two', 'three', 'four'][shrugs])} of them just shrugged.`;
  return `Most of ${noun === 'the team' ? 'the rest' : noun} just shrugged.`;
}

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
    text: (f) => `They expect the depth chart to move ${f.window}. If it doesn't, the next speech won't land.`,
  },
  { text: () => `It buys us a little time. It doesn't change what's bothering them.` },
];

// ───────── the staff notes: a commitment coming due, his word ─────────

export interface DueFact {
  backing: Exclude<Backing, 'words'>;
  noun: string;
  named: ManFact[];
}

export const DUE: readonly Line<DueFact>[] = [
  {
    when: (f) => f.backing === 'talks' && f.named.length === 1,
    reads: 2,
    text: (f) =>
      `What I told ${f.noun} comes due next week: talks with ${f.named[0].last}'s agent. Nothing's opened yet.`,
  },
  {
    when: (f) => f.backing === 'talks',
    reads: 1,
    text: (f) =>
      `What I told ${f.noun} comes due next week: talks with ${list(f.named)}'s agents. Nothing's opened yet.`,
  },
  {
    when: (f) => f.backing === 'snaps' && f.named.length === 1,
    reads: 2,
    text: (f) => `What I told ${f.noun} comes due next week: ${f.named[0].last}'s snaps. He's still not getting them.`,
  },
  {
    when: (f) => f.backing === 'feud' && f.named.length === 2,
    reads: 2,
    text: (f) =>
      `What I told ${f.noun} comes due next week: one of ${both(f.named[0], f.named[1])} going. They're both still here.`,
  },
  {
    when: (f) => f.backing === 'move',
    reads: 1,
    text: () => `The deadline's close, and I told them we'd bring someone in.`,
  },
  {
    when: (f) => f.backing === 'jobs',
    reads: 1,
    text: () => `I told them nobody's job was safe. The depth chart hasn't moved, and it comes due next week.`,
  },
  { text: (f) => `What I told ${f.noun} comes due next week.` },
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
      `Honestly, the players have heard enough speeches from me. A team meeting with nothing behind it won't land now; the next one needs a promise we keep.`,
  },
  {
    when: (f) => f.read === 'wornThin',
    reads: 1,
    text: () =>
      `I'll be straight with you: my word's worn thin with the players. Another team meeting won't fix it; something has to change.`,
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
  const out = [`We got the guys together ${times} this year.`];
  if (f.kept)
    out.push(
      f.kept.you
        ? `When you talked to the team in ${f.kept.month}, you told them ${f.kept.promise}, and we did. They noticed.`
        : `Talking to ${f.kept.noun} in ${f.kept.month} worked: I told them ${f.kept.promise}, we did, and ${f.kept.named ? `${f.kept.named} still listens to me for it` : 'they still listen to me for it'}.`,
    );
  const first = out.join(' ');
  if (!f.broken) return first;
  const said = f.broken.you ? 'You told them' : 'I said';
  return `${first}\n\n${cap(f.broken.when)} was another story. ${said} ${f.broken.promise}, it didn't happen, and a couple of the vets haven't let it go.`;
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
      `The guys took what you said seriously. Owning it went over with the vets; nobody upstairs had done that before.`,
  },
  {
    when: (f) => f.went === 'landed' && f.approach === 'raiseBar',
    reads: 2,
    text: () => `The guys heard you. The ones who want it took it as a challenge, and that's most of this room.`,
  },
  { when: (f) => f.went === 'landed', reads: 1, text: () => `The guys took what you said seriously.` },
  {
    when: (f) => f.went === 'mixed' && f.approach === 'raiseBar',
    reads: 2,
    text: () => `Some of the guys took it as a challenge. A few took it personally.`,
  },
  {
    when: (f) => f.went === 'mixed',
    reads: 1,
    text: () => `Some of the guys bought it. A few think it should have come from the coach.`,
  },
  {
    when: (f) => f.went === 'flopped',
    reads: 1,
    text: () => `Honestly, it didn't land. The guys have heard promises before.`,
  },
];

export const CAPTAIN_CLOSE: Record<Backing, string> = {
  jobs: "They'll come round if the depth chart moves like you said it would.",
  move: "If a starter comes in before the deadline, they'll believe the next one.",
  words: '',
  talks: '',
  snaps: '',
  feud: '',
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
