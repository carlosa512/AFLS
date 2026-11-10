/**
 * The benching chain in words (docs/superpowers/specs/2026-11-09-storylines-design.md, section 4): his ask, the head
 * coach's line before it, a week of not knowing, how he took your answer, how the story closes, the reminder when a
 * starter is cleared and the camp row on who holds each job. Every bank reads through `say`, and every line is true to
 * the facts its `when` reads: a man's words never claim more than the sheet knows, a line that names the man who took
 * his job reads him, and no line says who sat him when the staff sorts the chart. An NFL player or head coach: short,
 * plain, no numerals, nothing about ratings or mechanics. Types only from the benching module, so this file is a leaf.
 */
import type { BenchFact } from './benching';
import type { ManSheet } from './castSheet';
import type { BeatKind } from './types';
import type { Line } from './voice';

const poss = (name: string) => `${name}'s`;
const veteran = (m: ManSheet) => /veteran/.test(m.years);
const young = (m: ManSheet) => /rookie|year man/.test(m.years);
/** The man across from him, named: a line that reads it is only chosen when there is one. */
const across = (f: BenchFact) => f.other!.last;
const holder = (f: BenchFact) => f.role === 'holder';

/** His words when he asks where he stands. A holder sat at some point; the other man sat this week after starting. */
export const BENCH_ASK: readonly Line<BenchFact>[] = [
  { when: holder, text: () => "I sat, and I'd like to know where I stand." },
  {
    when: (f) => holder(f) && !!f.other,
    reads: 1,
    text: (f) => `${across(f)} got the start over me, and I'd like to know where that leaves me.`,
  },
  {
    when: (f) => holder(f) && !!f.other,
    reads: 1,
    text: (f) => `${across(f)} started and I did not. Is it his job now?`,
  },
  {
    when: (f) => holder(f) && !!f.other && f.man.captain && veteran(f.man),
    reads: 3,
    text: (f) => `I'm a captain here, and ${across(f)} started over me. I think I'm owed a straight answer.`,
  },
  {
    when: (f) => holder(f) && !!f.other && young(f.man),
    reads: 2,
    text: (f) => `${across(f)} got the start over me. I want to know what I have to do to get my spot back.`,
  },
  {
    when: (f) => holder(f) && f.man.calm,
    reads: 2,
    text: () => "I'm not here to complain. I sat, and I would just like to know where I stand.",
  },
  {
    when: (f) => holder(f) && f.man.loud,
    reads: 2,
    text: () => 'I sat, and I want to hear from you why.',
  },
  {
    when: (f) => holder(f) && f.backFromInjury,
    reads: 2,
    text: () => "I'm healthy again and I sat. Is my job still mine?",
  },
  {
    when: (f) => holder(f) && f.backFromInjury && !!f.other,
    reads: 3,
    text: (f) => `I came back from the injury, and ${across(f)} got the start. Is my job still mine?`,
  },
  {
    when: (f) => holder(f) && f.by === 'staff',
    reads: 1,
    text: () => "The staff has the chart, and I sat. I'd like to know if you stand behind that.",
  },
  {
    when: (f) => holder(f) && f.by === 'you',
    reads: 1,
    text: () => 'You set the lineup, and I sat. I would like to know what you want from me.',
  },
  {
    when: (f) => holder(f) && !!f.other && f.better,
    reads: 2,
    text: (f) => `I understand ${across(f)} is the better man right now. I'd still like to hear where I stand.`,
  },
  // The other man: he started for the holder, and now he has sat again with nobody saying a word.
  { when: (f) => !holder(f), text: () => 'I started, and then I sat. Nobody has told me where I stand.' },
  {
    when: (f) => !holder(f) && !!f.other,
    reads: 1,
    text: (f) => `I filled in for ${across(f)}, and now I'm out again. Whose job is it?`,
  },
  {
    when: (f) => !holder(f) && !!f.other && veteran(f.man),
    reads: 2,
    text: (f) =>
      `I've played long enough to know when nobody is saying anything. ${across(f)} has the job, or I do. Which is it?`,
  },
  {
    when: (f) => !holder(f) && !!f.other && young(f.man),
    reads: 2,
    text: (f) => `I started for ${across(f)} and then I sat. I'd like to know what I'm supposed to be working toward.`,
  },
  {
    when: (f) => !holder(f) && !!f.other && f.man.calm,
    reads: 2,
    text: (f) => `I'll do whatever you need, Coach. I just don't know if I'm the starter or ${across(f)} is.`,
  },
  {
    when: (f) => !holder(f) && !!f.other && f.man.loud,
    reads: 2,
    text: (f) => `One week I'm starting for ${across(f)}, the next I'm not. Tell me who has the job.`,
  },
  {
    when: (f) => !holder(f) && !!f.other && f.man.captain,
    reads: 2,
    text: (f) =>
      `I'm a captain, and I can't tell the room where I stand when I can't tell myself. Is it my job or ${poss(across(f))}?`,
  },
  {
    when: (f) => !holder(f) && !!f.other && f.by === 'staff',
    reads: 1,
    text: (f) => `The staff has been sorting the chart, and I don't know if I'm the starter or ${across(f)} is.`,
  },
];

