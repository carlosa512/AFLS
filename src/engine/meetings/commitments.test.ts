import { describe, expect, it } from 'vitest';
import { createLeague } from '../generate';
import { YEAR } from '../morale';
import { STARTERS } from '../positions';
import { activeRoster } from '../roster';
import { unitOf } from '../standing';
import type { Commitment, League, Player } from '../types';
import { aiKeepChance, deadlineClock, isKept, judgeCommitments, openCommitment, WINDOW } from './commitments';
import { CRED } from './credibility';
import { headCoachOf } from './suggest';

const base = createLeague({ seed: 'meetings-commit' });
const TEAM = 0;

function league(week = 5): League {
  const l = structuredClone(base);
  l.phase = 'regular';
  l.week = week;
  l.moraleAt = l.season * YEAR + 8 + week;
  for (const p of Object.values(l.players)) if (p.morale) p.morale = { level: 0 };
  return l;
}
const wrs = (l: League) => activeRoster(l, TEAM).filter((p) => unitOf(p.position) === 'WR');
const isStarter = (l: League, p: Player) =>
  (l.teams[TEAM].depthChart[p.position] ?? []).slice(0, STARTERS[p.position]).includes(p.id);

/** A snaps commitment naming a backup, two men bought in with a lift of 2 each. */
function snapsFor(l: League) {
  const men = wrs(l);
  const backup = men.find((p) => !isStarter(l, p))!;
  const other = men.find((p) => p !== backup)!;
  const c: Commitment = {
    backing: 'snaps',
    scope: 'WR',
    opened: l.moraleAt!,
    closes: l.moraleAt! + WINDOW.snaps,
    named: [backup.id],
    boughtIn: [backup.id, other.id],
    by: 'coach',
    lift: { [backup.id]: 2, [other.id]: 2 },
    coachId: headCoachOf(l, TEAM)!.id,
  };
  l.teams[TEAM].meetings!.open.push(c);
  return { c, backup, other };
}
const joltOf = (p: Player, kind: string) => p.morale?.jolts?.find((j) => j.kind === kind)?.size;
const step = (l: League, by = 1) => {
  l.moraleAt! += by;
  judgeCommitments(l);
};

