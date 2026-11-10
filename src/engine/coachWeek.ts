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
  SAME,
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
import { roomAsks } from './playerTalks';
import { weightOf } from './standing';
import { TALK_SUBJECT } from './playerVoice';
import { headCoach, type Draft } from './senders';
import { staffRows } from './staffNotes';
import { COACH, markTold, openStory, storyById, talkStoryOn, untold } from './stories';
import { shareWord, tellable } from './storiesStep';
import { talkCard, talkRows } from './talkMail';
import type { CoachRoom, InboxMessage, League, MailSection, Player, Story } from './types';
import { around, sentencesOf, seasonSaid, say, toldKeys } from './voice';

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

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
  /** A result that files a letter alone: it owes something (a Negotiate row) or has waited `RESULT_WAIT` steps. */
  forces?: true;
  /** Which row of a meeting's result it is, for what to cut first. */
  part?: 'man' | 'told' | 'next' | 'talks';
  closing?: true;
  /** The depth-chart call: its note key rides on the letter, and only when this row is kept. */
  call?: true;
}

/** Rows a letter may carry: what needs your answer always fits, and the rest is cut from the lowest tier up. */
export const MAX_ROWS = 6;
/** Steps a tier 4 or 5 item may wait before it is dropped. */
export const STALE = 3;
/** Steps a meeting's result waits for a letter filed for another reason before it files one itself. */
export const RESULT_WAIT = 2;
/** Men a meeting's result names, besides its room row. */
export const RESULT_MEN = 2;
/** Steps a room's losing waits before it comes to you again (`playerTalks.ts` answers a man sooner as you did). */
export { LOSING_GAP } from './playerTalks';

const SECTIONS: { section: WeekItem['section']; title: string }[] = [
  { section: 'since', title: 'Since last week' },
  { section: 'asks', title: 'Who came to see me' },
  { section: 'rooms', title: 'The rooms' },
  { section: 'want', title: 'What I want to do' },
  { section: 'staff', title: 'From the staff room' },
];

/** What goes first when a letter is over `MAX_ROWS`: the notes, then the rest of tier 3, closings, then a result's rows from its men inward. */
function dropOrder(i: WeekItem): number {
  if (i.tier === 1) return 0;
  if (i.part) return { man: 20, talks: 15, told: 12, next: 11 }[i.part];
  return i.tier === 5 ? 50 : i.tier === 4 ? 40 : i.tier === 3 ? 30 : 25;
}

