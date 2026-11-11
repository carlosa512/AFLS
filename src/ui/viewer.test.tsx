import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactElement } from 'react';
import type { Game, PlayLogEntry } from '../engine/types';
import { uniformFor } from './uniform';
import { createLeague } from '../engine/generate';
import { playWeek } from '../engine/league';
import { NavContext, type Nav } from './nav';
import { allSpeed, GameViewer, playLabel } from './screens/GameViewer';
import { fieldTransform, handoverFor, TopDownField, toScreen, type View } from './screens/TopDownField';
import { FIELD_W } from '../engine/field/ballPath';
import { stadiumSpot } from './stage/ends';
import { Field, project } from './screens/BroadcastField';
import { groundFrame } from './screens/broadcastView';
import { surfaceFor } from './screens/FieldPaint';
import { sameWeather } from './screens/BroadcastPaint';
import { buildingFor } from './stadiums/buildings';
import { gameStadium, homeGamesBefore } from './stadiums/gameLook';
import { GameMoments, MomentBanner } from './screens/GameMoments';
import { playMoments, type Moment } from './moments';
import { flagCall } from './stage/calls';
import { weatherAt, type Weather } from '../engine/weather';
import { endZones } from './screens/FieldPaint';
import { downParts, Scorebug } from './screens/Scorebug';
import { driveCaption, GameTimeline, laneColor } from './screens/GameTimeline';
import { contrast } from './color';
import { buildPlayNames, driveAt, drivesOf, linesAt, SHOWN_LINE, SHOWN_TEAM, teamStatsAt } from './gameRead';
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

