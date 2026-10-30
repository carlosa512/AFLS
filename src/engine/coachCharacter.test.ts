/** What coaches' character does in the game (docs/superpowers/specs/2026-10-30-coach-character-design.md). */
import { describe, expect, it } from 'vitest';
import { adaptShare } from './coachTraits';
import {
  bentDefense,
  bentPassLean,
  callerStyle,
  coachAsk,
  coachAskTo,
  cultureCalls,
  extendCoach,
  headCoachVision,
  isCoachExpiring,
  planUnder,
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
    expect(bentPassLean(oc(20, -0.4), v(0.8))).toBeCloseTo(-0.4 + 0.8 * 1.2);
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
  const headOf = (l: League, team: number) => teamCoaches(l, team).find((c) => c.role === 'headCoach')!;

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
