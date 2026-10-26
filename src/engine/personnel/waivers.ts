import { personnelMoveLock } from './elevations';
import { capSheet, logTransaction, paidShare, releasePlayer, releasePreview, weeksPaid } from '../finance/cap';
import type { ReleasePreview } from '../finance/cap';
import { deadMoney, isExpired } from '../finance/contract';
import { freeJersey } from '../generate';
import { rosterLimit } from '../offseason/negotiation';
import { STARTERS } from '../positions';
import { activeRoster, practiceSquad, syncDepthChart, teamPlayers } from '../roster';
import { Rng } from '../rng';
import { computeRecords, winPct } from '../season/standings';
import type { Contract, League, Player } from '../types';
import { POSITIONS } from '../types';
import { personnelClock, personnelTime, TRADE_DEADLINE_MINUTE, waiverDeadline } from './calendar';
import { ensureService, serviceSeasons } from './service';
import type { WaiverClaim, WaiverEntry, WaiverResult } from './types';
import { PERSONNEL_RULES } from './rules';
import { squadReturnProblem } from './rosterMoves';
import { inviteSquadReturn } from './squads';
import { squadFit } from './eligibility';

export function aiWaiverWindowKey(league: League): string {
  return `${league.season}:${league.phase}:${league.phase === 'preseason' ? 'camp' : league.phase === 'freeAgency' ? league.faDay : league.week}`;
}

export function originalWaiverOrder(league: League): number[] {
  const picks = league.draftPicks
    .filter((p) => p.season === league.season && p.round === 1 && p.overall !== undefined)
    .sort((a, b) => a.overall! - b.overall!)
    .map((p) => p.originalTeamId);
  if (new Set(picks).size === league.teams.length) return picks;
  // No fabricated prior standings for a new world; ties remain stable across refreshes and pick trades.
  return league.teams
    .map((t) => t.id)
    .sort(
      (a, b) =>
        new Rng(`${league.seed}:opening-waivers:${a}`).next() - new Rng(`${league.seed}:opening-waivers:${b}`).next() ||
        a - b,
    );
}

export function ensureWaivers(league: League) {
  if (!league.personnel?.enabled) throw new Error('Personnel transactions are not enabled.');
  personnelClock(league);
  const state = (league.personnel.waivers ??= {
    nextId: 1,
    originalOrder: { season: league.season, teams: originalWaiverOrder(league) },
    pending: [],
    claims: [],
    results: [],
  });
  if (state.originalOrder.season !== league.season) {
    if (state.pending.length) throw new Error('Settle last season’s waivers before opening a new league year.');
    state.originalOrder = { season: league.season, teams: originalWaiverOrder(league) };
  }
  return state;
}

export function waiverOrder(league: League): number[] {
  const original = league.personnel?.waivers?.originalOrder;
  const early = original?.season === league.season ? original.teams : originalWaiverOrder(league);
  if (!['regular', 'playoffs', 'complete'].includes(league.phase) || league.week <= 3) return [...early];
  const records = computeRecords(league);
  const pct = (id: number) => {
    const r = records.get(id)!;
    return winPct(r.w, r.l, r.t);
  };
  const strength = (id: number) => {
    const opponents = league.games.filter(
      (g) => g.season === league.season && !g.playoffRound && (g.homeId === id || g.awayId === id),
    );
    let w = 0,
      n = 0;
    for (const g of opponents) {
      const r = records.get(g.homeId === id ? g.awayId : g.homeId)!;
      w += r.w + r.t / 2;
      n += r.w + r.l + r.t;
    }
    return n ? w / n : 0.5;
  };
  const sos = new Map(early.map((id) => [id, strength(id)]));
  // AFLS settles remaining record/SOS ties by frozen original priority, not playoff standings.
  return [...early].sort((a, b) => pct(a) - pct(b) || sos.get(a)! - sos.get(b)! || early.indexOf(a) - early.indexOf(b));
}

export function waiverApplies(league: League, p: Player): boolean {
  if (!league.personnel?.enabled) return false;
  if (!p.contract || isExpired(p.contract, league.season)) return false;
  if (
    league.phase === 'playoffs' ||
    league.phase === 'complete' ||
    (league.phase === 'regular' && personnelTime(league) > TRADE_DEADLINE_MINUTE)
  )
    return true;
  // Completed seasons only: the current year cannot vest the exception early.
  return serviceSeasons(p, league.season) < 4;
}

