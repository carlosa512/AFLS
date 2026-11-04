import { traitLean, traitOf } from '../coachTraits';
import {
  addJolt,
  moodLean,
  moraleContext,
  moraleFactors,
  moraleLevel,
  promisesScore,
  YEAR,
  type MoraleContext,
} from '../morale';
import { characterZ } from '../personality';
import { Rng } from '../rng';
import { tierOf, weightOf } from '../standing';
import { effectiveTraits } from '../traits';
import type {
  Approach,
  Backing,
  League,
  MeetingRecord,
  MeetingSuggestion,
  Outcome,
  Player,
  MeetingTopic,
  TalkCause,
  Timing,
} from '../types';
import { CRED, credibilityOf, shiftCredibility } from './credibility';
import { openCommitment } from './commitments';
import { dugIn, grievancesOf, headCoachOf, meetingsOf, membersOf } from './suggest';

/**
 * How each man takes a meeting (L2, spec §1.3): a score from facts the game already has, a seeded draw for luck, then
 * one nudge from the leaders and voices who bought in. Lands, a shrug, or he bristles; a lands or a bristle is a
 * `meeting` jolt that fades like any other. A meeting never fixes the cause.
 */
export const REACT = {
  fit: 0.15,
  noGrievance: 0.25,
  miss: -0.1,
  money: -0.6,
  backingMatch: 0.8,
  backingOther: 0.15,
  credibility: 0.25,
  newVoice: 0.2,
  heard: -0.25,
  benched: -0.2,
  broken: -0.3,
  ripple: 0.15,
  luck: 0.5,
  lands: 0.5,
  bristles: -0.5,
};

/** The jolt on the mood level: a base, the timing, then a moment or the standard smaller and the GM's address bigger. */
export const JOLT = {
  base: 2,
  afterGame: 1.5,
  monday: 1,
  wednesday: 0.6,
  moment: 0.7,
  standard: 0.5,
  gm: 2,
  /** A man with nothing wrong isn't who it's about: it moves him a quarter as far (a happy room isn't made Tight by a talk). */
  content: 0.25,
};

export type MeetingChoice = { approach: Approach; backing: Backing; timing: Timing };

/** The GM address's terms (`address.ts`): trust in your word for the coach's, and its own lean per man. */
export interface SpeakerTerms {
  trust: (p: Player) => number;
  lean: (p: Player) => number;
}

/** A man benched in the last month still feels it. */
const BENCHED_MEMORY = 4;
/** The ripple counts at most this many leaders or voices either way. */
const RIPPLE_CAP = 2;

const zOf = (p: Player) => characterZ({ ...effectiveTraits(p), ...p.personality });
const pos = (v: number) => Math.max(0, v);

/** Work ethic and a will to win: he takes a challenge as one. */
export const isDriven = (p: Player) => {
  const z = zOf(p);
  return z.workEthic >= 1 && z.winning >= 0.5;
};
/** A short fuse and a loud mouth. */
export const isVolatile = (p: Player) => {
  const z = zOf(p);
  return z.temperament <= -1 && z.controversy >= 1;
};

const friendsWith = (p: Player, id: number | undefined, league: League) =>
  id !== undefined &&
  ((p.ties ?? []).some((t) => t.kind === 'friend' && t.with === id) ||
    (league.players[id]?.ties ?? []).some((t) => t.kind === 'friend' && t.with === p.id));

/** The grievance an approach is about. */
const aboutOf = (approach: Approach, s: MeetingSuggestion): MeetingTopic =>
  approach === 'losing' ? 'losing' : approach === 'standard' || approach === 'raiseBar' ? 'none' : s.topic;

/** The grievance a commitment answers. */
const ANSWERS: Record<Exclude<Backing, 'words'>, TalkCause> = {
  snaps: 'snaps',
  talks: 'deal',
  feud: 'feud',
  move: 'losing',
  jobs: 'losing',
  notice: 'losing',
};

