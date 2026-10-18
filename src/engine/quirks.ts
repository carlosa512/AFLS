/**
 * Quirks: on-field habits no rating captures ("stares down his first read", "ice water in his
 * veins"). Traits are who a player is and never change; quirks are how he plays, and they come and
 * go. Design notes: `docs/QUIRKS.md`.
 *
 * Every quirk is a situational lean the match engine reads (`match/gameSim.ts`), never a flat
 * ratings bonus (that is what ratings are for), and `npm run quirks` checks each one moves its stat.
 *
 * **The marble bag.** Each player draws from his own bag: marbles for his position's quirks, fix
 * marbles for the ones he holds, and blanks. It is refilled each league year (from his position,
 * traits, age and position coach) and drawn from without replacement: a big draw each offseason and
 * the odd one during the season. Drawn marbles stay out until the refill, so bad luck can't stack
 * without limit and what he drew earlier changes the odds later.
 *
 * **Grip.** A quirk's marble adds a point of grip, a fix marble takes one away. Grip 1: it's starting
 * to show. Grip 2: established (the engine applies it). Grip 3: ingrained, and only half of the fix
 * marbles drawn against it stick. So habits form and fade over weeks and seasons, never overnight.
 */
import { coachingFor } from './coaching';
import { playerOvr } from './positions';
import { clamp, Rng } from './rng';
import { TRAIT_MEAN } from './traits';
import type { League, Player, Position } from './types';

export type QuirkTone = 'good' | 'bad' | 'style';

export interface QuirkInfo {
  label: string;
  positions: readonly Position[];
  /** Style quirks trade something for something (like schemes): neither a plus nor a minus. */
  tone: QuirkTone;
  /** What a scout says about it, as a clause ("he slides away from interior pressure"). */
  clause: string;
  /** What it does in the match engine. */
  effect: string;
}

const RECEIVERS: readonly Position[] = ['WR', 'TE'];
const DLINE: readonly Position[] = ['DT', 'EDGE'];
const DBS: readonly Position[] = ['CB', 'S'];

