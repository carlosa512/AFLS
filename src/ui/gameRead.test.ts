import { describe, expect, it } from 'vitest';
import { createLeague } from '../engine/generate';
import { playWeek } from '../engine/league';
import type { Game, League, PlayLogEntry, StatLine, TeamGameStats } from '../engine/types';
import {
  buildPlayNames,
  drivesOf,
  injuriesAt,
  linesAt,
  quartersAt,
  recordBefore,
  secondsOf,
  SHOWN_LINE,
  SHOWN_TEAM,
  teamStatsAt,
  timeoutsAt,
  type PlayNames,
} from './gameRead';

/**
 * A week of kept games in each of four worlds, every one with its full play log and box score. The last world plays
 * your games on the spatial field, as a real save does.
 */
const worlds: League[] = ['read-a', 'read-b', 'read-c', 'read-s'].map((seed) => {
  const league = createLeague({ seed, spatialField: seed === 'read-s' });
  playWeek(league);
  return league;
});
const kept = (league: League): Game[] => league.games.filter((g) => g.result?.plays?.some((p) => !p.scoring));

describe('the reader against the box score', () => {
  it('has a week of games to read in every world', () => {
    for (const league of worlds) expect(kept(league).length).toBe(16);
  });

  it('ends every game on the box score’s team numbers', () => {
    const wrong: string[] = [];
    for (const league of worlds)
      for (const g of kept(league)) {
        const plays = g.result!.plays!;
        const got = teamStatsAt(plays, plays.length - 1, g.homeId);
        for (const side of ['home', 'away'] as const)
          for (const key of SHOWN_TEAM) {
            const want = (g.result![side] as TeamGameStats)[key];
            if (got[side][key] !== want)
              wrong.push(`${league.seed} g${g.id} ${side} ${key}: ${got[side][key]}, not ${want}`);
          }
      }
    expect(wrong).toEqual([]);
  });

  it('ends every game on the box score’s player lines', () => {
    const wrong: string[] = [];
    for (const league of worlds)
      for (const g of kept(league)) {
        const plays = g.result!.plays!;
        const lines = linesAt(plays, plays.length - 1, g.homeId, buildPlayNames(league, g), g.result!.field);
        const ids = new Set([...Object.keys(g.result!.playerStats).map(Number), ...lines.keys()]);
        for (const id of ids) {
          const want: StatLine = g.result!.playerStats[id] ?? {};
          const got = lines.get(id) ?? {};
          for (const key of SHOWN_LINE)
            if ((got[key] ?? 0) !== (want[key] ?? 0))
              wrong.push(`${league.seed} g${g.id} p${id} ${key}: ${got[key] ?? 0}, not ${want[key] ?? 0}`);
        }
      }
    expect(wrong).toEqual([]);
  });

  it('ends every game on the box score’s quarters', () => {
    for (const league of worlds)
      for (const g of kept(league)) {
        const plays = g.result!.plays!;
        const q = quartersAt(plays, plays.length - 1);
        const want = g.result!.quarters;
        // The box score keeps no column for an overtime nobody scored in until it's played; neither does the reader.
        expect(q.home.slice(0, want.home.length)).toEqual(want.home);
        expect(q.away.slice(0, want.away.length)).toEqual(want.away);
        expect(q.home.slice(want.home.length).every((n) => n === 0)).toBe(true);
      }
  });
});

// ───────── hand-built logs ─────────

const HOME = 1;
const AWAY = 2;
const BUF = { abbrev: 'BUF' };
const NO = { abbrev: 'NO' };
const NO_NAMES: PlayNames = { re: null, ids: new Map() };

/** 1st & 10 at its own 25, Q1 15:00, 0–0, the home side running for 3. */
const entry = (e: Partial<PlayLogEntry> = {}): PlayLogEntry => ({
  quarter: 1,
  clock: 900,
  offense: HOME,
  down: 1,
  distance: 10,
  yardLine: 25,
  text: 'J.Back rush up the middle for 3 yards',
  homeScore: 0,
  awayScore: 0,
  kind: 'run',
  from: 25,
  to: 28,
  ...e,
});
/** A line in the log that is no play: a timeout, an injury, the two-minute warning. */
const note = (text: string, e: Partial<PlayLogEntry> = {}): PlayLogEntry =>
  entry({ kind: undefined, down: 0, distance: 0, from: undefined, to: undefined, text, ...e });
