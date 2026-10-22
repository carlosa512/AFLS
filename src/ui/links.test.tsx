import { beforeAll, describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createLeague } from '../engine/generate';
import { simToEndOfSeason } from '../engine/league';
import { advanceOffseason, beginOffseason } from '../engine/offseason';
import { expiringPlayers } from '../engine/offseason/ai';
import { Resign } from './screens/FrontOffice';
import type { ReactElement } from 'react';
import type { League, Player } from '../engine/types';
import { GradesTable, PlayerLink, SortSeg, TeamLink, TeamPicker } from './components';
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

  it('shows the surname alone on request', () => {
    const p = { ...signed(), firstName: 'Kyle', lastName: 'James', position: 'WR' } as Player;
    const html = render(<PlayerLink league={league} player={p} surname pos />);
    expect(html).toContain('>WR James</span>');
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

describe('TeamPicker', () => {
  it('offers the league first when asked, and never the excluded club', () => {
    const me = league.userTeamId;
    const html = render(<TeamPicker league={league} value="all" onChange={() => {}} allowLeague exclude={[me]} />);
    expect(html).toMatch(/<option value="all"[^>]*>League<\/option>/);
    expect(html).not.toContain(`value="${me}"`);
    expect(html).not.toContain('(you)');
  });
});

describe('SortSeg', () => {
  it('marks the active key and shows its direction', () => {
    const html = render(
      <SortSeg
        label="Sort assets"
        options={[
          { k: 'pos', label: 'Position', desc: false },
          { k: 'ovr', label: 'OVR' },
        ]}
        sort={{ key: 'ovr', desc: true }}
        onSort={() => {}}
      />,
    );
    expect(html).toMatch(/aria-pressed="true"[^>]*>OVR[^<]*▼/);
    expect(html).toMatch(/aria-pressed="false"[^>]*>Position/);
  });
});

describe('Resign tables', () => {
  it('sort through the shared header and keep every row its buttons', () => {
    const l = createLeague({ seed: 'resign' });
    simToEndOfSeason(l);
    beginOffseason(l);
    while (l.phase !== 'resign') advanceOffseason(l);
    const html = render(<Resign league={l} negotiate={() => {}} />);
    const expiring = expiringPlayers(l, l.userTeamId).length;
    expect(expiring).toBeGreaterThan(0);
    expect(html.split('>Negotiate</button>').length - 1).toBe(expiring);
    expect(html).toContain('class="th-sort"');
  });
});

describe('GradesTable', () => {
  it('marks your row with is-user and keeps it a tap away from its staff', () => {
    const me = league.userTeamId;
    const grades = new Map([
      [me, { rank: 1, grade: 'A' }],
      [me === 0 ? 1 : 0, { rank: 2, grade: 'B' }],
    ]);
    const html = render(<GradesTable league={league} grades={grades} staffOf={() => null} />);
    expect(html).toContain('class="is-user"');
    expect(html).not.toContain('class="me"');
    expect(html).toMatch(/class="is-user"[\s\S]*?aria-expanded="false"/);
    expect(html).toContain('class="th-sort"');
  });
});
