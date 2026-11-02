/**
 * Letters around the locker room that aren't the head coach's report (`lockerReport.ts` tells mentors, feuds,
 * friendships, captains and who grew up): SNN on a player who speaks out and on the coaching trees, agents of free
 * agents who'd like to come home, and a recap's aside on its player of the game. Read off the league as it stands,
 * keyed by what they're about so nothing doubles up, and never asking anything of you.
 */
import { teamCoaches } from './coaching';
import { headCoach, type Draft } from './senders';
import { personalityRead } from './personality';
import { clubFeeling, rapport, speakEvents, speaksOut, type SpeakEvent } from './relationships';
import { perceive } from './scouting';
import { linksOf, treeBornSeason, treeOf } from './trees';
import type { League, Player } from './types';

const fullName = (p: { firstName: string; lastName: string }) => `${p.firstName} ${p.lastName}`;

const SAID: Record<SpeakEvent, (p: Player, club: string) => string> = {
  traded: (p, club) =>
    `"I gave that place everything," ${p.lastName} said of the ${club}. "They'll see what they let go."`,
  cut: (p, club) => `"They never gave me a real chance," ${p.lastName} said after the ${club} let him go.`,
  benched: (p, club) =>
    `"I'm a starter in this league," ${p.lastName} said of losing his job with the ${club}. "I'll prove it."`,
  snubbed: (p, club) =>
    `"You see who they pay," ${p.lastName} said of the ${club}'s latest deal. "That tells you everything."`,
};

/** SNN on a player speaking out: ours, or one who left us in the last three seasons. Neutral reporting, his words. */
function speakMail(league: League, have: Set<string>): Draft[] {
  const user = league.userTeamId;
  const out: Draft[] = [];
  for (const p of Object.values(league.players)) {
    if (p.retired) continue;
    const ours = p.teamId === user || p.left?.some((d) => d.teamId === user && league.season - d.season <= 3);
    if (!ours) continue;
    for (const e of speakEvents(league, p)) {
      const id = `speak:${league.season}:${p.id}:${e.kind}`;
      if (have.has(id) || !speaksOut(league, p, league.season, e.kind)) continue;
      const club = league.teams[e.teamId];
      out.push({
        id,
        season: league.season,
        phase: league.phase,
        week: league.week,
        from: 'SNN league desk',
        category: 'league',
        subject: `${fullName(p)} speaks out`,
        body: `${fullName(p)} didn't keep it to himself. ${SAID[e.kind](p, `${club.city} ${club.name}`)}`,
        actions: [{ kind: 'player', playerId: p.id }],
      });
    }
  }
  return out;
}

/** Free agency: agents of men who'd like to come home, and men who did well under one of our coaches (two of each). */
function freeAgentMail(league: League, have: Set<string>): Draft[] {
  if (league.phase !== 'freeAgency') return [];
  const user = league.userTeamId;
  const pool = Object.values(league.players)
    .filter((p) => p.teamId === null && !p.retired && p.contract === null && p.experience > 0)
    .map((p) => ({ p, ovr: perceive(league, user, p).ovr }))
    .sort((a, b) => b.ovr - a.ovr)
    .map((x) => x.p);
  const coaches = teamCoaches(league, user);
  const out: Draft[] = [];
  let home = 0;
  let pull = 0;
  for (const p of pool) {
    if (home < 2 && clubFeeling(league, p, user) === 'home') {
      const id = `home:${league.season}:${p.id}`;
      if (!have.has(id)) {
        home++;
        out.push({
          id,
          season: league.season,
          phase: league.phase,
          week: 0,
          from: `${p.lastName}'s agent`,
          category: 'contracts',
          subject: `${fullName(p)} would like to come home`,
          body: `My client has never stopped thinking of your club as home. If there's a fair deal there, ${p.firstName} would rather sign it with you than anyone.`,
          actions: [{ kind: 'player', playerId: p.id }],
        });
      }
    }
    const coach = pull < 2 ? coaches.find((c) => rapport(league, p, c) === 'good') : undefined;
    if (coach) {
      const id = `rapport:${league.season}:${p.id}`;
      if (!have.has(id)) {
        pull++;
        out.push({
          id,
          season: league.season,
          phase: league.phase,
          week: 0,
          ...headCoach(league),
          category: 'contracts',
          subject: `${fullName(p)} asked about us`,
          body: `${fullName(p)} asked about joining us. He played well for ${fullName(coach)} and would like to again.`,
          actions: [{ kind: 'player', playerId: p.id }],
        });
      }
    }
  }
  return out;
}

/**
 * A recap's aside on its player of the game, only when the box score backs it: a revenge game (he beat or starred
 * against a club that cut or traded him) and a clutch one (ours, read as Clutch, in a one-score win).
 */
