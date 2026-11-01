/**
 * The calls All-22 puts on its banner, read off a play's log line: a flag (what, on whom, how far, declined or
 * offsetting) and an injury (who, what, and how he leaves the field). Only what the log says, which is public.
 */
import { INJURY_TYPES, severityFor, type InjuryType } from '../../engine/injuries';
import type { GameInjury, League, PlayLogEntry } from '../../engine/types';
import type { Mark } from './transition';

/** A flag on the play, in the banner's words: "Offensive holding · BAL J.Murphy · 10 yards, no play". */
export function flagCall(e: PlayLogEntry): string | null {
  if (/Offsetting penalties/.test(e.text)) return 'Offsetting penalties · replay the down';
  const taken = /PENALTY on (\S+?)(?: \(([^)]+)\))?: ([^,]+), (\d+) yards?\./.exec(e.text);
  if (taken) {
    const [, team, by, foul, yards] = taken;
    const noPlay = /No play\./.test(e.text) ? ', no play' : '';
    return `${foul} · ${team}${by ? ` ${by}` : ''} · ${yards} yd${yards === '1' ? '' : 's'}${noPlay}`;
  }
  // A kickoff out of bounds: no yards, the ball goes to the receiving 40.
  const placed = /PENALTY on (\S+?)(?: \(([^)]+)\))?: ([^,.]+)\. Ball at the (\S+ \d+)/.exec(e.text);
  if (placed) {
    const [, team, by, foul, spot] = placed;
    return `${foul} · ${team}${by ? ` ${by}` : ''} · ball at the ${spot}`;
  }
  const declined = /(?:^|\.\s)([A-Z][^.,]*?) on (\S+?)(?: \(([^)]+)\))?, declined/.exec(e.text);
  if (declined) {
    const [, foul, team, by] = declined;
    return `${foul} · ${team}${by ? ` ${by}` : ''} · declined`;
  }
  return null;
}

/**
 * When in a play a foul happens, which is when its flag flies: before the snap (a false start), at it (offside), while
 * the play is on (holding, a block in the back), as the ball arrives (interference), just after the throw or the kick
 * (a hit on the passer or the kicker), at the whistle (a late or a dirty hit), or where a kickoff went out of bounds.
 */
export type FoulPhase = 'early' | 'snap' | 'during' | 'ball' | 'afterThrow' | 'afterKick' | 'whistle' | 'out';

/** One foul named in a play's log line: what, by which side's man (abbreviation and short name), and when. */
export interface FoulCall {
  label: string;
  team: string;
  name?: string;
  phase: FoulPhase;
}

/** Each foul's moment, by its label (`penalties.ts`); anything else is a foul while the play is on. */
const PHASES: [RegExp, FoulPhase][] = [
  [/^false start/i, 'early'],
  [/^offside|formation/i, 'snap'],
  [/interference/i, 'ball'],
  [/roughing the passer/i, 'afterThrow'],
  [/kicker/i, 'afterKick'],
  [/out of bounds/i, 'out'],
  [/roughness|face mask|horse collar|unsportsmanlike/i, 'whistle'],
];
const phaseOf = (label: string): FoulPhase => PHASES.find(([re]) => re.test(label))?.[1] ?? 'during';

/**
 * Every foul a play's log line names: taken ("PENALTY on BAL (J.Murphy): Offensive holding, 10 yards."), declined
 * ("Offside on BAL (D.Miller), declined") and offsetting ("Offsetting penalties: offensive holding on JAX (K.Liufau),
 * pass interference on NYK (T.Miles)."), in the order they're written.
 */
export function foulsIn(e: PlayLogEntry): FoulCall[] {
  const out: { at: number; call: FoulCall }[] = [];
  for (const m of e.text.matchAll(/PENALTY on (\S+?)(?: \(([^)]+)\))?: ([^,.]+)/g))
    out.push({ at: m.index, call: { label: m[3], team: m[1], ...(m[2] ? { name: m[2] } : {}), phase: phaseOf(m[3]) } });
  // Declined or offsetting: "<foul> on <TEAM> (<name>)", after the start, a full stop, a colon or a comma.
  for (const m of e.text.matchAll(/(?:^|[.:,] )([A-Za-z][A-Za-z -]*?) on (\S+?)(?: \(([^)]+)\))?(?=[,.]|$)/g))
    out.push({ at: m.index, call: { label: m[1], team: m[2], ...(m[3] ? { name: m[3] } : {}), phase: phaseOf(m[1]) } });
  return out.sort((a, b) => a.at - b.at).map((o) => o.call);
}

