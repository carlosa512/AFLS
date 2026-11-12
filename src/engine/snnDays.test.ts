/**
 * SNN's big-day editions (`snnDays.ts`): which moment the league is at, what each day's stories are and how they
 * rank, the cut to a page, the list box, and the mail. Scenes are built by hand on a fresh league, so no season or
 * draft is played here (`snnDays.season.test.ts` plays an offseason).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { createLeague } from './generate';
import { activeRoster } from './roster';
import { buildDay, cutDay, DAY, dayCandidates, dayMail, dayNow, rankDay, type DayCandidate } from './snnDays';
import { ruleBreaks } from './storyRules';
import type { EditionStory, InboxMessage, League, Player } from './types';

const stories = (e: { lead: EditionStory; club?: EditionStory; tiles: EditionStory[] }) => [
  e.lead,
  ...(e.club ? [e.club] : []),
  ...e.tiles,
];

describe('Draft day', () => {
  let l: League;
  let first: Player;
  let mine: Player[];
  /** A rookie of a club given a pick of this year's draft, by hand. */
  const pick = (teamId: number, n: number, at: number, rank: number, deal?: { from: number; got: string[] }) => {
    const p = activeRoster(l, teamId)
      .filter((x) => !x.draft || x.draft.season !== l.season)
      .sort((a, b) => a.age - b.age)[n];
    p.position = p.position === 'QB' ? 'WR' : p.position;
    p.draft = {
      season: l.season,
      round: at <= 32 ? 1 : 2,
      pick: at,
      teamId,
      rank,
      ...(deal ? { via: deal.from, deal } : {}),
    };
    return p;
  };
  beforeEach(() => {
    l = createLeague({ seed: 'draft-day' });
    l.phase = 'preseason';
    for (const p of Object.values(l.players)) if (p.draft?.season === l.season) delete p.draft;
    const u = l.userTeamId;
    const others = l.teams.map((t) => t.id).filter((id) => id !== u);
    first = pick(others[0], 0, 1, 3);
    pick(others[1], 0, 4, 2, { from: others[5], got: ['No. 9', `${l.season + 1} round 1`] });
    pick(others[2], 0, 20, 55);
    pick(others[3], 0, 40, 12);
    pick(others[4], 0, 7, 7);
    mine = [pick(u, 0, 15, 18), pick(u, 1, 47, 50)];
  });

  it('is at Draft day when camp opens, and files it once', () => {
    expect(dayNow(l)).toEqual(['draft']);
    const [m] = dayMail(l);
    expect(m.id).toBe(`snn:${l.season}:d:draft`);
    expect(m.edition!.day).toBe('draft');
    expect(m.edition!.scores).toEqual([]);
    expect(m.subject.startsWith('Draft day · ')).toBe(true);
    expect(m.subject.length).toBeLessThanOrEqual(60);
    expect(m.actions).toEqual([]);
    l.inbox = [{ ...m, read: false } as InboxMessage];
    expect(dayMail(l)).toEqual([]);
  });

  it('leads with the first pick and tells a trade up, the wait and a pick ahead of the board', () => {
    const cs = dayCandidates(l, 'draft', new Set());
    expect(cs.find((c) => c.angle === 'first')).toMatchObject({ tier: 1, pick: 1, playerId: first.id });
    expect(cs.find((c) => c.angle === 'up')).toMatchObject({
      tier: 2,
      pick: 4,
      got: ['No. 9', `${l.season + 1} round 1`],
    });
    expect(cs.find((c) => c.angle === 'wait')).toMatchObject({ tier: 3, pick: 40, rank: 12 });
    expect(cs.find((c) => c.angle === 'ahead')).toMatchObject({ tier: 3, pick: 20, rank: 55 });
    expect(buildDay(l, ['draft'])!.lead.cast[0]).toBe(first.id);
  });

  it('holds the wait and the reach to their bars, and a page tells one of each at most', () => {
    const others = l.teams.map((t) => t.id).filter((id) => id !== l.userTeamId);
    pick(others[10], 0, 60, 30);
    pick(others[11], 0, 25, 50);
    const cs = rankDay(dayCandidates(l, 'draft', new Set()), 'x');
    // The furthest fall and the widest gap come first of their kind.
    expect(cs.filter((c) => c.angle === 'wait').map((c) => c.pick)).toEqual([60, 40]);
    expect(cs.filter((c) => c.angle === 'ahead').map((c) => c.pick)).toEqual([20, 25]);
    const page = buildDay(l, ['draft'])!;
    for (const angle of ['wait', 'ahead'])
      expect([page.lead, ...page.tiles].filter((s) => s.angle === angle).length).toBeLessThanOrEqual(1);
    // Under the bar, neither is a story.
    for (const p of Object.values(l.players))
      if (p.draft?.season === l.season) p.draft.rank = p.draft.pick + (DAY.ahead - 1);
    const under = dayCandidates(l, 'draft', new Set());
    expect(under.some((c) => c.angle === 'wait' || c.angle === 'ahead')).toBe(false);
  });

  it('tells one quarterback story for the first taken in round one, counting the rest', () => {
    const [a, b] = Object.values(l.players).filter((p) => p.draft?.season === l.season && p.draft.pick >= 7);
    a.position = 'QB';
    b.position = 'QB';
    const qb = dayCandidates(l, 'draft', new Set()).filter((c) => c.angle === 'qb');
    expect(qb).toHaveLength(1);
    const taken = [a, b].filter((p) => p.draft!.round === 1).sort((x, y) => x.draft!.pick - y.draft!.pick);
    expect(qb[0]).toMatchObject({ tier: 2, playerId: taken[0].id, n: taken.length });
  });

  it('puts the more worthwhile story first inside a tier: the earlier pick', () => {
    const others = l.teams.map((t) => t.id).filter((id) => id !== l.userTeamId);
    pick(others[6], 0, 9, 9, { from: others[7], got: ['No. 14'] });
    const ups = rankDay(dayCandidates(l, 'draft', new Set()), 'x').filter((c) => c.angle === 'up');
    expect(ups.map((c) => c.pick)).toEqual([4, 9]);
  });

  it('does not call the other half of a swap a move up', () => {
    const others = l.teams.map((t) => t.id).filter((id) => id !== l.userTeamId);
    // This club took No. 6 after giving No. 5 away: it moved down.
    pick(others[8], 0, 6, 6, { from: others[9], got: ['No. 5'] });
    const ups = dayCandidates(l, 'draft', new Set()).filter((c) => c.angle === 'up');
    expect(ups.map((c) => c.pick)).toEqual([4]);
  });

  it('runs one story a club, three tiles at most, and never the reader’s club as a tile', () => {
    const e = buildDay(l, ['draft'])!;
    const clubs = [e.lead, ...e.tiles].map((s) => s.clubId);
    expect(new Set(clubs).size).toBe(clubs.length);
    expect(e.tiles.length).toBeLessThanOrEqual(3);
    expect(e.tiles.some((s) => s.clubId === l.userTeamId)).toBe(false);
    expect(e.lead.clubId).not.toBe(l.userTeamId);
  });

  it('cuts to the top story as the lead and the next three clubs as tiles', () => {
    const c = (key: string, tier: DayCandidate['tier'], clubId: number, stakes: number): DayCandidate => ({
      key,
      day: 'draft',
      angle: key,
      tier,
      clubId,
      teams: [clubId],
      stakes,
    });
    const ranked = rankDay(
      [c('a', 2, 1, 0.5), c('b', 1, 2, 0.1), c('c', 2, 1, 0.9), c('d', 3, 3, 0.2), c('e', 3, 4, 0.1), c('f', 4, 5, 0)],
      'x',
    );
    const cut = cutDay(ranked, 9)!;
    expect(cut.lead.key).toBe('b');
    // One story a club: 'a' gives way to 'c', the same club's bigger story.
    expect(cut.tiles.map((x) => x.key)).toEqual(['c', 'd', 'e']);
    expect(cutDay(rankDay([c('z', 1, 9, 1)], 'x'), 9)).toBeNull();
  });

  it('gives the reader’s club its class, and no slot when it made no pick or he has no club', () => {
    const e = buildDay(l, ['draft'])!;
    expect(e.club!.yours).toBe(true);
    expect(e.club!.table!.head).toEqual(['Pick', 'Player', 'Consensus']);
    expect(e.club!.table!.rows).toHaveLength(2);
    for (const p of mine) delete p.draft;
    expect(buildDay(l, ['draft'])!.club).toBeUndefined();
  });

  it('lists round one’s first ten', () => {
    const [list] = buildDay(l, ['draft'])!.lists!;
    expect(list.title).toBe('Round one');
    expect(list.head).toEqual(['Pick', 'Player', 'Club', 'Consensus']);
    expect(list.rows.length).toBeLessThanOrEqual(10);
    expect(list.rows[0]).toMatchObject({ playerId: first.id, teamId: first.draft!.teamId });
    expect(list.rows.every((r) => l.players[r.playerId!].draft!.round === 1)).toBe(true);
  });

  it('keeps every story to the writing rules and stops on a fact', () => {
    const e = buildDay(l, ['draft'])!;
    for (const s of stories(e)) expect(ruleBreaks(l, s), s.headline).toEqual([]);
    for (const s of stories(e)) expect(s.kind).toBe('day');
  });

  it('files nothing when the day has no lead', () => {
    for (const p of Object.values(l.players)) if (p.draft?.season === l.season) delete p.draft;
    expect(dayMail(l)).toEqual([]);
  });

  it('is at no day in season, and at none once the day’s edition is on file', () => {
    l.phase = 'regular';
    l.week = 5;
    expect(dayNow(l)).toEqual([]);
  });
});
