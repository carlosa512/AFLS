import { useState, type CSSProperties } from 'react';
import { champion, gamesInWeek, userGame } from '../../engine/league';
import { teamRatings } from '../../engine/roster';
import { ROUND_NAMES } from '../../engine/season/playoffs';
import { computeRecords, divisionStandings } from '../../engine/season/standings';
import { teamLeader } from '../../engine/stats';
import type { Game, League, StatKey, Team } from '../../engine/types';
import { useNav } from '../App';
import { Panel, TeamChip, TeamLabel } from '../components';
import { pct, recordText, shortName, weekLabel } from '../format';
import { live } from '../live';
import { store } from '../store';

function lastUserGame(league: League): Game | undefined {
  return league.games
    .filter((g) => g.season === league.season && g.result && (g.homeId === league.userTeamId || g.awayId === league.userTeamId))
    .sort((a, b) => b.week - a.week)[0];
}

export function ScoreLine({ league, game }: { league: League; game: Game }) {
  const nav = useNav();
  const r = game.result!;
  const away = league.teams[game.awayId];
  const home = league.teams[game.homeId];
  return (
    <button className="score-line" onClick={() => nav.openGame(game.id)}>
      <span className={`t${r.awayScore < r.homeScore ? ' lost' : ''}`}>
        <TeamChip team={away} /> {away.name}
      </span>
      <span className="s">{r.awayScore}</span>
      <span className={`t${r.homeScore < r.awayScore ? ' lost' : ''}`}>
        <TeamChip team={home} /> {home.name}
      </span>
      <span className="s">
        {r.homeScore}
        {r.overtime ? ' OT' : ''}
      </span>
    </button>
  );
}

function UnitBars({ a, b, league }: { a: Team; b: Team; league: League }) {
  const ra = teamRatings(league, a);
  const rb = teamRatings(league, b);
  const rows: [string, number, number][] = [
    ['QB', ra.qb, rb.qb],
    ['Offense', ra.offense, rb.offense],
    ['Defense', ra.defense, rb.defense],
    ['Kicking', ra.special, rb.special],
  ];
  const w = (v: number) => `${Math.max(4, Math.min(100, (v / 20) * 100))}%`;
  return (
    <div className="unit-bars">
      {rows.map(([label, va, vb]) => (
        <div className="unit-bar" key={label}>
          <span className="num">{va.toFixed(1)}</span>
          <span className="bar rev">
            <i style={{ width: w(va), '--c': a.colors[0] } as CSSProperties} />
          </span>
          <span className="label">{label}</span>
          <span className="bar">
            <i style={{ width: w(vb), '--c': b.colors[0] } as CSSProperties} />
          </span>
          <span className="num" style={{ textAlign: 'right' }}>
            {vb.toFixed(1)}
          </span>
        </div>
      ))}
    </div>
  );
}

function NextGame({ league }: { league: League }) {
  const nav = useNav();
  const records = computeRecords(league);
  const user = league.teams[league.userTeamId];
  const game = league.phase === 'complete' ? undefined : userGame(league);

  if (league.phase === 'complete') return null;
  if (!game) {
    const eliminated = league.phase === 'playoffs';
    return (
      <Panel title={eliminated ? 'Season over for you' : `${weekLabel(league.week)}: bye week`}>
        <p className="muted" style={{ margin: 0 }}>
          {eliminated
            ? 'Your team is out of the playoffs. Sim ahead to see who wins the title, then start next season.'
            : 'No game this week. Use it to tune your depth chart, then play the week to see the league results.'}
        </p>
      </Panel>
    );
  }
  const isHome = game.homeId === user.id;
  const opp = league.teams[isHome ? game.awayId : game.homeId];
  const title = game.playoffRound ? ROUND_NAMES[game.playoffRound] : weekLabel(league.week);
  return (
    <Panel title={<span className="eyebrow">Next up · {title}</span>} className="hero-game">
      <div className="matchup">
        <div className="matchup-side">
          <TeamChip team={user} large />
          <strong>{user.name}</strong>
          <span className="muted">{recordText(records.get(user.id)!)}</span>
        </div>
        <span className="vs">{game.neutral ? 'vs' : isHome ? 'vs' : '@'}</span>
        <div className="matchup-side right">
          <TeamChip team={opp} large />
          <strong>
            <button className="linklike" onClick={() => nav.openTeam(opp.id)}>
              {opp.name}
            </button>
          </strong>
          <span className="muted">{recordText(records.get(opp.id)!)}</span>
        </div>
      </div>
      <UnitBars a={user} b={opp} league={league} />
      <p className="muted" style={{ margin: 0, fontSize: 'var(--step--1)' }}>
        {game.neutral ? 'Neutral site.' : isHome ? 'Home game: a small edge in every matchup.' : `Road game in ${opp.city}.`} Press Play to watch it live.
        Unit ratings are starter averages on the 1–20 scale.
      </p>
    </Panel>
  );
}

