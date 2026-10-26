/** Coaching habits use their own streams; adding a habit never reshuffles the coaching market. */
import { coachValue } from './coachRatings';
import { clamp, Rng } from './rng';
import type { Coach, CoachGameReport, CoachRole, League, Player, Position } from './types';

type Info = {
  label: string;
  role: CoachRole;
  tone: 'good' | 'bad' | 'style';
  effect: string;
  qualityBiased?: boolean;
  /**
   * Marbles in his bag (3 if unset; for a quality-biased habit, added to what his quality gives, never below 1).
   * Style habits draw from fewer so each is a minority's trait (about one chair in five), not half the league's.
   */
  marbles?: number;
};
export const COACH_QUIRKS = {
  clingsToTimeouts: {
    label: 'Clings to Timeouts',
    role: 'headCoach',
    tone: 'bad',
    effect: 'Sometimes saves a defensive timeout through another snap late in a close game.',
    marbles: 2,
  },
  stopsTheClock: {
    label: 'Stops the Clock Early',
    role: 'headCoach',
    tone: 'style',
    effect: 'Starts spending defensive timeouts a little earlier to preserve another possession.',
    marbles: 2,
  },
  takesThePoints: {
    label: 'Takes the Points',
    role: 'headCoach',
    tone: 'style',
    effect: 'Sometimes chooses the comfortable field goal on short fourth downs near the goal line.',
    marbles: 2,
  },
  backsHisOffense: {
    label: 'Backs His Offense',
    role: 'headCoach',
    tone: 'style',
    effect: 'More willing to trust his offense on fourth down inside the three.',
    marbles: 2,
  },
  goesForTwo: {
    label: 'Goes for Two',
    role: 'headCoach',
    tone: 'style',
    effect: 'Follows the analytics chart into a two-point try in a few high-leverage second-half spots.',
    marbles: 2,
  },
  distrustsLongKick: {
    label: 'Distrusts the Long Kick',
    role: 'headCoach',
    tone: 'style',
    effect: 'Would rather punt or go for it than try a long field goal, unless his kicker has the leg for it.',
    marbles: 2,
  },
  settlesForThree: {
    label: 'Settles for Three',
    role: 'offCoord',
    tone: 'style',
    effect: 'Favors safer early-down calls once inside comfortable field-goal range.',
    marbles: 2,
  },
  shotPlayArchitect: {
    label: 'Shot-Play Architect',
    qualityBiased: true,
    role: 'offCoord',
    tone: 'good',
    effect: 'A knack for designing up to two favorable deep-shot calls a game; protection and execution still matter.',
  },
  goesIntoShell: {
    label: 'Goes Into a Shell',
    role: 'offCoord',
    tone: 'style',
    effect: 'Protects narrow fourth-quarter leads with safer calls earlier.',
    marbles: 2,
  },
  scriptedOpening: {
    label: 'Scripted Opening',
    role: 'offCoord',
    tone: 'good',
    effect: 'Creates slightly better passing windows on his first six offensive snaps.',
    marbles: 2,
  },
  attacksEndZone: {
    label: 'Attacks the End Zone',
    role: 'offCoord',
    tone: 'style',
    effect: 'Throws a little more, and a little farther, on early downs inside the 20.',
    marbles: 2,
  },
  upTempo: {
    label: 'Up-Tempo',
    role: 'offCoord',
    tone: 'style',
    effect: 'Goes no-huddle earlier when trailing and in any two-minute drive before the half.',
    marbles: 2,
  },
  thirdDownHeat: {
    label: 'Third-Down Heat',
    role: 'defCoord',
    tone: 'style',
    effect: 'Sends a little more pressure on third-and-long, leaving the usual coverage risks.',
    marbles: 2,
  },
  trustsCoverage: {
    label: 'Trusts His Coverage',
    role: 'defCoord',
    tone: 'style',
    effect: 'Favors coverage over pressure on third-and-long.',
    marbles: 2,
  },
  crowdsTheLine: {
    label: 'Crowds the Line',
    role: 'defCoord',
    tone: 'style',
    effect: 'More often anticipates a run on early short-yardage downs.',
    marbles: 2,
  },
  protectsDeep: {
    label: 'Protects Against the Deep Ball',
    role: 'defCoord',
    tone: 'style',
    effect: 'Protecting a late lead, closes deep windows but concedes a little underneath.',
    marbles: 2,
  },
  playsPrevent: {
    label: 'Plays Prevent',
    role: 'defCoord',
    tone: 'bad',
    effect: 'Sits soft with a two-score lead late: takes away the deep ball but gives up quick yards underneath.',
    marbles: 2,
  },
  disguisesCoverages: {
    label: 'Disguises Coverages',
    qualityBiased: true,
    role: 'defCoord',
    tone: 'good',
    effect:
      'Muddies the picture on obvious passing downs: a little more pressure gets home and more throws are misread.',
    marbles: -1,
  },
  earnYourReps: {
    label: 'Earn Your Reps',
    role: 'positionCoach',
    tone: 'style',
    effect: 'Favors preparation in close selection calls; hard workers fit his teaching better than coasters.',
    marbles: 2,
  },
  trustsVeterans: {
    label: 'Trusts His Veterans',
    role: 'positionCoach',
    tone: 'style',
    effect: 'Favors experience in close selection calls and gets a little more from veteran preparation.',
    marbles: 2,
  },
  patientTeacher: {
    label: 'Patient Teacher',
    role: 'positionCoach',
    tone: 'good',
    effect: 'Helps young players learn and gives them more time to develop.',
    marbles: 2,
  },
  techniqueStickler: {
    label: 'Technique Stickler',
    role: 'positionCoach',
    tone: 'good',
    effect: 'Occasionally works against an established negative playing habit in his room.',
    marbles: 2,
  },
  keepsThemFresh: {
    label: 'Keeps Them Fresh',
    role: 'positionCoach',
    tone: 'good',
    effect: 'His room recovers better between games and picks up fewer practice injuries.',
    marbles: 2,
  },
  runsHardPractices: {
    label: 'Runs Hard Practices',
    role: 'positionCoach',
    tone: 'style',
    effect: 'His room develops a little faster, at a slightly higher risk of practice injuries.',
    marbles: 2,
  },
} as const satisfies Record<string, Info>;
export type CoachQuirkId = keyof typeof COACH_QUIRKS;
export const COACH_QUIRK_IDS = Object.keys(COACH_QUIRKS) as CoachQuirkId[];
export const COACH_ACTIVE_MAX = 2;
/** Habits that pull against each other: a coach picks up one of a pair, never both at once. */
const OPPOSITES: Partial<Record<CoachQuirkId, CoachQuirkId>> = {
  settlesForThree: 'attacksEndZone',
  attacksEndZone: 'settlesForThree',
  keepsThemFresh: 'runsHardPractices',
  runsHardPractices: 'keepsThemFresh',
};
const HELD_MAX = 4;
const ROOMS: Record<Position, string | null> = {
  QB: 'QB',
  RB: 'RB',
  WR: 'WR',
  TE: 'WR',
  OL: 'OL',
  DT: 'DL',
  EDGE: 'DL',
  LB: 'LB',
  CB: 'DB',
  S: 'DB',
  K: null,
  P: null,
};
export const coachQuirkPool = (role: CoachRole) => COACH_QUIRK_IDS.filter((id) => COACH_QUIRKS[id].role === role);
export function activeCoachQuirks(c: Coach): CoachQuirkId[] {
  return (Object.entries(c.quirks ?? {}) as [CoachQuirkId, number][])
    .filter(([id, grip]) => COACH_QUIRKS[id]?.role === c.role && grip >= 2)
    .sort((a, b) => b[1] - a[1] || COACH_QUIRK_IDS.indexOf(a[0]) - COACH_QUIRK_IDS.indexOf(b[0]))
    .slice(0, COACH_ACTIVE_MAX)
    .map(([id]) => id);
}
/** A soft bias, not a gate: teaching ratings are an imperfect proxy for offensive design.
 * Every caller can develop the habit. Experience matters, and good teaching is not a prerequisite
 * for an ordinary coach to have a particular schematic strength (or retain it as he ages).
 */
