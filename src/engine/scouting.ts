/**
 * What a front office believes about a player. The match engine always plays the true ratings;
 * every screen shows a team's perception instead: exact for its own players, a range for
 * everyone else that narrows with film (years in the league) and with scouting visits.
 *
 * Nothing per team is stored except the user's scouting. A view is derived from how well the team
 * knows the player, how good the staff member reading him is (see staff.ts), and an error seeded by
 * (league, team, player), so a report never changes when a screen refreshes, and as knowledge grows
 * the same error shrinks toward the truth instead of being re-rolled. Part of the error belongs to
 * the reader himself: a new scout brings his own opinions.
 */
import { ATTRIBUTE_INFO, type AgingFamily } from './attributes';
import { declineOnset } from './aging';
import { repsSoFar } from './development';
import { ATTRIBUTE_PROFILES, overall, OVR_WEIGHTS, POSITION_NAMES, STARTERS } from './positions';
import { activeQuirks, formingQuirks, QUIRKS, type QuirkId, type QuirkTone } from './quirks';
import { clamp, Rng } from './rng';
import { knockFor } from './familiarity';
import { slotOf, starters, teamRatings } from './roster';
import { accuracy, FOCUS_OF, readFor, teamStaff, type Domain } from './staff';
import { passerRating } from './stats';
import { TEMPER_POSITIONS, TRAIT_MEAN } from './traits';
import type { Attribute, Combine, League, Player, Position, Ratings, StatLine, Team, Traits } from './types';
import { ATTRIBUTES, POSITIONS } from './types';

/** Scouting visits a front office gets per league year. */
export const SCOUT_POINTS_PER_YEAR = 30;
/** Share of the remaining uncertainty one scouting visit removes. */
const VISIT_GAIN = 0.35;

/** Rating-point error (sd) and range half-width at zero knowledge. */
const ERROR = 2.4;
const SPREAD = 4;
/** Some things are easier to see on film: athleticism shows, the mental game hides. */
const VISIBILITY: Record<AgingFamily, number> = { physical: 0.2, technical: 0, mental: -0.1 };

/** A draft prospect who hasn't been picked yet. */
export const isProspect = (p: Player) => !!p.scouting && !p.draft && p.teamId === null;

/**
 * How well `teamId` knows a player: 0 (a name on a list) … 1 (exact). Your own players are known
 * exactly; veterans are well known from film; prospects are mostly guesswork until scouted.
 */
export function knowledge(league: League, teamId: number, p: Player): number {
  if (p.teamId === teamId) return 1;
  // Higher-graded prospects get more exposure (bowl games, TV), so start better known.
  const film = isProspect(p)
    ? 0.2 + 0.15 * clamp((p.scouting!.grade - 6) / 8, 0, 1)
    : Math.min(0.9, 0.45 + 0.08 * p.experience);
  const scouted = teamId === league.userTeamId ? (league.knowledge[p.id] ?? 0) : aiScouted(league, teamId, p, film);
  return Math.max(film, scouted);
}

/** Where AI teams send their scouts: the prospects likely to be there at their own early picks. */
interface DraftContext {
  /** Each prospect's rank in his class by consensus (1 = best). */
  rank: Map<number, number>;
  /** Overall slots each team owns in the first two rounds. */
  slots: Map<number, number[]>;
}

const draftCache = new WeakMap<League, { key: string; ctx: DraftContext }>();

function draftContext(league: League): DraftContext {
  const last = league.transactions.at(-1);
  const key = `${league.season}|${league.draftClass.length}|${league.draftClass[0]}|${league.transactions.length}|${last?.text ?? ''}`;
  const hit = draftCache.get(league);
  if (hit && hit.key === key) return hit.ctx;
  const rank = new Map(
    league.draftClass
      .map((id) => league.players[id])
      .filter((p) => p?.scouting)
      .sort(
        (a, b) =>
          0.6 * b.scouting!.grade + 0.4 * b.scouting!.ceiling - (0.6 * a.scouting!.grade + 0.4 * a.scouting!.ceiling),
      )
      .map((p, i) => [p.id, i + 1]),
  );
  const slots = new Map<number, number[]>();
  for (const pick of league.draftPicks) {
    if (pick.season !== league.season || pick.round > 2 || pick.overall === undefined) continue;
    slots.set(pick.ownerId, [...(slots.get(pick.ownerId) ?? []), pick.overall]);
  }
  const ctx = { rank, slots };
  draftCache.set(league, { key, ctx });
  return ctx;
}

/**
 * An AI team's own scouting, derived rather than stored: prospects ranked just above and below its
 * early picks get about two visits' worth of looks. Different slots mean different teams know
 * different prospects, so their boards disagree in different places.
 */
function aiScouted(league: League, teamId: number, p: Player, film: number): number {
  if (!isProspect(p)) return 0;
  const ctx = draftContext(league);
  const rank = ctx.rank.get(p.id);
  if (rank === undefined) return 0;
  const near = (ctx.slots.get(teamId) ?? []).some((slot) => rank >= slot - 4 && rank <= slot + 16);
  return near ? film + (1 - film) * 0.55 : 0;
}

export interface RatingView {
  /** Best guess, rounded. */
  value: number;
  lo: number;
  hi: number;
}

export interface PlayerView {
  knowledge: number;
  /** Own player: visible ratings are exact (potential is still a judgment call). */
  exact: boolean;
  ratings: Record<Attribute, RatingView>;
  /** Best-guess overall (unrounded) and its range. */
  ovr: number;
  ovrLo: number;
  ovrHi: number;
  /** Projected ceiling, on the overall scale. Collapses to the overall once he's done growing. */
  potLo: number;
  potHi: number;
  /** Best single guess at the ceiling, and how far off (1 sd) the overall and ceiling guesses tend to be. */
  potMid: number;
  ovrSd: number;
  potSd: number;
  /** How the readers scale errors and ranges (1 = a typical department) and who they are. */
  accuracy: number;
  potAccuracy: number;
  readerId: number | null;
  potReaderId: number | null;
}

/** `teamId`'s view of a player. */
export function perceive(league: League, teamId: number, p: Player): PlayerView {
  const k = knowledge(league, teamId, p);
  const exact = k >= 1;
  // Who reads him: prospects are the college scouts' job, everyone else the pro scouts'.
  const domain: Domain = isProspect(p) ? 'college' : 'pro';
  const staff = league.teams[teamId] ? teamStaff(league, teamId) : null;
  const evalRead = staff && readFor(staff, domain, FOCUS_OF[p.position], 'evaluation');
  const projRead = staff && readFor(staff, domain, FOCUS_OF[p.position], 'projection');
  const acc = evalRead ? accuracy(evalRead.rating) : 1;
  const accPot = projRead ? accuracy(projRead.rating) : 1;
  const readerId = evalRead?.by?.id ?? null;
  const potReaderId = projRead?.by?.id ?? null;
  // The team's lasting impression of the player, and the current readers' own take on him.
  const rng = new Rng(`${league.seed}:view:${teamId}:${p.id}`);
  // The evaluator's own take on today's ratings; the projector's on the ceiling. Changing one
  // reader leaves the other's opinions alone.
  const ownEval = new Rng(`${league.seed}:view:${teamId}:${p.id}:${readerId ?? 0}`);
  const mix = () => 0.8 * rng.normal() + 0.6 * ownEval.normal();
  // A scout who is high on a player tends to be high on all of him; each trait adds its own miss.
  const zPlayer = mix();
  const zPot =
    0.8 * rng.normal() +
    (p.age < 26 ? 0.6 * new Rng(`${league.seed}:view:${teamId}:${p.id}:pot:${potReaderId ?? 0}`).normal() : 0);
  const weights = OVR_WEIGHTS[p.position];
  const ratings = {} as Record<Attribute, RatingView>;
  const centers = {} as Ratings;
  let spread = 0;
  let weightSum = 0;
  let missSum = 0;
  let missSq = 0;
  for (const attr of ATTRIBUTES) {
    const z = mix();
    const truth = p.ratings[attr];
    const miss = exact ? 0 : 1 - clamp(k + VISIBILITY[ATTRIBUTE_INFO[attr].aging], 0, 1);
    // A sharper reader is both closer to the truth and surer of it, so ranges stay honest.
    const center = clamp(truth + ERROR * miss * acc * (0.6 * zPlayer + 0.8 * z), 1, 20);
    const half = SPREAD * miss * acc;
    const value = Math.round(center);
    ratings[attr] =
      half < 0.5
        ? { value, lo: value, hi: value }
        : { value, lo: clamp(Math.round(center - half), 1, 20), hi: clamp(Math.round(center + half), 1, 20) };
    centers[attr] = center;
    const w = weights[attr] ?? 0;
    spread += w * half;
    weightSum += w;
    missSum += w * miss;
    missSq += (w * miss) ** 2;
  }
  const ovr = overall(centers, p.position);
  // Misses on different traits partly cancel out in the overall.
  const ovrHalf = (0.6 * spread) / weightSum;
  const ovrLo = Math.max(1, ovr - ovrHalf);
  const ovrHi = Math.min(20, ovr + ovrHalf);
  const ovrSd = ERROR * acc * Math.sqrt(0.36 * (missSum / weightSum) ** 2 + (0.64 * missSq) / weightSum ** 2);

  let potLo = ovrLo;
  let potHi = ovrHi;
  let potMid = ovr;
  let potSd = ovrSd;
  if (p.age < 26) {
    // The younger he is, the more growth is left to guess at; even your own staff can be wrong.
    const room = 26 - p.age;
    const u = (0.5 + 0.35 * room) * (1 - 0.6 * k) * accPot;
    // Overrate him now and you'll overrate his ceiling too.
    const center = p.potential + (ovr - overall(p.ratings, p.position)) + 0.8 * u * zPot;
    potLo = clamp(Math.max(ovr, center - u), 1, 20);
    potHi = clamp(Math.max(potLo, center + u), 1, 20);
    potMid = clamp(Math.max(ovr, center), 1, 20);
    potSd = Math.sqrt(ovrSd ** 2 + (0.8 * u) ** 2);
  }
  return {
    knowledge: k,
    exact,
    ratings,
    ovr,
    ovrLo,
    ovrHi,
    potLo,
    potHi,
    potMid,
    ovrSd,
    potSd,
    accuracy: acc,
    potAccuracy: accPot,
    readerId,
    potReaderId,
  };
}

