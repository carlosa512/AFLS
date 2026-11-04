import { describe, expect, it } from 'vitest';
import { createLeague } from '../generate';
import { playWeek } from '../league';
import { simulateGame, type FieldTap } from '../match/gameSim';
import type { GameResult, League } from '../types';
import { momentOf } from './moment';
import { playYards } from './play';
import { skillsAt } from './snapshot';

const league = createLeague({ seed: 'field-engine' });
const week1 = league.games.filter((g) => g.week === 1);

/** A game played with the switch on, and what each open field started from and decided. */
function spatial(i: number, l: League = league): { r: GameResult; taps: FieldTap[]; homeId: number; awayId: number } {
  const g = l.games.filter((x) => x.week === 1)[i];
  const taps: FieldTap[] = [];
  const r = simulateGame(l, g, { field: true, fieldTap: (t) => taps.push(t) });
  return { r, taps, homeId: g.homeId, awayId: g.awayId };
}

describe('the engine plays the open field', () => {
  const games = [0, 1, 2, 3].map((i) => spatial(i));

  it('plays spatial games to valid results', () => {
    for (const { r, taps, homeId, awayId } of games) {
      expect(taps.filter((t) => t.result).length).toBeGreaterThan(30);
      // Team rushing and receiving yards are the players' sums.
      const sum = (teamId: number, key: 'rushYds' | 'recYds') =>
        Object.entries(r.playerStats)
          .filter(([id]) => r.playerTeams[Number(id)] === teamId)
          .reduce((n, [, line]) => n + (line[key] ?? 0), 0);
      expect(sum(homeId, 'rushYds')).toBe(r.home.rushYds);
      expect(sum(awayId, 'rushYds')).toBe(r.away.rushYds);
      // The tackler (when tackled) is a defender on the field that play.
      for (const t of taps) {
        if (!t.result || t.result.tackler === null) continue;
        expect(t.start.players.find((p) => p.id === t.result!.tackler)!.side, `play ${t.moment.index}`).toBe(1);
      }
    }
  });

  it("logs each spatial play's yards to its spot, downs following and the clock running forward", () => {
    for (const { r } of games) {
      const plays = r.plays!;
      for (let i = 0; i < plays.length - 1; i++) {
        const e = plays[i];
        if (!e.field || e.kind !== 'run' || /PENALTY|FUMBLE|Fumble|TOUCHDOWN|SAFETY/i.test(e.text)) continue;
        const yards = Number(/for (-?\d+) yard/.exec(e.text)?.[1] ?? (/no gain/.test(e.text) ? 0 : NaN));
        if (!Number.isFinite(yards)) continue;
        expect(Math.abs(e.to! - e.from!), `play ${i}`).toBe(Math.abs(yards));
        const next = plays[i + 1];
        if (next.offense === e.offense && next.down > 1 && next.quarter === e.quarter)
          expect(next.yardLine, `play ${i}`).toBe(e.yardLine + yards);
      }
      for (let i = 1; i < plays.length; i++)
        if (plays[i].quarter === plays[i - 1].quarter) expect(plays[i].clock).toBeLessThanOrEqual(plays[i - 1].clock);
    }
  });

  it('plays about as many snaps as the same games with the switch off', () => {
    // Over the games, not each one: once a spatial game's clock moves it on, it's a different game.
    const snaps = (x: GameResult) => x.home.plays + x.away.plays;
    let on = 0;
    let off = 0;
    games.forEach(({ r }, i) => {
      on += snaps(r);
      off += snaps(simulateGame(league, week1[i], { keepPlays: true }));
    });
    expect(Math.abs(on - off) / off).toBeLessThan(0.08);
  });

  it('changes nothing with the switch off or the tap on', () => {
    const plain = simulateGame(league, week1[4], { keepPlays: true });
    const tapped = simulateGame(league, week1[4], { keepPlays: true, fieldTap: () => {} });
    expect(tapped.homeScore).toBe(plain.homeScore);
    expect(tapped.awayScore).toBe(plain.awayScore);
    expect(tapped.playerStats).toEqual(plain.playerStats);
    expect(tapped.plays).toEqual(plain.plays);
  });

  it("rolls today's dice first", () => {
    const on: FieldTap[] = [];
    const off: FieldTap[] = [];
    simulateGame(league, week1[5], { field: true, fieldTap: (t) => on.push(t) });
    simulateGame(league, week1[5], { fieldTap: (t) => off.push(t) });
    expect(on[0].today.yards).toBe(off[0].today.yards);
    expect(on[0].today.tackler).toBe(off[0].today.tackler);
    expect(on[0].start).toEqual(off[0].start);
  });

  it('plays the same spatial game twice', () => {
    const again = spatial(0);
    expect(again.r.playerStats).toEqual(games[0].r.playerStats);
    expect(again.r.plays).toEqual(games[0].r.plays);
  });

  it("rolls fumbles at the sim's tackle", () => {
    let fumbles = 0;
    for (let i = 0; i < 16; i++) {
      const { r } = i < 4 ? games[i] : spatial(i % week1.length);
      for (const e of r.plays!) {
        // A carry's fumble (a strip-sack's recovery is a turnover's own field: `turnover.test.ts`).
        if (!e.field || (e.kind !== 'run' && e.kind !== 'pass') || !/fumble/i.test(e.text)) continue;
        fumbles++;
        // The man who forced it is the one the play's tackle went to: named in the text's parentheses.
        expect(e.text).toMatch(/\(([A-Z]\.[^)]+)\)\. (FUMBLE|Fumble)/);
      }
    }
    expect(fumbles).toBeGreaterThan(0);
  });

  it('logs what a replay needs', () => {
    for (const { r, taps, homeId } of games)
      for (const t of taps) {
        if (!t.result) continue;
        const e = r.plays![t.moment.index];
        expect(momentOf(e, r.field!, t.moment.index, homeId), `play ${t.moment.index}`).toEqual(t.moment);
        for (const p of t.start.players) expect(skillsAt(r.field!.snap!, p.id, t.moment.index)).toEqual(p.s);
      }
  });

  it("moves nothing in the week's other games when yours plays spatially", () => {
    const a = createLeague({ seed: 'field-week' });
    const b = createLeague({ seed: 'field-week' });
    a.settings = { spatialField: true };
    playWeek(a);
    playWeek(b);
    const mine = (l: League, g: (typeof l.games)[number]) => g.homeId === l.userTeamId || g.awayId === l.userTeamId;
    a.games.forEach((g, i) => {
      if (!g.result || mine(a, g)) return;
      expect(g.result.playerStats, `game ${g.id}`).toEqual(b.games[i].result!.playerStats);
      expect(g.result.homeScore).toBe(b.games[i].result!.homeScore);
    });
    expect(a.games.find((g) => g.result && mine(a, g))!.result!.plays!.some((e) => e.field)).toBe(true);
    expect(b.games.find((g) => g.result && mine(b, g))!.result!.plays!.some((e) => e.field)).toBe(false);
  });
});

