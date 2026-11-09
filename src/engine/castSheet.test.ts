import { describe, expect, it } from 'vitest';
import { coachSheet, manSheet, momentSheet, whenWords } from './castSheet';
import { teamCoaches } from './coaching';
import { createLeague } from './generate';
import { moraleClock, moraleContext, YEAR } from './morale';
import { teamPlayers } from './roster';

const make = () => {
  const l = createLeague({ seed: 'cast-sheet' });
  const ctx = moraleContext(l);
  const mine = teamPlayers(l, l.userTeamId).filter((p) => !p.retired);
  const other = Object.values(l.players).find((p) => p.teamId !== null && p.teamId !== l.userTeamId)!;
  return { l, ctx, p: mine[0], other };
};

/** Fails on any number except the id. */
const walk = (v: unknown, path: string): void => {
  if (typeof v === 'number') expect(path).toBe('.id');
  else if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${path}[${i}]`));
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, `${path}.${k}`);
};

describe('the cast sheet', () => {
  it('holds no number but the id', () => {
    const { l, ctx, p } = make();
    const hc = teamCoaches(l, l.userTeamId).find((c) => c.role === 'headCoach')!;
    walk(manSheet(l, p, ctx), '');
    walk(momentSheet(l), '');
    walk(coachSheet(l, hc), '');
  });

  it('gives nothing for another club’s player', () => {
    const { l, ctx, other } = make();
    expect(manSheet(l, other, ctx)).toBeNull();
  });

  it('hedges a loose personality read and names none when unknown', () => {
    const { l, ctx } = make();
    const sheets = teamPlayers(l, l.userTeamId).map((p) => manSheet(l, p, ctx)!);
    const reads = sheets.map((s) => s.personality);
    // Every read is a name and a hedge flag, or null where the staff don't know him yet; never a bare number.
    for (const r of reads)
      expect(r === null || (typeof r.name === 'string' && typeof r.hedged === 'boolean')).toBe(true);
    expect(reads.some((r) => r !== null)).toBe(true);
  });

  it('reads history with you from his talk record', () => {
    const { l, ctx, p } = make();
    const week8 = l.season * YEAR + 8 + 8 - 1;
    p.morale = {
      level: 0,
      talk: {
        club: l.userTeamId,
        reassured: 1,
        answered: { reply: 'reassure', at: week8, ask: week8 - 1, cause: 'deal' },
      },
    };
    const s = manSheet(l, p, ctx)!;
    expect(s.asks).toBe('second');
    expect(s.lastAnswer).toEqual({ reply: 'reassure', when: 'in week 8', cause: 'deal' });
  });

  it('puts a clock in the coach’s words', () => {
    const { l } = make();
    const y = l.season * YEAR;
    expect(whenWords(l, y + 7)).toBe('at camp');
    expect(whenWords(l, y + 2)).toBe('over the winter');
    expect(whenWords(l, y - YEAR + 12)).toBe('last season');
    expect(whenWords(l, y + 30)).toBe('in the playoffs');
  });

  it('knows the season is over for a club with no game left', () => {
    const { l } = make();
    expect(momentSheet(l).seasonOver).toBe(false);
    l.phase = 'complete';
    expect(momentSheet(l).seasonOver).toBe(true);
    l.phase = 'playoffs';
    for (const g of l.games)
      if (g.season === l.season && (g.homeId === l.userTeamId || g.awayId === l.userTeamId)) g.result = undefined;
    expect(momentSheet(l).seasonOver).toBe(false);
    l.games = l.games.filter((g) => g.season !== l.season || (g.homeId !== l.userTeamId && g.awayId !== l.userTeamId));
    expect(momentSheet(l).seasonOver).toBe(true);
    expect(moraleClock(l)).toBeGreaterThan(0);
  });
});
