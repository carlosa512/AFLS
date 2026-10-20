import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { AGING, ageShift, declineOnset, retireChance } from './aging';
import { developPlayer, playedShare } from './development';
import { ageFactor, preferredYears } from './finance/market';
import { createLeague, generatePlayer, SAVE_VERSION } from './generate';
import { simToEndOfSeason } from './league';
import { buildLineup } from './match/lineup';
import { simulateGame } from './match/gameSim';
import { migrateLeague } from './migrate';
import { beginOffseason } from './offseason';
import { playerOvr } from './positions';
import { Rng } from './rng';
import { careerOutlook, characterNotes, characterRead, CHARACTER_KNOWLEDGE, isProspect, knowledge, needsReps, perceive, projectedCeiling, scoutReport } from './scouting';
import { generateTraits, TRAIT_MEAN } from './traits';
import type { League, Player, Position, Traits } from './types';

const copy = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const corr = (xs: number[], ys: number[]) => {
  const mx = mean(xs);
  const my = mean(ys);
  const cov = mean(xs.map((x, i) => (x - mx) * (ys[i] - my)));
  return cov / Math.sqrt(mean(xs.map((x) => (x - mx) ** 2)) * mean(ys.map((y) => (y - my) ** 2)));
};

/** A fresh player of a given position, age and makeup. */
function rookie(pos: Position, age: number, i: number, traits: Partial<Traits> = {}): Player {
  const rng = new Rng(`dev-test:${pos}:${i}`);
  const p = generatePlayer(rng, { id: 1_000_000 + i, position: pos, quality: 11, age, teamId: null, jerseysUsed: new Set() });
  p.traits = { ...p.traits, ...traits };
  return p;
}

/** Average change in overall over `years` offseasons for clones that differ only in what `vary` sets. */
function growth(pos: Position, age: number, years: number, vary: (p: Player) => void, played = 1, n = 300): number {
  const deltas: number[] = [];
  for (let i = 0; i < n; i++) {
    const p = rookie(pos, age, i);
    vary(p);
    const start = playerOvr(p);
    for (let y = 0; y < years; y++) {
      developPlayer(new Rng(`dev-test:year:${i}:${y}`), p, { playedShare: played });
      p.age++;
    }
    deltas.push(playerOvr(p) - start);
  }
  return mean(deltas);
}

describe('hidden traits', () => {
  it('are seeded by the player, on the 1–20 scale, and independent of talent', () => {
    const league = createLeague({ seed: 'traits-a' });
    const again = createLeague({ seed: 'traits-a' });
    const players = Object.values(league.players);
    for (const p of players.slice(0, 50)) expect(again.players[p.id].traits).toEqual(p.traits);
    expect(generateTraits(players[0])).toEqual(players[0].traits);
    const we = players.map((p) => p.traits.workEthic);
    const dur = players.map((p) => p.traits.durability);
    const temp = players.map((p) => p.traits.temperament);
    for (const t of [...we, ...dur, ...temp]) expect(Number.isInteger(t) && t >= 1 && t <= 20).toBe(true);
    expect(Math.abs(mean(we) - TRAIT_MEAN)).toBeLessThan(0.3);
    expect(Math.abs(mean(dur) - TRAIT_MEAN)).toBeLessThan(0.3);
    // Pros keep their cool a little more often; nothing else is related.
    expect(corr(we, temp)).toBeGreaterThan(0.15);
    expect(corr(we, temp)).toBeLessThan(0.45);
    expect(Math.abs(corr(we, dur))).toBeLessThan(0.08);
    expect(Math.abs(corr(we, players.map(playerOvr)))).toBeLessThan(0.08);
  });
});

