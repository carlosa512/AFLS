/**
 * The head coach's words for the locker room report (`lockerReport.ts`). Each bank is a set of lines with conditions on
 * what the staff can see; the most specific that fits wins (`voice.ts`). The register is a coach at the podium: short,
 * flat sentences, the room's business kept in the room, captains as the room's call. Our own lines, never anyone's
 * quotes. Personality names are our scouts' read; nothing here is a number or a trait.
 */
import { inWords, unitIs } from './roomVoice';
import type { Line } from './voice';

export type Checkin = 'camp' | 'cutdown' | 'deadline' | 'end';

const ORDINAL = ['First', 'Second', 'Third', 'Fourth', 'Fifth', 'Sixth', 'Seventh', 'Eighth', 'Ninth', 'Tenth'];
const yearOf = (experience: number) => ORDINAL[experience] ?? `${experience + 1}th`;
const COUNT = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine'];
const count = (n: number) => COUNT[n] ?? String(n);
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const first = (units: string[] | undefined) => units?.[0] ?? 'the room';
/** No feud in the room, old or new: only then is the rest of the room "fine". */
const calm = (f: VerdictFact) => !f.standing && f.newFeuds === 0;
/** Rooms reading Split or Down. */
const troubled = (f: VerdictFact) => (f.split?.length ?? 0) + (f.down?.length ?? 0);
/** "the line", "the line and the backs", "the line, the backs and the secondary". */
const listOf = (units: string[]) =>
  units.length <= 1 ? (units[0] ?? 'the room') : `${units.slice(0, -1).join(', ')} and ${units[units.length - 1]}`;

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
  /** Men whose mood reads Poor or worse. */
  unhappy: number;
  /** The room's shape (L1): units reading Split and Down, as "the receivers". */
  split?: string[];
  down?: string[];
  /** A unit reading Tight, when none is Split or Down. */
  tight?: string | null;
  /** The vets and the young guys two mood steps or more apart. */
  apart?: 'young down' | 'vets down' | null;
}

const quiet = (f: VerdictFact) =>
  f.newFeuds === 0 &&
  !f.standing &&
  f.lost === 0 &&
  f.struggling === 0 &&
  f.friends === 0 &&
  f.grew === 0 &&
  f.unhappy < 3 &&
  !f.split?.length &&
  !f.down?.length &&
  !f.apart;
const month = (c: Checkin) => (c === 'camp' ? 'the season' : c === 'cutdown' ? 'September' : 'the stretch run');

