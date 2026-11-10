/**
 * The step after morale and the meetings: story beats for what is read rather than done (a room turning Down or Split,
 * a feud, the staff's standing), the links between a man's story and his room's, and the men who left. Your club only.
 * Record-keeping: nothing here draws, and nothing in the sim reads what it writes. It lives apart from `stories.ts` so
 * it may read `standing.ts`, `morale.ts`, `belief.ts` and `coaching.ts` freely; none of those may import it.
 */
import { BELIEF, beliefOf, beliefRead, runnerOf, SIDE_ROOMS, type BeliefRead } from './belief';
import { teamCoaches } from './coaching';
import { employed } from './employment';
import { credibilityRead } from './meetings/credibility';
import { moraleClock, moraleContext, moraleView, viewContext, type MoraleContext } from './morale';
import { CAUSE_OF } from './playerTalks';
import { activeRoster, teamPlayers } from './roster';
import { tierOf, unitOf, unitRead, UNITS, weightOf } from './standing';
import { beat, closeRoomStories, closeStory, openStory, STORIES, type StoryOn } from './stories';
import { momentSheet } from './castSheet';
import type { Beat, BeatKind, CoachRoom, League, Player, Story, StoryKind, TalkCause } from './types';

/** Steps a turn must still stand before it is told: the second week running. */
export const HOLD = 1;

/** A quiet man still counts in his unit's read; the share counts him the same way. */
const READ_FLOOR = 0.3;
/** Under this share of his room's weight he is only a part of it; from half he is most of it. */
const PART = 0.2;
const MOST = 0.5;

const lastOf = (s: Story, kinds: readonly BeatKind[]): Beat | undefined =>
  [...s.beats].reverse().find((b) => kinds.includes(b.kind));

const onOf = (s: Story): StoryOn => ({
  kind: s.kind,
  teamId: s.teamId,
  playerId: s.playerId,
  unit: s.unit,
  coachId: s.coachId,
});

/**
 * A room's turn (or its recovery) has stood long enough to tell. About turns only: a room story with no turn (a meeting
 * suggested, held or passed) is never tellable here, because a meeting request is told at once by the letter's request row.
 */
export function tellable(league: League, s: Story, clock: number): boolean {
  if (s.kind !== 'room') return true;
  const last = lastOf(s, ['turned', 'eased', 'recovered']);
  if (!last || last.kind === 'eased') return false;
  if (last.kind === 'recovered') return true;
  if (clock - last.at < HOLD) return false;
  // The turn must still stand: the step that saw the room ease would have said so, but a story read between steps
  // answers for the room as it reads now.
  const unit = s.unit;
  if (!unit || unit === 'team' || unit === 'ST') return true;
  const word = unitRead(league, s.teamId, unit, viewContext(league))?.word;
  return word === 'Down' || word === 'Split';
}

/** His share of his room's weight, in words: null under a fifth, 'part' under half, 'most' from half. */
export function shareWord(league: League, p: Player, ctx: MoraleContext): 'part' | 'most' | null {
  if (p.teamId === null) return null;
  const unit = unitOf(p.position);
  let total = 0;
  let mine = 0;
  for (const m of activeRoster(league, p.teamId)) {
    if (unitOf(m.position) !== unit) continue;
    const w = Math.max(weightOf(league, m, ctx), READ_FLOOR);
    total += w;
    if (m.id === p.id) mine = w;
  }
  const share = total ? mine / total : 0;
  return share >= MOST ? 'most' : share >= PART ? 'part' : null;
}

const onClub = (p: Player | undefined, teamId: number): p is Player => !!p && !p.retired && p.teamId === teamId;

/** The cause a story's man would ask about: a benching is a grievance about snaps. */
const causeOf = (kind: StoryKind): TalkCause | null =>
  kind === 'deal' || kind === 'losing' || kind === 'snaps' ? kind : kind === 'benched' ? 'snaps' : null;

