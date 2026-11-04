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
  if (share >= 0.95)
    return group === 'them'
      ? 'all of them'
      : SINGULAR.has(group)
        ? `the whole ${group.replace(/^the /, '')}`
        : `all of ${group}`;
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
  deal: 'want a new deal',
  losing: 'are wearing the losing',
  feud: 'are caught up in a feud',
};
/** The same for one man ("one of them wants more snaps"). */
const FEEL_ONE: Record<Cause, string> = {
  snaps: 'wants more snaps',
  deal: 'wants a new deal',
  losing: 'is wearing the losing',
  feud: 'is caught up in a feud',
};
/** "Two of them want more snaps", "One of them wants more snaps", "Half the line think they're underpaid". */
const feelFor = (cause: Cause, count: string) => `${cap(count)} ${(/^one\b/.test(count) ? FEEL_ONE : FEEL)[cause]}`;

/** How many feel one of a unit's reasons, as a coach counts: "two of them", "half the line". */
export const countOf = (n: number, total: number, unit: string): string =>
  n <= 4 ? `${inWords(n)} of them` : coachCount(n, total, unit);

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
  /** Which of his seasons the report is about, counting from 0: at the season's end, the one just finished. */
  yearOf: number;
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

const SINGULAR = new Set(['the line', 'the D-line', 'the secondary', 'the room', 'the passing game']);
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
/** "The line is", "The receivers are", with "still" when it's still so. */
const isAre = (unit: string, still = false) => `${SINGULAR.has(unit) ? 'is' : 'are'}${still ? ' still' : ''}`;
const U = (f: { unit: string; still?: boolean }) => `${cap(f.unit)} ${isAre(f.unit, f.still)}`;
const looks = (unit: string) => (SINGULAR.has(unit) ? 'looks' : 'look');
const listens = (unit: string) => (SINGULAR.has(unit) ? 'listens' : 'listen');
/** "Hill's" for "Hill is", but "Owens is", "Chavez is": a contraction after a name ending in a hiss doesn't read. */
const HISS = /[sxz]$/i;
const isOf = (name: string | null) => (HISS.test(name ?? '') ? `${name} is` : `${name}'s`);
const hasOf = (name: string | null) => (HISS.test(name ?? '') ? `${name} has` : `${name}'s`);
const yearsIn = (n: number) => `${cap(inWords(n))} years`;
const ordinal = (experience: number) => ORDINAL[experience] ?? 'Another';
const feel = (f: UnitFact) => (f.cause ? `${feelFor(f.cause, f.causeCount ?? 'some of them')}.` : '');

// ───────── the head coach on a unit (the report's rows) ─────────

const word = (w: UnitWord) => (f: UnitFact) => f.word === w;
/** How a room is, after "is"/"are": the screen's words in a coach's mouth. */
const ADJ: Record<UnitWord, string> = {
  Tight: 'in a good place',
  Settled: 'steady',
  Restless: 'a little restless',
  Down: 'down',
  Split: 'divided',
};
/** "The D-line has", "The receivers have". */
const has_ = (unit: string) => `${cap(unit)} ${SINGULAR.has(unit) ? 'has' : 'have'}`;

/**
 * The head coach on one room, a row of his report: a short, flat sentence on how it is, then the fact behind it when
 * there is one. "Divided", never "split", so the letter and the screen use one word.
 */
