import { beforeAll, describe, expect, it } from 'vitest';
import { createLeague } from '../generate';
import { playWeek, simToEndOfSeason } from '../league';
import { beginOffseason } from '../offseason';
import type { League } from '../types';
import { ovrOf, rosterOf, tradeContext } from './context';
import { needSeverity, needsOn, scoutedLine, scoutedNeeds, starterLine, teamNeeds, type Need } from './plans';
import { STARTERS } from '../positions';
import { POSITIONS, type Player, type Position } from '../types';

let inSeason: League;
let offseason: League;
beforeAll(() => {
  inSeason = createLeague({ seed: 'needs-0' });
  playWeek(inSeason);
  playWeek(inSeason);
  offseason = createLeague({ seed: 'needs-1' });
  simToEndOfSeason(offseason);
  beginOffseason(offseason);
});

describe("a team's needs", () => {
  it('needsOn with true ratings is teamNeeds, in season and in the offseason', () => {
    for (const l of [inSeason, offseason]) {
      const ctx = tradeContext(l);
      for (const t of l.teams)
        expect(needsOn(l, rosterOf(ctx, t.id), starterLine(ctx), (p) => ovrOf(ctx, p))).toEqual(teamNeeds(ctx, t));
    }
  });

  it("reads a rival's needs through your scouts, and flags a team they barely know", () => {
    const l = createLeague({ seed: 'needs-film' });
    const ctx = tradeContext(l);
    const rival = l.teams.find((t) => t.id !== l.userTeamId)!;
    // Scouts start the league knowing most starters: blank out the film on this one club.
    const view = ctx.view;
    ctx.view = (teamId, p) => (p.teamId === rival.id ? { ...view(teamId, p), knowledge: 0.2 } : view(teamId, p));
    const read = scoutedNeeds(ctx, l.userTeamId, rival);
    expect(read.littleFilm).toBe(true);
    expect(read.needs.every((n) => Number.isFinite(n.urgency))).toBe(true);
    expect(scoutedNeeds(ctx, l.userTeamId, l.teams[l.userTeamId]).littleFilm).toBe(false);
  });

  it('calls an empty position a hole on any read', () => {
    const l = createLeague({ seed: 'needs-hole' });
    const rival = l.teams.find((t) => t.id !== l.userTeamId)!;
    for (const p of Object.values(l.players)) if (p.teamId === rival.id && p.position === 'K') p.teamId = null;
    const read = scoutedNeeds(tradeContext(l), l.userTeamId, rival);
    expect(read.needs.find((n) => n.position === 'K')?.reason).toBe('hole');
  });
});

describe('scheme counts', () => {
  const l = createLeague({ seed: 'needs-scheme' });
  l.phase = 'draft';
  const ctx = tradeContext(l);
  const roster = rosterOf(ctx, l.teams[0].id);
  const tes = roster.filter((p) => p.position === 'TE').sort((a, b) => b.id - a.id);
  // Everyone reads 15 but the tight ends behind the best one, who read 5; the line is 12 everywhere.
  const ovr = (p: Player) => (p.position === 'TE' && p !== tes[0] ? 5 : 15);
  const line = Object.fromEntries(POSITIONS.map((p) => [p, 12])) as Record<Position, number>;
  const at = (pos: Position, xs: Need[]) => xs.find((n) => n.position === pos);

  it('measures the S-th starter when a scheme starts more at a position', () => {
    expect(at('TE', needsOn(l, roster, line, ovr))?.reason).not.toBe('upgrade');
    expect(at('TE', needsOn(l, roster, line, ovr, { ...STARTERS, TE: 2 }))?.reason).toBe('upgrade');
  });

  it('skips a position the scheme starts nobody at', () => {
    expect(at('TE', needsOn(l, roster, line, ovr, { ...STARTERS, TE: 0 }))).toBeUndefined();
  });

  it("pools each team's top S for the viewer's line; the default is scoutedNeeds' own", () => {
    const v = l.userTeamId;
    expect(scoutedLine(ctx, v)).toEqual(scoutedLine(ctx, v, STARTERS));
    expect(scoutedLine(ctx, v, { ...STARTERS, TE: 2 }).TE).toBeLessThanOrEqual(scoutedLine(ctx, v).TE);
    const seen = (p: Player) => ctx.view(v, p).ovr;
    for (const t of l.teams)
      expect(scoutedNeeds(ctx, v, t).needs).toEqual(needsOn(l, rosterOf(ctx, t.id), scoutedLine(ctx, v), seen));
  });

  it('reads severity on one scale for every position: a hole is 1', () => {
    for (const pos of POSITIONS) {
      const hole = at(
        pos,
        needsOn(
          l,
          roster.filter((p) => p.position !== pos),
          line,
          ovr,
        ),
      );
      expect(hole?.reason).toBe('hole');
      expect(needSeverity(hole!)).toBe(1);
    }
  });
});
