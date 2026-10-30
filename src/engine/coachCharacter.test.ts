/** What coaches' character does in the game (docs/superpowers/specs/2026-10-30-coach-character-design.md). */
import { describe, expect, it } from 'vitest';
import { ADAPT, adaptShare, headStints, STEP_UP, stepsDown, wantsStepUp } from './coachTraits';
import {
  bentDefense,
  bentPassLean,
  callerStyle,
  coachAsk,
  coachAskTo,
  cultureCalls,
  ensureCoached,
  extendCoach,
  headCoachVision,
  isCoachExpiring,
  ownerDismissHeadCoach,
  planUnder,
  poachProblem,
  promotionProblem,
  releaseCoach,
  stepDown,
  teamCoaches,
  visionFit,
  type Vision,
} from './coaching';
import { createLeague } from './generate';
import { simToEndOfSeason } from './league';
import { moraleContext, moraleFactors } from './morale';
import { beginOffseason } from './offseason';
import { TREE_PULL, treeLean } from './trees';
import type { Coach, CoachTraits, League } from './types';

const typical = (): CoachTraits => ({ ambition: 10.5, loyalty: 10.5, adaptability: 10.5, discipline: 10.5 });
const withTraits = (c: Coach, t: Partial<CoachTraits>) => {
  c.traits = { ...typical(), ...t };
  return c;
};
const coachOf = (role: Coach['role']): Coach => ({
  id: 9000,
  firstName: 'Ray',
  lastName: 'Holt',
  role,
  age: 45,
  youth: 10,
  veterans: 10,
  teamId: null,
  contract: null,
  traits: typical(),
});
const copyOf = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const headOf = (l: League, team: number) => teamCoaches(l, team).find((c) => c.role === 'headCoach')!;
const offseason = (seed: string) => {
  const league = createLeague({ seed });
  simToEndOfSeason(league);
  beginOffseason(league);
  return league;
};

/** Three coaches with no history: a head coach and two men who served four seasons under him before the league. */
function oldBoss(): { l: League; hc: Coach; a: Coach; b: Coach } {
  const l = createLeague({ seed: 'loyalty' });
  const [hc, a, b] = Object.values(l.coaches);
  for (const x of [hc, a, b]) {
    x.career = [];
    delete x.pastUnder;
  }
  for (const x of [a, b]) x.pastUnder = [{ coachId: hc.id, role: 'offCoord', seasons: 4 }];
  return { l, hc, a, b };
}

describe('loyalty', () => {
  it('pulls a loyal man to his old boss harder than a disloyal one, a typical man as before', () => {
    const { l, hc, a, b } = oldBoss();
    withTraits(a, { loyalty: 18 });
    withTraits(b, { loyalty: 3 });
    expect(treeLean(l, hc, a, 'offCoord')).toBeLessThan(treeLean(l, hc, b, 'offCoord'));
    withTraits(a, {});
    expect(treeLean(l, hc, a, 'offCoord')).toBeCloseTo(-TREE_PULL);
  });

  it('asks a loyal man less to stay, and the same to anyone else', () => {
    const l = offseason('loyal-ask');
    const c = withTraits(teamCoaches(l, 3).find((x) => x.role === 'defCoord')!, { loyalty: 18 });
    expect(coachAskTo(l, c, 2, 3)).toBe(Math.round(coachAsk(l, c, 2) * 0.95));
    expect(coachAskTo(l, c, 2, 4)).toBe(coachAsk(l, c, 2));
    withTraits(c, { loyalty: 3 });
    expect(coachAskTo(l, c, 2, 3)).toBe(Math.round(coachAsk(l, c, 2) * 1.05));
  });

  it('pays what it checked when you re-sign him', () => {
    const l = offseason('loyal-extend');
    const user = l.userTeamId;
    l.teams[user].staffBudgetMult = 2;
    const c = teamCoaches(l, user).find((x) => isCoachExpiring(l, x))!;
    withTraits(c, { loyalty: 18 });
    const ask = coachAskTo(l, c, 2, user);
    extendCoach(l, user, c.id, 2);
    expect(c.contract!.salary).toBe(ask);
  });
});

