/**
 * The words for the room (docs/superpowers/specs/2026-11-01-locker-room-voices-design.md §6): how each unit is
 * feeling, who found his voice or lost it, why the room goes to a man, and the position coach's note on his own guys.
 * Each bank is a set of lines with conditions on what our staff can see; the most specific that fits wins
 * (`voice.ts`). The head coach is short and dry and talks about the whole room; a position coach talks about his own
 * guys in the first person. Facts are words and flags only (`roomFacts.ts` builds them), never a player or a number
 * a screen mustn't show. Our own lines, never anyone's quotes; no digits; no term from the engine.
 */
import type { Sound, Tier, Unit, UnitWord, WhyPart } from './standing';
import type { Line } from './voice';

export const UNIT_PHRASE: Record<Exclude<Unit, 'ST'>, string> = {
  QB: 'the quarterbacks',
  RB: 'the backs',
  WR: 'the receivers',
  OL: 'the line',
  DL: 'the D-line',
  LB: 'the linebackers',
  DB: 'the secondary',
};
export const SPECIALISTS = 'the specialists';

const NUMBER = [
  'no',
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
];
const ORDINAL = ['First', 'Second', 'Third', 'Fourth', 'Fifth', 'Sixth', 'Seventh', 'Eighth', 'Ninth', 'Tenth'];

/** A number the way a coach says it: in words, never digits. */
export const inWords = (n: number): string => NUMBER[Math.max(0, Math.round(n))] ?? 'a lot of';

/** How many, the way a coach counts: up to four by name, past that a share of the group. */
export function coachCount(n: number, total: number, group = 'them'): string {
  if (n <= 4) return inWords(n);
  const share = n / Math.max(1, total);
  const of = group === 'them' ? 'of them' : group;
  if (share >= 0.95) return group === 'them' ? 'all of them' : `the whole ${group.replace(/^the /, '')}`;
  if (share >= 0.6) return `most ${group === 'them' ? 'of them' : `of ${group}`}`;
  if (share >= 0.4) return `half ${of}`;
  return 'several of them';
}

export type Cause = 'snaps' | 'deal' | 'losing' | 'feud';
const CAUSES: Record<string, Cause> = {
  'Wants more snaps': 'snaps',
  'Waiting on his snaps': 'snaps',
  'Still stung by the benching': 'snaps',
  'Wants a new deal': 'deal',
  'Waiting on his new deal': 'deal',
  'Noticed who got paid': 'deal',
  'The losing is wearing on him': 'losing',
  'A feud in the room': 'feud',
};
/** What a mood board phrase is about, when it's a grievance a coach would name. */
export const causeOf = (reason: string): Cause | null => CAUSES[reason] ?? null;

/** The grievance in the players' own terms, after "two of them". */
const FEEL: Record<Cause, string> = {
  snaps: 'want more snaps',
  deal: "think they're underpaid",
  losing: 'are wearing the losing',
  feud: 'are caught up in a feud',
};
/** The same for one man ("one of them wants more snaps"). */
const FEEL_ONE: Record<Cause, string> = {
  snaps: 'wants more snaps',
  deal: "thinks he's underpaid",
  losing: 'is wearing the losing',
  feud: 'is caught up in a feud',
};
/** "Two of them want more snaps", "One of them wants more snaps", "Half the line think they're underpaid". */
const feelFor = (cause: Cause, count: string) => `${cap(count)} ${(/^one\b/.test(count) ? FEEL_ONE : FEEL)[cause]}`;

/** How many feel one of a unit's reasons, as a coach counts: "two of them", "half the line". */
export const countOf = (n: number, total: number, unit: string): string =>
  n <= 4 ? `${inWords(n)} of them` : coachCount(n, total, unit);

/** The Locker Room's "what's going on" for a unit: its most-felt reason, counted. */
export function goingOn(reason: { text: string; count: number }, total: number, unit: string): string {
  const count = countOf(reason.count, total, unit);
  const cause = causeOf(reason.text);
  return cause ? `${feelFor(cause, count)}.` : `${reason.text}: ${count}.`;
}

/** What it's about, after "It's about". */
const TOPIC: Record<Cause, string> = { snaps: 'snaps', deal: 'money', losing: 'the losing', feud: 'a feud' };