export const UNIT_NOTE: readonly Line<UnitFact>[] = [
  // Divided
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
      `${U(f)} divided. ${f.setter} thinks ${f.rival} took his job, and he says so. The younger guys are with ${f.rival}.`,
  },
  {
    when: (f) => f.word === 'Split' && !!f.setter && f.pulling === 'down' && f.cause === 'snaps' && !!f.rival,
    reads: 4,
    text: (f) => `${U(f)} divided. ${f.setter} wants ${f.rival}'s job.`,
  },
  {
    when: (f) => f.word === 'Split' && !!f.setter && f.setterSound === 'stirs' && !!f.cause,
    reads: 3,
    text: (f) => `${U(f)} divided, and ${f.setter} is doing the talking. It's about ${TOPIC[f.cause!]}.`,
  },
  {
    when: (f) => f.word === 'Split' && !!f.setter && f.setterSound === 'steadies' && f.pulling !== 'down',
    reads: 3,
    text: (f) => `${U(f)} divided, but ${f.setter} is staying even about it.`,
  },
  {
    when: (f) => f.word === 'Split' && !!f.setter && f.pulling === 'down',
    reads: 2,
    text: (f) => `${U(f)} divided, and ${f.setter} is on the unhappy side of it.`,
  },
  { when: (f) => f.word === 'Split' && !!f.cause, reads: 2, text: (f) => `${U(f)} divided. ${feel(f)}` },
  { when: (f) => f.word === 'Split' && f.still, reads: 1, text: (f) => `${U(f)} divided. Same as last time.` },
  { when: word('Split'), text: (f) => `${U(f)} divided. I'm keeping an eye on it.` },
  { when: word('Split'), text: (f) => `${U(f)} divided right now. I'm watching it.` },

  // Down
  {
    when: (f) => f.word === 'Down' && !!f.setter && f.setterSound === 'steadies' && f.pulling !== 'down',
    reads: 3,
    text: (f) => `${U(f)} down, but ${f.setter} is staying positive.`,
  },
  {
    when: (f) => f.word === 'Down' && !!f.setter && f.setterSound === 'stirs' && f.pulling === 'down',
    reads: 3,
    text: (f) => `${U(f)} down, and ${f.setter} is the loudest about it.`,
  },
  {
    when: (f) => f.word === 'Down' && f.cause === 'losing',
    reads: 2,
    text: (f) => `${U(f)} down. The losing's getting to them.`,
  },
  { when: (f) => f.word === 'Down' && !!f.cause, reads: 2, text: (f) => `${U(f)} down. ${feel(f)}` },
  { when: word('Down'), text: (f) => `${U(f)} down right now.` },
  { when: word('Down'), text: (f) => `${U(f)} down. It shows in the meetings.` },

  // In a good place
  {
    when: (f) => f.word === 'Tight' && f.losingRun >= 3 && !!f.setter,
    reads: 3,
    text: (f) =>
      `${cap(inWords(f.losingRun))} losses in a row and ${f.unit} ${SINGULAR.has(f.unit) ? "hasn't" : "haven't"} blinked. ${f.setter} sets the tone.`,
  },
  {
    when: (f) => f.word === 'Tight' && f.setterCaptain && !!f.setter,
    reads: 3,
    text: (f) => `${U(f)} in a good place, and ${isOf(f.setter)} the reason.`,
  },
  { when: (f) => f.word === 'Tight' && f.turned, reads: 2, text: (f) => `${has_(f.unit)} come together. Good to see.` },
  {
    when: (f) => f.word === 'Tight' && !!f.setter && f.pulling === 'up',
    reads: 2,
    text: (f) => `${U(f)} in a good place, and ${isOf(f.setter)} a big part of it.`,
  },
  { when: word('Tight'), text: (f) => `${U(f)} in a good place.` },
  { when: word('Tight'), text: (f) => `No complaints from ${f.unit}.` },

  // A little restless
  {
    when: (f) => f.word === 'Restless' && !!f.setter && f.setterSound === 'stirs' && f.pulling === 'down',
    reads: 3,
    text: (f) => `${U(f)} a little restless, and ${f.setter} is the loudest about it.`,
  },
  { when: (f) => f.word === 'Restless' && !!f.cause, reads: 2, text: (f) => `${U(f)} a little restless. ${feel(f)}` },
  { when: word('Restless'), text: (f) => `${U(f)} a little restless. Nothing I'd call trouble.` },
  { when: word('Restless'), text: (f) => `Some grumbling from ${f.unit}. Not a problem yet.` },

  // Steady
  {
    when: (f) => f.word === 'Settled' && f.turned && (f.was === 'Split' || f.was === 'Down' || f.was === 'Restless'),
    reads: 1,
    text: (f) => `${U(f)} back on an even keel.`,
  },
  {
    when: (f) => f.word === 'Settled' && f.turned && f.was === 'Tight',
    reads: 1,
    text: (f) => `${U(f)} steady. Not as close as ${SINGULAR.has(f.unit) ? 'it was' : 'they were'}, but nothing wrong.`,
  },
  { when: word('Settled'), text: (f) => `${U(f)} steady. Nothing to report.` },
  { when: word('Settled'), text: (f) => `Nothing new from ${f.unit}. Steady.` },

  // A leader who left and nobody in his place: said only when there's a man to name.
  {
    when: (f) => f.noVoice && !!f.goneLeader,
    reads: 4,
    text: (f) => `${U(f)} ${ADJ[f.word]}, and nobody's stepped up since ${f.goneLeader} left.`,
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
    text: (f) => `My guys are down, but ${f.setter} is staying positive.`,
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
    when: (f) => f.now === 'voice' && f.was === null && f.yearOf >= 1 && f.yearOf <= 2 && f.starts,
    reads: 3,
    text: (f) =>
      `${ordinal(f.yearOf)} year, starting, and ${f.unit} ${listens(f.unit)}. That came quicker than I expected.`,
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
  { when: has('starts'), reads: 1, text: () => 'Starts, and the room takes his lead.' },
  { when: has('starts'), reads: 1, text: () => 'On the field every week. When he talks, they listen.' },
  { when: has('starts'), reads: 1, text: (f) => `Earned it on the field. ${cap(f.unit)} ${listens(f.unit)}.` },
  { text: (f) => `His word carries with ${f.unit}.` },
];

