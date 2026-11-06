/**
 * GM habits: hidden ways an AI general manager does business, drawn from a marble bag like on-field quirks.
 * Only the AI's own decisions read them. Imports stay at types and rng so `finance/cap.ts` can call in without a cycle.
 */
import { Rng } from './rng';
import type { GeneralManager, HabitHold, League, Player, Position, Team } from './types';

export type HabitId =
  | 'bridgeQb'
  | 'tradeUpQb'
  | 'extendEarly'
  | 'sellsEarly'
  | 'hisGuys'
  | 'firstsForStars'
  | 'swaps'
  | 'bpa'
  | 'tagsFirst'
  | 'youngQb'
  | 'gunShy';

export const HABIT_IDS: readonly HabitId[] = [
  'bridgeQb',
  'tradeUpQb',
  'extendEarly',
  'sellsEarly',
  'hisGuys',
  'firstsForStars',
  'swaps',
  'bpa',
  'tagsFirst',
  'youngQb',
  'gunShy',
];

export const HABITS: Record<HabitId, { label: string }> = {
  bridgeQb: { label: 'Signs a Bridge QB' },
  tradeUpQb: { label: 'Trades Up for a QB' },
  extendEarly: { label: 'Extends Early' },
  sellsEarly: { label: 'Sells a Year Early' },
  hisGuys: { label: 'Brings His Guys Back' },
  firstsForStars: { label: 'Trades Firsts for Stars' },
  swaps: { label: 'Prefers Player Swaps' },
  bpa: { label: 'Drafts Best Available' },
  tagsFirst: { label: 'Tags Before He Pays' },
  youngQb: { label: 'Sticks With His Young QB' },
  gunShy: { label: 'Gun-Shy on Big Deals' },
};

/** By archetype, the first is active on day one and each also puts two marbles in his bag. Balanced draws one at random. */
export const STARTING_HABITS: Record<string, readonly HabitId[]> = {
  'Cap Magician': ['sellsEarly'],
  'All-In': ['firstsForStars', 'bridgeQb'],
  'Draft and Develop': ['youngQb', 'bpa'],
  'Can-Kicker': ['extendEarly'],
  'Hard-Liner': ['tagsFirst'],
  'Pick Hoarder': ['bpa', 'sellsEarly'],
  Balanced: [],
  'Market Mover': ['extendEarly', 'sellsEarly', 'swaps'],
  'Core Keeper': ['extendEarly', 'sellsEarly'],
  'Slow Mover': ['tagsFirst', 'youngQb'],
};

export const ACTIVE_GRIP = 2;
export const MAX_ACTIVE = 3;
export const DRAWS = 3;
export const BLANKS = 9;
/** An older GM changes less: more blanks dilute the bag. */
export const BLANKS_OLD = 16;
export const OLD_AGE = 55;
export const LOG_YEARS = 8;
/** A release whose dead money is this share of the cap burns a GM into Gun-Shy. */
export const BLOWUP_SHARE = 0.03;
export const GUN_SHY_MARBLES = 3;

/** Tests and the check only: pin one habit on for every AI club (and a position for Gun-Shy), or all off. */
export const habitsForce: { all: HabitId | null; pos: Position; off: boolean } = { all: null, pos: 'QB', off: false };

/** The AI general manager running a club, or undefined for yours and for a vacancy. */
export function aiGm(league: League, team: Team): GeneralManager | undefined {
  if (team.id === league.userTeamId || team.gmId === null) return undefined;
  return league.gms[team.gmId];
}

/** His archetype lives on the club while he is employed and on his own record after. */
export function archetypeOf(league: League, gm: GeneralManager): string {
  const t = gm.teamId === null ? gm.traits?.archetype : league.teams[gm.teamId]?.gm.archetype;
  return t ?? 'Balanced';
}

export function habitOn(league: League, team: Team, id: HabitId): boolean {
  if (habitsForce.off) return false;
  if (habitsForce.all) return id === habitsForce.all && !!aiGm(league, team);
  const gm = aiGm(league, team);
  return !!gm && (gm.habits?.[id]?.grip ?? 0) >= ACTIVE_GRIP;
}

export function gunShyAt(league: League, team: Team, pos: Position): boolean {
  if (habitsForce.off) return false;
  if (habitsForce.all) return habitsForce.all === 'gunShy' && habitsForce.pos === pos && !!aiGm(league, team);
  const gm = aiGm(league, team);
  const h = gm?.habits?.gunShy;
  return !!h && h.grip >= ACTIVE_GRIP && h.pos === pos;
}