const kickoff = (e: Partial<PlayLogEntry> = {}) =>
  entry({ kind: 'kickoff', down: 0, distance: 0, text: 'K.Icker kicks off. Touchback.', from: 35, to: 75, ...e });

describe('timeouts', () => {
  const plays = [
    kickoff(),
    entry({ clock: 890 }),
    note('Timeout BUF (2 left).', { clock: 850 }),
    entry({ clock: 850, offense: AWAY }),
    note('Timeout NO (2 left).', { quarter: 2, clock: 40, offense: AWAY }),
    note('Timeout BUF (1 left).', { quarter: 2, clock: 30 }),
    kickoff({ quarter: 3 }),
    entry({ quarter: 4, clock: 5 }),
    kickoff({ quarter: 5, clock: 600 }),
  ];
  const at = (i: number) => timeoutsAt(plays, i, BUF, NO);

  it('starts each side on three, before anything is shown', () => {
    expect(at(-1)).toEqual({ home: 3, away: 3 });
    expect(at(1)).toEqual({ home: 3, away: 3 });
  });

  it('takes one off the side that called it, as the log says', () => {
    expect(at(2)).toEqual({ home: 2, away: 3 });
    expect(at(5)).toEqual({ home: 1, away: 2 });
  });

  it('gives three back at the half and two in overtime', () => {
    expect(at(6)).toEqual({ home: 3, away: 3 });
    expect(at(8)).toEqual({ home: 2, away: 2 });
  });
});

describe('the game clock', () => {
  it('counts seconds from the kickoff, a quarter 900 and overtime as long as its first clock', () => {
    const plays = [
      kickoff(),
      entry({ clock: 600 }),
      entry({ quarter: 2, clock: 900 }),
      entry({ quarter: 4, clock: 0 }),
      kickoff({ quarter: 5, clock: 600 }),
      entry({ quarter: 5, clock: 450 }),
    ];
    expect(secondsOf(plays)).toEqual([0, 300, 900, 3600, 3600, 3750]);
  });
});

