import { beforeEach, describe, expect, it } from 'vitest';
import { releaseCoach, teamCoaches } from './coaching';
import { createLeague } from './generate';
import { addJolt, moraleClock, moraleContext } from './morale';
import { activeRoster, setTeam } from './roster';
import { tierOf, unitOf, weightOf, type Unit } from './standing';
import { beat, closeRoomStories, COACH, openStory, STORIES, storyById, talkBeat, untold } from './stories';
import { HOLD, shareWord, storiesStep, tellable } from './storiesStep';
import type { League, Player } from './types';

beforeEach(() => {
  STORIES.on = true;
});

const template = createLeague({ seed: 'stories-step' });
const fresh = () => {
  const l = structuredClone(template);
  l.phase = 'regular';
  l.week = 6;
  // Every mood Okay: the rooms start calm, and the step reads the clock as the week's.
  for (const p of activeRoster(l, l.userTeamId)) if (p.morale) p.morale = { level: 0 };
  l.moraleAt = moraleClock(l);
  return l;
};
const men = (l: League, unit: Unit) =>
  activeRoster(l, l.userTeamId).filter((p) => unitOf(p.position) === unit && p.morale);
const setUnit = (l: League, unit: Unit, level: number) =>
  men(l, unit).forEach((p) => {
    p.morale!.level = level;
    delete p.morale!.jolts;
  });
const splitUnit = (l: League, unit: Unit) =>
  men(l, unit).forEach((p, i) => {
    p.morale!.level = i % 2 ? 2 : -2;
    delete p.morale!.jolts;
  });
const next = (l: League) => {
  l.moraleAt = l.moraleAt! + 1;
  storiesStep(l);
};
const room = (l: League, unit: Unit) => openStory(l, { kind: 'room', teamId: l.userTeamId, unit })!;

describe('rooms', () => {
  it('opens a room story when a unit turns Down and tells it only the second week running', () => {
    const l = fresh();
    setUnit(l, 'DL', -4);
    storiesStep(l);
    const s = room(l, 'DL');
    expect(s.beats.map((b) => [b.kind, b.how])).toEqual([['turned', 'Down']]);
    const clock = l.moraleAt!;
    expect(tellable(l, s, clock)).toBe(false);
    next(l);
    expect(tellable(l, s, clock + HOLD)).toBe(true);
    // Still Down a step on: no second turned beat.
    expect(s.beats).toHaveLength(1);
  });

  it('adds a turn when the word changes between Down and Split', () => {
    const l = fresh();
    setUnit(l, 'DL', -4);
    storiesStep(l);
    splitUnit(l, 'DL');
    next(l);
    expect(room(l, 'DL').beats.map((b) => b.how)).toEqual(['Down', 'Split']);
  });

  it('a room that flips back within a step is never tellable', () => {
    const l = fresh();
    setUnit(l, 'DL', -4);
    storiesStep(l);
    const s = room(l, 'DL');
    setUnit(l, 'DL', 0);
    next(l);
    expect(s.beats.at(-1)!.kind).toBe('eased');
    expect(tellable(l, s, l.moraleAt! + 5)).toBe(false);
  });

  it('recovers a room after two calm steps, not one', () => {
    const l = fresh();
    setUnit(l, 'DL', -4);
    storiesStep(l);
    const s = room(l, 'DL');
    setUnit(l, 'DL', 0);
    next(l);
    expect(openStory(l, { kind: 'room', teamId: l.userTeamId, unit: 'DL' })).toBe(s);
    next(l);
    expect(openStory(l, { kind: 'room', teamId: l.userTeamId, unit: 'DL' })).toBeUndefined();
    expect(s.beats.map((b) => b.kind)).toEqual(['turned', 'eased', 'recovered']);
    expect(tellable(l, s, l.moraleAt!)).toBe(true);
    // Back to Down in the same league year re-opens the same story.
    setUnit(l, 'DL', -4);
    next(l);
    expect(room(l, 'DL').id).toBe(s.id);
  });

  it('records nothing for a calm league, or with stories off', () => {
    const l = fresh();
    storiesStep(l);
    expect(l.stories?.open ?? []).toEqual([]);
    STORIES.on = false;
    setUnit(l, 'DL', -4);
    storiesStep(l);
    expect(l.stories?.open ?? []).toEqual([]);
  });
});

