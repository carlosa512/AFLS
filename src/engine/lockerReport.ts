/**
 * The head coach's locker room report, four times a year: camp opens, cut-down day, deadline week and the season's
 * end. It replaces the one-off locker room letters (a mentor lost, a feud, a friendship, a player who grew up, the
 * captains): each report tells what changed since the one before, in sections that show only when they have rows,
 * under a one-line verdict on the room. What a report told it lists in `covered`, under the ids the old one-off
 * letters used, so an upgraded save never hears the same news twice. Never asks anything of you.
 */
import { betterMentor, mentorStatus } from './mentoring';
import { personalityOf, personalityRead, personalityTone, trueCharacter, leadersOf } from './personality';
import {
  CAPTAIN_WHY,
  FRICTION,
  FRICTION_LEAD,
  GETTING_ALONG,
  GREW_UP,
  MENTOR_LOST,
  MENTOR_SUGGEST,
  MORALE_LEAD,
  MORALE_NOTE,
  VERDICT,
  type Checkin,
  type VerdictFact,
} from './lockerVoice';
import { headCoach, type Draft } from './senders';
import { starters } from './roster';
import { TRADE_DEADLINE_WEEK } from './trade/rules';
import type { League, MailSection, Player } from './types';
import { mottoOf, recentBodies, say, toldKeys } from './voice';
import { teamCoaches } from './coaching';
import { DOWN_REASONS, moraleContext, moraleView } from './morale';

const fullName = (p: { firstName: string; lastName: string }) => `${p.firstName} ${p.lastName}`;
const ORDER: readonly Checkin[] = ['camp', 'cutdown', 'deadline', 'end'];

const SUBJECT: Record<Checkin, string> = {
  camp: 'Locker room: camp opens',
  cutdown: 'Locker room: after cut-down',
  deadline: 'Locker room: deadline week',
  end: 'Locker room: the year in the room',
};

/**
 * The check-in that's due, or null: camp once captains are named, cut-down day in the regular season's first weeks,
 * deadline week from the deadline on (a sim that jumps past cut-down files only this one), the season's end in the
 * re-sign window. One of each a league year.
 */
export function dueCheckin(league: League, have: Set<string>): Checkin | null {
  const { phase, week, season } = league;
  const due: Checkin | null =
    phase === 'preseason'
      ? league.teams[league.userTeamId].captains?.season === season
        ? 'camp'
        : null
      : phase === 'regular'
        ? week >= TRADE_DEADLINE_WEEK
          ? 'deadline'
          : 'cutdown'
        : phase === 'playoffs'
          ? 'deadline'
          : phase === 'resign'
            ? 'end'
            : null;
  if (!due) return null;
  // Once a later check-in has filed, an earlier one never does.
  const football = footballSeason(league, due);
  if (ORDER.slice(ORDER.indexOf(due)).some((c) => have.has(`locker:${football}:${c}`))) return null;
  return due;
}

/** Which check-in a date falls in, by phase and week: the window each report covers. */
function windowOf(phase: League['phase'], week: number): Checkin | null {
  if (phase === 'preseason') return 'camp';
  if (phase === 'regular') return week >= TRADE_DEADLINE_WEEK ? 'deadline' : 'cutdown';
  if (phase === 'playoffs') return 'deadline';
  if (phase === 'resign') return 'end';
  return null;
}

/**
 * A GM who took the job inside a check-in's window skips that report: his first day is the owner's welcome and the
 * head coach's rundown of the team, and the room's first report is the next one.
 */
function arrivedDuring(league: League, c: Checkin): boolean {
  const welcome = [...(league.inbox ?? [])].reverse().find((m) => m.id.includes(':welcome:'));
  return !!welcome && welcome.season === league.season && windowOf(welcome.phase, welcome.week) === c;
}

/** The season a check-in is about: the re-sign window falls in the new league year but looks back on the last one. */
const footballSeason = (league: League, c: Checkin) => (c === 'end' ? league.season - 1 : league.season);