export const QUIRKS = {
  // ── QB ──
  muddyPockets: { label: 'Navigates Muddy Pockets', positions: ['QB'], tone: 'good', clause: 'slides into open gaps when the pocket collapses', effect: 'Pressure turns into fewer sacks.' },
  staresDown: { label: 'Stares Down Hot Route', positions: ['QB'], tone: 'bad', clause: 'locks onto his first read, so linebackers jump short throws', effect: 'More interceptions on short throws against zone.' },
  gunslinger: { label: 'Gunslinger', positions: ['QB'], tone: 'style', clause: 'never throws it away, even when the play breaks down', effect: 'No throwaways under pressure: a few more big plays, more interceptions.' },
  // ── RB ──
  finishesForward: { label: 'Finishes Forward', positions: ['RB'], tone: 'good', clause: 'always falls forward for an extra yard', effect: 'A yard more on short runs.' },
  looseCarriage: { label: 'Loose Carriage', positions: ['RB'], tone: 'bad', clause: 'carries the ball away from his body in traffic', effect: 'More fumbles on carries and catches.' },
  dwellsInHole: { label: 'Dwells in the Hole', positions: ['RB'], tone: 'style', clause: 'hunts for the home run instead of taking what is there', effect: 'Runs swing wider: more stuffs, more big gains.' },
  // ── WR / TE ──
  yacSlasher: { label: 'YAC Slasher', positions: RECEIVERS, tone: 'good', clause: 'turns upfield the moment he catches it', effect: 'More yards after the catch.' },
  goesUpForIt: { label: 'Goes Up and Gets It', positions: RECEIVERS, tone: 'good', clause: 'attacks the ball at its highest point on deep throws', effect: 'Wins more deep contested balls, fewer of them picked.' },
  hearsFootsteps: { label: 'Hears Footsteps', positions: RECEIVERS, tone: 'bad', clause: 'drops easy ones when he expects to get hit', effect: 'More drops on short and intermediate throws.' },
  // ── OL ──
  anchor: { label: 'Anchor Monster', positions: ['OL'], tone: 'good', clause: 'resets his anchor against the bull rush', effect: 'Less pressure on the quarterback.' },
  handPlacement: { label: 'Loses Hand Placement', positions: ['OL'], tone: 'bad', clause: 'lets his hands get wide, and the flags follow', effect: 'More holding calls.' },
  pancakePreacher: { label: 'Pancake Preacher', positions: ['OL'], tone: 'style', clause: 'chases the highlight block, for better and worse', effect: 'Runs swing wider: more big gains, more blown blocks.' },
  // ── DT / EDGE ──
  firstStep: { label: 'First-Step Flash', positions: DLINE, tone: 'good', clause: 'times the snap count and fires off the ball', effect: 'More pressure, a few more offsides.' },
  bitesOnPlayAction: { label: 'Bites on Play-Action', positions: DLINE, tone: 'bad', clause: 'crashes on every fake handoff', effect: 'Play action works better against his defense.' },
  bullRush: { label: 'Bull-Rush Primary', positions: DLINE, tone: 'style', clause: 'walks blockers straight back into the quarterback', effect: 'More pressure, but fewer of his rushes finish as sacks.' },
  // ── LB ──
  zoneHawk: { label: 'Zone Hawk', positions: ['LB'], tone: 'good', clause: 'reads the quarterback and undercuts throws in zone', effect: 'More interceptions in zone coverage.' },
  manDeficit: { label: 'Man-Coverage Deficit', positions: ['LB'], tone: 'bad', clause: 'lacks the hips to run with backs and tight ends in man', effect: 'Gives up more separation in man coverage.' },
  gapShooter: { label: 'Gap-Shooter', positions: ['LB'], tone: 'style', clause: 'shoots gaps to make plays in the backfield', effect: 'More tackles for loss, more big runs behind him.' },
  // ── CB / S ──
  fluidHips: { label: 'Fluid Hip-Turn', positions: DBS, tone: 'good', clause: 'turns and runs without losing a step', effect: 'Better deep coverage.' },
  bitesOnDoubleMoves: { label: 'Bites on Double-Moves', positions: DBS, tone: 'bad', clause: 'jumps the first break and gets beaten over the top', effect: 'Tighter on short throws, beaten more often deep.' },
  playsTheBall: { label: 'Plays the Ball', positions: DBS, tone: 'style', clause: 'turns to find the ball every time', effect: 'More interceptions, more separation allowed.' },
  // ── K / P ──
  iceWater: { label: 'Ice-Water Veins', positions: ['K'], tone: 'good', clause: 'is at his best when the game is on the line', effect: 'More accurate on fourth-quarter kicks in close games.' },
  boomerLeg: { label: 'Boomer Leg', positions: ['K'], tone: 'style', clause: 'has a cannon, but sprays the short ones', effect: 'Longer range and more touchbacks, a little shakier inside 40 yards.' },
  coffinCorner: { label: 'Coffin-Corner Specialist', positions: ['P'], tone: 'good', clause: 'pins teams inside the 10', effect: 'Better placement from plus territory.' },
  outkicksCoverage: { label: 'Out-Kicks His Coverage', positions: ['P'], tone: 'bad', clause: 'booms it with no hang time, and returners feast', effect: 'Longer punts, much longer returns.' },
} as const satisfies Record<string, QuirkInfo>;

export type QuirkId = keyof typeof QUIRKS;
export const QUIRK_IDS = Object.keys(QUIRKS) as QuirkId[];
export const quirkInfo = (id: QuirkId): QuirkInfo => QUIRKS[id];

/** The quirks a position can draw. */
export const QUIRKS_FOR: Record<Position, QuirkId[]> = Object.fromEntries(
  (['QB', 'RB', 'WR', 'TE', 'OL', 'DT', 'EDGE', 'LB', 'CB', 'S', 'K', 'P'] as Position[]).map((pos) => [pos, QUIRK_IDS.filter((id) => (QUIRKS[id].positions as readonly Position[]).includes(pos))]),
) as Record<Position, QuirkId[]>;