export interface UnitFact {
  /** `UNIT_PHRASE`: "the receivers". */
  unit: string;
  word: UnitWord;
  /** The same read was told last time. */
  still: boolean;
  /** The read changed since it was last told. */
  turned: boolean;
  /** The read last told, when there was one. */
  was: UnitWord | null;
  /** Who sets the tone, by last name. */
  setter: string | null;
  setterCaptain: boolean;
  setterSound: Sound | null;
  pulling: 'up' | 'down' | 'even' | null;
  /** The unit's most-felt grievance, and how many feel it ("two of them", "half the line"). */
  cause: Cause | null;
  causeCount: string | null;
  /** Split: the happy side is mostly the young guys. */
  upYoung: boolean;
  /** The starter whose job the down tone-setter wants, by last name. */
  rival: string | null;
  /** The club's losing streak (0 when it isn't on one). */
  losingRun: number;
  noVoice: boolean;
  /** A leader of this unit who has left the club since it was last told. */
  goneLeader: string | null;
  /** A young man close to finding his voice. */
  nearVoice: string | null;
}

export interface StandingFact {
  name: string;
  now: Tier | null;
  was: Tier | null;
  /** Seasons in the league (0 for a rookie). */
  experience: number;
  newcomer: boolean;
  starts: boolean;
  captain: boolean;
  /** Still stung by a benching. */
  benched: boolean;
  stirs: boolean;
  /** Our read of him is a name that warns (a Locker-Room Lawyer, a Diva…): the room can see he stirs. */
  warn: boolean;
  unit: string;
}

export interface WhyFact {
  parts: WhyPart[];
  experience: number;
  unit: string;
}

// ───────── grammar ─────────

const SINGULAR = new Set(['the line', 'the D-line', 'the secondary', 'the room']);
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
/** "The line is", "The receivers are", with "still" when it's still so. */
const isAre = (unit: string, still = false) => `${SINGULAR.has(unit) ? 'is' : 'are'}${still ? ' still' : ''}`;
const U = (f: { unit: string; still?: boolean }) => `${cap(f.unit)} ${isAre(f.unit, f.still)}`;
const looks = (unit: string) => (SINGULAR.has(unit) ? 'looks' : 'look');
const listens = (unit: string) => (SINGULAR.has(unit) ? 'listens' : 'listen');
const it = (unit: string) => (SINGULAR.has(unit) ? 'it' : 'them');
/** "Hill's" for "Hill is", but "Owens is", "Chavez is": a contraction after a name ending in a hiss doesn't read. */
const HISS = /[sxz]$/i;
const isOf = (name: string | null) => (HISS.test(name ?? '') ? `${name} is` : `${name}'s`);
const hasOf = (name: string | null) => (HISS.test(name ?? '') ? `${name} has` : `${name}'s`);
const yearsIn = (n: number) => `${cap(inWords(n))} years`;
const ordinal = (experience: number) => ORDINAL[experience] ?? 'Another';
const feel = (f: UnitFact) => (f.cause ? `${feelFor(f.cause, f.causeCount ?? 'some of them')}.` : '');

// ───────── the head coach on a unit (the report's rows) ─────────

const word = (w: UnitWord) => (f: UnitFact) => f.word === w;
const ADJ: Record<UnitWord, string> = {
  Tight: 'a tight group',
  Settled: 'steady',
  Restless: 'a little restless',
  Down: 'down',
  Split: 'split',
};

