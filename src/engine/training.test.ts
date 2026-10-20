import { describe, expect, it } from 'vitest';
import { skill, useKnocks } from './attributes';
import { CONVERSIONS, conversionOf, knockFor, knockWord, OUT_OF_POSITION_KNOCK, slotOvr, targetsFor } from './familiarity';
import { releasePlayer } from './finance/cap';
import { createLeague, SAVE_VERSION } from './generate';
import { buildLineup } from './match/lineup';
import { migrateLeague } from './migrate';
import { overall, playerOvr } from './positions';
import { placeAt, slotOf, syncDepthChart, teamPlayers } from './roster';
import { playerTradeBlocker } from './trade/rules';
import {
  activeLearning,
  completeMoves,
  conversionRead,
  familiarity,
  holdReason,
  isReady,
  moveProblem,
  MOTIVE_BAR,
  motiveWeight,
  planMoves,
  rebasedPotential,
  setCoachesDecide,
  startMove,
  stopMove,
  suggestMove,
  trainingWeek,
} from './training';
import type { League, Player, Position } from './types';

const copy = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

/** A fresh league moved to the draft: plans can start, and nothing has been simulated. */
const base = createLeague({ seed: 'training' });
base.phase = 'draft';
const fresh = (): League => copy(base);

/** The user's best-rated player at a position who can start a move to `to`. */
function moverAt(league: League, from: Position, to: Position): Player {
  const p = teamPlayers(league, league.userTeamId)
    .filter((x) => x.position === from && !moveProblem(league, x, to))
    .sort((a, b) => playerOvr(b) - playerOvr(a))[0];
  if (!p) throw new Error(`No ${from} who can learn ${to}`);
  return p;
}

describe('conversions', () => {
  it('are directed pairs with a clock and an age window, and nothing else is taught', () => {
    for (const c of CONVERSIONS) {
      expect(c.from).not.toBe(c.to);
      expect(c.weeks).toBeGreaterThan(0);
      expect(c.ages[0]).toBeLessThanOrEqual(c.ages[1]);
      expect(conversionOf(c.from, c.to)).toBe(c);
    }
    expect(conversionOf('QB', 'WR')).toBeUndefined();
    expect(targetsFor({ position: 'EDGE' }).sort()).toEqual(['DT', 'LB']);
    expect(targetsFor({ position: 'QB' })).toEqual([]);
  });
});

describe('starting a plan', () => {
  it('only in the offseason, for a pair the coaches teach, at an age that suits it', () => {
    const l = fresh();
    const p = moverAt(l, 'CB', 'S');
    expect(moveProblem(l, p, 'S')).toBeNull();
    expect(moveProblem(l, p, 'LB')).toContain("won't teach");
    const inSeason = copy(l);
    inSeason.phase = 'regular';
    expect(moveProblem(inSeason, inSeason.players[p.id], 'S')).toBe('Position moves start in the offseason.');
    const old = copy(l);
    const q = moverAt(old, 'S', 'CB');
    old.players[q.id].age = 30;
    expect(moveProblem(old, old.players[q.id], 'CB')).toContain('Too old');
  });

  it('two at a time for you, and a third waits', () => {
    const l = fresh();
    const cbs = teamPlayers(l, l.userTeamId).filter((x) => x.position === 'CB' && !moveProblem(l, x, 'S'));
    startMove(l, cbs[0].id, 'S');
    startMove(l, cbs[1].id, 'S');
    expect(moveProblem(l, cbs[2], 'S')).toContain('Already teaching 2');
    expect(() => startMove(l, cbs[2].id, 'S')).toThrow();
    stopMove(l, cbs[0].id);
    expect(moveProblem(l, cbs[2], 'S')).toBeNull();
  });

  it('ends with a trade or release, and a recent mover waits out the cooldown', () => {
    const l = fresh();
    const p = moverAt(l, 'CB', 'S');
    startMove(l, p.id, 'S');
    expect(activeLearning(l.players[p.id])).toBeDefined();
    const traded = copy(l);
    traded.players[p.id].teamId = (l.userTeamId + 1) % l.teams.length;
    expect(activeLearning(traded.players[p.id])).toBeUndefined();
    const moved = copy(l);
    moved.players[p.id].moves = [{ season: l.season - 1, from: 'S', to: 'CB' }];
    delete moved.players[p.id].learning;
    expect(moveProblem(moved, moved.players[p.id], 'S')).toBe('Changed position too recently.');
  });
});

