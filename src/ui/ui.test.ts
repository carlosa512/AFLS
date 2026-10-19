import { beforeAll, describe, expect, it } from 'vitest';
import { createLeague, SAVE_VERSION } from '../engine/generate';
import { deliverMail, needsYou } from '../engine/inbox';
import { gamesInWeek, playWeek } from '../engine/league';
import { computeRecords } from '../engine/season/standings';
import { teamSeasonStats } from '../engine/stats';
import { sortRows } from './components';
import { linkedSegments, moveSegments, nameIndex, type MoveIndex } from './moves';
import { hashToRoute, routeToHash, type Route } from './routes';
import { backupFileName, parseBackup } from './saves';
import { byeTeams, resultsWeek, stripGames } from './strip';
import { hurtList, wornDown } from './injuries';
import { gameStory } from './game';
import { TEAM_COLS, teamRank, teamStatSeasons } from './screens/TeamStats';
import { outlookPill, SEASON_DEFAULT, seasonFacts, waitingMail } from './widgets';

describe('routes', () => {
  it('round-trip through the address bar', () => {
    const routes: Route[] = [
      { view: 'home' },
      { view: 'roster' },
      { view: 'roster', teamId: 0 },
      { view: 'cap', teamId: 31 },
      { view: 'inbox' },
      // A trade's message id: colons, spaces and a slash all survive the address bar.
      { view: 'inbox', messageId: 'trades:2026:regular:5:BUF traded QB A. Smith to LV for 2027 R1/R2' },
      { view: 'office' },
      { view: 'office', tab: 'draft' },
      { view: 'stats' },
      { view: 'stats', tab: 'records' },
      { view: 'stats', tab: 'teams' },
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
    for (const bad of ['#/nope', '#/office/payroll', '#/stats/trophies', '#/roster/abc', '#/game/', '#/roster/-1', '#/inbox/%E0%A4%A']) expect(hashToRoute(bad)).toBeNull();
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

describe('home widgets', () => {
  const league = createLeague({ seed: 'widgets' });
  beforeAll(() => {
    deliverMail(league);
    for (let w = 0; w < 6; w++) {
      playWeek(league);
      deliverMail(league);
    }
  }, 30_000);

  it('lists the hurt longest layoff first by the doctor\'s estimate, in a pill\'s words', () => {
    const hurt = league.teams.flatMap((t) => hurtList(league, t.id));
    expect(hurt.length).toBeGreaterThan(0);
    for (const t of league.teams) {
      const list = hurtList(league, t.id);
      const est = list.map((p) => (p.injury ? p.injury.estimate[1] : -1));
      expect(est).toEqual([...est].sort((a, b) => b - a));
    }
    for (const p of hurt) expect(outlookPill(league, p)).toMatch(/^(IR · (season|ready|\d+(–\d+)? wk)|Out (for season|\d+(–\d+)? wk)|Playing hurt)$/);
    for (const p of wornDown(league, league.userTeamId)) expect(p.injury || p.ir).toBeFalsy();
  });

  it('tells our last game in a line, from our side', () => {
    const user = league.userTeamId;
    const g = league.games.filter((x) => x.result && (x.homeId === user || x.awayId === user)).at(-1)!;
    const story = gameStory(g, user);
    expect(story).toMatch(/^(Led|Trailed|Tied) \d+–\d+ at the half; (won|lost) the second half \d+–\d+|^(Led|Trailed|Tied) \d+–\d+ at the half; played the second half even/);
    // The halves add up to the final score (before overtime).
    const nums = story.match(/\d+/g)!.map(Number);
    const r = g.result!;
    const [us, them] = g.homeId === user ? [r.homeScore, r.awayScore] : [r.awayScore, r.homeScore];
    if (!r.overtime) expect([nums[0] + nums[2], nums[1] + nums[3]]).toEqual([us, them]);
  });

  it('offers every season fact, the defaults among them, with ranks in words', () => {
    const facts = seasonFacts(league);
    const keys = facts.map((f) => f.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const k of SEASON_DEFAULT) expect(keys).toContain(k);
    for (const f of facts) expect(f.value).not.toMatch(/NaN|undefined/);
    expect(facts.find((f) => f.key === 'ppg')!.sub).toMatch(/^\d+(st|nd|rd|th) in the league$/);
    expect(facts.find((f) => f.key === 'papg')!.sub).toMatch(/^(Fewest in the league|\d+(st|nd|rd|th) fewest)$/);
    expect(facts.find((f) => f.key === 'left')!.sub).toBe('of 17');
  });

  it('ranks teams in every column the right way round, ties sharing a place', () => {
    expect(teamStatSeasons(league)).toEqual([league.season]);
    const stats = teamSeasonStats(league);
    for (const col of TEAM_COLS) {
      const ranked = league.teams.map((t) => ({ v: col.value(stats.get(t.id)!), rank: teamRank(stats, col, t.id) })).sort((a, b) => a.rank - b.rank);
      expect(ranked[0].rank).toBe(1);
      for (let i = 1; i < ranked.length; i++) {
        const [a, b] = [ranked[i - 1], ranked[i]];
        if (a.v === b.v) expect(b.rank).toBe(a.rank);
        else expect(col.fewest ? a.v < b.v : a.v > b.v).toBe(true);
      }
      for (const r of ranked) expect(col.format(r.v)).not.toMatch(/NaN|Infinity/);
    }
  });

  it('links everyone by full name, and the people a message is about even when a name is shared', () => {
    const index = nameIndex(league);
    const players = Object.values(league.players);
    const unique = players.find((p) => index.get(`${p.firstName} ${p.lastName}`)?.id === p.id)!;
    const links = (text: string, about = [] as { kind: 'player'; id: number }[]) => linkedSegments(league, text, about, index).filter((x) => typeof x !== 'string');
    expect(links(`${unique.firstName} ${unique.lastName}'s contract is up`)).toEqual([{ text: `${unique.firstName} ${unique.lastName}`, who: { kind: 'player', id: unique.id } }]);
    expect(links(`Starting with ${unique.position} ${unique.firstName} ${unique.lastName} at No. 3.`)).toHaveLength(1);
    // A shared name stays plain, unless it's the message's own player.
    const twin = { ...unique, id: -1 };
    league.players[-1] = twin;
    const shared = nameIndex(league);
    delete league.players[-1];
    expect(shared.get(`${unique.firstName} ${unique.lastName}`)).toBeNull();
    expect(linkedSegments(league, `${unique.firstName} ${unique.lastName} is hurt`, [], shared).filter((x) => typeof x !== 'string')).toHaveLength(0);
    expect(linkedSegments(league, `${unique.firstName} ${unique.lastName} is hurt`, [{ kind: 'player', id: unique.id }], shared).filter((x) => typeof x !== 'string')).toHaveLength(1);
  });

  it('puts what needs you first, then the unread, newest first', () => {
    const { needs, rows } = waitingMail(league);
    expect(rows.length).toBeGreaterThan(0);
    const needy = (t: (typeof rows)[number]) => t.messages.some((m) => needs.has(m.id));
    const firstOther = rows.findIndex((t) => !needy(t));
    if (firstOther >= 0) for (const t of rows.slice(firstOther)) expect(needy(t)).toBe(false);
    for (const m of rows.flatMap((t) => t.messages)) expect(needs.has(m.id) === needsYou(league, m) && (needs.has(m.id) || !m.read)).toBe(true);
    const order = league.inbox!.map((m) => m.id);
    const unread = rows.filter((t) => !needy(t)).map((t) => order.indexOf(t.messages[0].id));
    expect(unread).toEqual([...unread].sort((a, b) => b - a));
  });
});
