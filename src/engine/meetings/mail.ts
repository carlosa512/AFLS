import { MONTHS } from '../awards';
import { employed } from '../employment';
import { moraleContext, YEAR } from '../morale';
import { captainsNow, weightOf } from '../standing';
import { headCoach, type Draft } from '../senders';
import { computeRecords } from '../season/standings';
import type { League, MailSection, MeetingRecord, MeetingScope, Player, TeamMeetings } from '../types';
import { recentBodies, say } from '../voice';
import { credibilityRead, type CredibilityRead } from './credibility';
import { deadlineClock } from './commitments';
import { manFact, reasonFor, SCOPE_NOUN, styleOf, suggestFact, type ManFact } from './facts';

import { headCoachOf, meetingsOf, membersOf, stepClock } from './suggest';
import { traitOf } from '../coachTraits';
import {
  ASK,
  CANDID,
  CAPTAIN_CLOSE,
  CAPTAIN_OPEN,
  DUE,
  MOMENT_LEAD,
  NEXT,
  promisePhrase,
  READ_LEAD,
  READ_ROOM,
  READ_WHY,
  restLine,
  SNN_RUMOR,
  TOLD,
  WENT,
  yearParagraph,
  type YearFact,
} from './voice';

/**
 * The meetings' letters (L2, spec §5), filed by `deliverMail` like every letter: the head coach's suggestion (what a
 * choice shows is read off the league as it is: `meetingCard`), the result of a meeting, a captain's word after your
 * address; and what the staff notes, the season's-end report and SNN add.
 */

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export const suggestionId = (season: number, clock: number, scope: MeetingScope) =>
  `meeting:${season}:${clock}:${scope}`;
export const resultId = (season: number, clock: number, scope: MeetingScope) =>
  `meeting-result:${season}:${clock}:${scope}`;
export const captainId = (season: number, clock: number) => `meeting-captain:${season}:${clock}`;

const SUBJECT_MOMENT = {
  camp: 'Camp: a word with the team',
  newCoach: 'A first word with the team',
  deadline: 'Deadline week: a word with the team',
  push: 'The push: a word with the team',
  final: 'The final: a word the night before',
  end: "The season's end: a word with the team",
} as const;

const base = (league: League) => ({
  season: league.season,
  phase: league.phase,
  week: league.phase === 'regular' || league.phase === 'playoffs' ? league.week : 0,
  category: 'staff' as const,
});

/** The head coach's suggestion waiting on you, as a letter: his read, then his ask. */
function suggestionLetter(league: League, have: Set<string>): Draft[] {
  const teamId = league.userTeamId;
  const m = meetingsOf(league.teams[teamId]);
  const s = m.pending;
  if (!s || s.kind === 'gm') return [];
  const id = suggestionId(league.season, s.clock, s.scope);
  if (have.has(id)) return [];
  const f = suggestFact(league, teamId, s);
  const key = { key: id, recent: recentBodies(league, headCoach(league).from) };
  const paragraphs =
    s.kind === 'moment' && s.moment
      ? [MOMENT_LEAD[s.moment], say(ASK, f, { ...key, slot: 'ask' })]
      : [
          [say(READ_LEAD, f, { ...key, slot: 'lead' }), say(READ_WHY, f, { ...key, slot: 'why' })]
            .filter(Boolean)
            .join(' '),
          say(READ_ROOM, f, { ...key, slot: 'room' }),
          say(ASK, f, { ...key, slot: 'ask' }),
        ];
  return [
    {
      ...base(league),
      id,
      ...headCoach(league),
      subject: s.moment
        ? SUBJECT_MOMENT[s.moment]
        : `${cap(SCOPE_NOUN[s.scope])} ${s.scope === 'team' ? 'needs' : 'wants'} a word`,
      body: paragraphs.filter(Boolean).join('\n\n'),
      actions: [{ kind: 'locker' }],
    },
  ];
}

const WEEKS = ['', 'a week', 'two weeks', 'three weeks', 'four weeks', 'five weeks', 'six weeks'];