/**
 * Views for one AI decision pass, computed once each. Nothing a pass does changes a view (knowledge
 * and staff only move between passes), and the cache is thrown away with the pass, so a reloaded
 * save decides exactly the same way.
 */
export function viewCache(league: League): (teamId: number, p: Player) => PlayerView {
  const memo = new Map<number, PlayerView>();
  return (teamId, p) => {
    const key = p.id * 64 + teamId;
    let v = memo.get(key);
    if (!v) memo.set(key, (v = perceive(league, teamId, p)));
    return v;
  };
}

/**
 * How well scouts must know a unit's starters (mean knowledge) before a screen gives its strength as one
 * number. The opposition report uses the same floor before it speaks with confidence.
 */
export const WELL_KNOWN = 0.7;

/** One unit's strength as a club reads it: a best guess with its range, exact for its own players. */
export interface UnitView {
  value: number;
  lo: number;
  hi: number;
  exact: boolean;
  /** The scouts know these starters well enough to give one number. */
  known: boolean;
}

export interface TeamView {
  overall: UnitView;
  qb: UnitView;
  offense: UnitView;
  defense: UnitView;
  special: UnitView;
}

const UNIT_POSITIONS: Record<Exclude<keyof TeamView, 'overall'>, Position[]> = {
  qb: ['QB'],
  offense: ['QB', 'RB', 'WR', 'TE', 'OL'],
  defense: ['DT', 'EDGE', 'LB', 'CB', 'S'],
  special: ['K', 'P'],
};

/**
 * `teamRatings` as `viewerId`'s scouts read the club: the same starters and weights, each starter at his
 * perceived overall in the spot he lines up (knock included), with his range carried along. A club reads
 * its own players exactly. Screens show this, never `teamRatings`, so a rival's strength stays a scouting
 * judgment.
 */
export function perceivedTeamRatings(league: League, viewerId: number, team: Team): TeamView {
  if (viewerId === team.id) {
    const t = teamRatings(league, team);
    const at = (value: number): UnitView => ({ value, lo: value, hi: value, exact: true, known: true });
    return {
      overall: at(t.overall),
      qb: at(t.qb),
      offense: at(t.offense),
      defense: at(t.defense),
      special: at(t.special),
    };
  }
  const unit = (positions: Position[]): UnitView => {
    let value = 0;
    let lo = 0;
    let hi = 0;
    let known = 0;
    let n = 0;
    for (const pos of positions) {
      for (const p of starters(league, team, pos)) {
        const v = perceive(league, viewerId, p);
        const values = {} as Ratings;
        for (const a of ATTRIBUTES) values[a] = v.ratings[a].value;
        const here = (pos === p.position ? v.ovr : overall(values, pos)) - knockFor(p, pos);
        value += here;
        lo += here - (v.ovr - v.ovrLo);
        hi += here + (v.ovrHi - v.ovr);
        known += v.knowledge;
        n++;
      }
    }
    const d = Math.max(1, n);
    return { value: value / d, lo: lo / d, hi: hi / d, exact: false, known: known / d >= WELL_KNOWN };
  };
  const qb = unit(UNIT_POSITIONS.qb);
  const offense = unit(UNIT_POSITIONS.offense);
  const defense = unit(UNIT_POSITIONS.defense);
  const special = unit(UNIT_POSITIONS.special);
  // The headline mixes the units with teamRatings' weights. It is known when offense and defense are (95% of
  // it, the quarterback included): a kicker nobody has scouted shouldn't blur the whole club.
  const mix = (f: (u: UnitView) => number) => f(qb) * 0.2 + f(offense) * 0.35 + f(defense) * 0.4 + f(special) * 0.05;
  return {
    overall: {
      value: mix((u) => u.value),
      lo: mix((u) => u.lo),
      hi: mix((u) => u.hi),
      exact: false,
      known: offense.known && defense.known,
    },
    qb,
    offense,
    defense,
    special,
  };
}

/** Best-guess overall for a table cell. */
export const seenOvr = (league: League, teamId: number, p: Player) => perceive(league, teamId, p).ovr;

/** Spend a scouting visit on a player. Returns his new knowledge level. */
export function scoutPlayer(league: League, playerId: number): number {
  const p = league.players[playerId];
  if (!p || p.retired) throw new Error('No such player');
  if (p.teamId === league.userTeamId) throw new Error('He is already on your roster');
  if (league.scoutPoints <= 0) throw new Error('No scouting visits left this year');
  const k = knowledge(league, league.userTeamId, p);
  const next = Math.round((k + (1 - k) * VISIT_GAIN) * 1000) / 1000;
  league.knowledge[p.id] = next;
  league.scoutPoints--;
  return next;
}

/** New league year: a fresh scouting budget, and no notes kept on players who have retired. */
export function resetScouting(league: League): void {
  league.scoutPoints = SCOUT_POINTS_PER_YEAR;
  for (const id of Object.keys(league.knowledge))
    if (!league.players[Number(id)] || league.players[Number(id)].retired) delete league.knowledge[Number(id)];
}

// ───────── character ─────────

/** Below this much knowledge a front office can't say anything about a player's makeup. */
export const CHARACTER_KNOWLEDGE = 0.5;
/** Error (sd, trait points) in a makeup read at zero knowledge, for a typical reader. */
const CHARACTER_ERROR = 4;
/**
 * The same for injury resistance: a typical department reads a veteran within about two points, a
 * poor one can miss by five (an injury-prone bust who scouts as an ironman), an elite one by one.
 */
export const INJURY_ERROR = 6;

/** A front office's read of a player's hidden makeup, on the traits' 1–20 scale. Engine-only: screens get words. */
export interface CharacterRead extends Traits {
  /** How far off (1 sd) these guesses tend to be. */
  sd: number;
  exact: boolean;
}

/**
 * What `teamId` believes about a player's work ethic, body and temper, or null when it hasn't seen
 * enough of him to say (a scouting visit doubles as the sit-down). The projection scout judges
 * makeup and body; the evaluator sees the flags. Seeded like `perceive`, so a read never changes
 * on refresh and sharpens toward the truth as knowledge grows.
 */
