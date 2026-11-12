import { describe, expect, it } from 'vitest';
import { createLeague } from './generate';
import { moraleAdvance, moraleContext, type MoraleContext } from './morale';
import {
  aiReply,
  answerRoomTalk,
  answerTalk,
  BOILING,
  canPromise,
  FORM_TALK,
  losingReachesYou,
  roomAsks,
  talksAt,
  talkStep,
  waitFor,
} from './playerTalks';
import { activeRoster, setTeam } from './roster';
import { POSITIONS, type League, type MoraleJolt, type Player } from './types';

/**
 * A man made to sulk about one thing: a rookie (no contract grievance) with an average makeup, no ties, a mood at Very
 * poor and one big jolt that names his cause (a benching → snaps, a snub → a deal).
 */
function sulker(l: League, teamId: number, index: number, kind: MoraleJolt = 'benched', level = -4): Player {
  const p = activeRoster(l, teamId).filter((x) => x.contract?.kind === 'rookie' && x.experience < 3)[index];
  p.ties = [];
  delete p.shifts;
  p.traits = { ...p.traits, temperament: 11 };
  p.personality = { ...p.personality, patience: 0.5, loyalty: 0.5 };
  p.morale = { level, jolts: [{ kind, size: -8, at: l.moraleAt! }] };
  return p;
}

/** Steps the league's moods `n` times from where they stand. */
function steps(l: League, n: number) {
  for (let i = 0; i < n; i++) moraleAdvance(l, l.moraleAt! + 1);
}

/** A league where everyone starts in good spirits, so only the men a test makes sulk have a cause to ask. */
function fresh(): League {
  const l = createLeague({ seed: 'talks' });
  for (const p of Object.values(l.players)) if (p.morale) p.morale.level = 4;
  return l;
}

describe('talks: who asks', () => {
  it('asks at his third step down, not his second', () => {
    const l = fresh();
    const p = sulker(l, l.userTeamId, 0);
    steps(l, 2);
    expect(p.morale!.talk?.ask).toBeUndefined();
    steps(l, 1);
    expect(p.morale!.talk?.ask).toEqual({ cause: 'snaps', at: l.moraleAt });
  });

  it('names a deal when the snub is what weighs on him', () => {
    const l = fresh();
    const p = sulker(l, l.userTeamId, 0, 'snubbed');
    steps(l, 3);
    expect(p.morale!.talk?.ask?.cause).toBe('deal');
  });

  it('never asks without a cause he could be answered on', () => {
    const l = fresh();
    const p = sulker(l, l.userTeamId, 0, 'friendGone');
    steps(l, 4);
    expect(p.morale!.talk?.ask).toBeUndefined();
  });

  it('files two asks a club a step, the unhappiest first', () => {
    const l = fresh();
    const [a, b, c] = [
      sulker(l, l.userTeamId, 0, 'benched', -3),
      sulker(l, l.userTeamId, 1, 'benched', -9),
      sulker(l, l.userTeamId, 2, 'benched', -6),
    ];
    steps(l, 3);
    const asked = [a, b, c].filter((p) => p.morale!.talk?.ask).map((p) => p.id);
    expect(asked.sort()).toEqual([b.id, c.id].sort());
  });

  it('talks only at weeks, the re-sign window and camp', () => {
    const l = fresh();
    expect(talksAt({ ...l, phase: 'regular' }, 9)).toBe(true);
    expect(talksAt({ ...l, phase: 'playoffs' }, 28)).toBe(true);
    expect(talksAt({ ...l, phase: 'resign' }, 0)).toBe(true);
    expect(talksAt({ ...l, phase: 'preseason' }, 7)).toBe(true);
    expect(talksAt({ ...l, phase: 'freeAgency' }, 2)).toBe(false);
    expect(talksAt({ ...l, phase: 'draft' }, 6)).toBe(false);
  });

  it('holds the flood: across the re-sign window, camp and week one, two a step and nobody twice', () => {
    const l = fresh();
    const down = [0, 1, 2, 3, 4].map((i) => sulker(l, l.userTeamId, i, 'benched', -9));
    const seen = new Map<number, number>();
    for (let i = 0; i < 10; i++) {
      steps(l, 1);
      const now = down.filter((p) => p.morale!.talk?.ask?.at === l.moraleAt);
      expect(now.length).toBeLessThanOrEqual(2);
      for (const p of now) seen.set(p.id, (seen.get(p.id) ?? 0) + 1);
    }
    expect([...seen.values()].every((n) => n === 1)).toBe(true);
  });
});

