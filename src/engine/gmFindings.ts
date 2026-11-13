/**
 * What the public record shows about a general manager's work at one team, as findings SNN's Column can build a piece
 * on (`snnGmVoice.ts`; spec `docs/superpowers/specs/2026-11-13-gm-column-voice-design.md`): the quarterbacks he drafted,
 * the star he traded for, the contract that did not last, the player who left and won elsewhere. Pure: it reads picks,
 * his moves (`gmMoves.ts`), box-score lines, job-holders, honors and careers, and nothing a scout believes. Only his
 * seasons at this team count, so a GM on his second team is read there on what he did there.
 */
import { AWARD_KEYS, AWARD_NAMES } from './awards';
import { movesAt } from './gmMoves';
import { computeRecords } from './season/standings';
import type { Coach, Departure, GmMove, League, Player } from './types';
import { stableHash } from './voice';

export type FindingFamily =
  | 'qbPicks'
  | 'qbs'
  | 'firsts'
  | 'class'
  | 'lateFind'
  | 'starTrade'
  | 'contract'
  | 'left'
  | 'coaches';

/** An award or an All-League team, as a sentence would name it. */
export interface Honor {
  season: number;
  what: string;
  /** The team he won it with: a sentence names that team, which is not always the one he plays for now. */
  teamId: number;
}

/** A draft pick of his, and what has become of the player. */
export interface PickFact {
  playerId: number;
  season: number;
  round: number;
  pick: number;
  /** Still on this team. */
  here: boolean;
  /** Holds a starting job here (`Team.jobs.held`). */
  starts: boolean;
  /** Snaps this season. */
  snaps: number;
  /** Won with this team in his seasons. */
  honors: Honor[];
}

type Trade = Extract<GmMove, { kind: 'trade' }>;
type Signing = Extract<GmMove, { kind: 'sign' }>;

interface Base {
  side: 'blame' | 'credit';
  /** The season of its newest fact: a later piece may lead with the family again only when this has moved on. */
  latest: number;
}

export type Finding = Base &
  (
    | {
        family: 'qbPicks';
        picks: PickFact[];
        /** A quarterback he also signed for three years or more; `before` when that came no later than the first pick. */
        signed?: { playerId: number; season: number; years: number; before: boolean };
      }
    | { family: 'qbs'; passers: { season: number; playerId: number }[] }
    | { family: 'firsts'; picks: PickFact[]; starting: number; gone: number }
    | { family: 'class'; picks: PickFact[] }
    | { family: 'lateFind'; pick: PickFact }
    | {
        family: 'starTrade';
        move: Trade;
        playerId: number;
        here: boolean;
        honors: Honor[];
        /** A season the team won it all with him, or null. */
        title: number | null;
        /** A later trade of the same kind. */
        again?: Trade;
      }
    | { family: 'contract'; move: Signing; here: boolean; nowTeamId: number | null; honors: Honor[] }
    | {
        family: 'left';
        playerId: number;
        how: Departure['how'];
        season: number;
        nowTeamId: number;
        honors: Honor[];
      }
    | {
        family: 'coaches';
        coachIds: number[];
        /** One coach all the way through, begun the year the GM came. */
        hiredFirst: boolean;
        /** A head coach in his first season here, hired by a GM who was here before him, and winning. */
        newCoach?: true;
      }
  );

/** How much a family says, most first: what a piece leads with when a GM has more than one finding. */
export const FINDING_ORDER: Record<'blame' | 'credit', FindingFamily[]> = {
  blame: ['qbPicks', 'left', 'starTrade', 'contract', 'firsts', 'qbs', 'coaches'],
  credit: ['starTrade', 'class', 'lateFind', 'qbs', 'contract', 'firsts', 'coaches'],
};

/** A star trade costs a first-round pick; a quarterback signed for this long is a try at the position. */
const FIRST = 1;
const QB_YEARS = 3;
/** A late find comes from this round or later. */
const LATE_ROUND = 4;
/** A contract is blamed while the signing is this many league years old or fewer. */
const CONTRACT_YEARS = 2;
/** The current season counts (its leading passer, a new coach's record) once the team has played this many games. */
const PASSER_GAMES = 6;

/** His finished seasons at this team, oldest first. */
export function gmSeasons(l: League, gmId: number, teamId: number): { season: number; w: number; l: number }[] {
  const gm = l.gms[gmId];
  if (!gm) return [];
  return gm.career
    .filter((c) => c.teamId === teamId && c.season < l.season)
    .flatMap((c) => {
      const rec = c.record?.regular ?? l.history.find((h) => h.season === c.season)?.records[teamId];
      return rec ? [{ season: c.season, w: rec.w, l: rec.l }] : [];
    })
    .sort((a, b) => a.season - b.season);
}

