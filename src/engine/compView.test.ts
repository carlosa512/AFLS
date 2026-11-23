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
    for (const p of mine(l)) p.statTeams = { [l.season - 1]: [l.userTeamId] };
    const yes = mine(l).find((p) => demand(l, p, l.userTeamId).market >= COMP.floor * cap);
    const no = mine(l).find((p) => demand(l, p, l.userTeamId).market < COMP.floor * cap);
    expect(yes && no).toBeTruthy();
    expect(walkLine(l, yes!)).toMatch(
      /^If he signs elsewhere, likely a (3rd|4th|5th|6th|7th)-round compensatory pick next year\.$/,
    );
    const want = compRound(demand(l, yes!, l.userTeamId).market, cap)!;
    expect(walkLine(l, yes!)).toContain(`a ${['', '', '', '3rd', '4th', '5th', '6th', '7th'][want]}-round`);
    expect(walkLine(l, no!)).toBeNull();
    // Not credited to us unless his last team was ours.
    yes!.statTeams = { [l.season - 1]: [l.userTeamId === 7 ? 8 : 7] };
    expect(walkLine(l, yes!)).toBeNull();
    yes!.statTeams = {};
    expect(walkLine(l, yes!)).toBeNull();
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
  it('shows in the draft phase, where signings still count, and not in preseason', () => {
    const { l, user, a } = setup();
    a.teamId = null;
    a.contract = null;
    a.statTeams = { [l.season - 1]: [user === 7 ? 8 : 7] };
    a.left = [];
    l.transactions.forEach((t) => (t.phase = 'draft'));
    l.phase = 'draft';
    expect(tallyLine(l)).toMatch(/^On track for/);
    expect(cancelLine(l, a, pay(l, 4))).toMatch(/^Signing him cancels/);
    l.phase = 'preseason';
    expect(tallyLine(l)).toBeNull();
  });
  describe('which pick a signing cancels', () => {
    const scene = (rounds: (3 | 4 | 5 | 6 | 7)[], gained: (3 | 4 | 5 | 6 | 7)[] = []) => {
      const l = world();
      l.phase = 'freeAgency';
      const user = l.userTeamId;
      const other = user === 5 ? 6 : 5;
      const mineP = mine(l);
      rounds.forEach((r, i) =>
        logTransaction(l, 'sign', [other], 'signed', mineP[i].id, { from: user, apy: pay(l, r) }),
      );
      const away = Object.values(l.players).filter((p) => p.teamId !== user && p.teamId !== null);
      gained.forEach((r, i) =>
        logTransaction(l, 'sign', [user], 'signed', away[i].id, { from: other, apy: pay(l, r) }),
      );
      const target = away[gained.length];
      target.teamId = null;
      target.contract = null;
      target.statTeams = { [l.season - 1]: [other] };
      target.left = [];
      return { l, mineP, target };
    };
    it('names the pick the new signing costs after the others reshuffle, not the loss it matches', () => {
      // Losses R4 and R6, an R7 signing already took the 6th; an R5 now takes the 4th as well.
      const { l, mineP, target } = scene([4, 6], [7]);
      const line = cancelLine(l, target, pay(l, 5))!;
      expect(line).toContain('4th-round');
      expect(line).toContain(`${mineP[0].firstName[0]}. ${mineP[0].lastName}`);
      expect(line).not.toContain('6th');
    });
    it('says nothing when the cap of four means the pick we are on track for stays', () => {
      const { l, target } = scene([3, 4, 5, 6, 7]);
      expect(cancelLine(l, target, pay(l, 7))).toBeNull();
    });
  });
});

describe('pickLabel', () => {
  it('marks a compensatory pick', () => {
    const l = world();
    const pick = { ...l.draftPicks[0], comp: true as const };
    expect(pickLabel(l, pick)).toContain('round ' + pick.round + ' comp pick');
    expect(pickLabel(l, pick)).not.toMatch(/\)[^·]*\(/);
    expect(pickLabel(l, l.draftPicks[0])).not.toContain('comp');
  });
});
