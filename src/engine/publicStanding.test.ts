/**
 * Who is a star, in public, out of season: last season's honors, a top-five place in a major stat, a winning club's
 * passer; a starter by his snaps; a high pick by his draft. And the transaction log names the player a release or a
 * pick is about, which the big-day editions read.
 */
import { describe, expect, it } from 'vitest';
import { releasePlayer } from './finance/cap';
import { createLeague } from './generate';
import { draftedHigh, publicStanding, STANDING, standingReader } from './publicStanding';
import { activeRoster } from './roster';

describe('public standing', () => {
  it('reads a star from last season’s public record', () => {
    const l = createLeague({ seed: 'standing' });
    const last = l.season - 1;
    for (const p of Object.values(l.players)) p.stats = {};
    const [a, b, c] = activeRoster(l, 0).filter((p) => p.position !== 'QB');
    // An All-League place, a top-five place in a major stat, and neither.
    l.awards = [{ season: last, winners: {}, allLeague: [[{ playerId: a.id, teamId: 0 }], []] }];
    b.stats[last] = { gp: 17, snaps: 900, recYds: 99999 };
    c.stats[last] = { gp: 12, snaps: 600 };
    const read = standingReader(l, last);
    expect(read(a)).toBe('star');
    expect(read(b)).toBe('star');
    expect(read(c)).toBe('starter');
    c.stats[last] = { gp: 12, snaps: STANDING.snaps - 1 };
    expect(standingReader(l, last)(c)).toBe('depth');
  });

  it('calls a winning club’s passer a star, and a losing club’s only a starter', () => {
    const l = createLeague({ seed: 'standing-qb' });
    const last = l.season - 1;
    for (const p of Object.values(l.players)) p.stats = {};
    l.awards = [];
    const qb = (teamId: number) => activeRoster(l, teamId).find((p) => p.position === 'QB')!;
    const [won, lost] = [qb(2), qb(3)];
    for (const [p, teamId] of [
      [won, 2],
      [lost, 3],
    ] as const) {
      p.stats[last] = { gp: 17, snaps: 1000, passAtt: 500 };
      p.statTeams = { [last]: [teamId] };
    }
    l.history = [
      { season: last, championId: 0, runnerUpId: 1, records: { 2: { w: 11, l: 6, t: 0 }, 3: { w: 5, l: 12, t: 0 } } },
    ];
    const read = standingReader(l, last);
    expect(read(won)).toBe('star');
    expect(read(lost)).toBe('starter');
  });

  it('a league with no last season calls nobody a star and throws nothing', () => {
    const l = createLeague({ seed: 'standing-0' });
    l.awards = [];
    l.history = [];
    for (const p of Object.values(l.players)) p.stats = {};
    expect(Object.values(l.players).every((p) => publicStanding(l, p) === 'depth')).toBe(true);
  });

  it('knows a high pick of the last three drafts', () => {
    const l = createLeague({ seed: 'standing-d' });
    const p = activeRoster(l, 0)[0];
    p.draft = { season: l.season - 2, round: 2, pick: 40, teamId: 0 };
    expect(draftedHigh(l, p)).toBe(true);
    p.draft = { season: l.season - 4, round: 1, pick: 3, teamId: 0 };
    expect(draftedHigh(l, p)).toBe(false);
    p.draft = { season: l.season, round: 3, pick: 70, teamId: 0 };
    expect(draftedHigh(l, p)).toBe(false);
  });

  it('logs the player on a release', () => {
    const l = createLeague({ seed: 'standing-t' });
    const p = activeRoster(l, 1).at(-1)!;
    releasePlayer(l, p);
    expect(l.transactions.at(-1)).toMatchObject({ kind: 'release', playerId: p.id });
  });
});