/** `motto: true` lines close with the coach's saying. */
export const VERDICT: readonly (Line<VerdictFact> & { motto?: true })[] = [
  // The room's shape (L1): a divided or a down room is the news, ahead of anything but a feud on the field; a close
  // one is worth a word on a quiet report. Short and flat, like the rest of his verdicts. Text must hold for any fact:
  // the report reads every line's text to find the one it picked.
  {
    when: (f) => f.split?.length === 1 && !f.down?.length && calm(f),
    reads: 4,
    text: (f) => `One room on my list is ${first(f.split)}, and everyone else is happy.`,
  },
  {
    when: (f) => f.split?.length === 1 && !f.down?.length && calm(f),
    reads: 4,
    text: (f) => `${unitIs(first(f.split))} divided, and everyone else is fine.`,
  },
  {
    when: (f) => f.down?.length === 1 && !f.split?.length && calm(f),
    reads: 4,
    text: (f) => `${unitIs(first(f.down))} down, and everyone else is doing well.`,
  },
  {
    when: (f) => troubled(f) === 1 && !!f.standing && f.newFeuds === 0,
    reads: 5,
    text: (f) =>
      `${unitIs(first([...(f.split ?? []), ...(f.down ?? [])]))} ${f.split?.length ? 'divided' : 'down'}, and ${f.standing} still aren't talking, so I'm watching two things.`,
  },
  {
    when: (f) => troubled(f) >= 2,
    reads: 4,
    text: (f) =>
      `${cap(inWords(troubled(f)))} rooms are on my list, and they are ${listOf([...(f.split ?? []), ...(f.down ?? [])])}.`,
  },
  {
    when: (f) => troubled(f) >= 2,
    reads: 4,
    text: (f) => `My attention is on ${listOf([...(f.split ?? []), ...(f.down ?? [])])}.`,
  },
  {
    when: (f) => f.apart === 'young down' && !f.split?.length,
    reads: 2,
    text: () => 'The veterans are fine, and it is the younger players who are down.',
  },
  {
    when: (f) => f.apart === 'vets down' && !f.split?.length,
    reads: 2,
    text: () => 'The younger players are fine, and it is the veterans who are down.',
  },
  {
    when: (f) => quiet(f) && !!f.tight,
    reads: 2,
    text: (f) => `The room is good, and ${unitIs(f.tight ?? 'the room')} as close a group as I've seen.`,
  },
  {
    when: (f) => !!f.standing && f.newFeuds === 0,
    reads: 3,
    text: (f) =>
      `${f.standing} still aren't talking, but it has not reached the field. If it does, you will hear it from me before you hear it from SNN.`,
  },
  {
    when: (f) => !!f.standing && f.newFeuds === 0,
    reads: 3,
    text: (f) => `${f.standing} still aren't speaking. It hasn't cost us a snap, and I'm keeping it that way.`,
  },
  {
    when: (f) => !!f.standing && f.newFeuds === 0 && !f.split?.length && !f.down?.length,
    reads: 3,
    text: (f) => `${f.standing} are the same as last time, cold but professional, and the rest of the room is fine.`,
  },
  {
    when: (f) => f.newFeuds > 0 && f.friends > 0,
    reads: 2,
    text: () => "Some players have made new friendships, and some can't stand each other.",
  },
  {
    when: (f) => f.newFeuds > 0 && f.lost > 0 && !!f.lostName,
    reads: 3,
    text: (f) =>
      `Most of the room is good, ${f.newFeuds === 1 ? 'one thing is' : 'a couple of things are'} worth watching, and ${f.lostName} needs a new voice.`,
  },
  {
    when: (f) => f.lost > 1,
    reads: 2,
    text: (f) =>
      `The cuts took some mentors with them, and ${count(f.lost).toLowerCase()} younger players have new ones to get used to.`,
  },
  {
    when: (f) => f.lost > 1,
    reads: 2,
    text: (f) => `${count(f.lost)} of our younger players lost the veteran who was bringing them along.`,
  },
  {
    when: (f) => f.checkin === 'end' && f.grew > 0,
    reads: 2,
    text: () => 'It was a good year in the room, and some of the younger players matured.',
  },
  {
    when: (f) => f.checkin === 'end' && f.grew > 0,
    reads: 2,
    text: () => 'A few of our younger players matured this year, and it does not show up in the box score.',
  },
  { when: (f) => f.unhappy >= 3, reads: 1, text: () => "A few players are down, and I'm working on it." },
  {
    when: (f) => f.unhappy >= 3,
    reads: 1,
    text: () => 'Some players are unhappy, and I can handle it, but you should know who.',
  },
  { when: (f) => f.newFeuds > 0, reads: 1, text: () => 'The room is fine, but there is friction to watch.' },
  {
    when: (f) => f.newFeuds > 0,
    reads: 1,
    text: () => 'There is one spot of friction in the room, and it is being handled.',
  },
  {
    when: (f) => f.struggling > 0,
    reads: 1,
    text: () => 'Most of the younger players are listening, but not all of them.',
  },
  {
    when: (f) => f.struggling > 0,
    reads: 1,
    text: () => 'The mentoring is working for most of them, but a couple of pairings are not, and I would change them.',
  },
  {
    when: (f) => f.friends > 0,
    reads: 1,
    text: () => 'The room is coming together, and you see it in the cafeteria before you see it on Sundays.',
  },
  {
    when: (f) => f.lost === 1 && !!f.lostName,
    reads: 1,
    text: (f) => `The room is good, and ${f.lostName} only needs a new voice.`,
  },
  {
    when: (f) => f.checkin === 'camp',
    reads: 1,
    motto: true,
    text: () => 'Camp is open and the room has picked its leaders.',
  },
  {
    when: (f) => f.checkin === 'camp',
    reads: 1,
    motto: true,
    text: () => 'The pads are on, and the room knows who it follows.',
  },
  {
    when: (f) => quiet(f) && f.checkin !== 'end',
    motto: true,
    text: (f) => `The room is quiet, and I like that heading into ${month(f.checkin)}.`,
  },
  { when: quiet, motto: true, text: () => 'I have nothing to report from the room, and I like it that way.' },
  { when: quiet, motto: true, text: () => 'The room is in good shape, and nobody has called me about a problem.' },
  { when: quiet, motto: true, text: () => 'The team is quiet, and the players are focused.' },
  { text: () => 'I have no news about the room this time.' },
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
    text: () => "The players follow him. I would rather they followed someone else, but it is the room's call.",
  },
  {
    when: (f) => f.experience <= 2,
    reads: 2,
    text: (f) => `He is in his ${yearOf(f.experience).toLowerCase()} year, I know, but the room already goes to him.`,
  },
  {
    when: (f) => f.experience >= 8,
    reads: 2,
    text: (f) =>
      `He is in his ${yearOf(f.experience).toLowerCase()} year in the league, and the room goes quiet when he talks.`,
  },
  { when: (f) => f.kicker, reads: 2, text: () => 'He is out there on every kick, and the core players trust him.' },
  { when: (f) => f.qb, reads: 1, text: () => 'The ball is in his hands every snap, and he leads the huddle.' },
  {
    when: (f) => f.role === 'specialTeams',
    reads: 1,
    text: () => 'He is a core special-teamer, does the dirty work, and the players see it.',
  },
  {
    when: (f) => f.experience >= 5,
    reads: 1,
    text: () => 'He has seen enough football to know what matters, and the younger players watch him.',
  },
  { when: (f) => !!f.read, reads: 1, text: (f) => `Our read on him is "${f.read}", and the vote says the same.` },
  { text: () => 'The players voted, and he is the one they listen to.' },
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
      `With ${f.mentor} gone, ${f.name} lost the player bringing him along, so we have put him with ${f.now} for now.`,
  },
  {
    when: (f) => !!f.now,
    reads: 1,
    text: (f) => `${f.mentor} leaving hit ${f.name} harder than people think. ${f.now} is mentoring him now.`,
  },
  {
    when: (f) => !f.now && f.byYou,
    reads: 1,
    text: (f) => `${f.name} needs a new mentor, and you can pick one on the Locker Room screen.`,
  },
  { when: (f) => !f.now, text: (f) => `${f.name} lost ${f.mentor}, and we will find him someone in the room.` },
];