// Past the pregame card a replay opens on, to the first play.
const viewer = (g = game) =>
  render(<GameViewer league={league} gameId={g.id} onBack={() => {}} onBoxScore={() => {}} pregame={false} />);
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

  it('opens a replay on the pregame card in either view: no play on the field yet, no list of who sat out', () => {
    for (const view of ['broadcast', 'all22']) {
      const html = withView(view, () =>
        render(<GameViewer league={league} gameId={game.id} onBack={() => {}} onBoxScore={() => {}} />),
      );
      expect(html).toContain('moment-card pregame');
      expect(html).toContain('The field before kickoff');
      expect(html).not.toContain('td-field');
      expect(html).not.toContain('pg-out');
      expect(html).not.toContain('Kick off');
      // Nothing of the first play is told under the card.
      expect(html).not.toContain(plays[0].text);
    }
  });

  it('shows the same play, score and clock in either view', () => {
    // Everything but the field and the switch itself: the scorebug, the clock, the controls and the play log.
    const strip = (html: string) =>
      html
        .replace(/<div class="td-field[\s\S]*?<\/svg>(<div class="td-card[\s\S]*?<\/div>)?<\/div>/, '')
        .replace(/<canvas class="stadium-(?:picture|crowd)"[^>]*><\/canvas>/g, '')
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

  it('names a leader a team in passing, rushing, receiving and defense, each a link to his card', () => {
    const html = playersPanel(last);
    for (const label of ['Passing', 'Rushing', 'Receiving', 'Defense']) expect(html).toContain(`>${label}<`);
    const rows = html.match(/class="lead-row"/g) ?? [];
    expect(rows).toHaveLength(8);
    expect(html.match(/class="lead-row">[\s\S]*?<button type="button" class="linklike"/g)).toHaveLength(8);
  });

  it('names the defenders from the first tackle on, by the box score’s own count', () => {
    // The first snap somebody was tackled on: the panel has a defender to name from there, not only after a sack.
    const tacklers = (i: number) =>
      [...linesAt(plays, i, home.id, names, game.result!.field)].filter(([, l]) => l.tackles).map(([id]) => id);
    const first = plays.findIndex((_, i) => tacklers(i).length > 0);
    expect(playersPanel(first - 1)).not.toContain('>Defense<');
    const html = playersPanel(first);
    const defense = html.slice(html.indexOf('>Defense<'));
    expect(defense).toMatch(/class="lead-row">[\s\S]*?<button type="button" class="linklike"/);
    expect(defense).toMatch(/>1 tackle(?: · 1 sack)?</);
    expect(SHOWN_LINE).toContain('tackles');
    // At the final his line is the box score's.
    const top = Object.entries(game.result!.playerStats).sort((a, b) => (b[1].tackles ?? 0) - (a[1].tackles ?? 0))[0];
    expect(linesAt(plays, last, home.id, names, game.result!.field).get(Number(top[0]))?.tackles).toBe(top[1].tackles);
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

describe('the end zones', () => {
  const home = league.teams[game.homeId];
  const away = league.teams[game.awayId];

  it('are both the home club’s at a home game: its nickname in one, its city in the other', () => {
    const [low, high] = endZones(home, away);
    expect(low).toEqual({ text: home.name.toUpperCase(), fill: home.colors[0], stroke: home.colors[1] });
    expect(high).toEqual({ text: home.city.toUpperCase(), fill: home.colors[0], stroke: home.colors[1] });
  });

  it('are one a team at a neutral site', () => {
    const [low, high] = endZones(home, away, true);
    expect(low.text).toBe(home.name.toUpperCase());
    expect(high).toEqual({ text: away.name.toUpperCase(), fill: away.colors[0], stroke: away.colors[1] });
  });

  it('are what All-22 paints', () => {
    const html = render(
      <TopDownField
        league={league}
        record={game.result!.field!}
        game={game}
        home={home}
        away={away}
        plays={plays}
        index={plays.findIndex((e) => e.kind === 'pass')}
        animKey="t"
        speed={1}
        onDone={() => {}}
      />,
    );
    expect(html).toContain(`>${home.name.toUpperCase()}</text>`);
    expect(html).toContain(`>${home.city.toUpperCase()}</text>`);
    expect(html).not.toContain(`>${away.name.toUpperCase()}</text>`);
  });
});

describe('All-22 switching ends', () => {
  const view = (layout: View['layout'], phi: number, swap: boolean): View => ({
    layout,
    dir: 1,
    cx: 38,
    span: 45,
    phi,
    swap,
  });
  /** A point through an SVG `matrix(a b c d e f)`. */
  const through = (matrix: string, x: number, y: number): [number, number] => {
    const [a, b, c, d, e, f] = matrix.match(/-?[\d.]+(?:e-?\d+)?/g)!.map(Number);
    return [a * x + c * y + e, b * x + d * y + f];
  };

  it('stands every man on the paint where the stadium has him, whichever way the field is turned', () => {
    // Either layout, the home side's ball or the away side's (the upright field turns with it), before and after
    // the ends switch: a change of possession on a quarter's first play is one of these.
    for (const layout of ['wide', 'upright'] as const)
      for (const phi of [0, Math.PI])
        for (const swap of [false, true])
          for (const [x, y] of [
            [30, 10],
            [95, 50],
            [50, FIELD_W / 2],
          ]) {
            const v = view(layout, phi, swap);
            const spot = stadiumSpot(x, y, swap ? 2 : 1);
            const [px, py] = through(fieldTransform(v), spot.x, spot.y);
            const [sx, sy] = toScreen(v, x, y);
            expect(sx).toBeCloseTo(px, 3);
            expect(sy).toBeCloseTo(py, 3);
          }
  });

  it('on a wide screen turns the men half way round and leaves the paint alone', () => {
    const [ax, ay] = toScreen(view('wide', 0, false), 30, 10);
    const [bx, by] = toScreen(view('wide', 0, true), 30, 10);
    expect([bx, by]).toEqual([100 - ax, FIELD_W - ay]);
    expect(fieldTransform(view('wide', 0, true))).toBe(fieldTransform(view('wide', 0, false)));
  });

  it('on a phone leaves the men attacking up the screen and turns the paint under them', () => {
    expect(toScreen(view('upright', 0, true), 30, 10)).toEqual(toScreen(view('upright', 0, false), 30, 10));
    expect(fieldTransform(view('upright', 0, true))).not.toBe(fieldTransform(view('upright', 0, false)));
  });

  it('draws a second-quarter play turned round, on the same paint', () => {
    const index = plays.findIndex((e) => e.kind === 'pass' && e.quarter === 1 && e.clock > 200);
    const shot = (quarter: number) => {
      const html = render(
        <TopDownField
          league={league}
          record={game.result!.field!}
          game={game}
          home={league.teams[game.homeId]}
          away={league.teams[game.awayId]}
          plays={plays.map((e, i) => (i === index ? { ...e, quarter } : e))}
          index={index}
          animKey="t"
          speed={1}
          onDone={() => {}}
        />,
      );
      const dots = [...html.matchAll(/class="dot" transform="translate\(([-\d.]+) ([-\d.]+)\)"/g)].map((m) => [
        Number(m[1]),
        Number(m[2]),
      ]);
      const paint = /<g transform="matrix[^"]*">([\s\S]*?)<line/.exec(html)![1];
      return { dots, paint };
    };
    const first = shot(1);
    const second = shot(2);
    expect(first.dots).toHaveLength(22);
    expect(second.paint).toBe(first.paint);
    second.dots.forEach(([x, y], i) => {
      expect(x).toBeCloseTo(100 - first.dots[i][0], 1);
      expect(y).toBeCloseTo(FIELD_W - first.dots[i][1], 1);
    });
  });
});

describe('the broadcast field switching ends', () => {
  it('draws a spot where the stadium has it that quarter', () => {
    expect(project(100, 10, 0, 2)).toEqual(project(0, FIELD_W - 10, 0, 1));
    expect(project(30, 20, 3, 4)).toEqual(project(70, FIELD_W - 20, 3, 3));
  });

  it('reads the quarter it is given, whatever came before', () => {
    // A highlight level can go from the second quarter straight to the fourth: both are switched.
    expect(project(30, 20, 0, 4)).toEqual(project(30, 20, 0, 2));
    expect(project(30, 20, 0, 5)).toEqual(project(30, 20, 0, 1));
  });

  it('leaves a spot alone in the first quarter, and when no quarter is given', () => {
    expect(project(30, 20, 0)).toEqual(project(30, 20, 0, 1));
  });
});

describe('the painted broadcast field', () => {
  const home = league.teams[game.homeId];
  const away = league.teams[game.awayId];
  const snap = plays.findIndex((e) => e.kind === 'run' && e.quarter === 1);
  const field = (o: { quarter?: number; home?: typeof home; neutral?: boolean } = {}) =>
    render(
      <Field
        home={o.home ?? home}
        away={away}
        neutral={o.neutral}
        entry={{ ...plays[snap], quarter: o.quarter ?? 1 }}
        restX={50}
        animKey="t"
        speed={1}
        onDone={() => {}}
      />,
    );
  const letters = (html: string, zone: string) =>
    [...html.matchAll(new RegExp(`class="ez-letter ${zone}"[^>]*>([^<])<`, 'g'))].map((m) => m[1]).join('');

  it('spells the home club’s nickname in one end zone and its city in the other, a letter at a time', () => {
    const html = field();
    expect(letters(html, 'low')).toBe(home.name.toUpperCase().replace(/ /g, ''));
    expect(letters(html, 'high')).toBe(home.city.toUpperCase().replace(/ /g, ''));
    expect(html).not.toContain('class="ez-text"');
  });

  it('gives each team an end zone at a neutral site', () => {
    expect(letters(field({ neutral: true }), 'high')).toBe(away.name.toUpperCase().replace(/ /g, ''));
  });

  it('stands goalposts at both ends and a bench on each sideline', () => {
    const html = field();
    expect(html.match(/class="posts"/g)).toHaveLength(2);
    expect(html).toContain('class="bench home"');
    expect(html).toContain('class="bench away"');
    expect(html).toContain(`>${home.abbrev}</text>`);
  });

  it('mows grass in five-yard stripes and lays turf in ten', () => {
    const grass = league.teams.find((t) => surfaceFor(t) === 'grass')!;
    const turf = league.teams.find((t) => surfaceFor(t) === 'turf')!;
    const stripes = (t: typeof home) => field({ home: t }).match(/class="stripe"/g)!.length;
    expect(stripes(grass)).toBe(10);
    expect(stripes(turf)).toBe(5);
  });

  it('paints the same field in every quarter', () => {
    // The ball and the lines are placed as the play runs; everything in the markup is the stadium, which never moves.
    expect(field({ quarter: 2 })).toBe(field({ quarter: 1 }));
    expect(field()).toContain('class="ground"');
  });
});

describe('the stadium and the weather', () => {
  const home = league.teams[game.homeId];
  const away = league.teams[game.awayId];
  const dry: Weather = { roof: 'outdoors', tempF: 60, windMph: 6, precip: 'none' };
  const field = (weather: Weather, quarter = 1) =>
    render(
      <Field
        home={home}
        away={away}
        weather={weatherAt(weather, quarter)}
        entry={{ ...plays[5], quarter }}
        restX={50}
        animKey="t"
        speed={1}
        onDone={() => {}}
      />,
    );

  it('lets rain and snow fall outdoors only, twice as hard when heavy', () => {
    const drops = (html: string) => html.match(/class="drop"/g)?.length ?? 0;
    const flakes = (html: string) => html.match(/class="flake"/g)?.length ?? 0;
    const rain = field({ ...dry, precip: 'rain' });
    expect(drops(rain)).toBeGreaterThan(0);
    expect(flakes(rain)).toBe(0);
    expect(drops(field({ ...dry, precip: 'rain', heavy: true }))).toBe(drops(rain) * 2);
    const snow = field({ ...dry, precip: 'snow' });
    expect(flakes(snow)).toBeGreaterThan(0);
    expect(drops(snow)).toBe(0);
    const mixed = field({ ...dry, precip: 'mixed' });
    expect(drops(mixed)).toBeGreaterThan(0);
    expect(flakes(mixed)).toBeGreaterThan(0);
    const dome = field({ ...dry, roof: 'dome', precip: 'rain' });
    expect(drops(dome) + flakes(dome)).toBe(0);
  });

  it('keeps the field dry until the rain starts', () => {
    const late: Weather = { ...dry, precip: 'rain', onset: 3 };
    expect(field(late, 2)).not.toContain('class="drop"');
    expect(field(late, 3)).toContain('class="drop"');
  });

  it('stops the rain and the snow for a viewer who asks for less motion', () => {
    const css = readFileSync('src/styles.css', 'utf8');
    const reduced = /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\n\}/g;
    expect([...css.matchAll(reduced)].some((m) => /\.drop/.test(m[0]) && /\.flake/.test(m[0]))).toBe(true);
  });
});

describe('the drive on the grass', () => {
  const home = league.teams[game.homeId];
  const away = league.teams[game.awayId];
  const all = drivesOf(plays, home.id);
  const long = all.find((d) => d.snaps >= 6)!;
  const mid = long.first + 3;
  const field = (index: number, o: Partial<PlayLogEntry> = {}) =>
    render(
      <Field
        home={home}
        away={away}
        drive={driveAt(plays, index, home.id)}
        entry={{ ...plays[index], ...o }}
        restX={50}
        animKey="t"
        speed={1}
        onDone={() => {}}
      />,
    );

  it('finds the drive a snap belongs to, and none for a kickoff', () => {
    expect(driveAt(plays, mid, home.id)).toMatchObject({ teamId: long.teamId });
    expect(
      driveAt(
        plays,
        plays.findIndex((e) => e.kind === 'kickoff'),
        home.id,
      ),
    ).toBeUndefined();
    // Where it began, in the field's own coordinates: the home side counts from 0, the away side from 100.
    const began = long.teamId === home.id ? long.from : 100 - long.from;
    expect(driveAt(plays, mid, home.id)!.from).toBe(began);
  });

  it('tints the grass from where the drive began to the ball, and says where that was', () => {
    const html = field(mid);
    expect(html).toContain('class="drive-band"');
    // A caret whose tooltip names it: no label box on the grass.
    expect(html).toMatch(/class="drive-caret"[^>]*><title>Drive began here<\/title>/);
    expect(html).not.toContain('>Drive began<');
  });

  it('draws no band on a drive’s first snap, nor on a kickoff', () => {
    expect(field(long.first)).not.toContain('class="drive-band"');
    expect(field(plays.findIndex((e) => e.kind === 'kickoff'))).not.toContain('class="drive-band"');
  });

  it('reddens the last twenty yards while the offense snaps the ball inside them', () => {
    expect(field(mid, { yardLine: 85, distance: 10 })).toContain('class="red-zone"');
    expect(field(mid, { yardLine: 75, distance: 10 })).not.toContain('class="red-zone"');
  });

  it('puts no player’s name on the field', () => {
    const names = buildPlayNames(league, game);
    const pass = plays.findIndex((e, i) => e.kind === 'pass' && !!driveAt(plays, i, home.id));
    expect(names.re!.test(field(pass))).toBe(false);
  });
});

describe('the moments over the field', () => {
  const home = league.teams[game.homeId];
  const away = league.teams[game.awayId];
  const names = buildPlayNames(league, game);
  const over = (moments: Moment[], speed = 1, own?: ('flag' | 'injury' | 'turnover')[]) =>
    render(<GameMoments league={league} home={home} away={away} moments={moments} speed={speed} own={own} />);
  const td: Moment = {
    kind: 'banner',
    tone: 'score',
    teamId: home.id,
    head: 'Touchdown',
    line: 'A run',
    side: '4 plays',
  };
  const flag: Moment = { kind: 'banner', tone: 'flag', teamId: null, head: 'Offside', line: 'NO X.Man', side: '5 yds' };
  const man = Object.keys(game.result!.playerTeams).map(Number)[0];
  const line: Moment = { kind: 'player', playerId: man, teamId: home.id, number: 19, line: '5 rec · 56 yds' };

  it('draws a banner in the side’s colours with its call, its line and its note', () => {
    const html = render(<MomentBanner tone="score" team={home} head="Touchdown" line="A run" side="4 plays" />);
    expect(html).toContain('class="moment-banner score"');
    expect(html).toContain(`>${home.abbrev}<`);
    expect(html).toContain('>Touchdown<');
    expect(html).toContain('>A run<');
    expect(html).toContain('>4 plays<');
    expect(html).toContain(home.colors[0]);
  });

  it('marks a flag as a flag, on no team’s colours', () => {
    const html = over([flag]);
    expect(html).toContain('class="moment-banner flag"');
    expect(html).toContain('>FLAG<');
  });

  it('shows a player’s line whole, his name a link to his card', () => {
    const html = over([line]);
    expect(html).toContain('class="moment-player"');
    expect(html).toMatch(/class="mp-num"[^>]*>19</);
    expect(html).toMatch(/<button type="button" class="linklike"/);
    expect(html).toContain('>5 rec · 56 yds<');
  });

  it('shows one thing at a time: a banner, not a line with it', () => {
    const html = over([td, line]);
    expect(html).toContain('moment-banner');
    expect(html).not.toContain('moment-player');
  });

  it('skips the player’s line when the game is sped up, and keeps the banner', () => {
    expect(over([line], 4)).not.toContain('moment-player');
    expect(over([td], 8)).toContain('moment-banner');
  });

  it('leaves to a view what the view announces itself', () => {
    expect(over([flag], 1, ['flag'])).not.toContain('moment-banner');
    expect(over([td], 1, ['flag'])).toContain('moment-banner');
  });

  it('says which bench has something to cheer', () => {
    expect(over([td])).toContain('data-cheer="home"');
    expect(over([{ ...td, teamId: away.id }])).toContain('data-cheer="away"');
    expect(over([flag])).not.toContain('data-cheer');
  });

  it('makes nothing of a play until its result is shown, nor of one the highlights skipped past', () => {
    const scored = plays.findIndex(
      (e, i) => i > 0 && e.homeScore + e.awayScore - plays[i - 1].homeScore - plays[i - 1].awayScore >= 6,
    );
    const opts = { home, away, names, record: game.result!.field, over: true };
    expect(playMoments(plays, scored, { ...opts, told: true, still: false }).map((m) => m.kind)).toContain('banner');
    expect(playMoments(plays, scored, { ...opts, told: false, still: false })).toEqual([]);
    expect(playMoments(plays, scored, { ...opts, told: true, still: true })).toEqual([]);
  });

  it('is in the replay, round either view, under the SNN mark', () => {
    const html = render(<GameViewer league={league} gameId={game.id} onBack={() => {}} onBoxScore={() => {}} />);
    expect(html).toContain('class="viewer-scene"');
    expect(html).toMatch(/class="vb-net"[^>]*>SNN</);
  });

  it('gives All-22’s own call the banner’s look', () => {
    const index = plays.findIndex((e) => !!flagCall(e) && e.kind === 'penalty');
    const html = render(
      <TopDownField
        league={league}
        record={game.result!.field!}
        game={game}
        home={home}
        away={away}
        plays={plays}
        index={index}
        animKey="t"
        speed={1}
        onDone={() => {}}
      />,
    );
    expect(html).toContain('class="moment-banner flag"');
  });

  it('keeps yellow for the flag alone, and stops the cheering for a viewer who asks for less motion', () => {
    const css = readFileSync('src/styles.css', 'utf8');
    const rules = [...css.matchAll(/([^{}]*\.(?:moment-|mb-|mp-)[^{}]*)\{([^}]*)\}/g)];
    const yellow = rules.filter((m) => /--marker\b/.test(m[2])).map((m) => m[1].trim());
    expect(yellow.length).toBeGreaterThan(0);
    for (const sel of yellow) expect(sel).toMatch(/\.flag/);
    const reduced = [...css.matchAll(/@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\n\}/g)];
    expect(reduced.some((m) => /bench-man/.test(m[0]) && /\.stadium-crowd/.test(m[0]))).toBe(true);
    // The crowd jumps as the bench does; the picture itself never flashes.
    expect(css).toMatch(/data-cheer='home'\]\) \.stadium-crowd \{\s*animation: bf-jump/);
    expect(css).not.toContain('bf-roar');
  });
});

