import { describe, expect, it } from 'vitest';
import { capSpace } from '../finance/cap';
import { createLeague } from '../generate';
import { deliverMail } from '../inbox';
import { simToEndOfSeason } from '../league';
import { beginOffseason, simOffseason } from '../offseason';
import { payAhead } from '../offseason/ai';
import { practiceSquad } from '../roster';
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
    expect(l.teams.filter((t) => practiceSquad(l, t.id).length > 0).length).toBeGreaterThanOrEqual(30);
    // Camp's pay-ahead held room for a full veteran squad; once squads formed, what they didn't cost was paid ahead too.
    const again = structuredClone(l);
    again.phase = 'preseason';
    for (const t of again.teams) {
      const before = capSpace(again, t.id);
      payAhead(again, t);
      expect(capSpace(again, t.id)).toBeCloseTo(before, 3);
    }
  }, 300_000);
});