export interface SuggestFact {
  name: string;
  mentor: string;
  /** A veteran who'd suit him better, or null when there's nobody in the room right now. */
  better: string | null;
  status: 'not taking' | 'picking up his bad habits';
}

export const MENTOR_SUGGEST: readonly Line<SuggestFact>[] = [
  {
    when: (f) => !f.better && f.status === 'picking up his bad habits',
    reads: 2,
    text: (f) =>
      `${f.mentor} is having the wrong effect on ${f.name}, and I do not have a better fit in the room right now.`,
  },
  {
    when: (f) => !f.better && f.status === 'picking up his bad habits',
    reads: 2,
    text: (f) =>
      `${f.name} is taking the wrong lessons from ${f.mentor}. If we add a veteran at his position, I would make the switch.`,
  },
  {
    when: (f) => !f.better && f.status === 'not taking',
    reads: 2,
    text: (f) =>
      `${f.name} and ${f.mentor} have not worked well together, and nobody else in the room is a better fit yet.`,
  },
  {
    when: (f) => !!f.better && f.status === 'picking up his bad habits',
    reads: 1,
    text: (f) =>
      `${f.name} is picking up the wrong things from ${f.mentor}. I would move him to ${f.better} before it becomes a habit.`,
  },
  {
    when: (f) => !!f.better && f.status === 'not taking',
    reads: 1,
    text: (f) =>
      `${f.name} isn't listening to ${f.mentor}, who is the wrong voice for him. ${f.better} has the patience, so I would pair them.`,
  },
  {
    when: (f) => !!f.better && f.status === 'not taking',
    reads: 1,
    text: (f) => `${f.name} and ${f.mentor} are not working well together, and ${f.better} would be my pick.`,
  },
];

// ───────── friction and getting along ─────────

export const FRICTION_LEAD: readonly Line<{ n: number }>[] = [
  {
    text: () =>
      'We have it handled, and if it ever gets onto the field, you will hear it from me before you hear it from SNN.',
  },
  { text: () => "We'll handle it in-house. It hasn't touched practice." },
  { text: () => 'I have talked to both sides, and nothing has reached the field yet.' },
];

export interface FeudFact {
  why?: 'benched' | 'snubbed';
}

