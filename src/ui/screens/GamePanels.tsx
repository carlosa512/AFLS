/**
 * The two panels beside the field (tabs under it on a narrow window). The game: its weather, the score by quarter,
 * each team's numbers and who got hurt. The players: the leaders, or one team's lines. Everything is read from the
 * play log through the last play whose result is on screen (`gameRead.ts`), so a live game and a replay say the same
 * and neither gets ahead of the picture. Only box-score facts: nothing here is a rating.
 * Spec: docs/superpowers/specs/2026-11-10-broadcast-info-design.md §4.
 */
import { useMemo } from 'react';
import { estimateText, injuryLabel } from '../../engine/injuries';
import type { FieldRecord, Game, GameResult, League, PlayLogEntry, Team } from '../../engine/types';
import { gameWeather } from '../../engine/weather';
import { PlayerLink, WeatherNote } from '../components';
import {
  injuriesAt,
  linesAt,
  quartersAt,
  SHOWN_LINE,
  SHOWN_TEAM,
  teamStatsAt,
  type PlayNames,
  type RunningLine,
  type RunningTeam,
} from '../gameRead';
import { STAGE_TABS, usePref, WHO_KEY, WHO_PICKS, type StageTab } from '../viewerPrefs';
import { laneColor } from './GameTimeline';

// ───────── the game ─────────

interface StatRow {
  /** The row's key in the markup, and the numbers it needs (all must be ones the reader gets exactly). */
  id: string;
  label: string;
  needs: readonly (keyof RunningTeam)[];
  text: (t: RunningTeam) => string | number;
  /** What the split bar weighs: the number itself, or a rate. */
  weight: (t: RunningTeam) => number;
}
/** The box score's rows, in its order and under its labels. */
const ROWS: readonly StatRow[] = [
  {
    id: 'firstDowns',
    label: 'First downs',
    needs: ['firstDowns'],
    text: (t) => t.firstDowns,
    weight: (t) => t.firstDowns,
  },
  { id: 'totalYds', label: 'Total yards', needs: ['totalYds'], text: (t) => t.totalYds, weight: (t) => t.totalYds },
  { id: 'passYds', label: 'Passing', needs: ['passYds'], text: (t) => t.passYds, weight: (t) => t.passYds },
  { id: 'rushYds', label: 'Rushing', needs: ['rushYds'], text: (t) => t.rushYds, weight: (t) => t.rushYds },
  {
    id: 'thirdDown',
    label: '3rd down',
    needs: ['thirdDownConv', 'thirdDownAtt'],
    text: (t) => `${t.thirdDownConv}/${t.thirdDownAtt}`,
    weight: (t) => (t.thirdDownAtt ? t.thirdDownConv / t.thirdDownAtt : 0),
  },
  { id: 'turnovers', label: 'Turnovers', needs: ['turnovers'], text: (t) => t.turnovers, weight: (t) => t.turnovers },
];
const SHOWN_ROWS = ROWS.filter((r) => r.needs.every((k) => SHOWN_TEAM.includes(k)));