export const UNIT_NOTE: readonly Line<UnitFact>[] = [
  // Split
  {
    when: (f) =>
      f.word === 'Split' &&
      !!f.setter &&
      f.setterSound === 'stirs' &&
      f.pulling === 'down' &&
      f.cause === 'snaps' &&
      !!f.rival &&
      f.upYoung,
    reads: 5,
    text: (f) =>
      `${U(f)} split. ${f.setter} thinks ${f.rival} took his job, and he isn't keeping it to himself. ${hasOf(f.rival)} got the younger guys.`,
  },
  {
    when: (f) => f.word === 'Split' && !!f.setter && f.pulling === 'down' && f.cause === 'snaps' && !!f.rival,
    reads: 4,
    text: (f) => `${U(f)} split. ${f.setter} thinks the job should be his, not ${f.rival}'s.`,
  },
  {
    when: (f) => f.word === 'Split' && !!f.setter && f.setterSound === 'stirs' && !!f.cause,
    reads: 3,
    text: (f) => `${U(f)} split, and ${isOf(f.setter)} doing the talking. It's about ${TOPIC[f.cause!]}.`,
  },
  {
    when: (f) => f.word === 'Split' && !!f.setter && f.setterSound === 'steadies' && f.pulling !== 'down',
    reads: 3,
    text: (f) => `${U(f)} split, but ${f.setter} is keeping it civil.`,
  },
  {
    when: (f) => f.word === 'Split' && !!f.setter && f.pulling === 'down',
    reads: 2,
    text: (f) => `${U(f)} split. ${isOf(f.setter)} on one side of it.`,
  },
  {
    when: (f) => f.word === 'Split' && !!f.cause,
    reads: 2,
    text: (f) => `${U(f)} split. ${feel(f)}`,
  },
  {
    when: (f) => f.word === 'Split' && f.still,
    reads: 1,
    text: (f) => `${U(f)} split. Same story as last time.`,
  },
  { when: word('Split'), text: (f) => `${U(f)} split. I'm keeping an eye on it.` },
  { when: word('Split'), text: (f) => `${U(f)} split down the middle. I'm watching it.` },

  // Down
  {
    when: (f) => f.word === 'Down' && !!f.setter && f.setterSound === 'steadies' && f.pulling !== 'down',
    reads: 3,
    text: (f) => `${U(f)} down, but ${f.setter} is holding them together.`,
  },
  {
    when: (f) => f.word === 'Down' && !!f.setter && f.setterSound === 'stirs' && f.pulling === 'down',
    reads: 3,
    text: (f) => `${U(f)} down, and ${f.setter} isn't helping.`,
  },
  {
    when: (f) => f.word === 'Down' && f.cause === 'losing',
    reads: 2,
    text: (f) => `${U(f)} down. Losing does that.`,
  },
  {
    when: (f) => f.word === 'Down' && !!f.cause,
    reads: 2,
    text: (f) => `${U(f)} down. ${feel(f)}`,
  },
  { when: word('Down'), text: (f) => `${U(f)} down. Nobody in there is enjoying it right now.` },
  { when: word('Down'), text: (f) => `${U(f)} down, and it shows in the meetings.` },

  // Tight
  {
    when: (f) => f.word === 'Tight' && f.losingRun >= 3 && !!f.setter,
    reads: 3,
    text: (f) => `${cap(inWords(f.losingRun))} losses in a row and ${f.unit} hasn't blinked. ${f.setter} won't let it.`,
  },
  {
    when: (f) => f.word === 'Tight' && f.setterCaptain && !!f.setter,
    reads: 3,
    text: (f) => `${U(f)} a tight group. That's ${f.setter}. They'd follow him anywhere.`,
  },
  {
    when: (f) => f.word === 'Tight' && f.turned,
    reads: 2,
    text: (f) => `${cap(f.unit)} came together this month. Nobody planned it.`,
  },
  {
    when: (f) => f.word === 'Tight' && !!f.setter && f.pulling === 'up',
    reads: 2,
    text: (f) => `${U(f)} in a good place, and ${f.setter} is a big part of it.`,
  },
  { when: word('Tight'), text: (f) => `${U(f)} a tight group right now.` },
  { when: word('Tight'), text: (f) => `No complaints from ${f.unit}. ${cap(isAre(f.unit))} a tight group.` },

  // Restless
  {
    when: (f) => f.word === 'Restless' && !!f.setter && f.setterSound === 'stirs' && f.pulling === 'down',
    reads: 3,
    text: (f) => `${U(f)} a little restless, and ${f.setter} is the loudest about it.`,
  },
  {
    when: (f) => f.word === 'Restless' && !!f.cause,
    reads: 2,
    text: (f) => `${U(f)} a little restless. ${feel(f)}`,
  },
  { when: word('Restless'), text: (f) => `${U(f)} a little restless. Not a problem yet.` },
  { when: word('Restless'), text: (f) => `Some grumbling from ${f.unit}. Nothing I'd call trouble yet.` },

  // Settled
  {
    when: (f) => f.word === 'Settled' && f.turned && (f.was === 'Split' || f.was === 'Down' || f.was === 'Restless'),
    reads: 1,
    text: (f) => `${U(f)} back on an even keel.`,
  },
  {
    when: (f) => f.word === 'Settled' && f.turned && f.was === 'Tight',
    reads: 1,
    text: (f) => `${U(f)} steady. Not as tight as it was, but nothing wrong.`,
  },
  { when: word('Settled'), text: (f) => `${U(f)} steady. Nothing to report.` },
  { when: word('Settled'), text: (f) => `Nothing new from ${f.unit}. Steady.` },

  // No voice of its own: said whatever the read, once the read itself has nothing sharper to say.
  {
    when: (f) => f.noVoice && !!f.goneLeader && f.word !== 'Split',
    reads: 3,
    text: (f) => `${U(f)} ${ADJ[f.word]}, but nobody's taken charge since ${f.goneLeader} left.`,
  },
  {
    when: (f) => f.noVoice && !!f.nearVoice && f.word !== 'Split' && f.word !== 'Down',
    reads: 2,
    text: (f) =>
      `${U(f)} ${ADJ[f.word]}. No one in there has the room yet; ${f.nearVoice} might, give him another year.`,
  },
  {
    when: (f) => f.noVoice && (f.word === 'Settled' || f.word === 'Restless'),
    reads: 1,
    text: (f) => `${U(f)} ${ADJ[f.word]}, and nobody in there has taken charge yet.`,
  },
];