/** The window in words: "four weeks", "the deadline". */
function windowWords(opened: number, closes: number): string {
  if (closes === deadlineClock(Math.floor(opened / YEAR))) return 'the deadline';
  const n = closes - opened;
  return WEEKS[n] ?? 'a few weeks';
}

const men = (league: League, ids: number[]): ManFact[] =>
  ids.flatMap((id) => (league.players[id] ? [manFact(league, league.players[id])] : []));

/** A meeting held: what he told them, how it went, where that leaves us. */
function resultLetter(league: League, r: MeetingRecord): Draft {
  const teamId = league.userTeamId;
  const id = resultId(league.season, r.clock, r.scope);
  const ctx = moraleContext(league);
  const hc = headCoachOf(league, teamId);
  const style = styleOf(hc ? traitOf(hc, 'discipline') : 10.5);
  const noun = SCOPE_NOUN[r.scope];
  const c = meetingsOf(league.teams[teamId]).open.find((x) => x.opened === r.clock && x.scope === r.scope);
  const named = men(league, c?.named ?? []);
  const speaker =
    r.speaker !== undefined && league.players[r.speaker] ? manFact(league, league.players[r.speaker]) : undefined;
  const key = { key: id, recent: recentBodies(league, headCoach(league).from) };
  const told = say(
    TOLD,
    {
      style,
      approach: r.approach,
      backing: r.backing,
      topic: r.topic ?? 'none',
      noun,
      named,
      speaker,
      ...(r.moment ? { moment: r.moment } : {}),
    },
    { ...key, slot: 'told' },
  );
  // Who to name: two who took it well and one who bristled, the room's heaviest first.
  const byWeight = (ids: number[]) =>
    ids
      .map((pid) => league.players[pid])
      .filter((p): p is Player => !!p)
      .sort((a, b) => weightOf(league, b, ctx) - weightOf(league, a, ctx) || a.id - b.id);
  const went = [
    ...byWeight(r.outcomes.lands)
      .slice(0, 2)
      .map((p) => ({ p, outcome: 'lands' as const })),
    ...byWeight(r.outcomes.bristles)
      .slice(0, 1)
      .map((p) => ({ p, outcome: 'bristles' as const })),
  ].map(({ p, outcome }) =>
    say(
      WENT,
      {
        man: manFact(league, p),
        outcome,
        reason: reasonFor(league, teamId, p, r, outcome === 'lands', ctx),
        topic: r.topic ?? 'none',
      },
      { ...key, slot: `went:${p.id}` },
    ),
  );
  const room = membersOf(league, teamId, r.scope).length;
  const shrugs = room - r.outcomes.lands.length - r.outcomes.bristles.length;
  const rest = restLine(Math.max(0, shrugs), noun);
  const next = say(
    NEXT,
    { backing: r.backing, noun, named, window: c ? windowWords(c.opened, c.closes) : 'a few weeks' },
    { ...key, slot: 'next' },
  );
  const rows: MailSection['rows'] =
    r.backing === 'talks'
      ? named.map((n) => ({
          playerId: n.id,
          cells: [`${n.first} ${n.last}`],
          note: `Talks with his agent: ${windowWords(c!.opened, c!.closes)}.`,
          negotiate: { playerId: n.id },
        }))
      : [];
  return {
    ...base(league),
    id,
    ...headCoach(league),
    subject: `How it went with ${noun}`,
    body: [`What I told them: “${told}”`, [...went, rest].filter(Boolean).join(' '), next].join('\n\n'),
    ...(rows.length ? { sections: [{ title: 'What we owe them', rows }] } : {}),
    actions: [{ kind: 'locker' }],
  };
}

