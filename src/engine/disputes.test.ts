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

const { disputeStep, disputeKind, RUN_STEPS } = await import('./disputes');
const { moraleContext, moraleFactors } = await import('./morale');
const { yearsLeft } = await import('./finance/contract');
const { answerTalk } = await import('./playerTalks');

const YEAR = 32;

/**
 * A man on team `teamId` whose contract is his biggest grievance, with two years or fewer left and past his rookie
 * deal, sitting at Very poor with a soured deal talk `run` steps old.
 */
function souredDeal(l: League, teamId = 1, run = RUN_STEPS - 1, nth = 0): Player {
  const ctx = moraleContext(l);
  const p = activeRoster(l, teamId)
    .filter(
      (x) =>
        x.morale &&
        !x.injury &&
        x.contract &&
        x.contract.kind !== 'rookie' &&
        yearsLeft(x.contract, l.season) <= 2 &&
        yearsLeft(x.contract, l.season) >= 1,
    )
    .map((x) => ({ x, f: moraleFactors(l, x, ctx) }))
    .filter(({ f }) => f.contract < -0.75 && f.contract <= Math.min(f.role, f.team, f.room, f.rest))
    .sort((a, b) => a.f.contract - b.f.contract)[nth].x;
  p.morale = { level: -5, talk: { club: teamId, sour: { cause: 'deal', at: l.season * YEAR - 10, run } } };
  return p;
}

/** Morale's clock at a week of this league year. */
const at = (l: League, week: number) => l.season * YEAR + week;

describe('disputes: who escalates (G4)', () => {
  it('sours a talk answered firm or left unanswered, and a reassurance clears it', () => {
    const { l } = base('sour');
    const p = activeRoster(l, l.userTeamId).find((x) => x.morale)!;
    p.morale!.talk = { club: l.userTeamId, ask: { cause: 'deal', at: l.moraleAt! } };
    answerTalk(l, p.id, 'firm');
    expect(p.morale!.talk!.sour).toEqual({ cause: 'deal', at: l.moraleAt, run: 0 });
    p.morale!.talk!.ask = { cause: 'deal', at: l.moraleAt! };
    answerTalk(l, p.id, 'reassure');
    expect(p.morale!.talk!.sour).toBeUndefined();
  });

  it('starts a hold-in on the fourth Very poor step since, and a better step resets the count', () => {
    const { l } = base('start');
    const p = souredDeal(l);
    p.personality.greed = 0.2;
    disputeStep(l, moraleContext(l), at(l, 0), 0, false);
    expect(p.morale!.dispute).toMatchObject({ kind: 'holdIn', cause: 'deal', since: at(l, 0) });
    expect(p.morale!.talk!.sour).toBeUndefined();

    const q = souredDeal(l, 2);
    q.morale!.level = -1;
    disputeStep(l, moraleContext(l), at(l, 1), 1, false);
    expect(q.morale!.dispute).toBeUndefined();
    expect(q.morale!.talk!.sour!.run).toBe(0);
  });

  it('starts a contract dispute only in the re-sign window to camp', () => {
    const { l } = base('window');
    const p = souredDeal(l);
    disputeStep(l, moraleContext(l), at(l, 9), 9, false);
    expect(p.morale!.dispute).toBeUndefined();
    expect(p.morale!.talk!.sour!.run).toBe(RUN_STEPS);
    disputeStep(l, moraleContext(l), at(l, 7), 7, false);
    expect(p.morale!.dispute?.kind).toBeDefined();
  });

  it('needs a deal he can be extended out of', () => {
    const { l } = base('extend');
    const p = souredDeal(l);
    p.contract!.years.push({ ...p.contract!.years.at(-1)!, season: p.contract!.years.at(-1)!.season + 1 });
    p.contract!.years.push({ ...p.contract!.years.at(-1)!, season: p.contract!.years.at(-1)!.season + 1 });
    disputeStep(l, moraleContext(l), at(l, 0), 0, false);
    expect(p.morale!.dispute).toBeUndefined();
  });

  it('makes a greedy veteran starter a holdout, everyone else a hold-in', async () => {
    const { l } = base('kind');
    const p = souredDeal(l);
    const ctx = moraleContext(l);
    p.personality.greed = 0.6;
    const { expectedRole } = await import('./morale');
    expect(disputeKind(l, p, ctx)).toBe(expectedRole(p, ctx) === 2 ? 'holdOut' : 'holdIn');
    p.personality.greed = 0.59;
    expect(disputeKind(l, p, ctx)).toBe('holdIn');
    // A rookie deal before its option year: a hold-in, however greedy.
    p.personality.greed = 0.9;
    p.contract!.kind = 'rookie';
    expect(disputeKind(l, p, ctx)).toBe('holdIn');
  });

  it('starts one a club a step, the unhappiest first, and none for a hurt man', () => {
    const { l } = base('one-a-club');
    const a = souredDeal(l, 3, RUN_STEPS - 1, 0);
    const b = souredDeal(l, 3, RUN_STEPS - 1, 1);
    b.morale!.level = -7;
    disputeStep(l, moraleContext(l), at(l, 0), 0, false);
    expect(b.morale!.dispute).toBeDefined();
    expect(a.morale!.dispute).toBeUndefined();
    const c = souredDeal(l, 4);
    c.injury = { weeksRemaining: 3 } as unknown as Player['injury'];
    disputeStep(l, moraleContext(l), at(l, 1), 1, false);
    expect(c.morale!.dispute).toBeUndefined();
  });

  it('starts nothing with the dial off', () => {
    const { l } = base('off');
    const p = souredDeal(l);
    MOOD_ACTS.on = false;
    disputeStep(l, moraleContext(l), at(l, 0), 0, false);
    expect(p.morale!.dispute).toBeUndefined();
  });
});