/** The week's items as the letter holds them: stale notes gone, then cut from the lowest tier up to `MAX_ROWS` rows. */
export function fitItems(items: WeekItem[], clock: number): WeekItem[] {
  const live = items.filter((i) => i.tier <= 3 || clock - i.born < STALE);
  const cut = new Set<WeekItem>();
  // What is owed (a result's Negotiate row) is never cut, whatever else is.
  const order = live
    .filter((i) => i.tier > 1 && i.part !== 'talks')
    .sort((a, b) => dropOrder(b) - dropOrder(a) || b.born - a.born);
  for (const i of order) {
    if (live.length - cut.size <= MAX_ROWS) break;
    cut.add(i);
  }
  const kept = live.filter((i) => !cut.has(i));
  // A result is told, and so covered, only when its room's row or a man's row made the letter; the rest of it waits.
  const toldResults = new Set(
    kept.filter((i) => i.result && (i.part === 'man' || i.part === 'told')).map((i) => i.covers![0]),
  );
  return kept.map((i) =>
    i.result && !toldResults.has(i.covers![0])
      ? { ...i, key: i.key === i.covers![0] ? `${i.key}:part` : i.key, covers: [] }
      : i,
  );
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
  // The losing's asks are told again when no letter in the inbox holds their row (it was archived or deleted): the GM
  // always has somewhere to answer. A letter on file for this step holds one, so nothing is quoted twice in a step.
  const stranded = newestLosingLetter(league) === undefined;
  const fresh = (p: Player) =>
    (stranded && p.morale!.talk!.ask!.cause === 'losing') ||
    !askTold(told, league.season, p.morale!.talk!.ask!.at, p.id);
  const causeOfAsk = (p: Player) => p.morale!.talk!.ask!.cause;
  const askKey = (p: Player) => `talk:${league.season}:${p.morale!.talk!.ask!.at}:${p.id}`;
  // The losing is the club's: one row for the man asking with the most standing, the others named in a sentence, one answer.
  const heaviest = (men: Player[]) =>
    [...men].sort((a, b) => weightOf(league, b, ctx) - weightOf(league, a, ctx) || a.id - b.id)[0];
  const losers = askers.filter((p) => causeOfAsk(p) === 'losing');
  const freshLosers = losers.filter(fresh);
  const spokesman = freshLosers.length ? heaviest(freshLosers) : undefined;
  const waitingLoser = !spokesman && losers.length ? heaviest(losers) : undefined;
  const quoted = (p: Player) => causeOfAsk(p) !== 'losing' || p.id === spokesman?.id;
  for (const at of [...new Set(askers.map((p) => p.morale!.talk!.ask!.at))]) {
    const ids = new Set(askers.filter((p) => p.morale!.talk!.ask!.at === at && fresh(p) && quoted(p)).map((p) => p.id));
    if (!ids.size) continue;
    for (const row of talkRows(league, at, said)) {
      if (row.playerId === undefined || !ids.has(row.playerId)) continue;
      const p = league.players[row.playerId];
      const cause = p.morale!.talk!.ask!.cause;
      const man = sheet(p);
      const key = askKey(p);
      const out: Row = { ...row };
      if (man && hasHistory(man)) {
        out.before = say(BEFORE, { man }, { key, slot: 'before', ...around(league, said) });
        remember(out.before);
      }
      remember(out.note);
      // The others who asked, named: they said the same, and one answer goes to them all.
      const speaks = p.id === spokesman?.id;
      const others = speaks ? freshLosers.filter((m) => m.id !== p.id) : [];
      if (speaks) {
        out.talkRoom = { unit: 'team', clock: at };
        if (others.length) {
          const same = say(
            SAME,
            { names: others.map((m) => m.lastName) },
            { key, slot: 'same', ...around(league, said) },
          );
          remember(same);
          out.note = `${out.note ?? ''} ${same}`.trim();
        }
      }
      const story = openStory(league, talkStoryOn(league, p, cause));
      const mate = story?.other === undefined ? undefined : league.players[story.other]?.lastName;
      items.push({
        tier: 1,
        key,
        section: 'asks',
        row: out,
        born: at,
        ...(others.length ? { covers: others.map(askKey) } : {}),
        ...(story ? { storyId: story.id } : {}),
        head: {
          kind: cause === 'losing' ? 'losing' : (story?.kind ?? cause),
          beat: 'asked',
          ...(man ? { man } : {}),
          ...(mate ? { mate } : {}),
        },
      });
    }
  }
  for (const p of askers) {
    const ask = p.morale!.talk!.ask!;
    if (fresh(p) || ask.at >= clock) continue;
    // A room's losing waits as one row, its heaviest man's.
    if (ask.cause === 'losing' && waitingLoser?.id !== p.id) continue;
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
        ...(ask.cause === 'losing' ? { talkRoom: { unit: 'team', clock: ask.at } } : {}),
      },
      born: ask.at,
      ...(story ? { storyId: story.id } : {}),
      head: { kind: ask.cause === 'losing' ? 'losing' : (story?.kind ?? ask.cause), beat: 'asked', man },
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

  // A meeting held last step is told in this letter: its rows, once.
  const job = league.gms[league.userGmId]?.appointments.at(-1);
  const arrived = job?.teamId === user ? (job.clock ?? -Infinity) : -Infinity;
  const due = meetingsOf(league.teams[user]).log.filter(
    (r) =>
      r.kind !== 'gm' &&
      Math.floor(r.clock / YEAR) === league.season &&
      r.clock > arrived &&
      clock > r.clock &&
      !told.has(resultId(league.season, r.clock, r.scope)),
  );

  // ───── tier 2: a story closing ─────
  for (const s of league.stories?.closed ?? []) {
    if (!s.told?.coach || !untold(league, s, COACH).length) continue;
    // A room that recovered in the letter that tells its meeting: the result already says where it stands.
    if (s.kind === 'room' && lastBeat(s).kind === 'recovered' && due.some((r) => r.scope === s.unit)) {
      markTold(s, COACH);
      continue;
    }
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
        cells: [p ? nameOf(p) : coach ? coachName(coach) : cap(nounOf(s) ?? 'the club'), 'Closed'],
        note,
      },
      storyId: s.id,
      born: b.at,
      closing: true,
      head: fact,
    });
  }

  // ───── tier 3: last step's meeting, told a step after it was held ─────
  for (const r of due) {
    const key = resultId(league.season, r.clock, r.scope);
    const rows = resultRows(league, r, said, RESULT_MEN);
    const story = openStory(league, { kind: 'room', teamId: user, unit: r.scope });
    rows.forEach((row, i) =>
      items.push({
        tier: 3,
        key: i === 0 ? key : `${key}:${i}`,
        section: 'since',
        row,
        born: r.clock,
        ...(story ? { storyId: story.id } : {}),
        // Every row carries the result's key: whichever the letter keeps tells it.
        covers: [key],
        ...(rows.some((x) => x.negotiate) || clock - r.clock >= RESULT_WAIT ? { forces: true as const } : {}),
        result: true,
        part: row.negotiate ? 'talks' : row.cells[1] === 'What I told them' ? 'told' : row.cells[1] ? 'next' : 'man',
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
        cells: [p ? nameOf(p) : cap(noun ?? 'the club'), 'The clock'],
        note,
        // A deal coming due is the moment to sit down with him.
        ...(s.kind === 'deal' && p ? { negotiate: { playerId: p.id } } : {}),
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
    // A depth-chart call puts a decision in front of you, so it files a letter alone; habit work is a note (tier 5).
    items.push({
      tier: isCall ? 3 : 5,
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
  const said = seasonSaid(league, sender.from, 'coach:');
  const { items, coachNote } = gather(league, told, said, have);
  // Notes alone never make a letter: something to answer, a story closing, a clock or a result that cannot wait does, and
  // the rest ride along. A result with nothing owed waits in the log for the next letter, two steps at most.
  if (!items.some((i) => i.tier <= 3 && (!i.result || i.forces))) return [];

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

/** The newest coach letter holding the losing's row: its buttons answer every open losing ask, and older rows only say what was said. */
export function newestLosingLetter(league: League): string | undefined {
  const held = (league.inbox ?? []).filter(
    (m) =>
      m.id.startsWith('coach:') &&
      !m.archived &&
      !m.deleted &&
      m.sections?.some((sec) => sec.rows.some((r) => r.talkRoom)),
  );
  return held.at(-1)?.id;
}

/** The letter still asks while any of its rows waits on your answer: a man's ask, or the meeting request. */
export function coachWeekNeedsYou(league: League, m: InboxMessage): boolean {
  return !!m.sections?.some((sec) =>
    sec.rows.some(
      (r) =>
        (r.talk && !r.talkRoom && talkCard(league, r.talk).state === 'open') ||
        (r.talkRoom && newestLosingLetter(league) === m.id && roomAsks(league, r.talkRoom.unit).length > 0) ||
        (r.meeting && meetingCard(league, r.meeting).state === 'open'),
    ),
  );
}