describe('the learning clock', () => {
  it('banks practice weeks in season, climbs the familiarity ladder, and is ready at the move’s weeks', () => {
    const l = fresh();
    const p = moverAt(l, 'CB', 'S');
    startMove(l, p.id, 'S');
    expect(familiarity(l.players[p.id])).toBe('Awkward');
    l.phase = 'regular';
    for (let i = 0; i < 10; i++) trainingWeek(l);
    expect(l.players[p.id].learning!.done).toBeGreaterThan(0);
    l.players[p.id].learning!.done = conversionOf('CB', 'S')!.weeks;
    expect(familiarity(l.players[p.id])).toBe('Ready');
    expect(isReady(l.players[p.id])).toBe(true);
  });
});

describe('cut-down day', () => {
  it('moves a ready learner: new label, history, depth chart, ceiling never raised, trade lock', () => {
    const l = fresh();
    l.teams[l.userTeamId].autoDepth = false;
    const p = moverAt(l, 'CB', 'S');
    const potential = p.potential;
    startMove(l, p.id, 'S', 'hole');
    l.players[p.id].learning!.done = 99;
    completeMoves(l);
    const after = l.players[p.id];
    expect(after.position).toBe('S');
    expect(after.moves).toEqual([{ season: l.season, from: 'CB', to: 'S' }]);
    expect(after.learning).toBeUndefined();
    expect(after.potential).toBeLessThanOrEqual(Math.max(potential, overall(after.ratings, 'S')));
    const chart = l.teams[l.userTeamId].depthChart;
    expect(chart.S).toContain(p.id);
    expect(chart.CB).not.toContain(p.id);
    expect(playerTradeBlocker(l, after)).toContain('Just changed position');
    expect(l.transactions.at(-1)!.text).toContain(`moved CB ${p.firstName} ${p.lastName} to S: they were short at S`);
  });

  it("waits rather than leave his old room short", () => {
    const l = fresh();
    const p = moverAt(l, 'CB', 'S');
    for (const x of teamPlayers(l, l.userTeamId)) if (x.position === 'CB' && x.id !== p.id) x.teamId = null;
    startMove(l, p.id, 'S');
    l.players[p.id].learning!.done = 99;
    expect(holdReason(l, l.players[p.id])).toContain('short at CB');
    completeMoves(l);
    expect(l.players[p.id].position).toBe('CB');
  });

  it('rebases the ceiling: half the label’s cost kept, never above where he was', () => {
    expect(rebasedPotential(16, 12, 10)).toBe(15); // 10 + 4 headroom + half of 2
    expect(rebasedPotential(16, 12, 13)).toBe(16);
    expect(rebasedPotential(12, 12, 14)).toBe(14); // already better there than his old ceiling
    for (let drop = 0; drop < 5; drop += 0.5) expect(rebasedPotential(15, 12, 12 - drop)).toBeLessThanOrEqual(15);
  });
});

