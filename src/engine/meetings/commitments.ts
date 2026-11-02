import { STARTERS } from '../positions';
import { YEAR } from '../morale';
import { TRADE_DEADLINE_WEEK } from '../trade/rules';
import { POSITIONS, type Commitment, type League, type MeetingRecord, type MeetingSuggestion } from '../types';

/**
 * What's put behind a meeting (L2, spec §2.1): a promise to the room with a window. Kept, the men who bought in get a
 * further lift and the coach's word gains; broken, they get a dip bigger than the meeting gave and his word loses.
 */
export const WINDOW = { snaps: 3, talks: 4, feud: 4, move: Infinity, jobs: 3 };

/** Morale's clock at the step after deadline week's games: deadline day's deals are done by then. */
export const deadlineClock = (season: number): number => season * YEAR + 8 + TRADE_DEADLINE_WEEK + 1;

/** Every starter on the club's depth chart, sorted (a `jobs` or `move` commitment is judged against these). */
export function startersOf(league: League, teamId: number): number[] {
  const chart = league.teams[teamId].depthChart;
  return POSITIONS.flatMap((pos) => (chart[pos] ?? []).slice(0, STARTERS[pos])).sort((a, b) => a - b);
}

/** The commitment a meeting opens, or none (words only). */
export function openCommitment(
  league: League,
  teamId: number,
  record: MeetingRecord,
  s: MeetingSuggestion,
  lift: Record<number, number>,
): Commitment | null {
  const backing = record.backing;
  if (backing === 'words') return null;
  const opened = record.clock;
  const deadline = deadlineClock(Math.floor(opened / YEAR));
  const before = opened < deadline;
  const window = WINDOW[backing];
  const closes =
    backing === 'move'
      ? before
        ? deadline
        : opened
      : backing === 'talks' && before
        ? Math.min(opened + window, deadline)
        : opened + window;
  const boughtIn = Object.entries(record.outcomes)
    .filter(([, o]) => o === 'lands')
    .map(([id]) => Number(id))
    .sort((a, b) => a - b);
  return {
    backing,
    scope: record.scope,
    opened,
    closes,
    named: [...(s.namedFor?.[backing] ?? [])],
    boughtIn,
    by: record.kind === 'gm' ? 'gm' : 'coach',
    lift: Object.fromEntries(boughtIn.map((id) => [id, lift[id] ?? 0])),
    ...(backing === 'jobs' || backing === 'move' ? { starters: startersOf(league, teamId) } : {}),
  };
}
