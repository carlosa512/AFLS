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
    return `${foul} · ${team}${by ? ` ${by}` : ''} · ${yards} yard${yards === '1' ? '' : 's'}${noPlay}`;
  }
  const declined = /(?:^|\.\s)([A-Z][^.,]*?) on (\S+?)(?: \(([^)]+)\))?, declined/.exec(e.text);
  if (declined) {
    const [, foul, team, by] = declined;
    return `${foul} · ${team}${by ? ` ${by}` : ''} · declined`;
  }
  return null;
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