/** Whether this GM was in the chair (or, for an opening incumbent, by the tenure generated for him) when the player was drafted. */
export function draftedBy(gm: GeneralManager, p: Player): boolean {
  const d = p.draft;
  if (!d) return false;
  return gm.appointments.some(
    (a) =>
      a.teamId === d.teamId &&
      a.start.season - (a.priorSeasons ?? 0) <= d.season &&
      (!a.end || a.end.season >= d.season),
  );
}

export function startHabits(league: League, gm: GeneralManager): void {
  if (gm.habits || gm.id === league.userGmId) return;
  const first = STARTING_HABITS[archetypeOf(league, gm)]?.[0];
  const id = first ?? new Rng(`${league.seed}:gm-habits:start:${gm.id}`).pick(HABIT_IDS.filter((h) => h !== 'gunShy'));
  gm.habits = { [id]: { grip: ACTIVE_GRIP } };
}

export function logMove(
  league: League,
  team: Team,
  habit: HabitId,
  extra?: { playerId?: number; pos?: Position; good?: true; ovr?: number },
): void {
  const gm = aiGm(league, team);
  if (!gm) return;
  const log = (gm.habitLog ??= []);
  log.push({ habit, season: league.season, teamId: team.id, ...extra });
  gm.habitLog = log.filter((m) => m.season >= league.season - LOG_YEARS);
}

export function addMarbles(gm: GeneralManager, key: string, n: number): void {
  const m = (gm.habitMarbles ??= {});
  m[key] = (m[key] ?? 0) + n;
}

/** Every marble in his bag, blanks included. */
export function bagOf(league: League, gm: GeneralManager): string[] {
  const bag: string[] = Array(gm.age >= OLD_AGE ? BLANKS_OLD : BLANKS).fill('blank');
  const own = STARTING_HABITS[archetypeOf(league, gm)] ?? [];
  // His own habits weigh double; every other habit (Gun-Shy only after a blow-up) has one marble, so any GM can take one up.
  for (const h of HABIT_IDS) if (h !== 'gunShy') bag.push(h, ...(own.includes(h) ? [h] : []));
  for (const [k, n] of Object.entries(gm.habitMarbles ?? {})) for (let i = 0; i < n; i++) bag.push(k);
  return bag;
}

/** The offseason draw: three marbles, each tightening or loosening a grip. The year's extra marbles are spent. */
export function drawHabits(league: League, gm: GeneralManager, rng: Rng): void {
  if (gm.id === league.userGmId) return;
  const habits = (gm.habits ??= {});
  const drawn = rng.shuffle([...bagOf(league, gm)]).slice(0, DRAWS);
  for (const m of drawn) {
    if (m === 'blank') continue;
    if (m.startsWith('fade:')) {
      const id = m.slice(5);
      const h = habits[id];
      if (!h) continue;
      if (h.grip <= 1) delete habits[id];
      else h.grip = (h.grip - 1) as HabitHold['grip'];
      continue;
    }
    const h = habits[m];
    if (m === 'gunShy' && !h) continue;
    const next = Math.min(3, (h?.grip ?? 0) + 1);
    if (next >= ACTIVE_GRIP) {
      const others = Object.entries(habits).filter(([k, v]) => k !== m && v.grip >= ACTIVE_GRIP).length;
      // A fourth active habit would make him a caricature: it waits at 1.
      if ((h?.grip ?? 0) < ACTIVE_GRIP && others >= MAX_ACTIVE) {
        habits[m] = { ...h, grip: 1 };
        continue;
      }
    }
    habits[m] = { ...h, grip: next as HabitHold['grip'] };
  }
  delete gm.habitMarbles;
}

/** A release that costs a real slice of the cap on a deal he signed himself leaves him wary of that position. */
export function noteRelease(league: League, team: Team, p: Player, dead: number): void {
  const gm = aiGm(league, team);
  const cap = league.caps[league.season];
  if (!gm || cap === undefined || dead < BLOWUP_SHARE * cap) return;
  const start = gm.appointments.at(-1)?.start;
  const c = p.contract;
  if (!start || !c || c.signedSeason < start.season || c.signedWeek === -1) return;
  const habits = (gm.habits ??= {});
  habits.gunShy = { grip: Math.max(habits.gunShy?.grip ?? 1, 1) as HabitHold['grip'], pos: p.position };
  addMarbles(gm, 'gunShy', GUN_SHY_MARBLES);
  logMove(league, team, 'gunShy', { playerId: p.id, pos: p.position });
}

export function usedThisYear(gm: GeneralManager, id: HabitId, season: number): boolean {
  return !!gm.habitLog?.some((m) => m.habit === id && m.season === season) || (gm.habitMarbles?.[id] ?? 0) > 0;
}
