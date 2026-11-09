/**
 * The head coach's weekly letter (docs/superpowers/specs/2026-11-09-storylines-design.md, section 3): the editor that
 * gathers what could be told from your club's open stories and the staff's notes, ranks it, and files one letter a step
 * or none. It replaces the separate player-talk, meeting-request, meeting-result and staff-notes letters. Rebuilds are
 * safe: a step's letter is filed once, and nothing here draws from any stream.
 */
import { manSheet, momentSheet, coachSheet, type CoachSheet, type ManSheet } from './castSheet';
import { coachName, coachTitle, ROOM_LABEL, teamCoaches } from './coaching';
import {
  BEFORE,
  CLOCK,
  CLOSING,
  HEADLINE,
  LINK,
  OPENING,
  STILL_WAITING,
  type OpeningFact,
  type StoryFact,
} from './coachWeekVoice';
import { employed } from './employment';
import { reportTellsRooms } from './lockerReport';
import { meetingCard, requestRow, resultRows, suggestionId, resultId } from './meetings/mail';
import { SCOPE_NOUN, styleOf } from './meetings/facts';
import { meetingsOf } from './meetings/suggest';
import { moraleContext, moraleClock, YEAR } from './morale';
import { TALK_SUBJECT } from './playerVoice';
import { headCoach, type Draft } from './senders';
import { staffRows } from './staffNotes';
import { COACH, markTold, openStory, storyById, talkStoryOn, untold } from './stories';
import { shareWord, tellable } from './storiesStep';
import { talkCard, talkRows } from './talkMail';
import type { CoachRoom, InboxMessage, League, MailSection, MeetingRecord, Player, Story } from './types';
import { around, sentencesOf, seasonSaid, say, toldKeys } from './voice';

export const coachWeekId = (season: number, clock: number) => `coach:${season}:${clock}`;

export type Tier5 = 1 | 2 | 3 | 4 | 5;
type Row = MailSection['rows'][number];

export interface WeekItem {
  tier: Tier5;
  /** What `covered` records when the item is told. */
  key: string;
  section: 'since' | 'asks' | 'rooms' | 'want' | 'staff';
  row: Row;
  storyId?: number;
  /** The step it came about: a tier 4 or 5 item that has waited `STALE` steps is dropped, not told stale. */
  born: number;
  /** Further keys the item tells (a room's note covers its turn, its chemistry and its warning). */
  covers?: string[];
  /** What its headline reads. */
  head?: StoryFact;
  /** A room whose row says a man feeds it. */
  link?: NonNullable<OpeningFact['link']>;
  result?: true;
  closing?: true;
  /** The depth-chart call: its note key rides on the letter, and only when this row is kept. */
  call?: true;
}

/** Rows beyond tiers 1 to 3 a letter may carry. */
export const EXTRA = 4;
/** Steps a tier 4 or 5 item may wait before it is dropped. */
export const STALE = 3;

const SECTIONS: { section: WeekItem['section']; title: string }[] = [
  { section: 'since', title: 'Since last week' },
  { section: 'asks', title: 'Who came to see me' },
  { section: 'rooms', title: 'The rooms' },
  { section: 'want', title: 'What I want to do' },
  { section: 'staff', title: 'From the staff room' },
];

/** Everything of tiers 1 to 3, then the freshest tier 4 and 5 items that fit: what waits a week waits, and past three steps it goes. */
export function fitItems(items: WeekItem[], clock: number): WeekItem[] {
  const must = items.filter((i) => i.tier <= 3);
  const extra = items
    .filter((i) => i.tier > 3 && clock - i.born < STALE)
    .sort((a, b) => a.tier - b.tier || a.born - b.born)
    .slice(0, EXTRA);
  return items.filter((i) => must.includes(i) || extra.includes(i));
}

const stepNow = (league: League) => league.moraleAt ?? moraleClock(league);
const nameOf = (p: Player) => `${p.firstName} ${p.lastName}`;
const lastBeat = (s: Story) => s.beats[s.beats.length - 1];
const isUnit = (u: Story['unit']): u is CoachRoom => !!u && u !== 'team' && u !== 'ST';
const nounOf = (s: Story) => (s.unit && s.unit !== 'ST' ? SCOPE_NOUN[s.unit] : undefined);

