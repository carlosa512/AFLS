import { describe, expect, it } from 'vitest';
import { capFor, capSpace } from '../finance/cap';
import { yearsLeft } from '../finance/contract';
import { createLeague } from '../generate';
import { simToEndOfSeason } from '../league';
import { beginOffseason } from '../offseason';
import { applyFranchiseTag } from '../offseason/ai';
import { willExtend } from '../offseason/negotiation';
import { playerOvr, STARTERS } from '../positions';
import { activeRoster } from '../roster';
import type { League, Player, Team } from '../types';
import { executeTrade, judge, marketValue, tradeBlock, tradeContext } from '.';
import { tradeDeadMoney, type TradeProposal } from './rules';
import { readPlayer } from './value';

const base = (() => {
  const l = createLeague({ seed: 'extend' });
  simToEndOfSeason(l);
  beginOffseason(l);
  return JSON.stringify(l);
})();
const fresh = (): League => JSON.parse(base);

/** A starter with a year left, and a team with room he'd start for and would sign with. */
function arrival(l: League): { p: Player; buyer: Team } {
  const starts = (t: Team, p: Player) => {
    const room = activeRoster(l, t.id).filter((x) => x.position === p.position).map(playerOvr).sort((a, b) => b - a);
    return playerOvr(p) >= (room[STARTERS[p.position] - 1] ?? 0);
  };
  const ai = l.teams.filter((t) => t.id !== l.userTeamId);
  for (const p of Object.values(l.players).filter((x) => x.teamId !== null && x.teamId !== l.userTeamId && x.contract && yearsLeft(x.contract, l.season) === 1 && x.contract.kind !== 'rookie' && !x.injury)) {
    const buyer = ai.find((t) => t.id !== p.teamId && capSpace(l, t.id) > 0.15 * l.caps[l.season] && starts(t, p) && willExtend(l, p, t.id));
    if (buyer) return { p, buyer };
  }
  throw new Error('no arrival found');
}

describe('trade and extend', { timeout: 30_000 }, () => {
  it('prices a willing player higher for his buyer, but not what the league would pay', () => {
    const l = fresh();
    const { p, buyer } = arrival(l);
    const ctx = tradeContext(l);
    expect(readPlayer(ctx, buyer, p).extension).toBeGreaterThan(0);
    // His own team re-signs him through the window: no extension in its read.
    expect(readPlayer(ctx, l.teams[p.teamId!], p).extension).toBe(0);
    const before = marketValue(ctx, l.teams[p.teamId!], p);
    l.phase = 'regular';
    expect(willExtend(l, p, buyer.id)).toBe(false);
    l.phase = 'resign';
    expect(marketValue(tradeContext(l), l.teams[p.teamId!], p)).toBeCloseTo(before, 6);
  });

  it('extends him on arrival when his ask fits, keeping the deal he was traded on', () => {
    const l = fresh();
    const { p, buyer } = arrival(l);
    const was = p.contract!;
    const pick = l.draftPicks.find((x) => x.ownerId === buyer.id && x.playerId === undefined)!;
    const record = executeTrade(l, { sides: [{ teamId: p.teamId!, players: [p.id], picks: [] }, { teamId: buyer.id, players: [], picks: [pick.id] }] }, { kind: 'sale' });
    expect(record.extended).toEqual([{ playerId: p.id, tradedOn: was }]);
    expect(yearsLeft(l.players[p.id].contract!, l.season)).toBeGreaterThan(1);
  });

  it('never extends a player for you', () => {
    const l = fresh();
    const { p } = arrival(l);
    const pick = l.draftPicks.find((x) => x.ownerId === l.userTeamId && x.playerId === undefined)!;
    const record = executeTrade(l, { sides: [{ teamId: p.teamId!, players: [p.id], picks: [] }, { teamId: l.userTeamId, players: [], picks: [pick.id] }] }, { kind: 'user' });
    expect(record.extended).toBeUndefined();
  });
});

describe('tag and trade', { timeout: 30_000 }, () => {
  it('puts a seller’s tagged star on the block in the offseason', () => {
    const l = fresh();
    const seller = l.teams.find((t) => t.id !== l.userTeamId && (t.stance?.mode === 'rebuild' || t.stance?.mode === 'retool'))!;
    const star = activeRoster(l, seller.id).filter((p) => p.contract).sort((a, b) => playerOvr(b) - playerOvr(a))[0];
    seller.taggedId = null;
    applyFranchiseTag(l, star);
    const entry = tradeBlock(tradeContext(l), seller).find((e) => e.playerId === star.id);
    expect(entry?.reason).toBe('tagged');
  });
});

describe('dead money in the re-sign window', { timeout: 30_000 }, () => {
  it('counts the void years about to land when free agency opens', () => {
    const l = fresh();
    const team = l.teams.find((t) => t.id !== l.userTeamId)!;
    const seller = activeRoster(l, team.id).find((p) => p.contract && yearsLeft(p.contract, l.season) >= 2)!;
    seller.contract!.bonuses.push({ amount: 8000, start: l.season, years: 2, source: 'signing' });
    const dead = tradeDeadMoney(l, { teamId: team.id, players: [seller.id], picks: [] }).thisYear;
    // A hair under a quarter of the cap with the sale...
    team.deadMoney = [{ season: l.season, amount: Math.round(0.25 * capFor(l, l.season) - dead - 1000), note: 'Released', playerId: seller.id }];
    const buyer = l.teams.find((t) => t.id !== team.id && t.id !== l.userTeamId)!;
    const pick = l.draftPicks.find((x) => x.ownerId === buyer.id && x.playerId === undefined)!;
    const deal: TradeProposal = { sides: [{ teamId: team.id, players: [seller.id], picks: [] }, { teamId: buyer.id, players: [], picks: [pick.id] }] };
    expect(judge(tradeContext(l), team.id, deal).refusal ?? '').not.toMatch(/dead money/);
    // ...and over it once a deal that ran out drops its void years on the books.
    const gone = activeRoster(l, team.id).find((p) => p.id !== seller.id)!;
    gone.contract = { ...gone.contract!, years: [{ season: l.season, base: 0, guaranteed: 0, void: true }], bonuses: [{ amount: 4000, start: l.season - 1, years: 2, source: 'signing' }] };
    expect(judge(tradeContext(l), team.id, deal).refusal).toMatch(/dead money/);
  });
});
