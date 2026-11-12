/**
 * SNN's big-day editions (`snnDays.ts`): which moment the league is at, what each day's stories are and how they
 * rank, the cut to a page, the list box, and the mail. Scenes are built by hand on a fresh league, so no season or
 * draft is played here (`snnDays.season.test.ts` plays an offseason).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { teamCoaches } from './coaching';
import { createLeague } from './generate';
import { deliverMail } from './inbox';
import { activeRoster, setTeam } from './roster';
import { buildDay, cutDay, DAY, dayCandidates, dayMail, dayNow, rankDay, type DayCandidate } from './snnDays';
import { writeDayStory } from './snnDayVoice';
import { ruleBreaks } from './storyRules';
import type { Coach, EditionStory, GeneralManager, InboxMessage, League, Player } from './types';

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

  it('tells a move up outside the top ten only at a heavy price, and headlines the price once', () => {
    const others = l.teams.map((t) => t.id).filter((id) => id !== l.userTeamId);
    const heavy = pick(others[6], 0, 14, 14, { from: others[8], got: ['No. 22', 'No. 54', `${l.season + 1} round 2`] });
    const light = pick(others[7], 0, 16, 16, { from: others[9], got: ['No. 19', 'No. 120'] });
    const ups = dayCandidates(l, 'draft', new Set()).filter((c) => c.angle === 'up');
    expect(ups.map((c) => c.pick)).toEqual([4, 14]);
    expect(ups.some((c) => c.playerId === light.id)).toBe(false);
    // The earliest pick bought at a heavy price carries the price in its headline. The next one is told plainly.
    expect(ups.map((c) => c.text)).toEqual(['heavy', undefined]);
    const [top, next] = ups.map((c) => writeDayStory(l, c, { editionId: 'snn:test', said: [] }));
    expect(top.headline).toContain('trade a future first-round pick to move up');
    expect(next.headline).toContain('move up to No. 14');
    expect(next.paragraphs[1]).toContain('received three picks');
    expect(heavy.draft!.pick).toBe(14);
    for (const s of [top, next]) expect(ruleBreaks(l, s)).toEqual([]);
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
    expect(list.head).toEqual(['Pick', 'Player', 'Team', 'Consensus']);
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

describe('The new league year', () => {
  let l: League;
  let club: number;
  let gmClub: number;
  let hired: Coach;
  let fired: Coach;
  let newGm: GeneralManager;
  let oldGm: GeneralManager;
  let tagged: Player;
  let kept: Player;
  let walked: Player;
  let mine: Player;
  const at = () => ({ editionId: 'snn:test', said: [] as string[] });
  const log = (kind: 'tag' | 'resign', p: Player, text: string) =>
    l.transactions.push({
      season: l.season,
      phase: 'resign',
      week: 0,
      teamIds: [p.teamId!],
      kind,
      text,
      playerId: p.id,
    });
  beforeEach(() => {
    l = createLeague({ seed: 'new-year' });
    l.phase = 'freeAgency';
    l.faDay = 1;
    const last = l.season - 1;
    const u = l.userTeamId;
    const others = l.teams.map((t) => t.id).filter((id) => id !== u);
    [club, gmClub] = others;
    // Every head coach finished last season where he is, except one team's.
    const hc = (teamId: number) => teamCoaches(l, teamId).find((c) => c.role === 'headCoach')!;
    for (const c of Object.values(l.coaches)) c.career = (c.career ?? []).filter((x) => x.season !== last);
    for (const t of l.teams)
      if (t.id !== club) hc(t.id).career!.push({ season: last, teamId: t.id, role: 'headCoach' });
    hired = hc(club);
    fired = teamCoaches(l, others[2]).find((c) => c.role !== 'headCoach')!;
    fired.career!.push({ season: last, teamId: club, role: 'headCoach' });
    l.history = [
      { season: last, championId: others[5], runnerUpId: others[6], records: { [club]: { w: 4, l: 13, t: 0 } } },
    ];
    // A GM replaced at another team.
    newGm = l.gms[l.teams[gmClub].gmId!];
    oldGm = l.gms[l.teams[others[3]].gmId!];
    const event = (kind: 'gmDismissed' | 'gmHired', gmId: number) =>
      l.leadership.events.push({
        id: l.leadership.nextEventId++,
        date: { season: l.season, phase: 'resign', week: 0 },
        teamId: gmClub,
        kind,
        gmId,
        report: 'x',
      });
    event('gmDismissed', oldGm.id);
    event('gmHired', newGm.id);
    // Three stars by last season's honors: one tagged, one re-signed, one let go to the market; and one of ours tagged.
    for (const p of Object.values(l.players)) p.stats = {};
    const star = (teamId: number) => activeRoster(l, teamId).filter((p) => p.position !== 'QB')[0];
    [tagged, kept, walked, mine] = [star(others[7]), star(others[8]), star(others[9]), star(u)];
    l.awards = [
      {
        season: last,
        winners: { mvp: { playerId: tagged.id, teamId: tagged.teamId } },
        allLeague: [[kept, walked, mine].map((p) => ({ playerId: p.id, teamId: p.teamId })), []],
      },
    ];
    log('tag', tagged, 'tagged');
    log('resign', kept, `${l.teams[kept.teamId!].abbrev} re-signed ${kept.lastName}`);
    log('tag', mine, 'tagged');
    walked.statTeams = { [last]: [walked.teamId!] };
    walked.contract = null;
    setTeam(l, walked, null);
  });

  it('is the moment free agency opens', () => {
    expect(dayNow(l)).toEqual(['year']);
    expect(dayMail(l)[0].id).toBe(`snn:${l.season}:d:year`);
  });

  it('tells a change at the top with who left and who came in', () => {
    const cs = dayCandidates(l, 'year', new Set());
    const c = cs.find((x) => x.angle === 'coach')!;
    expect(c).toMatchObject({ tier: 1, clubId: club, coachId: hired.id });
    const s = writeDayStory(l, c, at());
    expect(s.paragraphs.join(' ')).toMatch(new RegExp(`${hired.lastName}[\\s\\S]*${fired.lastName}`));
    expect(ruleBreaks(l, s)).toEqual([]);
    const g = cs.find((x) => x.angle === 'gm')!;
    expect(g).toMatchObject({ tier: 1, clubId: gmClub, gmId: newGm.id });
    const gs = writeDayStory(l, g, at());
    expect(gs.paragraphs.join(' ')).toMatch(new RegExp(`${newGm.lastName}[\\s\\S]*${oldGm.lastName}`));
    expect(ruleBreaks(l, gs)).toEqual([]);
  });

  it('tells a star tagged at tier 1, a star kept and a star reaching the market at tier 2', () => {
    const cs = dayCandidates(l, 'year', new Set());
    expect(cs.find((x) => x.angle === 'tag')).toMatchObject({ tier: 1, playerId: tagged.id });
    expect(cs.find((x) => x.angle === 'kept')).toMatchObject({ tier: 2, playerId: kept.id });
    expect(cs.find((x) => x.angle === 'market')).toMatchObject({ tier: 2, playerId: walked.id });
    // A player who is no star is no story.
    expect(cs.filter((x) => x.angle === 'tag' && x.clubId !== l.userTeamId)).toHaveLength(1);
    for (const c of cs) expect(ruleBreaks(l, writeDayStory(l, c, at())), c.angle).toEqual([]);
  });

  it('puts the bigger name first inside a tier: the award winner leads', () => {
    const e = buildDay(l, ['year'])!;
    expect(e.lead.cast[0]).toBe(tagged.id);
    expect(e.label).toBe('The new league year');
  });

  it('lists the changes at the top, and gives the reader’s team its window', () => {
    const e = buildDay(l, ['year'])!;
    const list = e.lists!.find((x) => x.title === 'Changes at the top')!;
    expect(list.head).toEqual(['Team', 'Job', 'Out', 'In']);
    expect(list.rows.map((r) => r.teamId).sort()).toEqual([club, gmClub].sort());
    expect(e.club!.yours).toBe(true);
    expect(e.club!.paragraphs.join(' ')).toContain(mine.lastName);
    expect(ruleBreaks(l, e.club!)).toEqual([]);
  });

  it('covers the three digests, and none files beside it', () => {
    deliverMail(l);
    const ids = l.inbox!.map((x) => x.id);
    expect(ids).toContain(`snn:${l.season}:d:year`);
    const m = l.inbox!.find((x) => x.id === `snn:${l.season}:d:year`)!;
    expect(m.covered).toEqual(expect.arrayContaining([`league:${l.season}:carousel`, `offMarket:${l.season}`]));
    // The note on a new GM that the front-office digest carried rides with the edition.
    expect(m.gmNotes!.map((n) => n.gmId)).toEqual([newGm.id]);
    expect(ids.some((id) => id === `league:${l.season}:carousel`)).toBe(false);
    expect(ids.some((id) => id.startsWith('offMarket:') || id.startsWith('leadership-phase:'))).toBe(false);
    // Filed once.
    deliverMail(l);
    expect(l.inbox!.filter((x) => x.id.startsWith(`snn:${l.season}:d:`))).toHaveLength(1);
  });

  it('does not file when one of its digests is already on file for the season (a save from before)', () => {
    l.inbox = [{ id: `offMarket:${l.season}`, season: l.season } as InboxMessage];
    expect(dayMail(l)).toEqual([]);
  });

  it('carries a change it never told into the next edition', () => {
    l.phase = 'draft';
    expect(dayCandidates(l, 'market', new Set()).some((c) => c.angle === 'coach' && c.clubId === club)).toBe(true);
    const told = new Set([`lead:${l.season}:${club}:coach`]);
    expect(dayCandidates(l, 'market', told).some((c) => c.angle === 'coach')).toBe(false);
  });

  it('builds in a league with no last season', () => {
    l.awards = [];
    l.history = [];
    expect(() => dayMail(l)).not.toThrow();
  });
});

describe('Free agency', () => {
  let l: League;
  let star: Player;
  let rich: Player;
  let oldClub: number;
  let buyer: number;
  const at = () => ({ editionId: 'snn:test', said: [] as string[] });
  /** A player who finished last season with one team and signed with another in free agency's first week. */
  const sign = (p: Player, to: number, years: number, apy: number) => {
    const from = p.teamId!;
    p.statTeams = { [l.season - 1]: [from] };
    p.left = [{ teamId: from, season: l.season, how: 'walked' }];
    setTeam(l, p, to);
    p.contract = { ...p.contract!, length: years, apy };
    l.transactions.push({
      season: l.season,
      phase: 'freeAgency',
      week: 0,
      teamIds: [to],
      kind: 'sign',
      text: 'signed',
      playerId: p.id,
    });
    return from;
  };
  beforeEach(() => {
    l = createLeague({ seed: 'market-day' });
    l.phase = 'draft';
    for (const p of Object.values(l.players)) p.stats = {};
    l.awards = [];
    const u = l.userTeamId;
    const others = l.teams.map((t) => t.id).filter((id) => id !== u);
    const any = (teamId: number, n = 0) => activeRoster(l, teamId).filter((p) => p.position !== 'QB')[n];
    star = any(others[0]);
    rich = any(others[1]);
    l.awards = [
      { season: l.season - 1, winners: { mvp: { playerId: star.id, teamId: star.teamId } }, allLeague: [[], []] },
    ];
    buyer = others[2];
    oldClub = sign(star, buyer, 3, 20000);
    sign(rich, others[3], 4, 24000);
    // Four more starters to one team: the haul.
    for (let n = 0; n < 4; n++) {
      const p = any(others[4 + n], 1);
      p.stats[l.season - 1] = { gp: 17, snaps: 900 };
      sign(p, others[9], 2, 3000);
    }
  });

  it('is the moment the draft opens, and tells a star who changed teams', () => {
    expect(dayNow(l)).toEqual(['market']);
    const cs = dayCandidates(l, 'market', new Set());
    expect(cs.find((c) => c.angle === 'moved')).toMatchObject({
      tier: 1,
      playerId: star.id,
      clubId: buyer,
      otherId: oldClub,
    });
  });

  it('leads with the richest deal, in years and total dollars, then the stars who moved', () => {
    const e = buildDay(l, ['market'])!;
    expect(e.lead.cast[0]).toBe(rich.id);
    expect(e.tiles[0].cast[0]).toBe(star.id);
    const c = dayCandidates(l, 'market', new Set()).find((x) => x.angle === 'richest')!;
    expect(c).toMatchObject({ tier: 1, playerId: rich.id, deal: { years: 4, total: 96000 } });
    const s = writeDayStory(l, c, at());
    expect(s.paragraphs.join(' ')).toMatch(/four years and \$96 million/);
    expect(ruleBreaks(l, s)).toEqual([]);
  });

  it('tells only the team that signed the most starters, at the bar', () => {
    const hauls = dayCandidates(l, 'market', new Set()).filter((c) => c.angle === 'haul');
    expect(hauls).toHaveLength(1);
    expect(hauls[0]).toMatchObject({ tier: 3, n: 4 });
    expect(DAY.marketStarters).toBe(4);
  });

  it('lists the biggest contracts, largest first, each with where he came from', () => {
    const list = buildDay(l, ['market'])!.lists!.find((x) => x.title === 'The biggest contracts')!;
    expect(list.head).toEqual(['Player', 'From', 'To', 'Deal']);
    expect(list.rows[0]).toMatchObject({ playerId: rich.id });
    expect(list.rows[1]).toMatchObject({ playerId: star.id, teamId: buyer });
    expect(list.rows[1].cells[1]).toBe(l.teams[oldClub].name);
  });

  it('keeps every story to the writing rules', () => {
    for (const c of dayCandidates(l, 'market', new Set()))
      expect(ruleBreaks(l, writeDayStory(l, c, at())), c.angle).toEqual([]);
  });

  it('gives the reader’s team its signings, and no slot when it made none and lost nobody', () => {
    expect(buildDay(l, ['market'])!.club).toBeUndefined();
    const mine = activeRoster(l, l.teams.find((t) => t.id !== l.userTeamId && t.id !== buyer)!.id)[5];
    sign(mine, l.userTeamId, 2, 5000);
    const club = buildDay(l, ['market'])!.club!;
    expect(club.yours).toBe(true);
    expect(club.paragraphs.join(' ')).toContain(mine.lastName);
    expect(ruleBreaks(l, club)).toEqual([]);
  });

  it('does not tell a signing twice', () => {
    const told = new Set([`player:${star.id}:${l.season}:moved`]);
    expect(dayCandidates(l, 'market', told).some((c) => c.playerId === star.id && c.angle === 'moved')).toBe(false);
  });
});

