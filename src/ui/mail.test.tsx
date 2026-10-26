import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { deliverMail, mailForOffer, offerMailId, threads } from '../engine/inbox';
import { applyInjury, NEED } from '../engine/injuries';
import { chooseCover } from '../engine/roster';
import { createLeague } from '../engine/generate';
import { playWeek } from '../engine/league';
import { answerEnquiry, openOffers } from '../engine/trade';
import { talksOf } from '../engine/trade/talks';
import { dealAdvice } from '../engine/trade/advice';
import type { Game, InboxMessage, League, TradeOffer } from '../engine/types';
import { noteTone, OfferCard, showNote } from './offers';
import { nameIndex } from './moves';
import { aboutOf, clubOf, Folded, MessageBody, sender, SenderAvatar } from './screens/Inbox';
import { badgeOn, contrast } from './color';
import { MailCards, weekBack, weeksMissed } from './mail';

// Fallbacks, tried in order until one has what a test needs: an opening league that commits as a settled one does
// files fewer swap offers to you (none of trades-0..9 had one with players both ways by week 9 once rentals for
// squeezed buyers closed between AI teams); a later one does.
const SEEDS = [
  'trades-0',
  'trades-1',
  'trades-2',
  'trades-3',
  'trades-4',
  'trades-5',
  'trades-6',
  'trades-7',
  'trades-8',
  'trades-9',
  'trades-10',
  'trades-11',
  'trades-12',
  'trades-13',
  'trades-14',
  'trades-15',
];

it('separates a dated staff recommendation from the briefing without repeating its text', () => {
  const league = createLeague({ seed: 'coach-note-ui' });
  const text = 'The early return is encouraging; we should consider keeping the change for another week.';
  const m: InboxMessage = {
    id: `matchup:${league.season}:1`,
    season: league.season,
    week: 1,
    phase: 'regular',
    from: 'Head coach',
    read: false,
    category: 'matchup',
    subject: 'Opposition report',
    body: `Regular opponent briefing.\n\n${text}`,
    actions: [],
    coachNoteKey: 'test-followup',
    coachNote: { coachId: -1, coachName: 'Former Staff Member', kind: 'followup', text },
  };
  const html = renderToStaticMarkup(<MessageBody league={league} m={m} index={nameIndex(league)} act={() => {}} />);
  expect(html).toContain('class="coach-note" aria-label="Coach follow-up"');
  expect(html).toContain('Following up');
  expect(html).toContain('Former Staff Member');
  expect(html.split(text)).toHaveLength(2);
  expect(html).toContain('Regular opponent briefing.');
});

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
  it('shows at most two focused contests with clear reasoning and linked unit leaders', () => {
    const league = createLeague({ seed: 'inbox' });
    deliverMail(league);
    const report = league.inbox!.find((m) => m.category === 'matchup')!;
    const html = renderToStaticMarkup(<MailCards league={league} message={report} />);
    const count = html.match(/class="mail-focus"/g)!.length;
    expect(count).toBeGreaterThanOrEqual(1);
    expect(count).toBeLessThanOrEqual(2);
    expect(html).toContain('Unit leaders');
    expect(html).toMatch(/(Our|Their) .* \(\d+(st|nd|rd|th)\) vs/);
    expect(html).toMatch(/Our offense vs their defense|Their offense vs our defense/);
    expect(html).not.toContain('mail-matchup-score');
  });
  it('reads each matchup in one line and does not invent early-season statistics', () => {
    const league = createLeague({ seed: 'inbox' });
    deliverMail(league);
    const report = league.inbox!.find((m) => m.category === 'matchup')!;
    const html = renderToStaticMarkup(<MailCards league={league} message={report} />);
    expect(html).not.toContain('Higher unit percentiles');
    expect(html).not.toContain('Not enough games yet');
    expect(html).not.toContain('percentile');
    expect(html).toMatch(/\((\d+)(st|nd|rd|th)\) vs (our|their) .* \((\d+)(st|nd|rd|th)\): /);
    expect(html).not.toContain('mail-focus-facts');
    expect(html).not.toMatch(/NaN|Infinity|71th/);
  });
});

