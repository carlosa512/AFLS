import { describe, expect, it } from 'vitest';
import { createLeague, SAVE_VERSION } from '../engine/generate';
import { gamesInWeek, playWeek } from '../engine/league';
import { computeRecords } from '../engine/season/standings';
import { sortRows } from './components';
import { moveSegments, type MoveIndex } from './moves';
import { hashToRoute, routeToHash, type Route } from './routes';
import { backupFileName, parseBackup } from './saves';
import { byeTeams, resultsWeek, stripGames } from './strip';

describe('routes', () => {
  it('round-trip through the address bar', () => {
    const routes: Route[] = [
      { view: 'home' },
      { view: 'roster' },
      { view: 'roster', teamId: 0 },
      { view: 'cap', teamId: 31 },
      { view: 'inbox' },
      { view: 'office' },
      { view: 'office', tab: 'draft' },
      { view: 'stats' },
      { view: 'stats', tab: 'records' },
      { view: 'stats', tab: 'awards' },
      { view: 'standings' },
      { view: 'live' },
    ];
    for (const r of routes) expect(hashToRoute(routeToHash(r))).toEqual(r);
  });

  it('send a game opened from a link back to the schedule', () => {
    expect(hashToRoute(routeToHash({ view: 'game', gameId: 42, back: { view: 'home' } }))).toEqual({ view: 'game', gameId: 42, back: { view: 'schedule' } });
  });

  it('send the old Leaders address to the Stats tab', () => {
    expect(hashToRoute('#/leaders')).toEqual({ view: 'stats', tab: 'leaders' });
  });

  it('reject anything unrecognised', () => {
    expect(hashToRoute('')).toEqual({ view: 'home' });
    for (const bad of ['#/nope', '#/office/payroll', '#/stats/trophies', '#/roster/abc', '#/game/', '#/roster/-1']) expect(hashToRoute(bad)).toBeNull();
  });
});

describe('backups', () => {
  const league = createLeague({ seed: 'backup-test' });

  it('load back what was saved', () => {
    const result = parseBackup(JSON.stringify(league));
    expect('league' in result && result.league.seed).toBe('backup-test');
    expect(backupFileName(league)).toMatch(/^afls-[a-z]+-\d{4}-\w+\.json$/);
  });

  it('turn away other files and newer versions', () => {
    expect(parseBackup('not json')).toHaveProperty('error');
    expect(parseBackup('{"hello":1}')).toHaveProperty('error');
    expect(parseBackup(JSON.stringify({ ...league, version: SAVE_VERSION + 1 }))).toMatchObject({ error: expect.stringContaining('newer') });
  });
});

describe('sortRows', () => {
  it('sorts both ways and keeps ties in order', () => {
    const rows = [
      { n: 'a', v: 2 },
      { n: 'b', v: 1 },
      { n: 'c', v: 2 },
    ];
    expect(sortRows(rows, { key: 'v', desc: true }, (r) => r.v).map((r) => r.n)).toEqual(['a', 'c', 'b']);
    expect(sortRows(rows, { key: 'v', desc: false }, (r) => r.v).map((r) => r.n)).toEqual(['b', 'a', 'c']);
  });
});

describe('transaction links', () => {
  const index: MoveIndex = new Map([
    ['WR John Smith', { kind: 'player', id: 1 }],
    ['John Smith', { kind: 'coach', id: 7 }],
    ['CB Joe Bloggs', { kind: 'player', id: 2 }],
    ['Sam Lee', null],
  ]);
  const linked = (text: string) => moveSegments(text, [index]).map((s) => (typeof s === 'string' ? s : `[${s.who.kind}:${s.who.id}]`)).join('');

  it('links every name, the longest where they overlap', () => {
    expect(linked('CIN traded WR John Smith, CB Joe Bloggs to PIT for 2027 R1')).toBe('CIN traded [player:1], [player:2] to PIT for 2027 R1');
    expect(linked('CIN hired quarterbacks coach John Smith (2 yrs)')).toBe('CIN hired quarterbacks coach [coach:7] (2 yrs)');
    expect(linked("CIN exercised WR John Smith's fifth-year option")).toBe("CIN exercised [player:1]'s fifth-year option");
  });

  it('leaves partial and shared names alone', () => {
    expect(linked('CIN released WR John Smithers')).toBe('CIN released WR John Smithers');
    expect(linked('CIN hired physiotherapist Sam Lee (2 yr)')).toBe('CIN hired physiotherapist Sam Lee (2 yr)');
  });
});

describe('score strip', () => {
  const league = createLeague({ seed: 'strip' });
  const user = league.userTeamId;
  const ours = (g: { homeId: number; awayId: number }) => g.homeId === user || g.awayId === user;

  it('shows the week ahead with our game first, and no game of the week before anyone has a record', () => {
    expect(resultsWeek(league)).toBeNull();
    const games = stripGames(league, 1);
    expect(games.map((x) => x.game.id).sort()).toEqual(gamesInWeek(league, 1).map((g) => g.id).sort());
    expect(ours(games[0].game)).toBe(true);
    expect(games[0].tag).toBe('Your game');
    expect(games.some((x) => x.gameOfWeek)).toBe(false);
  });

  it('names the best two records meeting the game of the week, lists every team off, and keeps last week as finals', () => {
    while (league.week < 8) playWeek(league);
    const records = computeRecords(league);
    const share = (id: number) => {
      const r = records.get(id)!;
      return (r.w + 0.5 * r.t) / (r.w + r.l + r.t);
    };
    const games = stripGames(league, league.week, records);
    const best = games.filter((x) => x.gameOfWeek);
    expect(best).toHaveLength(1);
    expect(best[0].tag).toBe('Game of the week');
    expect(ours(best[0].game)).toBe(false);
    const rate = (g: { homeId: number; awayId: number }) => share(g.homeId) + share(g.awayId);
    for (const x of games) if (!ours(x.game)) expect(rate(x.game)).toBeLessThanOrEqual(rate(best[0].game));
    // Our game, then the game of the week, then everything else.
    expect(games.findIndex((x) => x.gameOfWeek)).toBe(games.some((x) => ours(x.game)) ? 1 : 0);
    expect(games.length * 2 + byeTeams(league, league.week).length).toBe(league.teams.length);
    expect(resultsWeek(league)).toBe(league.week - 1);
    for (const x of stripGames(league, league.week - 1, records)) expect(x.tag).toMatch(ours(x.game) ? /^Your game · Final/ : /^Final/);
  }, 30_000);
});
