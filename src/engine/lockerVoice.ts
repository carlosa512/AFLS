/**
 * The head coach's words for the locker room report (`lockerReport.ts`). Each bank is a set of lines with conditions on
 * what the staff can see; the most specific that fits wins (`voice.ts`). The register is a coach at the podium: short,
 * flat sentences, the room's business kept in the room, captains as the room's call. Our own lines, never anyone's
 * quotes. Personality names are our scouts' read; nothing here is a number or a trait.
 */
import type { Line } from './voice';

export type Checkin = 'camp' | 'cutdown' | 'deadline' | 'end';

const ORDINAL = ['First', 'Second', 'Third', 'Fourth', 'Fifth', 'Sixth', 'Seventh', 'Eighth', 'Ninth', 'Tenth'];
const yearOf = (experience: number) => ORDINAL[experience] ?? `${experience + 1}th`;
const COUNT = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine'];
const count = (n: number) => COUNT[n] ?? String(n);

// ───────── the verdict: the line a GM reads every report ─────────

export interface VerdictFact {
  checkin: Checkin;
  newFeuds: number;
  /** A feud told in an earlier report that's still on ("Dunn and Mack"), or null. */
  standing: string | null;
  lost: number;
  /** The first young player who lost his mentor, for "X needs a new voice". */
  lostName: string | null;
  /** Pairs not taking, or going the wrong way. */
  struggling: number;
  friends: number;
  grew: number;
}

const quiet = (f: VerdictFact) =>
  f.newFeuds === 0 && !f.standing && f.lost === 0 && f.struggling === 0 && f.friends === 0 && f.grew === 0;
const month = (c: Checkin) => (c === 'camp' ? 'the season' : c === 'cutdown' ? 'September' : 'the stretch run');

/** `motto: true` lines close with the coach's saying. */
export const VERDICT: readonly (Line<VerdictFact> & { motto?: true })[] = [
  {
    when: (f) => !!f.standing && f.newFeuds === 0,
    reads: 3,
    text: (f) =>
      `${f.standing} still aren't talking. Not on the field yet. If it gets there, you'll hear it from me before you hear it from SNN.`,
  },
  {
    when: (f) => f.newFeuds > 0 && f.lost > 0 && !!f.lostName,
    reads: 3,
    text: (f) =>
      `Mostly good. ${f.newFeuds === 1 ? 'One thing' : 'A couple of things'} on the line to watch, and ${f.lostName} needs a new voice.`,
  },
  {
    when: (f) => f.lost > 1,
    reads: 2,
    text: (f) => `The cuts took some teachers with them. ${count(f.lost)} young guys have new mentors to get used to.`,
  },
  {
    when: (f) => f.lost > 1,
    reads: 2,
    text: (f) =>
      `${count(f.lost)} of our young guys lost the vet bringing them along. That's the part of cut-down nobody sees.`,
  },
  {
    when: (f) => f.checkin === 'end' && f.grew > 0,
    reads: 2,
    text: () => 'Good year in the room. Some young guys grew up on us.',
  },
  {
    when: (f) => f.checkin === 'end' && f.grew > 0,
    reads: 2,
    text: () => "The best thing that happened this year didn't show up in the box score. A few of our kids grew up.",
  },
  { when: (f) => f.newFeuds > 0, reads: 1, text: () => "Room's fine, but there's friction to keep an eye on." },
  { when: (f) => f.newFeuds > 0, reads: 1, text: () => "One spot of friction in the room. It's being handled." },
  { when: (f) => f.struggling > 0, reads: 1, text: () => 'Most of the young guys are listening. Not all of them.' },
  {
    when: (f) => f.struggling > 0,
    reads: 1,
    text: () => "The mentoring is working for most of them. A couple of pairings aren't, and I'd change them.",
  },
  {
    when: (f) => f.friends > 0,
    reads: 1,
    text: () => "The room's coming together. You see it in the cafeteria before you see it on Sundays.",
  },
  {
    when: (f) => f.lost === 1 && !!f.lostName,
    reads: 1,
    text: (f) => `Good room. ${f.lostName} needs a new voice, that's all.`,
  },
  {
    when: (f) => f.checkin === 'camp',
    reads: 1,
    motto: true,
    text: () => 'Camp is open and the room has picked its leaders.',
  },
  { when: (f) => f.checkin === 'camp', reads: 1, motto: true, text: () => 'Pads on. The room knows who it follows.' },
  {
    when: (f) => quiet(f) && f.checkin !== 'end',
    motto: true,
    text: (f) => `Quiet room. The kind I like heading into ${month(f.checkin)}.`,
  },
  { when: quiet, motto: true, text: () => "Nothing to report from the room, and that's how I like it." },
  { when: quiet, motto: true, text: () => "Room's in good shape. Nobody's making my phone ring." },
  { when: quiet, motto: true, text: () => 'Quiet in the building. The guys are locked in.' },
  { text: () => 'Here is where the room stands.' },
];

