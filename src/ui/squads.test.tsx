import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createLeague } from '../engine/generate';
import { releaseSquadPlayer, submitSquadOffer } from '../engine/personnel/squads';
import { squadCandidates } from '../engine/personnel/squadMarket';
import { squadRates } from '../engine/personnel/eligibility';
import { practiceSquad } from '../engine/roster';
import { contractLabel } from './contracts';
import { lockProtections, protectionPicks, setPin } from '../engine/personnel/poaching';
import { PoachAction, ProtectionCell } from './personnel';
import { hashToRoute, routeToHash } from './routes';
import { PracticeSquad } from './screens/PracticeSquad';

describe('practice squad desk', () => {
  it('has a direct route and explains disabled careers', () => {
    expect(hashToRoute('#/office/squad')).toEqual({ view: 'office', tab: 'squad' });
    expect(routeToHash({ view: 'office', tab: 'squad' })).toBe('#/office/squad');
    expect(renderToStaticMarkup(<PracticeSquad league={createLeague({ seed: 'squad-ui-off' })} />)).toContain(
      'not active',
    );
  });
  it('renders pay, slot limits, own offers and promotion controls without save mutations or opponent instructions', () => {
    const l = createLeague({ seed: 'squad-ui', personnel: true });
    releaseSquadPlayer(l, practiceSquad(l, 1)[0]);
    const before = JSON.stringify(l);
    const html = renderToStaticMarkup(<PracticeSquad league={l} />);
    expect(JSON.stringify(l)).toBe(before);
    for (const text of [
      'Player limits',
      '16/16',
      'Squad weekly pay',
      'Squad season cost',
      '$13,750',
      'Sign to 53',
      'Scouted ceiling',
      'Send offers',
    ])
      expect(html).toContain(text);
    expect(html).not.toContain('class="is-user"');
    expect(html).toContain('Your scouts&#x27; estimate of his best future overall');
    const p = squadCandidates(l)[0];
    submitSquadOffer(l, { teamId: 1, playerId: p.id, weeklyPay: squadRates(l, p).min });
    expect(renderToStaticMarkup(<PracticeSquad league={l} />)).toBe(html);
    expect(contractLabel(l, practiceSquad(l, l.userTeamId)[0])).toContain('Practice squad');
  });
  it('shows protection with a pin toggle on your squad', () => {
    const l = createLeague({ seed: 'squad-ui-poach', personnel: true, userTeamId: 0 });
    const [auto] = protectionPicks(l, 0);
    expect(renderToStaticMarkup(<ProtectionCell league={l} player={l.players[auto]} />)).toContain('Protected · auto');
    const other = practiceSquad(l, 0).find((p) => !protectionPicks(l, 0).includes(p.id))!;
    const open = renderToStaticMarkup(<ProtectionCell league={l} player={other} />);
    expect(open).toContain('Always protect');
    setPin(l, 0, other.id, true);
    expect(renderToStaticMarkup(<ProtectionCell league={l} player={other} />)).toContain('Protected · pinned');
  });
  it("offers 'Sign to our 53' on another club's unprotected players only", () => {
    const l = createLeague({ seed: 'squad-ui-poach', personnel: true, userTeamId: 0 });
    const theirs = practiceSquad(l, 7);
    const shielded = l.players[protectionPicks(l, 7)[0]];
    const open = theirs.find((p) => !protectionPicks(l, 7).includes(p.id))!;
    expect(renderToStaticMarkup(<PoachAction league={l} player={open} />)).toContain('Sign to our 53');
    lockProtections(l);
    expect(renderToStaticMarkup(<PoachAction league={l} player={shielded} />)).toContain('Protected');
    expect(renderToStaticMarkup(<PoachAction league={l} player={practiceSquad(l, 0)[0]} />)).toBe('');
    expect(renderToStaticMarkup(<PracticeSquad league={l} />)).toContain('Squad signings');
  });
  it("shows other clubs' protections only once the week has locked them", () => {
    const l = createLeague({ seed: 'squad-ui-poach', personnel: true, userTeamId: 0 });
    const top = l.players[protectionPicks(l, 7)[0]];
    expect(renderToStaticMarkup(<PoachAction league={l} player={top} />)).toContain('Sign to our 53');
    lockProtections(l);
    expect(renderToStaticMarkup(<PoachAction league={l} player={top} />)).toContain('Protected');
  });
});
