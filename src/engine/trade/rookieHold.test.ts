/**
 * No club trades a first- or second-round pick in his rookie season (`freshPick`): it drafted him to play, his
 * signing bonus would land on its cap as dead money, and the NFL's young first-rounders who were traded went a year
 * on at the soonest. An AI club keeps him off its block, out of swaps and off the phone; your own are yours to move.
 */
import { describe, expect, it } from 'vitest';
import { createLeague } from '../generate';
import { teamPlayers } from '../roster';
import type { League, Player } from '../types';
import { tradeContext } from './context';
import { judge } from './judge';
import { askPrice } from './offers';
import { tradeBlock, untouchables } from './plans';
import { freshPick } from './rules';

const base = JSON.stringify(createLeague({ seed: 'rookie-hold' }));
const fresh = (): League => JSON.parse(base);
const AI = 9;
const AI2 = 10;

const drafted = (l: League, p: Player, round: number, season = l.season) =>
  (p.draft = { season, round, pick: (round - 1) * 32 + 6, teamId: p.teamId! });
const secondPick = (l: League, teamId: number) =>
  l.draftPicks.filter((pk) => pk.ownerId === teamId && pk.round === 2).map((pk) => pk.id);

describe('a high pick in his rookie season', () => {
  it('is a first- or second-round pick of this league year, and no one else', () => {
    const l = fresh();
    const p = teamPlayers(l, AI)[0];
    drafted(l, p, 1);
    expect(freshPick(l, p)).toBe(true);
    drafted(l, p, 2);
    expect(freshPick(l, p)).toBe(true);
    drafted(l, p, 3);
    expect(freshPick(l, p)).toBe(false);
    drafted(l, p, 1, l.season - 1);
    expect(freshPick(l, p)).toBe(false);
    delete p.draft;
    expect(freshPick(l, p)).toBe(false);
  });

  it('is untouchable at an AI club: off its block, and it won’t discuss him', () => {
    const l = fresh();
    const team = l.teams[AI];
    team.stance = { ...(team.stance ?? ({} as never)), mode: 'rebuild' } as never;
    team.gm.loyalty = 0;
    const p = teamPlayers(l, AI).find((x) => x.position === 'S')!;
    drafted(l, p, 1);
    const ctx = tradeContext(l);
    expect(untouchables(ctx, team).has(p.id)).toBe(true);
    expect(tradeBlock(ctx, team).some((e) => e.playerId === p.id)).toBe(false);
    expect(askPrice(l, p.id)).toMatchObject({
      proposal: null,
      message: `The ${team.name} won't discuss ${p.firstName} ${p.lastName}.`,
    });
  });

  it('is refused whatever the price, by the club that has him and only by it', () => {
    const l = fresh();
    const p = teamPlayers(l, AI).find((x) => x.position === 'S')!;
    drafted(l, p, 1);
    const ctx = tradeContext(l);
    const proposal = {
      sides: [
        { teamId: AI2, players: [], picks: secondPick(l, AI2) },
        { teamId: AI, players: [p.id], picks: [] },
      ],
    } as const;
    const seller = judge(ctx, AI, { sides: [...proposal.sides] as never });
    expect(seller.accepts).toBe(false);
    expect(seller.refusal).toBe(`They won't trade ${p.firstName} ${p.lastName} in his rookie season.`);
    // The buyer has nothing against taking him.
    expect(judge(ctx, AI2, { sides: [...proposal.sides] as never }).refusal).toBeNull();
  });

  it('is yours to trade at your own club', () => {
    const l = fresh();
    const user = l.teams[l.userTeamId];
    const p = teamPlayers(l, user.id)[0];
    drafted(l, p, 1);
    expect(untouchables(tradeContext(l), user).has(p.id)).toBe(false);
  });
});
