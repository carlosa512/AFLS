/**
 * Storylines: what happened to one subject of your club (a deal, a benching, a feud, a room, a coach), kept beat by
 * beat so a letter can tell it as one story. Record-keeping only: nothing in the sim reads `League.stories`, and
 * writing a beat draws nothing from any stream.
 */
import { employed } from './employment';
import type { Beat, BeatKind, CoachRoom, League, OutletId, Player, Position, Story, TalkCause } from './types';

export type StoryOn = Pick<Story, 'kind' | 'teamId' | 'playerId' | 'unit' | 'coachId'>;

/** Tests turn it off to prove play is untouched. */
export const STORIES = { on: true };
export const MAX_BEATS = 12;
/** Clock steps in a league year, as `morale.ts` counts them (kept here so this file imports no engine code). */
const YEAR = 32;

/** A reader of the store. The coach sees his own club's beats; a public outlet, later, only `pub` ones. */
export interface Outlet {
  id: OutletId;
  sees: (league: League, s: Story, b: Beat) => boolean;
}
export const COACH: Outlet = { id: 'coach', sees: (league, s) => s.teamId === league.userTeamId };

const same = (s: Story, on: StoryOn) =>
  s.kind === on.kind &&
  s.teamId === on.teamId &&
  s.playerId === on.playerId &&
  s.unit === on.unit &&
  s.coachId === on.coachId;

/**
 * The story a man's ask belongs to: his own by cause, except a feud's, which is the pair's (the lower id of him and his
 * feud partner on the club; the higher is `other`, which a beat sets on the story).
 */
export function talkStoryOn(league: League, p: Player, cause: TalkCause): StoryOn {
  const teamId = p.teamId!;
  // The losing is a room's, not a man's: his ask adds a beat to his room's story.
  if (cause === 'losing') return { kind: 'room', teamId, unit: talkRoomOf(p) };
  if (cause !== 'feud') return { kind: cause, teamId, playerId: p.id };
  const mate = feudMate(league, p);
  return { kind: 'feud', teamId, playerId: mate === undefined ? p.id : Math.min(p.id, mate) };
}

/** His feud partner on the same club, if he has one. */
function feudMate(league: League, p: Player): number | undefined {
  return p.ties?.find((t) => t.kind === 'feud' && league.players[t.with]?.teamId === p.teamId)?.with;
}

const ROOM_OF: Partial<Record<Position, CoachRoom>> = {
  QB: 'QB',
  RB: 'RB',
  WR: 'WR',
  TE: 'WR',
  OL: 'OL',
  DT: 'DL',
  EDGE: 'DL',
  LB: 'LB',
  CB: 'DB',
  S: 'DB',
};
/** The room a man's losing is told with (kept here, as `coaching.ts`'s table, so this file imports no engine code): a specialist's is the team's. */
export const talkRoomOf = (p: Player): CoachRoom | 'team' => ROOM_OF[p.position] ?? 'team';

/** A beat on a man's talk story: one line at each site (a feud's story also learns the other man of the pair). */
export function talkBeat(
  league: League,
  p: Player,
  cause: TalkCause,
  kind: BeatKind,
  at: number,
  extra: { how?: string; pub?: true; due?: number | null } = {},
): Story | null {
  const mate = cause === 'feud' ? feudMate(league, p) : undefined;
  const other = mate === undefined ? undefined : Math.max(p.id, mate);
  // The losing joins its room's story when there is one; a room with no story of its own (it has not turned) gets none from
  // a man's ask, or every club in a losing year would open a story a room.
  if (cause === 'losing' && !openStory(league, talkStoryOn(league, p, cause))) return null;
  return beat(league, talkStoryOn(league, p, cause), kind, at, other === undefined ? extra : { ...extra, other });
}

/** The open story on this subject, if any. */
export function openStory(league: League, on: StoryOn): Story | undefined {
  return league.stories?.open.find((s) => same(s, on));
}

