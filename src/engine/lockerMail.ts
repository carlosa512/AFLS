/**
 * Letters from the locker room: a mentor who is taking, one who left, a young player who has grown up, and the captains.
 * Like all mail they're read off the league as it stands (`deliverMail` files them), keyed by what they're about so
 * nothing doubles up, and never ask anything of you. Your position coaches write plainly about their own room; the
 * head coach writes about the whole team.
 */
import { ROOM_OF, teamCoaches } from './coaching';
import { personalityOf, personalityTone, trueCharacter } from './personality';
import type { Coach, InboxMessage, League, Player } from './types';

type Draft = Omit<InboxMessage, 'read'>;
type Sender = Pick<InboxMessage, 'from' | 'fromCard'>;

const fullName = (p: { firstName: string; lastName: string }) => `${p.firstName} ${p.lastName}`;
const signed = (c: Coach, title: string): Sender => ({
  from: `${fullName(c)}, ${title}`,
  fromCard: { kind: 'coach', id: c.id },
});

function headCoach(league: League): Sender {
  const c = teamCoaches(league, league.userTeamId).find((x) => x.role === 'headCoach');
  return c ? signed(c, 'Head coach') : { from: 'Coaching staff' };
}

/** The coach of his position room, or the head coach when the chair is empty. */
function roomCoach(league: League, p: Player): Sender {
  const room = ROOM_OF[p.position];
  const c = teamCoaches(league, league.userTeamId).find((x) => x.role === 'positionCoach' && x.room === room);
  return c ? signed(c, 'Position coach') : headCoach(league);
}

function took(league: League, p: Player, have: Set<string>): Draft | null {
  const id = `mentor:${league.season}:took:${p.id}`;
  const by = p.mentoredBy?.at(-1);
  const mentor = by && league.players[by.id];
  if (have.has(id) || !mentor || (p.shiftedLast?.workEthic ?? 0) < 0.5) return null;
  return {
    id,
    season: league.season,
    phase: league.phase,
    week: 0,
    ...roomCoach(league, p),
    category: 'staff',
    subject: `${fullName(p)} is learning from ${mentor.lastName}`,
    body: `${p.lastName} has been picking up ${fullName(mentor)}'s habits in the film room and the weight room. He's putting in more work than he did a year ago, and it shows.`,
    actions: [{ kind: 'player', playerId: p.id }],
  };
}

function grownUp(league: League, p: Player, have: Set<string>): Draft | null {
  const id = `persona:${league.season}:${p.id}`;
  const last = p.shiftedLast;
  if (have.has(id) || !last || last.season !== league.season) return null;
  const before = { ...trueCharacter(p) };
  for (const k of ['workEthic', 'temperament', 'poise'] as const)
    before[k] = p.traits[k] + (p.shifts?.[k] ?? 0) - (last[k] ?? 0);
  const now = { ...trueCharacter(p) };
  for (const k of ['workEthic', 'temperament', 'poise'] as const) now[k] = p.traits[k] + (p.shifts?.[k] ?? 0);
  const was = personalityOf(before);
  const is = personalityOf(now);
  // Only a change for the better: a bad mentor's mark is the feud letters' and the card's to tell.
  const rank = { warn: 0, neutral: 1, good: 2 } as const;
  if (rank[personalityTone(is)] <= rank[personalityTone(was)]) return null;
  return {
    id,
    season: league.season,
    phase: league.phase,
    week: 0,
    ...roomCoach(league, p),
    category: 'staff',
    subject: `${fullName(p)} has grown up`,
    body: `A year ago our read on ${p.lastName} was "${was}". Not any more: he's grown up. "${is}" is closer to it now.`,
    actions: [{ kind: 'player', playerId: p.id }],
  };
}

function gone(league: League, p: Player, have: Set<string>): Draft | null {
  const lost = p.lostMentor;
  if (!lost || lost.season !== league.season) return null;
  const id = `mentor:${lost.season}:${lost.week}:gone:${p.id}`;
  const mentor = league.players[lost.id];
  if (have.has(id) || !mentor) return null;
  return {
    id,
    season: lost.season,
    phase: league.phase,
    week: lost.week,
    ...headCoach(league),
    category: 'staff',
    subject: `${fullName(p)} loses his mentor`,
    body: `With ${fullName(mentor)} gone, ${p.lastName} loses the man who was bringing him along. The staff will find him someone else in the room, unless you'd rather pick.`,
    actions: [{ kind: 'player', playerId: p.id }],
  };
}

function captains(league: League, have: Set<string>): Draft | null {
  const c = league.teams[league.userTeamId].captains;
  const id = `captains:${league.season}`;
  if (have.has(id) || !c || c.season !== league.season) return null;
  const [o, d, s] = [c.offense, c.defense, c.specialTeams].map((x) => league.players[x]);
  if (!o || !d || !s) return null;
  return {
    id,
    season: league.season,
    phase: league.phase,
    week: 0,
    ...headCoach(league),
    category: 'staff',
    subject: 'Our captains',
    body: `The room has spoken. ${fullName(o)} captains the offense, ${fullName(d)} the defense and ${fullName(s)} the kicking game. They're the ones the guys listen to.`,
    actions: [{ kind: 'team', teamId: league.userTeamId }],
  };
}

/** Everything new from the locker room, for `deliverMail`. */
export function lockerMail(league: League, have: Set<string>): Draft[] {
  const out: Draft[] = [];
  const ours = Object.values(league.players).filter((p) => p.teamId === league.userTeamId && !p.retired);
  if (league.phase === 'resign')
    for (const p of ours) {
      const a = took(league, p, have);
      if (a) out.push(a);
      const b = grownUp(league, p, have);
      if (b) out.push(b);
    }
  if (league.phase === 'regular' || league.phase === 'playoffs')
    for (const p of ours) {
      const g = gone(league, p, have);
      if (g) out.push(g);
    }
  if (league.phase === 'preseason' || league.phase === 'regular') {
    const c = captains(league, have);
    if (c) out.push(c);
  }
  return out;
}
