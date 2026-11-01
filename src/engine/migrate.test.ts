import { describe, expect, it } from 'vitest';
import { createLeague, SAVE_VERSION } from './generate';
import { deliverMail, mailSubject } from './inbox';
import { migrateLeague } from './migrate';
import { moraleAdvance, moraleContext, moraleFactors, moraleTarget } from './morale';
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
    expect(SAVE_VERSION).toBe(73);
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
