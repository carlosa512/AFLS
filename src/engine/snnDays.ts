/**
 * The editor of SNN's big-day editions (`docs/NEWS.md`, spec `docs/superpowers/specs/2026-11-12-snn-big-days-design.md`):
 * one front page for each of the calendar's big days (the new league year, free agency, draft day, cut-down day,
 * kickoff), on the weekly edition's page. It works as the weekly editor does: gather the day's candidates from the
 * public record (the transaction log, the draft, leadership events, the schedule), rank them, cut them to a page (a
 * lead, the reader's club, up to three tiles, one story a club), and have `snnDayVoice.ts` word them. Inside a tier
 * the more worthwhile story comes first (`stakes`: the earlier pick, the bigger contract, the bigger name). Mail-side
 * only: public facts, no draws, nothing in the sim reads it. What an edition printed lives in its `covered` keys.
 */
import { coachName } from './coaching';
import { employed } from './employment';
import { reputation } from './gmVoice';
import { headCoachChanges } from './inbox';
import { freeAgents } from './offseason/negotiation';
import { publicRecord, type PublicRecord } from './publicStanding';
import type { Draft } from './senders';
import { writeDayStory, yourDayStory } from './snnDayVoice';
import { short, SNN, SUBJECT } from './snnWeek';
import type { Edition, EditionDay, EditionList, League, Player } from './types';
import { seasonSaid, stableHash, toldKeys } from './voice';

export type Day = EditionDay;

/**
 * Off, no big-day edition files and the digests it replaced file as they did (the front-office carousel, the coaching
 * carousel, "off the market"): how their tests still reach them. A league year that was already being told the old
 * way when the editions arrived finishes that way too (`legacyYear`).
 */
export const DAYS = { on: true };

/** The bars, each the owner's call from the counts (`npm run editions -- --offseasons n`). */
export const DAY = {
  /** A trade up is a story when it lands at this pick or earlier. */
  upInside: 10,
  /** The wait: places below the consensus, in the first two rounds. A page tells one, the furthest it can. */
  wait: 15,
  /** Ahead of the board: places above the consensus, in the first round. A page tells one, the widest it can. */
  ahead: 15,
  /** How many of each the editor offers the page, so the one it tells need not be a club that already has a story. */
  offered: 3,
  /** The club with the most picks in the first two rounds is a story at this many. */
  haulPicks: 4,
  /** The team that let the most of last season's starters reach the market is a story at this many. */
  yearLost: 5,
  /** Rows in a list box. */
  listRows: 10,
};

export const DAY_LABEL: Record<Day, string> = {
  year: 'The new league year',
  market: 'Free agency',
  draft: 'Draft day',
  cuts: 'Cut-down day',
  kickoff: 'Kickoff',
};

/** One thing a big day could tell, with the public facts its story is written from. */
export interface DayCandidate {
  /** What it is about, kept in the edition's `covered` so it is told once. */
  key: string;
  day: Day;
  /** The one thing it says: 'first', 'up', 'qb', 'wait', 'ahead', 'haul'… */
  angle: string;
  tier: 1 | 2 | 3 | 4 | 5;
  /** The club the story is about. An edition runs one story a club. */
  clubId: number;
  teams: number[];
  /** Ranks candidates inside a tier: what makes one more worth telling than the next, on a scale of about 0 to 1. */
  stakes: number;
  /** The ids the separate mails of old filed the same news under. */
  covers?: string[];
  playerId?: number;
  coachId?: number;
  gmId?: number;
  /** The other club in it: who traded the pick, who he left. */
  otherId?: number;
  pick?: number;
  rank?: number;
  /** A count the story carries: quarterbacks in the round, picks in two rounds, starters lost. */
  n?: number;
  /** What a club got for a pick, as the draft record words it ("No. 9", "2028 round 1"). */
  got?: string[];
  deal?: { years: number; total: number };
  /** A public line the story carries (a leadership report), or 'most' when it is the biggest of its kind that day. */
  text?: string;
}

