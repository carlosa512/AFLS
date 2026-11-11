/** A small briefing from current scouting reads and completed regular-season games. */
import { keyMatchups, type Matchup } from './inbox';
import type { League } from './types';
import { say, type Line } from './voice';

type Totals = {
  games: number;
  pass: number;
  attempts: number;
  dropbacks: number;
  sacks: number;
  rush: number;
  carries: number;
  allowedPass: number;
  facedPass: number;
  facedDropbacks: number;
  madeSacks: number;
  allowedRush: number;
  facedRush: number;
};
export interface MatchupFact {
  teamId: number;
  /** What the unit has done, as a verb phrase a sentence can follow "It" with: "allows a sack on 5.1% of dropbacks". */
  label: string;
  value: string;
  /** What its league rank is a rank in: "at preventing sacks", "in sacks". */
  place: string;
  rank: number | null;
  games: number;
}
export interface MatchupFocus {
  side: 'attack' | 'defend';
  matchup: Matchup;
  offenseId: number;
  defenseId: number;
  advantage: 'ours' | 'theirs' | null;
  /** What the edge rests on: our scouts' film, or only the season's results. */
  basis: 'film' | 'results' | null;
  /** A wide gap on film. */
  clear: boolean;
  /** Our unit first, whichever side of the ball it plays: "Our pass rush vs their offensive line". */
  heading: string;
  /** Whose matchup it is. "split": our scouts grade one side ahead and the stats this season favour the other. */
  tag: 'us' | 'them' | 'even' | 'split';
  /** "Edge: us", "Edge: them", "Even" or "Split". */
  label: string;
  /** What our scouts grade, then what the stats this season show, in the head coach's words. */
  why: string;
  /** Our unit's number this season and theirs; null until every club has played enough to rank. */
  ours: MatchupFact | null;
  theirs: MatchupFact | null;
  /** Whom the stats this season favour (four places or more apart), or that it is close; null without both ranks. */
  lean: 'us' | 'them' | 'close' | null;
}
function totals(l: League): Map<number, Totals> {
  const out = new Map(
    l.teams.map((t) => [
      t.id,
      {
        games: 0,
        pass: 0,
        attempts: 0,
        dropbacks: 0,
        sacks: 0,
        rush: 0,
        carries: 0,
        allowedPass: 0,
        facedPass: 0,
        facedDropbacks: 0,
        madeSacks: 0,
        allowedRush: 0,
        facedRush: 0,
      },
    ]),
  );
  for (const g of l.games) {
    if (g.season !== l.season || g.playoffRound || !g.result || g.week >= l.week) continue;
    for (const home of [true, false]) {
      const s = out.get(home ? g.homeId : g.awayId)!;
      const us = home ? g.result.home : g.result.away;
      const them = home ? g.result.away : g.result.home;
      s.games++;
      s.pass += us.passYds;
      s.attempts += us.passAtt;
      s.dropbacks += us.passAtt + us.sacked;
      s.sacks += us.sacked;
      s.rush += us.rushYds;
      s.carries += us.rushAtt;
      s.allowedPass += them.passYds;
      s.facedPass += them.passAtt;
      s.facedDropbacks += them.passAtt + them.sacked;
      s.madeSacks += them.sacked;
      s.allowedRush += them.rushYds;
      s.facedRush += them.rushAtt;
    }
  }
  return out;
}
function evidence(all: Map<number, Totals>, teamId: number, title: string, offense: boolean): MatchupFact | null {
  const s = all.get(teamId)!;
  const denominator = (x: Totals) =>
    title === 'Trenches'
      ? offense
        ? x.dropbacks
        : x.facedDropbacks
      : title === 'Run game'
        ? offense
          ? x.carries
          : x.facedRush
        : offense
          ? x.attempts
          : x.facedPass;
  const valid = (x: Totals) => x.games >= 3 && denominator(x) >= 30;
  if (!valid(s)) return null;
  const measure = (x: Totals) =>
    title === 'Trenches'
      ? (offense ? x.sacks : x.madeSacks) / denominator(x)
      : title === 'Run game'
        ? (offense ? x.rush : x.allowedRush) / denominator(x)
        : (offense ? x.pass : x.allowedPass) / denominator(x);
  const low = title === 'Trenches' ? offense : !offense;
  const value = measure(s);
  const qualified = [...all.values()].every(valid);
  const rank = qualified
    ? 1 + [...all.values()].filter((x) => (low ? measure(x) < value : measure(x) > value)).length
    : null;
  const amount =
    title === 'Trenches'
      ? `${(value * 100).toFixed(1)}% of dropbacks`
      : `${value.toFixed(1)} yards ${title === 'Run game' ? 'a carry' : 'an attempt'}`;
  const [verb, place] = PHRASES[title][offense ? 0 : 1];
  return { teamId, label: `${verb} ${amount}`, value: amount, place, rank, games: s.games };
}
/** How a contest's two numbers read, the offense's then the defense's: the verb before the amount, and what a rank is in. */
const PHRASES: Record<string, [[string, string], [string, string]]> = {
  Trenches: [
    ['allows a sack on', 'at preventing sacks'],
    ['gets a sack on', 'in sacks'],
  ],
  'Run game': [
    ['gains', 'in yards a carry'],
    ['allows', 'at stopping the run'],
  ],
  'Pass game': [
    ['gains', 'in yards an attempt'],
    ['allows', 'at defending the pass'],
  ],
};
/**
 * A contest's two units in full, the offense's then the defense's, each with the short name a second mention uses.
 * In full so nobody has to work out which side of the ball "line" or "front" is on.
 */