describe('current briefings without a task badge', () => {
  it('keeps the deadline card live until trading closes', () => {
    const league = createLeague({ seed: 'deadline-briefing' });
    league.week = 10; // deadline day: the league office's only deadline notice
    deliverMail(league);
    const message = league.inbox!.find((m) => m.id.startsWith('deadline:'))!;
    expect(message).toBeDefined();
    const live = renderToStaticMarkup(<MailCards league={league} message={message} />);
    expect(live).not.toContain('The trade deadline has passed');
    expect(live).toContain('mail-card');
    league.phase = 'complete';
    const closed = renderToStaticMarkup(<MailCards league={league} message={message} />);
    expect(closed).toContain('The trade deadline has passed');
  });
});

describe('rookie checkpoint table', () => {
  it('renders the saved rows with sortable headers after game history is gone', () => {
    const league = createLeague({ seed: 'rookie-table' });
    const p = Object.values(league.players).find((p) => p.teamId === league.userTeamId)!;
    const message = {
      id: `rookies:${league.season}:mid`,
      season: league.season,
      phase: 'regular' as const,
      week: 9,
      from: 'Director',
      category: 'scouting' as const,
      subject: 'Eight games in',
      body: 'Our class so far.',
      read: false,
      actions: [],
      rookieReport: {
        teamId: league.userTeamId,
        games: 8,
        rows: [
          {
            playerId: p.id,
            name: `${p.firstName} ${p.lastName}`,
            position: p.position,
            round: 2,
            pick: 40,
            snaps: 400,
            production: '22 catches · 310 yards',
            context: 'Workload rose after a recorded injury.',
            contributed: true,
          },
        ],
      },
    };
    league.games = [];
    const html = renderToStaticMarkup(<MailCards league={league} message={message} />);
    expect(html).toContain('<table');
    expect(html).toContain('Snaps');
    expect(html).toContain('aria-sort="ascending"');
    expect(html).toContain('400');
    expect(html).toContain('310 yards');
    expect(html).toContain('Workload rose');
    expect(html).toContain('No. 40');
  });
  it('keeps old narrative-only checkpoint letters readable without inventing a table', () => {
    const league = createLeague({ seed: 'old-rookie-table' });
    deliverMail(league);
    const message = { ...league.inbox![0], id: `rookies:${league.season}:mid` };
    expect(renderToStaticMarkup(<MailCards league={league} message={message} />)).toBe('');
  });
});

describe('medical letters distinguish history from current health', () => {
  it('does not call a player healthy merely because the original diagnosis is over', () => {
    const league = createLeague({ seed: 'medical-report-status' });
    const p = Object.values(league.players).find((p) => p.teamId === league.userTeamId)!;
    applyInjury(league, p, {
      type: 'hamstring',
      severity: 'moderate',
      weeksRemaining: 4,
      estimate: [3, 5],
      season: league.season,
      week: league.week,
      where: 'game',
    });
    deliverMail(league);
    const message = league.inbox!.find((m) => m.id === `medical:${league.season}:${league.week}:${p.id}:hamstring`)!;
    p.injury!.week++;
    let html = renderToStaticMarkup(<MailCards league={league} message={message} />);
    expect(html).toContain('Past report');
    expect(html).toContain('now being treated');
    expect(html).not.toContain('>Healthy<');
    delete p.injury;
    html = renderToStaticMarkup(<MailCards league={league} message={message} />);
    expect(html).toContain('has since recovered');
  });
});

