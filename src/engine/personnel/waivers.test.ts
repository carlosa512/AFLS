import { beforeEach, describe, expect, it } from 'vitest';
import { capSheet, capSpace, releasePlayer } from '../finance/cap';
import { createLeague, SAVE_VERSION } from '../generate';
import { playGame, playWeek, startLiveGame } from '../league';
import { migrateLeague } from '../migrate';
import { advanceOffseason } from '../offseason';
import { freeAgents, makeOffer, offerProblem, signPlayer } from '../offseason/negotiation';
import { availableProspects } from '../offseason/draft';
import { activeRoster, isAvailable, rosterList } from '../roster';
import { playerTradeBlocker } from '../trade/rules';
import type { Contract, GameResult, League, Player } from '../types';
import { submitAIClaims } from './ai';
import { gameTime, personnelClock } from './calendar';
import { settleOffseasonWaivers, settleWaivers, settleWeek } from './flow';
import { TRADE_DEADLINE_WEEK } from '../trade/rules';
import { initialService } from './service';
import {
  assignedContract,
  claimProblem,
  ensureWaivers,
  originalWaiverOrder,
  reorderWaiverClaims,
  resolveWaiverBatch,
  setWaiverClaim,
  waiverApplies,
  waiverOrder,
} from './waivers';

const template = createLeague({ seed: 'waiver-foundation' });
const copy = <T>(x: T): T => JSON.parse(JSON.stringify(x));
let l: League;
beforeEach(() => {
  l = copy(template);
  l.personnel!.enabled = true;
  ensureWaivers(l).originalOrder.teams = l.teams.map((t) => t.id);
});
const contract = (): Contract => ({
  kind: 'rookie',
  signedSeason: 2026,
  signedWeek: -1,
  apy: 1500,
  length: 2,
  years: [
    { season: 2026, base: 1000, guaranteed: 800 },
    { season: 2027, base: 1100, guaranteed: 600 },
  ],
  bonuses: [{ amount: 1200, start: 2026, years: 3, source: 'signing' }],
});
function player(team = 3): Player {
  const p = activeRoster(l, team)
    .filter((p) => p.position === 'WR')
    .at(-1)!;
  p.contract = contract();
  p.service = initialService(0, 2025);
  return p;
}
function room(team: number) {
  const p = activeRoster(l, team)
    .filter((p) => p.position === 'WR')
    .at(-1)!;
  p.teamId = null;
  p.contract = null;
}
function waive(p = player()) {
  releasePlayer(l, p);
  return l.personnel!.waivers!.pending.find((e) => e.playerId === p.id)!;
}
function claim(entryId: number, teamId = 1, cutIds: number[] = [], preference = 0) {
  return { entryId, teamId, cutIds, preference };
}

