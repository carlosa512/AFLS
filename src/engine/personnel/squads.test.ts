import { beforeEach, describe, expect, it } from 'vitest';
import { createLeague, generatePlayer, SAVE_VERSION } from '../generate';
import { capSheet, capSpace, releasePlayer } from '../finance/cap';
import { capHit } from '../finance/contract';
import { inSeasonReserve, spendable } from '../offseason/ai';
import { contenderScore } from '../offseason/negotiation';
import { irProblem } from '../injuries';
import { migrateLeague } from '../migrate';
import { activeRoster, isAvailable, practiceSquad, syncDepthChart } from '../roster';
import { Rng } from '../rng';
import { rosterOf, tradeContext } from '../trade/context';
import type { League, Player } from '../types';
import { squadCategory, squadFit, squadRates } from './eligibility';
import { ensureSquads, settleSquadPayroll, squadPayroll } from './payroll';
import { archiveService, creditService, initialService } from './service';
import { ensureSquadSupply, formPracticeSquads, resolveSquadOffers, squadCandidates } from './squadMarket';
import {
  acceptSquadOffer,
  inviteSquadReturn,
  promoteSquadPlayer,
  releaseSquadPlayer,
  squadOfferProblem,
  squadPromotionPreview,
  squadReserve,
  submitSquadOffer,
} from './squads';
import { resolveWaiverBatch } from './waivers';

const template = createLeague({ seed: 'squad-contracts' });
let l: League;
beforeEach(() => {
  l = structuredClone(template);
  l.personnel!.enabled = true;
  for (const t of l.teams) t.carryover = 100_000;
});
function candidate(experience = 0): Player {
  const p = generatePlayer(new Rng(`candidate:${l.nextPlayerId}`), {
    id: l.nextPlayerId++,
    position: 'WR',
    age: 22 + experience,
    quality: 8,
    teamId: null,
    jerseysUsed: new Set(),
  });
  p.experience = experience;
  p.service = initialService(experience, l.season - 1);
  p.contract = null;
  l.players[p.id] = p;
  return p;
}
function sign(p = candidate(), teamId = 0, weeklyPay = squadRates(l, p).min) {
  acceptSquadOffer(l, { playerId: p.id, teamId, weeklyPay });
  return p;
}
function open53() {
  const p = activeRoster(l, 0).find((x) => x.position === 'WR')!;
  p.teamId = null;
  p.contract = null;
}