describe('meetings: commitments', () => {
  it('kept: the named man starts, the room that bought in feels it, the coach gains, his record shows it', () => {
    const l = league();
    const { backup, other } = snapsFor(l);
    const hc = headCoachOf(l, TEAM)!;
    expect(isKept(l, TEAM, l.teams[TEAM].meetings!.open[0])).toBeNull();
    const chart = l.teams[TEAM].depthChart[backup.position]!;
    l.teams[TEAM].depthChart[backup.position] = [backup.id, ...chart.filter((id) => id !== backup.id)];
    step(l);
    expect(l.teams[TEAM].meetings!.open).toEqual([]);
    expect(joltOf(backup, 'kept')).toBe(1);
    expect(joltOf(other, 'kept')).toBe(1);
    expect(hc.credibility).toBeCloseTo(CRED.kept, 6);
    expect(backup.morale!.talk!.kept).toBe(1);
  });

  it('broken: the window closes untouched; a dip bigger than the lift; the word falls', () => {
    const l = league();
    const { backup, other } = snapsFor(l);
    const hc = headCoachOf(l, TEAM)!;
    step(l, 1);
    expect(l.teams[TEAM].meetings!.open.length).toBe(1);
    step(l, WINDOW.snaps);
    expect(l.teams[TEAM].meetings!.open).toEqual([]);
    expect(joltOf(backup, 'broken')).toBe(-3);
    expect(joltOf(other, 'broken')).toBe(-3);
    expect(hc.credibility).toBeCloseTo(CRED.broken, 6);
    expect(backup.morale!.talk!.broken).toBe(1);
  });

  it('a named man who leaves is void for him: the rest is judged on whoever is left', () => {
    const l = league();
    const [a, b] = wrs(l);
    l.teams[TEAM].meetings!.open.push({
      backing: 'talks',
      scope: 'WR',
      opened: l.moraleAt!,
      closes: l.moraleAt! + 2,
      named: [a.id, b.id],
      boughtIn: [a.id, b.id],
      by: 'coach',
      lift: { [a.id]: 2, [b.id]: 2 },
    });
    a.teamId = 5;
    step(l, 2);
    expect(joltOf(a, 'broken')).toBeUndefined();
    expect(a.morale!.talk?.broken).toBeUndefined();
    expect(joltOf(b, 'broken')).toBe(-3);
    expect(b.morale!.talk!.broken).toBe(1);
  });

  it('a hurt named man pushes the window back a week for each week out', () => {
    const l = league();
    const { c, backup } = snapsFor(l);
    const closes = c.closes;
    backup.injury = { ...(backup.injury ?? {}), weeksRemaining: 2 } as never;
    step(l);
    step(l);
    expect(l.teams[TEAM].meetings!.open[0].closes).toBe(closes + 2);
  });

  it('talks close at the deadline if sooner; everything left open is judged at the new league year', () => {
    const l = league(8);
    const opened = l.moraleAt!;
    const c = openCommitment(
      l,
      TEAM,
      {
        clock: opened,
        scope: 'WR',
        kind: 'trouble',
        approach: 'straight',
        backing: 'talks',
        timing: 'monday',
        outcomes: { lands: [], bristles: [] },
      },
      {
        clock: opened,
        scope: 'WR',
        kind: 'trouble',
        topic: 'deal',
        approaches: [],
        backings: [],
        timings: [],
        named: [],
      },
      {},
    )!;
    expect(c.closes).toBe(Math.min(opened + WINDOW.talks, deadlineClock(l.season)));
    expect(c.closes).toBe(deadlineClock(l.season));
    const { backup } = snapsFor(l);
    l.teams[TEAM].meetings!.open[0].closes = l.moraleAt! + 30;
    l.season += 1;
    l.moraleAt = l.season * YEAR;
    judgeCommitments(l);
    expect(l.teams[TEAM].meetings!.open).toEqual([]);
    expect(joltOf(backup, 'broken')).toBe(-3);
  });

  it('a head coach fired mid-window: still judged, and his word goes to no one', () => {
    const l = league();
    const { backup } = snapsFor(l);
    const hc = headCoachOf(l, TEAM)!;
    hc.teamId = null;
    step(l, WINDOW.snaps);
    expect(joltOf(backup, 'broken')).toBe(-3);
    expect(hc.credibility ?? 0).toBe(0);
  });

  it("an AI club keeps its word by its GM's tendencies, reproducibly", () => {
    expect(aiKeepChance({ loyalty: 1, stubbornness: 0 })).toBeCloseTo(0.85, 6);
    expect(aiKeepChance({ loyalty: 0, stubbornness: 1 })).toBeCloseTo(0.25, 6);
    expect(aiKeepChance({ loyalty: 0, stubbornness: 3 })).toBe(0.2);
    const run = () => {
      const l = league();
      l.userTeamId = 9;
      const { backup } = snapsFor(l);
      step(l, WINDOW.snaps);
      return [joltOf(backup, 'kept'), joltOf(backup, 'broken')];
    };
    const a = run();
    expect(a).toEqual(run());
    expect(a.filter((x) => x !== undefined).length).toBe(1);
  });
});

describe('meetings: a dug-in man and a commitment', () => {
  it('a kept commitment lifts no one who has dug in, and adds nothing to his record; a broken one still costs', () => {
    const l = league();
    const { backup, other } = snapsFor(l);
    backup.morale = { level: 0, dispute: { kind: 'trade', cause: 'snaps', since: l.moraleAt! - 1, club: TEAM } };
    const chart = l.teams[TEAM].depthChart[backup.position]!;
    l.teams[TEAM].depthChart[backup.position] = [backup.id, ...chart.filter((id) => id !== backup.id)];
    step(l);
    expect(joltOf(backup, 'kept')).toBeUndefined();
    expect(backup.morale!.talk?.kept).toBeUndefined();
    expect(joltOf(other, 'kept')).toBe(1);
    const l2 = league();
    const s2 = snapsFor(l2);
    s2.backup.morale = { level: 0, talk: { club: TEAM, sour: { cause: 'snaps', at: l2.moraleAt! - 1, run: 1 } } };
    step(l2, WINDOW.snaps);
    expect(joltOf(s2.backup, 'broken')).toBe(-3);
  });
});