/** The coach's line above his quote, only when there is something to say; the lines that need a fact need it. */
export const BENCH_BEFORE: readonly Line<BenchFact>[] = [
  {
    when: (f) => holder(f) && f.backFromInjury,
    reads: 2,
    text: (f) => `${f.man.last} only just got back from his injury, and he sat anyway.`,
  },
  {
    when: (f) => holder(f) && f.by === 'you' && !!f.other,
    reads: 2,
    text: (f) => `${across(f)} started on the lineup you set.`,
  },
  {
    when: (f) => holder(f) && f.by === 'staff',
    reads: 2,
    text: () => 'My staff sorts the chart, so this was their lineup, not a call made by hand.',
  },
  { when: (f) => f.man.captain, reads: 1, text: (f) => `${f.man.last} is one of our captains.` },
  {
    when: (f) => f.man.broken,
    reads: 2,
    text: (f) => `${f.man.last} has had a promise broken on him here before.`,
  },
  { when: (f) => f.man.dispute, reads: 2, text: (f) => `${f.man.last} is already in a dispute with us.` },
  {
    when: (f) => !holder(f) && !!f.other,
    reads: 2,
    text: (f) => `${f.man.last} started for ${across(f)}, then sat again, and neither of them has been told a thing.`,
  },
];

/** A question nobody has answered, a week on: only ever worded while it is open and unanswered. */
export const BENCH_STILL: readonly Line<BenchFact>[] = [
  {
    when: (f) => holder(f) && !!f.other && f.otherAsked,
    reads: 3,
    text: (f) => `${f.man.last} still hasn't heard from you. Now ${across(f)} is asking too.`,
  },
  {
    when: (f) => holder(f) && f.weeksOpen === 'one',
    reads: 2,
    text: (f) => `${f.man.last} has had this hanging over him for a week.`,
  },
  {
    when: (f) => holder(f) && f.weeksOpen === 'two',
    reads: 2,
    text: (f) => `${f.man.last} has had this hanging over him for two weeks.`,
  },
  {
    when: (f) => holder(f) && (f.weeksOpen === 'three' || f.weeksOpen === 'many'),
    reads: 2,
    text: (f) => `${f.man.last} has had this hanging over him for weeks.`,
  },
  {
    when: (f) => holder(f) && !!f.other,
    reads: 1,
    text: (f) => `Nobody has told ${f.man.last} or ${across(f)} whose job it is.`,
  },
  {
    when: (f) => holder(f) && f.man.captain,
    reads: 1,
    text: (f) => `${f.man.last} is a captain, and this is still hanging over him.`,
  },
  { when: holder, text: (f) => `${f.man.last} is still waiting to hear where he stands.` },
  {
    when: (f) => !holder(f),
    text: (f) => `${f.man.last} sat after starting, and still nobody has told him where he stands.`,
  },
];