describe('drives', () => {
  it('reads a touchdown drive: its snaps, its yards and who scored', () => {
    const plays = [
      kickoff(),
      entry({ clock: 890 }),
      entry({
        clock: 850,
        down: 2,
        distance: 7,
        yardLine: 28,
        from: 28,
        to: 60,
        kind: 'pass',
        text: 'Q.B pass for 32 yards',
      }),
      entry({ clock: 800, yardLine: 60, from: 60, to: 102, text: 'J.Back rush for 40 yards, TOUCHDOWN', homeScore: 6 }),
      entry({ clock: 795, kind: 'xp', down: 0, distance: 0, text: 'K.Icker extra point is GOOD.', homeScore: 7 }),
      kickoff({ clock: 795, homeScore: 7 }),
      entry({ clock: 790, offense: AWAY, from: 75, to: 72, homeScore: 7 }),
    ];
    const [d, next] = drivesOf(plays, HOME);
    expect(d).toMatchObject({ teamId: HOME, first: 1, last: 3, from: 25, snaps: 3, yards: 75, how: 'td' });
    expect(d.points).toEqual({ home: 7, away: 0 });
    expect(d.start).toBe(10);
    expect(next).toMatchObject({ teamId: AWAY, first: 6, how: 'end' });
  });

  it('tells a made kick from a missed one, and a punt', () => {
    const made = drivesOf(
      [entry(), entry({ kind: 'fg', down: 4, text: 'K.Icker 40-yard field goal is GOOD.', homeScore: 3 })],
      HOME,
    );
    expect(made[0].how).toBe('fg');
    const missed = drivesOf(
      [entry(), entry({ kind: 'fg', down: 4, text: 'K.Icker 58-yard field goal is NO GOOD.' })],
      HOME,
    );
    expect(missed[0].how).toBe('missed');
    const punt = drivesOf([entry(), entry({ kind: 'punt', down: 4, text: 'P.Unter punts 45 yards.' })], HOME);
    expect(punt[0].how).toBe('punt');
  });

  it('a kick a flag wiped out does not end the drive', () => {
    const plays = [
      entry(),
      entry({
        kind: 'punt',
        down: 4,
        text: 'P.Unter punts. PENALTY on NO (D.End): Roughing the kicker, 15 yards. No play.',
      }),
      entry({ yardLine: 43, from: 43, to: 46 }),
    ];
    expect(drivesOf(plays, HOME)).toHaveLength(1);
  });

  it('ends on a pick, a lost fumble, downs and a safety', () => {
    // A pick's logged end is where its return finished: no yards for the offense.
    const pick = drivesOf([entry({ kind: 'int', to: 60, text: 'Q.B pass INTERCEPTED by C.Orner' })], HOME);
    expect(pick[0].how).toBe('int');
    expect(pick[0].yards).toBe(0);
    const fumble = drivesOf(
      [entry({ text: 'J.Back rush for 3 yards. FUMBLE, recovered by S.Afety', loose: 28 })],
      HOME,
    );
    expect(fumble[0].how).toBe('fumble');
    const downs = drivesOf(
      [entry({ down: 4, distance: 5 }), note('Turnover on downs.'), entry({ offense: AWAY, from: 72, to: 70 })],
      HOME,
    );
    expect(downs.map((d) => d.how)).toEqual(['downs', 'end']);
    const safety = drivesOf(
      [
        entry({ kind: 'sack', yardLine: 2, from: 2, to: -2, text: 'Q.B SACKED' }),
        note('SAFETY! NO scores 2.', { awayScore: 2 }),
      ],
      HOME,
    );
    expect(safety[0].how).toBe('safety');
    expect(safety[0].points).toEqual({ home: 0, away: 2 });
  });

  it('a pick returned for a touchdown scores for the other side', () => {
    const plays = [
      entry({
        kind: 'int',
        text: 'Q.B pass INTERCEPTED by C.Orner. C.Orner returns it 40 yards for a TOUCHDOWN!',
        awayScore: 6,
      }),
      entry({ kind: 'xp', down: 0, offense: AWAY, text: 'K.Icker extra point is GOOD.', awayScore: 7 }),
    ];
    const [d] = drivesOf(plays, HOME);
    expect(d.how).toBe('int');
    expect(d.points).toEqual({ home: 0, away: 7 });
  });

  it('closes a drive the half ends, and keeps one drive across a quarter', () => {
    const plays = [
      entry({ quarter: 1, clock: 30 }),
      entry({ quarter: 2, clock: 880, down: 2 }),
      entry({ quarter: 2, clock: 5, down: 3 }),
      kickoff({ quarter: 3 }),
      entry({ quarter: 3, clock: 890, offense: AWAY, from: 75, to: 72 }),
    ];
    const drives = drivesOf(plays, HOME);
    expect(drives.map((d) => d.how)).toEqual(['half', 'end']);
    expect(drives[0]).toMatchObject({ first: 0, last: 2, start: 870 });
    expect(drives[0].end).toBeGreaterThan(900);
  });

  it('leaves the last drive of a live game open', () => {
    expect(drivesOf([entry()], HOME, true)[0].how).toBe('on');
    expect(drivesOf([entry()], HOME)[0].how).toBe('end');
  });

  it('never makes a drive of a two-point try or a kickoff', () => {
    const plays = [
      entry({ text: 'J.Back rush for 75 yards, TOUCHDOWN', to: 102, homeScore: 6 }),
      entry({
        text: 'Two-point try: J.Back rush, TOUCHDOWN — GOOD.',
        down: 1,
        yardLine: 98,
        from: 98,
        to: 102,
        homeScore: 8,
      }),
      kickoff({ homeScore: 8 }),
    ];
    const drives = drivesOf(plays, HOME);
    expect(drives).toHaveLength(1);
    expect(drives[0].points).toEqual({ home: 8, away: 0 });
  });

  it('reads every kept game without losing a point', () => {
    for (const league of worlds)
      for (const g of kept(league)) {
        const plays = g.result!.plays!;
        const drives = drivesOf(plays, g.homeId);
        const sum = (side: 'home' | 'away') => drives.reduce((n, d) => n + d.points[side], 0);
        // Kick-return touchdowns belong to no drive; everything else does.
        expect(sum('home')).toBeLessThanOrEqual(g.result!.homeScore);
        expect(sum('away')).toBeLessThanOrEqual(g.result!.awayScore);
        for (const d of drives) {
          expect(d.last).toBeGreaterThanOrEqual(d.first);
          expect(d.end).toBeGreaterThanOrEqual(d.start);
        }
        for (let i = 1; i < drives.length; i++) expect(drives[i].first).toBeGreaterThan(drives[i - 1].last);
      }
  });
});

