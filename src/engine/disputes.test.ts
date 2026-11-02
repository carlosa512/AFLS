import { afterEach, describe, expect, it } from 'vitest';
import { MOOD_ACTS, rustKnock } from './disputeRead';
import { createLeague } from './generate';
import { migrateLeague } from './migrate';
import { moraleAdvance } from './morale';
import { activeRoster, isAvailable, rosterList, setTeam } from './roster';
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
  p.morale!.dispute = { kind: 'holdOut', cause: 'deal', since: l.moraleAt!, out: true, club: p.teamId! };
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

describe('save v77', () => {
  it('upgrades a v76 save with talks open and steps it without starting anything', () => {
    const { l, p } = base('v77');
    const clock = l.moraleAt!;
    p.morale!.talk = {
      club: p.teamId!,
      answered: { reply: 'firm', at: clock, ask: clock },
      promise: { kind: 'deal', made: clock, due: clock + 20 },
    };
    l.version = 76;
    const up = migrateLeague(l)!;
    expect(up.version).toBe(77);
    expect(() => moraleAdvance(up, clock + 1)).not.toThrow();
    expect(Object.values(up.players).some((x) => x.morale?.dispute)).toBe(false);
  });
});

const { disputeStep, disputeKind, RUN_STEPS } = await import('./disputes');
const { moraleContext, moraleFactors } = await import('./morale');
const { yearsLeft } = await import('./finance/contract');
const { marketApy } = await import('./finance/market');
const { answerTalk } = await import('./playerTalks');

const YEAR = 32;

/**
 * A man on team `teamId` whose contract is his biggest grievance, with two years or fewer left and past his rookie
 * deal, sitting at Very poor with a soured deal talk `run` steps old.
 */
