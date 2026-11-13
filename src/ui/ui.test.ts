import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { createLeague, SAVE_VERSION } from '../engine/generate';
import { deliverMail, needsYou } from '../engine/inbox';
import { gamesInWeek, playWeek } from '../engine/league';
import { computeRecords, divisionStandings } from '../engine/season/standings';
import { teamSeasonStats } from '../engine/stats';
import { NUMBER_MIN_PX, sortRows } from './components';
import { linkedSegments, moveSegments, nameIndex, type MoveIndex } from './moves';
import { hashToRoute, routeToHash, type Route } from './routes';
import { backupFileName, parseBackup } from './saves';
import { byeTeams, resultsWeek, stripGames } from './strip';
import { hurtList, wornDown } from './injuries';
import { gameStory } from './game';
import { standingsSortValue } from './screens/Standings';
import { coordinatorFor } from './training';
import { installInterimHeadCoach, teamCoaches } from '../engine/coaching';
import { startCareer } from './screens/NewGame';
import { TEAM_COLS, teamRank, teamStatSeasons } from './screens/TeamStats';
import { defaultTradeTab, stickyTradeTab } from './screens/Trades';
import { tradeDesk } from './tradeDesk';
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
      { view: 'office', tab: 'fa', pos: 'S' },
      { view: 'office', tab: 'trades', sub: 'block' },
      { view: 'stats' },
      { view: 'stats', tab: 'records' },
      { view: 'stats', tab: 'teams' },
      { view: 'stats', tab: 'awards' },
      { view: 'standings' },
      { view: 'locker' },
      { view: 'live' },
    ];
    for (const r of routes) expect(hashToRoute(routeToHash(r))).toEqual(r);
  });

  it('send a game opened from a link back to the schedule', () => {
    expect(hashToRoute(routeToHash({ view: 'game', gameId: 42, back: { view: 'home' } }))).toEqual({
      view: 'game',
      gameId: 42,
      back: { view: 'schedule' },
    });
  });

  it('opens the trade table by default and when a draft is waiting', () => {
    const league = createLeague({ seed: 'tabs' });
    expect(defaultTradeTab(league)).toBe('table');
    tradeDesk.put({ partnerId: 1, mine: { players: [], picks: [] }, theirs: { players: [], picks: [] } });
    expect(defaultTradeTab(league)).toBe('table');
    tradeDesk.take();
  });

  it('keeps the trades view it opened on until a link names another', () => {
    const league = createLeague({ seed: 'tabs' });
    // Opened on Offers (one was pending); the last one answered, the screen stays put instead of jumping to the table.
    expect(stickyTradeTab('offers', undefined, league)).toBe('offers');
    expect(stickyTradeTab(undefined, undefined, league)).toBe(defaultTradeTab(league));
    expect(stickyTradeTab('offers', 'block', league)).toBe('block');
  });

  it('send the old Leaders address to the Stats tab', () => {
    expect(hashToRoute('#/leaders')).toEqual({ view: 'stats', tab: 'leaders' });
  });

  it('reject anything unrecognised', () => {
    expect(hashToRoute('')).toEqual({ view: 'home' });
    for (const bad of [
      '#/nope',
      '#/office/payroll',
      '#/office/trades/nope',
      '#/office/fa/block',
      '#/stats/trophies',
      '#/roster/abc',
      '#/game/',
      '#/roster/-1',
      '#/inbox/%E0%A4%A',
    ])
      expect(hashToRoute(bad)).toBeNull();
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
    expect(parseBackup(JSON.stringify({ ...league, version: SAVE_VERSION + 1 }))).toMatchObject({
      error: expect.stringContaining('newer'),
    });
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
  const linked = (text: string) =>
    moveSegments(text, [index])
      .map((s) => (typeof s === 'string' ? s : `[${s.who.kind}:${s.who.id}]`))
      .join('');

  it('links every name, the longest where they overlap', () => {
    expect(linked('CIN traded WR John Smith, CB Joe Bloggs to PIT for 2027 R1')).toBe(
      'CIN traded [player:1], [player:2] to PIT for 2027 R1',
    );
    expect(linked('CIN hired quarterbacks coach John Smith (2 yrs)')).toBe(
      'CIN hired quarterbacks coach [coach:7] (2 yrs)',
    );
    expect(linked("CIN exercised WR John Smith's fifth-year option")).toBe(
      "CIN exercised [player:1]'s fifth-year option",
    );
  });

  it('leaves partial and shared names alone', () => {
    expect(linked('CIN released WR John Smithers')).toBe('CIN released WR John Smithers');
    expect(linked('CIN hired physiotherapist Sam Lee (2 yr)')).toBe('CIN hired physiotherapist Sam Lee (2 yr)');
  });

  it('links a team by its city in mail, unless two teams share it', () => {
    const league = createLeague({ seed: 'city-links' });
    const show = (text: string) =>
      linkedSegments(league, text)
        .map((s) => (typeof s === 'string' ? s : `[${s.who.kind}:${s.who.id}]`))
        .join('');
    const lone = league.teams.find((t) => league.teams.filter((u) => u.city === t.city).length === 1)!;
    const shared = league.teams.find((t) => league.teams.filter((u) => u.city === t.city).length > 1)!;
    expect(show(`We'd like to bring him to ${lone.city}.`)).toBe(`We'd like to bring him to [team:${lone.id}].`);
    expect(show(`A trip to ${shared.city}.`)).toBe(`A trip to ${shared.city}.`);
    // A player named after a city is still the player.
    const p = Object.values(league.players)[0];
    p.lastName = lone.city;
    expect(show(`${p.firstName} ${p.lastName} signs`)).toBe(`[player:${p.id}] signs`);
  });
});

