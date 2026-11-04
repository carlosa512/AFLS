import { describe, expect, it } from 'vitest';
import { runnerOf } from './belief';
import { teamCoaches } from './coaching';
import { createLeague } from './generate';
import { leadershipMail } from './inbox';
import { playWeek } from './league';
import { aiKeepChance, judgeCommitments } from './meetings/commitments';
import { meetingsOf } from './meetings/suggest';
import { aiCover, aiRelieve, aiRelieveNow, onTheTable, RELIEVE } from './relieve';
import { Rng } from './rng';
import type { Commitment, League } from './types';

/** Six weeks in: enough games for a record to mean something. */
const base = (() => {
  const l = createLeague({ seed: 'relieve-ai' });
  for (let i = 0; i < 6; i++) playWeek(l);
  return JSON.stringify(l);
})();
const fresh = (): League => JSON.parse(base);
/** An AI club that hasn't relieved anyone yet this season. */
const AI = (l: League) =>
  l.teams.find(
    (t) => t.id !== l.userTeamId && !l.leadership.events.some((e) => e.teamId === t.id && e.kind === 'coachRelieved'),
  )!.id;
const coord = (l: League, t: number, role: 'offCoord' | 'defCoord') => teamCoaches(l, t).find((c) => c.role === role)!;

/** A club that lost every game this season, scoring little and allowing a lot, its offense's rooms doubting. */
function sink(l: League, t: number, scored = 3, allowed = 30) {
  for (const g of l.games) {
    if (g.season !== l.season || !g.result || (g.homeId !== t && g.awayId !== t)) continue;
    g.result.homeScore = g.homeId === t ? scored : allowed;
    g.result.awayScore = g.homeId === t ? allowed : scored;
  }
  const oc = coord(l, t, 'offCoord');
  oc.belief = { QB: -0.3, RB: -0.3, WR: -0.3, OL: -0.3 };
}