// ───────── captains and leaders ─────────

export interface CaptainFact {
  role: 'offense' | 'defense' | 'specialTeams';
  experience: number;
  /** Our read of him (`personalityRead`), or null while we don't know him well enough. */
  read: string | null;
  tone: 'good' | 'warn' | 'neutral' | null;
  kicker: boolean;
  qb: boolean;
}

export const CAPTAIN_WHY: readonly Line<CaptainFact>[] = [
  {
    when: (f) => f.tone === 'warn',
    reads: 2,
    text: () => "The guys follow him. I'd rather they followed someone else, but that's the room's call.",
  },
  {
    when: (f) => f.experience <= 2,
    reads: 2,
    text: (f) => `${yearOf(f.experience)} year, I know, but the room already goes to him.`,
  },
  {
    when: (f) => f.experience >= 8,
    reads: 2,
    text: (f) => `${yearOf(f.experience)} year in the league. When he talks, the room goes quiet.`,
  },
  { when: (f) => f.kicker, reads: 2, text: () => "He's out there on every kick. The core guys trust him." },
  { when: (f) => f.qb, reads: 1, text: () => 'The ball is in his hands every snap. The huddle is his.' },
  {
    when: (f) => f.role === 'specialTeams',
    reads: 1,
    text: () => 'Core special-teamer. Does the dirty work and the guys see it.',
  },
  {
    when: (f) => f.experience >= 5,
    reads: 1,
    text: () => "He's seen enough football to know what matters. The young guys watch him.",
  },
  { when: (f) => !!f.read, reads: 1, text: (f) => `Our read on him is "${f.read}". The vote says the same.` },
  { text: () => "The guys voted. He's the one they listen to." },
];

// ───────── mentoring ─────────

export interface LostFact {
  name: string;
  mentor: string;
  /** His new mentor's full name, or null while he waits. */
  now: string | null;
  byYou: boolean;
}

export const MENTOR_LOST: readonly Line<LostFact>[] = [
  {
    when: (f) => !!f.now,
    reads: 1,
    text: (f) =>
      `With ${f.mentor} gone, ${f.name} lost the guy bringing him along. We've put him with ${f.now} for now.`,
  },
  {
    when: (f) => !!f.now,
    reads: 1,
    text: (f) => `${f.mentor} leaving hit ${f.name} harder than people think. ${f.now} has him now.`,
  },
  {
    when: (f) => !f.now && f.byYou,
    reads: 1,
    text: (f) => `${f.name} needs a new mentor. Your call: pick one on the Locker Room screen.`,
  },
  { when: (f) => !f.now, text: (f) => `${f.name} lost ${f.mentor}. We'll find him someone in the room.` },
];

export interface SuggestFact {
  name: string;
  mentor: string;
  better: string;
  status: 'not taking' | 'picking up his bad habits';
}