// ───────── the position coach on his own guys (the weekly staff notes) ─────────

export const UNIT_TURN: readonly Line<UnitFact>[] = [
  {
    when: (f) => f.word === 'Split' && !!f.setter && f.pulling === 'down' && f.cause === 'snaps' && !!f.rival,
    reads: 4,
    text: (f) => `My room's split. ${f.rival} has the job and ${f.setter} doesn't think he earned it.`,
  },
  {
    when: (f) => f.word === 'Split' && !!f.setter && f.setterSound === 'stirs' && f.pulling === 'down',
    reads: 3,
    text: (f) => `My room's split, and ${f.setter} is saying it out loud. I'm watching it.`,
  },
  {
    when: (f) => f.word === 'Split' && !!f.cause,
    reads: 2,
    text: (f) => `My room's split. ${feel(f)} I'm watching it.`,
  },
  { when: word('Split'), text: () => "My room's split right now. I wanted you to hear it from me." },
  { when: word('Split'), text: () => "Heads up: my guys aren't on the same page this week." },

  {
    when: (f) => f.word === 'Down' && !!f.setter && f.setterSound === 'steadies' && f.pulling !== 'down',
    reads: 3,
    text: (f) => `My guys are down, but ${f.setter} is the one keeping them together.`,
  },
  {
    when: (f) => f.word === 'Down' && f.cause === 'losing',
    reads: 2,
    text: () => "My guys are down. The losing's getting to them.",
  },
  { when: (f) => f.word === 'Down' && !!f.cause, reads: 2, text: (f) => `My guys are down. ${feel(f)}` },
  { when: word('Down'), text: () => "My room's down this week. I wanted you to know." },
  { when: word('Down'), text: () => "Rough week in my room. They're down." },

  {
    when: (f) => f.word === 'Tight' && !!f.setter && f.pulling === 'up',
    reads: 2,
    text: (f) => `Good week in my room. ${hasOf(f.setter)} got them right.`,
  },
  { when: word('Tight'), text: () => "Good week in my room. They're a tight group right now." },
  { when: word('Tight'), text: () => "My guys are in a good place. Thought you'd want the good ones too." },

  // A unit only turns Settled or Restless in a note when it's coming back from Split or Down.
  { when: word('Settled'), text: () => "My room's back on an even keel." },
  { when: word('Settled'), text: () => "My guys have come back around. Steady again, I'd say." },
  { when: word('Restless'), text: () => "My room's calmer than it was. Still a little restless, but I'll take it." },
];

