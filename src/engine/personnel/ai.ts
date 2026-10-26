import { squadReserve } from './squads';
import { capSpace } from '../finance/cap';
import { capHit } from '../finance/contract';
import { minSalary } from '../finance/market';
import { inSeasonReserve, KEEP_MIN } from '../offseason/ai';
import { rosterLimit } from '../offseason/negotiation';
import { activeRoster } from '../roster';
import { perceive } from '../scouting';
import type { League } from '../types';
import { aiWaiverWindowKey, assignedContract, claimProblem, setWaiverClaim } from './waivers';
import { PERSONNEL_RULES } from './rules';
import type { WaiverClaim } from './types';

/** All clubs decide against the same pre-award world. No hidden OVR/potential or buyer iteration advantage. */
export function submitAIClaims(league: League, closing: number, autoUser = false): void {
  const state = league.personnel?.waivers;
  if (!league.personnel?.enabled || !state) return;
  const entries = state.pending.filter((e) => e.batch <= closing);
  const key = aiWaiverWindowKey(league);
  if (state.aiWindow?.key !== key) state.aiWindow = { key, awards: {} };
  for (const team of [...league.teams].sort((a, b) => a.id - b.id)) {
    if (team.id === league.userTeamId && !autoUser) continue;
    const roster = activeRoster(league, team.id);
    // Re-evaluate AI instructions when time moves, rather than persisting stale roster assumptions.
    state.claims = state.claims.filter((c) => c.teamId !== team.id || !entries.some((e) => e.id === c.entryId));
    if ((state.aiWindow!.awards[team.id] ?? 0) >= PERSONNEL_RULES.maxAIWaiverAddsPerWindow) continue;
    const candidates: { claim: WaiverClaim; score: number; playerId: number }[] = [];
    for (const entry of entries) {
      if (entry.fromTeamId === team.id) continue;
      const p = league.players[entry.playerId];
      if (!p || (p.injury?.estimate[0] ?? 0) >= 2) continue;
      const read = perceive(league, team.id, p);
      const room = roster
        .filter((x) => x.position === p.position)
        .sort((a, b) => perceive(league, team.id, a).ovr - perceive(league, team.id, b).ovr || a.id - b.id);
      const full = roster.length >= rosterLimit(league);
      const cut = full
        ? room.find(
            (x) =>
              !(
                x.waiverArrival?.season === league.season &&
                (league.phase === 'preseason'
                  ? x.waiverArrival.phase === 'preseason'
                  : league.week - x.waiverArrival.week < 2)
              ),
          )
        : undefined;
      if (full && !cut) continue;
      const missing = room.length < KEEP_MIN[p.position];
      const bar = cut
        ? perceive(league, team.id, cut).ovr
        : missing
          ? 7.5
          : room[0]
            ? perceive(league, team.id, room[0]).ovr
            : 10;
      const gain = read.ovr - bar;
      // Upside helps only an affordable, already useful prospect; it cannot justify hoarding a bad contract.
      const youth = p.age <= 25 ? Math.min(0.6, Math.max(0, read.potMid - read.ovr) * 0.15) : 0;
      const minimum = minSalary(p.experience, league.caps[league.season]);
      const hit = capHit(assignedContract(entry), league.season);
      const expense = Math.max(0, hit / Math.max(1, minimum) - 1) * 0.25;
      const score = gain + youth - expense;
      if (score < (missing && !full ? 0 : 0.6)) continue;
      const incoming = hit - (cut?.contract ? capHit(cut.contract, league.season) : 0);
      if (
        capSpace(league, team.id) - Math.max(0, incoming) <
        inSeasonReserve(league, team.id) + squadReserve(league, team.id)
      )
        continue;
      const claim: WaiverClaim = {
        entryId: entry.id,
        teamId: team.id,
        preference: 0,
        cutIds: cut ? [cut.id] : [],
        group: p.position,
        minCapSpace: inSeasonReserve(league, team.id) + squadReserve(league, team.id),
        automatic: true,
      };
      if (claimProblem(league, claim)) continue;
      candidates.push({ claim, score, playerId: p.id });
    }
    candidates.sort((a, b) => b.score - a.score || a.playerId - b.playerId);
    candidates.forEach(({ claim }, preference) => setWaiverClaim(league, { ...claim, preference }));
  }
}