export const FRICTION: readonly Line<FeudFact>[] = [
  { when: (f) => f.why === 'benched', reads: 1, text: () => 'It started when the job changed hands.' },
  { when: (f) => f.why === 'benched', reads: 1, text: () => 'It started with the depth chart.' },
  { when: (f) => f.why === 'snubbed', reads: 1, text: () => 'It started with the new contract.' },
  {
    when: (f) => f.why === 'snubbed',
    reads: 1,
    text: () => 'It started with money, because one got paid and the other noticed.',
  },
  { text: () => 'Nobody has said what started it, but it is in the room, so you should know.' },
  { text: () => "I can't tell you how it started. They just don't get along." },
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
      `${f.a} took ${f.b}'s ${f.gone === 'cut' ? 'release' : 'trade'} hard because they were close, and he needs a week.`,
  },
  {
    when: (f) => !!f.gone,
    reads: 1,
    text: (f) =>
      `${f.a} lost his best friend on the team when ${f.b} was ${f.gone === 'cut' ? 'let go' : 'traded'}. He will be fine with a week.`,
  },
  { when: (f) => !f.gone, text: (f) => `${f.a} and ${f.b} have gotten close, which is good for the room.` },
  { when: (f) => !f.gone, text: (f) => `${f.a} and ${f.b} are inseparable these days.` },
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
      `${f.name} has been picking up ${f.mentor}'s habits in the film room and the weight room. He works more than he did a year ago, and it shows.`,
  },
  {
    when: (f) => !!f.mentor,
    reads: 1,
    text: (f) => `${f.name} has learned from ${f.mentor}, and he is the first to arrive now.`,
  },
  {
    when: (f) => !!f.was,
    reads: 1,
    text: (f) => `A year ago our read on ${f.name} was "${f.was}", and now "${f.is}" is closer to it.`,
  },
  {
    when: (f) => !!f.was,
    reads: 1,
    text: (f) =>
      `A year ago I would have told you ${f.name} was "${f.was}", but he has grown up and "${f.is}" fits him now.`,
  },
];

// ───────── morale ─────────

export interface MoraleNoteFact {
  name: string;
  /** What weighs on him most, as the morale screen words it (`moraleReasons`), or null. */
  reason: string | null;
  /** One of the happiest in the room, for the good-news rows. */
  happy: boolean;
  /** Down at the last report, himself again now. */
  back?: boolean;
  /** Very poor or worse: his mood is costing him in his work (G2). */
  costing?: boolean;
}

