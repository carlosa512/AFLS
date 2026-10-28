import { describe, expect, it } from 'vitest';
import { createLeague } from './generate';
import {
  disciplesOf,
  hasTree,
  linksOf,
  liveTrees,
  mainMentor,
  keepBonus,
  seedFoundingTrees,
  treeLean,
  standingOf,
  treeFor,
  treeOf,
} from './trees';
import { migrateLeague } from './migrate';
import { asPromoted, headCoachVision } from './coaching';
import type { Coach, CoachRole, League } from './types';

/** A league whose coaches' careers are cleared, so each test writes exactly the history it means. */
function blank(): { l: League; c: Coach[] } {
  const l = createLeague({ seed: 'trees' });
  const c = Object.values(l.coaches);
  for (const x of c) {
    x.career = [];
    delete x.pastUnder;
    // Nobody holds a chair until a test says so.
    x.role = 'positionCoach';
    x.room = 'QB';
    x.teamId = null;
  }
  return { l, c };
}
const row = (
  season: number,
  teamId: number,
  role: CoachRole,
  extra: Partial<Coach['career'] extends (infer R)[] | undefined ? R : never> = {},
) => ({
  season,
  teamId,
  role,
  ...extra,
});

/** A winning season's record (10-7): a tree grows only from a .500 head coach. */
const won = {
  record: { fromWeek: 1, throughWeek: 18, regular: { w: 10, l: 7, t: 0 }, playoffs: null, champion: false },
};

describe('coaching tree links', () => {
  it('needs three seasons together on a head coach’s staff', () => {
    const { l, c } = blank();
    const [hc, oc, dc] = c;
    hc.career = [2020, 2021, 2022].map((s) => row(s, 4, 'headCoach'));
    oc.career = [2020, 2021, 2022].map((s) => row(s, 4, 'offCoord'));
    dc.career = [2021, 2022].map((s) => row(s, 4, 'defCoord'));
    expect(linksOf(l, oc.id)).toEqual([expect.objectContaining({ mentorId: hc.id, seasons: 3, as: 'headCoach' })]);
    expect(linksOf(l, dc.id)).toEqual([]);
    expect(mainMentor(l, oc.id)?.id).toBe(hc.id);
    expect(disciplesOf(l, hc.id).map((x) => x.id)).toEqual([oc.id]);
  });

  it('adds up seasons under the same man at two clubs', () => {
    const { l, c } = blank();
    const [hc, oc] = c;
    hc.career = [row(2020, 4, 'headCoach'), row(2021, 4, 'headCoach'), row(2022, 9, 'headCoach')];
    oc.career = [row(2020, 4, 'offCoord'), row(2021, 4, 'offCoord'), row(2022, 9, 'offCoord')];
    expect(linksOf(l, oc.id)[0]).toMatchObject({ mentorId: hc.id, seasons: 3 });
  });

  it('credits an interim season to the head coach who had the most weeks', () => {
    const { l, c } = blank();
    const [hc, interim, oc] = c;
    const rec = (fromWeek: number, throughWeek: number) => ({
      record: { fromWeek, throughWeek, regular: { w: 0, l: 0, t: 0 }, playoffs: null, champion: false },
    });
    hc.career = [row(2020, 4, 'headCoach'), row(2021, 4, 'headCoach'), row(2022, 4, 'headCoach', rec(1, 6))];
    interim.career = [row(2022, 4, 'headCoach', rec(7, 18))];
    oc.career = [2020, 2021, 2022].map((s) => row(s, 4, 'offCoord'));
    expect(linksOf(l, oc.id).find((k) => k.mentorId === hc.id)).toBeUndefined();
  });

  it('links a position coach to his side’s coordinator', () => {
    const { l, c } = blank();
    const [oc, qbCoach] = c;
    oc.career = [2020, 2021, 2022].map((s) => row(s, 4, 'offCoord'));
    qbCoach.career = [2020, 2021, 2022].map((s) => row(s, 4, 'positionCoach', { room: 'QB' }));
    expect(linksOf(l, qbCoach.id)).toEqual([
      expect.objectContaining({ mentorId: oc.id, seasons: 3, as: 'coordinator' }),
    ]);
  });

  it('counts founding history kept in pastUnder', () => {
    const { l, c } = blank();
    const [hc, oc] = c;
    oc.pastUnder = [{ coachId: hc.id, role: 'offCoord', seasons: 4 }];
    expect(linksOf(l, oc.id)).toEqual([expect.objectContaining({ mentorId: hc.id, seasons: 4, as: 'headCoach' })]);
    expect(mainMentor(l, oc.id)?.id).toBe(hc.id);
  });
});

