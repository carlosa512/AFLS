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