describe('talks: the answers', () => {
  it('an AI club answers at once, by its GM', () => {
    const l = fresh();
    const other = (l.userTeamId + 1) % 32;
    l.teams[other].gm = { ...l.teams[other].gm!, loyalty: 0.8, stubbornness: 0.3 };
    expect(aiReply(l, other, 'snaps')).toBe('promise');
    expect(aiReply(l, other, 'losing')).toBe('reassure');
    l.teams[other].gm = { ...l.teams[other].gm!, loyalty: 0.8, stubbornness: 0.7 };
    expect(aiReply(l, other, 'deal')).toBe('firm');
    l.teams[other].gm = { ...l.teams[other].gm!, loyalty: 0.5, stubbornness: 0.5 };
    expect(aiReply(l, other, 'snaps')).toBe('reassure');
    l.teams[other].gmId = null;
    expect(aiReply(l, other, 'snaps')).toBe('reassure');
    const p = sulker(l, (l.userTeamId + 2) % 32, 0);
    steps(l, 3);
    expect(p.morale!.talk?.ask).toBeUndefined();
    expect(p.morale!.talk?.answered?.at).toBe(l.moraleAt);
  });

  it('promises lift him by his trust; reassurance halves each time; firmness stings a volatile man', () => {
    const l = fresh();
    const p = sulker(l, l.userTeamId, 0);
    steps(l, 3);
    p.morale!.talk!.broken = 1;
    expect(answerTalk(l, p.id, 'promise')).toBe(true);
    expect(p.morale!.jolts!.find((j) => j.kind === 'promised')?.size).toBe(1.5);
    expect(p.morale!.talk!.promise?.kind).toBe('snaps');

    const q = sulker(l, l.userTeamId, 1);
    q.morale!.talk = { club: l.userTeamId, ask: { cause: 'losing', at: l.moraleAt! } };
    expect(canPromise('losing')).toBe(false);
    expect(answerTalk(l, q.id, 'promise')).toBe(false);
    expect(answerTalk(l, q.id, 'reassure')).toBe(true);
    expect(q.morale!.jolts!.find((j) => j.kind === 'reassured')?.size).toBe(1);
    q.morale!.talk!.ask = { cause: 'losing', at: l.moraleAt! };
    answerTalk(l, q.id, 'reassure');
    expect(q.morale!.jolts!.filter((j) => j.kind === 'reassured').map((j) => j.size)).toEqual([1, 0.5]);

    for (const [temperament, size] of [
      [14, undefined],
      [1, -1.36],
    ] as const) {
      const r = sulker(l, l.userTeamId, temperament === 14 ? 2 : 3);
      r.traits.temperament = temperament;
      r.morale!.talk = { club: l.userTeamId, ask: { cause: 'feud', at: l.moraleAt! } };
      answerTalk(l, r.id, 'firm');
      expect(r.morale!.jolts?.find((j) => j.kind === 'firm')?.size).toBe(size);
    }
  });

  it('closes an unanswered letter as ignored by the third step for your club, and a late answer does nothing', () => {
    const l = fresh();
    const p = sulker(l, l.userTeamId, 0);
    steps(l, 3);
    const at = p.morale!.talk!.ask!.at;
    steps(l, 2);
    expect(p.morale!.talk!.ask).toBeDefined();
    steps(l, 1);
    expect(p.morale!.talk!.ask).toBeUndefined();
    expect(p.morale!.talk!.answered).toEqual({ reply: 'ignored', at: l.moraleAt, ask: at, cause: 'snaps' });
    expect(p.morale!.jolts!.some((j) => j.kind === 'ignored' && j.size === -1)).toBe(true);
    const before = JSON.stringify(p.morale);
    expect(answerTalk(l, p.id, 'reassure')).toBe(false);
    expect(JSON.stringify(p.morale)).toBe(before);
  });

  it("waits a step longer on your club's ask than on an AI club's (the coach writes every other step)", () => {
    const l = fresh();
    const mine = sulker(l, l.userTeamId, 0);
    const theirs = sulker(l, (l.userTeamId + 1) % 32, 0);
    expect(waitFor(l, mine)).toBe(waitFor(l, theirs) + 1);
    expect(waitFor(l, theirs)).toBe(2);
  });

  it("refuses an answer for another club's player", () => {
    const l = fresh();
    const p = sulker(l, (l.userTeamId + 1) % 32, 0);
    p.morale!.talk = { club: p.teamId!, ask: { cause: 'snaps', at: l.moraleAt! } };
    expect(answerTalk(l, p.id, 'reassure')).toBe(false);
  });

  it('stays quiet for eight steps after an answer (the owner: less mail)', () => {
    const l = fresh();
    const p = sulker(l, l.userTeamId, 0, 'benched', -9);
    steps(l, 3);
    answerTalk(l, p.id, 'firm');
    for (let i = 0; i < 8; i++) {
      p.morale!.jolts = [{ kind: 'benched', size: -8, at: l.moraleAt! }];
      p.morale!.level = -9;
      steps(l, 1);
      if (i < 7) expect(p.morale!.talk?.ask).toBeUndefined();
    }
    expect(p.morale!.talk?.ask).toBeDefined();
  });

  it('is the same every time: a copy stepped alike asks and answers alike', () => {
    const a = fresh();
    for (const t of [0, 3, 9]) [0, 1, 2].forEach((i) => sulker(a, t, i));
    const b = structuredClone(a);
    steps(a, 5);
    steps(b, 5);
    const talks = (l: League) => JSON.stringify(Object.values(l.players).map((p) => p.morale?.talk ?? null));
    expect(talks(a)).toBe(talks(b));
  });
});

