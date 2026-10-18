import { describe, expect, it } from 'vitest';
import { createLeague, generatePlayer, SAVE_VERSION } from './generate';
import { migrateLeague } from './migrate';
import { activeQuirks, eventQuirks, fillBag, formFor, formingQuirks, generateQuirks, isSpecial, QUIRK_IDS, QUIRKS, QUIRKS_FOR, quirkOffseason, quirkWeek, recordForm, schemeQuirks, SLUMP_WEEKS } from './quirks';
import { simulateGame } from './match/gameSim';
import { teamScheme } from './coaching';
import { Rng } from './rng';
import { fixedHabits, habitChangeText, habitTimeline, knowledge, QUIRK_KNOWLEDGE, quirkNotes, quirkWorth, scoutReport, trueQuirkWorth } from './scouting';
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

  it('applies three at most, and a fourth established one for a special player', () => {
    const p = player(2, 30, 3);
    p.potential = 12;
    p.quirks = { muddyPockets: 3, staresDown: 3, gunslinger: 3, safetyEyes: 2 };
    if (!isSpecial(p)) {
      expect(activeQuirks(p)).toHaveLength(3);
      expect(formingQuirks(p)).toEqual(['safetyEyes']);
    }
    // A rare ceiling or a long career makes room for the fourth.
    p.potential = 18;
    expect(activeQuirks(p)).toHaveLength(4);
    p.potential = 12;
    p.experience = 12;
    expect(activeQuirks(p)).toHaveLength(4);
    // Never a fifth, and a habit only starting to show doesn't count.
    p.quirks = { ...p.quirks, noHuddle: 2, bailsEarly: 1 };
    expect(activeQuirks(p)).toHaveLength(4);
    expect(formingQuirks(p).sort()).toEqual(['bailsEarly', 'noHuddle']);
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

  it('are worth a little to AI front offices, and only the habits their scouts have seen', () => {
    const league = createLeague({ seed: 'quirk-worth' });
    const me = league.userTeamId;
    const mine = Object.values(league.players).find((p) => p.teamId === me)!;
    mine.quirks = { muddyPockets: 2, safetyEyes: 2 };
    mine.position = 'QB';
    expect(quirkWorth(league, me, mine)).toBeCloseTo(0.6);
    mine.quirks = { staresDown: 3, gunslinger: 3, bailsEarly: 1 };
    // A minus, a style (worth nothing) and a minus starting to show at half.
    expect(quirkWorth(league, me, mine)).toBeCloseTo(-0.45);
    expect(trueQuirkWorth(mine)).toBeCloseTo(-0.45);
    // Never more than a fraction of a point either way.
    mine.quirks = { staresDown: 3, bailsEarly: 3, patsTheBall: 3, muddyPockets: 1, safetyEyes: 1 };
    expect(quirkWorth(league, me, mine)).toBeGreaterThanOrEqual(-0.9);
    // A prospect nobody has scouted: his habits count for nothing yet.
    const unseen = { ...player(4, 21, 0), scouting: { grade: 6, ceiling: 8 }, quirks: { staresDown: 3 } };
    league.players[unseen.id] = unseen;
    expect(quirkWorth(league, me, unseen)).toBe(0);
    expect(trueQuirkWorth(unseen)).toBeLessThan(0);
  });

  it('drop marbles for big games and big seasons, at his position only', () => {
    const qb = player(5);
    expect(eventQuirks(qb, { sacked: 5, passInt: 3 })).toEqual(['seesGhosts', 'staresDown']);
    expect(eventQuirks(qb, { sacked: 4 })).toEqual([]);
    expect(eventQuirks(qb, { sacked: 45 }, true)).toEqual(['seesGhosts']);
    // A sack-happy stat line on a quarterback earns nothing a pass rusher would.
    expect(eventQuirks(qb, { sacks: 3 })).toEqual([]);
  });

  it('carry form between games: shaken for one game, a slump for up to three weeks', () => {
    const league = createLeague({ seed: 'quirk-form' });
    const qb = Object.values(league.players).find((p) => p.position === 'QB' && p.teamId !== null)!;
    const k = Object.values(league.players).find((p) => p.position === 'K' && p.teamId !== null)!;
    recordForm(league, qb, 3, { sacked: 6 }, { shaken: true });
    expect(formFor(league, qb, 4).shaken).toBe(true);
    // The next game uses it up.
    recordForm(league, qb, 4, {}, undefined);
    expect(formFor(league, qb, 5).shaken).toBe(false);
    const yipsBefore = k.quirkBag?.yips ?? 0;
    recordForm(league, k, 5, {}, { slump: 'start' });
    expect(k.quirkBag!.yips).toBe(yipsBefore + 1);
    expect(formFor(league, k, 5 + SLUMP_WEEKS).slump).toBe(true);
    expect(formFor(league, k, 6 + SLUMP_WEEKS).slump).toBe(false);
    recordForm(league, k, 6, {}, { slump: 'end' });
    expect(formFor(league, k, 7).slump).toBe(false);
    expect(k.form).toBeUndefined();
  });

  it('rattle a quarterback who sees ghosts once he has been sacked twice', () => {
    const league = createLeague({ seed: 'quirk-ghosts' });
    for (const p of Object.values(league.players)) p.quirks = p.position === 'QB' ? { seesGhosts: 3 } : undefined;
    const games = league.games.filter((g) => g.week <= 4);
    const results = games.map((g) => simulateGame(league, g, { keepPlays: true }));
    const rattled = results.flatMap((r) => r.plays!.filter((p) => p.text.includes('looks rattled')));
    expect(rattled.length).toBeGreaterThan(0);
    // A beating (five sacks) leaves him shaken for next week.
    const beaten = results.filter((r) => Object.values(r.form ?? {}).some((f) => f.shaken));
    for (const r of beaten) for (const [id, f] of Object.entries(r.form!)) if (f.shaken) expect(r.playerStats[Number(id)].sacked).toBeGreaterThanOrEqual(5);
  });

  it('teach a scheme\'s habits in the offseason refill', () => {
    const league = createLeague({ seed: 'quirk-scheme' });
    const team = league.teams.find((t) => teamScheme(league, t.id).coverage?.man)!;
    const cb = Object.values(league.players).find((p) => p.teamId === team.id && p.position === 'CB')!;
    expect(schemeQuirks(league, cb)).toContain('physicalJammer');
    const zone = league.teams.find((t) => teamScheme(league, t.id).coverage && !teamScheme(league, t.id).coverage!.man)!;
    const lb = Object.values(league.players).find((p) => p.teamId === zone.id && p.position === 'LB')!;
    expect(schemeQuirks(league, lb)).toEqual(expect.arrayContaining(['zoneHawk', 'spotDrop']));
    // Every scheme marble is one his position can draw.
    for (const p of Object.values(league.players).slice(0, 500)) for (const q of schemeQuirks(league, p)) expect(QUIRKS_FOR[p.position]).toContain(q);
  });

  it('linger in other teams\' eyes after he shakes them, until their scouts notice', () => {
    const league = createLeague({ seed: 'quirk-linger' });
    const me = league.userTeamId;
    // A veteran on another team: well known from film, not an open book.
    const vet = Object.values(league.players).find(
      (p) => p.teamId !== null && p.teamId !== me && p.position === 'QB' && knowledge(league, me, p) < 0.9 && quirkNotes(league, me, { ...p, quirks: { staresDown: 2 } }).notes.some((n) => n.id === 'staresDown'),
    )!;
    vet.quirks = {};
    vet.quirkLog = [
      { id: 'staresDown', change: 'gained', season: league.season - 1, week: 4 },
      { id: 'staresDown', change: 'lost', season: league.season, week: league.week },
    ];
    {
      expect(quirkNotes(league, me, vet).notes.map((n) => n.id)).toContain('staresDown');
      expect(fixedHabits(league, me, vet)).toEqual([]);
      expect(habitTimeline(league, me, vet).map((e) => e.change)).toEqual(['gained']);
      // Most of a season later, they've noticed.
      league.week += 17;
      expect(quirkNotes(league, me, vet).notes.map((n) => n.id)).not.toContain('staresDown');
      expect(fixedHabits(league, me, vet).map((f) => f.id)).toEqual(['staresDown']);
      expect(habitTimeline(league, me, vet).map((e) => e.change)).toEqual(['lost', 'gained']);
      expect(scoutReport(league, me, vet).join(' ')).toMatch(/seems to have shaken Stares Down Hot Route/);
    }
    // His own team knows at once.
    const team = vet.teamId!;
    league.week -= 17;
    expect(quirkNotes(league, team, vet).notes).toEqual([]);
    expect(fixedHabits(league, team, vet).map((f) => f.id)).toEqual(['staresDown']);
  });

  it('describe a change in words that fit the habit', () => {
    expect(habitChangeText({ label: 'Patient Presser', tone: 'good', change: 'gained' })).toBe('Added Patient Presser to his game');
    expect(habitChangeText({ label: 'Short-Arm Catcher', tone: 'bad', change: 'gained' })).toBe('Picked up a bad habit: Short-Arm Catcher');
    expect(habitChangeText({ label: 'Gunslinger', tone: 'style', change: 'lost' })).toBe('Moved away from Gunslinger');
    expect(habitChangeText({ label: 'Loose Carriage', tone: 'bad', change: 'lost' }, false)).toBe('shaken Loose Carriage');
    expect(habitChangeText({ label: 'Zone Hawk', tone: 'good', change: 'lost' }, false)).toBe('stopped showing Zone Hawk');
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
    expect(up.version).toBe(SAVE_VERSION);
    for (const p of Object.values(up.players)) if (!p.retired) expect(p.quirks).toEqual(fresh.players[p.id].quirks);
  });
});