/** After your address: the captain the room listens to most, for the players. */
function captainLetter(league: League, r: MeetingRecord): Draft | null {
  const teamId = league.userTeamId;
  const team = league.teams[teamId];
  const c = captainsNow(league, team);
  if (!c) return null;
  const ctx = moraleContext(league);
  const capt = [c.offense, c.defense]
    .map((id) => league.players[id])
    .filter((p): p is Player => !!p && p.teamId === teamId)
    .sort((a, b) => weightOf(league, b, ctx) - weightOf(league, a, ctx))[0];
  if (!capt) return null;
  const lands = r.outcomes.lands.length;
  const bristles = r.outcomes.bristles.length;
  const room = Math.max(1, membersOf(league, teamId, 'team').length);
  const went = bristles > lands ? 'flopped' : lands >= 2 * bristles && lands / room >= 0.3 ? 'landed' : 'mixed';
  const rec = computeRecords(league).get(teamId);
  const record = rec && rec.l > rec.w ? 'losing' : rec && rec.w > rec.l ? 'winning' : 'even';
  const id = captainId(league.season, r.clock);
  const open = say(CAPTAIN_OPEN, { approach: r.approach, backing: r.backing, went, record }, { key: id, slot: 'open' });
  const side = c.defense === capt.id ? 'Defensive captain' : 'Offensive captain';
  return {
    ...base(league),
    id,
    from: `${capt.firstName} ${capt.lastName}, ${side}`,
    subject: 'About what you said',
    body: [open, went === 'flopped' ? '' : CAPTAIN_CLOSE[r.backing]].filter(Boolean).join(' '),
    actions: [{ kind: 'player', playerId: capt.id }],
  };
}

/** Results and the captain's word for meetings held at your club this league year, each once. */
function heldLetters(league: League, have: Set<string>): Draft[] {
  const out: Draft[] = [];
  for (const r of meetingsOf(league.teams[league.userTeamId]).log) {
    if (Math.floor(r.clock / YEAR) !== league.season) continue;
    if (r.kind === 'gm') {
      const id = captainId(league.season, r.clock);
      if (have.has(id)) continue;
      const letter = captainLetter(league, r);
      if (letter) out.push(letter);
    } else {
      if (have.has(resultId(league.season, r.clock, r.scope))) continue;
      out.push(resultLetter(league, r));
    }
  }
  return out;
}

/** The meetings' own letters for your club. */
export function meetingMail(league: League, have: Set<string>): Draft[] {
  if (!employed(league)) return [];
  const out = [...heldLetters(league, have), ...suggestionLetter(league, have), ...rumorMail(league, have)];
  for (const d of out) have.add(d.id);
  return out;
}

/** A suggestion letter still asks while its suggestion is the one waiting. */
export function meetingNeedsYou(league: League, s: { clock: number; scope: MeetingScope }): boolean {
  const p = league.teams[league.userTeamId]?.meetings?.pending;
  return !!p && p.clock === s.clock && p.scope === s.scope;
}

// ───────── what the staff notes add ─────────

export interface StaffRow {
  key: string;
  playerId?: number;
  label: string;
  note: string;
  negotiate?: number;
}

const CRED_RANK: Record<CredibilityRead, number> = { wornThin: 0, heardBefore: 1, steady: 2, believes: 3 };

/** The head coach's own rows this week: a commitment coming due, and his word when it has moved since he last said. */
export function meetingStaffRows(league: League, told: Set<string>): StaffRow[] {
  const teamId = league.userTeamId;
  const m = league.teams[teamId].meetings;
  const clock = stepClock(league);
  const rows: StaffRow[] = [];
  for (const c of m?.open ?? []) {
    if (c.closes - clock !== 1) continue;
    const key = `due:${c.opened}:${c.scope}:${c.backing}`;
    if (told.has(key)) continue;
    const named = men(league, c.named);
    rows.push({
      key,
      ...(named[0] ? { playerId: named[0].id } : {}),
      label: named.length === 1 ? `${named[0].first} ${named[0].last}` : cap(SCOPE_NOUN[c.scope]),
      note: say(DUE, { backing: c.backing, noun: SCOPE_NOUN[c.scope], named }, { key, slot: 'due' }),
      ...(c.backing === 'talks' && named.length === 1 ? { negotiate: named[0].id } : {}),
    });
  }
  const hc = headCoachOf(league, teamId);
  if (hc) {
    const read = credibilityRead(hc);
    // What he last said about his word, if anything: `cred:<coach>:<read>:<clock>`.
    const last = [...told]
      .filter((k) => k.startsWith(`cred:${hc.id}:`))
      .map((k) => k.split(':'))
      .sort((a, b) => Number(b[3]) - Number(a[3]))[0];
    const lastRead = last?.[2] as CredibilityRead | undefined;
    const changed = lastRead ? lastRead !== read : read !== 'steady';
    if (changed) {
      const key = `cred:${hc.id}:${read}:${clock}`;
      rows.push({
        key,
        label: 'The room',
        note: say(
          CANDID,
          { read, better: !!lastRead && CRED_RANK[read] > CRED_RANK[lastRead] },
          { key, slot: 'candid' },
        ),
      });
    }
  }
  return rows.filter((r) => r.note);
}

