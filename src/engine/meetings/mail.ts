import { MONTHS } from '../awards';
import { employed } from '../employment';
import { moraleContext, YEAR, type MoraleContext } from '../morale';
import { captainsNow, weightOf } from '../standing';
import { headCoach, type Draft } from '../senders';
import { computeRecords } from '../season/standings';
import type {
  Approach,
  CoachRoom,
  Backing,
  League,
  MailSection,
  MeetingSuggestion,
  Timing,
  MeetingRecord,
  MeetingScope,
  Player,
  TeamMeetings,
} from '../types';
import { manSheet } from '../castSheet';
import { readsDown, RESULT_MAN, RESULT_ROOM, SET_FOR, type ResultFact } from '../coachWeekVoice';
import { unitRead } from '../standing';
import { around, say, seasonSaid } from '../voice';
import { credibilityRead, type CredibilityRead } from './credibility';
import { deadlineClock } from './commitments';
import { manFact, SCOPE_NOUN, styleOf, suggestFact, type ManFact, type SuggestFact } from './facts';

import { gmAddressOpen } from './address';
import { COOLDOWN, headCoachOf, meetingsOf, membersOf, offCooldown, ROOMS, stepClock } from './suggest';
import { traitOf } from '../coachTraits';
import {
  approachLabel,
  ASK,
  ASK_CALL,
  ASK_CALL_MOMENT,
  ASK_OPEN,
  ASKED,
  backingLabel,
  CANDID,
  CAPTAIN_CLOSE,
  CAPTAIN_OPEN,
  DUE,
  MOMENT_LEAD,
  NEXT,
  promisePhrase,
  QUESTION,
  READ_LEAD,
  READ_ROOM,
  READ_WHY,
  SNN_RUMOR,
  TIMING_LABEL,
  TOLD,
  verb,
  yearParagraph,
  type YearFact,
} from './voice';

/**
 * The meetings' mail (L2, spec §5): the head coach's suggestion and a meeting's result are rows of his weekly letter
 * (`requestRow`, `resultRows`; what a choice shows is read off the league as it is: `meetingCard`); a captain's word
 * after your address and SNN's rumor are letters of their own; and what the staff notes and the season's-end report add.
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

/** The subject a suggestion goes by. */
const requestSubject = (s: MeetingSuggestion): string =>
  s.moment
    ? SUBJECT_MOMENT[s.moment]
    : s.asked
      ? `About ${SCOPE_NOUN[s.scope]}`
      : `${cap(SCOPE_NOUN[s.scope])} ${s.scope === 'team' ? 'needs' : verb(SCOPE_NOUN[s.scope], 'wants', 'want')} a word`;

/** What the head coach says of a suggestion: his lead and read, then what he wants to do about it. */
function requestWords(league: League, s: MeetingSuggestion, id: string, said: string[]): string[] {
  const f = suggestFact(league, league.userTeamId, s);
  const key = { key: id, ...around(league, said) };
  // His read is a plus: once he has said it this year he says no more, and the ask stands without it.
  const read = (): string => {
    const t = say(ASK, f, { ...key, slot: 'ask' });
    return t && !key.skip(t) ? t : '';
  };
  const ask = (): string =>
    [
      s.kind === 'moment' ? '' : say(ASK_OPEN, f, { ...key, slot: 'open' }),
      say(s.kind === 'moment' ? ASK_CALL_MOMENT : ASK_CALL, f, { ...key, slot: 'call' }),
      read(),
    ]
      .filter(Boolean)
      .join(' ');
  if (s.kind === 'moment' && s.moment) return [MOMENT_LEAD[s.moment], ask()];
  const lead = say(READ_LEAD, f, { ...key, slot: 'lead' });
  const why = f.driver && lead.includes(f.driver.last) ? say(READ_WHY, f, { ...key, slot: 'why' }) : '';
  return [
    [s.asked ? say(ASKED, f, { ...key, slot: 'asked' }) : '', lead, why].filter(Boolean).join(' '),
    say(READ_ROOM, f, { ...key, slot: 'room' }),
    ask(),
  ];
}

