import { describe, expect, it } from 'vitest';
import { capSpace } from '../finance/cap';
import { createLeague } from '../generate';
import { deliverMail } from '../inbox';
import { simToEndOfSeason } from '../league';
import { beginOffseason, simOffseason } from '../offseason';
import { payAhead } from '../offseason/ai';
import { practiceSquad } from '../roster';
import { squadCategory, squadFormationCost } from './eligibility';
import { canTurnOnPersonnel, turnOnPersonnel } from './activation';

describe('switching practice squads on', () => {
  it('is refused in season and for careers that already have them', () => {
    const off = createLeague({ seed: 'activation-refuse' });
    expect(canTurnOnPersonnel(off)).toMatch(/offseason/);
    const on = createLeague({ seed: 'activation-refuse', personnel: true });
    expect(canTurnOnPersonnel(on)).toMatch(/already/);
  });

  it('the offer is for one offseason only: a later one cannot turn them on', () => {
    const l = createLeague({ seed: 'activation-once' });
    l.phase = 'resign';
    expect(canTurnOnPersonnel(l)).toMatch(/offer/);
    l.personnel!.offered = l.season;
    expect(canTurnOnPersonnel(l)).toBeNull();
    l.season++;
    expect(canTurnOnPersonnel(l)).toMatch(/offer/);
  });

  it('an old career gets the offer once at its offseason; turned on before camp, squads form at camp', () => {
    const l = createLeague({ seed: 'activation-old' });
    simToEndOfSeason(l);
    beginOffseason(l);
    deliverMail(l);
    deliverMail(l);
    expect((l.inbox ?? []).filter((m) => m.id.startsWith('personnelOffer:'))).toHaveLength(1);
    expect(canTurnOnPersonnel(l)).toBeNull();
    turnOnPersonnel(l);
    expect(l.personnel!.enabled).toBe(true);
    expect(canTurnOnPersonnel(l)).toMatch(/already/);
    simOffseason(l);
    expect(l.phase).toBe('regular');
    for (const t of l.teams) {
      expect(capSpace(l, t.id)).toBeGreaterThanOrEqual(-0.001);
    }
    // Most clubs form one at camp; a few with no room or no one worth keeping don't. Across leagues it runs 26–31 of
    // 32 (seeds activation-old, sq-2, sq-3 on main before the draft-busts change: 31, 26, 30).
    // 2026-11-16: the market and exits: 24 of 32 formed one in this world (bound 26, now 22). The eight that did not had
    // $0.3M to $4M of room on a full 53 (and one $11M, with no one worth keeping): clubs spend first in free agency's
    // first days now (`SPEND_FIRST`), so more reach camp with their room spent, as the test's own line says a few do.
    expect(l.teams.filter((t) => practiceSquad(l, t.id).length > 0).length).toBeGreaterThanOrEqual(22);
    // Camp's pay-ahead held room for a full veteran squad; once squads formed, what they didn't cost was paid ahead too.
    // A club whose books moved after camp is left out: a holdout who gives in at week 1 comes back to a full 53, and
    // the cut that makes his room frees cap camp never saw (G4).
    const moved = new Set(
      l.transactions
        .filter((t) => t.season === l.season && t.phase === 'regular' && (t.kind === 'release' || t.kind === 'waiver'))
        .flatMap((t) => t.teamIds),
    );
    const again = structuredClone(l);
    again.phase = 'preseason';
    // 2026-11-26: who plays moved (discipline's final words), and one club (NYE) came out of week 1 with $49K more room
    // than camp's pay-ahead left. The cause is a short veteran count, not discipline: camp reserves the squad's cost
    // for six veterans (`squadReserve`), so a club that formed with fewer leaves one veteran slot's extra unspent for
    // each one short, and the second pay-ahead sweeps it. A club may drift only for that, by at most that much. Every
    // other club's pay-ahead is still a no-op.
    const perVeteran = squadFormationCost(l, 1, 1) - squadFormationCost(l, 1, 0);
    for (const t of again.teams.filter((x) => !moved.has(x.id))) {
      const veterans = practiceSquad(l, t.id).filter((p) => squadCategory(l, p) === 'veteran').length;
      const before = capSpace(again, t.id);
      payAhead(again, t);
      const drift = before - capSpace(again, t.id);
      if (veterans >= 6) expect(capSpace(again, t.id), t.abbrev).toBeCloseTo(before, 3);
      else {
        expect(drift, t.abbrev).toBeLessThanOrEqual((6 - veterans) * perVeteran + 0.001);
        expect(drift, t.abbrev).toBeGreaterThanOrEqual(-0.001);
      }
    }
    expect(moved.size).toBeLessThan(8);
  }, 300_000);
});