describe('talks: promises kept and broken', () => {
  /** Every club `g` games in, a league-average starter at 60 snaps a game. */
  function played(l: League, g: number): MoraleContext {
    const ctx = moraleContext(l);
    for (const r of ctx.records.values()) Object.assign(r, { w: g, l: 0, t: 0 });
    for (const pos of POSITIONS) ctx.live[pos] = 60 * g;
    return ctx;
  }
  const snapsAt = (l: League, p: Player, snaps: number) => (p.stats[l.season] = { ...p.stats[l.season], gp: 1, snaps });

  function promised(l: League, cause: 'snaps' | 'deal' = 'snaps', index = 0) {
    const p = sulker(l, l.userTeamId, index);
    p.morale!.talk = { club: l.userTeamId, ask: { cause, at: l.moraleAt! } };
    expect(answerTalk(l, p.id, 'promise')).toBe(true);
    p.morale!.talk!.promise!.role = 2;
    return p;
  }
  const kinds = (p: Player) => (p.morale!.jolts ?? []).map((j) => j.kind);

  it('keeps a snaps promise on a starter’s snaps over two games, not one', () => {
    const l = fresh();
    const p = promised(l);
    const c = l.moraleAt!;
    snapsAt(l, p, 60);
    talkStep(l, played(l, 1), c + 1, 9, false);
    expect(p.morale!.talk!.promise).toBeDefined();
    snapsAt(l, p, 120);
    talkStep(l, played(l, 2), c + 2, 10, false);
    expect(p.morale!.talk!.promise).toBeUndefined();
    expect(p.morale!.talk!.kept).toBe(1);
    expect(kinds(p)).toContain('kept');
  });

  it('breaks it after four games without the snaps; a game missed hurt does not count', () => {
    const l = fresh();
    const p = promised(l);
    const c = l.moraleAt!;
    p.injury = { type: 'Hamstring strain', weeksRemaining: 1 } as Player['injury'];
    talkStep(l, played(l, 1), c + 1, 9, false);
    expect(p.morale!.talk!.promise!.left).toBe(4);
    delete p.injury;
    for (let g = 2; g <= 4; g++) talkStep(l, played(l, g), c + g, 8 + g, false);
    expect(p.morale!.talk!.promise!.left).toBe(1);
    talkStep(l, played(l, 5), c + 5, 13, false);
    expect(p.morale!.talk!.promise).toBeUndefined();
    expect(p.morale!.talk!.broken).toBe(1);
    expect(kinds(p)).toContain('broken');
  });

  it('carries a snaps promise’s games left across the season’s end', () => {
    const l = fresh();
    const p = promised(l);
    const pr = p.morale!.talk!.promise!;
    Object.assign(pr, { left: 2, seen: { season: l.season - 1, games: 16, snaps: 0 } });
    talkStep(l, played(l, 0), l.moraleAt! + 1, 9, false);
    expect(pr.left).toBe(2);
    talkStep(l, played(l, 1), l.moraleAt! + 2, 10, false);
    expect(p.morale!.talk!.promise!.left).toBe(1);
  });

  it('keeps a deal promise made in season with a raise in next year’s re-sign window, and breaks it when the window closes', () => {
    const l = fresh();
    const p = promised(l, 'deal');
    const due = (l.season + 1) * 32 + 1;
    expect(p.morale!.talk!.promise!.due).toBe(due);
    const q = promised(l, 'deal', 1);
    // Next league year: the re-sign window closes at `due`.
    p.morale!.jolts = [{ kind: 'paid', size: 3, at: due }];
    talkStep(l, played(l, 0), due, 1, false);
    expect(p.morale!.talk!.kept).toBe(1);
    expect(q.morale!.talk!.broken).toBe(1);
  });

  it('breaks an open promise when he is traded, and clears his record', () => {
    const l = fresh();
    const p = promised(l);
    setTeam(l, p, (l.userTeamId + 1) % 32);
    talkStep(l, played(l, 1), l.moraleAt! + 1, 9, false);
    expect(kinds(p)).toContain('broken');
    expect(p.morale!.talk?.promise).toBeUndefined();
    expect(p.morale!.talk?.club ?? p.teamId).toBe(p.teamId);
  });

  it('does not blame you for another club’s broken promise when he arrives', () => {
    const l = fresh();
    const other = (l.userTeamId + 1) % 32;
    const p = activeRoster(l, other)[0];
    p.morale = { level: 0, talk: { club: other, promise: { kind: 'deal', made: l.moraleAt!, due: l.moraleAt! + 40 } } };
    setTeam(l, p, l.userTeamId);
    talkStep(l, played(l, 1), l.moraleAt! + 1, 9, false);
    expect(kinds(p)).not.toContain('broken');
    expect(p.morale!.talk).toBeUndefined();
  });

  it('does not blame you for another club’s promise when he walks in free agency and you sign him', () => {
    const l = fresh();
    const other = (l.userTeamId + 1) % 32;
    const p = activeRoster(l, other)[0];
    p.morale = { level: 0, talk: { club: other, promise: { kind: 'deal', made: l.moraleAt!, due: l.moraleAt! + 40 } } };
    // He walks: a free agent keeps no jolts (G1), so the promise his old club left open costs nothing.
    p.teamId = null;
    talkStep(l, played(l, 1), l.moraleAt! + 1, 9, false);
    expect(kinds(p)).not.toContain('broken');
    expect(p.morale!.talk).toBeUndefined();
    // You sign him the next step: nothing of theirs follows him in.
    setTeam(l, p, l.userTeamId);
    talkStep(l, played(l, 1), l.moraleAt! + 2, 9, false);
    expect(kinds(p)).not.toContain('broken');
  });

  it('fades what he remembers at the new league year', () => {
    const l = fresh();
    const p = activeRoster(l, l.userTeamId)[0];
    p.morale!.talk = { club: l.userTeamId, kept: 2, broken: 1, reassured: 3 };
    talkStep(l, played(l, 0), (l.season + 1) * 32, 0, true);
    expect(p.morale!.talk).toEqual({ club: l.userTeamId, kept: 1 });
  });
});

