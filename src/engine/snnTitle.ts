/**
 * SNN's edition for the final (`snnWeek.ts` builds the page, this adds what only that week has): the champion's story
 * told as a championship (the game's most valuable player, the road there, how many titles that makes), a tile for
 * the league's most valuable player, and two lists (the season's awards, the champions' road). Mail-side only: every
 * fact is a box score, a standing or an award already voted. Nothing is drawn and nothing is stored but the page.
 * The most valuable player of the final is SNN's reading of the box score (`titleMvp`), not an award on his record.
 */
import { AWARD_KEYS, AWARD_NAMES, seasonAwards } from './awards';
import { POSITION_NAMES } from './positions';
import { computeRecords } from './season/standings';
import { statLine } from './stats';
import type { EditionList, EditionStory, Game, InboxAction, League, Player, StatLine } from './types';
import { sentencesOf } from './voice';

const COUNT = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
const count = (n: number) => COUNT[n] ?? String(n);
const ORDINAL = ['', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth'];
const num = (n: number) => n.toLocaleString('en-US');
const full = (p: Player) => `${p.firstName} ${p.lastName}`;
const posName = (p: Player) => (p.position === 'OL' ? 'offensive lineman' : POSITION_NAMES[p.position].toLowerCase());
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const plural = (n: number, one: string) => (n === 1 ? one : `${one}s`);
/** A team by its city, or by its nickname where two share one. */
const town = (l: League, id: number) =>
  l.teams.filter((t) => t.city === l.teams[id].city).length > 1 ? `the ${l.teams[id].name}` : l.teams[id].city;
const ROUND: Record<string, string> = {
  WC: 'Wild Card',
  DIV: 'Divisional round',
  CONF: 'Conference final',
  FINAL: 'The final',
};

/** What a line was worth in one game: the yardstick for the final's most valuable player, on the winning side. */
const worth = (s: StatLine) =>
  (s.passYds ?? 0) / 25 +
  (s.passTd ?? 0) * 4 -
  (s.passInt ?? 0) * 2 +
  ((s.rushYds ?? 0) + (s.recYds ?? 0)) / 10 +
  ((s.rushTd ?? 0) + (s.recTd ?? 0)) * 6 +
  (s.sacks ?? 0) * 4 +
  (s.defInt ?? 0) * 5 +
  (s.forcedFum ?? 0) * 3 +
  (s.defTd ?? 0) * 6 +
  (s.tackles ?? 0) * 0.5 +
  (s.passDef ?? 0);

const winnerOf = (g: Game) => (g.result!.homeScore >= g.result!.awayScore ? g.homeId : g.awayId);

/** The final's most valuable player: the winning team's best line of the game. */
export function titleMvp(l: League, g: Game): { p: Player; s: StatLine } | null {
  const W = winnerOf(g);
  const best = Object.entries(g.result?.playerStats ?? {})
    .flatMap(([id, s]) => (l.players[Number(id)]?.teamId === W ? [{ p: l.players[Number(id)], s }] : []))
    .sort((a, b) => worth(b.s) - worth(a.s) || a.p.id - b.p.id)[0];
  return best && worth(best.s) > 0 ? best : null;
}

/** "threw for 281 yards and four touchdowns": a line as the clause after "He". */
function lineWords(s: StatLine): string {
  const td = (n: number, verb = '') => (n ? ` and ${verb}${count(n)} ${plural(n, 'touchdown')}` : '');
  if ((s.passYds ?? 0) >= 150) return `threw for ${num(s.passYds!)} yards${td(s.passTd ?? 0)}`;
  const scrimmage = (s.rushYds ?? 0) + (s.recYds ?? 0);
  if (scrimmage >= 60)
    return `gained ${num(scrimmage)} yards from scrimmage${td((s.rushTd ?? 0) + (s.recTd ?? 0), 'scored ')}`;
  const sacks = Math.round(s.sacks ?? 0);
  if (sacks) return `had ${count(sacks)} ${plural(sacks, 'sack')}`;
  if (s.defInt) return `intercepted ${count(s.defInt)} ${s.defInt === 1 ? 'pass' : 'passes'}`;
  return `made ${count(s.tackles ?? 0)} ${plural(s.tackles ?? 0, 'tackle')}`;
}

/** His totals over this season's playoff games. */
function playoffLine(l: League, p: Player): { s: StatLine; games: number } {
  const s: StatLine = {};
  let games = 0;
  for (const g of l.games) {
    const line = g.season === l.season && g.playoffRound ? g.result?.playerStats[p.id] : undefined;
    if (!line) continue;
    games++;
    for (const [k, v] of Object.entries(line)) s[k as keyof StatLine] = (s[k as keyof StatLine] ?? 0) + (v ?? 0);
  }
  return { s, games };
}

/** The champion's playoff games before the final, oldest first. */
const roadOf = (l: League, teamId: number) =>
  l.games
    .filter((g) => g.season === l.season && g.playoffRound && g.result && (g.homeId === teamId || g.awayId === teamId))
    .sort((a, b) => a.week - b.week);

const andList = (xs: string[]) => (xs.length <= 1 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`);

/** The lead, told as a championship: the game as it was written, then the most valuable player and the road. */
function championLead(l: League, g: Game, lead: EditionStory, said: string[]): EditionStory {
  const W = winnerOf(g);
  const mvp = titleMvp(l, g);
  const cast = [...lead.cast];
  const body = lead.paragraphs.join(' ');
  const paragraphs = lead.paragraphs.slice(0, 2);

  // How many titles that makes, when the record holds an earlier one.
  const before = l.history.filter((h) => h.championId === W && h.season < l.season);
  if (before.length) {
    const span = l.season - Math.min(...l.history.map((h) => h.season)) + 1;
    paragraphs[paragraphs.length - 1] +=
      ` It is their ${ORDINAL[before.length + 1] ?? `${before.length + 1}th`} championship in ${count(span)} seasons.`;
  }
  if (mvp) {
    const named = cast.includes(mvp.p.id) && body.includes(mvp.p.lastName);
    if (!cast.includes(mvp.p.id)) cast.push(mvp.p.id);
    const all = playoffLine(l, mvp.p);
    // A line the game story already gave is not given twice: his playoffs stand in for it.
    const second =
      named && all.games > 1
        ? `He ${lineWords(all.s)} in ${count(all.games)} playoff games.`
        : `He ${lineWords(mvp.s)}.`;
    paragraphs.push(
      `${cap(posName(mvp.p))} ${named ? mvp.p.lastName : full(mvp.p)} was the final's most valuable player. ${second}`,
    );
  }
  const reg = computeRecords(l).get(W);
  const beaten = roadOf(l, W)
    .filter((x) => x.id !== g.id)
    .map((x) => town(l, x.homeId === W ? x.awayId : x.homeId));
  if (reg && beaten.length)
    paragraphs.push(
      `${cap(town(l, W))} went ${reg.w}–${reg.l}${reg.t ? `–${reg.t}` : ''} in the regular season and beat ${andList(beaten)} to reach the final.`,
    );
  said.push(...paragraphs.slice(lead.paragraphs.slice(0, 2).length).flatMap((x) => sentencesOf(x)));
  const star: InboxAction[] =
    mvp && !lead.links.some((a) => a.kind === 'player' && a.playerId === mvp.p.id)
      ? [{ kind: 'player', playerId: mvp.p.id }]
      : [];
  const links: InboxAction[] = [...lead.links.slice(0, 1), ...star, ...lead.links.slice(1)];
  return {
    ...lead,
    kicker: 'The championship',
    cast,
    paragraphs: paragraphs.slice(0, 4),
    picture: mvp ? { playerId: mvp.p.id, gameId: g.id } : lead.picture,
    links,
  };
}