const UNITS: Record<string, [[string, string], [string, string]]> = {
  Trenches: [
    ['offensive line', 'line'],
    ['pass rush', 'rush'],
  ],
  'Run game': [
    ['run game', 'run game'],
    ['run defense', 'run defense'],
  ],
  'Pass game': [
    ['passing game', 'passing game'],
    ['coverage', 'coverage'],
  ],
};

/** What a line of the card may read: the two units, how far apart our scouts have them, and each one's number. */
export interface MatchupWords {
  /** Our unit and theirs in full, then the short names. */
  ours: string;
  theirs: string;
  our: string;
  their: string;
  /** "ahead of", or "well ahead of" for a wide gap on film. */
  ahead: string;
  mine?: { label: string; place: string; rank: number };
  them?: { label: string; place: string; rank: number };
}
const at = (f: MatchupWords['mine']) => `${ordinal(f!.rank)} ${f!.place}`;
const ranks = (c: MatchupWords) => `Our ${c.our} is ${at(c.mine)} and their ${c.their} is ${at(c.them)}.`;
const theirRanks = (c: MatchupWords) => `Their ${c.their} is ${at(c.them)} and our ${c.our} is ${at(c.mine)}.`;
const forUs = (c: MatchupWords) => `Our scouts grade our ${c.ours} ${c.ahead} their ${c.theirs}`;
const forThem = (c: MatchupWords) => `Our scouts grade their ${c.theirs} ${c.ahead} our ${c.ours}`;
const level = (c: MatchupWords) => `Our scouts see nothing between our ${c.ours} and their ${c.theirs}.`;

/**
 * The card's sentences by case, two or more ways each. Our scouts grade the players and the stats measure what they
 * have done, so the stats never make the scouts wrong: they agree, or a unit is performing above or below expectations.
 * Always "the stats this season"; no colon, no semicolon.
 */
