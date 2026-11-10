/**
 * How the people who write to you choose their words. A bank holds candidate lines, each with a condition on what the
 * writer can see; the most specific line that fits wins (the rule-database approach of Valve's dynamic dialogue), so a
 * letter reflects as much of the league as it can before it varies its wording. Ties break on a stable hash of the
 * letter and the sentence's slot, never the sim's randomness, so the same league always writes the same letter. A line
 * the sender used in his last few letters steps aside when another fits. Knows nothing about mail kinds: any sender's
 * bank works.
 */
import type { InboxMessage, League } from './types';

/** One way to say something: a condition (`when`) on what the writer sees, and how many facts it reads. */
export interface Line<C> {
  when?: (c: C) => boolean;
  /** How specific the condition is: the facts it looks at. Higher wins; a plain fallback reads 0. */
  reads?: number;
  text: (c: C) => string;
}

/** FNV-1a, 32-bit: the same string always lands on the same number. */
export function stableHash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * The sentence for one slot of one letter: the most specific lines that fit, less any the sender said recently (unless
 * that leaves none), picked by the letter's key. Empty when nothing fits. With `skip` (see `around`), a group of lines
 * that has all been said gives way to the next most specific group that has not, so a narrow fit never repeats itself
 * while a plainer line is still unsaid.
 */
export function say<C>(
  bank: readonly Line<C>[],
  c: C,
  at: { key: string; slot: string; recent?: readonly string[]; skip?: (text: string) => boolean },
): string {
  const fits = bank.filter((l) => !l.when || l.when(c));
  if (!fits.length) return '';
  // A line of two sentences is said again when either was, so a recent list kept sentence by sentence still catches it.
  const said = (t: string) => !!at.recent?.some((b) => b.includes(t) || sentencesOf(t).some((s) => b.includes(s)));
  const heard = (t: string) => said(t) || !!at.skip?.(t);
  const levels = [...new Set(fits.map((l) => l.reads ?? 0))].sort((a, b) => b - a);
  const group = (reads: number) => fits.filter((l) => (l.reads ?? 0) === reads).map((l) => l.text(c));
  let pool: string[] | undefined;
  if (at.skip)
    for (const reads of levels) {
      const fresh = group(reads).filter((t) => !heard(t));
      if (fresh.length) {
        pool = fresh;
        break;
      }
    }
  if (!pool) {
    const texts = group(levels[0]);
    const fresh = texts.filter((t) => !said(t));
    pool = fresh.length ? fresh : texts;
  }
  return pool[stableHash(`${at.key}:${at.slot}`) % pool.length];
}

/** How a builder words a row: around everything said so far when it keeps a list, else around the sender's last letters. */
export const wording = (league: League, from: string, said?: readonly string[]) =>
  said ? around(league, said) : { recent: recentBodies(league, from) };

/** The bodies of a sender's last `n` letters, newest first: what he'd rather not say again. */
export function recentBodies(league: League, from: string, n = 5): string[] {
  const out: string[] = [];
  const inbox = league.inbox ?? [];
  for (let i = inbox.length - 1; i >= 0 && out.length < n; i--) if (inbox[i].from === from) out.push(inbox[i].body);
  return out;
}

/** A text split where a sentence ends; a quote's marks at either end are not part of the sentence. */
export function sentencesOf(text: string | undefined): string[] {
  const out: string[] = [];
  for (const s of (text ?? '').split(/(?<=[.?!]) +/)) {
    // A quoted line ends in its closing quote, and opens with one: the sentence is the same either way.
    const t = s.replace(/^[“"]|[”"]$/g, '').trim();
    if (t) out.push(t);
  }
  return out;
}

/** The key a filed sentence is kept under in `League.mailTold`, so evicting its letter does not forget it. */
export const saidKey = (sentence: string) => `said:${stableHash(sentence)}`;

/** Every sentence of a letter: its body and each section row's note and the coach's line before it. */
export function lettersSentences(m: Pick<InboxMessage, 'body' | 'sections'>): string[] {
  return [
    ...sentencesOf(m.body),
    ...(m.sections ?? []).flatMap((sec) => sec.rows.flatMap((r) => [...sentencesOf(r.note), ...sentencesOf(r.before)])),
  ];
}

/**
 * Every sentence a sender filed this league year: each message's body and each section row's note, split where a
 * sentence ends (and every letter whose id starts with `idPrefix`, whoever signed it). What a letter writes next steps
 * around all of it, so no sentence comes twice in a year.
 */
export function seasonSaid(league: League, from: string, idPrefix?: string): string[] {
  const out: string[] = [];
  // A letter series (`idPrefix`) is one voice however many people have signed it: a new head coach does not reuse
  // what the last one's players said.
  for (const m of league.inbox ?? [])
    if ((m.from === from || (idPrefix && m.id.startsWith(idPrefix))) && m.season === league.season)
      out.push(...lettersSentences(m));
  return out;
}

/** Some sentence of this text was filed this league year, even if its letter has since left a full inbox. */
export function saidBefore(league: League, text: string): boolean {
  const told = league.mailTold;
  return !!told && sentencesOf(text).some((s) => told[saidKey(s)] === league.season);
}

/**
 * What `say` steps around for one sender's letter: the sentences already said (this league year's, and every one a
 * builder adds as it writes) and whatever the inbox has forgotten but `mailTold` kept. Pass it as `...around(...)`.
 */
export const around = (league: League, said: readonly string[]) => ({
  skip: (text: string) => sentencesOf(text).some((s) => said.some((b) => b.includes(s))) || saidBefore(league, text),
});

/**
 * Everything the inbox has already told: each message's id, whatever a digest says it covered, and the covered keys
 * kept after their letters left a full inbox (`League.mailTold`).
 */
export function toldKeys(league: League): Set<string> {
  const told = new Set<string>(Object.keys(league.mailTold ?? {}));
  for (const m of league.inbox ?? []) {
    told.add(m.id);
    for (const k of m.covered ?? []) told.add(k);
  }
  return told;
}

/** Head coaches' sayings, in our own words: each coach keeps one, the way a coach repeats his at the podium. */
export const MOTTOS: readonly string[] = [
  'Next man up.',
  "We don't make excuses in this building.",
  "It's a long season.",
  "Ball's in our hands.",
  'We go to work.',
  'One week at a time.',
  'The tape tells the truth.',
  'Win the week, then do it again.',
  "We don't flinch.",
];

export const mottoOf = (coachId: number): string => MOTTOS[stableHash(`motto:${coachId}`) % MOTTOS.length];