describe('player lines without the facts', () => {
  it('gives nobody a line when a game kept no actors and no field record', () => {
    const plays = [entry(), entry({ kind: 'pass', text: 'Q.B pass to W.Out for 12 yards', to: 37 })];
    expect(linesAt(plays, 1, HOME, NO_NAMES).size).toBe(0);
  });

  it('credits a passer by name only when the name is one man’s', () => {
    const plays = [entry({ kind: 'pass', text: 'Q.B pass to W.Out for 12 yards', to: 37 })];
    const one: PlayNames = { re: /(Q\.B)/g, ids: new Map([['Q.B', 7]]) };
    expect(linesAt(plays, 0, HOME, one).get(7)).toMatchObject({ passAtt: 1, passCmp: 1, passYds: 12 });
    // Two men named Q.B: `buildPlayNames` leaves the name out, and nobody is credited.
    expect(linesAt(plays, 0, HOME, NO_NAMES).size).toBe(0);
  });

  it('counts nothing before the first play', () => {
    expect(linesAt([entry()], -1, HOME, NO_NAMES).size).toBe(0);
    expect(teamStatsAt([entry()], -1, HOME).home.totalYds).toBe(0);
    expect(quartersAt([entry()], -1)).toEqual({ home: [], away: [] });
  });
});

describe('injuries', () => {
  const plays = [
    entry(),
    note('Injury: BUF RB D.Grimes (back spasms) is out for the game.', { quarter: 4, clock: 548 }),
    entry({ quarter: 4, clock: 512 }),
  ];
  const names: PlayNames = { re: /(D\.Grimes)/g, ids: new Map([['D.Grimes', 5]]) };

  it('shows a man hurt only from the play it happened on', () => {
    expect(injuriesAt(plays, 0, names)).toEqual([]);
    expect(injuriesAt(plays, 2, names)).toEqual([
      { index: 1, playerId: 5, teamAbbrev: 'BUF', name: 'D.Grimes', what: 'back spasms', quarter: 4, clock: 548 },
    ]);
  });

  it('keeps the line when the name is not one man’s', () => {
    expect(injuriesAt(plays, 2, NO_NAMES)[0]).toMatchObject({ playerId: undefined, name: 'D.Grimes' });
  });
});

describe('records going into a game', () => {
  it('counts only the weeks before it', () => {
    const league = createLeague({ seed: 'read-rec' });
    playWeek(league);
    playWeek(league);
    const week2 = league.games.find((g) => g.week === 2 && g.result)!;
    const week1 = league.games.find((g) => g.week === 1 && (g.homeId === week2.homeId || g.awayId === week2.homeId))!;
    expect(recordBefore(league, week1.homeId, week1)).toEqual({ w: 0, l: 0, t: 0 });
    const r = recordBefore(league, week2.homeId, week2);
    expect(r.w + r.l + r.t).toBe(1);
    const wasHome = week1.homeId === week2.homeId;
    const us = wasHome ? week1.result!.homeScore : week1.result!.awayScore;
    const them = wasHome ? week1.result!.awayScore : week1.result!.homeScore;
    expect(r).toEqual({ w: us > them ? 1 : 0, l: us < them ? 1 : 0, t: us === them ? 1 : 0 });
  });
});
