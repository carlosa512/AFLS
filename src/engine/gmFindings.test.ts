/**
 * What the public record shows about a general manager's work at one team: each family on a scene built by hand, the
 * facts a paragraph will read, and a near miss.
 */
import { describe, expect, it } from 'vitest';
import { teamCoaches } from './coaching';
import { createLeague } from './generate';
import { FINDING_ORDER, gmFindings, gmSeasons, rankFindings, type Finding, type FindingFamily } from './gmFindings';
import { setTeam, teamPlayers } from './roster';
import type { GmMove, League, Player } from './types';

const T = 5;
const OTHER = 9;
type Rec = { w: number; l: number };
const LOSING: Rec = { w: 5, l: 12 };
const WINNING: Rec = { w: 11, l: 6 };

/** A league whose GM at `T` has finished these seasons there, oldest first. */
function scene(seed: string, seasons: Rec[] = [LOSING, LOSING, LOSING], teamId = T) {
  const l = createLeague({ seed });
  const gm = l.gms[l.teams[teamId].gmId!];
  gm.career = seasons.map((r, i) => ({
    season: l.season - seasons.length + i,
    teamId,
    record: { fromWeek: 1, throughWeek: 18, regular: { ...r, t: 0 }, playoffs: null, champion: false },
  }));
  // No head coach history unless a test writes it.
  for (const c of [...Object.values(l.coaches), ...Object.values(l.retiredCoaches)]) c.career = [];
  l.teams[teamId].jobs = { held: {} };
  // The picks a generated league says this team made in those years are not part of the scene.
  const first = l.season - seasons.length;
  for (const p of Object.values(l.players)) if (p.draft?.teamId === teamId && p.draft.season >= first) delete p.draft;
  return { l, gm, first };
}
const at = (l: League, pos: string, n = 0, teamId = T) => teamPlayers(l, teamId).filter((p) => p.position === pos)[n];
const drafted = (p: Player, season: number, round: number, pick: number, teamId = T) => {
  p.draft = { season, round, pick, teamId };
  return p;
};
const starts = (l: League, p: Player, teamId = T) => {
  l.teams[teamId].jobs!.held[p.id] = { pos: p.position, since: 0 };
};
const honor = (l: League, p: Player, season: number, teamId: number, key: 'mvp' | 'dpoy' | 'droy' | 'allLeague') => {
  let a = l.awards.find((x) => x.season === season);
  if (!a) l.awards.push((a = { season, winners: {}, allLeague: [[], []] }));
  if (key === 'allLeague') a.allLeague[0].push({ playerId: p.id, teamId });
  else a.winners[key] = { playerId: p.id, teamId };
};
type Trade = Extract<GmMove, { kind: 'trade' }>;
/** A trade on his record: a first-round pick given, unless the test says otherwise. */
const trade = (_l: League, season: number, over: Partial<Trade> = {}): Trade => ({
  kind: 'trade',
  season,
  phase: 'resign',
  week: 1,
  teamId: T,
  otherId: OTHER,
  gave: { players: [], picks: [{ season, round: 1 }] },
  got: { players: [], picks: [] },
  ...over,
});
const sign = (_l: League, season: number, p: Player, years = 2, total = 43_000): GmMove => ({
  kind: 'sign',
  season,
  phase: 'freeAgency',
  week: 1,
  teamId: T,
  playerId: p.id,
  years,
  total,
});
const find = <F extends FindingFamily>(found: Finding[], family: F) =>
  found.find((f) => f.family === family) as Extract<Finding, { family: F }> | undefined;

describe('a GM’s seasons at a team', () => {
  it('are his finished seasons there, oldest first', () => {
    const { l, gm, first } = scene('find-seasons', [LOSING, WINNING]);
    expect(gmSeasons(l, gm.id, T)).toEqual([
      { season: first, ...LOSING },
      { season: first + 1, ...WINNING },
    ]);
    expect(gmSeasons(l, gm.id, OTHER)).toEqual([]);
  });

  it('returns nothing for a GM with no finished season here', () => {
    const { l, gm } = scene('find-new', []);
    drafted(at(l, 'QB', 0), l.season, 1, 2);
    drafted(at(l, 'QB', 1), l.season, 1, 9);
    expect(gmFindings(l, gm.id, T)).toEqual([]);
  });
});