describe('talks: what an answer was about (G4)', () => {
  it('records the ask it answered, an ignored letter too', () => {
    const l = fresh();
    const p = sulker(l, l.userTeamId, 0);
    steps(l, 3);
    const cause = p.morale!.talk!.ask!.cause;
    expect(answerTalk(l, p.id, 'reassure')).toBe(true);
    expect(p.morale!.talk!.answered?.cause).toBe(cause);
    const q = sulker(l, l.userTeamId, 1);
    q.morale!.talk = { club: l.userTeamId, ask: { cause: 'losing', at: l.moraleAt! } };
    steps(l, 3);
    expect(q.morale!.talk?.answered).toMatchObject({ reply: 'ignored', cause: 'losing' });
  });
});

describe("talks: the club's losing", () => {
  it('is answered once for every man with an open ask, whatever his room, and the answer is kept', () => {
    const l = fresh();
    const dl = activeRoster(l, l.userTeamId).filter((p) => p.position === 'DT' || p.position === 'EDGE');
    const wr = activeRoster(l, l.userTeamId).find((p) => p.position === 'WR')!;
    for (const p of [dl[0], wr])
      p.morale = { level: -4, talk: { club: l.userTeamId, ask: { cause: 'losing', at: l.moraleAt! } } };
    expect(roomAsks(l)).toHaveLength(2);
    expect(answerRoomTalk(l, 'team', 'reassure')).toBe(2);
    expect(dl[0].morale!.talk?.answered?.reply).toBe('reassure');
    expect(wr.morale!.talk?.answered?.reply).toBe('reassure');
    expect(l.teams[l.userTeamId].losingAnswer?.team).toEqual({ reply: 'reassure', at: l.moraleAt });
    expect(answerRoomTalk(l, 'team', 'firm')).toBe(0);
  });
});