export function queueWaiver(league: League, p: Player, preview: ReleasePreview): void {
  if (p.teamId === null || !p.contract || p.waiver) throw new Error('No roster contract to waive.');
  const state = ensureWaivers(league);
  const from = p.teamId;
  const paid = paidShare(league, p.contract);
  const assigned = deadMoney(p.contract, league.season, { paid, postJune1: preview.postJune1, trade: true });
  const entry: WaiverEntry = {
    id: state.nextId++,
    playerId: p.id,
    fromTeamId: from,
    season: league.season,
    deadline: waiverDeadline(personnelTime(league)),
    contract: structuredClone(p.contract),
    paid,
    paidBefore: weeksPaid(league),
    postJune1: preview.postJune1,
    release: { thisYear: Math.round(preview.thisYear), nextYear: Math.round(preview.nextYear) },
    assigned: { thisYear: Math.round(assigned.thisYear), nextYear: Math.round(assigned.nextYear) },
  };
  state.pending.push(entry);
  const t = league.teams[from];
  if (preview.postJune1 && !['preseason', 'regular', 'playoffs'].includes(league.phase)) t.postJune1Used++;
  for (const pos of POSITIONS) t.depthChart[pos] = t.depthChart[pos].filter((id) => id !== p.id);
  if (t.playingAt) delete t.playingAt[p.id];
  if (t.taggedId === p.id) t.taggedId = null;
  p.waiver = { id: entry.id, fromTeamId: from };
  p.teamId = null;
  p.tagCount = 0;
  delete league.negotiations[p.id];
  logTransaction(league, 'waiver', [from], `${t.abbrev} waived ${p.position} ${p.firstName} ${p.lastName}`);
}

/** Claiming takes unpaid salary/guarantees and control; originating bonuses never transfer. */
export function assignedContract(entry: WaiverEntry): Contract {
  const c = structuredClone(entry.contract);
  c.bonuses = [];
  c.years = c.years.filter((y) => !y.void);
  const now = c.years.find((y) => y.season === entry.season);
  if (now) {
    const paid = now.base * entry.paid;
    now.base = Math.round(now.base - paid);
    now.guaranteed = Math.min(now.base, Math.round(Math.max(0, now.guaranteed - paid)));
    now.paidBefore = entry.paidBefore;
  }
  return c;
}

/** Pure validation against the actual award state, including every year of cap commitments. */
export function claimProblem(league: League, claim: WaiverClaim, resolving = false): string | null {
  if (!league.personnel?.enabled) return 'Waivers are not enabled.';
  if (
    claim.automatic &&
    league.personnel.waivers?.aiWindow?.key === aiWaiverWindowKey(league) &&
    (league.personnel.waivers.aiWindow.awards[claim.teamId] ?? 0) >= PERSONNEL_RULES.maxAIWaiverAddsPerWindow
  )
    return 'The AI front office has filled its waiver plan for this window.';
  const entry = league.personnel.waivers?.pending.find((e) => e.id === claim.entryId);
  if (!entry) return 'This waiver has already settled.';
  if (personnelTime(league) > entry.deadline || (!resolving && personnelTime(league) === entry.deadline))
    return 'The claim deadline has passed.';
  const p = league.players[entry.playerId];
  if (!p || p.waiver?.id !== entry.id || p.retired) return 'The player is no longer available.';
  if (!league.teams[claim.teamId] || entry.fromTeamId === claim.teamId)
    return 'The waiving club cannot claim its own player.';
  if (new Set(claim.cutIds).size !== claim.cutIds.length) return 'A conditional release is listed twice.';
  if (
    new Set(claim.squadReturnIds).size !== (claim.squadReturnIds?.length ?? 0) ||
    claim.squadReturnIds?.some((id) => !claim.cutIds.includes(id))
  )
    return 'Squad return plans must name a player released by this claim.';
  const roster = activeRoster(league, claim.teamId);
  const cuts = claim.cutIds.map((id) => league.players[id]);
  const lockedCut = cuts.find((p) => p && personnelMoveLock(league, p));
  if (lockedCut) return personnelMoveLock(league, lockedCut);
  if (cuts.some((c) => !c || c.teamId !== claim.teamId || !c.contract || c.waiver || c.squad || c.ir))
    return 'A conditional release is no longer on this roster.';
  for (const id of claim.squadReturnIds ?? []) {
    const issue = squadReturnProblem(league, claim.teamId, league.players[id]);
    if (issue) return issue;
  }
  if (claim.squadReturnIds?.length) {
    const issue = squadFit(league, [
      ...practiceSquad(league, claim.teamId),
      ...claim.squadReturnIds.map((id) => league.players[id]),
    ]);
    if (issue) return issue;
  }
  const remaining = roster.filter((x) => !claim.cutIds.includes(x.id));
  if (remaining.length + 1 > rosterLimit(league)) return 'Choose a roster move to make room if this claim wins.';
  for (const pos of POSITIONS) {
    const before = roster.filter((x) => x.position === pos).length;
    const after = remaining.filter((x) => x.position === pos).length + (p.position === pos ? 1 : 0);
    if (after < Math.min(before, STARTERS[pos])) return `The conditional releases leave too few ${pos}.`;
  }
  const arrival = { ...p, teamId: claim.teamId, contract: assignedContract(entry), waiver: undefined };
  const costs = cuts.map((c) => releasePreview(league, c));
  const lastYear = Math.max(league.season + 1, ...arrival.contract.years.map((y) => y.season));
  for (let y = league.season; y <= lastYear; y++) {
    const sheet = capSheet(league, claim.teamId, y, [
      ...remaining,
      ...teamPlayers(league, claim.teamId).filter((x) => x.ir),
      arrival,
    ]);
    const cutCosts = costs.reduce(
      (sum, c) =>
        sum + (y === league.season ? Math.round(c.thisYear) : y === league.season + 1 ? Math.round(c.nextYear) : 0),
      0,
    );
    if (sheet.space - cutCosts < (y === league.season ? (claim.minCapSpace ?? 0) : 0))
      return `The claim and releases exceed the ${y} cap budget.`;
  }
  return null;
}