export const MATCHUP_LINES: Record<string, ((c: MatchupWords) => string)[]> = {
  usAgree: [
    (c) => `${forUs(c)}, and the stats this season agree. ${ranks(c)}`,
    (c) => `${forUs(c)}. The stats this season back that up. ${ranks(c)}`,
  ],
  usTheyAbove: [
    (c) =>
      `${forUs(c)}. Their ${c.their} is performing above expectations this season. It ${c.them!.label}, ${ordinal(c.them!.rank)} in the league, and our ${c.our} is ${at(c.mine)}.`,
    (c) =>
      `${forUs(c)}. Their ${c.their} has performed above expectations this season. It ${c.them!.label}, which ranks ${ordinal(c.them!.rank)}, and our ${c.our} is ${at(c.mine)}.`,
  ],
  usWeBelow: [
    (c) =>
      `${forUs(c)}. Our ${c.our} is performing below expectations this season, ranked ${at(c.mine)}. Their ${c.their} is ${at(c.them)}.`,
    (c) =>
      `${forUs(c)}. Our ${c.our} has performed below expectations this season and sits ${at(c.mine)}. Their ${c.their} is ${at(c.them)}.`,
  ],
  usClose: [
    (c) => `${forUs(c)}. The stats this season have it close. ${ranks(c)}`,
    (c) => `${forUs(c)}. The stats this season show little between them. ${ranks(c)}`,
  ],
  us: [(c) => `${forUs(c)}.`],
  themAgree: [
    (c) => `${forThem(c)}, and the stats this season agree. ${theirRanks(c)}`,
    (c) => `${forThem(c)}. The stats this season back that up. ${theirRanks(c)}`,
  ],
  themWeAbove: [
    (c) =>
      `${forThem(c)}. Our ${c.our} is performing above expectations this season. It ${c.mine!.label}, ${ordinal(c.mine!.rank)} in the league, and their ${c.their} is ${at(c.them)}.`,
    (c) =>
      `${forThem(c)}. Our ${c.our} has performed above expectations this season. It ${c.mine!.label}, which ranks ${ordinal(c.mine!.rank)}, and their ${c.their} is ${at(c.them)}.`,
  ],
  themTheyBelow: [
    (c) =>
      `${forThem(c)}. Their ${c.their} is performing below expectations this season, ranked ${at(c.them)}. Our ${c.our} is ${at(c.mine)}.`,
    (c) =>
      `${forThem(c)}. Their ${c.their} has performed below expectations this season and sits ${at(c.them)}. Our ${c.our} is ${at(c.mine)}.`,
  ],
  themClose: [
    (c) => `${forThem(c)}. The stats this season have it close. ${theirRanks(c)}`,
    (c) => `${forThem(c)}. The stats this season show little between them. ${theirRanks(c)}`,
  ],
  them: [(c) => `${forThem(c)}.`],
  levelUs: [
    (c) => `${level(c)} The stats this season lean our way. ${ranks(c)}`,
    (c) => `${level(c)} The stats this season favor us. ${ranks(c)}`,
  ],
  levelThem: [
    (c) => `${level(c)} The stats this season lean their way. ${theirRanks(c)}`,
    (c) => `${level(c)} The stats this season favor them. ${theirRanks(c)}`,
  ],
  level: [(c) => level(c)],
};

/** Which bank fits: the film's side, then where the stats this season stand against it. */
function matchupCase(
  film: 'ours' | 'theirs' | null,
  lean: MatchupFocus['lean'],
  mine: number | undefined,
  theirs: number | undefined,
  clubs: number,
): keyof typeof MATCHUP_LINES {
  const top = (r?: number) => r !== undefined && r <= Math.ceil(clubs / 3);
  const bottom = (r?: number) => r !== undefined && r > Math.floor((2 * clubs) / 3);
  if (!film) return lean === 'us' ? 'levelUs' : lean === 'them' ? 'levelThem' : 'level';
  if (!lean) return film === 'ours' ? 'us' : 'them';
  if (film === 'ours') {
    if (lean === 'us') return 'usAgree';
    if (lean === 'them') return top(theirs) ? 'usTheyAbove' : 'usWeBelow';
    return bottom(mine) ? 'usWeBelow' : top(theirs) ? 'usTheyAbove' : 'usClose';
  }
  if (lean === 'them') return 'themAgree';
  if (lean === 'us') return top(mine) ? 'themWeAbove' : 'themTheyBelow';
  return bottom(theirs) ? 'themTheyBelow' : top(mine) ? 'themWeAbove' : 'themClose';
}
export const ordinal = (n: number) =>
  `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] ?? 'th')}`;