const drafted = (l: League): Player[] =>
  Object.values(l.players)
    .filter((p) => p.draft?.season === l.season)
    .sort((a, b) => a.draft!.pick - b.draft!.pick);

/**
 * A pick that changed hands was a move up when nothing its seller got back picks earlier in this draft: the club that
 * took No. 6 after giving up No. 5 moved down, and is the other half of someone else's story.
 */
const movedUp = (pick: number, got: string[]) =>
  !got.some((g) => {
    const m = /^No\. (\d+)$/.exec(g);
    return !!m && Number(m[1]) < pick;
  });

/** Draft day: the first pick, a trade up, the first quarterback, the furthest fall, the widest reach, the biggest haul. */
function draftCandidates(l: League): DayCandidate[] {
  const picks = drafted(l);
  if (!picks.length) return [];
  const out: DayCandidate[] = [];
  const base = (p: Player, angle: string) => ({
    key: `draft:${l.season}:${angle}:${p.id}`,
    day: 'draft' as const,
    angle,
    clubId: p.draft!.teamId,
    teams: [p.draft!.teamId],
    playerId: p.id,
    pick: p.draft!.pick,
    ...(p.draft!.rank !== undefined ? { rank: p.draft!.rank } : {}),
  });
  const first = picks.find((p) => p.draft!.pick === 1);
  if (first) out.push({ ...base(first, 'first'), tier: 1, stakes: 1 });
  for (const p of picks) {
    const d = p.draft!;
    if (!d.deal || d.pick > DAY.upInside || p === first || !movedUp(d.pick, d.deal.got)) continue;
    out.push({
      ...base(p, 'up'),
      tier: 2,
      stakes: 1 / d.pick,
      otherId: d.deal.from,
      teams: [d.teamId, d.deal.from],
      got: [...d.deal.got],
    });
  }
  // One quarterback story: the first taken in round one, with how many went in the round.
  const qbs = picks.filter((p) => p.position === 'QB' && p.draft!.round === 1);
  if (qbs.length && qbs[0] !== first)
    out.push({ ...base(qbs[0], 'qb'), tier: 2, stakes: 1 / qbs[0].draft!.pick, n: qbs.length });
  const ranked = picks.filter((p) => p.draft!.rank !== undefined);
  const fall = (p: Player) => p.draft!.pick - p.draft!.rank!;
  const waits = ranked
    .filter((p) => p.draft!.round <= 2 && fall(p) >= DAY.wait)
    .sort((a, b) => fall(b) - fall(a) || a.id - b.id);
  for (const [i, p] of waits.slice(0, DAY.offered).entries())
    out.push({ ...base(p, 'wait'), tier: 3, stakes: fall(p) / 100, ...(i === 0 ? { text: 'most' } : {}) });
  const reaches = ranked
    .filter((p) => p.draft!.round === 1 && -fall(p) >= DAY.ahead)
    .sort((a, b) => fall(a) - fall(b) || a.id - b.id);
  for (const [i, p] of reaches.slice(0, DAY.offered).entries())
    out.push({ ...base(p, 'ahead'), tier: 3, stakes: -fall(p) / 100, ...(i === 0 ? { text: 'most' } : {}) });
  // The club with the most picks in the first two rounds, alone at the top.
  const early = picks.filter((p) => p.draft!.round <= 2);
  const by = new Map<number, Player[]>();
  for (const p of early) by.set(p.draft!.teamId, [...(by.get(p.draft!.teamId) ?? []), p]);
  const hauls = [...by.values()].sort((a, b) => b.length - a.length);
  if (hauls[0] && hauls[0].length >= DAY.haulPicks && hauls[0].length > (hauls[1]?.length ?? 0))
    out.push({ ...base(hauls[0][0], 'haul'), tier: 4, stakes: hauls[0].length / 10, n: hauls[0].length });
  return out;
}