describe('adaptability', () => {
  const v = (pass: number, front: 'threeFour' | 'fourThree' = 'threeFour') =>
    ({ pass, defense: { front, coverage: 'cover3' }, pressure: 0 }) as Vision;
  const oc = (adaptability: number, passLean: number) =>
    withTraits({ ...coachOf('offCoord'), style: { passLean } }, { adaptability });

  it('bends an adaptable OC’s pass lean toward the head coach, not a stubborn one’s', () => {
    expect(bentPassLean(oc(20, -0.4), v(0.8))).toBeCloseTo(-0.4 + 0.8 * (1.2 - ADAPT.tilt));
    expect(bentPassLean(oc(1, -0.4), v(0.8))).toBeCloseTo(-0.4);
    expect(adaptShare(oc(20, 0))).toBeCloseTo(0.8);
  });

  it('has an adaptable DC run the head coach’s front about as often as his share says', () => {
    const dc = withTraits(
      { ...coachOf('defCoord'), scheme: { front: 'fourThree', coverage: 'cover2' } },
      {
        adaptability: 20,
      },
    );
    const runs = Array.from({ length: 400 }, (_, id) => bentDefense('s', dc, id, v(0))?.front === 'threeFour');
    const share = runs.filter(Boolean).length / runs.length;
    expect(share).toBeGreaterThan(0.7);
    expect(share).toBeLessThan(0.9);
    withTraits(dc, { adaptability: 1 });
    expect(bentDefense('s', dc, 7, v(0))).toEqual(dc.scheme);
  });

  it('scores fit on the bent plan, and calls the game on it', () => {
    const l = createLeague({ seed: 'adapt' });
    const team = 5;
    const hc = teamCoaches(l, team).find((c) => c.role === 'headCoach')!;
    const coord = teamCoaches(l, team).find((c) => c.role === 'offCoord')!;
    const vision = headCoachVision(l, hc);
    coord.style = { ...coord.style, passLean: vision.pass > 0 ? -1 : 1 };
    withTraits(coord, { adaptability: 1 });
    const stubborn = visionFit(l, hc, coord)!;
    withTraits(coord, { adaptability: 20 });
    expect(visionFit(l, hc, coord)!).toBeGreaterThan(stubborn);
    expect(callerStyle(l, team).passLean).toBeCloseTo(bentPassLean(coord, vision));
    expect(planUnder(l, coord).style?.passLean).toBeCloseTo(bentPassLean(coord, vision));
  });
});

describe('discipline', () => {
  it('gives a disciplinarian fewer flags and a player’s coach more, a typical coach none', () => {
    const l = createLeague({ seed: 'culture-calls' });
    withTraits(headOf(l, 1), { discipline: 18 });
    withTraits(headOf(l, 2), { discipline: 3 });
    withTraits(headOf(l, 3), {});
    expect(cultureCalls(l, 1)).toBeCloseTo(0.92);
    expect(cultureCalls(l, 2)).toBeCloseTo(1.08);
    expect(cultureCalls(l, 3)).toBe(1);
  });

  it('lifts the room under a player’s coach and quiets it under a disciplinarian', () => {
    const l = createLeague({ seed: 'culture-room' });
    withTraits(headOf(l, 2), { discipline: 3 });
    withTraits(headOf(l, 1), { discipline: 18 });
    const ctx = moraleContext(l);
    expect(ctx.culture.get(2)).toBeCloseTo(0.5);
    expect(ctx.culture.get(1)).toBeCloseTo(-0.5);
    const p = l.players[l.teams[2].depthChart.QB[0]];
    const base = moraleFactors(l, p, { ...ctx, culture: new Map() }).room;
    expect(moraleFactors(l, p, ctx).room).toBeCloseTo(Math.min(1.5, base + 0.5));
  });

  it('keeps the league’s mood centred over a league of coaches', () => {
    const ctx = moraleContext(createLeague({ seed: 'culture' }));
    const xs = [...ctx.culture.values()];
    expect(Math.abs(xs.reduce((a, b) => a + b, 0) / xs.length)).toBeLessThan(0.15);
  });
});

