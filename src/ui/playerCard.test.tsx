import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactElement } from 'react';
import { createLeague } from '../engine/generate';
import { mentoringWeek } from '../engine/mentoring';
import { activeRoster } from '../engine/roster';
import { NavContext, type Nav } from './nav';
import { PlayerCard } from './screens/PlayerCard';

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