/** What one read of a GM at a team shares between the families. */
interface Read {
  l: League;
  teamId: number;
  past: { season: number; w: number; l: number }[];
  /** His seasons here: the finished ones, and this one while he still runs the team. */
  T: Set<number>;
  first: number;
  moves: GmMove[];
  players: Player[];
  held: Record<number, unknown>;
}

function honorsOf(l: League, playerId: number, from: number, where: (teamId: number | null) => boolean): Honor[] {
  const out: Honor[] = [];
  for (const a of l.awards) {
    if (a.season < from) continue;
    for (const k of AWARD_KEYS) {
      const w = a.winners[k];
      if (w?.playerId === playerId && w.teamId !== null && where(w.teamId))
        out.push({ season: a.season, what: AWARD_NAMES[k], teamId: w.teamId });
    }
    a.allLeague.forEach((squad, i) => {
      const w = squad.find((x) => x.playerId === playerId && x.teamId !== null && where(x.teamId));
      if (w)
        out.push({
          season: a.season,
          what: i === 0 ? 'first-team All-League' : 'second-team All-League',
          teamId: w.teamId!,
        });
    });
  }
  return out;
}
/** Honors won with this team in one of his seasons, from `from` on. */
const honorsHere = (r: Read, playerId: number, from = r.first) =>
  honorsOf(r.l, playerId, from, (t) => t === r.teamId).filter((h) => r.T.has(h.season));
const newest = (xs: number[]) => Math.max(...xs);
const isHere = (r: Read, p: Player) => p.teamId === r.teamId;
const startsHere = (r: Read, p: Player) => isHere(r, p) && r.held[p.id] !== undefined;
/** He was traded away for a first-round pick: letting him go, or the contract he left on, is no finding against the GM. */
const soldForAFirst = (r: Read, playerId: number) =>
  r.moves.some(
    (m) => m.kind === 'trade' && m.gave.players.includes(playerId) && m.got.picks.some((p) => p.round === FIRST),
  );
/** On another team now: not retired and not unsigned, so a sentence can say where he plays. */
const elsewhere = (r: Read, p: Player) => !p.retired && p.teamId !== null && p.teamId !== r.teamId;

function pickFact(r: Read, p: Player): PickFact {
  return {
    playerId: p.id,
    season: p.draft!.season,
    round: p.draft!.round,
    pick: p.draft!.pick,
    here: isHere(r, p),
    starts: startsHere(r, p),
    snaps: p.stats[r.l.season]?.snaps ?? 0,
    honors: honorsHere(r, p.id),
  };
}

/** His draft picks here, by year and then by slot. */
const picksOf = (r: Read): PickFact[] =>
  r.players
    .filter((p) => p.draft && p.draft.teamId === r.teamId && r.T.has(p.draft.season))
    .sort((a, b) => a.draft!.season - b.draft!.season || a.draft!.pick - b.draft!.pick)
    .map((p) => pickFact(r, p));

function qbPicks(r: Read, picks: PickFact[]): Finding[] {
  const qbs = picks.filter((p) => p.round === FIRST && r.l.players[p.playerId].position === 'QB');
  if (qbs.length < 2) return [];
  const deal = r.moves.find(
    (m): m is Signing => m.kind === 'sign' && m.years >= QB_YEARS && r.l.players[m.playerId]?.position === 'QB',
  );
  const signed = deal
    ? { playerId: deal.playerId, season: deal.season, years: deal.years, before: deal.season <= qbs[0].season }
    : undefined;
  return [
    {
      family: 'qbPicks',
      side: 'blame',
      latest: newest([...qbs.map((p) => p.season), ...(signed ? [signed.season] : [])]),
      picks: qbs,
      ...(signed ? { signed } : {}),
    },
  ];
}

function quarterbacks(r: Read): Finding[] {
  const { l, teamId } = r;
  const me = computeRecords(l).get(teamId);
  const playing = r.T.has(l.season) && !!me && me.w + me.l + me.t >= PASSER_GAMES;
  const seasons = [...r.past.map((s) => s.season), ...(playing ? [l.season] : [])];
  const passers = seasons.flatMap((season) => {
    const best = r.players
      .filter((p) => (p.stats[season]?.passAtt ?? 0) > 0 && p.statTeams?.[season]?.includes(teamId))
      .sort((a, b) => b.stats[season]!.passAtt! - a.stats[season]!.passAtt! || a.id - b.id)[0];
    return best ? [{ season, playerId: best.id }] : [];
  });
  if (new Set(passers.map((p) => p.playerId)).size < 3) return [];
  const finished = r.past.filter((s) => passers.some((p) => p.season === s.season));
  const losing = finished.filter((s) => s.w < s.l).length;
  const side = finished.length && finished.every((s) => s.w > s.l) ? 'credit' : losing >= 2 ? 'blame' : null;
  return side ? [{ family: 'qbs', side, latest: passers.at(-1)!.season, passers }] : [];
}

