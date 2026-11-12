/**
 * The words of SNN's big-day editions (`snnDays.ts` chooses the stories, this writes them). Each story is two
 * paragraphs of prose to the weekly edition's writing rules (`storyRules.ts`: it stops on a fact, two numbers a
 * sentence at most, a man's full name first) and the house rules for letters (`letterRules.ts`). Public facts only:
 * the pick, the consensus rank, the contract, the club. No sentence comes twice in a league year: each sentence is
 * picked around what SNN has already said (`at.said`). The second paragraph ends on the next fact on the calendar,
 * where a weekly story ends on the next fixture.
 */
import { gamesInWeek } from './league';
import { POSITION_NAMES } from './positions';
import { cap, possessive, referrer, type Referrer } from './refer';
import type { Day, DayCandidate } from './snnDays';
import type { EditionStory, InboxAction, League, Player } from './types';
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
const posWord = (p: Player) => (p.position === 'OL' ? 'offensive lineman' : POSITION_NAMES[p.position].toLowerCase());
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

/** The club's first game of the season, as the fact a story stops on; its camp when the schedule is not out. */
function openerLine(l: League, ref: Referrer, teamId: number): string {
  const g = gamesInWeek(l, 1).find((x) => x.season === l.season && (x.homeId === teamId || x.awayId === teamId));
  const name = cap(ref.club(teamId));
  if (!g) return `${name} report for camp next.`;
  const home = g.homeId === teamId;
  const opp = l.teams[home ? g.awayId : g.homeId].name;
  return home ? `${name} open the season at home to the ${opp}.` : `${name} open the season away to the ${opp}.`;
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
        trades ? `Clubs made ${trades} trades on the day.` : '',
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
              `Clubs made ${trades} trades on the day.`,
              `There were ${trades} trades before the draft closed.`,
            ])
          : '',
        later
          ? `${cap(ref.club(club))} also took ${tag(later)} at No. ${later.draft!.pick}.`
          : openerLine(l, ref, club),
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
    return assemble(c, ref, {
      kicker: 'Trade up',
      headline: head(`${Club} move up to No. ${c.pick} for ${tag(p)}`, `${Club} move up for ${p.lastName}`),
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
        openerLine(l, ref, club),
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
      second: [rankLine(p.lastName, c), openerLine(l, ref, club)],
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
        openerLine(l, ref, club),
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
        openerLine(l, ref, club),
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
    summary: `No club made more picks in the first two rounds. The first was ${tag(p)} at No. ${c.pick}.`,
    first: [
      `${the} made ${count(n)} picks in the first two rounds, more than any other club.`,
      `The first was ${posWord(p)} ${man} at No. ${c.pick}.`,
    ],
    second: [rankLine(p.lastName, c), openerLine(l, ref, club)],
    numbers: [{ value: String(n), label: 'Picks in rounds 1–2' }, ...pickChips(c)].slice(0, 3),
    picture: { playerId: p.id },
    links: links(p, club),
  });
}

/** One story of a big day, from its candidate. */
export function writeDayStory(l: League, c: DayCandidate, at: Wording): EditionStory {
  return draftStory(l, c, at);
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
    kicker: 'Your club',
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
    second: b ? [`${cap(posWord(b))} ${ref.man(b.id)} followed at No. ${b.draft!.pick}.`] : [openerLine(l, ref, u)],
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

/** The reader's club on a big day, in public terms; nothing when it did nothing that day. */
export function yourDayStory(l: League, day: Day, at: Wording): EditionStory | null {
  return day === 'draft' ? yourDraft(l, at) : null;
}