export function focusMatchups(l: League, opponent: number): MatchupFocus[] {
  const { attack, defend } = keyMatchups(l, opponent);
  const all = totals(l);
  const rows = [
    ...attack.map((matchup) => ({ side: 'attack' as const, matchup })),
    ...defend.map((matchup) => ({ side: 'defend' as const, matchup })),
  ].map((r) => ({ ...r, gap: (r.matchup.offense.score - r.matchup.defense.score) * (r.side === 'attack' ? 1 : -1) }));
  const sorted = [...rows].sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap));
  let chosen = [sorted[0]];
  if (Math.abs(sorted[0].gap) >= 0.2) {
    const next =
      sorted.find((r) => r !== sorted[0] && r.side !== sorted[0].side && Math.abs(r.gap) >= 0.12) ??
      sorted.find((r) => r !== sorted[0] && Math.abs(r.gap) >= 0.2);
    if (next) chosen.push(next);
  } else {
    const opportunity = [...rows].sort((a, b) => b.gap - a.gap)[0];
    if (opportunity.gap >= 0.08) chosen = [opportunity];
    else {
      const results = rows.map((r) => {
        const off = evidence(all, r.side === 'attack' ? l.userTeamId : opponent, r.matchup.title, true);
        const def = evidence(all, r.side === 'attack' ? opponent : l.userTeamId, r.matchup.title, false);
        return { r, gap: off?.rank && def?.rank ? (def.rank - off.rank) * (r.side === 'attack' ? 1 : -1) : 0 };
      });
      const opening = [...results].sort((a, b) => b.gap - a.gap)[0];
      const danger = [...results].sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap))[0];
      if (opening.gap >= 4) chosen = [opening.r];
      else if (Math.abs(danger.gap) >= 4) chosen = [danger.r];
    }
  }
  return chosen.map(({ side, matchup, gap }) => {
    const offenseId = side === 'attack' ? l.userTeamId : opponent;
    const defenseId = side === 'attack' ? opponent : l.userTeamId;
    const off = evidence(all, offenseId, matchup.title, true);
    const def = evidence(all, defenseId, matchup.title, false);
    const [mineFact, theirFact] = off && def ? (side === 'attack' ? [off, def] : [def, off]) : [null, null];
    const statGap = off?.rank && def?.rank ? (def.rank - off.rank) * (side === 'attack' ? 1 : -1) : 0;
    const lean: MatchupFocus['lean'] =
      off?.rank && def?.rank ? (statGap >= 4 ? 'us' : statGap <= -4 ? 'them' : 'close') : null;
    const film = gap >= 0.08 ? 'ours' : gap <= -0.08 ? 'theirs' : null;
    const advantage = film ?? (lean === 'us' ? 'ours' : lean === 'them' ? 'theirs' : null);
    const clear = Math.abs(gap) >= 0.4;
    const basis = film ? 'film' : advantage ? 'results' : null;
    // The film gives the edge. When the stats this season point the other way the card says so: it is split.
    const tag: MatchupFocus['tag'] =
      film && ((film === 'ours' && lean === 'them') || (film === 'theirs' && lean === 'us'))
        ? 'split'
        : advantage === 'ours'
          ? 'us'
          : advantage === 'theirs'
            ? 'them'
            : 'even';
    const label = { us: 'Edge: us', them: 'Edge: them', even: 'Even', split: 'Split' }[tag];
    // Our unit first, whichever side of the ball it plays, and each unit named in full.
    const [offUnit, defUnit] = UNITS[matchup.title] ?? [
      ['offense', 'offense'],
      ['defense', 'defense'],
    ];
    const [mine, theirs] = side === 'attack' ? [offUnit, defUnit] : [defUnit, offUnit];
    const heading = `Our ${mine[0]} vs their ${theirs[0]}`;
    const words: MatchupWords = {
      ours: mine[0],
      theirs: theirs[0],
      our: mine[1],
      their: theirs[1],
      ahead: clear ? 'well ahead of' : 'ahead of',
      ...(mineFact?.rank && theirFact?.rank
        ? {
            mine: { label: mineFact.label, place: mineFact.place, rank: mineFact.rank },
            them: { label: theirFact.label, place: theirFact.place, rank: theirFact.rank },
          }
        : {}),
    };
    const which = matchupCase(film, lean, words.mine?.rank, words.them?.rank, l.teams.length);
    const bank: Line<MatchupWords>[] = MATCHUP_LINES[which].map((text) => ({ text }));
    // The same report always reads the same, and a wording changes from week to week and opponent to opponent.
    const why = say(bank, words, { key: `matchup:${l.season}:${l.week}:${opponent}`, slot: heading });

    return {
      side,
      matchup,
      offenseId,
      defenseId,
      advantage,
      basis,
      clear,
      heading,
      tag,
      label,
      why,
      ours: mineFact,
      theirs: theirFact,
      lean,
    };
  });
}
