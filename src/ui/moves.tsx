/**
 * Transactions are kept as text, so the people in them are found the way the engine writes them: a player
 * as "WR John Smith" (`nameOf` in finance/cap.ts), a coach, scout or medic by full name. Each becomes a link
 * to his card; a name two people share stays plain text rather than guess.
 */
import type { League, Transaction } from '../engine/types';
import { useNav, type StaffKind } from './App';

export interface Who {
  kind: 'player' | StaffKind | 'team';
  id: number;
}
/** Name as written → who it is (null when two people share it). */
export type MoveIndex = Map<string, Who | null>;
export type MoveIndexes = Record<Exclude<Who['kind'], 'team'>, MoveIndex>;

/**
 * Everyone a transaction can name, one index per kind of person, so a coaching move only weighs coaches (a
 * scout who shares his name doesn't make it ambiguous). Cheap enough to build once per list render, so it's
 * never stale.
 */
export function moveIndex(league: League): MoveIndexes {
  const build = (
    people: { id: number; firstName: string; lastName: string; position?: string; moves?: { from: string }[] }[],
    kind: Exclude<Who['kind'], 'team'>,
  ) => {
    const index: MoveIndex = new Map();
    for (const p of people) {
      // A player who changed position is named in older lines by the one he had then.
      const labels = p.position ? new Set([p.position, ...(p.moves ?? []).map((m) => m.from)]) : new Set(['']);
      for (const label of labels) {
        const key = `${label ? `${label} ` : ''}${p.firstName} ${p.lastName}`;
        const prev = index.get(key);
        index.set(key, prev === undefined || prev?.id === p.id ? { kind, id: p.id } : null);
      }
    }
    return index;
  };
  return {
    player: build(Object.values(league.players), 'player'),
    coach: build([...Object.values(league.coaches), ...Object.values(league.retiredCoaches)], 'coach'),
    scout: build(Object.values(league.staff), 'scout'),
    medic: build(Object.values(league.medics), 'medic'),
    gm: build(Object.values(league.gms), 'gm'),
  };
}

/** The indexes a transaction's names can come from: always players, plus the staff its kind is about. */
const STAFF_OF: Partial<Record<Transaction['kind'], Exclude<Who['kind'], 'team'>>> = {
  coach: 'coach',
  staff: 'scout',
  medical: 'medic',
};
export const indexesFor = (all: MoveIndexes, kind: Transaction['kind']): MoveIndex[] =>
  STAFF_OF[kind] ? [all.player, all[STAFF_OF[kind]!]] : [all.player];

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

/** Plain runs and named people, each person a link to his card. */
function Segments({ segments }: { segments: ReturnType<typeof moveSegments> }) {
  const nav = useNav();
  return (
    <>
      {segments.map((s, i) =>
        typeof s === 'string' ? (
          s
        ) : (
          <button
            key={i}
            className="linklike"
            onClick={() =>
              s.who.kind === 'player'
                ? nav.openPlayer(s.who.id)
                : s.who.kind === 'team'
                  ? nav.openTeam(s.who.id)
                  : nav.openStaff(s.who.kind, s.who.id)
            }
          >
            {s.text}
          </button>
        ),
      )}
    </>
  );
}

/** A transaction's text with every player, coach, scout and medic in it a link to his card. */
export function MoveText({ move, index }: { move: Transaction; index: MoveIndexes }) {
  return <Segments segments={moveSegments(move.text, indexesFor(index, move.kind))} />;
}

const fullName = (p: { firstName: string; lastName: string }) => `${p.firstName} ${p.lastName}`;

/**
 * Everyone by full name, the way mail writes them ("Tim Bell was the player of the game"): players, coaches
 * (retired too), scouts and medics in one index, a name two people share left out. Teams go in last as
 * "Denver Summit", the bare nickname ("The Scorpions ask…"; nicknames are unique) and a city one team has, never
 * over a person.
 */
export function nameIndex(league: League): MoveIndex {
  const index: MoveIndex = new Map();
  const add = (people: { id: number; firstName: string; lastName: string }[], kind: Exclude<Who['kind'], 'team'>) => {
    for (const p of people) {
      const key = fullName(p);
      index.set(key, index.has(key) ? null : { kind, id: p.id });
    }
  };
  add(Object.values(league.players), 'player');
  add([...Object.values(league.coaches), ...Object.values(league.retiredCoaches)], 'coach');
  add(Object.values(league.staff), 'scout');
  add(Object.values(league.medics), 'medic');
  add(Object.values(league.gms), 'gm');
  // A nickname two teams share (a mod's) stays plain, like a shared person's name.
  const teamKeys = new Set<string>();
  for (const t of league.teams) {
    for (const key of [`${t.city} ${t.name}`, t.name]) {
      if (teamKeys.has(key)) index.set(key, null);
      else if (!index.has(key)) index.set(key, { kind: 'team', id: t.id });
      teamKeys.add(key);
    }
  }
  // Then the bare city ("bring him to Washington"), last of all so a nickname or person always wins; a city two
  // teams share (New York) stays plain.
  const cities = new Map<string, number>();
  for (const t of league.teams) cities.set(t.city, (cities.get(t.city) ?? 0) + 1);
  for (const t of league.teams)
    if (cities.get(t.city) === 1 && !index.has(t.city)) index.set(t.city, { kind: 'team', id: t.id });
  return index;
}

/** The person a `Who` points at, if he's still on file. */
function personOf(league: League, w: Who): { firstName: string; lastName: string } | undefined {
  return w.kind === 'team'
    ? undefined
    : w.kind === 'player'
      ? league.players[w.id]
      : w.kind === 'coach'
        ? (league.coaches[w.id] ?? league.retiredCoaches[w.id])
        : w.kind === 'scout'
          ? league.staff[w.id]
          : w.kind === 'gm'
            ? league.gms[w.id]
            : league.medics[w.id];
}

/**
 * Text with everyone in it a link to his card. `about` names the people it's about (a message's player, its
 * sender): their names link even when someone else shares them. Pass `index` to share one across a screen.
 */
export function LinkedText({
  league,
  text,
  about = [],
  index,
}: {
  league: League;
  text: string;
  about?: Who[];
  index?: MoveIndex;
}) {
  return <Segments segments={linkedSegments(league, text, about, index)} />;
}

/** `LinkedText`'s cut: plain runs and named people, the people it's about first. */
export function linkedSegments(league: League, text: string, about: Who[] = [], index = nameIndex(league)) {
  const names = new Map(index);
  for (const w of about) {
    const p = personOf(league, w);
    if (p) names.set(fullName(p), w);
  }
  return moveSegments(text, [names]);
}
