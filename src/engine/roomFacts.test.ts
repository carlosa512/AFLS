import { describe, expect, it } from 'vitest';

describe('chemistry facts (L3)', () => {
  it('never calls a new league’s starters new: no one has history yet', async () => {
    const { createLeague } = await import('./generate');
    const { CHEM_ROOMS, chemistryOf } = await import('./chemistry');
    const { chemFact } = await import('./roomFacts');
    const { moraleContext } = await import('./morale');
    const l = createLeague({ seed: 'chem-new-facts' });
    const ctx = moraleContext(l);
    for (const unit of CHEM_ROOMS) expect(chemFact(l, chemistryOf(l, l.userTeamId, unit)!, ctx).newStarters).toBe(0);
  });

  it('talks about the passing game, not the quarterbacks, for the QB room', async () => {
    const { createLeague } = await import('./generate');
    const { chemistryOf } = await import('./chemistry');
    const { chemFact } = await import('./roomFacts');
    const { moraleContext } = await import('./morale');
    const l = createLeague({ seed: 'chem-new-facts' });
    expect(chemFact(l, chemistryOf(l, l.userTeamId, 'QB')!, moraleContext(l)).unit).toBe('the passing game');
  });
});