/** His season as the clause after "He", and the chips beside it. */
function seasonWords(s: StatLine): { text: string; chips: EditionStory['numbers'] } {
  const td = (n: number) => (n ? ` and ${num(n)} ${plural(n, 'touchdown')}` : '');
  if ((s.passYds ?? 0) >= 1500)
    return {
      text: `threw for ${num(s.passYds!)} yards${td(s.passTd ?? 0)}`,
      chips: [
        { value: num(s.passYds!), label: 'Passing yards' },
        { value: String(s.passTd ?? 0), label: 'Touchdown passes' },
      ],
    };
  if ((s.rec ?? 0) >= 50 && (s.recYds ?? 0) >= (s.rushYds ?? 0))
    return {
      text: `caught ${num(s.rec!)} passes for ${num(s.recYds ?? 0)} yards`,
      chips: [
        { value: num(s.recYds ?? 0), label: 'Receiving yards' },
        { value: String(s.recTd ?? 0), label: 'Touchdowns' },
      ],
    };
  if ((s.rushYds ?? 0) >= 500)
    return {
      text: `ran for ${num(s.rushYds!)} yards${td(s.rushTd ?? 0)}`,
      chips: [
        { value: num(s.rushYds!), label: 'Rushing yards' },
        { value: String(s.rushTd ?? 0), label: 'Touchdowns' },
      ],
    };
  if ((s.sacks ?? 0) >= 5)
    return { text: `had ${num(s.sacks!)} sacks`, chips: [{ value: num(s.sacks!), label: 'Sacks' }] };
  if ((s.defInt ?? 0) >= 3)
    return {
      text: `intercepted ${num(s.defInt!)} passes`,
      chips: [{ value: num(s.defInt!), label: 'Interceptions' }],
    };
  return {
    text: `made ${num(s.tackles ?? 0)} tackles`,
    chips: [{ value: num(s.tackles ?? 0), label: 'Tackles' }],
  };
}