export const MORALE_NOTE: readonly Line<MoraleNoteFact>[] = [
  // What it's costing him (G2): the reason and the cost together, then the cost alone.
  {
    when: (f) => !!f.costing && f.reason === 'You broke your word',
    reads: 3,
    text: (f) => `${f.name} took you at your word and has stopped working like it, and it shows in practice.`,
  },
  {
    when: (f) => !!f.costing && f.reason === 'Wants more snaps',
    reads: 3,
    text: (f) => `${f.name} is sulking about snaps, and it is showing in practice.`,
  },
  {
    when: (f) => !!f.costing && f.reason === 'Wants a new deal',
    reads: 3,
    text: (f) => `${f.name} has the contract on his mind, and it is in his work, so he is a step slow in practice.`,
  },
  {
    when: (f) => !!f.costing && f.reason === 'The losing is wearing on him',
    reads: 3,
    text: (f) => `The losing is affecting ${f.name}, and you can see it on the practice field.`,
  },
  {
    when: (f) => !!f.costing && f.reason === 'A feud in the room',
    reads: 3,
    text: (f) => `${f.name}'s feud is costing him, and his mind is not on the work.`,
  },
  {
    when: (f) => !!f.costing,
    reads: 2.5,
    text: (f) => `${f.name} is down, and it is costing him in practice and on game day.`,
  },
  { when: (f) => !!f.costing, reads: 2.5, text: (f) => `Whatever is bothering ${f.name}, it is in his work now.` },
  {
    when: (f) => !f.costing && f.reason === 'You broke your word',
    reads: 3,
    text: (f) => `You told ${f.name} he would get it, and he is still waiting.`,
  },
  {
    when: (f) => !f.costing && f.reason === 'You broke your word',
    reads: 3,
    text: (f) => `${f.name} took you at your word, but that is gone now, and the room saw it.`,
  },
  {
    when: (f) => f.reason === 'You kept your word',
    reads: 3,
    text: (f) => `You kept your word to ${f.name}, and the room noticed.`,
  },
  {
    when: (f) => f.reason === 'You kept your word',
    reads: 3,
    text: (f) => `${f.name} got what you promised him, and he will not forget it.`,
  },
  { when: (f) => !!f.back, reads: 3, text: () => 'He has settled down, and whatever it was is behind him.' },
  { when: (f) => !!f.back, reads: 3, text: (f) => `${f.name} is back to himself.` },
  { when: (f) => f.happy, reads: 1, text: () => 'He could not be happier.' },
  { when: (f) => f.happy, reads: 1, text: (f) => `${f.name} is very happy right now.` },
  {
    when: (f) => f.reason === 'Wants more snaps',
    reads: 2,
    text: (f) => `${f.name} is sulking about snaps, so I would talk to him before it spreads.`,
  },
  {
    when: (f) => f.reason === 'Wants more snaps',
    reads: 2,
    text: (f) => `${f.name} thinks he should be on the field more, and he has a case.`,
  },
  {
    when: (f) => f.reason === 'Wants a new deal',
    reads: 2,
    text: () => 'He is watching what the market pays, and it is on his mind.',
  },
  {
    when: (f) => f.reason === 'Wants a new deal',
    reads: 2,
    text: (f) => `${f.name} knows what players at his position are getting. He has not said it to me, but he will.`,
  },
  { when: (f) => f.reason === 'Wants a new deal', reads: 2, text: () => 'The contract is what is bothering him.' },
  {
    when: (f) => f.reason === 'Wants a new deal',
    reads: 2,
    text: (f) => `${f.name} thinks he is underpaid, but he plays like it does not bother him for now.`,
  },
  { when: (f) => f.reason === 'The losing is wearing on him', reads: 2, text: () => 'The losing is bothering him.' },
  {
    when: (f) => f.reason === 'The losing is wearing on him',
    reads: 2,
    text: (f) => `${f.name} did not come here to lose, and it shows.`,
  },
  { when: (f) => f.reason === 'A feud in the room', reads: 2, text: () => 'The feud is bothering him.' },
  {
    when: (f) => f.reason === 'Still stung by the benching',
    reads: 2,
    text: () => 'He has not got over losing the job, and he needs time.',
  },
  {
    when: (f) => f.reason === 'Noticed who got paid',
    reads: 2,
    text: () => "He saw a teammate's new deal, and he noticed.",
  },
  {
    when: (f) => f.reason === 'Misses a friend who left',
    reads: 2,
    text: () => 'He misses his friend, and it will pass.',
  },
  {
    when: (f) => f.reason === 'Hard to please',
    reads: 2,
    text: () => 'That is just how he is, and nothing is ever quite right for him.',
  },
  { text: (f) => `${f.name} is down, and I'm keeping an eye on it.` },
  { text: () => 'He is not himself, and I will find out why.' },
];

export interface MoraleLeadFact {
  /** Men down who didn't make the letter's list. */
  more: number;
}

/** The line over a long Morale list: the letter names the worst, the Locker Room screen has the rest. */
export const MORALE_LEAD: readonly Line<MoraleLeadFact>[] = [
  {
    when: (f) => f.more === 1,
    reads: 1,
    text: () => 'I worry about these players. One more is down too, and he is on the Locker Room screen.',
  },
  {
    text: (f) =>
      `I worry about these players. ${count(f.more)} more are down too, and they are all on the Locker Room screen.`,
  },
  {
    text: (f) =>
      `These are the worst of it, and ${count(f.more).toLowerCase()} others are down a bit, as the Locker Room screen shows.`,
  },
];

// ───────── players who want a word (G3) ─────────

export interface RelayFact {
  /** His full name. */
  name: string;
  cause: 'snaps' | 'deal' | 'losing' | 'feud';
}

const ABOUT: Record<RelayFact['cause'], string> = {
  snaps: 'his snaps',
  deal: 'his contract',
  losing: 'the losing',
  feud: 'a problem in his room',
};

/** The head coach bringing one player's ask to you: who, what about, then the player's own words. */
export const TALK_RELAY: readonly Line<RelayFact>[] = [
  { text: (f) => `${f.name} came to see me about ${ABOUT[f.cause]}, and his own words are below.` },
  { text: (f) => `${f.name} stopped by my office about ${ABOUT[f.cause]}, and what he said is below.` },
  { text: (f) => `${f.name} wants a word with you about ${ABOUT[f.cause]}, and he says it himself below.` },
];

const TALLY = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine'];

/** Two or more the same step: the head coach's line over their rows. */
export const TALK_GROUP_COACH: readonly Line<{ n: number }>[] = [
  {
    text: (f) =>
      `${TALLY[f.n] ?? 'A few'} players came to see me this week and are waiting on you. Their own words are below.`,
  },
  {
    text: (f) =>
      `I had ${(TALLY[f.n] ?? 'a few').toLowerCase()} players in my office this week. Each one is below, with what he wants from you.`,
  },
];

