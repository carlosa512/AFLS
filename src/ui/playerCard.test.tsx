import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactElement } from 'react';
import { createLeague } from '../engine/generate';
import { mentoringWeek } from '../engine/mentoring';
import { activeRoster, retirePlayer, slimRetired } from '../engine/roster';
import type { Player } from '../engine/types';
import { NavContext, type Nav } from './nav';
import { PlayerCard } from './screens/PlayerCard';
import { Ovr } from './scouting';

const nav = {
  openPlayer: () => {},
  openTeam: () => {},
  go: () => {},
  openStaff: () => {},
  compareIds: [],
} as unknown as Nav;
const render = (el: ReactElement) => renderToStaticMarkup(<NavContext.Provider value={nav}>{el}</NavContext.Provider>);
const league = createLeague({ seed: 'player-card' });
mentoringWeek(league);
const card = (id: number) => render(<PlayerCard league={league} player={league.players[id]} onClose={() => {}} />);
/** The facts block up top: from the facts div to the first section or the action row after it. */
const facts = (html: string) => {
  const at = html.indexOf('class="facts"');
  const ends = ['class="card-section', 'class="card-actions"'].map((m) => html.indexOf(m, at)).filter((i) => i > at);
  return html.slice(at, Math.min(...ends));
};

describe('the player card: pills only up top', () => {
  const mine = activeRoster(league, league.userTeamId);

  it('drops the mentor line from the facts', () => {
    const kid = mine.find((p) => p.mentor !== undefined)!;
    const html = card(kid.id);
    expect(html).not.toContain('Learning from');
    expect(html).not.toContain('Learned from');
  });

  it('keeps "Has fixed" out of the facts, in the habits over time', () => {
    const p = mine.find((x) => x.position === 'QB')!;
    delete p.quirks?.staresDown;
    p.quirkLog = [{ id: 'staresDown', change: 'lost', season: league.season, week: Math.max(1, league.week - 1) }];
    const html = card(p.id);
    expect(facts(html)).not.toContain('Has fixed');
    expect(html).toContain('Has fixed');
  });

  it('shows your player’s morale as a pill with its word', () => {
    const p = mine[3];
    p.morale = { level: -4, jolts: [] };
    const html = facts(card(p.id));
    expect(html).toContain('>Morale<');
    expect(html).toMatch(/mood-pill[^>]*>.*Very poor/);
  });

  it('pins an open promise beside his morale, for your players only', () => {
    const p = mine[4];
    p.morale = { level: -2 };
    expect(facts(card(p.id))).not.toContain('Promised');
    p.morale = {
      level: -2,
      talk: { club: league.userTeamId, promise: { kind: 'deal', made: league.moraleAt!, due: league.moraleAt! + 40 } },
    };
    expect(facts(card(p.id))).toContain('Promised a new deal');
    const theirs = activeRoster(league, (league.userTeamId + 4) % 32)[0];
    theirs.morale = { level: -2, talk: { club: theirs.teamId!, promise: { kind: 'deal', made: 0, due: 99999 } } };
    expect(card(theirs.id)).not.toContain('Promised');
  });

  it('says nothing on the card about what his mood costs him', () => {
    const p = mine[5];
    p.morale = { level: -4, jolts: [] };
    const html = card(p.id);
    expect(html).not.toMatch(/costing|lifting/i);
  });

  it('shows no morale for another club’s player', () => {
    const theirs = activeRoster(league, (league.userTeamId + 1) % 32)[0];
    expect(card(theirs.id)).not.toContain('>Morale<');
  });

  it('puts who read him inside the scout’s report', () => {
    const theirs = activeRoster(league, (league.userTeamId + 2) % 32)[0];
    const html = card(theirs.id);
    const report = html.indexOf('class="report"');
    expect(report).toBeGreaterThan(-1);
    expect(html.indexOf('Read by')).toBeGreaterThan(report);
  });

  it('turns a grudge against us into a pill', () => {
    const theirs = activeRoster(league, (league.userTeamId + 3) % 32)[0];
    theirs.left = [{ teamId: league.userTeamId, season: league.season, how: 'cut' }];
    const html = facts(card(theirs.id));
    expect(html).toMatch(/tag-pill[^"]*tag-warn[^>]*>Holds a grudge/);
    expect(html).not.toContain('Still sore');
  });
});

describe('a retired player’s card: his career and nothing else (2026-11-17)', () => {
  const l = createLeague({ seed: 'retired-card' });
  const p = Object.values(l.players).find((x) => x.position === 'QB' && x.teamId !== null)!;
  const team = p.teamId!;
  const other = (team + 1) % l.teams.length;
  p.stats = {
    [l.season - 1]: { gp: 17, passCmp: 380, passAtt: 560, passYds: 4300, passTd: 30, passInt: 9 },
    [l.season]: { gp: 15, passCmp: 300, passAtt: 470, passYds: 3500, passTd: 24, passInt: 8 },
  } as Player['stats'];
  p.statTeams = { [l.season - 1]: [team], [l.season]: [other] };
  retirePlayer(l, p);
  p.teamId = null;
  p.contract = null;
  slimRetired(p);
  const html = renderToStaticMarkup(
    <NavContext.Provider value={nav}>
      <PlayerCard league={l} player={p} onClose={() => {}} />
    </NavContext.Provider>,
  );

  it('shows that he is retired, the teams he played for and his career stats', () => {
    expect(html).toContain('Retired');
    expect(html).toContain('Teams');
    expect(html).toContain(l.teams[team].name);
    expect(html).toContain(l.teams[other].name);
    expect(html).toContain('Career stats');
    expect(html).toContain('4300');
  });

  it('shows a dash for his overall in a list', () => {
    expect(renderToStaticMarkup(<Ovr league={l} player={p} />)).toContain('–');
  });

  it('shows no ratings, scouting, makeup, habits, development, combine, health or contract', () => {
    for (const gone of [
      'Overall',
      'Potential',
      'Ratings at',
      'class="report"',
      'Development',
      'combine',
      'Habits',
      'Contract',
      'Health',
      'Injur',
    ])
      expect(html, gone).not.toContain(gone);
  });
});
