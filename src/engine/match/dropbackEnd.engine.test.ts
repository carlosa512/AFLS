import { describe, expect, it } from 'vitest';
import { createLeague } from '../generate';
import { sackCredits, simulateGame, unhitPlay, type ContactTap, type EndingTap } from './gameSim';
import { OUT_TEXT } from './sideline';
import type { PlayLogEntry } from '../types';

const league = createLeague({ seed: 'dropback-engine' });
const taps: EndingTap[] = [];
const contacts: ContactTap[] = [];
const plays: PlayLogEntry[] = [];
for (const g of league.games.filter((x) => !x.playoffRound).slice(0, 8)) {
  const r = simulateGame(league, g, {
    keepPlays: true,
    endingTap: (t) => taps.push(t),
    contactTap: (t) => contacts.push(t),
  });
  plays.push(...r.plays!);
}
const SLIDES = [
  ', slides with the first down in hand',
  ', slides to keep the clock running',
  ', slides to avoid the hit',
];

describe('how a play ends, in the engine', () => {
  it('taps every sack, never past his goal line, and some cost nothing', () => {
    const sacks = taps.filter((t) => t.kind === 'sack');
    // A sack a flag wiped out is logged as the penalty, its text kept.
    expect(sacks.length).toBe(plays.filter((e) => / SACKED by /.test(e.text)).length);
    for (const t of sacks) expect(t.loss!).toBeLessThanOrEqual(t.yardLine!);
    expect(sacks.some((t) => t.loss === 0)).toBe(true);
  });

  it('writes why he slid, and credits the man who touched him down', () => {
    const slides = plays.filter((e) => e.kind === 'scramble' && /, slides/.test(e.text));
    expect(slides.length).toBeGreaterThan(0);
    for (const e of slides) {
      expect(SLIDES.some((w) => e.text.includes(w))).toBe(true);
    }
    const slid = taps.filter((t) => t.kind === 'scramble' && t.slid);
    expect(slid.some((t) => t.tackled)).toBe(true);
    expect(slid.some((t) => !t.tackled)).toBe(true);
    // A touched slide names its man; an untouched one names nobody.
    expect(slides.some((e) => /\([^)]+\), slides/.test(e.text))).toBe(true);
    expect(slides.some((e) => /yards?, slides/.test(e.text))).toBe(true);
  });

  it('counts every scramble in bounds as a contact, slides that cannot fumble included', () => {
    const inBounds = taps.filter((t) => t.kind === 'scramble').length;
    const scrambleContacts = contacts.filter((c) => c.kind === 'scramble');
    expect(scrambleContacts.length).toBeGreaterThanOrEqual(inBounds - 3);
    for (const c of scrambleContacts) if (c.slid) expect(c.fumbled).toBe(false);
  });

  it('says why a man went out of bounds, and taps it', () => {
    const outs = taps.filter((t) => t.kind === 'out');
    expect(outs.length).toBeGreaterThan(0);
    const texts = plays.filter((e) => /out of bounds/.test(e.text) && e.kind !== 'kickoff' && e.kind !== 'punt');
    for (const e of texts) expect(Object.values(OUT_TEXT).some((w) => e.text.includes(w))).toBe(true);
    expect(outs.some((t) => t.why === 'hit')).toBe(true);
  });
});

describe('what a slide and a sack at the line book', () => {
  it('books no hit on a slide or a step-out, and a hit otherwise', () => {
    expect(unhitPlay({ outOfBounds: 'stepped' })).toBe(true);
    expect(unhitPlay({ slid: true })).toBe(true);
    expect(unhitPlay({ outOfBounds: 'pushed' })).toBe(false);
    expect(unhitPlay({})).toBe(false);
  });

  it('credits a tackle for loss only on a sack that lost yards', () => {
    expect(sackCredits(0)).not.toContain('tfl');
    expect(sackCredits(0)).toContain('sacks');
    expect(sackCredits(6)).toContain('tfl');
  });
});