/** He (or the group letter of his step) was already asked about in a letter on file. */
const askTold = (told: Set<string>, season: number, at: number, id: number) =>
  told.has(`talk:${season}:${at}:${id}`) || told.has(`talk:${season}:${at}`);

/** A man has history with us when his letter has something to call back to. */
const hasHistory = (m: ManSheet) => m.asks !== 'first' || !!m.lastAnswer || m.kept || m.broken || m.dispute;

interface Gathered {
  items: WeekItem[];
  coachNote?: Pick<InboxMessage, 'coachNoteKey' | 'coachNote'>;
}

/** The week's candidate items, ranked and fitted to the budget; the words are chosen around `said`, which grows. */
function gather(league: League, told: Set<string>, said: string[], have: Set<string>): Gathered {
  const user = league.userTeamId;
  const clock = stepNow(league);
  const ctx = moraleContext(league);
  const sheet = (p: Player | undefined) => (p ? manSheet(league, p, ctx) : null);
  const items: WeekItem[] = [];
  const remember = (text?: string) => {
    if (text) said.push(...sentencesOf(text));
  };

  // ───── tier 1: asks, and an ask still waiting ─────
  const askers = Object.values(league.players)
    .filter((p) => p.teamId === user && p.morale?.talk?.ask)
    .sort((a, b) => a.morale!.talk!.ask!.at - b.morale!.talk!.ask!.at || a.id - b.id);
  const fresh = (p: Player) => !askTold(told, league.season, p.morale!.talk!.ask!.at, p.id);
  for (const at of [...new Set(askers.map((p) => p.morale!.talk!.ask!.at))]) {
    const ids = new Set(askers.filter((p) => p.morale!.talk!.ask!.at === at && fresh(p)).map((p) => p.id));
    if (!ids.size) continue;
    for (const row of talkRows(league, at, said)) {
      if (row.playerId === undefined || !ids.has(row.playerId)) continue;
      const p = league.players[row.playerId];
      const cause = p.morale!.talk!.ask!.cause;
      const man = sheet(p);
      const key = `talk:${league.season}:${at}:${p.id}`;
      const out: Row = { ...row };
      if (man && hasHistory(man)) {
        out.before = say(BEFORE, { man }, { key, slot: 'before', ...around(league, said) });
        remember(out.before);
      }
      remember(out.note);
      const story = openStory(league, talkStoryOn(league, p, cause));
      const mate = story?.other === undefined ? undefined : league.players[story.other]?.lastName;
      items.push({
        tier: 1,
        key,
        section: 'asks',
        row: out,
        born: at,
        ...(story ? { storyId: story.id } : {}),
        head: { kind: story?.kind ?? cause, beat: 'asked', ...(man ? { man } : {}), ...(mate ? { mate } : {}) },
      });
    }
  }
  for (const p of askers) {
    const ask = p.morale!.talk!.ask!;
    if (fresh(p) || ask.at >= clock) continue;
    const man = sheet(p);
    if (!man) continue;
    const key = `waiting:${clock}:${p.id}`;
    const note = say(STILL_WAITING, { man }, { key, slot: 'waiting', ...around(league, said) });
    remember(note);
    const story = openStory(league, talkStoryOn(league, p, ask.cause));
    items.push({
      tier: 1,
      key,
      section: 'asks',
      row: {
        playerId: p.id,
        cells: [nameOf(p), TALK_SUBJECT[ask.cause]],
        note,
        talk: { playerId: p.id, clock: ask.at },
      },
      born: ask.at,
      ...(story ? { storyId: story.id } : {}),
      head: { kind: story?.kind ?? ask.cause, beat: 'asked', man },
    });
  }

  // ───── tier 1: the meeting request ─────
  const pending = meetingsOf(league.teams[user]).pending;
  if (pending && pending.kind !== 'gm' && !told.has(suggestionId(league.season, pending.clock, pending.scope))) {
    const row = requestRow(league);
    if (row?.meeting) {
      remember(row.note);
      const story = openStory(league, { kind: 'room', teamId: user, unit: row.meeting.scope });
      items.push({
        tier: 1,
        key: suggestionId(league.season, row.meeting.clock, row.meeting.scope),
        section: 'want',
        row,
        born: row.meeting.clock,
        ...(story ? { storyId: story.id } : {}),
        head: { kind: 'room', beat: 'suggested', noun: SCOPE_NOUN[row.meeting.scope] },
      });
    }
  }

  // ───── tier 2: a story closing ─────
  for (const s of league.stories?.closed ?? []) {
    if (!s.told?.coach || !untold(league, s, COACH).length) continue;
    const b = lastBeat(s);
    const p = s.playerId === undefined ? undefined : league.players[s.playerId];
    const man = sheet(p);
    const mate = s.other === undefined ? undefined : league.players[s.other]?.lastName;
    const coach = s.coachId === undefined ? undefined : league.coaches[s.coachId];
    const key = `story:${s.id}:${s.beats.length - 1}`;
    const fact = {
      kind: s.kind,
      beat: b.kind,
      ...(man ? { man } : {}),
      ...(mate ? { mate } : {}),
      ...(nounOf(s) ? { noun: nounOf(s) } : {}),
      ...(coach ? { coach: coach.lastName } : {}),
    };
    const note = say(CLOSING, fact, { key, slot: 'closing', ...around(league, said) });
    remember(note);
    items.push({
      tier: 2,
      key,
      section: 'since',
      row: {
        ...(p ? { playerId: p.id } : {}),
        cells: [p ? nameOf(p) : coach ? coachName(coach) : (nounOf(s) ?? 'The club'), 'Closed'],
        note,
      },
      storyId: s.id,
      born: b.at,
      closing: true,
      head: fact,
    });
  }

  // ───── tier 3: last step's meeting, told a step after it was held ─────
  const job = league.gms[league.userGmId]?.appointments.at(-1);
  const arrived = job?.teamId === user ? (job.clock ?? -Infinity) : -Infinity;
  const log: MeetingRecord[] = meetingsOf(league.teams[user]).log;
  for (const r of log) {
    if (r.kind === 'gm' || Math.floor(r.clock / YEAR) !== league.season || r.clock <= arrived || clock <= r.clock)
      continue;
    const key = resultId(league.season, r.clock, r.scope);
    if (told.has(key)) continue;
    const rows = resultRows(league, r, said);
    const story = openStory(league, { kind: 'room', teamId: user, unit: r.scope });
    rows.forEach((row, i) =>
      items.push({
        tier: 3,
        key: i === 0 ? key : `${key}:${i}`,
        section: 'since',
        row,
        born: r.clock,
        ...(story && i === 0 ? { storyId: story.id } : {}),
        ...(i === 0 ? { covers: [key] } : {}),
        result: true,
        head: { kind: 'room', beat: 'held', noun: SCOPE_NOUN[r.scope] },
      }),
    );
  }

  // ───── tier 3: a clock at halfway or due ─────
  for (const s of league.stories?.open ?? []) {
    if (s.teamId !== user || s.due === undefined) continue;
    const start = [...s.beats].reverse().find((b) => b.kind === 'promised' || b.kind === 'commitment');
    if (!start || s.due - start.at < 1) continue;
    const half = start.at + Math.ceil((s.due - start.at) / 2);
    const at = clock >= s.due - 1 ? 'due' : clock >= half && s.due - start.at >= 2 ? 'half' : null;
    if (!at) continue;
    const key = `clock:${s.id}:${s.due}:${at}`;
    if (told.has(key)) continue;
    const p = s.playerId === undefined ? undefined : league.players[s.playerId];
    const man = sheet(p);
    const noun = nounOf(s);
    const manKind = s.kind !== 'room' && s.kind !== 'staff';
    if (manKind && !man) continue;
    const note = say(
      CLOCK,
      { kind: s.kind, at, ...(man ? { man } : {}), ...(noun ? { noun } : {}) },
      {
        key,
        slot: 'clock',
        ...around(league, said),
      },
    );
    remember(note);
    items.push({
      tier: 3,
      key,
      section: 'since',
      row: {
        ...(p ? { playerId: p.id } : {}),
        cells: [p ? nameOf(p) : (noun ?? 'The club'), 'The clock'],
        note,
      },
      born: clock,
      head: { kind: s.kind, beat: start.kind, ...(man ? { man } : {}), ...(noun ? { noun } : {}) },
    });
  }

  // ───── tier 4 and 5: the rooms and the staff room ─────
  const inSeason = league.phase === 'regular' || league.phase === 'playoffs';
  const staff = inSeason
    ? staffRows(league, told, { leaveRooms: reportTellsRooms(league, have) })
    : { rooms: [], roomMeta: [], staff: [], staffKeys: [], covered: [] as string[], coachNote: undefined };
  const sender = headCoach(league);
  const roomItems: WeekItem[] = staff.rooms.map((row, i) => {
    const { unit, keys } = staff.roomMeta[i];
    const story = openStory(league, { kind: 'room', teamId: user, unit });
    const turned = story && [...story.beats].reverse().find((b) => b.kind === 'turned');
    return {
      tier: 4,
      key: keys[0] ?? `room:${unit}:${clock}`,
      section: 'rooms',
      row,
      covers: keys,
      born: turned?.at ?? clock,
      ...(story ? { storyId: story.id } : {}),
      head: { kind: 'room', beat: 'turned', noun: SCOPE_NOUN[unit] },
    };
  });
  // A room a man's story feeds: his share of it, and what it is about, in the room's own row.
  for (const s of league.stories?.open ?? []) {
    if (s.teamId !== user || s.kind !== 'room' || !isUnit(s.unit) || !tellable(league, s, clock)) continue;
    const turn = [...s.beats].reverse().find((b) => b.kind === 'turned');
    if (!turn || (turn.how !== 'Down' && turn.how !== 'Split')) continue;
    if (!untold(league, s, COACH).some((b) => b.kind === 'turned')) continue;
    const feeder = (league.stories?.open ?? []).find((m) => m.feeds?.includes(s.id) && m.playerId !== undefined);
    const p = feeder && league.players[feeder.playerId!];
    const man = sheet(p);
    const share = p && shareWord(league, p, ctx);
    if (!feeder || !man || !share) continue;
    const noun = SCOPE_NOUN[s.unit];
    const note = say(
      LINK,
      { man, share, kind: feeder.kind, noun, word: turn.how },
      { key: `room:${s.unit}:${turn.at}`, slot: 'link', ...around(league, said) },
    );
    remember(note);
    const own = roomItems.find((i) => i.storyId === s.id);
    if (own) {
      own.row = { ...own.row, note: `${note} ${own.row.note ?? ''}`.trim() };
      own.link = { noun, man: man.last, word: turn.how };
      continue;
    }
    const pc = teamCoaches(league, user).find((c) => c.role === 'positionCoach' && c.room === s.unit);
    roomItems.push({
      tier: 4,
      key: `room:${s.unit}:${turn.at}`,
      section: 'rooms',
      row: {
        cells: [ROOM_LABEL[s.unit], pc ? `${coachName(pc)}, ${coachTitle(pc)}` : sender.from],
        note,
        ...(pc ? { coachId: pc.id } : {}),
      },
      storyId: s.id,
      born: turn.at,
      head: { kind: 'room', beat: 'turned', noun },
      link: { noun, man: man.last, word: turn.how },
    });
  }
  items.push(...roomItems);
  const callKey = staff.coachNote?.coachNoteKey;
  let callSeen = false;
  staff.staff.forEach((row, i) => {
    const keys = staff.staffKeys[i] ?? [];
    const isCall = keys.length === 0 && !callSeen && !!callKey;
    if (isCall) callSeen = true;
    items.push({
      tier: 5,
      key: isCall ? `call:${callKey}` : (keys[0] ?? `staff:${clock}:${i}`),
      section: 'staff',
      row,
      covers: keys,
      born: clock,
      ...(isCall ? { call: true as const } : {}),
    });
  });

  const kept = fitItems(items, clock);
  const call = kept.some((i) => i.call);
  return { items: kept, ...(call && staff.coachNote ? { coachNote: staff.coachNote } : {}) };
}