export function characterRead(league: League, teamId: number, p: Player): CharacterRead | null {
  const k = knowledge(league, teamId, p);
  if (k >= 1) return { ...p.traits, sd: 0, exact: true };
  if (k < CHARACTER_KNOWLEDGE) return null;
  const domain: Domain = isProspect(p) ? 'college' : 'pro';
  const staff = league.teams[teamId] ? teamStaff(league, teamId) : null;
  const proj = staff && readFor(staff, domain, FOCUS_OF[p.position], 'projection');
  const evalr = staff && readFor(staff, domain, FOCUS_OF[p.position], 'evaluation');
  // Another club's player is never an open book: even a long career leaves some doubt.
  const miss = Math.max(1 - k, 0.15);
  const sdProj = CHARACTER_ERROR * miss * (proj ? accuracy(proj.rating) : 1);
  const sdEval = CHARACTER_ERROR * miss * (evalr ? accuracy(evalr.rating) : 1);
  // The club's lasting impression, plus each reader's own take.
  const team = new Rng(`${league.seed}:view:${teamId}:${p.id}:char`);
  const projector = new Rng(`${league.seed}:view:${teamId}:${p.id}:char:${proj?.by?.id ?? 0}`);
  const evaluator = new Rng(`${league.seed}:view:${teamId}:${p.id}:temper:${evalr?.by?.id ?? 0}`);
  const guess = (truth: number, sd: number, own: Rng) =>
    clamp(truth + sd * (0.8 * team.normal() + 0.6 * own.normal()), 1, 20);
  const workEthic = guess(p.traits.workEthic, sdProj, projector);
  const durability = guess(p.traits.durability, sdProj, projector);
  const temperament = guess(p.traits.temperament, sdEval, evaluator);
  // Another club's medical file stays closed: how often a body breaks is the hardest thing to see.
  const sdBody = INJURY_ERROR * Math.max(1 - k, 0.3) * (proj ? accuracy(proj.rating) : 1);
  return {
    workEthic,
    durability,
    temperament,
    injuryResistance: guess(p.traits.injuryResistance, sdBody, projector),
    naturalFitness: guess(p.traits.naturalFitness, sdEval, evaluator),
    // Seen in practice and on film when he lines up somewhere new: the evaluator's call.
    versatility: guess(p.traits.versatility, sdEval, evaluator),
    sd: Math.max(sdProj, sdEval),
    exact: false,
  };
}

/**
 * Where a young player is likely to top out, given the work ethic a front office reads in him: a
 * grinder gets more of his ceiling, a coaster less (`npm run careers` measures the real gap).
 */
export function projectedCeiling(ovr: number, ceiling: number, workEthic?: number): number {
  if (workEthic === undefined) return ceiling;
  return ovr + Math.max(0, ceiling - ovr) * clamp(1 + 0.025 * (workEthic - TRAIT_MEAN), 0.75, 1.25);
}

export interface CharacterNote {
  /** What it reads: his makeup (most notes), or how he travels between positions (a football trait, not character). */
  about?: 'versatility';
  label: string;
  tone: 'good' | 'warn';
  /** What it means for him, as a sentence. */
  line: string;
  /** The same, as a clause for the scout's report. */
  clause: string;
}

export interface CharacterNotes {
  /** False when the team hasn't seen enough of him to judge. */
  known: boolean;
  /** True when the read is still early word rather than a settled judgment. */
  hedged: boolean;
  notes: CharacterNote[];
}

const note = (label: string, tone: CharacterNote['tone'], clause: string): CharacterNote => ({
  label,
  tone,
  clause,
  line: `${cap(clause)}.`,
});

/**
 * Words for a makeup read: only what stands out gets a label; an average player gets none. Work
 * ethic speaks to growth while he's young and to how he ages once he's done growing.
 */
export function characterNotes(league: League, teamId: number, p: Player): CharacterNotes {
  const read = characterRead(league, teamId, p);
  if (!read) return { known: false, hedged: false, notes: [] };
  const notes: CharacterNote[] = [];
  const young = p.age < 26;
  const we = read.workEthic;
  if (we >= 16)
    notes.push(
      note(
        'Model pro',
        'good',
        young ? 'a model pro who should reach his ceiling' : 'a model pro who should keep his game longer than most',
      ),
    );
  else if (we >= 13.5)
    notes.push(
      note(
        'Driven',
        'good',
        young ? 'a self-starter who should get the most out of his ability' : 'a self-starter who should age well',
      ),
    );
  else if (we <= 5)
    notes.push(
      note(
        'Needs a push',
        'warn',
        young
          ? 'rarely puts in extra work, so he is unlikely to reach his ceiling'
          : 'rarely puts in extra work, so expect him to age badly',
      ),
    );
  else if (we <= 7.5)
    notes.push(
      note(
        'Coasts',
        'warn',
        young
          ? 'coasts at times, so he may fall short of his ceiling'
          : 'coasts at times, so the decline may hit him harder',
      ),
    );
  if (read.durability >= 14) notes.push(note('Built to last', 'good', 'his body is built to last'));
  else if (read.durability <= 7) notes.push(note('Wears down early', 'warn', 'his body may wear down early'));
  if (TEMPER_POSITIONS.has(p.position)) {
    if (read.temperament <= 7) notes.push(note('Hothead', 'warn', 'has a short fuse, so his line draws more flags'));
    else if (read.temperament >= 14.5)
      notes.push(note('Even-keeled', 'good', 'even-keeled, so he rarely draws a flag'));
  }
  if (read.versatility >= 15)
    notes.push({
      ...note(
        'Plays anywhere',
        'good',
        'versatile enough to cover another position in a pinch, and quick to learn a new one',
      ),
      about: 'versatility',
    });
  else if (read.versatility <= 6)
    notes.push({
      ...note('One-position player', 'warn', 'struggles away from his own position and is slow to learn a new one'),
      about: 'versatility',
    });
  return { known: true, hedged: !read.exact && read.sd > 1.2, notes };
}

// ───────── quirks ─────────

/**
 * What habits are worth to a front office, in overall points: a plus habit adds a little, a bad one
 * costs a little, a style trades one thing for another and counts for nothing. Early word counts
 * half. Capped, so a player is never bought or cut for his habits alone.
 */
const QUIRK_WORTH: Record<QuirkTone, number> = { good: 0.3, bad: -0.3, style: 0 };
const QUIRK_WORTH_CAP = 0.9;
const worthOf = (habits: { tone: QuirkTone; forming: boolean }[]) =>
  clamp(
    habits.reduce((a, h) => a + QUIRK_WORTH[h.tone] * (h.forming ? 0.5 : 1), 0),
    -QUIRK_WORTH_CAP,
    QUIRK_WORTH_CAP,
  );

/** The habits `teamId` has spotted, as overall points (the AI's read: unseen habits count for nothing). */
export const quirkWorth = (league: League, teamId: number, p: Player): number =>
  worthOf(quirkNotes(league, teamId, p).notes);

/** The same from every habit he really has (analysis and tests, never an AI decision about another club's player). */
export const trueQuirkWorth = (p: Player): number =>
  worthOf([
    ...activeQuirks(p).map((id) => ({ tone: QUIRKS[id].tone, forming: false })),
    ...formingQuirks(p).map((id) => ({ tone: QUIRKS[id].tone, forming: true })),
  ]);

/** Habits show on film, so they come out sooner than makeup: below this, a team can't name any. */
export const QUIRK_KNOWLEDGE = 0.35;
/** A habit only starting to show takes a closer look before anyone mentions it. */
const FORMING_KNOWLEDGE = 0.7;

export interface QuirkNote {
  id: QuirkId;
  label: string;
  tone: QuirkTone;
  /** What it means for him, as a sentence. */
  line: string;
  /** Starting to show (or established but crowded out by stronger habits): early word, not a settled one. */
  forming: boolean;
}

export interface QuirkNotes {
  /** False when the team hasn't seen enough of him to name any habit. */
  known: boolean;
  notes: QuirkNote[];
}

/**
 * The habits `teamId` has spotted in a player. Each one surfaces at its own knowledge level (seeded
 * per team, player and quirk, so it never flickers on refresh), anywhere from the film threshold to
 * a fifth above it; one that is only starting to show needs a closer look. Your own players hide
 * nothing.
 */
export function quirkNotes(league: League, teamId: number, p: Player): QuirkNotes {
  const k = knowledge(league, teamId, p);
  if (k < QUIRK_KNOWLEDGE) return { known: false, notes: [] };
  const note = (id: QuirkId, forming: boolean): QuirkNote => {
    const q = QUIRKS[id];
    return { id, label: q.label, tone: q.tone, line: `${cap(q.clause)}. ${q.effect}`, forming };
  };
  const active = activeQuirks(p);
  const forming = formingQuirks(p);
  // A habit he has shaken still shows until this team notices: its scouts go on what they last saw.
  const stale = shakenHabits(league, teamId, p, k).filter(
    (h) => !h.noticed && !active.includes(h.id) && !forming.includes(h.id),
  );
  const notes = [
    ...active.filter((id) => spotted(league, teamId, p, id, k, QUIRK_KNOWLEDGE)).map((id) => note(id, false)),
    ...stale.map((h) => note(h.id, false)),
    ...forming.filter((id) => spotted(league, teamId, p, id, k, FORMING_KNOWLEDGE)).map((id) => note(id, true)),
  ];
  return { known: true, notes };
}

/** Whether `teamId` has caught a habit on film: each one surfaces at its own seeded knowledge level, from `at` to a fifth above it. */
function spotted(league: League, teamId: number, p: Player, id: QuirkId, k: number, at: number): boolean {
  return k >= 1 || k >= at + 0.2 * new Rng(`${league.seed}:view:${teamId}:${p.id}:quirk:${id}`).next();
}

/** Weeks in a league year, near enough (regular season and playoffs; the offseason counts as week 0). */
const WEEKS_PER_YEAR = 22;
/** Weeks a team that barely knows a player goes on believing in a habit he has shaken. */
const LINGER_WEEKS = 30;
const weeksSince = (league: League, e: { season: number; week: number }) =>
  (league.season - e.season) * WEEKS_PER_YEAR + league.week - e.week;