describe('wanting the step up', () => {
  const dc = (ambition: number, age = 45) => withTraits({ ...coachOf('defCoord'), age }, { ambition });

  it('never takes a lifer up, always a climber, and the same answer all offseason', () => {
    const { lifer, climber } = STEP_UP.headCoach;
    expect(wantsStepUp('s', 2030, dc(lifer), 'headCoach')).toBe(false);
    expect(wantsStepUp('s', 2030, dc(climber), 'headCoach')).toBe(true);
    const c = dc((lifer + climber) / 2);
    expect(wantsStepUp('s', 2030, c, 'headCoach')).toBe(wantsStepUp('s', 2030, copyOf(c), 'headCoach'));
  });

  it('says yes as often as ambition sits between lifer and climber, less after 55', () => {
    const { lifer, climber } = STEP_UP.headCoach;
    const mid = (lifer + climber) / 2;
    const share = (age: number) =>
      Array.from({ length: 1000 }, (_, id) => wantsStepUp('s', 2030, { ...dc(mid, age), id }, 'headCoach')).filter(
        Boolean,
      ).length / 1000;
    expect(share(45)).toBeGreaterThan(0.45);
    expect(share(45)).toBeLessThan(0.55);
    expect(share(65)).toBe(0);
  });

  it('is a step easier for a position coach taking a coordinator’s chair', () => {
    const pc = (ambition: number) => withTraits({ ...coachOf('positionCoach'), room: 'LB' }, { ambition });
    expect(STEP_UP.coordinator.lifer).toBeLessThan(STEP_UP.headCoach.lifer);
    expect(wantsStepUp('s', 2030, pc(STEP_UP.coordinator.lifer), 'defCoord')).toBe(false);
    expect(wantsStepUp('s', 2030, pc(STEP_UP.coordinator.climber), 'defCoord')).toBe(true);
  });

  it('hires the best willing man, logs the top choice who said no, and never leaves a chair empty', () => {
    const l = offseason('step-up');
    const lifers = new Set<number>();
    for (const c of Object.values(l.coaches))
      if (c.role === 'offCoord' || c.role === 'defCoord') lifers.add(withTraits(c, { ambition: 1 }).id);
    const fired = l.teams.map((t) => t.id).filter((t) => t !== l.userTeamId && ownerDismissHeadCoach(l, t));
    expect(fired.length).toBeGreaterThan(2);
    ensureCoached(l);
    for (const t of fired) {
      const hc = headOf(l, t);
      expect(hc).toBeDefined();
      // Every coordinator is a lifer: the job went to a head coach on the market (or a journeyman), never a lifer.
      expect(lifers.has(hc.id)).toBe(false);
    }
    expect(l.transactions.some((x) => /top choice, .* turned down head-coach talks\./.test(x.text))).toBe(true);
  });

  it('turns down your promotion or poach with the reason, the answer AI clubs get', () => {
    const l = offseason('step-up-you');
    const mine = withTraits(teamCoaches(l, l.userTeamId).find((c) => c.role === 'defCoord')!, { ambition: 1 });
    expect(promotionProblem(l, l.userTeamId, mine)).toBe(
      'He’s happy as defensive coordinator: he won’t take head-coach talks.',
    );
    const theirs = withTraits(teamCoaches(l, (l.userTeamId + 1) % 32).find((c) => c.role === 'offCoord')!, {
      ambition: 1,
    });
    expect(poachProblem(l, l.userTeamId, theirs)).toBe(
      'He’s happy as offensive coordinator: he won’t take head-coach talks.',
    );
  });
});