/** The week's items, in the order the letter reads them: ranked, budgeted, words chosen around what he said this year. */
export function weekItems(league: League, told: Set<string>, said: string[]): WeekItem[] {
  return gather(league, told, said, new Set()).items;
}

const lowerFirst = (s: string) => (s.startsWith('The ') ? `t${s.slice(1)}` : s);
const AGAIN = ['again', 'still', 'once more', 'one more time'];

/** The subject: the top item's headline, and the second's when there are two; never one already used this year. */
function subjectFor(league: League, heads: string[]): string {
  const used = new Set(
    (league.inbox ?? []).filter((m) => m.id.startsWith('coach:') && m.season === league.season).map((m) => m.subject),
  );
  const unique = [...new Set(heads)];
  if (!unique.length) unique.push('This week');
  const pair = (a: string, b: string) => `${a}, and ${lowerFirst(b)}`;
  const cands = [
    ...(unique.length > 1 ? [pair(unique[0], unique[1])] : []),
    ...unique,
    ...unique.slice(2).map((h) => pair(unique[0], h)),
  ];
  const free = cands.find((c) => !used.has(c));
  if (free) return free;
  for (const w of AGAIN) if (!used.has(`${unique[0]}: ${w}`)) return `${unique[0]}: ${w}`;
  return unique[0];
}