export function GamePanel({
  league,
  game,
  home,
  away,
  plays,
  shown,
  names,
  result,
}: {
  league: League;
  game: Game;
  home: Team;
  away: Team;
  plays: readonly PlayLogEntry[];
  /** The last play whose result is on screen (-1: none yet). */
  shown: number;
  names: PlayNames;
  /** A finished game's result: its weather as played, and the doctor's word on each injury. */
  result?: GameResult;
}) {
  const stats = useMemo(() => teamStatsAt(plays, shown, home.id), [plays, shown, home.id]);
  const quarters = quartersAt(plays, shown);
  const hurt = injuriesAt(plays, shown, names);
  const columns = Math.max(4, quarters.home.length);
  const total = (list: number[]) => list.reduce((a, b) => a + b, 0);
  const colors = { home: laneColor(home.colors), away: laneColor(away.colors) };
  const sides = [
    { team: away, scores: quarters.away, color: colors.away },
    { team: home, scores: quarters.home, color: colors.home },
  ];
  return (
    <aside className="stage-rail rail-game" aria-label="The game">
      <section className="rail-card">
        <h2>Game</h2>
        <p className="rail-wx">
          <WeatherNote weather={result?.weather ?? gameWeather(league, game)} forecast={null} />
        </p>
        <table className="rail-quarters" aria-label="Score by quarter">
          <thead>
            <tr>
              <th />
              {Array.from({ length: columns }, (_, q) => (
                <th key={q} className="num">
                  {q < 4 ? q + 1 : 'OT'}
                </th>
              ))}
              <th className="num">T</th>
            </tr>
          </thead>
          <tbody>
            {sides.map(({ team, scores, color }) => (
              <tr key={team.id}>
                <th scope="row" style={{ color }}>
                  {team.abbrev}
                </th>
                {Array.from({ length: columns }, (_, q) => (
                  <td key={q} className="num">
                    {scores[q] ?? '·'}
                  </td>
                ))}
                <td className="tot num">{total(scores)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="cmp">
          {SHOWN_ROWS.map((row) => {
            const a = row.weight(stats.away);
            const h = row.weight(stats.home);
            return (
              <div key={row.id} className="cmp-row" data-stat={row.id}>
                <span className="cmp-a num" style={{ color: colors.away }}>
                  {row.text(stats.away)}
                </span>
                <span className="cmp-k">{row.label}</span>
                <span className="cmp-h num" style={{ color: colors.home }}>
                  {row.text(stats.home)}
                </span>
                <span className="cmp-bar" aria-hidden="true">
                  {a + h > 0 ? (
                    <>
                      <i style={{ flex: Math.max(a, 0), background: colors.away }} />
                      <i style={{ flex: Math.max(h, 0), background: colors.home }} />
                    </>
                  ) : (
                    <i className="none" style={{ flex: 1 }} />
                  )}
                </span>
              </div>
            );
          })}
        </div>
      </section>
      {hurt.length > 0 && (
        <section className="rail-card">
          <h2>Injuries</h2>
          <ul className="game-injuries">
            {hurt.map((i) => {
              const p = i.playerId !== undefined ? league.players[i.playerId] : undefined;
              const seen = p ? result?.injuries?.find((x) => x.playerId === p.id) : undefined;
              return (
                <li key={i.index}>
                  <b>{i.teamAbbrev}</b> {p ? <PlayerLink league={league} player={p} short pos /> : i.name}:{' '}
                  {seen ? `${injuryLabel(seen.type).toLowerCase()}, ${estimateText(seen)}` : i.what}
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </aside>
  );
}

// ───────── the players ─────────

const n = (x: number | undefined) => x ?? 0;
const has = (key: keyof RunningLine) => SHOWN_LINE.includes(key);
const extra = (count: number, word: string) => (count ? ` · ${count} ${word}` : '');

interface Category {
  label: string;
  /** Who belongs in it, and his order in it (most first). */
  rank: (l: RunningLine) => number;
  in: (l: RunningLine) => boolean;
  /** His line, long (a leader's) or short (a row among his team's). */
  line: (l: RunningLine, short: boolean) => string;
}
const CATEGORIES: readonly Category[] = [
  {
    label: 'Passing',
    in: (l) => n(l.passAtt) > 0,
    rank: (l) => n(l.passYds) * 1000 + n(l.passAtt),
    line: (l, short) =>
      `${n(l.passCmp)}/${n(l.passAtt)} · ${n(l.passYds)}${short ? '' : ' yds'}${extra(n(l.passTd), 'TD')}${extra(n(l.passInt), 'INT')}`,
  },
  {
    label: 'Rushing',
    in: (l) => n(l.rushAtt) > 0,
    rank: (l) => n(l.rushYds) * 1000 + n(l.rushAtt),
    line: (l, short) =>
      short
        ? `${n(l.rushAtt)} · ${n(l.rushYds)}${extra(n(l.rushTd), 'TD')}`
        : `${n(l.rushAtt)} car · ${n(l.rushYds)} yds${extra(n(l.rushTd), 'TD')}`,
  },
  {
    label: 'Receiving',
    in: (l) => n(l.rec) > 0,
    rank: (l) => n(l.recYds) * 1000 + n(l.rec),
    line: (l, short) =>
      short
        ? `${n(l.rec)} · ${n(l.recYds)}${extra(n(l.recTd), 'TD')}`
        : `${n(l.rec)} rec · ${n(l.recYds)} yds${extra(n(l.recTd), 'TD')}`,
  },
];
/** Sacks and picks: a row among a team's lines, never a leader's category (most games have one or none). */
const DEFENSE: Category = {
  label: 'Defense',
  in: (l) => (has('sacks') && n(l.sacks) > 0) || (has('defInt') && n(l.defInt) > 0),
  rank: (l) => n(l.sacks) + n(l.defInt),
  line: (l) =>
    [n(l.sacks) ? `${n(l.sacks)} sack${n(l.sacks) === 1 ? '' : 's'}` : '', n(l.defInt) ? `${n(l.defInt)} INT` : '']
      .filter(Boolean)
      .join(' · '),
};

export function PlayersPanel({
  league,
  home,
  away,
  plays,
  shown,
  names,
  record,
  playerTeams,
}: {
  league: League;
  home: Team;
  away: Team;
  plays: readonly PlayLogEntry[];
  shown: number;
  names: PlayNames;
  /** Who was on the field (the passer comes from it); a game that kept none falls back to the play's text. */
  record?: FieldRecord;
  /** A finished game's own list of who played for whom, so a later trade can't move a line. */
  playerTeams?: Record<number, number>;
}) {
  const [who, setWho] = usePref(WHO_KEY, WHO_PICKS, 'leaders');
  const lines = useMemo(() => linesAt(plays, shown, home.id, names, record), [plays, shown, home.id, names, record]);
  const colors = { [home.id]: laneColor(home.colors), [away.id]: laneColor(away.colors) };
  /** A team's men in a category, most first. */
  const men = (team: Team, c: Category) =>
    [...lines]
      .filter(
        ([id, l]) => league.players[id] && (playerTeams?.[id] ?? league.players[id].teamId) === team.id && c.in(l),
      )
      .sort((a, b) => c.rank(b[1]) - c.rank(a[1]));
  const picks: { key: typeof who; label: string }[] = [
    { key: 'leaders', label: 'Leaders' },
    { key: 'away', label: away.abbrev },
    { key: 'home', label: home.abbrev },
  ];
  const team = who === 'home' ? home : who === 'away' ? away : null;
  const groups = team
    ? [...CATEGORIES, DEFENSE].map((c) => ({ c, rows: men(team, c).map(([id, l]) => ({ id, l, teamId: team.id })) }))
    : CATEGORIES.map((c) => ({
        c,
        rows: [away, home].flatMap((t) =>
          men(t, c)
            .slice(0, 1)
            .map(([id, l]) => ({ id, l, teamId: t.id })),
        ),
      }));
  const any = groups.some((g) => g.rows.length);
  return (
    <aside className="stage-rail rail-players" aria-label="The players">
      <section className="rail-card">
        <div className="rail-head">
          <h2>Players</h2>
          <span className="seg seg-sm" role="group" aria-label="Whose players">
            {picks.map((p) => (
              <button key={p.key} aria-pressed={who === p.key} onClick={() => setWho(p.key)}>
                {p.label}
              </button>
            ))}
          </span>
        </div>
        {!any && <p className="rail-fine">No plays yet.</p>}
        {groups
          .filter((g) => g.rows.length)
          .map(({ c, rows }) => (
            <div key={c.label} className="lead-cat">
              <h3>{c.label}</h3>
              {rows.map(({ id, l, teamId }) =>
                team ? (
                  <div key={id} className="line-row">
                    <PlayerLink league={league} player={league.players[id]} short pos />
                    <span className="num">{c.line(l, true)}</span>
                  </div>
                ) : (
                  <div key={id} className="lead-row">
                    <i style={{ background: colors[teamId] }} />
                    <div>
                      <PlayerLink league={league} player={league.players[id]} short bold />
                      <span className="num">{c.line(l, false)}</span>
                    </div>
                  </div>
                ),
              )}
            </div>
          ))}
      </section>
    </aside>
  );
}

// ───────── the tabs a narrow window gets ─────────

const TAB_LABELS: Record<StageTab, string> = { plays: 'Plays', game: 'Game', players: 'Players' };

/** Plays · Game · Players: what shows under the field when the panels can't sit beside it. */
export function StageTabs({ value, onChange }: { value: StageTab; onChange: (t: StageTab) => void }) {
  return (
    <span className="seg stage-tabs" role="group" aria-label="Below the field">
      {STAGE_TABS.map((t) => (
        <button key={t} aria-pressed={t === value} onClick={() => onChange(t)}>
          {TAB_LABELS[t]}
        </button>
      ))}
    </span>
  );
}
