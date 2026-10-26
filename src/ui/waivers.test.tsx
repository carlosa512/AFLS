import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createLeague } from '../engine/generate';
import { releasePlayer } from '../engine/finance/cap';
import { initialService } from '../engine/personnel/service';
import { ensureWaivers, setWaiverClaim } from '../engine/personnel/waivers';
import { activeRoster } from '../engine/roster';
import { hashToRoute, routeToHash } from './routes';
import { Waivers } from './screens/Waivers';

describe('waiver desk', () => {
  it('shows one decision line for the wire, never per-player times or a clock to advance', () => {
    const l = createLeague({ seed: 'waiver-decision-times' });
    l.personnel!.enabled = true;
    for (const teamId of [3, 4]) {
      const p = activeRoster(l, teamId)
        .filter((x) => x.position === 'WR')
        .at(-1)!;
      p.service = initialService(0, l.season - 1);
      releasePlayer(l, p);
    }
    const html = renderToStaticMarkup(<Waivers league={l} />);
    expect(html).toContain('Decided before Week 1 kickoff');
    expect(html).not.toContain('Decision time');
    expect(html).not.toContain('Advance roster clock');
  });
  it('routes directly to the wire', () => {
    expect(hashToRoute('#/office/waivers')).toEqual({ view: 'office', tab: 'waivers' });
    expect(routeToHash({ view: 'office', tab: 'waivers' })).toBe('#/office/waivers');
  });

  it('explains inactive careers without exposing an active wire', () => {
    const l = createLeague({ seed: 'waiver-ui-off' });
    expect(renderToStaticMarkup(<Waivers league={l} />)).toContain('not active');
  });

  it('renders deadlines, contract costs and own instructions, never opposing claims', () => {
    const l = createLeague({ seed: 'waiver-ui' });
    l.personnel!.enabled = true;
    ensureWaivers(l);
    const p = activeRoster(l, 3)
      .filter((x) => x.position === 'WR')
      .at(-1)!;
    p.contract!.years.forEach((y) => {
      y.base = 1000;
      y.guaranteed = 0;
    });
    p.contract!.bonuses = [];
    p.service = initialService(0, 2025);
    releasePlayer(l, p);
    const id = l.personnel!.waivers!.pending[0].id;
    const before = JSON.stringify(l);
    const noClaims = renderToStaticMarkup(<Waivers league={l} />);
    expect(JSON.stringify(l)).toBe(before);
    const remove = activeRoster(l, 1)
      .filter((x) => x.position === 'WR')
      .at(-1)!;
    remove.teamId = null;
    remove.contract = null;
    setWaiverClaim(l, { entryId: id, teamId: 1, cutIds: [], preference: 0, group: 'PRIVATE-OPPOSING-PLAN' });
    const withHiddenClaim = renderToStaticMarkup(<Waivers league={l} />);
    expect(withHiddenClaim).not.toContain('PRIVATE-OPPOSING-PLAN');
    expect(withHiddenClaim).not.toContain('Your signing order');
    expect(withHiddenClaim).toBe(noClaims);
    expect(withHiddenClaim).toContain('released by other teams');
    expect(withHiddenClaim).toContain('Available to claim');
    expect(withHiddenClaim).toContain('Your released players');
    expect(withHiddenClaim).toContain('Decided before Week 1 kickoff');
    expect(withHiddenClaim).toContain('Your actions');
    expect(withHiddenClaim).toContain('Plan claim');
    expect(withHiddenClaim).not.toContain('Deadline</');
    expect(withHiddenClaim).toContain('Contract ends');
  });
});
