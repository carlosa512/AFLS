import { beforeAll, describe, expect, it } from 'vitest';
import { createLeague } from '../generate';
import { simToEndOfSeason } from '../league';
import { Rng } from '../rng';
import { quirkWorth, viewCache } from '../scouting';
import { teamOutlook } from '../outlook';
import type { League } from '../types';
import { depthOutlooks, needGain, upgradeBar, winNow } from './ai';
import { beginOffseason } from './index';
import { capPlan, stanceFor, STANCE_BANK, STANCE_SPEND, worthIt } from './capPlan';

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
            plan.targets,
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
