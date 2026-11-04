import { describe, expect, it } from 'vitest';
import { createLeague, SAVE_VERSION } from './generate';
import { deliverMail, mailSubject } from './inbox';
import { migrateLeague } from './migrate';
import { WINDOW } from './meetings/commitments';
import { moraleAdvance, moraleContext, moraleFactors, moraleTarget, YEAR } from './morale';
import { activeRoster } from './roster';
import { nameCaptains } from './personality';
import { playWeek } from './league';
import { defenseCallAt } from './playActors';
import type { InboxMessage } from './types';

describe('save v65 and v66', () => {
  it('a v64 save loads at 65 with its inbox as it was', () => {
    const l = createLeague({ seed: 'v65' });
    deliverMail(l);
    const before = JSON.parse(JSON.stringify(l.inbox));
    l.version = 64;
    const up = migrateLeague(l)!;
    expect(SAVE_VERSION).toBe(86);
    expect(up.version).toBe(SAVE_VERSION);
    expect(up.inbox).toEqual(before);
  });
});

describe('save v67', () => {
  it('starts every rostered player at his target with no jolts, and no one else', () => {
    const l = createLeague({ seed: 'v67' });
    for (const p of Object.values(l.players)) delete p.morale;
    delete l.moraleAt;
    l.version = 66;
    const up = migrateLeague(l)!;
    expect(up.version).toBe(SAVE_VERSION);
    const ctx = moraleContext(up);
    // Seeded before anyone has a mood: no voice pulls yet (L3).
    ctx.leans.clear();
    ctx.voices.clear();
    for (const p of Object.values(up.players)) {
      if (p.teamId === null) {
        expect(p.morale).toBeUndefined();
        continue;
      }
      expect(p.morale!.jolts).toBeUndefined();
      expect(p.morale!.level).toBeCloseTo(moraleTarget(moraleFactors(up, p, ctx)));
    }
    expect(Object.values(up.players).some((p) => p.morale!.level !== 0)).toBe(true);
  });
});

describe('save v67 mid-season', () => {
  it('invents no jolts from the year already played', () => {
    const l = createLeague({ seed: 'v67-mid' });
    l.phase = 'preseason';
    nameCaptains(l);
    l.phase = 'regular';
    for (let i = 0; i < 4; i++) playWeek(l);
    for (const p of Object.values(l.players)) delete p.morale;
    delete l.moraleAt;
    l.version = 66;
    const up = migrateLeague(l)!;
    // The next step with nothing new: a captaincy named in camp, a benching or a friend cut before the save was
    // upgraded is history, not news.
    moraleAdvance(up, up.moraleAt! + 1);
    const jolted = Object.values(up.players).filter((p) => p.morale?.jolts?.length);
    expect(jolted).toEqual([]);
  }, 60_000);
});

describe('save v68', () => {
  it('loads a v67 save with nothing added', () => {
    const l = createLeague({ seed: 'v68' });
    const before = JSON.stringify(Object.values(l.players).map((p) => p.morale ?? null));
    l.version = 67;
    const up = migrateLeague(l)!;
    expect(up.version).toBe(SAVE_VERSION);
    expect(JSON.stringify(Object.values(up.players).map((p) => p.morale ?? null))).toBe(before);
  });
});

describe('save v69', () => {
  it('loads a v68 save with every open year as it was, and no tilt added', () => {
    const l = createLeague({ seed: 'v69' });
    const p = Object.values(l.players).find((x) => x.teamId !== null)!;
    p.dev = { season: l.season, games: 10, rate: 1, potential: p.potential, done: 0.6, applied: [1] };
    const before = JSON.stringify(Object.values(l.players).map((x) => x.dev ?? null));
    l.version = 68;
    const up = migrateLeague(l)!;
    expect(up.version).toBe(SAVE_VERSION);
    expect(JSON.stringify(Object.values(up.players).map((x) => x.dev ?? null))).toBe(before);
  });
});

describe('save v69: a broken promise that was never his club’s', () => {
  it("drops the hit a free agent carried in from his old club's promise, and keeps one his own club broke", () => {
    const l = createLeague({ seed: 'v69-broken' });
    const [walked, kept] = Object.values(l.players).filter((p) => p.teamId === l.userTeamId);
    const at = l.moraleAt!;
    walked.morale = {
      level: 0,
      jolts: [
        { kind: 'broken', size: -4, at },
        { kind: 'paid', size: 3, at: at + 1 },
      ],
      talk: { club: l.userTeamId },
    };
    kept.morale = { level: 0, jolts: [{ kind: 'broken', size: -4, at }], talk: { club: l.userTeamId, broken: 1 } };
    l.version = 68;
    const up = migrateLeague(l)!;
    expect(up.players[walked.id].morale!.jolts!.map((j) => j.kind)).toEqual(['paid']);
    expect(up.players[kept.id].morale!.jolts!.map((j) => j.kind)).toEqual(['broken']);
  });
});

