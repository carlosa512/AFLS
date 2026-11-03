/**
 * The habits the engine found in play on a run or a catch (`OpenField.habits`), by man: the film shows them in how he
 * moves (spec: docs/superpowers/specs/2026-11-02-all-22-open-field-design.md §3a). Older games noted none.
 */
import type { QuirkId } from '../../engine/quirks';
import type { PlayLogEntry } from '../../engine/types';

export type Habits = ReadonlyMap<number, ReadonlySet<QuirkId>>;

/** Each man's noted habits on this play, for the men on the field (a noted id the formation doesn't hold is dropped). */
export function habitsOf(e: PlayLogEntry, onField: ReadonlySet<number>): Map<number, Set<QuirkId>> {
  const out = new Map<number, Set<QuirkId>>();
  for (const [id, q] of e.open?.habits ?? e.ran?.open?.habits ?? []) {
    if (!onField.has(id)) continue;
    if (!out.has(id)) out.set(id, new Set());
    out.get(id)!.add(q);
  }
  return out;
}

/** Whether `id` showed habit `q` on this play. */
export const has = (h: Habits | undefined, id: number | undefined, q: QuirkId): boolean =>
  id !== undefined && !!h?.get(id)?.has(q);

const NONE: ReadonlySet<QuirkId> = new Set();

/** One man's habits on this play (none, if he showed none). */
export const habitsFor = (h: Habits | undefined, id: number | undefined): ReadonlySet<QuirkId> =>
  (id !== undefined && h?.get(id)) || NONE;