/** Your answer to a man, the week after: how he took it, from where his mood is now. */
export interface TookFact {
  man: ManSheet;
  reply: 'backIn' | 'thisWeek' | 'earn' | 'his' | 'yours' | 'compete';
  /** He reads Poor or worse now. */
  down: boolean;
}

export const BENCH_TOOK: readonly Line<TookFact>[] = [
  {
    when: (f) => f.reply === 'backIn',
    text: (f) => `${f.man.last} heard that he is back in. We will see it at kickoff.`,
  },
  {
    when: (f) => f.reply === 'backIn' && f.down,
    reads: 1,
    text: (f) => `${f.man.last} is still low after the benching, even with your word. Starting will help.`,
  },
  {
    when: (f) => f.reply === 'thisWeek',
    text: (f) => `${f.man.last} accepted that it was only one week. If he sits again, that will not hold.`,
  },
  {
    when: (f) => f.reply === 'thisWeek' && f.down,
    reads: 1,
    text: (f) => `${f.man.last} says he understands, but he is still hurting over it.`,
  },
  {
    when: (f) => f.reply === 'earn',
    text: (f) => `${f.man.last} knows the job is open, and he wants it back.`,
  },
  {
    when: (f) => f.reply === 'earn' && f.down,
    reads: 1,
    text: (f) => `${f.man.last} did not like hearing he has to earn it back. He wants the job, but he is not happy.`,
  },
  {
    when: (f) => f.reply === 'earn' && f.man.calm && !f.down,
    reads: 1,
    text: (f) => `${f.man.last} took it as a professional. He knows the job is open and he is going to work for it.`,
  },
  { when: (f) => f.reply === 'yours', text: (f) => `${f.man.last} knows you told him the job is his.` },
  { when: (f) => f.reply === 'compete', text: (f) => `${f.man.last} knows he has to keep competing for it.` },
  { when: (f) => f.reply === 'his', text: (f) => `${f.man.last} has heard it from you straight.` },
];

/** His own words back to your answer, on the card. */
export interface ReplyFact {
  man: ManSheet;
  reply: TookFact['reply'];
}

export const BENCH_REPLY: readonly Line<ReplyFact>[] = [
  { when: (f) => f.reply === 'backIn', text: () => "Understood. I'll be ready." },
  { when: (f) => f.reply === 'backIn' && f.man.calm, reads: 1, text: () => "Thank you, Coach. I'll be ready." },
  { when: (f) => f.reply === 'backIn' && f.man.loud, reads: 1, text: () => 'Good. Then put me out there.' },
  { when: (f) => f.reply === 'thisWeek', text: () => "All right. I'll take that." },
  {
    when: (f) => f.reply === 'thisWeek' && f.man.loud,
    reads: 1,
    text: () => "If it's one week, fine. Don't make it two.",
  },
  { when: (f) => f.reply === 'earn', text: () => "Then I'll earn it." },
  { when: (f) => f.reply === 'earn' && f.man.calm, reads: 1, text: () => "Fair enough. I'll go earn it back." },
  { when: (f) => f.reply === 'earn' && f.man.loud, reads: 1, text: () => 'Earn it back. Fine. Watch me.' },
  { when: (f) => f.reply === 'yours', text: () => "Understood. I won't let it go." },
  { when: (f) => f.reply === 'compete', text: () => "Fine. I'll keep working." },
  { when: (f) => f.reply === 'his', text: () => 'Then that is that. I hear you.' },
];

/** A starter cleared and not back in his spot. `listed` is where the chart has him, as a word. */
export interface ClearedFact {
  man: ManSheet;
  listed: string;
}

