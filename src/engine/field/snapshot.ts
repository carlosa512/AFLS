/**
 * A spatial game's snapshot (spec §4, "Re-watching"): for each man who took part, the skills, size and habits the open
 * field read, so a replay months later re-runs the same play though his ratings have moved on. A man whose skills
 * changed mid-game (a knock after an injury reshuffle) is kept again from that play.
 */
import type { FieldSkills, FieldStart } from './types';

export interface FieldSnapshot {
  /** The game's seed: a play's open field draws from `${seed}:field:${index}`. */
  seed: string;
  /** The open field's version it was played on (`FIELD_VERSION`): a replay on another stages as drawn. */
  v?: number;
  players: Record<number, FieldSkills>;
  later?: [index: number, id: number, s: FieldSkills][];
}

/** What the open field read for `id` on the play at `index`. */
export function skillsAt(snap: FieldSnapshot, id: number, index: number): FieldSkills | undefined {
  let s = snap.players[id];
  for (const [at, who, later] of snap.later ?? []) if (who === id && at <= index) s = later;
  return s;
}

/** Keep what this play's field read, for its replay. */
export function noteSkills(snap: FieldSnapshot, start: Pick<FieldStart, 'players'>, index: number): void {
  for (const p of start.players) {
    const had = skillsAt(snap, p.id, index);
    if (!had) snap.players[p.id] = p.s;
    else if (JSON.stringify(had) !== JSON.stringify(p.s)) (snap.later ??= []).push([index, p.id, p.s]);
  }
}