const lastRecord = (l: League, teamId: number) => l.history.find((h) => h.season === l.season - 1)?.records[teamId];
/** Last season's winning percentage, for ranking one team's news over another's; even when there was no last season. */
const lastPct = (l: League, teamId: number) => {
  const r = lastRecord(l, teamId);
  return r ? (r.w + r.t / 2) / Math.max(1, r.w + r.l + r.t) : 0.5;
};

/** A team with a new head coach or general manager this league year: who came in, and who left when that is known. */
export interface TopChange {
  teamId: number;
  job: 'coach' | 'gm';
  inName: string;
  outName: string;
  coachId?: number;
  gmId?: number;
}

/**
 * The changes at the top going into this league year, from the public record: the head coaches who did not finish
 * last season in their chairs (`headCoachChanges`) and the GMs hired since it ended (leadership events). A league with
 * no last season on record has no "before", so it reports none.
 */
export function topChanges(l: League): TopChange[] {
  const out: TopChange[] = [];
  for (const x of headCoachChanges(l)) {
    if (!x.replaced) continue;
    out.push({
      teamId: x.teamId,
      job: 'coach',
      inName: coachName(x.coach),
      outName: coachName(x.replaced),
      coachId: x.coach.id,
    });
  }
  const events = l.leadership.events.filter((e) => e.date.season === l.season && e.date.phase !== 'regular');
  const gmName = (id: number | undefined) => {
    const g = id === undefined ? undefined : l.gms[id];
    return g ? `${g.firstName} ${g.lastName}` : '';
  };
  for (const t of l.teams) {
    const hired = events.filter((e) => e.teamId === t.id && e.kind === 'gmHired').at(-1);
    if (!hired || hired.gmId === undefined || !l.gms[hired.gmId]) continue;
    // Your own appointment is yours to know, not SNN's to tell you.
    if (hired.gmId === l.userGmId) continue;
    const left = events
      .filter((e) => e.teamId === t.id && (e.kind === 'gmDismissed' || e.kind === 'gmRetired') && e.id < hired.id)
      .at(-1);
    out.push({ teamId: t.id, job: 'gm', inName: gmName(hired.gmId), outName: gmName(left?.gmId), gmId: hired.gmId });
  }
  return out;
}

/**
 * A change at the top no edition has told yet. It belongs to the new league year's edition (tier 1); one that comes
 * later, or that edition had no room for, is still news in the next one (tier 3).
 */
function leaderCandidates(l: League, day: Day): DayCandidate[] {
  return topChanges(l).map((x) => ({
    key: `lead:${l.season}:${x.teamId}:${x.job}`,
    day,
    angle: x.job,
    tier: day === 'year' ? (1 as const) : (3 as const),
    clubId: x.teamId,
    teams: [x.teamId],
    stakes: lastPct(l, x.teamId),
    ...(x.coachId !== undefined ? { coachId: x.coachId } : {}),
    ...(x.gmId !== undefined ? { gmId: x.gmId } : {}),
    text: x.outName,
  }));
}

const windowMoves = (l: League, kind: 'tag' | 'resign' | 'release') =>
  l.transactions
    .filter((t) => t.season === l.season && t.phase === 'resign' && t.kind === kind && t.playerId !== undefined)
    .filter((t) => kind !== 'resign' || t.text.includes(' re-signed '))
    .flatMap((t) => (l.players[t.playerId!] ? [{ p: l.players[t.playerId!], teamId: t.teamIds[0] }] : []));
/** The team he finished last season with. */
const lastClub = (l: League, p: Player) => p.statTeams?.[l.season - 1]?.at(-1);
/** Free agents who finished last season with a team that did not release them: their contracts ran out. */
function reachedMarket(l: League): { p: Player; teamId: number }[] {
  const cut = new Set(windowMoves(l, 'release').map((x) => x.p.id));
  return freeAgents(l).flatMap((p) => {
    const teamId = lastClub(l, p);
    return teamId === undefined || cut.has(p.id) ? [] : [{ p, teamId }];
  });
}
const dealOf = (p: Player) =>
  p.contract ? { deal: { years: p.contract.length, total: p.contract.apy * p.contract.length } } : {};