function souredDeal(l: League, teamId = 1, run = RUN_STEPS - 1, nth = 0): Player {
  const ctx = moraleContext(l);
  // The grievance is made, not found: how many men a world leaves this underpaid moves with every change to pay or
  // moods (fewer sulkers left a club with none). Paid half his market and minding money, a starter's deal is his worst.
  const underpaid = (x: Player) => {
    const was = { apy: x.contract!.apy, greed: x.personality.greed };
    x.contract!.apy = Math.round(0.5 * marketApy(ctx.market, x));
    x.personality.greed = 1;
    const f = moraleFactors(l, x, ctx);
    if (f.contract < -0.75 && f.contract <= Math.min(f.role, f.team, f.room, f.rest)) return true;
    Object.assign(x.personality, { greed: was.greed });
    x.contract!.apy = was.apy;
    return false;
  };
  const p = activeRoster(l, teamId)
    .filter(
      (x) =>
        x.morale &&
        !x.injury &&
        x.contract &&
        x.contract.kind !== 'rookie' &&
        yearsLeft(x.contract, l.season) <= 2 &&
        yearsLeft(x.contract, l.season) >= 1 &&
        !x.morale.talk?.sour,
    )
    .filter(underpaid)[nth];
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

const { CAMP_FINE, giveInLimit } = await import('./disputes');
const { capHit, yearOf } = await import('./finance/contract');
const { serviceSeasons, creditService } = await import('./personnel/service');

/** A holdout started at the re-sign window on team `teamId`, his base set to `base` ($K). */
function holdingOut(l: League, teamId = 1, base = 20_000): Player {
  const p = souredDeal(l, teamId);
  p.personality = { ...p.personality, greed: 1, patience: 0 };
  yearOf(p.contract!, l.season)!.base = base;
  p.morale!.dispute = { kind: 'holdOut', cause: 'deal', since: at(l, 0), club: teamId };
  delete p.morale!.talk!.sour;
  return p;
}

/** Runs dispute steps from week `from` to week `to` of this league year. */
function run(l: League, from: number, to: number) {
  for (let w = from; w <= to; w++) {
    l.moraleAt = at(l, w);
    disputeStep(l, moraleContext(l), at(l, w), w, false);
  }
}

describe('disputes: a holdout runs and ends (G4)', () => {
  it("sends a holdout to Did Not Report at camp's step", () => {
    const { l } = base('camp');
    const p = holdingOut(l);
    run(l, 1, 6);
    expect(p.morale!.dispute!.out).toBeUndefined();
    run(l, 7, 7);
    expect(p.morale!.dispute!.out).toBe(true);
    expect(rosterList(p)).toBe('didNotReport');
  });

  it('fines a holdout still out when camp ends and costs him the accrued season', () => {
    const { l } = base('fine');
    const p = holdingOut(l);
    run(l, 7, 8);
    expect(p.morale!.dispute).toMatchObject({ fined: CAMP_FINE, lost: CAMP_FINE });
    expect(CAMP_FINE).toBe(2250);
    expect(p.lostAccrual).toBe(l.season);
    for (let w = 1; w <= 8; w++) creditService(p, l.season, w);
    expect(serviceSeasons(p, l.season + 1)).toBe(serviceSeasons(p, l.season));
  });

  it("withholds a game check each regular-season week he's out and credits his club's cap", () => {
    const { l } = base('checks');
    const p = holdingOut(l);
    const before = capHit(p.contract!, l.season);
    run(l, 7, 11);
    expect(yearOf(p.contract!, l.season)!.withheld).toBe(3);
    expect(capHit(p.contract!, l.season)).toBe(before - Math.round((20_000 * 3) / 18));
    expect(p.morale!.dispute!.lost).toBe(CAMP_FINE + 3 * Math.round(20_000 / 18));
  });

  it('gives in at his limit, reports with rust, and sours the talk', () => {
    const { l } = base('give-in');
    const calm = holdingOut(l, 1, 5_000);
    calm.personality = { ...calm.personality, greed: 0, patience: 1 };
    const star = holdingOut(l, 2, 20_000);
    expect(giveInLimit(l, star)).toBe(10_000);
    run(l, 7, 8);
    expect(calm.morale!.dispute).toBeUndefined();
    expect(calm.morale!.disputeEnd).toMatchObject({ how: 'gaveIn', kind: 'holdOut' });
    expect(calm.morale!.rust).toEqual({ season: l.season, week: 1 });
    expect(calm.morale!.jolts?.some((j) => j.kind === 'gaveIn')).toBe(true);
    expect(calm.morale!.talk!.sour).toMatchObject({ cause: 'deal', after: 'holdOut' });
    run(l, 9, 26);
    expect(star.morale!.disputeEnd?.how).toBe('gaveIn');
    // $2.25M of fines, then $1.11M a week: past $10M after his seventh game check.
    expect(star.morale!.rust).toEqual({ season: l.season, week: 8 });
  });

  it('ends a hold-in at week 1: he plays, with rust, and the talk sours', () => {
    const { l } = base('week1');
    const p = souredDeal(l);
    p.morale!.dispute = { kind: 'holdIn', cause: 'deal', since: at(l, 2), club: 1 };
    delete p.morale!.talk!.sour;
    run(l, 7, 8);
    expect(p.morale!.dispute).toBeUndefined();
    expect(p.morale!.disputeEnd?.how).toBe('week1');
    expect(p.morale!.rust).toEqual({ season: l.season, week: 1 });
    expect(p.morale!.talk!.sour).toMatchObject({ after: 'holdIn' });
  });

  it('ends on a raise, a trade or a release', () => {
    const { l } = base('ends');
    const a = holdingOut(l, 1);
    const b = holdingOut(l, 2);
    const c = holdingOut(l, 3);
    run(l, 7, 9);
    a.morale!.jolts = [{ kind: 'paid', size: 3, at: at(l, 10) }];
    setTeam(l, b, 5);
    setTeam(l, c, null);
    run(l, 10, 10);
    expect(a.morale!.disputeEnd?.how).toBe('signed');
    expect(b.morale!.disputeEnd?.how).toBe('traded');
    expect(rosterList(b)).toBe('active');
    expect(c.morale!.disputeEnd?.how).toBe('released');
    expect([a, b, c].every((x) => !x.morale!.dispute)).toBe(true);
  });

  it('ends a holdout still out at the new league year', () => {
    const { l } = base('new-year');
    const p = holdingOut(l);
    p.morale!.dispute!.since = at(l, 0) - 20;
    l.moraleAt = at(l, 0);
    disputeStep(l, moraleContext(l), at(l, 0), 0, true);
    expect(p.morale!.disputeEnd?.how).toBe('newYear');
  });
});