describe('the cards at the quarter, the half and the final', () => {
  const home = league.teams[game.homeId];
  const away = league.teams[game.awayId];
  const names = buildPlayNames(league, game);
  const half = plays
    .map((e, i) => (e.quarter === 2 ? i : -1))
    .filter((i) => i >= 0)
    .pop()!;
  const last = plays.length - 1;
  const card = (
    kind: 'half' | 'final' | 'quarter',
    shown: number,
    o: Partial<Parameters<typeof GameMoments>[0]> = {},
  ) =>
    render(
      <GameMoments
        league={league}
        home={home}
        away={away}
        moments={[]}
        speed={1}
        card={kind === 'quarter' ? { kind, head: 'End of the first quarter' } : { kind }}
        facts={{ plays, shown, names, record: game.result!.field, playerTeams: game.result!.playerTeams }}
        {...o}
      />,
    );

  it('shows the half: the score, four team numbers through that play, and three leaders', () => {
    const html = card('half', half);
    const at = teamStatsAt(plays, half, home.id);
    expect(html).toContain('>Halftime<');
    expect(html).toContain(`>${plays[half].awayScore} – ${plays[half].homeScore}<`);
    for (const label of ['Total yards', 'First downs', '3rd down', 'Turnovers']) expect(html).toContain(`>${label}<`);
    expect(html).toContain(`>${at.home.totalYds}<`);
    expect(html).toContain(`>${at.away.totalYds}<`);
    expect(html.match(/class="mc-lead"[\s\S]*?<\/div><\/div>/)![0].match(/class="linklike"/g)).toHaveLength(3);
  });

  it('waits for Continue in a live game, and offers nothing to press in a replay', () => {
    const live = card('half', half, { onContinue: () => {}, onSim: () => {} });
    expect(live).toContain('>Continue<');
    expect(live).toContain('>Sim to final<');
    const replay = card('half', half);
    expect(replay).not.toContain('>Continue<');
    expect(replay).not.toContain('<button class="btn');
  });

  it('shows the final once, with the result and the live game’s buttons', () => {
    const html = card('final', last, { verdict: 'W', onBoxScore: () => {}, onReplay: () => {}, onContinue: () => {} });
    expect(html).toContain('>Final<');
    expect(html.match(/class="res-W"/g)).toHaveLength(1);
    expect(html).toContain(`>${game.result!.awayScore} – ${game.result!.homeScore}<`);
    for (const label of ['Box score', 'Watch replay', 'Continue']) expect(html).toContain(`>${label}<`);
    // The panel that used to say the result under the live game is gone: the card says it.
    expect(readFileSync('src/ui/screens/LiveGame.tsx', 'utf8')).not.toContain('live-final');
  });

  it('marks a quarter’s end in a line', () => {
    const html = card('quarter', 32);
    expect(html).toContain('>End of the first quarter<');
    expect(html).not.toContain('Total yards');
  });

  it('signs every card SNN', () => {
    for (const kind of ['half', 'final', 'quarter'] as const)
      expect(card(kind, half)).toMatch(/class="mc-net"[^>]*>SNN</);
  });
});