/** The season's-end reminder of promises (`promiseMail.ts`): its subject and the head coach's lead. */
export const PROMISES_SUBJECT: readonly Line<{ n: number }>[] = [
  { text: (f) => (f.n === 1 ? 'A promise to keep' : 'Promises to keep') },
];
export const PROMISES_LEAD: readonly Line<{ n: number }>[] = [
  {
    text: (f) =>
      f.n === 1
        ? 'The season is over, and one promise we made a player is still open before the new year starts.'
        : `The season is over, and ${f.n} promises we made players are still open before the new year starts.`,
  },
  {
    text: (f) =>
      f.n === 1
        ? 'We still owe a player a promise going into the offseason, and he has not forgotten it.'
        : `We still owe players ${f.n} promises going into the offseason, and they have not forgotten them.`,
  },
];

// ───────── the report as a summary ─────────

export interface MoraleGroupFact {
  /** The players' full names as one phrase: "Terrence Bell, Andre Sanders and Eric Glover". */
  names: string;
  kind: 'down' | 'back' | 'happy';
  /** What weighs on them, as the morale screen words it, or null. */
  reason: string | null;
}

/** Several players with the same mood for the same reason are one line of the report, not a row each. */
export const MORALE_GROUP: readonly Line<MoraleGroupFact>[] = [
  { when: (f) => f.kind === 'back', reads: 2, text: (f) => `${f.names} are back to themselves.` },
  {
    when: (f) => f.kind === 'back',
    reads: 2,
    text: (f) => `${f.names} have settled down, and whatever it was is behind them.`,
  },
  { when: (f) => f.kind === 'happy', reads: 2, text: (f) => `${f.names} could not be happier.` },
  { when: (f) => f.kind === 'happy', reads: 2, text: (f) => `${f.names} are very happy right now.` },
  {
    when: (f) => f.reason === 'Still stung by the benching',
    reads: 3,
    text: (f) => `${f.names} have not got over losing their jobs, and they need time.`,
  },
  {
    when: (f) => f.reason === 'Wants more snaps',
    reads: 3,
    text: (f) => `${f.names} think they should be on the field more.`,
  },
  {
    when: (f) => f.reason === 'Wants a new deal',
    reads: 3,
    text: (f) => `${f.names} have their contracts on their minds.`,
  },
  {
    when: (f) => f.reason === 'The losing is wearing on him',
    reads: 3,
    text: (f) => `The losing is bothering ${f.names}.`,
  },
  {
    when: (f) => f.reason === 'A feud in the room',
    reads: 3,
    text: (f) => `${f.names} are bothered by a feud in the room.`,
  },
  {
    when: (f) => f.reason === 'Noticed who got paid',
    reads: 3,
    text: (f) => `${f.names} saw a teammate's new deal, and they noticed.`,
  },
  {
    when: (f) => f.reason === 'Misses a friend who left',
    reads: 3,
    text: (f) => `${f.names} miss a friend who left, and it will pass.`,
  },
  {
    when: (f) => f.reason === 'Hard to please',
    reads: 3,
    text: (f) => `${f.names} are hard to please, and that is just how they are.`,
  },
  { text: (f) => `${f.names} are down, and I am keeping an eye on them.` },
];

export interface RoomSummaryFact {
  /** Players down now, and players who were down at the last report and are themselves again. */
  down: number;
  back: number;
}

/** The count the head coach gives after his verdict, so the letter says how the room stands before it lists anyone. */
export const ROOM_SUMMARY: readonly Line<RoomSummaryFact>[] = [
  {
    when: (f) => f.down > 0 && f.back > 0,
    reads: 2,
    text: (f) =>
      `${f.down === 1 ? 'One player is' : `${count(f.down)} players are`} down, and ${
        f.back === 1 ? 'one has come back to himself' : `${count(f.back).toLowerCase()} have come back to themselves`
      } since my last report.`,
  },
  {
    when: (f) => f.down > 0,
    reads: 1,
    text: (f) => `${f.down === 1 ? 'One player is' : `${count(f.down)} players are`} down right now.`,
  },
  {
    when: (f) => f.back > 0,
    reads: 1,
    text: (f) =>
      f.back === 1
        ? 'One player who was down is back to himself.'
        : `${count(f.back)} players who were down are back to themselves.`,
  },
];
