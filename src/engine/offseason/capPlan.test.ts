import { beforeAll, describe, expect, it } from 'vitest';
import { createLeague } from '../generate';
import { simToEndOfSeason } from '../league';
import { Rng } from '../rng';
import { quirkWorth, viewCache } from '../scouting';
import { teamOutlook } from '../outlook';
import type { League } from '../types';
import {
  aiFifthYearOptions,
  aiResignWindow,
  depthOutlooks,
  expiringPlayers,
  makeRoomFor,
  needGain,
  spendable,
  upgradeBar,
  winNow,
} from './ai';
import { advanceOffseason, beginOffseason } from './index';
import { isExpired } from '../finance/contract';
import { demand, offerValue } from './negotiation';
import { MOOD_ACTS, promisedDeal } from '../disputeRead';
import { playerOvr } from '../positions';
import { teamPlayers } from '../roster';
import { capPlan, gambles, stanceFor, STANCE_BANK, STANCE_SPEND, worthIt } from './capPlan';

let window: League;
beforeAll(() => {
  window = createLeague({ seed: 'cap-plan', personnel: true });
  simToEndOfSeason(window);
  beginOffseason(window);
});
const fresh = () => structuredClone(window);

describe('the cap plan', () => {
  it('keepers come best first by the club’s outlook', () => {
    const l = fresh();
    for (const team of l.teams) {
      const { keepers } = capPlan(l, team, new Rng(`k${team.id}`));
      const ahead = keepers.map((k) => k.ahead);
      expect(ahead).toEqual([...ahead].sort((a, b) => b - a));
    }
  });

  it('stance follows winNow: 0.7 spends, 0.5 balances, 0.2 banks', () => {
    expect(stanceFor(0.7)).toBe('spend');
    expect(stanceFor(0.5)).toBe('balance');
    expect(stanceFor(0.2)).toBe('bank');
    expect(stanceFor(STANCE_SPEND)).toBe('spend');
    expect(stanceFor(STANCE_BANK)).toBe('balance');
  });

  it('a keeper whose gain doesn’t clear the bar his price sets is not worth it', () => {
    expect(worthIt({ gain: 0.5, apy: 10_000, position: 'WR' }, 1, [], 50_000)).toBe(false);
    expect(worthIt({ gain: 2, apy: 10_000, position: 'WR' }, 1, [], 50_000)).toBe(true);
  });

  it('a cheaper target at his position that buys more gain makes a keeper not worth it', () => {
    const keeper = { gain: 2, apy: 10_000, position: 'WR' as const };
    const target = (position: 'WR' | 'CB', price: number) => ({ player: { position } as never, gain: 2, price });
    expect(worthIt(keeper, 1, [target('WR', 5_000)], 50_000)).toBe(false);
    // Out of reach, or at another position, a target changes nothing.
    expect(worthIt(keeper, 1, [target('WR', 5_000)], 4_000)).toBe(true);
    expect(worthIt(keeper, 1, [target('CB', 5_000)], 50_000)).toBe(true);
  });

  it('every keeper is judged by that rule at his own offer', () => {
    const l = fresh();
    for (const team of l.teams.slice(0, 8)) {
      const plan = capPlan(l, team, new Rng(`w${team.id}`));
      for (const k of plan.keepers)
        expect(k.worth).toBe(
          worthIt(
            { gain: k.gain, apy: k.offer.apy, position: k.player.position },
            upgradeBar(l, team, k.offer.apy),
            k.reason === 'starter' && !gambles(l, team) ? [] : plan.targets,
            plan.room,
          ),
        );
    }
  });

  it('targets are read through the club’s own scouts', () => {
    const l = fresh();
    const read = viewCache(l);
    for (const team of l.teams.slice(0, 8)) {
      const depth = depthOutlooks(l, team);
      const wn = winNow(l, team);
      for (const t of capPlan(l, team, new Rng('t')).targets) {
        expect(t.player.teamId).not.toBe(team.id);
        const ahead = teamOutlook(l, team.id, t.player, wn, read(team.id, t.player));
        expect(t.gain).toBeCloseTo(needGain(depth, t.player, ahead + quirkWorth(l, team.id, t.player)));
      }
    }
  });

  it('a JSON-reloaded league plans the same', () => {
    const a = fresh();
    const b = JSON.parse(JSON.stringify(a)) as League;
    for (const id of [0, 9, 21]) {
      const pa = capPlan(a, a.teams[id], new Rng('same'));
      const pb = capPlan(b, b.teams[id], new Rng('same'));
      expect(pb.keepers.map((k) => [k.player.id, k.worth, k.offer.apy])).toEqual(
        pa.keepers.map((k) => [k.player.id, k.worth, k.offer.apy]),
      );
      expect(pb.faRoom).toBeCloseTo(pa.faRoom);
    }
  });
});