describe('talks: the losing reaches you only when it boils over', () => {
  it('comes from a captain, or from anyone once the club has lost four straight', () => {
    const l = fresh();
    const p = sulker(l, l.userTeamId, 0);
    const ctx = moraleContext(l);
    const run = (n: number): MoraleContext => ({
      ...ctx,
      records: new Map([[l.userTeamId, { ...ctx.records.get(l.userTeamId)!, streak: `L${n}` }]]),
    });
    expect(losingReachesYou(l, p, run(BOILING - 1))).toBe(false);
    expect(losingReachesYou(l, p, run(BOILING))).toBe(true);
    l.teams[l.userTeamId].captains = { season: l.season, offense: p.id, defense: -1, specialTeams: -1 };
    expect(losingReachesYou(l, p, run(0))).toBe(true);
  });

  it('files no ask for a man without standing, and leaves an AI club alone', () => {
    const l = fresh();
    const p = sulker(l, l.userTeamId, 0);
    p.morale = { level: -4 };
    p.personality = { ...p.personality, winning: 1 };
    l.history.push({ season: l.season - 1, records: { [l.userTeamId]: { w: 0, l: 17, t: 0 } } } as never);
    steps(l, 3);
    expect(p.morale!.talk?.ask).toBeUndefined();
    expect(p.morale!.talk?.answered).toBeUndefined();
  });

  it('keeps the words of "lead the room" apart from a plain reassurance', () => {
    const l = fresh();
    const p = sulker(l, l.userTeamId, 0);
    p.morale = { level: -4, talk: { club: l.userTeamId, ask: { cause: 'losing', at: l.moraleAt! } } };
    expect(answerRoomTalk(l, 'team', 'reassure', true)).toBe(1);
    expect(p.morale!.talk!.answered).toMatchObject({ reply: 'reassure', lead: true });
  });
});

