/**
 * SNN's weekly edition as mail: one a completed week, filed at its moment only, in place of the separate in-season SNN
 * mails, and saved as it read when filed.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { createLeague, SAVE_VERSION } from './generate';
import { endGmAppointment } from './gm';
import { deliverMail, mailSubject, needsYou } from './inbox';
import { playWeek } from './league';
import { migrateLeague } from './migrate';
import { setTeam } from './roster';
import { newsCandidates, SNN } from './snnWeek';
import { reportableTrades } from './tradeNews';
import { isDeadlineDay, TRADE_DEADLINE_WEEK } from './trade/rules';
import type { InboxMessage, League } from './types';
import { sentencesOf } from './voice';

const ids = (l: League, prefix: string) => (l.inbox ?? []).filter((m) => m.id.startsWith(prefix)).map((m) => m.id);
const editions = (l: League) => (l.inbox ?? []).filter((m) => m.edition);
const storiesOf = (m: InboxMessage) => [
  m.edition!.lead,
  ...(m.edition!.club ? [m.edition!.club] : []),
  ...m.edition!.tiles,
];

describe('filing the edition', () => {
  let l: League;
  beforeAll(() => {
    l = createLeague({ seed: 'snn-filing' });
    deliverMail(l);
    for (let w = 0; w < 6; w++) {
      playWeek(l);
      deliverMail(l);
      deliverMail(l);
    }
  }, 240_000);

  it('files one edition a completed week and nothing on a second delivery', () => {
    expect(ids(l, 'snn:')).toEqual([1, 2, 3, 4, 5, 6].map((w) => `snn:${l.season}:w${w}`));
  });

  it('is SNN’s only mail in season: no separate headline, roundup, speak-out or rumor', () => {
    const snn = (l.inbox ?? []).filter((m) => /SNN/.test(m.from) && m.phase === 'regular');
    expect(snn.every((m) => !!m.edition)).toBe(true);
    expect(ids(l, 'press:')).toEqual([]);
    expect(ids(l, 'leadership-week:')).toEqual([]);
  });

  it('is a letter from SNN that never needs you, and reads as an edition', () => {
    for (const m of editions(l)) {
      expect(m).toMatchObject({ from: SNN, category: 'league', phase: 'regular', actions: [] });
      expect(needsYou(l, m)).toBe(false);
      expect(mailSubject(m)).toEqual({ kind: 'edition', season: l.season, week: m.week });
      expect(m.subject).toMatch(new RegExp(`^Week ${m.week} · `));
      expect(m.subject.length).toBeLessThanOrEqual(130);
    }
  });

  it('keeps every sentence it printed where the next edition will step around it', () => {
    const m = editions(l).at(-1)!;
    for (const s of storiesOf(m))
      for (const x of [...s.paragraphs, ...(s.quote ? [s.quote.text] : [])].flatMap((p) => sentencesOf(p)))
        expect(m.body).toContain(x);
    const all = editions(l).flatMap((e) => sentencesOf(e.body));
    expect(new Set(all).size).toBe(all.length);
  });

  it('names what it told, so nothing is told twice', () => {
    for (const m of editions(l)) for (const s of storiesOf(m)) expect(m.covered).toContain(s.key);
    const keys = editions(l).flatMap((m) =>
      storiesOf(m)
        .filter((s) => s.kind !== 'game')
        .map((s) => s.key),
    );
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('survives its facts: a man traded away, a box score pruned, three more weeks', () => {
    const m = editions(l).at(-1)!;
    const before = JSON.stringify(m.edition);
    const man = storiesOf(m).flatMap((s) => s.cast)[0];
    if (man !== undefined && l.players[man].teamId !== null)
      setTeam(l, l.players[man], (l.players[man].teamId! + 3) % l.teams.length);
    for (const g of l.games) if (g.result && g.week === m.week) delete g.result.plays;
    for (let w = 0; w < 3; w++) {
      playWeek(l);
      deliverMail(l);
    }
    expect(JSON.stringify(editions(l).find((x) => x.id === m.id)!.edition)).toBe(before);
  });
});

describe('filing the edition, at the edges', () => {
  it('files only the latest week after a long advance', () => {
    const l = createLeague({ seed: 'snn-long' });
    deliverMail(l);
    for (let w = 0; w < 7; w++) playWeek(l);
    deliverMail(l);
    expect(ids(l, 'snn:')).toEqual([`snn:${l.season}:w7`]);
    // And one Column at most, though seven weeks of claims went unsaid.
    const edition = l.inbox!.find((m) => m.id === `snn:${l.season}:w7`)!.edition!;
    expect(edition.tiles.filter((s) => s.kind === 'column').length).toBeLessThanOrEqual(1);
    expect(edition.tiles.length).toBeLessThanOrEqual(edition.lead.yours ? 4 : 3);
  }, 240_000);

  it('does not retell what an old save already filed this week', () => {
    const l = createLeague({ seed: 'snn-old' });
    let found: { week: number; key: string } | undefined;
    for (let w = 1; w <= 9 && !found; w++) {
      playWeek(l);
      const t = reportableTrades(l, w, w)[0];
      if (t) found = { week: w, key: t.key };
    }
    expect(found).toBeDefined();
    const old = `press:${l.season}:${found!.week}:trade:${found!.key}`;
    expect(newsCandidates(l, found!.week, new Set()).some((c) => c.key === `trade:${found!.key}`)).toBe(true);
    l.inbox = [
      {
        id: old,
        season: l.season,
        phase: 'regular',
        week: found!.week,
        from: SNN,
        category: 'league',
        subject: 'x',
        body: 'y',
        read: true,
        actions: [],
      },
    ];
    deliverMail(l);
    const m = editions(l).at(-1)!;
    expect(m.week).toBe(found!.week);
    expect(storiesOf(m).some((s) => s.key === `trade:${found!.key}`)).toBe(false);
    // The old message is still there and still parses.
    expect(mailSubject(l.inbox!.find((x) => x.id === old)!)).toMatchObject({ kind: 'news' });
  }, 240_000);

  it('carries deadline day’s deals in the week’s edition: one SNN mail at that step, not two', () => {
    const l = createLeague({ seed: 'snn-deadline' });
    for (let w = 0; w < TRADE_DEADLINE_WEEK; w++) playWeek(l);
    // Week 9 is played and it is deadline day: a deal done today is dated the week to come.
    expect(isDeadlineDay(l)).toBe(true);
    const earlier = Array.from({ length: TRADE_DEADLINE_WEEK - 1 }, (_, i) =>
      reportableTrades(l, i + 1, i + 1),
    ).flat()[0];
    expect(earlier).toBeDefined();
    earlier.deal.week = TRADE_DEADLINE_WEEK + 1;
    expect(reportableTrades(l, TRADE_DEADLINE_WEEK + 1, TRADE_DEADLINE_WEEK + 1).map((t) => t.key)).toContain(
      earlier.key,
    );
    expect(newsCandidates(l, TRADE_DEADLINE_WEEK, new Set()).map((c) => c.key)).toContain(`trade:${earlier.key}`);
    deliverMail(l);
    const snn = (l.inbox ?? []).filter((m) => /SNN/.test(m.from) && m.phase === 'regular');
    expect(snn.map((m) => m.id)).toEqual([`snn:${l.season}:w${TRADE_DEADLINE_WEEK}`]);
    expect(ids(l, 'press:')).toEqual([]);
  }, 240_000);

  it('has no Your club slot for a GM between jobs, and still files', () => {
    const l = createLeague({ seed: 'snn-jobless' });
    for (let w = 0; w < 2; w++) playWeek(l);
    endGmAppointment(l, l.userGmId, 'dismissed');
    deliverMail(l);
    const m = editions(l).at(-1);
    expect(m).toBeDefined();
    expect(m!.edition!.club).toBeUndefined();
    expect(m!.edition!.lead.yours).toBeUndefined();
    expect(m!.edition!.race).toBeUndefined();
  }, 240_000);

  it('upgrades a save from before editions without touching its mail', () => {
    const l = createLeague({ seed: 'snn-migrate' });
    expect(SAVE_VERSION).toBe(94);
    const old = JSON.parse(JSON.stringify(l)) as League;
    old.version = 93;
    old.inbox = [
      {
        id: `press:${l.season}:4:trade:x`,
        season: l.season,
        phase: 'regular',
        week: 4,
        from: SNN,
        category: 'league',
        subject: 's',
        body: 'b',
        read: false,
        actions: [],
      },
    ];
    const up = migrateLeague(old)!;
    expect(up.version).toBe(94);
    expect(up.inbox).toEqual(old.inbox);
    expect(mailSubject(up.inbox![0])).toMatchObject({ kind: 'news' });
  });
});
