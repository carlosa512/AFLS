import { afterEach, describe, expect, it } from 'vitest';
import { MOOD_ACTS, rustKnock } from './disputeRead';
import { createLeague } from './generate';
import { migrateLeague } from './migrate';
import { moraleAdvance } from './morale';
import { activeRoster, isAvailable, rosterList } from './roster';
import type { League, Player } from './types';

afterEach(() => {
  MOOD_ACTS.on = true;
});

/** A league and one of team 0's healthy veterans. */
function base(seed = 'disputes') {
  const l = createLeague({ seed });
  const p = activeRoster(l, 0).find((x) => x.morale && !x.injury && x.contract?.kind === 'veteran')!;
  return { l, p };
}

const holdout = (l: League, p: Player) => {
  p.morale!.dispute = { kind: 'holdOut', cause: 'deal', since: l.moraleAt!, out: true };
};

describe('disputes: the lists and the readers (G4)', () => {
  it('sends a holdout to Did Not Report, off the 53 and unavailable', () => {
    const { l, p } = base();
    holdout(l, p);
    expect(rosterList(p)).toBe('didNotReport');
    expect(activeRoster(l, 0).some((x) => x.id === p.id)).toBe(false);
    expect(isAvailable(p)).toBe(false);
  });

  it('keeps IR ahead of Did Not Report, and a released man unattached', () => {
    const { l, p } = base();
    holdout(l, p);
    p.ir = { season: l.season, week: 1, weeks: 4 };
    expect(rosterList(p)).toBe('injuredReserve');
    delete p.ir;
    p.teamId = null;
    expect(rosterList(p)).toBe('unattached');
  });

  it('reads nothing with the dial off', () => {
    const { l, p } = base();
    holdout(l, p);
    MOOD_ACTS.on = false;
    expect(rosterList(p)).toBe('active');
  });

  it('rusts a man a point his first week back, half the next, then nothing', () => {
    const { l, p } = base();
    p.morale!.rust = { season: l.season, week: 3 };
    const at = (week: number) => ((l.week = week), rustKnock(l, p));
    expect([at(3), at(4), at(5), at(2)]).toEqual([1, 0.5, 0, 0]);
    p.morale!.rust = { season: l.season - 1, week: 3 };
    expect(at(3)).toBe(0);
    p.morale!.rust = { season: l.season, week: 3 };
    MOOD_ACTS.on = false;
    expect(at(3)).toBe(0);
  });
});

describe('save v71', () => {
  it('upgrades a v70 save with talks open and steps it without starting anything', () => {
    const { l, p } = base('v71');
    const clock = l.moraleAt!;
    p.morale!.talk = {
      club: p.teamId!,
      answered: { reply: 'firm', at: clock, ask: clock },
      promise: { kind: 'deal', made: clock, due: clock + 20 },
    };
    l.version = 70;
    const up = migrateLeague(l)!;
    expect(up.version).toBe(71);
    expect(() => moraleAdvance(up, clock + 1)).not.toThrow();
    expect(Object.values(up.players).some((x) => x.morale?.dispute)).toBe(false);
  });
});
