import { describe, expect, it } from 'vitest';
import { createLeague } from '../generate';
import { simToEndOfSeason } from '../league';
import { beginOffseason } from '../offseason';
import { cutChoice } from '../offseason/ai';
import { ROSTER_MAX } from '../offseason/negotiation';
import { playerOvr } from '../positions';
import { activeRoster } from '../roster';
import type { League } from '../types';
import { judge, tradeContext } from '.';
import { pickSwapFor } from './deals';
import type { TradeProposal } from './rules';
import { nextDraftSeason } from './value';

const base = JSON.stringify(createLeague({ seed: 'cuts' }));
const fresh = (): League => JSON.parse(base);
const latePick = (l: League, teamId: number) => l.draftPicks.filter((p) => p.ownerId === teamId && p.round === 7).sort((a, b) => b.season - a.season)[0];

describe('trades before a cut', () => {
  it('takes a 7th for a player it is cutting anyway, which it would not for one it keeps', () => {
    const l = fresh();
    l.phase = 'preseason';
    // A depth player of team 9's: the one it would let go first.
    const p = cutChoice(l, activeRoster(l, 9), ROSTER_MAX - 1)[0];
    const deal: TradeProposal = { sides: [{ teamId: 9, players: [p.id], picks: [] }, { teamId: 4, players: [], picks: [latePick(l, 4).id] }] };
    const ctx = tradeContext(l);
    const against = judge(ctx, 9, deal, { rosterCuts: true, releasing: true });
    expect(against.accepts).toBe(true);
    // Nothing back is no deal, even for a player he's letting go.
    const nothing: TradeProposal = { sides: [deal.sides[0], { teamId: 4, players: [], picks: [] }] };
    expect(judge(ctx, 9, nothing, { rosterCuts: true, releasing: true }).get).toBe(0);
  });

  it('charges a roster spot only for the cuts a deal adds, not for a camp roster over 53', () => {
    const l = fresh();
    l.phase = 'preseason';
    const ctx = tradeContext(l);
    const p = activeRoster(l, 9).find((x) => x.position === 'WR')!;
    const q = activeRoster(l, 4).find((x) => x.position === 'WR')!;
    const swap: TradeProposal = { sides: [{ teamId: 9, players: [p.id], picks: [] }, { teamId: 4, players: [q.id], picks: [] }] };
    const before = judge(ctx, 4, swap, { rosterCuts: true }).get;
    // Twenty more bodies in camp, the weakest another team has (no contracts, so the cap and the rooms don't move,
    // and too weak to change how good the team is): a one-for-one swap forces no extra cut.
    for (const x of activeRoster(l, 2).filter((y) => y.position !== 'WR').sort((a, b) => playerOvr(a) - playerOvr(b)).slice(0, 20)) {
      x.teamId = 4;
      x.contract = null;
    }
    // The old charge was a roster spot (15 points) for every body over 53: 300 here. The extra bodies can still
    // move the team's cap picture a little, and with it how it weighs salary.
    expect(judge(tradeContext(l), 4, swap, { rosterCuts: true }).get).toBeGreaterThan(before - 15);
  });
});

describe('future-for-current pick swaps', { timeout: 30_000 }, () => {
  it("trades a win-now GM's pick next year for this year's a round later, before the draft", () => {
    const l = fresh();
    simToEndOfSeason(l);
    beginOffseason(l);
    for (const t of l.teams) t.gm.futureDiscount = t.id === 1 ? 0.38 : 0.18;
    const ctx = tradeContext(l);
    const deal = pickSwapFor(ctx, l.teams[1], l.teams.filter((t) => t.id !== l.userTeamId));
    expect(deal).not.toBeNull();
    const [mine, theirs] = deal!.proposal.sides.map((s) => l.draftPicks.find((p) => p.id === s.picks[0])!);
    expect(mine.season).toBe(nextDraftSeason(l) + 1);
    expect(theirs.season).toBe(nextDraftSeason(l));
    expect(theirs.round).toBe(mine.round + 1);
    // In season nobody swaps like this.
    l.phase = 'regular';
    expect(pickSwapFor(tradeContext(l), l.teams[1], l.teams)).toBeNull();
  });
});
