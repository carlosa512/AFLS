import { useState } from 'react';
import { estimateText, injuryLabel } from '../../engine/injuries';
import { ROUND_NAMES } from '../../engine/season/playoffs';
import { passerRating } from '../../engine/stats';
import type { GameResult, League, Player, PlayLogEntry, StatLine, Team, TeamGameStats } from '../../engine/types';
import { useNav } from '../App';
import { FieldStrip, Panel, TeamChip, WeatherNote } from '../components';
import { PlayText, usePlayNames, type PlayNames } from './GameViewer';
import { GameOfficials } from './Officials';
import { gameClock, shortName, weekLabel } from '../format';

type Row = [Player, StatLine];

function TeamStatsTable({ away, home, a, h }: { away: Team; home: Team; a: TeamGameStats; h: TeamGameStats }) {
  const top = (s: number) => gameClock(s);
  const rows: [string, string | number, string | number][] = [
    ['First downs', a.firstDowns, h.firstDowns],
    ['Total yards', a.totalYds, h.totalYds],
    ['Passing', a.passYds, h.passYds],
    ['Comp–Att', `${a.passCmp}–${a.passAtt}`, `${h.passCmp}–${h.passAtt}`],
    ['Rushing', `${a.rushYds} (${a.rushAtt})`, `${h.rushYds} (${h.rushAtt})`],
    ['Sacked', a.sacked, h.sacked],
    ['3rd down', `${a.thirdDownConv}/${a.thirdDownAtt}`, `${h.thirdDownConv}/${h.thirdDownAtt}`],
    ['4th down', `${a.fourthDownConv}/${a.fourthDownAtt}`, `${h.fourthDownConv}/${h.fourthDownAtt}`],
    ['Red zone TD', `${a.redZoneTd}/${a.redZoneAtt}`, `${h.redZoneTd}/${h.redZoneAtt}`],
    ['Turnovers', a.turnovers, h.turnovers],
    ['Penalties', `${a.penalties}–${a.penaltyYds}`, `${h.penalties}–${h.penaltyYds}`],
    ['Possession', top(a.top), top(h.top)],
  ];
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th />
            <th className="num">{away.abbrev}</th>
            <th className="num">{home.abbrev}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([label, av, hv]) => (
            <tr key={label}>
              <td>{label}</td>
              <td className="num">{av}</td>
              <td className="num">{hv}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StatTable({
  title,
  rows,
  cols,
}: {
  title: string;
  rows: Row[];
  cols: [string, (s: StatLine) => string | number][];
}) {
  const nav = useNav();
  if (!rows.length) return null;
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th className="sticky-col">{title}</th>
            {cols.map(([l]) => (
              <th key={l} className="num">
                {l}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(([p, s]) => (
            <tr key={p.id}>
              <td className="sticky-col">
                <button className="linklike" onClick={() => nav.openPlayer(p.id)}>
                  {shortName(p)}
                </button>
              </td>
              {cols.map(([l, f]) => (
                <td key={l} className="num">
                  {f(s)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PlayerStats({ league, result, teamId }: { league: League; result: GameResult; teamId: number }) {
  const rows: Row[] = Object.entries(result.playerStats)
    .map(([id, s]) => [league.players[Number(id)], s] as Row)
    .filter(([p]) => p && (result.playerTeams?.[p.id] ?? p.teamId) === teamId);
  const by = (pred: (s: StatLine) => boolean, sort: (s: StatLine) => number) =>
    rows.filter(([, s]) => pred(s)).sort((a, b) => sort(b[1]) - sort(a[1]));
  const n = (k: keyof StatLine) => (s: StatLine) => s[k] ?? 0;
  return (
    <div className="stack">
      <StatTable
        title="Passing"
        rows={by((s) => !!s.passAtt, n('passAtt'))}
        cols={[
          ['C/Att', (s) => `${s.passCmp ?? 0}/${s.passAtt}`],
          ['Yds', n('passYds')],
          ['TD', n('passTd')],
          ['Int', n('passInt')],
          ['Sck', n('sacked')],
          ['Rtg', (s) => passerRating(s).toFixed(1)],
        ]}
      />
      <StatTable
        title="Rushing"
        rows={by((s) => !!s.rushAtt, n('rushYds'))}
        cols={[
          ['Car', n('rushAtt')],
          ['Yds', n('rushYds')],
          ['Avg', (s) => ((s.rushYds ?? 0) / (s.rushAtt || 1)).toFixed(1)],
          ['TD', n('rushTd')],
          ['Long', n('rushLong')],
        ]}
      />
      <StatTable
        title="Receiving"
        rows={by((s) => !!s.targets, n('recYds'))}
        cols={[
          ['Rec', n('rec')],
          ['Tgt', n('targets')],
          ['Yds', n('recYds')],
          ['TD', n('recTd')],
          ['Long', n('recLong')],
        ]}
      />
      <StatTable
        title="Defense"
        rows={by(
          (s) => !!(s.tackles || s.sacks || s.defInt || s.passDef),
          (s) => (s.tackles ?? 0) + (s.sacks ?? 0) * 2 + (s.defInt ?? 0) * 3,
        )}
        cols={[
          ['Tkl', n('tackles')],
          ['TFL', n('tfl')],
          ['Sck', n('sacks')],
          ['Int', n('defInt')],
          ['PD', n('passDef')],
          ['FF', n('forcedFum')],
        ]}
      />
      <StatTable
        title="Kicking"
        rows={by((s) => !!(s.fgAtt || s.xpAtt), n('fgAtt'))}
        cols={[
          ['FG', (s) => `${s.fgMade ?? 0}/${s.fgAtt ?? 0}`],
          ['Long', n('fgLong')],
          ['XP', (s) => `${s.xpMade ?? 0}/${s.xpAtt ?? 0}`],
        ]}
      />
      <StatTable
        title="Punting"
        rows={by((s) => !!s.punts, n('punts'))}
        cols={[
          ['Punts', n('punts')],
          ['Avg', (s) => ((s.puntYds ?? 0) / (s.punts || 1)).toFixed(1)],
        ]}
      />
      <StatTable
        title="Penalties"
        rows={by((s) => !!s.penalties, n('penaltyYds'))}
        cols={[
          ['Flags', n('penalties')],
          ['Yds', n('penaltyYds')],
        ]}
      />
      <StatTable
        title="Returns"
        rows={by(
          (s) => !!(s.krAtt || s.prAtt),
          (s) => (s.krYds ?? 0) + (s.prYds ?? 0),
        )}
        cols={[
          ['KR', n('krAtt')],
          ['KR Yds', n('krYds')],
          ['PR', n('prAtt')],
          ['PR Yds', n('prYds')],
          ['TD', (s) => (s.krTd ?? 0) + (s.prTd ?? 0)],
        ]}
      />
    </div>
  );
}

function downText(p: PlayLogEntry) {
  if (!p.down) return '';
  const ord = ['', '1st', '2nd', '3rd', '4th'][p.down];
  return `${ord} & ${p.yardLine + p.distance >= 100 ? 'Goal' : p.distance}`;
}

function PlayByPlay({ league, plays, names }: { league: League; plays: PlayLogEntry[]; names: PlayNames }) {
  const [filter, setFilter] = useState<'all' | 'scoring'>('all');
  const shown = filter === 'all' ? plays : plays.filter((p) => p.scoring);
  const quarters = [...new Set(shown.map((p) => p.quarter))];
  const teamById = (id: number) => league.teams[id];
  return (
    <Panel
      title="Play-by-play"
      action={
        <div className="seg" role="group" aria-label="Play filter">
          <button aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>
            All plays
          </button>
          <button aria-pressed={filter === 'scoring'} onClick={() => setFilter('scoring')}>
            Scoring
          </button>
        </div>
      }
    >
      {quarters.map((q) => (
        <div key={q} className="pbp" style={{ marginBottom: 14 }}>
          <span className="eyebrow" style={{ padding: '6px 0' }}>
            {q <= 4 ? `Quarter ${q}` : 'Overtime'}
          </span>
          {shown
            .filter((p) => p.quarter === q)
            .map((p, i) => {
              const off = teamById(p.offense);
              return (
                <div key={i} className={`pbp-row${p.scoring ? ' scoring' : ''}`}>
                  <span className="num muted">{gameClock(p.clock)}</span>
                  <span className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
                    <TeamChip team={off} />
                  </span>
                  {p.down ? (
                    <FieldStrip small yardLine={p.yardLine} toGain={p.yardLine + p.distance} />
                  ) : (
                    <span className="field" aria-hidden="true" style={{ visibility: 'hidden' }} />
                  )}
                  <span className="txt">
                    {p.down ? (
                      <b className="num" style={{ marginRight: 8 }}>
                        {downText(p)}
                      </b>
                    ) : null}
                    <PlayText text={p.text} names={names} />
                    {p.scoring && (
                      <span className="num muted" style={{ marginLeft: 8 }}>
                        {p.awayScore}–{p.homeScore}
                      </span>
                    )}
                  </span>
                </div>
              );
            })}
        </div>
      ))}
    </Panel>
  );
}

export function BoxScore({ league, gameId, onBack }: { league: League; gameId: number; onBack: () => void }) {
  const nav = useNav();
  const game = league.games.find((g) => g.id === gameId);
  const [side, setSide] = useState<'away' | 'home'>(() => (game?.homeId === league.userTeamId ? 'home' : 'away'));
  const names = usePlayNames(league, game);
  if (!game?.result) {
    return (
      <Panel title="Game not found">
        <button className="btn" onClick={onBack}>
          Back
        </button>
      </Panel>
    );
  }
  const r = game.result;
  const away = league.teams[game.awayId];
  const home = league.teams[game.homeId];
  const label = game.playoffRound ? ROUND_NAMES[game.playoffRound] : weekLabel(game.week);
  const qCount = Math.max(r.quarters.home.length, r.quarters.away.length);

  return (
    <>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <button className="btn btn-sm btn-ghost" onClick={onBack}>
          ← Back
        </button>
        {(r.plays ?? []).some((p) => !p.scoring) && (
          <button className="btn btn-sm btn-primary" onClick={() => nav.watchGame(game.id)}>
            ▶ Watch replay
          </button>
        )}
      </div>
      <div className="scorebug">
        <div className="bug-team away" style={{ background: away.colors[0] }}>
          <span className="name">
            <span>{away.city}</span>
            <strong>{away.name}</strong>
          </span>
          <span className="bug-score">{r.awayScore}</span>
        </div>
        <div className="bug-mid">
          {r.overtime ? 'Final/OT' : 'Final'}
          <br />
          {label}
        </div>
        <div className="bug-team home" style={{ background: home.colors[0] }}>
          <span className="bug-score">{r.homeScore}</span>
          <span className="name">
            <span>{home.city}</span>
            <strong>{home.name}</strong>
          </span>
        </div>
      </div>
      {r.weather && (
        <p style={{ margin: 0, textAlign: 'center' }}>
          <WeatherNote weather={r.weather} forecast={null} />
        </p>
      )}

      <div className="grid-2">
        <Panel title="Line score">
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th />
                  {Array.from({ length: qCount }, (_, i) => (
                    <th key={i} className="num">
                      {i < 4 ? i + 1 : 'OT'}
                    </th>
                  ))}
                  <th className="num">T</th>
                </tr>
              </thead>
              <tbody>
                {(
                  [
                    [away, r.quarters.away, r.awayScore],
                    [home, r.quarters.home, r.homeScore],
                  ] as const
                ).map(([t, qs, total]) => (
                  <tr key={t.id}>
                    <td>
                      <span className="team-inline">
                        <TeamChip team={t} /> {t.abbrev}
                      </span>
                    </td>
                    {Array.from({ length: qCount }, (_, i) => (
                      <td key={i} className="num">
                        {qs[i] ?? 0}
                      </td>
                    ))}
                    <td className="num" style={{ fontWeight: 700 }}>
                      {total}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
        <Panel title="Team stats">
          <TeamStatsTable away={away} home={home} a={r.away} h={r.home} />
        </Panel>
        <GameOfficials league={league} game={game} away={away} home={home} />
      </div>

      <Panel
        title="Player stats"
        action={
          <div className="seg" role="group" aria-label="Team">
            <button aria-pressed={side === 'away'} onClick={() => setSide('away')}>
              {away.abbrev}
            </button>
            <button aria-pressed={side === 'home'} onClick={() => setSide('home')}>
              {home.abbrev}
            </button>
          </div>
        }
      >
        <PlayerStats league={league} result={r} teamId={side === 'away' ? away.id : home.id} />
      </Panel>

      {r.injuries && r.injuries.length > 0 && <GameInjuries league={league} result={r} />}

      {r.plays && r.plays.length > 0 && <PlayByPlay league={league} plays={r.plays} names={names} />}
    </>
  );
}

/** Who got hurt and when, with the diagnosis as it was made at the time. */
function GameInjuries({ league, result }: { league: League; result: GameResult }) {
  const nav = useNav();
  return (
    <Panel title="Injuries">
      <ul className="box-injuries">
        {result.injuries!.map((i) => {
          const p = league.players[i.playerId];
          if (!p) return null;
          return (
            <li key={i.playerId}>
              <b>{league.teams[i.teamId].abbrev}</b>{' '}
              <button className="linklike" onClick={() => nav.openPlayer(p.id)}>
                {p.position} {shortName(p)}
              </button>
              : {injuryLabel(i.type).toLowerCase()}, {estimateText(i)}{' '}
              <span className="muted small">
                ({i.quarter >= 5 ? 'OT' : `Q${i.quarter}`} {gameClock(i.clock)})
              </span>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}
