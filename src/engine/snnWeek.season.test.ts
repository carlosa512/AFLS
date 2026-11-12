/**
 * One whole season and its playoffs with SNN's weekly edition filed as the game files it, then every edition read
 * together: one a completed week and playoff round, every story to the writing rules, no sentence twice, one story a
 * club, nothing told in two editions, never Needs you. And the season plays the same with mail delivered or not: an
 * edition is told from the league, and nothing in the league is moved by it. Slow (two seasons of sims), so it lives
 * apart from the fast tests.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { createLeague } from './generate';
import { deliverMail, mailDate, needsYou } from './inbox';
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

/** A breath for the runner between steps: a worker that plays seasons without one cannot report in, and the run fails on the timeout. */
const tick = () => new Promise((done) => setTimeout(done, 0));

beforeAll(async () => {
  l = createLeague({ seed: SEED });
  quiet = createLeague({ seed: SEED });
  deliverMail(l);
  // As the Continue button does in season: play the week, then the mail is filed.
  for (let step = 0; step < 30 && (l.phase === 'regular' || l.phase === 'playoffs'); step++) {
    playWeek(l);
    deliverMail(l);
    await tick();
  }
  for (let step = 0; step < 30 && (quiet.phase === 'regular' || quiet.phase === 'playoffs'); step++) {
    playWeek(quiet);
    await tick();
  }
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
      // The reader's club may have one more: its game, and a tile for its other news.
      const news = told.filter((s) => s.clubId === l.userTeamId && s.kind !== 'game');
      expect(news.length).toBeLessThanOrEqual(1);
      expect(dupes(told.filter((s) => !news.includes(s)).map((s) => String(s.clubId)))).toEqual([]);
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

  it('says in a playoff headline what the game decided, and tells the final as a championship', () => {
    const playoffs = editions().filter((m) => /:p[A-Z]+$/.test(m.id));
    // A player's day may lead its own story short of the final: every other game story's headline carries the stakes.
    const heads = playoffs.flatMap((m) =>
      storiesOf(m)
        .filter((x) => x.kind === 'game' && x.angle !== 'day')
        .map((x) => x.headline),
    );
    expect(heads.length).toBeGreaterThan(3);
    for (const h of heads) expect(h).toMatch(/reach|eliminate|are out|champion|lose the final/);
    const final = playoffs.at(-1)!.edition!;
    expect(final.label).toBe('The final');
    expect(final.lead.kicker).toBe('The championship');
    expect(final.lead.headline).toMatch(/champion|lose the final/);
    expect(final.lead.paragraphs.join(' ')).toContain('most valuable player');
    expect(final.lead.paragraphs.at(-1)).toContain('in the regular season');
    expect(final.tiles.filter((x) => x.kind === 'award').map((x) => x.kicker)).toEqual(['The awards']);
    expect(final.lists!.map((x) => x.title)).toEqual(["The season's awards", "The champions' road"]);
    const awards = l.awards.find((a) => a.season === l.season)!;
    expect(final.lists![0].rows[0].playerId).toBe(awards.winners.mvp!.playerId);
    // The road ends at the final, and every row is a game of the champion's.
    const champion = l.history.at(-1)!.championId;
    for (const r of final.lists![1].rows) expect([r.teamId, r.otherId]).toContain(champion);
    expect(final.lists![1].rows.at(-1)!.cells[0]).toBe('The final');
    // Every game of the road opens its box score, and every award names its player.
    for (const r of final.lists![1].rows) expect(l.games.find((g) => g.id === r.gameId)?.result).toBeDefined();
    for (const r of final.lists![0].rows) expect(l.players[r.playerId!]).toBeDefined();
  });

  it('is filed under the week it is read in, to the end of the season', () => {
    const of = (week: number) => mailDate(editions().find((m) => m.week === week)!);
    expect(of(12)).toMatchObject({ phase: 'regular', week: 13 });
    // The last regular-season week is read as the playoffs open, the final once the season is over.
    expect(of(18)).toMatchObject({ phase: 'playoffs', week: 19 });
    expect(mailDate(editions().at(-1)!).phase).toBe('complete');
    // And no date runs backwards down the inbox, so each week is one heading.
    const order = ['regular', 'playoffs', 'complete'];
    const keys = (l.inbox ?? [])
      .filter((m) => m.season === l.season && order.includes(mailDate(m).phase))
      .map((m) => order.indexOf(mailDate(m).phase) * 100 + mailDate(m).week);
    for (let i = 1; i < keys.length; i++) expect(keys[i]).toBeGreaterThanOrEqual(keys[i - 1]);
  });

  it('runs one Column an edition at most, never two weeks running, and never the same claim twice', () => {
    const weeks: number[] = [];
    const keys: string[] = [];
    let yours = 0;
    for (const m of editions()) {
      const columns = m.edition!.tiles.filter((s) => s.kind === 'column');
      expect(columns.length).toBeLessThanOrEqual(1);
      expect(m.edition!.lead.kind).not.toBe('column');
      if (!columns.length) continue;
      // In the regular season only.
      expect(m.phase).toBe('regular');
      weeks.push(m.week);
      keys.push(columns[0].key);
      if (columns[0].clubId === l.userTeamId) yours++;
      expect(columns[0].table).toBeDefined();
      expect(m.covered).toContain(columns[0].key);
    }
    expect(weeks.length).toBeGreaterThanOrEqual(5);
    expect(weeks.length).toBeLessThanOrEqual(9);
    for (let i = 1; i < weeks.length; i++) expect(weeks[i] - weeks[i - 1]).toBeGreaterThanOrEqual(2);
    expect(dupes(keys)).toEqual([]);
    expect(yours).toBeLessThanOrEqual(3);
  });

  it('keeps every subject line of the season short and plain', () => {
    for (const m of l.inbox ?? []) {
      expect(m.subject.length, m.subject).toBeLessThanOrEqual(60);
      expect(m.subject, m.subject).not.toContain(';');
    }
    // An edition's subject is its week and its lead story, and nothing more.
    for (const m of editions()) expect(m.subject.split(' · '), m.subject).toHaveLength(2);
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