/** The new league year: stars tagged, released, kept and reaching the market, and the team that lost the most starters. */
function yearCandidates(l: League, rec: PublicRecord): DayCandidate[] {
  const out: DayCandidate[] = [];
  const player = (x: { p: Player; teamId: number }, angle: string, tier: 1 | 2) => ({
    key: `player:${x.p.id}:${l.season}`,
    day: 'year' as const,
    angle,
    tier,
    clubId: x.teamId,
    teams: [x.teamId],
    stakes: rec.worth(x.p),
    playerId: x.p.id,
  });
  const stars = (xs: { p: Player; teamId: number }[]) => xs.filter((x) => rec.standing(x.p) === 'star');
  for (const x of stars(windowMoves(l, 'tag'))) out.push(player(x, 'tag', 1));
  for (const x of stars(windowMoves(l, 'release'))) out.push(player(x, 'released', 1));
  for (const x of stars(windowMoves(l, 'resign'))) out.push({ ...player(x, 'kept', 2), ...dealOf(x.p) });
  const walked = reachedMarket(l);
  for (const x of stars(walked)) out.push(player(x, 'market', 2));
  // The one team that let the most of last season's starters reach the market.
  const by = new Map<number, Player[]>();
  for (const x of walked) if (rec.standing(x.p) !== 'depth') by.set(x.teamId, [...(by.get(x.teamId) ?? []), x.p]);
  const most = [...by].sort((a, b) => b[1].length - a[1].length || a[0] - b[0]);
  if (most[0] && most[0][1].length >= DAY.yearLost && most[0][1].length > (most[1]?.[1].length ?? 0)) {
    const [teamId, lost] = most[0];
    const best = [...lost].sort((a, b) => rec.worth(b) - rec.worth(a) || a.id - b.id)[0];
    out.push({
      key: `window:${l.season}:${teamId}`,
      day: 'year',
      angle: 'lost',
      tier: 3,
      clubId: teamId,
      teams: [teamId],
      stakes: lost.length / 20,
      n: lost.length,
      playerId: best.id,
    });
  }
  return out;
}

/** The digests of old that the new league year's edition replaces. One on file means that year was told the old way. */
const yearDigests = (l: League) => [`league:${l.season}:carousel`, `offMarket:${l.season}`];
export const legacyYear = (l: League, have: Set<string>): boolean =>
  !DAYS.on ||
  (!have.has(dayId(l, 'year')) &&
    (yearDigests(l).some((id) => have.has(id)) ||
      [...have].some((id) => id.startsWith(`leadership-phase:${l.season}:`))));

/** A day's candidates that no edition has told yet. */
export function dayCandidates(l: League, day: Day, have: Set<string>): DayCandidate[] {
  const rec = publicRecord(l);
  const all = day === 'draft' ? draftCandidates(l) : day === 'year' ? yearCandidates(l, rec) : [];
  // A change at the top is news on whichever day it is first told, unless that year's digests told it the old way.
  const top = legacyYear(l, have) ? [] : leaderCandidates(l, day);
  return [...all, ...top].filter((c) => !have.has(c.key) && !(c.covers ?? []).some((id) => have.has(id)));
}

/** Top tier first, then the more worthwhile story, then a hash of the edition and the story: the same league, the same order. */
export function rankDay(cs: DayCandidate[], editionId: string): DayCandidate[] {
  return [...cs].sort(
    (a, b) =>
      a.tier - b.tier ||
      b.stakes - a.stakes ||
      stableHash(`${editionId}:${a.key}`) - stableHash(`${editionId}:${b.key}`) ||
      (a.key < b.key ? -1 : 1),
  );
}