const MAN_STORIES: readonly StoryKind[] = ['deal', 'snaps', 'benched', 'losing', 'feud'];

// ───────── men who left, a losing run lifted ─────────

function departures(league: League, user: number, clock: number): void {
  for (const s of [...(league.stories?.open ?? [])]) {
    if (s.teamId !== user || !MAN_STORIES.includes(s.kind) || s.playerId === undefined) continue;
    const p = league.players[s.playerId];
    const mate = s.other === undefined ? undefined : league.players[s.other];
    if (!onClub(p, user) || (s.other !== undefined && !onClub(mate, user))) {
      closeStory(league, onOf(s), 'left', clock);
      continue;
    }
  }
}

// ───────── feuds ─────────

function feuds(league: League, user: number, clock: number): void {
  const tied = (a: Player, b: Player) =>
    a.ties?.find((t) => t.kind === 'feud' && t.with === b.id) ??
    b.ties?.find((t) => t.kind === 'feud' && t.with === a.id);
  for (const p of teamPlayers(league, user)) {
    for (const t of p.ties ?? []) {
      const mate = league.players[t.with];
      if (t.kind !== 'feud' || p.id > t.with || !onClub(mate, user)) continue;
      const on: StoryOn = { kind: 'feud', teamId: user, playerId: p.id };
      if (openStory(league, on)) continue;
      beat(league, on, 'started', clock, t.why ? { how: t.why, other: mate.id } : { other: mate.id });
    }
  }
  for (const s of [...(league.stories?.open ?? [])]) {
    if (s.teamId !== user || s.kind !== 'feud' || s.playerId === undefined) continue;
    const p = league.players[s.playerId];
    if (!onClub(p, user)) continue;
    const mate = s.other === undefined ? undefined : league.players[s.other];
    const stands = mate
      ? !!tied(p, mate)
      : (p.ties ?? []).some((t) => t.kind === 'feud' && onClub(league.players[t.with], user));
    if (!stands) closeStory(league, onOf(s), 'ended', clock);
  }
}

// ───────── rooms ─────────

function rooms(league: League, user: number, clock: number, ctx: MoraleContext): void {
  for (const unit of UNITS) {
    if (unit === 'ST') continue;
    const word = unitRead(league, user, unit, ctx)?.word;
    const bad = word === 'Down' || word === 'Split';
    const on: StoryOn = { kind: 'room', teamId: user, unit };
    const s = openStory(league, on);
    const state = s ? lastOf(s, ['turned', 'eased']) : undefined;
    if (bad) {
      // A turn is a room newly Down or Split, back to it from easing, or the one word for the other.
      if (!state || state.kind === 'eased' || state.how !== word) beat(league, on, 'turned', clock, { how: word });
    } else if (s && s.beats.some((b) => b.kind === 'turned') && state) {
      // Two calm steps, not one: a room that flips back within a step is not recovered.
      if (state.kind === 'turned') beat(league, on, 'eased', clock);
      else if (state.at < clock) closeStory(league, on, 'recovered', clock);
    }
  }
}

// ───────── the staff ─────────

const BELIEF_RANK: Record<BeliefRead, number> = { believes: 0, steady: 1, doubts: 2, lost: 3 };
const ROOMS: readonly CoachRoom[] = [...SIDE_ROOMS.offCoord, ...SIDE_ROOMS.defCoord];