export function recapAside(league: League, p: Player, game: { won: boolean; margin: number }): string {
  const user = league.userTeamId;
  if (p.teamId !== user && clubFeeling(league, p, user) === 'grudge') {
    const how = [...(p.left ?? [])].reverse().find((d) => d.teamId === user)?.how;
    return how === 'traded' ? ', against the club that traded him away' : ', against the club that cut him';
  }
  if (p.teamId === user && game.won && game.margin <= 8 && personalityRead(league, user, p)?.name === 'Clutch')
    return ', and he wanted the ball late';
  return '';
}

// ───────── coaching trees on SNN ─────────

const coachName = (league: League, id: number) => {
  const c = league.coaches[id] ?? league.retiredCoaches[id];
  return c ? fullName(c) : 'a coach';
};

function snn(league: League, id: string, subject: string, body: string): Draft {
  return {
    id,
    season: league.season,
    phase: league.phase,
    week: league.week,
    from: 'SNN league desk',
    category: 'league',
    subject,
    body,
    actions: [{ kind: 'coaches' }],
  };
}

/** SNN on the coaching trees: one born, a mentor meeting his disciple for the first time, a root retiring. */
function treeMail(league: League, have: Set<string>): Draft[] {
  const out: Draft[] = [];
  const everyone = [...Object.values(league.coaches), ...Object.values(league.retiredCoaches)];
  for (const root of everyone) {
    const tree = treeOf(league, root.id);
    if (!tree) continue;
    // Born: this is the first season two of his men run clubs at once (founding trees were born before the league).
    const born = `tree:${league.season}:born:${root.id}`;
    if (treeBornSeason(league, root.id) === league.season && !have.has(born))
      out.push(
        snn(
          league,
          born,
          `A ${root.lastName} tree`,
          `With ${coachName(league, tree.disciples[1])} taking over a club, ${fullName(root)} now has two former assistants running teams of their own. Around the league they're calling it the ${root.lastName} tree.`,
        ),
      );
    // Retired: the root of a live tree left the game this offseason.
    const retired = `tree:${league.season}:retired:${root.id}`;
    const last = Math.max(-Infinity, ...(root.career ?? []).map((r) => r.season));
    if (
      league.retiredCoaches[root.id] &&
      last === league.season - 1 &&
      tree.activeHeadCoaches.length >= 2 &&
      !have.has(retired)
    )
      out.push(
        snn(
          league,
          retired,
          `${fullName(root)} retires`,
          `${fullName(root)} has retired. His tree carries on: ${tree.activeHeadCoaches.map((id) => coachName(league, id)).join(', ')} still run clubs.`,
        ),
      );
  }
  // The week before: a mentor and his disciple face each other as head coaches for the first time.
  if (league.phase === 'regular') {
    const headOf = (teamId: number) => teamCoaches(league, teamId).find((c) => c.role === 'headCoach');
    for (const g of league.games) {
      if (g.week !== league.week || g.result || g.season !== league.season) continue;
      const [a, b] = [headOf(g.homeId), headOf(g.awayId)];
      if (!a || !b) continue;
      const pair = linksOf(league, b.id).some((k) => k.mentorId === a.id && k.as === 'headCoach')
        ? [a, b]
        : linksOf(league, a.id).some((k) => k.mentorId === b.id && k.as === 'headCoach')
          ? [b, a]
          : null;
      if (!pair) continue;
      const [mentor, disciple] = pair;
      const id = `tree:meet:${mentor.id}:${disciple.id}`;
      if (have.has(id)) continue;
      out.push(
        snn(
          league,
          id,
          `${mentor.lastName} meets his old assistant`,
          `${fullName(mentor)} faces ${fullName(disciple)}, who worked under him for years, for the first time as rival head coaches this week.`,
        ),
      );
    }
  }
  return out;
}

/** How many have left our staff to run a club in the five seasons up to this one (the poached letter's line). */
export function headCoachesOffStaff(league: League, teamId: number): number {
  let n = 0;
  for (const c of [...Object.values(league.coaches), ...Object.values(league.retiredCoaches)]) {
    const rows = c.career ?? [];
    if (
      rows.some(
        (r) =>
          r.role === 'headCoach' &&
          r.teamId !== teamId &&
          r.season >= league.season - 4 &&
          rows.some((x) => x.teamId === teamId && x.role !== 'headCoach' && x.season === r.season - 1),
      )
    )
      n++;
  }
  return n;
}

/**
 * Everything new from the locker room that isn't the head coach's report (`lockerReport.ts`): SNN on a player speaking
 * out and on the coaching trees, and free agents' agents. For `deliverMail`.
 */
export function lockerMail(league: League, have: Set<string>): Draft[] {
  return [...speakMail(league, have), ...freeAgentMail(league, have), ...treeMail(league, have)];
}
