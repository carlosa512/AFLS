import { describe, expect, it, vi } from 'vitest';

// Every lineup the sim builds, with the mean it was handed: the rebuild after an injury must get the kickoff's.
const calls = vi.hoisted(() => [] as (number | undefined)[]);
vi.mock('./match/lineup', async (load) => {
  const real = await load<typeof import('./match/lineup')>();
  return {
    ...real,
    buildLineup: (...args: Parameters<typeof real.buildLineup>) => {
      calls.push(args[4]);
      return real.buildLineup(...args);
    },
  };
});

const { skill, useKnocks } = await import('./attributes');
const { createLeague } = await import('./generate');
const { buildLineup } = await import('./match/lineup');
const { simulateGame } = await import('./match/gameSim');
const { moodPull, moraleMean } = await import('./morale');
type League = import('./types').League;

/** A league with every mood at Okay, but the user team's starting QB Superb and a starting CB Abysmal. */
function setup() {
  const l = createLeague({ seed: 'mood-effects' });
  for (const p of Object.values(l.players)) p.morale = { level: 0, jolts: [] };
  const team = l.teams[l.userTeamId];
  const qb = l.players[team.depthChart.QB[0]];
  const cb = l.players[team.depthChart.CB[0]];
  qb.morale = { level: 10, jolts: [] };
  cb.morale = { level: -10, jolts: [] };
  return { l, team, qb, cb };
}

describe('game day (G2)', () => {
  it('plays a happy man up and an unhappy one down, half a point at most', () => {
    const { l, team, qb, cb } = setup();
    const mean = moraleMean(l);
    const lineup = buildLineup(l, team, new Set(), undefined, mean);
    expect(lineup.knocks.get(qb.id)).toBeCloseTo(-0.5 * moodPull(10, mean), 9);
    expect(lineup.knocks.get(cb.id)).toBeCloseTo(-0.5 * moodPull(-10, mean), 9);
    const plain = buildLineup(l, team);
    // Everyone in his own position: his whole entry is his mood's, never past half a point.
    for (const [id, k] of lineup.knocks) if (!plain.knocks.has(id)) expect(Math.abs(k)).toBeLessThanOrEqual(0.5);
    const base = skill(qb, 'pocketPresence');
    const prev = useKnocks(lineup.knocks);
    const up = skill(qb, 'pocketPresence');
    useKnocks(prev);
    expect(up - base).toBeCloseTo(0.5 * moodPull(10, mean), 9);
  });

  it('gives a lineup sitting at the mean no entries for mood', () => {
    const { l, team, qb, cb } = setup();
    qb.morale = { level: 0, jolts: [] };
    cb.morale = { level: 0, jolts: [] };
    expect([...buildLineup(l, team, new Set(), undefined, moraleMean(l)).knocks]).toEqual([
      ...buildLineup(l, team).knocks,
    ]);
  });

  it('keeps an out-of-position knock, less his edge', () => {
    const { l, team } = setup();
    // A receiver who lines up only at corner (a man with one job his own keeps his full game).
    const wr = l.players[team.depthChart.WR[team.depthChart.WR.length - 1]];
    team.depthChart.WR = team.depthChart.WR.filter((id) => id !== wr.id);
    team.depthChart.CB[0] = wr.id;
    wr.morale = { level: 10, jolts: [] };
    const mean = moraleMean(l);
    const knock = buildLineup(l, team).knocks.get(wr.id)!;
    expect(knock).toBeGreaterThan(0);
    expect(buildLineup(l, team, new Set(), undefined, mean).knocks.get(wr.id)).toBeCloseTo(
      knock - 0.5 * moodPull(10, mean),
      9,
    );
  });

  it('changes nothing without a mean', () => {
    const { l, team, qb, cb } = setup();
    const moody = [...buildLineup(l, team).knocks];
    qb.morale = cb.morale = { level: 0, jolts: [] };
    expect(moody).toEqual([...buildLineup(l, team).knocks]);
  });

  it('passes the kickoff mean to every lineup it builds, the rebuild after an injury too', () => {
    const { l } = setup();
    let rebuilt = 0;
    for (const g of l.games.filter((x) => x.week <= 3)) {
      calls.length = 0;
      const mean = moraleMean(l);
      simulateGame(l, g);
      expect(calls.length).toBeGreaterThanOrEqual(2);
      for (const m of calls) expect(m).toBe(mean);
      if (calls.length > 2) rebuilt++;
    }
    expect(rebuilt).toBeGreaterThan(0);
  }, 60_000);

  it('plays a game out differently when moods differ, and the same when they do not', () => {
    const play = (lift: boolean) => {
      const { l, team } = setup();
      if (lift)
        for (const pos of Object.keys(team.depthChart) as (keyof typeof team.depthChart)[])
          for (const id of team.depthChart[pos].slice(0, 2)) l.players[id].morale = { level: 10, jolts: [] };
      const g = l.games.find((x) => x.homeId === team.id || x.awayId === team.id)!;
      return JSON.stringify(simulateGame(l as League, g).playerStats);
    };
    expect(play(true)).not.toBe(play(false));
    expect(play(true)).toBe(play(true));
  }, 60_000);
});