describe('feuds', () => {
  const feud = (l: League) => {
    const [a, b] = men(l, 'WR');
    a.ties = [{ kind: 'feud', with: b.id, since: 1, why: 'benched' }];
    b.ties = [{ kind: 'feud', with: a.id, since: 1, why: 'benched' }];
    return [a, b] as const;
  };

  it('opens one story for the pair, on the lower id, and ends it when the tie goes', () => {
    const l = fresh();
    const [a, b] = feud(l);
    storiesStep(l);
    expect(l.stories!.open).toHaveLength(1);
    const s = l.stories!.open[0];
    expect([s.kind, s.playerId, s.other]).toEqual(['feud', Math.min(a.id, b.id), Math.max(a.id, b.id)]);
    expect(s.beats).toEqual([{ at: l.moraleAt, kind: 'started', how: 'benched' }]);
    delete a.ties;
    delete b.ties;
    next(l);
    expect(s.beats.at(-1)!.kind).toBe('ended');
    expect(l.stories!.open).toHaveLength(0);
  });
});

describe('men who left', () => {
  it('closes a traded man’s stories with "left" and drops the link', () => {
    const l = fresh();
    const p = men(l, 'DL')[0];
    const s = beat(l, { kind: 'deal', teamId: l.userTeamId, playerId: p.id }, 'asked', l.moraleAt!)!;
    s.feeds = [999];
    const other = l.teams.find((t) => t.id !== l.userTeamId)!;
    setTeam(l, p, other.id);
    next(l);
    expect(s.beats.at(-1)!.kind).toBe('left');
    expect(s.closed).toBeDefined();
    expect(l.stories!.open).not.toContain(s);
  });

  it('closes a feud when either man goes', () => {
    const l = fresh();
    const [a, b] = men(l, 'WR');
    a.ties = [{ kind: 'feud', with: b.id, since: 1 }];
    b.ties = [{ kind: 'feud', with: a.id, since: 1 }];
    storiesStep(l);
    const s = l.stories!.open[0];
    setTeam(l, b, l.teams.find((t) => t.id !== l.userTeamId)!.id);
    next(l);
    expect(s.beats.at(-1)!.kind).toBe('left');
  });

  it("puts a man's losing on his room's story, and opens none of his own", () => {
    const l = fresh();
    const p = men(l, 'DL')[0];
    // The club's one story for the losing opens with the first ask and takes the rest.
    talkBeat(l, p, 'losing', 'asked', l.moraleAt!);
    talkBeat(l, men(l, 'WR')[0], 'losing', 'asked', l.moraleAt! + 1);
    const room = openStory(l, { kind: 'room', teamId: l.userTeamId, unit: 'team' })!;
    expect(l.stories!.open).toHaveLength(1);
    expect(room.beats.map((b) => b.kind)).toEqual(['asked', 'asked']);
    expect(openStory(l, { kind: 'losing', teamId: l.userTeamId, playerId: p.id })).toBeUndefined();
  });

  it('closes every open room story quietly when the club has no game left', () => {
    const l = fresh();
    const room = beat(l, { kind: 'room', teamId: l.userTeamId, unit: 'DL' }, 'turned', l.moraleAt!, { how: 'Down' })!;
    closeRoomStories(l);
    expect(l.stories!.open).toHaveLength(0);
    expect(room.beats.at(-1)!.kind).toBe('ended');
    // Told already: no letter has anything to say about it.
    expect(untold(l, room, COACH)).toHaveLength(0);
  });
});

