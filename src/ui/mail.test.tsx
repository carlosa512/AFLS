import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { deliverMail, offerMailId, threads } from '../engine/inbox';
import { createLeague } from '../engine/generate';
import { playWeek } from '../engine/league';
import { answerEnquiry, openOffers } from '../engine/trade';
import type { League, TradeOffer } from '../engine/types';
import { OfferCard } from './offers';
import { nameIndex } from './moves';
import { Folded } from './screens/Inbox';

const SEEDS = ['trades-0', 'trades-1', 'trades-2', 'trades-3', 'trades-4', 'trades-5'];

/** A league with an enquiry on the desk, found by playing on. */
function withEnquiry(seed = SEEDS[0]): { league: League; enquiry: TradeOffer } {
  const league = createLeague({ seed });
  for (let w = 0; w < 9; w++) {
    const enquiry = openOffers(league).find((o) => o.kind === 'enquiry');
    if (enquiry) return { league, enquiry };
    playWeek(league);
  }
  return withEnquiry(SEEDS[SEEDS.indexOf(seed) + 1]);
}

const card = (league: League, offer: TradeOffer) =>
  renderToStaticMarkup(<OfferCard league={league} offer={offer} compact />);

describe('the offer card', () => {
  it('says how an answered enquiry ended and links to the reply', () => {
    let found: { league: League; enquiry: TradeOffer; bid: TradeOffer } | undefined;
    for (const seed of SEEDS) {
      const { league, enquiry } = withEnquiry(seed);
      const { offer: bid } = answerEnquiry(league, enquiry.id, 'offer');
      if (bid) {
        found = { league, enquiry, bid };
        break;
      }
    }
    expect(found, 'a bid in one of the seeds').toBeDefined();
    const { league, enquiry, bid } = found!;
    expect(card(league, enquiry)).toContain(enquiry.outcome!.replace(/'/g, '&#x27;'));
    expect(card(league, enquiry)).toMatch(/see their offer/i);
    // The reply itself is open, so it has no link back.
    expect(card(league, bid)).not.toMatch(/see their offer/i);
    // The button opens the bid's message, filed in the enquiry's thread.
    expect(offerMailId(league, bid)).toBe(`offer:${bid.season}:${bid.id}:${enquiry.id}`);
  });

  it('words a closed offer from an old save that never kept an outcome', () => {
    const { league, enquiry } = withEnquiry();
    answerEnquiry(league, enquiry.id, 'notForSale');
    delete enquiry.outcome;
    const html = card(league, enquiry);
    expect(html).toMatch(/you turned it down/i);
    expect(html).not.toMatch(/see their offer/i);
  });

  it('shows a folded offer conversation as a conversation, not a list of players', () => {
    let html = '';
    for (const seed of SEEDS) {
      const { league, enquiry } = withEnquiry(seed);
      deliverMail(league);
      const { offer: bid } = answerEnquiry(league, enquiry.id, 'offer');
      if (!bid) continue;
      deliverMail(league);
      const thread = threads(league.inbox!).find((t) => t.messages.some((m) => m.id === offerMailId(league, enquiry)))!;
      expect(thread.messages.length).toBeGreaterThanOrEqual(2);
      html = renderToStaticMarkup(
        <Folded league={league} t={thread} needs={new Set()} index={nameIndex(league)} act={() => {}} />,
      );
      expect(html).toContain(`A conversation with the ${thread.messages[0].from}, newest first.`);
      expect(html).toContain('Open');
      break;
    }
    expect(html, 'a conversation in one of the seeds').not.toBe('');
    expect(html).not.toMatch(/age \d/);
    expect(html).not.toContain('class="pos"');
    expect(html).not.toMatch(/letters in one/);
  });
});
