import { describe, expect, it } from 'vitest';
import { createLeague } from './generate';
import { moraleAdvance, moraleContext, type MoraleContext } from './morale';
import { aiReply, answerTalk, canPromise, talksAt, talkStep } from './playerTalks';
import { activeRoster } from './roster';
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

  it('closes an unanswered letter as ignored by the second step, and a late answer does nothing', () => {
    const l = fresh();
    const p = sulker(l, l.userTeamId, 0);
    steps(l, 3);
    const at = p.morale!.talk!.ask!.at;
    steps(l, 1);
    expect(p.morale!.talk!.ask).toBeDefined();
    steps(l, 1);
    expect(p.morale!.talk!.ask).toBeUndefined();
    expect(p.morale!.talk!.answered).toEqual({ reply: 'ignored', at: l.moraleAt, ask: at });
    expect(p.morale!.jolts!.some((j) => j.kind === 'ignored' && j.size === -1)).toBe(true);
    const before = JSON.stringify(p.morale);
    expect(answerTalk(l, p.id, 'reassure')).toBe(false);
    expect(JSON.stringify(p.morale)).toBe(before);
  });

  it("refuses an answer for another club's player", () => {
    const l = fresh();
    const p = sulker(l, (l.userTeamId + 1) % 32, 0);
    p.morale!.talk = { club: p.teamId!, ask: { cause: 'snaps', at: l.moraleAt! } };
    expect(answerTalk(l, p.id, 'reassure')).toBe(false);
  });

  it('stays quiet for six steps after an answer', () => {
    const l = fresh();
    const p = sulker(l, l.userTeamId, 0, 'benched', -9);
    steps(l, 3);
    answerTalk(l, p.id, 'firm');
    for (let i = 0; i < 6; i++) {
      p.morale!.jolts = [{ kind: 'benched', size: -8, at: l.moraleAt! }];
      p.morale!.level = -9;
      steps(l, 1);
      if (i < 5) expect(p.morale!.talk?.ask).toBeUndefined();
    }
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
    p.teamId = (l.userTeamId + 1) % 32;
    talkStep(l, played(l, 1), l.moraleAt! + 1, 9, false);
    expect(kinds(p)).toContain('broken');
    expect(p.morale!.talk?.promise).toBeUndefined();
    expect(p.morale!.talk?.club ?? p.teamId).toBe(p.teamId);
  });

  it('fades what he remembers at the new league year', () => {
    const l = fresh();
    const p = activeRoster(l, l.userTeamId)[0];
    p.morale!.talk = { club: l.userTeamId, kept: 2, broken: 1, reassured: 3 };
    talkStep(l, played(l, 0), (l.season + 1) * 32, 0, true);
    expect(p.morale!.talk).toEqual({ club: l.userTeamId, kept: 1 });
  });
});