describe('trees, branches and standing', () => {
  const rec = (w: number, l: number) => ({
    record: { fromWeek: 1, throughWeek: 18, regular: { w, l, t: 0 }, playoffs: null, champion: false },
  });
  /** `d` spent three seasons as `m`'s offensive coordinator at `team`, ending the season before `from`; `m` won. */
  const served = (m: Coach, d: Coach, team: number, from: number, w = 10, lost = 7) => {
    for (const s of [from - 3, from - 2, from - 1]) {
      (m.career ??= []).push(row(s, team, 'headCoach', rec(w, lost)));
      (d.career ??= []).push(row(s, team, 'offCoord'));
    }
  };
  /** `c` was head coach at `team` for these seasons with this record each year. */
  const headed = (c: Coach, team: number, seasons: number[], w: number, l: number) => {
    for (const s of seasons) (c.career ??= []).push(row(s, team, 'headCoach', rec(w, l)));
  };
  const active = (c: Coach, team: number) => {
    c.role = 'headCoach';
    c.teamId = team;
  };
  const off = (c: Coach) => {
    c.role = 'offCoord';
    c.teamId = null;
  };

  it('is a tree only once two of his men have become head coaches', () => {
    const { l, c } = blank();
    const [r, a, b] = c;
    const now = l.season;
    served(r, a, 1, now - 6);
    served(r, b, 1, now - 4);
    headed(a, 2, [now - 4, now - 3, now - 2, now - 1], 9, 8);
    expect(hasTree(l, r.id)).toBe(false);
    headed(b, 3, [now - 4, now - 3, now - 2, now - 1], 9, 8);
    expect(hasTree(l, r.id)).toBe(true);
    expect(treeOf(l, r.id)!.disciples.sort()).toEqual([a.id, b.id].sort());
  });

  it('grows only from a winner: .500 or better over three seasons in charge', () => {
    const { l, c } = blank();
    const [r, a, b] = c;
    const now = l.season;
    served(r, a, 1, now - 8, 6, 11);
    served(r, b, 1, now - 5, 6, 11);
    headed(a, 2, [now - 4, now - 3, now - 2, now - 1], 9, 8);
    headed(b, 3, [now - 4, now - 3, now - 2, now - 1], 9, 8);
    expect(hasTree(l, r.id)).toBe(false); // 6-11 six years running: good teachers, no tree
    // Three big seasons before those and he's a .500 coach: now his men make a tree.
    headed(r, 1, [now - 14, now - 13, now - 12], 15, 2);
    expect(hasTree(l, r.id)).toBe(true);
  });

  it('nests a disciple’s own tree as a branch, without looping on odd data', () => {
    const { l, c } = blank();
    const [r, a, b, x, y] = c;
    const now = l.season;
    served(r, a, 1, now - 9);
    served(r, b, 1, now - 6);
    headed(a, 2, [now - 6, now - 5, now - 4, now - 3, now - 2, now - 1], 9, 8);
    headed(b, 3, [now - 5, now - 4, now - 3, now - 2], 9, 8);
    served(a, x, 2, now - 4);
    served(a, y, 2, now - 4);
    headed(x, 4, [now - 4, now - 3, now - 2, now - 1], 9, 8);
    headed(y, 5, [now - 4, now - 3, now - 2, now - 1], 9, 8);
    expect(treeOf(l, r.id)!.branches).toEqual([a.id]);
    // A loop in hand-made history: each counts the other as a mentor.
    (r.pastUnder ??= []).push({ coachId: a.id, role: 'offCoord', seasons: 4 });
    expect(treeOf(l, r.id)).not.toBeNull();
    expect(treeFor(l, x.id)?.rootId).toBe(a.id);
  });

  it('runs hot, steady, withering or faded on its head coaches’ results', () => {
    const { l, c } = blank();
    const [r, a, b] = c;
    const now = l.season;
    served(r, a, 1, now - 10);
    served(r, b, 1, now - 10);
    headed(r, 1, [now - 14], 10, 7); // a fourth winning season: a tree grows from a proven winner
    const years = [now - 9, now - 8, now - 7, now - 6, now - 5, now - 4, now - 3, now - 2, now - 1];
    headed(a, 2, years, 11, 6);
    headed(b, 3, years, 10, 7);
    active(a, 2);
    active(b, 3);
    expect(standingOf(l, treeOf(l, r.id)!)).toBe('hot');
    a.career = a.career!.filter((x) => x.role !== 'headCoach');
    b.career = b.career!.filter((x) => x.role !== 'headCoach');
    headed(a, 2, years, 7, 10);
    headed(b, 3, years, 7, 10);
    expect(standingOf(l, treeOf(l, r.id)!)).toBe('steady'); // losing, but nobody fired
    // Both fired after their last losing season: gone from the chair.
    a.career = a.career!.filter((x) => x.season !== now - 1);
    b.career = b.career!.filter((x) => x.season !== now - 1);
    off(a);
    off(b);
    expect(standingOf(l, treeOf(l, r.id)!)).toBe('withering');
    for (const x of [a, b]) x.career = x.career!.filter((k) => k.role !== 'headCoach' || k.season <= now - 5);
    expect(standingOf(l, treeOf(l, r.id)!)).toBe('faded');
  });

  it('keeps a retired legend’s tree alive through his disciples’ disciples', () => {
    const { l, c } = blank();
    const [r, a, b, x, y] = c;
    const now = l.season;
    served(r, a, 1, now - 12);
    served(r, b, 1, now - 12);
    headed(r, 1, [now - 16], 10, 7); // a fourth winning season
    headed(a, 2, [now - 12, now - 11, now - 10, now - 9], 8, 9);
    headed(b, 3, [now - 12, now - 11, now - 10, now - 9], 8, 9);
    served(a, x, 2, now - 6);
    served(a, y, 2, now - 6);
    headed(x, 4, [now - 3, now - 2, now - 1], 9, 8);
    headed(y, 5, [now - 3, now - 2, now - 1], 9, 8);
    active(x, 4);
    active(y, 5);
    off(a);
    off(b);
    delete l.coaches[r.id];
    l.retiredCoaches[r.id] = r;
    const live = liveTrees(l);
    expect(live.map((t) => t.rootId)).toContain(r.id);
    expect(live.find((t) => t.rootId === r.id)!.activeHeadCoaches.sort()).toEqual([x.id, y.id].sort());
  });
});

