/**
 * An offseason of SNN's big-day editions, played as the app plays it: from the title game to Week 1, one step at a
 * time, the mail filed after every step in one league and never in its twin. Holds what the spec asks of the whole
 * year: each edition once and in order, one SNN mail a step, every story to the writing rules, nothing told twice,
 * none of the digests it replaced beside it, and a league that plays the same with or without the mail. A third
 * league sims the offseason in one go and gets Kickoff alone.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { createLeague } from './generate';
import { deliverMail } from './inbox';
import { playWeek } from './league';
import { advanceOffseason, beginOffseason, simOffseason } from './offseason';
import { activeRoster } from './roster';
import { ruleBreaks } from './storyRules';
import type { EditionStory, InboxMessage, League } from './types';
import { sentencesOf } from './voice';

const SEED = 'big-days';
let l: League;
let quiet: League;
let simmed: League;
/** SNN mails filed at each offseason step. */
const perStep: number[] = [];

const editions = (league: League = l): InboxMessage[] =>
  (league.inbox ?? []).filter((m) => m.id.startsWith(`snn:${league.season}:d:`));
const storiesOf = (m: InboxMessage): EditionStory[] => [
  m.edition!.lead,
  ...(m.edition!.club ? [m.edition!.club] : []),
  ...m.edition!.tiles,
];
const dupes = (xs: string[]) => {
  const n = new Map<string, number>();
  for (const x of xs) n.set(x, (n.get(x) ?? 0) + 1);
  return [...n].filter(([, c]) => c > 1).map(([s, c]) => `${c}x ${s}`);
};
const rosters = (league: League) =>
  league.teams.map((t) =>
    activeRoster(league, t.id)
      .map((p) => p.id)
      .sort((a, b) => a - b)
      .join(','),
  );
const snnCount = (league: League) => (league.inbox ?? []).filter((m) => m.id.startsWith('snn:')).length;

/** A breath for the runner between steps: a worker that plays seasons without one cannot report in, and the run fails on the timeout. */
const tick = () => new Promise((done) => setTimeout(done, 0));

beforeAll(async () => {
  l = createLeague({ seed: SEED });
  quiet = createLeague({ seed: SEED });
  deliverMail(l);
  for (let step = 0; step < 30 && (l.phase === 'regular' || l.phase === 'playoffs'); step++) {
    playWeek(l);
    deliverMail(l);
    await tick();
  }
  for (let step = 0; step < 30 && (quiet.phase === 'regular' || quiet.phase === 'playoffs'); step++) {
    playWeek(quiet);
    await tick();
  }
  // The same league at the season's end, to sim its offseason in one go.
  simmed = JSON.parse(JSON.stringify(l));
  const step = (go: () => void) => {
    const before = snnCount(l);
    go();
    deliverMail(l);
    perStep.push(snnCount(l) - before);
  };
  step(() => beginOffseason(l));
  beginOffseason(quiet);
  await tick();
  for (let n = 0; n < 20 && (l.phase as string) !== 'regular'; n++) {
    step(() => advanceOffseason(l, { autoUser: true }));
    await tick();
    advanceOffseason(quiet, { autoUser: true });
    await tick();
  }
  beginOffseason(simmed);
  await tick();
  simOffseason(simmed);
  deliverMail(simmed);
}, 900_000);

describe('an offseason of big-day editions', () => {
  it('files each edition once and in the calendar’s order, one SNN mail a step', () => {
    const days = editions().map((m) => m.id.split(':').at(-1)!);
    const order = ['year', 'market', 'draft', 'cuts', 'kickoff'];
    expect(days).toEqual(order.filter((d) => days.includes(d)));
    // Every moment of this offseason had news: the league year, the market, the draft and Kickoff at the least.
    expect(days).toEqual(expect.arrayContaining(['year', 'market', 'draft', 'kickoff']));
    expect(Math.max(...perStep)).toBeLessThanOrEqual(1);
    for (const m of editions()) {
      expect(m.actions).toEqual([]);
      expect(m.subject.length, m.subject).toBeLessThanOrEqual(60);
      expect(m.edition!.scores).toEqual([]);
      expect(m.edition!.tiles.length).toBeLessThanOrEqual(3);
    }
  });

  it('keeps every story to the writing rules, and says no sentence twice', () => {
    const all = editions().flatMap((m) => storiesOf(m).map((s) => ({ m, s })));
    expect(all.flatMap(({ m, s }) => ruleBreaks(l, s).map((b) => `${m.id} · ${s.headline} · ${b}`))).toEqual([]);
    expect(dupes(all.flatMap(({ s }) => s.paragraphs.flatMap((p) => sentencesOf(p))))).toEqual([]);
  });

  it('runs one story a team on a page, and tells nothing twice across the offseason', () => {
    for (const m of editions()) {
      const clubs = [m.edition!.lead, ...m.edition!.tiles].map((s) => s.clubId);
      expect(new Set(clubs).size, m.id).toBe(clubs.length);
    }
    expect(dupes(editions().flatMap((m) => storiesOf(m).map((s) => s.key)))).toEqual([]);
  });

  it('gives the reader’s team its own slot, never a tile', () => {
    for (const m of editions()) {
      for (const s of [m.edition!.lead, ...m.edition!.tiles]) expect(s.clubId, m.id).not.toBe(l.userTeamId);
      if (m.edition!.club) expect(m.edition!.club.yours).toBe(true);
    }
    expect(editions().some((m) => m.edition!.club)).toBe(true);
  });

  it('files none of the digests it replaced beside an edition', () => {
    const ids = (l.inbox ?? []).filter((m) => m.season === l.season).map((m) => m.id);
    expect(ids.filter((id) => id.startsWith('leadership-phase:') || id.startsWith('offMarket:'))).toEqual([]);
    expect(ids).not.toContain(`league:${l.season}:carousel`);
  });

  it('moves nothing: the offseason plays the same with the mail filed or never filed', () => {
    expect(quiet.phase).toBe(l.phase);
    expect(rosters(quiet)).toEqual(rosters(l));
    expect(quiet.transactions.length).toBe(l.transactions.length);
    expect(quiet.inbox ?? []).toEqual([]);
  });

  it('a simmed offseason files Kickoff alone', () => {
    expect(simmed.phase).toBe('regular');
    expect(editions(simmed).map((m) => m.id)).toEqual([`snn:${simmed.season}:d:kickoff`]);
    const page = editions(simmed)[0].edition!;
    expect(page.label).toBe('Kickoff');
    expect(page.lists!.map((x) => x.title)).toContain('Opening week');
  });
});