export const MENTOR_SUGGEST: readonly Line<SuggestFact>[] = [
  {
    when: (f) => f.status === 'picking up his bad habits',
    reads: 1,
    text: (f) =>
      `${f.name} is picking up the wrong things from ${f.mentor}. I'd move him to ${f.better} before it sticks.`,
  },
  {
    when: (f) => f.status === 'not taking',
    reads: 1,
    text: (f) =>
      `${f.name} isn't hearing ${f.mentor}. Wrong voice for him. ${f.better} has the patience; I'd pair them.`,
  },
  {
    when: (f) => f.status === 'not taking',
    reads: 1,
    text: (f) => `It's not clicking between ${f.name} and ${f.mentor}. ${f.better} would be my pick.`,
  },
];

// ───────── friction and getting along ─────────

export const FRICTION_LEAD: readonly Line<{ n: number }>[] = [
  {
    text: () => "It's handled. If it ever gets onto the field, you'll hear it from me before you hear it from SNN.",
  },
  { text: () => "We'll handle it in-house. It hasn't touched practice." },
  { text: () => "I've talked to both sides. Nothing on the field yet." },
];

export interface FeudFact {
  why?: 'benched' | 'snubbed';
}

export const FRICTION: readonly Line<FeudFact>[] = [
  { when: (f) => f.why === 'benched', reads: 1, text: () => 'It started when the job changed hands.' },
  { when: (f) => f.why === 'benched', reads: 1, text: () => 'Started with the depth chart. It usually does.' },
  { when: (f) => f.why === 'snubbed', reads: 1, text: () => 'It started with the new contract.' },
  { when: (f) => f.why === 'snubbed', reads: 1, text: () => 'Money. One got paid and the other noticed.' },
  { text: () => "Nobody's said what started it. It's in the room, so you should know." },
  { text: () => "Couldn't tell you how it started. They just don't get along." },
];

export interface FriendFact {
  a: string;
  b: string;
  /** For a friend who left us this season: how. */
  gone?: 'cut' | 'traded';
}

export const GETTING_ALONG: readonly Line<FriendFact>[] = [
  {
    when: (f) => !!f.gone,
    reads: 1,
    text: (f) =>
      `${f.a} took ${f.b}'s ${f.gone === 'cut' ? 'release' : 'trade'} hard. They were close. Give him a week.`,
  },
  {
    when: (f) => !!f.gone,
    reads: 1,
    text: (f) =>
      `${f.a} lost his best friend in the building when ${f.b} was ${f.gone === 'cut' ? 'let go' : 'traded'}. He'll be fine; give him a week.`,
  },
  { when: (f) => !f.gone, text: (f) => `${f.a} and ${f.b} have gotten close. Good for the room.` },
  { when: (f) => !f.gone, text: (f) => `${f.a} and ${f.b} are inseparable these days. That kind of thing travels.` },
];

// ───────── grew up ─────────

export interface GrewFact {
  name: string;
  /** He learned from a mentor this year: his name. */
  mentor?: string;
  /** He grew up: our read a year ago and now. */
  was?: string;
  is?: string;
}

export const GREW_UP: readonly Line<GrewFact>[] = [
  {
    when: (f) => !!f.mentor,
    reads: 1,
    text: (f) =>
      `${f.name} has been picking up ${f.mentor}'s habits in the film room and the weight room. More work than a year ago, and it shows.`,
  },
  {
    when: (f) => !!f.mentor,
    reads: 1,
    text: (f) => `${f.mentor} got through to ${f.name}. He's first in the building now.`,
  },
  {
    when: (f) => !!f.was,
    reads: 1,
    text: (f) => `A year ago our read on ${f.name} was "${f.was}". Not any more. "${f.is}" is closer to it now.`,
  },
  {
    when: (f) => !!f.was,
    reads: 1,
    text: (f) => `A year ago I'd have told you ${f.name} was "${f.was}". He's grown up. "${f.is}" fits him now.`,
  },
];