describe('preserved contracts and financial settlement', () => {
  it('opens a roster spot without destroying the contract or exposing a free agent', () => {
    const p = player();
    const original = copy(p.contract);
    const e = waive(p);
    expect(p.contract).toEqual(original);
    expect(e.contract).toEqual(original);
    expect(p.teamId).toBeNull();
    expect(rosterList(p)).toBe('waivers');
    expect(activeRoster(l, 3)).toHaveLength(52);
    expect(isAvailable(p)).toBe(false);
    expect(freeAgents(l)).not.toContain(p);
    expect(playerTradeBlocker(l, p)).toMatch(/waivers/);
    const offer = { years: 1, apy: 1500, bonusPct: 0, gtdPct: 0, voidYears: 0 };
    expect(offerProblem(l, p, 1, offer)).toMatch(/clear waivers/);
    const before = copy(l);
    expect(() => signPlayer(l, p, 1, offer)).toThrow(/waivers/);
    expect(makeOffer(l, p, 1, offer).accepted).toBe(false);
    expect(() => releasePlayer(l, p)).toThrow(/waivers/);
    expect(l).toEqual(before);
    l.draftClass.push(p.id);
    expect(availableProspects(l)).not.toContain(p);
  });

  it('holds the worst-case release liability until unclaimed clearance, then books it once', () => {
    const p = player();
    const e = waive(p);
    const before = capSheet(l, 3);
    expect(before.dead).toBeGreaterThanOrEqual(e.release.thisYear);
    const next = capSheet(l, 3, 2027).used;
    resolveWaiverBatch(l, e.batch);
    expect(p.contract).toBeNull();
    expect(p.waiver).toBeUndefined();
    expect(freeAgents(l)).toContain(p);
    expect(capSheet(l, 3).used).toBeCloseTo(before.used, 0);
    expect(capSheet(l, 3, 2027).used).toBeCloseTo(next, 0);
    const settled = copy(l);
    expect(resolveWaiverBatch(l, e.batch)).toEqual([]);
    expect(l).toEqual(settled);
  });

  it('transfers salary and guarantees, leaving original bonus charges with the old club', () => {
    const p = player();
    const e = waive(p);
    room(1);
    const held = capSheet(l, 3).used;
    const receiver = capSheet(l, 1).used;
    setWaiverClaim(l, claim(e.id));
    resolveWaiverBatch(l, e.batch);
    expect(p.teamId).toBe(1);
    expect(p.contract!.bonuses).toEqual([]);
    expect(p.contract!.years).toEqual(
      e.contract.years.map((y) => ({ ...y, ...(y.season === 2026 ? { paidBefore: 0 } : {}) })),
    );
    expect(p.contract!.kind).toBe('rookie');
    expect(capSheet(l, 1).used - receiver).toBe(1000);
    expect(held - capSheet(l, 3).used).toBeCloseTo(e.release.thisYear - e.assigned.thisYear, 0);
    expect(l.teams[3].deadMoney.filter((d) => d.playerId === p.id).reduce((s, d) => s + d.amount, 0)).toBe(1200);
  });

  it('retains already-paid salary and transfers only the unpaid guaranteed balance in season', () => {
    l.week = 8;
    const p = player();
    const e = waive(p);
    room(1);
    const assigned = assignedContract(e);
    expect(assigned.years[0].base).toBe(Math.round((1000 * 11) / 18));
    expect(assigned.years[0].guaranteed).toBe(Math.round(800 - (1000 * 7) / 18));
    expect(assigned.years[0].paidBefore).toBe(7);
    setWaiverClaim(l, claim(e.id));
    resolveWaiverBatch(l, e.batch);
    expect(p.contract).toEqual(assigned);
    expect(l.teams[3].deadMoney.filter((d) => d.season === 2026 && d.playerId === p.id)[0].amount).toBe(
      Math.round(400 + (1000 * 7) / 18),
    );
  });

  it('keeps the original request snapshot when football time moves', () => {
    const p = player();
    const e = waive(p);
    const c = assignedContract(e);
    l.week = 2;
    expect(assignedContract(e)).toEqual(c);
    expect(p.contract).toEqual(e.contract);
  });

  it('keeps the ordinary release path when the feature is disabled', () => {
    l.personnel!.enabled = false;
    const p = player();
    releasePlayer(l, p);
    expect(p.contract).toBeNull();
    expect(p.waiver).toBeUndefined();
    expect(l.personnel!.waivers!.pending).toEqual([]);
  });
});

