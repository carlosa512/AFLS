import { beforeAll, describe, expect, it } from 'vitest';
import { createLeague } from './generate';
import { playWeek } from './league';
import { FORM, inSlump, MAN, manForm, unitForm, unitMan, unitOf, UNITS } from './slump';
import type { League } from './types';

let l: League;
beforeAll(() => {
  l = createLeague({ seed: 'slump' });
  for (let week = 1; week <= 9; week++) playWeek(l);
}, 240_000);

const played = (league: League, teamId: number, through: number) =>
  league.games.filter(
    (g) =>
      g.season === league.season &&
      !g.playoffRound &&
      g.result &&
      g.week <= through &&
      (g.homeId === teamId || g.awayId === teamId),
  );

describe('a unit’s form over its last four games', () => {
  it('has nothing to say until every club has played four', () => {
    for (const unit of UNITS) expect(unitForm(l, 0, unit, 3)).toBeNull();
    for (const t of l.teams) for (const unit of UNITS) expect(unitForm(l, t.id, unit, 9)).not.toBeNull();
  });

  it('ranks the 32 clubs once each, first to last', () => {
    for (const unit of UNITS) {
      const ranks = l.teams.map((t) => unitForm(l, t.id, unit, 9)!.rank).sort((a, b) => a - b);
      expect(ranks).toEqual(l.teams.map((_, i) => i + 1));
    }
  });

  it('counts a club’s last four games played, whatever weeks they fell in', () => {
    const off = l.teams.find((t) => played(l, t.id, 9).length === 8)!;
    expect(off).toBeDefined();
    const f = unitForm(l, off.id, 'run game', 9)!;
    expect(f.games).toBe(4);
    const weeks = played(l, off.id, 9)
      .map((g) => g.week)
      .sort((a, b) => a - b)
      .slice(-4);
    expect([f.from, f.to]).toEqual([weeks[0], weeks[3]]);
  });

  it('keeps the results of the span and of what came before it', () => {
    for (const t of l.teams) {
      const f = unitForm(l, t.id, 'coverage', 9)!;
      expect(f.won + f.lost).toBeLessThanOrEqual(4);
      expect((f.before?.games ?? 0) + f.games).toBe(played(l, t.id, 9).length);
      expect(f.league).toBeGreaterThan(0);
    }
  });

  it('reads the offensive line as sacks allowed a dropback', () => {
    const one = createLeague({ seed: 'slump-one' });
    playWeek(one);
    const g = one.games.find((x) => x.season === one.season && x.week === 1 && x.result)!;
    g.result!.home.sacked = 6;
    g.result!.home.passAtt = 24;
    const was = FORM.games;
    FORM.games = 1;
    try {
      expect(unitForm(one, g.homeId, 'offensive line', 1)!.value).toBeCloseTo(0.2, 6);
      // The other side's pass rush made those sacks.
      expect(unitForm(one, g.awayId, 'pass rush', 1)!.value).toBeCloseTo(0.2, 6);
    } finally {
      FORM.games = was;
    }
  });
});

describe('a man’s form', () => {
  it('puts every position but the kickers in a unit', () => {
    expect(unitOf('QB')).toBe('passing game');
    expect(unitOf('OL')).toBe('offensive line');
    expect(unitOf('EDGE')).toBe('pass rush');
    expect(unitOf('S')).toBe('coverage');
    expect(unitOf('K')).toBeNull();
  });

  it('is his unit’s, with the games of the span he started', () => {
    const t = l.teams.find((x) => played(l, x.id, 9).length === 9)!;
    // The club's passer: its most attempts this season.
    const qb = Object.values(l.players)
      .filter((p) => p.teamId === t.id && p.position === 'QB')
      .sort((a, b) => (b.stats[l.season]?.passAtt ?? 0) - (a.stats[l.season]?.passAtt ?? 0))[0];
    const m = manForm(l, qb.id, 9)!;
    expect(m.unit).toBe('passing game');
    expect(m.form).toEqual(unitForm(l, t.id, 'passing game', 9));
    expect(m.started).toBeGreaterThanOrEqual(0);
    expect(m.started).toBeLessThanOrEqual(4);
    // A backup who did not play has started none, and is in no slump whatever his unit has done.
    const backup = Object.values(l.players).find(
      (p) => p.teamId === t.id && p.position === 'QB' && !(p.stats[l.season]?.snaps ?? 0),
    );
    if (backup) {
      expect(manForm(l, backup.id, 9)!.started).toBe(0);
      expect(inSlump(l, backup.id, 9)).toBe(false);
    }
  });

  it('calls it a slump only for a man who started all four games of a bottom-quarter span', () => {
    let found = 0;
    for (const p of Object.values(l.players)) {
      if (p.teamId === null) continue;
      const m = manForm(l, p.id, 9);
      if (!m) continue;
      const slump = m.started === FORM.games && m.form.rank > 32 - FORM.quarter;
      expect(inSlump(l, p.id, 9)).toBe(slump);
      if (slump) found++;
    }
    expect(found).toBeGreaterThan(0);
  });
});