// ───────── the season's-end report ─────────

const monthOfClock = (clock: number): string => {
  const week = (clock % YEAR) - 8;
  if (week < 1) return clock % YEAR === 7 ? 'camp' : 'the spring';
  return (MONTHS.find((x) => week >= x.weeks[0] && week <= x.weeks[1])?.label ?? 'January').replace(
    'December/January',
    'December',
  );
};

/** The year's meetings at your club, for the re-sign window's report. */
export function yearFact(league: League): YearFact | null {
  const y: TeamMeetings['lastYear'] = league.teams[league.userTeamId].meetings?.lastYear;
  if (!y || y.season !== league.season - 1 || !y.held) return null;
  const kept = y.settled.find((x) => x.kept);
  const broken = y.settled.find((x) => !x.kept);
  const named = (ids: number[]) => men(league, ids);
  return {
    held: y.held,
    ...(kept
      ? {
          kept: {
            noun: SCOPE_NOUN[kept.scope] === 'the D-line' ? 'the line' : SCOPE_NOUN[kept.scope],
            month: monthOfClock(kept.clock),
            promise: promisePhrase(kept.backing, named(kept.named)),
            ...(kept.named.length === 1 ? { named: 'he' } : {}),
          },
        }
      : {}),
    ...(broken
      ? {
          broken: {
            when: broken.backing === 'move' ? 'the deadline' : monthOfClock(broken.clock),
            promise: promisePhrase(broken.backing, named(broken.named)),
          },
        }
      : {}),
  };
}

export const yearParagraphFor = (league: League): string => {
  const f = yearFact(league);
  return f ? yearParagraph(f) : '';
};

// ───────── SNN: a rumor for a coach clearly losing his room ─────────

/** SNN's item on it: rare by design (a word worn thin and a losing run), once a coach a season. */
function rumorMail(league: League, have: Set<string>): Draft[] {
  const r = snnRumor(league, have);
  if (!r) return [];
  return [
    {
      ...base(league),
      id: r.key,
      from: 'SNN league desk',
      category: 'league',
      subject: 'Around the league: a room slipping away',
      body: r.text,
      actions: [{ kind: 'gms' }],
    },
  ];
}

const RUN = ['', '', '', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];

/** One club this week whose head coach's word has worn thin while it loses, not yet rumored this season. */
export function snnRumor(league: League, told: Set<string>): { key: string; text: string } | null {
  if (league.phase !== 'regular') return null;
  const records = computeRecords(league);
  for (const team of league.teams) {
    if (team.id === league.userTeamId) continue;
    const hc = headCoachOf(league, team.id);
    if (!hc || credibilityRead(hc) !== 'wornThin') continue;
    const r = records.get(team.id);
    const streak = r?.streak ?? '';
    const n = streak[0] === 'L' ? Number(streak.slice(1)) : 0;
    if (n < 3) continue;
    const key = `rumor:${league.season}:${hc.id}`;
    if (told.has(key)) continue;
    return {
      key,
      text: say(
        SNN_RUMOR,
        {
          city: team.city,
          nickname: team.name,
          coach: `${hc.firstName} ${hc.lastName}`,
          winless: !!r && r.w === 0 && r.t === 0,
          run: RUN[n] ?? 'many',
        },
        { key, slot: 'rumor' },
      ),
    };
  }
  return null;
}