export function setWaiverClaim(league: League, claim: WaiverClaim): void {
  const problem = claimProblem(league, claim);
  if (problem) throw new Error(problem);
  if (!Number.isFinite(claim.preference) || claim.preference < 0) throw new Error('Invalid claim preference.');
  if (claim.minCapSpace !== undefined && (!Number.isFinite(claim.minCapSpace) || claim.minCapSpace < 0))
    throw new Error('Invalid claim budget.');
  const state = league.personnel!.waivers!;
  const old = state.claims.findIndex((c) => c.teamId === claim.teamId && c.entryId === claim.entryId);
  if (old >= 0) state.claims.splice(old, 1);
  state.claims.push(structuredClone(claim));
}

export function cancelWaiverClaim(league: League, entryId: number, teamId: number): void {
  const state = league.personnel?.waivers;
  const entry = state?.pending.find((e) => e.id === entryId);
  if (!state || !entry || personnelTime(league) >= entry.deadline) throw new Error('The claim is no longer editable.');
  state.claims = state.claims.filter((c) => c.entryId !== entryId || c.teamId !== teamId);
}

/** Reordering changes no cuts or budgets and must not partially edit a list containing a stale claim. */
export function reorderWaiverClaims(league: League, teamId: number, entryIds: number[]): void {
  const state = league.personnel?.waivers;
  const own = state?.claims.filter((c) => c.teamId === teamId) ?? [];
  if (
    !state ||
    entryIds.length !== own.length ||
    new Set(entryIds).size !== entryIds.length ||
    own.some(
      (c) =>
        !entryIds.includes(c.entryId) ||
        !state.pending.some((e) => e.id === c.entryId && e.deadline > personnelTime(league)),
    )
  )
    throw new Error('Claim preferences no longer match the open notices.');
  state.claims = state.claims.map((c) => (c.teamId === teamId ? { ...c, preference: entryIds.indexOf(c.entryId) } : c));
}

function book(league: League, entry: WaiverEntry, split: { thisYear: number; nextYear: number }, note: string) {
  for (const [season, amount] of [
    [entry.season, split.thisYear],
    [entry.season + 1, split.nextYear],
  ])
    if (amount > 0)
      league.teams[entry.fromTeamId].deadMoney.push({
        season,
        amount: Math.round(amount),
        playerId: entry.playerId,
        note,
      });
}