/**
 * Habits a player has shaken that `teamId` had seen, latest first: `noticed` once its scouts have
 * caught on (at once for its own players, within weeks for one it watches closely, most of a year
 * for one it barely knows).
 */
function shakenHabits(league: League, teamId: number, p: Player, k = knowledge(league, teamId, p)) {
  const linger = Math.round(LINGER_WEEKS * (1 - Math.min(1, k)));
  const latest = new Map<QuirkId, { season: number; week: number; change: 'gained' | 'lost' }>();
  for (const e of p.quirkLog ?? []) latest.set(e.id, e);
  return [...latest.entries()]
    .filter(([id, e]) => e.change === 'lost' && spotted(league, teamId, p, id, k, QUIRK_KNOWLEDGE))
    .map(([id, e]) => ({ id, season: e.season, week: e.week, noticed: weeksSince(league, e) >= linger }))
    .sort((a, b) => b.season - a.season || b.week - a.week);
}

export interface HabitChange {
  id: QuirkId;
  label: string;
  tone: QuirkTone;
  change: 'gained' | 'lost';
  season: number;
  /** 0 for the offseason. */
  week: number;
}

/**
 * A player's habits over time as `teamId` knows them, newest first: everything for its own players;
 * for anyone else, the habits its scouts have seen him pick up, and the ones they've noticed he shook.
 */
export function habitTimeline(league: League, teamId: number, p: Player): HabitChange[] {
  const k = knowledge(league, teamId, p);
  if (k < QUIRK_KNOWLEDGE) return [];
  const linger = Math.round(LINGER_WEEKS * (1 - Math.min(1, k)));
  return (p.quirkLog ?? [])
    .filter(
      (e) =>
        spotted(league, teamId, p, e.id, k, QUIRK_KNOWLEDGE) &&
        (e.change === 'gained' || weeksSince(league, e) >= linger),
    )
    .map((e) => ({
      id: e.id,
      label: QUIRKS[e.id].label,
      tone: QUIRKS[e.id].tone,
      change: e.change,
      season: e.season,
      week: e.week,
    }))
    .reverse();
}

/**
 * A change in words that fit the habit and what really happened. The log records a habit becoming
 * established and ceasing to be (grip 2 → 1), so a logged loss means it faded to an emerging habit,
 * not that it vanished: the wording only says "shaken" or "stopped showing" when `gone` says the
 * reader no longer sees it at all. `past` for a dated list ("Late-Hands Specialist became a regular
 * part of his game"), otherwise the perfect for a sentence ("has added …").
 */
export function habitChangeText(
  e: Pick<HabitChange, 'label' | 'tone' | 'change'> & { gone?: boolean },
  past = true,
): string {
  const [pastText, perfect] = {
    gained: {
      good: [`${e.label} became a regular part of his game`, `added ${e.label} to his game`],
      bad: [`${e.label} set in as a bad habit`, `picked up a bad habit (${e.label})`],
      style: [`${e.label} became part of how he plays`, `taken on a new style (${e.label})`],
    },
    lost: {
      good: [
        `${e.label} grew less dependable`,
        e.gone ? `stopped showing ${e.label}` : `grown less consistent with ${e.label}`,
      ],
      bad: [
        `${e.label} became less pronounced`,
        e.gone ? `shaken ${e.label}` : `reined in ${e.label}, though it still shows now and then`,
      ],
      style: [`Leaned away from ${e.label}`, e.gone ? `moved away from ${e.label}` : `leaned away from ${e.label}`],
    },
  }[e.change][e.tone];
  return past ? pastText : perfect;
}

/**
 * The line under a dated change: what the habit is and does once it has set in (from the registry,
 * so the list needs no knowledge of grip), or what a fade means, which is the same for every habit
 * of its kind: still on film, no longer something to count on (or to worry about).
 */
export function habitChangeDetail(e: Pick<HabitChange, 'id' | 'tone' | 'change'>): string {
  const q = QUIRKS[e.id];
  if (e.change === 'gained') return `He ${q.clause}. ${q.effect}`;
  return {
    good: 'It still shows on film now and then, but it is no longer a dependable part of his game.',
    bad: 'It still shows now and then, but it is no longer the problem it was.',
    style: 'He still falls back on it at times, but it no longer defines how he plays.',
  }[e.tone];
}

/** How a card names habits he has left behind, by kind: a bad one fixed, a plus gone quiet, a style dropped. */
export const FIXED_HEADING: Record<QuirkTone, string> = {
  bad: 'Seems to have fixed',
  good: 'No longer shows',
  style: 'Has moved away from',
};

/** Habits `teamId` has noticed he shook in the last year: "seems to have fixed…". */
export function fixedHabits(
  league: League,
  teamId: number,
  p: Player,
): { id: QuirkId; label: string; tone: QuirkTone }[] {
  const now = new Set([...activeQuirks(p), ...formingQuirks(p)]);
  return shakenHabits(league, teamId, p)
    .filter((h) => h.noticed && !now.has(h.id) && weeksSince(league, h) < WEEKS_PER_YEAR)
    .map((h) => ({ id: h.id, label: QUIRKS[h.id].label, tone: QUIRKS[h.id].tone }));
}

/**
 * The last age at which a family of a player's ratings is still at its best, for the body `teamId`
 * reads in him (a typical one when it can't tell). Development runs before his birthday and only
 * cuts ratings once he is past the onset, so the ratings he carries at the onset year plus one are
 * still intact; the first drop shows the season after.
 */
function lastGoodAge(league: League, teamId: number, p: Player, family: AgingFamily): number {
  const read = characterRead(league, teamId, p);
  const body = read ? { durability: read.durability } : undefined;
  return Math.floor(declineOnset(p.position, family, body)) + 1;
}

/** When `teamId` expects a player to start fading, in words. */
export function careerOutlook(league: League, teamId: number, p: Player): string {
  const read = characterRead(league, teamId, p);
  const sure = read && (read.exact || read.sd <= 1.2) ? 'about' : 'roughly';
  const tech = lastGoodAge(league, teamId, p, 'technical');
  const phys = lastGoodAge(league, teamId, p, 'physical');
  const { legs, skills, plural } = bodyWords(p.position);
  if (p.age > tech) return 'Past his prime: expect him to lose a little more every year.';
  if (p.age > phys)
    return `${cap(legs)} ${plural ? 'have' : 'has'} started to fade; ${skills} should hold up through ${sure} ${tech}.`;
  if (phys < tech)
    return `${cap(legs)} should start to fade after ${sure} ${phys}; ${skills} should hold up through ${sure} ${tech}.`;
  if (p.age === tech) return 'In the last year of his prime: expect the decline to start next year.';
  return `Prime through ${sure} ${tech}.`;
}
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

/**
 * What ages first and what lasts, in a position's own words: a quarterback's legs go before his arm
 * and his reads, a kicker's range before his accuracy, everyone else's physical tools before their
 * technique. The same words everywhere a screen talks about his body clock.
 */
function bodyWords(pos: Position): { legs: string; skills: string; plural: boolean } {
  if (pos === 'QB') return { legs: 'his legs', skills: 'his arm and his reads', plural: true };
  if (pos === 'K' || pos === 'P') return { legs: 'his range', skills: 'his accuracy', plural: false };
  return { legs: 'his physical tools', skills: 'his technique', plural: true };
}

/**
 * A young player of `teamId`'s whom its scouts still see real growth in, but who has barely played
 * in `season`: snaps would speed his development (and sitting slows it).
 */
export function needsReps(league: League, teamId: number, p: Player, season: number): boolean {
  if (p.teamId !== teamId || p.age > 25) return false;
  // Already in the starting lineup: the reps are coming.
  // (Wherever he's lined up: a youngster starting out of position is getting his snaps.)
  const at = slotOf(league, p);
  const slot = league.teams[teamId].depthChart[at].indexOf(p.id);
  if (slot >= 0 && slot < STARTERS[at]) return false;
  // A rookie looking back at last season was still in college.
  if (season < league.season && p.experience === 0) return false;
  const share = repsSoFar(league, p, season);
  if (share === null || share >= 0.35) return false;
  const view = perceive(league, teamId, p);
  return view.potMid - view.ovr >= 1.5;
}

// ───────── stars ─────────

interface Reference {
  /** True overalls at each position, ascending: every rostered player, starters only, backups only. */
  curves: Record<Position, number[]>;
  starters: Record<Position, number[]>;
  backups: Record<Position, number[]>;
  /** Average starter rating at each position, per attribute. */
  starterAvg: Record<Position, Ratings>;
}

const refCache = new WeakMap<League, { key: string; ref: Reference }>();