describe('the new letters read back', () => {
  const m = (id: string): InboxMessage => ({
    id,
    season: 2028,
    phase: 'regular',
    week: 3,
    from: 'x',
    category: 'staff',
    subject: '',
    body: '',
    read: true,
    actions: [],
  });
  it('reads each new id to its kind, and old ids as before', () => {
    expect(mailSubject(m('locker:2028:camp'))).toEqual({ kind: 'lockerReport', season: 2028, checkin: 'camp' });
    expect(mailSubject(m('waivers:2028:regular:3'))).toEqual({ kind: 'waivers', season: 2028, week: 3 });
    expect(mailSubject(m('staffNotes:2028:4'))).toEqual({ kind: 'staffNotes', season: 2028, week: 4 });
    expect(mailSubject(m('positions:2028:regular:1'))).toEqual({ kind: 'positionMoves', season: 2028 });
    expect(mailSubject(m('feud:2028:1:2'))?.kind).toBe('locker');
  });
});

describe('save v71', () => {
  it('loads a v70 save; its games have no field record and keep their plays', () => {
    const l = createLeague({ seed: 'v71' });
    playWeek(l);
    for (const g of l.games) {
      if (!g.result) continue;
      delete g.result.field;
      for (const e of g.result.plays ?? []) delete e.who;
    }
    const plays = l.games.find((g) => g.result?.plays?.length)!.result!.plays!.length;
    l.version = 70;
    const up = migrateLeague(l)!;
    expect(up.version).toBe(SAVE_VERSION);
    const game = up.games.find((g) => g.result?.plays?.length)!;
    expect(game.result!.field).toBeUndefined();
    expect(game.result!.plays!.length).toBe(plays);
  });
});

describe('save v72', () => {
  it('loads a v71 save: its flagged plays keep the walk-off without the play as it ran', () => {
    const l = createLeague({ seed: 'v72' });
    playWeek(l);
    let flagged = 0;
    for (const g of l.games)
      for (const e of g.result?.plays ?? [])
        if (e.ran) {
          flagged++;
          delete e.ran;
        }
    expect(flagged).toBeGreaterThan(0);
    l.version = 71;
    const up = migrateLeague(l)!;
    expect(up.version).toBe(SAVE_VERSION);
    expect(up.games.some((g) => g.result?.plays?.some((e) => e.kind === 'penalty' && !e.ran))).toBe(true);
  });
});

describe('save v73', () => {
  it("loads a v72 save: its kept games have no defensive calls, and every snap reads as the defense's base call", () => {
    const l = createLeague({ seed: 'v73' });
    playWeek(l);
    const kept = l.games.filter((g) => g.result?.field);
    expect(kept.some((g) => g.result!.field!.calls)).toBe(true);
    for (const g of kept) delete g.result!.field!.calls;
    l.version = 72;
    const up = migrateLeague(l)!;
    expect(up.version).toBe(SAVE_VERSION);
    const game = up.games.find((g) => g.result?.field)!;
    expect(game.result!.plays!.every((_, i) => defenseCallAt(game.result!.field!, i) === 'base')).toBe(true);
  });
});

describe('save v74', () => {
  it("loads a v73 save: no gear chosen yet, and this season's captains get this season as their first", () => {
    const l = createLeague({ seed: 'v74' });
    const team = l.teams[0];
    const [offense, defense, specialTeams] = Object.values(l.players)
      .filter((p) => p.teamId === team.id)
      .slice(0, 3);
    team.captains = { season: l.season, offense: offense.id, defense: defense.id, specialTeams: specialTeams.id };
    for (const p of Object.values(l.players)) {
      delete p.captainSeasons;
      delete p.gear;
    }
    l.version = 73;
    const up = migrateLeague(l)!;
    expect(up.version).toBe(SAVE_VERSION);
    expect(up.players[offense.id].captainSeasons).toEqual([l.season]);
    expect(up.players[specialTeams.id].captainSeasons).toEqual([l.season]);
    expect(Object.values(up.players).some((p) => p.gear)).toBe(false);
  });
});

describe('save v77', () => {
  it("a v76 save loads with every player's number as it was: numbers move only at the new league year", () => {
    const l = createLeague({ seed: 'v77' });
    l.version = 76;
    const before = Object.fromEntries(Object.values(l.players).map((p) => [p.id, p.jersey]));
    const up = migrateLeague(l)!;
    expect(up.version).toBe(SAVE_VERSION);
    for (const p of Object.values(up.players)) expect(p.jersey).toBe(before[p.id]);
  });
});

