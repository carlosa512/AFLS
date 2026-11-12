/**
 * A regular season of SNN's editions, game stories and all: every story keeps the writing rules a test can hold, a quote
 * comes only from the head coach of the story's club, and no sentence is said twice. (The season test in
 * `snnWeek.season.test.ts` holds the filed mail to the same; this holds the words as they are written.)
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { teamCoaches } from './coaching';
import { createLeague } from './generate';
import { playWeek } from './league';
import { ruleBreaks } from './storyRules';
import { buildEdition } from './snnWeek';
import type { Edition, EditionStory, League } from './types';
import { sentencesOf } from './voice';

let l: League;
const editions: Edition[] = [];
const said: string[] = [];
const storiesOf = (e: Edition): EditionStory[] => [e.lead, ...(e.club ? [e.club] : []), ...e.tiles];
beforeAll(() => {
  l = createLeague({ seed: 'snn-voice' });
  for (let week = 1; week <= 18; week++) {
    playWeek(l);
    const e = buildEdition(l, week)!;
    editions.push(e);
    // What a filed edition would leave in the inbox for the next one to step around.
    l.inbox = [
      ...(l.inbox ?? []),
      {
        id: `snn:${l.season}:w${week}`,
        season: l.season,
        phase: 'regular',
        week,
        from: 'SNN — Sports News Network',
        category: 'league',
        subject: '',
        body: storiesOf(e)
          .flatMap((s) => [...s.paragraphs, ...(s.quote ? [s.quote.text] : [])])
          .join(' '),
        // What it told, as the filed mail keeps it: a storyline printed this week is not next week's news again.
        covered: storiesOf(e).flatMap((s) => [s.key, ...(s.covers ?? [])]),
        read: false,
        actions: [],
      },
    ];
    for (const s of storiesOf(e))
      said.push(...[...s.paragraphs, ...(s.quote ? [s.quote.text] : [])].flatMap((p) => sentencesOf(p)));
  }
}, 240_000);

describe('a season of stories', () => {
  it('builds an edition every week with a lead, the reader’s club and up to four tiles', () => {
    expect(editions).toHaveLength(18);
    for (const e of editions) {
      expect(e.lead).toBeDefined();
      expect(e.tiles.length).toBeLessThanOrEqual(4);
      expect(e.scores.length).toBeGreaterThan(10);
      // The reader's club is always told: its own slot, or the lead.
      expect(e.club?.yours ?? e.lead.yours).toBe(true);
    }
  });

  it('keeps every story to the writing rules', () => {
    const breaks = editions.flatMap((e, i) =>
      storiesOf(e).flatMap((s) => ruleBreaks(l, s).map((b) => `week ${i + 1} · ${s.headline} · ${b}`)),
    );
    expect(breaks).toEqual([]);
  });

  it('leaves no token and no odd spacing in the text', () => {
    for (const e of editions)
      for (const s of storiesOf(e))
        for (const t of [s.headline, s.summary, s.kicker, ...s.paragraphs, s.quote?.text ?? '']) {
          expect(t).not.toMatch(/\{|\}|undefined|NaN|  /);
          expect(t.trim()).toBe(t);
        }
  });

  it('opens every paragraph and sentence with a capital, and ends each with a full stop', () => {
    for (const e of editions)
      for (const s of storiesOf(e))
        for (const p of s.paragraphs) {
          expect(p).toMatch(/^[A-Z]/);
          expect(p).toMatch(/\.$/);
          for (const x of sentencesOf(p)) expect(x).toMatch(/^[A-Z0-9]/);
        }
  });

  it('quotes only the head coach of the club the story is about or told for, at most once a story', () => {
    let quotes = 0;
    for (const e of editions)
      for (const s of storiesOf(e)) {
        if (!s.quote) continue;
        quotes++;
        const clubs = [s.clubId, ...(s.yours ? [l.userTeamId] : [])];
        const coaches = clubs.map((id) => teamCoaches(l, id).find((c) => c.role === 'headCoach')?.id);
        expect(coaches).toContain(s.quote.coachId);
        expect(s.quote.playerId).toBeUndefined();
      }
    expect(quotes).toBeGreaterThan(0);
  });

  it('does not say a sentence twice across the season', () => {
    const n = new Map<string, number>();
    for (const x of said) n.set(x, (n.get(x) ?? 0) + 1);
    expect([...n].filter(([, k]) => k > 1).map(([x, k]) => `${k}x ${x}`)).toEqual([]);
  });

  it('uses most of the angles over a season', () => {
    const angles = new Set(editions.flatMap((e) => storiesOf(e).map((s) => s.angle)));
    expect(angles.size).toBeGreaterThanOrEqual(7);
  });

  it('tells a story about one club only once in an edition', () => {
    for (const e of editions) {
      const clubs = [e.lead, ...e.tiles].map((s) => s.clubId);
      expect(new Set(clubs).size).toBe(clubs.length);
    }
  });
});
