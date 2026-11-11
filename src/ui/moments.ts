/**
 * The moments a game stops for: what the play on screen gives the viewer to show once its result has been told. A
 * banner for a score, a giveaway, a flag or an injury; a player's line after a big gain; a card at the quarter, the
 * half and the final. Everything is read from the play log and counts through that play, so nothing here can run
 * ahead of the picture. Spec: docs/superpowers/specs/2026-11-10-broadcast-field-and-moments-design.md §3.
 */
import { fumbleIn } from '../engine/field/fumble';
import { actorsIn } from '../engine/playActors';
import type { FieldRecord, PlayLogEntry, Team } from '../engine/types';
import { gameClock } from './format';
import { drivesOf, gainOf, linesAt, lineWords, type PlayNames } from './gameRead';
import { flagCall, injuryCall } from './stage/calls';

export type Tone = 'score' | 'turnover' | 'flag' | 'injury';
export type Moment =
  /** A block in a side's colours (none for a flag), a headline, a line under it, and a short note at the side. */
  | { kind: 'banner'; tone: Tone; teamId: number | null; head: string; line: string; side?: string }
  /** A man's line so far, after a big gain: his number when the game kept the jerseys. */
  | { kind: 'player'; playerId: number; teamId: number; number?: number; line: string }
  | { kind: 'quarter'; head: string }
  | { kind: 'half' }
  | { kind: 'final' };

/** Yards from scrimmage that earn a player's line. */
export const BIG_GAIN = 20;
/** A banner holds the screen this long at 1× (All-22's hold after a big play). */
const BANNER_MS = 2600;
/** A player's line holds this much longer than a banner, at 1×: it is numbers to read. */
export const LINE_BEAT = 1200;
/** No banner is shorter than this, however fast the game is played. */
export const BANNER_FLOOR = 800;
/** An injury's banner holds this much longer than a score's, at 1×: a name, a position and what he hurt. */
export const INJURY_BEAT = 1000;
/** No injury's banner is shorter than this: at 2× and faster it is the one banner a viewer mustn't miss. */
export const INJURY_FLOOR = 1800;
const QUARTER_MS = 2000;
/** At this speed and faster, the player's line and the quarter card are skipped. */
const FAST = 4;

const isTry = (e: PlayLogEntry) => e.kind === 'two' || /^Two-point try/.test(e.text);
const count = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;

/** A score's drive, for the banner's side: "14 plays · 91 yds · 8:04". None for a score no drive made (a return). */
function driveNote(plays: readonly PlayLogEntry[], index: number, homeId: number): string | undefined {
  const d = drivesOf(plays.slice(0, index + 1), homeId, true).find((x) => x.last === index);
  if (!d || !d.snaps) return undefined;
  return `${count(d.snaps, 'play')} · ${d.yards} yds · ${gameClock(Math.max(0, Math.round(d.end - d.start)))}`;
}

/** The banner the play at `index` makes, or none. One at most: a score before a giveaway before a flag. */
function bannerFor(plays: readonly PlayLogEntry[], index: number, home: Team, away: Team): Moment | null {
  const e = plays[index];
  const before = plays[index - 1];
  const dh = e.homeScore - (before?.homeScore ?? 0);
  const da = e.awayScore - (before?.awayScore ?? 0);
  const other = (id: number) => (id === home.id ? away : home);
  const ball = (t: Team) => `${t.city} ball`;

  // A score: read off the scoreboard, so a return and a defender's touchdown go to the side that scored.
  const points = dh + da;
  if (points > 0 && e.kind !== 'xp' && !isTry(e)) {
    const side = dh > 0 ? home : away;
    const score = (head: string, line: string): Moment => ({
      kind: 'banner',
      tone: 'score',
      teamId: side.id,
      head,
      line,
      ...(driveNote(plays, index, home.id) ? { side: driveNote(plays, index, home.id) } : {}),
    });
    if (points === 6) return score('Touchdown', e.text.replace(/[,.]? ?(?:for a )?TOUCHDOWN!?.*$/, ''));
    if (points === 3) return score('Field goal', kick(e.text));
    if (points === 2)
      return { kind: 'banner', tone: 'score', teamId: side.id, head: 'Safety', line: `${side.city} scores 2` };
  }

  if (e.kind === 'fg' && /NO GOOD/.test(e.text))
    return { kind: 'banner', tone: 'turnover', teamId: other(e.offense).id, head: 'No good', line: kick(e.text) };
  if (e.kind === 'int') {
    const m = /^(\S+) pass .*INTERCEPTED by (\S+)/.exec(e.text);
    const to = other(e.offense);
    return {
      kind: 'banner',
      tone: 'turnover',
      teamId: to.id,
      head: 'Interception',
      line: m ? `${m[2]} picks off ${m[1]}` : '',
      side: ball(to),
    };
  }
  if (fumbleIn(e)?.lost) {
    const m = /FUMBLE, recovered by (\S+?)[.,]?(?:\s|$)/.exec(e.text);
    const to = other(e.offense);
    return {
      kind: 'banner',
      tone: 'turnover',
      teamId: to.id,
      head: 'Fumble',
      line: m ? `Recovered by ${m[1]}` : '',
      side: ball(to),
    };
  }
  if (e.text === 'Turnover on downs.') {
    // The note follows the snap that came up short: the ball goes to the side that stopped it.
    const snap = [...plays.slice(0, index)].reverse().find((x) => x.down > 0);
    const to = other(snap?.offense ?? e.offense);
    return { kind: 'banner', tone: 'turnover', teamId: to.id, head: 'Turnover on downs', line: '', side: ball(to) };
  }

  const hurt = injuryCall(e);
  if (hurt) {
    const team = hurt.team === home.abbrev ? home : hurt.team === away.abbrev ? away : null;
    return {
      kind: 'banner',
      tone: 'injury',
      teamId: team?.id ?? null,
      head: 'Injury',
      line: `${hurt.name}, ${hurt.position} · ${hurt.label}`,
      side: 'Out for the game',
    };
  }

  // A flag, in the words All-22 already uses: the foul, on whom, what it cost.
  const flag = flagCall(e);
  if (flag) {
    return { kind: 'banner', tone: 'flag', teamId: null, ...flagParts(flag) };
  }
  return null;
}