describe('squad eligibility and agreements', () => {
  it('assigns overlapping slots independently of signing order and explains both expanded limits', () => {
    const base = Array.from({ length: 6 }, () => candidate());
    const developmental = Array.from({ length: 4 }, () => candidate(2));
    const veterans = Array.from({ length: 6 }, () => candidate(5));
    const legal = [...base, ...developmental, ...veterans];
    expect(squadFit(l, legal)).toBeNull();
    expect(squadFit(l, legal.reverse())).toBeNull();
    expect(squadFit(l, [...base.slice(1), ...developmental, ...veterans, candidate(2)])).toMatch(/ten expanded/);
    expect(squadFit(l, [...base.slice(1), ...developmental, ...veterans, candidate(6)])).toMatch(/six unrestricted/);
    expect(squadFit(l, [...legal, candidate()])).toMatch(/16/);
  });
  it('uses known actives in the lone accrued season and keeps unknown historical actives conservative', () => {
    const p = candidate();
    p.service = initialService(0, 2024);
    for (let w = 1; w <= 8; w++) creditService(p, 2025, w, 'active', true);
    expect(squadCategory(l, p)).toBe('base');
    archiveService(p.service, 2025);
    expect(squadCategory(l, p)).toBe('base');
    expect(squadCategory(l, candidate(1))).toBe('developmental');
    expect(squadCategory(l, candidate(3))).toBe('veteran');
  });
  it('rejects a ninth known activation for base eligibility', () => {
    const p = candidate();
    p.service = initialService(0, 2024);
    for (let w = 1; w <= 9; w++) creditService(p, 2025, w, 'active', true);
    expect(squadCategory(l, p)).toBe('developmental');
  });
  it('checks pay ranges, finite pay, draft rights, employer and physical before any mutation', () => {
    const p = candidate();
    const offer = { playerId: p.id, teamId: 0, weeklyPay: 14 };
    expect(squadOfferProblem(l, offer)).toMatch(/13.750/);
    expect(squadOfferProblem(l, { ...offer, weeklyPay: NaN })).toMatch(/Weekly pay/);
    l.draftClass.push(p.id);
    expect(squadOfferProblem(l, { ...offer, weeklyPay: 13.75 })).toMatch(/unattached/);
    l.draftClass = [];
    sign(p);
    expect(() => sign(p, 1)).toThrow(/unattached/);
    expect(irProblem(l, p)).toMatch(/Practice squad/);
    expect(isAvailable(p)).toBe(false);
    syncDepthChart(l, l.teams[0]);
    expect(l.teams[0].depthChart.WR).not.toContain(p.id);
    expect(activeRoster(l, 0)).toHaveLength(53);
  });
  it('clears a rookie contract permanently, then signs a separate squad agreement', () => {
    const p = activeRoster(l, 0)
      .filter((p) => p.position === 'WR')
      .at(-1)!;
    p.service = initialService(0, 2025);
    p.contract!.kind = 'rookie';
    const old = structuredClone(p.contract);
    inviteSquadReturn(l, 0, p);
    releasePlayer(l, p);
    expect(() => sign(p)).toThrow(/cleared/);
    const e = l.personnel!.waivers!.pending[0];
    resolveWaiverBatch(l, e.deadline);
    expect(p.contract).toBeNull();
    sign(p);
    expect(p.squad?.agreement?.weeklyPay).toBe(13.75);
    expect(p.contract).not.toEqual(old);
    open53();
    promoteSquadPlayer(l, p);
    expect(p.contract?.kind).toBe('minimum');
    expect(p.contract?.bonuses).toEqual([]);
    expect(p.contract?.length).toBe(1);
  });
});

