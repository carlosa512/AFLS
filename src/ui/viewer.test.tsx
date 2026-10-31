import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactElement } from 'react';
import { createLeague } from '../engine/generate';
import { playWeek } from '../engine/league';
import { NavContext, type Nav } from './nav';
import { allSpeed, GameViewer } from './screens/GameViewer';
import { TopDownField } from './screens/TopDownField';
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
    const numbers = [...html.matchAll(/<text[^>]*>(\d+)<\/text>/g)].map((m) => m[1]);
    expect(numbers).toHaveLength(22);
    expect(html).toContain('stroke="#ffd43b"');
    expect(html).toContain('aria-label="All-22: the play from above"');
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

  it('drops 4× and 8× to 2× in All-22', () => {
    expect(allSpeed(8)).toBe(2);
    expect(allSpeed(4)).toBe(2);
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
