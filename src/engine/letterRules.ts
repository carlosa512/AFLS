/**
 * The house rules for every letter in the inbox (`docs/NEWS.md`, "Words in a letter"), as a check on one piece of
 * text. The people who write to you (the head coach, your director, the doctor, players, agents, other GMs, the
 * league) each notice different things, and all of them write plain, complete sentences. SNN's stories have rules of
 * their own on top (`storyRules.ts`). Reads text only: nothing in the sim or the mail calls it.
 */

/** The files that word letters. `quotes` marks the ones whose lines are a person speaking, where a short answer is a sentence. */
export const LETTER_FILES: readonly { file: string; quotes?: true }[] = [
  { file: 'src/engine/coachWeek.ts' },
  { file: 'src/engine/coachWeekVoice.ts' },
  { file: 'src/engine/playerVoice.ts', quotes: true },
  { file: 'src/engine/talkMail.ts' },
  { file: 'src/engine/benchVoice.ts', quotes: true },
  { file: 'src/engine/meetings/voice.ts' },
  { file: 'src/engine/meetings/facts.ts' },
  { file: 'src/engine/castSheet.ts' },
  { file: 'src/engine/roomFacts.ts' },
  { file: 'src/engine/meetings/mail.ts' },
  { file: 'src/engine/roomVoice.ts' },
  { file: 'src/engine/lockerVoice.ts' },
  { file: 'src/engine/lockerReport.ts' },
  { file: 'src/engine/lockerMail.ts' },
  { file: 'src/engine/disputeVoice.ts' },
  { file: 'src/engine/disputeMail.ts' },
  { file: 'src/engine/promiseMail.ts' },
  { file: 'src/engine/staffNotes.ts' },
  { file: 'src/engine/coachReports.ts' },
  { file: 'src/engine/coachDecisions.ts' },
  { file: 'src/engine/directorAdvice.ts' },
  { file: 'src/engine/waiverMail.ts' },
  { file: 'src/engine/contractMail.ts' },
  { file: 'src/engine/offMarketMail.ts' },
  { file: 'src/engine/gmTalk.ts', quotes: true },
  { file: 'src/engine/gmVoice.ts' },
  { file: 'src/engine/opposition.ts' },
  { file: 'src/engine/gameStory.ts' },
  { file: 'src/engine/gazette.ts' },
  { file: 'src/engine/tradeNews.ts' },
  { file: 'src/engine/news.ts' },
  { file: 'src/engine/inbox.ts' },
];

/** A word no letter uses, whoever is writing or speaking. Matched whole-word, any case. */
const BANNED: readonly [RegExp, string][] = [
  // Players are players, or a name, or a position.
  [/\bmen\b/i, 'says "men" for players'],
  [
    /\b(a|the|one|each|every|that|this|another|other|young|older|our|my|your|their|better) man\b/i,
    'says "man" for a player',
  ],
  [/\b(a|the|that|this|one) man's\b/i, 'says "man" for a player'],
  [/-year man\b/i, 'says "man" for a player'],
  // The club is the club.
  [/\b(the|this) building\b/i, 'says "the building" for the club'],
];

/** What a letter from your own people leaves out. A person speaking (`quotes`) may say these. */
const WRITTEN: readonly [RegExp, string][] = [
  // A letter starts with its news: nothing announces the letter or the writer's view of it.
  [/(^|[.?!:] )here (is|are)\b|\bhere['’]s\b/i, 'announces what follows ("here is")'],
  [/\bas I see it\b|\bthe way I see it\b|\bhow I see it\b/i, 'announces a view ("as I see it")'],
  [/\b(from|crossed) my desk\b/i, 'announces the letter ("my desk")'],
  [/\bmy people\b/i, 'says "my people" for the players'],
  // Locker-room shorthand is spelled out.
  [/\bguys\b/i, 'says "guys" for players'],
  [/\bvets?\b/i, 'says "vets" for veterans'],
  [/\bkids\b/i, 'says "kids" for young players'],
];

/** The words no text in a letter file uses: for the short parts a sentence is built from. */
export const wordBreaks = (text: string): string[] =>
  BANNED.flatMap(([pattern, why]) => (pattern.test(text) ? [why] : []));

const sentences = (text: string) =>
  text
    .split(/(?<=[.?!])["”’']? +/)
    .map((s) => s.trim())
    .filter(Boolean);
const words = (s: string) => s.split(/\s+/).filter((w) => /[A-Za-z{]/.test(w)).length;

/**
 * What a piece of letter text breaks, in words; empty when it is clean. `quotes` is a person speaking (a player, an
 * agent, another club's GM): a one- or two-word answer is a sentence there, and so is his own way of putting things.
 */
export function letterBreaks(text: string, opts: { quotes?: boolean } = {}): string[] {
  const out: string[] = [];
  for (const [pattern, why] of BANNED) if (pattern.test(text)) out.push(why);
  if (text.includes(';')) out.push('has a semicolon');
  // A colon inside a sentence (a clock time and a label that ends a line aside).
  if (/[a-z}…]: +[a-z{“"]/.test(text) && /[.?!]["”’']?$/.test(text)) out.push('has a colon inside a sentence');
  if (/ [—–] /.test(text) && /[.?!]["”’']?$/.test(text)) out.push('has a dash inside a sentence');
  if (opts.quotes) return out;
  for (const [pattern, why] of WRITTEN) if (pattern.test(text)) out.push(why);
  // A sentence of one or two words is a fragment ("Good room.", "Pads on.").
  if (/[.?!]["”’']?$/.test(text))
    for (const s of sentences(text))
      // A sentence that is only filled-in parts is whatever fills it.
      if (words(s) < 3 && /[A-Za-z]/.test(s.replace(/\{…\}/g, ''))) out.push(`is clipped ("${s}")`);
  return out;
}
