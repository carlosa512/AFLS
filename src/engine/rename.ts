/**
 * The names pass for saves made before it (v27): everyone the old uniform pools named gets a name from the
 * heritage pools, as a new league would draw it, and every stored line of text that names them (mail,
 * transactions, rumors, play-by-play, severance) is rewritten to match, so history still links and still
 * reads true. A name the user typed is kept, and flagged so no later pass touches it.
 */
import { LEGACY_FIRST_NAMES, LEGACY_LAST_NAMES } from './data/legacyNames';
import { newIdentity, type NameFor } from './identity';
import { Rng } from './rng';
import { generateTraits } from './traits';
import type { League, Player } from './types';

const OLD_FIRST = new Set(LEGACY_FIRST_NAMES);
const OLD_LAST = new Set(LEGACY_LAST_NAMES);
const generated = (p: { firstName: string; lastName: string }) => OLD_FIRST.has(p.firstName) && OLD_LAST.has(p.lastName);

/**
 * Whether a player still has the name he was generated with. His traits are seeded by his name at creation
 * and never change, so a rename (the identity editor sets no flag before v27) shows up as a mismatch; a name
 * outside the old pools was typed in whatever the traits say.
 */
export function nameUntouched(p: Player): boolean {
  if (p.nameEdited || !generated(p)) return false;
  // Only the traits a v26 save had: Versatility arrives with v30, after this pass.
  const { versatility: _made, ...made } = generateTraits(p);
  const { versatility: _kept, ...kept } = p.traits;
  return JSON.stringify(made) === JSON.stringify(kept);
}

const full = (p: { firstName: string; lastName: string }) => `${p.firstName} ${p.lastName}`;
const short = (p: { firstName: string; lastName: string }) => `${p.firstName[0]}.${p.lastName}`;

/** Old full name to new, kept only where the old name meant one person (a shared one never linked anyway). */
class NameMap {
  private map = new Map<string, string | null>();
  add(from: string, to: string): void {
    this.map.set(from, this.map.has(from) ? null : to);
  }
  /** A name nobody was renamed from, but someone still carries, can't be swapped either. */
  block(name: string): void {
    if (this.map.has(name)) this.map.set(name, null);
  }
  get(name: string): string | undefined {
    return this.map.get(name) ?? undefined;
  }
  get size(): number {
    return this.map.size;
  }
}

/**
 * Rewrites "First Last" pairs in one pass over the words, so a swap is never swapped again. Words are runs of
 * letters, which is the boundary the UI's name links use: "Smith's" is Smith, "Smithers" is not.
 */
export function rewriteNames(text: string, names: NameMap): string {
  if (!names.size) return text;
  const words = [...text.matchAll(/[A-Za-z]+/g)];
  let out = '';
  let at = 0;
  for (let i = 0; i < words.length - 1; i++) {
    const a = words[i];
    const b = words[i + 1];
    if (b.index !== a.index + a[0].length + 1 || text[a.index + a[0].length] !== ' ') continue;
    const to = names.get(`${a[0]} ${b[0]}`);
    if (to === undefined) continue;
    out += text.slice(at, a.index) + to;
    at = b.index + b[0].length;
    i++;
  }
  return at === 0 ? text : out + text.slice(at);
}

/** Play text writes players as "F.Last": swapped per game, among the players who suited up in it. */
function rewritePlays(text: string, names: Map<string, string>): string {
  return text.replace(/\b[A-Z]\.[A-Za-z]+/g, (m) => names.get(m) ?? m);
}

type Named = { firstName: string; lastName: string; woman?: true };

/** Who an older save held when it loaded, and whether the old pools named it. */
export interface PeopleAtLoad {
  legacy: boolean;
  players: ReadonlySet<number>;
  coaches: ReadonlySet<number>;
  staff: ReadonlySet<number>;
  medics: ReadonlySet<number>;
  crews: ReadonlySet<number>;
}

/**
 * Taken before any upgrade step runs: the steps for older versions add people (staffs, crews) and name them
 * the new way, and those keep their names. A save counts as the old pools' when its staff and referees,
 * which nobody can rename, all carry old-pool names (or, before there were staffs, nearly all its players
 * do); one the new pools named already has nothing to redo.
 */
