import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactElement } from 'react';
import type { PlayLogEntry } from '../engine/types';
import { createLeague } from '../engine/generate';
import { playWeek } from '../engine/league';
import { NavContext, type Nav } from './nav';
import { allSpeed, GameViewer, playLabel } from './screens/GameViewer';
import { handoverFor, TopDownField } from './screens/TopDownField';
import { downParts, Scorebug } from './screens/Scorebug';
import { driveCaption, GameTimeline, laneColor } from './screens/GameTimeline';
import { contrast } from './color';
import { buildPlayNames, drivesOf, SHOWN_TEAM, teamStatsAt } from './gameRead';
import { GamePanel, PlayersPanel } from './screens/GamePanels';
import { VIEW_KEY } from './viewerPrefs';
import { vi } from 'vitest';

const nav = { openPlayer: () => {}, openTeam: () => {}, go: () => {} } as unknown as Nav;
const render = (el: ReactElement) => renderToStaticMarkup(<NavContext.Provider value={nav}>{el}</NavContext.Provider>);
const league = createLeague({ seed: 'viewer' });
playWeek(league);
const game = league.games.find(
  (g) => g.result?.field && (g.homeId === league.userTeamId || g.awayId === league.userTeamId),
)!;
const plays = game.result!.plays!;

describe('All-22', () => {
  it('draws 22 numbered dots, each in its team’s kit, with the players in the play ringed', () => {
    const index = plays.findIndex((e) => e.kind === 'pass');
    const html = render(
      <TopDownField
        league={league}
        record={game.result!.field!}
        game={game}
        home={league.teams[game.homeId]}
        away={league.teams[game.awayId]}
        plays={plays}
        index={index}
        animKey="t"
        speed={1}
        onDone={() => {}}
      />,
    );
    expect(html.match(/class="dot"/g)).toHaveLength(22);
    // The players' numbers (the field's own yard numbers are painted on it, outside the dots).
    const numbers = [...html.matchAll(/class="dot"[^]*?<text[^>]*>(\d*)<\/text>/g)].map((m) => m[1]);
    expect(numbers).toHaveLength(22);
    expect(html).toContain('stroke="#ffd43b"');
    expect(html).toContain('aria-label="All-22: the play from above"');
    // The ball is the read: no trail behind it (the broadcast view keeps its own).
    expect(html).not.toContain('<path');
  });

  it('draws nothing for a game without a field record', () => {
    const html = render(
      <TopDownField
        league={league}
        record={undefined}
        game={game}
        home={league.teams[game.homeId]}
        away={league.teams[game.awayId]}
        plays={plays}
        index={3}
        animKey="t"
        speed={1}
        onDone={() => {}}
      />,
    );
    expect(html).toBe('');
  });

  it('names a tapped player only through PlayerLink', () => {
    const src = readFileSync('src/ui/screens/TopDownField.tsx', 'utf8');
    expect(src).toContain('<PlayerLink league={league} player={cardPlayer} />');
    expect(src).not.toMatch(/firstName|lastName/);
  });
});

const viewer = (g = game) =>
  render(<GameViewer league={league} gameId={g.id} onBack={() => {}} onBoxScore={() => {}} />);
const withView = (view: string, fn: () => string) => {
  vi.stubGlobal('localStorage', { getItem: (k: string) => (k === VIEW_KEY ? view : null), setItem: () => {} });
  try {
    return fn();
  } finally {
    vi.unstubAllGlobals();
  }
};

describe('the view switch', () => {
  it('offers Broadcast and All-22 for a game with a field record', () => {
    const html = viewer();
    expect(html).toContain('Broadcast');
    expect(html).toContain('All-22');
  });

  it('hides it for a game without one', () => {
    const before = game.result!.field;
    delete game.result!.field;
    try {
      expect(viewer()).not.toContain('All-22');
    } finally {
      game.result!.field = before;
    }
  });

  it('plays All-22 at 1×, 2× or 4×: 8× drops to 4×', () => {
    expect(allSpeed(8)).toBe(4);
    expect(allSpeed(4)).toBe(4);
    expect(allSpeed(2)).toBe(2);
    expect(allSpeed(1)).toBe(1);
  });

  it('shows the same play, score and clock in either view', () => {
    // Everything but the field and the switch itself: the scorebug, the clock, the controls and the play log.
    const strip = (html: string) =>
      html
        .replace(/<div class="td-field[\s\S]*?<\/svg>(<div class="td-card[\s\S]*?<\/div>)?<\/div>/, '')
        .replace(/<svg class="field-scene[\s\S]*?<\/svg>/, '')
        .replace(/<span class="seg" role="group" aria-label="View">[\s\S]*?<\/span>/, '');
    const broadcast = withView('broadcast', viewer);
    const all22 = withView('all22', viewer);
    expect(all22).toContain('td-field');
    expect(broadcast).not.toContain('td-field');
    expect(strip(all22)).toBe(strip(broadcast));
  });
});