describe('out of position', () => {
  it('costs a knock: none at home, half within the room, a quarter at a former spot, fading as he learns', () => {
    const l = fresh();
    const p = copy(moverAt(l, 'CB', 'S'));
    p.traits.versatility = 10.5;
    expect(knockFor(p, 'CB')).toBe(0);
    const away = knockFor(p, 'WR');
    expect(away).toBeCloseTo(OUT_OF_POSITION_KNOCK, 1);
    expect(knockFor(p, 'S')).toBeCloseTo(away / 2, 1);
    p.learning = { to: 'S', done: conversionOf('CB', 'S')!.weeks / 2, pace: 1, since: l.season, teamId: p.teamId! };
    expect(knockFor(p, 'S')).toBeCloseTo(away / 4, 1);
    delete p.learning;
    p.moves = [{ season: l.season - 3, from: 'S', to: 'CB' }];
    expect(knockFor(p, 'S')).toBeCloseTo(away / 8, 1);
    expect(knockWord(0)).toBe('none');
    expect(knockWord(knockFor(p, 'S'))).toBe('small');
    expect(knockWord(away)).toBe('big');
  });

  it('is smaller for a versatile player, larger for a one-position one', () => {
    const p = copy(moverAt(fresh(), 'CB', 'S'));
    p.traits.versatility = 18;
    const loose = knockFor(p, 'WR');
    p.traits.versatility = 3;
    expect(knockFor(p, 'WR')).toBeGreaterThan(loose);
  });

  it('reaches the engine only through the skill overlay while he lines up there', () => {
    const l = fresh();
    const p = l.players[moverAt(l, 'CB', 'S').id];
    const clean = skill(p, 'edgeRush');
    const prev = useKnocks(new Map([[p.id, 2]]));
    try {
      expect(skill(p, 'edgeRush')).toBeCloseTo(clean - 2, 6);
    } finally {
      useKnocks(prev);
    }
    expect(skill(p, 'edgeRush')).toBe(clean);
  });

  it('"Play at" keeps him in the new group through a depth-chart sync, and the lineup uses him there', () => {
    const l = fresh();
    const team = l.teams[l.userTeamId];
    const cb = moverAt(l, 'CB', 'S');
    placeAt(l, cb.id, 'WR', 0);
    expect(team.autoDepth).toBe(false);
    expect(slotOf(l, l.players[cb.id])).toBe('WR');
    syncDepthChart(l, team);
    expect(team.depthChart.WR[0]).toBe(cb.id);
    expect(team.depthChart.CB).not.toContain(cb.id);
    const lineup = buildLineup(l, team);
    expect(lineup.wrs.map((x) => x.id)).toContain(cb.id);
    expect(lineup.knocks?.get(cb.id)).toBeGreaterThan(0);
    expect(slotOvr(l.players[cb.id], 'WR')).toBeLessThan(overall(cb.ratings, 'WR'));
    // A release takes him off every group.
    releasePlayer(l, l.players[cb.id]);
    for (const ids of Object.values(team.depthChart)) expect(ids).not.toContain(cb.id);
  });
});

describe('reasons', () => {
  it("a team's suggestion is worth it, for a reason its front office acts on", () => {
    const l = fresh();
    let found = 0;
    for (const team of l.teams) {
      const s = suggestMove(l, team.id);
      if (!s) continue;
      found++;
      expect(s.read.verdict).toBe('worth');
      expect(s.read.reason).not.toBeNull();
      const keen = Math.max(...s.read.motives.map((m) => m.strength * motiveWeight(l, team, m, s.read)));
      expect(keen).toBeGreaterThanOrEqual(MOTIVE_BAR);
    }
    expect(found).toBeGreaterThan(0);
  });

  it('a move with no reason is never worth it', () => {
    const l = fresh();
    for (const p of teamPlayers(l, l.userTeamId))
      for (const to of targetsFor(p)) {
        const read = conversionRead(l, p, to);
        if (!read.reason) expect(read.verdict).not.toBe('worth');
      }
  });

  it('AI coaches start their own plan; yours only when you let them', () => {
    const l = fresh();
    planMoves(l);
    const started = (league: League, teamId: number) => teamPlayers(league, teamId).filter((p) => activeLearning(p));
    expect(started(l, l.userTeamId)).toHaveLength(0);
    for (const team of l.teams) expect(started(l, team.id).length).toBeLessThanOrEqual(1);
    for (const p of Object.values(l.players)) if (activeLearning(p)) expect(p.learning!.why).toBeDefined();
    const mine = fresh();
    setCoachesDecide(mine, true);
    planMoves(mine);
    expect(started(mine, mine.userTeamId).length).toBe(suggestMove(fresh(), fresh().userTeamId) ? 1 : 0);
  });
});

describe('saves', () => {
  it('give older players a Versatility trait on load', () => {
    const l = fresh();
    l.version = 29;
    for (const p of Object.values(l.players)) delete (p.traits as Partial<Player['traits']>).versatility;
    const up = migrateLeague(l)!;
    expect(up.version).toBe(SAVE_VERSION);
    for (const p of Object.values(up.players)) expect(p.traits.versatility).toBeGreaterThanOrEqual(1);
  });
});