/** Grip at which a quirk is established and the engine applies it, and the most it can have. */
export const GRIP_ACTIVE = 2;
export const GRIP_MAX = 3;
/** Established quirks the engine applies (a special player can carry one more, if it's ingrained). */
export const MAX_ACTIVE = 3;
/** Quirks held at any grip: past this, a new one has no room to start. */
const MAX_HELD = 5;
const OFFSEASON_DRAWS = 3;
export const WEEKLY_DRAW_CHANCE = 0.25;
/** Draws in a college year and a pro year when a player is generated with a past. */
const COLLEGE_DRAWS = 3;
const PRO_DRAWS = OFFSEASON_DRAWS + 4;

/** Elite at his position, or a long career: room for a fourth quirk, if it's ingrained. */
export const isSpecial = (p: Player) => p.experience >= 10 || playerOvr(p) >= 15.5;

/**
 * The quirks the engine applies, strongest grip first: up to three, and a fourth for a special
 * player when it's ingrained. A quirk past the cap is held but dormant until another fades.
 */
export function activeQuirks(p: Player): QuirkId[] {
  const held = (Object.entries(p.quirks ?? {}) as [QuirkId, number][]).filter(([, g]) => g >= GRIP_ACTIVE).sort((a, b) => b[1] - a[1]);
  const out = held.slice(0, MAX_ACTIVE).map(([id]) => id);
  const fourth = held[MAX_ACTIVE];
  if (fourth && fourth[1] >= GRIP_MAX && isSpecial(p)) out.push(fourth[0]);
  return out;
}

/** Quirks starting to show (grip 1) or established but past the cap: scouts can mention them as early word. */
export function formingQuirks(p: Player): QuirkId[] {
  const active = new Set(activeQuirks(p));
  return (Object.keys(p.quirks ?? {}) as QuirkId[]).filter((id) => !active.has(id));
}

/**
 * Blank marbles per quirk his position can draw, by age: young players are still forming, veterans
 * are set in their ways. Per quirk, so adding quirks to a position doesn't make it busier.
 */
const blanksPerQuirk = (age: number) => (age <= 24 ? BLANKS[0] : age <= 29 ? BLANKS[1] : BLANKS[2]);
export const FIX: [number, number] = [11, 8];
export const BLANKS: [number, number, number] = [40, 64, 100];

/**
 * A fresh bag for the league year. Every quirk his position can draw gets a few marbles (style ones a
 * few more); a hard worker draws more of the good ones, a coaster and a hothead more of the bad.
 * Each quirk he holds also gets fix marbles: more against bad habits, more again with a good
 * position coach (`coachRate`, his staff's growth rate) and a hard worker.
 */
export function fillBag(p: Player, coachRate = 1): Record<string, number> {
  const bag: Record<string, number> = { blank: blanksPerQuirk(p.age) * QUIRKS_FOR[p.position].length };
  const work = p.traits.workEthic - TRAIT_MEAN;
  const coach = clamp(Math.round((coachRate - 1) * 8), -1, 2);
  for (const id of QUIRKS_FOR[p.position]) {
    const q = QUIRKS[id];
    let n = q.tone === 'style' ? 3 : 2;
    if (q.tone === 'good') n += Math.round(Math.max(0, work) / 3);
    if (q.tone === 'bad') n += Math.round(Math.max(0, -work) / 3) + (p.traits.temperament <= 7 ? 1 : 0);
    bag[id] = n;
    if (p.quirks?.[id]) bag[`fix:${id}`] = q.tone === 'bad' ? Math.max(2, FIX[0] + coach + (work >= 3 ? 1 : 0)) : FIX[1];
  }
  return bag;
}

