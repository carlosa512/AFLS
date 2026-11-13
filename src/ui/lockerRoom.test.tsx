import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { createLeague } from '../engine/generate';
import { playWeek } from '../engine/league';
import type { League } from '../engine/types';
import { NavContext, type Nav } from './nav';
import { LockerRoom, splitRooms } from './screens/LockerRoom';

const nav = {
  openPlayer: () => {},
  openTeam: () => {},
  go: () => {},
  openStaff: () => {},
  compareIds: [],
} as unknown as Nav;
const render = (l: League) =>
  renderToStaticMarkup(
    <NavContext.Provider value={nav}>
      <LockerRoom league={l} />
    </NavContext.Provider>,
  );

describe('the Locker Room layout', () => {
  it('keeps a room in trouble or with something to show among the big cards', () => {
    const card = (id: string, o: Partial<{ trouble: boolean; follows: number[]; deal: number[]; ties: number[] }>) => ({
      id,
      trouble: false,
      follows: [] as number[],
      deal: [] as number[],
      ties: [] as number[],
      ...o,
    });
    const { big, quiet } = splitRooms([
      card('trouble', { trouble: true }),
      card('empty-1', {}),
      card('follows', { follows: [1] }),
      card('deal', { deal: [2] }),
      card('empty-2', {}),
      card('ties', { ties: [3] }),
    ]);
    expect(big.map((c) => c.id)).toEqual(['trouble', 'follows', 'deal', 'ties']);
    expect(quiet.map((c) => c.id)).toEqual(['empty-1', 'empty-2']);
  });

  it('lays the screen out in panels: Morale, then The rooms with the captains first', () => {
    const l = createLeague({ seed: 'locker-layout', personnel: true });
    playWeek(l);
    playWeek(l);
    const html = render(l);
    expect(html).not.toContain('card-section');
    const morale = html.indexOf('<h2>Morale</h2>');
    const rooms = html.indexOf('<h2>The rooms</h2>');
    expect(morale).toBeGreaterThan(-1);
    expect(rooms).toBeGreaterThan(morale);
    expect(html.indexOf('captains-row')).toBeGreaterThan(rooms);
    expect(html.indexOf('captains-row')).toBeLessThan(html.indexOf('room-card'));
  });

  it('says the early lines in a new league', () => {
    const l = createLeague({ seed: 'locker-new' });
    const team = l.teams[l.userTeamId];
    const html = render(l);
    if (team.captains?.season !== l.season) expect(html).toContain('Captains are named when camp opens.');
    expect(html).toMatch(/Nobody is down right now\.|Needs a word/);
  });

  it('drops the folds and the heading', () => {
    const html = render(createLeague({ seed: 'locker-new' }));
    expect(html).not.toContain('<h1');
    expect(html).not.toContain('The way our coaches see it.');
  });

  it('lays morale out in three columns only on a wide screen', () => {
    const css = readFileSync('src/styles.css', 'utf8');
    const wide = /@media \(min-width: 1100px\) \{\s*\.morale-board \{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(wide).toMatch(/grid-template-columns:\s*repeat\(3,/);
    const base = /\n\.morale-board \{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(base).toMatch(/grid-template-columns:\s*minmax\(0, 1fr\);/);
  });
});
