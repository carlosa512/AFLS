/**
 * Flexible scheduling: as the standings take shape, the league moves the games people want to see into
 * prime time and the ones that went flat out of it, on the NFL's notice and limits:
 * - Sunday night, weeks 5–17, twelve days ahead (once week w − 2 is played); at most twice in weeks 5–10.
 * - Monday night, weeks 12–17, on the same notice.
 * - Thursday night, weeks 13–17, four weeks ahead; at most twice a season.
 * - Week 18 is set once week 17 is played: the game with the most riding on it on Sunday night, the next
 *   two on Saturday, the games with playoff stakes in the late window (so linked results kick off together)
 *   and the rest at 1:00.
 * A flex swaps the two games' kickoffs (a western host moved to Sunday afternoon plays late); the game
 * keeps the slot it was scheduled in as `flexed`. No randomness: the standings decide.
 */
import type { Game, Kickoff, League } from '../types';
import { EARLY, isPrimeTime, LATE, MONDAY, SATURDAY, SUNDAY_NIGHT, THURSDAY, western } from './kickoff';
import { REGULAR_SEASON_WEEKS } from './schedule';
import { computeRecords, playoffRace } from './standings';

/** How much better a game has to look than the one in the slot before the league moves it. */
const MARGIN = { sun: 0.55, mon: 0.75, thu: 0.75 };
/** Night games a team plays in a season at most, flexes included. */
const PRIME_CAP = 7;

const same = (a: Kickoff | undefined, b: Kickoff) => !!a && a.day === b.day && a.et === b.et;

/** Call once a regular-season week is played (`league.week` is already the next one). */
export function flexWeek(league: League): void {
  const played = league.week - 1;
  if (played === REGULAR_SEASON_WEEKS - 1) setFinalWeek(league);
  flexInto(league, played + 2, SUNDAY_NIGHT, 5);
  flexInto(league, played + 2, MONDAY, 12);
  flexInto(league, played + 4, THURSDAY, 13);
}

/** This season's regular-season games. */
const season = (league: League) => league.games.filter((g) => g.season === league.season && !g.playoffRound);

/**
 * How much the league wants to show a game now: both teams' records (regressed toward .500 early on),
 * a close match-up over a mismatch, both teams still in the race, and a division game late in the year.
 */
function appealOf(league: League): (g: Game) => number {
  const records = computeRecords(league);
  const share = (id: number) => {
    const r = records.get(id)!;
    return (r.w + 0.5 * r.t + 2) / (r.w + r.l + r.t + 4);
  };
  const alive = new Map(league.teams.map((t) => [t.id, !playoffRace(league, t.id).out]));
  return (g) => {
    const [h, a] = [share(g.homeId), share(g.awayId)];
    const late = g.week >= 12;
    const division = league.teams[g.homeId].division === league.teams[g.awayId].division;
    return h + a - 0.5 * Math.abs(h - a) + (alive.get(g.homeId) && alive.get(g.awayId) ? 0.25 : 0) + (late && division ? 0.15 : 0);
  };
}

/** Night games a team has this season, as scheduled now. */
function primeCount(league: League, teamId: number): number {
  return season(league).filter((g) => (g.homeId === teamId || g.awayId === teamId) && g.kickoff && isPrimeTime(g.kickoff)).length;
}

/** The kickoff a team has in a week, if it plays. */
const slotOf = (league: League, teamId: number, week: number) => season(league).find((g) => g.week === week && (g.homeId === teamId || g.awayId === teamId))?.kickoff;

/** Swap two games' kickoffs, remembering where each was first scheduled; a western host never lands at 1:00. */
function swap(league: League, a: Game, b: Game): void {
  const [ka, kb] = [a.kickoff!, b.kickoff!];
  a.flexed ??= { ...ka };
  b.flexed ??= { ...kb };
  a.kickoff = { ...kb };
  b.kickoff = same(ka, EARLY) && western(league, b.homeId) ? { ...LATE[1] } : { ...ka };
}

function flexInto(league: League, week: number, slot: Kickoff, from: number): void {
  if (week < from || week >= REGULAR_SEASON_WEEKS) return;
  const games = season(league).filter((g) => g.week === week && !g.result);
  const current = games.find((g) => same(g.kickoff, slot));
  if (!current) return;
  // The NFL's caps: Sunday night twice in weeks 5–10, Thursday night twice a season.
  const flexes = (k: Kickoff, weeks: [number, number]) => season(league).filter((g) => same(g.kickoff, k) && g.flexed && !same(g.flexed, k) && g.week >= weeks[0] && g.week <= weeks[1]).length;
  if (slot.day === 'sun' && week <= 10 && flexes(SUNDAY_NIGHT, [5, 10]) >= 2) return;
  if (slot.day === 'thu' && flexes(THURSDAY, [1, REGULAR_SEASON_WEEKS]) >= 2) return;
  const appeal = appealOf(league);
  const teams = (g: Game) => [g.homeId, g.awayId];
  // Rest: no Thursday the week after a Monday or Sunday night game, no Thursday game after a Monday one.
  const rested = (g: Game) =>
    teams(g).every((t) => {
      if (slot.day === 'thu') return !same(slotOf(league, t, week - 1), MONDAY);
      const next = slotOf(league, t, week + 1);
      return !next || next.day !== 'thu';
    });
  const best = games
    .filter((g) => g !== current && g.kickoff?.day === 'sun' && !isPrimeTime(g.kickoff) && rested(g) && teams(g).every((t) => primeCount(league, t) < PRIME_CAP))
    .sort((x, y) => appeal(y) - appeal(x) || x.id - y.id)[0];
  if (best && appeal(best) - appeal(current) >= MARGIN[slot.day as keyof typeof MARGIN]) swap(league, best, current);
}

/**
 * Week 18 once week 17 is played: what each game decides (a team still chasing a place or a seed, a
 * division title between the two), the biggest on Sunday night, the next two on Saturday.
 */
function setFinalWeek(league: League): void {
  const games = season(league).filter((g) => g.week === REGULAR_SEASON_WEEKS && !g.result);
  if (!games.length) return;
  const race = new Map(league.teams.map((t) => [t.id, playoffRace(league, t.id)]));
  const appeal = appealOf(league);
  const live = (id: number) => !race.get(id)!.out && !race.get(id)!.bye;
  const stakes = (g: Game) =>
    (live(g.homeId) ? 2 : 0) + (live(g.awayId) ? 2 : 0) + (!race.get(g.homeId)!.division && !race.get(g.awayId)!.division && live(g.homeId) && live(g.awayId) ? 1 : 0) + appeal(g) / 4;
  const ranked = [...games].sort((x, y) => stakes(y) - stakes(x) || x.id - y.id);
  ranked.forEach((g, i) => {
    const k = i === 0 ? SUNDAY_NIGHT : i <= SATURDAY.length ? SATURDAY[i - 1] : stakes(g) >= 2 || western(league, g.homeId) ? LATE[1] : EARLY;
    if (!same(g.kickoff, k)) {
      g.flexed ??= g.kickoff ? { ...g.kickoff } : undefined;
      g.kickoff = { ...k };
    }
  });
}