describe('talks: the losing inside the gap', () => {
  /** A rookie whose only weight is a losing club (last season's record), asking at his third step down. */
  function loser(l: League, teamId: number): Player {
    const p = sulker(l, teamId, 0);
    p.morale = { level: -4 };
    p.personality = { ...p.personality, winning: 1 };
    l.history.push({ season: l.season - 1, records: { [teamId]: { w: 0, l: 17, t: 0 } } } as never);
    return p;
  }

  it('answers your man as you last answered, files no ask, and asks again once the gap has passed', () => {
    const l = fresh();
    const p = loser(l, l.userTeamId);
    l.teams[l.userTeamId].losingAnswer = { team: { reply: 'firm', at: l.moraleAt! } };
    steps(l, 3);
    expect(p.morale!.talk?.ask).toBeUndefined();
    expect(p.morale!.talk?.answered).toMatchObject({ reply: 'firm', cause: 'losing' });

    const m = fresh();
    const q = loser(m, m.userTeamId);
    // A captain: the losing reaches your desk only from a man the room follows.
    m.teams[m.userTeamId].captains = { season: m.season, offense: q.id, defense: -1, specialTeams: -1 };
    m.teams[m.userTeamId].losingAnswer = { team: { reply: 'firm', at: m.moraleAt! - 10 } };
    steps(m, 3);
    expect(q.morale!.talk?.ask).toEqual({ cause: 'losing', at: m.moraleAt });
  });

  it('leaves an AI club to its GM', () => {
    const l = fresh();
    const other = (l.userTeamId + 1) % 32;
    l.teams[other].gm = { ...l.teams[other].gm!, loyalty: 0.3, stubbornness: 0.1 };
    const p = loser(l, other);
    l.teams[l.userTeamId].losingAnswer = { team: { reply: 'firm', at: l.moraleAt! } };
    steps(l, 3);
    expect(p.morale!.talk?.ask).toBeUndefined();
    expect(p.morale!.talk?.answered).toMatchObject({ reply: aiReply(l, other, 'losing'), cause: 'losing' });
  });
});

