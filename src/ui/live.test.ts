import { describe, expect, it, vi } from 'vitest';
import { createLeague } from '../engine/generate';
import type { PlayLogEntry } from '../engine/types';

// The live session records through the store, which reaches IndexedDB; this test never finishes a game.
vi.mock('./store', () => ({ store: { mutate: () => {} } }));
const { live } = await import('./live');

const bigMoment = (plays: PlayLogEntry[], i: number) => plays[i].kind === 'fg' || /TOUCHDOWN/.test(plays[i].text);

describe('live highlights', () => {
  it('skipTo lands on the play before the next highlight, pulling plays from the engine', () => {
    const league = createLeague({ seed: 'live-skip' });
    const game = league.games.find((g) => g.week === 1)!;
    live.start(league, game);
    const before = live.get()!.current;
    expect(live.skipTo(bigMoment)).toBe(true);
    const s = live.get()!;
    expect(s.current).toBeGreaterThan(before);
    expect(s.still).toBe(true);
    // The next play is the highlight, and nothing before it was one.
    expect(bigMoment(s.plays, s.current + 1)).toBe(true);
    for (let i = before + 1; i <= s.current; i++) expect(bigMoment(s.plays, i)).toBe(false);
    // Stepping on plays it, in motion.
    expect(live.advance()).toBe(true);
    expect(live.get()!.still).toBe(false);
    expect(bigMoment(live.get()!.plays, live.get()!.current)).toBe(true);
    live.clear();
  });

  it('skipTo moves nothing when the next play is already a highlight', () => {
    const league = createLeague({ seed: 'live-skip' });
    live.start(league, league.games.find((g) => g.week === 1)!);
    expect(live.skipTo(() => true)).toBe(false);
    expect(live.get()!.current).toBe(0);
    live.clear();
  });
});

describe('looking a play ahead', () => {
  it('pulls the next play from the engine without showing it', () => {
    const league = createLeague({ seed: 'live-peek' });
    live.start(league, league.games.find((g) => g.week === 1)!);
    // Walk to the last play pulled so far: nothing is known past it until the engine is asked.
    while (live.get()!.current < live.get()!.plays.length - 1) live.advance();
    const s = live.get()!;
    const at = s.current;
    expect(s.plays[at + 1]).toBeUndefined();
    const next = live.peek();
    expect(next).toBeDefined();
    expect(live.get()!.current).toBe(at);
    expect(live.get()!.plays[at + 1]).toBe(next);
    // The play it peeked at is the one stepping on shows.
    live.advance();
    expect(live.get()!.plays[live.get()!.current]).toBe(next);
    live.clear();
  });

  it('lets the screen see a period end as it happens: the half is known at the second quarter’s last play', () => {
    const league = createLeague({ seed: 'live-peek' });
    live.start(league, league.games.find((g) => g.week === 1)!);
    let guard = 0;
    while (guard++ < 400) {
      live.peek();
      const s = live.get()!;
      if (s.plays[s.current].quarter === 2 && s.plays[s.current + 1]?.quarter === 3) break;
      if (!live.advance()) break;
    }
    const s = live.get()!;
    expect(s.plays[s.current].quarter).toBe(2);
    expect(s.plays[s.current + 1].quarter).toBe(3);
    live.clear();
  });
});
