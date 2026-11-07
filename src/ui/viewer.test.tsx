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
        .replace(/<span class="vc-levels" role="group" aria-label="View">[\s\S]*?<\/span>/, '');
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