function firstRounders(picks: PickFact[]): Finding[] {
  const firsts = picks.filter((p) => p.round === FIRST);
  if (firsts.length < 2) return [];
  const starting = firsts.filter((p) => p.starts).length;
  const side = starting === firsts.length ? 'credit' : starting < firsts.length / 2 ? 'blame' : null;
  if (!side) return [];
  const gone = firsts.filter((p) => !p.here).length;
  return [{ family: 'firsts', side, latest: newest(firsts.map((p) => p.season)), picks: firsts, starting, gone }];
}

function honoredPicks(picks: PickFact[]): Finding[] {
  // Still here: a team is not winning with a pick who has left.
  const honored = picks.filter((p) => p.honors.length && p.here).sort((a, b) => a.round - b.round || a.pick - b.pick);
  const out: Finding[] = [];
  const latest = (xs: PickFact[]) => newest(xs.flatMap((p) => p.honors.map((h) => h.season)));
  if (honored.length >= 2) out.push({ family: 'class', side: 'credit', latest: latest(honored), picks: honored });
  const late = honored
    .filter((p) => p.round >= LATE_ROUND)
    .sort((a, b) => b.honors.length - a.honors.length || b.round - a.round || a.pick - b.pick)[0];
  if (late) out.push({ family: 'lateFind', side: 'credit', latest: latest([late]), pick: late });
  return out;
}

function starTrades(r: Read): Finding[] {
  const { l, teamId } = r;
  const deals = r.moves
    .filter(
      (m): m is Trade =>
        m.kind === 'trade' &&
        r.T.has(m.season) &&
        m.gave.picks.some((p) => p.round === FIRST) &&
        m.got.players.length === 1 &&
        m.got.picks.length === 0 &&
        !!l.players[m.got.players[0]],
    )
    .map((move) => {
      const p = l.players[move.got.players[0]];
      return { move, p, honors: honorsHere(r, p.id, move.season) };
    });
  const facts = (d: (typeof deals)[number], side: 'blame' | 'credit'): Finding => {
    const again = deals.find((x) => x.move !== d.move && deals.indexOf(x) > deals.indexOf(d))?.move;
    const title = l.history.find((h) => h.championId === teamId && h.season >= d.move.season && r.T.has(h.season));
    return {
      family: 'starTrade',
      side,
      latest: newest([d.move.season, ...d.honors.map((h) => h.season)]),
      move: d.move,
      playerId: d.p.id,
      here: isHere(r, d.p),
      honors: d.honors,
      title: title?.season ?? null,
      ...(again ? { again } : {}),
    };
  };
  // Honored here and still here: a trade is not said to have paid for a team the player has left.
  const paid = deals
    .filter((d) => d.honors.length && isHere(r, d.p))
    .sort((a, b) => b.honors.length - a.honors.length)[0];
  // A full season on, nothing won here, and he is gone or not a starter.
  const firsts = (m: Trade) => m.gave.picks.filter((p) => p.round === FIRST).length;
  const bust = deals
    .filter((d) => !d.honors.length && l.season > d.move.season && !startsHere(r, d.p))
    .sort((a, b) => firsts(b.move) - firsts(a.move))[0];
  return [...(paid ? [facts(paid, 'credit')] : []), ...(bust ? [facts(bust, 'blame')] : [])];
}

function contracts(r: Read): Finding[] {
  const { l } = r;
  const deals = r.moves
    .filter((m): m is Signing => m.kind === 'sign' && r.T.has(m.season) && !!l.players[m.playerId])
    .map((move) => ({ move, p: l.players[move.playerId], honors: honorsHere(r, move.playerId, move.season) }));
  const facts = (d: (typeof deals)[number], side: 'blame' | 'credit'): Finding => ({
    family: 'contract',
    side,
    latest: newest([d.move.season, ...d.honors.map((h) => h.season)]),
    move: d.move,
    here: isHere(r, d.p),
    nowTeamId: d.p.teamId,
    honors: d.honors,
  });
  const gone = deals
    // Gone with the deal still running: a contract that ran its length is no finding against the man who wrote it.
    .filter(
      (d) =>
        elsewhere(r, d.p) &&
        !soldForAFirst(r, d.p.id) &&
        l.season - d.move.season <= CONTRACT_YEARS &&
        d.move.season + d.move.years > l.season,
    )
    .sort((a, b) => b.move.total - a.move.total)[0];
  const hit = deals
    .filter((d) => startsHere(r, d.p) && d.honors.length)
    .sort((a, b) => b.honors.length - a.honors.length)[0];
  return [...(hit ? [facts(hit, 'credit')] : []), ...(gone ? [facts(gone, 'blame')] : [])];
}

