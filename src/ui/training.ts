/**
 * What the position screens say, in plain words: the UI side of engine/training.ts and familiarity.ts.
 * The coaches' read, the learning ladder and the knock for playing out of position all reach a screen as
 * words; the numbers behind them (a learner's weeks, his pace, a motive's strength, the knock's size) stay
 * with the engine. Mirrors ui/coaching.ts.
 */
import { placeAt, returnHome, slotOf } from '../engine/roster';
import { coordinatorOf, teamCoaches } from '../engine/coaching';
import { reasonLine } from '../engine/inbox';
import { knockFor, knockWord, targetsFor } from '../engine/familiarity';
import { POSITION_NAMES } from '../engine/positions';
import { activeLearning, type ConversionRead, type Familiarity, type Verdict } from '../engine/training';
import type { Coach, League, MoveReason, Phase, Player, Position, PositionMove } from '../engine/types';
import { OFFSEASON_PHASES, POSITIONS } from '../engine/types';
import { withArticle } from './coaching';

// ───────── the coaches' read, in words ─────────

/** The three verdicts the coaches give a move. */
export function verdictText(v: Verdict): string {
  return v === 'worth' ? 'Worth it' : v === 'ifNeeded' ? 'Only if you need him there' : 'Not worth it';
}
/** The pill tint that backs the verdict up (the words carry the meaning). */
export const verdictTone = (v: Verdict): string => (v === 'worth' ? 'tag-good' : v === 'not' ? 'tag-warn' : '');

/** What a reason needs to be put in words: a `ConversionRead` fits, and so does a plan's `why` with its coordinator. */
export interface ReasonRead {
  reason: MoveReason | null;
  to: Position;
  /** For a scheme reason: whose scheme it is, and whether he's new this year. */
  coordinator?: { coach: Coach; isNew: boolean };
}

/** The motive behind a move, as a sentence ("Fills a hole at S"); empty when there is none. The inbox's words. */
export const reasonText = (r: ReasonRead): string => (r.reason ? reasonLine(r.reason, r.to, r.coordinator) : '');

/** Where the time goes: "the coming camp" is this summer's, or next summer's once the season is on. */
function campWord(phase: Phase): string {
  if (phase === 'preseason') return 'this camp';
  return OFFSEASON_PHASES.includes(phase) ? 'the coming camp' : "next summer's camp";
}

/** When the coaches expect him ready (`camps` from `campsToReady`: 0 is the next camp), at a typical pace. */
export function readyText(camps: number, phase: Phase): string {
  if (camps <= 0) return `Ready by ${campWord(phase)}`;
  if (camps === 1) return 'Ready by the camp after';
  return `About ${camps + 1} camps away`;
}

/** The deal he would sign next, priced as what he has become. */
export function payText(pay: ConversionRead['pay'], to: Position): string {
  const job = POSITION_NAMES[to].toLowerCase();
  return pay === 'higher'
    ? `His next deal would pay more as ${withArticle(job)}`
    : pay === 'lower'
      ? `His next deal would pay less as ${withArticle(job)}`
      : 'His next deal would pay about the same';
}

const initialed = (p: Pick<Player, 'firstName' | 'lastName'>) => `${p.firstName[0]}. ${p.lastName}`;

/** Where he would slot at the new position today. */
export function roleText(read: Pick<ConversionRead, 'role' | 'ahead'>): string {
  if (read.role === 'backup') return 'A backup there';
  return read.ahead ? `Would start ahead of ${initialed(read.ahead)}` : 'Would start there';
}

/** What his old room looks like if he goes. */
export function leftText(left: number, from: Position): string {
  return `You would have ${left === 0 ? 'no' : left} ${from} left`;
}

/** The knock for lining up out of position, in words (`knockWord`); the engine keeps the number. */
export function knockText(word: 'none' | 'small' | 'big', pos: Position): string {
  if (word === 'none') return `No knock at ${pos}`;
  return `Plays ${pos} out of position: a ${word} knock`;
}

