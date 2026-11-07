import { describe, expect, it } from 'vitest';
import { createLeague } from '../generate';
import type { PlayLogEntry } from '../types';
import type { GameResult } from '../types';
import { simulateGame, type SituationTap } from './gameSim';
import { sureTwo } from './twoPoint';

const league = createLeague({ seed: 'situations-engine' });
const taps: (SituationTap & { game: number })[] = [];
const games: { plays: PlayLogEntry[]; homeId: number; awayId: number; r: GameResult }[] = [];
for (const g of league.games.filter((x) => !x.playoffRound).slice(0, 40)) {
  const r = simulateGame(league, g, { keepPlays: true, situationTap: (t) => taps.push({ ...t, game: g.id }) });
  games.push({ plays: r.plays!, homeId: g.homeId, awayId: g.awayId, r });
}
const of = <K extends SituationTap['kind']>(kind: K) =>
  taps.filter((t): t is Extract<SituationTap, { kind: K }> & { game: number } => t.kind === kind);

describe("a play's time, in the engine", () => {
  it('times every play at a second or more, incompletions as the NFL does', () => {
    const time = of('time');
    expect(time.length).toBeGreaterThan(40 * 100);
    for (const t of time) expect(t.seconds).toBeGreaterThanOrEqual(1);
    const inc = time.filter((t) => t.play === 'incomplete');
    expect(Math.abs(inc.reduce((a, t) => a + t.seconds, 0) / inc.length - 4.73)).toBeLessThan(0.6);
    // AI games: the field times nothing.
    expect(time.some((t) => t.field)).toBe(false);
  });
});

describe("the half's last possession, in the engine", () => {
  it('decides once a drive, never kneels past midfield, and sometimes tries from deep', () => {
    const half = of('half');
    expect(half.length).toBeGreaterThan(5);
    for (const t of half) {
      expect(t.clock).toBeLessThanOrEqual(75);
      if (t.kneeled) expect(t.yardLine).toBeLessThan(50);
    }
    // One a drive: within a game, each next decision comes later in the half.
    for (const g of new Set(half.map((t) => t.game))) {
      const clocks = half.filter((t) => t.game === g).map((t) => t.clock);
      for (let i = 1; i < clocks.length; i++) expect(clocks[i]).toBeLessThan(clocks[i - 1]);
    }
    expect(half.some((t) => !t.kneeled && t.yardLine <= 35)).toBe(true);
  });

  it('lets a drive that tries from deep score, or run out the half', () => {
    const deep = of('half').filter((t) => !t.kneeled && t.yardLine <= 35);
    expect(deep.some((t) => t.points >= 3)).toBe(true);
    expect(deep.some((t) => t.reachedHalf && t.points === 0)).toBe(true);
  });
});

const TRY = /^Two-point try: /;
const SNAPS = ['run', 'pass', 'incomplete', 'int', 'sack', 'scramble'];
const lastIndex = <T>(xs: T[], want: (x: T) => boolean) => {
  for (let i = xs.length - 1; i >= 0; i--) if (want(xs[i])) return i;
  return -1;
};

describe('the two-point try, in the engine', () => {
  it('taps every try, and goes on every sure call', () => {
    const tries = of('try');
    expect(tries.length).toBeGreaterThan(40);
    for (const t of tries)
      if (sureTwo({ quarter: t.quarter, clock: 600, overtime: t.quarter > 4, scoreDiff: t.scoreDiff }))
        expect(t.goes).toBe(true);
    expect(tries.some((t) => t.goes && t.run)).toBe(true);
    expect(tries.some((t) => t.goes && !t.run)).toBe(true);
  });

  it('snaps from the 2 and says how it went', () => {
    const entries = games.flatMap((g) => g.plays.filter((e) => TRY.test(e.text)));
    expect(entries.length).toBe(of('try').filter((t) => t.goes).length);
    for (const e of entries) {
      expect(SNAPS).toContain(e.kind);
      expect(e.yardLine).toBe(98);
      expect(/ — GOOD\.$| — NO GOOD\.$|returns it for 2 points!$/.test(e.text), e.text).toBe(true);
    }
    expect(entries.some((e) => / — GOOD\.$/.test(e.text))).toBe(true);
    expect(entries.some((e) => / — NO GOOD\.$/.test(e.text))).toBe(true);
  });

  it("books no stat: the players' attempts add up to the teams' snaps", () => {
    for (const { r } of games) {
      const sum = (k: 'rushAtt' | 'passAtt') => Object.values(r.playerStats).reduce((a, l) => a + (l[k] ?? 0), 0);
      expect(sum('rushAtt')).toBe(r.home.rushAtt + r.away.rushAtt);
      expect(sum('passAtt')).toBe(r.home.passAtt + r.away.passAtt);
    }
  });

  it('is snapped by the side that scored, after any touchdown, and takes no clock', () => {
    let checked = 0;
    for (const { plays, homeId, awayId } of games)
      plays.forEach((e, i) => {
        if (!TRY.test(e.text)) return;
        const at = lastIndex(plays.slice(0, i), (p) => /TOUCHDOWN/.test(p.text));
        const td = plays[at];
        const homeScored = td.homeScore > (plays[at - 1]?.homeScore ?? 0);
        expect(e.offense, e.text).toBe(homeScored ? homeId : awayId);
        // A touchdown's entry keeps its snap's clock; the try comes after the play's time and takes none of its own.
        expect(e.quarter).toBe(td.quarter);
        expect(e.clock).toBeLessThanOrEqual(td.clock);
        checked++;
      });
    expect(checked).toBeGreaterThan(0);
    // An overtime walk-off has no try: nothing after the winning touchdown in the 5th.
    for (const { plays } of games) {
      const last = lastIndex(plays, (e) => e.quarter >= 5 && /TOUCHDOWN/.test(e.text));
      if (last >= 0) expect(plays.slice(last + 1).some((e) => TRY.test(e.text))).toBe(false);
    }
  });
});

describe('returns, in the engine', () => {
  it('taps every return; a touchdown is exactly the return that reaches the end zone', () => {
    const rets = of('return');
    expect(rets.some((t) => t.play === 'kickoff')).toBe(true);
    expect(rets.some((t) => t.play === 'punt')).toBe(true);
    const logged = games.flatMap((g) =>
      g.plays.filter((e) => /returns the (kickoff|punt) .* for a TOUCHDOWN/.test(e.text)),
    );
    expect(rets.filter((t) => t.td).length).toBe(logged.length);
    for (const t of rets.filter((x) => x.play === 'kickoff')) expect(t.td).toBe(t.yards >= 97);
  });

  it('times a returned punt longer than a fair catch', () => {
    const avg = (k: string) => {
      const xs = of('time').filter((t) => t.play === k);
      return xs.reduce((a, t) => a + t.seconds, 0) / xs.length;
    };
    expect(avg('punt')).toBeGreaterThan(avg('fairCatch') + 2);
  });
});