/**
 * The men on the field (`ids`, `home` per id) who committed each foul: matched by short name and side, null when he
 * isn't among them (a log the field record can't place).
 */
export function foulersOn(
  league: League,
  ids: readonly number[],
  home: readonly boolean[],
  fouls: readonly FoulCall[],
  abbrev: { home: string; away: string },
): { id: number | null; phase: FoulPhase }[] {
  return fouls.map((f) => {
    const k = ids.findIndex((id, i) => {
      const p = league.players[id];
      return !!p && `${p.firstName[0]}.${p.lastName}` === f.name && (home[i] ? abbrev.home : abbrev.away) === f.team;
    });
    return { id: k < 0 ? null : ids[k], phase: f.phase };
  });
}

/** How a man hurt in a game leaves the field: on his own with a trainer, helped off by two, or on the cart. */
export type Exit = 'walk' | 'helped' | 'cart';

export interface InjuryCall {
  /** His team's abbreviation, position and short name as the log gives them ("NYK", "RB", "C.Mills"). */
  team: string;
  position: string;
  name: string;
  /** The injury's label, as the log has it ("high ankle sprain"). */
  label: string;
}

/** An injury line ("Injury: NYK RB C.Mills (high ankle sprain) is out for the game."). */
export function injuryCall(e: PlayLogEntry): InjuryCall | null {
  const m = /^Injury: (\S+) (\S+) (\S+) \((.+?)\) is out/.exec(e.text);
  return m ? { team: m[1], position: m[2], name: m[3], label: m[4] } : null;
}

/** The injury type a label names (`INJURY_TYPES`), or undefined for one the registry doesn't know. */
const typeFor = (label: string): InjuryType | undefined =>
  (Object.values(INJURY_TYPES) as InjuryType[]).find((t) => t.label.toLowerCase() === label.toLowerCase());

/**
 * How he leaves: the cart for a severe injury, two trainers for a moderate one, one for a minor one. Read off the
 * doctor's estimate when the game has it (`GameResult.injuries`, public), else the injury's usual layoff.
 */
export function exitFor(league: League, playerId: number, label: string, injuries?: readonly GameInjury[]): Exit {
  const type = typeFor(label);
  if (!type) return 'walk';
  const filed = injuries?.find((i) => i.playerId === playerId);
  const weeks = filed ? filed.estimate[1] : type.weeks[1];
  const severity = severityFor(type, weeks, league.players[playerId]?.age ?? 26);
  return severity === 'severe' || severity === 'career-threatening'
    ? 'cart'
    : severity === 'moderate'
      ? 'helped'
      : 'walk';
}

/** The banner for an injury: "Injury · NYK RB C.Mills · High ankle sprain · carted off". */
export function injuryBanner(call: InjuryCall, exit: Exit): string {
  const how = exit === 'cart' ? 'carted off' : exit === 'helped' ? 'helped off' : 'walks off';
  const label = call.label.charAt(0).toUpperCase() + call.label.slice(1);
  return `${call.team} ${call.position} ${call.name} · ${label} · ${how}`;
}

/**
 * The man an injury line names, among the men on the field (`spots`): his short name and his side's abbreviation.
 * Undefined when he isn't on it (a jump past the play he was hurt on).
 */
export function hurtOnField(
  league: League,
  spots: ReadonlyMap<number, Mark>,
  call: InjuryCall,
  abbrev: { home: string; away: string },
): number | undefined {
  for (const [id, m] of spots) {
    const p = league.players[id];
    if (p && `${p.firstName[0]}.${p.lastName}` === call.name && (m.home ? abbrev.home : abbrev.away) === call.team)
      return id;
  }
  return undefined;
}
