import { describe, expect, it } from 'vitest';
import { capSpace } from '../finance/cap';
import { createLeague, SAVE_VERSION } from '../generate';
import { playWeek } from '../league';
import { migrateLeague } from '../migrate';
import { rosterLimit } from '../offseason/negotiation';
import { activeRoster } from '../roster';
import type { League } from '../types';
import { marginFor, marketMoment, stanceFor, stanceOf, teamNeeds, tradeBlock, tradeContext, untouchables, updateStances } from '.';

const base = JSON.stringify(createLeague({ seed: 'market-tests' }));
const fresh = (): League => JSON.parse(base);
const copy = <T>(x: T): T => JSON.parse(JSON.stringify(x));

describe('team plans', () => {
  it('reads stances in bands with a dead zone, so a team does not flip on one result', () => {
    expect(stanceFor(0.3)).toBe('contend');
    expect(stanceFor(0.25)).toBe('bubble');
    expect(stanceFor(0.25, 'contend')).toBe('contend');
    expect(stanceFor(0.15, 'contend')).toBe('bubble');
    expect(stanceFor(-0.31)).toBe('rebuild');
    expect(stanceFor(-0.25)).toBe('retool');
    expect(stanceFor(-0.25, 'rebuild')).toBe('rebuild');
    expect(stanceFor(-0.15, 'rebuild')).toBe('retool');
  });

  it("gives every AI team a stance and leaves the user's alone", () => {
    const l = fresh();
    updateStances(tradeContext(l));
    for (const t of l.teams) expect(t.stance === undefined).toBe(t.id === l.userTeamId);
    // A league has both buyers and sellers.
    const modes = new Set(l.teams.filter((t) => t.stance).map(stanceOf));
    expect(modes.has('contend') || modes.has('bubble')).toBe(true);
    expect(modes.has('retool') || modes.has('rebuild')).toBe(true);
  });

  it('sees a hole where a team has no healthy starter', () => {
    const l = fresh();
    const team = l.teams[7];
    for (const p of Object.values(l.players)) if (p.teamId === team.id && p.position === 'QB') p.ir = { season: l.season, week: l.week, weeks: 8 };
    const needs = teamNeeds(tradeContext(l), team);
    expect(needs.find((n) => n.position === 'QB')).toMatchObject({ urgency: 1, reason: 'hole' });
  });

  it("never puts an untouchable on the block, and a contender's starting quarterback is one", () => {
    const l = fresh();
    const ctx = tradeContext(l);
    updateStances(ctx);
    for (const t of l.teams.filter((x) => x.id !== l.userTeamId)) {
      const keep = untouchables(ctx, t);
      expect(tradeBlock(ctx, t).some((e) => keep.has(e.playerId))).toBe(false);
    }
    const contender = l.teams.find((t) => t.id !== l.userTeamId && stanceOf(t) === 'contend');
    if (contender) {
      const qb = Object.values(l.players)
        .filter((p) => p.teamId === contender.id && p.position === 'QB')
        .sort((a, b) => ctx.view(contender.id, b).ovr - ctx.view(contender.id, a).ovr)[0];
      if (qb && ctx.view(contender.id, qb).ovr >= 14) expect(untouchables(ctx, contender).has(qb.id)).toBe(true);
    }
  });

  it('wants more from a division rival', () => {
    const l = fresh();
    const a = l.teams[3];
    const rival = l.teams.find((t) => t.id !== a.id && t.division === a.division)!;
    const other = l.teams.find((t) => t.division !== a.division)!;
    expect(marginFor(a, rival)).toBeGreaterThan(marginFor(a, other));
  });
});

describe('the AI market', () => {
  it('leaves every team legal on the cap and the roster, and never touches the user', () => {
    const l = fresh();
    const made = marketMoment(l, 'deadline');
    expect(made.length).toBeGreaterThan(0);
    for (const r of made) expect(r.sides.some((s) => s.teamId === l.userTeamId)).toBe(false);
    for (const t of l.teams) {
      expect(capSpace(l, t.id)).toBeGreaterThanOrEqual(0);
      expect(activeRoster(l, t.id).length).toBeLessThanOrEqual(rosterLimit(l));
    }
  }, 30_000);

  it('keeps a history and rumors, and files each trade under its tag', () => {
    const l = fresh();
    const made = marketMoment(l, 'deadline');
    expect(l.market!.history.slice(-made.length)).toEqual(made);
    const trades = l.transactions.filter((t) => t.kind === 'trade');
    expect(trades.length).toBeGreaterThanOrEqual(made.length);
    expect(trades.slice(-made.length).every((t) => /\(.+\)$/.test(t.text))).toBe(true);
    // Each rumor is about a team's real business and said once.
    const ids = l.market!.rumors.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const r of l.market!.rumors) expect(r.teamIds.includes(l.userTeamId)).toBe(false);
  }, 30_000);

  it('plays the same market from the same seed', () => {
    const run = () => {
      const l = fresh();
      while (l.week <= 3) playWeek(l);
      return l.market?.history ?? [];
    };
    expect(run()).toEqual(run());
  }, 30_000);

  it('runs on a save from before the market existed', () => {
    const old = fresh() as League;
    old.version = 22;
    delete old.market;
    for (const t of old.teams) delete t.stance;
    const up = migrateLeague(copy(old))!;
    expect(up.version).toBe(SAVE_VERSION);
    expect(() => marketMoment(up, 'week')).not.toThrow();
    expect(up.market).toBeDefined();
  }, 30_000);
});
