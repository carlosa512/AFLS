import { beforeAll, describe, expect, it } from 'vitest';
import { createLeague } from '../generate';
import { playWeek, simToEndOfSeason } from '../league';
import { beginOffseason } from '../offseason';
import type { League } from '../types';
import { ovrOf, rosterOf, tradeContext } from './context';
import { needsOn, scoutedNeeds, starterLine, teamNeeds } from './plans';

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