describe('quarterback picks', () => {
  it('are found when he has used two first-round picks on quarterbacks', () => {
    const { l, gm, first } = scene('find-qbpicks');
    const [a, b] = [drafted(at(l, 'QB', 0), first + 1, 1, 1), drafted(at(l, 'QB', 1), first + 2, 1, 2)];
    starts(l, a);
    a.stats[l.season] = { snaps: 396, gp: 7 };
    const f = find(gmFindings(l, gm.id, T), 'qbPicks')!;
    expect(f).toMatchObject({ side: 'blame', latest: first + 2 });
    expect(f.picks).toEqual([
      { playerId: a.id, season: first + 1, round: 1, pick: 1, here: true, starts: true, snaps: 396, honors: [] },
      { playerId: b.id, season: first + 2, round: 1, pick: 2, here: true, starts: false, snaps: 0, honors: [] },
    ]);
    expect(f.signed).toBeUndefined();
  });

  it('says whether the quarterback he signed came before either pick', () => {
    const { l, gm, first } = scene('find-qbsign');
    drafted(at(l, 'QB', 0), first + 1, 1, 1);
    drafted(at(l, 'QB', 1), first + 2, 1, 2);
    const third = at(l, 'QB', 0, OTHER);
    gm.deals = [sign(l, first + 1, third, 5, 17_700)];
    expect(find(gmFindings(l, gm.id, T), 'qbPicks')!.signed).toEqual({
      playerId: third.id,
      season: first + 1,
      years: 5,
      before: true,
    });
    gm.deals = [sign(l, first + 2, third, 5, 17_700)];
    expect(find(gmFindings(l, gm.id, T), 'qbPicks')!.signed!.before).toBe(false);
    // A two-year deal is no third try at the position.
    gm.deals = [sign(l, first + 1, third, 2, 17_700)];
    expect(find(gmFindings(l, gm.id, T), 'qbPicks')!.signed).toBeUndefined();
  });

  it('are not found for one quarterback, a second-round one, or picks made before he came', () => {
    const { l, gm, first } = scene('find-qbmiss');
    drafted(at(l, 'QB', 0), first + 1, 1, 1);
    drafted(at(l, 'QB', 1), first + 2, 2, 40);
    expect(find(gmFindings(l, gm.id, T), 'qbPicks')).toBeUndefined();
    drafted(at(l, 'QB', 1), first - 1, 1, 3);
    expect(find(gmFindings(l, gm.id, T), 'qbPicks')).toBeUndefined();
  });

  it('reads only his seasons at this team', () => {
    // Two seasons at team 3, then two at team 7: the quarterbacks team 3 drafted are not his work at team 7.
    const l = createLeague({ seed: 'find-two-teams' });
    const gm = l.gms[l.teams[7].gmId!];
    const row = (season: number, teamId: number) => ({
      season,
      teamId,
      record: { fromWeek: 1, throughWeek: 18, regular: { ...LOSING, t: 0 }, playoffs: null, champion: false },
    });
    gm.career = [row(l.season - 4, 3), row(l.season - 3, 3), row(l.season - 2, 7), row(l.season - 1, 7)];
    drafted(at(l, 'QB', 0, 3), l.season - 4, 1, 1, 3);
    drafted(at(l, 'QB', 1, 3), l.season - 3, 1, 2, 3);
    expect(gmFindings(l, gm.id, 7).some((f) => f.family === 'qbPicks')).toBe(false);
    expect(gmFindings(l, gm.id, 3).some((f) => f.family === 'qbPicks')).toBe(true);
  });
});

