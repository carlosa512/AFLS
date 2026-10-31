/**
 * Who a play was about, packed for the save. Every kept play carries one, so it is stored as a short list in a fixed
 * order (gaps as null, trailing gaps dropped) rather than as named fields: a third of the size. The passer and the
 * kick units are left out because the game's field record already names them (`GameResult.field`).
 */
import type { PackedActors, PlayActors, PlayLogEntry } from './types';

/** The packed order: most plays need only the first two. */
const ORDER = ['ball', 'tackle', 'cover', 'rush', 'beat', 'take'] as const satisfies readonly (keyof PlayActors)[];

export function packActors(a: PlayActors): PackedActors | undefined {
  const list: (number | null)[] = ORDER.map((k) => a[k] ?? null);
  while (list.length && list[list.length - 1] === null) list.pop();
  return list.length ? list : undefined;
}

/** A play's actors by name: empty for plays without any (kicks, announcements, games before v71). */
export function actorsIn(e: Pick<PlayLogEntry, 'who'>): PlayActors {
  const a: PlayActors = {};
  e.who?.forEach((id, i) => {
    if (id !== null) a[ORDER[i]] = id;
  });
  return a;
}
