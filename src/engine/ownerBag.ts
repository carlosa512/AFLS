/**
 * The owner's marble bag: how much patience is left, and how much heat the GM and the head coach have
 * built up. Like the concussion protocol and the quirk bag, it is drawn from rather than rolled against,
 * so the odds come from what is in it:
 *
 * - Calm marbles are the owner's patience: 5 for the quickest trigger, 9 for the most patient.
 * - Every losing season puts heat in, more for a worse one (8–9 one marble, 2–15 four), and the heat already in
 *   fades by half. Who it goes to depends on the roster: a talented roster losing is on the head coach, a thin
 *   one on the GM.
 * - At the review the owner draws one marble for each one last season put in. A heat marble is a change;
 *   a calm one is spent and never goes back, so a losing run always ends. Winning puts calm back.
 *
 * In season the owner reaches in only after a loss on a very bad pace, and puts the marble back.
 */
import { chairHolder, ownerTrigger, teamCoaches } from './coaching';
import { teamGm } from './gm';
import { teamRatings } from './roster';
import { clamp, type Rng } from './rng';
import type { Coach, League, OwnerBag, Team } from './types';

type Rec = { w: number; l: number; t: number };
const pct = (r: Rec) => (r.w + r.t / 2) / Math.max(1, r.w + r.l + r.t);

/**
 * Patience in marbles: ×0.5 (patient) … ×1.5 (quick trigger) on `ownerTrigger` gives 9 … 5. Any more and a 7–10 or
 * 6–11 season rarely cost a head coach his job, and the league's carousel ran below the NFL's seven a year.
 */
export const ownerCalm = (l: League, teamId: number) => Math.round(3 + 3 / ownerTrigger(l, teamId));

/** Heat a season puts in: none for a winning one, one for 8–9, two for 6–7 wins, three for 4–5, four below. */
export function seasonHeat(rec: Rec): number {
  const p = pct(rec);
  return p >= 0.52 ? 0 : p >= 0.44 ? 1 : p >= 0.33 ? 2 : p >= 0.22 ? 3 : 4;
}

/** Each club's roster rank by starting overall, 0 the best: what the owner expected from it. */
export function talentRanks(l: League): Map<number, number> {
  const order = l.teams
    .map((t) => ({ id: t.id, overall: teamRatings(l, t).overall }))
    .sort((a, b) => b.overall - a.overall || a.id - b.id);
  return new Map(order.map((o, i) => [o.id, i]));
}

/**
 * The head coach's share of a losing season. He owns how far the team fell short of its roster (a top roster
 * should win .750); the GM owns how far the roster he built sits below .500. Never all on one side, and the coach
 * always carries at least a third: owners change coaches more often than GMs (NFL about seven a year against four),
 * and a league that changed fewer coaches than that traded less at the deadline, with fewer new schemes to fit.
 */
export function coachBlame(rank: number, teams: number, rec: Rec): number {
  const expected = 0.75 - (0.5 * rank) / Math.max(1, teams - 1);
  const coach = Math.max(0, expected - pct(rec)),
    gm = Math.max(0, 0.5 - expected);
  return coach + gm ? clamp(coach / (coach + gm), 0.3, 0.85) : 0.5;
}

/** Whether he was this club's head coach that season: his game-by-game record, or his hire date when a save has none. */
function coachedThatYear(c: Coach, teamId: number, season: number): boolean {
  const rows = (c.career ?? []).filter((r) => r.season === season);
  if (rows.length) return rows.some((r) => r.teamId === teamId && r.role === 'headCoach');
  return c.teamId === teamId && c.role === 'headCoach' && (c.since ?? Infinity) <= season;
}

/** Split a season's heat between GM and head coach, halving each one's share in his first year (it isn't all his yet). */
function heatSplit(l: League, t: Team, season: number, rec: Rec, rank: number) {
  const heat = seasonHeat(rec);
  if (!heat) return { gm: 0, coach: 0 };
  const gm = teamGm(l, t.id),
    hc = chairHolder(teamCoaches(l, t.id), { role: 'headCoach' });
  const job = gm?.appointments.at(-1);
  const gmThere = !!job && job.start.season <= season;
  const hcThere = !!hc && coachedThatYear(hc, t.id, season);
  const share = hcThere ? coachBlame(rank, l.teams.length, rec) : 0;
  const gmFirst = gmThere && job!.start.season === season && !job!.priorSeasons;
  const hcFirst = hcThere && !coachedThatYear(hc!, t.id, season - 1);
  return {
    gm: gmThere ? Math.round(heat * (1 - share) * (gmFirst ? 0.5 : 1)) : 0,
    coach: hcThere ? Math.round(heat * share * (hcFirst ? 0.5 : 1)) : 0,
  };
}

