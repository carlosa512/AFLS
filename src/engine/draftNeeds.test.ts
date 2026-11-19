import { describe, expect, it } from 'vitest';
import { draftNeeds, lineupRows, needTier, rosterAtOpen, shownNeeds, type DraftNeed } from './draftNeeds';
import { createLeague } from './generate';
import { STARTERS } from './positions';
import { setTeam, teamPlayers } from './roster';
import { FRONTS, OFF_SCHEMES, type TeamScheme } from './schemes';
import { rosterOf, tradeContext } from './trade/context';
import { needsOn, teamNeeds } from './trade/plans';
import { POSITIONS, type League, type Player, type Position } from './types';

const base = (() => {
  const l = createLeague({ seed: 'draft-needs' });
  l.phase = 'draft';
  return JSON.stringify(l);
})();
const fresh = (): League => JSON.parse(base);

/** Marks a player as taken by his team in this year's draft. */
const draftee = (l: League, p: Player) => {
  p.draft = { season: l.season, round: 1, pick: 5, teamId: p.teamId!, rank: 5 };
};

const power: TeamScheme = { offense: OFF_SCHEMES.power, front: FRONTS.fourThree, coverage: null };
const air: TeamScheme = { offense: OFF_SCHEMES.airRaid, front: FRONTS.fourThree, coverage: null };

describe('draft needs', () => {
  it("reads needs as the draft opened: this year's draftees are left out", () => {
    const l = fresh();
    const t = l.teams[3];
    const te = teamPlayers(l, t.id).find((p) => p.position === 'TE')!;
    draftee(l, te);
    const ctx = tradeContext(l);
    expect(rosterAtOpen(ctx, t.id)).not.toContain(te);
    expect(rosterOf(ctx, t.id)).toContain(te);
  });

  it('marks a need filled once the team has drafted at the position', () => {
    const l = fresh();
    const t = l.teams[l.userTeamId];
    const cbs = teamPlayers(l, t.id).filter((p) => p.position === 'CB');
    for (const p of cbs.slice(1)) setTeam(l, p, null);
    draftee(l, cbs[0]);
    const cb = draftNeeds(tradeContext(l), l.userTeamId, t).needs.find((n) => n.position === 'CB');
    expect(cb).toMatchObject({ reason: 'hole', filled: true, tier: 'big' });
  });

  const row = (l: League, s: TeamScheme, pos: Position) =>
    lineupRows(tradeContext(l), l.userTeamId, l.teams[l.userTeamId], s).find((r) => r.position === pos)!;

  it('wants 4 TE and 5 WR in 12 personnel, 2 TE and 7 WR in 10', () => {
    const l = fresh();
    expect([row(l, power, 'TE').want, row(l, power, 'WR').want]).toEqual([4, 5]);
    expect([row(l, air, 'TE').want, row(l, air, 'WR').want]).toEqual([2, 7]);
  });

  it('has no TE need, starter or typical in 10 personnel, and does not throw', () => {
    const te = row(fresh(), air, 'TE');
    expect([te.need, te.weakest, te.typical, te.starters.length]).toEqual([null, null, null, 0]);
  });

  it('lists the lineup in position order with the weakest starter and a typical starter', () => {
    const l = fresh();
    const rows = lineupRows(tradeContext(l), l.userTeamId, l.teams[l.userTeamId], power);
    expect(rows.map((r) => r.position)).toEqual([...POSITIONS]);
    const tes = rows.find((r) => r.position === 'TE')!;
    expect(tes.starters).toHaveLength(2);
    expect(tes.starters).toContain(tes.weakest);
    expect(tes.have).toBe(rosterOf(tradeContext(l), l.userTeamId).filter((p) => p.position === 'TE').length);
    expect(Number.isFinite(tes.typical)).toBe(true);
  });

  it("reads a rival's needs through your scouts", () => {
    const l = fresh();
    const ctx = tradeContext(l);
    const read = (xs: { position: Position; urgency: number }[]) => xs.map((n) => `${n.position}:${n.urgency}`);
    const differs = l.teams
      .filter((t) => t.id !== l.userTeamId)
      .some((t) => read(draftNeeds(ctx, l.userTeamId, t).needs).join() !== read(teamNeeds(ctx, t)).join());
    expect(differs).toBe(true);
  });

  it('lists the top five unfilled needs, then every filled one', () => {
    const n = (position: Position, filled = false): DraftNeed => ({
      position,
      urgency: 0.5,
      reason: 'upgrade',
      filled,
      tier: 'need',
    });
    const xs = [n('QB'), n('RB'), n('OL', true), n('WR'), n('TE'), n('DT'), n('LB')];
    expect(shownNeeds(xs).map((x) => x.position)).toEqual(['QB', 'RB', 'WR', 'TE', 'DT', 'OL']);
  });

  it('tiers by severity: a hole is big at every position, K and P included', () => {
    const l = fresh();
    const roster = rosterOf(tradeContext(l), 0);
    const line = Object.fromEntries(POSITIONS.map((p) => [p, 12])) as Record<Position, number>;
    for (const pos of POSITIONS) {
      const hole = needsOn(
        l,
        roster.filter((p) => p.position !== pos),
        line,
        () => 15,
        STARTERS,
      ).find((x) => x.position === pos)!;
      expect(needTier(hole)).toBe('big');
    }
  });
});