describe('veteran eligibility, league priority and preferences', () => {
  it('uses completed pension seasons rather than the calendar experience or current year', () => {
    const p = player();
    p.experience = 15;
    expect(waiverApplies(l, p)).toBe(true);
    p.service = initialService(4, 2025);
    expect(waiverApplies(l, p)).toBe(false);
    p.service = initialService(3, 2025);
    p.service[2] = 63; // six games this season do not vest the exception early
    expect(waiverApplies(l, p)).toBe(true);
    l.week = TRADE_DEADLINE_WEEK;
    p.service = initialService(4, 2025);
    expect(waiverApplies(l, p)).toBe(false);
    l.week = TRADE_DEADLINE_WEEK + 1; // releases after the trade deadline week always use waivers
    expect(waiverApplies(l, p)).toBe(true);
  });

  it('honors original draft order independently of traded pick ownership', () => {
    l.draftPicks = l.teams.map((t, i) => ({
      id: i,
      season: 2026,
      round: 1,
      overall: 32 - i,
      originalTeamId: t.id,
      ownerId: 0,
    }));
    delete l.personnel!.waivers;
    const order = [...ensureWaivers(l).originalOrder.teams];
    expect(order).toEqual(l.teams.map((t) => t.id).reverse());
    l.draftPicks.reverse();
    for (const p of l.draftPicks) p.ownerId = 8;
    expect(waiverOrder(l)).toEqual(order);
  });

  it('has a stable opening order without inventing prior results', () => {
    l.draftPicks = [];
    expect(originalWaiverOrder(l)).toEqual(originalWaiverOrder(copy(l)));
    expect(new Set(originalWaiverOrder(l)).size).toBe(32);
    expect(l.history).toEqual([]);
  });

  it('uses record then strength of schedule after week 3, not playoff tiebreakers', () => {
    l.games = [];
    const game = (homeId: number, awayId: number, win: boolean) =>
      l.games.push({
        id: l.games.length,
        season: 2026,
        week: 1,
        homeId,
        awayId,
        result: { homeScore: win ? 20 : 10, awayScore: win ? 10 : 20 } as GameResult,
      });
    game(0, 2, false);
    game(0, 3, true);
    game(1, 4, true);
    game(1, 5, false);
    game(2, 6, true);
    game(3, 6, false);
    game(4, 7, false);
    game(5, 7, false);
    l.week = 3;
    expect(waiverOrder(l).indexOf(0)).toBeLessThan(waiverOrder(l).indexOf(1));
    l.week = 4;
    expect(waiverOrder(l).indexOf(1)).toBeLessThan(waiverOrder(l).indexOf(0));
  });

  it('awards competing claims by frozen league priority and does not rotate a winner down', () => {
    const a = waive();
    const b = waive(player(4));
    room(1);
    room(1);
    room(2);
    room(2);
    for (const e of [a, b]) {
      setWaiverClaim(l, claim(e.id, 2));
      setWaiverClaim(l, claim(e.id, 1));
    }
    const reverse = copy(l);
    reverse.personnel!.waivers!.claims.reverse();
    reverse.personnel!.waivers!.pending.reverse();
    const original = waiverOrder(l);
    const results = resolveWaiverBatch(l, a.batch);
    expect(results.map((r) => r.toTeamId)).toEqual([1, 1]);
    expect(resolveWaiverBatch(reverse, a.batch)).toEqual(results);
    expect(waiverOrder(l)).toEqual(original);
  });

  it('uses claim preferences and alternative groups with one roster spot', () => {
    const a = waive();
    const b = waive(player(4));
    room(1);
    setWaiverClaim(l, { ...claim(a.id, 1, [], 0), group: 'receiver' });
    setWaiverClaim(l, { ...claim(b.id, 1, [], 1), group: 'receiver' });
    const before = copy(l);
    expect(() => reorderWaiverClaims(l, 1, [b.id])).toThrow();
    expect(l).toEqual(before);
    reorderWaiverClaims(l, 1, [b.id, a.id]);
    resolveWaiverBatch(l, a.batch);
    expect(l.players[b.playerId].teamId).toBe(1);
    expect(l.players[a.playerId].teamId).toBeNull();
  });
});