/** For the verdict: "The line is", "The receivers are". */
export const unitIs = (unit: string) => `${cap(unit)} ${isAre(unit)}`;

// ───────── what stands out about a room (the Locker Room's cards) ─────────

/** A good reason as a room shares it: "four are close with each other". */
const SHARED: Record<string, [string, string]> = {
  'Close with his teammates': ['is close with the others', 'are close with each other'],
  'Enjoying his role': ['is enjoying his role', 'are enjoying their roles'],
  'Happy with his deal': ['is happy with his deal', 'are happy with their deals'],
  'Trusts your word': ['trusts your word', 'trust your word'],
  'Feels valued': ['feels valued', 'feel valued'],
  'Just got paid': ['just got paid', 'just got paid'],
};
const WINNING = 'Loving the winning';
/** A grievance on a card, in the mood board's own words: [one man, more]. */
const ON_CARD: Record<Cause, [string, string]> = {
  snaps: ['wants more snaps', 'want more snaps'],
  deal: ['wants a new deal', 'want a new deal'],
  losing: ['is tired of losing', 'are tired of losing'],
  feud: ['is caught up in a feud', 'are caught up in a feud'],
};

/**
 * The one line a room's card says about it: a complaint first ("Two want a new deal."), then something this room
 * feels that the rest of the team doesn't, then a happy room that only has the winning ("Winning keeps them happy."),
 * else nothing to flag. What the whole team feels (the winning, mostly) is the Morale card's, not a room's.
 */
export function standsOut(
  room: { members: number; mood: number; reasons: { text: string; count: number }[] },
  team: { size: number; reasons: { text: string; count: number }[] },
): string {
  const who = (n: number) => cap(n <= 4 ? inWords(n) : coachCount(n, room.members));
  // A grievance two men share, or one man's in a room of three.
  const gripe = room.reasons.find((r) => causeOf(r.text) && (r.count >= 2 || room.members <= 3));
  if (gripe) {
    const cause = causeOf(gripe.text)!;
    return `${who(gripe.count)} ${ON_CARD[cause][gripe.count === 1 ? 0 : 1]}.`;
  }
  const teamShare = (text: string) => (team.reasons.find((r) => r.text === text)?.count ?? 0) / Math.max(1, team.size);
  const own = room.reasons.find(
    (r) => SHARED[r.text] && r.count >= 2 && r.count / Math.max(1, room.members) - teamShare(r.text) >= 0.25,
  );
  if (own) return `${who(own.count)} ${SHARED[own.text][own.count === 1 ? 0 : 1]}.`;
  if (room.mood >= 5 && room.reasons[0]?.text === WINNING) return 'Winning keeps them happy.';
  return 'Nothing to flag.';
}

// ───────── chemistry (L3) ─────────

/** What a chemistry line may read: the room's word and the reasons behind it, all from what our staff see. */
export interface ChemFact {
  unit: string;
  word: 'Clicking' | 'Gelling' | 'Still learning each other' | 'Out of sync';
  /** Seasons the room's starters have played together, on average; null where it doesn't count. */
  years: number | null;
  newStarters: number;
  split: boolean;
  comfortable: boolean;
  /** The room's Spark (a voice whose mood spreads), and whether he's sour. */
  spark?: { last: string; sour: boolean };
  /** An Anchor in the room. */
  anchor?: string;
}

