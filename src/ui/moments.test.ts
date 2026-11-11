import { describe, expect, it } from 'vitest';
import { fumbleIn } from '../engine/field/fumble';
import { createLeague } from '../engine/generate';
import { playWeek } from '../engine/league';
import { packActors } from '../engine/playActors';
import type { League, PlayLogEntry, Team } from '../engine/types';
import { buildPlayNames, type PlayNames } from './gameRead';
import { BANNER_FLOOR, BIG_GAIN, LINE_BEAT, momentHold, momentsFor, type Moment } from './moments';
import { flagCall } from './stage/calls';

const BUF = { id: 1, abbrev: 'BUF', city: 'Buffalo', name: 'Blizzard', colors: ['#00338d', '#c60c30'] } as Team;
const NO = { id: 2, abbrev: 'NO', city: 'New Orleans', name: 'Krewe', colors: ['#101820', '#d3bc8d'] } as Team;
const NAMES: PlayNames = {
  re: /(J\.Back|W\.Out)/g,
  ids: new Map([
    ['J.Back', 30],
    ['W.Out', 19],
  ]),
};

/** 1st & 10 at its own 25, Q1 10:00, 0–0, the home side running for 3. */
const entry = (e: Partial<PlayLogEntry> = {}): PlayLogEntry => ({
  quarter: 1,
  clock: 600,
  offense: BUF.id,
  down: 1,
  distance: 10,
  yardLine: 25,
  text: 'J.Back rush up the middle for 3 yards (L.Backer)',
  homeScore: 0,
  awayScore: 0,
  kind: 'run',
  from: 25,
  to: 28,
  who: packActors({ ball: 30 }),
  ...e,
});
const note = (text: string, e: Partial<PlayLogEntry> = {}): PlayLogEntry =>
  entry({ kind: undefined, down: 0, distance: 0, from: undefined, to: undefined, who: undefined, text, ...e });
/** The moments of the last play of a log (one more play follows it, so it is not the game's last). */
const of = (plays: PlayLogEntry[], over = false): Moment[] =>
  momentsFor([...plays, ...(over ? [] : [entry({ clock: 1 })])], plays.length - 1, BUF, NO, NAMES, { over });
const banner = (plays: PlayLogEntry[]) =>
  of(plays).find((m) => m.kind === 'banner') as Extract<Moment, { kind: 'banner' }>;

