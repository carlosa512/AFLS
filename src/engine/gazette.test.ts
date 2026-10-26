import { beforeAll, describe, expect, it } from 'vitest';
import { editionAt, gazetteFor, lastColumnWeek, playerAdvanced } from './gazette';
import { createLeague } from './generate';
import { playWeek } from './league';
import type { League } from './types';

const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v));
/** A league after `weeks` weeks of games, one week at a time as the game plays them. */
function after(base: League, weeks: number) {
  const l = copy(base);
  while (l.week <= weeks) playWeek(l);
  return l;
}

describe('the Gazette’s editions', () => {
  let week4: League, week7: League;
  beforeAll(() => {
    const base = createLeague({ seed: 'gazette' });
    week4 = after(base, 4);
    week7 = after(week4, 7);
  }, 120_000);

  it('files each column once, at its moment', () => {
    expect(editionAt(week4)).toBe('w4');
    expect(editionAt(week7)).toBe('w7');
    const between = after(week4, 5);
    expect(editionAt(between)).toBeNull();
  }, 60_000);
  it('never files late after a long sim', () => {
    // Weeks 8 and 9 played in one go: week 7's column is gone, and week 9 has none.
    expect(editionAt(after(week7, 9))).toBeNull();
  }, 60_000);
  it('writes a story and tables, always showing our club', () => {
    const g = gazetteFor(week4)!;
    expect(g.edition).toBe('w4');
    expect(g.subject.length).toBeGreaterThan(10);
    expect(g.body.split('\n\n').length).toBeGreaterThanOrEqual(2);
    expect(g.tables.length).toBeGreaterThanOrEqual(2);
    for (const t of g.tables.filter((t) => !t.players))
      expect(t.rows.some((r) => r.teamId === week4.userTeamId)).toBe(true);
    expect(g.body).toMatch(/sit \d+(st|nd|rd|th) on offense and \d+(st|nd|rd|th) on defense\./);
  });
  it('keeps players under the sample out of the player tables', () => {
    const g = gazetteFor(week4)!;
    const players = playerAdvanced(week4, week4.season);
    for (const t of g.tables.filter((t) => t.players))
      for (const r of t.rows) {
        const p = players.get(r.playerId!)!;
        if (t.unit === 'perDropback') expect(p.dropbacks).toBeGreaterThanOrEqual(12 * p.games);
        if (t.unit === 'rushSuccess') expect(p.rushAtt).toBeGreaterThanOrEqual(6 * p.games);
        if (t.unit === 'pressureRate') expect(p.rushSnaps).toBeGreaterThanOrEqual(15 * p.games);
      }
  });
  it('changes themes between consecutive columns', () => {
    const a = gazetteFor(week4)!.tables.map((t) => t.title);
    const b = gazetteFor(week7)!.tables.map((t) => t.title);
    expect(a.filter((x) => b.includes(x)).length).toBeLessThanOrEqual(1);
  });
  it('leads with a runaway leader when there is one', () => {
    const l = copy(week4);
    const star = l.teams.find((t) => t.id !== l.userTeamId)!;
    for (const g of l.games)
      if (g.result?.home.adv && g.season === l.season) {
        if (g.homeId === star.id) g.result.home.adv.epa += 40;
        if (g.awayId === star.id) g.result.away.adv!.epa += 40;
      }
    expect(gazetteFor(l)!.subject).toContain(star.name);
  });
  it('names a stingy defense as the best, not as the one allowing the most', () => {
    const l = copy(week7);
    const wall = l.teams.find((t) => t.id !== l.userTeamId)!;
    for (const g of l.games)
      if (g.result?.home.adv && g.season === l.season) {
        if (g.homeId === wall.id) g.result.away.adv!.epa -= 40;
        if (g.awayId === wall.id) g.result.home.adv.epa -= 40;
      }
    const { subject } = gazetteFor(l)!;
    expect(subject).toContain(wall.name);
    expect(subject).toContain('defense');
    expect(subject).not.toContain('allowed');
  });
  it('never claims a cause the numbers can’t show', () => {
    for (const l of [week4, week7])
      expect(gazetteFor(l)!.body).not.toMatch(/\bwhy\b|score their way|keeps them in games/);
  });
  it('compares only with a column that was actually filed', () => {
    expect(lastColumnWeek(week7)).toBeNull(); // nothing was delivered in this league
    const l = copy(week7);
    l.inbox = [
      {
        id: `gazette:${l.season}:w4`,
        season: l.season,
        phase: 'regular',
        week: 4,
        from: 'The Arena Gazette',
        category: 'league',
        subject: 's',
        body: 'b',
        read: true,
        actions: [],
      },
    ];
    expect(lastColumnWeek(l)).toBe(4);
    expect(gazetteFor(week7)!.body).not.toMatch(/Since the/);
  });
  it('shows our best qualifying player in a player table, wherever he ranks', () => {
    const qb = gazetteFor(week4)!.tables.find((t) => t.unit === 'perDropback')!;
    const ours = [...playerAdvanced(week4, week4.season).entries()].filter(
      ([, p]) => p.teamId === week4.userTeamId && p.dropbacks >= 12 * p.games,
    );
    if (ours.length) expect(qb.rows.some((r) => r.teamId === week4.userTeamId)).toBe(true);
  });
  it('samples a player on the games he played', () => {
    const players = playerAdvanced(week4, week4.season);
    const [id, p] = [...players.entries()].find(([, x]) => x.dropbacks > 0)!;
    const played = week4.games.filter(
      (g) => g.season === week4.season && !g.playoffRound && g.result?.home.adv && g.result.playerStats[id],
    ).length;
    expect(p.games).toBe(played);
  });
  it('says nothing it cannot support when older games have no numbers', () => {
    const l = copy(week4);
    for (const g of l.games)
      if (g.season === l.season && g.week <= 3 && g.result) {
        delete g.result.home.adv;
        delete g.result.away.adv;
      }
    // A club without enough counted games: no team tables, so no column.
    expect(gazetteFor(l)).toBeNull();
  });
});