describe('founding trees', () => {
  const shape = (l: League) =>
    liveTrees(l)
      .map((t) => ({ disciples: [...t.disciples].sort(), heads: [...t.activeHeadCoaches].sort() }))
      .sort((a, b) => a.heads[0] - b.heads[0]);

  it('starts a new league with three or four live trees, six to eight head coaches in them', () => {
    const l = createLeague({ seed: 'founding' });
    const live = liveTrees(l);
    expect(live.length).toBeGreaterThanOrEqual(3);
    expect(live.length).toBeLessThanOrEqual(4);
    const heads = new Set(live.flatMap((t) => t.activeHeadCoaches));
    expect(heads.size).toBeGreaterThanOrEqual(6);
    expect(heads.size).toBeLessThanOrEqual(8);
    // At least one is a retired legend's.
    expect(live.some((t) => l.retiredCoaches[t.rootId])).toBe(true);
    // Founding history lives in pastUnder only: no career row before the league began.
    for (const c of [...Object.values(l.coaches), ...Object.values(l.retiredCoaches)])
      for (const r of c.career ?? []) expect(r.season).toBeGreaterThanOrEqual(l.season);
  });

  it('is the same for the same seed, and an upgraded save gets the trees a new league would', () => {
    const a = createLeague({ seed: 'founding-2' });
    const b = createLeague({ seed: 'founding-2' });
    expect(shape(a)).toEqual(shape(b));
    const legends = Object.values(b.retiredCoaches).filter((c) => !c.career?.length);
    for (const c of legends) delete b.retiredCoaches[c.id];
    for (const c of Object.values(b.coaches)) delete c.pastUnder;
    b.nextCoachId = Math.min(...legends.map((c) => c.id));
    b.version = 63;
    const up = migrateLeague(b)!;
    expect(shape(up)).toEqual(shape(a));
  });

  it('seeds nothing twice', () => {
    const l = createLeague({ seed: 'founding-3' });
    const before = shape(l);
    seedFoundingTrees(l);
    expect(shape(l)).toEqual(before);
  });
});