/** League-wide reference distributions, rebuilt when the league moves on. */
function reference(league: League): Reference {
  const last = league.transactions.at(-1);
  const key = `${league.season}|${league.phase}|${league.week}|${league.faDay}|${league.nextPlayerId}|${league.transactions.length}|${last?.text ?? ''}`;
  const hit = refCache.get(league);
  if (hit && hit.key === key) return hit.ref;
  const empty = () => Object.fromEntries(POSITIONS.map((pos) => [pos, [] as number[]])) as Record<Position, number[]>;
  const [curves, starterCurves, backups] = [empty(), empty(), empty()];
  const starterAvg = {} as Record<Position, Ratings>;
  for (const pos of POSITIONS) {
    // The position's own starters: a man lined up there out of position doesn't set its bar.
    const starters = league.teams.flatMap((t) =>
      t.depthChart[pos]
        .slice(0, STARTERS[pos])
        .map((id) => league.players[id])
        .filter((x) => x && x.position === pos),
    );
    starterAvg[pos] = Object.fromEntries(
      ATTRIBUTES.map((a) => [a, starters.reduce((s, p) => s + p.ratings[a], 0) / Math.max(1, starters.length)]),
    ) as Ratings;
    for (const p of starters) starterCurves[pos].push(overall(p.ratings, pos));
  }
  const starterIds = new Set(
    league.teams.flatMap((t) => POSITIONS.flatMap((pos) => t.depthChart[pos].slice(0, STARTERS[pos]))),
  );
  for (const p of Object.values(league.players)) {
    if (p.teamId === null || p.retired) continue;
    const ovr = overall(p.ratings, p.position);
    curves[p.position].push(ovr);
    if (!starterIds.has(p.id)) backups[p.position].push(ovr);
  }
  for (const c of [...Object.values(curves), ...Object.values(starterCurves), ...Object.values(backups)])
    c.sort((a, b) => a - b);
  const ref = { curves, starters: starterCurves, backups, starterAvg };
  refCache.set(league, { key, ref });
  return ref;
}

/** Share of an ascending curve below `value` (0–1). */
function percentile(curve: number[], value: number): number {
  if (!curve.length) return 0.5;
  let lo = 0;
  let hi = curve.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (curve[mid] < value) lo = mid + 1;
    else hi = mid;
  }
  return lo / curve.length;
}

/** Share of the league's rostered players at `pos` rated below `value` (0–1). */
export const leaguePercentile = (league: League, pos: Position, value: number) =>
  percentile(reference(league).curves[pos], value);

/** 0–4 in half steps: nine levels, each about an eighth of the league at the position. */
const toStars = (x: number) => clamp(Math.round(x * 2) / 2, 0, 4);

export type StarScale = 'league' | 'roster';

export interface StarRating {
  /** Current ability, 0–4 in half stars. */
  ability: number;
  /** Projected ceiling range on the same scale. */
  potLo: number;
  potHi: number;
  /** What the stars are measured against, for the label on screen. */
  basis: string;
}

/**
 * Stars relative to a reference group. `league` compares with every rostered player at the
 * position ("is he good?"); `roster` compares with the viewing team's starters there ("does he
 * start for me?": 3 stars is your starters' level, each rating point is half a star).
 */
export function starRating(
  league: League,
  teamId: number,
  p: Player,
  view: PlayerView,
  scale: StarScale = 'league',
): StarRating {
  const pos = p.position;
  if (scale === 'roster') {
    const team = league.teams[teamId];
    const mine = team.depthChart[pos]
      .slice(0, STARTERS[pos])
      .map((id) => league.players[id])
      .filter((x) => x && x.position === pos);
    const avg = mine.length ? mine.reduce((s, x) => s + overall(x.ratings, pos), 0) / mine.length : 10;
    const rel = (v: number) => toStars(3 + 0.5 * (v - avg));
    return {
      ability: rel(view.ovr),
      potLo: rel(view.potLo),
      potHi: rel(view.potHi),
      basis: `vs your starting ${pos}${STARTERS[pos] > 1 ? 's' : ''}`,
    };
  }
  const rel = (v: number) => toStars(leaguePercentile(league, pos, v) * 4);
  return {
    ability: rel(view.ovr),
    potLo: rel(view.potLo),
    potHi: rel(view.potHi),
    basis: `vs every ${pos} in the league`,
  };
}

// ───────── production ─────────

/**
 * How a scout reads a season's line at each position: the one rate that says how he played
 * (`measure`; `lowIsGood` for a blocker's pressures allowed), how much of the season it takes to
 * mean anything (`enough`), what tells a starter's line from a backup's (`volume`, for the league's
 * reference group), the gap that counts as a clear step above or below a league-average starter
 * (`step`), and the words for the line itself.
 */
interface Production {
  measure: (s: StatLine) => number;
  lowIsGood?: boolean;
  /** A low measure says nothing (a corner nobody throws at), so only a high one is reported. */
  onlyGood?: boolean;
  enough: (s: StatLine) => boolean;
  volume: (s: StatLine) => number;
  step: number;
  words: (s: StatLine) => string;
}
const perGame = (s: StatLine, k: keyof StatLine) => ((s[k] as number | undefined) ?? 0) / Math.max(1, s.gp ?? 0);
const n = (s: StatLine, k: keyof StatLine) => (s[k] as number | undefined) ?? 0;
const big = (x: number) => x.toLocaleString('en-US');
const pl = (x: number, word: string) => `${x} ${word}${x === 1 ? '' : 's'}`;
const PRODUCTION: Partial<Record<Position, Production>> = {
  QB: {
    measure: passerRating,
    enough: (s) => (s.gp ?? 0) >= 6 && n(s, 'passAtt') >= 14 * (s.gp ?? 0),
    volume: (s) => n(s, 'passAtt'),
    step: 6,
    words: (s) =>
      `threw for ${big(n(s, 'passYds'))} yards, ${pl(n(s, 'passTd'), 'touchdown')} and ${pl(n(s, 'passInt'), 'pick')} in ${n(s, 'gp')} games`,
  },
  RB: {
    measure: (s) => n(s, 'rushYds') / Math.max(1, n(s, 'rushAtt')),
    enough: (s) => (s.gp ?? 0) >= 6 && n(s, 'rushAtt') >= 8 * (s.gp ?? 0),
    volume: (s) => n(s, 'rushAtt'),
    step: 0.35,
    words: (s) =>
      `ran for ${big(n(s, 'rushYds'))} yards at ${(n(s, 'rushYds') / Math.max(1, n(s, 'rushAtt'))).toFixed(1)} a carry`,
  },
  WR: {
    measure: (s) => perGame(s, 'recYds'),
    enough: (s) => (s.gp ?? 0) >= 6 && n(s, 'rec') >= 2 * (s.gp ?? 0),
    volume: (s) => n(s, 'rec'),
    step: 15,
    words: (s) =>
      `caught ${pl(n(s, 'rec'), 'pass').replace('passs', 'passes')} for ${big(n(s, 'recYds'))} yards and ${pl(n(s, 'recTd'), 'touchdown')}`,
  },
  OL: {
    measure: (s) => perGame(s, 'pressuresAllowed') + perGame(s, 'sacksAllowed'),
    lowIsGood: true,
    enough: (s) => (s.gp ?? 0) >= 8,
    volume: (s) => n(s, 'gp'),
    step: 0.5,
    words: (s) =>
      `gave up ${pl(n(s, 'sacksAllowed'), 'sack')} and ${pl(n(s, 'pressuresAllowed'), 'pressure')} in ${n(s, 'gp')} games`,
  },
  DT: {
    measure: (s) => perGame(s, 'pressures'),
    enough: (s) => (s.gp ?? 0) >= 8,
    volume: (s) => n(s, 'pressures') + n(s, 'tackles'),
    step: 0.6,
    words: (s) =>
      `had ${n(s, 'sacks') % 1 ? n(s, 'sacks').toFixed(1) : n(s, 'sacks')} sack${n(s, 'sacks') === 1 ? '' : 's'} and ${pl(n(s, 'pressures'), 'pressure')}`,
  },
  LB: {
    measure: (s) => perGame(s, 'tackles'),
    enough: (s) => (s.gp ?? 0) >= 8,
    volume: (s) => n(s, 'tackles'),
    step: 1.2,
    words: (s) => `made ${pl(n(s, 'tackles'), 'tackle')}, ${n(s, 'tfl')} of them for loss`,
  },
  CB: {
    measure: (s) => perGame(s, 'passDef') + perGame(s, 'defInt'),
    enough: (s) => (s.gp ?? 0) >= 8,
    volume: (s) => n(s, 'passDef') + n(s, 'defInt') + n(s, 'tackles') / 4,
    step: 0.25,
    // A quiet line can mean nobody threw his way: the ball production only ever speaks for him, never against.
    onlyGood: true,
    words: (s) =>
      `had ${pl(n(s, 'defInt'), 'pick')} and ${n(s, 'passDef')} pass${n(s, 'passDef') === 1 ? '' : 'es'} defended`,
  },
  K: {
    measure: (s) => n(s, 'fgMade') / Math.max(1, n(s, 'fgAtt')),
    enough: (s) => n(s, 'fgAtt') >= 12,
    volume: (s) => n(s, 'fgAtt'),
    step: 0.05,
    words: (s) => `hit ${n(s, 'fgMade')} of ${n(s, 'fgAtt')} field goals`,
  },
  P: {
    measure: (s) => n(s, 'puntYds') / Math.max(1, n(s, 'punts')),
    enough: (s) => n(s, 'punts') >= 20,
    volume: (s) => n(s, 'punts'),
    step: 1.5,
    words: (s) => `averaged ${(n(s, 'puntYds') / Math.max(1, n(s, 'punts'))).toFixed(1)} yards a punt`,
  },
};
PRODUCTION.TE = PRODUCTION.WR;
PRODUCTION.EDGE = PRODUCTION.DT;
PRODUCTION.S = PRODUCTION.CB;

