import { beforeEach, describe, expect, it } from 'vitest';
import { releaseCoach, teamCoaches } from './coaching';
import { endGmAppointment } from './gm';
import { createLeague } from './generate';
import { acceptGmOffer, beginGmSearch, leadershipEvent } from './leadership';
import { talkCard } from './talkMail';
import { addJolt, moraleClock, moraleContext, QUIET } from './morale';
import { activeRoster, setTeam, teamPlayers } from './roster';
import { tierOf, unitOf, weightOf, type Unit } from './standing';
import { beat, closeRoomStories, closeStory, COACH, openStory, STORIES, storyById, talkBeat, untold } from './stories';
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

describe('mid-story: the people writing', () => {
  it('a coordinator relieved closes his staff story with "relieved"', () => {
    const l = fresh();
    const c = teamCoaches(l, l.userTeamId).find((x) => x.role === 'offCoord')!;
    c.belief = { WR: -0.3 };
    storiesStep(l);
    const s = openStory(l, { kind: 'staff', teamId: l.userTeamId, coachId: c.id })!;
    l.phase = 'resign';
    releaseCoach(l, l.userTeamId, c.id);
    l.phase = 'regular';
    leadershipEvent(l, { teamId: l.userTeamId, kind: 'coachRelieved', coachId: c.id, report: 'Relieved.' });
    next(l);
    expect(s.beats.at(-1)!.kind).toBe('relieved');
    expect(s.closed).toBeDefined();
  });

  it('you leave your job: open rows close, the old club’s stories are dropped, the new club’s start empty', () => {
    const l = fresh();
    const old = l.userTeamId;
    const man = men(l, 'DL')[0];
    const clock = l.moraleAt!;
    man.morale!.talk = { club: old, ask: { cause: 'deal', at: clock } };
    beat(l, { kind: 'deal', teamId: old, playerId: man.id }, 'asked', clock);
    const done = beat(l, { kind: 'snaps', teamId: old, playerId: man.id }, 'asked', clock)!;
    closeStory(l, { kind: 'snaps', teamId: old, playerId: man.id }, 'left', clock);
    expect(done.closed).toBeDefined();
    expect(talkCard(l, { clock, playerId: man.id }).state).toBe('open');
    const target = l.teams.find((t) => t.id !== old)!.id;
    l.phase = 'resign';
    endGmAppointment(l, l.userGmId, 'dismissed');
    endGmAppointment(l, l.teams[target].gmId!, 'dismissed');
    // Between jobs: nothing you press would answer him, and no story is kept.
    expect(talkCard(l, { clock, playerId: man.id }).state).toBe('closed');
    expect(beat(l, { kind: 'deal', teamId: old, playerId: man.id }, 'answered', clock + 1)).toBeNull();
    beginGmSearch(l);
    l.leadership.search!.offers = [{ teamId: target, through: l.season + 2, expiresRound: 2 }];
    acceptGmOffer(l, target);
    expect([...l.stories!.open, ...l.stories!.closed].filter((s) => s.teamId === old)).toEqual([]);
    expect(talkCard(l, { clock, playerId: man.id }).state).toBe('closed');
    // The new club's store starts empty, and its first beat opens a story.
    expect([...l.stories!.open, ...l.stories!.closed]).toEqual([]);
    const mine = teamPlayers(l, target)[0];
    expect(beat(l, { kind: 'deal', teamId: target, playerId: mine.id }, 'asked', clock + 2)).not.toBeNull();
    expect(l.stories!.open).toHaveLength(1);
  });
});