/** The head coach's sheet, or a plain one when the chair is empty (no line reads it, but the fact asks for one). */
function coachFact(league: League): CoachSheet {
  const c = teamCoaches(league, league.userTeamId).find((x) => x.role === 'headCoach');
  return c
    ? coachSheet(league, c)
    : { name: 'Coaching staff', style: styleOf(10.5), motto: '', isNew: false, word: 'steady' };
}

/** One letter a step: filed once (a rebuild after your answer files nothing and changes nothing), none in a quiet step. */
export function coachWeekMail(league: League, have: Set<string>): Draft[] {
  if (!employed(league)) return [];
  const clock = stepNow(league);
  const id = coachWeekId(league.season, clock);
  // First, before building anything: rows are never worded again against their own filed sentences.
  if (have.has(id)) return [];
  const told = toldKeys(league);
  if (told.has(id)) return [];
  const sender = headCoach(league);
  const said = seasonSaid(league, sender.from);
  const { items, coachNote } = gather(league, told, said, have);
  if (!items.length) return [];

  const ranked = [...items].sort((a, b) => a.tier - b.tier);
  const heads = ranked.flatMap((i, n) => (i.head ? [say(HEADLINE, i.head, { key: id, slot: `head:${n}` })] : []));
  const subject = subjectFor(league, heads.length ? heads : ['From the staff room']);
  const top = ranked.find((i) => i.head)?.head;
  const asks = items.filter((i) => i.section === 'asks' || i.section === 'want').length;
  const link = items.find((i) => i.link)?.link;
  const fact: OpeningFact = {
    moment: momentSheet(league),
    coach: coachFact(league),
    items: items.length - asks,
    asks,
    ...(link ? { link } : {}),
    ...(top
      ? { top: { kind: top.kind, ...(top.man ? { man: top.man.last } : {}), ...(top.noun ? { noun: top.noun } : {}) } }
      : {}),
    result: items.some((i) => i.result),
    closing: items.some((i) => i.closing),
  };
  const body = say(OPENING, fact, { key: id, slot: 'opening', ...around(league, said) });

  const sections: MailSection[] = SECTIONS.flatMap(({ section, title }) => {
    const rows = items.filter((i) => i.section === section).map((i) => i.row);
    return rows.length ? [{ title, rows, layout: 'people' as const }] : [];
  });
  const covered = [...new Set([id, ...items.flatMap((i) => [i.key, ...(i.covers ?? [])])])];
  // Told: each story's beats so far belong to this outlet now.
  for (const sid of new Set(items.flatMap((i) => (i.storyId === undefined ? [] : [i.storyId])))) {
    const s = storyById(league, sid);
    if (s) markTold(s, COACH);
  }
  return [
    {
      id,
      season: league.season,
      phase: league.phase,
      week: league.phase === 'regular' || league.phase === 'playoffs' ? league.week : 0,
      ...sender,
      category: 'staff',
      subject,
      body,
      sections,
      covered,
      ...(coachNote ?? {}),
      actions: [{ kind: 'locker' }],
    },
  ];
}

/** The letter still asks while any of its rows waits on your answer: a man's ask, or the meeting request. */
export function coachWeekNeedsYou(league: League, m: InboxMessage): boolean {
  return !!m.sections?.some((sec) =>
    sec.rows.some(
      (r) =>
        (r.talk && talkCard(league, r.talk).state === 'open') ||
        (r.meeting && meetingCard(league, r.meeting).state === 'open'),
    ),
  );
}
