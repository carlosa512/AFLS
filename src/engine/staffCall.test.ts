import { describe, expect, it } from 'vitest';
import { createLeague } from './generate';
import { staffCall } from './staffCall';

const league = createLeague({ seed: 'staff-call' });
const ours = Object.values(league.coaches).filter((c) => c.teamId === league.userTeamId);
const peers = (role: string) => Object.values(league.coaches).filter((c) => c.role === role && c.teamId !== null);

describe("the front office's call on a staff contract", () => {
  it('says over the budget when the ask goes past it, whoever he is', () => {
    const c = ours[0];
    expect(staffCall(league, { kind: 'coach', id: c.id }, { ask: c.contract!.salary, overBudget: true })).toMatch(
      /budget/i,
    );
  });

  it('backs a coach above the middle of his chair whose ask fits', () => {
    const c = ours.find((x) => {
      const ps = peers(x.role)
        .map((p) => (p.youth + p.veterans) / 2)
        .sort((a, b) => a - b);
      return (x.youth + x.veterans) / 2 > ps[ps.length >> 1];
    })!;
    const line = staffCall(league, { kind: 'coach', id: c.id }, { ask: c.contract!.salary, overBudget: false });
    expect(line).toMatch(/worth|keep|fair/i);
  });

  it('questions a below-the-middle man asking for a big raise', () => {
    const c = ours.find((x) => {
      const ps = peers(x.role)
        .map((p) => (p.youth + p.veterans) / 2)
        .sort((a, b) => a - b);
      return (x.youth + x.veterans) / 2 < ps[ps.length >> 1];
    });
    if (!c) return;
    const line = staffCall(league, { kind: 'coach', id: c.id }, { ask: c.contract!.salary * 1.6, overBudget: false });
    expect(line).toMatch(/better for the money|do better/i);
  });

  it('reads the same every time', () => {
    const c = ours[1];
    const a = staffCall(league, { kind: 'coach', id: c.id }, { ask: 1000, overBudget: false });
    expect(staffCall(league, { kind: 'coach', id: c.id }, { ask: 1000, overBudget: false })).toBe(a);
  });
});