/** "The line's", "The receivers are". */
const unitIs_ = (unit: string) => `${cap(unit)}${SINGULAR.has(unit) ? "'s" : ' are'}`;
/** Where a room's new men line up, the way a coach says it. */
const where = (unit: string) =>
  unit === 'the secondary' ? 'back there' : unit === 'the line' || unit === 'the D-line' ? 'up front' : 'out there';
const starters_ = (n: number) => `${inWords(n)} new starter${n === 1 ? '' : 's'}`;
const yearsTogether = (y: number) => `${inWords(Math.floor(y))} years together`;
const feeling = (unit: string) => `${cap(unit)}${SINGULAR.has(unit) ? "'s" : "'re"} feeling it`;

export const CHEM_NOTE: readonly Line<ChemFact>[] = [
  {
    when: (f) => f.word === 'Clicking' && (f.years ?? 0) >= 2,
    reads: 2,
    text: (f) => `${unitIs_(f.unit)} clicking. ${cap(yearsTogether(f.years!))} shows.`,
  },
  {
    when: (f) => f.word === 'Clicking' && !!f.anchor,
    reads: 2,
    text: (f) => `${unitIs_(f.unit)} clicking, and ${f.anchor} keeps them steady.`,
  },
  { when: (f) => f.word === 'Clicking', reads: 1, text: (f) => `${unitIs_(f.unit)} clicking right now.` },
  {
    when: (f) => f.word === 'Out of sync' && !!f.spark?.sour,
    reads: 3,
    text: (f) => `${isOf(f.spark!.last)} sour, and he's a spark. ${feeling(f.unit)}.`,
  },
  {
    when: (f) => f.word === 'Out of sync' && f.split,
    reads: 2,
    text: (f) => `${unitIs_(f.unit)} out of sync. When a room's divided, it shows on the field.`,
  },
  {
    when: (f) => f.word === 'Out of sync' && f.newStarters >= 2,
    reads: 2,
    text: (f) => `${unitIs_(f.unit)} out of sync. ${cap(starters_(f.newStarters))}, and it shows.`,
  },
  { when: (f) => f.word === 'Out of sync', reads: 1, text: (f) => `${unitIs_(f.unit)} out of sync right now.` },
  {
    when: (f) => f.word === 'Still learning each other' && f.newStarters >= 1,
    reads: 2,
    text: (f) => `${U(f)} still learning each other. ${cap(starters_(f.newStarters))} ${where(f.unit)}.`,
  },
  { when: (f) => f.word === 'Still learning each other', reads: 1, text: (f) => `${U(f)} still learning each other.` },
  {
    when: (f) => f.word === 'Gelling' && f.comfortable,
    reads: 2,
    text: (f) => `${unitIs_(f.unit)} comfortable. Winning does that.`,
  },
  {
    when: (f) => f.word === 'Gelling' && !!f.anchor,
    reads: 1,
    text: (f) => `${unitIs_(f.unit)} gelling. ${isOf(f.anchor!)} holding them together.`,
  },
  { text: (f) => `${unitIs_(f.unit)} gelling.` },
];

/** The Locker Room card's short reason beside the word; empty when nothing stands out. */
export const CHEM_REASON: readonly Line<ChemFact>[] = [
  { when: (f) => f.word === 'Clicking' && (f.years ?? 0) >= 2, reads: 3, text: (f) => yearsTogether(f.years!) },
  { when: (f) => !!f.spark?.sour && f.word === 'Out of sync', reads: 3, text: (f) => `${isOf(f.spark!.last)} sour` },
  { when: (f) => f.split && f.word === 'Out of sync', reads: 2, text: () => 'divided room' },
  {
    when: (f) => f.newStarters >= 1 && (f.word === 'Still learning each other' || f.word === 'Out of sync'),
    reads: 2,
    text: (f) => starters_(f.newStarters),
  },
  { when: (f) => f.comfortable, reads: 1, text: () => 'comfortable' },
  {
    when: (f) => !!f.anchor && f.word !== 'Out of sync',
    reads: 1,
    text: (f) => `${isOf(f.anchor!)} holding them together`,
  },
  { text: () => '' },
];

// ───────── backing the staff (L4): a room's belief in whoever runs its side ─────────