describe("the owner's call H: today's yards, the field's way there", () => {
  it("credits each spatial play today's yards, and the film ends near them", () => {
    let near = 0;
    let n = 0;
    for (const { taps } of [0, 1, 2].map((i) => spatial(i)))
      for (const t of taps) {
        if (!t.result) continue;
        n++;
        // The start carries today's spot, and the field ends there (the pile within a yard and a half).
        expect(t.moment.facts.to).toBe(t.today.yards);
        expect(t.start.target).toBeDefined();
        const ok = t.today.touchdown
          ? t.result.touchdown
          : !t.result.touchdown && Math.abs(t.result.yards - t.today.yards) <= 1.5;
        if (ok) near++;
        if (t.today.touchdown) expect(t.result.touchdown).toBe(true);
      }
    expect(n).toBeGreaterThan(100);
    expect(near / n).toBeGreaterThanOrEqual(0.9);
  });

  it('takes a run or a catch credited out of bounds out at its spot, nobody credited with a tackle', () => {
    let n = 0;
    for (const { r, taps } of [0, 1, 2, 3].map((i) => spatial(i)))
      for (const t of taps) {
        if (!t.result || !t.moment.facts.oob) continue;
        const e = r.plays![t.moment.index];
        expect(e.text, `play ${t.moment.index}`).toMatch(/out of bounds/);
        expect(t.result.outOfBounds, `play ${t.moment.index}`).toBe(true);
        expect(t.result.tackler, `play ${t.moment.index}`).toBeNull();
        expect(Math.abs(t.result.yards - t.today.yards), `play ${t.moment.index}`).toBeLessThanOrEqual(1.5);
        // The play's own sentence names no tackler (a flag's sentence after it may name its man).
        expect(e.text.split('. ')[0], `play ${t.moment.index}`).not.toMatch(/\([A-Z]\.[^)]*\)/);
        n++;
      }
    expect(n).toBeGreaterThanOrEqual(10);
  });

  it('credits no tackle when the field ends a run or a catch with nobody on him, as the film shows', () => {
    let n = 0;
    for (const { r, taps } of [0, 1, 2, 3].map((i) => spatial(i)))
      for (const t of taps) {
        if (!t.result || t.result.tackler !== null || t.result.touchdown) continue;
        if (t.moment.kind !== 'run' && t.moment.kind !== 'catch') continue;
        const e = r.plays![t.moment.index];
        if (e.kind === 'penalty' || e.loose !== undefined) continue;
        // No man named in parentheses after the yards, and so no fumble forced by one.
        // The play's own sentence names no tackler (a flag's sentence after it may name its man).
        expect(e.text.split('. ')[0], `play ${t.moment.index}`).not.toMatch(/\([A-Z]\.[^)]*\)/);
        n++;
      }
    expect(n).toBeGreaterThan(0);
  });

  it("logs today's yards on every spatial run and catch", () => {
    let n = 0;
    for (const { r, taps, homeId } of [0, 1].map((i) => spatial(i)))
      for (const t of taps) {
        const e = r.plays![t.moment.index];
        if (!t.result || t.moment.kind === 'return' || t.moment.kind === 'turnover') continue;
        if (e.kind === 'penalty' || e.loose !== undefined) continue;
        const dir = e.offense === homeId ? 1 : -1;
        const logged = e.to! >= 100 || e.to! <= 0 ? t.today.yards : (e.to! - e.from!) * dir;
        // `+ 0`: a no-gain play going right to left works out to -0.
        expect(logged + 0, `play ${t.moment.index}`).toBe(t.today.yards);
        n++;
      }
    expect(n).toBeGreaterThan(60);
  });
});

