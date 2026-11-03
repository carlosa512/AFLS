import { describe, expect, it } from 'vitest';
import { setTrait } from '../coachTraits';
import { createLeague } from '../generate';
import { moraleContext, YEAR } from '../morale';
import { activeRoster } from '../roster';
import { unitOf } from '../standing';
import type { League, MeetingSuggestion, Player } from '../types';
import { headCoachOf, suggestMeeting } from './suggest';
import { CRED } from './credibility';
import { holdMeeting, JOLT, joltSize, outcomeEntries, REACT, reactionScore, type MeetingChoice } from './react';

const base = createLeague({ seed: 'meetings-react' });
const TEAM = 0;

function calm(week = 5): League {
  const l = structuredClone(base);
  l.phase = 'regular';
  l.week = week;
  l.moraleAt = l.season * YEAR + 8 + week;
  for (const p of Object.values(l.players)) {
    if (p.morale) p.morale = { level: 0.5 };
    delete p.ties;
  }
  return l;
}
const wrs = (l: League) => activeRoster(l, TEAM).filter((p) => unitOf(p.position) === 'WR');
const sugg = (l: League, over: Partial<MeetingSuggestion> = {}): MeetingSuggestion => ({
  clock: l.moraleAt!,
  scope: 'WR',
  kind: 'trouble',
  topic: 'snaps',
  approaches: ['straight', 'standard'],
  backings: ['words'],
  timings: ['afterGame', 'monday', 'wednesday'],
  named: [],
  ...over,
});
const straight: MeetingChoice = { approach: 'straight', backing: 'words', timing: 'monday' };
/** A man stung by a benching: his grievance is snaps. */
const stung = (l: League, p: Player) =>
  (p.morale = { level: -2, jolts: [{ kind: 'benched', size: -3, at: l.moraleAt! - 1 }] });

describe('meetings: a reaction score', () => {
  it('a topic that matches his grievance scores higher than one that misses', () => {
    const l = calm();
    const p = wrs(l)[0];
    stung(l, p);
    const ctx = moraleContext(l);
    const hit = reactionScore(l, TEAM, p, sugg(l, { topic: 'snaps' }), straight, ctx);
    const miss = reactionScore(l, TEAM, p, sugg(l, { topic: 'deal' }), straight, ctx);
    expect(hit - miss).toBeCloseTo(REACT.fit - REACT.miss, 6);
    expect(hit).toBeGreaterThan(miss);
  });

  it('a blunt coach and a short fuse score lower than a calm man', () => {
    const l = calm();
    setTrait(headCoachOf(l, TEAM)!, 'discipline', 18);
    const [a, b] = wrs(l);
    a.traits.temperament = 4;
    b.traits.temperament = 16;
    const ctx = moraleContext(l);
    const s = sugg(l, { topic: 'none' });
    expect(reactionScore(l, TEAM, a, s, straight, ctx)).toBeLessThan(reactionScore(l, TEAM, b, s, straight, ctx));
    // A calm coach doesn't set the short fuse off.
    setTrait(headCoachOf(l, TEAM)!, 'discipline', 4);
    const calmCoach = reactionScore(l, TEAM, a, s, straight, ctx);
    setTrait(headCoachOf(l, TEAM)!, 'discipline', 18);
    expect(reactionScore(l, TEAM, a, s, straight, ctx)).toBeLessThan(calmCoach);
  });

  it('a happy leader speaking helps; an unhappy one hurts', () => {
    const l = calm();
    const [leader, p] = wrs(l);
    const ctx = moraleContext(l);
    const choice: MeetingChoice = { approach: 'leader', backing: 'words', timing: 'monday' };
    const s = sugg(l, { leader: leader.id, approaches: ['leader', 'straight'] });
    leader.morale = { level: 6 };
    const happy = reactionScore(l, TEAM, p, s, choice, ctx);
    leader.morale = { level: -6 };
    const unhappy = reactionScore(l, TEAM, p, s, choice, ctx);
    leader.morale = { level: 0 };
    const even = reactionScore(l, TEAM, p, s, choice, ctx);
    expect(happy).toBeGreaterThan(even);
    expect(unhappy).toBeLessThan(even);
  });

  it('the same approach to the same room again this season scores lower', () => {
    const l = calm();
    const p = wrs(l)[0];
    const ctx = moraleContext(l);
    const first = reactionScore(l, TEAM, p, sugg(l), straight, ctx);
    l.teams[TEAM].meetings!.log.push({
      clock: l.moraleAt! - 5,
      scope: 'WR',
      kind: 'trouble',
      approach: 'straight',
      backing: 'words',
      timing: 'monday',
      outcomes: { lands: [], bristles: [] },
    });
    expect(reactionScore(l, TEAM, p, sugg(l), straight, ctx)).toBeLessThan(first);
  });

  it('a commitment that matches his grievance lifts him far more than words', () => {
    const l = calm();
    const p = wrs(l)[0];
    stung(l, p);
    const ctx = moraleContext(l);
    const s = sugg(l, { backings: ['snaps', 'feud', 'words'], namedFor: { snaps: [p.id] }, named: [p.id] });
    const words = reactionScore(l, TEAM, p, s, straight, ctx);
    const snaps = reactionScore(l, TEAM, p, s, { ...straight, backing: 'snaps' }, ctx);
    const other = reactionScore(l, TEAM, p, s, { ...straight, backing: 'feud' }, ctx);
    expect(snaps - words).toBeGreaterThan(0.6);
    expect(other - words).toBeLessThan(0.3);
  });
});