export const CLEARED: readonly Line<ClearedFact>[] = [
  {
    when: (f) => f.man.backFromInjury,
    reads: 1,
    text: (f) => `${f.man.last} is cleared and still listed ${f.listed}. Put him back?`,
  },
  {
    when: (f) => f.man.backFromInjury,
    reads: 1,
    text: (f) => `${f.man.last} is healthy again, and the chart still has him ${f.listed}. Put him back?`,
  },
  {
    when: (f) => f.man.captain,
    reads: 1,
    text: (f) => `${f.man.last} is back and still listed ${f.listed}, and he is one of our captains. Put him back?`,
  },
  { text: (f) => `${f.man.last} can play again and is still listed ${f.listed}. Put him back?` },
  { text: (f) => `${f.man.last} is available again, and he is still listed ${f.listed}. Put him back?` },
];

/** How a benching story closes, from its last beat and how it closed. Names are last names, the holder's always. */
export interface BenchCloseFact {
  beat: BeatKind;
  how?: string;
  holder: string;
  other?: string;
  /** The holder's sheet, when he is still ours. */
  man: ManSheet | null;
}

const closed = (
  beat: BeatKind,
  how: string | undefined,
  text: (f: BenchCloseFact) => string,
  more: (f: BenchCloseFact) => boolean = () => true,
  reads = 2,
): Line<BenchCloseFact> => ({
  when: (f) => f.beat === beat && f.how === how && more(f),
  reads,
  text,
});
const named = (f: BenchCloseFact) => !!f.other;

export const BENCH_CLOSE: readonly Line<BenchCloseFact>[] = [
  closed('backIn', undefined, (f) => `${f.holder} is back in, and that one is behind us.`),
  closed('backIn', undefined, (f) => `${f.holder} is back in the lineup, so the benching is behind us.`),
  closed('left', 'other', (f) => `${f.other} is gone, so it's ${poss(f.holder)} job again.`, named),
  closed('left', 'holder', (f) => `${f.holder} is gone, so the job is ${poss(f.other!)} now.`, named),
  closed('left', 'both', (f) => `${f.holder} and ${f.other} are both gone, so there is nothing left to settle.`, named),
  closed(
    'left',
    'holder',
    (f) => `${f.holder} is gone, so the benching is closed.`,
    (f) => !f.other,
    1,
  ),
  closed(
    'settled',
    'outHolder',
    (f) => `${f.holder} is out for the rest of the season, so the job is ${poss(f.other!)} until next year.`,
    named,
  ),
  closed(
    'settled',
    'outOther',
    (f) => `${f.other} is out for the rest of the season, so the job stays ${poss(f.holder)}.`,
    named,
  ),
  closed(
    'settled',
    'out',
    (f) => `${f.holder} is out for the rest of the season, so there is nothing left to settle this year.`,
  ),
  closed('settled', 'his', (f) => `You told ${f.holder} it is ${poss(f.other!)} job now.`, named),
  closed(
    'settled',
    'his',
    (f) => `You told ${f.holder} it is ${poss(f.other!)} job now. He took it like a pro, and he won't love it.`,
    (f) => named(f) && !!f.man?.calm,
    3,
  ),
  closed(
    'settled',
    'his',
    (f) => `You told ${f.holder} it is ${poss(f.other!)} job now. He is not the type to hide how he feels about it.`,
    (f) => named(f) && !!f.man?.loud,
    3,
  ),
  closed(
    'settled',
    'his',
    (f) => `You told ${f.holder} the job is no longer his.`,
    (f) => !f.other,
    1,
  ),
  closed('settled', 'keeps', (f) => `You told ${f.other} it is ${poss(f.holder)} job, so ${f.holder} keeps it.`, named),
  closed(
    'settled',
    'earned',
    (f) => `${f.other} earned the job with three straight starts, and ${f.holder} lost it on the field.`,
    named,
  ),
  closed('settled', 'earnedBack', (f) => `${f.holder} earned the job back with three straight starts.`),
  closed(
    'settled',
    'chart',
    (f) => `${f.other} has started three straight, so that is that, and ${f.holder} found out from the depth chart.`,
    named,
  ),
  closed('settled', 'chartBack', (f) => `${f.holder} has started three straight, so the job is his again.`),
  { reads: 0, text: (f) => `The question over ${poss(f.holder)} job is closed.` },
];