// ───────── a man who found his voice or lost it (the report's rows) ─────────

export const STANDING_NOTE: readonly Line<StandingFact>[] = [
  {
    when: (f) => f.now === 'leader' && f.newcomer && f.experience >= 6,
    reads: 3,
    text: (f) => `${yearsIn(f.experience)} in the league. He walked in and ${f.unit} made room for him.`,
  },
  {
    when: (f) => f.now === 'voice' && f.was === null && f.experience <= 2 && f.starts,
    reads: 3,
    text: (f) =>
      `${ordinal(f.experience)} year, starting, and ${f.unit} ${listens(f.unit)}. That came quicker than I expected.`,
  },
  {
    when: (f) => f.now === 'voice' && f.was === null && f.stirs && f.warn,
    reads: 3,
    text: (f) => `${hasOf(f.name)} got a following now. Not all of it's good.`,
  },
  {
    when: (f) => f.now === null && f.benched,
    reads: 3,
    text: (f) => `Since the benching, ${isOf(f.name)} not the voice he was.`,
  },
  {
    when: (f) => f.now === 'leader',
    reads: 2,
    text: (f) => `${hasOf(f.name)} become one of the guys the room goes to.`,
  },
  { when: (f) => f.now === 'leader', reads: 2, text: (f) => `${f.name} has the room now. They go to him.` },
  {
    when: (f) => f.now === 'voice' && f.was === 'leader',
    reads: 2,
    text: (f) => `${f.name} still has a say, but the room doesn't go to him the way it did.`,
  },
  {
    when: (f) => f.now === null && !f.starts,
    reads: 2,
    text: (f) => `${hasOf(f.name)} gone quiet. Happens when you're not on the field as much.`,
  },
  {
    when: (f) => f.now === 'voice',
    reads: 1,
    text: (f) => `${hasOf(f.name)} found his voice. ${cap(f.unit)} ${listens(f.unit)} when he talks.`,
  },
  {
    when: (f) => f.now === null,
    reads: 1,
    text: (f) => `${f.name} doesn't carry the room the way he did.`,
  },
  { text: (f) => `The room sees ${f.name} differently now.` },
];

// ───────── why the room goes to him (the Locker Room screen) ─────────

const has = (p: WhyPart) => (f: WhyFact) => f.parts.includes(p);

export const STANDING_WHY: readonly Line<WhyFact>[] = [
  {
    when: (f) => f.parts.includes('captain') && f.parts.includes('veteran'),
    reads: 2,
    text: (f) => `${yearsIn(f.experience)} in, and he wears the C.`,
  },
  {
    when: (f) => f.parts.includes('veteran') && f.parts.includes('starts'),
    reads: 2,
    text: (f) => `${yearsIn(f.experience)} in, starts, and ${f.unit} ${looks(f.unit)} to him.`,
  },
  {
    when: (f) => f.parts.includes('newcomer') && f.parts.includes('veteran'),
    reads: 2,
    text: (f) => `New here, but ${inWords(f.experience)} years in the league. His word carried from day one.`,
  },
  { when: has('captain'), reads: 1, text: () => 'Wears the C. The room made that call.' },
  { when: has('quarterback'), reads: 1, text: () => 'The starting quarterback. The offense goes where he goes.' },
  { when: has('honoured'), reads: 1, text: () => 'Has the honours to back it up. His word carries.' },
  { when: has('leads'), reads: 1, text: () => 'A natural leader. People listen when he talks.' },
  { when: has('newcomer'), reads: 1, text: () => 'New here, but his word already carries.' },
  {
    when: has('veteran'),
    reads: 1,
    text: (f) => `${yearsIn(f.experience)} in the league. The young guys listen.`,
  },
  {
    when: has('starts'),
    reads: 1,
    text: (f) => `A starter, and ${f.unit} ${looks(f.unit)} to him.`,
  },
  { text: (f) => `His word carries with ${f.unit}.` },
];

/** For the verdict: "as tight as I've seen it" or "them". */
export const pronounFor = it;
/** For the verdict: "The line is", "The receivers are". */
export const unitIs = (unit: string) => `${cap(unit)} ${isAre(unit)}`;