describe('earned and projected squad payroll', () => {
  it('books the current week immediately, keeps earned money after release and credits a same-week re-sign', () => {
    const before = capSpace(l, 0);
    const p = sign();
    expect(squadPayroll(l, 0)).toEqual({ earned: 13.75, projected: 233.75, total: 247.5 });
    releaseSquadPlayer(l, p);
    expect(before - capSpace(l, 0)).toBeCloseTo(13.75);
    sign(p);
    releaseSquadPlayer(l, p);
    expect(squadPayroll(l, 0).earned).toBe(13.75);
  });
  it('bills skipped weeks once, preserves ledger across JSON reload and never mutates from cap queries', () => {
    const p = sign();
    l.week = 5;
    const json = JSON.stringify(l);
    expect(squadPayroll(l, 0).earned).toBe(68.75);
    capSheet(l, 0);
    squadPromotionPreview(l, p);
    expect(JSON.stringify(l)).toBe(json);
    l = JSON.parse(json);
    settleSquadPayroll(l);
    settleSquadPayroll(l);
    expect(squadPayroll(l, 0)).toEqual({ earned: 68.75, projected: 178.75, total: 247.5 });
    releaseSquadPlayer(l, l.players[p.id]);
    expect(squadPayroll(l, 0).total).toBe(68.75);
  });
  it('charges a new employer separately, and only a pay raise on a veteran same-week re-sign', () => {
    const p = sign(candidate(5));
    releaseSquadPlayer(l, p);
    sign(p, 0, 22.85);
    expect(squadPayroll(l, 0).earned).toBe(22.85);
    releaseSquadPlayer(l, p);
    sign(p, 1);
    expect(squadPayroll(l, 0).total).toBe(22.85);
    expect(squadPayroll(l, 1).earned).toBe(18.35);
  });
  it('previews exactly the net promotion cost, keeps prior weeks and protects this week against an immediate cut', () => {
    const p = sign();
    l.week = 4;
    open53();
    const before = capSpace(l, 0);
    const preview = squadPromotionPreview(l, p);
    expect(preview.problem).toBeNull();
    promoteSquadPlayer(l, p);
    expect(before - capSpace(l, 0)).toBeCloseTo(preview.additionalCap, 5);
    expect(squadPayroll(l, 0).earned).toBe(3 * 13.75);
    const guaranteed = p.contract!.years[0].guaranteed;
    releasePlayer(l, p);
    resolveWaiverBatch(l, l.personnel!.waivers!.pending[0].deadline);
    expect(
      squadPayroll(l, 0).earned +
        l.teams[0].deadMoney.filter((d) => d.playerId === p.id).reduce((s, d) => s + d.amount, 0),
    ).toBeGreaterThanOrEqual(3 * 13.75 + guaranteed);
  });
  it('requires a 53 spot and checks the full cap cost atomically', () => {
    const p = sign();
    expect(squadPromotionPreview(l, p).problem).toMatch(/Make room/);
    const before = JSON.stringify(l);
    expect(() => promoteSquadPlayer(l, p)).toThrow(/Make room/);
    expect(JSON.stringify(l)).toBe(before);
    open53();
    l.teams[0].carryover -= capSpace(l, 0);
    expect(squadPromotionPreview(l, p).problem).toMatch(/cap room/);
  });
  it('never credits the same squad check twice through promotion, waiver clearance and another promotion', () => {
    const p = sign();
    open53();
    for (let repeat = 0; repeat < 2; repeat++) {
      promoteSquadPlayer(l, p);
      expect(squadPayroll(l, 0).earned).toBe(0);
      releasePlayer(l, p);
      resolveWaiverBatch(l, l.personnel!.waivers!.pending[0].deadline);
      sign(p);
    }
    expect(squadPayroll(l, 0).earned).toBe(0);
    l.week++;
    settleSquadPayroll(l);
    expect(squadPayroll(l, 0).earned).toBe(13.75);
  });
  it('includes squad commitments even when the trade cache excludes squad players', () => {
    const p = sign();
    const ctx = tradeContext(l);
    expect(rosterOf(ctx, 0)).not.toContain(p);
    expect(capSheet(l, 0, l.season, rosterOf(ctx, 0))).toEqual(capSheet(l, 0));
    expect(capSheet(l, 0, l.season + 1).practiceSquad).toBeUndefined();
  });
});