function staff(league: League, user: number, clock: number): void {
  const team = league.teams[user];
  const coaches = teamCoaches(league, user);
  const runs = (coachId: number) => ROOMS.filter((r) => runnerOf(league, user, r)?.id === coachId);
  const on = (coachId: number): StoryOn => ({ kind: 'staff', teamId: user, coachId });

  // The warning: a room's belief fell past the line after a bad game this step.
  if (team.beliefFell?.clock === clock)
    for (const room of team.beliefFell.rooms) {
      const c = runnerOf(league, user, room);
      if (c) beat(league, on(c.id), 'warned', clock, { how: room });
    }
  for (const c of coaches) {
    const worst = runs(c.id)
      .map((r) => beliefRead(beliefOf(c, r)))
      .sort((a, b) => BELIEF_RANK[b] - BELIEF_RANK[a])[0];
    // A new beat only when the read is new: not every step he stays in doubt.
    if (worst === 'doubts' || worst === 'lost') {
      const s = openStory(league, on(c.id));
      const last = s && lastOf(s, ['doubt', 'recovered']);
      if (last?.kind !== 'doubt' || last.how !== worst) beat(league, on(c.id), 'doubt', clock, { how: worst });
    }
    if (c.role === 'headCoach' && credibilityRead(c) === 'wornThin') {
      const s = openStory(league, on(c.id));
      if (!s || lastOf(s, ['worn', 'recovered'])?.kind !== 'worn') beat(league, on(c.id), 'worn', clock);
    }
  }

  for (const s of [...(league.stories?.open ?? [])]) {
    if (s.teamId !== user || s.kind !== 'staff' || s.coachId === undefined) continue;
    const c = coaches.find((x) => x.id === s.coachId);
    if (!c) {
      const relieved = league.leadership?.events.some(
        (e) =>
          e.teamId === user && e.coachId === s.coachId && (e.kind === 'coachRelieved' || e.kind === 'coachDismissed'),
      );
      closeStory(league, onOf(s), relieved ? 'relieved' : 'left', clock);
      continue;
    }
    // Calm: every room he runs reads steady or better and is clear of the warning line, and his word holds.
    const calm =
      runs(c.id).every((r) => BELIEF_RANK[beliefRead(beliefOf(c, r))] <= 1 && beliefOf(c, r) > BELIEF.warn) &&
      (c.role !== 'headCoach' || credibilityRead(c) !== 'wornThin');
    if (calm) closeStory(league, onOf(s), 'recovered', clock);
  }
}

// ───────── links ─────────

/** A man's story feeds his room's when he is one the room follows, his mood is Poor or worse, and it is that grievance. */
function links(league: League, user: number, ctx: MoraleContext): void {
  for (const s of league.stories?.open ?? []) {
    if (s.teamId !== user || s.playerId === undefined) continue;
    const cause = causeOf(s.kind);
    if (!cause) continue;
    const p = league.players[s.playerId];
    if (!onClub(p, user)) continue;
    const found = openStory(league, { kind: 'room', teamId: user, unit: unitOf(p.position) });
    // Only a room that stands turned: one easing or recovered is no longer what his story feeds.
    const room = found && lastOf(found, ['turned', 'eased', 'recovered'])?.kind === 'turned' ? found : undefined;
    const view = moraleView(league, p, ctx);
    const feeds =
      !!room &&
      !!tierOf(league, p, weightOf(league, p, ctx)) &&
      !!view &&
      view.step <= 3 &&
      CAUSE_OF[view.reasons[0] ?? ''] === cause &&
      shareWord(league, p, ctx) !== null;
    // Only this room's id: other entries in `feeds` are not ours to touch.
    const rest = (s.feeds ?? []).filter((id) => id !== found?.id);
    const next = feeds ? [...rest, room!.id] : rest;
    if (next.length) s.feeds = next;
    else delete s.feeds;
  }
}

/** The beats of one step, in the order that lets each read the one before: leavers, rooms, feuds, staff, then links. */
export function storiesStep(league: League): void {
  if (!STORIES.on || !employed(league)) return;
  const user = league.userTeamId;
  const clock = league.moraleAt ?? moraleClock(league);
  const ctx = moraleContext(league);
  departures(league, user, clock);
  feuds(league, user, clock);
  // Your club's last game is played: the rooms close with the season, and none turns again until the next one.
  if (momentSheet(league).seasonOver) closeRoomStories(league);
  else {
    rooms(league, user, clock, ctx);
  }
  staff(league, user, clock);
  links(league, user, ctx);
}
