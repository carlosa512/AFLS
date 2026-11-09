import { beforeEach, describe, expect, it } from 'vitest';
import { createLeague } from './generate';
import { beat, closeStory, COACH, MAX_BEATS, markTold, STORIES, storiesNewYear, storyById, untold } from './stories';

beforeEach(() => {
  STORIES.on = true;
});

describe('the story store', () => {
  it('opens a story on the first beat and adds to it after', () => {
    const l = createLeague({ seed: 'stories' });
    const on = { kind: 'deal' as const, teamId: l.userTeamId, playerId: 7 };
    const s = beat(l, on, 'asked', 100)!;
    expect(beat(l, on, 'answered', 101, { how: 'reassure' })).toBe(s);
    expect(s.beats.map((b) => b.kind)).toEqual(['asked', 'answered']);
    expect(l.stories!.open).toHaveLength(1);
    expect(storyById(l, s.id)).toBe(s);
  });

  it('records one beat for the same kind at the same clock, and sets or clears the due clock', () => {
    const l = createLeague({ seed: 'stories-dup' });
    const on = { kind: 'deal' as const, teamId: l.userTeamId, playerId: 7 };
    const s = beat(l, on, 'asked', 100, { due: 120 })!;
    beat(l, on, 'asked', 100);
    expect(s.beats).toHaveLength(1);
    expect(s.due).toBe(120);
    beat(l, on, 'answered', 101, { due: null });
    expect(s.due).toBeUndefined();
  });

  it('records nothing for another club, between jobs, or switched off', () => {
    const l = createLeague({ seed: 'stories-off' });
    const other = { kind: 'deal' as const, teamId: (l.userTeamId + 1) % l.teams.length, playerId: 7 };
    expect(beat(l, other, 'asked', 1)).toBeNull();
    const mine = { ...other, teamId: l.userTeamId };
    STORIES.on = false;
    expect(beat(l, mine, 'asked', 1)).toBeNull();
    STORIES.on = true;
    const gm = l.gms[l.userGmId];
    const was = gm.teamId;
    gm.teamId = null;
    expect(beat(l, mine, 'asked', 1)).toBeNull();
    gm.teamId = was;
    expect(l.stories).toBeUndefined();
  });

  it('keeps twelve beats: the first and the last three always', () => {
    const l = createLeague({ seed: 'stories-cap' });
    const on = { kind: 'snaps' as const, teamId: l.userTeamId, playerId: 3 };
    let s;
    for (let i = 0; i < 20; i++) s = beat(l, on, i % 2 ? 'sat' : 'backIn', i)!;
    expect(s!.beats).toHaveLength(MAX_BEATS);
    expect(s!.beats[0].at).toBe(0);
    expect(s!.beats.slice(-3).map((b) => b.at)).toEqual([17, 18, 19]);
  });

  it('closes into `closed`, and the same subject opens a new story afterwards', () => {
    const l = createLeague({ seed: 'stories-close' });
    const on = { kind: 'feud' as const, teamId: l.userTeamId, playerId: 4 };
    expect(closeStory(l, on, 'ended', 5)).toBeNull();
    const a = beat(l, on, 'started', 1)!;
    const closed = closeStory(l, on, 'ended', 9, 'traded')!;
    expect(closed).toBe(a);
    expect(a.closed).toBe(9);
    expect(a.beats.at(-1)).toMatchObject({ kind: 'ended', how: 'traded' });
    expect(l.stories!.open).toHaveLength(0);
    expect(l.stories!.closed).toHaveLength(1);
    const b = beat(l, on, 'started', 20)!;
    expect(b.id).not.toBe(a.id);
    expect(storyById(l, a.id)).toBe(a);
  });

  it('tracks what each outlet has told', () => {
    const l = createLeague({ seed: 'stories-told' });
    const on = { kind: 'deal' as const, teamId: l.userTeamId, playerId: 7 };
    const s = beat(l, on, 'asked', 1)!;
    beat(l, on, 'answered', 2);
    expect(untold(l, s, COACH)).toHaveLength(2);
    markTold(s, COACH);
    expect(untold(l, s, COACH)).toHaveLength(0);
    beat(l, on, 'kept', 3);
    expect(untold(l, s, COACH)).toHaveLength(1);
  });

  it('does not tell the first beat again when the beat trimmed after it was untold', () => {
    const l = createLeague({ seed: 'stories-trim-told' });
    const on = { kind: 'snaps' as const, teamId: l.userTeamId, playerId: 3 };
    const s = beat(l, on, 'sat', 0)!;
    markTold(s, COACH);
    for (let i = 1; i <= 12; i++) beat(l, on, i % 2 ? 'backIn' : 'sat', i);
    expect(s.beats).toHaveLength(MAX_BEATS);
    expect(untold(l, s, COACH).some((b) => b.at === 0)).toBe(false);
    expect(untold(l, s, COACH)).toHaveLength(MAX_BEATS - 1);
  });

  it('drops closed stories a league year old at the new year', () => {
    const l = createLeague({ seed: 'stories-year' });
    const on = (id: number) => ({ kind: 'deal' as const, teamId: l.userTeamId, playerId: id });
    beat(l, on(1), 'asked', 1);
    closeStory(l, on(1), 'settled', 10);
    beat(l, on(2), 'asked', 1);
    closeStory(l, on(2), 'settled', 3 * 32 + 5);
    l.season = 3;
    storiesNewYear(l);
    expect(l.stories!.closed.map((s) => s.playerId)).toEqual([2]);
  });
});
