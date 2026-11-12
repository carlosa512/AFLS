/**
 * The editor of SNN's big-day editions (`docs/NEWS.md`, spec `docs/superpowers/specs/2026-11-12-snn-big-days-design.md`):
 * one front page for each of the calendar's big days (the new league year, free agency, draft day, cut-down day,
 * kickoff), on the weekly edition's page. It works as the weekly editor does: gather the day's candidates from the
 * public record (the transaction log, the draft, leadership events, the schedule), rank them, cut them to a page (a
 * lead, the reader's club, up to three tiles, one story a club), and have `snnDayVoice.ts` word them. Inside a tier
 * the more worthwhile story comes first (`stakes`: the earlier pick, the bigger contract, the bigger name). Mail-side
 * only: public facts, no draws, nothing in the sim reads it. What an edition printed lives in its `covered` keys.
 */
import { coachName, teamCoaches } from './coaching';
import { disputeOf } from './disputeRead';
import { employed } from './employment';
import { gamesInWeek } from './league';
import { reputation } from './gmVoice';
import { headCoachChanges } from './inbox';
import { mentorFacts } from './lockerMail';
import { freeAgents } from './offseason/negotiation';
import { draftedHigh, publicRecord, type PublicRecord } from './publicStanding';
import { activeRoster } from './roster';
import { kickoffLabel, kickoffOrder } from './season/kickoff';
import { statLine } from './stats';
import type { Draft } from './senders';
import { writeDayStory, yourDayStory } from './snnDayVoice';
import { short, SNN, SUBJECT } from './snnWeek';
import type { Edition, EditionDay, EditionList, League, Phase, Player } from './types';
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
  /** The team that signed the most starters in free agency, or lost the most, is a story at this many. */
  marketStarters: 4,
  /** A head coach kept after this many losing seasons in a row with his team starts the year as a story. */
  seatRun: 2,
  /** The team with the most new starters at Kickoff is a story at this many of its 24 jobs. */
  turnover: 8,
  /** A veteran released on cut-down day is a story at this many snaps last season. */
  cutSnaps: 700,
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
  /** What went the other way in a trade: the picks by year and round, and the players. */
  back?: { picks: { season: number; round: number }[]; players: number[] };
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