const { learnRate } = await import('./training');
const { demand } = await import('./offseason/negotiation');
const { minSalary, leagueMarket } = await import('./finance/market');
type Player = import('./types').Player;

describe('practice (G2)', () => {
  it('learns a new position up to 15% faster happy, slower unhappy', () => {
    const { l, team } = setup();
    const p = l.players[team.depthChart.S[0]];
    const at = (level: number) => ((p.morale = { level, jolts: [] }), learnRate(l, p, 'CB'));
    expect(at(0)).toBeGreaterThan(0.4);
    expect(at(0)).toBeLessThan(1.7);
    expect(at(10) / at(0)).toBeCloseTo(1.15, 9);
    expect(at(-10) / at(0)).toBeCloseTo(0.85, 9);
  });
});

describe('contract talks (G2)', () => {
  /** A starter on your team whose market is well above the minimum. */
  const pick = (l: League) =>
    Object.values(l.players)
      .filter((p) => p.teamId === l.userTeamId && p.contract)
      .sort((a, b) => b.contract!.apy - a.contract!.apy)[0];
  const ask = (l: League, p: Player, level: number, teamId = p.teamId!) => {
    p.morale = { level, jolts: [] };
    return demand(l, p, teamId);
  };

  it('an unhappy man asks his own club up to 10% more, and walks away higher', () => {
    const { l } = setup();
    const p = pick(l);
    const base = ask(l, p, 0);
    const sour = ask(l, p, -10);
    expect(base.walkAway).toBeGreaterThan(minSalary(p.experience, leagueMarket(l).cap) * 2);
    expect(sour.askApy / base.askApy).toBeCloseTo(1.1, 2);
    expect(sour.walkAway / base.walkAway).toBeCloseTo(1.1, 9);
  });

  it('a happy one asks up to 5% less', () => {
    const { l } = setup();
    const p = pick(l);
    expect(ask(l, p, 10).askApy / ask(l, p, 0).askApy).toBeCloseTo(0.95, 2);
  });

  it('gives a round of patience more past Very good, one less past Very poor, never under one', () => {
    const { l } = setup();
    const p = pick(l);
    const base = ask(l, p, 0).patience;
    expect(ask(l, p, 4).patience).toBe(base + 1);
    expect(ask(l, p, -4).patience).toBe(Math.max(1, base - 1));
    expect(ask(l, p, 2).patience).toBe(base);
    p.personality.patience = 0;
    expect(ask(l, p, -10).patience).toBe(1);
  });

  it('another club and a free agent ask the same whatever his mood', () => {
    const { l } = setup();
    const p = pick(l);
    const other = (p.teamId! + 3) % 32;
    expect(ask(l, p, -10, other)).toEqual(ask(l, p, 0, other));
    p.teamId = null;
    expect(ask(l, p, -10, l.userTeamId)).toEqual(ask(l, p, 0, l.userTeamId));
  });
});

const { MOOD_ACTS } = await import('./disputeRead');
const { activeLearning, bodyAs, learnBlock, moveProblem, startMove } = await import('./training');
const { beginYear, developBlock, MOOD_TILT, playedShare, RELEASE, rollInputs } = await import('./development');
const { coachingFor } = await import('./coaching');
const { Rng } = await import('./rng');
const { teamPlayers } = await import('./roster');
const { playerOvr } = await import('./positions');

