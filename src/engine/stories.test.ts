import { beforeEach, describe, expect, it } from 'vitest';
import { createLeague } from './generate';
import { playWeek } from './league';
import { activeRoster } from './roster';
import { addJolt, moraleAdvance, moraleContext } from './morale';
import { answerTalk } from './playerTalks';
import { disputeStep, endDispute } from './disputes';
import { answerMeeting, requestMeeting } from './meetings';
import { judgeCommitments } from './meetings/commitments';
import type { League, Player, TalkCause } from './types';
import {
  beat,
  closeStory,
  COACH,
  MAX_BEATS,
  markTold,
  openStory,
  STORIES,
  storiesNewYear,
  storyById,
  talkStoryOn,
  untold,
} from './stories';

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

describe('beats at the sim’s events', () => {
  const asking = (l: League, cause: TalkCause, index = 0): Player => {
    const p = activeRoster(l, l.userTeamId)[index];
    p.morale = { level: -4, talk: { club: l.userTeamId, ask: { cause, at: l.moraleAt! } } };
    beat(l, talkStoryOn(l, p, cause), 'asked', l.moraleAt!);
    return p;
  };
  const kinds = (s: { beats: { kind: string }[] }) => s.beats.map((b) => b.kind);
  const fresh = () => {
    const l = createLeague({ seed: 'story-events' });
    playWeek(l);
    return l;
  };

  it('an ask, your answer and a kept promise are one story', () => {
    const l = fresh();
    const p = asking(l, 'deal');
    expect(answerTalk(l, p.id, 'promise')).toBe(true);
    const on = { kind: 'deal' as const, teamId: l.userTeamId, playerId: p.id };
    const story = openStory(l, on)!;
    expect(story.due).toBe(p.morale!.talk!.promise!.due);
    const next = l.moraleAt! + 1;
    addJolt(p, 'paid', 1, next);
    moraleAdvance(l, next);
    expect(kinds(story)).toEqual(['asked', 'answered', 'promised', 'kept']);
    expect(story.beats[1].how).toBe('promise');
    expect(story.closed).toBeDefined();
    expect(openStory(l, on)).toBeUndefined();
  });

  it('a feud ask is the pair’s story, the lower id with the higher as the other', () => {
    const l = fresh();
    const [a, b] = activeRoster(l, l.userTeamId);
    a.ties = [{ kind: 'feud', with: b.id, since: 1 }];
    b.ties = [{ kind: 'feud', with: a.id, since: 1 }];
    expect(talkStoryOn(l, b, 'feud')).toEqual({ kind: 'feud', teamId: l.userTeamId, playerId: Math.min(a.id, b.id) });
    expect(talkStoryOn(l, a, 'deal')).toEqual({ kind: 'deal', teamId: l.userTeamId, playerId: a.id });
    a.morale = { level: -4, talk: { club: l.userTeamId, ask: { cause: 'feud', at: l.moraleAt! } } };
    answerTalk(l, a.id, 'reassure');
    const s = openStory(l, talkStoryOn(l, a, 'feud'))!;
    expect(s.other).toBe(Math.max(a.id, b.id));
    expect(kinds(s)).toEqual(['answered']);
  });

  it('an ask left unanswered is ignored on the story', () => {
    const l = fresh();
    const p = asking(l, 'snaps');
    const next = l.moraleAt! + 2;
    moraleAdvance(l, next);
    const s = openStory(l, { kind: 'snaps', teamId: l.userTeamId, playerId: p.id })!;
    expect(kinds(s)).toEqual(['asked', 'answered']);
    expect(s.beats[1].how).toBe('ignored');
  });

  it('a new ask from talkStep is a beat, and the ignored answer after it', () => {
    const l = createLeague({ seed: 'story-talk' });
    for (const x of Object.values(l.players)) if (x.morale) x.morale.level = 4;
    // A rookie made to sulk about a benching: the talks' own staging (`playerTalks.test.ts`).
    const p = activeRoster(l, l.userTeamId).filter((x) => x.contract?.kind === 'rookie' && x.experience < 3)[0];
    p.ties = [];
    p.morale = { level: -4, jolts: [{ kind: 'benched', size: -8, at: l.moraleAt! }] };
    for (let i = 0; i < 3; i++) moraleAdvance(l, l.moraleAt! + 1);
    const on = { kind: 'snaps' as const, teamId: l.userTeamId, playerId: p.id };
    expect(kinds(openStory(l, on)!)).toEqual(['asked']);
    expect(openStory(l, on)!.beats[0].at).toBe(p.morale.talk!.ask!.at);
  });

  it('a meeting suggested, held and passed lands on the room', () => {
    const l = fresh();
    const on = { kind: 'room' as const, teamId: l.userTeamId, unit: 'DL' as const };
    // A room that never turned has no story: a meeting about it makes none.
    requestMeeting(l, 'DL')!;
    expect(openStory(l, on)).toBeUndefined();
    answerMeeting(l, 'skip');
    expect(openStory(l, on)).toBeUndefined();
    // A turned room's story hears what is done about it.
    beat(l, on, 'turned', l.moraleAt!, { how: 'Down' });
    l.moraleAt = l.moraleAt! + 8;
    const s = requestMeeting(l, 'DL')!;
    expect(kinds(openStory(l, on)!)).toEqual(['turned', 'suggested']);
    expect(openStory(l, on)!.beats[1].how).toBe(s.topic);
    answerMeeting(l, 'skip');
    expect(kinds(openStory(l, on)!)).toEqual(['turned', 'suggested', 'passed']);
    // Held: the same room, next week.
    l.moraleAt = l.moraleAt! + 8;
    const t = requestMeeting(l, 'DL')!;
    const rec = answerMeeting(l, { approach: t.approaches[0], backing: 'words', timing: t.timings[0] ?? 'monday' })!;
    const held = openStory(l, on)!.beats.at(-1)!;
    expect(held.kind).toBe('held');
    expect(held.how).toBe(`${rec.approach}:words:${rec.timing}`);
  });

  it('a meeting held with "talks" puts the clock on the room and on each named man', () => {
    const l = fresh();
    const wr = l.players[l.teams[l.userTeamId].depthChart.WR[0]];
    beat(l, { kind: 'room', teamId: l.userTeamId, unit: 'WR' }, 'turned', l.moraleAt!, { how: 'Split' });
    const s = requestMeeting(l, 'WR')!;
    if (!s.backings.includes('talks')) s.backings.push('talks');
    s.namedFor = { talks: [wr.id] };
    s.named = [wr.id];
    answerMeeting(l, { approach: s.approaches[0], backing: 'talks', timing: s.timings[0] ?? 'monday' });
    const c = l.teams[l.userTeamId].meetings!.open.at(-1)!;
    const room = openStory(l, { kind: 'room', teamId: l.userTeamId, unit: 'WR' })!;
    expect(room.due).toBe(c.closes);
    expect(openStory(l, { kind: 'deal', teamId: l.userTeamId, playerId: wr.id })!.due).toBe(c.closes);
    // The window closes unkept: broken on both, the clock cleared.
    l.moraleAt = c.closes;
    judgeCommitments(l);
    expect(room.beats.at(-1)!.kind).toBe('broken');
    expect(room.due).toBeUndefined();
    const deal = openStory(l, { kind: 'deal', teamId: l.userTeamId, playerId: wr.id })!;
    expect(deal.beats.at(-1)!.kind).toBe('broken');
  });

  it('a dispute starts, leaks and ends on his story', () => {
    const l = fresh();
    const p = activeRoster(l, l.userTeamId)[0];
    const clock = l.moraleAt! + 1;
    l.moraleAt = clock;
    p.morale = {
      level: -4,
      talk: { club: l.userTeamId, sour: { cause: 'snaps', at: clock, run: 0, now: true, after: 'trade' } },
    };
    disputeStep(l, moraleContext(l), clock, clock - l.season * 32, false);
    const on = { kind: 'snaps' as const, teamId: l.userTeamId, playerId: p.id };
    expect(kinds(openStory(l, on)!)).toEqual(['dispute']);
    expect(openStory(l, on)!.beats[0].how).toBe('trade');
    p.morale.dispute!.since = clock - 6;
    disputeStep(l, moraleContext(l), clock + 1, clock + 1 - l.season * 32, false);
    const s = openStory(l, on)!;
    expect(p.morale.dispute?.public).toBeDefined();
    expect(s.beats.at(-1)).toMatchObject({ kind: 'leaked', pub: true });
    endDispute(l, p, 'withdrawn', clock + 2);
    expect(s.beats.at(-1)).toMatchObject({ kind: 'disputeEnd', how: 'withdrawn' });
  });

  it('play is identical with stories off', () => {
    const run = (on: boolean) => {
      STORIES.on = on;
      try {
        const l = createLeague({ seed: 'stories-identical' });
        const results = [];
        for (let i = 0; i < 3; i++) results.push(playWeek(l));
        return JSON.stringify({ results, morale: Object.values(l.players).map((p) => p.morale ?? null) });
      } finally {
        STORIES.on = true;
      }
    };
    expect(run(false)).toBe(run(true));
  });
});