describe('save v78', () => {
  it("a v77 save loads at 78 with its games as they were (a fumble's spot is new and optional)", () => {
    const l = createLeague({ seed: 'v78' });
    l.version = 77;
    const before = JSON.stringify(l.games);
    const up = migrateLeague(l)!;
    expect(up.version).toBe(SAVE_VERSION);
    expect(JSON.stringify(up.games)).toBe(before);
  });
});

describe('save v82: meetings', () => {
  it('loads a v81 save with empty meeting logs and every head coach at credibility 0', () => {
    const l = createLeague({ seed: 'v82' });
    for (const t of l.teams) delete t.meetings;
    for (const c of Object.values(l.coaches)) delete c.credibility;
    l.version = 81;
    const up = migrateLeague(l)!;
    expect(up.version).toBe(SAVE_VERSION);
    for (const t of up.teams) expect(t.meetings).toEqual({ log: [], open: [] });
    const heads = Object.values(up.coaches).filter((c) => c.role === 'headCoach');
    expect(heads.length).toBeGreaterThan(0);
    for (const c of heads) expect(c.credibility).toBe(0);
  });
  it('a new league starts the same, and stays plain JSON', () => {
    const l = createLeague({ seed: 'v82-new' });
    for (const t of l.teams) expect(t.meetings).toEqual({ log: [], open: [] });
    for (const c of Object.values(l.coaches).filter((c) => c.role === 'headCoach')) {
      expect(c.credibility).toBe(0);
      expect(c.newVoice).toBeUndefined();
    }
    expect(JSON.parse(JSON.stringify(l))).toEqual(l);
  });
});

describe('save v84: talks kept by a signing', () => {
  /** Week 2's receivers meeting promised talks with one man's agent; the window closed on it as broken. */
  function brokenTalks(signedWeek: number) {
    const l = createLeague({ seed: 'v84' });
    l.phase = 'regular';
    l.week = 9;
    const opened = l.season * YEAR + 8 + 1;
    const closes = opened + WINDOW.talks;
    l.moraleAt = closes + 3;
    const team = l.teams[l.userTeamId];
    const [wr, other] = activeRoster(l, team.id).filter((p) => p.position === 'WR');
    wr.contract!.signedSeason = l.season;
    wr.contract!.signedWeek = signedWeek;
    wr.morale = { level: -1, jolts: [{ kind: 'broken', size: -1.5, at: closes }], talk: { club: team.id, broken: 1 } };
    other.morale = { level: 0, jolts: [{ kind: 'broken', size: -1.5, at: closes }] };
    team.meetings = {
      log: [
        {
          clock: opened,
          scope: 'WR',
          kind: 'trouble',
          approach: 'standard',
          backing: 'talks',
          timing: 'monday',
          outcomes: { lands: [wr.id, other.id], bristles: [] },
        },
      ],
      open: [],
      settled: [{ clock: opened, scope: 'WR', backing: 'talks', kept: false, named: [wr.id] }],
    };
    l.version = 83;
    const up = migrateLeague(l)!;
    return { up, wr: up.players[wr.id], other: up.players[other.id], team: up.teams[team.id] };
  }

  it('re-signed inside the window: kept, his record says so, and the room loses the dip', () => {
    const { up, wr, other, team } = brokenTalks(2);
    expect(up.version).toBe(SAVE_VERSION);
    expect(team.meetings!.settled![0].kept).toBe(true);
    expect(wr.morale!.talk!.broken).toBeUndefined();
    expect(wr.morale!.talk!.kept).toBe(1);
    expect(wr.morale!.jolts).toBeUndefined();
    expect(other.morale!.jolts).toBeUndefined();
  });

  it('signed only after the window closed: it stays broken', () => {
    const { wr, team } = brokenTalks(8);
    expect(team.meetings!.settled![0].kept).toBe(false);
    expect(wr.morale!.talk!.broken).toBe(1);
    expect(wr.morale!.jolts?.[0].kind).toBe('broken');
  });
});

describe('save v85', () => {
  it('upgrades v84: your games on the field, games kept', () => {
    const l = createLeague({ seed: 'v85' });
    delete l.settings;
    l.version = 84;
    const before = JSON.stringify(l.games);
    const up = migrateLeague(l)!;
    expect(up.version).toBe(85);
    expect(up.settings).toEqual({ spatialField: true });
    expect(JSON.stringify(up.games)).toBe(before);
  });
});
