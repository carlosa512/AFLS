import { describe, expect, it } from 'vitest';
import { capFor, logTransaction } from './finance/cap';
import { createLeague } from './generate';
import { COMP, compRound } from './offseason/comp';
import { demand } from './offseason/negotiation';
import { cancelLine, tallyLine, walkLine } from './compView';
import { pickLabel } from './trade/value';
import type { League } from './types';

const pay = (l: League, round: 3 | 4 | 5 | 6 | 7) =>
  Math.ceil(capFor(l, l.season) * COMP.bands.find((b) => b.round === round)!.share) + 1;
const world = () => {
  const l = createLeague({ seed: 'comp-view' });
  l.phase = 'resign';
  return l;
};
/** The user's players sorted so a scene is searched for, never a lucky seed. */
const mine = (l: League) => Object.values(l.players).filter((p) => p.teamId === l.userTeamId && p.contract);

describe('walkLine', () => {
  it('names the round for a player who would qualify and nothing for one who would not', () => {
    const l = world();
    const cap = capFor(l, l.season);
    const yes = mine(l).find((p) => demand(l, p, l.userTeamId).market >= COMP.floor * cap);
    const no = mine(l).find((p) => demand(l, p, l.userTeamId).market < COMP.floor * cap);
    expect(yes && no).toBeTruthy();
    expect(walkLine(l, yes!)).toMatch(
      /^If he signs elsewhere, likely a (3rd|4th|5th|6th|7th)-round compensatory pick next year\.$/,
    );
    const want = compRound(demand(l, yes!, l.userTeamId).market, cap)!;
    expect(walkLine(l, yes!)).toContain(`a ${['', '', '', '3rd', '4th', '5th', '6th', '7th'][want]}-round`);
    expect(walkLine(l, no!)).toBeNull();
  });
});

describe('cancelLine and tallyLine', () => {
  const setup = () => {
    const l = world();
    l.phase = 'freeAgency';
    const user = l.userTeamId;
    const [a, b, c] = Object.values(l.players).filter((p) => p.teamId !== user && p.teamId !== null);
    // Two of ours walked: a 4th and a 6th.
    logTransaction(l, 'sign', [user === 5 ? 6 : 5], 'signed', mine(l)[0].id, { from: user, apy: pay(l, 4) });
    logTransaction(l, 'sign', [user === 5 ? 6 : 5], 'signed', mine(l)[1].id, { from: user, apy: pay(l, 6) });
    return { l, user, a, b, c };
  };
  it('tallies what we are on track for, and says nothing with none', () => {
    const { l } = setup();
    expect(tallyLine(l)).toMatch(
      /^On track for a 4th-round compensatory pick \(\w\. [\w'-]+\) and a 6th \(\w\. [\w'-]+\)\.$/,
    );
    const empty = world();
    empty.phase = 'freeAgency';
    expect(tallyLine(empty)).toBeNull();
  });
  it('says a signing cancels a pick, and nothing for a cheap one, a non-walker or outside free agency', () => {
    const { l, user, a } = setup();
    a.teamId = null;
    a.contract = null;
    a.statTeams = { [l.season - 1]: [user === 7 ? 8 : 7] };
    a.left = [];
    const lost = mine(l)[0];
    expect(cancelLine(l, a, pay(l, 4))).toContain(`${lost.firstName[0]}. ${lost.lastName}`);
    expect(cancelLine(l, a, pay(l, 4))).toMatch(
      /^Signing him cancels the 4th-round compensatory pick you are on track for \(/,
    );
    expect(cancelLine(l, a, 1)).toBeNull();
    a.statTeams = {};
    expect(cancelLine(l, a, pay(l, 4))).toBeNull();
    a.statTeams = { [l.season - 1]: [user === 7 ? 8 : 7] };
    l.phase = 'preseason';
    expect(cancelLine(l, a, pay(l, 4))).toBeNull();
  });
});

describe('pickLabel', () => {
  it('marks a compensatory pick', () => {
    const l = world();
    const pick = { ...l.draftPicks[0], comp: true as const };
    expect(pickLabel(l, pick)).toContain(' (comp)');
    expect(pickLabel(l, l.draftPicks[0])).not.toContain('(comp)');
  });
});