describe('news evidence and medical names', () => {
  it('shows one chosen evidence table, reserving previous-year values for comparisons', () => {
    const league = createLeague({ seed: 'news-table' });
    deliverMail(league);
    const message = {
      ...league.inbox![0],
      id: `press:${league.season}:10:division:0`,
      leagueReport: {
        division: 'Liberty East',
        table: 'division' as 'division' | 'team' | 'yearOverYear',
        teamId: 0,
        season: league.season,
        standings: [{ teamId: 0, name: 'Buffalo Blizzard', w: 6, l: 4, t: 0, gap: 0, streak: 'W1' }],
        stats: [
          { label: 'points per game', current: '26.6', previous: '15.6', currentRank: '2nd', previousRank: '30th' },
        ],
      },
    };
    const html = renderToStaticMarkup(<MailCards league={league} message={message} />);
    expect(html.match(/<table/g)).toHaveLength(1);
    expect(html).toContain('6–4');
    expect(html).not.toContain('26.6');
    message.leagueReport.table = 'team';
    const current = renderToStaticMarkup(<MailCards league={league} message={message} />);
    expect(current).toContain('26.6');
    expect(current).not.toContain('15.6');
    message.leagueReport.table = 'yearOverYear';
    const comparison = renderToStaticMarkup(<MailCards league={league} message={message} />);
    expect(comparison).toContain('26.6');
    expect(comparison).toContain('15.6');
    expect(html).toMatch(/<button[^>]*class="linklike[^>]*>[\s\S]*?Blizzard/);
  });
  it('links available corners and the out-of-position cover option to player cards', () => {
    const league = createLeague({ seed: 'medical-news-preview' });
    const corners = Object.values(league.players).filter((p) => p.teamId === league.userTeamId && p.position === 'CB');
    for (const p of corners.slice(2))
      applyInjury(league, p, {
        type: 'hamstring',
        severity: 'moderate',
        weeksRemaining: 5,
        estimate: [4, 6],
        season: league.season,
        week: league.week,
        where: 'game',
      });
    deliverMail(league);
    const note = league.inbox!.find(
      (m) => m.id === `medical:${league.season}:${league.week}:${corners[2].id}:hamstring`,
    )!;
    const cover = chooseCover(league, league.teams[league.userTeamId], 'CB', NEED)!;
    expect(cover).toBeDefined();
    const html = renderToStaticMarkup(<MailCards league={league} message={note} />);
    expect(html).toContain('Available at CB');
    expect(html).toContain('out of position');
    expect(html).toContain(`(${cover.position}, out of position)`);
    for (const p of [corners[0], corners[1], cover])
      expect(html).toMatch(
        new RegExp(`<button[^>]*class="linklike[^>]*><span>${p.firstName} ${p.lastName}</span></button>`),
      );
  });
});

describe('article paragraph layout', () => {
  it('renders paragraphs separately and keeps named people clickable in each', () => {
    const league = createLeague({ seed: 'article-paragraphs' });
    deliverMail(league);
    const p = Object.values(league.players).find((p) => p.teamId === league.userTeamId)!;
    const name = `${p.firstName} ${p.lastName}`;
    const message = {
      ...league.inbox![0],
      id: `press:${league.season}:10:division:0`,
      body: `${name} opened the scoring.\n\n${name} finished with two touchdowns.`,
      actions: [{ kind: 'player' as const, playerId: p.id }],
    };
    const [thread] = threads([message]);
    const html = renderToStaticMarkup(
      <Folded
        league={league}
        t={thread}
        needs={new Set()}
        index={nameIndex(league)}
        act={() => {}}
        focusId={message.id}
      />,
    );
    expect(html.match(/class="inbox-body"/g)).toHaveLength(2);
    expect(html.match(new RegExp(`<button[^>]*class="linklike"[^>]*>${name}</button>`, 'g'))).toHaveLength(2);
  });
});

describe('SNN deal evidence', () => {
  it('lists each return and links the named player and clubs', () => {
    const league = createLeague({ seed: 'snn-deal-table' });
    deliverMail(league);
    const p = Object.values(league.players).find((p) => p.teamId === 1)!;
    const name = `${p.firstName} ${p.lastName}`;
    const message = {
      ...league.inbox![0],
      id: `press:${league.season}:7:trade:test`,
      tradeReport: {
        exchanges: [
          { teamId: 2, receives: `${p.position} ${name}` },
          { teamId: 1, receives: '2028 first-round pick' },
        ],
        rumors: [],
      },
    };
    const html = renderToStaticMarkup(<MailCards league={league} message={message} />);
    expect(html).toContain('Receives');
    expect(html).toContain('2028 first-round pick');
    expect(html).toMatch(new RegExp(`<button[^>]*class="linklike"[^>]*>${name}</button>`));
  });
});

describe('mail from another club', () => {
  const l = createLeague({ seed: 'club-colours' });
  const other = (l.userTeamId + 7) % 32;
  const msg = (fromTeamId?: number): InboxMessage => ({
    id: 'x',
    season: l.season,
    phase: 'regular',
    week: 3,
    from: fromTeamId === undefined ? 'Maureen Rose, Director of scouting' : 'Somewhere front office',
    category: 'trades',
    subject: 's',
    body: 'b',
    read: false,
    actions: [],
    fromTeamId,
  });
  it('shows mail from another club in its colours with its abbreviation', () => {
    expect(clubOf(l, msg(other))?.id).toBe(other);
    const html = renderToStaticMarkup(<SenderAvatar league={l} m={msg(other)} initials="SF" />);
    expect(html).toContain(`>${l.teams[other].abbrev}<`);
    expect(html.toLowerCase()).toContain(`background:${badgeOn(l.teams[other].colors[0]).bg.toLowerCase()}`);
  });
  it('keeps our own staff, and our own club, in the category colours', () => {
    expect(clubOf(l, msg())).toBeNull();
    expect(clubOf(l, msg(l.userTeamId))).toBeNull();
    const html = renderToStaticMarkup(<SenderAvatar league={l} m={msg()} initials="MR" />);
    expect(html).toContain('>MR<');
    expect(html).toContain('cat-trades');
  });
  it('keeps every club’s initials readable', () => {
    for (const t of l.teams) {
      const { bg, ink } = badgeOn(t.colors[0]);
      expect(contrast(bg, ink)).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe('the head coach’s rundown', () => {
  it('lists our key players and prospects as links', () => {
    const league = createLeague({ seed: 'onboarding-card' });
    deliverMail(league);
    const m = league.inbox!.find((x) => x.id.startsWith('rundown:'))!;
    const html = renderToStaticMarkup(<MailCards league={league} message={m} />);
    for (const id of [...m.rundown!.offense, ...m.rundown!.defense, ...m.rundown!.prospects])
      expect(html).toContain(league.players[id].lastName);
    expect(html).toContain('Prospects to watch');
  });
});

describe('SNN’s offseason front-office digest', () => {
  it('shows the changes grouped, with clubs and GMs linked', () => {
    const l = createLeague({ seed: 'digest-card' });
    const [a, b] = [1, 2].map((i) => (l.userTeamId + i) % 32);
    const gm = l.gms[l.teams[a].gmId!];
    const message: InboxMessage = {
      id: `leadership-phase:${l.season}:resign:1-2`,
      season: l.season,
      phase: 'resign',
      week: 0,
      from: 'SNN league desk',
      category: 'league',
      subject: 'Front-office carousel: 1 GM out, 1 on the hot seat',
      body: 'b',
      read: false,
      actions: [],
      carousel: [
        { group: 'out', teamId: a, gmId: gm.id, name: `${gm.firstName} ${gm.lastName}`, line: 'let go after 3–14' },
        { group: 'hotSeat', teamId: b, name: 'Pat Doe', line: 'prove-it season' },
      ],
    };
    const html = renderToStaticMarkup(<MailCards league={l} message={message} />);
    expect(html).toContain('Out');
    expect(html).toContain('Hot seat');
    expect(html).not.toContain('Hired');
    expect(html).toContain('let go after 3–14');
    expect(html).toContain(l.teams[a].name);
    expect(html).toContain(gm.lastName);
  });
});

describe('outlet badges', () => {
  it.each([
    ['SNN league desk', 'SNN'],
    ['SNN — Sports News Network', 'SNN'],
    ['The Arena Gazette', 'GAZ'],
    ['League office', 'LO'],
    ['The owner', 'OWN'],
    ['SNN', 'SNN'],
    ['Front office', 'FO'],
    ['Coaching staff', 'CS'],
    ['Scouting department', 'SCT'],
    ['Director of scouting', 'DIR'],
    ['Medical staff', 'MED'],
    ['Your players', 'PLY'],
  ])('draws %s as %s', (from, badge) => expect(sender(from).initials).toBe(badge));
  it('keeps people’s initials', () => expect(sender('Nick Holland, Director of scouting').initials).toBe('NH'));
});