/** A new GM gets the owner's patience back; a new head coach starts without his predecessor's heat. */
function freshFaces(l: League, t: Team, bag: OwnerBag) {
  const hcId = chairHolder(teamCoaches(l, t.id), { role: 'headCoach' })?.id ?? null;
  if (bag.gmId !== t.gmId) Object.assign(bag, { gmId: t.gmId, gm: 0, calm: ownerCalm(l, t.id) });
  if (bag.coachId !== hcId) Object.assign(bag, { coachId: hcId, coach: 0 });
}

/**
 * The club's bag with every finished season in it. A save without one replays the last three seasons the
 * current people were there for, so an old save's owner doesn't forget a losing run.
 */
export function ownerBag(l: League, t: Team, ranks?: Map<number, number>): OwnerBag {
  const bag = (t.ownerBag ??= {
    season: l.season - 4,
    calm: ownerCalm(l, t.id),
    gm: 0,
    coach: 0,
    gmId: t.gmId,
    coachId: chairHolder(teamCoaches(l, t.id), { role: 'headCoach' })?.id ?? null,
  });
  freshFaces(l, t, bag);
  const last = l.season - 1;
  for (let s = bag.season + 1; s <= last; s++) {
    const h = l.history.find((x) => x.season === s);
    const rec = h?.records[t.id];
    if (!h || !rec) continue;
    if (h.playoffs?.[t.id]) {
      bag.gm = Math.floor(bag.gm / 2);
      bag.coach = Math.floor(bag.coach / 2);
      bag.calm = Math.min(ownerCalm(l, t.id), bag.calm + 2);
    } else if (!seasonHeat(rec)) {
      bag.gm = Math.max(0, bag.gm - 1);
      bag.coach = Math.max(0, bag.coach - 1);
      bag.calm = Math.min(ownerCalm(l, t.id), bag.calm + 1);
    } else {
      // Old heat fades by half each season: the owner judges the last couple of years, not the whole tenure. Kept
      // whole, a mediocre club's heat only grew, so reviews got harsher every year of a league and a year-six owner
      // changed 14 of 17 losing clubs (`npm run offseason`, 12 head coaches in one offseason).
      const split = heatSplit(l, t, s, rec, (ranks ??= talentRanks(l)).get(t.id)!);
      bag.gm = Math.floor(bag.gm / 2) + split.gm;
      bag.coach = Math.floor(bag.coach / 2) + split.coach;
    }
  }
  bag.season = Math.max(bag.season, last);
  return bag;
}

/** What came out of the bag: a heat marble for either side means the owner wants that person changed. */
export interface OwnerDraw {
  gm: boolean;
  coach: boolean;
}

/**
 * The offseason review: `draws` marbles without putting any back. Calm marbles drawn are spent from the
 * bag for good; heat marbles stay (the person they belong to either goes, or keeps them).
 */
export function drawOffseason(bag: OwnerBag, draws: number, rng: Rng): OwnerDraw {
  const left = { calm: bag.calm, gm: bag.gm, coach: bag.coach };
  const out: OwnerDraw = { gm: false, coach: false };
  for (let i = 0; i < draws; i++) {
    const total = left.calm + left.gm + left.coach;
    if (!total) break;
    const pick = rng.int(1, total);
    if (pick <= left.calm) {
      left.calm--;
      bag.calm--;
    } else if (pick <= left.calm + left.gm) {
      left.gm--;
      out.gm = true;
    } else {
      left.coach--;
      out.coach = true;
    }
  }
  return out;
}

/** In season: one marble, put straight back, from the bag with this season's heat so far added in. */
export function drawInSeason(bag: OwnerBag, extra: { gm: number; coach: number }, rng: Rng): OwnerDraw {
  const gm = bag.gm + extra.gm,
    coach = bag.coach + extra.coach;
  const pick = rng.int(1, bag.calm + gm + coach);
  return { gm: pick > bag.calm && pick <= bag.calm + gm, coach: pick > bag.calm + gm };
}

/** This season's heat so far, for an in-season draw: the same split as at the end of a season. */
export function heatSoFar(l: League, t: Team, rec: Rec, rank: number) {
  return heatSplit(l, t, l.season, rec, rank);
}