function habitMarbles(c: Coach, id: CoachQuirkId): number {
  const info: Info = COACH_QUIRKS[id];
  const evidence = c.quirkEvidence?.[id] ?? 0;
  if (info.qualityBiased) {
    const quality = coachValue(c);
    const base = quality >= 12 ? 3 : quality >= 9.5 ? 2 : 1;
    return Math.max(1, base + (info.marbles ?? 0)) + Math.min(1, Math.floor(evidence / 16));
  }
  return (info.marbles ?? 3) + Math.min(2, Math.floor(evidence / 8));
}
export function coachBag(c: Coach): Record<string, number> {
  const bag: Record<string, number> = { blank: c.age >= 55 ? 48 : 30 };
  for (const id of coachQuirkPool(c.role)) {
    const count = habitMarbles(c, id);
    if (count) bag[id] = count;
  }
  for (const id of Object.keys(c.quirks ?? {}) as CoachQuirkId[])
    bag[`fix:${id}`] = COACH_QUIRKS[id]?.tone === 'bad' ? 5 : 3;
  return bag;
}
export function drawCoachMarbles(c: Coach, rng: Rng, n: number, stamp?: { season: number; week: number }) {
  const bag = (c.quirkBag ??= coachBag(c));
  for (let i = 0; i < n; i++) {
    let r = rng.int(0, Math.max(0, Object.values(bag).reduce((a, b) => a + b, 0) - 1));
    const key = Object.keys(bag).find((k) => (r -= bag[k]) < 0);
    if (!key) break;
    if (--bag[key] <= 0) delete bag[key];
    if (key === 'blank') continue;
    const fix = key.startsWith('fix:');
    const id = (fix ? key.slice(4) : key) as CoachQuirkId;
    if (!COACH_QUIRKS[id] || (!fix && COACH_QUIRKS[id].role !== c.role)) continue;
    const held = (c.quirks ??= {});
    const grip = held[id] ?? 0;
    if (fix && (!grip || (grip === 3 && !rng.chance(0.5)))) continue;
    if (!fix && (grip === 3 || (!grip && Object.keys(held).length >= HELD_MAX))) continue;
    const opposite = OPPOSITES[id];
    if (!fix && !grip && opposite && held[opposite]) continue;
    const next = clamp(grip + (fix ? -1 : 1), 0, 3);
    if (next) held[id] = next;
    else delete held[id];
    if (stamp && grip !== next) {
      const log = (c.quirkLog ??= []);
      log.push({ id, from: grip, grip: next, ...stamp });
      if (log.length > 12) log.splice(0, log.length - 12);
    }
  }
}
export function generateCoachQuirks(seed: string, c: Coach): void {
  if (c.quirkBag) return;
  const rng = new Rng(`${seed}:coach-habits:history:${c.id}`);
  for (let y = 0; y < Math.min(16, Math.max(1, c.age - 28)); y++) {
    c.quirkBag = coachBag(c);
    drawCoachMarbles(c, rng, 4);
  }
  c.quirkBag = coachBag(c);
}
/** A coaching interpretation, not a promise that a player enters coaching or retains a tag. */
export function inheritCoachQuirk(seed: string, c: Coach, p: Player, stamp?: { season: number; week: number }): void {
  if (c.quirkOrigin) return;
  const mapping = {
    gunslinger: 'shotPlayArchitect',
    safetyEyes: 'shotPlayArchitect',
    stuntCommunicator: 'techniqueStickler',
    looseCarriage: 'techniqueStickler',
  } as const;
  const rng = new Rng(`${seed}:coach-habits:inherit:${p.id}`);
  for (const [source, id] of Object.entries(mapping)) {
    const grip = p.quirks?.[source as keyof typeof mapping] ?? 0;
    if (grip < 2 || !rng.chance(grip === 3 ? 0.55 : 0.3)) continue;
    const held = (c.quirks ??= {});
    if (!held[id] && Object.keys(held).length >= HELD_MAX) continue;
    const from = held[id] ?? 0;
    held[id] = Math.max(from, grip === 3 && rng.chance(0.35) ? 2 : 1);
    if (stamp && held[id] !== from) {
      const log = (c.quirkLog ??= []);
      log.push({ id, from, grip: held[id], ...stamp });
      if (log.length > 12) log.splice(0, log.length - 12);
    }
    c.quirkOrigin = { id, playerId: p.id, source };
    c.quirkBag = coachBag(c);
    break;
  }
}
/** Dated transitions, including losses, remain readable after the current habit is gone. */
export function coachHabitChangeText(e: NonNullable<Coach['quirkLog']>[number]): string {
  const label = COACH_QUIRKS[e.id].label;
  if (e.grip === 0) return `Lost ${label}`;
  if (e.from === undefined)
    return `${label} was ${e.grip === 1 ? 'forming' : e.grip === 2 ? 'established' : 'ingrained'}`;
  if (e.grip === 1)
    return e.from !== undefined && e.from >= 2 ? `${label} faded to a forming habit` : `${label} began forming`;
  if (e.grip === 3) return `${label} became ingrained`;
  return e.from === 3 ? `${label} weakened but remains established` : `Gained ${label}`;
}
export function coachQuirksOffseason(league: League, c: Coach): void {
  if (c.quirkYear === league.season) return;
  generateCoachQuirks(league.seed, c);
  c.quirkYear = league.season;
  c.quirkBag = coachBag(c);
  c.quirkIntroduced = Object.keys(c.quirkBag).filter((id) => COACH_QUIRK_IDS.includes(id as CoachQuirkId));
  delete c.quirkEvidence;
  drawCoachMarbles(c, new Rng(`${league.seed}:coach-habits:${league.season}:${c.id}:offseason`), 2, {
    season: league.season,
    week: 0,
  });
}
/** Reconcile a promotion without refilling: each newly relevant entry is introduced at most once per year. */
export function reconcileCoachBag(c: Coach): void {
  const bag = (c.quirkBag ??= coachBag(c));
  const known = (c.quirkIntroduced ??= Object.keys(bag).filter((k) => COACH_QUIRK_IDS.includes(k as CoachQuirkId)));
  for (const id of coachQuirkPool(c.role))
    if (!known.includes(id)) {
      bag[id] = 1;
      known.push(id);
    }
}
export function recordCoachEvidence(league: League, reports: CoachGameReport[] = []): void {
  for (const report of reports) {
    const c = league.coaches[report.coachId];
    if (!c) continue;
    const evidence = (c.quirkEvidence ??= {});
    for (const [id, n] of Object.entries(report.choices))
      evidence[id as CoachQuirkId] = Math.min(32, (evidence[id as CoachQuirkId] ?? 0) + Math.min(2, n));
    // A real delay can teach him; it never erases a habit immediately.
    if (report.events.some((e) => e.quirk === 'clingsToTimeouts')) {
      const bag = (c.quirkBag ??= coachBag(c));
      bag['fix:clingsToTimeouts'] = Math.min(8, (bag['fix:clingsToTimeouts'] ?? 0) + 1);
    }
  }
}
export function coachQuirksWeek(league: League): void {
  const played = new Set(
    league.games
      .filter((g) => g.season === league.season && g.week === league.week && g.result)
      .flatMap((g) => [g.homeId, g.awayId]),
  );
  for (const c of Object.values(league.coaches)) {
    if (c.teamId === null || !played.has(c.teamId)) continue;
    const stamp = `${league.season}:${league.week}`;
    if (c.quirkWeek === stamp) continue;
    c.quirkWeek = stamp;
    reconcileCoachBag(c);
    const rng = new Rng(`${league.seed}:coach-habits:${stamp}:${c.id}`);
    if (rng.chance(0.1)) drawCoachMarbles(c, rng, 1, { season: league.season, week: league.week });
  }
}
export function positionCoachFor(staff: readonly Coach[], position: Position): Coach | undefined {
  return staff.find((c) => c.role === 'positionCoach' && c.room === ROOMS[position]);
}
/** Fit changes coaching effectiveness, never the player's underlying character. */
export function coachPlayerFit(c: Coach | undefined, p: Player): number {
  if (!c) return 0;
  const active = activeCoachQuirks(c);
  const work = clamp((p.traits.workEthic - 10.5) / 9.5, -1, 1);
  let fit = active.includes('earnYourReps') ? 0.035 * work : 0;
  if (active.includes('earnYourReps') && p.traits.workEthic <= 7.5 && p.traits.temperament <= 7) fit -= 0.01;
  if (active.includes('trustsVeterans')) fit += p.age >= 29 ? 0.02 : p.age <= 24 ? -0.01 : 0;
  if (active.includes('patientTeacher') && p.age <= 25) fit += 0.025;
  if (active.includes('runsHardPractices')) fit += 0.02;
  return clamp(fit, -0.05, 0.05);
}
/**
 * What a room's coach does to its bodies between games: practice injury odds (×) and a share of lost condition
 * won back each week (+). Both mild: a medical staff and a player's own fitness still decide most of it.
 */
export function roomCare(c: Coach | undefined): { practice: number; recovery: number } {
  const active = c ? activeCoachQuirks(c) : [];
  if (active.includes('keepsThemFresh')) return { practice: 0.88, recovery: 0.03 };
  if (active.includes('runsHardPractices')) return { practice: 1.12, recovery: 0 };
  return { practice: 1, recovery: 0 };
}