describe('talks: a slumping leader asks where he stands', () => {
  /** A starting quarterback who is down for no reason a club could answer, on a club whose passing game is in a slump. */
  function slumping(l: League, teamId: number, level = -4): Player {
    const p = activeRoster(l, teamId).find((x) => x.position === 'QB')!;
    p.ties = [];
    delete p.shifts;
    p.traits = { ...p.traits, temperament: 11, poise: 11 };
    p.personality = { ...p.personality, patience: 0.5, loyalty: 0.5 };
    p.morale = { level, jolts: [{ kind: 'friendGone', size: -8, at: l.moraleAt! }] };
    const team = l.teams[teamId];
    team.jobs = {
      ...(team.jobs ?? {}),
      held: { ...(team.jobs?.held ?? {}), [p.id]: { pos: 'QB', since: l.moraleAt! } },
    };
    return p;
  }
  const inSlumpOnly = (ids: number[]) => {
    const was = FORM_TALK.slump;
    FORM_TALK.slump = (_l, id) => ids.includes(id);
    return () => {
      FORM_TALK.slump = was;
    };
  };

  it('files a form ask for a starting quarterback who is down and in a slump, and for nobody short of that', () => {
    const l = fresh();
    const p = slumping(l, l.userTeamId);
    const undo = inSlumpOnly([p.id]);
    try {
      steps(l, 2);
      expect(p.morale!.talk?.ask).toBeUndefined();
      steps(l, 1);
      expect(p.morale!.talk?.ask).toEqual({ cause: 'form', at: l.moraleAt });
      // Not down: nothing to ask.
      const m = fresh();
      const happy = slumping(m, m.userTeamId, 4);
      FORM_TALK.slump = (_l, id) => id === happy.id;
      steps(m, 4);
      expect(happy.morale!.talk?.ask).toBeUndefined();
      // No starting job: a backup's unit is not his to answer for.
      const n = fresh();
      const backup = slumping(n, n.userTeamId);
      delete n.teams[n.userTeamId].jobs!.held[backup.id];
      FORM_TALK.slump = (_l, id) => id === backup.id;
      steps(n, 4);
      expect(backup.morale!.talk?.ask).toBeUndefined();
      // No slump: nothing public to ask about.
      const o = fresh();
      const fine = slumping(o, o.userTeamId);
      FORM_TALK.slump = () => false;
      steps(o, 4);
      expect(fine.morale!.talk?.ask).toBeUndefined();
    } finally {
      undo();
    }
  });

  it('has two answers and no promise, and neither sours him', () => {
    const l = fresh();
    const p = slumping(l, l.userTeamId);
    const undo = inSlumpOnly([p.id]);
    try {
      steps(l, 3);
      expect(canPromise('form')).toBe(false);
      expect(answerTalk(l, p.id, 'promise')).toBe(false);
      const before = p.morale!.jolts!.length;
      expect(answerTalk(l, p.id, 'reassure')).toBe(true);
      expect(p.morale!.jolts!.length).toBe(before + 1);
      expect(p.morale!.jolts!.at(-1)).toMatchObject({ kind: 'reassured' });
      expect(p.morale!.jolts!.at(-1)!.size).toBeGreaterThan(0);
      expect(p.morale!.talk!.sour).toBeUndefined();
      expect(p.morale!.talk!.form).toBe(l.season);
      expect(p.morale!.talk!.ask).toBeUndefined();
    } finally {
      undo();
    }
  });

  it('takes "play your way out of it" by his poise: a steady man lifts, a fragile one drops', () => {
    const run = (poise: number) => {
      const l = fresh();
      const p = slumping(l, l.userTeamId);
      p.traits = { ...p.traits, poise };
      const undo = inSlumpOnly([p.id]);
      try {
        steps(l, 3);
        answerTalk(l, p.id, 'firm');
      } finally {
        undo();
      }
      expect(p.morale!.talk!.sour).toBeUndefined();
      return p.morale!.jolts!.filter((j) => j.kind === 'firm').reduce((a, j) => a + j.size, 0);
    };
    expect(run(18)).toBeGreaterThan(0);
    expect(run(4)).toBeLessThan(0);
    expect(run(18)).toBeLessThanOrEqual(0.5);
    expect(run(4)).toBeGreaterThanOrEqual(-1);
  });

  it('asks once a season, and an unanswered ask lapses without souring', () => {
    const l = fresh();
    const p = slumping(l, l.userTeamId);
    const undo = inSlumpOnly([p.id]);
    try {
      steps(l, 3);
      const asked = l.moraleAt!;
      steps(l, waitFor(l, p));
      expect(p.morale!.talk!.ask).toBeUndefined();
      expect(p.morale!.talk!.answered).toMatchObject({ reply: 'ignored', ask: asked, cause: 'form' });
      expect(p.morale!.talk!.sour).toBeUndefined();
      // Still down and still in the slump weeks later: he does not ask again this season.
      p.morale!.level = -4;
      steps(l, 14);
      expect(p.morale!.talk?.ask).toBeUndefined();
    } finally {
      undo();
    }
  });

  it('is answered at once at an AI club, and goes with the man when he is traded', () => {
    const l = fresh();
    const other = (l.userTeamId + 3) % 32;
    const theirs = slumping(l, other);
    const mine = slumping(l, l.userTeamId);
    const undo = inSlumpOnly([theirs.id, mine.id]);
    try {
      steps(l, 3);
      expect(theirs.morale!.talk!.ask).toBeUndefined();
      expect(theirs.morale!.talk!.answered).toMatchObject({ cause: 'form', reply: aiReply(l, other, 'form') });
      expect(mine.morale!.talk!.ask?.cause).toBe('form');
      setTeam(l, mine, other);
      steps(l, 1);
      expect(mine.morale!.talk?.ask).toBeUndefined();
    } finally {
      undo();
    }
  });
});