function LastResult({ league }: { league: League }) {
  const nav = useNav();
  const game = lastUserGame(league);
  if (!game) return null;
  const r = game.result!;
  const userHome = game.homeId === league.userTeamId;
  const us = userHome ? r.homeScore : r.awayScore;
  const them = userHome ? r.awayScore : r.homeScore;
  const res = us > them ? 'W' : us < them ? 'L' : 'T';
  const opp = league.teams[userHome ? game.awayId : game.homeId];
  return (
    <Panel
      title={<span className="eyebrow">Last game · {weekLabel(game.week)}</span>}
      action={
        <span className="row" style={{ gap: 8 }}>
          <button className="btn btn-sm" onClick={() => nav.openGame(game.id)}>
            Box score
          </button>
          <button className="btn btn-sm btn-primary" onClick={() => nav.watchGame(game.id)}>
            ▶ Watch replay
          </button>
        </span>
      }
    >
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <span className="row">
          <span className={`res-${res}`} style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--step-3)', lineHeight: 1 }}>
            {res}
          </span>
          <span style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--step-3)', fontWeight: 800, lineHeight: 1 }}>
            {us}–{them}
          </span>
        </span>
        <TeamLabel team={opp} full sub={userHome ? 'at home' : 'on the road'} />
      </div>
    </Panel>
  );
}

function DivisionMini({ league }: { league: League }) {
  const nav = useNav();
  const user = league.teams[league.userTeamId];
  const div = divisionStandings(league).find((d) => d.index === user.division)!;
  return (
    <Panel title={div.division.name} action={<button className="btn btn-sm btn-ghost" onClick={() => nav.go({ view: 'standings' })}>All standings</button>}>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Team</th>
              <th className="num">W-L-T</th>
              <th className="num">Pct</th>
              <th className="num">Diff</th>
              <th className="num">Strk</th>
            </tr>
          </thead>
          <tbody>
            {div.teams.map((r) => {
              const t = league.teams[r.teamId];
              return (
                <tr key={t.id} className={t.id === user.id ? 'is-user' : ''}>
                  <td>
                    <TeamLabel team={t} onClick={() => nav.openTeam(t.id)} />
                  </td>
                  <td className="num">{`${r.w}-${r.l}-${r.t}`}</td>
                  <td className="num">{pct(r)}</td>
                  <td className="num">{r.pf - r.pa > 0 ? `+${r.pf - r.pa}` : r.pf - r.pa}</td>
                  <td className="num">{r.streak || '–'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function TeamLeaders({ league }: { league: League }) {
  const nav = useNav();
  const cats: [StatKey, string][] = [
    ['passYds', 'Pass yds'],
    ['rushYds', 'Rush yds'],
    ['recYds', 'Rec yds'],
    ['tackles', 'Tackles'],
    ['sacks', 'Sacks'],
    ['defInt', 'INT'],
  ];
  const rows = cats.map(([k, label]) => [label, teamLeader(league, league.userTeamId, k)] as const).filter(([, r]) => r);
  return (
    <Panel title="Team leaders">
      {rows.length === 0 ? (
        <p className="muted" style={{ margin: 0 }}>
          Stats appear after your first game.
        </p>
      ) : (
        <div className="leaders-mini">
          {rows.map(([label, r]) => (
            <div className="leader-card" key={label}>
              <span className="eyebrow">{label}</span>
              <span className="v">{r!.value}</span>
              <button className="linklike" onClick={() => nav.openPlayer(r!.player.id)}>
                {shortName(r!.player)}
              </button>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

function AroundTheLeague({ league }: { league: League }) {
  const week = league.phase === 'complete' ? league.week - 1 : league.week - 1;
  const games = week >= 1 ? gamesInWeek(league, week).filter((g) => g.result) : [];
  if (!games.length) return null;
  return (
    <Panel title={`${weekLabel(week)} scores`}>
      <div className="scores-grid">
        {games.map((g) => (
          <ScoreLine key={g.id} league={league} game={g} />
        ))}
      </div>
    </Panel>
  );
}

function ChampionBanner({ league }: { league: League }) {
  const summary = champion(league);
  if (!summary) return null;
  const team = league.teams[summary.championId];
  const isUser = team.id === league.userTeamId;
  return (
    <section className="banner" style={{ background: team.colors[0], boxShadow: `inset 0 -8px 0 ${team.colors[1]}` }}>
      <span className="eyebrow" style={{ color: 'rgba(255,255,255,.8)' }}>
        {league.season} champions
      </span>
      <h2>
        {team.city} {team.name}
      </h2>
      <p style={{ margin: 0, opacity: 0.9 }}>
        {isUser ? 'You won it all. ' : ''}Press “Start {league.season + 1} season” to age the rosters, bring in rookies and build the new schedule.
      </p>
    </section>
  );
}

function StartOver() {
  const [confirming, setConfirming] = useState(false);
  return (
    <div className="row" style={{ justifyContent: 'flex-end' }}>
      {confirming ? (
        <>
          <span className="muted">This deletes your current career.</span>
          <button className="btn btn-sm" onClick={() => setConfirming(false)}>
            Keep playing
          </button>
          <button
            className="btn btn-sm"
            onClick={() => {
              live.clear();
              store.set(null);
            }}
          >
            Delete and start over
          </button>
        </>
      ) : (
        <button className="btn btn-sm btn-ghost" onClick={() => setConfirming(true)}>
          Start a new career
        </button>
      )}
    </div>
  );
}

export function Home({ league }: { league: League }) {
  return (
    <>
      <ChampionBanner league={league} />
      <div className="grid-2">
        <div className="stack">
          <NextGame league={league} />
          <LastResult league={league} />
          <TeamLeaders league={league} />
        </div>
        <div className="stack">
          <DivisionMini league={league} />
        </div>
      </div>
      <AroundTheLeague league={league} />
      <StartOver />
    </>
  );
}