describe('Cut-down day and Kickoff', () => {
  let l: League;
  let cutStar: Player;
  let cutVet: Player;
  let cutPick: Player;
  let champion: number;
  let coachClub: number;
  let qbClub: number;
  const at = () => ({ editionId: 'snn:test', said: [] as string[] });
  const stories = (e: { lead: EditionStory; club?: EditionStory; tiles: EditionStory[] }) => [
    e.lead,
    ...(e.club ? [e.club] : []),
    ...e.tiles,
  ];
  const release = (p: Player, withPlayer = true) => {
    const from = p.teamId!;
    p.statTeams = { ...(p.statTeams ?? {}), [l.season - 1]: [from] };
    p.contract = null;
    setTeam(l, p, null);
    l.transactions.push({
      season: l.season,
      phase: 'preseason',
      week: 0,
      teamIds: [from],
      kind: 'release',
      text: 'released',
      ...(withPlayer ? { playerId: p.id } : {}),
    });
    return from;
  };
  beforeEach(() => {
    l = createLeague({ seed: 'kickoff-day' });
    const last = l.season - 1;
    const u = l.userTeamId;
    const others = l.teams.map((t) => t.id).filter((id) => id !== u);
    for (const p of Object.values(l.players)) p.stats = {};
    const any = (teamId: number, n = 0) => activeRoster(l, teamId).filter((p) => p.position !== 'QB')[n];
    [cutStar, cutVet, cutPick] = [any(others[0]), any(others[1]), any(others[2])];
    l.awards = [
      { season: last, winners: { mvp: { playerId: cutStar.id, teamId: cutStar.teamId } }, allLeague: [[], []] },
    ];
    cutVet.stats[last] = { gp: 16, snaps: DAY.cutSnaps + 10 };
    cutPick.draft = { season: l.season - 1, round: 1, pick: 12, teamId: cutPick.teamId! };
    release(cutStar);
    release(cutVet);
    release(cutPick);
    // Last season: a champion, and one team whose head coach is new.
    champion = others[5];
    coachClub = others[6];
    qbClub = others[7];
    const hc = (teamId: number) => teamCoaches(l, teamId).find((c) => c.role === 'headCoach')!;
    for (const c of Object.values(l.coaches)) c.career = (c.career ?? []).filter((x) => x.season !== last);
    for (const t of l.teams)
      if (t.id !== coachClub) hc(t.id).career!.push({ season: last, teamId: t.id, role: 'headCoach' });
    teamCoaches(l, others[8])
      .find((c) => c.role !== 'headCoach')!
      .career!.push({ season: last, teamId: coachClub, role: 'headCoach' });
    l.history = [
      {
        season: last,
        championId: champion,
        runnerUpId: others[9],
        records: Object.fromEntries(l.teams.map((t) => [t.id, { w: 9, l: 8, t: 0 }])),
      },
    ];
    // Every team's quarterback holds his job and threw its passes last season, except one team's.
    for (const t of l.teams) {
      const [qb, backup] = activeRoster(l, t.id).filter((p) => p.position === 'QB');
      t.jobs = { held: { [qb.id]: { pos: 'QB', since: 0 } } };
      const passer = t.id === qbClub && backup ? backup : qb;
      passer.stats[last] = { gp: 17, snaps: 1000, passAtt: 500 };
      passer.statTeams = { [last]: [t.id] };
    }
    l.phase = 'regular';
    l.week = 1;
  });

  it('is at Cut-down day once the cuts are in, with practice squads on', () => {
    l.phase = 'preseason';
    l.personnel = { ...l.personnel!, enabled: true, clock: { season: l.season, cutdown: true } };
    expect(dayNow(l)).toEqual(['cuts']);
    const [m] = dayMail(l);
    expect(m.id).toBe(`snn:${l.season}:d:cuts`);
    expect(m.edition!.label).toBe('Cut-down day');
    expect(m.edition!.lists!.map((x) => x.title)).toEqual(['Notable cuts']);
  });

  it('files one mail for Cut-down day and Kickoff when they land together, and Kickoff alone after', () => {
    expect(dayNow(l)).toEqual(['cuts', 'kickoff']);
    const [m] = dayMail(l);
    expect(m.id).toBe(`snn:${l.season}:d:kickoff`);
    expect(m.edition!.label).toBe('Kickoff');
    expect(m.edition!.lists!.map((x) => x.title)).toEqual(['Opening week', 'Notable cuts']);
    expect(m.covered).toContain(`snn:${l.season}:d:cuts`);
    expect(m.week).toBe(1);
    l.inbox = [{ ...m, read: false } as InboxMessage];
    expect(dayMail(l)).toEqual([]);
    // With Cut-down day's own page on file, Kickoff is Kickoff alone.
    l.inbox = [{ id: `snn:${l.season}:d:cuts`, season: l.season } as InboxMessage];
    expect(dayNow(l)).toEqual(['kickoff']);
    expect(dayMail(l)[0].edition!.lists!.map((x) => x.title)).toEqual(['Opening week']);
  });

  it('leads a combined page with the preview, and shares the tiles between the two days', () => {
    const e = buildDay(l, ['cuts', 'kickoff'])!;
    expect(e.lead.angle).toBe('champion');
    const cuts = e.tiles.filter((s) => s.angle.startsWith('cut') || s.angle === 'undrafted');
    expect(cuts.length).toBeGreaterThanOrEqual(1);
    expect(cuts.length).toBeLessThan(e.tiles.length);
  });

  it('files nothing once a week 1 game is played', () => {
    l.games.find((g) => g.season === l.season && g.week === 1)!.result = {} as never;
    expect(dayNow(l)).toEqual([]);
  });

  it('tells a star released at tier 1, a starter at tier 2 and a high pick at tier 3', () => {
    const cs = dayCandidates(l, 'cuts', new Set());
    expect(cs.find((c) => c.playerId === cutStar.id)).toMatchObject({ angle: 'cutStar', tier: 1 });
    expect(cs.find((c) => c.playerId === cutVet.id)).toMatchObject({ angle: 'cutVet', tier: 2 });
    expect(cs.find((c) => c.playerId === cutPick.id)).toMatchObject({ angle: 'cutPick', tier: 3 });
    for (const c of cs) expect(ruleBreaks(l, writeDayStory(l, c, at())), c.angle).toEqual([]);
  });

  it('skips a release logged without a player (a save from before)', () => {
    const p = activeRoster(l, l.teams.find((t) => t.id !== l.userTeamId)!.id)[3];
    p.stats[l.season - 1] = { gp: 17, snaps: 1200 };
    release(p, false);
    expect(dayCandidates(l, 'cuts', new Set()).some((c) => c.playerId === p.id)).toBe(false);
  });

  it('tells the champion’s opener, a new head coach’s first game and a new starting quarterback', () => {
    const cs = dayCandidates(l, 'kickoff', new Set());
    expect(cs.find((c) => c.angle === 'champion')).toMatchObject({ tier: 2, clubId: champion });
    expect(cs.find((c) => c.angle === 'newCoach')).toMatchObject({ tier: 3, clubId: coachClub });
    expect(cs.filter((c) => c.angle === 'newQb').map((c) => c.clubId)).toEqual([qbClub]);
    for (const c of cs) expect(ruleBreaks(l, writeDayStory(l, c, at())), c.angle).toEqual([]);
  });

  it('does not call a starter back from a lost season a new quarterback', () => {
    const last = l.season - 1;
    const qb = Object.keys(l.teams[qbClub].jobs!.held).map((id) => l.players[Number(id)])[0];
    // He threw the team's passes the season before last.
    qb.stats[last - 1] = { gp: 17, snaps: 1000, passAtt: 520 };
    qb.statTeams = { ...(qb.statTeams ?? {}), [last - 1]: [qbClub] };
    expect(dayCandidates(l, 'kickoff', new Set()).filter((c) => c.angle === 'newQb')).toEqual([]);
  });

  it('reads only this year’s cut-down clock: last year’s leaves camp at Draft day', () => {
    l.phase = 'preseason';
    l.personnel = { ...l.personnel!, enabled: true, clock: { season: l.season - 1, cutdown: true } };
    expect(dayNow(l)).toEqual(['draft']);
  });

  it('makes no prediction: no story says will, should, favorite or expect', () => {
    for (const s of stories(buildDay(l, ['cuts', 'kickoff'])!))
      expect(s.paragraphs.join(' ')).not.toMatch(/\b(will|should|favou?rites?|expect(ed|s)?)\b/i);
  });

  it('gives the reader’s team its opener, and lists every opening game', () => {
    const e = buildDay(l, ['kickoff'])!;
    expect(e.club!.yours).toBe(true);
    expect(ruleBreaks(l, e.club!)).toEqual([]);
    const games = l.games.filter((g) => g.season === l.season && g.week === 1);
    expect(e.lists![0].rows).toHaveLength(games.length);
    expect(e.lists![0].head).toEqual(['Game', 'Kickoff']);
  });
});

