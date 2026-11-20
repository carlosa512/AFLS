/**
 * Free agency's race on the screens: the Free agents tab reads who is in for each player and where your offer stands,
 * and the negotiation dialog shows his race (what matters to him, a bar per team, his agent's line) above the offer.
 */
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { capSpace } from '../engine/finance/cap';
import { createLeague } from '../engine/generate';
import { advanceOffseason, beginOffseason } from '../engine/offseason';
import { deliverMail } from '../engine/inbox';
import { askOffer, demand, freeAgents } from '../engine/offseason/negotiation';
import { letGo, placeUserOffer } from '../engine/offseason/race';
import { raceView, wantsLine } from '../engine/offseason/raceView';
import type { League, Player } from '../engine/types';
import { MailCards } from './mail';
import { NavContext, type Nav } from './nav';
import { NegotiationDialog } from './negotiation';
import { RaceChips, RacePlace } from './race';
import { FreeAgents } from './screens/FrontOffice';

const nav = {
  openPlayer: () => {},
  openTeam: () => {},
  go: () => {},
  openStaff: () => {},
  compareIds: [],
} as unknown as Nav;
const render = (el: ReactElement) => renderToStaticMarkup(<NavContext.Provider value={nav}>{el}</NavContext.Provider>);

/** Free agency's first day, run by you, every team's opening offers standing (no season played: it reads offers only). */
const world = (() => {
  const l = createLeague({ seed: 'fa-race-ui' });
  l.phase = 'complete' as League['phase'];
  beginOffseason(l);
  while (l.phase !== 'resign') advanceOffseason(l, { autoUser: true });
  advanceOffseason(l, { autoUser: false });
  expect(l.phase).toBe('freeAgency');
  return JSON.stringify(l);
})();
const fresh = (): League => {
  const l: League = JSON.parse(world);
  const t = l.teams[l.userTeamId];
  t.carryover += 500_000 - capSpace(l, t.id);
  return l;
};
const teamsIn = (l: League, p: Player) => raceView(l, p.id)?.teams.length ?? 0;
/** A free agent with at least `n` teams in for him whom your scouts have read. */
const contested = (l: League, n: number) =>
  freeAgents(l).find((p) => teamsIn(l, p) >= n && wantsLine(l, l.userTeamId, p) !== null)!;
/** Your offer at his ask, raised past every offer in: it stands, and it leads. */
function bid(l: League, p: Player): void {
  const ask = askOffer(demand(l, p, l.userTeamId));
  const top = Math.max(...l.faRace!.offers[p.id].map((o) => o.offer.apy));
  expect(placeUserOffer(l, p, { ...ask, apy: Math.round(Math.max(ask.apy, top) * 1.5) }).status).toBe('standing');
}
const count = (html: string, s: string) => html.split(s).length - 1;

describe('the Free agents tab in the race', () => {
  it('shows who is in, your place and his status, and marks the rows you bid on', () => {
    const l = fresh();
    const p = contested(l, 2);
    bid(l, p);
    const html = render(<FreeAgents league={l} negotiate={() => {}} />);
    for (const col of ['Teams in', 'Your offer', 'Status']) expect(html).toContain(`>${col}<`);
    expect(html).not.toContain('>Market<');
    expect(html).not.toContain('>Ask<');
    expect(count(html, 'class="has-offer"')).toBe(1);
    expect(html).toContain('Leading');
  });

  it('shows the market and the ask outside the free-agency days', () => {
    const l = fresh();
    l.phase = 'draft';
    const html = render(<FreeAgents league={l} negotiate={() => {}} />);
    for (const col of ['Market', 'Ask']) expect(html).toContain(`>${col}<`);
    expect(html).not.toContain('>Teams in<');
    expect(html).not.toContain('has-offer');
  });

  it('draws a chip for each of the first three teams and counts the rest', () => {
    const l = fresh();
    const p = contested(l, 5);
    const view = raceView(l, p.id)!;
    const html = render(<RaceChips league={l} view={view} />);
    expect(count(html, 'class="chip')).toBe(3);
    expect(html).toContain(`+${view.teams.length - 3}`);
    const few = contested(l, 2);
    const two = raceView(l, few.id)!;
    expect(count(render(<RaceChips league={l} view={two} max={two.teams.length} />), 'class="chip')).toBe(
      two.teams.length,
    );
  });

  it('says where your offer stands in words', () => {
    const l = fresh();
    const p = contested(l, 3);
    expect(render(<RacePlace view={raceView(l, p.id)!} />)).toContain('None');
    bid(l, p);
    expect(render(<RacePlace view={raceView(l, p.id)!} />)).toContain('Leading');
    const v = { ...raceView(l, p.id)!, place: 2 };
    expect(render(<RacePlace view={v} />)).toContain(`2nd of ${v.of}`);
  });
});

describe('the dialog for a player in the race', () => {
  it('shows what matters to him, a bar per team and his agent, and places or updates your offer', () => {
    const l = fresh();
    const p = contested(l, 3);
    const dialog = () => render(<NegotiationDialog league={l} player={p} onClose={() => {}} />);
    let html = dialog();
    expect(html).toContain('What matters to him');
    expect(html).toContain(wantsLine(l, l.userTeamId, p)!);
    expect(count(html, 'class="race-track')).toBe(raceView(l, p.id)!.teams.length);
    expect(html).toContain('His agent');
    expect(html).toContain('>Make offer<');
    expect(html).not.toContain('Pull offer');
    bid(l, p);
    html = dialog();
    expect(count(html, 'class="race-track')).toBe(raceView(l, p.id)!.teams.length);
    expect(html).toContain('>Update offer<');
    expect(html).toContain('>Pull offer<');
    expect(html).not.toContain('Let him go');
    // His agent's warning open: letting him go is the answer, and costs nothing.
    l.faRace!.warnings.push({ playerId: p.id, day: l.faDay, answered: false });
    html = dialog();
    expect(html).toContain('>Let him go<');
    expect(html).not.toContain('Pull offer');
  });

  it('has no race panel for a player nobody else is in for', () => {
    const l = fresh();
    const p = freeAgents(l).find((x) => !(l.faRace!.offers[x.id] ?? []).length)!;
    const html = render(<NegotiationDialog league={l} player={p} onClose={() => {}} />);
    expect(html).not.toContain('What matters to him');
    expect(html).toContain('>Make offer<');
  });
});

describe("his agent's warning in the inbox", () => {
  it('carries the race and the two answers while it is open, and nothing once answered', () => {
    const l = fresh();
    const p = contested(l, 2);
    bid(l, p);
    // Trailing now: another team's offer passes ours, and his agent calls.
    const rival = l.faRace!.offers[p.id].find((o) => o.teamId !== l.userTeamId)!;
    rival.offer = { ...rival.offer, apy: l.faRace!.offers[p.id].find((o) => o.teamId === l.userTeamId)!.offer.apy * 2 };
    l.faRace!.warnings.push({ playerId: p.id, day: l.faDay, answered: false });
    deliverMail(l);
    const letter = l.inbox!.find((m) => m.id === `race:${l.season}:${p.id}:${l.faDay}`)!;
    let html = render(<MailCards league={l} message={letter} />);
    expect(html).toContain('What matters to him');
    expect(html).toContain('>Improve your offer<');
    expect(html).toContain('>Let him go<');
    expect(html).toContain('2nd of');
    letGo(l, p.id);
    html = render(<MailCards league={l} message={letter} />);
    expect(html).not.toContain('Improve your offer');
    expect(html).not.toContain('What matters to him');
  });
});