describe('the one man a unit’s numbers point at', () => {
  /** A club's last four games, with one man's line written into each box score. */
  const write = (league: League, teamId: number, playerId: number, line: Record<string, number>) => {
    for (const g of played(league, teamId, 9).slice(-4)) {
      g.result!.playerStats[playerId] = { ...(g.result!.playerStats[playerId] ?? {}), ...line };
      g.result!.playerTeams[playerId] = teamId;
    }
  };
  const fresh = () => {
    const x = createLeague({ seed: 'slump-man' });
    for (let week = 1; week <= 9; week++) playWeek(x);
    return x;
  };
  let m: League;
  let t: number;
  const of = (pos: string, n = 0) => Object.values(m.players).filter((p) => p.teamId === t && p.position === pos)[n];
  beforeAll(() => {
    m = fresh();
    t = m.teams[3].id;
  }, 240_000);

  it('names a lineman charged with a large share of the sacks, and nobody when they are spread around', () => {
    for (const g of played(m, t, 9).slice(-4)) {
      const side = g.homeId === t ? g.result!.home : g.result!.away;
      side.sacked = 3;
      for (const p of Object.values(m.players))
        if (p.teamId === t && p.position === 'OL' && g.result!.playerStats[p.id])
          g.result!.playerStats[p.id].sacksAllowed = 0;
    }
    const tackle = of('OL');
    write(m, t, tackle.id, { snaps: 60, sacksAllowed: 2 });
    expect(unitMan(m, t, 'offensive line', 9, 'blame')).toEqual({ playerId: tackle.id, what: 'lineSacks', n: 8 });
    // Nobody is praised for a clean pocket.
    expect(unitMan(m, t, 'offensive line', 9, 'credit')).toBeNull();
    // One each from four linemen is the line's problem, not a man's.
    write(m, t, tackle.id, { sacksAllowed: 1 });
    for (const n of [1, 2, 3]) write(m, t, of('OL', n).id, { snaps: 60, sacksAllowed: 1 });
    expect(unitMan(m, t, 'offensive line', 9, 'blame')).toBeNull();
  });

  it('names a quarterback who keeps turning it over, and a back who carries the load', () => {
    const qb = of('QB');
    write(m, t, qb.id, { snaps: 60, passAtt: 34, passInt: 2, fumblesLost: 0, passTd: 1 });
    expect(unitMan(m, t, 'passing game', 9, 'blame')).toEqual({ playerId: qb.id, what: 'turnovers', n: 8 });
    write(m, t, qb.id, { passInt: 1 });
    expect(unitMan(m, t, 'passing game', 9, 'blame')).toBeNull();
    const back = of('RB');
    for (const g of played(m, t, 9).slice(-4)) (g.homeId === t ? g.result!.home : g.result!.away).rushAtt = 25;
    for (const p of Object.values(m.players))
      if (p.teamId === t && p.position === 'RB' && p.id !== back.id) write(m, t, p.id, { rushAtt: 2 });
    write(m, t, back.id, { snaps: 50, rushAtt: 20, rushYds: 60 });
    expect(unitMan(m, t, 'run game', 9, 'blame')?.playerId).toBe(back.id);
    expect(unitMan(m, t, 'run game', 9, 'credit')?.what).toBe('carries');
  });

  it('never names a man for a run defense or a coverage that is struggling', () => {
    expect(unitMan(m, t, 'run defense', 9, 'blame')).toBeNull();
    expect(unitMan(m, t, 'coverage', 9, 'blame')).toBeNull();
    expect(MAN.share).toBeGreaterThan(0.3);
  });
});