describe('quarterbacks', () => {
  const passers = (l: League, first: number, n: number) =>
    teamPlayers(l, T)
      .slice(0, n)
      .map((p, i) => {
        p.stats[first + i] = { passAtt: 400 };
        p.statTeams = { ...(p.statTeams ?? {}), [first + i]: [T] };
        return p;
      });

  it('are blame when a different one led in attempts in three seasons and two were losing', () => {
    const { l, gm, first } = scene('find-qbs', [LOSING, LOSING, WINNING]);
    const [a, b, c] = passers(l, first, 3);
    expect(find(gmFindings(l, gm.id, T), 'qbs')).toMatchObject({
      side: 'blame',
      latest: first + 2,
      passers: [
        { season: first, playerId: a.id },
        { season: first + 1, playerId: b.id },
        { season: first + 2, playerId: c.id },
      ],
    });
  });

  it('are credit when the team won every one of those seasons', () => {
    const { l, gm, first } = scene('find-qbs-won', [WINNING, WINNING, WINNING]);
    passers(l, first, 3);
    expect(find(gmFindings(l, gm.id, T), 'qbs')).toMatchObject({ side: 'credit' });
  });

  it('are not found with the same passer twice in three seasons, or one losing season among winners', () => {
    const { l, gm, first } = scene('find-qbs-miss', [WINNING, LOSING, WINNING]);
    const [a] = passers(l, first, 3);
    expect(find(gmFindings(l, gm.id, T), 'qbs')).toBeUndefined();
    const { l: m, gm: gm2, first: f2 } = scene('find-qbs-same');
    const [x, y] = passers(m, f2, 2);
    x.stats[f2 + 2] = { passAtt: 500 };
    x.statTeams![f2 + 2] = [T];
    expect(a && y && find(gmFindings(m, gm2.id, T), 'qbs')).toBeUndefined();
  });
});

describe('first-round picks', () => {
  it('are blame when fewer than half start, with how many are gone', () => {
    const { l, gm, first } = scene('find-firsts');
    const [a, b, c] = [
      drafted(at(l, 'CB', 0), first, 1, 11),
      drafted(at(l, 'WR', 0), first + 1, 1, 8),
      drafted(at(l, 'OL', 0), first + 2, 1, 5),
    ];
    starts(l, a);
    setTeam(l, c, OTHER);
    const f = find(gmFindings(l, gm.id, T), 'firsts')!;
    expect(f).toMatchObject({ side: 'blame', starting: 1, gone: 1, latest: first + 2 });
    expect(f.picks.map((p) => p.playerId)).toEqual([a.id, b.id, c.id]);
  });

  it('are credit when every one starts, and not found in between', () => {
    const { l, gm, first } = scene('find-firsts-all');
    const [a, b] = [drafted(at(l, 'CB', 0), first, 1, 11), drafted(at(l, 'WR', 0), first + 1, 1, 8)];
    starts(l, a);
    expect(find(gmFindings(l, gm.id, T), 'firsts')).toBeUndefined();
    starts(l, b);
    expect(find(gmFindings(l, gm.id, T), 'firsts')).toMatchObject({ side: 'credit', starting: 2, gone: 0 });
  });
});

describe('a draft class and a late find', () => {
  it('are credit for picks honored here', () => {
    const { l, gm, first } = scene('find-class', [WINNING, WINNING]);
    const [a, b, c] = [
      drafted(at(l, 'OL', 0), first, 1, 13),
      drafted(at(l, 'DT', 0), first, 2, 45),
      drafted(at(l, 'S', 0), first, 5, 150),
    ];
    honor(l, a, first, T, 'allLeague');
    honor(l, b, first, T, 'droy');
    honor(l, c, first + 1, T, 'allLeague');
    const found = gmFindings(l, gm.id, T);
    const cls = find(found, 'class')!;
    expect(cls).toMatchObject({ side: 'credit', latest: first + 1 });
    expect(cls.picks.map((p) => p.playerId)).toEqual([a.id, b.id, c.id]);
    expect(cls.picks[1].honors).toEqual([{ season: first, what: 'Defensive Rookie of the Year', teamId: T }]);
    expect(find(found, 'lateFind')).toMatchObject({
      side: 'credit',
      pick: { playerId: c.id, round: 5, honors: [{ season: first + 1, what: 'first-team All-League', teamId: T }] },
    });
  });

  it('do not count an honor won with another team, or a single honored pick as a class', () => {
    const { l, gm, first } = scene('find-class-miss', [WINNING, WINNING]);
    const [a, b] = [drafted(at(l, 'OL', 0), first, 1, 13), drafted(at(l, 'S', 0), first, 5, 150)];
    honor(l, a, first, T, 'allLeague');
    honor(l, b, first + 1, OTHER, 'allLeague');
    const found = gmFindings(l, gm.id, T);
    expect(find(found, 'class')).toBeUndefined();
    expect(find(found, 'lateFind')).toBeUndefined();
  });
});