interface SeasonReference {
  /** A league-average starter's measure. */
  measure: number;
  /** A league-average starter's scrimmage snaps (null for a season before the count was kept, and for kickers). */
  snaps: number | null;
  /** A league-average starter's volume stat, the stand-in for snaps where there are none. */
  volume: number;
}
const productionCache = new WeakMap<League, { season: number; ref: Partial<Record<Position, SeasonReference>> }>();

/** A league-average starter at each position last season: the league's starting-sized group by snaps (or volume), averaged. */
function productionReference(league: League, season: number): Partial<Record<Position, SeasonReference>> {
  const hit = productionCache.get(league);
  if (hit && hit.season === season) return hit.ref;
  const lines: Partial<Record<Position, StatLine[]>> = {};
  for (const p of Object.values(league.players)) {
    const s = p.stats[season];
    if (s && PRODUCTION[p.position] && (s.gp ?? 0) > 0) (lines[p.position] ??= []).push(s);
  }
  const ref: Partial<Record<Position, SeasonReference>> = {};
  for (const pos of POSITIONS) {
    const rule = PRODUCTION[pos];
    if (!rule) continue;
    const all = lines[pos] ?? [];
    const counted = all.some((s) => s.snaps !== undefined);
    const size = (s: StatLine) => (counted ? (s.snaps ?? 0) : rule.volume(s));
    const group = [...all].sort((a, b) => size(b) - size(a)).slice(0, league.teams.length * STARTERS[pos]);
    const judged = group.filter((s) => rule.enough(s));
    if (judged.length < 8) continue;
    const mean = (f: (s: StatLine) => number, xs: StatLine[]) => xs.reduce((t, s) => t + f(s), 0) / xs.length;
    ref[pos] = {
      measure: mean(rule.measure, judged),
      snaps: counted ? mean((s) => s.snaps ?? 0, group) : null,
      volume: mean(rule.volume, group),
    };
  }
  productionCache.set(league, { season, ref });
  return ref;
}

export type SeasonRole = 'starter' | 'rotation' | 'backup';

/**
 * What a player was last season, by his scrimmage snaps against a league-average starter's at his
 * position (his volume stat where no snaps were kept): a starter from three-fifths of them, a
 * rotation player from a fifth, a backup below that. Null when he didn't play.
 */
export function seasonRole(
  league: League,
  p: Player,
  season = league.season - 1,
): { role: SeasonRole; share: number } | null {
  const s = p.stats[season];
  const rule = PRODUCTION[p.position];
  const ref = productionReference(league, season)[p.position];
  if (!s || !rule || !ref || !(s.gp ?? 0)) return null;
  const share =
    ref.snaps !== null && s.snaps !== undefined
      ? s.snaps / Math.max(1, ref.snaps)
      : rule.volume(s) / Math.max(1e-9, ref.volume);
  return { role: share >= 0.6 ? 'starter' : share >= 0.2 ? 'rotation' : 'backup', share };
}

/** How his overall has moved since a league year, in words, or null when it hasn't moved enough to say (most of a point). */
export function growthSince(p: Player, season: number): string | null {
  const then = p.ratingHistory?.[season];
  if (!then) return null;
  const ratings = Object.fromEntries(ATTRIBUTES.map((a, i) => [a, then[i]])) as Ratings;
  const delta = overall(p.ratings, p.position) - overall(ratings, p.position);
  return delta >= 1.2
    ? 'taken a real step'
    : delta >= 0.7
      ? 'come on a little'
      : delta <= -1.2
        ? 'slipped noticeably'
        : delta <= -0.7
          ? 'slipped a little'
          : null;
}

/**
 * The one sentence on last season worth a contract decision, or none: a starter's line only when it
 * stood out either way ("Last season he threw for 3,912 yards, 24 touchdowns and 9 picks in 16
 * games, above a league-average starter."), a rotation player's role and line, a backup's growth
 * since if he has grown, and nothing for an ordinary year. Box scores are public, so every team
 * reads the same; the growth is the development chart's, which the card already shows.
 */
export function seasonNote(league: League, p: Player): string | null {
  const season = league.season - 1;
  const grown = growthSince(p, season);
  const s = p.stats[season];
  const rule = PRODUCTION[p.position];
  const ref = productionReference(league, season)[p.position];
  const played = seasonRole(league, p, season);
  if (!s || !rule || !ref || !played) return grown ? `He has ${grown} since last season.` : null;
  const gap = ((rule.measure(s) - ref.measure) / rule.step) * (rule.lowIsGood ? -1 : 1);
  const who = p.position === 'K' ? 'kicker' : p.position === 'P' ? 'punter' : 'starter';
  if (played.role === 'starter') {
    if (!rule.enough(s)) return grown ? `He has ${grown} since last season.` : null;
    // A starter's line is news only when it stood well clear of the average: a step and a half either way.
    if (gap >= 2.5) return `Last season he ${rule.words(s)}, well above a league-average ${who}.`;
    if (gap >= 1.5) return `Last season he ${rule.words(s)}, above a league-average ${who}.`;
    if (gap <= -2.5 && !rule.onlyGood) return `Last season he ${rule.words(s)}, well below a league-average ${who}.`;
    if (gap <= -1.5 && !rule.onlyGood) return `Last season he ${rule.words(s)}, below a league-average ${who}.`;
    return grown ? `Nothing unusual in his line last season, but he has ${grown} since.` : null;
  }
  if (played.role === 'rotation')
    return `A rotation player last season (${rule.words(s)})${gap >= 1.5 ? ", at a starter's rate" : ''}${grown ? `, and he has ${grown} since` : ''}.`;
  return grown ? `He barely saw the field last season, but he has ${grown} since.` : null;
}

// ───────── scout report ─────────

/** Where an overall would rank in the league: among its starters, or else among its backups. */
interface Tier {
  /** Verdict adjective ("A solid starting cornerback"). */
  role: string;
  /** What he could become ("he could become a solid starter"). */
  becomes: string;
}
const TIERS: Tier[] = [
  { role: 'An elite', becomes: 'an elite player' },
  { role: 'A high-end starting', becomes: 'a high-end starter' },
  { role: 'A solid starting', becomes: 'a solid starter' },
  { role: 'A fringe starting', becomes: 'a fringe starter' },
  { role: 'A quality backup', becomes: 'a quality backup' },
  { role: 'A depth', becomes: 'a depth player' },
  { role: 'A camp-body', becomes: 'a camp body' },
];

function tierOf(league: League, pos: Position, ovr: number): number {
  const ref = reference(league);
  const sp = percentile(ref.starters[pos], ovr);
  if (sp >= 0.9) return 0;
  if (sp >= 0.6) return 1;
  if (sp >= 0.3) return 2;
  if (sp >= 0.08) return 3;
  const bp = percentile(ref.backups[pos], ovr);
  return bp >= 0.5 ? 4 : bp >= 0.15 ? 5 : 6;
}

/** Habits as one sentence, each with its own "he" ("he X, he Y, and he Z"): a clause can carry commas of its own. */
const clauses = (items: string[]) =>
  items.length > 1 ? `${items.slice(0, -1).join(', he ')}, and he ${items.at(-1)}` : items.join('');
const list = (items: string[]) =>
  items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
const lowerFirst = (s: string) => s[0].toLowerCase() + s.slice(1);

/**
 * How a scout names a trait in a sentence ("his deep ball", "his hands are"). The registry's trait
 * names are for a ratings sheet; a report says "arm", not "arm strength". The same rating means
 * different things by position: a quarterback's awareness is his decision-making, a lineman's his
 * recognition, a defender's his instincts.
 */