/** Take one marble out of the bag (without replacement). Null when the bag is empty. */
function drawMarble(rng: Rng, bag: Record<string, number>): string | null {
  const total = Object.values(bag).reduce((a, b) => a + b, 0);
  if (total <= 0) return null;
  let r = rng.int(0, total - 1);
  for (const key of Object.keys(bag)) {
    r -= bag[key];
    if (r < 0) {
      if (--bag[key] <= 0) delete bag[key];
      return key;
    }
  }
  return null;
}

export interface QuirkChange {
  id: QuirkId;
  change: 'gained' | 'lost';
}

/** Apply one marble to a player's grips. Returns what changed, if a quirk became or stopped being established. */
function applyMarble(rng: Rng, p: Player, key: string): QuirkChange | null {
  if (key === 'blank') return null;
  const quirks = (p.quirks ??= {});
  if (key.startsWith('fix:')) {
    const id = key.slice(4) as QuirkId;
    const grip = quirks[id];
    if (!grip) return null;
    // Ingrained habits are hard to break.
    if (grip >= GRIP_MAX && !rng.chance(0.5)) return null;
    if (grip <= 1) delete quirks[id];
    else quirks[id] = grip - 1;
    return grip === GRIP_ACTIVE ? { id, change: 'lost' } : null;
  }
  const id = key as QuirkId;
  if (!QUIRKS[id]) return null;
  const grip = quirks[id] ?? 0;
  if (grip >= GRIP_MAX || (!grip && Object.keys(quirks).length >= MAX_HELD)) return null;
  quirks[id] = grip + 1;
  return grip + 1 === GRIP_ACTIVE ? { id, change: 'gained' } : null;
}

/** Keep the log short: the last few changes are the story, the rest is noise. */
const LOG_LIMIT = 12;

function draw(rng: Rng, p: Player, n: number, stamp?: { season: number; week: number }) {
  for (let i = 0; i < n; i++) {
    const key = p.quirkBag && drawMarble(rng, p.quirkBag);
    if (!key) return;
    const change = applyMarble(rng, p, key);
    if (change && stamp) {
      const log = (p.quirkLog ??= []);
      log.push({ ...change, ...stamp });
      if (log.length > LOG_LIMIT) log.splice(0, log.length - LOG_LIMIT);
    }
  }
  if (p.quirks && Object.keys(p.quirks).length === 0) delete p.quirks;
}

/**
 * A player's quirks when he's created: one draw-and-refill cycle for each year since he was 18, so a
 * veteran arrives with a history and a prospect with his college habits. Seeded by the player
 * himself (like his traits), so it never shifts the league's random stream.
 */
export function generateQuirks(p: Player): void {
  const rng = new Rng(`quirks:${p.id}:${p.firstName}:${p.lastName}`);
  const age = p.age;
  const college = Math.max(0, age - 18 - p.experience);
  delete p.quirks;
  for (let y = 0; y < college + p.experience; y++) {
    p.age = age - (college + p.experience) + y;
    p.quirkBag = fillBag(p);
    draw(rng, p, y < college ? COLLEGE_DRAWS : PRO_DRAWS);
  }
  p.age = age;
  p.quirkBag = fillBag(p);
}

/** New league year: refill the bag and make the big draw. Runs after development and his birthday. */
export function quirkOffseason(league: League, p: Player): void {
  const rng = new Rng(`${league.seed}:quirks:${league.season}:${p.id}`);
  p.quirkBag = fillBag(p, coachingFor(league, p.teamId, p.position).rate);
  draw(rng, p, OFFSEASON_DRAWS, { season: league.season, week: 0 });
}

/** In season: each rostered player has a small chance of drawing a marble every week. */
export function quirkWeek(league: League): void {
  for (const p of Object.values(league.players)) {
    if (p.retired || p.teamId === null) continue;
    const rng = new Rng(`${league.seed}:quirks:${league.season}:${league.week}:${p.id}`);
    if (!rng.chance(WEEKLY_DRAW_CHANCE)) continue;
    p.quirkBag ??= fillBag(p, coachingFor(league, p.teamId, p.position).rate);
    draw(rng, p, 1, { season: league.season, week: league.week });
  }
}