export function peopleAtLoad(league: League): PeopleAtLoad {
  const ids = (r: Record<number, unknown> | undefined) => new Set(Object.keys(r ?? {}).map(Number));
  const coaches = [...Object.values(league.coaches ?? {}), ...Object.values(league.retiredCoaches ?? {})];
  const unedited = [...coaches.filter((c) => c.playerId === undefined), ...Object.values(league.staff ?? {}), ...Object.values(league.medics ?? {}), ...(league.crews ?? [])];
  const players = Object.values(league.players);
  const share = (xs: { firstName: string; lastName: string }[]) => xs.filter(generated).length / xs.length;
  return {
    legacy: unedited.length ? share(unedited) >= 0.95 : players.length > 0 && share(players) >= 0.9,
    players: ids(league.players),
    coaches: new Set(coaches.map((c) => c.id)),
    staff: ids(league.staff),
    medics: ids(league.medics),
    crews: new Set((league.crews ?? []).map((c) => c.id)),
  };
}

export function renamePeople(league: League, before: PeopleAtLoad): void {
  if (!before.legacy) return;
  const fullNames = new NameMap();
  const playMaps = new Map<number, string>(); // player id -> new short name, for the plays
  const oldShort = new Map<number, string>();
  const rename = (who: Named, kind: string, id: number, as: NameFor, avoidLast?: ReadonlySet<string>) => {
    const before = full(who);
    const next = newIdentity(new Rng(`${league.seed}:rename:${kind}:${id}`), as, avoidLast);
    who.firstName = next.firstName;
    who.lastName = next.lastName;
    if (next.woman) who.woman = true;
    fullNames.add(before, full(who));
  };

  for (const p of Object.values(league.players)) {
    if (!before.players.has(p.id)) continue;
    if (!nameUntouched(p)) {
      p.nameEdited = true;
      continue;
    }
    oldShort.set(p.id, short(p));
    rename(p, 'player', p.id, { kind: 'player', position: p.position });
    playMaps.set(p.id, short(p));
  }
  for (const c of [...Object.values(league.coaches), ...Object.values(league.retiredCoaches)]) {
    if (!before.coaches.has(c.id)) continue;
    if (c.playerId !== undefined) {
      // a former player keeps his playing name, the new one if it changed
      const p = league.players[c.playerId];
      if (p && (p.firstName !== c.firstName || p.lastName !== c.lastName)) {
        c.firstName = p.firstName;
        c.lastName = p.lastName;
      }
      continue;
    }
    if (generated(c)) rename(c, 'coach', c.id, { kind: 'coach', role: c.role });
  }
  for (const s of Object.values(league.staff)) if (before.staff.has(s.id) && generated(s)) rename(s, 'scout', s.id, { kind: 'scout', role: s.role });
  for (const m of Object.values(league.medics)) if (before.medics.has(m.id) && generated(m)) rename(m, 'medic', m.id, { kind: 'medic', role: m.role });
  const renames = (c: { id: number; firstName: string; lastName: string }) => before.crews.has(c.id) && generated(c);
  const crewSurnames = new Set(league.crews.filter((c) => !renames(c)).map((c) => c.lastName));
  for (const c of league.crews) {
    if (!renames(c)) continue;
    rename(c, 'crew', c.id, { kind: 'official' }, crewSurnames);
    crewSurnames.add(c.lastName);
  }
  // a name someone kept (typed in, or a former player's) still means them: don't swap it for anyone else
  for (const p of Object.values(league.players)) if (p.nameEdited) fullNames.block(full(p));

  const fix = (s: string) => rewriteNames(s, fullNames);
  for (const t of league.transactions) t.text = fix(t.text);
  for (const m of league.inbox ?? []) {
    // trade mail is keyed by its transaction's text: rewritten the same way, it still finds its transaction
    m.id = fix(m.id);
    m.subject = fix(m.subject);
    m.body = fix(m.body);
    m.from = fix(m.from);
  }
  if (league.market) {
    for (const r of league.market.rumors) r.text = fix(r.text);
    for (const h of league.market.history) for (const x of h.physicals ?? []) x.note = fix(x.note);
    for (const x of league.market.exam?.exams ?? []) x.note = fix(x.note);
  }
  for (const t of league.teams) for (const list of [t.staffDead, t.coachDead, t.medicalDead]) for (const d of list ?? []) d.name = fix(d.name);

  for (const g of league.games) {
    if (!g.result?.plays) continue;
    const swap = new Map<string, string | null>();
    for (const id of Object.keys(g.result.playerTeams).map(Number)) {
      const from = oldShort.get(id);
      const to = playMaps.get(id);
      if (from && to) swap.set(from, swap.has(from) ? null : to);
    }
    const names = new Map([...swap].filter((e): e is [string, string] => e[1] !== null));
    if (names.size) for (const play of g.result.plays) play.text = rewritePlays(play.text, names);
  }
}