export function storyById(league: League, id: number): Story | undefined {
  return league.stories?.open.find((s) => s.id === id) ?? league.stories?.closed.find((s) => s.id === id);
}

/** Past the cap the oldest beat that is neither the first nor one of the last three goes: the start and the latest stay. */
function trim(s: Story): void {
  while (s.beats.length > MAX_BEATS) {
    s.beats.splice(1, 1);
    // The dropped beat (index 1) was told only when the outlet had told two or more; a count of 1 stays on the first.
    if (s.told) for (const k of Object.keys(s.told) as OutletId[]) if ((s.told[k] ?? 0) > 1) s.told[k]! -= 1;
  }
}

function push(s: Story, kind: BeatKind, at: number, how?: string, pub?: true): void {
  if (s.beats.some((b) => b.kind === kind && b.at === at)) return;
  const b: Beat = { at, kind };
  if (pub) b.pub = true;
  if (how !== undefined) b.how = how;
  s.beats.push(b);
  trim(s);
}

export function beat(
  league: League,
  on: StoryOn,
  kind: BeatKind,
  at: number,
  extra: { how?: string; pub?: true; due?: number | null; other?: number } = {},
): Story | null {
  if (!STORIES.on || on.teamId !== league.userTeamId || !employed(league)) return null;
  const stories = (league.stories ??= { next: 1, open: [], closed: [] });
  let s = openStory(league, on);
  if (!s) {
    s = { id: stories.next++, kind: on.kind, teamId: on.teamId, opened: at, beats: [] };
    if (on.playerId !== undefined) s.playerId = on.playerId;
    if (on.unit !== undefined) s.unit = on.unit;
    if (on.coachId !== undefined) s.coachId = on.coachId;
    stories.open.push(s);
  }
  if (extra.other !== undefined) s.other = extra.other;
  if (extra.due === null) delete s.due;
  else if (extra.due !== undefined) s.due = extra.due;
  push(s, kind, at, extra.how, extra.pub);
  return s;
}

export function closeStory(league: League, on: StoryOn, kind: BeatKind, at: number, how?: string): Story | null {
  const s = openStory(league, on);
  if (!s || !league.stories) return null;
  push(s, kind, at, how);
  s.closed = at;
  delete s.due;
  league.stories.open.splice(league.stories.open.indexOf(s), 1);
  league.stories.closed.push(s);
  return s;
}

/** The beats past what the outlet has told, that it sees. */
export function untold(league: League, s: Story, outlet: Outlet): Beat[] {
  return s.beats.slice(s.told?.[outlet.id] ?? 0).filter((b) => outlet.sees(league, s, b));
}

export function markTold(s: Story, outlet: Outlet): void {
  (s.told ??= {})[outlet.id] = s.beats.length;
}

/**
 * Every open room story of your club with nothing open on it (no commitment from a meeting) closes, told or not: rooms
 * end with the season, so they do not pile up. Silent: the coach has nothing to say about a story that only ended.
 */
export function closeRoomStories(league: League): void {
  const open = league.teams[league.userTeamId]?.meetings?.open ?? [];
  for (const s of [...(league.stories?.open ?? [])]) {
    if (s.kind !== 'room' || s.teamId !== league.userTeamId || open.some((c) => c.scope === s.unit)) continue;
    const closed = closeStory(
      league,
      { kind: 'room', teamId: s.teamId, unit: s.unit },
      'ended',
      s.beats.at(-1)?.at ?? s.opened,
    );
    if (closed) markTold(closed, COACH);
  }
}

/** Closed stories from before last league year are forgotten; the rooms still open close. */
export function storiesNewYear(league: League): void {
  if (!league.stories) return;
  closeRoomStories(league);
  const floor = (league.season - 1) * YEAR;
  league.stories.closed = league.stories.closed.filter((s) => (s.closed ?? 0) >= floor);
}