/** How many stories of one angle a page runs among its lead and tiles: two, and one of an angle told as "the most". */
const SAME_ANGLE = 2;
const ONCE = new Set(['wait', 'ahead']);
const TILES = 3;

/**
 * The page's slots from the ranked day: the lead is the biggest story that is not about the reader's club (his club
 * has its own slot, written whole by `yourDayStory`), then three tiles, one story a club. Nothing when no story could lead.
 */
export function cutDay(
  ranked: DayCandidate[],
  userTeamId: number | null,
): { lead: DayCandidate; tiles: DayCandidate[] } | null {
  const lead = ranked.find((c) => c.clubId !== userTeamId);
  if (!lead) return null;
  const used = new Set<number>([lead.clubId]);
  const told = new Map<string, number>([[lead.angle, 1]]);
  const tiles: DayCandidate[] = [];
  // Variety first (an angle twice at most); then a slot still empty takes the next story whatever its angle, since a
  // third trade up is better than a blank tile.
  for (const varied of [true, false])
    for (const c of ranked) {
      if (tiles.length >= TILES) break;
      if (c === lead || c.clubId === userTeamId || used.has(c.clubId)) continue;
      const n = told.get(c.angle) ?? 0;
      // "The furthest fall" is said once a page, whatever else is empty.
      if (ONCE.has(c.angle) ? n >= 1 : varied && n >= SAME_ANGLE) continue;
      used.add(c.clubId);
      told.set(c.angle, (told.get(c.angle) ?? 0) + 1);
      tiles.push(c);
    }
  // In the order the day ranked them.
  tiles.sort((a, b) => ranked.indexOf(a) - ranked.indexOf(b));
  return { lead, tiles };
}

const nameOf = (p: Player) => `${p.position} ${p.firstName} ${p.lastName}`;

/** The day's rows at a glance, where the division race sits in season. */
export function dayLists(l: League, days: Day[]): EditionList[] {
  const out: EditionList[] = [];
  if (days.includes('draft')) {
    const rows = drafted(l)
      .filter((p) => p.draft!.round === 1)
      .slice(0, DAY.listRows)
      .map((p) => ({
        playerId: p.id,
        teamId: p.draft!.teamId,
        cells: [
          `No. ${p.draft!.pick}`,
          nameOf(p),
          l.teams[p.draft!.teamId].name,
          p.draft!.rank !== undefined ? `No. ${p.draft!.rank}` : '',
        ],
      }));
    if (rows.length) out.push({ title: 'Round one', head: ['Pick', 'Player', 'Team', 'Consensus'], rows });
  }
  if (days.includes('year')) {
    const rows = topChanges(l)
      .slice(0, DAY.listRows)
      .map((x) => ({
        teamId: x.teamId,
        cells: [l.teams[x.teamId].name, x.job === 'coach' ? 'Head coach' : 'General manager', x.outName, x.inName],
      }));
    if (rows.length) out.push({ title: 'Changes at the top', head: ['Team', 'Job', 'Out', 'In'], rows });
  }
  return out;
}

/**
 * The moments the league is at now, in the order their edition is named by the last: free agency's opening is the new
 * league year's, the draft's opening is free agency's, camp is the draft's (then cut-down day's once the cuts are in),
 * and week 1 before a game is Kickoff's, with cut-down day's stories when that day never had a page of its own.
 */
export function dayNow(l: League): Day[] {
  if (l.phase === 'freeAgency') return ['year'];
  if (l.phase === 'draft') return ['market'];
  if (l.phase === 'preseason') return l.personnel?.clock?.cutdown ? ['cuts'] : ['draft'];
  if (l.phase === 'regular' && l.week === 1 && !l.games.some((g) => g.season === l.season && g.result))
    return toldKeys(l).has(dayId(l, 'cuts')) ? ['kickoff'] : ['cuts', 'kickoff'];
  return [];
}

export const dayId = (l: League, day: Day): string => `snn:${l.season}:d:${day}`;

