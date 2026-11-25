/**
 * Discipline on your desk (spec `docs/superpowers/specs/2026-11-23-discipline-design.md`): the facts the head coach's
 * row and notes read, the league office's letter about a ruling on one of your players, and the words of a card's
 * Discipline list. Mail-side only: it reads the record `conduct.ts` keeps and never draws or changes anything.
 */
import { YEAR } from './morale';
import {
  countWord,
  INCIDENT,
  LEAGUE_MISSES,
  LEAGUE_RECORD,
  LEAGUE_RULING,
  LEAGUE_SUBJECT,
  TEAM_RULES,
} from './conductVoice';
import type { ConductFact, LeagueFact } from './conductVoice';
import { STARTERS } from './positions';
import { teamPlayers } from './roster';
import type { Draft } from './senders';
import type { ConductEntry, ConductKind, Game, League, Player } from './types';
import { around, say, seasonSaid } from './voice';

/** Morale's step of a league year that the first game week falls on (`morale.ts`: `REGULAR`). */
const FIRST_GAME_STEP = 8;
const gameWord = (n: number) => `${countWord(n)} game${n === 1 ? '' : 's'}`;
const QUARTER = ['', 'first', 'second', 'third', 'fourth'];

/** The head coach's fact sheet for a man in trouble (before the answer is on his record). */
export function conductFact(league: League, p: Player, kind: ConductKind): ConductFact {
  // The last two league years: older trouble is forgotten (`ConductFact.clean`).
  const entries = (p.discipline?.entries ?? []).filter((e) => e.season >= league.season - 1);
  const team = p.teamId === null ? undefined : league.teams[p.teamId];
  const spot = team ? team.depthChart[p.position].indexOf(p.id) : -1;
  const answered = entries.filter((e) => e.outcome === 'fine' || e.outcome === 'sat' || e.outcome === 'letGo');
  const last = answered.at(-1)?.outcome;
  return {
    kind,
    last: p.lastName,
    times: entries.filter((e) => TEAM_RULES.includes(e.kind) && e.season === league.season).length,
    clean: entries.length === 0,
    ...(last === 'fine' || last === 'sat' || last === 'letGo' ? { lastOutcome: last } : {}),
    starter: spot >= 0 && spot < STARTERS[p.position],
    rookie: p.experience === 0,
    veteran: p.experience >= 6,
    inSeason: league.phase === 'regular' || league.phase === 'playoffs',
  };
}

/** A game of the user's team in the week the entry's step names (the step is `8 +` the game week). */
function gameOf(league: League, teamId: number, e: ConductEntry): Game | undefined {
  const week = e.week - FIRST_GAME_STEP;
  if (week < 1) return undefined;
  return league.games.find(
    (g) => g.season === e.season && g.week === week && (g.homeId === teamId || g.awayId === teamId),
  );
}

/** "at Miami" or "at home against New England": where a game was, from the team's side. */
function whereOf(league: League, g: Game, teamId: number): string {
  const home = g.homeId === teamId;
  const them = league.teams[home ? g.awayId : g.homeId];
  return home ? `at home against ${them.city}` : `at ${them.city}`;
}

/** The games the user's team has still to play this league year, in order. */
function upcoming(league: League, teamId: number): Game[] {
  return league.games
    .filter((g) => g.season === league.season && !g.result && (g.homeId === teamId || g.awayId === teamId))
    .sort((a, b) => a.week - b.week);
}

const LETTER_ID = (e: ConductEntry, playerId: number) =>
  `conduct:${e.season}:${e.week}:${playerId}:${e.kind}:${e.outcome}`;

/** What the league office tells you about one ruling on one of your players. */
export function leagueFact(league: League, p: Player, e: ConductEntry, idx: number): LeagueFact {
  const team = e.teamId ?? league.userTeamId;
  const g = e.kind === 'ejected' ? gameOf(league, team, e) : undefined;
  const ej = g?.result?.ejections?.find((x) => x.playerId === p.id);
  const so = (p.discipline?.entries ?? []).slice(0, idx + 1);
  const games = e.games ?? 1;
  const next = upcoming(league, team);
  const back = next[games]?.week;
  return {
    full: `${p.firstName} ${p.lastName}`,
    last: p.lastName,
    kind: e.kind,
    ruling: e.outcome === 'suspended' ? 'suspended' : 'leagueFine',
    games,
    ...(ej && g && QUARTER[ej.quarter]
      ? { why: ej.why, quarter: QUARTER[ej.quarter], where: whereOf(league, g, team) }
      : {}),
    ejections: so.filter((x) => x.kind === 'ejected' && x.season === e.season).length,
    bans: so.filter((x) => x.outcome === 'suspended' && x.season >= e.season - 1).length,
    ...(next[0] ? { next: whereOf(league, next[0], team) } : {}),
    ...(back !== undefined && back <= 18 ? { back } : {}),
  };
}