/**
 * The pending suggestion as a row of the weekly letter ("What I want to do"): his lead, his read and his ask as its
 * note, and the suggestion it asks about, so the letter draws its choices from the league as it is.
 */
export function requestRow(league: League): MailSection['rows'][number] | null {
  const s = meetingsOf(league.teams[league.userTeamId]).pending;
  if (!s || s.kind === 'gm' || !employed(league)) return null;
  const said = seasonSaid(league, headCoach(league).from, 'coach:');
  const id = suggestionId(league.season, s.clock, s.scope);
  return {
    cells: [requestSubject(s)],
    note: requestWords(league, s, id, said).filter(Boolean).join(' '),
    meeting: { clock: s.clock, scope: s.scope },
  };
}

/** The letter's opening and, only right after a lead that named him, why the man driving it matters ("He's…"). */
export function leadAndWhy(f: SuggestFact, key: { key: string; recent?: readonly string[] }): [string, string] {
  const lead = say(READ_LEAD, f, { ...key, slot: 'lead' });
  return [lead, f.driver && lead.includes(f.driver.last) ? say(READ_WHY, f, { ...key, slot: 'why' }) : ''];
}

const WEEKS = ['', 'a week', 'two weeks', 'three weeks', 'four weeks', 'five weeks', 'six weeks'];

/** The window in words, with its preposition: "within four weeks", "by the deadline". */
function windowWords(opened: number, closes: number): string {
  if (closes === deadlineClock(Math.floor(opened / YEAR))) return 'by the deadline';
  return `within ${WEEKS[closes - opened] ?? 'a few weeks'}`;
}

const men = (league: League, ids: number[]): ManFact[] =>
  ids.flatMap((id) => (league.players[id] ? [manFact(league, league.players[id])] : []));

/** The commitment a held meeting opened, while it is still open. */
const commitmentOf = (league: League, r: MeetingRecord) =>
  meetingsOf(league.teams[league.userTeamId]).open.find((x) => x.opened === r.clock && x.scope === r.scope);

/** The men a result names, each with how he took it: the commitment's, then two who landed and one who bristled. */
function namedByResult(
  league: League,
  r: MeetingRecord,
  ctx: MoraleContext,
): { p: Player; outcome: ResultFact['outcome'] }[] {
  const c = commitmentOf(league, r);
  // Who to name: the room's heaviest first.
  const byWeight = (ids: number[]) =>
    ids
      .map((pid) => league.players[pid])
      .filter((p): p is Player => !!p)
      .sort((a, b) => weightOf(league, b, ctx) - weightOf(league, a, ctx) || a.id - b.id);
  const outcomeOf = (p: Player): ResultFact['outcome'] =>
    r.outcomes.lands.includes(p.id) ? 'lands' : r.outcomes.bristles.includes(p.id) ? 'bristles' : 'none';
  const picked = [
    ...byWeight(c?.named ?? []),
    ...byWeight(r.outcomes.lands).slice(0, 2),
    ...byWeight(r.outcomes.bristles).slice(0, 1),
  ];
  return picked.filter((p, i) => picked.indexOf(p) === i).map((p) => ({ p, outcome: outcomeOf(p) }));
}

/** What he told them, in quotes: the same words however the result is filed. */
function toldWords(league: League, r: MeetingRecord, key: string, said: string[]): string {
  const teamId = league.userTeamId;
  const hc = headCoachOf(league, teamId);
  const c = commitmentOf(league, r);
  const speaker =
    r.speaker !== undefined && league.players[r.speaker] ? manFact(league, league.players[r.speaker]) : undefined;
  const told = say(
    TOLD,
    {
      style: styleOf(hc ? traitOf(hc, 'discipline') : 10.5),
      approach: r.approach,
      backing: r.backing,
      topic: r.topic ?? 'none',
      noun: SCOPE_NOUN[r.scope],
      named: men(league, c?.named ?? []),
      speaker,
      ...(r.moment ? { moment: r.moment } : {}),
    },
    { key, slot: 'told', ...around(league, said) },
  );
  said.push(told);
  return told;
}

