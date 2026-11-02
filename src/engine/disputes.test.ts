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

/** A league and one of team 0's healthy veterans; every AI GM holds firm, so a dispute runs (AI answers: below). */
function base(seed = 'disputes') {
  const l = createLeague({ seed });
  for (const t of l.teams) Object.assign(t.gm, { loyalty: 0, stubbornness: 1 });
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
  it('upgrades a v78 save with talks open and steps it without starting anything', () => {
    const { l, p } = base('v77');
    const clock = l.moraleAt!;
    p.morale!.talk = {
      club: p.teamId!,
      answered: { reply: 'firm', at: clock, ask: clock },
      promise: { kind: 'deal', made: clock, due: clock + 20 },
    };
    l.version = 78;
    const up = migrateLeague(l)!;
    expect(up.version).toBe(79);
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
function souredDeal(
  l: League,
  teamId = 1,
  run = RUN_STEPS - 1,
  nth = 0,
  pick: (x: Player) => boolean = () => true,
): Player {
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
        !x.morale.talk?.sour &&
        pick(x),
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

/**
 * A holdout started at the re-sign window on team `teamId`, his base set to `base` ($K). His club has no room for his raise,
 * so it can't settle (below): the dispute runs its course.
 */
function holdingOut(l: League, teamId = 1, base = 20_000): Player {
  room(l, teamId, -400_000);
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
    room(l, 1, -400_000);
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

  it('reports to your full 53 by waiting off it until you make room; an AI club cuts for him', () => {
    const { l } = base('report-full');
    l.phase = 'regular';
    const mine = holdingOut(l, l.userTeamId);
    const theirs = holdingOut(l, 1);
    run(l, 7, 8);
    expect(rosterList(mine)).toBe('didNotReport');
    // Both give in at once: the 53 is full at each club.
    for (const x of [mine, theirs]) x.morale!.dispute!.lost = 10 ** 9;
    while (activeRoster(l, l.userTeamId).length < 53) {
      const extra = activeRoster(l, 2).find((x) => !x.morale?.dispute)!;
      setTeam(l, extra, l.userTeamId);
    }
    run(l, 9, 9);
    expect(mine.morale!.disputeEnd?.how).toBe('gaveIn');
    expect(rosterList(mine)).toBe('didNotReport');
    expect(activeRoster(l, l.userTeamId)).toHaveLength(53);
    expect(rosterList(theirs)).toBe('active');
    expect(activeRoster(l, 1).length).toBeLessThanOrEqual(53);
    // You make room: he's on the 53 the next step.
    setTeam(l, activeRoster(l, l.userTeamId).find((x) => x !== mine)!, null);
    run(l, 10, 10);
    expect(rosterList(mine)).toBe('active');
    expect(activeRoster(l, l.userTeamId)).toHaveLength(53);
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

const { aiSettle, promisedDeal } = await import('./disputes');
const { aiResignWindow, expiringPlayers, resignCall, spendable } = await import('./offseason/ai');
const { simToEndOfSeason } = await import('./league');
const { beginOffseason } = await import('./offseason');
const { isExpired } = await import('./finance/contract');
const { syncDepthChart, teamPlayers } = await import('./roster');
const { playerOvr, STARTERS } = await import('./positions');
const { Rng } = await import('./rng');
const { ageShift } = await import('./aging');

/** Team `teamId`'s GM as `aiReply` reads him: loyal (he negotiates) or stubborn (he holds firm). */
const gm = (l: League, teamId: number, loyal: boolean) =>
  Object.assign(l.teams[teamId].gm, loyal ? { loyalty: 1, stubbornness: 0 } : { loyalty: 0, stubbornness: 1 });
/** Cap room for a club this league year ($K), or none. */
const room = (l: League, teamId: number, amount: number) =>
  l.teams[teamId].deadMoney.push({ season: l.season, amount: -amount, playerId: -1, note: 'test' });

describe('disputes: AI clubs answer (G4)', () => {
  it('a loyal AI GM settles a dispute it can afford, a stubborn one holds firm, and so does one without the room', () => {
    const { l } = base('settle');
    gm(l, 1, true);
    gm(l, 3, true);
    room(l, 1, 60_000);
    room(l, 3, -400_000);
    const keeper = (t: number) => (x: Player) => resignCall(l, t, x).call !== 'walk';
    const a = souredDeal(l, 1, RUN_STEPS - 1, 0, keeper(1));
    const b = souredDeal(l, 2);
    const c = souredDeal(l, 3, RUN_STEPS - 1, 0, keeper(3));
    disputeStep(l, moraleContext(l), at(l, 0), 0, false);
    expect(a.morale!.dispute).toBeUndefined();
    expect(a.morale!.disputeEnd?.how).toBe('signed');
    expect(a.contract!.signedSeason).toBe(l.season);
    expect(b.morale!.dispute?.answered?.choice).toBe('firm');
    expect(c.morale!.dispute?.answered?.choice).toBe('firm');
  });

  it('makes room for a man it would keep when it is short, as for a keeper, and stays under the cap', () => {
    const { l } = base('settle-room');
    // The re-sign window: restructures are an offseason move.
    l.phase = 'resign';
    gm(l, 1, true);
    const a = souredDeal(l, 1, RUN_STEPS - 1, 0, (x) => resignCall(l, 1, x).call !== 'walk');
    // $5M short before his raise (restructures convert $1M or more at a time).
    room(l, 1, -(spendable(l, 1) + 5_000));
    expect(spendable(l, 1)).toBeLessThan(0);
    disputeStep(l, moraleContext(l), at(l, 0), 0, false);
    expect(a.morale!.disputeEnd?.how).toBe('signed');
    expect(spendable(l, 1)).toBeGreaterThanOrEqual(0);
  });

  it('answers nothing with the dial off', () => {
    const { l } = base('settle-off');
    gm(l, 1, true);
    room(l, 1, 60_000);
    const a = souredDeal(l, 1, RUN_STEPS - 1, 0, (x) => resignCall(l, 1, x).call !== 'walk');
    MOOD_ACTS.on = false;
    expect(aiSettle(l, l.teams[1], a)).toBe(false);
    expect(promisedDeal(a)).toBe(false);
  });
});

const { aiReviewDispute } = await import('./disputes');

/**
 * Team `teamId`'s starter holding out (or in) since the re-sign window, answered firm by a GM this stubborn whose club has
 * room for his raise; every other man at his position `gap` points worse on every rating.
 */
function firmHoldout(
  l: League,
  teamId: number,
  stubbornness: number,
  gap: number,
  kind: 'holdIn' | 'holdOut' = 'holdOut',
) {
  Object.assign(l.teams[teamId].gm, { loyalty: 0, stubbornness });
  room(l, teamId, 60_000);
  const p = souredDeal(l, teamId, RUN_STEPS - 1, 0, (x) => resignCall(l, teamId, x).call !== 'walk');
  for (const x of teamPlayers(l, teamId))
    if (x.position === p.position && x !== p)
      x.ratings = Object.fromEntries(
        Object.entries(p.ratings).map(([k, v]) => [k, Math.max(1, v - gap)]),
      ) as typeof p.ratings;
  p.morale!.dispute = {
    kind,
    cause: 'deal',
    since: at(l, 0),
    club: teamId,
    answered: { choice: 'firm', at: at(l, 0) },
  };
  delete p.morale!.talk!.sour;
  return p;
}

/** The step his dispute ended signed in, running steps `from` to `to`; null if it didn't. */
function settledAt(l: League, p: Player, from: number, to: number): number | null {
  for (let w = from; w <= to; w++) {
    run(l, w, w);
    if (p.morale!.disputeEnd?.how === 'signed') return w;
    if (!p.morale!.dispute) return null;
  }
  return null;
}

describe('disputes: a firm club thinks again (G4)', () => {
  it("settles with a starter it can't replace once camp and the games make his absence cost, never before camp", () => {
    const { l } = base('review');
    const p = firmHoldout(l, 1, 0.5, 4);
    run(l, 1, 6);
    expect(p.morale!.dispute).toBeDefined();
    expect(settledAt(l, p, 7, 12)).not.toBeNull();
    expect(p.contract!.signedSeason).toBe(l.season);
  });

  it('holds while his backup is as good as he is', () => {
    const { l } = base('review-twin');
    const p = firmHoldout(l, 1, 0.2, 0);
    expect(settledAt(l, p, 7, 12)).toBeNull();
  });

  it('a stubborn GM holds longer than an easy one, and a club playing for later longer than a contender', () => {
    const steps = (stubbornness: number, winNow: number) => {
      const { l } = base('review-gm');
      const p = firmHoldout(l, 1, stubbornness, 1.5);
      l.teams[1].gm.winNow = winNow;
      return settledAt(l, p, 7, 12) ?? 99;
    };
    expect(steps(0.1, 0.5)).toBeLessThan(steps(0.9, 0.5));
    expect(steps(0.5, 1)).toBeLessThan(steps(0.5, 0));
  });

  it('weighs a hold-in at camp only: from week 1 he plays', () => {
    const big = base('review-hold-in');
    expect(settledAt(big.l, firmHoldout(big.l, 1, 0.1, 8, 'holdIn'), 7, 7)).toBe(7);
    const twin = base('review-hold-in');
    const p = firmHoldout(twin.l, 1, 0.1, 0, 'holdIn');
    expect(settledAt(twin.l, p, 7, 12)).toBeNull();
    expect(p.morale!.disputeEnd?.how).toBe('week1');
  });

  it('stops thinking again after week 4, and leaves your club to you', () => {
    const late = base('review-late');
    const p = firmHoldout(late.l, 1, 0.1, 8);
    p.morale!.dispute!.out = true;
    expect(settledAt(late.l, p, 13, 16)).toBeNull();
    const yours = base('review-yours');
    const mine = firmHoldout(yours.l, yours.l.userTeamId, 0.1, 8);
    // Stubborn and well paid: he holds out past week 4 (`giveInLimit`, half his $20M).
    mine.personality = { ...mine.personality, greed: 1, patience: 0 };
    yearOf(mine.contract!, yours.l.season)!.base = 20_000;
    expect(settledAt(yours.l, mine, 7, 12)).toBeNull();
    expect(mine.morale!.dispute).toBeDefined();
    // The morale check stands in for you with the same rule.
    aiReviewDispute(yours.l, mine, at(yours.l, 12), 12);
    expect(mine.morale!.disputeEnd?.how).toBe('signed');
  });
});

/** A league at its re-sign window after one season (built once). */
let windowSave = '';
const resignWindow = (): League => {
  if (!windowSave) {
    const l = createLeague({ seed: 'dispute-window' });
    simToEndOfSeason(l);
    beginOffseason(l);
    windowSave = JSON.stringify(l);
  }
  return JSON.parse(windowSave);
};
/** An AI club's expiring keeper, alone in its window (every other expiring man gone), the club given room. */
function promisedKeeper(promised: boolean) {
  const l = resignWindow();
  const team = l.teams.find(
    (t) => t.id !== l.userTeamId && expiringPlayers(l, t.id).some((p) => resignCall(l, t.id, p).call !== 'walk'),
  )!;
  const p = expiringPlayers(l, team.id).find((x) => resignCall(l, team.id, x).call !== 'walk')!;
  for (const x of expiringPlayers(l, team.id)) if (x !== p) setTeam(l, x, null);
  room(l, team.id, 80_000);
  // Its tag spent, so a man who goes to test the market walks rather than being tagged.
  team.taggedId = teamPlayers(l, team.id).find((x) => x !== p)!.id;
  // Ready to test the market: without the promise, about a third of the time he goes to see what it pays.
  p.personality.loyalty = 0;
  p.morale = { level: 0, jolts: [] };
  if (promised) p.morale.talk = { club: team.id, promise: { kind: 'deal', made: l.moraleAt!, due: l.moraleAt! + 8 } };
  return { l, team, p };
}

describe('disputes: AI clubs keep their promises (G4)', () => {
  it('keeps a deal promise in the re-sign window, and draws what it would have drawn', () => {
    // A seed whose market-test draw sends him to the market unpromised: the promise is what keeps him.
    for (let i = 0; i < 12; i++) {
      const seed = `keep:${i}`;
      const plain = promisedKeeper(false);
      const rngPlain = new Rng(seed);
      aiResignWindow(plain.l, plain.team, rngPlain);
      const kept = promisedKeeper(true);
      const rngKept = new Rng(seed);
      aiResignWindow(kept.l, kept.team, rngKept);
      expect(isExpired(kept.p.contract!, kept.l.season)).toBe(false);
      expect(kept.p.teamId).toBe(kept.team.id);
      expect(rngKept.getState()).toEqual(rngPlain.getState());
      if (isExpired(plain.p.contract!, plain.l.season)) return;
    }
    throw new Error('no seed sent the unpromised man to the market');
  });

  it('extends a promised man with two years left, on the dispute stream', () => {
    const run = (promised: boolean) => {
      const l = resignWindow();
      const team = l.teams.find((t) => t.id !== l.userTeamId)!;
      const p = teamPlayers(l, team.id).find(
        (x) =>
          x.contract &&
          x.contract.kind === 'veteran' &&
          !isExpired(x.contract, l.season) &&
          yearsLeft(x.contract, l.season) <= 2 &&
          resignCall(l, team.id, x).call !== 'walk',
      )!;
      room(l, team.id, 80_000);
      p.morale = { level: 0, jolts: [] };
      if (promised)
        p.morale.talk = { club: team.id, promise: { kind: 'deal', made: l.moraleAt!, due: l.moraleAt! + 8 } };
      const rng = new Rng('extend');
      aiResignWindow(l, team, rng);
      return { p, l, state: rng.getState() };
    };
    const kept = run(true);
    const plain = run(false);
    expect(kept.p.contract!.signedSeason).toBe(kept.l.season);
    expect(plain.p.contract!.signedSeason).toBeLessThan(plain.l.season);
    expect(kept.state).toEqual(plain.state);
  });

  it('breaks the promise when its own read says walk', () => {
    const { l, team, p } = promisedKeeper(true);
    p.age = ageShift(p.position) + 34;
    expect(resignCall(l, team.id, p).call).toBe('walk');
    aiResignWindow(l, team, new Rng('walk'));
    expect(isExpired(p.contract!, l.season)).toBe(true);
  });

  it("starts a promised man for his promise's games when he's within a point of the last starter, on AI clubs only", () => {
    const l = createLeague({ seed: 'snaps-promise' });
    const pos = 'LB';
    const n = STARTERS[pos];
    const chartOf = (teamId: number) => l.teams[teamId].depthChart[pos];
    /** The club's first man past its starters within `gap` points of its last starter, promised snaps. */
    const promise = (teamId: number, near: (gap: number) => boolean) => {
      const t = l.teams[teamId];
      t.autoDepth = false;
      const chart = chartOf(teamId);
      const last = l.players[chart[n - 1]];
      const i = chart.findIndex((id, k) => k >= n && near(playerOvr(last) - playerOvr(l.players[id])));
      if (i < 0) return null;
      const p = l.players[chart[i]];
      p.morale = {
        level: -3,
        jolts: [],
        talk: { club: teamId, promise: { kind: 'snaps', made: l.moraleAt!, role: 2, left: 4 } },
      };
      return { p, last };
    };
    const ai = l.teams.filter((t) => t.id !== l.userTeamId).map((t) => t.id);
    const close = ai.map((id) => ({ id, x: promise(id, (g) => g >= 0 && g <= 1) })).find((c) => c.x)!;
    syncDepthChart(l, l.teams[close.id]);
    expect(chartOf(close.id).slice(0, n)).toContain(close.x!.p.id);
    expect(chartOf(close.id).slice(0, n)).not.toContain(close.x!.last.id);
    const far = ai
      .filter((id) => id !== close.id)
      .map((id) => ({ id, x: promise(id, (g) => g >= 1.5) }))
      .find((c) => c.x)!;
    const before = [...chartOf(far.id)];
    syncDepthChart(l, l.teams[far.id]);
    expect(chartOf(far.id)).toEqual(before);
    // Your club's chart is yours.
    const mine = promise(l.userTeamId, (g) => g >= 0 && g <= 1);
    if (mine) {
      const was = [...chartOf(l.userTeamId)];
      syncDepthChart(l, l.teams[l.userTeamId]);
      expect(chartOf(l.userTeamId)).toEqual(was);
    }
    // And with moods not acting, nothing moves.
    const off = ai
      .filter((id) => id !== close.id && id !== far.id)
      .map((id) => ({ id, x: promise(id, (g) => g >= 0 && g <= 1) }))
      .find((c) => c.x);
    if (off) {
      const was = [...chartOf(off.id)];
      MOOD_ACTS.on = false;
      syncDepthChart(l, l.teams[off.id]);
      expect(chartOf(off.id)).toEqual(was);
    }
  });
});

const { disputeView } = await import('./disputes');

describe('disputes: what screens see (G4)', () => {
  it("reads a hold-in or holdout for anyone's player, in words, and nothing without one", () => {
    const { l } = base('view');
    const theirs = activeRoster(l, (l.userTeamId + 1) % 32).find((x) => x.morale)!;
    expect(disputeView(l, theirs)).toBeNull();
    theirs.morale!.dispute = { kind: 'holdOut', cause: 'deal', since: l.moraleAt!, club: theirs.teamId!, out: true };
    expect(disputeView(l, theirs)).toMatchObject({ kind: 'holdOut', label: 'Holding out' });
    expect(disputeView(l, theirs)!.text).not.toMatch(/answer|\$/);
    const mine = activeRoster(l, l.userTeamId).find((x) => x.morale)!;
    mine.morale!.dispute = { kind: 'holdIn', cause: 'deal', since: l.moraleAt!, club: l.userTeamId };
    expect(disputeView(l, mine)).toMatchObject({ kind: 'holdIn', label: 'Holding in' });
    MOOD_ACTS.on = false;
    expect(disputeView(l, mine)).toBeNull();
  });
});