/** The league office's letters: one for each ruling on a player of yours (a fine or a suspension), filed once. */
export function conductLetters(league: League, have: Set<string>): Draft[] {
  const out: Draft[] = [];
  const user = league.userTeamId;
  const said = seasonSaid(league, 'League office', 'conduct:');
  for (const p of teamPlayers(league, user)) {
    const entries = p.discipline?.entries ?? [];
    entries.forEach((e, idx) => {
      if ((e.outcome !== 'leagueFine' && e.outcome !== 'suspended') || e.teamId !== user) return;
      if (e.season !== league.season) return;
      const id = LETTER_ID(e, p.id);
      if (have.has(id)) return;
      const f = leagueFact(league, p, e, idx);
      const at = { key: id, ...around(league, said) };
      const parts = [
        say(LEAGUE_RULING, f, { ...at, slot: 'ruling' }),
        say(LEAGUE_RECORD, f, { ...at, slot: 'record' }),
        say(LEAGUE_MISSES, f, { ...at, slot: 'misses' }),
      ].filter(Boolean);
      if (!parts.length) return;
      said.push(...parts);
      const gw = e.week - FIRST_GAME_STEP;
      const inSeason = gw >= 1;
      out.push({
        id,
        season: e.season,
        // Step 8 is the last offseason step, rolled after the phase flipped: it is camp, never "week 0" of the season.
        phase: inSeason ? (gw > 18 ? 'playoffs' : 'regular') : e.week >= 7 ? 'preseason' : league.phase,
        week: inSeason ? gw : 0,
        from: 'League office',
        category: 'league',
        subject: say(LEAGUE_SUBJECT, f, { key: id, slot: 'subject' }),
        body: parts.join(' '),
        actions: [{ kind: 'player', playerId: p.id }],
      });
    });
  }
  return out;
}

// ───────── a card's Discipline list ─────────

/** Where in the offseason a step falls (`morale.ts`: 0 the re-sign window, 1 to 5 free agency's days, 6 the draft, 7 camp). */
const offseasonAt = (step: number) =>
  step === 0 ? 'in the re-sign window' : step < 6 ? 'in free agency' : step === 6 ? 'at the draft' : 'at camp';

/** Worded by who answered: you on your desk, your head coach, or else the team (a predecessor, an answer that timed out). */
const DONE: Record<'fine' | 'sat' | 'letGo', [string, string, string]> = {
  fine: ['You fined him.', 'The head coach fined him.', 'The team fined him.'],
  sat: ['You sat him for a game.', 'The head coach sat him for a game.', 'The team sat him for a game.'],
  letGo: ['You let it go.', 'The head coach let it go.', 'The team let it go.'],
};
const doneWho = (e: ConductEntry) => (e.byYou ? 0 : e.byCoach ? 1 : 2);

/**
 * What his record says, newest first, in words that follow "Week 8:" on a card. An entry is yours only if it happened on
 * your team (a man traded to you brings his old team's private trouble with him, and you never see it); another team's
 * shows only when it was public, worded as that team's or the league's doing.
 */
export function disciplineLines(league: League, p: Player): { when: string; text: string }[] {
  const rows: { when: string; text: string }[] = [];
  // Only the last two league years: older trouble is forgotten, and "last season" is always the season before.
  for (const e of [...(p.discipline?.entries ?? [])].reverse()) {
    if (e.season < league.season - 1) continue;
    const mine = e.teamId === league.userTeamId;
    if (!mine && !e.public) continue;
    const found = e.kind === 'ejected' && e.teamId !== undefined ? gameOf(league, e.teamId, e) : undefined;
    // Only a game whose record says he was thrown out: the week alone proves nothing.
    const g = found?.result?.ejections?.some((x) => x.playerId === p.id) ? found : undefined;
    const lastYear = e.season !== league.season;
    const when =
      e.week > FIRST_GAME_STEP
        ? `${lastYear ? 'Last season, week' : 'Week'} ${e.week - FIRST_GAME_STEP}${
            g && e.teamId !== undefined ? ` ${whereOf(league, g, e.teamId).replace('at home against', 'against')}` : ''
          }`
        : `${lastYear ? 'Last offseason,' : 'This offseason,'} ${offseasonAt(e.week)}`;
    const games = e.games ?? 1;
    const what = e.kind === 'ejected' ? 'ejected' : INCIDENT[e.kind];
    let text: string;
    if (e.outcome === 'leagueFine') text = `${what}, fined by the league.`;
    else if (e.outcome === 'suspended') text = `${what}, suspended ${gameWord(games)}.`;
    else if (mine) text = `${what}. ${DONE[e.outcome][doneWho(e)]}`;
    else text = `${what}${e.outcome === 'sat' ? '. The team sat him for a game.' : '.'}`;
    rows.push({ when, text });
  }
  return rows;
}

/** What became of a row that no longer waits: the first answer on his record from the row's step on, in a few words. */
export function conductSettled(league: League, playerId: number, clock: number): string {
  const e = (league.players[playerId]?.discipline?.entries ?? []).find(
    (x) =>
      x.teamId === league.userTeamId &&
      x.season * YEAR + x.week >= clock &&
      (x.outcome === 'fine' || x.outcome === 'sat' || x.outcome === 'letGo'),
  );
  return e && (e.outcome === 'fine' || e.outcome === 'sat' || e.outcome === 'letGo')
    ? DONE[e.outcome][doneWho(e)]
    : 'This one is settled.';
}