describe('atomic validation and notice boundaries', () => {
  it('a user claim with two cuts is rejected and changes nothing', () => {
    const e = waive();
    const [x, y] = activeRoster(l, l.userTeamId).filter((p) => p.position === 'WR');
    const before = copy(l);
    expect(() => setWaiverClaim(l, claim(e.id, l.userTeamId, [x.id, y.id]))).toThrow(/at most one/);
    expect(() => setWaiverClaim(l, { ...claim(e.id, l.userTeamId, [x.id]), group: 'two-ways' })).toThrow(
      /groups are not available/,
    );
    expect(l).toEqual(before);
  });

  it('a user claim with one cut and a squad invite still works', () => {
    const e = waive();
    const cut = activeRoster(l, l.userTeamId)
      .filter((p) => p.position === 'WR')
      .at(-1)!;
    const plan = { ...claim(e.id, l.userTeamId, [cut.id]), squadReturnIds: [cut.id] };
    const issue = claimProblem(l, plan);
    expect(issue === null || !/at most one|groups/.test(issue)).toBe(true);
  });

  it('rejects a full-roster claim without changing any state', () => {
    const e = waive();
    const before = copy(l);
    expect(claimProblem(l, claim(e.id))).toMatch(/roster move/);
    expect(() => setWaiverClaim(l, claim(e.id))).toThrow();
    expect(l).toEqual(before);
  });

  it('checks future cap commitments as well as this year', () => {
    const p = player();
    p.contract!.years[1].base = 500_000;
    const e = waive(p);
    room(1);
    const before = copy(l);
    expect(claimProblem(l, claim(e.id))).toMatch(/2027 cap/);
    expect(() => setWaiverClaim(l, claim(e.id))).toThrow();
    expect(l).toEqual(before);
  });

  it('a successful conditional cut enters a later batch and remains unavailable', () => {
    const e = waive();
    const cut = player(1);
    cut.contract!.bonuses = [];
    cut.contract!.years.forEach((y) => (y.guaranteed = 0));
    setWaiverClaim(l, claim(e.id, 1, [cut.id]));
    resolveWaiverBatch(l, e.batch);
    const follow = l.personnel!.waivers!.pending.find((x) => x.playerId === cut.id)!;
    expect(follow.batch).toBeGreaterThan(e.batch);
    expect(cut.contract).not.toBeNull();
    expect(freeAgents(l)).not.toContain(cut);
    expect(l.players[e.playerId].teamId).toBe(1);
    expect(activeRoster(l, 1)).toHaveLength(53);
  });

  it('does not cut a player when another club wins the claim', () => {
    const e = waive();
    const cut = player(2);
    room(1);
    setWaiverClaim(l, claim(e.id, 2, [cut.id]));
    setWaiverClaim(l, claim(e.id, 1));
    const c = copy(cut.contract);
    resolveWaiverBatch(l, e.batch);
    expect(cut.teamId).toBe(2);
    expect(cut.contract).toEqual(c);
  });

  it('revalidates a conditional release that left the club before the notice', () => {
    const e = waive();
    const cut = player(1);
    cut.contract!.bonuses = [];
    cut.contract!.years.forEach((y) => (y.guaranteed = 0));
    setWaiverClaim(l, claim(e.id, 1, [cut.id]));
    cut.teamId = 2;
    resolveWaiverBatch(l, e.batch);
    expect(l.players[e.playerId].teamId).toBeNull();
    expect(cut.teamId).toBe(2);
  });

  it('cannot overspend after an earlier award, including the AI reserve floor', () => {
    const a = waive();
    const b = waive(player(4));
    room(1);
    room(1);
    const budget = 1300;
    l.teams[1].carryover += budget - capSpace(l, 1);
    setWaiverClaim(l, claim(a.id, 1, [], 0));
    setWaiverClaim(l, claim(b.id, 1, [], 1));
    resolveWaiverBatch(l, a.batch);
    expect([l.players[a.playerId].teamId, l.players[b.playerId].teamId]).toEqual([1, null]);
    expect(capSpace(l, 1)).toBeGreaterThanOrEqual(0);
  });

  it('survives JSON reload mid-claim and settles exactly once', () => {
    const e = waive();
    room(1);
    setWaiverClaim(l, claim(e.id));
    const loaded = migrateLeague(copy(l))!;
    expect(loaded.version).toBe(SAVE_VERSION);
    expect(resolveWaiverBatch(loaded, e.batch)).toEqual(resolveWaiverBatch(l, e.batch));
    expect(loaded).toEqual(l);
  });

  it('queries and invalid edits do not mutate the league', () => {
    const e = waive();
    const before = copy(l);
    waiverOrder(l);
    claimProblem(l, claim(e.id));
    assignedContract(e);
    expect(l).toEqual(before);
    resolveWaiverBatch(l, e.batch);
    const settled = copy(l);
    expect(() => setWaiverClaim(l, claim(e.id))).toThrow(/settled/);
    expect(l).toEqual(settled);
  });
});