describe('disputes (G4)', () => {
  const copy = (l: League): League => JSON.parse(JSON.stringify(l));
  /** He's holding in over his deal: at camp, not practicing, until week 1. */
  const holdIn = (l: League, p: Player) => {
    p.morale = {
      ...(p.morale ?? { level: 0, jolts: [] }),
      dispute: { kind: 'holdIn', cause: 'deal', since: l.moraleAt!, club: p.teamId! },
    };
  };

  it('banks no position learning for a man holding in at the program or camp', () => {
    const l = createLeague({ seed: 'dispute-costs' });
    l.phase = 'draft';
    const p = teamPlayers(l, l.userTeamId)
      .filter((x) => x.position === 'CB' && !moveProblem(l, x, 'S'))
      .sort((a, b) => playerOvr(b) - playerOvr(a))[0];
    startMove(l, p.id, 'S');
    const banked = (hold: boolean, acts = true) => {
      const x = copy(l);
      if (hold) holdIn(x, x.players[p.id]);
      MOOD_ACTS.on = acts;
      try {
        learnBlock(x, 'program');
        learnBlock(x, 'camp');
      } finally {
        MOOD_ACTS.on = true;
      }
      return activeLearning(x.players[p.id])!.done;
    };
    expect(banked(false)).toBeGreaterThan(0);
    expect(banked(true)).toBe(0);
    expect(banked(true, false)).toBe(banked(false));
  });

  it("tilts a man holding in's growth at the program and camp as a pull of −1 does", () => {
    const was = MOOD_TILT.growth;
    MOOD_TILT.growth = 0.1;
    try {
      const l = createLeague({ seed: 'dispute-costs' });
      // The spring program and camp run in the offseason (a hold-in practices from week 1).
      l.phase = 'draft';
      for (const x of Object.values(l.players)) x.morale = { level: 0, jolts: [] };
      const p = Object.values(l.players).find(
        (x) => x.teamId !== null && x.age <= 23 && x.potential > playerOvr(x) + 1,
      )!;
      const ctx = rollInputs({
        playedShare: playedShare(p, l.season),
        ...coachingFor(l, p.teamId, p.position),
        bodyAs: bodyAs(p),
      });
      beginYear(l, new Rng(`${l.seed}:dev:${l.season}:${p.id}`), p, ctx);
      expect(p.dev?.potential).toBeDefined();
      const tilt = (set: (x: League) => void, acts = true) => {
        const x = copy(l);
        set(x);
        MOOD_ACTS.on = acts;
        try {
          developBlock(x, 'program');
          developBlock(x, 'camp');
        } finally {
          MOOD_ACTS.on = true;
        }
        return x.players[p.id].dev!.mood ?? 0;
      };
      // A pull of −1 at the program and camp: the share of the year's tilt those two steps carry, all of it down.
      const full = RELEASE.program + RELEASE.camp + RELEASE.season;
      const atMinusOne = (-MOOD_TILT.growth * (RELEASE.program + RELEASE.camp)) / full;
      expect(tilt((x) => holdIn(x, x.players[p.id]))).toBeCloseTo(atMinusOne, 9);
      // With moods not acting he's the Okay man he is.
      expect(tilt((x) => holdIn(x, x.players[p.id]), false)).toBeCloseTo(
        tilt(() => {}),
        9,
      );
    } finally {
      MOOD_TILT.growth = was;
    }
  });

  it('plays a man back from a holdout a point down his first week and half the next, on top of his mood', () => {
    const { l, team, qb } = setup();
    const mean = moraleMean(l);
    const knock = () => buildLineup(l, team, new Set(), undefined, mean).knocks.get(qb.id) ?? 0;
    const plain = knock();
    qb.morale!.rust = { season: l.season, week: l.week };
    expect(knock()).toBeCloseTo(plain + 1, 9);
    l.week++;
    expect(knock()).toBeCloseTo(plain + 0.5, 9);
    l.week++;
    expect(knock()).toBeCloseTo(plain, 9);
    l.week -= 2;
    MOOD_ACTS.on = false;
    try {
      expect(knock()).toBeCloseTo(plain, 9);
    } finally {
      MOOD_ACTS.on = true;
    }
  });
});