/**
 * A result told from where each man is now, a step after the meeting: the commitment's men and the heaviest who took it
 * well or bristled, each by how he took it then and how he reads now; the room by its read now against its read then.
 * `said` is what the sender has already said this league year; every sentence used goes onto it.
 */
function resultParts(league: League, r: MeetingRecord, said: string[], limit = Infinity) {
  const teamId = league.userTeamId;
  const ctx = moraleContext(league);
  const key = resultId(league.season, r.clock, r.scope);
  const c = commitmentOf(league, r);
  const noun = SCOPE_NOUN[r.scope];
  const mens: MailSection['rows'] = [];
  for (const { p, outcome } of namedByResult(league, r, ctx).slice(0, limit)) {
    const man = manSheet(league, p, ctx);
    if (!man) continue;
    const note = say(
      RESULT_MAN,
      { man, outcome, named: !!c?.named.includes(p.id), nowDown: readsDown(man), topic: r.topic ?? 'none' },
      { key, slot: `man:${p.id}`, ...around(league, said) },
    );
    said.push(note);
    mens.push({ playerId: p.id, cells: [`${p.firstName} ${p.lastName}`], note });
  }
  const now = r.scope === 'team' ? null : (unitRead(league, teamId, r.scope as CoachRoom, ctx)?.word ?? null);
  const room = say(RESULT_ROOM, { noun, then: r.word ?? null, now }, { key, slot: 'room', ...around(league, said) });
  if (room) said.push(room);
  const next = say(
    NEXT,
    {
      backing: r.backing,
      noun,
      named: men(league, c?.named ?? []),
      window: c ? windowWords(c.opened, c.closes) : 'within a few weeks',
    },
    { key, slot: 'next', ...around(league, said) },
  );
  said.push(next);
  const talks: MailSection['rows'] =
    r.backing === 'talks' && c
      ? men(league, c.named).map((n) => ({
          playerId: n.id,
          cells: [`${n.first} ${n.last}`],
          note: `Talks with his agent, ${windowWords(c.opened, c.closes)}.`,
          negotiate: { playerId: n.id },
        }))
      : [];
  return { key, noun, mens, room, next, talks };
}

/**
 * A meeting's result as rows of the weekly letter: what he told the room and where that leaves us, as two paragraphs
 * that name the room themselves (the letter draws no label over them), then each player named and the Negotiate rows
 * for what we owe. A leader's words are the coach's report of them, so only the coach's own are quoted. `said` is what
 * the sender said this league year (`seasonSaid`), and grows as rows are written.
 */
