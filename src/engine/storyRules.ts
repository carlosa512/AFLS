/**
 * The writing rules of SNN's edition that a test can hold (spec §3): what `snnWeek.season.test.ts` holds every story to
 * and what `npm run editions` lists at the top of a season's read-through. Each break is a short message; none is a
 * story that keeps the rules. The rules a test cannot hold (one angle, sentences that join facts, no filler) are read.
 */
import type { EditionStory, League } from './types';
import { sentencesOf } from './voice';

const HEADLINE = 70;
/** Digits a sentence may carry before the rest belong in the number chips. */
const NUMBERS = 2;
/** A sentence under this many words is a short one: a Column gets one a paragraph, or it reads as a list. */
const SHORT = 8;
/**
 * A Column about a general manager (blame or credit, never a correction): written whole from what he did
 * (`snnGmVoice.ts`), so it runs to two to four paragraphs and may close on a judgment.
 */
const GM_PIECE = /^column:\d+:gm:(\d+):[23][+-]$/;

/** How many numbers a sentence holds: a record (7–1), a time (17:34) and an ordinal (31st) are one each. */
function numbersIn(sentence: string, score?: EditionStory['score']): number {
  let s = sentence;
  // The final score is the result, not a stat.
  if (score) for (const x of [`${score.home}–${score.away}`, `${score.away}–${score.home}`]) s = s.split(x).join('');
  return (s.match(/\d[\d,.]*(?:[–:-]\d+)*/g) ?? []).length;
}

export function ruleBreaks(l: League, s: EditionStory): string[] {
  const out: string[] = [];
  const texts = [...s.paragraphs, s.summary, ...(s.quote ? [s.quote.text] : [])];
  const sentences = texts.flatMap((t) => sentencesOf(t));
  const short = (t: string) => (t.length > 60 ? `${t.slice(0, 57)}…` : t);
  for (const x of sentences) {
    if (x.includes(';')) out.push(`semicolon: "${short(x)}"`);
    // A clock time is not a colon inside a sentence.
    if (x.replace(/\d:\d\d/g, '').includes(':')) out.push(`colon inside a sentence: "${short(x)}"`);
    if (numbersIn(x, s.score) > NUMBERS) out.push(`more than ${NUMBERS} numbers in a sentence: "${short(x)}"`);
  }
  // A brief (a second story about the reader's club) is its news alone: the rest is in the club's own story.
  if ((s.paragraphs.length < 2 && !s.brief) || s.paragraphs.length > 4)
    out.push(`${s.paragraphs.length} paragraphs: a story has two to four`);
  if (s.numbers.length > 3) out.push(`${s.numbers.length} number chips: at most three`);
  if (s.headline.length > HEADLINE) out.push(`headline over ${HEADLINE} characters: "${short(s.headline)}"`);

  // A general manager's Column is a piece with rules of its own (below).
  const gmId = s.kind === 'column' ? GM_PIECE.exec(s.key)?.[1] : undefined;
  const gm = gmId === undefined ? undefined : l.gms[Number(gmId)];
  // A story stops on a fact: its last sentence carries a number, a man of the story or a club.
  const last = sentencesOf(s.paragraphs.at(-1)).at(-1) ?? '';
  const names = [
    ...s.cast.flatMap((id) => (l.players[id] ? [l.players[id].lastName] : [])),
    ...l.teams.flatMap((t) => [t.name, t.city]),
  ];
  if (gm) {
    // It may close on a judgment, and the judgment names the man or the team.
    const team = l.teams[s.clubId];
    if (![gm.lastName, team.name, team.city].some((n) => last.includes(n)))
      out.push(`a GM piece ends on a sentence naming neither the man nor the team: "${short(last)}"`);
  } else if (!/\d/.test(last) && !names.some((n) => last.includes(n))) out.push(`ends on no fact: "${short(last)}"`);

  // A Column is an argument: its numbers sit in a table and its sentences lean on each other.
  if (s.kind === 'column') {
    if (!s.table || s.table.rows.length < 2 || s.table.rows.length > 4)
      out.push('a Column carries an evidence table of two to four rows');
    for (const p of s.paragraphs) {
      const sents = sentencesOf(p);
      if (sents.filter((x) => x.trim().split(/\s+/).length < SHORT).length > 1)
        out.push(`more than one sentence under eight words in a paragraph: "${short(p)}"`);
      // A GM piece tells picks, prices and years: it keeps to the edition's two numbers a sentence.
      if (!gm)
        for (const x of sents)
          if (numbersIn(x) > 1) out.push(`more than one number in a Column's sentence: "${short(x)}"`);
    }
    const argument = sentencesOf(s.paragraphs[1] ?? '').length;
    if (!gm && (argument < 2 || argument > 3))
      out.push(`${argument} sentences in the argument: a Column has two or three sentences there`);
  }

  // A man's first mention is his full name.
  const body = s.paragraphs.join(' ');
  for (const id of s.cast) {
    const p = l.players[id];
    if (!p) continue;
    const at = body.search(
      new RegExp(`(?<![\\p{L}\\p{M}'-])${p.lastName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{M}])`, 'u'),
    );
    // Two men of the story may share a surname: its first use must be one of theirs in full.
    const namesakes = s.cast.flatMap((x) => (l.players[x]?.lastName === p.lastName ? [l.players[x].firstName] : []));
    if (at >= 0 && !namesakes.some((first) => body.slice(0, at).endsWith(`${first} `)))
      out.push(`first mention is not the full name: ${p.lastName}`);
  }
  return out;
}
