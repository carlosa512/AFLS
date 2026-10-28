import { describe, expect, it } from 'vitest';
import {
  clockState,
  GAP_LINE,
  lockVerdicts,
  pickMark,
  riskOf,
  staffBoardValue,
  staffGaps,
  verdictFor,
  verdictRecord,
} from './draftGrade';
import { createLeague, SAVE_VERSION } from './generate';
import { migrateLeague } from './migrate';
import { advanceOffseason, beginOffseason } from './offseason';
import { availableProspects, draftPlayer, generateDraftClass, nextPick, simDraft } from './offseason/draft';
import { simToEndOfSeason } from './league';
import { Rng } from './rng';
import { perceive, type PlayerView } from './scouting';
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
    expect(loaded.version).toBe(SAVE_VERSION);
    expect(loaded.players[old.id].draft!.verdict).toBeDefined();
    expect(loaded.players[recent.id].draft!.verdict).toBeUndefined();
  });
});

/** A view with just what the risk read looks at. */
const view = (ovr: number, potMid: number, potHi: number, potSd: number) =>
  ({ ovr, potMid, potHi, potSd }) as PlayerView;

describe('riskOf', () => {
  it('calls a ready, well-read prospect safe and a raw or loosely read one boom-or-bust', () => {
    expect(riskOf(view(12, 12.5, 13, 1.4)).word).toBe('safe');
    expect(riskOf(view(8, 14, 17, 1.6)).word).toBe('boom-or-bust');
    expect(riskOf(view(11, 12, 15, 2.6)).word).toBe('boom-or-bust');
    expect(riskOf(view(10, 14, 16, 2)).word).toBeNull();
    const r = riskOf(view(10, 14, 16, 2));
    expect(r.lo).toBeLessThanOrEqual(r.mid);
    expect(r.mid).toBeLessThanOrEqual(r.hi);
  });

  it('gives each word to roughly a fifth of a class', () => {
    const l = createLeague({ seed: 'risk' });
    generateDraftClass(l, new Rng('risk-class'));
    const words = availableProspects(l).map((p) => riskOf(perceive(l, l.userTeamId, p)).word);
    const share = (w: string) => words.filter((x) => x === w).length / words.length;
    expect(share('safe')).toBeGreaterThan(0.12);
    expect(share('safe')).toBeLessThan(0.3);
    expect(share('boom-or-bust')).toBeGreaterThan(0.12);
    expect(share('boom-or-bust')).toBeLessThan(0.3);
  });
});

describe('staffGaps', () => {
  const classOf = (seed: string) => {
    const l = createLeague({ seed });
    generateDraftClass(l, new Rng(`${seed}-class`));
    return l;
  };

  it('ranks a small pool on both boards, the gaps summing to nothing', () => {
    const l = classOf('gap-small');
    const pool = availableProspects(l).slice(0, 3);
    const gaps = [...staffGaps(l, pool).values()];
    expect(gaps.map((g) => g.ours).sort()).toEqual([1, 2, 3]);
    expect(gaps.map((g) => g.consensus).sort()).toEqual([1, 2, 3]);
    expect(gaps.reduce((s, g) => s + g.diff, 0)).toBe(0);
    expect(gaps.every((g) => g.tag === null)).toBe(true);
  });

  it('marks a prospect the staff likes a dozen spots more than the league a sleeper, and the reverse a fade', () => {
    const l = classOf('gap-big');
    const pool = availableProspects(l).slice(0, 40);
    // Our top prospect, whom the consensus ranks 20th of the 40.
    const byOurs = [...pool].sort((a, b) => staffBoardValue(l, b) - staffBoardValue(l, a));
    const star = byOurs[0];
    const others = pool.filter((p) => p !== star);
    // Five points a rank: wider than any position's premium, so the consensus order is the one set here.
    others.forEach((p, i) => (p.scouting = { grade: 200 - 5 * i, ceiling: 200 - 5 * i }));
    star.scouting = { grade: 200 - 5 * 18.5, ceiling: 200 - 5 * 18.5 };
    const g = staffGaps(l, pool).get(star.id)!;
    expect(g.ours).toBe(1);
    expect(g.consensus).toBe(20);
    expect(g).toMatchObject({ diff: 19, tag: 'sleeper' });
    const fade = [...staffGaps(l, pool).values()].find((x) => x.diff <= -GAP_LINE);
    if (fade) expect(fade.tag).toBe('fade');
  });
});

describe('clockState', () => {
  /** One league played through a season, cloned per test. */
  const played = (() => {
    const league = createLeague({ seed: 'clock' });
    simToEndOfSeason(league);
    return JSON.stringify(league);
  })();
  const fresh = (): League => JSON.parse(played);
  const toDraft = () => {
    const l = fresh();
    beginOffseason(l);
    while (l.phase !== 'draft') advanceOffseason(l);
    return l;
  };

  it('has no class to show in a new league before its first offseason', () => {
    const l = createLeague({ seed: 'clock-new' });
    expect(l.draftClass).toHaveLength(0);
    expect(clockState(l)).toEqual({ kind: 'none' });
  });

  it("previews the class before the draft, with the user's first pick", () => {
    const l = fresh();
    beginOffseason(l);
    const s = clockState(l);
    expect(s.kind).toBe('preview');
    if (s.kind !== 'preview') return;
    expect(s.prospects).toBe(availableProspects(l).length);
    expect(s.firstPick?.ownerId).toBe(l.userTeamId);
  });

  it("puts the user on the clock when the next pick is theirs, and counts the draft done when it's over", () => {
    const l = toDraft();
    simDraft(l, new Rng('clock-draft'), { stopAtUser: true });
    const s = clockState(l);
    expect(s).toMatchObject({ kind: 'live', userUp: true });
    if (s.kind === 'live') expect(s.pick).toBe(nextPick(l));
    for (let pick = nextPick(l); pick; pick = nextPick(l)) draftPlayer(l, pick, availableProspects(l)[0]);
    expect(clockState(l)).toEqual({ kind: 'done' });
  });
});

describe('verdictRecord', () => {
  it("counts the user's locked picks by draft year, newest first, and leaves out the rest", () => {
    const league = createLeague({ seed: 'dg-record' });
    const s = league.season;
    const ps = drafted(league, [s - 4, s - 4, s - 3, s - 3, s - 1]);
    for (const p of ps) p.draft!.teamId = league.userTeamId;
    ps[0].draft!.verdict = 'steal';
    ps[1].draft!.verdict = 'miss';
    ps[2].draft!.verdict = 'hit';
    ps[3].draft!.teamId = (league.userTeamId + 1) % 32;
    ps[3].draft!.verdict = 'hit';
    expect(verdictRecord(league, league.userTeamId)).toEqual([
      { season: s - 3, steal: 0, hit: 1, miss: 0 },
      { season: s - 4, steal: 1, hit: 0, miss: 1 },
    ]);
  });
});