describe('simultaneous market and world generation', () => {
  it('supplies base-eligible candidates rather than treating every young expanded-slot player as enough', () => {
    l.teams = l.teams.slice(0, 1);
    for (let i = 0; i < 80; i++) candidate(2);
    ensureSquadSupply(l);
    expect(squadCandidates(l).filter((p) => squadCategory(l, p) === 'base')).toHaveLength(80);
  });
  it('counts long-time squad players by accrued service when replenishing the pool', () => {
    l.teams = l.teams.slice(0, 1);
    for (let i = 0; i < 80; i++) candidate(10).service = initialService(0, l.season - 1);
    const next = l.nextPlayerId;
    ensureSquadSupply(l);
    expect(l.nextPlayerId).toBe(next);
  });
  it('preserves a contingent invitation until its waiver notice actually clears', () => {
    const p = activeRoster(l, 0)
      .filter((p) => p.position === 'WR')
      .at(-1)!;
    p.service = initialService(0, l.season - 1);
    inviteSquadReturn(l, 0, p);
    releasePlayer(l, p);
    formPracticeSquads(l);
    expect(l.personnel!.squads!.returns.some((o) => o.playerId === p.id)).toBe(true);
    expect(p.waiver).toBeDefined();
  });
  it('rebuilds player preference context after waiver changes so a warm cache and a JSON reload agree', () => {
    const p = candidate();
    p.personality.winning = 1;
    contenderScore(l, 1);
    for (const x of activeRoster(l, 1)) x.teamId = null;
    submitSquadOffer(l, { playerId: p.id, teamId: 1, weeklyPay: 13.75 });
    submitSquadOffer(l, { playerId: p.id, teamId: 2, weeklyPay: 13.75 });
    const reload = JSON.parse(JSON.stringify(l));
    resolveSquadOffers(l);
    resolveSquadOffers(reload);
    expect(l.players[p.id].teamId).toBe(reload.players[p.id].teamId);
  });
  it('awards competing bids identically when clubs/offers are submitted in reverse order', () => {
    const p = candidate(5);
    submitSquadOffer(l, { playerId: p.id, teamId: 1, weeklyPay: 18.35 });
    submitSquadOffer(l, { playerId: p.id, teamId: 2, weeklyPay: 22.85 });
    const other = structuredClone(l);
    other.personnel!.squads!.offers.reverse();
    resolveSquadOffers(l);
    resolveSquadOffers(other);
    expect(l.players[p.id].teamId).toBe(2);
    expect(l.personnel!.squads!.results).toEqual(other.personnel!.squads!.results);
  });
  it('does not promise a return when a player prefers a competing offer', () => {
    const p = activeRoster(l, 0)
      .filter((p) => p.position === 'WR')
      .at(-1)!;
    p.service = initialService(5, l.season - 1);
    inviteSquadReturn(l, 0, p);
    releasePlayer(l, p);
    expect(p.waiver).toBeUndefined();
    submitSquadOffer(l, { playerId: p.id, teamId: 1, weeklyPay: 22.85 });
    // Give the player no familiarity discount and a strong preference for the pay difference.
    p.personality.loyalty = 0;
    p.personality.greed = 1;
    formPracticeSquads(l);
    expect(p.teamId).toBe(1);
  });
  it('reserves formation money before offseason spending without replacing the injury reserve', () => {
    l.phase = 'freeAgency';
    const reserve = squadReserve(l, 0);
    expect(reserve).toBe(16 * 18 * 13.75);
    const enabled = spendable(l, 0);
    l.personnel!.enabled = false;
    expect(spendable(l, 0) - enabled).toBeCloseTo(reserve);
    expect(inSeasonReserve(l, 0)).toBeGreaterThan(0);
  });
  it('creates legal affordable squads while preserving every existing 53 and shared RNG state', () => {
    const ordinary = createLeague({ seed: 'squad-world' });
    const enabled = createLeague({ seed: 'squad-world', personnel: true });
    expect(enabled.rngState).toEqual(ordinary.rngState);
    expect(ordinary.personnel?.squads).toBeUndefined();
    for (const t of enabled.teams) {
      expect(activeRoster(enabled, t.id).map((p) => p.id)).toEqual(activeRoster(ordinary, t.id).map((p) => p.id));
      const squad = practiceSquad(enabled, t.id);
      expect(squad).toHaveLength(16);
      expect(squadFit(enabled, squad)).toBeNull();
      expect(capSpace(enabled, t.id) + 1).toBeGreaterThanOrEqual(inSeasonReserve(enabled, t.id));
      expect(squad.every((p) => !p.contract && !isAvailable(p))).toBe(true);
    }
    const again = createLeague({ seed: 'squad-world', personnel: true });
    expect(again.personnel!.squads!.results).toEqual(enabled.personnel!.squads!.results);
    expect(capHit(activeRoster(enabled, 0)[0].contract!, enabled.season)).toBeGreaterThan(0);
  });
  it('migrates an existing career without creating payroll or switching personnel on', () => {
    l.personnel!.enabled = false;
    l.version = 42;
    const loaded = migrateLeague(l)!;
    expect(loaded.version).toBe(SAVE_VERSION);
    expect(loaded.personnel?.enabled).toBe(false);
    expect(loaded.personnel?.squads).toBeUndefined();
    expect(ensureSquads.bind(null, loaded)).toThrow(/not active/);
  });
});