describe('the carousel', () => {
  it('keeps a new head coach’s own man more often, and ranks him first in a search', () => {
    const { l, c } = blank();
    const [hc, mine, stranger] = c;
    mine.pastUnder = [{ coachId: hc.id, role: 'offCoord', seasons: 4 }];
    expect(keepBonus(l, hc, mine)).toBeGreaterThan(0);
    expect(keepBonus(l, hc, stranger)).toBe(0);
    expect(treeLean(l, hc, mine, 'offCoord')).toBeLessThan(treeLean(l, hc, stranger, 'offCoord'));
  });

  it('follows a tree’s standing in head-coach searches: hot ahead, withering behind', () => {
    const { l, c } = blank();
    const [r, a, b, cand] = c;
    const now = l.season;
    for (const d of [a, b, cand]) d.pastUnder = [{ coachId: r.id, role: 'offCoord', seasons: 4 }];
    const rec = (w: number, lo: number) => ({
      record: { fromWeek: 1, throughWeek: 18, regular: { w, l: lo, t: 0 }, playoffs: null, champion: false },
    });
    for (const d of [a, b]) {
      d.career = [now - 3, now - 2, now - 1].map((s) => row(s, d === a ? 2 : 3, 'headCoach', rec(12, 5)));
      d.role = 'headCoach';
      d.teamId = d === a ? 2 : 3;
    }
    const hot = treeLean(l, null, cand, 'headCoach');
    for (const d of [a, b]) {
      d.career = [now - 5, now - 4, now - 3, now - 2].map((s) => row(s, d === a ? 2 : 3, 'headCoach', rec(5, 12)));
      d.role = 'offCoord';
      d.teamId = null;
    }
    const withering = treeLean(l, null, cand, 'headCoach');
    expect(hot).toBeLessThan(0);
    expect(withering).toBeGreaterThan(0);
    expect(treeLean(l, null, cand, 'offCoord')).toBe(0); // only head-coach searches read standing
  });

  it('carries a mentor’s scheme on about half the time, the same answer every time', () => {
    const l = createLeague({ seed: 'tree-schemes' });
    const hcs = Object.values(l.coaches).filter((x) => x.role === 'headCoach');
    const mentor = Object.values(l.coaches).find((x) => x.role === 'offCoord' && x.scheme?.offense)!;
    mentor.role = 'headCoach';
    let same = 0;
    let n = 0;
    const pcs = Object.values(l.coaches).filter((x) => x.role === 'positionCoach' && x.room === 'QB');
    // History first: the tree index is kept for the calendar step, as it is in play.
    for (const pc of pcs) pc.pastUnder = [{ coachId: mentor.id, role: 'positionCoach', seasons: 4 }];
    for (const pc of pcs) {
      const up = asPromoted(l, pc, { role: 'offCoord' });
      expect(asPromoted(l, pc, { role: 'offCoord' }).scheme).toEqual(up.scheme);
      n++;
      if (up.scheme?.offense === mentor.scheme!.offense) same++;
    }
    expect(n).toBeGreaterThan(10);
    expect(same / n).toBeGreaterThan(0.35);
    expect(hcs.length).toBeGreaterThan(0);
    const hc = hcs[0];
    expect(headCoachVision(l, hc)).toEqual(headCoachVision(l, hc));
  });

  it('counts only head coaches’ men toward a tree, never a coordinator’s', () => {
    const { l, c } = blank();
    const [oc, a, b] = c;
    oc.role = 'offCoord';
    for (const d of [a, b]) {
      d.career = [2020, 2021, 2022].map((s) => row(s, 4, 'positionCoach', { room: 'QB' }));
      d.career.push(row(2023, d === a ? 5 : 6, 'headCoach'));
    }
    oc.career = [2020, 2021, 2022].map((s) => row(s, 4, 'offCoord'));
    expect(linksOf(l, a.id).some((k) => k.mentorId === oc.id)).toBe(true);
    expect(hasTree(l, oc.id)).toBe(false);
  });

  it('never counts a man who ran a club before he served under him', () => {
    const { l, c } = blank();
    const [hc, a, b] = c;
    hc.career = [2019, 2020, 2021, 2022].map((s) => row(s, 4, 'headCoach', won));
    // a was a head coach first, then three seasons on hc's staff; b went the other way.
    a.career = [row(2018, 7, 'headCoach'), ...[2020, 2021, 2022].map((s) => row(s, 4, 'offCoord'))];
    b.career = [
      ...[2020, 2021, 2022].map((s) => row(s, 4, 'defCoord')),
      row(2023, 8, 'headCoach'),
      row(2024, 8, 'headCoach'),
      row(2025, 8, 'headCoach'),
      row(2026, 8, 'headCoach'),
    ];
    const third = c[3];
    third.career = [
      ...[2020, 2021, 2022].map((s) => row(s, 4, 'positionCoach', { room: 'QB' })),
      row(2023, 9, 'headCoach'),
      row(2024, 9, 'headCoach'),
      row(2025, 9, 'headCoach'),
      row(2026, 9, 'headCoach'),
    ];
    expect(hasTree(l, hc.id)).toBe(true); // b and third
    third.career = third.career.filter((r) => r.role !== 'headCoach');
    expect(hasTree(l, hc.id)).toBe(false); // a doesn't count
  });

  it('is a tree only once two of his men have run clubs side by side, two seasons', () => {
    const { l, c } = blank();
    const [hc, a, b] = c;
    hc.career = [2009, 2010, 2011, 2012].map((s) => row(s, 4, 'headCoach', won));
    a.career = [
      ...[2010, 2011, 2012].map((s) => row(s, 4, 'offCoord')),
      ...[2014, 2015, 2016, 2017].map((s) => row(s, 7, 'headCoach')),
    ];
    b.career = [
      ...[2010, 2011, 2012].map((s) => row(s, 4, 'defCoord')),
      row(2018, 8, 'headCoach'),
      row(2019, 8, 'headCoach'),
    ];
    expect(hasTree(l, hc.id)).toBe(false); // never at the same time
    b.career.push(...[2014, 2015, 2016, 2017].map((s) => row(s, 8, 'headCoach')));
    expect(hasTree(l, hc.id)).toBe(true);
  });

  it('waits until both men are established: a second season in charge, at the same time', () => {
    const { l, c } = blank();
    const [hc, a, b] = c;
    hc.career = [2009, 2010, 2011, 2012].map((s) => row(s, 4, 'headCoach', won));
    a.career = [
      ...[2010, 2011, 2012].map((s) => row(s, 4, 'offCoord')),
      row(2014, 7, 'headCoach'),
      row(2015, 7, 'headCoach'),
    ];
    b.career = [...[2010, 2011, 2012].map((s) => row(s, 4, 'defCoord')), row(2015, 8, 'headCoach')];
    expect(hasTree(l, hc.id)).toBe(false); // b's first season: not yet
    b.career.push(...[2016, 2017, 2018].map((s) => row(s, 8, 'headCoach')));
    a.career.push(...[2016, 2017, 2018].map((s) => row(s, 7, 'headCoach')));
    expect(hasTree(l, hc.id)).toBe(true);
  });
});