// ───────── learning ─────────

/** "Learning LB (from EDGE) · Competent". */
export function learnLine(from: Position, to: Position, f: Familiarity | null): string {
  return `Learning ${to} (from ${from})${f ? ` · ${f}` : ''}`;
}

/** The pill tint for how far along he is: warm while he is raw, green once he's close. */
export function familiarityTone(f: Familiarity | null): string {
  return f === 'Awkward' || f === 'Unconvincing' ? 'tag-warn' : f === 'Accomplished' || f === 'Ready' ? 'tag-good' : '';
}

/** One finished move for the card's history: "2026: EDGE → LB". */
export const moveLine = (m: PositionMove): string => `${m.season}: ${m.from} → ${m.to}`;

const DEFENDERS: ReadonlySet<Position> = new Set(['DT', 'EDGE', 'LB', 'CB', 'S']);

/** The coordinator whose scheme a plan serves, with whether he's new this year (for a scheme reason). */
export function coordinatorFor(league: League, teamId: number, to: Position): ReasonRead['coordinator'] {
  // The same split the coaches' read makes: defenders answer to the defensive coordinator.
  const coach = coordinatorOf(teamCoaches(league, teamId), DEFENDERS.has(to) ? 'defCoord' : 'offCoord');
  return coach ? { coach, isNew: coach.since === league.season } : undefined;
}

/** A live plan's reason, as the card and the Coaches screen read it (a plan keeps the reason it started with). */
export function planReason(league: League, p: Player): string {
  const l = activeLearning(p);
  if (!l?.why) return '';
  return reasonText({
    reason: l.why,
    to: l.to,
    coordinator: l.why === 'scheme' ? coordinatorFor(league, p.teamId!, l.to) : undefined,
  });
}

/** The line under a Start button that can't be pressed, or null. Out of the offseason one line on the card says it for every row. */
export const startNote = (read: Pick<ConversionRead, 'problem'>, league: League): string | null =>
  OFFSEASON_PHASES.includes(league.phase) ? read.problem : null;

/** Does his card have anything to say about position: a plan, a target, a move behind him, or a spot away from his own? */
export function hasPositionWork(league: League, p: Player): boolean {
  return (
    !p.retired &&
    p.teamId === league.userTeamId &&
    (!!activeLearning(p) || targetsFor(p).length > 0 || (p.moves ?? []).length > 0 || slotOf(league, p) !== p.position)
  );
}

// ───────── playing out of position ─────────

/** The knock he takes lined up at `slot`, in words. The only way a screen sees it. */
export const knockAt = (p: Player, slot: Position) => knockWord(knockFor(p, slot));

/** "Lined up at WR (out of position): a big knock" ("no knock" once he has learned it). */
export function lineupText(p: Player, slot: Position): string {
  const word = knockAt(p, slot);
  return `Lined up at ${slot} (out of position): ${word === 'none' ? 'no knock' : `a ${word} knock`}`;
}

/** A "Play at…" choice: "WR · big knock", "S · no knock". */
export const playAtLabel = (p: Player, pos: Position): string =>
  pos === p.position ? `Back to ${pos}` : `${pos} · ${knockAt(p, pos) === 'none' ? 'no' : knockAt(p, pos)} knock`;

/** Where the "Play at…" menu can send him: every position but the one he's lined up at (his own comes first as "Back to"). */
export const positionChoices = (slot: Position): Position[] => POSITIONS.filter((pos) => pos !== slot);

/** Put him back at his own position, among the group by rating (`returnHome`). */
export function placeBack(league: League, playerId: number): void {
  if (league.players[playerId].teamId === null) throw new Error('Not on a team.');
  returnHome(league, playerId);
}

/** Line him up at `pos` ("Play at…"), or back at his own. Auto-sort stays as it was: the move is remembered either way. */
export function playAt(league: League, playerId: number, pos: Position): void {
  if (league.players[playerId].position === pos) placeBack(league, playerId);
  else placeAt(league, playerId, pos);
}