const TRAIT_WORDS: Partial<Record<Attribute, string>> = {
  throwPower: 'arm',
  throwAccDeep: 'deep ball',
  kickPower: 'leg',
  passRush: 'pass rush',
  elusiveness: 'elusiveness',
};
/** Trait words that take a plural verb ("his hands are", "his instincts are"). */
const PLURAL_WORDS = new Set(['hands', 'instincts']);
function traitWords(a: Attribute, pos: Position): string {
  if (a === 'awareness')
    return pos === 'QB'
      ? 'decision-making'
      : pos === 'OL'
        ? 'recognition'
        : ['RB', 'WR', 'TE'].includes(pos)
          ? 'feel for the game'
          : 'instincts';
  return TRAIT_WORDS[a] ?? ATTRIBUTE_INFO[a].trait;
}

/** A scout's report in its parts, so a card can set the verdict apart from the rest. */
export interface ScoutReport {
  /** The one sentence that says what he is: his standing today and where he is headed. */
  verdict: string;
  /** His game: what sets him apart and what holds him back, then his projection or his body clock. */
  game: string[];
  /** The rest of what the staff has seen: a habit or his makeup, how sure the read is, what he wants. */
  notes: string[];
}

/** The tone a report leads with when it has to pick between a player's habits: a flaw first, then a plus, then a style. */
const HABIT_ORDER: Record<QuirkTone, number> = { bad: 0, good: 1, style: 2 };

/**
 * A scout's report: one judgment with a few observations behind it, written only from what
 * `teamId` can see. The verdict says what he is and where he is going; one sentence picks his most
 * consequential strength and concern; one gives his projection (young) or his body clock as the
 * scouts read it (a typical one when they can't tell yet). Then the one or two most telling things
 * about his habits or makeup (the card's pills carry the full list), how far to trust the grades
 * when that matters, and his priorities when they are no secret.
 */
export function scoutReportParts(league: League, teamId: number, p: Player): ScoutReport {
  const view = perceive(league, teamId, p);
  const pos = p.position === 'OL' ? 'offensive lineman' : POSITION_NAMES[p.position].toLowerCase();
  const now = tierOf(league, p.position, view.ovr);
  const ceiling = tierOf(league, p.position, view.potHi);
  const young = p.age < 26;
  // Growth that won't change his standing still matters to a contract: say so when there is some.
  const growing = young && ceiling >= now && view.potHi - view.ovr >= 1.5;
  const ovrHalf = (view.ovrHi - view.ovrLo) / 2;
  // A wide range is said up front, where it colours the verdict, not just in a footnote.
  const rough = !view.exact && ovrHalf > 1.1;
  const tech = lastGoodAge(league, teamId, p, 'technical');
  const phys = lastGoodAge(league, teamId, p, 'physical');
  const { legs, skills, plural } = bodyWords(p.position);
  const read = characterRead(league, teamId, p);
  const sure = read && (read.exact || read.sd <= 1.2) ? 'about' : 'roughly';

  // Traits that count at his position, measured against the league's starters there: the one that
  // sets him apart (two if both are elite) and the one that holds him back most.
  const avg = reference(league).starterAvg[p.position];
  const weights = OVR_WEIGHTS[p.position];
  const traits = (Object.keys(weights) as Attribute[]).map((a) => ({
    a,
    diff: view.ratings[a].value - avg[a],
    w: weights[a]!,
  }));
  const pluses = traits.filter((t) => t.diff >= 2).sort((x, y) => y.diff * y.w - x.diff * x.w);
  const plus = pluses.slice(0, pluses.length > 1 && pluses[1].diff >= 4 ? 2 : 1);
  const minus = traits.filter((t) => t.diff <= -3 && t.w >= 1).sort((x, y) => x.diff * x.w - y.diff * y.w)[0];
  // Short of the starters' bar, a player still has a shape: what he does best and worst for his level.
  const rel = traits.map((t) => ({ ...t, rel: view.ratings[t.a].value - view.ovr }));
  const best = [...rel]
    .sort((x, y) => y.rel - x.rel || y.w - x.w)
    .find((t) => t.rel >= 1 && !plus.some((x) => x.a === t.a));
  const worst = [...rel]
    .filter((t) => t.w >= 1 && t.a !== minus?.a)
    .sort((x, y) => x.rel - y.rel || y.w - x.w)
    .find((t) => t.rel <= -1.5);
  const name = (t: { a: Attribute }) => traitWords(t.a, p.position);
  const many = (ts: { a: Attribute }[]) => ts.length > 1 || PLURAL_WORDS.has(name(ts[0]));
  const is = (t: { a: Attribute }) => (many([t]) ? 'are' : 'is');
  const praise = plus[0]?.diff >= 4 ? 'elite' : plus.length > 1 ? 'real strengths' : 'a real strength';
  // A pocket passer's legs were never part of his game, so their fading is no part of his outlook:
  // his clock is his arm and his reads. A quarterback who runs is read like everyone else.
  const legsMatter = p.position !== 'QB' || traits.some((t) => (t.a === 'speed' || t.a === 'agility') && t.diff >= 1.5);
  const fading = !young && legsMatter && p.age > phys && p.age <= tech;
  // One of a few reviewed wordings, seeded by the player: the same report on every refresh, and no
  // two cards in a row reading like a form letter.
  const rng = new Rng(`${league.seed}:report:${p.id}`);
  const pick = (...xs: string[]) => xs[rng.int(0, xs.length - 1)];

  const arc = young
    ? ceiling < now
      ? ` with the upside of ${TIERS[ceiling].becomes}`
      : growing
        ? ' with room still to grow'
        : ', and already close to his ceiling'
    : p.age > tech
      ? pick(' on the downslope', ' past his best', ' in decline')
      : fading
        ? pick(` whose value now rests on ${skills}`, ` living on ${skills} now`)
        : p.age >= tech - 1
          ? pick(' nearing the end of his best years', ' with a year or two of his prime left')
          : pick(' in his prime', ' in his best years', ' in the middle of his prime');
  const verdict = `${rough ? `On limited looks, ${lowerFirst(TIERS[now].role)}` : TIERS[now].role} ${pos}${arc}.`;

  const produced = seasonNote(league, p);
  const strongest = (t: { a: Attribute }) =>
    pick(
      `His ${name(t)} ${is(t)} the best of what he has`,
      `${cap(name(t))} ${is(t)} his strongest suit`,
      `His ${name(t)} ${is(t)} where he is strongest`,
    );
  const game: string[] = [];
  if (plus.length && minus)
    game.push(
      `His ${list(plus.map(name))} ${many(plus) ? 'are' : 'is'} ${praise}, but his ${name(minus)} ${many([minus]) ? 'remain' : 'remains'} the main concern.`,
    );
  else if (plus.length)
    game.push(
      `His ${list(plus.map(name))} ${many(plus) ? 'are' : 'is'} ${praise}${worst ? `; his ${name(worst)} ${is(worst)} the softest part of his game` : ', and there is no glaring hole in his game'}.`,
    );
  else if (minus)
    game.push(
      `${best ? `${strongest(best)}, but his` : 'Nothing in his game stands out, and his'} ${name(minus)} ${is(minus)} a real concern.`,
    );
  else if (best && worst) game.push(`${strongest(best)}; his ${name(worst)} ${is(worst)} where he falls shortest.`);
  else if (best) game.push(`${strongest(best)}, and nothing in his game is a liability.`);
  else if (worst) game.push(`Nothing jumps out, but his ${name(worst)} ${is(worst)} the softest part of his game.`);
  else game.push('A balanced set: no one trait carries him, and none holds him back.');
  if (young) {
    // Growth ends at 26: a player of 25 with a tier still to climb has one year left to climb it.
    if (ceiling < now) {
      const could = pick(
        `With reps he could grow into ${TIERS[ceiling].becomes}`,
        `Given snaps he could become ${TIERS[ceiling].becomes}`,
        `There is ${TIERS[ceiling].becomes} in him if he develops`,
      );
      const soon = p.age === 25;
      const how = minus
        ? `; how quickly depends on his ${name(minus)} coming along${soon ? ', and at 25 it has to come soon' : ''}`
        : soon
          ? ', though at 25 what growth is left has to come soon'
          : '';
      game.push(`${could}${how}.`);
    } else if (growing)
      game.push(
        `He should keep improving for a few years yet${minus ? `, ${name(minus)} first of all` : ''}, without it changing what he is.`,
      );
    else game.push('Most of his value is in what he does today rather than a projected leap.');
  } else if (p.age > tech)
    game.push(
      pick(
        `At ${p.age}, expect him to lose a little more every year.`,
        `At ${p.age} the decline is under way: budget for a little less each season.`,
        `Every year from here takes something; at ${p.age} that is the deal.`,
      ),
    );
  else if (fading && p.age === tech)
    game.push(
      pick(
        `${cap(legs)} ${plural ? 'have' : 'has'} begun to fade, but ${skills} should hold this year; expect the rest to follow next year.`,
        `The athleticism is going first; ${skills} should hold this year, and from ${tech + 1} on expect a little less each season.`,
      ),
    );
  else if (fading)
    game.push(
      pick(
        `${cap(legs)} ${plural ? 'have' : 'has'} begun to fade, but ${skills} should hold up through ${sure} ${tech}.`,
        `The athleticism is going first; ${skills} should carry him through ${sure} ${tech}.`,
      ),
    );
  else if (p.age === tech)
    game.push(
      pick(
        'This is the last year of his prime: expect the decline to start next year.',
        `${cap(skills)} should hold this year; from ${tech + 1} on, expect a little less each season.`,
      ),
    );
  // In his prime, his body clock is the Development section's business (it says when it turns); the
  // report has nothing to warn about, so the slot goes to last season, when it says something.
  if (produced && game.length < 3) game.push(produced);

  const notes: string[] = [];
  // His habits, as far as we know them, in at most two sentences: what has changed this year is news,
  // so a habit he picked up lately is told as news rather than listed twice; of the rest, the two
  // settled ones that matter most (a flaw before a plus, a plus before a style); then, with a sentence
  // to spare, the most telling of those only starting to show (three when they are all there is).
  const habits = quirkNotes(league, teamId, p).notes;
  const seen = new Set(habits.map((n) => n.id));
  const changes = new Map<QuirkId, HabitChange>();
  for (const e of habitTimeline(league, teamId, p))
    if (weeksSince(league, e) < WEEKS_PER_YEAR && !changes.has(e.id)) changes.set(e.id, e);
  const lately = [...changes.values()].slice(0, 2);
  const settled = habits
    .filter((n) => !n.forming && !changes.has(n.id))
    .sort((a, b) => HABIT_ORDER[a.tone] - HABIT_ORDER[b.tone])
    .slice(0, 2);
  const settledSaid = settled.length > 0;
  const forming = habits
    .filter((n) => n.forming)
    .sort((a, b) => HABIT_ORDER[a.tone] - HABIT_ORDER[b.tone])
    .slice(0, settledSaid ? 2 : 3);
  // A loss the reader still sees traces of is a fade; one he sees nothing of any more is gone.
  const change = (e: HabitChange) => habitChangeText({ ...e, gone: !seen.has(e.id) }, false);
  const gained = lately.filter((e) => e.change === 'gained').map(change);
  const lost = lately.filter((e) => e.change === 'lost').map(change);
  const exact = knowledge(league, teamId, p) >= 1;
  if (settled.length) notes.push(`On film he ${clauses(settled.map((n) => QUIRKS[n.id].clause))}.`);
  if (gained.length || lost.length) {
    // Hedged unless it's our own player: we only think he has left a habit behind.
    const parts = [
      gained.length ? `has ${list(gained)}` : '',
      lost.length ? `${exact ? 'has' : 'seems to have'} ${list(lost)}` : '',
    ].filter(Boolean);
    notes.push(`Lately he ${parts.join(', and ')}.`);
  }
  if (notes.length < 2 && forming.length)
    notes.push(`Starting to show: he ${clauses(forming.map((n) => QUIRKS[n.id].clause))}.`);
  // Makeup, once the staff has seen enough of him: the two notes that matter most (the pills carry the rest).
  // Versatility is a football trait: it is said with what he is (the verdict), not with his makeup.
  const makeup = characterNotes(league, teamId, p);
  const character = makeup.notes.filter((n) => !n.about).slice(0, 2);
  const versatile = makeup.notes.find((n) => n.about === 'versatility');
  if (character.length)
    notes.push(
      `${makeup.hedged ? 'Early word on his makeup' : 'Makeup'}: ${character.map((n) => n.clause).join('; ')}.`,
    );

  // How far to trust the grades, when that is in question: film, visits and who's doing the reading.
  // Our own player's game is known; his ceiling is worth a word only when the scouts' range on it is wide.
  if (view.exact) {
    if (young && view.potHi - view.potLo >= 1.5)
      notes.push('We know his game; how high he goes is still our scouts’ guess.');
  } else if (ovrHalf <= 0.5) notes.push('Plenty of film on him: this read is reliable.');
  else if (ovrHalf <= 1.1) notes.push('Decent film on him, but these grades could be a point or two off.');
  else
    notes.push(
      `Our read is still provisional: more film${teamId === league.userTeamId && league.scoutPoints > 0 ? ' or a scouting visit' : ''} would narrow these grades.`,
    );

  // Agents and teammates talk: a well-known player's priorities are no secret.
  if (view.knowledge >= 0.7) {
    const { greed, loyalty, winning } = p.personality;
    const top = Math.max(greed, loyalty, winning);
    if (top > 0.8)
      notes.push(
        top === greed
          ? 'His agent drives a hard bargain.'
          : top === loyalty
            ? 'Values loyalty: open to a hometown discount.'
            : 'Wants to play for a contender.',
      );
  }
  const said = versatile
    ? `${verdict.slice(0, -1)}, ${versatile.tone === 'good' ? 'who can play anywhere' : 'at his best at his own position'}.`
    : verdict;
  return { verdict: said, game, notes };
}

