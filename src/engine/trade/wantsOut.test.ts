/** A public trade request in the market (G4b): his club's block and floor, calls and bids for yours, nothing while private. */
import { describe, expect, it } from 'vitest';
import { createLeague } from '../generate';
import { playerOvr } from '../positions';
import { activeRoster } from '../roster';
import type { League, Player } from '../types';
import { playerTradeBlocker, tradeContext } from '.';
import { quickValue } from './deals';
import { floorShare, WANTS_OUT } from './judge';
import { bidFor, yourListings } from './offers';
import { tradeBlock } from './plans';

const league = (seed = 'wants-out') => createLeague({ seed });

/** A request from `p` to his club, answered `choice`, leaked (`public`) or not. */
function asks(l: League, p: Player, choice: 'shop' | 'refuse', open: boolean) {
  const at = l.moraleAt!;
  p.morale!.dispute = {
    kind: 'trade',
    cause: 'snaps',
    since: at - 6,
    club: p.teamId!,
    answered: { choice, at: at - 6 },
    ...(choice === 'refuse' ? { refused: true as const } : {}),
    ...(open ? { public: at } : {}),
  };
}

/** A tradeable starter-grade man on team `teamId`, the best first. */
const tradeable = (l: League, teamId: number) =>
  activeRoster(l, teamId)
    .filter((p) => p.morale && p.contract && !playerTradeBlocker(l, p) && p.position !== 'K' && p.position !== 'P')
    .sort((a, b) => playerOvr(b) - playerOvr(a));

describe('the market reads a public trade request (G4b)', () => {
  it('an AI club shopping a public requester puts him on its block, keen; refused or private, it does not', () => {
    for (const [choice, open, listed] of [
      ['shop', true, true],
      ['shop', false, false],
      ['refuse', true, false],
    ] as const) {
      const l = league();
      const team = l.teams.find((t) => t.id !== l.userTeamId)!;
      const p = tradeable(l, team.id)[0];
      asks(l, p, choice, open);
      const entry = tradeBlock(tradeContext(l), team).find((e) => e.playerId === p.id && e.reason === 'wantsOut');
      if (listed) expect(entry?.keenness).toBeGreaterThanOrEqual(0.75);
      else expect(entry).toBeUndefined();
    }
  });

  it("his club holds out for 15% less once it's public, from AI clubs and from you; a private request moves nothing", () => {
    const l = league();
    const team = l.teams.find((t) => t.id !== l.userTeamId)!;
    const p = tradeable(l, team.id)[0];
    const before = [floorShare(l, team, p, false), floorShare(l, team, p, true)];
    asks(l, p, 'refuse', false);
    expect([floorShare(l, team, p, false), floorShare(l, team, p, true)]).toEqual(before);
    asks(l, p, 'refuse', true);
    expect(WANTS_OUT).toBe(0.15);
    expect(floorShare(l, team, p, false)).toBeCloseTo(before[0] * (1 - WANTS_OUT));
    expect(floorShare(l, team, p, true)).toBeCloseTo(before[1] * (1 - WANTS_OUT));
  });

  it('your public requester draws calls as if listed, and bids for him open lower; private, nothing changes', () => {
    const plain = league();
    const ctx = tradeContext(plain);
    // Bids some AI club makes for your men as they stand (a buyer at his own most bids the same either way).
    const found: { p: number; buyer: number; value: number }[] = [];
    for (const p of tradeable(plain, plain.userTeamId).slice(0, 16)) {
      const buyer = plain.teams.find((t) => t.id !== plain.userTeamId && bidFor(ctx, t, p));
      if (!buyer) continue;
      found.push({ p: p.id, buyer: buyer.id, value: quickValue(ctx, buyer, bidFor(ctx, buyer, p)!.sides[0]) });
      if (found.length >= 6) break;
    }
    expect(found.length).toBeGreaterThanOrEqual(3);
    const listing = (l: League, id: number) => yourListings(tradeContext(l)).find((x) => x.entry.playerId === id)!;
    const bidValue = (l: League, c: { p: number; buyer: number }) => {
      const x = tradeContext(l);
      const bid = bidFor(x, l.teams[c.buyer], l.players[c.p]);
      return bid ? quickValue(x, l.teams[c.buyer], bid.sides[0]) : 0;
    };
    let lower = 0;
    for (const c of found) {
      expect(listing(plain, c.p).entry.reason).toBe('available');
      const quiet = league();
      asks(quiet, quiet.players[c.p], 'refuse', false);
      expect(listing(quiet, c.p).entry.reason).toBe('available');
      expect(bidValue(quiet, c)).toBe(c.value);
      const loud = league();
      asks(loud, loud.players[c.p], 'refuse', true);
      expect(listing(loud, c.p).entry).toMatchObject({ reason: 'listed', keenness: 0.9 });
      const v = bidValue(loud, c);
      expect(v).toBeLessThanOrEqual(c.value);
      if (v < c.value) lower++;
    }
    expect(lower).toBeGreaterThanOrEqual(1);
  });
});