export function lockerReportMail(league: League, have: Set<string>): Draft[] {
  const checkin = dueCheckin(league, have);
  // A welcome in this delivery's batch (not on file yet) is a GM arriving today.
  const filed = new Set((league.inbox ?? []).map((m) => m.id));
  const arrivingNow = [...have].some((x) => x.includes(':welcome:') && !filed.has(x));
  if (!checkin || arrivingNow || arrivedDuring(league, checkin)) return [];
  const { season } = league;
  // The seasons whose news this report can tell: the season's end looks back on the one just played as well as the
  // new league year's first days; every other check-in, this season.
  const inWindow = (s: number) => s === season || s === footballSeason(league, checkin);
  const user = league.userTeamId;
  const id = `locker:${footballSeason(league, checkin)}:${checkin}`;
  const told = toldKeys(league);
  for (const k of have) told.add(k);
  const covered: string[] = [];
  const fresh = (key: string) => {
    if (told.has(key)) return false;
    told.add(key);
    covered.push(key);
    return true;
  };
  const sender = headCoach(league);
  const recent = recentBodies(league, sender.from);
  const at = (slot: string) => ({ key: id, slot, recent });
  const ours = Object.values(league.players).filter((p) => p.teamId === user && !p.retired);
  const team = league.teams[user];
  const sections: MailSection[] = [];

  // Captains and leaders: camp only.
  // Captains and leaders: camp's report, or the season's first report when camp went by unseen (a sim straight to the
  // season, a new GM).
  if (checkin !== 'end' && team.captains?.season === season && fresh(`captains:${season}`)) {
    const c = team.captains;
    const starting = new Set(
      (['QB', 'RB', 'WR', 'TE', 'OL', 'DT', 'EDGE', 'LB', 'CB', 'S'] as const).flatMap((pos) =>
        starters(league, team, pos).map((p) => p.id),
      ),
    );
    const rows: MailSection['rows'] = [];
    for (const [role, pid, label] of [
      ['offense', c.offense, 'Offense captain'],
      ['defense', c.defense, 'Defense captain'],
      ['specialTeams', c.specialTeams, 'Special teams captain'],
    ] as const) {
      const p = league.players[pid];
      if (!p) continue;
      const read = personalityRead(league, user, p);
      rows.push({
        playerId: p.id,
        cells: [fullName(p), label, read?.name ?? 'Still reading him'],
        note: say(
          CAPTAIN_WHY,
          {
            role,
            experience: p.experience,
            read: read?.name ?? null,
            tone: read ? personalityTone(read.name) : null,
            kicker: p.position === 'K' || p.position === 'P',
            qb: p.position === 'QB' && starting.has(p.id),
          },
          at(`captain:${p.id}`),
        ),
      });
    }
    for (const p of leadersOf(league, user))
      rows.push({
        playerId: p.id,
        cells: [fullName(p), 'Leader', personalityRead(league, user, p)?.name ?? 'Still reading him'],
      });
    if (rows.length) sections.push({ title: 'Captains and leaders', columns: ['Player', 'Role', 'Our read'], rows });
  }

  // Morale, as our staff see it (`moraleView`): who slipped since the last report, worst first; who came around; then
  // a couple of the happiest. A man still down from last time was told then.
  const fs = footballSeason(league, checkin);
  const last = new Map<number, 'down' | 'up'>();
  const earlier = ORDER.slice(0, ORDER.indexOf(checkin));
  const prev = [...earlier].reverse().find((c) => told.has(`locker:${fs}:${c}`));
  if (prev)
    for (const k of told) {
      const hit = k.match(/^morale:(\d+):(\w+):(\d+):(down|up)$/);
      if (hit && Number(hit[1]) === fs && hit[2] === prev) last.set(Number(hit[3]), hit[4] as 'down' | 'up');
    }
  const moodCtx = moraleContext(league);
  const moods = ours.flatMap((p) => {
    const view = moraleView(league, p, moodCtx);
    return view ? [{ p, view }] : [];
  });
  const down = moods.filter((m) => m.view.step <= 3).sort((a, b) => a.view.level - b.view.level || a.p.id - b.p.id);
  const slipped = down.filter((m) => last.get(m.p.id) !== 'down');
  const back = moods.filter((m) => m.view.step >= 4 && last.get(m.p.id) === 'down');
  const flying = moods
    .filter((m) => m.view.step >= 6 && last.get(m.p.id) !== 'up' && !back.includes(m))
    .sort((a, b) => b.view.level - a.view.level || a.p.id - b.p.id)
    .slice(0, 2);
  const morale: MailSection['rows'] = [];
  // A promise kept or broken since the last report comes first, told once; it's that man's row this time.
  const promised = new Set<number>();
  for (const { p } of moods)
    for (const j of p.morale?.jolts ?? []) {
      if ((j.kind !== 'kept' && j.kind !== 'broken') || !fresh(`promise:${fs}:${p.id}:${j.at}`)) continue;
      promised.add(p.id);
      const reason = j.kind === 'kept' ? 'You kept your word' : 'You broke your word';
      morale.push({
        playerId: p.id,
        cells: [fullName(p), j.kind === 'kept' ? 'Promise kept' : 'Promise broken'],
        note: say(MORALE_NOTE, { name: p.lastName, reason, happy: false }, at(`promise:${p.id}`)),
      });
    }
  // The worst six by name: a letter is not the room's whole list (the Locker Room screen is).
  const listed = slipped.slice(0, 6);
  for (const { p, view } of [...listed, ...back, ...flying].filter((m) => !promised.has(m.p.id))) {
    const isBack = back.some((m) => m.p.id === p.id);
    const happy = !isBack && view.step >= 6;
    const reason = view.reasons.find((r) => (happy ? !DOWN_REASONS.has(r) : DOWN_REASONS.has(r))) ?? null;
    morale.push({
      playerId: p.id,
      cells: [fullName(p), view.word],
      note: say(
        MORALE_NOTE,
        { name: p.lastName, reason, happy, back: isBack, costing: !happy && !isBack && view.effect === 'costing' },
        at(`morale:${p.id}`),
      ),
    });
  }
  // Every man down (or flying) now is on file for the next report to compare with, listed here or not.
  for (const { p } of down) covered.push(`morale:${fs}:${checkin}:${p.id}:down`);
  // Every man flying is on file, named this time or last, so a man up all season is named once.
  for (const m of moods)
    if (m.view.step >= 6 && !back.includes(m)) covered.push(`morale:${fs}:${checkin}:${m.p.id}:up`);
  const more = slipped.length - listed.length;
  if (morale.length)
    sections.push({
      title: 'Morale',
      ...(more > 0 ? { lead: say(MORALE_LEAD, { more }, at('morale-lead')) } : {}),
      columns: ['Player', 'Mood'],
      rows: morale,
    });

  // Mentoring: who lost his mentor since the last report, then every pair and how it's going.
  const mentoring: MailSection['rows'] = [];
  let lost = 0;
  let lostName: string | null = null;
  let struggling = 0;
  for (const p of ours) {
    const l = p.lostMentor;
    const was = l && league.players[l.id];
    if (!l || !inWindow(l.season) || !was || !fresh(`mentor:${l.season}:${l.week}:gone:${p.id}`)) continue;
    lost++;
    lostName ??= p.lastName;
    const now = p.mentor === undefined ? undefined : league.players[p.mentor];
    mentoring.push({
      playerId: p.id,
      cells: [fullName(p), now ? `now with ${fullName(now)}` : 'no mentor yet', `lost ${fullName(was)}`],
      note: say(
        MENTOR_LOST,
        { name: p.lastName, mentor: fullName(was), now: now ? fullName(now) : null, byYou: !!team.mentoringByYou },
        at(`lost:${p.id}`),
      ),
    });
  }
  // The pairs that work are a count in the section's line; only the ones that don't get a row.
  const going = { 'learning well': 0, 'early days': 0 };
  const suggested = new Map<number, number>();
  if (checkin !== 'end')
    for (const p of ours) {
      if (p.mentor === undefined || mentoring.some((r) => r.playerId === p.id)) continue;
      const m = league.players[p.mentor];
      if (!m) continue;
      const status = mentorStatus(league, p);
      const bad = status === 'not taking' || status === 'picking up his bad habits';
      if (!bad) {
        going[status as keyof typeof going]++;
        continue;
      }
      struggling++;
      const better = betterMentor(league, user, p, suggested);
      if (better) suggested.set(better.id, (suggested.get(better.id) ?? 0) + 1);
      mentoring.push({
        playerId: p.id,
        cells: [fullName(p), `mentored by ${fullName(m)}`, status],
        note: say(
          MENTOR_SUGGEST,
          { name: p.lastName, mentor: m.lastName, better: better ? fullName(better) : null, status },
          at(`suggest:${p.id}`),
        ),
      });
    }
  const pairsLine = [
    going['learning well'] && `${going['learning well']} learning well`,
    going['early days'] && `${going['early days']} too early to tell`,
  ]
    .filter(Boolean)
    .join(', ');
  if (mentoring.length)
    sections.push({
      title: 'Mentoring',
      ...(pairsLine ? { lead: `The other pairs: ${pairsLine}.` } : {}),
      columns: ['Player', 'Mentor', "How it's going"],
      rows: mentoring,
    });

  // Friction: feuds that started this season, each once. A feud told before that's still on goes in the verdict.
  const friction: MailSection['rows'] = [];
  let standing: string | null = null;
  for (const a of ours)
    for (const t of a.ties ?? []) {
      const b = league.players[t.with];
      if (t.kind !== 'feud' || !inWindow(t.since) || !b || b.id < a.id || b.teamId !== user) continue;
      const key = `feud:${t.since}:${a.id}:${b.id}`;
      if (told.has(key) && !covered.includes(key)) {
        standing ??= `${a.lastName} and ${b.lastName}`;
        continue;
      }
      if (!fresh(key)) continue;
      friction.push({
        playerId: a.id,
        cells: [fullName(a), `with ${fullName(b)}`],
        note: say(FRICTION, { why: t.why }, at(`feud:${a.id}:${b.id}`)),
      });
    }
  if (friction.length)
    sections.push({
      title: 'Friction',
      lead: say(FRICTION_LEAD, { n: friction.length }, at('friction')),
      columns: ['Player', 'With'],
      rows: friction,
    });

  // Getting along: new friendships, and a man whose friend we cut or traded this season.
  const along: MailSection['rows'] = [];
  for (const a of ours)
    for (const t of a.ties ?? []) {
      const b = league.players[t.with];
      if (t.kind !== 'friend' || !b) continue;
      const gone = b.left?.find((d) => d.teamId === user && inWindow(d.season) && d.how !== 'walked');
      if (gone && b.teamId !== user) {
        if (!fresh(`friend:${gone.season}:left:${a.id}:${b.id}`)) continue;
        along.push({
          playerId: a.id,
          cells: [fullName(a), `${fullName(b)}, ${gone.how === 'cut' ? 'released' : 'traded'}`],
          note: say(
            GETTING_ALONG,
            { a: a.lastName, b: b.lastName, gone: gone.how === 'cut' ? 'cut' : 'traded' },
            at(`gone:${a.id}:${b.id}`),
          ),
        });
      } else if (inWindow(t.since) && b.teamId === user && a.id < b.id && fresh(`friend:${t.since}:${a.id}:${b.id}`))
        along.push({
          playerId: a.id,
          cells: [fullName(a), `with ${fullName(b)}`],
          note: say(GETTING_ALONG, { a: a.lastName, b: b.lastName }, at(`friend:${a.id}:${b.id}`)),
        });
    }
  if (along.length) sections.push({ title: 'Getting along', columns: ['Player', 'With'], rows: along });

  // Grew up: the season's end only, after mentoring's year has landed.
  const grew: MailSection['rows'] = [];
  if (checkin === 'end')
    for (const p of ours) {
      const by = p.mentoredBy?.at(-1);
      const mentor = by && league.players[by.id];
      if (mentor && (p.shiftedLast?.workEthic ?? 0) >= 0.5 && fresh(`mentor:${season}:took:${p.id}`))
        grew.push({
          playerId: p.id,
          cells: [fullName(p), `learned from ${fullName(mentor)}`],
          note: say(GREW_UP, { name: p.lastName, mentor: fullName(mentor) }, at(`took:${p.id}`)),
        });
      const change = grownUp(p, season);
      if (change && fresh(`persona:${season}:${p.id}`))
        grew.push({
          playerId: p.id,
          cells: [fullName(p), `now "${change.is}"`],
          note: say(GREW_UP, { name: p.lastName, ...change }, at(`grew:${p.id}`)),
        });
    }
  if (grew.length) sections.push({ title: 'Grew up', columns: ['Player', 'What changed'], rows: grew });

  const fact: VerdictFact = {
    checkin,
    newFeuds: friction.length,
    standing,
    lost,
    lostName,
    struggling,
    friends: along.length,
    grew: grew.length,
    unhappy: slipped.length,
  };
  const verdict = say(VERDICT, fact, at('verdict'));
  const asksMotto = VERDICT.find((l) => l.text(fact) === verdict)?.motto;
  const coach = teamCoaches(league, user).find((c) => c.role === 'headCoach');
  const motto = asksMotto && coach ? mottoOf(coach.id) : '';
  return [
    {
      id,
      season,
      phase: league.phase,
      week: league.phase === 'regular' || league.phase === 'playoffs' ? league.week : 0,
      ...sender,
      category: 'staff',
      subject: SUBJECT[checkin],
      body:
        (motto && !verdict.includes(motto) ? `${verdict} ${motto}` : verdict) +
        (!mentoring.length && pairsLine ? `\n\nThe mentoring pairs: ${pairsLine}.` : ''),
      ...(sections.length ? { sections } : {}),
      covered,
      actions: [{ kind: 'locker' }],
    },
  ];
}

/**
 * Our staff's read of him a year ago against now, when the year changed it for the better: mentoring's mark landing
 * at the new league year. (A change for the worse is the friction section's and the card's to tell.)
 */
function grownUp(p: Player, season: number): { was: string; is: string } | null {
  const last = p.shiftedLast;
  if (!last || last.season !== season) return null;
  const before = { ...trueCharacter(p) };
  for (const k of ['workEthic', 'temperament', 'poise'] as const)
    before[k] = p.traits[k] + (p.shifts?.[k] ?? 0) - (last[k] ?? 0);
  const now = { ...trueCharacter(p) };
  for (const k of ['workEthic', 'temperament', 'poise'] as const) now[k] = p.traits[k] + (p.shifts?.[k] ?? 0);
  const was = personalityOf(before);
  const is = personalityOf(now);
  const rank = { warn: 0, neutral: 1, good: 2 } as const;
  return rank[personalityTone(is)] > rank[personalityTone(was)] ? { was, is } : null;
}
