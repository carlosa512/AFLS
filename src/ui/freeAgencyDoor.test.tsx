/**
 * Free agency does not open by accident: in the re-sign window the advance button waits on the owner's question about
 * an interim head coach and on every expiring contract, and one button on the Re-sign tab answers for the rest.
 */
import { describe, expect, it } from 'vitest';
import { installInterimHeadCoach } from '../engine/coaching';
import { openContracts } from '../engine/contractMail';
import { createLeague } from '../engine/generate';
import { deliverMail } from '../engine/inbox';
import {
  decideInterim,
  declineGmOffers,
  pendingGmOffers,
  userExtensionOffer,
  acceptGmOffer,
} from '../engine/leadership';
import { beginOffseason, letRestWalk, setLettingWalk } from '../engine/offseason';
import type { League } from '../engine/types';
import { offseasonStep } from './App';

/** The re-sign window, with any question about your own job answered first. */
function resignWindow(l: League): League {
  l.phase = 'complete';
  beginOffseason(l);
  const offer = userExtensionOffer(l);
  if (offer) acceptGmOffer(l, offer.teamId);
  else if (pendingGmOffers(l)) declineGmOffers(l);
  return l;
}

describe('opening free agency', () => {
  it('waits until every expiring contract has an answer', () => {
    const l = resignWindow(createLeague({ seed: 'fa-door' }));
    const open = openContracts(l);
    expect(open.length).toBeGreaterThan(1);
    const step = offseasonStep(l)!;
    expect(step.label).toBe(`Decide ${open.length} contracts`);
    expect(step.then).toEqual({ view: 'office', tab: 'resign' });
    // The button takes you there and changes nothing.
    step.run(l);
    expect(l.phase).toBe('resign');
    setLettingWalk(l, open[0].id, true);
    expect(offseasonStep(l)!.label).toBe(
      open.length === 2 ? 'Decide 1 contract' : `Decide ${open.length - 1} contracts`,
    );
    letRestWalk(
      l,
      openContracts(l).map((p) => p.id),
    );
    expect(openContracts(l)).toEqual([]);
    const go = offseasonStep(l)!;
    expect(go.label).toBe('Open free agency');
    go.run(l);
    expect(l.phase).toBe('freeAgency');
  });

  it('asks about your interim head coach before the contracts', () => {
    const l = createLeague({ seed: 'fa-door-interim' });
    l.teams[l.userTeamId].staffBudgetMult = 3;
    const interim = installInterimHeadCoach(l, l.userTeamId)!;
    resignWindow(l);
    // The owner's letter is on file, as it is after any step in the app: the door sends you to it.
    deliverMail(l);
    const step = offseasonStep(l)!;
    expect(step.label).toBe('Decide on your head coach');
    expect(step.then).toEqual({ view: 'inbox', messageId: `interim:${l.season}:${interim.id}` });
    decideInterim(l, true);
    expect(offseasonStep(l)!.label).toMatch(/^Decide \d+ contracts?$/);
  });

  it('does not block on the head coach when the owner’s letter was deleted: the window closes and he decides', () => {
    const l = createLeague({ seed: 'fa-door-deleted' });
    l.teams[l.userTeamId].staffBudgetMult = 3;
    const interim = installInterimHeadCoach(l, l.userTeamId)!;
    resignWindow(l);
    deliverMail(l);
    const letter = l.inbox!.find((m) => m.id === `interim:${l.season}:${interim.id}`)!;
    expect(offseasonStep(l)!.label).toBe('Decide on your head coach');
    letter.deleted = true;
    expect(offseasonStep(l)!.label).toMatch(/^Decide \d+ contracts?$/);
    letRestWalk(
      l,
      openContracts(l).map((p) => p.id),
    );
    const go = offseasonStep(l)!;
    expect(go.label).toBe('Open free agency');
    go.run(l);
    expect(l.phase).toBe('freeAgency');
    expect(interim.interim).toBeUndefined();
  });
});