describe('The other stories a big day tells', () => {
  let l: League;
  let others: number[];
  let last: number;
  let star: Player;
  const at = () => ({ editionId: 'snn:test', said: [] as string[] });
  const hc = (teamId: number) => teamCoaches(l, teamId).find((c) => c.role === 'headCoach')!;
  const records = (over: Record<number, { w: number; l: number; t: number }> = {}) => ({
    ...Object.fromEntries(l.teams.map((t) => [t.id, { w: 9, l: 8, t: 0 }])),
    ...over,
  });
  beforeEach(() => {
    l = createLeague({ seed: 'other-stories' });
    last = l.season - 1;
    others = l.teams.map((t) => t.id).filter((id) => id !== l.userTeamId);
    for (const p of Object.values(l.players)) p.stats = {};
    // Every head coach has had his team for two seasons, and one of them lost in both.
    for (const c of Object.values(l.coaches)) c.career = [];
    for (const t of l.teams)
      hc(t.id).career!.push(
        { season: last - 1, teamId: t.id, role: 'headCoach' },
        { season: last, teamId: t.id, role: 'headCoach' },
      );
    l.history = [
      {
        season: last - 1,
        championId: others[5],
        runnerUpId: others[6],
        records: records({ [others[0]]: { w: 5, l: 12, t: 0 } }),
      },
      {
        season: last,
        championId: others[5],
        runnerUpId: others[6],
        records: records({ [others[0]]: { w: 4, l: 13, t: 0 } }),
      },
    ];
    star = activeRoster(l, others[1]).filter((p) => p.position !== 'QB')[0];
    l.awards = [{ season: last, winners: { mvp: { playerId: star.id, teamId: star.teamId } }, allLeague: [[], []] }];
  });

  it('tells a head coach kept after two losing seasons, and a GM the owners put on notice', () => {
    l.phase = 'freeAgency';
    const warn = (teamId: number, coachId?: number) =>
      l.leadership.events.push({
        id: l.leadership.nextEventId++,
        date: { season: l.season, phase: 'resign', week: 0 },
        teamId,
        kind: 'warning',
        gmId: l.teams[teamId].gmId!,
        ...(coachId !== undefined ? { coachId } : {}),
        report: 'x',
      });
    warn(others[2]);
    // A new GM told to keep the coach is no pressure on anyone.
    warn(others[3], hc(others[3]).id);
    const cs = dayCandidates(l, 'year', new Set());
    expect(cs.filter((c) => c.angle === 'seat')).toMatchObject([
      { clubId: others[0], n: 2, tier: 3, coachId: hc(others[0]).id },
    ]);
    expect(cs.filter((c) => c.angle === 'pressure').map((c) => c.clubId)).toEqual([others[2]]);
    const seat = writeDayStory(l, cs.find((c) => c.angle === 'seat')!, at());
    expect(seat.headline).toContain('two losing seasons');
    expect(seat.paragraphs[1]).toContain('third season in the job');
    for (const c of cs.filter((x) => x.angle === 'seat' || x.angle === 'pressure')) {
      const s = writeDayStory(l, c, at());
      expect(ruleBreaks(l, s), c.angle).toEqual([]);
      // What the record shows, never a hidden state.
      expect(s.paragraphs.join(' ')).not.toMatch(/hot seat|expect/i);
    }
  });

  it('says where a new head coach comes from and what he takes over', () => {
    l.phase = 'freeAgency';
    const club = others[0];
    hc(club).career = [{ season: last, teamId: others[7], role: 'offCoord' }];
    teamCoaches(l, others[4]).find((c) => c.role !== 'headCoach')!.career = [
      { season: last, teamId: club, role: 'headCoach' },
    ];
    l.history[1].records[others[7]] = { w: 13, l: 4, t: 0 };
    const cs = dayCandidates(l, 'year', new Set());
    const s = writeDayStory(l, cs.find((x) => x.angle === 'coach' && x.clubId === club)!, at());
    expect(s.paragraphs[0]).toContain('went 13–4 that season');
    expect(s.paragraphs[1]).toContain('two losing seasons in a row');
    expect(ruleBreaks(l, s)).toEqual([]);
    // A new coach has no losing run of his own to answer for.
    expect(cs.some((x) => x.angle === 'seat' && x.clubId === club)).toBe(false);
  });

  it('tells a trade only when a star is in it, with what went back', () => {
    l.phase = 'draft';
    const seller = star.teamId!;
    const buyer = others[8];
    const sent = l.draftPicks.find((p) => p.season === l.season + 1 && p.round === 1)!;
    const depth = activeRoster(l, others[9]).filter((p) => p.position !== 'QB')[5];
    const side = (teamId: number, players: number[], picks: number[]) => ({ teamId, players, picks });
    l.market = {
      ...l.market!,
      history: [
        {
          season: l.season,
          phase: 'freeAgency',
          week: 0,
          kind: 'star',
          sides: [side(seller, [star.id], []), side(buyer, [], [sent.id])],
        },
        {
          season: l.season,
          phase: 'freeAgency',
          week: 0,
          kind: 'swap',
          sides: [side(others[9], [depth.id], []), side(others[10], [], [])],
        },
      ],
    } as League['market'];
    setTeam(l, star, buyer);
    const cs = dayCandidates(l, 'market', new Set()).filter((c) => c.angle === 'trade');
    expect(cs).toMatchObject([{ tier: 1, clubId: buyer, otherId: seller, playerId: star.id }]);
    const s = writeDayStory(l, cs[0], at());
    expect(s.paragraphs[1]).toContain(`received a ${l.season + 1} first-round pick in return`);
    expect(ruleBreaks(l, s)).toEqual([]);
    // The same trade is not the next day's news.
    expect(dayCandidates(l, 'draft', new Set()).filter((c) => c.angle === 'trade')).toEqual([]);
  });

  it('tells a starter still holding out and a star who changed position, on cut-down day', () => {
    const holder = activeRoster(l, others[2]).filter((p) => p.position !== 'QB')[0];
    holder.stats[last] = { gp: 17, snaps: 900 };
    holder.morale = {
      ...holder.morale!,
      dispute: { kind: 'holdOut', cause: 'deal', since: 0, club: holder.teamId!, out: true },
    } as Player['morale'];
    const from = star.position === 'CB' ? 'S' : 'CB';
    const moved = (p: Player) =>
      l.transactions.push({
        season: l.season,
        phase: 'preseason',
        week: 0,
        teamIds: [p.teamId!],
        kind: 'position',
        text: `${l.teams[p.teamId!].abbrev} moved ${from} ${p.firstName} ${p.lastName} to ${p.position}`,
        playerId: p.id,
      });
    moved(star);
    // A player with no public standing changes position without a story.
    moved(activeRoster(l, others[4]).filter((p) => p.position !== 'QB')[6]);
    const cs = dayCandidates(l, 'cuts', new Set());
    expect(cs.filter((c) => c.angle === 'holdout')).toMatchObject([{ tier: 2, playerId: holder.id }]);
    expect(cs.filter((c) => c.angle === 'position')).toMatchObject([{ tier: 2, playerId: star.id, text: from }]);
    for (const c of cs.filter((x) => x.angle === 'holdout' || x.angle === 'position')) {
      const s = writeDayStory(l, c, at());
      expect(ruleBreaks(l, s), c.angle).toEqual([]);
      expect(s.paragraphs.join(' ')).not.toMatch(/\b(will|should|expect(ed|s)?)\b/i);
    }
  });

  it('tells the team with the most new starters, with its new staff, only at the bar', () => {
    const club = others[3];
    const starters = activeRoster(l, club)
      .filter((p) => !['QB', 'K', 'P'].includes(p.position))
      .slice(0, DAY.turnover);
    for (const t of l.teams) t.jobs = { held: {} };
    for (const p of starters) {
      p.experience = 3;
      p.statTeams = { [last]: [others[4]] };
    }
    const hold = (ps: Player[]) =>
      (l.teams[club].jobs = { held: Object.fromEntries(ps.map((p) => [p.id, { pos: p.position, since: 0 }])) });
    hold(starters);
    const c = dayCandidates(l, 'kickoff', new Set()).find((x) => x.angle === 'turnover')!;
    expect(c).toMatchObject({ tier: 3, clubId: club, n: DAY.turnover });
    const s = writeDayStory(l, c, at());
    expect(s.headline).toContain('new starters');
    // No coordinator of this league has a last season on record, so the story says the staff is new too.
    expect(s.paragraphs[1]).toMatch(/new (offensive|defensive) coordinator|two new coordinators/);
    expect(ruleBreaks(l, s)).toEqual([]);
    hold(starters.slice(1));
    expect(dayCandidates(l, 'kickoff', new Set()).some((x) => x.angle === 'turnover')).toBe(false);
  });

  it('writes a first game against a mentor as a tile, never the lead', () => {
    const g = l.games.find(
      (x) => x.season === l.season && x.week === 1 && x.homeId !== l.userTeamId && x.awayId !== l.userTeamId,
    )!;
    const c: DayCandidate = {
      key: 'tree:meet:1:2',
      day: 'kickoff',
      angle: 'mentor',
      tier: 4,
      clubId: g.homeId,
      teams: [g.homeId, g.awayId],
      stakes: 1,
      coachId: hc(g.homeId).id,
      n: hc(g.awayId).id,
      otherId: g.awayId,
    };
    const s = writeDayStory(l, c, at());
    expect(s.paragraphs[0]).toContain('first time');
    expect(ruleBreaks(l, s)).toEqual([]);
    expect(cutDay([c], l.userTeamId)).toBeNull();
    const other = l.teams.map((t) => t.id).find((id) => ![g.homeId, g.awayId, l.userTeamId].includes(id))!;
    const page = cutDay([c, { ...c, key: 'x', angle: 'champion', tier: 4, clubId: other }], l.userTeamId)!;
    expect(page.lead.angle).toBe('champion');
    expect(page.tiles.map((x) => x.angle)).toEqual(['mentor']);
  });
});