describe('what the review found', () => {
  const home = league.teams[game.homeId];
  const away = league.teams[game.awayId];
  const names = buildPlayNames(league, game);

  it('shows a period-ending play’s banner before the card, never the card over it', () => {
    // A walk-off touchdown is the game's biggest moment: the final card waits for its banner.
    const td: Moment = { kind: 'banner', tone: 'score', teamId: home.id, head: 'Touchdown', line: 'A run' };
    const html = render(
      <GameMoments
        league={league}
        home={home}
        away={away}
        moments={[td, { kind: 'final' }]}
        speed={1}
        card={{ kind: 'final' }}
        facts={{ plays, shown: plays.length - 1, names }}
      />,
    );
    expect(html).toContain('moment-banner score');
    expect(html).not.toContain('moment-card');
  });

  it('knows two readings of the same weather apart from a change in it, so the stadium is drawn once', () => {
    const w: Weather = { roof: 'outdoors', tempF: 60, windMph: 6, precip: 'none', night: true };
    expect(sameWeather(w, { ...w })).toBe(true);
    expect(sameWeather(w, { ...w, tempF: 40 })).toBe(true);
    expect(sameWeather(w, { ...w, precip: 'rain' })).toBe(false);
    expect(sameWeather(w, { ...w, windMph: 20 })).toBe(false);
    expect(sameWeather(w, { ...w, night: undefined })).toBe(false);
    expect(sameWeather({ ...w, precip: 'rain' }, { ...w, precip: 'rain', heavy: true })).toBe(false);
  });
});