export function resultRows(league: League, r: MeetingRecord, said: string[], men = Infinity): MailSection['rows'] {
  const { key, noun, mens, room, next, talks } = resultParts(league, r, said, men);
  const told = toldWords(league, r, key, said);
  const words = r.approach === 'leader' ? told : `${room ? 'I told them' : `I told ${noun}`}, “${told}”`;
  return [
    { cells: [cap(noun), 'What I told them'], note: `${room ? `${room} ` : ''}${words}` },
    { cells: [cap(noun), 'Where that leaves us'], note: next },
    ...mens,
    ...talks,
  ];
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

/** The captain's word for your address to the team this league year, once each (results are the weekly letter's). */
function heldLetters(league: League, have: Set<string>): Draft[] {
  const out: Draft[] = [];
  // A meeting at or before the step you took the job was held before you came: it isn't yours to hear about.
  const job = league.gms[league.userGmId]?.appointments.at(-1);
  const arrived = job?.teamId === league.userTeamId ? (job.clock ?? -Infinity) : -Infinity;
  for (const r of meetingsOf(league.teams[league.userTeamId]).log) {
    if (Math.floor(r.clock / YEAR) !== league.season || r.clock <= arrived) continue;
    if (r.kind !== 'gm') continue;
    const id = captainId(league.season, r.clock);
    if (have.has(id)) continue;
    const letter = captainLetter(league, r);
    if (letter) out.push(letter);
  }
  return out;
}

/** The meetings' own letters for your club. */
export function meetingMail(league: League, have: Set<string>): Draft[] {
  if (!employed(league)) return [];
  // SNN's rumor on a coach losing his room is a story of the weekly edition now (`snnRumor`, read by `snnWeek.ts`).
  const out = [...heldLetters(league, have)];
  for (const d of out) have.add(d.id);
  return out;
}

export interface MeetingCardView {
  /** Open: it waits on your call. Held: what you went ahead with. Passed: you said not now, or it lapsed. */
  state: 'open' | 'held' | 'passed';
  questions?: { approach: string; backing: string; timing: string };
  approaches?: { value: Approach; label: string }[];
  backings?: { value: Backing; label: string }[];
  timings?: { value: Timing; label: string }[];
  /** Your own address to the team: yours to give, not the coach's. */
  gm?: boolean;
  /** The time it's held when there's no choosing (a moment, your address). */
  timing?: Timing;
  /** Your club leaves these to the head coach. */
  byCoach?: boolean;
  /** What you went ahead with, in a sentence. */
  said?: string;
  /** Held: when it is set for, in the coach's words. The result comes in a later letter, never here. */
  setFor?: string;
}

/** What a suggestion letter shows now, read off the league: your club only. */
export function meetingCard(league: League, s: { clock: number; scope: MeetingScope }): MeetingCardView {
  const teamId = league.userTeamId;
  const m = league.teams[teamId]?.meetings;
  if (!m || !employed(league)) return { state: 'passed' };
  // The coach's letter: never your own address, which can share its week and scope.
  const held = m.log.find((r) => r.clock === s.clock && r.scope === s.scope && r.kind !== 'gm');
  const p = m.pending?.kind === 'gm' ? undefined : m.pending;
  const sugg = held ? pendingFrom(league, held) : p && p.clock === s.clock && p.scope === s.scope ? p : null;
  const f = sugg ? suggestFact(league, teamId, sugg) : null;
  if (held && f) {
    // The labels as you picked them (a name or a day keeps its capital).
    const parts = [approachLabel(held.approach, f), backingLabel(held.backing, f)];
    if (held.kind === 'trouble') parts.push(TIMING_LABEL[held.timing]);
    return {
      state: 'held',
      said: `You went ahead: ${parts.join(' · ')}`,
      setFor: say(
        SET_FOR,
        { timing: held.timing, scope: held.scope, noun: SCOPE_NOUN[held.scope], backing: held.backing },
        { key: `setFor:${held.clock}:${held.scope}`, slot: 'setFor' },
      ),
    };
  }
  if (!p || p.clock !== s.clock || p.scope !== s.scope || !f) return { state: 'passed' };
  const gm = p.kind === 'gm';
  return {
    state: 'open',
    questions: {
      approach: gm ? QUESTION.gmApproach : QUESTION.approach,
      backing: gm ? QUESTION.gmBacking : QUESTION.backing,
      timing: QUESTION.timing,
    },
    approaches: p.approaches.map((value) => ({ value, label: approachLabel(value, f) })),
    backings: p.backings.map((value) => ({ value, label: backingLabel(value, f) })),
    // One time on offer (your address is Monday's) isn't a question.
    timings: p.timings.length > 1 ? p.timings.map((value) => ({ value, label: TIMING_LABEL[value] })) : [],
    timing: p.timings[0] ?? 'monday',
    ...(gm ? { gm: true } : {}),
    ...(m.byCoach ? { byCoach: true } : {}),
  };
}

/** A held meeting's suggestion as far as its labels need it: who was named, from the commitment it opened. */
function pendingFrom(league: League, r: MeetingRecord): MeetingSuggestion {
  const c = league.teams[league.userTeamId].meetings?.open.find((x) => x.opened === r.clock && x.scope === r.scope);
  const settled = league.teams[league.userTeamId].meetings?.settled?.find(
    (x) => x.clock === r.clock && x.scope === r.scope,
  );
  const named = c?.named ?? settled?.named ?? [];
  return {
    clock: r.clock,
    scope: r.scope,
    kind: r.kind,
    topic: r.topic ?? 'none',
    approaches: [r.approach],
    backings: [r.backing],
    timings: [r.timing],
    named,
    ...(r.backing !== 'words' ? { namedFor: { [r.backing]: named } } : {}),
    ...(r.approach === 'callout' && r.speaker !== undefined ? { driver: r.speaker } : {}),
    ...(r.approach === 'leader' && r.speaker !== undefined ? { leader: r.speaker } : {}),
  };
}

/** A suggestion letter still asks while its suggestion is the one waiting. */
export function meetingNeedsYou(league: League, s: { clock: number; scope: MeetingScope }): boolean {
  const p = league.teams[league.userTeamId]?.meetings?.pending;
  return !!p && p.kind !== 'gm' && p.clock === s.clock && p.scope === s.scope;
}

// ───────── the Locker Room screen ─────────

export interface RoomMeetingView {
  scope: MeetingScope;
  /** You can ask the head coach to meet with them now. */
  canAsk: boolean;
  /** Why not, in words, when you can't. */
  why?: string;
  /** What we told them and still owe, a sentence each, with the men it names (a screen links them). */
  owed: { text: string; named: number[] }[];
}

export interface MeetingsView {
  rooms: RoomMeetingView[];
  /** Why no room can be asked right now, said once (a room's own `why` is only its cooldown). */
  blocked?: string;
  /** A crisis has opened your address to the team, and nothing else waits on you. */
  address: boolean;
  /** What waits on your call, if anything: its letter's key. */
  pending?: { clock: number; scope: MeetingScope };
  byCoach: boolean;
}

/** What the Locker Room shows of meetings: each room's ask and what we owe it. Your club only. */
export function meetingsView(league: League): MeetingsView | null {
  const teamId = league.userTeamId;
  const team = league.teams[teamId];
  if (!team || !employed(league)) return null;
  const m = team.meetings;
  const clock = stepClock(league);
  const hc = headCoachOf(league, teamId);
  const metThisWeek = !!m?.log.some((r) => clock - r.clock < COOLDOWN.week);
  const blocked = !hc
    ? "We don't have a head coach to hold one."
    : m?.pending
      ? 'Answer what the coach suggested first.'
      : metThisWeek
        ? "We've already had a meeting this week."
        : m?.lastOffer !== undefined && clock - m.lastOffer < COOLDOWN.week
          ? 'The coach brought you one this week already.'
          : undefined;
  const rooms = ([...ROOMS, 'team'] as MeetingScope[]).map((scope): RoomMeetingView => {
    const why = blocked
      ? undefined
      : !offCooldown(league, teamId, scope)
        ? scope === 'team'
          ? 'The team met not long ago.'
          : 'They met not long ago.'
        : undefined;
    const owed = (m?.open ?? [])
      .filter((c) => c.scope === scope)
      .map((c) => {
        const left = c.closes - clock;
        const when =
          c.closes === deadlineClock(league.season)
            ? 'at the deadline'
            : left <= 1
              ? 'this week'
              : `in ${WEEKS[left] ?? 'a few weeks'}`;
        return {
          text: `We told them ${promisePhrase(c.backing, men(league, c.named))}, and it comes due ${when}.`,
          named: [...c.named],
        };
      });
    return { scope, canAsk: !blocked && !why, ...(why ? { why } : {}), owed };
  });
  return {
    rooms,
    ...(blocked ? { blocked } : {}),
    address: !m?.pending && gmAddressOpen(league, teamId),
    ...(m?.pending ? { pending: { clock: m.pending.clock, scope: m.pending.scope } } : {}),
    byCoach: !!m?.byCoach,
  };
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

/** A commitment's due row: its key (told once), who it names, and the head coach's warning. */
export interface DueRow {
  key: string;
  playerId?: number;
  label: string;
  note: string;
  negotiate?: number;
}

/**
 * Your club's open commitments within `window` steps of coming due, each once (`due:` keys): every one of them, whether
 * or not a story holds it, since most have none. Its words are chosen around `said`, which grows.
 */
export function dueRows(league: League, told: Set<string>, said: string[], window: number): DueRow[] {
  const teamId = league.userTeamId;
  const clock = stepClock(league);
  const inSeason = league.phase === 'regular' || league.phase === 'playoffs';
  const rows: DueRow[] = [];
  for (const c of league.teams[teamId].meetings?.open ?? []) {
    const left = c.closes - clock;
    if (left < 1 || left > window) continue;
    const key = `due:${c.opened}:${c.scope}:${c.backing}`;
    if (told.has(key)) continue;
    const named = men(league, c.named);
    // Steps are weeks in the season; away from it they are the calendar's moments, so "soon" is all that is true.
    const when = !inSeason ? 'soon' : left === 1 ? 'next week' : 'in two weeks';
    const note = say(
      DUE,
      { backing: c.backing, noun: SCOPE_NOUN[c.scope], named, when, ...(c.by === 'gm' ? { you: true } : {}) },
      { key, slot: 'due', ...around(league, said) },
    );
    if (!note) continue;
    said.push(note);
    rows.push({
      key,
      ...(named[0] ? { playerId: named[0].id } : {}),
      label: named.length === 1 ? `${named[0].first} ${named[0].last}` : cap(SCOPE_NOUN[c.scope]),
      note,
      ...(c.backing === 'talks' && named.length === 1 ? { negotiate: named[0].id } : {}),
    });
  }
  return rows;
}

/** The head coach's word with the players, when it has moved since he last said (`cred:` keys). */
export function meetingStaffRows(league: League, told: Set<string>, said?: string[]): StaffRow[] {
  const teamId = league.userTeamId;
  const clock = stepClock(league);
  const rows: StaffRow[] = [];
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
        label: 'My word with the players',
        note: say(
          CANDID,
          { read, better: !!lastRead && CRED_RANK[read] > CRED_RANK[lastRead] },
          { key, slot: 'candid', ...(said ? around(league, said) : {}) },
        ),
      });
      if (said) said.push(rows.at(-1)!.note);
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
            ...(kept.by === 'gm' ? { you: true } : {}),
          },
        }
      : {}),
    ...(broken
      ? {
          broken: {
            when: broken.backing === 'move' ? 'the deadline' : monthOfClock(broken.clock),
            promise: promisePhrase(broken.backing, named(broken.named)),
            ...(broken.by === 'gm' ? { you: true } : {}),
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

const RUN = ['', '', '', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];

/**
 * One club this week whose head coach's word has worn thin while it loses, not yet rumored this season: rare by design,
 * once a coach a season. SNN's weekly edition tells it.
 */
export function snnRumor(
  league: League,
  told: Set<string>,
): { key: string; text: string; teamId: number; coachId: number } | null {
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
      teamId: team.id,
      coachId: hc.id,
      text: say(
        SNN_RUMOR,
        {
          city: team.city,
          nickname: team.name,
          coach: `${hc.firstName} ${hc.lastName}`,
          winless: !!r && r.w === 0 && r.t === 0,
          run: RUN[n] ?? 'more than ten',
        },
        { key, slot: 'rumor' },
      ),
    };
  }
  return null;
}
