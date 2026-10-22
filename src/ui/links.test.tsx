import { beforeAll, describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createLeague } from '../engine/generate';
import type { ReactElement } from 'react';
import type { League, Player } from '../engine/types';
import { PlayerLink, TeamLink } from './components';
import { NavContext, type Nav } from './nav';

let league: League;
const nav = { openPlayer: () => {}, openTeam: () => {} } as unknown as Nav;
const render = (el: ReactElement) => renderToStaticMarkup(<NavContext.Provider value={nav}>{el}</NavContext.Provider>);
const signed = () => Object.values(league.players).find((x) => x.teamId !== null)!;

beforeAll(() => {
  league = createLeague({ seed: 'links' });
});

describe('PlayerLink', () => {
  it('renders the full name as a link, no avatar in a sentence', () => {
    const p = signed();
    const html = render(<PlayerLink league={league} player={p} />);
    expect(html).toContain('class="linklike"');
    expect(html).toContain(`${p.firstName} ${p.lastName}`);
    expect(html).not.toContain('<svg');
  });

  it('adds the avatar and the player-link class in a table', () => {
    const html = render(<PlayerLink league={league} player={signed()} avatar={26} />);
    expect(html).toContain('class="linklike player-link"');
    expect(html).toContain('<svg');
  });

  it('shortens the name and prefixes the position on request', () => {
    const p = { ...signed(), firstName: 'J', lastName: 'Smith-Jones', position: 'QB' } as Player;
    const html = render(<PlayerLink league={league} player={p} short pos />);
    expect(html).toContain('QB J. Smith-Jones');
  });

  it('draws a free agent in the free-agent grey', () => {
    const p = { ...signed(), teamId: null } as Player;
    expect(() => render(<PlayerLink league={league} player={p} avatar={26} />)).not.toThrow();
  });
});

describe('TeamLink', () => {
  it('links the nickname, no chip in a sentence', () => {
    const t = league.teams[0];
    const html = render(<TeamLink team={t} />);
    expect(html).toContain(`>${t.name}</button>`);
    expect(html).not.toContain('class="chip"');
  });

  it('draws the chip and the full name in a table, with the note outside the link', () => {
    const t = league.teams[0];
    const html = render(<TeamLink team={t} chip full sub="Division leader" />);
    expect(html).toContain('team-inline');
    expect(html).toContain(`${t.city} ${t.name}</button>`);
    expect(html).toMatch(/<\/button><small[^>]*>Division leader/);
  });
});