describe('the trade for a star', () => {
  it('is one player for a first-round pick or more', () => {
    const { l, gm, first } = scene('find-star', [WINNING, WINNING]);
    const star = at(l, 'QB', 0);
    const [x, y] = teamPlayers(l, T).filter((p) => p.id !== star.id);
    // Picks for picks.
    gm.deals = [trade(l, first, { got: { players: [], picks: [{ season: first, round: 2 }] } })];
    expect(find(gmFindings(l, gm.id, T), 'starTrade')).toBeUndefined();
    // A first-round pick for two players.
    gm.deals = [trade(l, first, { got: { players: [x.id, y.id], picks: [] } })];
    expect(find(gmFindings(l, gm.id, T), 'starTrade')).toBeUndefined();
    // No first-round pick in it.
    gm.deals = [
      trade(l, first, {
        gave: { players: [], picks: [{ season: first, round: 2 }] },
        got: { players: [star.id], picks: [] },
      }),
    ];
    expect(find(gmFindings(l, gm.id, T), 'starTrade')).toBeUndefined();
    // One player for a first, and he won the award here.
    const move = trade(l, first, { got: { players: [star.id], picks: [] } });
    gm.deals = [move];
    honor(l, star, first, T, 'mvp');
    l.history.push({ season: first, championId: T, runnerUpId: OTHER, records: {}, playoffs: {} } as never);
    expect(find(gmFindings(l, gm.id, T), 'starTrade')).toEqual({
      family: 'starTrade',
      side: 'credit',
      latest: first,
      move,
      playerId: star.id,
      here: true,
      honors: [{ season: first, what: 'Most Valuable Player', teamId: T }],
      title: first,
    });
  });

  it('is blame a season on when he has won nothing here and is gone or does not start', () => {
    const { l, gm, first } = scene('find-star-bust');
    const p = at(l, 'WR', 0);
    gm.deals = [trade(l, first, { got: { players: [p.id], picks: [] } })];
    expect(find(gmFindings(l, gm.id, T), 'starTrade')).toMatchObject({ side: 'blame', here: true, title: null });
    starts(l, p);
    expect(find(gmFindings(l, gm.id, T), 'starTrade')).toBeUndefined();
    setTeam(l, p, OTHER);
    expect(find(gmFindings(l, gm.id, T), 'starTrade')).toMatchObject({ side: 'blame', here: false });
    // Traded for this league year: no full season to judge it by.
    gm.deals = [trade(l, l.season, { got: { players: [p.id], picks: [] } })];
    expect(find(gmFindings(l, gm.id, T), 'starTrade')).toBeUndefined();
  });

  it('names a later star trade beside the one that paid', () => {
    const { l, gm, first } = scene('find-star-again', [WINNING, WINNING]);
    const [star, second] = [at(l, 'QB', 0), at(l, 'OL', 0)];
    const later = trade(l, first + 2, { got: { players: [second.id], picks: [] } });
    gm.deals = [trade(l, first, { got: { players: [star.id], picks: [] } }), later];
    honor(l, star, first, T, 'mvp');
    expect(find(gmFindings(l, gm.id, T), 'starTrade')!.again).toEqual(later);
  });
});

