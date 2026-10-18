/**
 * Transactions are kept as text, so the people in them are found the way the engine writes them: a player
 * as "WR John Smith" (`nameOf` in finance/cap.ts), a coach, scout or medic by full name. Each becomes a link
 * to his card; a name two people share stays plain text rather than guess.
 */
import type { League, Transaction } from '../engine/types';
import { useNav, type StaffKind } from './App';

export interface Who {
  kind: 'player' | StaffKind;
  id: number;
}
/** Name as written → who it is (null when two people share it). */
export type MoveIndex = Map<string, Who | null>;
export type MoveIndexes = Record<Who['kind'], MoveIndex>;

/**
 * Everyone a transaction can name, one index per kind of person, so a coaching move only weighs coaches (a
 * scout who shares his name doesn't make it ambiguous). Cheap enough to build once per list render, so it's
 * never stale.
 */
export function moveIndex(league: League): MoveIndexes {
  const build = (people: { id: number; firstName: string; lastName: string; position?: string }[], kind: Who['kind']) => {
    const index: MoveIndex = new Map();
    for (const p of people) {
      const key = `${p.position ? `${p.position} ` : ''}${p.firstName} ${p.lastName}`;
      index.set(key, index.has(key) ? null : { kind, id: p.id });
    }
    return index;
  };
  return {
    player: build(Object.values(league.players), 'player'),
    coach: build([...Object.values(league.coaches), ...Object.values(league.retiredCoaches)], 'coach'),
    scout: build(Object.values(league.staff), 'scout'),
    medic: build(Object.values(league.medics), 'medic'),
  };
}

/** The indexes a transaction's names can come from: always players, plus the staff its kind is about. */
const STAFF_OF: Partial<Record<Transaction['kind'], Who['kind']>> = { coach: 'coach', staff: 'scout', medical: 'medic' };
export const indexesFor = (all: MoveIndexes, kind: Transaction['kind']): MoveIndex[] => (STAFF_OF[kind] ? [all.player, all[STAFF_OF[kind]!]] : [all.player]);

const letter = (ch: string | undefined) => !!ch && /[A-Za-z]/.test(ch);

/** `text` cut into plain runs and named people, in order. Where names overlap, the longest wins ("WR John Smith" over a coach called John Smith). */
export function moveSegments(text: string, indexes: MoveIndex[]): (string | { text: string; who: Who })[] {
  const hits: { at: number; key: string; who: Who }[] = [];
  for (const index of indexes) {
    for (const [key, who] of index) {
      if (!who) continue;
      // Whole names only: "John Smith" isn't in "John Smithers"; "Smith's" still counts.
      for (let at = text.indexOf(key); at >= 0; at = text.indexOf(key, at + 1)) {
        if (!letter(text[at - 1]) && !letter(text[at + key.length])) hits.push({ at, key, who });
      }
    }
  }
  hits.sort((a, b) => b.key.length - a.key.length);
  const taken: typeof hits = [];
  for (const h of hits) if (!taken.some((t) => h.at < t.at + t.key.length && t.at < h.at + h.key.length)) taken.push(h);
  taken.sort((a, b) => a.at - b.at);
  const out: (string | { text: string; who: Who })[] = [];
  let from = 0;
  for (const h of taken) {
    if (h.at > from) out.push(text.slice(from, h.at));
    out.push({ text: h.key, who: h.who });
    from = h.at + h.key.length;
  }
  if (from < text.length) out.push(text.slice(from));
  return out;
}

/** A transaction's text with every player, coach, scout and medic in it a link to his card. */
export function MoveText({ move, index }: { move: Transaction; index: MoveIndexes }) {
  const nav = useNav();
  return (
    <>
      {moveSegments(move.text, indexesFor(index, move.kind)).map((s, i) =>
        typeof s === 'string' ? (
          s
        ) : (
          <button key={i} className="linklike" onClick={() => (s.who.kind === 'player' ? nav.openPlayer(s.who.id) : nav.openStaff(s.who.kind, s.who.id))}>
            {s.text}
          </button>
        ),
      )}
    </>
  );
}