describe('development', () => {
  it('rewards work ethic and reps while young, and nothing grows after 25', () => {
    const driven = growth('WR', 21, 5, (p) => (p.traits.workEthic = 17));
    const coasts = growth('WR', 21, 5, (p) => (p.traits.workEthic = 4));
    expect(driven - coasts).toBeGreaterThan(0.5);
    const starter = growth('CB', 22, 4, () => {}, 1);
    const bench = growth('CB', 22, 4, () => {}, 0);
    expect(starter - bench).toBeGreaterThan(0.25);
    expect(Math.abs(growth('LB', 27, 1, () => {}))).toBeLessThan(0.25);
  });

  it('follows the position curves: backs fade first, linemen hold, a quarterback loses his legs before his arm', () => {
    const at29 = (pos: Position) => growth(pos, 29, 1, () => {});
    expect(at29('RB')).toBeLessThan(-1);
    expect(at29('OL')).toBeGreaterThan(-0.3);
    // QB at 31: legs on the way down, accuracy still holding.
    let speed = 0;
    let acc = 0;
    for (let i = 0; i < 300; i++) {
      const p = rookie('QB', 31, i);
      const before = { ...p.ratings };
      developPlayer(new Rng(`qb:${i}`), p, { playedShare: 1 });
      speed += p.ratings.speed - before.speed;
      acc += p.ratings.throwAccShort - before.throwAccShort;
    }
    expect(speed / 300).toBeLessThan(-0.5);
    expect(acc / 300).toBeGreaterThan(-0.1);
  });

  it('lets a durable body and a hard worker age more gently', () => {
    const durable = growth('RB', 28, 2, (p) => (p.traits.durability = 18));
    const fragile = growth('RB', 28, 2, (p) => (p.traits.durability = 3));
    expect(durable - fragile).toBeGreaterThan(1);
    const pro = growth('WR', 31, 2, (p) => (p.traits.workEthic = 18));
    const lazy = growth('WR', 31, 2, (p) => (p.traits.workEthic = 3));
    expect(pro - lazy).toBeGreaterThan(0.4);
    expect(declineOnset('RB', 'technical', { durability: 20 })).toBeGreaterThan(declineOnset('RB', 'technical'));
  });

  it('counts reps from games played and runs each player on his own stream', () => {
    const league = createLeague({ seed: 'dev-reps' });
    simToEndOfSeason(league);
    const team = league.teams[league.userTeamId];
    const starter = league.players[team.depthChart.QB[0]];
    const third = league.players[team.depthChart.QB[2]];
    // A starter suits up every week he's healthy; an injury can cost him a few.
    const gp = starter.stats[league.season]?.gp ?? 0;
    expect(gp).toBeGreaterThanOrEqual(10);
    expect(playedShare(starter, league.season)).toBe(Math.min(1, gp / 17));
    expect(playedShare(third, league.season)).toBeLessThan(0.3);
    // "Needs reps": young, still growing in your scouts' eyes, and not playing.
    const mine = Object.values(league.players).filter((p) => p.teamId === team.id);
    const sitting = mine.find((p) => p.age <= 25 && !p.stats[league.season]?.gp && perceive(league, team.id, p).potMid - playerOvr(p) >= 1.5);
    expect(sitting).toBeDefined();
    expect(needsReps(league, team.id, sitting!, league.season)).toBe(true);
    expect(needsReps(league, team.id, starter, league.season)).toBe(false);
    // Promote him and the flag goes: the reps are coming.
    const chart = team.depthChart[sitting!.position];
    chart.splice(chart.indexOf(sitting!.id), 1);
    chart.unshift(sitting!.id);
    expect(needsReps(league, team.id, sitting!, league.season)).toBe(false);
    expect(mine.some((p) => needsReps(league, team.id, p, league.season + 1))).toBe(false);

    // Taking a player out of the league changes nobody else's development.
    const a = copy(league);
    const b = copy(league);
    const gone = Object.values(b.players).find((p) => p.teamId === null && !p.retired && !isProspect(p))!;
    gone.retired = true;
    beginOffseason(a);
    beginOffseason(b);
    const sample = Object.values(a.players).filter((p) => p.id !== gone.id && !p.retired && p.teamId !== null).slice(0, 200);
    for (const p of sample) expect(b.players[p.id].ratings).toEqual(p.ratings);
  }, 30_000);
});

