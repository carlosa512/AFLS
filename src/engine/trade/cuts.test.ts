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
import { dumpFor, pickSwapFor } from './deals';
import { initiate } from './market';
import { tradeBlock } from './plans';
import type { TradeProposal } from './rules';
import { nextDraftSeason, salaryWeight } from './value';

const base = JSON.stringify(createLeague({ seed: 'cuts' }));
const fresh = (): League => JSON.parse(base);
const latePick = (l: League, teamId: number) =>
  l.draftPicks.filter((p) => p.ownerId === teamId && p.round === 7).sort((a, b) => b.season - a.season)[0];

describe('trades before a cut', () => {
  it('takes a 7th for a player it is cutting anyway, which it would not for one it keeps', () => {
    const l = fresh();
    l.phase = 'preseason';
    // A depth player of team 9's: the one it would let go first.
    const p = cutChoice(l, activeRoster(l, 9), ROSTER_MAX - 1)[0];
    const deal: TradeProposal = {
      sides: [
        { teamId: 9, players: [p.id], picks: [] },
        { teamId: 4, players: [], picks: [latePick(l, 4).id] },
      ],
    };
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
    const swap: TradeProposal = {
      sides: [
        { teamId: 9, players: [p.id], picks: [] },
        { teamId: 4, players: [q.id], picks: [] },
      ],
    };
    const before = judge(ctx, 4, swap, { rosterCuts: true }).get;
    // Twenty more bodies in camp, the weakest another team has (no contracts, so the cap and the rooms don't move,
    // and too weak to change how good the team is): a one-for-one swap forces no extra cut.
    for (const x of activeRoster(l, 2)
      .filter((y) => y.position !== 'WR')
      .sort((a, b) => playerOvr(a) - playerOvr(b))
      .slice(0, 20)) {
      x.teamId = 4;
      x.contract = null;
    }
    // The old charge was a roster spot (15 points) for every body over 53: 300 here. The extra bodies can still
    // move the team's cap picture a little, and with it how it weighs salary.
    expect(judge(tradeContext(l), 4, swap, { rosterCuts: true }).get).toBeGreaterThan(before - 15);
  });
});

describe('future-for-current pick swaps', () => {
  it("trades a win-now GM's pick next year for this year's a round later, before the draft", () => {
    const l = fresh();
    simToEndOfSeason(l);
    beginOffseason(l);
    for (const t of l.teams) t.gm.futureDiscount = t.id === 1 ? 0.38 : 0.18;
    const ctx = tradeContext(l);
    const deal = pickSwapFor(
      ctx,
      l.teams[1],
      l.teams.filter((t) => t.id !== l.userTeamId),
    );
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

describe('league-year dumps', () => {
  it('has a squeezed team clear its bad contract before it shops', { timeout: 300_000 }, () => {
    // A team truly squeezed moves a bad contract when the league year opens, before the money's guaranteed: its
    // call goes to the dump first, not to the buy or sale it would otherwise make.
    let calls = 0;
    for (const seed of ['trades-0', 'trades-1', 'trades-2']) {
      const l = createLeague({ seed });
      simToEndOfSeason(l);
      beginOffseason(l);
      const ctx = tradeContext(l);
      const market = l.market!;
      const ai = l.teams.filter((t) => t.id !== l.userTeamId);
      const listings = ai.flatMap((t) => tradeBlock(ctx, t).map((entry) => ({ team: t, entry })));
      for (const team of ai) {
        if (salaryWeight(ctx, team.id) < 1.6) continue;
        if (market.history.some((r) => r.kind === 'dump' && r.season === l.season && r.sides[0].teamId === team.id))
          continue;
        const others = ai.filter((t) => t.id !== team.id);
        const dumpable = tradeBlock(ctx, team)
          .filter((e) => e.reason === 'overpaid')
          .slice(0, 2)
          .some((e) => dumpFor(ctx, team, l.players[e.playerId], others));
        if (!dumpable) continue;
        const deal = initiate(ctx, market, team, 'leagueYear', listings, () => true);
        calls++;
        expect(deal?.kind, `${seed} ${team.abbrev}`).toBe('dump');
      }
    }
    expect(calls, 'squeezed teams with a contract another would take').toBeGreaterThan(0);
  });
});
