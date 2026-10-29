/**
 * The director's waiver letter, one a day: what happened to the players we released and the claims we put in, and who
 * on the wire is worth a claim. The wire is about depth and upside, not starters: a position where we carry fewer
 * bodies than a club normally does, and a player our scouts think will grow into a starter. Read off the league as it
 * stands, keyed so nothing is told twice (old one-letter-per-result ids count as told).
 */
import { capHit, yearsLeft } from './finance/contract';
import { MIN_KNOWLEDGE } from './directorAdvice';
import type { WaiverClaim, WaiverEntry, WaiverResult } from './personnel/types';
import { claimProblem, waiverOrder } from './personnel/waivers';
import { POSITION_NAMES, ROSTER_TEMPLATE, STARTERS } from './positions';
import { activeRoster, isAvailable } from './roster';
import { perceive } from './scouting';
import { director, type Draft } from './senders';
import { tradeContext } from './trade/context';
import { starterLine } from './trade/plans';
import type { Contract, League, MailSection, Position } from './types';
import { recentBodies, say, toldKeys, type Line } from './voice';

const fullName = (p: { firstName: string; lastName: string }) => `${p.firstName} ${p.lastName}`;
const millions = (k: number) => `$${(k / 1000).toFixed(1)}M`;
const NUMBER = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
const plural = (pos: Position) =>
  pos === 'OL'
    ? 'offensive linemen'
    : pos === 'EDGE'
      ? 'edge rushers'
      : pos === 'S'
        ? 'safeties'
        : `${POSITION_NAMES[pos].toLowerCase()}s`;
/** Room to grow, on our read, for "upside": the same gap the scouts use for a player still growing. */
const UPSIDE = 1.5;
/** Most wire rows the letter lists. */
const WIRE_MAX = 3;

/** Bodies a club can line up at a position this week: on the 53 and able to play. */
const bodies = (league: League, teamId: number, pos: Position) =>
  activeRoster(league, teamId).filter((p) => p.position === pos && isAvailable(p)).length;
const thin = (league: League, teamId: number, pos: Position) => bodies(league, teamId, pos) < ROSTER_TEMPLATE[pos];

/** Where we stand in the claim order for a player, and a word for our chances: thin clubs ahead of us want him too. */
export function wireChance(
  league: League,
  entry: WaiverEntry,
): { place: number; word: 'good chance' | 'maybe' | 'long shot' } {
  const order = waiverOrder(league);
  const place = order.indexOf(league.userTeamId) + 1;
  const pos = league.players[entry.playerId].position;
  const rivals = order.slice(0, place - 1).filter((t) => t !== entry.fromTeamId && thin(league, t, pos)).length;
  return { place, word: rivals === 0 ? 'good chance' : rivals <= 2 ? 'maybe' : 'long shot' };
}

const deal = (c: Contract | null, season: number) =>
  !c ? 'none' : `${yearsLeft(c, season)} yr, ${millions(capHit(c, season))}`;

/** What became of one result, in the director's words. */
function outcome(league: League, r: WaiverResult): string {
  const club = r.toTeamId === null ? null : league.teams[r.toTeamId];
  if (r.fromTeamId === league.userTeamId)
    return club
      ? `Claimed by the ${club.name}; his contract went with him.`
      : 'Cleared waivers: a free agent now, and his release stays on our cap.';
  if (r.toTeamId === league.userTeamId)
    return `Ours off waivers from the ${league.teams[r.fromTeamId].name}, on his deal.`;
  return `Our claim didn't win. ${r.userReason ?? ''}`.trim();
}

/** The id the old one-letter-per-result mail used: a claim we made (won or lost), else a release of ours. */
const resultKey = (league: League, r: WaiverResult) =>
  (r.toTeamId === league.userTeamId && r.fromTeamId !== league.userTeamId) || r.userReason
    ? `waiverClaim:${r.season}:${r.entryId}`
    : `waiverOut:${r.season}:${r.entryId}`;

interface WireFact {
  pos: Position;
  /** Bodies behind the starters at his position. */
  behind: number;
  age: number;
  /** He'd be raw for us today: under the league's median starter on our read. */
  raw: boolean;
  /** The age our scouts see him arriving by. */
  by: number;
  /** His ceiling on our read reaches a typical starter's: only then do we say "a starter". */
  starter: boolean;
}

