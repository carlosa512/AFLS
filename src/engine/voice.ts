/**
 * How the people who write to you choose their words. A bank holds candidate lines, each with a condition on what the
 * writer can see; the most specific line that fits wins (the rule-database approach of Valve's dynamic dialogue), so a
 * letter reflects as much of the league as it can before it varies its wording. Ties break on a stable hash of the
 * letter and the sentence's slot, never the sim's randomness, so the same league always writes the same letter. A line
 * the sender used in his last few letters steps aside when another fits. Knows nothing about mail kinds: any sender's
 * bank works.
 */
import type { League } from './types';

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
 * that leaves none), picked by the letter's key. Empty when nothing fits.
 */
export function say<C>(
  bank: readonly Line<C>[],
  c: C,
  at: { key: string; slot: string; recent?: readonly string[] },
): string {
  const fits = bank.filter((l) => !l.when || l.when(c));
  if (!fits.length) return '';
  const top = Math.max(...fits.map((l) => l.reads ?? 0));
  const texts = fits.filter((l) => (l.reads ?? 0) === top).map((l) => l.text(c));
  const fresh = texts.filter((t) => !at.recent?.some((b) => b.includes(t)));
  const pool = fresh.length ? fresh : texts;
  return pool[stableHash(`${at.key}:${at.slot}`) % pool.length];
}

/** The bodies of a sender's last `n` letters, newest first: what he'd rather not say again. */
export function recentBodies(league: League, from: string, n = 5): string[] {
  const out: string[] = [];
  const inbox = league.inbox ?? [];
  for (let i = inbox.length - 1; i >= 0 && out.length < n; i--) if (inbox[i].from === from) out.push(inbox[i].body);
  return out;
}

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
