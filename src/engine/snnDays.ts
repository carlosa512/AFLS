/**
 * The editor of SNN's big-day editions (`docs/NEWS.md`, spec `docs/superpowers/specs/2026-11-12-snn-big-days-design.md`):
 * one front page for each of the calendar's big days (the new league year, free agency, draft day, cut-down day,
 * kickoff), on the weekly edition's page. It works as the weekly editor does: gather the day's candidates from the
 * public record (the transaction log, the draft, leadership events, the schedule), rank them, cut them to a page (a
 * lead, the reader's club, up to three tiles, one story a club), and have `snnDayVoice.ts` word them. Inside a tier
 * the more worthwhile story comes first (`stakes`: the earlier pick, the bigger contract, the bigger name). Mail-side
 * only: public facts, no draws, nothing in the sim reads it. What an edition printed lives in its `covered` keys.
 */
import { employed } from './employment';
import type { Draft } from './senders';
import { writeDayStory, yourDayStory } from './snnDayVoice';
import { short, SNN, SUBJECT } from './snnWeek';
import type { Edition, EditionDay, EditionList, League, Player } from './types';
import { seasonSaid, stableHash, toldKeys } from './voice';

export type Day = EditionDay;

/** The bars, each the owner's call from the counts (`npm run editions -- --offseasons n`). */
export const DAY = {
  /** A trade up is a story when it lands at this pick or earlier. */
  upInside: 10,
  /** The wait: places below the consensus, in the first two rounds. Only the furthest fall is told. */
  wait: 15,
  /** Ahead of the board: places above the consensus, in the first round. Only the widest gap is told. */
  ahead: 15,
  /** The club with the most picks in the first two rounds is a story at this many. */
  haulPicks: 4,
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
  text?: string;
}

const drafted = (l: League): Player[] =>
  Object.values(l.players)
    .filter((p) => p.draft?.season === l.season)
    .sort((a, b) => a.draft!.pick - b.draft!.pick);

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
    if (!d.deal || d.pick > DAY.upInside || p === first) continue;
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
  const wait = ranked.filter((p) => p.draft!.round <= 2).sort((a, b) => fall(b) - fall(a) || a.id - b.id)[0];
  if (wait && fall(wait) >= DAY.wait) out.push({ ...base(wait, 'wait'), tier: 3, stakes: fall(wait) / 100 });
  const ahead = ranked.filter((p) => p.draft!.round === 1).sort((a, b) => fall(a) - fall(b) || a.id - b.id)[0];
  if (ahead && -fall(ahead) >= DAY.ahead) out.push({ ...base(ahead, 'ahead'), tier: 3, stakes: -fall(ahead) / 100 });
  // The club with the most picks in the first two rounds, alone at the top.
  const early = picks.filter((p) => p.draft!.round <= 2);
  const by = new Map<number, Player[]>();
  for (const p of early) by.set(p.draft!.teamId, [...(by.get(p.draft!.teamId) ?? []), p]);
  const hauls = [...by.values()].sort((a, b) => b.length - a.length);
  if (hauls[0] && hauls[0].length >= DAY.haulPicks && hauls[0].length > (hauls[1]?.length ?? 0))
    out.push({ ...base(hauls[0][0], 'haul'), tier: 4, stakes: hauls[0].length / 10, n: hauls[0].length });
  return out;
}

/** A day's candidates that no edition has told yet. */
export function dayCandidates(l: League, day: Day, have: Set<string>): DayCandidate[] {
  const all = day === 'draft' ? draftCandidates(l) : [];
  return all.filter((c) => !have.has(c.key) && !(c.covers ?? []).some((id) => have.has(id)));
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

/** How many stories of one angle a page runs among its lead and tiles. */
const SAME_ANGLE = 2;
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
      if (varied && (told.get(c.angle) ?? 0) >= SAME_ANGLE) continue;
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
    if (rows.length) out.push({ title: 'Round one', head: ['Pick', 'Player', 'Club', 'Consensus'], rows });
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
  const days = dayNow(l);
  const day = days.at(-1);
  if (!day) return [];
  const id = dayId(l, day);
  if (toldKeys(l).has(id)) return [];
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
          ...stories.flatMap((s) => [s.key, ...(s.covers ?? [])]),
        ]),
      ],
      actions: [],
    },
  ];
}