const ordinal = (n: number) =>
  `${n}${[11, 12, 13].includes(n % 100) ? 'th' : (['th', 'st', 'nd', 'rd'][n % 10] ?? 'th')}`;
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const behindWords = (f: WireFact) =>
  `${NUMBER[f.behind] ?? f.behind} ${f.behind === 1 ? POSITION_NAMES[f.pos].toLowerCase() : plural(f.pos)}`;

const WIRE_NOTE: readonly Line<WireFact>[] = [
  {
    when: (f) => f.behind <= 0,
    reads: 2,
    text: (f) => `Nobody behind our starting ${plural(f.pos)}. He'd be the first man up the day someone goes down.`,
  },
  {
    when: (f) => f.raw && f.age <= 24 && f.starter,
    reads: 3,
    text: (f) => `${capital(behindWords(f))} behind the starters. Raw, but our scouts see a starter in him by ${f.by}.`,
  },
  {
    when: (f) => f.raw && f.age <= 24,
    reads: 2,
    text: (f) => `${capital(behindWords(f))} behind the starters. Raw, but he should be pushing for snaps by ${f.by}.`,
  },
  {
    when: (f) => f.raw && f.age <= 24,
    reads: 2,
    text: (f) => `${capital(behindWords(f))} behind the starters. He's a year or two away, and that's the point.`,
  },
  {
    when: (f) => !f.raw,
    reads: 1,
    text: (f) => `We're light at ${f.pos}, and he could play for us now. There's more in him than that, too.`,
  },
  {
    when: (f) => f.raw,
    reads: 1,
    text: (f) => `A project, but we're short of ${plural(f.pos)} and the ceiling is real.`,
  },
  { text: (f) => `We're thin at ${f.pos}, and our scouts like what's still to come from him.` },
];

const OPENER: readonly Line<{ settled: number; wire: number }>[] = [
  {
    when: (f) => f.settled > 0 && f.wire > 0,
    reads: 2,
    text: () => "Where the wire left our guys, and a few on it I'd put a claim in for.",
  },
  {
    when: (f) => f.settled > 0 && f.wire > 0,
    reads: 2,
    text: () => 'The wire settled overnight. Below is where everyone landed, then who I like on it now.',
  },
  {
    when: (f) => f.wire > 0,
    reads: 1,
    text: () => "A few names on the wire I'd put a claim in for. Claims settle before the next kickoff.",
  },
  {
    when: (f) => f.wire > 0,
    reads: 1,
    text: () => 'Some depth worth a look on the wire. Our place in line is next to each.',
  },
  { when: (f) => f.settled > 1, reads: 1, text: () => 'The wire settled. Here is where everyone landed.' },
  { text: () => 'The wire settled. Here is how it went.' },
];