/** The report as a list of sentences, verdict first. */
export function scoutReport(league: League, teamId: number, p: Player): string[] {
  const r = scoutReportParts(league, teamId, p);
  return [r.verdict, ...r.game, ...r.notes];
}

// ───────── combine ─────────

/** An average NFL starter's combine at each position: [40, bench, vertical, broad, shuttle, 3-cone]. */
export const COMBINE_TYPICAL: Record<Exclude<Position, 'K' | 'P'>, [number, number, number, number, number, number]> = {
  QB: [4.8, 0, 31, 112, 4.35, 7.05],
  RB: [4.52, 20, 35, 121, 4.25, 7.0],
  WR: [4.48, 14, 36, 124, 4.2, 6.9],
  TE: [4.7, 20, 33.5, 117, 4.35, 7.15],
  OL: [5.25, 27, 28, 104, 4.65, 7.75],
  DT: [5.05, 28, 29.5, 107, 4.6, 7.65],
  EDGE: [4.75, 24, 34, 119, 4.4, 7.15],
  LB: [4.68, 22, 34.5, 119, 4.28, 7.05],
  CB: [4.47, 14, 37, 125, 4.18, 6.95],
  S: [4.55, 16, 36.5, 123, 4.2, 6.95],
};

const round = (x: number, step: number) => Math.round(x / step) * step;

/**
 * Measurables and drills, driven by the true physical ratings plus noise, so the combine is
 * evidence rather than truth. Seeded by the player himself, so it never touches the league's RNG.
 */
export function generateCombine(p: Player): Combine {
  const rng = new Rng(`combine:${p.id}:${p.firstName} ${p.lastName}:${p.heightIn}:${p.weightLb}`);
  const noise = Array.from({ length: 14 }, () => rng.normal());
  const skips = Array.from({ length: 6 }, () => rng.chance(0.08));
  const c: Combine = {
    arms: round(clamp(0.43 * p.heightIn + 0.7 * noise[0], 28.5, 36.5), 0.125),
    hands: round(clamp(9.6 + 0.03 * (p.heightIn - 74) + 0.45 * noise[1], 8, 11.25), 0.125),
  };
  if (p.position === 'K' || p.position === 'P') return c;
  // Each drill reads a rating relative to an average starter at his position.
  const typical = (a: Attribute) => 12.8 + (ATTRIBUTE_PROFILES[p.position][a] ?? -8);
  const ds = p.ratings.speed - typical('speed');
  const da = p.ratings.agility - typical('agility');
  const dst = p.ratings.strength - typical('strength');
  const burst = 0.6 * ds + 0.4 * da;
  const [forty, bench, vertical, broad, shuttle, cone] = COMBINE_TYPICAL[p.position];
  const heavy = p.weightLb - 250;
  if (!skips[0]) c.forty = round(clamp(forty - 0.035 * ds + 0.0015 * heavy + 0.035 * noise[2], 4.2, 5.7), 0.01);
  // Quarterbacks don't bench at the combine.
  if (!skips[1] && p.position !== 'QB')
    c.bench = Math.round(clamp(bench + 1.3 * dst + 0.03 * heavy + 1.8 * noise[3], 4, 45));
  if (!skips[2]) c.vertical = round(clamp(vertical + 0.6 * burst + 1.3 * noise[4], 22, 45), 0.5);
  if (!skips[3]) c.broad = Math.round(clamp(broad + 2 * burst + 3 * noise[5], 90, 145));
  if (!skips[4]) c.shuttle = round(clamp(shuttle - 0.025 * da + 0.05 * noise[6], 3.85, 5.1), 0.01);
  if (!skips[5]) c.cone = round(clamp(cone - 0.04 * da + 0.08 * noise[7], 6.4, 8.4), 0.01);
  return c;
}