describe('retirement and the one aging table', () => {
  it('retires players by position and body clock, not one age for everyone', () => {
    const at = (pos: Position, age: number, durability = TRAIT_MEAN, teamId: number | null = 0) => {
      const p = rookie(pos, age, 1, { durability });
      p.teamId = teamId;
      return retireChance(p, 13);
    };
    expect(at('RB', 36)).toBe(1);
    expect(at('K', 35)).toBe(0);
    expect(at('K', 37)).toBeLessThan(at('RB', 33));
    expect(at('QB', 36)).toBeLessThan(at('WR', 36));
    expect(at('WR', 33, 20)).toBeLessThan(at('WR', 33, 1));
    for (let age = 28; age < 40; age++) expect(at('OL', age + 1)).toBeGreaterThanOrEqual(at('OL', age));
  });

  it('feeds contracts and trades from the same curve', () => {
    // Unchanged from before: quarterbacks and kickers age 4 years later, backs 2 earlier.
    expect(ageShift('QB')).toBe(4);
    expect(ageShift('K')).toBe(4);
    expect(ageShift('RB')).toBe(-2);
    expect(ageShift('WR')).toBe(0);
    expect(ageFactor('RB', 29)).toBeLessThan(ageFactor('OL', 29));
    expect(preferredYears(rookie('RB', 28, 1))).toBeLessThan(preferredYears(rookie('OL', 28, 1)));
    for (const pos of Object.keys(AGING) as Position[]) expect(Math.abs(ageShift(pos))).toBeLessThanOrEqual(4);
  });
});

describe('temperament', () => {
  it('moves only the line’s discipline, and hotheads draw more flags', () => {
    const league = createLeague({ seed: 'temper' });
    const team = league.teams[0];
    const set = (l: League, t: number) => {
      for (const pos of ['OL', 'DT', 'EDGE'] as const) for (const id of l.teams[0].depthChart[pos]) l.players[id].traits.temperament = t;
      for (const id of l.teams[0].depthChart.WR) l.players[id].traits.temperament = t;
    };
    const calm = copy(league);
    const hot = copy(league);
    set(calm, 20);
    set(hot, 1);
    const lc = buildLineup(calm, calm.teams[0]);
    const lh = buildLineup(hot, hot.teams[0]);
    expect(lc.offenseDiscipline - lh.offenseDiscipline).toBeCloseTo(0.3 * 19, 5);
    expect(lc.passBlock).toBe(lh.passBlock);
    const flags = (l: League) => {
      let n = 0;
      const games = l.games.filter((g) => g.homeId === team.id || g.awayId === team.id);
      for (let rep = 0; rep < 8; rep++)
        for (const g of games) {
          const r = simulateGame(l, g, { seed: `temper:${g.id}:${rep}` });
          n += g.homeId === team.id ? r.home.penalties : r.away.penalties;
        }
      return n;
    };
    expect(flags(hot)).toBeGreaterThan(flags(calm) * 1.15);
  }, 30_000);
});