/** A heavy price to move up: a future first-round pick, or three picks or more. */
const heavyPrice = (got: string[]) => got.length >= 3 || got.some((g) => /^\d{4} round 1$/.test(g));

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
  // The price is the headline once a day, for the earliest pick bought that way.
  let priced = false;
  for (const p of [...picks].sort((a, b) => a.draft!.pick - b.draft!.pick)) {
    const d = p.draft!;
    if (!d.deal || p === first || !movedUp(d.pick, d.deal.got)) continue;
    // Inside the top ten, or anywhere in round one when a team paid heavily to get there.
    const heavy = heavyPrice(d.deal.got);
    if (d.pick > DAY.upInside && !(d.round === 1 && heavy)) continue;
    const headline = heavy && !priced;
    priced ||= heavy;
    out.push({
      ...base(p, 'up'),
      tier: 2,
      // The higher pick is the bigger story: the price only breaks a near tie.
      stakes: 1 / d.pick + (heavy ? 0.1 : 0),
      ...(headline ? { text: 'heavy' } : {}),
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
    // One key a move: the same player can be news again when he signs somewhere.
    key: `player:${x.p.id}:${l.season}:${angle}`,
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

/** A signing of free agency's first week: who, where he went, and where he finished last season (when anywhere). */
interface Signing {
  p: Player;
  to: number;
  from: number | undefined;
}
export function signings(l: League): Signing[] {
  return l.transactions
    .filter((t) => t.season === l.season && t.phase === 'freeAgency' && t.kind === 'sign' && t.playerId !== undefined)
    .flatMap((t) => {
      const p = l.players[t.playerId!];
      // Still where he signed, on that deal: a player who has moved on since is another day's story.
      return p && p.contract && p.teamId === t.teamIds[0] ? [{ p, to: p.teamId, from: lastClub(l, p) }] : [];
    });
}
const totalOf = (p: Player) => (p.contract ? p.contract.apy * p.contract.length : 0);

/** Free agency: a star who changed teams, the richest deal, the biggest haul and the biggest loss, who is still out there. */
function marketCandidates(l: League, rec: PublicRecord): DayCandidate[] {
  const out: DayCandidate[] = [];
  const signed = signings(l);
  const moved = signed.filter((x) => x.from !== undefined && x.from !== x.to);
  const base = (x: Signing, angle: string) => ({
    key: `player:${x.p.id}:${l.season}:${angle}`,
    day: 'market' as const,
    angle,
    clubId: x.to,
    teams: x.from === undefined ? [x.to] : [x.to, x.from],
    playerId: x.p.id,
    ...(x.from !== undefined ? { otherId: x.from } : {}),
    ...dealOf(x.p),
  });
  // The richest contract of the week leads, as the first pick leads Draft day: it is the day's biggest fact.
  const richest = [...signed].sort((a, b) => totalOf(b.p) - totalOf(a.p) || a.p.id - b.p.id)[0];
  if (richest) out.push({ ...base(richest, 'richest'), tier: 1, stakes: 2 });
  const stars = moved.filter((x) => rec.standing(x.p) === 'star' && x !== richest);
  for (const x of stars) out.push({ ...base(x, 'moved'), tier: 1, stakes: rec.worth(x.p) });
  // The one team that signed the most of last season's starters, and the one that lost the most.
  const starters = moved.filter((x) => rec.standing(x.p) !== 'depth');
  const most = (side: 'to' | 'from', angle: string) => {
    const by = new Map<number, Signing[]>();
    for (const x of starters) by.set(x[side]!, [...(by.get(x[side]!) ?? []), x]);
    const ranked = [...by].sort((a, b) => b[1].length - a[1].length || a[0] - b[0]);
    if (!ranked[0] || ranked[0][1].length < DAY.marketStarters || ranked[0][1].length === ranked[1]?.[1].length) return;
    const [teamId, xs] = ranked[0];
    const best = [...xs].sort((a, b) => rec.worth(b.p) - rec.worth(a.p) || a.p.id - b.p.id)[0];
    out.push({
      key: `market:${l.season}:${angle}:${teamId}`,
      day: 'market',
      angle,
      tier: 3,
      clubId: teamId,
      teams: [teamId],
      stakes: xs.length / 20,
      n: xs.length,
      playerId: best.p.id,
      otherId: side === 'to' ? best.from : best.to,
    });
  };
  most('to', 'haul');
  most('from', 'lostMarket');
  // A signing by a team he has played for before, further back than last season.
  for (const x of moved)
    if ((x.p.left ?? []).slice(0, -1).some((d) => d.teamId === x.to))
      out.push({ ...base(x, 'home'), tier: 4, stakes: rec.worth(x.p) });
  // The best player nobody has signed.
  const open = freeAgents(l)
    .filter((p) => rec.standing(p) !== 'depth' && lastClub(l, p) !== undefined)
    .sort((a, b) => rec.worth(b) - rec.worth(a) || a.id - b.id)[0];
  if (open)
    out.push({
      key: `player:${open.id}:${l.season}:unsigned`,
      day: 'market',
      angle: 'unsigned',
      tier: 4,
      clubId: lastClub(l, open)!,
      teams: [lastClub(l, open)!],
      stakes: rec.worth(open),
      playerId: open.id,
    });
  return out;
}

/** Camp's releases that name their player (an entry from before v96 names none, and is no story). */
const campCuts = (l: League): { p: Player; teamId: number }[] =>
  l.transactions
    .filter((t) => t.season === l.season && t.phase === 'preseason' && t.kind === 'release' && t.playerId !== undefined)
    .flatMap((t) => (l.players[t.playerId!] ? [{ p: l.players[t.playerId!], teamId: t.teamIds[0] }] : []));
const lastSnaps = (l: League, p: Player) => statLine(p, l.season - 1)?.snaps ?? 0;
/** Rookies nobody drafted who are on a 53. */
const undraftedOn53 = (l: League): Player[] =>
  l.teams.flatMap((t) => activeRoster(l, t.id).filter((p) => p.experience === 0 && !p.draft));

/** Cut-down day: a star released, a veteran starter, a high pick of the last three drafts, the undrafted who made it. */
function cutsCandidates(l: League, rec: PublicRecord): DayCandidate[] {
  const out: DayCandidate[] = [];
  for (const x of campCuts(l)) {
    const star = rec.standing(x.p) === 'star';
    const vet = lastSnaps(l, x.p) >= DAY.cutSnaps;
    const high = draftedHigh(l, x.p);
    if (!star && !vet && !high) continue;
    out.push({
      key: `player:${x.p.id}:${l.season}:cut`,
      day: 'cuts',
      angle: star ? 'cutStar' : vet ? 'cutVet' : 'cutPick',
      tier: star ? 1 : vet ? 2 : 3,
      clubId: x.teamId,
      teams: [x.teamId],
      stakes: rec.worth(x.p),
      playerId: x.p.id,
    });
  }
  // One story for the rookies nobody drafted: the one on the best of last season's teams stands for them.
  const made = undraftedOn53(l).sort((a, b) => lastPct(l, b.teamId!) - lastPct(l, a.teamId!) || a.id - b.id);
  if (made[0])
    out.push({
      key: `cuts:${l.season}:undrafted`,
      day: 'cuts',
      angle: 'undrafted',
      tier: 4,
      clubId: made[0].teamId!,
      teams: [made[0].teamId!],
      stakes: 0,
      n: made.length,
      playerId: made[0].id,
    });
  return out;
}

/** The quarterback who holds each team's job, from its depth chart as set on cut-down day. */
const startingQb = (l: League, teamId: number): Player | undefined => {
  const id = Object.entries(l.teams[teamId].jobs?.held ?? {}).find(([, j]) => j.pos === 'QB')?.[0];
  return id === undefined ? undefined : l.players[Number(id)];
};
/** Each team's passer in a season (last season's unless given): the most attempts among the players who finished it there. */
function lastPassers(l: League, season = l.season - 1): Map<number, number> {
  const best = new Map<number, { id: number; att: number }>();
  for (const p of Object.values(l.players)) {
    const teamId = p.statTeams?.[season]?.at(-1);
    const att = statLine(p, season)?.passAtt ?? 0;
    if (teamId !== undefined && att > (best.get(teamId)?.att ?? 0)) best.set(teamId, { id: p.id, att });
  }
  return new Map([...best].map(([teamId, x]) => [teamId, x.id]));
}
const opener = (l: League, teamId: number) =>
  gamesInWeek(l, 1).find((g) => g.season === l.season && (g.homeId === teamId || g.awayId === teamId));

/** Kickoff: the champion's opener, a rookie quarterback starting, a new head coach's first game, a new quarterback. */
function kickoffCandidates(l: League): DayCandidate[] {
  const out: DayCandidate[] = [];
  const game = (teamId: number, angle: string, tier: 2 | 3, stakes: number, more: Partial<DayCandidate> = {}) => {
    const g = opener(l, teamId);
    if (!g) return;
    const other = g.homeId === teamId ? g.awayId : g.homeId;
    out.push({
      key: `kick:${l.season}:${angle}:${teamId}`,
      day: 'kickoff',
      angle,
      tier,
      clubId: teamId,
      teams: [teamId, other],
      stakes,
      otherId: other,
      ...more,
    });
  };
  const champion = l.history.find((h) => h.season === l.season - 1)?.championId;
  if (champion !== undefined) game(champion, 'champion', 2, 1);
  const passers = lastPassers(l);
  // The season before: a starter back from a year lost to injury is not a new quarterback.
  const before = lastPassers(l, l.season - 2);
  for (const t of l.teams) {
    const qb = startingQb(l, t.id);
    if (!qb) continue;
    if (qb.experience === 0) game(t.id, 'rookieQb', 2, 0.9, { playerId: qb.id });
    // A league with no last season has no passer to compare him with.
    else if (passers.has(t.id) && passers.get(t.id) !== qb.id && before.get(t.id) !== qb.id)
      game(t.id, 'newQb', 3, lastPct(l, t.id), { playerId: qb.id, n: passers.get(t.id) });
  }
  for (const x of topChanges(l))
    if (x.job === 'coach') game(x.teamId, 'newCoach', 3, lastPct(l, x.teamId) + 0.01, { coachId: x.coachId });
  return out;
}

/** The phase whose trades a day's edition tells. */
const TRADE_PHASE: Partial<Record<Day, Phase>> = {
  year: 'resign',
  market: 'freeAgency',
  draft: 'draft',
  cuts: 'preseason',
};

/** A trade with a star in it: who got him, who sent him, and what went back. Other trades are not a story. */
function tradeCandidates(l: League, day: Day, rec: PublicRecord): DayCandidate[] {
  const phase = TRADE_PHASE[day];
  if (!phase) return [];
  const out: DayCandidate[] = [];
  for (const r of l.market?.history ?? []) {
    if (r.season !== l.season || r.phase !== phase) continue;
    const star = r.sides
      .flatMap((s) => s.players)
      .flatMap((id) => (l.players[id] && rec.standing(l.players[id]) === 'star' ? [l.players[id]] : []))
      .sort((a, b) => rec.worth(b) - rec.worth(a) || a.id - b.id)[0];
    if (!star) continue;
    const seller = r.sides.find((s) => s.players.includes(star.id))!;
    const buyer = r.sides.find((s) => s !== seller)!;
    out.push({
      key: `player:${star.id}:${l.season}:traded:${phase}`,
      day,
      angle: 'trade',
      tier: 1,
      clubId: buyer.teamId,
      teams: [buyer.teamId, seller.teamId],
      stakes: rec.worth(star),
      playerId: star.id,
      otherId: seller.teamId,
      n: buyer.picks.length,
      back: {
        picks: buyer.picks.flatMap((id) => {
          const pick = l.draftPicks.find((x) => x.id === id);
          return pick ? [{ season: pick.season, round: pick.round }] : [];
        }),
        players: buyer.players.filter((id) => l.players[id]),
      },
    });
  }
  return out;
}

/** How many losing seasons in a row a head coach has had with his team, counting back from last season. */
export function losingRun(l: League, coachId: number, teamId: number): number {
  const c = l.coaches[coachId];
  let n = 0;
  for (let season = l.season - 1; ; season--) {
    const r = l.history.find((h) => h.season === season)?.records[teamId];
    const his = (c?.career ?? []).some((x) => x.season === season && x.teamId === teamId && x.role === 'headCoach');
    if (!r || !his || r.w >= r.l) return n;
    n++;
  }
}

/**
 * Who starts the league year needing results, from the public record: a GM the owners' reviews put on notice (the
 * report SNN was given), and a head coach kept after `DAY.seatRun` losing seasons in a row with his team.
 */
function pressureCandidates(l: League): DayCandidate[] {
  const out: DayCandidate[] = [];
  const seen = new Set<number>();
  for (const e of l.leadership.events) {
    // A warning that names a coach is a new GM told to keep him: no pressure on anyone.
    if (e.date.season !== l.season || e.kind !== 'warning' || e.coachId !== undefined) continue;
    if (e.gmId === undefined || !l.gms[e.gmId] || e.gmId === l.userGmId || seen.has(e.teamId)) continue;
    if (l.teams[e.teamId].gmId !== undefined && l.teams[e.teamId].gmId !== e.gmId) continue;
    seen.add(e.teamId);
    out.push({
      key: `lead:${l.season}:${e.teamId}:pressure`,
      day: 'year',
      angle: 'pressure',
      tier: 3,
      clubId: e.teamId,
      teams: [e.teamId],
      stakes: 1 - lastPct(l, e.teamId),
      gmId: e.gmId,
    });
  }
  for (const t of l.teams) {
    const hc = teamCoaches(l, t.id).find((c) => c.role === 'headCoach');
    const n = hc ? losingRun(l, hc.id, t.id) : 0;
    if (!hc || n < DAY.seatRun || seen.has(t.id)) continue;
    out.push({
      key: `lead:${l.season}:${t.id}:seat`,
      day: 'year',
      angle: 'seat',
      tier: 3,
      clubId: t.id,
      teams: [t.id],
      stakes: 1 - lastPct(l, t.id) + n / 10,
      coachId: hc.id,
      n,
    });
  }
  return out;
}

/** Cut-down day's other news: a starter still holding out, and a star who changed position in camp. */
function campCandidates(l: League, rec: PublicRecord): DayCandidate[] {
  const out: DayCandidate[] = [];
  for (const p of Object.values(l.players)) {
    const d = disputeOf(p);
    if (p.teamId === null || d?.kind !== 'holdOut' || !d.out || rec.standing(p) === 'depth') continue;
    out.push({
      key: `player:${p.id}:${l.season}:holdout`,
      day: 'cuts',
      angle: 'holdout',
      tier: 2,
      clubId: p.teamId,
      teams: [p.teamId],
      stakes: rec.worth(p),
      playerId: p.id,
    });
  }
  for (const t of l.transactions) {
    if (t.season !== l.season || t.kind !== 'position' || t.playerId === undefined) continue;
    const p = l.players[t.playerId];
    const from = / moved (\w+) /.exec(t.text)?.[1];
    if (!p || !from || rec.standing(p) !== 'star' || p.teamId !== t.teamIds[0]) continue;
    out.push({
      key: `player:${p.id}:${l.season}:position`,
      day: 'cuts',
      angle: 'position',
      tier: 2,
      clubId: p.teamId,
      teams: [p.teamId],
      stakes: rec.worth(p),
      playerId: p.id,
      text: from,
    });
  }
  return out;
}

const OFFENSE = new Set(['QB', 'RB', 'WR', 'TE', 'OL']);
const DEFENSE = new Set(['DT', 'EDGE', 'LB', 'CB', 'S']);
/** Kickoff's other news: the team with the most new starters (and its new staff), and a coach's first game against his mentor. */
function openingCandidates(l: League, have: Set<string>): DayCandidate[] {
  const out: DayCandidate[] = [];
  const fresh = l.teams
    .map((t) => {
      const held = Object.keys(t.jobs?.held ?? {}).flatMap((id) =>
        l.players[Number(id)] ? [l.players[Number(id)]] : [],
      );
      // New to the team: a rookie, or a player who finished last season with another one.
      const news = held.filter((p) => {
        const from = lastClub(l, p);
        return p.experience === 0 || (from !== undefined && from !== t.id);
      });
      return { teamId: t.id, news };
    })
    // Level on new starters, the team that did worse last season is the one that turned over.
    .sort(
      (a, b) => b.news.length - a.news.length || lastPct(l, a.teamId) - lastPct(l, b.teamId) || a.teamId - b.teamId,
    );
  const top = fresh[0];
  if (top && top.news.length >= DAY.turnover && opener(l, top.teamId)) {
    const last = l.season - 1;
    const staff = teamCoaches(l, top.teamId)
      .filter((c) => ['headCoach', 'offCoord', 'defCoord'].includes(c.role))
      .filter((c) => !(c.career ?? []).some((x) => x.season === last && x.teamId === top.teamId && x.role === c.role))
      .map((c) => c.role);
    out.push({
      key: `kick:${l.season}:turnover:${top.teamId}`,
      day: 'kickoff',
      angle: 'turnover',
      tier: 3,
      clubId: top.teamId,
      teams: [top.teamId],
      stakes: 0.99,
      otherId:
        opener(l, top.teamId)!.homeId === top.teamId ? opener(l, top.teamId)!.awayId : opener(l, top.teamId)!.homeId,
      n: top.news.length,
      // How the new starters split, and the new staff, for the words.
      got: [
        `off:${top.news.filter((p) => OFFENSE.has(p.position)).length}`,
        `def:${top.news.filter((p) => DEFENSE.has(p.position)).length}`,
        ...staff,
      ],
    });
  }
  // A head coach's first game against the coach he learned under: the weekly edition's own story, told here for Week 1.
  for (const m of mentorFacts(l, 1, have))
    out.push({
      key: m.id,
      day: 'kickoff',
      angle: 'mentor',
      tier: 4,
      clubId: l.coaches[m.discipleId]?.teamId ?? m.homeId,
      teams: [m.homeId, m.awayId],
      stakes: lastPct(l, m.homeId) + lastPct(l, m.awayId),
      coachId: m.discipleId,
      n: m.mentorId,
      otherId: l.coaches[m.mentorId]?.teamId ?? m.awayId,
    });
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
  const all = [
    ...(day === 'draft'
      ? draftCandidates(l)
      : day === 'year'
        ? [...yearCandidates(l, rec), ...pressureCandidates(l)]
        : day === 'market'
          ? marketCandidates(l, rec)
          : day === 'cuts'
            ? [...cutsCandidates(l, rec), ...campCandidates(l, rec)]
            : [...kickoffCandidates(l), ...openingCandidates(l, have)]),
    ...tradeCandidates(l, day, rec),
  ];
  // A change at the top is news on whichever day it is first told, unless that year's digests told it the old way.
  // By Kickoff a new head coach is told as his first game, so a change no edition found room for rests there.
  const top = legacyYear(l, have) || day === 'kickoff' ? [] : leaderCandidates(l, day);
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
const ONCE = new Set(['wait', 'ahead', 'seat', 'pressure', 'mentor']);
/**
 * Kinds of story a page keeps one tile for when the day has one, whatever ranks above it: who starts the league year
 * needing results (the other end of "New in charge"), and a head coach's first game against his mentor.
 */
const RESERVED = [new Set(['seat', 'pressure']), new Set(['mentor'])];
/** Stories that fill a tile and never lead a page. */
const NO_LEAD = new Set(['mentor']);
const TILES = 3;

/**
 * The page's slots from the ranked day: the lead is the biggest story that is not about the reader's club (his club
 * has its own slot, written whole by `yourDayStory`), then three tiles, one story a club. Nothing when no story could lead.
 */
export function cutDay(
  ranked: DayCandidate[],
  userTeamId: number | null,
  leadDay?: Day,
): { lead: DayCandidate; tiles: DayCandidate[] } | null {
  // A page that holds two days (cut-down day inside Kickoff's) leads with the day it is named for, when it has a story.
  const leads = ranked.filter((c) => c.clubId !== userTeamId && !NO_LEAD.has(c.angle));
  const lead = leads.find((c) => c.day === leadDay) ?? leads[0];
  if (!lead) return null;
  const days = new Set(ranked.map((c) => c.day));
  const perDay = new Map<Day, number>();
  const used = new Set<number>([lead.clubId]);
  const told = new Map<string, number>([[lead.angle, 1]]);
  const tiles: DayCandidate[] = [];
  const take = (c: DayCandidate) => {
    perDay.set(c.day, (perDay.get(c.day) ?? 0) + 1);
    used.add(c.clubId);
    told.set(c.angle, (told.get(c.angle) ?? 0) + 1);
    tiles.push(c);
  };
  for (const kinds of RESERVED) {
    const c = ranked.find((x) => kinds.has(x.angle) && x !== lead && x.clubId !== userTeamId && !used.has(x.clubId));
    if (c && tiles.length < TILES - 1) take(c);
  }
  // Variety first (an angle twice at most); then a slot still empty takes the next story whatever its angle, since a
  // third trade up is better than a blank tile.
  for (const varied of [true, false])
    for (const c of ranked) {
      if (tiles.length >= TILES) break;
      if (c === lead || c.clubId === userTeamId || used.has(c.clubId)) continue;
      const n = told.get(c.angle) ?? 0;
      // "The furthest fall" is said once a page, whatever else is empty.
      if (ONCE.has(c.angle) ? n >= 1 : varied && n >= SAME_ANGLE) continue;
      // On a page of two days neither takes every tile while the other has a story to tell.
      if (varied && days.size > 1 && (perDay.get(c.day) ?? 0) >= TILES - 1) continue;
      take(c);
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
  if (days.includes('market')) {
    const rows = signings(l)
      .sort((a, b) => totalOf(b.p) - totalOf(a.p) || a.p.id - b.p.id)
      .slice(0, DAY.listRows)
      .map((x) => ({
        playerId: x.p.id,
        teamId: x.to,
        cells: [
          nameOf(x.p),
          x.from !== undefined && x.from !== x.to ? l.teams[x.from].name : '',
          l.teams[x.to].name,
          `${x.p.contract!.length} yr, $${Math.round(totalOf(x.p) / 1000)}M`,
        ],
      }));
    if (rows.length) out.push({ title: 'The biggest contracts', head: ['Player', 'From', 'To', 'Deal'], rows });
  }
  if (days.includes('kickoff')) {
    const rows = gamesInWeek(l, 1)
      .filter((g) => g.season === l.season)
      .sort((a, b) => kickoffOrder(a.kickoff) - kickoffOrder(b.kickoff) || a.id - b.id)
      .map((g) => ({
        teamId: g.homeId,
        otherId: g.awayId,
        cells: [`${l.teams[g.awayId].name} at ${l.teams[g.homeId].name}`, g.kickoff ? kickoffLabel(g.kickoff) : ''],
      }));
    if (rows.length) out.push({ title: 'Opening week', head: ['Game', 'Kickoff'], rows });
  }
  if (days.includes('cuts')) {
    const rec = publicRecord(l);
    const rows = campCuts(l)
      .filter((x) => rec.standing(x.p) !== 'depth' || draftedHigh(l, x.p))
      .sort((a, b) => rec.worth(b.p) - rec.worth(a.p) || a.p.id - b.p.id)
      .slice(0, DAY.listRows)
      .map((x) => ({
        playerId: x.p.id,
        teamId: x.teamId,
        cells: [nameOf(x.p), l.teams[x.teamId].name, String(statLine(x.p, l.season - 1)?.gp ?? 0)],
      }));
    if (rows.length) out.push({ title: 'Notable cuts', head: ['Player', 'Team', 'Games last season'], rows });
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
  // The clock is last year's until something asks for this year's (`personnelClock`): only this year's cuts count.
  const clock = l.personnel?.clock;
  if (l.phase === 'preseason') return clock?.season === l.season && clock.cutdown ? ['cuts'] : ['draft'];
  // A league that has not played a season has no offseason to report: its first edition is Week 1's.
  const played = l.history.some((h) => h.season === l.season - 1);
  if (played && l.phase === 'regular' && l.week === 1 && !l.games.some((g) => g.season === l.season && g.result))
    return toldKeys(l).has(dayId(l, 'cuts')) ? ['kickoff'] : ['cuts', 'kickoff'];
  return [];
}

export const dayId = (l: League, day: Day): string => `snn:${l.season}:d:${day}`;

/**
 * Opening week's game of the week: the two best of last season's records meeting, the reader's own game aside. This
 * season has no records yet, so each team's is last season's.
 */
function openingGame(l: League, user: number | null): Pick<Edition, 'next'> {
  const text = (teamId: number) => {
    const r = lastRecord(l, teamId);
    return r ? `${r.w}–${r.l}${r.t ? `–${r.t}` : ''} last season` : '';
  };
  const g = gamesInWeek(l, 1)
    .filter((x) => x.season === l.season && x.homeId !== user && x.awayId !== user)
    .sort(
      (a, b) =>
        lastPct(l, b.homeId) + lastPct(l, b.awayId) - lastPct(l, a.homeId) - lastPct(l, a.awayId) || a.id - b.id,
    )[0];
  return g && lastRecord(l, g.homeId) && lastRecord(l, g.awayId)
    ? { next: { gameId: g.id, homeId: g.homeId, awayId: g.awayId, home: text(g.homeId), away: text(g.awayId) } }
    : {};
}

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
    day,
  );
  if (!cut) return null;
  const at = { editionId: id, said: [...seasonSaid(l, SNN, 'snn:')] };
  const lead = writeDayStory(l, cut.lead, at);
  const club = user === null ? null : yourDayStory(l, day, at);
  const tiles = cut.tiles.map((c) => writeDayStory(l, c, at));
  const lists = dayLists(l, days);
  return {
    label: DAY_LABEL[day],
    scores: [],
    lead,
    ...(club ? { club } : {}),
    tiles,
    day,
    ...(lists.length ? { lists } : {}),
    ...(days.includes('kickoff') ? openingGame(l, user) : {}),
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