describe('the ball changing hands in All-22', () => {
  const play = (o: Partial<PlayLogEntry>): PlayLogEntry => ({
    quarter: 1,
    clock: 600,
    offense: 1,
    down: 1,
    distance: 10,
    yardLine: 50,
    text: '',
    homeScore: 0,
    awayScore: 0,
    ...o,
  });

  it("names the turnover before the other side's first snap, and nothing for a kick or a series that carries on", () => {
    const pick = play({ kind: 'int', offense: 1, text: 'X pass INTERCEPTED by Y' });
    const theirs = play({ kind: 'run', offense: 2 });
    expect(handoverFor([pick, theirs], 1, 1)).toBe('Interception');
    expect(handoverFor([play({ kind: 'run', offense: 1, down: 4 }), theirs], 1, 1)).toBe('Turnover on downs');
    expect(handoverFor([play({ kind: 'run', offense: 1, text: 'FUMBLE, recovered by Z' }), theirs], 1, 1)).toBe(
      'Fumble',
    );
    // A punt has its own change-over, and the same side's next snap is no handover.
    expect(handoverFor([play({ kind: 'punt', offense: 1, from: 30, air: 70 }), theirs], 1, 1)).toBeNull();
    expect(handoverFor([play({ kind: 'run', offense: 1 }), play({ kind: 'pass', offense: 1 })], 1, 1)).toBeNull();
  });
});

describe('the play label', () => {
  // The away side (offense 1; home is 0) drives toward 0.
  const play = (over: Partial<PlayLogEntry>): PlayLogEntry => ({
    quarter: 2,
    clock: 400,
    offense: 1,
    down: 2,
    distance: 10,
    yardLine: 50,
    text: 'A.Passer pass short left to W.Out for 12 yards (C.Corner)',
    homeScore: 0,
    awayScore: 0,
    kind: 'pass',
    from: 50,
    air: 42,
    to: 38,
    ...over,
  });

  it('labels a two-point try as a try, good or not, never a touchdown (0.4.11)', () => {
    const at = { yardLine: 98, from: 98, down: 1, distance: 2 };
    expect(
      playLabel(
        play({ ...at, kind: 'run', to: 100, text: 'Two-point try: R.Back rush left for 2 yards, TOUCHDOWN — GOOD.' }),
        0,
      ),
    ).toBe('Two-point try · Good');
    expect(
      playLabel(
        play({
          ...at,
          kind: 'incomplete',
          to: 98,
          text: 'Two-point try: A.Passer pass short left to W.Out incomplete — NO GOOD.',
        }),
        0,
      ),
    ).toBe('Two-point try · No good');
  });

  it("gives a lost fumble's gain to where the ball came out, and says it was lost", () => {
    const lost = play({
      text: 'A.Passer pass short left to W.Out for 12 yards (C.Corner). FUMBLE, recovered by C.Corner',
      to: 42,
      loose: 38,
    });
    expect(playLabel(lost, 0)).toBe('Pass · +12 yds · Fumble lost');
    expect(
      playLabel(
        { ...lost, kind: 'run', text: 'R.Back rush left for 12 yards (C.Corner). FUMBLE, recovered by C.Corner' },
        0,
      ),
    ).toBe('Run · +12 yds · Fumble lost');
    // A game before v78 kept only where the return ended.
    expect(playLabel({ ...lost, loose: undefined }, 0)).toBe('Pass · +8 yds · Fumble lost');
  });

  it('says when the offense kept a fumble, and calls a lost one on a sack a strip sack', () => {
    expect(
      playLabel(
        play({
          text: 'R.Back rush left for 3 yards (B.Backer). Fumble, recovered by the offense',
          kind: 'run',
          to: 47,
        }),
        0,
      ),
    ).toBe('Run · +3 yds · Fumble kept');
    const sack = play({
      kind: 'sack',
      text: 'A.Passer SACKED by E.Rusher for -7 yards. FUMBLE, recovered by E.Rusher',
      to: 57,
      loose: 57,
      air: undefined,
    });
    expect(playLabel(sack, 0)).toBe('Strip sack · Fumble lost');
    expect(playLabel({ ...sack, text: 'A.Passer SACKED by E.Rusher for -7 yards' }, 0)).toBe('Sack · -7 yds');
  });

  it('says a fourth down that came up short turned the ball over, and not one that made it', () => {
    expect(
      playLabel(
        play({ down: 4, distance: 2, kind: 'run', text: 'R.Back rush up the middle for 1 yard (B.Backer)', to: 49 }),
        0,
      ),
    ).toBe('Run · +1 yds · Turnover on downs');
    expect(
      playLabel(
        play({ down: 4, distance: 2, kind: 'incomplete', text: 'A.Passer pass incomplete deep right', to: 50 }),
        0,
      ),
    ).toBe('Incomplete · Turnover on downs');
    expect(
      playLabel(
        play({ down: 4, distance: 2, kind: 'run', text: 'R.Back rush up the middle for 3 yards (B.Backer)', to: 47 }),
        0,
      ),
    ).toBe('Run · +3 yds');
    expect(
      playLabel(
        play({ down: 3, distance: 2, kind: 'run', text: 'R.Back rush up the middle for 1 yard (B.Backer)', to: 49 }),
        0,
      ),
    ).toBe('Run · +1 yds');
    expect(playLabel(play({ kind: 'int', text: 'A.Passer pass intercepted by C.Corner', to: 60 }), 0)).toBe(
      'Interception',
    );
  });
});