describe('what scouts can say about makeup', () => {
  it('reads character in words once they know a player, sharper with knowledge, without touching the league stream', () => {
    const league = createLeague({ seed: 'makeup' });
    const before = league.rngState;
    const me = league.userTeamId;
    const own = Object.values(league.players).find((p) => p.teamId === me)!;
    expect(characterRead(league, me, own)).toMatchObject({ ...own.traits, exact: true });
    const prospect = Object.values(league.players).find((p) => p.teamId !== me && knowledge(league, me, p) < CHARACTER_KNOWLEDGE)!;
    expect(characterRead(league, me, prospect)).toBeNull();
    expect(characterNotes(league, me, prospect).known).toBe(false);

    league.knowledge[prospect.id] = 0.6;
    const loose = characterRead(league, me, prospect)!;
    expect(characterRead(league, me, prospect)).toEqual(loose);
    league.knowledge[prospect.id] = 0.95;
    const tight = characterRead(league, me, prospect)!;
    expect(tight.sd).toBeLessThan(loose.sd);
    expect(league.rngState).toEqual(before);

    // Across the league, a well-known read lands close to the truth.
    const vets = Object.values(league.players).filter((p) => p.teamId !== null && p.teamId !== me && p.experience >= 5).slice(0, 300);
    const err = vets.map((p) => Math.abs(characterRead(league, me, p)!.workEthic - p.traits.workEthic));
    expect(mean(err)).toBeLessThan(1.5);

    // Screens get words, never numbers, and a veteran's makeup is never an open book.
    for (const p of vets) {
      const notes = characterNotes(league, me, p);
      for (const n of notes.notes) expect(n.line + n.label).not.toMatch(/\d/);
      expect(careerOutlook(league, me, p)).toMatch(/prime|fade|Past/i);
      expect(characterRead(league, me, p)!.sd).toBeGreaterThan(0.3);
      const report = scoutReport(league, me, p).join(' ');
      expect(report).not.toMatch(/::|: [a-z][^.]*:/);
    }
  });

  it('times the outlook to when his ratings actually start to drop', () => {
    // A receiver with a near-typical body: technique turns at 29.1, so he still carries his best
    // technique at 30 and the first real drop shows at 31.
    let at29 = 0;
    let at30 = 0;
    let at31 = 0;
    for (let i = 0; i < 300; i++) {
      const p = rookie('WR', 26, i, { durability: 11, workEthic: 10 });
      for (let age = 26; age < 31; age++) {
        if (age === 29) at29 += p.ratings.routeRunning;
        if (age === 30) at30 += p.ratings.routeRunning;
        developPlayer(new Rng(`outlook:${i}:${age}`), p, { playedShare: 1 });
        p.age++;
      }
      at31 += p.ratings.routeRunning;
    }
    expect(Math.abs(at30 - at29) / 300).toBeLessThan(0.15);
    expect((at31 - at30) / 300).toBeLessThan(-0.5);

    const league = createLeague({ seed: 'outlook' });
    const me = league.userTeamId;
    const wr = Object.values(league.players).find((p) => p.teamId === me && p.position === 'WR')!;
    wr.traits.durability = 11;
    wr.age = 27;
    expect(careerOutlook(league, me, wr)).toBe('His physical tools should start to fade after about 29; his technique should hold up through about 30.');
    wr.age = 30;
    expect(careerOutlook(league, me, wr)).toBe('His physical tools have started to fade; his technique should hold up through about 30.');
    // The report says the same in one of its reviewed wordings: the tools going first, the technique holding this year.
    expect(scoutReport(league, me, wr)[2]).toMatch(/^(His physical tools have begun to fade, but his technique should hold this year|The athleticism is going first; his technique should hold this year)/);
    wr.age = 29;
    expect(scoutReport(league, me, wr)[2]).toMatch(/about 29.*about 30|about 30.*about 29/);
    wr.age = 30;
    expect(scoutReport(league, me, wr)[0]).toMatch(/ wide receiver (whose value now rests on his technique|living on his technique now)\.$/);
    wr.age = 31;
    expect(careerOutlook(league, me, wr)).toMatch(/^Past his prime/);
    const ol = Object.values(league.players).find((p) => p.teamId === me && p.position === 'OL')!;
    ol.traits.durability = 11;
    ol.age = 32;
    expect(careerOutlook(league, me, ol)).toBe('In the last year of his prime: expect the decline to start next year.');
  });

  it('projects a grinder closer to his ceiling than a coaster, within bounds', () => {
    expect(projectedCeiling(10, 14, 18)).toBeGreaterThan(projectedCeiling(10, 14, 4));
    expect(projectedCeiling(10, 14)).toBe(14);
    expect(projectedCeiling(10, 14, 20)).toBeLessThanOrEqual(15);
    expect(projectedCeiling(10, 14, 1)).toBeGreaterThanOrEqual(13);
  });

  it('keeps the true traits out of the screens', () => {
    const dir = new URL('../ui/', import.meta.url);
    const files = readdirSync(dir, { recursive: true }).map(String).filter((f) => /\.tsx?$/.test(f));
    for (const f of files) {
      const src = readFileSync(new URL(f, dir), 'utf8');
      expect(src, f).not.toMatch(/\.traits\b|\bcharacterRead\b|\bprojectedCeiling\b/);
    }
  });
});

describe('save migration to v5', () => {
  it('gives every player the same traits a new league would', () => {
    const league = createLeague({ seed: 'migrate-v5' });
    const old = copy(league);
    old.version = 4;
    for (const p of Object.values(old.players)) delete (p as Partial<Player>).traits;
    const up = migrateLeague(old)!;
    expect(up.version).toBe(SAVE_VERSION);
    for (const p of Object.values(league.players)) expect(up.players[p.id].traits).toEqual(p.traits);
    expect(up.rngState).toEqual(league.rngState);
    // Running it again changes nothing.
    expect(migrateLeague(copy(up))).toEqual(up);
  });
});