describe('AI clubs relieve coordinators', () => {
  it('off the table unless the club is losing, the side is among the worst and the rooms have turned', () => {
    const l = fresh();
    const t = AI(l);
    sink(l, t);
    expect(onTheTable(l, t, 'offCoord')).toBe(true);
    // Rooms that still believe.
    const a = fresh();
    sink(a, t);
    coord(a, t, 'offCoord').belief = { QB: 0, RB: 0, WR: -0.3, OL: 0 };
    expect(onTheTable(a, t, 'offCoord')).toBe(false);
    // A losing club whose offense scores plenty.
    const b = fresh();
    sink(b, t, 45, 50);
    expect(onTheTable(b, t, 'offCoord')).toBe(false);
    // A winning club.
    const c = fresh();
    sink(c, t, 40, 3);
    expect(onTheTable(c, t, 'offCoord')).toBe(false);
  });

  it('never touches your club, and at most once a club a season', () => {
    const l = fresh();
    const t = AI(l);
    sink(l, t);
    sink(l, l.userTeamId);
    coord(l, t, 'defCoord').belief = { DL: -0.6, LB: -0.6, DB: -0.6 };
    const was = RELIEVE.chance;
    RELIEVE.chance = 10;
    try {
      const mine = coord(l, l.userTeamId, 'offCoord').id;
      aiRelieve(l);
      expect(l.coaches[mine].teamId).toBe(l.userTeamId);
      const relieved = l.leadership.events.filter((e) => e.kind === 'coachRelieved' && e.teamId === t);
      expect(relieved).toHaveLength(1);
      aiRelieve(l);
      expect(l.leadership.events.filter((e) => e.kind === 'coachRelieved' && e.teamId === t)).toHaveLength(1);
    } finally {
      RELIEVE.chance = was;
    }
  });

  it("picks the better of the head coach's cover and an interim", () => {
    const l = fresh();
    const t = AI(l);
    const hc = teamCoaches(l, t).find((c) => c.role === 'headCoach')!;
    const pcs = teamCoaches(l, t).filter(
      (c) => c.role === 'positionCoach' && ['QB', 'RB', 'WR', 'OL'].includes(c.room!),
    );
    hc.youth = hc.veterans = 20;
    expect(aiCover(l, t, 'offCoord')).toBe('headCoach');
    hc.youth = hc.veterans = 1;
    for (const pc of pcs) pc.youth = pc.veterans = 18;
    const cover = aiCover(l, t, 'offCoord');
    // A position coach who'd step up beats a weak head coach (if one of them would take it at all).
    if (cover !== 'headCoach') expect(pcs.map((p) => p.id)).toContain(cover);
  });

  it('relieves the same men when a week is played twice', () => {
    const a = fresh();
    const b = fresh();
    const was = RELIEVE.chance;
    RELIEVE.chance = 10;
    try {
      for (const l of [a, b]) {
        sink(l, AI(l));
        playWeek(l);
      }
    } finally {
      RELIEVE.chance = was;
    }
    const ev = (l: League) => l.leadership.events.filter((e) => e.kind === 'coachRelieved').map((e) => e.report);
    expect(ev(a)).toEqual(ev(b));
  }, 120_000);

  it("SNN's roundup carries it", () => {
    const l = fresh();
    const t = AI(l);
    sink(l, t);
    const was = RELIEVE.chance;
    RELIEVE.chance = 10;
    try {
      aiRelieve(l);
    } finally {
      RELIEVE.chance = was;
    }
    const e = l.leadership.events.find((x) => x.kind === 'coachRelieved')!;
    expect(e).toBeDefined();
    const mail = leadershipMail(l, new Set());
    expect(mail.some((m) => m.body.includes(e.report) || m.subject.includes(e.report))).toBe(true);
  });

  it('an AI notice kept by its GM is kept by relieving him', () => {
    const l = fresh();
    const t = AI(l);
    // Only when it's come to that: losing, the offense among the worst, its rooms turned.
    sink(l, t);
    const oc = runnerOf(l, t, 'OL')!;
    oc.belief = { QB: -0.4, RB: -0.4, WR: -0.4, OL: -0.4 };
    l.moraleAt ??= l.season * 32;
    const closes = l.moraleAt;
    // An opening clock whose draw keeps it (the AI's word at the window's end is its GM's draw).
    let opened = closes - 4;
    while (
      !new Rng(`${l.seed}:meeting:${l.season}:${closes}:${t}:commit:${opened}`).chance(aiKeepChance(l.teams[t].gm))
    )
      opened--;
    const c: Commitment = {
      backing: 'notice',
      scope: 'OL',
      opened,
      closes,
      named: [],
      boughtIn: [],
      by: 'coach',
      coord: oc.id,
    };
    meetingsOf(l.teams[t]).open.push(c);
    judgeCommitments(l);
    expect(oc.teamId).toBeNull();
    expect(l.leadership.events.some((e) => e.kind === 'coachRelieved' && e.coachId === oc.id)).toBe(true);
  });

  it('an AI notice kept by its GM at a club that is winning is broken, and nobody goes', () => {
    const l = fresh();
    const t = AI(l);
    sink(l, t, 30, 3);
    const oc = runnerOf(l, t, 'OL')!;
    oc.belief = { QB: -0.4, RB: -0.4, WR: -0.4, OL: -0.4 };
    l.moraleAt ??= l.season * 32;
    const closes = l.moraleAt;
    let opened = closes - 4;
    while (
      !new Rng(`${l.seed}:meeting:${l.season}:${closes}:${t}:commit:${opened}`).chance(aiKeepChance(l.teams[t].gm))
    )
      opened--;
    meetingsOf(l.teams[t]).open.push({
      backing: 'notice',
      scope: 'OL',
      opened,
      closes,
      named: [],
      boughtIn: [],
      by: 'coach',
      coord: oc.id,
    });
    judgeCommitments(l);
    expect(oc.teamId).toBe(t);
  });

  it('relieves only in weeks five to fourteen, by the weekly draw or a notice alike', () => {
    const l = fresh();
    const t = AI(l);
    sink(l, t);
    const oc = runnerOf(l, t, 'OL')!;
    l.week = RELIEVE.to + 2;
    expect(aiRelieveNow(l, t, oc.id)).toBe(false);
    expect(oc.teamId).toBe(t);
    l.week = RELIEVE.from + 1;
    expect(aiRelieveNow(l, t, oc.id)).toBe(true);
  });
});
