import { describe, expect, it } from 'vitest';
import { createLeague } from '../generate';
import { teamPlayers } from '../roster';
import type { League, Phase, TradeOffer } from '../types';
import { emptyMarket } from './execute';
import { askedAbout, deskState } from './desk';

/** A league at a point in the year, with an empty market. */
function at(phase: Phase, week = 1): League {
  const l = createLeague({ seed: 'desk-0' });
  l.phase = phase;
  l.week = week;
  l.market = emptyMarket();
  return l;
}

const yours = (l: League) => teamPlayers(l, l.userTeamId).filter((p) => p.contract)[0];
const rivalOf = (l: League) => l.teams.find((t) => t.id !== l.userTeamId)!;

/** A pending bid from a rival for one of your players. */
function bid(l: League, teamId = rivalOf(l).id, playerId = yours(l).id): TradeOffer {
  const offer: TradeOffer = {
    id: l.market!.nextOfferId++,
    teamId,
    sides: [
      { teamId, players: [], picks: [] },
      { teamId: l.userTeamId, players: [playerId], picks: [] },
    ],
    kind: 'buy',
    reason: 'bid',
    season: l.season,
    phase: l.phase,
    week: l.week,
    moment: l.market!.moment,
    status: 'pending',
    patience: 2,
    worth: 100,
  };
  l.market!.offers.push(offer);
  return offer;
}

describe('the trade desk', () => {
  it('puts a physical first, then offers, then deadline day, a closed window, and quiet', () => {
    const quiet = at('regular', 7);
    expect(deskState(quiet).headline).toBe('quiet');
    expect(deskState(quiet).text).toMatch(/^No calls waiting · \d+ teams are buying$/);
    expect(deskState(quiet).urgent).toBe(false);

    const withOffer = at('regular', 7);
    bid(withOffer);
    expect(deskState(withOffer)).toMatchObject({ headline: 'offers', text: '1 offer needs an answer.', urgent: true });
    bid(withOffer);
    expect(deskState(withOffer).text).toBe('2 offers need an answer.');

    const p = yours(withOffer);
    withOffer.market!.exam = {
      sides: [
        { teamId: rivalOf(withOffer).id, players: [], picks: [] },
        { teamId: withOffer.userTeamId, players: [p.id], picks: [] },
      ],
      aiId: rivalOf(withOffer).id,
      kind: 'buy',
      exams: [{ playerId: p.id, result: 'concerns', note: '' }],
      by: 'theirs',
    };
    expect(deskState(withOffer)).toMatchObject({
      headline: 'exam',
      text: `A physical flagged ${p.firstName} ${p.lastName}: your call.`,
      urgent: true,
    });

    expect(deskState(at('regular', 10)).text).toBe('Deadline day: the window shuts when you advance.');
    expect(deskState(at('regular', 12)).headline).toBe('closed');
    expect(deskState(at('playoffs')).text).toBe('Trades reopen when the new league year begins.');
  });

  it('words the deadline for every part of the year', () => {
    expect(deskState(at('regular', 7)).deadline.value).toBe('Week 9 · 2 weeks away');
    expect(deskState(at('regular', 8)).deadline.value).toBe('Week 9 · 1 week away');
    expect(deskState(at('regular', 9)).deadline.value).toBe('This week');
    expect(deskState(at('regular', 10)).deadline.value).toBe('Today');
    expect(deskState(at('regular', 12)).deadline.value).toBe('Passed');
    expect(deskState(at('freeAgency')).deadline).toEqual({ value: 'Week 9', note: 'open all offseason' });
    expect(deskState(at('playoffs')).deadline.value).toBe('Reopens in the new league year');
  });

  it('counts your statuses and the teams asking, from offers to you only', () => {
    const l = at('regular', 7);
    const [a, b, c] = teamPlayers(l, l.userTeamId).filter((p) => p.contract);
    l.market!.status = { [a.id]: 'listed', [b.id]: 'listed', [c.id]: 'untouchable' };
    const [r1, r2] = l.teams.filter((t) => t.id !== l.userTeamId);
    bid(l, r1.id, a.id);
    bid(l, r1.id, b.id).status = 'declined';
    bid(l, r2.id, a.id);
    // What AI clubs are watching is their business, not yours.
    l.market!.interest.push({ teamId: l.teams[5].id, playerId: c.id, level: 3, at: l.market!.moment });
    expect(deskState(l)).toMatchObject({ listed: 2, untouchable: 1, asking: 2, offers: 2 });
    expect(askedAbout(l).get(r1.id)).toEqual([a.id, b.id]);
  });

  it('works before the market exists', () => {
    const l = at('regular', 3);
    delete l.market;
    expect(deskState(l)).toMatchObject({ headline: 'quiet', offers: 0, listed: 0, untouchable: 0, asking: 0 });
  });
});