/** The coach's words against the man's makeup, by approach (the plan's speaker terms). */
function speakerTerm(league: League, teamId: number, p: Player, s: MeetingSuggestion, approach: Approach): number {
  const z = zOf(p);
  switch (approach) {
    case 'straight': {
      const hc = headCoachOf(league, teamId);
      const discipline = hc ? pos(traitLean(traitOf(hc, 'discipline'))) : 0;
      return 0.1 + 0.15 * pos(z.temperament) - 0.35 * discipline * pos(-z.temperament);
    }
    case 'leader': {
      const leader = s.leader !== undefined ? league.players[s.leader] : undefined;
      if (!leader) return 0;
      return 0.35 * moodLean(moraleLevel(league, leader)) + (friendsWith(p, leader.id, league) ? 0.15 : 0);
    }
    case 'callout': {
      if (p.id === s.driver) return isDriven(p) ? 0.5 : -0.6 - 0.3 * pos(z.controversy);
      return friendsWith(p, s.driver, league) ? -0.3 : 0.1;
    }
    case 'standard':
      return 0.1;
    default:
      // Keep it about the losing: the fit on the losing cause is the whole of it. The GM's approaches lean in `terms`.
      return 0;
  }
}

/** Times this approach has been used on this scope this league year: "heard it before". */
function heardTimes(league: League, teamId: number, s: MeetingSuggestion, approach: Approach): number {
  const season = league.season;
  return meetingsOf(league.teams[teamId]).log.filter(
    (r) => r.scope === s.scope && r.approach === approach && Math.floor(r.clock / YEAR) === season,
  ).length;
}

/**
 * His score before luck and the ripple (for tests and the AI's choice): fit, the speaker against his makeup, what's
 * behind it, the coach's word (or trust in yours), and his own history.
 */
export function reactionScore(
  league: League,
  teamId: number,
  p: Player,
  s: MeetingSuggestion,
  choice: MeetingChoice,
  ctx: MoraleContext,
  terms?: SpeakerTerms,
): number {
  const grievances = grievancesOf(league, p, ctx);
  const about = aboutOf(choice.approach, s);
  let score =
    grievances.size === 0
      ? REACT.noGrievance
      : about !== 'none' && about !== 'coordinator' && grievances.has(about)
        ? REACT.fit
        : REACT.miss;
  // A man who wants a new deal can't be talked out of it: only talks behind the meeting reach him.
  if ((grievances.has('deal') || underpaid(league, p, ctx)) && choice.backing !== 'talks') score += REACT.money;
  score += speakerTerm(league, teamId, p, s, choice.approach);
  if (choice.backing !== 'words') {
    const named = s.namedFor?.[choice.backing];
    const answers = grievances.has(ANSWERS[choice.backing]) && (!named?.length || named.includes(p.id));
    score += answers ? REACT.backingMatch : REACT.backingOther;
  }
  if (terms) score += terms.trust(p) + terms.lean(p);
  else {
    const hc = headCoachOf(league, teamId);
    if (hc) {
      score += REACT.credibility * credibilityOf(hc);
      if ((hc.newVoice ?? 0) > 0) score += REACT.newVoice;
    }
  }
  score += REACT.heard * heardTimes(league, teamId, s, choice.approach);
  const clock = s.clock;
  if ((p.morale?.jolts ?? []).some((j) => j.kind === 'benched' && clock - j.at < BENCHED_MEMORY))
    score += REACT.benched;
  if (promisesScore(p) < 0) score += REACT.broken;
  return score;
}

/** Paid well under what he thinks he's worth, whether or not it's the first thing he'd say. */
const underpaid = (league: League, p: Player, ctx: MoraleContext) =>
  moraleFactors(league, p, ctx).contract <= -MONEY_AT;
/** The contract factor past which his mood board says he wants a new deal (`moraleReasons`). */
const MONEY_AT = 0.75;

/** A meeting's reactions as [player id, outcome] pairs (shrugs left out). */
export const outcomeEntries = (r: MeetingRecord): [number, Outcome][] => [
  ...r.outcomes.lands.map((id): [number, Outcome] => [id, 'lands']),
  ...r.outcomes.bristles.map((id): [number, Outcome] => [id, 'bristles']),
];

const outcomeOf = (score: number): Outcome =>
  score >= REACT.lands ? 'lands' : score <= REACT.bristles ? 'bristles' : 'shrug';

/** The size of the meeting's jolt, either way. */
export function joltSize(s: MeetingSuggestion, choice: MeetingChoice): number {
  const timing = s.kind === 'trouble' ? JOLT[choice.timing] : JOLT.monday;
  const kind = s.kind === 'gm' ? JOLT.gm : s.kind === 'moment' ? JOLT.moment : 1;
  return JOLT.base * timing * kind * (choice.approach === 'standard' ? JOLT.standard : 1);
}

