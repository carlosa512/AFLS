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
  /** Rarer than most: one marble a year instead of two or three. */
  rare?: boolean;
  /** A hothead draws extra marbles for it (low temperament). */
  temper?: boolean;
}

const RECEIVERS: readonly Position[] = ['WR', 'TE'];
const DLINE: readonly Position[] = ['DT', 'EDGE'];
const DBS: readonly Position[] = ['CB', 'S'];

export const QUIRKS = {
  // ── QB ──
  muddyPockets: { label: 'Navigates Muddy Pockets', positions: ['QB'], tone: 'good', clause: 'slides into open gaps when the pocket collapses', effect: 'Pressure turns into fewer sacks.' },
  staresDown: { label: 'Stares Down Hot Route', positions: ['QB'], tone: 'bad', clause: 'locks onto his first read, so linebackers jump short throws', effect: 'More interceptions on short throws against zone.' },
  gunslinger: { label: 'Gunslinger', positions: ['QB'], tone: 'style', clause: 'never throws it away, even when the play breaks down', effect: 'No throwaways: under pressure he forces it into coverage, so fewer completions and more interceptions.' },
  safetyEyes: { label: 'Manipulates Safety Eyes', positions: ['QB'], tone: 'good', clause: 'moves the safeties with his eyes before he throws', effect: 'Less help over the top against zone.' },
  noHuddle: { label: 'Thrives in No-Huddle', positions: ['QB'], tone: 'good', clause: 'is at his sharpest when the offense goes fast', effect: 'More accurate, better decisions in hurry-up.' },
  bailsEarly: { label: 'Bails Early', positions: ['QB'], tone: 'bad', clause: 'leaves the pocket at the first sign of pressure', effect: 'Scrambles more, and cuts deep throws short.' },
  patsTheBall: { label: 'Pat-The-Rock', positions: ['QB'], tone: 'bad', clause: 'pats the ball before he throws, giving the rush an extra beat', effect: 'More pressure, and more strip-sacks.' },
  hardCount: { label: 'Hard-Count Fiend', positions: ['QB'], tone: 'style', clause: 'lives on the hard count', effect: 'Draws more offsides, and his own line jumps now and then.' },
  // ── RB ──
  finishesForward: { label: 'Finishes Forward', positions: ['RB'], tone: 'good', clause: 'always falls forward for an extra yard', effect: 'A yard more on short runs.' },
  looseCarriage: { label: 'Loose Carriage', positions: ['RB'], tone: 'bad', clause: 'carries the ball away from his body in traffic', effect: 'More fumbles on carries and catches.' },
  dwellsInHole: { label: 'Dwells in the Hole', positions: ['RB'], tone: 'style', clause: 'hunts for the home run instead of taking what is there', effect: 'Runs swing wider: more stuffs, more big gains.' },
  patientPresser: { label: 'Patient Presser', positions: ['RB'], tone: 'good', clause: 'lets his blocks set up before he hits the hole', effect: 'Gets more out of his line, good or bad.' },
  blitzPickup: { label: 'Elite Blitz Pickup', positions: ['RB'], tone: 'good', clause: 'stones blitzers in pass protection', effect: 'Fewer sacks when the defense blitzes.' },
  softHands: { label: 'Soft-Hands Outlet', positions: ['RB'], tone: 'good', clause: 'catches checkdowns in stride', effect: 'More yards after the catch on short throws.' },
  highKnee: { label: 'High-Knee Stride', positions: ['RB'], tone: 'style', clause: 'runs upright, shrugging off ankle tackles but taking big hits', effect: 'Breaks more tackles, fumbles more.' },
  jumpCutter: { label: 'Jump-Cutter', positions: ['RB'], tone: 'style', clause: 'jump-cuts from gap to gap', effect: 'More big runs, more stuffs.' },
  bouncesExternal: { label: 'Bounces External', positions: ['RB'], tone: 'bad', clause: 'bounces inside runs to the outside', effect: 'Inside runs turn into losses more often.' },
  shortArm: { label: 'Short-Arm Catcher', positions: ['RB'], tone: 'bad', clause: 'catches with his body instead of his hands', effect: 'More drops when he is covered.' },
  contactAverse: { label: 'Contact Averse', positions: ['RB'], tone: 'bad', clause: 'goes down early to avoid the big hit', effect: 'Fewer yards after contact, fewer fumbles.' },
  // ── WR / TE ──
  yacSlasher: { label: 'YAC Slasher', positions: RECEIVERS, tone: 'good', clause: 'turns upfield the moment he catches it', effect: 'More yards after the catch.' },
  goesUpForIt: { label: 'Goes Up and Gets It', positions: RECEIVERS, tone: 'good', clause: 'attacks the ball at its highest point on deep throws', effect: 'Wins more deep contested balls, fewer of them picked.' },
  hearsFootsteps: { label: 'Hears Footsteps', positions: RECEIVERS, tone: 'bad', clause: 'drops easy ones when he expects to get hit', effect: 'More drops on short and intermediate throws.' },
  lateHands: { label: 'Late-Hands Specialist', positions: RECEIVERS, tone: 'good', clause: 'shows his hands at the last moment', effect: 'Wins more contested catches.' },
  stemsDB: { label: 'Stems DB In-Break', positions: RECEIVERS, tone: 'good', clause: 'turns corners the wrong way at the top of his route', effect: 'More separation against man coverage.' },
  getsJammed: { label: 'Gets Jammed at Line', positions: RECEIVERS, tone: 'bad', clause: 'gets knocked off his route by press corners', effect: 'Less separation against man coverage.' },
  bodyCatcher: { label: 'Body-Catcher', positions: RECEIVERS, tone: 'bad', clause: 'traps the ball against his chest', effect: 'More drops in tight coverage.' },
  runsEastWest: { label: 'Runs East-West', positions: RECEIVERS, tone: 'bad', clause: 'runs sideways after the catch looking for room', effect: 'Fewer yards after the catch.' },
  // ── OL ──
  anchor: { label: 'Anchor Monster', positions: ['OL'], tone: 'good', clause: 'resets his anchor against the bull rush', effect: 'Less pressure on the quarterback.' },
  handPlacement: { label: 'Loses Hand Placement', positions: ['OL'], tone: 'bad', clause: 'lets his hands get wide, and the flags follow', effect: 'More holding calls.' },
  pancakePreacher: { label: 'Pancake Preacher', positions: ['OL'], tone: 'style', clause: 'chases the highlight block, for better and worse', effect: 'Runs swing wider: more big gains, more blown blocks.' },
  secondLevel: { label: 'Second-Level Hunter', positions: ['OL'], tone: 'good', clause: 'climbs to the linebackers and seals them off', effect: 'More long runs.' },
  finishedToDirt: { label: 'Finished to the Dirt', positions: ['OL'], tone: 'good', clause: 'drives his man until the whistle', effect: 'More yards when the line is winning.' },
  heavyPunch: { label: 'Heavy Snapping Punch', positions: ['OL'], tone: 'good', clause: 'stuns rushers with his first strike', effect: 'Fewer pressures turn into sacks.' },
  stuntCommunicator: { label: 'Stunt Communicator', positions: ['OL'], tone: 'good', clause: 'sorts out games and blitzes up front', effect: 'Less pressure against the blitz.' },
  waistBender: { label: 'Waist-Bender', positions: ['OL'], tone: 'bad', clause: 'bends at the waist, so finesse rushers swim past him', effect: 'More pressure from agile edge rushers.' },
  heavyFeet: { label: 'Heavy Feet', positions: ['OL'], tone: 'bad', clause: 'is slow to set against speed', effect: 'More pressure from fast edge rushers.' },
  lungesAtStunts: { label: 'Lunges at Stunts', positions: ['OL'], tone: 'bad', clause: 'bites on games and blitzes', effect: 'More pressure against the blitz.' },
  pullsSoft: { label: 'Pulls Soft', positions: ['OL'], tone: 'bad', clause: 'pulls into traffic instead of through it', effect: 'Fewer yards on inside runs.' },
  twoTapSet: { label: 'Two-Tapped Set', positions: ['OL'], tone: 'style', clause: 'kicks out fast with a quick two-step set', effect: 'Better against speed, a little worse against power.' },
  // ── DT / EDGE ──
  firstStep: { label: 'First-Step Flash', positions: DLINE, tone: 'good', clause: 'times the snap count and fires off the ball', effect: 'More pressure, a few more offsides.' },
  bitesOnPlayAction: { label: 'Bites on Play-Action', positions: DLINE, tone: 'bad', clause: 'crashes on every fake handoff', effect: 'Play action works better against his defense.' },
  bullRush: { label: 'Bull-Rush Primary', positions: DLINE, tone: 'style', clause: 'walks blockers straight back into the quarterback', effect: 'More pressure, but fewer of his rushes finish as sacks.' },
  planAdjuster: { label: 'Pass-Rush Plan Adjuster', positions: DLINE, tone: 'good', clause: 'always has a second move ready', effect: 'More pressure on obvious passing downs.' },
  unblockable: { label: 'Unblockable Disruption', positions: DLINE, tone: 'good', clause: 'blows up runs in the backfield', effect: 'Fewer yards on inside runs.' },
  highMotor: { label: 'High-Motor Chaser', positions: DLINE, tone: 'good', clause: 'never stops chasing', effect: 'Fewer long runs and long scrambles.' },
  battenDown: { label: 'Batten-Down the Hatches', positions: DLINE, tone: 'good', clause: 'eats double teams so the linebackers run free', effect: 'Fewer yards on runs.' },
  losesContainment: { label: 'Loses Edge Containment', positions: DLINE, tone: 'bad', clause: 'rushes too far inside and leaves the edge open', effect: 'Quarterbacks scramble for more.' },
  armTackler: { label: 'Arm Tackler in Traffic', positions: DLINE, tone: 'bad', clause: 'reaches for ball carriers instead of shedding', effect: 'More yards on runs.' },
  gassed: { label: 'Gassed in High-Tempo', positions: DLINE, tone: 'bad', clause: 'fades on long drives and against the hurry-up', effect: 'Less rush and run defense when tired.' },
  jumpHappy: { label: 'Jump-Happy', positions: DLINE, tone: 'bad', clause: 'jumps at hard counts and pump fakes', effect: 'More offsides, many more against a hard count.', rare: true, temper: true },
  bendsArc: { label: 'Bends the Arc', positions: ['EDGE'], tone: 'style', clause: 'dips and bends around the tackle', effect: 'More sacks, softer against inside runs.' },
  // ── LB ──
  zoneHawk: { label: 'Zone Hawk', positions: ['LB'], tone: 'good', clause: 'reads the quarterback and undercuts throws in zone', effect: 'More interceptions in zone coverage.' },
  manDeficit: { label: 'Man-Coverage Deficit', positions: ['LB'], tone: 'bad', clause: 'lacks the hips to run with backs and tight ends in man', effect: 'Gives up more separation in man coverage.' },
  gapShooter: { label: 'Gap-Shooter', positions: ['LB'], tone: 'style', clause: 'shoots gaps to make plays in the backfield', effect: 'More tackles for loss, more big runs behind him.' },
  diagnoses: { label: 'Diagnoses Before Snap', positions: ['LB'], tone: 'good', clause: 'reads the play before the snap', effect: 'Fewer yards on runs, fooled less by play action.' },
  scraper: { label: 'Sideline-to-Sideline Scraper', positions: ['LB'], tone: 'good', clause: 'flows to the ball through traffic', effect: 'Fewer yards on outside runs.' },
  thumper: { label: 'Thumping Tackler', positions: ['LB'], tone: 'good', clause: 'stops ball carriers dead', effect: 'Fewer broken tackles.' },
  greenDog: { label: 'Green-Dog Blitz Specialist', positions: ['LB'], tone: 'good', clause: 'turns into a blitzer when his man stays in', effect: 'More pressure on blitzes.' },
  stuckOnBlocks: { label: 'Stuck on Blocks', positions: ['LB'], tone: 'bad', clause: 'can\'t get off blocks once a lineman gets hands on him', effect: 'More yards on runs behind a good line.' },
  slowFlow: { label: 'Slow Flow', positions: ['LB'], tone: 'bad', clause: 'waits to see the ball before he moves', effect: 'More yards on runs.' },
  misreadsKeys: { label: 'Misreads Keys', positions: ['LB'], tone: 'bad', clause: 'gets fooled by misdirection', effect: 'Play action works better against him.' },
  spotDrop: { label: 'Spot-Drop Coverer', positions: ['LB'], tone: 'style', clause: 'drops to his spot and guards grass', effect: 'Tighter on short zone throws, looser beyond them.' },
  // ── CB / S ──
  fluidHips: { label: 'Fluid Hip-Turn', positions: DBS, tone: 'good', clause: 'turns and runs without losing a step', effect: 'Better deep coverage.' },
  bitesOnDoubleMoves: { label: 'Bites on Double-Moves', positions: DBS, tone: 'bad', clause: 'jumps the first break and gets beaten over the top', effect: 'Tighter on short throws, beaten more often deep.' },
  playsTheBall: { label: 'Plays the Ball', positions: DBS, tone: 'style', clause: 'turns to find the ball every time', effect: 'More interceptions, more separation allowed.' },
  baitsQB: { label: 'Baits the Quarterback', positions: DBS, tone: 'good', clause: 'plays off and dares the quarterback to throw', effect: 'More interceptions, more short completions.' },
  physicalJammer: { label: 'Physical Jammer', positions: DBS, tone: 'good', clause: 'reroutes receivers at the line', effect: 'Less separation against his press.' },
  alleyCrusher: { label: 'Alley Crusher', positions: DBS, tone: 'good', clause: 'fills hard against outside runs', effect: 'Fewer yards on outside runs.' },
  ballStripper: { label: 'Ball-Stripper', positions: DBS, tone: 'good', clause: 'punches at the ball on every tackle', effect: 'More forced fumbles.' },
  handsy: { label: 'Handsy in the Route', positions: DBS, tone: 'bad', clause: 'grabs when he is beaten', effect: 'More pass interference and holding calls.', temper: true },
  businessDecision: { label: 'Tackling Business Decision', positions: DBS, tone: 'bad', clause: 'avoids big ball carriers', effect: 'More yards after the catch for big receivers.' },
  peeks: { label: 'Peeks in the Backfield', positions: DBS, tone: 'bad', clause: 'watches the backfield and loses his man', effect: 'Beaten more often on play action.' },
  catchPoint: { label: 'Struggles at the Catch Point', positions: DBS, tone: 'bad', clause: 'is in position but never gets his hands up', effect: 'More contested catches allowed.' },
  offMan: { label: 'Off-Man Specialist', positions: DBS, tone: 'style', clause: 'plays off and keeps everything in front', effect: 'Fewer deep completions, more short ones.' },
  // ── K / P ──
  iceWater: { label: 'Ice-Water Veins', positions: ['K'], tone: 'good', clause: 'is at his best when the game is on the line', effect: 'More accurate on fourth-quarter kicks in close games.' },
  boomerLeg: { label: 'Boomer Leg', positions: ['K'], tone: 'style', clause: 'has a cannon, but sprays the short ones', effect: 'Longer range and more touchbacks, a little shakier inside 40 yards.' },
  coffinCorner: { label: 'Coffin-Corner Specialist', positions: ['P'], tone: 'good', clause: 'pins teams inside the 10', effect: 'Better placement from plus territory.' },
  outkicksCoverage: { label: 'Out-Kicks His Coverage', positions: ['P'], tone: 'bad', clause: 'booms it with no hang time, and returners feast', effect: 'Longer punts, much longer returns.' },
  quickRelease: { label: 'Quick-Release Operation', positions: ['P'], tone: 'good', clause: 'gets the punt off in a blink', effect: 'Almost never blocked.' },
  slingFoot: { label: 'Sling-Foot Starter', positions: ['P'], tone: 'bad', clause: 'is slow from snap to kick', effect: 'More blocked punts.' },
  highArc: { label: 'High-Arc Boot', positions: ['P'], tone: 'style', clause: 'kicks for hang time over distance', effect: 'Shorter punts, fewer return yards.' },
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
 * Blank marbles in the bag, by age: young players are still forming, veterans are set in their
 * ways. A fixed count dwarfs the quirk marbles, so each quirk's odds barely depend on how many
 * quirks his position can draw.
 */
const blanksFor = (age: number) => (age <= 24 ? BLANKS[0] : age <= 29 ? BLANKS[1] : BLANKS[2]);
export const FIX: [number, number] = [11, 8];
export const BLANKS: [number, number, number] = [120, 192, 300];

/**
 * A fresh bag for the league year. Every quirk his position can draw gets a few marbles (style ones a
 * few more); a hard worker draws more of the good ones, a coaster and a hothead more of the bad.
 * Each quirk he holds also gets fix marbles: more against bad habits, more again with a good
 * position coach (`coachRate`, his staff's growth rate) and a hard worker.
 */
export function fillBag(p: Player, coachRate = 1): Record<string, number> {
  const bag: Record<string, number> = { blank: blanksFor(p.age) };
  const work = p.traits.workEthic - TRAIT_MEAN;
  const coach = clamp(Math.round((coachRate - 1) * 8), -1, 2);
  for (const id of QUIRKS_FOR[p.position]) {
    const q = QUIRKS[id];
    const info: QuirkInfo = q;
    let n = info.rare ? 1 : q.tone === 'style' ? 3 : 2;
    if (q.tone === 'good') n += Math.round(Math.max(0, work) / 3);
    if (q.tone === 'bad') n += Math.round(Math.max(0, -work) / 3) + (p.traits.temperament <= 7 ? 1 : 0);
    // A short fuse feeds the habits that draw flags.
    if (info.temper && p.traits.temperament <= 7) n += 2;
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