describe('a field the open field cannot play', () => {
  it("leaves a catch made past the goal line it's credited short of to today's film (no teleport back)", () => {
    // Film's league, game 24: a pass at the 1 credited for no gain, the blind staging catching it a yard deep.
    const l = createLeague({ seed: 'film' });
    const g = l.games[24];
    const taps: FieldTap[] = [];
    // The tap alone keeps today's game (with the switch on, an earlier play's field could change what comes later).
    const r = simulateGame(l, g, { seed: 'film-spatial-24', fieldTap: (t) => taps.push(t) });
    expect(r.plays![71].text).toMatch(/for 0 yards/);
    expect(taps.find((t) => t.moment.index === 71)).toBeUndefined();
  });
});

describe('a spatial play to yards', () => {
  it('calls a tackle in the end zone a safety, and a run stopped at the goal line short of it', () => {
    // At his own 2, thrown for a three-yard loss: the engine's own clamp, a safety.
    expect(playYards({ yards: -3, touchdown: false }, 2)).toEqual({ yards: -2, touchdown: false });
    // Tackled half a yard short of the goal line from the 10: not a touchdown.
    expect(playYards({ yards: 9.6, touchdown: false }, 90)).toEqual({ yards: 9, touchdown: false });
    expect(playYards({ yards: 10, touchdown: true }, 90)).toEqual({ yards: 10, touchdown: true });
  });
});