/** The league's most valuable player, with the other awards in its second paragraph. */
function mvpTile(l: League, said: string[]): EditionStory | null {
  const awards = seasonAwards(l, l.season);
  const who = (k: (typeof AWARD_KEYS)[number]) => {
    const w = awards?.winners[k];
    const p = w ? l.players[w.playerId] : undefined;
    return p && w && w.teamId !== null ? { p, teamId: w.teamId } : undefined;
  };
  const mvp = who('mvp');
  if (!mvp) return null;
  const season = seasonWords(statLine(mvp.p, l.season) ?? {});
  const of = (x: { p: Player; teamId: number }) => `${full(x.p)} of the ${l.teams[x.teamId].name}`;
  // A man named already is named by his surname the second time.
  const seen = new Set([mvp.p.id]);
  const name = (x: { p: Player; teamId: number }) => {
    if (seen.has(x.p.id)) return x.p.lastName;
    seen.add(x.p.id);
    return of(x);
  };
  const [opoy, dpoy, oroy, droy] = [who('opoy'), who('dpoy'), who('oroy'), who('droy')];
  const players = [
    opoy ? `${name(opoy)} is the offensive player of the year` : '',
    dpoy ? `${name(dpoy)} is the defensive player of the year` : '',
  ].filter(Boolean);
  const rookies = [oroy, droy].flatMap((x) => (x ? [name(x)] : []));
  const second = [
    players.length ? `${andList(players).replace(', and ', ' and ')}.` : '',
    rookies.length
      ? `The ${plural(rookies.length, 'rookie')} of the year ${rookies.length === 1 ? 'is' : 'are'} ${andList(rookies)}.`
      : '',
  ].filter(Boolean);
  if (!second.length) return null;
  const paragraphs = [
    `${cap(posName(mvp.p))} ${of(mvp)} is the league's most valuable player for ${l.season}. He ${season.text}.`,
    second.join(' '),
  ];
  said.push(...paragraphs.flatMap((x) => sentencesOf(x)));
  const long = `${full(mvp.p)} is the league's most valuable player`;
  return {
    key: `award:${l.season}:mvp`,
    kind: 'award',
    angle: 'mvp',
    tier: 2,
    clubId: mvp.teamId,
    kicker: 'The awards',
    headline: long.length <= 70 ? long : `${mvp.p.lastName} is the most valuable player`,
    summary: `He ${season.text} for the ${l.teams[mvp.teamId].name}.`,
    picture: { playerId: mvp.p.id },
    cast: [...seen],
    numbers: season.chips,
    paragraphs,
    links: [
      { kind: 'player', playerId: mvp.p.id },
      { kind: 'team', teamId: mvp.teamId },
    ],
  };
}

/** The season's awards, and the champions' playoff games, as the page's lists. */
function titleLists(l: League, g: Game): EditionList[] {
  const out: EditionList[] = [];
  const awards = seasonAwards(l, l.season);
  const rows = AWARD_KEYS.flatMap((k) => {
    const w = awards?.winners[k];
    const p = w ? l.players[w.playerId] : undefined;
    return p && w && w.teamId !== null
      ? [
          {
            playerId: p.id,
            teamId: w.teamId,
            cells: [AWARD_NAMES[k], `${p.position} ${full(p)}`, l.teams[w.teamId].name],
          },
        ]
      : [];
  });
  if (rows.length) out.push({ title: "The season's awards", head: ['Award', 'Player', 'Team'], rows });
  const road = roadOf(l, winnerOf(g)).map((x) => ({
    teamId: x.homeId,
    otherId: x.awayId,
    gameId: x.id,
    cells: [
      ROUND[x.playoffRound!] ?? '',
      `${l.teams[x.awayId].name} at ${l.teams[x.homeId].name}`,
      `${x.result!.awayScore}–${x.result!.homeScore}${x.result!.overtime ? ' (OT)' : ''}`,
    ],
  }));
  if (road.length > 1) out.push({ title: "The champions' road", head: ['Round', 'Game', 'Score'], rows: road });
  return out;
}

/** What the final's edition adds to its page: the lead retold, a tile for the awards, and the two lists. */
export function titleEdition(
  l: League,
  g: Game,
  lead: EditionStory,
  said: string[],
): { lead: EditionStory; tiles: EditionStory[]; lists: EditionList[] } {
  const tile = mvpTile(l, said);
  return { lead: championLead(l, g, lead, said), tiles: tile ? [tile] : [], lists: titleLists(l, g) };
}