/** What you told him, as the card says it. */
export function benchSaid(reply: TookFact['reply'], other: string | undefined): string {
  switch (reply) {
    case 'backIn':
      return "You told him he's back in next week.";
    case 'thisWeek':
      return 'You told him it was just this week.';
    case 'earn':
      return 'You told him to earn it back.';
    case 'yours':
      return 'You told him the job is his.';
    case 'compete':
      return 'You told him to keep competing.';
    case 'his':
      return other ? `You told him it's ${poss(other)} job.` : 'You told him the job is gone.';
  }
}

/** The camp row on who holds each job: the starters by room, and one spot where our scouts see the next man close. */
export interface JobsFact {
  lineup: string;
  /** `ahead`: our scouts read the second man above the last starter. */
  close?: { pos: string; first: string; second: string; ahead: boolean };
}

export const JOBS_ROW: readonly Line<JobsFact>[] = [
  { text: (f) => `Here is who starts as camp ends. ${f.lineup}` },
  { text: (f) => `This is the lineup I have as camp ends. ${f.lineup}` },
  {
    when: (f) => !!f.close && !f.close.ahead,
    reads: 1,
    text: (f) =>
      `Here is who starts as camp ends. ${f.lineup} At ${f.close!.pos}, our scouts have ${f.close!.second} right behind ${f.close!.first}.`,
  },
  {
    when: (f) => !!f.close && !f.close.ahead,
    reads: 1,
    text: (f) =>
      `This is the lineup I have as camp ends. ${f.lineup} At ${f.close!.pos}, ${f.close!.second} is close to ${f.close!.first} on our scouts' read.`,
  },
  {
    when: (f) => !!f.close?.ahead,
    reads: 1,
    text: (f) =>
      `Here is who starts as camp ends. ${f.lineup} At ${f.close!.pos}, our scouts read ${f.close!.second} slightly ahead of ${f.close!.first}.`,
  },
];

/** How your word stands now, read off the question: waiting on his next game, a one-game word, the job open, or broken. */
export interface StandsFact {
  state: 'promise' | 'soft' | 'open' | 'brokenPromise' | 'brokenSoft';
  /** Who the word went to, when it is not the man whose card this is. */
  to?: string;
}

export const BENCH_STANDS: readonly Line<StandsFact>[] = [
  { when: (f) => f.state === 'promise', text: (f) => `${f.to ?? 'He'} is waiting on his next game.` },
  { when: (f) => f.state === 'soft', text: (f) => `${f.to ?? 'He'} is watching to see if he starts again.` },
  { when: (f) => f.state === 'open', text: () => 'The job is still open.' },
  { when: (f) => f.state === 'brokenPromise', text: () => 'He sat again, so your word did not hold.' },
  { when: (f) => f.state === 'brokenSoft', text: () => 'He sat again.' },
];

/** Every way a benching story closes, as the engine files it: its beat, how, and whether the line names the other man. */
export const CLOSE_ENDS: readonly { beat: BeatKind; how?: string; needsOther: boolean }[] = [
  { beat: 'backIn', needsOther: false },
  { beat: 'left', how: 'other', needsOther: true },
  { beat: 'left', how: 'holder', needsOther: false },
  { beat: 'left', how: 'both', needsOther: true },
  { beat: 'settled', how: 'out', needsOther: false },
  { beat: 'settled', how: 'outHolder', needsOther: true },
  { beat: 'settled', how: 'outOther', needsOther: true },
  { beat: 'settled', how: 'his', needsOther: false },
  { beat: 'settled', how: 'keeps', needsOther: true },
  { beat: 'settled', how: 'earned', needsOther: true },
  { beat: 'settled', how: 'earnedBack', needsOther: false },
  { beat: 'settled', how: 'chart', needsOther: true },
  { beat: 'settled', how: 'chartBack', needsOther: false },
];