describe('the field through the stadium’s camera', () => {
  it('draws the field where the stadium has it', () => {
    expect(project(-10, 0).x).toBeCloseTo(327.93, 1); // the end line behind the home goal line, near side
    expect(project(-10, 0).y).toBeCloseTo(171.98, 1);
    expect(project(110, FIELD_W).x).toBeCloseTo(80, 0);
    expect(project(110, FIELD_W).y).toBeCloseTo(90, 0);
    expect(project(50, 0).scale).toBeCloseTo(1, 3);
    expect(project(50, FIELD_W).scale).toBeCloseTo(0.676, 2);
    expect(project(50, 26, 10).y).toBeLessThan(project(50, 26, 0).y);
  });
  it('lays a yard along the field level across the picture, and a yard across it up the picture', () => {
    const f = groundFrame(50, 26);
    expect(f.dx[0]).toBeLessThan(0); // x runs right to left
    expect(Math.abs(f.dx[1])).toBeLessThan(0.01);
    expect(f.dy[1]).toBeLessThan(0);
  });
});

describe('the building behind the field', () => {
  const FAIR: Weather = { roof: 'outdoors', tempF: 60, windMph: 5, precip: 'none' };
  const home = league.teams[game.homeId];
  const away = league.teams[game.awayId];
  const own = home.colors as [string, string];

  it('puts the club’s building behind the field, as the game has it', () => {
    const html = withView('broadcast', viewer);
    expect(html).toContain('class="stadium-picture"');
    expect(html).toContain(`data-building="${buildingFor(home.abbrev, game.season, own).id}"`);
    expect(html).toMatch(
      /data-look="(day|night)(@#[0-9a-fA-F]+)?:(none|rain|snow|mixed)(\+lying)?:(none|open|closed):0\.\d+"/,
    );
    expect(html).not.toContain('class="stadium sky-');
  });
  it('keeps the picture and the play in one box', () => {
    const html = withView('broadcast', viewer);
    expect(html).toMatch(
      /<canvas class="stadium-picture"[^>]*><\/canvas>(?:<canvas class="stadium-crowd"[^>]*><\/canvas>){3}<svg class="field-scene"/,
    );
  });
  it('shuts a roof at the quarter the rain comes, not before', () => {
    const roofed = league.games.find((g) =>
      ['ATL', 'HOU', 'IND', 'DAL', 'ARI'].includes(league.teams[g.homeId].abbrev),
    )!;
    const w: Weather = { roof: 'open', tempF: 70, windMph: 5, precip: 'rain', onset: 3 };
    const at = (q: number) => gameStadium(league, roofed, weatherAt(w, q)).look.roof;
    expect([at(1), at(2), at(3), at(4)]).toEqual(['open', 'open', 'closed', 'closed']);
  });
  it('fills a playoff game and counts only earlier home games for the early rule', () => {
    expect(gameStadium(league, { ...game, playoffRound: 'WC' }, FAIR).look.fill).toBe(0.97);
    expect(homeGamesBefore(league, game)).toBe(0); // week 1
    expect(gameStadium(league, game, FAIR).look.fill).toBe(0.8); // 0–0, a first home game
  });
  it('uses one colour from each club at a neutral site, and the building of the game’s own season', () => {
    const s = gameStadium(league, { ...game, neutral: true }, FAIR);
    expect(s.colors).toEqual([home.colors[0], away.colors[0]]);
    expect(s.building.id).toBe(buildingFor(home.abbrev, game.season, own).id);
  });
  it('dresses the crowd in the jersey of a colour rush or blackout night, and not for a classic or a plain game', () => {
    const open = league.games.find((g) => league.teams[g.homeId].abbrev === 'BUF')!;
    const club = league.teams[open.homeId];
    const theme = (uniform?: Game['uniform'], neutral = false) =>
      gameStadium(league, { ...open, uniform, neutral }, FAIR).look.theme;
    expect(theme('rush')).toBe(uniformFor(league, club, { ...open, uniform: 'rush' }).kit.jersey);
    expect(theme('blackout')).toBe(uniformFor(league, club, { ...open, uniform: 'blackout' }).kit.jersey);
    expect(theme('classic')).toBeUndefined();
    expect(theme()).toBeUndefined();
    expect(theme('rush', true)).toBeUndefined();
  });
  it('plays a night kickoff at a neutral site under the lights', () => {
    const open = league.games.find((g) => league.teams[g.homeId].abbrev === 'BUF')!;
    const at = (et: number) =>
      gameStadium(league, { ...open, neutral: true, kickoff: { day: 'sun', et } }, FAIR).look.night;
    expect(at(20 * 60 + 20)).toBe(true);
    expect(at(13 * 60)).toBe(false);
  });
  it('lets snow lie outdoors while it falls or in a freezing deep winter, and never of a building’s own accord', () => {
    const open = league.games.find((g) => league.teams[g.homeId].abbrev === 'BUF')!;
    expect(gameStadium(league, { ...open, week: 2 }, FAIR).look.lying).toBe(false);
    expect(gameStadium(league, { ...open, week: 2 }, { ...FAIR, precip: 'snow' }).look.lying).toBe(true);
    expect(gameStadium(league, { ...open, week: 15 }, { ...FAIR, tempF: 20 }).look.lying).toBe(true);
    expect(gameStadium(league, { ...open, week: 15 }, { ...FAIR, tempF: 45 }).look.lying).toBe(false);
  });
});
