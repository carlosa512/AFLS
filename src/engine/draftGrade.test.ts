import { describe, expect, it } from 'vitest';
import { lockVerdicts, pickMark, verdictFor } from './draftGrade';
import { createLeague } from './generate';
import { migrateLeague } from './migrate';
import type { League, Player } from './types';

const copy = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

/** Three players from the league, given picks in drafts this league held (with the consensus read kept). */
function drafted(league: League, seasons: number[]): Player[] {
  const ps = Object.values(league.players)
    .filter((p) => p.teamId !== null)
    .slice(0, seasons.length);
  ps.forEach((p, i) => {
    p.draft = { season: seasons[i], round: 1 + i, pick: 10 + 32 * i, teamId: p.teamId!, rank: 10 };
    p.scouting = { grade: 10, ceiling: 13 };
    p.experience = league.season - seasons[i];
  });
  return ps;
}

describe('verdictFor', () => {
  it('judges a pick against its round: steal two levels over the bar, hit at it, miss under it', () => {
    expect(verdictFor(1, 1)).toBe('hit');
    expect(verdictFor(1, 0)).toBe('hit');
    expect(verdictFor(1, 2)).toBe('miss');
    expect(verdictFor(2, 0)).toBe('steal');
    expect(verdictFor(2, 2)).toBe('hit');
    expect(verdictFor(2, 3)).toBe('miss');
    expect(verdictFor(3, 1)).toBe('steal');
    expect(verdictFor(4, 2)).toBe('steal');
    expect(verdictFor(7, 4)).toBe('hit');
    expect(verdictFor(7, 5)).toBe('miss');
  });
});

describe('pickMark', () => {
  it('has nothing to say about a player from no draft this league held', () => {
    const league = createLeague({ seed: 'dg-mark' });
    const [p] = drafted(league, [league.season]);
    delete p.scouting;
    expect(pickMark(league, p)).toBeNull();
    delete p.draft;
    expect(pickMark(league, p)).toBeNull();
  });

  it('is too early before his rookie season is in, a live lean after, and the stored verdict once locked', () => {
    const league = createLeague({ seed: 'dg-mark' });
    const [p] = drafted(league, [league.season]);
    delete p.ceilingShifts;
    expect(pickMark(league, p)).toEqual({ verdict: null, locked: false });
    p.experience = 1;
    const live = pickMark(league, p)!;
    expect(live.locked).toBe(false);
    expect(['steal', 'hit', 'miss']).toContain(live.verdict);
    p.draft!.verdict = 'miss';
    expect(pickMark(league, p)).toEqual({ verdict: 'miss', locked: true });
  });
});

describe('lockVerdicts', () => {
  it('locks picks three league years back, retired players too, and never rewrites one', () => {
    const league = createLeague({ seed: 'dg-lock' });
    const s = league.season;
    const [old, recent, gone] = drafted(league, [s - 3, s - 2, s - 3]);
    gone.retired = true;
    lockVerdicts(league);
    expect(old.draft!.verdict).toBeDefined();
    expect(gone.draft!.verdict).toBeDefined();
    expect(recent.draft!.verdict).toBeUndefined();
    const other = old.draft!.verdict === 'miss' ? 'hit' : 'miss';
    old.draft!.verdict = other;
    lockVerdicts(league);
    expect(old.draft!.verdict).toBe(other);
  });

  it('skips a made-up draft line from before the league (no consensus read)', () => {
    const league = createLeague({ seed: 'dg-lock' });
    const [p] = drafted(league, [league.season - 5]);
    delete p.scouting;
    lockVerdicts(league);
    expect(p.draft!.verdict).toBeUndefined();
  });

  it('a v58 save locks its old picks on load', () => {
    const league = createLeague({ seed: 'dg-migrate' });
    const [old, recent] = drafted(league, [league.season - 4, league.season - 1]);
    const saved = copy(league);
    saved.version = 58;
    const loaded = migrateLeague(saved)!;
    expect(loaded.version).toBe(59);
    expect(loaded.players[old.id].draft!.verdict).toBeDefined();
    expect(loaded.players[recent.id].draft!.verdict).toBeUndefined();
  });
});
