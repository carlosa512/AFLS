/**
 * Letters from the locker room: a mentor who is taking, one who left, a young player who has grown up, and the captains.
 * Like all mail they're read off the league as it stands (`deliverMail` files them), keyed by what they're about so
 * nothing doubles up, and never ask anything of you. Your position coaches write plainly about their own room; the
 * head coach writes about the whole team.
 */
import { ROOM_OF, teamCoaches } from './coaching';
import { personalityOf, personalityTone, trueCharacter } from './personality';
import { personalityRead } from './personality';
import { clubFeeling, rapport, speakEvents, speaksOut, type SpeakEvent } from './relationships';
import { perceive } from './scouting';
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

/** Your position coach on a feud in his room (each pair once a season). */
function feudMail(league: League, have: Set<string>, ours: Player[]): Draft[] {
  const out: Draft[] = [];
  for (const a of ours)
    for (const t of a.ties ?? []) {
      const b = league.players[t.with];
      if (t.kind !== 'feud' || t.since !== league.season || !b || b.id < a.id || b.teamId !== a.teamId) continue;
      const id = `feud:${league.season}:${a.id}:${b.id}`;
      if (have.has(id)) continue;
      const why =
        t.why === 'benched'
          ? ' It started when the job changed hands.'
          : t.why === 'snubbed'
            ? ' It started with the new contract.'
            : '';
      out.push({
        id,
        season: league.season,
        phase: league.phase,
        week: league.week,
        ...roomCoach(league, a),
        category: 'staff',
        subject: `${a.lastName} and ${b.lastName} don't see eye to eye`,
        body: `${fullName(a)} and ${fullName(b)} don't see eye to eye.${why} I'll keep it off the field, but it's in the room and you should know.`,
        actions: [{ kind: 'player', playerId: a.id }],
      });
    }
  return out;
}

/** The head coach when a man's friend is cut or traded away this season. */
function friendGoneMail(league: League, have: Set<string>, ours: Player[]): Draft[] {
  const out: Draft[] = [];
  for (const a of ours)
    for (const t of a.ties ?? []) {
      const b = league.players[t.with];
      const gone = b?.left?.find(
        (d) => d.teamId === league.userTeamId && d.season === league.season && d.how !== 'walked',
      );
      if (t.kind !== 'friend' || !b || !gone || b.teamId === league.userTeamId) continue;
      const id = `friend:${league.season}:left:${a.id}:${b.id}`;
      if (have.has(id)) continue;
      out.push({
        id,
        season: league.season,
        phase: league.phase,
        week: league.week,
        ...headCoach(league),
        category: 'staff',
        subject: `${a.lastName} takes ${b.lastName}'s ${gone.how === 'cut' ? 'release' : 'trade'} hard`,
        body: `${fullName(a)} took ${fullName(b)}'s ${gone.how === 'cut' ? 'release' : 'trade'} hard. They were close. He'll be fine, but give him a week.`,
        actions: [{ kind: 'player', playerId: a.id }],
      });
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
    return '. He wanted the ball late';
  return '';
}

/** Everything new from the locker room, for `deliverMail`. */
export function lockerMail(league: League, have: Set<string>): Draft[] {
  const ours = Object.values(league.players).filter((p) => p.teamId === league.userTeamId && !p.retired);
  const out: Draft[] = [
    ...speakMail(league, have),
    ...feudMail(league, have, ours),
    ...friendGoneMail(league, have, ours),
    ...freeAgentMail(league, have),
  ];
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