describe('AI and calendar integration', () => {
  it('AI submits legal scouted upgrades, keeps the user manual, and preserves its budget', () => {
    const p = player();
    for (const key of Object.keys(p.ratings) as (keyof Player['ratings'])[]) p.ratings[key] = 19;
    p.age = 23;
    const e = waive(p);
    submitAIClaims(l, e.batch);
    const claims = l.personnel!.waivers!.claims;
    expect(claims.length).toBeGreaterThan(0);
    expect(claims.some((c) => c.teamId === l.userTeamId)).toBe(false);
    for (const c of claims) {
      expect(claimProblem(l, c)).toBeNull();
      expect(c.cutIds).toHaveLength(1);
      expect(c.minCapSpace).toBeGreaterThan(0);
    }
    const again = copy(l);
    submitAIClaims(again, e.batch);
    expect(again.personnel!.waivers!.claims).toEqual(claims);
    settleWaivers(l);
    const winner = p.teamId!;
    expect(winner).not.toBeNull();
    expect(activeRoster(l, winner)).toHaveLength(53);
    expect(capSpace(l, winner)).toBeGreaterThanOrEqual(claims.find((c) => c.teamId === winner)!.minCapSpace!);
  });

  it('rejects an overpriced waiver even when the player looks excellent', () => {
    const p = player();
    for (const key of Object.keys(p.ratings) as (keyof Player['ratings'])[]) p.ratings[key] = 20;
    p.contract!.years[0].base = 250_000;
    const e = waive(p);
    submitAIClaims(l, e.batch);
    expect(l.personnel!.waivers!.claims).toEqual([]);
  });

  it('limits automatic additions per window without restricting manual claims', () => {
    const entries = [waive(player(3)), waive(player(4)), waive(player(5))];
    room(1);
    room(1);
    room(1);
    entries.forEach((e, preference) => setWaiverClaim(l, { ...claim(e.id, 1, [], preference), automatic: true }));
    const manual = copy(l);
    manual.personnel!.waivers!.claims.forEach((c) => delete c.automatic);
    expect(resolveWaiverBatch(l, entries[0].batch).filter((r) => r.toTeamId === 1)).toHaveLength(2);
    expect(resolveWaiverBatch(manual, entries[0].batch).filter((r) => r.toTeamId === 1)).toHaveLength(3);
  });

  it('AI cannot detect true potential through its claim selection', () => {
    const p = player();
    const e = waive(p);
    const a = copy(l);
    const b = copy(l);
    a.players[p.id].potential = 1;
    b.players[p.id].potential = 20;
    // Fix observable scouting inputs through identical perceived ranges: the claim test compares current-grade-only vets.
    a.players[p.id].age = 30;
    b.players[p.id].age = 30;
    submitAIClaims(a, e.batch);
    submitAIClaims(b, e.batch);
    expect(a.personnel!.waivers!.claims).toEqual(b.personnel!.waivers!.claims);
  });

  it("a release before kickoff resolves before that week's first game", () => {
    const p = player();
    const e = waive(p);
    const first = [...l.games].filter((g) => g.week === 1).sort((a, b) => gameTime(a) - gameTime(b))[0];
    startLiveGame(l, first);
    expect(l.personnel!.waivers!.pending.some((x) => x.id === e.id)).toBe(false);
    expect(l.personnel!.waivers!.results.some((r) => r.entryId === e.id)).toBe(true);
    expect(p.waiver).toBeUndefined();
  });

  it("a release after the week's first kickoff waits for next week", () => {
    const week = l.games.filter((g) => g.week === 1).sort((a, b) => gameTime(a) - gameTime(b));
    playGame(l, week[0]);
    const later = week.find((g) => !g.result && !g.personnel?.lists)!;
    const e = waive(player(later.homeId));
    playGame(l, later);
    expect(l.personnel!.waivers!.pending.some((x) => x.id === e.id)).toBe(true);
    playWeek(l);
    expect(l.week).toBe(2);
    expect(l.personnel!.waivers!.pending.some((x) => x.id === e.id)).toBe(true);
    const next = l.games.filter((g) => g.week === 2).sort((a, b) => gameTime(a) - gameTime(b))[0];
    playGame(l, next);
    expect(l.personnel!.waivers!.pending.some((x) => x.id === e.id)).toBe(false);
  });

  it('settling twice in a week does nothing, also after a JSON reload', () => {
    const first = waive();
    settleWeek(l);
    expect(l.personnel!.waivers!.pending.some((x) => x.id === first.id)).toBe(false);
    const second = waive(player(5));
    settleWeek(l);
    expect(l.personnel!.waivers!.pending.some((x) => x.id === second.id)).toBe(true);
    const loaded = migrateLeague(copy(l))!;
    settleWeek(loaded);
    expect(loaded.personnel!.waivers!.pending.some((x) => x.id === second.id)).toBe(true);
    expect(loaded).toEqual(l);
  });

  it('a week-18 release settles at the first playoff game, or when the season ends', () => {
    l.week = 18;
    settleWeek(l);
    const e = waive();
    l.phase = 'playoffs';
    l.week = 19;
    settleWeek(l);
    expect(l.personnel!.waivers!.pending.some((x) => x.id === e.id)).toBe(false);
    const late = waive(player(6));
    settleOffseasonWaivers(l); // what beginOffseason runs before the league year turns
    expect(l.personnel!.waivers!.pending.some((x) => x.id === late.id)).toBe(false);
  });

  it('plays earlier games before a Sunday live game', () => {
    const game = l.games.find((g) => g.week === 1 && g.kickoff?.day === 'sun')!;
    startLiveGame(l, game);
    expect(l.games.filter((g) => g.week === 1 && gameTime(g) < gameTime(game)).every((g) => !!g.result)).toBe(true);
    expect(() => waive(player(game.homeId))).toThrow(/Finish the game/);
  });

  it('does not run camp development twice when pausing for cutdown claims', () => {
    l.phase = 'preseason';
    delete l.personnel!.clock;
    for (const t of l.teams) t.carryover += 5000;
    advanceOffseason(l);
    expect(l.phase).toBe('preseason');
    expect(personnelClock(l).cutdown).toBe(true);
    const ratings = Object.fromEntries(Object.values(l.players).map((p) => [p.id, copy(p.ratings)]));
    advanceOffseason(l);
    expect(l.phase).toBe('regular');
    // Formation can add unattached candidates; only the players present at camp had development to repeat.
    for (const [id, before] of Object.entries(ratings)) expect(l.players[Number(id)].ratings).toEqual(before);
  });

  it('rejects an illegal user cutdown before changing camp or offers', () => {
    l.phase = 'preseason';
    const p = copy(activeRoster(l, 1)[0]);
    p.id = l.nextPlayerId++;
    p.teamId = l.userTeamId;
    l.players[p.id] = p;
    const before = copy(l);
    expect(() => advanceOffseason(l)).toThrow(/Cut down/);
    expect(l).toEqual(before);
  });

  it('the normal continue action resolves follow-on notices without extra daily choices', () => {
    l.phase = 'preseason';
    delete l.personnel!.clock;
    personnelClock(l).cutdown = true;
    const p = player(3);
    for (const key of Object.keys(p.ratings) as (keyof Player['ratings'])[]) p.ratings[key] = 19;
    const e = waive(p);
    const cut = player(l.userTeamId);
    cut.contract!.bonuses = [];
    cut.contract!.years.forEach((y) => (y.guaranteed = 0));
    setWaiverClaim(l, claim(e.id, l.userTeamId, [cut.id]));
    advanceOffseason(l);
    expect(l.phase).toBe('regular');
    expect(p.teamId).toBe(l.userTeamId);
    expect(activeRoster(l, l.userTeamId)).toHaveLength(53);
    expect(l.personnel!.waivers!.pending).toHaveLength(0);
    expect(l.personnel!.waivers!.results.some((r) => r.playerId === cut.id)).toBe(true);
  });

  it('collects no game service for pending waivers across an enabled week', () => {
    const p = player();
    p.contract!.years[0].base = 250_000;
    waive(p);
    playWeek(l);
    expect(p.service![2]).toBe(0);
  });
});