describe('the big contract', () => {
  it('is blame when he is on another team inside two seasons, and credit when he starts here with an honor', () => {
    const { l, gm, first } = scene('find-contract');
    const p = at(l, 'OL', 0);
    const move = sign(l, first + 1, p, 3);
    gm.deals = [move];
    expect(find(gmFindings(l, gm.id, T), 'contract')).toBeUndefined();
    setTeam(l, p, OTHER);
    expect(find(gmFindings(l, gm.id, T), 'contract')).toEqual({
      family: 'contract',
      side: 'blame',
      latest: first + 1,
      move,
      here: false,
      nowTeamId: OTHER,
      honors: [],
    });
    setTeam(l, p, T);
    starts(l, p);
    honor(l, p, first + 2, T, 'allLeague');
    expect(find(gmFindings(l, gm.id, T), 'contract')).toMatchObject({ side: 'credit', here: true, latest: first + 2 });
  });

  it('is not blamed for a deal that ran its length', () => {
    const { l, gm } = scene('find-contract-ran');
    const p = at(l, 'OL', 0);
    // One year, signed for last season: he left when it ended, as a one-year deal does.
    gm.deals = [sign(l, l.season - 1, p, 1)];
    setTeam(l, p, OTHER);
    expect(find(gmFindings(l, gm.id, T), 'contract')).toBeUndefined();
    // Two years, signed for last season: he is gone with a year of it left.
    gm.deals = [sign(l, l.season - 1, p, 2)];
    expect(find(gmFindings(l, gm.id, T), 'contract')).toMatchObject({ side: 'blame' });
  });

  it('is not blamed when he was traded for a first-round pick, and neither is letting that player go', () => {
    const { l, gm, first } = scene('find-sold');
    const p = at(l, 'CB', 0);
    setTeam(l, p, OTHER);
    p.left = [{ teamId: T, season: first + 2, how: 'traded' }];
    honor(l, p, first + 2, OTHER, 'allLeague');
    gm.deals = [sign(l, first + 1, p, 4, 105_600)];
    const found = () => gmFindings(l, gm.id, T).filter((f) => f.family === 'contract' || f.family === 'left');
    expect(
      found()
        .map((f) => f.family)
        .sort(),
    ).toEqual(['contract', 'left']);
    // The same departure, with a first-round pick coming back for him.
    gm.deals.push(
      trade(l, first + 2, {
        gave: { players: [p.id], picks: [] },
        got: { players: [], picks: [{ season: first + 4, round: 1 }] },
      }),
    );
    expect(found()).toEqual([]);
    // A fifth-round pick coming back changes nothing.
    gm.deals[1] = trade(l, first + 2, {
      gave: { players: [p.id], picks: [] },
      got: { players: [], picks: [{ season: first + 4, round: 5 }] },
    });
    expect(
      found()
        .map((f) => f.family)
        .sort(),
    ).toEqual(['contract', 'left']);
  });

  it('is not blamed for a deal three seasons old', () => {
    const { l, gm, first } = scene('find-contract-old');
    const p = at(l, 'OL', 0);
    gm.deals = [sign(l, first, p)];
    setTeam(l, p, OTHER);
    expect(find(gmFindings(l, gm.id, T), 'contract')).toBeUndefined();
  });
});

describe('the one who left', () => {
  it('is a player who left under him and has been honored elsewhere since', () => {
    const { l, gm, first } = scene('find-left');
    const p = at(l, 'EDGE', 0);
    setTeam(l, p, OTHER);
    p.left = [{ teamId: T, season: first + 1, how: 'traded' }];
    expect(find(gmFindings(l, gm.id, T), 'left')).toBeUndefined();
    honor(l, p, first + 2, OTHER, 'dpoy');
    expect(find(gmFindings(l, gm.id, T), 'left')).toEqual({
      family: 'left',
      side: 'blame',
      latest: first + 2,
      playerId: p.id,
      how: 'traded',
      season: first + 1,
      nowTeamId: OTHER,
      honors: [{ season: first + 2, what: 'Defensive Player of the Year', teamId: OTHER }],
    });
  });

  it('is not found for a player who left before he came', () => {
    const { l, gm, first } = scene('find-left-before');
    const p = at(l, 'EDGE', 0);
    setTeam(l, p, OTHER);
    p.left = [{ teamId: T, season: first - 1, how: 'walked' }];
    honor(l, p, first, OTHER, 'dpoy');
    expect(find(gmFindings(l, gm.id, T), 'left')).toBeUndefined();
  });

  it('finds no "left" or blamed "contract" for a player who has retired or is unsigned', () => {
    const { l, gm, first } = scene('find-gone');
    const [a, b] = [at(l, 'EDGE', 0), at(l, 'OL', 0)];
    setTeam(l, a, OTHER);
    a.left = [{ teamId: T, season: first + 1, how: 'cut' }];
    honor(l, a, first + 2, OTHER, 'dpoy');
    gm.deals = [sign(l, first + 1, b, 3)];
    setTeam(l, b, OTHER);
    const both = () => gmFindings(l, gm.id, T).filter((f) => f.family === 'left' || f.family === 'contract');
    expect(both()).toHaveLength(2);
    a.retired = true;
    b.retired = true;
    expect(both()).toEqual([]);
    delete a.retired;
    delete b.retired;
    setTeam(l, a, null);
    setTeam(l, b, null);
    expect(both()).toEqual([]);
  });
});