/** A batch is immutable. Cuts caused by awards enter a later notice and cannot clear recursively. */
export function resolveWaiverBatch(league: League, deadline: number): WaiverResult[] {
  const state = ensureWaivers(league);
  const batch = state.pending.filter((e) => e.deadline === deadline).sort((a, b) => a.playerId - b.playerId);
  if (!batch.length) return [];
  if (personnelTime(league) > deadline) throw new Error('Process overdue notices in chronological order.');
  if (batch.some((e) => league.players[e.playerId]?.waiver?.id !== e.id))
    throw new Error('Waiver membership is inconsistent.');
  const ids = new Set(batch.map((e) => e.id));
  const completed = new Map<number, number>();
  const reasons = new Map<number, string>();
  const order = waiverOrder(league); // Freeze priority for the entire notice.
  const byId = new Map(batch.map((e) => [e.id, e]));
  personnelClock(league).minute = deadline;
  for (const teamId of order) {
    const groups = new Set<string>();
    const claims = state.claims
      .filter((c) => c.teamId === teamId && ids.has(c.entryId))
      .sort((a, b) => a.preference - b.preference || byId.get(a.entryId)!.playerId - byId.get(b.entryId)!.playerId);
    for (const claim of claims) {
      if (completed.has(claim.entryId)) {
        if (teamId === league.userTeamId) reasons.set(claim.entryId, 'A club with higher waiver priority won.');
        continue;
      }
      if (claim.group && groups.has(claim.group)) {
        if (teamId === league.userTeamId)
          reasons.set(claim.entryId, 'An earlier alternative in this group was awarded.');
        continue;
      }
      const problem = claimProblem(league, claim, true);
      if (problem) {
        if (teamId === league.userTeamId) reasons.set(claim.entryId, problem);
        continue;
      }
      const entry = batch.find((e) => e.id === claim.entryId)!;
      const p = league.players[entry.playerId];
      // Validate before the first mutation. The reserved worst-case release costs make the cuts affordable.
      for (const id of claim.cutIds) {
        if (claim.squadReturnIds?.includes(id)) inviteSquadReturn(league, teamId, league.players[id]);
        releasePlayer(league, league.players[id]);
      }
      book(league, entry, entry.assigned, 'Waiver assignment');
      p.contract = assignedContract(entry);
      p.teamId = teamId;
      p.waiverArrival = { season: league.season, week: league.week, phase: league.phase };
      delete p.waiver;
      delete p.ir;
      p.jersey = freeJersey(
        p.position,
        new Set(
          teamPlayers(league, teamId)
            .filter((x) => x.id !== p.id)
            .map((x) => x.jersey),
        ),
        p.jersey,
      );
      ensureService(p, league.season);
      syncDepthChart(league, league.teams[teamId]);
      completed.set(entry.id, teamId);
      if (claim.automatic) {
        const key = aiWaiverWindowKey(league);
        if (state.aiWindow?.key !== key) state.aiWindow = { key, awards: {} };
        state.aiWindow!.awards[teamId] = (state.aiWindow!.awards[teamId] ?? 0) + 1;
      }
      if (claim.group) groups.add(claim.group);
      // Remove its cap hold immediately, before considering another winning claim.
      state.pending = state.pending.filter((e) => e.id !== entry.id);
      logTransaction(
        league,
        'claim',
        [entry.fromTeamId, teamId],
        `${league.teams[teamId].abbrev} claimed ${p.position} ${p.firstName} ${p.lastName} from ${league.teams[entry.fromTeamId].abbrev}`,
      );
    }
  }
  const results: WaiverResult[] = [];
  for (const entry of batch) {
    const toTeamId = completed.get(entry.id) ?? null;
    if (toTeamId === null) {
      const p = league.players[entry.playerId];
      book(league, entry, entry.release, 'Cleared waivers');
      p.contract = null;
      delete p.waiver;
      delete p.ir;
      logTransaction(
        league,
        'release',
        [entry.fromTeamId],
        `${p.position} ${p.firstName} ${p.lastName} cleared waivers`,
      );
    }
    results.push({
      entryId: entry.id,
      playerId: entry.playerId,
      fromTeamId: entry.fromTeamId,
      toTeamId,
      season: entry.season,
      deadline,
      ...(reasons.has(entry.id) ? { userReason: reasons.get(entry.id) } : {}),
    });
  }
  state.pending = state.pending.filter((e) => !ids.has(e.id));
  state.claims = state.claims.filter((c) => !ids.has(c.entryId));
  state.results.push(...results);
  state.results = state.results.slice(-96);
  personnelClock(league).minute = deadline;
  return results;
}
