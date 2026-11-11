/**
 * One whole season and its playoffs with SNN's weekly edition filed as the game files it, then every edition read
 * together: one a completed week and playoff round, every story to the writing rules, no sentence twice, one story a
 * club, nothing told in two editions, never Needs you. And the season plays the same with mail delivered or not: an
 * edition is told from the league, and nothing in the league is moved by it. Slow (two seasons of sims), so it lives
 * apart from the fast tests.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { createLeague } from './generate';
import { deliverMail, needsYou } from './inbox';
import { playWeek } from './league';
import { ruleBreaks } from './storyRules';
import type { EditionStory, InboxMessage, League } from './types';
import { sentencesOf } from './voice';

const SEED = 'snn-season';
let l: League;
let quiet: League;
const editions = () => (l.inbox ?? []).filter((m) => m.edition);
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
const scores = (league: League) =>
  league.games
    .filter((g) => g.season === league.season && g.result)
    .map((g) => `${g.week}:${g.homeId}-${g.awayId}:${g.result!.homeScore}-${g.result!.awayScore}`)
    .sort();

beforeAll(() => {
  l = createLeague({ seed: SEED });
  quiet = createLeague({ seed: SEED });
  deliverMail(l);
  // As the Continue button does in season: play the week, then the mail is filed.
  for (let step = 0; step < 30 && (l.phase === 'regular' || l.phase === 'playoffs'); step++) {
    playWeek(l);
    deliverMail(l);
  }
  for (let step = 0; step < 30 && (quiet.phase === 'regular' || quiet.phase === 'playoffs'); step++) playWeek(quiet);
}, 900_000);

describe('a season of editions', () => {
  it('files one edition a completed week and one a playoff round, each once', () => {
    const weeks = new Set(l.games.filter((g) => g.season === l.season && g.result).map((g) => g.week));
    const ids = editions().map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toHaveLength(weeks.size);
    expect(ids.filter((id) => /:w\d+$/.test(id))).toHaveLength(18);
    expect(ids.filter((id) => /:p[A-Z]+$/.test(id)).length).toBeGreaterThanOrEqual(3);
  });

  it('keeps every story of every edition to the writing rules', () => {
    const breaks = editions().flatMap((m) =>
      storiesOf(m).flatMap((s) => ruleBreaks(l, s).map((b) => `${m.edition!.label} · ${s.headline} · ${b}`)),
    );
    expect(breaks).toEqual([]);
  });

  it('says no sentence twice in the season', () => {
    const said = editions().flatMap((m) =>
      storiesOf(m).flatMap((s) => [...s.paragraphs, ...(s.quote ? [s.quote.text] : [])].flatMap((p) => sentencesOf(p))),
    );
    expect(dupes(said)).toEqual([]);
  });

  it('runs one story a club in an edition, and at most one angle twice', () => {
    for (const m of editions()) {
      const told = [m.edition!.lead, ...m.edition!.tiles];
      expect(dupes(told.map((s) => String(s.clubId)))).toEqual([]);
      const angles = new Map<string, number>();
      for (const s of told) angles.set(s.angle, (angles.get(s.angle) ?? 0) + 1);
      for (const n of angles.values()) expect(n).toBeLessThanOrEqual(2);
      expect(m.edition!.tiles.length).toBeLessThanOrEqual(4);
    }
  });

  it('tells nothing but a game in two editions', () => {
    const keys = editions().flatMap((m) =>
      storiesOf(m)
        .filter((s) => s.kind !== 'game')
        .map((s) => s.key),
    );
    expect(dupes(keys)).toEqual([]);
  });

  it('always tells the reader’s club, and never asks anything of him', () => {
    for (const m of editions()) {
      expect(needsYou(l, m)).toBe(false);
      expect(m.actions).toEqual([]);
      // His club's own slot or the lead, in every week it could be told: a week it played, or its bye.
      if (m.phase === 'regular') expect(m.edition!.club?.yours ?? m.edition!.lead.yours).toBe(true);
    }
  });

  it('carries the race in the regular season and the bracket in the playoffs', () => {
    for (const m of editions()) {
      if (m.phase === 'regular') {
        expect(m.edition!.race).toBeDefined();
        expect(m.edition!.bracket).toBeUndefined();
      } else {
        expect(m.edition!.bracket).toBeDefined();
        expect(m.edition!.race).toBeUndefined();
        expect(m.edition!.next).toBeUndefined();
      }
    }
  });

  it('is SNN’s only mail in season', () => {
    const snn = (l.inbox ?? []).filter((m) => /SNN/.test(m.from) && (m.phase === 'regular' || m.phase === 'playoffs'));
    expect(snn.filter((m) => !m.edition).map((m) => m.id)).toEqual([]);
  });

  it('moves nothing: the season plays the same with the mail filed or never filed', () => {
    expect(scores(l)).toEqual(scores(quiet));
    expect(scores(l).length).toBeGreaterThan(270);
  });
});