describe('meetings: holding one', () => {
  const ready = () => {
    const l = calm();
    const men = wrs(l);
    men.forEach((p, i) => (p.morale = { level: i % 2 ? 2 : -2 }));
    const s = suggestMeeting(l, TEAM, moraleContext(l))!;
    l.teams[TEAM].meetings!.pending = s;
    return l;
  };

  it('adds a meeting jolt, logs it, clears pending, and is reproducible', () => {
    const a = ready();
    const b = ready();
    const ra = holdMeeting(a, TEAM, straight);
    const rb = holdMeeting(b, TEAM, straight);
    expect(ra).toEqual(rb);
    expect(a.teams[TEAM].meetings!.pending).toBeUndefined();
    expect(a.teams[TEAM].meetings!.log.at(-1)).toEqual(ra);
    const moved = outcomeEntries(ra);
    expect(moved.length).toBeGreaterThan(0);
    for (const [id, o] of moved) {
      const j = a.players[Number(id)].morale!.jolts!.find((j) => j.kind === 'meeting')!;
      // A man with nothing wrong is moved a quarter as far.
      expect([2, 2 * JOLT.content]).toContain(Math.abs(j.size));
      expect(o === 'lands' ? j.size > 0 : j.size < 0).toBe(true);
    }
    expect(joltSize(a.teams[TEAM].meetings!.log.at(-1) as never, straight)).toBe(2 * JOLT.monday);
  });

  it('right after the game moves more than Wednesday', () => {
    const s = { kind: 'trouble' } as MeetingSuggestion;
    const after = joltSize(s, { ...straight, timing: 'afterGame' });
    const wed = joltSize(s, { ...straight, timing: 'wednesday' });
    expect(after / wed).toBeCloseTo(1.5 / 0.6, 6);
    const l = ready();
    const r = holdMeeting(l, TEAM, { ...straight, timing: 'afterGame' });
    const [id, o] = outcomeEntries(r)[0];
    const j = l.players[Number(id)].morale!.jolts!.find((j) => j.kind === 'meeting')!;
    expect([3, 3 * JOLT.content]).toContain(Math.abs(j.size));
    expect(o === 'lands' ? j.size > 0 : j.size < 0).toBe(true);
  });

  it("moves the head coach's word with the room, and spends a new voice", () => {
    const l = ready();
    const hc = headCoachOf(l, TEAM)!;
    hc.newVoice = 2;
    const before = hc.credibility ?? 0;
    const r = holdMeeting(l, TEAM, straight);
    const outs = outcomeEntries(r).map(([, o]) => o);
    const net =
      outs.filter((o) => o === 'lands').length * CRED.meetingLands +
      outs.filter((o) => o === 'bristles').length * CRED.meetingBristles;
    expect((hc.credibility ?? 0) - before).toBeCloseTo(net / wrs(l).length, 3);
    expect(hc.newVoice).toBe(1);
  });
});

describe('meetings: a man who has dug in', () => {
  it('a man in a dispute or whose talks have soured is never reached: at best he shrugs', () => {
    const l = calm();
    const men = wrs(l);
    men.forEach((p, i) => (p.morale = { level: i % 2 ? 2 : -2 }));
    const s = suggestMeeting(l, TEAM, moraleContext(l))!;
    l.teams[TEAM].meetings!.pending = s;
    const [a, b] = men;
    a.morale = { ...a.morale!, dispute: { kind: 'trade', cause: 'snaps', since: l.moraleAt! - 2, club: TEAM } };
    b.morale = { ...b.morale!, talk: { club: TEAM, sour: { cause: 'snaps', at: l.moraleAt! - 1, run: 1 } } };
    // Every man is pushed to land: only the two dug in may not.
    const r = holdMeeting(
      l,
      TEAM,
      { approach: 'straight', backing: 'words', timing: 'monday' },
      {
        trust: () => 5,
        lean: () => 0,
      },
    );
    expect(r.outcomes.lands).not.toContain(a.id);
    expect(r.outcomes.lands).not.toContain(b.id);
    expect(r.outcomes.lands.length).toBeGreaterThan(0);
  });
});