describe('the scorebug', () => {
  const home = league.teams[game.homeId];
  const away = league.teams[game.awayId];
  const bug = (list: PlayLogEntry[], index: number, told: boolean) =>
    render(
      <Scorebug
        league={league}
        game={game}
        home={home}
        away={away}
        plays={list}
        index={index}
        told={told}
        label="Week 1"
      />,
    );

  it('shows each club’s record going into the game and three timeouts a side', () => {
    const html = bug(plays, 0, false);
    expect(html.match(/class="vb-rec[^"]*">0–0</g)).toHaveLength(2);
    expect(html.match(/aria-label="3 timeouts left"/g)).toHaveLength(2);
  });

  it('takes a timeout off once the play that called it has been shown', () => {
    const called: PlayLogEntry = {
      ...plays[4],
      kind: undefined,
      down: 0,
      from: undefined,
      to: undefined,
      who: undefined,
      text: `Timeout ${home.abbrev} (2 left).`,
    };
    const list = [...plays.slice(0, 5), called, ...plays.slice(5)];
    expect(bug(list, 5, true)).toContain('aria-label="2 timeouts left"');
    expect(bug(list, 4, true)).not.toContain('aria-label="2 timeouts left"');
  });

  it('keeps a score off the board until its play has been seen', () => {
    const i = plays.findIndex(
      (e, k) => k > 0 && e.homeScore + e.awayScore !== plays[k - 1].homeScore + plays[k - 1].awayScore,
    );
    const scores = (html: string) => [...html.matchAll(/class="vb-score">(\d+)</g)].map((m) => Number(m[1]));
    expect(scores(bug(plays, i, false))).toEqual([plays[i - 1].awayScore, plays[i - 1].homeScore]);
    expect(scores(bug(plays, i, true))).toEqual([plays[i].awayScore, plays[i].homeScore]);
  });

  it('is what the replay draws', () => {
    const html = render(<GameViewer league={league} gameId={game.id} onBack={() => {}} onBoxScore={() => {}} />);
    expect(html.match(/class="vb-tos"/g)).toHaveLength(2);
  });
});

describe('the down and the spot', () => {
  const home = league.teams[game.homeId];
  const away = league.teams[game.awayId];
  const play = (o: Partial<PlayLogEntry>): PlayLogEntry => ({
    quarter: 1,
    clock: 600,
    offense: home.id,
    down: 1,
    distance: 10,
    yardLine: 50,
    text: '',
    homeScore: 0,
    awayScore: 0,
    ...o,
  });

  it('reads a snap as a pill and a spot', () => {
    const e = play({ offense: home.id, down: 2, distance: 10, yardLine: 83 });
    expect(downParts(e, home, away)).toMatchObject({ down: '2ND & 10', spot: `Ball on ${away.abbrev} 17` });
    expect(downParts(play({ offense: away.id, down: 1, distance: 4, yardLine: 96 }), home, away)).toMatchObject({
      down: '1ST & GOAL',
      spot: `Ball on ${home.abbrev} 4`,
    });
  });

  it('has nothing to say between snaps', () => {
    expect(downParts(play({ down: 0, kind: 'kickoff' }), home, away)).toBeNull();
  });
});

describe('the timeline', () => {
  const home = league.teams[game.homeId];
  const away = league.teams[game.awayId];
  const all = drivesOf(plays, home.id);
  // A play in the middle of the third drive: two drives done, more to come.
  const mid = all[2].first + 1;
  const line = (list: PlayLogEntry[], index: number, replay: boolean) =>
    render(
      <GameTimeline
        home={home}
        away={away}
        plays={list}
        index={index}
        told
        replay={replay}
        onJump={() => {}}
        transport={null}
        settings={null}
      />,
    );
  const count = (html: string, cls: string) => html.match(new RegExp(`class="${cls}[" ]`, 'g'))?.length ?? 0;

  it('draws only what a live game has shown', () => {
    const html = line(plays, mid, false);
    expect(count(html, 'tl-drive')).toBe(3);
    expect(html).not.toContain('later');
    expect(html).toContain('class="tl-future"');
    expect(html).not.toContain('id="viewer-scrub"');
  });

  it('draws the whole game in a replay, the drives to come dimmed', () => {
    const html = line(plays, mid, true);
    expect(count(html, 'tl-drive')).toBe(all.length);
    expect(html.match(/class="tl-drive[^"]* later/g)).toHaveLength(all.length - 3);
    expect(html).not.toContain('class="tl-future"');
  });

  it('marks every drive that ended in a score or gave the ball away', () => {
    const html = line(plays, plays.length - 1, true);
    const scored = all.filter((d) => d.points.home + d.points.away > 0).length;
    const gaveUp = all.filter(
      (d) => d.points.home + d.points.away === 0 && ['missed', 'int', 'fumble', 'downs'].includes(d.how),
    ).length;
    expect(count(html, 'tl-mark score')).toBe(scored);
    expect(count(html, 'tl-mark miss')).toBe(gaveUp);
  });

  it('keeps the slider for the keyboard in a replay', () => {
    const html = line(plays, mid, true);
    expect(html).toContain('id="viewer-scrub"');
    expect(html).toContain(`max="${plays.length - 1}"`);
    expect(html).toContain(`value="${mid}"`);
  });

  it('has four quarters, and a fifth section once there is overtime', () => {
    expect(count(line(plays, mid, true), 'tl-q')).toBe(4);
    const last = plays[plays.length - 1];
    const overtime = [...plays, { ...last, quarter: 5, clock: 600 }, { ...last, quarter: 5, clock: 300 }];
    expect(count(line(overtime, mid, true), 'tl-q')).toBe(5);
  });

  it('captions the drive on the field with its plays, yards and time so far', () => {
    const html = line(plays, mid, false);
    expect(html).toMatch(
      new RegExp(
        `class="tl-cap"><b>${all[2].teamId === home.id ? home.city : away.city} drive</b> · \\d+ plays? · -?\\d+ yds · \\d+:\\d\\d<`,
      ),
    );
  });

  it('captions a finished drive with when it began and how it ended', () => {
    const td = all.find((d) => d.how === 'td')!;
    const text = driveCaption(td, plays, false);
    expect(text).toMatch(/^Q[1-4] \d+:\d\d · \d+ plays? · \d+ yds · Touchdown, /);
    const punt = all.find((d) => d.how === 'punt')!;
    expect(driveCaption(punt, plays, false)).toMatch(/ · Punt$/);
  });

  it('marks both scores when a kick is run back right after a touchdown', () => {
    const snap = (o: Partial<PlayLogEntry>): PlayLogEntry => ({
      quarter: 1,
      clock: 800,
      offense: home.id,
      down: 1,
      distance: 10,
      yardLine: 25,
      text: 'A.Back rush for 3 yards',
      homeScore: 0,
      awayScore: 0,
      kind: 'run',
      from: 25,
      to: 28,
      ...o,
    });
    const list = [
      snap({ text: 'A.Back rush for 75 yards, TOUCHDOWN', to: 102, homeScore: 6 }),
      snap({ kind: 'xp', down: 0, clock: 790, text: 'K.Icker extra point is GOOD.', homeScore: 7 }),
      snap({
        kind: 'kickoff',
        down: 0,
        clock: 790,
        text: 'Returned 100 yards for a TOUCHDOWN',
        homeScore: 7,
        awayScore: 6,
      }),
      snap({
        kind: 'xp',
        down: 0,
        clock: 775,
        offense: away.id,
        text: 'K.Icker extra point is GOOD.',
        homeScore: 7,
        awayScore: 7,
      }),
      snap({ kind: 'kickoff', down: 0, clock: 775, homeScore: 7, awayScore: 7 }),
      snap({ clock: 770, homeScore: 7, awayScore: 7 }),
    ];
    const html = line(list, list.length - 1, true);
    expect(count(html, 'tl-mark score home')).toBe(1);
    expect(count(html, 'tl-mark score away')).toBe(1);
  });

  it('never draws a drive past the end of the track', () => {
    const last = plays[plays.length - 1];
    const overtime = [
      ...plays,
      { ...last, quarter: 5, clock: 600, kind: 'kickoff' as const, down: 0 },
      { ...last, quarter: 5, clock: 300, kind: 'run' as const, down: 1, text: 'A.Back rush for 3 yards' },
    ];
    const html = line(overtime, overtime.length - 1, true);
    for (const m of html.matchAll(
      /class="tl-drive[^"]*" style="left:([\d.]+)%;width:max\(4px, calc\(([\d.]+)% - 2px\)\)/g,
    ))
      expect(Number(m[1]) + Number(m[2])).toBeLessThanOrEqual(100.01);
  });

  it('calls the end of the fourth quarter the end of regulation, not of a half', () => {
    const list = [
      { ...plays[1], quarter: 4, clock: 30, down: 1, kind: 'run' as const, text: 'A.Back rush for 3 yards' },
      { ...plays[1], quarter: 5, clock: 600, down: 0, kind: 'kickoff' as const },
    ];
    const [d] = drivesOf(list, home.id);
    expect(driveCaption(d, list, false)).toMatch(/ · End of regulation$/);
  });

  it('shows where the keyboard is when the slider has the focus', () => {
    const css = readFileSync('src/styles.css', 'utf8');
    expect(css).toMatch(/\.tl:has\(#viewer-scrub:focus-visible\) \.tl-area \{[^}]*outline:/);
  });

  it('is what the replay draws, with the view switch up beside Box score', () => {
    const html = render(<GameViewer league={league} gameId={game.id} onBack={() => {}} onBoxScore={() => {}} />);
    expect(html).toContain('class="tl-area can-jump"');
    expect(html).not.toContain('viewer-controls');
    expect(html.indexOf('aria-label="View"')).toBeLessThan(html.indexOf('class="viewer"'));
  });
});

describe('a club’s colour on the timeline', () => {
  const SCENE = '#0b1210';

  it('keeps a colour that already reads on the night scene', () => {
    expect(laneColor(['#ffb612', '#101820'])).toBe('#ffb612');
  });

  it('lightens a dark colour rather than swap it for the club’s other one', () => {
    const blue = laneColor(['#00338d', '#c60c30']);
    expect(contrast(SCENE, blue)).toBeGreaterThanOrEqual(3);
    // Still a blue: more blue in it than red.
    expect(parseInt(blue.slice(5, 7), 16)).toBeGreaterThan(parseInt(blue.slice(1, 3), 16));
  });

  it('uses the second colour when the first is all but black', () => {
    expect(laneColor(['#101820', '#d3bc8d'])).toBe('#d3bc8d');
  });
});

describe('the panels beside the field', () => {
  const home = league.teams[game.homeId];
  const away = league.teams[game.awayId];
  const names = buildPlayNames(league, game);
  const last = plays.length - 1;
  const gamePanel = (list: PlayLogEntry[], shown: number) =>
    render(
      <GamePanel
        league={league}
        game={game}
        home={home}
        away={away}
        plays={list}
        shown={shown}
        names={names}
        result={game.result}
      />,
    );
  const playersPanel = (shown: number) =>
    render(
      <PlayersPanel
        league={league}
        home={home}
        away={away}
        plays={plays}
        shown={shown}
        names={names}
        record={game.result!.field}
        playerTeams={game.result!.playerTeams}
      />,
    );

  it('shows the team numbers through the play on screen, under the box score’s labels', () => {
    const mid = Math.floor(last / 2);
    const html = gamePanel(plays, mid);
    const at = teamStatsAt(plays, mid, home.id);
    for (const label of ['First downs', 'Total yards', 'Passing', 'Rushing', '3rd down', 'Turnovers'])
      expect(html).toContain(`>${label}<`);
    const row = /data-stat="totalYds">([\s\S]*?)<span class="cmp-bar"/.exec(html)![1];
    expect(row).toMatch(new RegExp(`<span class="cmp-a num"[^>]*>${at.away.totalYds}</span>`));
    expect(row).toMatch(new RegExp(`<span class="cmp-h num"[^>]*>${at.home.totalYds}</span>`));
    expect(html).not.toContain('Possession');
    expect(SHOWN_TEAM).toContain('totalYds');
  });

  it('ends on the box score', () => {
    const html = gamePanel(plays, last);
    const row = (id: string) => new RegExp(`data-stat="${id}">([\\s\\S]*?)<span class="cmp-bar"`).exec(html)![1];
    expect(row('totalYds')).toMatch(new RegExp(`<span class="cmp-a num"[^>]*>${game.result!.away.totalYds}</span>`));
    expect(row('firstDowns')).toMatch(
      new RegExp(`<span class="cmp-h num"[^>]*>${game.result!.home.firstDowns}</span>`),
    );
    // The score by quarter, and the final in the last column.
    expect(html).toContain(`<td class="tot num">${game.result!.homeScore}</td>`);
  });

  it('shows a man hurt only once the play it happened on has been seen, as a link to him', () => {
    const [name, id] = [...names.ids][0];
    const p = league.players[id];
    const hurt: PlayLogEntry = {
      ...plays[10],
      kind: undefined,
      down: 0,
      from: undefined,
      to: undefined,
      who: undefined,
      text: `Injury: ${league.teams[p.teamId!].abbrev} ${p.position} ${name} (ankle sprain) is out for the game.`,
    };
    const list = [...plays.slice(0, 11), hurt, ...plays.slice(11)];
    expect(gamePanel(list, 10)).not.toContain('Injuries');
    const html = gamePanel(list, 11);
    expect(html).toContain('>Injuries<');
    expect(html).toMatch(/class="game-injuries">[\s\S]*?<button type="button" class="linklike"/);
    expect(html).toContain('ankle sprain');
  });

  it('names a leader a team in passing, rushing and receiving, each a link to his card', () => {
    const html = playersPanel(last);
    for (const label of ['Passing', 'Rushing', 'Receiving']) expect(html).toContain(`>${label}<`);
    const rows = html.match(/class="lead-row"/g) ?? [];
    expect(rows).toHaveLength(6);
    expect(html.match(/class="lead-row">[\s\S]*?<button type="button" class="linklike"/g)).toHaveLength(6);
    expect(html).not.toContain('Tackles');
  });

  it('has nothing odd to say before the first play', () => {
    const html = gamePanel(plays, -1) + playersPanel(-1);
    expect(html).not.toMatch(/undefined|NaN/);
    expect(html).toContain('Players’ numbers appear after the first play.');
  });

  it('sits beside the field in the replay, with tabs for a narrow window', () => {
    const html = render(<GameViewer league={league} gameId={game.id} onBack={() => {}} onBoxScore={() => {}} />);
    expect(html).toContain('class="game-stage" data-tab="plays"');
    const tabs = /aria-label="Below the field">([\s\S]*?)<\/span>/.exec(html)![1];
    expect(tabs.match(/<button/g)).toHaveLength(3);
    for (const cls of ['stage-rail rail-game', 'stage-rail rail-players', 'panel game-log'])
      expect(html).toContain(`class="${cls}"`);
  });
});