/** The day's waiver letter, or nothing when there's nothing new. */
export function waiverMail(league: League, have: Set<string>): Draft[] {
  const state = league.personnel?.waivers;
  if (!state) return [];
  const user = league.userTeamId;
  const id = `waivers:${league.season}:${league.phase}:${league.week}`;
  if (have.has(id)) return [];
  const told = toldKeys(league);
  for (const k of have) told.add(k);
  const covered: string[] = [];

  const results = state.results.filter(
    (r) =>
      r.season === league.season &&
      league.players[r.playerId] &&
      (r.fromTeamId === user || r.toTeamId === user || !!r.userReason) &&
      !told.has(resultKey(league, r)),
  );
  const happened: MailSection['rows'] = results.map((r) => {
    covered.push(resultKey(league, r));
    const p = league.players[r.playerId];
    return {
      playerId: p.id,
      cells: [
        fullName(p),
        String(p.age),
        String(Math.round(perceive(league, user, p).ovr)),
        deal(p.contract, league.season),
        outcome(league, r),
      ],
    };
  });

  const line = starterLine(tradeContext(league));
  const weakest = (pos: Position) =>
    Math.min(
      ...activeRoster(league, user)
        .filter((p) => p.position === pos)
        .map((p) => perceive(league, user, p).ovr),
    );
  const sender = director(league);
  const recent = recentBodies(league, sender.from);
  const wire = state.pending
    .filter((e) => e.fromTeamId !== user && !told.has(`wire:${league.season}:${e.id}`))
    .map((e) => ({ e, p: league.players[e.playerId] }))
    .filter(({ p }) => p && !p.retired && thin(league, user, p.position))
    .map(({ e, p }) => ({ e, p, v: perceive(league, user, p) }))
    // Upside, not a starter: room to grow on our read (the scouts' own test for it) and a ceiling past the weakest
    // man we carry there, so in time he'd be an upgrade on our depth.
    .filter(
      ({ p, v }) => v.knowledge >= MIN_KNOWLEDGE && v.potMid - v.ovr >= UPSIDE && v.potMid >= weakest(p.position) + 0.5,
    )
    .sort(
      (a, b) =>
        ROSTER_TEMPLATE[b.p.position] -
          bodies(league, user, b.p.position) -
          (ROSTER_TEMPLATE[a.p.position] - bodies(league, user, a.p.position)) ||
        b.v.potMid - a.v.potMid ||
        a.p.id - b.p.id,
    )
    .slice(0, WIRE_MAX)
    .map(({ e, p, v }) => {
      covered.push(`wire:${league.season}:${e.id}`);
      const chance = wireChance(league, e);
      const fact: WireFact = {
        pos: p.position,
        behind: bodies(league, user, p.position) - STARTERS[p.position],
        age: p.age,
        raw: v.ovr < line[p.position],
        by: Math.max(p.age + 1, Math.min(p.age + 3, 25)),
        starter: v.potMid >= line[p.position],
      };
      return {
        playerId: p.id,
        cells: [
          fullName(p),
          String(p.age),
          String(Math.round(v.ovr)),
          deal(e.contract, league.season),
          `${capital(chance.word)} · ${ordinal(chance.place)} in line`,
        ],
        note: say(WIRE_NOTE, fact, { key: id, slot: `wire:${p.id}`, recent }),
        claim: { entryId: e.id },
      };
    });

  if (!happened.length && !wire.length) return [];
  const sections: MailSection[] = [];
  if (happened.length)
    sections.push({
      title: 'What happened',
      columns: ['Player', 'Age', 'Our read', 'Deal', 'What happened'],
      rows: happened,
    });
  if (wire.length)
    sections.push({
      title: 'On the wire now',
      lead: 'Worth a claim before the wire settles. Depth where we need it, and room to grow.',
      columns: ['Player', 'Age', 'Our read', 'Deal', 'Our chance'],
      rows: wire,
    });
  const subject =
    happened.length && wire.length
      ? `Waivers: ${happened.length} settled, ${wire.length} worth a claim`
      : happened.length
        ? `Waivers: ${happened.length === 1 ? 'one move' : `${happened.length} moves`} settled`
        : `On the wire: ${wire.length === 1 ? 'one' : NUMBER[wire.length]} worth a claim`;
  const text = say(OPENER, { settled: happened.length, wire: wire.length }, { key: id, slot: 'opener', recent });
  return [
    {
      id,
      season: league.season,
      phase: league.phase,
      week: league.week,
      ...sender,
      category: 'contracts',
      subject,
      body: text,
      sections,
      covered,
      actions: [{ kind: 'waivers' }],
    },
  ];
}

/** The letter still asks something while a player it named is on the wire and we haven't claimed him. */
export function waiverLetterNeedsYou(league: League, sections: MailSection[] | undefined): boolean {
  const state = league.personnel?.waivers;
  if (!state || !sections) return false;
  return sections.some((s) =>
    s.rows.some(
      (r) =>
        r.claim &&
        state.pending.some((e) => e.id === r.claim!.entryId) &&
        !state.claims.some((c) => c.entryId === r.claim!.entryId && c.teamId === league.userTeamId),
    ),
  );
}

/**
 * The claim a wire row's button puts in: ours, on that entry, with no release attached, last on our list; why it
 * can't go in (the waiver screen's own check), and whether it already has.
 */
export function wireClaim(
  league: League,
  entryId: number,
): { claim: WaiverClaim; problem: string | null; claimed: boolean } {
  const user = league.userTeamId;
  const claims = league.personnel?.waivers?.claims ?? [];
  const claim: WaiverClaim = {
    entryId,
    teamId: user,
    cutIds: [],
    preference: claims.filter((c) => c.teamId === user).length,
  };
  return {
    claim,
    problem: claimProblem(league, claim),
    claimed: claims.some((c) => c.teamId === user && c.entryId === entryId),
  };
}