describe('banners', () => {
  it('a touchdown: the scoring side, the play that scored it, and the drive', () => {
    const b = banner([
      entry({ clock: 600 }),
      entry({
        clock: 560,
        down: 2,
        distance: 7,
        yardLine: 28,
        from: 28,
        to: 102,
        text: 'J.Back rush left end for 72 yards, TOUCHDOWN',
        homeScore: 6,
      }),
    ]);
    expect(b).toEqual({
      kind: 'banner',
      tone: 'score',
      teamId: BUF.id,
      head: 'Touchdown',
      line: 'J.Back rush left end for 72 yards',
      side: '2 plays · 75 yds · 0:40',
    });
  });

  it('a kick run back for a touchdown: the side whose score went up', () => {
    const b = banner([
      entry({
        kind: 'kickoff',
        down: 0,
        offense: BUF.id,
        from: 35,
        to: -2,
        who: undefined,
        text: 'K.Icker kicks off. R.Eturn returns the kickoff 100 yards for a TOUCHDOWN!',
        awayScore: 6,
      }),
    ]);
    expect(b).toMatchObject({ tone: 'score', teamId: NO.id, head: 'Touchdown' });
  });

  it('a field goal made, and one missed', () => {
    const made = banner([
      entry(),
      entry({ kind: 'fg', down: 4, who: undefined, text: 'K.Icker 42-yard field goal is GOOD.', homeScore: 3 }),
    ]);
    expect(made).toMatchObject({ tone: 'score', teamId: BUF.id, head: 'Field goal', line: 'K.Icker, 42 yards' });
    const missed = banner([
      entry(),
      entry({ kind: 'fg', down: 4, who: undefined, text: 'K.Icker 58-yard field goal is NO GOOD.' }),
    ]);
    expect(missed).toMatchObject({ tone: 'turnover', teamId: NO.id, head: 'No good', line: 'K.Icker, 58 yards' });
  });

  it('a safety, for the side that scored it', () => {
    const b = banner([
      entry({ kind: 'sack', text: 'Q.B SACKED by D.End for -3 yards' }),
      note('SAFETY! NO scores 2.', { awayScore: 2 }),
    ]);
    expect(b).toMatchObject({ tone: 'score', teamId: NO.id, head: 'Safety' });
  });

  it('an interception and a lost fumble: the side that took it, who took it, whose ball', () => {
    const pick = banner([
      entry({
        kind: 'int',
        to: 60,
        who: undefined,
        text: 'Q.B pass deep right intended for W.Out INTERCEPTED by C.Orner',
      }),
    ]);
    expect(pick).toEqual({
      kind: 'banner',
      tone: 'turnover',
      teamId: NO.id,
      head: 'Interception',
      line: 'C.Orner picks off Q.B',
      side: 'New Orleans ball',
    });
    const fumble = banner([entry({ text: 'J.Back rush for 3 yards. FUMBLE, recovered by S.Afety', loose: 28 })]);
    expect(fumble).toMatchObject({
      tone: 'turnover',
      teamId: NO.id,
      head: 'Fumble',
      line: 'Recovered by S.Afety',
      side: 'New Orleans ball',
    });
  });

  it('a fourth down stopped', () => {
    const b = banner([entry({ down: 4, distance: 5 }), note('Turnover on downs.')]);
    expect(b).toMatchObject({ tone: 'turnover', teamId: NO.id, head: 'Turnover on downs', side: 'New Orleans ball' });
  });

  it('a flag: the foul, on whom, and what it cost, in the words All-22 uses', () => {
    const b = banner([
      entry({
        kind: 'penalty',
        text: 'Q.B pass short right to W.Out for 2 yards (E.Waters). PENALTY on NO (E.Waters): Defensive holding, 5 yards. No play.',
      }),
    ]);
    expect(b).toEqual({
      kind: 'banner',
      tone: 'flag',
      teamId: null,
      head: 'Defensive holding',
      line: 'NO E.Waters',
      side: '5 yds, no play',
    });
  });

  it('an injury: the man, his position, what it is', () => {
    const b = banner([note('Injury: BUF RB J.Back (back spasms) is out for the game.')]);
    expect(b).toEqual({
      kind: 'banner',
      tone: 'injury',
      teamId: BUF.id,
      head: 'Injury',
      line: 'J.Back, RB · back spasms',
      side: 'Out for the game',
    });
  });

  it('an ordinary play makes none, nor an extra point or a two-point try', () => {
    expect(of([entry()])).toEqual([]);
    expect(
      of([entry({ kind: 'xp', down: 0, who: undefined, text: 'K.Icker extra point is GOOD.', homeScore: 1 })]),
    ).toEqual([]);
    expect(
      of([
        entry({ text: 'Two-point try: J.Back rush, TOUCHDOWN — GOOD.', yardLine: 98, from: 98, to: 102, homeScore: 2 }),
      ]),
    ).toEqual([]);
  });
});

describe('a player’s line', () => {
  const big = entry({ from: 25, to: 25 + BIG_GAIN, text: 'J.Back rush left end for 20 yards (L.Backer)' });

  it('follows a gain of twenty yards or more, with his numbers through that play', () => {
    const [m] = of([entry(), big]);
    expect(m).toEqual({ kind: 'player', playerId: 30, teamId: BUF.id, number: undefined, line: '2 car · 23 yds' });
  });

  it('is his catches after a long catch', () => {
    const [m] = of([
      entry({
        kind: 'pass',
        to: 60,
        who: packActors({ ball: 19 }),
        text: 'Q.B pass deep left to W.Out for 35 yards (C.Orner)',
      }),
    ]);
    expect(m).toMatchObject({ kind: 'player', playerId: 19, line: '1 rec · 35 yds' });
  });

  it('does not follow a shorter gain', () => {
    expect(of([entry({ to: 25 + BIG_GAIN - 1 })])).toEqual([]);
  });

  it('gives way to a banner: a long touchdown is told once', () => {
    const moments = of([entry({ to: 102, text: 'J.Back rush for 75 yards, TOUCHDOWN', homeScore: 6 })]);
    expect(moments.map((m) => m.kind)).toEqual(['banner']);
  });

  it('is left out when the game kept no word of who had the ball', () => {
    expect(of([{ ...big, who: undefined }])).toEqual([]);
  });
});