function whoLeft(r: Read): Finding[] {
  const { l, teamId } = r;
  const best = r.players
    .filter((p) => elsewhere(r, p) && !soldForAFirst(r, p.id))
    .flatMap((p) =>
      (p.left ?? [])
        .filter((d) => d.teamId === teamId && r.T.has(d.season))
        .map((d) => ({ p, d, honors: honorsOf(l, p.id, d.season, (t) => t !== null && t !== teamId) })),
    )
    .filter((x) => x.honors.length)
    .sort((a, b) => b.honors.length - a.honors.length || a.p.id - b.p.id)[0];
  if (!best) return [];
  return [
    {
      family: 'left',
      side: 'blame',
      latest: newest([best.d.season, ...best.honors.map((h) => h.season)]),
      playerId: best.p.id,
      how: best.d.how,
      season: best.d.season,
      nowTeamId: best.p.teamId!,
      honors: best.honors,
    },
  ];
}

function headCoaches(r: Read): Finding[] {
  const { l, teamId } = r;
  const all: Coach[] = [...Object.values(l.coaches), ...Object.values(l.retiredCoaches)];
  const here = (c: Coach) => (c.career ?? []).filter((s) => s.role === 'headCoach' && s.teamId === teamId);
  const under = all
    .map((c) => ({
      c,
      seasons: here(c)
        .filter((s) => r.T.has(s.season))
        .map((s) => s.season),
    }))
    .filter((x) => x.seasons.length)
    .sort((a, b) => Math.min(...a.seasons) - Math.min(...b.seasons) || a.c.id - b.c.id);
  const coachIds = under.map((x) => x.c.id);
  const out: Finding[] = [];
  if (under.length >= 3)
    out.push({
      family: 'coaches',
      side: 'blame',
      latest: Math.min(...under.at(-1)!.seasons),
      coachIds,
      hiredFirst: false,
    });
  // One coach all the way through, and his hire: the coach began here the year the GM did, and the league has a
  // season on record before that (a league's first coaches were there when the save began, hired by nobody).
  const began = under.length === 1 ? Math.min(...here(under[0].c).map((s) => s.season)) : null;
  const known = l.history.some((h) => h.season < r.first);
  if (began === r.first && known && r.T.size >= 3)
    out.push({ family: 'coaches', side: 'credit', latest: r.first, coachIds, hiredFirst: true });
  // A coach in his first season here under a GM who was here before him is that GM's hire: credit once he is winning.
  const now = Object.values(l.coaches).find((c) => c.teamId === teamId && c.role === 'headCoach' && !c.interim);
  const me = computeRecords(l).get(teamId);
  if (
    now &&
    r.T.has(l.season) &&
    !here(now).some((s) => s.season < l.season) &&
    me &&
    me.w + me.l + me.t >= PASSER_GAMES &&
    me.w > me.l &&
    // After a losing season: winning again under a new coach when the team was already winning is no turnaround.
    r.past.at(-1)!.w < r.past.at(-1)!.l &&
    !out.some((f) => f.side === 'credit')
  )
    out.push({
      family: 'coaches',
      side: 'credit',
      latest: l.season,
      coachIds: [now.id],
      hiredFirst: false,
      newCoach: true,
    });
  return out;
}

/** Everything the record shows about this GM at this team, both sides, unranked. Empty until he has finished a season. */
export function gmFindings(l: League, gmId: number, teamId: number): Finding[] {
  const gm = l.gms[gmId];
  const past = gmSeasons(l, gmId, teamId);
  if (!gm || !past.length) return [];
  const T = new Set(past.map((s) => s.season));
  if (l.teams[teamId]?.gmId === gmId) T.add(l.season);
  const r: Read = {
    l,
    teamId,
    past,
    T,
    first: past[0].season,
    moves: movesAt(gm, teamId).filter((m) => T.has(m.season)),
    players: Object.values(l.players),
    held: l.teams[teamId]?.jobs?.held ?? {},
  };
  const picks = picksOf(r);
  return [
    ...qbPicks(r, picks),
    ...quarterbacks(r),
    ...firstRounders(picks),
    ...honoredPicks(picks),
    ...starTrades(r),
    ...contracts(r),
    ...whoLeft(r),
    ...headCoaches(r),
  ];
}

/** One side's findings, the one to lead with first: the fixed order, then the newest fact, then a stable hash. */
export function rankFindings(found: Finding[], side: 'blame' | 'credit', key: string): Finding[] {
  const order = FINDING_ORDER[side];
  return found
    .filter((f) => f.side === side)
    .sort(
      (a, b) =>
        order.indexOf(a.family) - order.indexOf(b.family) ||
        b.latest - a.latest ||
        stableHash(key + a.family) - stableHash(key + b.family),
    );
}