describe('head coaches', () => {
  const coach = (l: League, n: number, seasons: number[], teamId = T) => {
    const c = Object.values(l.coaches)[n];
    c.career = [...(c.career ?? []), ...seasons.map((season) => ({ season, teamId, role: 'headCoach' as const }))];
    return c;
  };

  it('are blame when he is on his third', () => {
    const { l, gm, first } = scene('find-coaches');
    const [a, b, c] = [coach(l, 0, [first]), coach(l, 1, [first + 1, first + 2]), coach(l, 2, [first + 3])];
    expect(find(gmFindings(l, gm.id, T), 'coaches')).toEqual({
      family: 'coaches',
      side: 'blame',
      latest: first + 3,
      coachIds: [a.id, b.id, c.id],
      hiredFirst: false,
    });
  });

  it('are credit for one coach he hired when he came, never for the coach a league began with', () => {
    // The GM came a season after the league's first: the coach who started that year is his hire.
    const { l, gm, first } = scene('find-coach-hire', [WINNING, WINNING]);
    l.history.push({ season: first - 1, championId: 0, runnerUpId: 1, records: {}, playoffs: {} } as never);
    const c = coach(l, 0, [first, first + 1, first + 2]);
    expect(find(gmFindings(l, gm.id, T), 'coaches')).toMatchObject({
      side: 'credit',
      coachIds: [c.id],
      hiredFirst: true,
    });
    // With no season on record before he came, nobody can say who hired the coach.
    l.history.length = 0;
    expect(find(gmFindings(l, gm.id, T), 'coaches')).toBeUndefined();
    // A coach who was here before him is not his hire either.
    l.history.push({ season: first - 1, championId: 0, runnerUpId: 1, records: {}, playoffs: {} } as never);
    c.career!.unshift({ season: first - 1, teamId: T, role: 'headCoach' });
    expect(find(gmFindings(l, gm.id, T), 'coaches')).toBeUndefined();
  });
});

describe('a new head coach who is winning', () => {
  it('is credit for the GM who was here before him', () => {
    const { l, gm } = scene('find-new-coach', [LOSING]);
    const hc = teamCoaches(l, T).find((c) => c.role === 'headCoach')!;
    delete hc.interim;
    // Six games in, four of them won.
    const mine = l.games.filter((g) => g.season === l.season && !g.playoffRound && (g.homeId === T || g.awayId === T));
    mine.slice(0, 6).forEach((g, i) => {
      const won = i < 4;
      const home = g.homeId === T;
      g.result = { homeScore: won === home ? 24 : 13, awayScore: won === home ? 13 : 24 } as never;
    });
    expect(find(gmFindings(l, gm.id, T), 'coaches')).toEqual({
      family: 'coaches',
      side: 'credit',
      latest: l.season,
      coachIds: [hc.id],
      hiredFirst: false,
      newCoach: true,
    });
    // Winning after a winning season is no turnaround to credit the hire with.
    gm.career[0].record!.regular = { w: 12, l: 5, t: 0 };
    expect(find(gmFindings(l, gm.id, T), 'coaches')).toBeUndefined();
    gm.career[0].record!.regular = { ...LOSING, t: 0 };
    // A coach who was here last season is not a new hire, and neither is an interim.
    hc.career = [{ season: l.season - 1, teamId: T, role: 'headCoach' }];
    expect(find(gmFindings(l, gm.id, T), 'coaches')).toBeUndefined();
    hc.career = [];
    hc.interim = true;
    expect(find(gmFindings(l, gm.id, T), 'coaches')).toBeUndefined();
  });
});

describe('ranking', () => {
  it('keeps one side, by the fixed order, then the newest fact', () => {
    const mk = (family: FindingFamily, side: 'blame' | 'credit', latest: number) =>
      ({ family, side, latest }) as Finding;
    const found = [
      mk('firsts', 'blame', 2028),
      mk('class', 'credit', 2028),
      mk('left', 'blame', 2027),
      mk('qbPicks', 'blame', 2026),
    ];
    expect(rankFindings(found, 'blame', 'k').map((f) => f.family)).toEqual(['qbPicks', 'left', 'firsts']);
    expect(rankFindings(found, 'credit', 'k').map((f) => f.family)).toEqual(['class']);
    expect(FINDING_ORDER.blame).toEqual(['qbPicks', 'left', 'starTrade', 'contract', 'firsts', 'qbs', 'coaches']);
    expect(FINDING_ORDER.credit).toEqual(['starTrade', 'class', 'lateFind', 'qbs', 'contract', 'firsts', 'coaches']);
  });
});
