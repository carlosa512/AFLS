/**
 * Your players' disputes (G4): the head coach's letter when one starts and when it ends, filed by `deliverMail` like
 * every letter. Its buttons answer through `answerDispute`; what the letter shows is worked out from the league as it is
 * (`disputeCard`), so nothing about it is stored on the message.
 */
import { disputeCard } from './disputes';
import {
  DISPUTE_ASK,
  DISPUTE_END,
  DISPUTE_START,
  DISPUTE_SUBJECT,
  disputeEndSubject,
  type DisputeFact,
} from './disputeVoice';
import { STARTERS } from './positions';
import { teamPlayers } from './roster';
import { headCoach, type Draft } from './senders';
import { TRAIT_MEAN } from './traits';
import type { League, Player } from './types';
import { recentBodies, say } from './voice';

/** Morale's clock: steps in a league year. */
const YEAR = 32;

export const disputeLetterId = (since: number, playerId: number) =>
  `dispute:${Math.floor(since / YEAR)}:${since}:${playerId}`;
export const disputeEndId = (since: number, playerId: number) =>
  `dispute-end:${Math.floor(since / YEAR)}:${since}:${playerId}`;

function fact(league: League, p: Player, kind: DisputeFact['kind'], how?: DisputeFact['how']): DisputeFact {
  const spot = league.teams[p.teamId!].depthChart[p.position].indexOf(p.id);
  return {
    name: p.lastName,
    full: `${p.firstName} ${p.lastName}`,
    kind,
    loud: (p.traits.controversy - TRAIT_MEAN) / 3.5 >= 0.5,
    veteran: p.experience >= 6,
    starter: spot >= 0 && spot < STARTERS[p.position],
    how,
    waiting: !!p.morale?.reported,
  };
}

/** The head coach's letters: one as a dispute starts, one as it ends (only for one he wrote to you about). */
export function disputeMail(league: League, have: Set<string>): Draft[] {
  const out: Draft[] = [];
  const coach = headCoach(league);
  const recent = coach.from ? recentBodies(league, coach.from) : [];
  const base = {
    season: league.season,
    phase: league.phase,
    week: league.phase === 'regular' || league.phase === 'playoffs' ? league.week : 0,
    category: 'staff' as const,
  };
  for (const p of teamPlayers(league, league.userTeamId)) {
    const m = p.morale;
    if (!m) continue;
    const d = m.dispute;
    if (d && d.club === p.teamId && d.kind !== 'trade') {
      const id = disputeLetterId(d.since, p.id);
      if (!have.has(id)) {
        const f = fact(league, p, d.kind);
        const body = `${say(DISPUTE_START, f, { key: id, slot: 'start', recent })} ${say(DISPUTE_ASK, f, { key: id, slot: 'ask', recent })}`;
        out.push({
          ...base,
          id,
          ...coach,
          subject: DISPUTE_SUBJECT[d.kind](p.lastName),
          body,
          actions: [{ kind: 'player', playerId: p.id }],
        });
        recent.push(body);
      }
    }
    const e = m.disputeEnd;
    if (e && e.kind !== 'trade' && have.has(disputeLetterId(e.since, p.id))) {
      const id = disputeEndId(e.since, p.id);
      if (!have.has(id)) {
        const body = say(DISPUTE_END, fact(league, p, e.kind, e.how), { key: id, slot: 'end', recent });
        out.push({
          ...base,
          id,
          ...coach,
          subject: disputeEndSubject(p.lastName, e.how),
          body,
          actions: [{ kind: 'player', playerId: p.id }],
        });
        recent.push(body);
      }
    }
  }
  return out;
}

/** Does a dispute's letter still ask something: the start letter while its dispute waits on your answer. */
export function disputeNeedsYou(league: League, s: { since: number; playerId: number; end?: true }): boolean {
  return !s.end && disputeCard(league, s).state === 'open';
}