describe('the staff', () => {
  const coordinator = (l: League) => teamCoaches(l, l.userTeamId).find((c) => c.role === 'offCoord')!;

  it('warns, then doubts, then recovers once belief is back above the line', () => {
    const l = fresh();
    const c = coordinator(l);
    c.belief = { WR: -0.15, QB: -0.15 };
    l.teams[l.userTeamId].beliefFell = { clock: l.moraleAt!, rooms: ['WR'] };
    storiesStep(l);
    const s = openStory(l, { kind: 'staff', teamId: l.userTeamId, coachId: c.id })!;
    expect(s.beats.map((b) => b.kind)).toEqual(['warned']);
    c.belief = { WR: -0.25, QB: -0.15 };
    delete l.teams[l.userTeamId].beliefFell;
    next(l);
    expect(s.beats.map((b) => [b.kind, b.how])).toEqual([
      ['warned', 'WR'],
      ['doubt', 'doubts'],
    ]);
    next(l);
    expect(s.beats).toHaveLength(2);
    c.belief = { WR: 0, QB: 0 };
    next(l);
    expect(s.beats.at(-1)!.kind).toBe('recovered');
    expect(l.stories!.open).not.toContain(s);
  });

  it('a head coach whose word has worn thin gets a story of his own, once', () => {
    const l = fresh();
    const hc = teamCoaches(l, l.userTeamId).find((c) => c.role === 'headCoach')!;
    hc.credibility = -0.6;
    storiesStep(l);
    next(l);
    const s = openStory(l, { kind: 'staff', teamId: l.userTeamId, coachId: hc.id })!;
    expect(s.beats.map((b) => b.kind)).toEqual(['worn']);
  });

  it('closes with "relieved" or "left" when the coach is off the staff', () => {
    const l = fresh();
    const c = coordinator(l);
    c.belief = { WR: -0.3 };
    storiesStep(l);
    const s = openStory(l, { kind: 'staff', teamId: l.userTeamId, coachId: c.id })!;
    // Coaching moves open in the re-sign window: step into it to let him go, then back to the season.
    l.phase = 'resign';
    releaseCoach(l, l.userTeamId, c.id);
    l.phase = 'regular';
    next(l);
    expect(s.beats.at(-1)!.kind).toBe('left');
  });
});

describe('links', () => {
  /** A man the room follows (a captain), and one it doesn't, in the same room, both Poor over a deal. */
  const stage = () => {
    const l = fresh();
    const dl = men(l, 'DL');
    // One heavy voice (a captain with years behind him) and a room of quiet men: his share is a real part of it.
    const lead = dl[0];
    lead.traits.leads = 20;
    lead.experience = 10;
    for (const p of dl.slice(1)) p.traits.leads = 1;
    const ctx = moraleContext(l);
    const depth = dl.find((p) => !tierOf(l, p, weightOf(l, p, ctx)) && p.id !== lead.id)!;
    l.teams[l.userTeamId].captains = { season: l.season, offense: 0, defense: lead.id, specialTeams: 0 };
    return { l, lead, depth, dl };
  };
  const sour = (l: League, p: Player) => {
    p.morale!.level = -4;
    addJolt(p, 'snubbed', -6, l.moraleAt!);
  };

  it('links a voice’s deal story to his room, and no link for a depth man', () => {
    const { l, lead, depth, dl } = stage();
    // A Down room: the voice and the others sit low.
    for (const p of dl) p.morale!.level = -4;
    sour(l, lead);
    sour(l, depth);
    const deal = beat(l, { kind: 'deal', teamId: l.userTeamId, playerId: lead.id }, 'asked', l.moraleAt!)!;
    const depthDeal = beat(l, { kind: 'deal', teamId: l.userTeamId, playerId: depth.id }, 'asked', l.moraleAt!)!;
    storiesStep(l);
    const r = room(l, 'DL');
    expect(shareWord(l, lead, moraleContext(l))).not.toBeNull();
    expect(deal.feeds).toEqual([r.id]);
    expect(depthDeal.feeds ?? []).toEqual([]);
    // The link follows the grievance: a snaps story for the same man is not fed by a deal grievance.
    const snaps = beat(l, { kind: 'snaps', teamId: l.userTeamId, playerId: lead.id }, 'asked', l.moraleAt!)!;
    storiesStep(l);
    expect(snaps.feeds ?? []).toEqual([]);
    expect(storyById(l, r.id)).toBe(r);
  });

  it('drops the link when the room calms', () => {
    const { l, lead, dl } = stage();
    for (const p of dl) p.morale!.level = -4;
    sour(l, lead);
    const deal = beat(l, { kind: 'deal', teamId: l.userTeamId, playerId: lead.id }, 'asked', l.moraleAt!)!;
    storiesStep(l);
    expect(deal.feeds).toHaveLength(1);
    for (const p of dl) delete p.morale!.jolts;
    setUnit(l, 'DL', 0);
    next(l);
    next(l);
    expect(deal.feeds).toBeUndefined();
  });
});

describe('shareWord', () => {
  it('reads a man’s share of his room’s weight in words', () => {
    const l = fresh();
    const ctx = moraleContext(l);
    const words = new Set(activeRoster(l, l.userTeamId).map((p) => shareWord(l, p, ctx)));
    expect([...words].every((w) => w === null || w === 'part' || w === 'most')).toBe(true);
  });
});