describe('stepping down', () => {
  const rows = (role: Coach['role'], teamId: number, ...seasons: number[]) =>
    seasons.map((season) => ({ season, teamId, role }));
  const fired = (over: Partial<Coach> = {}, t: Partial<CoachTraits> = {}) =>
    withTraits({ ...coachOf('headCoach'), ...over }, t);
  const share = (make: (id: number) => Coach, when: 'dismissed' | 'interim' | 'camp' = 'dismissed') =>
    Array.from({ length: 1000 }, (_, id) => stepsDown('s', 2030, make(id), when)).filter(Boolean).length / 1000;

  it('steps down more often when old, fired before or unambitious; an interim most of all', () => {
    const once = (id: number, age = 50, ambition = 10.5) =>
      fired({ id, age, career: rows('headCoach', 3, 2028, 2029) }, { ambition });
    const twice = (id: number) =>
      fired({ id, career: [...rows('headCoach', 1, 2020, 2021), ...rows('headCoach', 3, 2028)] });
    expect(share((id) => once(id, 62))).toBeGreaterThan(share((id) => once(id, 45)) + 0.2);
    expect(share(twice)).toBeGreaterThan(share((id) => once(id)) + 0.1);
    expect(share((id) => once(id, 50, 4))).toBeGreaterThan(share((id) => once(id, 50, 16)) + 0.3);
    expect(share((id) => once(id), 'interim')).toBeGreaterThan(share((id) => once(id)) + 0.3);
    expect(headStints(twice(1))).toBe(2);
  });

  it('moves him to his side’s coordinator chair with a scheme, and logs it', () => {
    const l = offseason('step-down');
    const c = Object.values(l.coaches).find((x) => x.role === 'headCoach')!;
    c.teamId = null;
    c.contract = null;
    c.career = [...rows('defCoord', 3, 2020, 2021), ...rows('headCoach', 4, 2022, 2023)];
    expect(stepDown(l, c)).toBe(true);
    expect(c.role).toBe('defCoord');
    expect(c.scheme?.front).toBeDefined();
    expect(l.transactions.at(-1)!.text).toBe(
      `Former ${l.teams[4].abbrev} head coach ${c.firstName} ${c.lastName} will look for coordinator jobs.`,
    );
  });

  it('keeps a man who never coordinated waiting, and sends an interim back to his acting side', () => {
    const l = offseason('step-down-2');
    const [a, b] = Object.values(l.coaches).filter((x) => x.role === 'headCoach');
    for (const c of [a, b]) {
      c.teamId = null;
      c.contract = null;
      c.career = rows('headCoach', 4, 2022, 2023);
    }
    expect(stepDown(l, a)).toBe(false);
    expect(a.role).toBe('headCoach');
    b.actingAs = 'offCoord';
    expect(stepDown(l, b)).toBe(true);
    expect(b.role).toBe('offCoord');
  });

  it('drops ambition by 3 at his second firing, once', () => {
    const l = offseason('second-firing');
    const user = l.userTeamId;
    l.teams[user].staffBudgetMult = 3;
    const hc = withTraits(headOf(l, user), { ambition: 12 });
    hc.career = [...rows('headCoach', (user + 1) % 32, 2020, 2021), ...rows('headCoach', user, l.season - 1)];
    releaseCoach(l, user, hc.id);
    expect(hc.traits!.ambition).toBe(9);
  });

  it('gives head coaches still unhired at camp another decision', () => {
    const l = offseason('camp-step-down');
    const market = Object.values(l.coaches).filter((c) => c.teamId === null && c.role === 'headCoach');
    for (const c of market) {
      c.career = [...rows('offCoord', 2, 2015, 2016), ...rows('headCoach', 2, 2017)];
      withTraits(c, { ambition: 1 });
      c.age = 64;
    }
    expect(market.length).toBeGreaterThan(0);
    ensureCoached(l);
    expect(market.some((c) => c.role === 'offCoord')).toBe(true);
  });
});

describe('review fixes', () => {
  it('works out a head coach’s vision once per moment, not on every lineup', () => {
    const l = createLeague({ seed: 'vision-cache' });
    const hc = headOf(l, 3);
    expect(headCoachVision(l, hc)).toBe(headCoachVision(l, hc));
  });

  it('keeps a man who just stepped down out of head-coach talks this offseason', () => {
    const l = offseason('stepped-down');
    const c = Object.values(l.coaches).find((x) => x.role === 'headCoach')!;
    c.teamId = null;
    c.contract = null;
    c.career = [
      { season: l.season - 4, teamId: 3, role: 'defCoord' },
      { season: l.season - 1, teamId: 4, role: 'headCoach' },
    ];
    withTraits(c, { ambition: 20 });
    expect(stepDown(l, c)).toBe(true);
    expect(wantsStepUp(l.seed, l.season, c, 'headCoach')).toBe(false);
    expect(wantsStepUp(l.seed, l.season + 1, c, 'headCoach')).toBe(true);
  });
});