describe('score strip', () => {
  const league = createLeague({ seed: 'strip' });
  const user = league.userTeamId;
  const ours = (g: { homeId: number; awayId: number }) => g.homeId === user || g.awayId === user;

  it('shows the week ahead with our game first, and no game of the week before anyone has a record', () => {
    expect(resultsWeek(league)).toBeNull();
    const games = stripGames(league, 1);
    expect(games.map((x) => x.game.id).sort()).toEqual(
      gamesInWeek(league, 1)
        .map((g) => g.id)
        .sort(),
    );
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
    for (const x of stripGames(league, league.week - 1, records))
      expect(x.tag).toMatch(ours(x.game) ? /^Your game · Final/ : /^Final/);
  });
});

describe('home widgets', () => {
  const league = createLeague({ seed: 'widgets' });
  beforeAll(() => {
    deliverMail(league);
    for (let w = 0; w < 6; w++) {
      playWeek(league);
      deliverMail(league);
    }
  });

  it("lists the hurt longest layoff first by the doctor's estimate, in a pill's words", () => {
    const hurt = league.teams.flatMap((t) => hurtList(league, t.id));
    expect(hurt.length).toBeGreaterThan(0);
    for (const t of league.teams) {
      const list = hurtList(league, t.id);
      const est = list.map((p) => (p.injury ? p.injury.estimate[1] : -1));
      expect(est).toEqual([...est].sort((a, b) => b - a));
    }
    for (const p of hurt)
      expect(outlookPill(league, p)).toMatch(
        /^(IR · (season|ready|protocol|\d+(–\d+)? wk)|Out (for season|\d+(–\d+)? wk)|Playing hurt|Protocol)$/,
      );
    for (const p of wornDown(league, league.userTeamId)) expect(p.injury || p.ir).toBeFalsy();
  });

  it('tells our last game in a line, from our side', () => {
    const user = league.userTeamId;
    const g = league.games.filter((x) => x.result && (x.homeId === user || x.awayId === user)).at(-1)!;
    const story = gameStory(g, user);
    expect(story).toMatch(
      /^(Led|Trailed|Tied) \d+–\d+ at the half; (won|lost) the second half \d+–\d+|^(Led|Trailed|Tied) \d+–\d+ at the half; played the second half even/,
    );
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
      const ranked = league.teams
        .map((t) => ({ v: col.value(stats.get(t.id)!), rank: teamRank(stats, col, t.id) }))
        .sort((a, b) => a.rank - b.rank);
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
    const links = (text: string, about = [] as { kind: 'player'; id: number }[]) =>
      linkedSegments(league, text, about, index).filter((x) => typeof x !== 'string');
    expect(links(`${unique.firstName} ${unique.lastName}'s contract is up`)).toEqual([
      { text: `${unique.firstName} ${unique.lastName}`, who: { kind: 'player', id: unique.id } },
    ]);
    expect(links(`Starting with ${unique.position} ${unique.firstName} ${unique.lastName} at No. 3.`)).toHaveLength(1);
    // A shared name stays plain, unless it's the message's own player.
    const twin = { ...unique, id: -1 };
    league.players[-1] = twin;
    const shared = nameIndex(league);
    delete league.players[-1];
    expect(shared.get(`${unique.firstName} ${unique.lastName}`)).toBeNull();
    expect(
      linkedSegments(league, `${unique.firstName} ${unique.lastName} is hurt`, [], shared).filter(
        (x) => typeof x !== 'string',
      ),
    ).toHaveLength(0);
    expect(
      linkedSegments(
        league,
        `${unique.firstName} ${unique.lastName} is hurt`,
        [{ kind: 'player', id: unique.id }],
        shared,
      ).filter((x) => typeof x !== 'string'),
    ).toHaveLength(1);
  });

  it('links team names to their roster, the full name over the nickname', () => {
    const other = league.teams.find((t) => league.teams.filter((u) => u.name === t.name).length === 1)!;
    const links = (text: string) => linkedSegments(league, text).filter((x) => typeof x !== 'string');
    expect(links(`We face the ${other.city} ${other.name} on the road`)).toEqual([
      { text: `${other.city} ${other.name}`, who: { kind: 'team', id: other.id } },
    ]);
    expect(links(`The ${other.name} ask about a pick`)).toEqual([
      { text: other.name, who: { kind: 'team', id: other.id } },
    ]);
    // Lower case is ordinary prose, and the nickname matches whole words only.
    expect(links(`a ${other.name.toLowerCase()} day, ${other.name}s and ${other.name}ish`)).toHaveLength(0);
  });

  it('links a person over a team when they share a name', () => {
    const team = league.teams[0];
    const p = Object.values(league.players)[0];
    const [first, last] = [p.firstName, p.lastName];
    p.firstName = team.city;
    p.lastName = team.name;
    try {
      const hit = linkedSegments(league, `${team.city} ${team.name} is hurt`).filter((x) => typeof x !== 'string');
      expect(hit).toEqual([{ text: `${team.city} ${team.name}`, who: { kind: 'player', id: p.id } }]);
    } finally {
      p.firstName = first;
      p.lastName = last;
    }
  });

  it('puts what needs you first, then the unread, newest first', () => {
    const { needs, rows } = waitingMail(league);
    expect(rows.length).toBeGreaterThan(0);
    const needy = (t: (typeof rows)[number]) => t.messages.some((m) => needs.has(m.id));
    const firstOther = rows.findIndex((t) => !needy(t));
    if (firstOther >= 0) for (const t of rows.slice(firstOther)) expect(needy(t)).toBe(false);
    for (const m of rows.flatMap((t) => t.messages))
      expect(needs.has(m.id) === needsYou(league, m) && (needs.has(m.id) || !m.read)).toBe(true);
    const order = league.inbox!.map((m) => m.id);
    const unread = rows.filter((t) => !needy(t)).map((t) => order.indexOf(t.messages[0].id));
    expect(unread).toEqual([...unread].sort((a, b) => b - a));
  });
});

