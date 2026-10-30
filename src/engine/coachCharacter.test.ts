/** What coaches' character does in the game (docs/superpowers/specs/2026-10-30-coach-character-design.md). */
import { describe, expect, it } from 'vitest';
import { coachAsk, coachAskTo, extendCoach, isCoachExpiring, teamCoaches } from './coaching';
import { createLeague } from './generate';
import { simToEndOfSeason } from './league';
import { beginOffseason } from './offseason';
import { TREE_PULL, treeLean } from './trees';
import type { Coach, CoachTraits, League } from './types';

const typical = (): CoachTraits => ({ ambition: 10.5, loyalty: 10.5, adaptability: 10.5, discipline: 10.5 });
const withTraits = (c: Coach, t: Partial<CoachTraits>) => {
  c.traits = { ...typical(), ...t };
  return c;
};
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