describe('a story gone quiet', () => {
  /** A man's deal story: asked and answered a long time ago, nothing pending. */
  function dealStory(l: League, age = QUIET) {
    const p = activeRoster(l, l.userTeamId)[5];
    const on = { kind: 'deal' as const, teamId: l.userTeamId, playerId: p.id };
    const at = l.moraleAt! - age;
    const s = beat(l, on, 'asked', at - 1)!;
    beat(l, on, 'answered', at, { how: 'reassure' });
    return { p, on, s };
  }

  it('closes a deal story with nothing pending once its last beat is eight steps old, told so no closing row', () => {
    const l = fresh();
    const { s } = dealStory(l);
    storiesStep(l);
    expect(s.beats.at(-1)!.kind).toBe('quiet');
    expect(l.stories!.open).not.toContain(s);
    expect(untold(l, s, COACH)).toHaveLength(0);
  });

  it('waits until the last beat is old enough', () => {
    const l = fresh();
    const { s } = dealStory(l, QUIET - 1);
    storiesStep(l);
    expect(l.stories!.open).toContain(s);
  });

  it.each([
    [
      'an open ask on him for that cause',
      (p: Player, l: League) => (p.morale!.talk = { club: l.userTeamId, ask: { cause: 'deal', at: l.moraleAt! } }),
    ],
    [
      'an open promise',
      (p: Player, l: League) =>
        (p.morale!.talk = {
          club: l.userTeamId,
          promise: { kind: 'deal', made: l.moraleAt! - 9, due: l.moraleAt! + 5 } as never,
        }),
    ],
    [
      'an open dispute',
      (p: Player) => (p.morale!.dispute = { kind: 'holdIn', cause: 'deal', since: 1, club: p.teamId! } as never),
    ],
    [
      'a commitment from a meeting naming him',
      (p: Player, l: League) => {
        l.teams[l.userTeamId].meetings!.open = [
          { backing: 'talks', scope: 'WR', opened: 1, closes: 99, named: [p.id], boughtIn: [], by: 'coach' },
        ];
      },
    ],
  ])('does not close with %s', (_name, block) => {
    const l = fresh();
    const { p, s } = dealStory(l);
    p.morale ??= { level: 0 };
    block(p, l);
    storiesStep(l);
    expect(l.stories!.open).toContain(s);
  });

  it('does not close a story with a deadline (`due`)', () => {
    const l = fresh();
    const { on, s } = dealStory(l);
    beat(l, on, 'promised', l.moraleAt! - QUIET, { due: l.moraleAt! + 3 });
    storiesStep(l);
    expect(l.stories!.open).toContain(s);
  });

  it('leaves a benching alone, and a standing feud', () => {
    const l = fresh();
    const p = activeRoster(l, l.userTeamId)[5];
    const b = beat(l, { kind: 'benched', teamId: l.userTeamId, playerId: p.id }, 'sat', l.moraleAt! - 20)!;
    storiesStep(l);
    expect(l.stories!.open).toContain(b);
  });

  it('re-opens with its history when he raises it again that league year, so a callback reads the earlier answer', () => {
    const l = fresh();
    const { on, s } = dealStory(l);
    storiesStep(l);
    expect(l.stories!.open).not.toContain(s);
    const again = beat(l, on, 'asked', l.moraleAt! + 2)!;
    expect(again.id).toBe(s.id);
    expect(again.beats.map((b) => b.kind)).toEqual(['asked', 'answered', 'quiet', 'asked']);
    expect(again.beats[1].how).toBe('reassure');
    expect(untold(l, again, COACH).map((b) => b.kind)).toEqual(['asked']);
  });
});

describe('the end of the season', () => {
  it('closes staff stories silently with the room stories, and leaves a man’s deal story open', () => {
    const l = fresh();
    const c = teamCoaches(l, l.userTeamId).find((x) => x.role === 'offCoord')!;
    c.belief = { WR: -0.3 };
    storiesStep(l);
    const staff = openStory(l, { kind: 'staff', teamId: l.userTeamId, coachId: c.id })!;
    const p = activeRoster(l, l.userTeamId)[5];
    const deal = beat(l, { kind: 'deal', teamId: l.userTeamId, playerId: p.id }, 'asked', l.moraleAt!)!;
    closeRoomStories(l);
    expect(l.stories!.open).not.toContain(staff);
    expect(staff.beats.at(-1)!.kind).toBe('ended');
    expect(untold(l, staff, COACH)).toHaveLength(0);
    expect(l.stories!.open).toContain(deal);
  });
});
