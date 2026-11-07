import { describe, expect, it } from 'vitest';
import { capSpace, paidFraction } from '../finance/cap';
import { capHit } from '../finance/contract';
import { createLeague } from '../generate';
import { refillRoster } from '../injuries';
import { activeRoster, setTeam } from '../roster';
import type { League } from '../types';

const template = createLeague({ seed: 'refill-cap', personnel: true, userTeamId: 0 });
const copy = (): League => JSON.parse(JSON.stringify(template));

/** An AI club one man short of 53 in `week`, with its cap room set to `space` (plenty if none). */
function shortClub(week: number, space = 50_000): { l: League; teamId: number } {
  const l = copy();
  l.week = week;
  const teamId = 5;
  const roster = activeRoster(l, teamId);
  setTeam(l, roster[roster.length - 1], null);
  l.teams[teamId].carryover += space - capSpace(l, teamId);
  return { l, teamId };
}

/** What the refill signs in `week` with room to spare, and the cap room that deal's full-season price needs. */
function dryRun(week: number) {
  const { l, teamId } = shortClub(week);
  const had = new Set(activeRoster(l, teamId).map((p) => p.id));
  refillRoster(l, l.teams[teamId]);
  const signed = activeRoster(l, teamId).find((p) => !had.has(p.id))!;
  const charge = capHit(signed.contract!, l.season);
  return { charge, exact: signed.contract!.apy * (1 - paidFraction(l)) };
}

describe('refilling the 53 at kickoff', () => {
  it('never books a deal past the cap, whatever fraction of a thousand the room is', () => {
    // A week where the booked charge rounds UP from the price's exact share of the season left: the deal that,
    // priced to the last of the room, lands a fraction over the cap (the crash this guards: room 398.63, charge 399).
    const week = [14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 15, 16].find((w) => {
      const d = dryRun(w);
      return d.charge - d.exact > 0.2;
    });
    expect(week, 'a week where the charge rounds up').toBeDefined();
    const { charge, exact } = dryRun(week!);
    // Room from the exact price up to the booked charge, a twentieth of a thousand at a time.
    for (let room = exact; room < charge; room += 0.05) {
      const { l, teamId } = shortClub(week!, room);
      refillRoster(l, l.teams[teamId]);
      expect(capSpace(l, teamId), `room ${room}`).toBeGreaterThanOrEqual(0);
    }
  });
});