describe('cards', () => {
  it('mark the end of the first and third quarters, the half, regulation and the game', () => {
    const last = (quarter: number, next?: number) =>
      momentsFor([entry({ quarter }), ...(next ? [entry({ quarter: next })] : [])], 0, BUF, NO, NAMES, { over: !next });
    expect(last(1, 2)).toEqual([{ kind: 'quarter', head: 'End of the first quarter' }]);
    expect(last(2, 3)).toEqual([{ kind: 'half' }]);
    expect(last(3, 4)).toEqual([{ kind: 'quarter', head: 'End of the third quarter' }]);
    expect(last(4, 5)).toEqual([{ kind: 'quarter', head: 'End of regulation' }]);
    // A playoff game goes on through as many overtime periods as it takes.
    expect(last(5, 6)).toEqual([{ kind: 'quarter', head: 'End of overtime' }]);
    expect(last(4)).toEqual([{ kind: 'final' }]);
  });

  it('do not call a live game final at the last play it has reached', () => {
    expect(momentsFor([entry({ quarter: 4 })], 0, BUF, NO, NAMES, { over: false })).toEqual([]);
  });

  it('come after the banner of the play that ended the period', () => {
    const plays = [
      entry({ quarter: 2, to: 102, text: 'J.Back rush for 75 yards, TOUCHDOWN', homeScore: 6 }),
      entry({ quarter: 3 }),
    ];
    expect(momentsFor(plays, 0, BUF, NO, NAMES, { over: true }).map((m) => m.kind)).toEqual(['banner', 'half']);
  });
});

describe('how long the screen holds', () => {
  const score: Moment = { kind: 'banner', tone: 'score', teamId: 1, head: 'Touchdown', line: '' };
  const player: Moment = { kind: 'player', playerId: 1, teamId: 1, line: '' };
  const quarter: Moment = { kind: 'quarter', head: '' };

  it('holds a banner 2.6 seconds, less when sped up, never under the floor', () => {
    expect(momentHold([score], 1)).toBe(2600);
    expect(momentHold([score], 2)).toBe(1300);
    expect(momentHold([score], 4)).toBe(BANNER_FLOOR);
    expect(momentHold([score], 8)).toBe(BANNER_FLOOR);
  });

  it('holds a player’s line a beat longer, and skips it and the quarter card when sped up', () => {
    expect(momentHold([player], 1)).toBe(2600 + LINE_BEAT);
    expect(momentHold([player], 4)).toBe(0);
    expect(momentHold([quarter], 1)).toBe(2000);
    expect(momentHold([quarter], 8)).toBe(0);
  });

  it('holds a banner and then the quarter’s card, one after the other', () => {
    expect(momentHold([score, quarter], 1)).toBe(2600 + 2000);
    expect(momentHold([score, quarter], 4)).toBe(BANNER_FLOOR);
  });

  it('adds nothing for an ordinary play', () => {
    expect(momentHold([], 1)).toBe(0);
  });
});

describe('on real games', () => {
  const worlds: League[] = ['moments-a', 'moments-b'].map((seed) => {
    const league = createLeague({ seed });
    playWeek(league);
    return league;
  });

  it('marks every score once, for the side that scored, and every giveaway and flag', () => {
    const wrong: string[] = [];
    let scores = 0;
    for (const league of worlds)
      for (const g of league.games.filter((x) => x.result?.plays?.some((p) => !p.scoring))) {
        const plays = g.result!.plays!;
        const [home, away] = [league.teams[g.homeId], league.teams[g.awayId]];
        const names = buildPlayNames(league, g);
        plays.forEach((e, i) => {
          const where = `${league.seed} g${g.id} #${i} ${e.text.slice(0, 50)}`;
          const banners = momentsFor(plays, i, home, away, names, { record: g.result!.field, over: true }).filter(
            (m): m is Extract<Moment, { kind: 'banner' }> => m.kind === 'banner',
          );
          if (banners.length > 1) wrong.push(`two banners: ${where}`);
          const b = banners[0];
          const dh = e.homeScore - (plays[i - 1]?.homeScore ?? 0);
          const da = e.awayScore - (plays[i - 1]?.awayScore ?? 0);
          const pts = dh + da;
          const isTry = /^Two-point try/.test(e.text) || e.kind === 'two';
          if ((pts === 6 || pts === 3 || (pts === 2 && !isTry)) && e.kind !== 'xp') {
            scores++;
            if (b?.tone !== 'score' || b.teamId !== (dh ? home.id : away.id)) wrong.push(`score: ${where}`);
          } else if (e.kind === 'int' || fumbleIn(e)?.lost) {
            if (b?.tone !== 'turnover') wrong.push(`turnover: ${where}`);
          } else if (flagCall(e) && pts === 0) {
            if (b?.tone !== 'flag') wrong.push(`flag: ${where}`);
          }
        });
      }
    expect(wrong).toEqual([]);
    expect(scores).toBeGreaterThan(100);
  });
});