/** What a belief line may read: the room, its read of the man running its side, and a lawyer voice stirring it. */
export interface BeliefFact {
  unit: string;
  read: 'believes' | 'steady' | 'doubts' | 'lost';
  /** The coordinator's (or the head coach's) last name. */
  coach: string;
  side: 'offense' | 'defense';
  lawyer?: string;
}
/** "the receivers' ears", "the line's ears". */
const ears = (unit: string) => `${unit}${unit.endsWith('s') ? "'" : "'s"} ears`;
const calls = (f: BeliefFact) => (f.side === 'offense' ? 'the play-calling' : 'the calls');

/** The position coach's warning in the staff notes, before the room reads in doubt: the room has started to slip. */
export const BELIEF_WARN: readonly Line<BeliefFact>[] = [
  {
    when: (f) => !!f.lawyer,
    reads: 2,
    text: (f) => `${f.lawyer} has been in ${ears(f.unit)} about ${calls(f)} since Sunday.`,
  },
  {
    reads: 1,
    text: (f) =>
      `${cap(f.unit)} ${SINGULAR.has(f.unit) ? 'is' : 'are'} quieter in meetings with ${f.coach}. Nothing said yet.`,
  },
  { text: (f) => `I'm hearing some grumbling in ${f.unit} about ${calls(f)}. Nothing loud yet.` },
];

/** The head coach's report, when a room's read of the man running its side has changed since he last told it. */
export const BELIEF_NOTE: readonly Line<BeliefFact>[] = [
  {
    when: (f) => f.read === 'lost' && !!f.lawyer,
    reads: 3,
    text: (f) => `${f.coach} has lost ${f.unit}, and ${f.lawyer} made sure of it.`,
  },
  { when: (f) => f.read === 'lost', reads: 2, text: (f) => `${f.coach} has lost ${f.unit}.` },
  {
    when: (f) => f.read === 'doubts' && !!f.lawyer,
    reads: 3,
    text: (f) => `${has_(f.unit)} doubts about ${f.coach}'s calls, and ${isOf(f.lawyer!)} stirring it.`,
  },
  { when: (f) => f.read === 'doubts', reads: 2, text: (f) => `${has_(f.unit)} doubts about ${f.coach}'s calls.` },
  {
    when: (f) => f.read === 'believes',
    reads: 2,
    text: (f) => `${cap(f.unit)} ${SINGULAR.has(f.unit) ? 'believes' : 'believe'} in ${f.coach}.`,
  },
  { text: (f) => `${U(f)} back on board with ${f.coach}.` },
];

/** The Locker Room card's line, when there's something to say. */
export const BELIEF_LINE: readonly Line<BeliefFact>[] = [
  { when: (f) => f.read === 'lost', reads: 2, text: (f) => `${f.coach} has lost them` },
  {
    when: (f) => f.read === 'doubts' && !!f.lawyer,
    reads: 3,
    text: (f) => `Doubts about ${f.coach}'s calls · ${isOf(f.lawyer!)} stirring it`,
  },
  { when: (f) => f.read === 'doubts', reads: 2, text: (f) => `Doubts about ${f.coach}'s calls` },
  { when: (f) => f.read === 'believes', reads: 2, text: (f) => `Believe in ${f.coach}` },
  { text: () => '' },
];

/** The Coaches screen's line on one of our coordinators: how his rooms take him, rooms grouped by read. */
export function beliefStaffLine(facts: readonly BeliefFact[]): string {
  const by = (r: BeliefFact['read']) => facts.filter((f) => f.read === r).map((f) => f.unit);
  const list = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`);
  const parts: string[] = [];
  const believe = by('believes');
  const doubt = by('doubts');
  const lost = by('lost');
  if (believe.length)
    parts.push(`${list(believe)} ${believe.length === 1 && SINGULAR.has(believe[0]) ? 'believes' : 'believe'} in him`);
  if (doubt.length)
    parts.push(`${list(doubt)} ${doubt.length === 1 && SINGULAR.has(doubt[0]) ? 'has' : 'have'} doubts`);
  if (lost.length) parts.push(`he's lost ${list(lost)}`);
  return parts.length ? `${cap(parts.join('; '))}.` : '';
}

/** The report's and the card's short read of a room's belief, in the screen's own words. */
export const BELIEF_WORD: Record<BeliefFact['read'], string> = {
  believes: 'Believe in him',
  steady: 'Back on board',
  doubts: 'Doubts',
  lost: 'Lost them',
};
