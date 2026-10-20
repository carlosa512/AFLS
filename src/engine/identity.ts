/**
 * Names for new people: players by position, staff by chair, referees. A heritage is drawn from the
 * role's mix (`data/heritage.ts`), then a first name and a surname from that heritage's pools
 * (`data/names.ts`). The heritage is thrown away: only the name is kept, and nothing reads it back.
 */
import {
  MEDIC_MIX,
  COACH_MIX,
  MIXED_SURNAME,
  OFFICIAL_MIX,
  PLAYER_MIX,
  SCOUT_MIX,
  WOMEN_MIX,
  WOMEN_SHARE,
  type Mix,
} from './data/heritage';
import {
  HERITAGES,
  MEN_FIRST,
  RESERVED_FULL_NAMES,
  SURNAMES,
  WOMEN_FIRST,
  type Heritage,
  type Weighted,
} from './data/names';
import { Rng } from './rng';
import type { CoachRole, MedicRole, Position, StaffRole } from './types';

export type NameFor =
  | { kind: 'player'; position: Position }
  | { kind: 'coach'; role: CoachRole }
  | { kind: 'scout'; role: StaffRole }
  | { kind: 'medic'; role: MedicRole }
  | { kind: 'official' };

export interface Identity {
  firstName: string;
  lastName: string;
  /** Scouts and medics only, at their chair's share. */
  woman?: true;
}

/**
 * The pools list the head of each distribution (Census counts), not its long tail, so their weights are
 * flattened: without it Smith would be one white player in eleven instead of about one in seventy, and
 * shared full names (shown unlinked in mail) would pile up (tune).
 */
const FLATTEN = 0.6;
/** Redraws before accepting a clash (a reserved name, first = last, a surname a crew already has). */
const TRIES = 30;

const RESERVED = new Set(RESERVED_FULL_NAMES);

interface Table {
  names: readonly string[];
  /** Running totals of the flattened weights. */
  cum: Float64Array;
}
const tables = new Map<Weighted, Table>();
function table(list: Weighted): Table {
  let t = tables.get(list);
  if (!t) {
    const cum = new Float64Array(list.length);
    let sum = 0;
    list.forEach(([, w], i) => (cum[i] = sum += w ** FLATTEN));
    t = { names: list.map(([n]) => n), cum };
    tables.set(list, t);
  }
  return t;
}
/** One draw: binary search on the running totals. */
function pickFrom(rng: Rng, list: Weighted): string {
  const { names, cum } = table(list);
  const x = rng.next() * cum[cum.length - 1];
  let lo = 0;
  let hi = cum.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] > x) hi = mid;
    else lo = mid + 1;
  }
  return names[lo];
}
function heritageFrom(rng: Rng, m: Mix): Heritage {
  let x = rng.next() * HERITAGES.reduce((s, h) => s + m[h], 0);
  for (const h of HERITAGES) if ((x -= m[h]) < 0) return h;
  return HERITAGES[0];
}

function mixFor(who: NameFor, woman: boolean): Mix {
  switch (who.kind) {
    case 'player':
      return PLAYER_MIX[who.position];
    case 'coach':
      return COACH_MIX[who.role];
    case 'scout':
      return woman ? WOMEN_MIX[who.role] : SCOUT_MIX[who.role];
    case 'medic':
      return woman ? WOMEN_MIX[who.role] : MEDIC_MIX[who.role];
    case 'official':
      return OFFICIAL_MIX;
  }
}

/** The whole draw, on its own stream. */
export function identityFrom(
  rng: Rng,
  who: NameFor,
  avoidLast?: ReadonlySet<string>,
): Identity & { heritage: Heritage } {
  const woman = (who.kind === 'scout' || who.kind === 'medic') && rng.chance(WOMEN_SHARE[who.role]);
  const m = mixFor(who, woman);
  // players were born around 2000; staff and referees a generation earlier
  const generation = who.kind === 'player' ? 'young' : 'older';
  let best: Identity & { heritage: Heritage } = { firstName: '', lastName: '', heritage: 'white' };
  for (let i = 0; i < TRIES; i++) {
    const heritage = heritageFrom(rng, m);
    const firstName = pickFrom(rng, woman ? WOMEN_FIRST[heritage] : MEN_FIRST[heritage][generation]);
    const lastName = pickFrom(rng, SURNAMES[rng.chance(MIXED_SURNAME) ? heritageFrom(rng, m) : heritage]);
    best = { firstName, lastName, heritage, ...(woman && { woman: true as const }) };
    if (firstName !== lastName && !RESERVED.has(`${firstName} ${lastName}`) && !avoidLast?.has(lastName)) break;
  }
  return best;
}

/**
 * A new person's name (and, for scouts and medics, whether she's a woman). It costs the caller's stream
 * exactly two draws, as the old uniform name picks did, so every roll after it lands where it always has;
 * the draw itself runs on a stream seeded from those two.
 */
export function newIdentity(rng: Rng, who: NameFor, avoidLast?: ReadonlySet<string>): Identity {
  const { firstName, lastName, woman } = identityFrom(new Rng(`name:${rng.next()}:${rng.next()}`), who, avoidLast);
  return { firstName, lastName, ...(woman && { woman }) };
}