describe('conditional practice squad return plans', () => {
  it('creates a return invitation only after winning, preserves it across reload and uses a later waiver notice', () => {
    l.teams[0].carryover = 100_000;
    const cut = player(0);
    const e = waive();
    setWaiverClaim(l, { ...claim(e.id, 0, [cut.id]), squadReturnIds: [cut.id] });
    expect(l.personnel!.squads!.returns.some((o) => o.playerId === cut.id)).toBe(false);
    const reload = copy(l);
    resolveWaiverBatch(l, e.batch);
    resolveWaiverBatch(reload, e.batch);
    expect(JSON.stringify(copy(l)) === JSON.stringify(copy(reload))).toBe(true);
    expect(l.players[e.playerId].teamId).toBe(0);
    expect(cut.squad).toBeUndefined();
    expect(cut.waiver).toBeDefined();
    expect(l.personnel!.waivers!.pending.find((x) => x.playerId === cut.id)!.batch).toBeGreaterThan(e.batch);
    expect(l.personnel!.squads!.returns.some((o) => o.playerId === cut.id)).toBe(true);
  });
  it('leaves both the roster and return instructions alone when a higher-priority club wins', () => {
    l.userTeamId = 1;
    l.teams[1].carryover = 100_000;
    const cut = player(1);
    const e = waive();
    room(0);
    setWaiverClaim(l, claim(e.id, 0));
    setWaiverClaim(l, { ...claim(e.id, 1, [cut.id]), squadReturnIds: [cut.id] });
    resolveWaiverBatch(l, e.batch);
    expect(cut.teamId).toBe(1);
    expect(cut.waiver).toBeUndefined();
    expect(l.personnel!.squads!.returns.some((o) => o.playerId === cut.id)).toBe(false);
  });
  it('rejects a full squad or a return plan for a player not actually released by the claim', () => {
    l = createLeague({ seed: 'full-return-squad', personnel: true });
    const cut = player(0);
    const e = waive();
    const saved = JSON.stringify(l);
    expect(claimProblem(l, { ...claim(e.id, 0, [cut.id]), squadReturnIds: [cut.id] })).toMatch(/16/);
    expect(claimProblem(l, { ...claim(e.id, 0), squadReturnIds: [cut.id] })).toMatch(/released by this claim/);
    expect(JSON.stringify(l)).toBe(saved);
  });
});