describe('the re-sign window in priority', () => {
  /** Every expiring player takes a fair offer and none tests the market: what's left is the club's plan. */
  const settled = () => {
    const l = fresh();
    for (const t of l.teams)
      for (const p of expiringPlayers(l, t.id)) {
        p.personality.loyalty = 1;
        p.personality.greed = 0;
      }
    return l;
  };
  const resigned = (l: League, teamId: number, id: number) =>
    l.players[id].teamId === teamId && !!l.players[id].contract && !isExpired(l.players[id].contract!, l.season);

  it('a keeper not worth his price walks even with room', () => {
    const l = settled();
    let seen = 0;
    for (const team of l.teams.filter((t) => t.id !== l.userTeamId)) {
      team.carryover = l.caps[l.season]; // room for anyone
      aiFifthYearOptions(l, team); // the window's first act: the plan reads the room after it
      const plan = capPlan(structuredClone(l), team, new Rng(`w${team.id}`));
      aiResignWindow(l, team, new Rng(`w${team.id}`));
      // A promised man (G4) signs whatever the plan says: his own test below.
      for (const k of plan.keepers.filter((x) => !x.worth && x.call === 'keep' && !promisedDeal(x.player))) {
        seen++;
        expect(resigned(l, team.id, k.player.id)).toBe(false);
      }
    }
    expect(seen).toBeGreaterThan(0);
  });

  it('with room for one, the better keeper signs before a cheaper one', () => {
    const l = settled();
    for (const team of l.teams.filter((t) => t.id !== l.userTeamId)) {
      aiFifthYearOptions(l, team);
      const plan = capPlan(structuredClone(l), team, new Rng(`p${team.id}`));
      // Only keepers who'd take the club's offer: one who turns it down walks on his own call, not the club's order.
      const takes = new Set(
        plan.keepers
          .filter((k) => offerValue(l, k.player, team.id, k.offer) >= demand(l, k.player, team.id).walkAway)
          .map((k) => k.player.id),
      );
      aiResignWindow(l, team, new Rng(`p${team.id}`));
      const worth = plan.keepers.filter(
        (k) => k.worth && k.call === 'keep' && !promisedDeal(k.player) && takes.has(k.player.id),
      );
      // A better keeper missed while a worse one at least as dear signed would be roster order, not priority.
      for (const [i, a] of worth.entries())
        for (const b of worth.slice(i + 1))
          if (!resigned(l, team.id, a.player.id) && resigned(l, team.id, b.player.id))
            expect(b.cost).toBeLessThan(a.cost);
    }
  });

  it('a promised player signs even when the plan says he isn’t worth his price', () => {
    const l = settled();
    MOOD_ACTS.on = true;
    for (const team of l.teams.filter((t) => t.id !== l.userTeamId)) {
      team.carryover = l.caps[l.season];
      const k = capPlan(structuredClone(l), team, new Rng(`g${team.id}`)).keepers.find((x) => !x.worth);
      if (!k) continue;
      const p = l.players[k.player.id];
      p.morale = { ...(p.morale ?? ({} as never)), talk: { club: team.id, promise: { kind: 'deal', made: 0 } } };
      aiResignWindow(l, team, new Rng(`g${team.id}`));
      expect(resigned(l, team.id, p.id)).toBe(true);
      return;
    }
    throw new Error('no club with a keeper not worth his price');
  });

  it('makes the room once for its keepers in order: a cut never better than the keeper it funds', () => {
    const l = settled();
    for (const team of l.teams.filter((t) => t.id !== l.userTeamId)) {
      const plan = capPlan(l, team, new Rng(`m${team.id}`));
      const keepers = plan.keepers.filter((k) => k.worth);
      if (!keepers.length) continue;
      team.carryover -= Math.max(0, spendable(l, team.id)); // squeezed to nothing
      const before = new Set(teamPlayers(l, team.id).map((p) => p.id));
      makeRoomFor(l, team, keepers);
      const cut = [...before].filter((id) => l.players[id].teamId !== team.id).map((id) => l.players[id]);
      for (const c of cut) expect(playerOvr(c)).toBeLessThan(playerOvr(keepers[0].player));
    }
  });

  it('the user’s club re-signs nobody unless the AI runs it', () => {
    const l = settled();
    const mine = expiringPlayers(l, l.userTeamId).map((p) => p.id);
    advanceOffseason(l);
    for (const id of mine) expect(l.players[id].teamId === l.userTeamId && !!l.players[id].contract).toBe(false);
  });
});

describe('GMs make bad calls', () => {
  it('a gambling GM weighs his starters against the market; most GMs don’t', () => {
    const l = fresh();
    const on = l.teams.filter((t) => gambles(l, t)).length;
    expect(on).toBeGreaterThan(0);
    expect(on).toBeLessThan(l.teams.length / 2);
    // The same answer however often it's asked: its own stream.
    expect(l.teams.map((t) => gambles(l, t))).toEqual(l.teams.map((t) => gambles(l, t)));
  });
});