/**
 * The screen contract (docs/UI.md): names always link, tables sort and mark your row the same way, every team
 * dropdown is the shared picker, and nothing reads the truth past the fog of war. A new screen that breaks a rule
 * fails here; fix the screen, never widen an allow-list without a reason in its comment.
 */
describe('screen contract', () => {
  const files = ['src/ui', 'src/ui/screens']
    .flatMap((d) =>
      readdirSync(d)
        .filter((f) => /\.tsx$/.test(f) && !/\.test\./.test(f))
        .map((f) => join(d, f)),
    )
    .filter((f) => !f.endsWith('components.tsx'));
  const src = (f: string) => readFileSync(f, 'utf8');

  it('keeps iPhone Safari from enlarging the text of a table wider than the screen', () => {
    const css = readFileSync('src/styles.css', 'utf8');
    expect(css).toMatch(/html \{[^}]*-webkit-text-size-adjust: 100%;[^}]*text-size-adjust: 100%;/);
  });

  it('draws a player big enough to read his number, wherever a screen shows his picture', () => {
    // Under `NUMBER_MIN_PX` the avatar is a plain figure with no number on it: no list is that tight.
    const small: string[] = [];
    for (const f of files)
      for (const m of src(f).matchAll(/<PlayerLink\b[^>]*?\bavatar=\{(\d+)\}|<PlayerAvatar\b[^>]*?\bsize=\{(\d+)\}/g))
        if (Number(m[1] ?? m[2]) < NUMBER_MIN_PX) small.push(`${f}: ${m[0].slice(0, 60)}`);
    expect(small).toEqual([]);
  });

  // Every non-test source file under src/ui, at any depth, components.tsx included.
  const allUi = (dir = 'src/ui'): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory()
        ? allUi(join(dir, e.name))
        : /\.tsx?$/.test(e.name) && !/\.test\./.test(e.name)
          ? [join(dir, e.name)]
          : [],
    );

  it('draws icons only through Icon', () => {
    // Characters every font (and iOS's emoji) draws its own way. An arrow inside text ("EDGE → DT") is punctuation.
    const glyph = /[▲▼▴▾▸▶◀❚✕✎✓‹›←↑↓↗↘]/;
    const allowed: [file: string, text: string, why: string][] = [
      [join('src/ui', 'mail.tsx'), '/^(.*?)\\s*([▲▼])(\\d+)$/', "reads the engine's change marks"],
      [join('src/ui', 'mail.tsx'), "=== '▲'", "reads the engine's change marks"],
    ];
    const hits: string[] = [];
    for (const f of allUi().filter((f) => !f.endsWith('icons.tsx')))
      src(f)
        .split('\n')
        .forEach((line, i) => {
          const t = line.trim();
          if (/^(\/\/|\*|\/\*)/.test(t) || !glyph.test(line)) return;
          if (allowed.some(([af, text]) => af === f && line.includes(text))) return;
          hits.push(`${f}:${i + 1}`);
        });
    for (const m of readFileSync('src/styles.css', 'utf8').matchAll(/content:\s*'([^']*)'/g))
      if (glyph.test(m[1])) hits.push(`src/styles.css: content '${m[1]}'`);
    expect(hits).toEqual([]);
  });

  it('names every button that holds only an icon', () => {
    const bad: string[] = [];
    for (const f of allUi())
      for (const m of src(f).matchAll(/<button\b([^>]*)>\s*<Icon\b[^>]*\/>\s*<\/button>/g))
        if (!/aria-label=/.test(m[1])) bad.push(`${f}: ${m[0].slice(0, 80)}`);
    expect(bad).toEqual([]);
  });

  it('goes to another screen through MoreLink', () => {
    // A bordered button does something here; going somewhere else is a MoreLink (docs/UI.md, "Links to another
    // screen"). The yellow primary may go somewhere: it is the one main thing to do in its panel.
    const go = String.raw`onClick=\{\(\) => nav\.(?:go|openGame|watchGame)\([^)]*\)\}`;
    const btn = String.raw`className="btn(?![^"]*btn-primary)[^"]*"`;
    const either = new RegExp(String.raw`<button\b(?=[^>]*${btn})(?=[^>]*${go})[^>]*>`, 'g');
    const bad: string[] = [];
    for (const f of allUi())
      for (const m of src(f).matchAll(either))
        bad.push(`${f}:${src(f).slice(0, m.index).split('\n').length} (use MoreLink)`);
    expect(bad).toEqual([]);
    const rule = /\.more-link \{([^}]*)\}/.exec(readFileSync('src/styles.css', 'utf8'))?.[1] ?? '';
    expect(Number(/min-height:\s*(\d+)px/.exec(rule)?.[1] ?? 0)).toBeGreaterThanOrEqual(32);
  });

  it('sizes app text from the scale, and writes the label once', () => {
    // Exempt by selector, each for a reason. Everything else sizes text with --step-* and writes an uppercase label
    // only through the two shared label rules (`.eyebrow`, `.eyebrow-sm`). docs/UI.md, "Labels and text sizes".
    const EXEMPT = [
      '.ed-', // SNN's newspaper keeps its own type
      '.vb-', // the game viewer and broadcast, from here down: a look of their own
      '.vc-',
      '.tl-',
      '.rail-',
      '.pg-',
      '.mc-',
      '.mb-',
      '.mp-',
      '.bug-',
      '.endzone',
      '.cmp-',
      '.lead-',
      '.line-row',
      '.game-injuries',
      '.td-',
      '.chart', // SVG chart text, sized in px
      '.dev-chart',
      '.dev-tip',
      '.rookie-mark', // sized to the heading it sits in
      '.sheet-head .rookie-mark',
    ];
    const css = readFileSync('src/styles.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const bad: string[] = [];
    for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const sel = m[1].trim().replace(/\s+/g, ' ');
      const parts = sel.split(',').map((x) => x.trim());
      if (parts.every((x) => EXEMPT.some((e) => x.startsWith(e)))) continue;
      for (const v of m[2].matchAll(/font-size:\s*([^;]+);/g))
        if (/^[\d.]+(rem|em|px)$/.test(v[1].trim()) && v[1].trim() !== '16px') bad.push(`${sel}: ${v[1].trim()}`);
      if (/text-transform:\s*uppercase/.test(m[2]) && parts[0] !== '.eyebrow' && parts[0] !== '.eyebrow-sm')
        bad.push(`${sel}: uppercase outside the shared label rules`);
    }
    expect(bad).toEqual([]);
  });

  it('renders player names only through PlayerLink', () => {
    // The card's own header, the "signed" toast and the play-by-play (it links by index) are not links by design.
    const allowed = ['src/ui/screens/PlayerCard.tsx', 'src/ui/negotiation.tsx', 'src/ui/screens/GameViewer.tsx'];
    const raw = /\{\w+\.firstName\} \{\w+\.lastName\}/;
    const handRolled = /className="linklike[^"]*"[^>]*onClick=\{\(\) => nav\.openPlayer\(/;
    const bad = files.filter((f) => !allowed.includes(f) && (raw.test(src(f)) || handRolled.test(src(f))));
    expect(bad).toEqual([]);
  });

  it('never shows a GM’s archetype or habits', () => {
    const bad = files.filter((f) =>
      /\.archetype\b|\.habits\b|\bhabitLog\b|\bhabitMarbles\b|\bHABITS\b|\bwithYou\b|\bstandingWith\b|\bYouMoment\b/.test(
        src(f),
      ),
    );
    expect(bad).toEqual([]);
  });

  it('keeps engine words off the screen', () => {
    // Players read football words: never a marble, a trait or a z-score (spec §5.5).
    // Comments are for developers and may say "trait"; only what renders counts.
    const copy = (f: string) =>
      src(f)
        .replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')
        .replace(/^import[\s\S]*?from '[^']*';$/gm, '');
    const bad = files.filter((f) => /['"`>][^'"`<{}\n]*\b(marbles?|traits?|z-score)\b/i.test(copy(f)));
    expect(bad).toEqual([]);
  });

  it('renders team names only through TeamLink', () => {
    const bad = files.filter((f) => /<TeamLabel|linklike team-inline" onClick=\{\(\) => nav\.openTeam/.test(src(f)));
    expect(bad).toEqual([]);
  });

  it('marks your row with is-user only', () => {
    const bad = files.filter((f) => /['"`]me['"`]\s*:\s*undefined|className=\{[^}]*\?\s*'me'/.test(src(f)));
    expect(bad).toEqual([]);
  });

  it('offers league or mine as the seg control, not a select', () => {
    expect(/<select\s+aria-label="Players"/.test(src('src/ui/screens/Stats.tsx'))).toBe(false);
  });

  it("never reads a club's true strength", () => {
    // teamRatings is the truth; screens show perceivedTeamRatings (fog of war). New Game is the one exception,
    // by the owner's call: before you take a job you have no scouts, and its overall is how you pick a project.
    const bad = files.filter((f) => f !== join('src/ui/screens', 'NewGame.tsx') && /\bteamRatings\b/.test(src(f)));
    expect(bad).toEqual([]);
  });

  it('never reads the truth past the fog of war', () => {
    // A screen shows its own club's view only (docs/UI.md, "Fog of war"). ui/scouting.tsx is the one place that
    // reads true ratings, and only for an exact view of your own player (his rating changes). Hidden traits have
    // their own guard in engine/development.test.ts, which scans this file too, so the pattern leaves them out.
    const truth = /\b(p|player)\.ratings\b|\bplayerOvr\b|\.potential\b|\bweeksRemaining\b|\bceilingShifts\b/;
    const bad = files.filter((f) => f !== join('src/ui', 'scouting.tsx') && truth.test(src(f)));
    expect(bad).toEqual([]);
  });

  it('reads moods only through moraleView', () => {
    // A mood is your own players' only (fog of war), in words: no screen reads the stored level or its jolts.
    const bad = files.filter((f) => /\.morale\b|\bmoraleLevel\b|\bmoraleFactors\b/.test(src(f)));
    expect(bad).toEqual([]);
  });

  it('shows origins only through OriginTag, on the player card and the draft board', () => {
    const reads = files.filter(
      (f) => f !== join('src/ui', 'origin.tsx') && /\bORIGINS\b|\boriginOf\(|\b(p|player)\.origin\b/.test(src(f)),
    );
    expect(reads).toEqual([]);
    const shown = files.filter((f) => /<OriginTag\b/.test(src(f))).sort();
    // The squad desk lists who can take the international place (profile v2).
    expect(shown).toEqual([
      join('src/ui/screens', 'Draft.tsx'),
      join('src/ui/screens', 'PlayerCard.tsx'),
      join('src/ui/screens', 'PracticeSquad.tsx'),
    ]);
    expect(src(join('src/ui/screens', 'Draft.tsx'))).toContain('label="School"');
  });

  it('builds team dropdowns only with TeamPicker', () => {
    const bad = files.filter((f) => /\[\.\.\.league\.teams\]\s*\.(sort|filter)/.test(src(f)));
    expect(bad).toEqual([]);
  });
});

describe('standings sort', () => {
  it('sorts each division on its own and restores the tiebreaker order', () => {
    const league = createLeague({ seed: 'standings' });
    for (let i = 0; i < 6; i++) playWeek(league);
    const d = divisionStandings(league, computeRecords(league))[0];
    const rows = d.teams.map((r, i) => ({ r, i }));
    const byPf = sortRows(rows, { key: 'pf', desc: true }, ({ r, i }, k) => standingsSortValue(r, k, i));
    expect(byPf.map((x) => x.r.pf)).toEqual([...byPf].map((x) => x.r.pf).sort((a, b) => b - a));
    const back = sortRows(byPf, { key: 'rank', desc: false }, ({ r, i }, k) => standingsSortValue(r, k, i));
    expect(back.map((x) => x.r.teamId)).toEqual(d.teams.map((r) => r.teamId));
  });
});

describe('starting a career', () => {
  it('opens the inbox with the owner’s welcome and the head coach’s rundown, unread, before anything is played', () => {
    const league = startCareer('first-day', 9);
    expect(league.userTeamId).toBe(9);
    const ids = (league.inbox ?? []).filter((m) => !m.read).map((m) => m.id.split(':')[0] + ':' + m.id.split(':')[2]);
    expect(ids).toContain(`owner:welcome`);
    expect(ids.some((id) => id.startsWith('rundown:'))).toBe(true);
  });
});

describe('a position move’s scheme reason under an interim', () => {
  it('names the head coach still running the defense', () => {
    const league = createLeague({ seed: 'acting-reason' });
    league.phase = 'regular';
    league.week = 11;
    league.teams[4].staffBudgetMult = 3;
    const dc = teamCoaches(league, 4).find((c) => c.role === 'defCoord')!;
    dc.youth = 20;
    dc.veterans = 20;
    installInterimHeadCoach(league, 4);
    expect(coordinatorFor(league, 4, 'LB')?.coach.id).toBe(dc.id);
  });
});

describe('the spatial switch', () => {
  it('starts a new career with your games on the field; scripts and tests keep the league as built', () => {
    expect(startCareer('field-on', 9).settings?.spatialField).toBe(true);
    expect(createLeague({ seed: 'field-on' }).settings?.spatialField).toBe(false);
  });

  it("shows the spatial switch only in developer mode, and it flips the league's setting", async () => {
    const { devMode, setSpatialField } = await import('./dev');
    expect(devMode('')).toBe(false);
    expect(devMode('?season=3')).toBe(false);
    expect(devMode('?dev')).toBe(true);
    expect(devMode('?x=1&dev=1')).toBe(true);
    const l = createLeague({ seed: 'dev-switch' });
    expect(l.settings?.spatialField).toBe(false);
    setSpatialField(l, true);
    expect(l.settings?.spatialField).toBe(true);
    setSpatialField(l, false);
    expect(l.settings?.spatialField).toBe(false);
    setSpatialField(l, true);
    expect(l.settings?.spatialField).toBe(true);
    delete l.settings;
    setSpatialField(l, false);
    expect(l.settings).toEqual({ spatialField: false });
  });
});
