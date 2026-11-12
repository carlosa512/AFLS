/**
 * The words of SNN's big-day editions (`snnDays.ts` chooses the stories, this writes them). Each story is two
 * paragraphs of prose to the weekly edition's writing rules (`storyRules.ts`: it stops on a fact, two numbers a
 * sentence at most, a man's full name first) and the house rules for letters (`letterRules.ts`). Public facts only:
 * the pick, the consensus rank, the contract, the club. No sentence comes twice in a league year: each sentence is
 * picked around what SNN has already said (`at.said`). The second paragraph ends on the next fact on the calendar,
 * where a weekly story ends on the next fixture.
 */
import { coachName, teamCoaches } from './coaching';
import { yearsLeft } from './finance/contract';
import { gamesInWeek } from './league';
import { activeRoster } from './roster';
import { statLine } from './stats';
import { POSITION_NAMES } from './positions';
import { publicRecord, type StarWhy } from './publicStanding';
import { cap, possessive, referrer, type Referrer } from './refer';
import type { Day, DayCandidate } from './snnDays';
import type { CoachRole, EditionStory, InboxAction, Kickoff, League, Player, Position, StatKey } from './types';
import { around, sentencesOf, stableHash } from './voice';

interface Wording {
  editionId: string;
  said: string[];
}