/** The meeting's own stream: a meeting reads nothing else, and nothing else reads it. */
export const meetingRng = (league: League, teamId: number, s: MeetingSuggestion, scope: string = s.scope) =>
  new Rng(`${league.seed}:meeting:${league.season}:${s.clock}:${teamId}:${scope}`);

/**
 * Hold the meeting waiting on the club (`pending`): each man's reaction, the jolts, the log, the commitment, the
 * coach's word. The GM address passes its own terms and skips the coach's credibility (`address.ts`).
 */
export function holdMeeting(
  league: League,
  teamId: number,
  choice: MeetingChoice,
  terms?: SpeakerTerms,
  ctx: MoraleContext = moraleContext(league),
): MeetingRecord {
  const team = league.teams[teamId];
  const m = meetingsOf(team);
  const s = m.pending;
  if (!s) throw new Error('No meeting is waiting.');
  const rng = meetingRng(league, teamId, s, s.kind === 'gm' ? 'gm' : s.scope);
  const men = membersOf(league, teamId, s.scope)
    .map((p) => ({ p, w: weightOf(league, p, ctx) }))
    // Leaders and voices first, by weight: the room hears them first.
    .sort((a, b) => b.w - a.w || a.p.id - b.p.id);
  // Luck drawn for every man in a fixed order before anything is decided, so the draws don't depend on the outcomes.
  const scored = men.map((x) => ({
    ...x,
    tier: tierOf(league, x.p, x.w) !== null,
    content: grievancesOf(league, x.p, ctx).size === 0,
    score: reactionScore(league, teamId, x.p, s, choice, ctx, terms) + rng.normal(0, REACT.luck),
  }));
  let net = 0;
  for (const x of scored.filter((x) => x.tier)) {
    const o = outcomeOf(x.score);
    net += o === 'lands' ? 1 : o === 'bristles' ? -1 : 0;
  }
  const ripple = REACT.ripple * Math.max(-RIPPLE_CAP, Math.min(RIPPLE_CAP, net));
  const size = joltSize(s, choice);
  const outcomes: MeetingRecord['outcomes'] = { lands: [], bristles: [] };
  const lift: Record<number, number> = {};
  let lands = 0;
  let bristles = 0;
  for (const x of scored) {
    const raw = outcomeOf(x.tier ? x.score : x.score + ripple);
    // A man who has dug in (a dispute, or talks gone sour: G4) isn't talked round: at best he shrugs it off. A meeting
    // buys time; it doesn't end a holdout or take back a trade request.
    const o = raw === 'lands' && dugIn(x.p) ? 'shrug' : raw;
    if (o === 'shrug') continue;
    outcomes[o].push(x.p.id);
    const his = x.content ? size * JOLT.content : size;
    addJolt(x.p, 'meeting', o === 'lands' ? his : -his, s.clock);
    if (o === 'lands') {
      lands++;
      lift[x.p.id] = his;
    } else bristles++;
  }
  const record: MeetingRecord = {
    clock: s.clock,
    scope: s.scope,
    kind: s.kind,
    approach: choice.approach,
    backing: choice.backing,
    timing: s.kind === 'trouble' ? choice.timing : 'monday',
    outcomes,
    topic: s.topic,
    ...(s.moment ? { moment: s.moment } : {}),
    ...(choice.approach === 'leader' && s.leader !== undefined
      ? { speaker: s.leader }
      : choice.approach === 'callout' && s.driver !== undefined
        ? { speaker: s.driver }
        : {}),
  };
  m.log.push(record);
  const c = openCommitment(league, teamId, record, s, lift);
  if (c) m.open.push(c);
  if (s.kind !== 'gm') {
    const hc = headCoachOf(league, teamId);
    if (hc && men.length) {
      shiftCredibility(hc, (CRED.meetingLands * lands + CRED.meetingBristles * bristles) / men.length);
      if (hc.newVoice) {
        hc.newVoice -= 1;
        if (hc.newVoice <= 0) delete hc.newVoice;
      }
    }
  }
  delete m.pending;
  return record;
}
