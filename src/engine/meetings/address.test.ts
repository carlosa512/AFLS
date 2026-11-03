import { describe, expect, it } from 'vitest';
import { createLeague } from '../generate';
import { moraleContext, YEAR } from '../morale';
import { activeRoster } from '../roster';
import type { League, MeetingSuggestion } from '../types';
import { addressSuggestion, gmAddressOpen, gmTerms, holdGmAddress } from './address';
import { joltSize, outcomeEntries, reactionScore } from './react';
import { headCoachOf } from './suggest';

const base = createLeague({ seed: 'meetings-address' });
const TEAM = 0;

function league(week = 8): League {
  const l = structuredClone(base);
  l.phase = 'regular';
  l.week = week;
  l.moraleAt = l.season * YEAR + 8 + week;
  for (const p of Object.values(l.players)) if (p.morale) p.morale = { level: 0.5 };
  return l;
}

/** The club's first `n` games this season played and lost, the rest unplayed. */
function lose(l: League, n: number) {
  const result = structuredClone(base.games.find((g) => g.result)?.result ?? l.games[0].result) as never;
  const games = l.games
    .filter((g) => g.season === l.season && !g.playoffRound && (g.homeId === TEAM || g.awayId === TEAM))
    .sort((a, b) => a.week - b.week);
  for (const g of games.slice(0, n))
    g.result = {
      ...(result as object),
      homeScore: g.homeId === TEAM ? 3 : 30,
      awayScore: g.homeId === TEAM ? 30 : 3,
    } as never;
}

describe('meetings: the GM address', () => {
  it('opens on a four-game losing streak, not on three', () => {
    const three = league();
    lose(three, 3);
    expect(gmAddressOpen(three, TEAM)).toBe(false);
    const four = league();
    lose(four, 4);
    expect(gmAddressOpen(four, TEAM)).toBe(true);
  });

  it('opens once a season', () => {
    const l = league();
    lose(l, 4);
    l.teams[TEAM].meetings!.gmAddressSeason = l.season;
    expect(gmAddressOpen(l, TEAM)).toBe(false);
  });

  it('offers a fresh start only right after a firing', () => {
    const l = league();
    lose(l, 4);
    const ctx = moraleContext(l);
    expect(addressSuggestion(l, TEAM, ctx).approaches).not.toContain('freshStart');
    const hc = headCoachOf(l, TEAM)!;
    hc.interim = true;
    hc.interimAppointments = [{ season: l.season, teamId: TEAM, week: l.week }];
    expect(gmAddressOpen(l, TEAM)).toBe(true);
    const s = addressSuggestion(l, TEAM, ctx);
    expect(s.approaches).toEqual(['ownIt', 'raiseBar', 'freshStart']);
    expect(s.kind).toBe('gm');
    expect(s.scope).toBe('team');
    expect(s.timings).toEqual(['monday']);
    expect(s.backings).toEqual(['jobs', 'move', 'words']);
    l.week += 3;
    expect(addressSuggestion(l, TEAM, ctx).approaches).not.toContain('freshStart');
  });

  it('kept promises score higher than broken ones', () => {
    const l = league();
    const [a, b] = activeRoster(l, TEAM);
    a.morale = { level: 0.5, talk: { club: TEAM, kept: 2 } };
    b.morale = { level: 0.5, talk: { club: TEAM, broken: 1 } };
    b.traits = { ...a.traits };
    b.personality = { ...a.personality };
    b.experience = a.experience;
    const ctx = moraleContext(l);
    const s = addressSuggestion(l, TEAM, ctx);
    const choice = { approach: 'ownIt' as const, backing: 'words' as const, timing: 'monday' as const };
    const terms = gmTerms(l, choice);
    expect(reactionScore(l, TEAM, a, s, choice, ctx, terms)).toBeGreaterThan(
      reactionScore(l, TEAM, b, s, choice, ctx, terms),
    );
  });

  it("its jolts are twice a Monday coach meeting's, and it's spent for the season", () => {
    const monday = { approach: 'straight' as const, backing: 'words' as const, timing: 'monday' as const };
    expect(joltSize({ kind: 'gm' } as MeetingSuggestion, { ...monday, approach: 'ownIt' })).toBe(
      2 * joltSize({ kind: 'trouble' } as MeetingSuggestion, monday),
    );
    const l = league();
    lose(l, 4);
    l.teams[TEAM].meetings!.pending = addressSuggestion(l, TEAM, moraleContext(l));
    const r = holdGmAddress(l, TEAM, { approach: 'raiseBar', backing: 'words', timing: 'monday' });
    expect(r.kind).toBe('gm');
    expect(l.teams[TEAM].meetings!.gmAddressSeason).toBe(l.season);
    expect(gmAddressOpen(l, TEAM)).toBe(false);
    for (const [id, o] of outcomeEntries(r)) {
      const j = l.players[Number(id)].morale!.jolts!.find((j) => j.kind === 'meeting')!;
      expect(j.size).toBe(o === 'lands' ? 4 : -4);
    }
  });
});