const HEADLINE = 70;
const COUNT = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
const count = (n: number) => COUNT[n] ?? String(n);
const ORDINAL = ['', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh'];
/** "linebacker", "offensive lineman": the position as a word before a name. */
const posName = (pos: Position) => (pos === 'OL' ? 'offensive lineman' : POSITION_NAMES[pos].toLowerCase());
const posWord = (p: Player) => posName(p.position);
const full = (p: Player) => `${p.firstName} ${p.lastName}`;
const tag = (p: Player) => `${p.position} ${full(p)}`;

/**
 * One sentence (or two that belong together) for a slot: the first wording SNN has not used this league year, by a
 * stable order of the edition and the slot; the first of all when every one has been said. What is chosen is noted.
 */
function pick(l: League, at: Wording, slot: string, variants: (string | false | undefined)[]): string {
  const all = variants.filter((v): v is string => !!v);
  if (!all.length) return '';
  const { skip } = around(l, at.said);
  const start = stableHash(`${at.editionId}:${slot}`) % all.length;
  const order = [...all.slice(start), ...all.slice(0, start)];
  const text = order.find((t) => !skip(t)) ?? order[0];
  at.said.push(...sentencesOf(text));
  return text;
}

/** The headline, with a shorter form when the long one runs over. */
const head = (long: string, shorter: string) => (long.length <= HEADLINE ? long : shorter);

/** "No. 9 and a 2028 first-round pick", two numbers at most; else how many picks and the best of them. */
function gotWords(got: string[]): string {
  const say = (g: string) => {
    const m = /^(\d{4}) round (\d)$/.exec(g);
    return m ? `a ${m[1]} ${ORDINAL[Number(m[2])] ?? `round-${m[2]}`}-round pick` : g;
  };
  if (got.length === 1) return say(got[0]);
  if (got.length === 2) return `${say(got[0])} and ${say(got[1])}`;
  return `${count(got.length)} picks, the first of them ${say(got[0])}`;
}

/**
 * The fact a story stops on: the team's first game of the season, told one of a few ways so the same team's stories
 * across the offseason's editions do not end on the same sentence; its camp when the schedule is not out.
 */
function openerLine(l: League, at: Wording, ref: Referrer, teamId: number): string {
  const g = gamesInWeek(l, 1).find((x) => x.season === l.season && (x.homeId === teamId || x.awayId === teamId));
  const name = cap(ref.club(teamId));
  if (!g) return pick(l, at, `opener:${teamId}`, [`${name} report for camp next.`]);
  const home = g.homeId === teamId;
  const opp = l.teams[home ? g.awayId : g.homeId].name;
  const r = l.history.find((h) => h.season === l.season - 1)?.records[teamId];
  const where = home ? 'at home' : 'on the road';
  return pick(l, at, `opener:${teamId}`, [
    `${name} open the season ${where} against the ${opp}.`,
    `${name} play their first game against the ${opp}, ${where}.`,
    `The ${opp} are the first opponent for ${ref.city(teamId)}.`,
    r ? `${name} went ${r.w}–${r.l}${r.t ? `–${r.t}` : ''} last season.` : false,
    `${name} start ${where}, against the ${opp}.`,
  ]);
}

/** Where the consensus had him, as a sentence about a man already named. */
const rankLine = (last: string, c: { pick?: number; rank?: number }) =>
  c.rank === undefined
    ? ''
    : c.rank === c.pick
      ? `The consensus board had ${last} in the same place.`
      : `The consensus board had ${last} at No. ${c.rank}.`;

const draftTrades = (l: League) =>
  (l.market?.history ?? []).filter((r) => r.season === l.season && r.phase === 'draft').length;

interface Parts {
  kicker: string;
  headline: string;
  summary: string;
  first: string[];
  second: string[];
  numbers: EditionStory['numbers'];
  picture: EditionStory['picture'];
  links: InboxAction[];
  table?: EditionStory['table'];
  yours?: true;
}

const assemble = (
  c: Pick<DayCandidate, 'key' | 'angle' | 'tier' | 'clubId' | 'covers'>,
  ref: Referrer,
  x: Parts,
): EditionStory => ({
  key: c.key,
  kind: 'day',
  angle: c.angle,
  tier: c.tier,
  clubId: c.clubId,
  ...(x.yours ? { yours: true as const } : {}),
  kicker: x.kicker,
  headline: x.headline,
  summary: x.summary,
  picture: x.picture,
  cast: ref.named(),
  numbers: x.numbers.slice(0, 3),
  paragraphs: [x.first.filter(Boolean).join(' '), x.second.filter(Boolean).join(' ')],
  ...(x.table ? { table: x.table } : {}),
  links: x.links,
  ...(c.covers?.length ? { covers: c.covers } : {}),
});

const pickChips = (c: { pick?: number; rank?: number }): EditionStory['numbers'] => [
  ...(c.pick !== undefined ? [{ value: `No. ${c.pick}`, label: 'Pick' }] : []),
  ...(c.rank !== undefined ? [{ value: `No. ${c.rank}`, label: 'Consensus' }] : []),
];
const links = (p: Player, teamId: number): InboxAction[] => [
  { kind: 'player', playerId: p.id },
  { kind: 'team', teamId },
];

/** A Draft day story: the first pick, a trade up, the first quarterback, the wait, a pick ahead of the board, a haul. */
function draftStory(l: League, c: DayCandidate, at: Wording): EditionStory {
  const p = l.players[c.playerId!];
  const club = c.clubId;
  const ref = referrer(l, { playerIds: [p.id] });
  const Club = l.teams[club].name;
  const slot = (s: string) => `${c.key}:${s}`;
  // The club's next pick of this draft, when it made one: a fact to stop on before the opener.
  const later = Object.values(l.players)
    .filter((x) => x.draft?.season === l.season && x.draft.teamId === club && x.draft.pick > (c.pick ?? 0))
    .sort((a, b) => a.draft!.pick - b.draft!.pick)[0];

  if (c.angle === 'first') {
    const trades = draftTrades(l);
    const the = cap(ref.club(club));
    const man = ref.man(p.id);
    return assemble(c, ref, {
      kicker: 'Draft day',
      headline: head(`${Club} open the draft with ${tag(p)}`, `${Club} take ${p.lastName} first`),
      summary: [
        c.rank === 1
          ? `${p.lastName} was first on the consensus board too.`
          : `The consensus had ${p.lastName} at No. ${c.rank}.`,
        trades ? `Teams made ${trades} trades on the day.` : '',
      ]
        .filter(Boolean)
        .join(' '),
      first: [
        pick(l, at, slot('lede'), [
          `${the} used the first pick of the ${l.season} draft on ${posWord(p)} ${man}.`,
          `${the} opened the ${l.season} draft by taking ${posWord(p)} ${man}.`,
        ]),
        c.rank === 1 ? `He was first on the consensus board as well.` : rankLine(p.lastName, c),
      ],
      second: [
        trades
          ? pick(l, at, slot('trades'), [
              `Teams made ${trades} trades on the day.`,
              `There were ${trades} trades before the draft closed.`,
            ])
          : '',
        later
          ? `${cap(ref.club(club))} also took ${tag(later)} at No. ${later.draft!.pick}.`
          : openerLine(l, at, ref, club),
      ],
      numbers: [...pickChips(c), ...(trades ? [{ value: String(trades), label: 'Trades on the day' }] : [])],
      picture: { playerId: p.id },
      links: links(p, club),
    });
  }

  if (c.angle === 'up') {
    const the = cap(ref.club(club));
    const man = ref.man(p.id);
    const from = c.otherId !== undefined ? l.teams[c.otherId].name : '';
    // A heavy price is the headline once a day: a future first-round pick, or how many picks it took.
    const future = (c.got ?? []).some((g) => /^\d{4} round 1$/.test(g));
    const price = future ? 'a future first-round pick' : `${count(c.got?.length ?? 0)} picks`;
    return assemble(c, ref, {
      kicker: 'Trade up',
      headline:
        c.text === 'heavy'
          ? head(`${Club} trade ${price} to move up for ${p.lastName}`, `${Club} move up for ${p.lastName}`)
          : head(`${Club} move up to No. ${c.pick} for ${tag(p)}`, `${Club} move up for ${p.lastName}`),
      summary:
        from && c.got?.length ? `The ${from} got ${gotWords(c.got)} for the pick.` : `${Club} traded up for the pick.`,
      first: [
        pick(l, at, slot('lede'), [
          `${the} traded up to No. ${c.pick} and took ${posWord(p)} ${man}.`,
          `${the} moved up to No. ${c.pick} for ${posWord(p)} ${man}.`,
        ]),
        rankLine(p.lastName, c),
      ],
      second: [
        from && c.got?.length ? `The ${from} received ${gotWords(c.got)} in return.` : '',
        openerLine(l, at, ref, club),
      ],
      numbers: pickChips(c),
      picture: { playerId: p.id },
      links: links(p, club),
    });
  }

  if (c.angle === 'qb') {
    const the = cap(ref.club(club));
    const man = ref.man(p.id);
    const n = c.n ?? 1;
    return assemble(c, ref, {
      kicker: 'Quarterbacks',
      headline: head(
        n > 1
          ? `${full(p)} is the first quarterback taken, at No. ${c.pick}`
          : `${Club} take quarterback ${full(p)} at No. ${c.pick}`,
        `${p.lastName} is the first quarterback taken`,
      ),
      summary:
        n > 1
          ? `${cap(count(n))} quarterbacks went in the first round. ${p.lastName} was the first, to the ${Club}.`
          : `${p.lastName} was the only quarterback taken in the first round.`,
      first: [
        pick(l, at, slot('lede'), [
          `${the} made ${man} the first quarterback taken, at No. ${c.pick}.`,
          `${the} took quarterback ${man} at No. ${c.pick}, before any other passer was chosen.`,
        ]),
        n > 1
          ? `${cap(count(n))} quarterbacks went in the first round.`
          : `He was the only quarterback taken in the first round.`,
      ],
      second: [rankLine(p.lastName, c), openerLine(l, at, ref, club)],
      numbers: [...pickChips(c), ...(n > 1 ? [{ value: String(n), label: 'Quarterbacks in round one' }] : [])],
      picture: { playerId: p.id },
      links: links(p, club),
    });
  }

  if (c.angle === 'wait') {
    const man = ref.man(p.id);
    const the = cap(ref.club(club));
    return assemble(c, ref, {
      kicker: 'The wait',
      headline: head(`${full(p)} lasts until No. ${c.pick}`, `${p.lastName} lasts until No. ${c.pick}`),
      summary: `The consensus had the ${posWord(p)} at No. ${c.rank}. The ${Club} ended his wait.`,
      first: [
        pick(l, at, slot('lede'), [
          `${cap(posWord(p))} ${man} was No. ${c.rank} on the consensus board and was still there at No. ${c.pick}.`,
          `${cap(posWord(p))} ${man} was ranked No. ${c.rank} by the consensus and waited until No. ${c.pick}.`,
        ]),
        `${the} took him.`,
      ],
      second: [
        // Only the furthest fall of the day is called that.
        c.text === 'most'
          ? pick(l, at, slot('why'), [
              `No player in the first two rounds went further below his ranking.`,
              `It was the longest wait of any player ranked in the first two rounds.`,
            ])
          : `${p.lastName} went ${(c.pick ?? 0) - (c.rank ?? 0)} places after his ranking.`,
        openerLine(l, at, ref, club),
      ],
      numbers: pickChips(c),
      picture: { playerId: p.id },
      links: links(p, club),
    });
  }

  if (c.angle === 'ahead') {
    const the = cap(ref.club(club));
    const man = ref.man(p.id);
    return assemble(c, ref, {
      kicker: 'Ahead of the board',
      headline: head(`${Club} take ${tag(p)} at No. ${c.pick}`, `${Club} take ${p.lastName} at No. ${c.pick}`),
      summary:
        c.text === 'most'
          ? `The consensus had ${p.lastName} at No. ${c.rank}, the widest gap in the first round.`
          : `The consensus had ${p.lastName} at No. ${c.rank}.`,
      first: [
        pick(l, at, slot('lede'), [
          `${the} took ${posWord(p)} ${man} at No. ${c.pick}.`,
          `${the} used the No. ${c.pick} pick on ${posWord(p)} ${man}.`,
        ]),
        rankLine(p.lastName, c),
      ],
      second: [
        c.text === 'most'
          ? pick(l, at, slot('why'), [
              `It was the widest gap between a pick and his ranking in the first round.`,
              `No first-round pick went further ahead of his ranking.`,
            ])
          : `${p.lastName} went ${(c.rank ?? 0) - (c.pick ?? 0)} places ahead of his ranking.`,
        openerLine(l, at, ref, club),
      ],
      numbers: pickChips(c),
      picture: { playerId: p.id },
      links: links(p, club),
    });
  }

  // 'haul': the most picks in the first two rounds.
  const the = cap(ref.club(club));
  const man = ref.man(p.id);
  const n = c.n ?? 0;
  return assemble(c, ref, {
    kicker: 'Draft day',
    headline: `${Club} make ${count(n)} picks in the first two rounds`,
    summary: `No team made more picks in the first two rounds. The first was ${tag(p)} at No. ${c.pick}.`,
    first: [
      `${the} made ${count(n)} picks in the first two rounds, more than any other team.`,
      `The first was ${posWord(p)} ${man} at No. ${c.pick}.`,
    ],
    second: [rankLine(p.lastName, c), openerLine(l, at, ref, club)],
    numbers: [{ value: String(n), label: 'Picks in rounds 1–2' }, ...pickChips(c)].slice(0, 3),
    picture: { playerId: p.id },
    links: links(p, club),
  });
}

const STAT_WORDS: Partial<Record<StatKey, string>> = {
  passYds: 'passing yards',
  rushYds: 'rushing yards',
  recYds: 'receiving yards',
  sacks: 'sacks',
  defInt: 'interceptions',
};
/** Why he is a name, as one sentence about a man already named: last season's honor or his place among the leaders. */
function whyLine(last: string, why: StarWhy | null): string {
  if (!why) return '';
  if (why.kind === 'award') return `${last} won one of the league's awards last season.`;
  if (why.kind === 'allLeague') return `${last} was named All-League last season.`;
  if (why.kind === 'passer') return `${last} was the quarterback of a winning team last season.`;
  return `${last} was in the league's top five in ${STAT_WORDS[why.stat] ?? 'his category'} last season.`;
}
const rec = (r: { w: number; l: number; t: number }) => `${r.w}–${r.l}${r.t ? `–${r.t}` : ''}`;
const lastRecord = (l: League, teamId: number) => l.history.find((h) => h.season === l.season - 1)?.records[teamId];
/** A team's record last season as a sentence, one of a few ways so two editions about it do not share one. */
function wentLine(l: League, at: Wording, name: string, teamId: number): string {
  const r = lastRecord(l, teamId);
  if (!r) return '';
  return pick(l, at, `went:${teamId}`, [
    `${name} went ${rec(r)} last season.`,
    `${name} finished last season ${rec(r)}.`,
    `${name} were ${rec(r)} last season.`,
  ]);
}
/** "four years and $96 million": the years in words, so the sentence carries one number. */
const dealWords = (d: { years: number; total: number }) =>
  `${count(d.years)} year${d.years === 1 ? '' : 's'} and $${Math.round(d.total / 1000)} million`;
const ROLE: Record<CoachRole, string> = {
  headCoach: 'head coach',
  offCoord: 'offensive coordinator',
  defCoord: 'defensive coordinator',
  stCoord: 'special teams coordinator',
  positionCoach: 'a position coach',
  strengthCoach: 'strength coach',
};

const recordOf = (l: League, teamId: number, season: number) =>
  l.history.find((h) => h.season === season)?.records[teamId];
const madePlayoffs = (l: League, teamId: number) =>
  !!l.history.find((h) => h.season === l.season - 1)?.playoffs?.[teamId];
/** How many losing seasons in a row a team has had, counting back from last season. */
function teamLosingRun(l: League, teamId: number): number {
  let n = 0;
  for (let season = l.season - 1; ; season--) {
    const r = recordOf(l, teamId, season);
    if (!r || r.w >= r.l) return n;
    n++;
  }
}

/**
 * Who starts the league year needing results: a head coach kept after a run of losing seasons, or a general manager
 * the owners' review put on notice, told as reporting ("league sources say") since the review itself is private.
 */
function pressureStory(l: League, c: DayCandidate, at: Wording): EditionStory {
  const club = c.clubId;
  const ref = referrer(l, { playerIds: [] });
  const Club = l.teams[club].name;
  const slot = (s: string) => `${c.key}:${s}`;
  const last = lastRecord(l, club);
  const the = ref.club(club);
  const record = wentLine(l, at, cap(ref.city(club)), club);
  const numbers: EditionStory['numbers'] = last ? [{ value: rec(last), label: 'Last season' }] : [];
  if (c.angle === 'seat') {
    const coach = l.coaches[c.coachId!];
    const name = coachName(coach);
    const n = c.n ?? 2;
    const years = (coach.career ?? []).filter(
      (x) => x.teamId === club && x.role === 'headCoach' && x.season < l.season,
    );
    return assemble(c, ref, {
      kicker: 'Under pressure',
      headline: head(`${Club} keep ${name} after ${count(n)} losing seasons`, `${Club} keep ${coach.lastName}`),
      summary: last ? `The ${Club} went ${rec(last)} last season.` : `${coach.lastName} is back as head coach.`,
      first: [
        pick(l, at, slot('lede'), [
          `${name} is back as head coach of ${the} after ${count(n)} losing seasons in a row.`,
          `${cap(the)} have kept head coach ${name} after ${count(n)} losing seasons in a row.`,
        ]),
        record,
      ],
      second: [
        `This is ${possessive(coach.lastName)} ${ORDINAL[years.length + 1] ?? `${years.length + 1}th`} season in the job.`,
        openerLine(l, at, ref, club),
      ],
      numbers: [...numbers, { value: String(n), label: 'Losing seasons in a row' }],
      picture: { coachId: coach.id, teamIds: [club] },
      links: [{ kind: 'team', teamId: club }],
    });
  }
  const gm = l.gms[c.gmId!];
  const name = `${gm.firstName} ${gm.lastName}`;
  const since = gm.appointments.at(-1)?.start.season;
  const hc = teamCoaches(l, club).find((x) => x.role === 'headCoach');
  return assemble(c, ref, {
    kicker: 'Under pressure',
    headline: head(`${Club} want progress from GM ${name}`, `${Club} want progress from ${gm.lastName}`),
    summary: last ? `The ${Club} went ${rec(last)} last season.` : `${gm.lastName} is the general manager.`,
    first: [
      pick(l, at, slot('lede'), [
        `League sources say ${the} want a better season from general manager ${name}.`,
        `General manager ${name} has been told ${the} must improve this season, league sources say.`,
      ]),
      record,
    ],
    second: [
      since !== undefined && since < l.season ? `${gm.lastName} has been general manager since ${since}.` : '',
      hc ? `${coachName(hc)} is the head coach.` : '',
      openerLine(l, at, ref, club),
    ],
    numbers,
    picture: { teamIds: [club] },
    links: [{ kind: 'team', teamId: club }, { kind: 'gms' }],
  });
}

/** What went back in a trade: the players by name, the picks by year and round, two numbers at most. */
function backWords(l: League, ref: Referrer, back: NonNullable<DayCandidate['back']>, picksSent: number): string {
  const pickWord = (x: { season: number; round: number }) =>
    `a ${x.season} ${ORDINAL[x.round] ?? `round-${x.round}`}-round pick`;
  const picks = [...back.picks].sort((a, b) => a.round - b.round || a.season - b.season);
  const players = back.players.map((id) => l.players[id]);
  if (!players.length) {
    if (!picks.length) return picksSent ? `${count(picksSent)} draft pick${picksSent === 1 ? '' : 's'}` : '';
    if (picks.length === 1) return pickWord(picks[0]);
    if (picks.length === 2) return `${pickWord(picks[0])} and ${pickWord(picks[1])}`;
    return `${count(picks.length)} picks, the highest of them ${pickWord(picks[0])}`;
  }
  const others = players.length - 1;
  const parts = [
    `${posWord(players[0])} ${ref.man(players[0].id)}`,
    others ? `${count(others)} other player${others === 1 ? '' : 's'}` : '',
    picks.length === 1 ? pickWord(picks[0]) : picks.length ? `${count(picks.length)} picks` : '',
  ].filter(Boolean);
  return parts.length === 3 ? `${parts[0]}, ${parts[1]} and ${parts[2]}` : parts.join(' and ');
}

/** A star traded: who got him, why he is a name, and what went back. */
function tradeStory(l: League, c: DayCandidate, at: Wording): EditionStory {
  const p = l.players[c.playerId!];
  const club = c.clubId;
  const ref = referrer(l, { playerIds: [p.id, ...(c.back?.players ?? [])] });
  const Club = l.teams[club].name;
  const From = l.teams[c.otherId!].name;
  const slot = (s: string) => `${c.key}:${s}`;
  const the = cap(ref.club(club));
  const man = ref.man(p.id);
  const back = c.back ? backWords(l, ref, c.back, c.n ?? 0) : '';
  return assemble(c, ref, {
    kicker: 'Trade',
    headline: head(`${Club} trade for ${tag(p)}`, `${Club} trade for ${p.lastName}`),
    summary: back ? `The ${From} get ${back}.` : `He comes from the ${From}.`,
    first: [
      pick(l, at, slot('lede'), [
        `${the} have traded for ${posWord(p)} ${man}.`,
        `${the} acquired ${posWord(p)} ${man} in a trade.`,
      ]),
      whyLine(p.lastName, publicRecord(l).why(p)),
    ],
    second: [
      back ? `The ${From} received ${back} in return.` : `${p.lastName} comes from the ${From}.`,
      openerLine(l, at, ref, club),
    ],
    numbers: [{ value: String(p.age), label: 'Age' }],
    picture: { playerId: p.id },
    links: links(p, club),
  });
}

/** A change at the top: the new head coach or general manager, the one he replaces, and the record he inherits. */
function topStory(l: League, c: DayCandidate, at: Wording): EditionStory {
  const club = c.clubId;
  const ref = referrer(l, { playerIds: [] });
  const Club = l.teams[club].name;
  const slot = (s: string) => `${c.key}:${s}`;
  const last = lastRecord(l, club);
  const out = c.text ?? '';
  // Named once here: a wording that is not chosen must not use up the first mention.
  const the = ref.club(club);
  const record = wentLine(l, at, cap(ref.city(club)), club);
  if (c.angle === 'coach') {
    const coach = l.coaches[c.coachId!];
    const name = coachName(coach);
    const before = (coach.career ?? []).filter((x) => x.season < l.season).sort((a, b) => b.season - a.season)[0];
    const from = !before
      ? `It is his first job in the league.`
      : before.teamId === club
        ? `He was already on the ${possessive(Club)} staff.`
        : `He was ${ROLE[before.role]} with the ${l.teams[before.teamId].name} in ${before.season}.`;
    // What he comes from, when it was a winning team, and what he walks into.
    const then = before && before.teamId !== club ? recordOf(l, before.teamId, before.season) : undefined;
    const pedigree =
      then && then.w > then.l ? `The ${l.teams[before!.teamId].name} went ${rec(then)} that season.` : '';
    const run = teamLosingRun(l, club);
    const expects = madePlayoffs(l, club)
      ? `${coach.lastName} takes over a team that reached the playoffs last season.`
      : run >= 2
        ? `The ${Club} have had ${count(run)} losing seasons in a row.`
        : '';
    return assemble(c, ref, {
      kicker: 'New in charge',
      headline: head(`${Club} hire ${name} as head coach`, `${Club} hire ${coach.lastName}`),
      summary: [out ? `He replaces ${out}.` : '', last ? `The ${Club} went ${rec(last)} last season.` : '']
        .filter(Boolean)
        .join(' '),
      first: [
        pick(l, at, slot('lede'), [
          `${name} is the new head coach of ${the}.`,
          `${cap(the)} have hired ${name} as head coach.`,
        ]),
        from,
        pedigree,
      ],
      second: [out ? `He replaces ${out}.` : '', record, expects, openerLine(l, at, ref, club)],
      numbers: last ? [{ value: rec(last), label: 'Last season' }] : [],
      picture: { coachId: coach.id, teamIds: [club] },
      links: [{ kind: 'team', teamId: club }],
    });
  }
  const gm = l.gms[c.gmId!];
  const name = `${gm.firstName} ${gm.lastName}`;
  return assemble(c, ref, {
    kicker: 'New in charge',
    headline: head(`${Club} name ${name} general manager`, `${Club} name ${gm.lastName} GM`),
    summary: [out ? `${gm.lastName} replaces ${out}.` : '', last ? `The ${Club} went ${rec(last)} last season.` : '']
      .filter(Boolean)
      .join(' '),
    first: [
      pick(l, at, slot('lede'), [
        `${name} is the new general manager of ${the}.`,
        `${cap(the)} have named ${name} their general manager.`,
      ]),
      out ? `${gm.lastName} replaces ${out}.` : '',
    ],
    second: [record, openerLine(l, at, ref, club)],
    numbers: last ? [{ value: rec(last), label: 'Last season' }] : [],
    picture: { teamIds: [club] },
    links: [{ kind: 'team', teamId: club }, { kind: 'gms' }],
  });
}

/** A new-league-year story about one player: tagged, released, re-signed or free, or the team that lost the most. */
function yearStory(l: League, c: DayCandidate, at: Wording): EditionStory {
  const p = l.players[c.playerId!];
  const club = c.clubId;
  const ref = referrer(l, { playerIds: [p.id] });
  const Club = l.teams[club].name;
  const slot = (s: string) => `${c.key}:${s}`;
  const why = whyLine(p.lastName, publicRecord(l).why(p));
  const base = { picture: { playerId: p.id }, links: links(p, club), numbers: [] as EditionStory['numbers'] };

  if (c.angle === 'tag') {
    const the = cap(ref.club(club));
    const man = ref.man(p.id);
    return assemble(c, ref, {
      ...base,
      kicker: 'Tagged',
      headline: head(`${Club} use the franchise tag on ${tag(p)}`, `${Club} tag ${p.lastName}`),
      summary: `${p.lastName} stays with the ${Club} for at least one more season.`,
      first: [
        pick(l, at, slot('lede'), [
          `${the} used the franchise tag on ${posWord(p)} ${man}.`,
          `${the} put the franchise tag on ${posWord(p)} ${man} before free agency opened.`,
        ]),
        why,
      ],
      second: [
        pick(l, at, slot('means'), [
          `The tag keeps ${p.lastName} off the market for one more season.`,
          `${p.lastName} would have been a free agent without it.`,
        ]),
        openerLine(l, at, ref, club),
      ],
    });
  }

  if (c.angle === 'released') {
    const the = cap(ref.club(club));
    const man = ref.man(p.id);
    return assemble(c, ref, {
      ...base,
      kicker: 'Released',
      headline: head(`${Club} release ${tag(p)}`, `${Club} release ${p.lastName}`),
      summary: `${p.lastName} is a free agent and can sign with any team.`,
      first: [
        pick(l, at, slot('lede'), [
          `${the} released ${posWord(p)} ${man}.`,
          `${the} have let ${posWord(p)} ${man} go.`,
        ]),
        why,
      ],
      second: [`He is a free agent and can sign with any team.`, `${p.lastName} is ${p.age}.`],
      numbers: [{ value: String(p.age), label: 'Age' }],
    });
  }

  if (c.angle === 'kept') {
    const the = cap(ref.club(club));
    const man = ref.man(p.id);
    return assemble(c, ref, {
      ...base,
      kicker: 'Staying',
      headline: head(`${Club} re-sign ${tag(p)}`, `${Club} re-sign ${p.lastName}`),
      summary: c.deal
        ? `The deal is for ${dealWords(c.deal)}. He never reached the market.`
        : `${p.lastName} never reached the market.`,
      first: [
        pick(l, at, slot('lede'), [
          `${the} re-signed ${posWord(p)} ${man} before he reached the market.`,
          `${the} kept ${posWord(p)} ${man} off the market with a new contract.`,
        ]),
        c.deal ? `The deal is for ${dealWords(c.deal)}.` : '',
      ],
      second: [why, openerLine(l, at, ref, club)],
      numbers: c.deal
        ? [
            { value: String(c.deal.years), label: c.deal.years === 1 ? 'Year' : 'Years' },
            { value: `$${Math.round(c.deal.total / 1000)}M`, label: 'Total' },
          ]
        : [],
    });
  }

  if (c.angle === 'market') {
    const man = ref.man(p.id);
    const old = ref.club(club);
    return assemble(c, ref, {
      ...base,
      kicker: 'On the market',
      headline: head(`${tag(p)} reaches free agency`, `${p.lastName} reaches free agency`),
      summary: `The ${Club} let his contract run out. Any team can sign him.`,
      first: [
        pick(l, at, slot('lede'), [
          `${cap(posWord(p))} ${man} is a free agent after ${old} let his contract run out.`,
          `${cap(posWord(p))} ${man} has reached free agency, and ${old} did not re-sign or tag him.`,
        ]),
        why,
      ],
      second: [
        pick(l, at, slot('means'), [`Any team can sign him from today.`, `He can now sign with any team.`]),
        `${p.lastName} is ${p.age}.`,
      ],
      numbers: [{ value: String(p.age), label: 'Age' }],
    });
  }

  // 'lost': the team that let the most of last season's starters reach the market.
  const n = c.n ?? 0;
  const the = cap(ref.club(club));
  const man = ref.man(p.id);
  return assemble(c, ref, {
    ...base,
    kicker: 'On the market',
    headline: `${Club} let ${count(n)} starters reach free agency`,
    summary: `No team let more of last season's starters reach the market. The best known is ${tag(p)}.`,
    first: [
      `${the} let ${count(n)} of last season's starters reach free agency, more than any other team.`,
      `The best known is ${posWord(p)} ${man}.`,
    ],
    second: [why, openerLine(l, at, ref, club)],
    numbers: [{ value: String(n), label: 'Starters on the market' }],
  });
}

const dealChips = (d: { years: number; total: number } | undefined): EditionStory['numbers'] =>
  d
    ? [
        { value: String(d.years), label: d.years === 1 ? 'Year' : 'Years' },
        { value: `$${Math.round(d.total / 1000)}M`, label: 'Total' },
      ]
    : [];

/** A free agency story: a star who moved, the richest deal, a team's haul or its losses, a return, who is still out there. */
function marketStory(l: League, c: DayCandidate, at: Wording): EditionStory {
  const p = l.players[c.playerId!];
  const club = c.clubId;
  const ref = referrer(l, { playerIds: [p.id] });
  const Club = l.teams[club].name;
  const slot = (s: string) => `${c.key}:${s}`;
  const why = whyLine(p.lastName, publicRecord(l).why(p));
  const old = c.otherId !== undefined ? l.teams[c.otherId].name : '';
  const deal = c.deal ? `The deal is for ${dealWords(c.deal)}.` : '';
  const base = { picture: { playerId: p.id }, links: links(p, club) };

  if (c.angle === 'moved') {
    const the = cap(ref.club(club));
    const man = ref.man(p.id);
    return assemble(c, ref, {
      ...base,
      kicker: 'Free agency',
      headline: head(`${Club} sign ${tag(p)}`, `${Club} sign ${p.lastName}`),
      summary: [old ? `${p.lastName} played for the ${old} last season.` : '', deal].filter(Boolean).join(' '),
      first: [
        pick(l, at, slot('lede'), [
          old
            ? `${the} signed ${posWord(p)} ${man}, who played for the ${old} last season.`
            : `${the} signed ${posWord(p)} ${man}.`,
          old ? `${the} took ${posWord(p)} ${man} from the ${old} in free agency.` : false,
        ]),
        deal,
      ],
      second: [why, openerLine(l, at, ref, club)],
      numbers: dealChips(c.deal),
    });
  }

  if (c.angle === 'richest') {
    const the = cap(ref.club(club));
    const man = ref.man(p.id);
    return assemble(c, ref, {
      ...base,
      kicker: 'The richest deal',
      headline: head(`${full(p)} signs the richest deal of free agency`, `${p.lastName} signs the richest deal`),
      summary: [`He signed with the ${Club}.`, deal].filter(Boolean).join(' '),
      first: [
        pick(l, at, slot('lede'), [
          `${the} gave ${posWord(p)} ${man} the richest contract of free agency.`,
          `No free agent signed for more than ${posWord(p)} ${man}, who joined ${ref.club(club)}.`,
        ]),
        deal,
      ],
      second: [
        old && c.otherId !== club ? `${p.lastName} played for the ${old} last season.` : '',
        openerLine(l, at, ref, club),
      ],
      numbers: dealChips(c.deal),
    });
  }

  if (c.angle === 'haul' || c.angle === 'lostMarket') {
    const n = c.n ?? 0;
    const the = cap(ref.club(club));
    const man = ref.man(p.id);
    const haul = c.angle === 'haul';
    return assemble(c, ref, {
      ...base,
      kicker: 'Free agency',
      headline: haul
        ? `${Club} sign ${count(n)} of last season's starters`
        : `${Club} lose ${count(n)} starters in free agency`,
      summary: haul
        ? `No team signed more players who started elsewhere last season. The best known is ${tag(p)}.`
        : `No team lost more of last season's starters. ${cap(posWord(p))} ${full(p)} was one of them.`,
      first: haul
        ? [
            `${the} signed ${count(n)} players who started for other teams last season, more than anyone else.`,
            `The best known is ${posWord(p)} ${man}.`,
          ]
        : [
            `${the} lost ${count(n)} of last season's starters to other teams in free agency, more than anyone else.`,
            old ? `${cap(posWord(p))} ${man} signed with the ${old}.` : `${cap(posWord(p))} ${man} was one of them.`,
          ],
      second: [why, openerLine(l, at, ref, club)],
      numbers: [{ value: String(n), label: haul ? 'Starters signed' : 'Starters lost' }],
    });
  }

  if (c.angle === 'home') {
    const the = ref.club(club);
    const man = ref.man(p.id);
    return assemble(c, ref, {
      ...base,
      kicker: 'A return',
      headline: head(`${full(p)} returns to the ${Club}`, `${p.lastName} returns to the ${Club}`),
      summary: `${p.lastName} has played for the ${Club} before.`,
      first: [`${cap(posWord(p))} ${man} has signed with ${the}, a team he has played for before.`, deal],
      second: [why, openerLine(l, at, ref, club)],
      numbers: dealChips(c.deal),
    });
  }

  // 'unsigned': the best player nobody has signed.
  const man = ref.man(p.id);
  return assemble(c, ref, {
    ...base,
    kicker: 'Still unsigned',
    headline: head(`${tag(p)} is still unsigned`, `${p.lastName} is still unsigned`),
    summary: `${p.lastName} played for the ${Club} last season and has not signed anywhere.`,
    first: [
      pick(l, at, slot('lede'), [
        `${cap(posWord(p))} ${man} has not signed with anyone after the first week of free agency.`,
        `${cap(posWord(p))} ${man} is still a free agent a week after the market opened.`,
      ]),
      why,
    ],
    second: [`He played for ${ref.club(club)} last season.`, `${p.lastName} is ${p.age}.`],
    numbers: [{ value: String(p.age), label: 'Age' }],
  });
}

/** A cut-down day story: a player released as rosters went to 53, or the rookies nobody drafted who made one. */
function cutsStory(l: League, c: DayCandidate, at: Wording): EditionStory {
  const p = l.players[c.playerId!];
  const club = c.clubId;
  const ref = referrer(l, { playerIds: [p.id] });
  const Club = l.teams[club].name;
  const slot = (s: string) => `${c.key}:${s}`;
  const the = cap(ref.club(club));
  const man = ref.man(p.id);
  const base = { picture: { playerId: p.id }, links: links(p, club) };
  if (c.angle === 'undrafted') {
    const n = c.n ?? 1;
    return assemble(c, ref, {
      ...base,
      kicker: 'Made the 53',
      headline: n === 1 ? `One undrafted rookie makes a roster` : `${cap(count(n))} undrafted rookies make a roster`,
      summary: `${cap(posWord(p))} ${full(p)} of the ${Club} is one of them.`,
      first: [
        n === 1
          ? `One rookie nobody drafted made a roster as teams cut to 53 players.`
          : `${cap(count(n))} rookies nobody drafted made a roster as teams cut to 53 players.`,
        `${cap(posWord(p))} ${man} is one of them, with ${ref.club(club)}.`,
      ],
      second: [openerLine(l, at, ref, club)],
      numbers: [{ value: String(n), label: 'Undrafted rookies on a 53' }],
    });
  }
  if (c.angle === 'holdout') {
    const left = p.contract ? yearsLeft(p.contract, l.season) : 0;
    const games = statLine(p, l.season - 1)?.gp ?? 0;
    const why =
      whyLine(p.lastName, publicRecord(l).why(p)) ||
      (games ? `${p.lastName} played in ${games} games for the team last season.` : '');
    return assemble(c, ref, {
      ...base,
      kicker: 'Holdout',
      headline: head(`${tag(p)} has not reported to the ${Club}`, `${p.lastName} has not reported to the ${Club}`),
      summary: `The ${Club} cut to 53 players without him.`,
      first: [
        pick(l, at, slot('lede'), [
          `${cap(posWord(p))} ${man} has not reported to ${ref.club(club)}.`,
          `${the} cut to 53 players without ${posWord(p)} ${man}, who has not reported to the team.`,
        ]),
        why,
      ],
      second: [
        left ? `${p.lastName} has ${count(left)} year${left === 1 ? '' : 's'} left on his contract.` : '',
        openerLine(l, at, ref, club),
      ],
      numbers: left
        ? [{ value: String(left), label: left === 1 ? 'Year left on his deal' : 'Years left on his deal' }]
        : [],
    });
  }
  if (c.angle === 'position') {
    const from = posName(c.text as Position);
    const to = posWord(p);
    return assemble(c, ref, {
      ...base,
      kicker: 'New position',
      headline: head(`${Club} move ${full(p)} from ${from} to ${to}`, `${Club} move ${p.lastName} to ${to}`),
      summary: `He played ${from} last season.`,
      first: [
        pick(l, at, slot('lede'), [
          `${the} have moved ${man} from ${from} to ${to}.`,
          `${man} has moved from ${from} to ${to} for ${ref.club(club)}.`,
        ]),
        whyLine(p.lastName, publicRecord(l).why(p)),
      ],
      second: [openerLine(l, at, ref, club)],
      numbers: [{ value: String(p.age), label: 'Age' }],
    });
  }
  const line = statLine(p, l.season - 1);
  const fact =
    c.angle === 'cutStar'
      ? whyLine(p.lastName, publicRecord(l).why(p))
      : c.angle === 'cutPick' && p.draft
        ? `${p.lastName} was a ${ORDINAL[p.draft.round]}-round pick in ${p.draft.season}.`
        : line?.gp
          ? `${p.lastName} played in ${line.gp} games last season.`
          : '';
  return assemble(c, ref, {
    ...base,
    kicker: 'Released',
    headline: head(`${Club} release ${tag(p)}`, `${Club} release ${p.lastName}`),
    summary: [fact, `He is a free agent.`].filter(Boolean).join(' '),
    first: [
      pick(l, at, slot('lede'), [
        `${the} released ${posWord(p)} ${man} as they cut to 53 players.`,
        `${the} let ${posWord(p)} ${man} go on cut-down day.`,
      ]),
      fact,
    ],
    second: [
      pick(l, at, slot('means'), [
        `He is a free agent and can sign with any team.`,
        `Any team can sign him now.`,
        `He is free to sign with another team.`,
      ]),
      `${p.lastName} is ${p.age}.`,
    ],
    numbers: [
      { value: String(p.age), label: 'Age' },
      ...(line?.gp ? [{ value: String(line.gp), label: 'Games last season' }] : []),
    ],
  });
}

const DAY_NAME: Record<Kickoff['day'], string> = { thu: 'Thursday', sat: 'Saturday', sun: 'Sunday', mon: 'Monday' };
/** "on Thursday at 8:15 PM Eastern": a kickoff as a sentence says it. */
function whenWords(k: Kickoff): string {
  const h = Math.floor(k.et / 60);
  const m = String(k.et % 60).padStart(2, '0');
  return `on ${DAY_NAME[k.day]} at ${((h + 11) % 12) + 1}:${m} ${h < 12 ? 'AM' : 'PM'} Eastern`;
}

/** Where a team opens: "at home against the Hammers", and when the game kicks off. */
function openerFacts(l: League, teamId: number): { where: string; opp: number; when: string } | null {
  const g = gamesInWeek(l, 1).find((x) => x.season === l.season && (x.homeId === teamId || x.awayId === teamId));
  if (!g) return null;
  const home = g.homeId === teamId;
  const opp = home ? g.awayId : g.homeId;
  return {
    where: `${home ? 'at home against' : 'on the road against'} the ${l.teams[opp].name}`,
    opp,
    when: g.kickoff ? whenWords(g.kickoff) : '',
  };
}
/** A Kickoff story: who opens against whom, and what is new about the team going in. No prediction. */
function kickoffStory(l: League, c: DayCandidate, at: Wording): EditionStory {
  const club = c.clubId;
  const p = c.playerId === undefined ? undefined : l.players[c.playerId];
  const ref = referrer(l, { playerIds: p ? [p.id] : [] });
  const Club = l.teams[club].name;
  const slot = (s: string) => `${c.key}:${s}`;
  const game = openerFacts(l, club)!;
  const Opp = l.teams[game.opp].name;
  const the = cap(ref.club(club));
  const last = lastRecord(l, club);
  const close = [wentLine(l, at, cap(ref.city(club)), club), wentLine(l, at, `The ${Opp}`, game.opp)].filter(Boolean);
  const numbers: EditionStory['numbers'] = last ? [{ value: rec(last), label: 'Last season' }] : [];
  const picture = p ? { playerId: p.id } : { teamIds: [club, game.opp] };
  const links: InboxAction[] = [
    { kind: 'team', teamId: club },
    { kind: 'team', teamId: game.opp },
  ];

  if (c.angle === 'champion')
    return assemble(c, ref, {
      kicker: 'Kickoff',
      headline: head(`${Club} open their title defense against the ${Opp}`, `${Club} open their title defense`),
      summary: `The champions open ${game.where}.`,
      first: [
        pick(l, at, slot('lede'), [
          `${the} open the defense of their title ${game.where}.`,
          `${the}, last season's champions, open ${game.where}.`,
        ]),
        game.when ? `The game kicks off ${game.when}.` : '',
      ],
      second: close.length ? close : [`${the} are the champions.`],
      numbers,
      picture,
      links,
    });

  if (c.angle === 'turnover') {
    const n = c.n ?? 0;
    const num = (k: string) => Number(c.got?.find((g) => g.startsWith(`${k}:`))?.split(':')[1] ?? 0);
    const [off, def] = [num('off'), num('def')];
    const roles = (c.got ?? []).filter((g) => !g.includes(':'));
    const hc = teamCoaches(l, club).find((x) => x.role === 'headCoach');
    const newHc = hc && roles.includes('headCoach') ? hc : undefined;
    const coords = roles.filter((r) => r !== 'headCoach').map((r) => ROLE[r as CoachRole]);
    const coordWords = coords.length === 2 ? 'two new coordinators' : coords.length ? `a new ${coords[0]}` : '';
    const City = cap(ref.city(club));
    const staff = newHc
      ? `${coachName(newHc)} is in his first season as head coach${coordWords ? `, with ${coordWords}` : ''}.`
      : coordWords
        ? `The team also has ${coordWords}.`
        : '';
    const split =
      off && def
        ? `${cap(count(off))} of them start on offense and ${count(def)} on defense.`
        : off || def
          ? `${cap(count(off || def))} of them start on ${off ? 'offense' : 'defense'}.`
          : '';
    return assemble(c, ref, {
      kicker: 'New starters',
      headline: head(`${Club} open the season with ${count(n)} new starters`, `${Club} have ${count(n)} new starters`),
      summary: `No team has more. The ${Club} open ${game.where}.`,
      first: [
        pick(l, at, slot('lede'), [
          `${the} open the season with ${count(n)} starters who were not with the team last season.`,
          `${cap(count(n))} of the starters for ${ref.club(club)} were not with the team last season.`,
        ]),
        `No team in the league has more.`,
        split,
      ],
      second: [staff, `${City} open ${game.where}.`, ...close.slice(0, 1)],
      numbers: [{ value: String(n), label: 'New starters' }, ...numbers],
      picture: newHc ? { coachId: newHc.id, teamIds: [club] } : picture,
      links,
    });
  }

  if (c.angle === 'mentor') {
    const d = l.coaches[c.coachId!];
    const m = l.coaches[c.n!];
    const home = game.where.startsWith('at home');
    return assemble(c, ref, {
      kicker: 'Opening week',
      headline: head(`${coachName(m)} meets his old assistant in Week 1`, `${m.lastName} meets his old assistant`),
      summary: `${coachName(d)} of the ${Club} worked on his staff.`,
      first: [
        pick(l, at, slot('lede'), [
          `${coachName(d)} of ${ref.club(club)} faces ${coachName(m)} of ${ref.club(game.opp)} in Week 1, the first time the two have met as head coaches.`,
          `${coachName(d)} of ${ref.club(club)} and ${coachName(m)} of ${ref.club(game.opp)} meet as head coaches for the first time in Week 1.`,
        ]),
        `${d.lastName} worked on ${possessive(m.lastName)} staff before he became a head coach.`,
      ],
      second: [
        `${cap(ref.city(club))} are ${home ? 'at home' : 'on the road'}${game.when ? ` ${game.when}` : ''}.`,
        ...close,
      ],
      numbers,
      picture: { teamIds: home ? [game.opp, club] : [club, game.opp] },
      links,
    });
  }

  if (c.angle === 'newCoach') {
    const coach = l.coaches[c.coachId!];
    const name = coachName(coach);
    const run = teamLosingRun(l, club);
    // What he walks into, worded apart from the new league year's story about him.
    const expects = madePlayoffs(l, club)
      ? `${coach.lastName} inherits a team that made the playoffs.`
      : run >= 2
        ? `${cap(ref.city(club))} have not had a winning season in ${count(run)} years.`
        : '';
    return assemble(c, ref, {
      kicker: 'New in charge',
      headline: head(
        `${name} coaches his first game for the ${Club}`,
        `${coach.lastName} coaches his first ${Club} game`,
      ),
      summary: `The ${Club} open ${game.where}.`,
      first: [
        pick(l, at, slot('lede'), [
          `${name} coaches ${ref.club(club)} for the first time ${game.where}.`,
          `${the} open ${game.where}, the first game for head coach ${name}.`,
        ]),
        game.when ? `The game kicks off ${game.when}.` : '',
      ],
      second: [expects, ...(close.length ? close : [`${the} open ${game.where}.`])],
      numbers,
      picture: { coachId: coach.id, teamIds: [club] },
      links,
    });
  }

  // A new quarterback, a rookie or not.
  const qb = p!;
  const man = ref.man(qb.id);
  const rookie = c.angle === 'rookieQb';
  const old = !rookie && c.n !== undefined ? l.players[c.n] : undefined;
  return assemble(c, ref, {
    kicker: rookie ? 'A rookie starts' : 'A new quarterback',
    headline: rookie
      ? head(`Rookie ${full(qb)} starts at quarterback for the ${Club}`, `Rookie ${qb.lastName} starts for the ${Club}`)
      : head(`${Club} start ${full(qb)} at quarterback`, `${Club} start ${qb.lastName} at quarterback`),
    summary: `The ${Club} open ${game.where}.`,
    first: [
      pick(l, at, slot('lede'), [
        rookie
          ? `${the} have named rookie ${man} their starting quarterback.`
          : `${the} open the season with ${man} at quarterback.`,
        rookie
          ? `Rookie ${man} starts at quarterback for ${ref.club(club)}.`
          : `${man} is the new starting quarterback of ${ref.club(club)}.`,
      ]),
      rookie && qb.draft
        ? `He was the No. ${qb.draft.pick} pick in the draft.`
        : old
          ? `${full(old)} threw most of the team's passes last season.`
          : '',
    ],
    second: [`${cap(ref.city(club))} open ${game.where}.`, ...close.slice(0, 1)],
    numbers,
    picture,
    links: [{ kind: 'player', playerId: qb.id }, ...links.slice(0, 1)],
  });
}

/** One story of a big day, from its candidate. */
export function writeDayStory(l: League, c: DayCandidate, at: Wording): EditionStory {
  if (c.angle === 'coach' || c.angle === 'gm') return topStory(l, c, at);
  if (c.angle === 'trade') return tradeStory(l, c, at);
  if (c.angle === 'pressure' || c.angle === 'seat') return pressureStory(l, c, at);
  if (c.day === 'cuts') return cutsStory(l, c, at);
  if (c.day === 'kickoff') return kickoffStory(l, c, at);
  if (c.day === 'year') return yearStory(l, c, at);
  if (c.day === 'market') return marketStory(l, c, at);
  return draftStory(l, c, at);
}

/** The reader's team in the window before free agency: who it tagged, kept and let reach the market, in public terms. */
function yourYear(l: League, at: Wording): EditionStory | null {
  const u = l.userTeamId;
  const moves = (kind: 'tag' | 'resign') =>
    l.transactions
      .filter((t) => t.season === l.season && t.phase === 'resign' && t.kind === kind && t.teamIds[0] === u)
      .filter((t) => kind !== 'resign' || t.text.includes(' re-signed '))
      .flatMap((t) => (t.playerId !== undefined && l.players[t.playerId] ? [l.players[t.playerId]] : []));
  const record = publicRecord(l);
  const best = (ps: Player[]) => [...ps].sort((a, b) => record.worth(b) - record.worth(a) || a.id - b.id);
  const tagged = best(moves('tag'));
  const kept = best(moves('resign'));
  const walked = best(
    Object.values(l.players).filter(
      (p) =>
        p.teamId === null && !p.retired && p.statTeams?.[l.season - 1]?.at(-1) === u && !l.draftClass.includes(p.id),
    ),
  ).filter((p) => record.standing(p) !== 'depth');
  // The biggest name of the three groups leads, whichever group he is in.
  const top = best([tagged[0], kept[0], walked[0]].filter((p): p is Player => !!p))[0];
  if (!top) return null;
  const ref = referrer(l, { playerIds: [...tagged, ...kept, ...walked].map((p) => p.id) });
  const Club = l.teams[u].name;
  const key = `year:${l.season}:yours`;
  const the = cap(ref.club(u));
  const did = top === tagged[0] ? 'used the franchise tag on' : top === kept[0] ? 're-signed' : 'let';
  const lede =
    did === 'let'
      ? `${the} let ${posWord(top)} ${ref.man(top.id)} reach free agency.`
      : `${the} ${did} ${posWord(top)} ${ref.man(top.id)} before free agency opened.`;
  const others = [
    kept.length - (did === 're-signed' ? 1 : 0) > 0
      ? `${cap(count(kept.length))} player${kept.length === 1 ? ' was' : 's were'} re-signed in all.`
      : '',
    walked.length && did !== 'let'
      ? `${cap(count(walked.length))} of last season's starters ${walked.length === 1 ? 'is' : 'are'} on the market, ${posWord(walked[0])} ${ref.man(walked[0].id)} among them.`
      : '',
    tagged.length && did !== 'used the franchise tag on'
      ? `${cap(posWord(tagged[0]))} ${ref.man(tagged[0].id)} was given the franchise tag.`
      : '',
  ].filter(Boolean);
  return assemble({ key, angle: 'yours', tier: 3, clubId: u }, ref, {
    kicker: 'Your team',
    yours: true,
    headline: head(
      did === 'let' ? `${Club} let ${tag(top)} reach free agency` : `${Club} keep ${tag(top)}`,
      did === 'let' ? `${Club} let ${top.lastName} go to market` : `${Club} keep ${top.lastName}`,
    ),
    summary: [
      tagged.length ? `${cap(count(tagged.length))} tagged.` : '',
      kept.length ? `${cap(count(kept.length))} re-signed.` : '',
      walked.length ? `${cap(count(walked.length))} of last season's starters on the market.` : '',
    ]
      .filter(Boolean)
      .join(' '),
    first: [pick(l, at, `${key}:lede`, [lede]), whyLine(top.lastName, record.why(top))],
    second: [...others, openerLine(l, at, ref, u)],
    numbers: [
      ...(tagged.length ? [{ value: String(tagged.length), label: 'Tagged' }] : []),
      ...(kept.length ? [{ value: String(kept.length), label: 'Re-signed' }] : []),
      ...(walked.length ? [{ value: String(walked.length), label: 'To market' }] : []),
    ],
    picture: { playerId: top.id },
    links: [{ kind: 'team', teamId: u }],
  });
}

/** The reader's club on Draft day: its class, the first pick against the consensus, a table of the first four. */
function yourDraft(l: League, at: Wording): EditionStory | null {
  const u = l.userTeamId;
  const mine = Object.values(l.players)
    .filter((p) => p.draft?.season === l.season && p.draft.teamId === u)
    .sort((a, b) => a.draft!.pick - b.draft!.pick);
  if (!mine.length) return null;
  const [a, b] = mine;
  const ref = referrer(l, { playerIds: mine.map((p) => p.id) });
  const Club = l.teams[u].name;
  const key = `draft:${l.season}:yours`;
  const the = cap(ref.club(u));
  const man = ref.man(a.id);
  const n = mine.length;
  const where = a.draft!.pick === 1 ? 'the first pick' : `the No. ${a.draft!.pick} pick`;
  const c = { pick: a.draft!.pick, rank: a.draft!.rank };
  return assemble({ key, angle: 'yours', tier: 3, clubId: u }, ref, {
    kicker: 'Your team',
    yours: true,
    headline: head(
      `${Club} make ${count(n)} pick${n === 1 ? '' : 's'}, starting with ${tag(a)}`,
      `${Club} start their class with ${a.lastName}`,
    ),
    summary: [
      `${a.lastName} went at No. ${a.draft!.pick}.`,
      c.rank !== undefined && c.rank !== c.pick ? `The consensus had him at No. ${c.rank}.` : '',
    ]
      .filter(Boolean)
      .join(' '),
    first: [
      pick(l, at, `${key}:lede`, [
        `${the} took ${posWord(a)} ${man} with ${where} and made ${count(n)} pick${n === 1 ? '' : 's'} in all.`,
        `${the} used ${where} on ${posWord(a)} ${man}, the first of ${possessive(Club)} ${count(n)} pick${n === 1 ? '' : 's'}.`,
      ]),
      rankLine(a.lastName, c),
    ],
    second: b ? [`${cap(posWord(b))} ${ref.man(b.id)} followed at No. ${b.draft!.pick}.`] : [openerLine(l, at, ref, u)],
    numbers: [
      { value: String(n), label: n === 1 ? 'Pick' : 'Picks' },
      { value: `No. ${a.draft!.pick}`, label: 'First pick' },
    ],
    picture: { playerId: a.id },
    links: [{ kind: 'draft' }, { kind: 'team', teamId: u }],
    table: {
      head: ['Pick', 'Player', 'Consensus'],
      rows: mine
        .slice(0, 4)
        .map((p) => [`No. ${p.draft!.pick}`, tag(p), p.draft!.rank !== undefined ? `No. ${p.draft!.rank}` : '']),
    },
  });
}

/** The reader's team in free agency's first week: who it signed and who left for another team, in public terms. */
function yourMarket(l: League, at: Wording): EditionStory | null {
  const u = l.userTeamId;
  const last = (p: Player) => p.statTeams?.[l.season - 1]?.at(-1);
  const signed = l.transactions
    .filter((t) => t.season === l.season && t.phase === 'freeAgency' && t.kind === 'sign' && t.playerId !== undefined)
    .flatMap((t) => (l.players[t.playerId!]?.contract ? [l.players[t.playerId!]] : []))
    .filter((p) => p.teamId !== null);
  const total = (p: Player) => p.contract!.apy * p.contract!.length;
  const came = signed.filter((p) => p.teamId === u && last(p) !== u).sort((a, b) => total(b) - total(a) || a.id - b.id);
  const record = publicRecord(l);
  const went = signed
    .filter((p) => p.teamId !== u && last(p) === u)
    .sort((a, b) => record.worth(b) - record.worth(a) || a.id - b.id);
  // The bigger contract leads: losing a starter to a rich deal elsewhere outweighs a small signing.
  const byDeal = [...went].sort((a, b) => total(b) - total(a) || a.id - b.id);
  const lost = byDeal[0] && (!came[0] || total(byDeal[0]) > total(came[0]));
  const top = lost ? byDeal[0] : came[0];
  if (!top) return null;
  const ref = referrer(l, { playerIds: [...came, ...went].map((p) => p.id) });
  const Club = l.teams[u].name;
  const key = `market:${l.season}:yours`;
  const the = cap(ref.club(u));
  const deal = { years: top.contract!.length, total: total(top) };
  const lede = !lost
    ? `${the} signed ${posWord(top)} ${ref.man(top.id)} in free agency.`
    : `${the} lost ${posWord(top)} ${ref.man(top.id)} to the ${l.teams[top.teamId!].name} in free agency.`;
  const other = lost ? came[0] : byDeal[0];
  const more = [
    other && lost ? `${cap(ref.city(u))} signed ${posWord(other)} ${ref.man(other.id)}.` : '',
    other && !lost ? `${cap(posWord(other))} ${ref.man(other.id)} left for the ${l.teams[other.teamId!].name}.` : '',
    came.length > 1 ? `${cap(count(came.length))} players signed in all.` : '',
  ].filter(Boolean);
  return assemble({ key, angle: 'yours', tier: 3, clubId: u }, ref, {
    kicker: 'Your team',
    yours: true,
    headline: !lost
      ? head(`${Club} sign ${tag(top)}`, `${Club} sign ${top.lastName}`)
      : head(`${Club} lose ${tag(top)} in free agency`, `${Club} lose ${top.lastName}`),
    summary: [
      came.length ? `${cap(count(came.length))} signed.` : '',
      went.length ? `${cap(count(went.length))} left for other teams.` : '',
    ]
      .filter(Boolean)
      .join(' '),
    first: [pick(l, at, `${key}:lede`, [lede]), `The deal is for ${dealWords(deal)}.`],
    second: [...more, openerLine(l, at, ref, u)],
    numbers: [
      ...(came.length ? [{ value: String(came.length), label: 'Signed' }] : []),
      ...(went.length ? [{ value: String(went.length), label: 'Left' }] : []),
    ],
    picture: { playerId: top.id },
    links: [{ kind: 'team', teamId: u }],
  });
}

/** The reader's team on cut-down day: its most notable release and the rookies who made the roster. */
function yourCuts(l: League, at: Wording): EditionStory | null {
  const u = l.userTeamId;
  const record = publicRecord(l);
  const cut = l.transactions
    .filter((t) => t.season === l.season && t.phase === 'preseason' && t.kind === 'release' && t.teamIds[0] === u)
    .flatMap((t) => (t.playerId !== undefined && l.players[t.playerId] ? [l.players[t.playerId]] : []))
    .sort((a, b) => record.worth(b) - record.worth(a) || a.id - b.id);
  const top = cut[0];
  if (!top) return null;
  const rookies = activeRoster(l, u).filter((p) => p.experience === 0);
  const ref = referrer(l, { playerIds: [top.id] });
  const Club = l.teams[u].name;
  const key = `cuts:${l.season}:yours`;
  const the = cap(ref.club(u));
  const gp = statLine(top, l.season - 1)?.gp ?? 0;
  return assemble({ key, angle: 'yours', tier: 3, clubId: u }, ref, {
    kicker: 'Your team',
    yours: true,
    headline: head(`${Club} release ${tag(top)}`, `${Club} release ${top.lastName}`),
    summary: [
      `${cap(count(cut.length))} released.`,
      rookies.length ? `${cap(count(rookies.length))} rookie${rookies.length === 1 ? '' : 's'} on the 53.` : '',
    ]
      .filter(Boolean)
      .join(' '),
    first: [
      pick(l, at, `${key}:lede`, [`${the} released ${posWord(top)} ${ref.man(top.id)} as they cut to 53 players.`]),
      gp ? `${top.lastName} played in ${gp} games last season.` : '',
    ],
    second: [
      rookies.length ? `${cap(count(rookies.length))} rookie${rookies.length === 1 ? '' : 's'} made the roster.` : '',
      openerLine(l, at, ref, u),
    ],
    numbers: [
      { value: String(cut.length), label: 'Released' },
      ...(rookies.length ? [{ value: String(rookies.length), label: 'Rookies on the 53' }] : []),
    ],
    picture: { playerId: top.id },
    links: [{ kind: 'team', teamId: u }],
  });
}

/** The reader's team at Kickoff: who it opens against, and both teams' records last season. */
function yourKickoff(l: League, at: Wording): EditionStory | null {
  const u = l.userTeamId;
  const game = openerFacts(l, u);
  if (!game) return null;
  const ref = referrer(l, { playerIds: [] });
  const Club = l.teams[u].name;
  const Opp = l.teams[game.opp].name;
  const key = `kick:${l.season}:yours`;
  const the = cap(ref.club(u));
  const last = lastRecord(l, u);
  const close = [wentLine(l, at, cap(ref.city(u)), u), wentLine(l, at, `The ${Opp}`, game.opp)].filter(Boolean);
  return assemble({ key, angle: 'yours', tier: 3, clubId: u }, ref, {
    kicker: 'Your team',
    yours: true,
    headline: head(`${Club} open ${game.where}`, `${Club} open against the ${Opp}`),
    summary: game.when ? `The game kicks off ${game.when}.` : `The ${Club} open ${game.where}.`,
    first: [
      pick(l, at, `${key}:lede`, [`${the} open the season ${game.where}.`]),
      game.when ? `The game kicks off ${game.when}.` : '',
    ],
    second: close.length ? close : [`${the} open ${game.where}.`],
    numbers: last ? [{ value: rec(last), label: 'Last season' }] : [],
    picture: { teamIds: [u, game.opp] },
    links: [
      { kind: 'team', teamId: u },
      { kind: 'team', teamId: game.opp },
    ],
  });
}

/** The reader's club on a big day, in public terms; nothing when it did nothing that day. */
export function yourDayStory(l: League, day: Day, at: Wording): EditionStory | null {
  return day === 'draft'
    ? yourDraft(l, at)
    : day === 'year'
      ? yourYear(l, at)
      : day === 'market'
        ? yourMarket(l, at)
        : day === 'cuts'
          ? yourCuts(l, at)
          : yourKickoff(l, at);
}
