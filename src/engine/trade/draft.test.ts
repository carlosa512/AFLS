import { describe, expect, it } from 'vitest';
import { createLeague } from '../generate';
import { deliverMail, offerWords } from '../inbox';
import { simToEndOfSeason } from '../league';
import { migrateLeague } from '../migrate';
import { advanceOffseason, beginOffseason } from '../offseason';
import { draftOrder } from '../offseason/draft';
import type { League, TradeOffer } from '../types';
import { emptyMarket } from './execute';

/** One league played through a season and walked to draft day, cloned per test. */
const atDraft = (() => {
  const league = createLeague({ seed: 'draft-trades' });
  simToEndOfSeason(league);
  beginOffseason(league);
  while (league.phase !== 'draft') advanceOffseason(league, { autoUser: true });
  return JSON.stringify(league);
})();
const draftDay = (): League => JSON.parse(atDraft);

/** An offer to you from `teamId`: his picks for yours. */
function pickOffer(league: League, teamId: number, his: number[], yours: number[], reason: TradeOffer['reason']) {
  const market = (league.market ??= emptyMarket());
  const offer: TradeOffer = {
    id: market.nextOfferId++,
    teamId,
    sides: [
      { teamId, players: [], picks: his },
      { teamId: league.userTeamId, players: [], picks: yours },
    ],
    kind: 'draft',
    reason,
    season: league.season,
    phase: league.phase,
    week: league.week,
    moment: market.moment,
    status: 'pending',
    patience: 1,
    worth: 0,
  };
  market.offers.push(offer);
  return offer;
}

/** The first pick of yours and two later picks of another team, in this draft. */
function picksFor(league: League) {
  const order = draftOrder(league);
  const mine = order.find((p) => p.ownerId === league.userTeamId)!;
  const other = order.find((p) => p.ownerId !== league.userTeamId && p.overall! > mine.overall!)!;
  const theirs = order.filter((p) => p.ownerId === other.ownerId && p.overall! > mine.overall!).slice(0, 2);
  return { mine, team: league.teams[other.ownerId], theirs };
}

describe('draft-day offers in words', () => {
  it('reads a draft offer as a move up for your pick', () => {
    const l = draftDay();
    const { mine, team, theirs } = picksFor(l);
    const o = pickOffer(
      l,
      team.id,
      theirs.map((p) => p.id),
      [mine.id],
      'draft',
    );
    const words = offerWords(l, o);
    expect(words.subject).toBe(`The ${team.name} want to move up to No. ${mine.overall}`);
    expect(words.body).toContain(`No. ${theirs[0].overall}`);
    expect(words.body).toContain('now');
  });

  it('reads a shop answer about a pick', () => {
    const l = draftDay();
    const { mine, team, theirs } = picksFor(l);
    const o = pickOffer(l, team.id, [theirs[0].id], [mine.id], 'shop');
    expect(offerWords(l, o).subject).toBe(`The ${team.name} answer your call about No. ${mine.overall}`);
  });

  it("reads an ask as that team's price for its pick", () => {
    const l = draftDay();
    const { mine, team, theirs } = picksFor(l);
    const o = pickOffer(l, team.id, [theirs[0].id], [mine.id], 'ask');
    expect(offerWords(l, o).subject).toBe(`The ${team.name}' price for No. ${theirs[0].overall}`);
  });

  it('files no mail for draft offers or asks: they end with the pick', () => {
    const l = draftDay();
    const { mine, team, theirs } = picksFor(l);
    const ids = [
      pickOffer(l, team.id, [theirs[0].id], [mine.id], 'draft'),
      pickOffer(l, team.id, [theirs[1].id], [mine.id], 'ask'),
    ].map((o) => `offer:${o.season}:${o.id}`);
    deliverMail(l);
    expect((l.inbox ?? []).filter((m) => ids.some((id) => m.id.startsWith(id)))).toHaveLength(0);
  });
});

describe('save v60', () => {
  it('fills draft.via from the picks still kept', () => {
    const l = draftDay();
    const { mine, team } = picksFor(l);
    // A drafted pick that came from another team, and one that never moved.
    const used = draftOrder(l)
      .filter((p) => p.ownerId !== l.userTeamId)
      .slice(0, 2);
    const prospects = l.draftClass.map((id) => l.players[id]).slice(0, 2);
    used.forEach((pk, i) => {
      pk.playerId = prospects[i].id;
      prospects[i].teamId = pk.ownerId;
      prospects[i].draft = { season: l.season, round: pk.round, pick: pk.overall!, teamId: pk.ownerId };
    });
    used[0].originalTeamId = team.id === used[0].ownerId ? mine.ownerId : team.id;
    const old = JSON.parse(JSON.stringify(l)) as League;
    old.version = 59;
    const up = migrateLeague(old)!;
    expect(up.version).toBe(60);
    expect(up.players[prospects[0].id].draft!.via).toBe(used[0].originalTeamId);
    expect(up.players[prospects[1].id].draft!.via).toBeUndefined();
  });
});