/** "C.Johnson, 42 yards" from a kick's log line. */
function kick(text: string): string {
  const m = /(\S+) (\d+)-yard field goal/.exec(text);
  return m ? `${m[1]}, ${m[2]} yards` : '';
}

const GAINERS: ReadonlySet<string> = new Set(['run', 'pass', 'scramble']);

/**
 * The moments the play at `index` makes once its result has been shown, in the order they appear: a banner or a
 * player's line (never both), then the card for a period it ended. `over` says the log is a finished game's, so its
 * last play is the final (a live game's last play is only the last one reached).
 */
export function momentsFor(
  plays: readonly PlayLogEntry[],
  index: number,
  home: Team,
  away: Team,
  names: PlayNames,
  opts: { record?: FieldRecord; over?: boolean } = {},
): Moment[] {
  const e = plays[index];
  if (!e) return [];
  const out: Moment[] = [];
  const banner = bannerFor(plays, index, home, away);
  if (banner) out.push(banner);
  else if (e.kind && GAINERS.has(e.kind) && !isTry(e) && gainOf(e, home.id) >= BIG_GAIN) {
    // Only a man the log names: a game kept before it did has no line to show.
    const who = actorsIn(e).ball;
    const line = who === undefined ? undefined : linesAt(plays, index, home.id, names, opts.record).get(who);
    if (who !== undefined && line)
      out.push({
        kind: 'player',
        playerId: who,
        teamId: e.offense,
        number: opts.record?.jerseys[who],
        line: lineWords(e.kind === 'pass' ? 'receiving' : 'rushing', line),
      });
  }
  const next = plays[index + 1];
  if (next && next.quarter !== e.quarter) {
    if (e.quarter === 2) out.push({ kind: 'half' });
    else
      out.push({
        kind: 'quarter',
        head:
          e.quarter === 1
            ? 'End of the first quarter'
            : e.quarter === 3
              ? 'End of the third quarter'
              : e.quarter === 4
                ? 'End of regulation'
                : 'End of overtime',
      });
  } else if (!next && opts.over) out.push({ kind: 'final' });
  return out;
}

/**
 * How long the screen holds on a play's moments before the next play, in milliseconds (0: the view's usual hold).
 * Sped up, a banner is shorter but never under the floor (an injury's holds a beat longer, on a higher floor), and
 * the player's line and the quarter card are skipped (an overlay draws no moment whose hold is 0). The half and the
 * final wait on their own (`GameMoments`).
 */
export function momentHold(moments: readonly Moment[], speed: number): number {
  // A banner or a line is read first, then the quarter's card: one after the other, never one over the other.
  let read = 0;
  let card = 0;
  for (const m of moments) {
    if (m.kind === 'banner')
      read = Math.max(
        read,
        m.tone === 'injury'
          ? Math.max(INJURY_FLOOR, (BANNER_MS + INJURY_BEAT) / speed)
          : Math.max(BANNER_FLOOR, BANNER_MS / speed),
      );
    else if (m.kind === 'player') read = Math.max(read, speed >= FAST ? 0 : (BANNER_MS + LINE_BEAT) / speed);
    else if (m.kind === 'quarter') card = Math.max(card, speed >= FAST ? 0 : QUARTER_MS / speed);
  }
  return read + card;
}

/**
 * How long a period's card waits before it comes up: as long as the play's banner is read, whichever view draws it
 * (a walk-off touchdown is told before the final card, not under it).
 */
export function cardWait(moments: readonly Moment[], speed: number): number {
  const banner = moments.find((m) => m.kind === 'banner');
  return banner ? momentHold([banner], speed) : 0;
}

/**
 * How long the screen holds a play that ends a period, by playing into it: the wait for its banner, then the card
 * (the half's for as long as the screen gives it). Nothing for a play with no card at this speed.
 */
export function periodHold(moments: readonly Moment[], speed: number, halfMs = 0): number {
  const half = moments.some((m) => m.kind === 'half');
  const quarter = moments.filter((m) => m.kind === 'quarter');
  const card = half ? halfMs / speed : momentHold(quarter, speed);
  return card > 0 ? cardWait(moments, speed) + card : 0;
}

/** A flag's call (`flagCall`) as a banner's three parts: the foul, on whom, what it cost. */
export function flagParts(call: string): { head: string; line: string; side?: string } {
  const [head, ...rest] = call.split(' · ');
  const [line, side] = rest.length > 1 ? rest : ['', rest[0]];
  return { head, line, ...(side ? { side } : {}) };
}

/**
 * The moments of the play on screen, as a screen may show them: none until its result has been shown, and none for
 * a play the highlight level skipped past (it landed still, with others; only the play that is shown gets one).
 */
export function playMoments(
  plays: readonly PlayLogEntry[],
  index: number,
  o: { home: Team; away: Team; names: PlayNames; record?: FieldRecord; over?: boolean; told: boolean; still: boolean },
): Moment[] {
  return o.told && !o.still
    ? momentsFor(plays, index, o.home, o.away, o.names, { record: o.record, over: o.over })
    : [];
}
