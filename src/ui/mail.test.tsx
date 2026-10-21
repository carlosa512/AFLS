import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { deliverMail, mailForOffer, offerMailId, threads } from '../engine/inbox';
import { createLeague } from '../engine/generate';
import { playWeek } from '../engine/league';
import { answerEnquiry, openOffers } from '../engine/trade';
import { talksOf } from '../engine/trade/talks';
import { dealAdvice } from '../engine/trade/advice';
import type { Game, League, TradeOffer } from '../engine/types';
import { noteTone, OfferCard, showNote } from './offers';
import { nameIndex } from './moves';
import { aboutOf, Folded } from './screens/Inbox';
import { MailCards, weekBack, weeksMissed } from './mail';

// Fixed seeds searched in order for a fixture: a swap offered to you in the first nine weeks is rare (two seeds in
// twelve), so the list runs to the first one that has it.
const SEEDS = ['trades-0', 'trades-1', 'trades-2', 'trades-3', 'trades-4', 'trades-5', 'trades-6', 'trades-7'];

/** A league with an enquiry on the desk, found by playing on. */
function withEnquiry(seed = SEEDS[0]): { league: League; enquiry: TradeOffer } {
  const league = createLeague({ seed });
  for (let w = 0; w < 9; w++) {
    const enquiry = openOffers(league).find((o) => o.kind === 'enquiry');
    if (enquiry) return { league, enquiry };
    playWeek(league);
  }
  if (SEEDS.indexOf(seed) + 1 >= SEEDS.length) throw new Error('no seed in SEEDS had an enquiry by week 9');
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

  it('reads a bid that could not be made as answered, never as turned down', () => {
    const { league, enquiry } = withEnquiry();
    // Talks are off with this team this moment, so no bid can be filed.
    talksOf(league.market!, enquiry.teamId).offUntil = league.market!.moment;
    const { offer } = answerEnquiry(league, enquiry.id, 'offer');
    expect(offer).toBeNull();
    const html = card(league, enquiry);
    expect(html).toMatch(/couldn(&#x27;|')t make the numbers work/);
    expect(html).not.toMatch(/declined|turned it down/i);
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

  it('opens the thread with the offer it was sent to expanded', () => {
    let html = '';
    for (const seed of SEEDS) {
      const { league, enquiry } = withEnquiry(seed);
      deliverMail(league);
      const { offer: bid } = answerEnquiry(league, enquiry.id, 'offer');
      if (!bid) continue;
      deliverMail(league);
      const target = mailForOffer(league, bid)?.id ?? offerMailId(league, bid);
      const thread = threads(league.inbox!).find((t) => t.messages.some((m) => m.id === target))!;
      expect(thread.messages.length).toBeGreaterThanOrEqual(2);
      html = renderToStaticMarkup(
        <Folded
          league={league}
          t={thread}
          needs={new Set()}
          index={nameIndex(league)}
          act={() => {}}
          focusId={target}
        />,
      );
      break;
    }
    expect(html, 'a conversation in one of the seeds').not.toBe('');
    // Only the bid is open, and it shows its buttons.
    expect(html.match(/aria-expanded="true"/g)?.length).toBe(1);
    expect(html).toContain('Accept');
  });
});

/** A league with a filed offer message, found by playing on; `want` picks the offer. */
function withFiledOffer(
  want: (o: TradeOffer, league: League) => boolean,
  seed = SEEDS[0],
): { league: League; offer: TradeOffer } {
  const league = createLeague({ seed });
  for (let w = 0; w < 9; w++) {
    deliverMail(league);
    const offer = openOffers(league).find((o) => want(o, league) && mailForOffer(league, o));
    if (offer) return { league, offer };
    playWeek(league);
  }
  if (SEEDS.indexOf(seed) + 1 >= SEEDS.length) throw new Error('no seed in SEEDS had a matching filed offer by week 9');
  return withFiledOffer(want, SEEDS[SEEDS.indexOf(seed) + 1]);
}

describe('staff notes on an offer', () => {
  it('link every player they name', () => {
    const { league, offer } = withFiledOffer(
      (o, l) => o.kind !== 'enquiry' && dealAdvice(l, o.sides).some((a) => a.who === 'coach'),
    );
    const named = dealAdvice(league, offer.sides).flatMap((a) =>
      offer.sides
        .flatMap((s) => s.players)
        .map((id) => league.players[id])
        .filter(Boolean)
        .filter((p) => a.line.includes(`${p.firstName} ${p.lastName}`)),
    );
    expect(named.length, 'a note naming a player').toBeGreaterThan(0);
    const html = renderToStaticMarkup(<OfferCard league={league} offer={offer} />);
    const list = html.slice(html.indexOf('plain-list small'));
    expect(list).toContain(`>${named[0].firstName} ${named[0].lastName}</button>`);
  });
});

describe('the note under an offer', () => {
  it('is neutral when an accept only asks for something more, red only for a real refusal', () => {
    expect(noteTone({ ok: true })).toBe('good');
    expect(noteTone({ ok: false })).toBe('bad');
    expect(noteTone({ ok: false, release: [] })).toBe('note');
    expect(noteTone({ ok: false, exam: true })).toBe('note');
  });

  it('is not repeated when the card already shows the same line as the outcome', () => {
    const offer = { outcome: 'You turned it down.' } as TradeOffer;
    expect(showNote('You turned it down.', offer)).toBe(false);
    expect(showNote('Something else.', offer)).toBe(true);
    expect(showNote(null, offer)).toBe(false);
    expect(showNote('', offer)).toBe(false);
    expect(showNote('Anything.', { ...offer, outcome: undefined })).toBe(true);
  });
});

describe('offer mail', () => {
  it('still reads after the offer is pruned from the market', () => {
    const { league, offer } = withFiledOffer(() => true);
    const message = mailForOffer(league, offer)!;
    league.market!.offers = league.market!.offers.filter((o) => o.id !== offer.id);
    let html = '';
    expect(() => {
      html = renderToStaticMarkup(<MailCards league={league} message={message} />);
    }).not.toThrow();
    expect(html).toMatch(/no longer on file/i);
  });

  it('links every player on both sides of the offer', () => {
    const { league, offer } = withFiledOffer((o) => o.sides[0].players.length > 0 && o.sides[1].players.length > 0);
    const message = mailForOffer(league, offer)!;
    const about = aboutOf(league, message);
    for (const id of [...offer.sides[0].players, ...offer.sides[1].players]) {
      expect(about, `player ${id}`).toContainEqual({ kind: 'player', id });
    }
    // Once the offer is gone there is nothing to read the players from, and it still answers.
    league.market!.offers = league.market!.offers.filter((o) => o.id !== offer.id);
    expect(() => aboutOf(league, message)).not.toThrow();
  });
});

describe('flex mail', () => {
  it('shows the opponent card, with the team name as a button', () => {
    const league = createLeague({ seed: 'flex-mail' });
    const user = league.userTeamId;
    const g = league.games.find((x) => x.season === league.season && (x.homeId === user || x.awayId === user))!;
    g.flexed = { day: 'sun', et: 13 };
    g.kickoff = { day: 'mon', et: 20 };
    deliverMail(league);
    const message = league.inbox!.find((m) => m.id.startsWith(`flex:${g.season}:${g.id}:`))!;
    expect(message, 'a flex message').toBeDefined();
    const opp = league.teams[g.homeId === user ? g.awayId : g.homeId];
    const html = renderToStaticMarkup(<MailCards league={league} message={message} />);
    expect(html).toMatch(new RegExp(`<button[^>]*>[^<]*${opp.name}[^<]*</button>`));
  });

  it('shows nothing for a game that is no longer in the league', () => {
    const league = createLeague({ seed: 'flex-mail' });
    const message = { id: `flex:${league.season}:99999:sun13`, actions: [] } as unknown as Parameters<
      typeof MailCards
    >[0]['message'];
    expect(renderToStaticMarkup(<MailCards league={league} message={message} />)).toBe('');
  });
});

describe('cleared mail', () => {
  it('counts the weeks a player missed, not the weeks since he was hurt', () => {
    // Hurt in week 2's game, out for week 3, back for week 4: one week out.
    expect(weeksMissed({ season: 2026, week: 2 }, { season: 2026, week: 4 })).toBe(1);
    expect(weeksMissed({ season: 2026, week: 1 }, { season: 2026, week: 3 })).toBe(1);
    // Cleared in time for the next game.
    expect(weeksMissed({ season: 2026, week: 5 }, { season: 2026, week: 6 })).toBe(0);
  });

  it('finds the week he was back from the box scores, so a multi-week sim does not stretch it', () => {
    const game = (week: number, dressed: number[]) =>
      ({
        season: 2026,
        week,
        result: { playerTeams: Object.fromEntries(dressed.map((id) => [id, 0])) },
      }) as unknown as Game;
    const games = [game(5, [7]), game(6, []), game(7, [7]), game(8, [7]), game(9, [])];
    // Hurt in week 5, dressed again in week 7: the letter filed in week 17 after a sim still says week 7.
    expect(weekBack(games, 7, { season: 2026, week: 5 }, { season: 2026, week: 17 })).toBe(7);
    expect(weeksMissed({ season: 2026, week: 5 }, { season: 2026, week: 7 })).toBe(1);
    // Not played since he was cleared: the letter's own week.
    expect(weekBack(games, 9, { season: 2026, week: 5 }, { season: 2026, week: 9 })).toBe(9);
    // Dressed in the letter's own week: that week.
    expect(weekBack(games, 7, { season: 2026, week: 7 }, { season: 2026, week: 8 })).toBe(8);
  });

  it('gives no count for an offseason injury or one that ran into the next season', () => {
    expect(weeksMissed({ season: 2026, week: 0 }, { season: 2026, week: 3 })).toBeNull();
    expect(weeksMissed({ season: 2025, week: 17 }, { season: 2026, week: 2 })).toBeNull();
  });
});

describe('the opposition report', () => {
  it('shows key matchups, each unit against the one it faces, with the key players', () => {
    const league = createLeague({ seed: 'inbox' });
    deliverMail(league);
    const report = league.inbox!.find((m) => m.category === 'matchup')!;
    const html = renderToStaticMarkup(<MailCards league={league} message={report} />);
    expect(html).toContain('Key matchups');
    expect(html).toContain('Our offense vs their defense');
    expect(html).toContain('Their offense vs our defense');
    expect(html).not.toContain('How we match up');
    for (const title of ['Trenches', 'Run game', 'Pass game']) expect(html.split(title).length - 1).toBe(2);
    // Two sides of three rows, a face on each side.
    expect(html.match(/class="mail-matchup-side[ "]/g)?.length).toBe(12);
    expect(html.slice(html.indexOf('Key matchups')).match(/class="avatar"/g)?.length).toBeGreaterThanOrEqual(12);
  });

  it('says plainly what its numbers mean', () => {
    const league = createLeague({ seed: 'inbox' });
    deliverMail(league);
    const report = league.inbox!.find((m) => m.category === 'matchup')!;
    const html = renderToStaticMarkup(<MailCards league={league} message={report} />);
    expect(html).toMatch(/where the unit ranks in the league/);
    expect(html).toMatch(/50th is average/);
    // Every score reads as a rank ("74th"), with what it means on hover.
    const scores = [...html.matchAll(/class="num mail-matchup-score"[^>]*>([^<]+)</g)].map((m) => m[1]);
    expect(scores).toHaveLength(12);
    for (const s of scores) expect(s).toMatch(/^\d+(st|nd|rd|th)$/);
    expect(html).toMatch(/title="Better than about \d+% of the league(&#x27;|')s units"/);
  });
});
