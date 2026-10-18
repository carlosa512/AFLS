import { describe, expect, it } from 'vitest';
import { createLeague, generatePlayer } from './generate';
import { migrateLeague } from './migrate';
import { activeQuirks, fillBag, formingQuirks, generateQuirks, isSpecial, QUIRK_IDS, QUIRKS, QUIRKS_FOR, quirkOffseason, quirkWeek } from './quirks';
import { Rng } from './rng';
import { knowledge, QUIRK_KNOWLEDGE, quirkNotes } from './scouting';
import type { Player } from './types';

const copy = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

function player(i: number, age = 27, experience = 5): Player {
  const p = generatePlayer(new Rng(`quirk-test:${i}`), { id: 2_000_000 + i, position: 'QB', quality: 10, age, teamId: null, jerseysUsed: new Set() });
  p.experience = experience;
  return p;
}

describe('quirks', () => {
  it('every quirk belongs to a position, and every position can draw some', () => {
    for (const id of QUIRK_IDS) expect(QUIRKS[id].positions.length).toBeGreaterThan(0);
    for (const ids of Object.values(QUIRKS_FOR)) expect(ids.length).toBeGreaterThanOrEqual(2);
  });

  it('are seeded by the player himself, so generating them never moves the league stream', () => {
    const a = player(1);
    const b = copy(a);
    generateQuirks(a);
    generateQuirks(b);
    expect(a.quirks).toEqual(b.quirks);
    expect(a.quirkBag).toEqual(fillBag(a));
  });

  it('applies three at most, and a fourth only for a special player whose fourth is ingrained', () => {
    const p = player(2, 30, 3);
    p.quirks = { muddyPockets: 3, staresDown: 3, gunslinger: 3 };
    expect(activeQuirks(p)).toHaveLength(3);
    // QB has three quirks so far: borrow a receiver's to test the cap.
    p.quirks = { ...p.quirks, yacSlasher: 3 };
    p.experience = 3;
    if (!isSpecial(p)) expect(activeQuirks(p)).toHaveLength(3);
    p.experience = 12;
    expect(activeQuirks(p)).toHaveLength(4);
    p.quirks.yacSlasher = 2;
    expect(activeQuirks(p)).toHaveLength(3);
    expect(formingQuirks(p)).toEqual(['yacSlasher']);
  });

  it('change through the season and the offseason, and log what was gained and lost', () => {
    const league = createLeague({ seed: 'quirk-churn' });
    const before = JSON.stringify(Object.values(league.players).map((p) => p.quirks ?? null));
    for (let y = 0; y < 3; y++) {
      for (let w = 1; w <= 18; w++) {
        league.week = w;
        quirkWeek(league);
      }
      league.season++;
      for (const p of Object.values(league.players)) if (!p.retired && p.teamId !== null) quirkOffseason(league, p);
    }
    expect(JSON.stringify(Object.values(league.players).map((p) => p.quirks ?? null))).not.toEqual(before);
    const logs = Object.values(league.players).flatMap((p) => p.quirkLog ?? []);
    expect(logs.some((e) => e.change === 'gained')).toBe(true);
    expect(logs.some((e) => e.change === 'lost')).toBe(true);
    for (const p of Object.values(league.players)) for (const g of Object.values(p.quirks ?? {})) expect(g).toBeGreaterThanOrEqual(1);
  });

  it('show on film: nothing below the threshold, everything for your own players, words only', () => {
    const league = createLeague({ seed: 'quirk-fog' });
    const me = league.userTeamId;
    const mine = Object.values(league.players).filter((p) => p.teamId === me);
    for (const p of mine) expect(quirkNotes(league, me, p).notes.map((n) => n.id).sort()).toEqual(Object.keys(p.quirks ?? {}).sort());
    // A late-round prospect nobody has scouted: a name on a list.
    const unseen = { ...player(3, 21, 0), scouting: { grade: 6, ceiling: 8 } };
    league.players[unseen.id] = unseen;
    expect(knowledge(league, me, unseen)).toBeLessThan(QUIRK_KNOWLEDGE);
    expect(quirkNotes(league, me, unseen)).toEqual({ known: false, notes: [] });
    for (const p of Object.values(league.players).slice(0, 400)) for (const n of quirkNotes(league, me, p).notes) expect(n.label).not.toMatch(/\d/);
  });

  it('upgrade a v10 save with the same quirks a new league would roll', () => {
    const league = createLeague({ seed: 'quirk-migrate' });
    const fresh = copy(league);
    const old = copy(league);
    old.version = 10;
    for (const p of Object.values(old.players)) {
      delete p.quirks;
      delete p.quirkBag;
    }
    const up = migrateLeague(old)!;
    expect(up.version).toBe(11);
    for (const p of Object.values(up.players)) if (!p.retired) expect(p.quirks).toEqual(fresh.players[p.id].quirks);
  });
});