/** The edition for these days (one, or cut-down day and Kickoff together), or nothing when no story could lead it. */
export function buildDay(l: League, days: Day[]): Edition | null {
  const day = days.at(-1);
  if (!day) return null;
  const id = dayId(l, day);
  const have = toldKeys(l);
  const user = employed(l) ? l.userTeamId : null;
  const cut = cutDay(
    rankDay(
      days.flatMap((d) => dayCandidates(l, d, have)),
      id,
    ),
    user,
  );
  if (!cut) return null;
  const at = { editionId: id, said: [...seasonSaid(l, SNN, 'snn:')] };
  const lead = writeDayStory(l, cut.lead, at);
  const club = user === null ? null : yourDayStory(l, day, at);
  const tiles = cut.tiles.map((c) => writeDayStory(l, c, at));
  const lists = dayLists(l, [...days].reverse());
  return {
    label: DAY_LABEL[day],
    scores: [],
    lead,
    ...(club ? { club } : {}),
    tiles,
    day,
    ...(lists.length ? { lists } : {}),
  };
}

/**
 * SNN's edition for the moment the league is at, as mail: filed at its moment only (a simmed offseason gets the last
 * one, not a backlog), once. Its body holds every paragraph it printed, for search and so the next edition steps
 * around them; `covered` names what it told, under its own keys and the ids of the mails it replaces.
 */
export function dayMail(l: League): Draft[] {
  if (!DAYS.on) return [];
  const days = dayNow(l);
  const day = days.at(-1);
  if (!day) return [];
  const id = dayId(l, day);
  const have = toldKeys(l);
  if (have.has(id)) return [];
  // A save that was already told this year's window the old way (a digest on file) gets no second telling.
  if (day === 'year' && legacyYear(l, have)) return [];
  const edition = buildDay(l, days);
  if (!edition) return [];
  const stories = [edition.lead, ...(edition.club ? [edition.club] : []), ...edition.tiles];
  return [
    {
      id,
      season: l.season,
      phase: l.phase,
      week: l.phase === 'regular' ? l.week : 0,
      from: SNN,
      category: 'league',
      subject: `${edition.label} · ${short(edition.lead.headline, SUBJECT - edition.label.length - 3)}`,
      body: stories.flatMap((s) => s.paragraphs).join('\n\n'),
      edition,
      // A day told inside another's edition (cut-down day in Kickoff's) is on file with it.
      covered: [
        ...new Set([
          ...days.slice(0, -1).map((d) => dayId(l, d)),
          // The new league year's edition stands in for the digests of old, whichever of their news it printed.
          ...(day === 'year' ? yearDigests(l) : []),
          ...stories.flatMap((s) => [s.key, ...(s.covers ?? [])]),
        ]),
      ],
      // What is known of the new GMs rides under the page, as it did under the front-office digest.
      ...(days.includes('year') ? newGmNotes(l) : {}),
      actions: [],
    },
  ];
}

/** How many new GMs the edition says a word about under its page. */
const GM_NOTES = 3;
/** A line on each new general manager's record, for the first few: the note the front-office digest carried. */
function newGmNotes(l: League): { gmNotes?: { gmId: number; line: string }[] } {
  const notes = topChanges(l)
    .filter((x) => x.job === 'gm' && x.gmId !== undefined && x.teamId !== (employed(l) ? l.userTeamId : -1))
    .slice(0, GM_NOTES)
    .map((x) => ({ gmId: x.gmId!, line: reputation(l, l.gms[x.gmId!]) }));
  return notes.length ? { gmNotes: notes } : {};
}

/** A day's edition is on file, or is being filed now: the mails it replaces step aside. */
export function dayOnFile(l: League, day: Day, have: Set<string>): boolean {
  if (!DAYS.on) return false;
  if (have.has(dayId(l, day))) return true;
  const days = dayNow(l);
  return days.includes(day) && !(day === 'year' && legacyYear(l, have)) && buildDay(l, days) !== null;
}
