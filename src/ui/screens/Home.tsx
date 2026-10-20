import { useState, type CSSProperties } from 'react';
import { AWARD_SHORT, HONOR_SLOTS, monthEnding, seasonAwards, weeklyAwards, type AwardWinner } from '../../engine/awards';
import { champion, userGame } from '../../engine/league';
import { capSheet } from '../../engine/finance/cap';
import { autoCutdown, FA_DAYS } from '../../engine/offseason';
import { expiringPlayers } from '../../engine/offseason/ai';
import { formatRecord, gmRecord } from '../../engine/records';
import { activeRoster, teamPlayers, teamRatings } from '../../engine/roster';
import { staffWindowOpen } from '../../engine/staff';
import { allSeeds, ROUND_NAMES, roundWeek } from '../../engine/season/playoffs';
import { computeRecords, divisionStandings } from '../../engine/season/standings';
import type { Game, League, Team } from '../../engine/types';
import { forecast } from '../../engine/weather';
import { useNav } from '../App';
import { attentionText, coachAttention } from '../coaching';
import { Panel, TeamChip, TeamLabel, WeatherNote } from '../components';
import { isOffseasonPhase, money, pct, PHASE_LABELS, recordText, shortName, weekLabel } from '../format';
import { live } from '../live';
import { WinnerCell } from './Stats';
import { CrewNote } from './Officials';
import { BackupButton, LoadBackupButton } from '../saves';
import { ThemeSelect } from '../theme';
import { store } from '../store';
import { LinkedText, moveIndex, MoveText, type Who } from '../moves';
import { ScoreStrip } from '../strip';
import { LeagueLeaders, SeasonSoFar, TeamStatsWidget, TheirInjuries, WaitingForYou, YourInjuries } from '../widgets';
import { GameStar, gameStory, KeyStats, LineScore, standouts, Standouts } from '../game';

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
    // The top seed has no Wild Card game: that is a bye, not elimination.
    const topSeedBye = league.phase === 'playoffs' && league.week === roundWeek('WC') && allSeeds(league)[user.conference][0] === user.id;
    const eliminated = league.phase === 'playoffs' && !topSeedBye;
    const title = topSeedBye ? 'Wild Card: first-round bye' : eliminated ? 'Season over for you' : `${weekLabel(league.week)}: bye week`;
    return (
      <Panel title={title}>
        <p className="muted" style={{ margin: 0 }}>
          {topSeedBye
            ? 'You earned the top seed and skip the Wild Card round. Play the week to see who you will host in the Divisional Round.'
            : eliminated
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
      <p style={{ margin: 0 }}>
        Forecast: <WeatherNote forecast={forecast(league, game)} />
      </p>
      <p style={{ margin: 0 }}>
        Crew: <CrewNote league={league} game={game} />
      </p>
      <TheirInjuries league={league} opp={opp} game={game} />
      <p className="muted" style={{ margin: 0, fontSize: 'var(--step--1)' }}>
        {game.neutral ? 'Neutral site.' : isHome ? 'Home game: a small edge in every matchup.' : `Road game in ${opp.city}.`} Press Play to watch it live.
        Unit ratings are starter averages on the 1–20 scale.
      </p>
    </Panel>
  );
}

/** Our last game: the score and how it went, the line score and key stats, the player of the game and our best. */
function LastGame({ league }: { league: League }) {
  const nav = useNav();
  const game = lastUserGame(league);
  if (!game) return null;
  const r = game.result!;
  const user = league.userTeamId;
  const userHome = game.homeId === user;
  const us = userHome ? r.homeScore : r.awayScore;
  const them = userHome ? r.awayScore : r.homeScore;
  const res = us > them ? 'W' : us < them ? 'L' : 'T';
  const opp = league.teams[userHome ? game.awayId : game.homeId];
  const when = game.playoffRound ? ROUND_NAMES[game.playoffRound] : weekLabel(game.week);
  const where = game.neutral ? 'neutral site' : userHome ? 'at home' : `at ${opp.city}`;
  const best = standouts(league, game, user, 3);
  return (
    <Panel
      className="last-game"
      title={
        <span className="eyebrow">
          Last game · {when} · {where}
        </span>
      }
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
      <div className="last-result">
        <span className={`res-${res}`}>{res}</span>
        <span>
          {us}–{them}
        </span>
        <span className="small muted">
          {userHome || game.neutral ? 'vs' : 'at'}{' '}
          <button className="linklike" onClick={() => nav.openTeam(opp.id)}>
            {opp.city} {opp.name}
          </button>
        </span>
      </div>
      <p className="small" style={{ margin: 0 }}>
        {gameStory(game, user)}
      </p>
      <div className="split-2">
        <LineScore league={league} game={game} teamId={user} />
        <KeyStats league={league} game={game} teamId={user} />
      </div>
      <div className="split-2">
        <GameStar league={league} game={game} />
        {best.length > 0 && (
          <div>
            <div className="eyebrow">Your top performers</div>
            <Standouts rows={best} />
          </div>
        )}
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

/** The user's record as general manager, season by season (shown once a season has been finished). */
function GmRecord({ league }: { league: League }) {
  const rec = gmRecord(league);
  if (!rec.seasons.length) return null;
  const n = rec.seasons.length;
  const parts = [
    `${formatRecord(rec.regular)} in ${n} season${n > 1 ? 's' : ''}`,
    rec.playoffs.w + rec.playoffs.l ? `${rec.playoffs.w}–${rec.playoffs.l} in the playoffs` : '',
    rec.playoffTrips ? `${rec.playoffTrips} playoff trip${rec.playoffTrips > 1 ? 's' : ''}` : '',
    rec.titles ? `${rec.titles} title${rec.titles > 1 ? 's' : ''}` : '',
  ].filter(Boolean);
  return (
    <Panel title="Your record as GM">
      <p style={{ margin: 0 }}>{parts.join(' · ')}</p>
      <details className="more">
        <summary className="small">Season by season</summary>
        <div className="table-scroll">
          <table className="small">
            <thead>
              <tr>
                <th className="num">Season</th>
                <th className="num">Record</th>
                <th>Playoffs</th>
              </tr>
            </thead>
            <tbody>
              {rec.seasons.map((s) => (
                <tr key={s.season}>
                  <td className="num">{s.season}</td>
                  <td className="num">{formatRecord(s.regular)}</td>
                  <td className={s.champion ? 'tone-good' : 'muted'}>{s.playoffs ? `${s.finish} (${s.playoffs.w}–${s.playoffs.l})` : s.finish || '–'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
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
        {isUser ? 'You won it all. ' : ''}Press “Begin {league.season + 1} offseason” to open the new league year: re-signings, free agency, the draft and
        training camp.
      </p>
    </section>
  );
}

/** The season's awards, announced once the regular season ends (and kept up through the playoffs). */
function AwardsNotice({ league }: { league: League }) {
  const nav = useNav();
  const awards = league.phase === 'regular' ? undefined : seasonAwards(league, league.season);
  if (!awards) return null;
  const winners = (['mvp', 'opoy', 'dpoy'] as const).filter((k) => awards.winners[k]).map((k) => ({ k, w: awards.winners[k]! }));
  // Your own winners hear about it in the inbox; the banner is the league's news.
  return (
    <div className="notice staff-notice">
      <span>
        <b>Awards week: the {awards.season} awards are in.</b>{' '}
        {winners.map(({ k, w }, i) => (
          <span key={k}>
            {i > 0 && ' · '}
            {AWARD_SHORT[k]}{' '}
            <button className="linklike" onClick={() => nav.openPlayer(w.playerId)}>
              {shortName(league.players[w.playerId])}
            </button>
            {w.teamId !== null ? ` (${league.teams[w.teamId].abbrev})` : ''}
          </span>
        ))}
        .
      </span>
      <button className="btn btn-sm" onClick={() => nav.go({ view: 'stats', tab: 'awards' })}>
        All awards
      </button>
    </div>
  );
}

/** The latest week's players of the week (and of the month, when one just ended). */
function PlayersOfTheWeek({ league }: { league: League }) {
  const nav = useNav();
  const [period, setPeriod] = useState<'week' | 'month'>('week');
  const honors = weeklyAwards(league, league.season);
  const week = Math.max(0, ...Object.keys(honors?.weeks ?? {}).map(Number));
  if (!honors || !week) return null;
  const month = monthEnding(week);
  const monthly = month && honors.months[month.key];
  const showMonth = period === 'month' && !!monthly;
  const list = (winners: (AwardWinner | null)[], weeks: [number, number]) => (
    <ul className="honor-list">
      {HONOR_SLOTS.map(({ conference, side }, i) => (
        <li key={i} className={winners[i] && league.players[winners[i]!.playerId].teamId === league.userTeamId ? 'is-user' : undefined}>
          <span className="eyebrow">
            {league.conferences[conference].abbrev} {side}
          </span>
          <WinnerCell league={league} winner={winners[i]} season={league.season} weeks={weeks} />
        </li>
      ))}
    </ul>
  );
  return (
    <Panel
      title={showMonth ? `Players of the month · ${month!.label}` : `Players of the week · ${weekLabel(week)}`}
      action={
        <span className="row" style={{ gap: 8 }}>
          {monthly && (
            <span className="seg" role="group" aria-label="Week or month">
              <button aria-pressed={!showMonth} onClick={() => setPeriod('week')}>
                {weekLabel(week)}
              </button>
              <button aria-pressed={showMonth} onClick={() => setPeriod('month')}>
                {month!.label}
              </button>
            </span>
          )}
          <button className="btn btn-sm btn-ghost" onClick={() => nav.go({ view: 'stats', tab: 'awards' })}>
            All awards
          </button>
        </span>
      }
    >
      {showMonth ? list(monthly!, month!.weeks) : list(honors.weeks[week], [week, week])}
    </Panel>
  );
}

function StartOver({ league }: { league: League }) {
  const [confirming, setConfirming] = useState(false);
  return (
    <div className="row" style={{ justifyContent: 'flex-end' }}>
      {confirming ? (
        <>
          <span className="muted">This deletes your current career.</span>
          <button className="btn btn-sm" onClick={() => setConfirming(false)}>
            Keep playing
          </button>
          <BackupButton league={league} />
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
        <>
          <ThemeSelect />
          <BackupButton league={league} />
          <LoadBackupButton />
          <button className="btn btn-sm btn-ghost" onClick={() => setConfirming(true)}>
            Start a new career
          </button>
        </>
      )}
    </div>
  );
}

const STEPS: [League['phase'], string][] = [
  ['resign', 'Re-sign'],
  ['freeAgency', 'Free agency'],
  ['draft', 'Draft'],
  ['preseason', 'Training camp'],
  ['regular', 'Week 1'],
];

/** What this step of the offseason is about, with the numbers that matter for it. */
function OffseasonHome({ league }: { league: League }) {
  const nav = useNav();
  const teamId = league.userTeamId;
  const team = league.teams[teamId];
  const sheet = capSheet(league, teamId);
  // Injured reserve doesn't count toward the 53.
  const roster = activeRoster(league, teamId);
  const reserve = teamPlayers(league, teamId).length - roster.length;
  const idx = STEPS.findIndex(([p]) => p === league.phase);
  const last = league.history[league.history.length - 1];
  // Your own trades, retirements, injuries and position moves come to the inbox instead.
  const inboxed = new Set(['trade', 'retire', 'injury', 'position']);
  const moves = league.transactions
    .filter((t) => t.season === league.season && t.kind !== 'release' && !(inboxed.has(t.kind) && t.teamIds.includes(teamId)))
    .slice(-14)
    .reverse();
  const names = moveIndex(league);
  // A calm nudge, not a second primary action: an empty coaching chair or deals that are up, while moves are open.
  const attention = staffWindowOpen(league) ? coachAttention(league, teamId) : null;
  const coachNote = attention ? attentionText(league, teamId, attention) : '';
  const myPick = league.draftPicks.filter((p) => p.season === league.season && p.ownerId === teamId && p.playerId === undefined).sort((a, b) => (a.overall ?? 999) - (b.overall ?? 999))[0];

  let title = '';
  let body = '';
  let action: { label: string; go: () => void } | null = null;
  switch (league.phase) {
    case 'resign': {
      const n = expiringPlayers(league, teamId).length;
      title = 'Re-sign window';
      body = `${n} of your players are out of contract. Re-sign the ones you need, use your franchise tag${team.taggedId ? ' (used)' : ''}, and decide fifth-year options. Everyone else hits free agency when you open it.`;
      action = { label: 'Expiring contracts', go: () => nav.go({ view: 'office', tab: 'resign' }) };
      break;
    }
    case 'freeAgency':
      title = `Free agency · day ${league.faDay} of ${FA_DAYS}`;
      body = `Make offers now: rival teams sign players every time you advance a day, but asks drop as the market cools. You have ${money(Math.round(sheet.space))} of room and ${roster.length} players.`;
      action = { label: 'Free agents', go: () => nav.go({ view: 'office', tab: 'fa' }) };
      break;
    case 'draft':
      title = 'The draft';
      body = myPick ? `Your next pick: round ${myPick.round}, No. ${myPick.overall}. Sim to it, then pick from the big board or let your scouts choose.` : 'You have no picks left in this draft.';
      action = { label: 'Draft room', go: () => nav.go({ view: 'office', tab: 'draft' }) };
      break;
    case 'preseason':
      title = 'Training camp';
      body = `Cut down to 53 before week 1 (you have ${roster.length}${reserve ? `, plus ${reserve} on injured reserve` : ''}). After June 1, dead money from cuts is split across two years automatically.`;
      action = { label: 'Cap & cuts', go: () => nav.go({ view: 'cap' }) };
      break;
  }

  return (
    <>
      <ol className="stepper" aria-label="Offseason steps">
        {STEPS.map(([phase, label], i) => (
          <li key={phase} className={i < idx ? 'done' : i === idx ? 'current' : undefined} aria-current={i === idx ? 'step' : undefined}>
            {label}
          </li>
        ))}
      </ol>
      <div className="grid-2">
        <div className="stack">
          <Panel title={title} action={action && <button className="btn btn-sm btn-primary" onClick={action.go}>{action.label}</button>}>
            <p style={{ marginTop: 0 }}>{body}</p>
            <div className="facts">
              <span className="fact">
                <span className="eyebrow">Cap space</span>
                <b className={`num${sheet.space < 0 ? ' tone-bad' : ''}`}>{money(Math.round(sheet.space))}</b>
              </span>
              <span className="fact">
                <span className="eyebrow">Roster</span>
                <b className="num">{roster.length}</b>
              </span>
              <span className="fact">
                <span className="eyebrow">{league.season} cap</span>
                <b className="num">{money(league.caps[league.season])}</b>
              </span>
              {last && (
                <span className="fact">
                  <span className="eyebrow">{last.season} champion</span>
                  <b>{league.teams[last.championId].name}</b>
                </span>
              )}
            </div>
            {league.phase === 'preseason' && roster.length > 53 && (
              <div className="row" style={{ marginTop: 12 }}>
                <button className="btn btn-sm" onClick={() => store.mutate(autoCutdown)}>
                  Let the coaches make the cuts
                </button>
                <span className="muted small">Keeps the best value at each position, signs minimum fill-ins if a group runs thin.</span>
              </div>
            )}
          </Panel>
          {coachNote && (
            <div className="notice staff-notice">
              <span>
                <LinkedText league={league} text={coachNote} about={attention!.leaving.map((c): Who => ({ kind: 'coach', id: c.id }))} />
              </span>
              <button className="btn btn-sm" onClick={() => nav.go({ view: 'office', tab: 'coaches' })}>
                Review coaches
              </button>
            </div>
          )}
          <WaitingForYou league={league} />
        </div>
        <Panel title="Around the league">
          {moves.length === 0 ? (
            <p className="muted" style={{ margin: 0 }}>
              Quiet so far.
            </p>
          ) : (
            <ul className="moves">
              {moves.map((m, i) => (
                <li key={i}>
                  <span className="muted small">{PHASE_LABELS[m.phase]}</span>
                  <span>
                    <MoveText move={m} index={names} />
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </>
  );
}

export function Home({ league }: { league: League }) {
  if (isOffseasonPhase(league)) {
    return (
      <>
        <OffseasonHome league={league} />
        <GmRecord league={league} />
        <StartOver league={league} />
      </>
    );
  }
  const last = !!lastUserGame(league);
  const next = league.phase !== 'complete';
  const honors = weeklyAwards(league, league.season);
  const pow = !!honors && Object.keys(honors.weeks).length > 0;
  const gm = gmRecord(league).seasons.length > 0;
  // One grid, row by row: the games, the week's business, the league's leaders, the season. A row's panels line up;
  // a panel with no partner takes the whole row.
  return (
    <>
      <ScoreStrip league={league} />
      <ChampionBanner league={league} />
      <AwardsNotice league={league} />
      <div className="home-grid">
        {next && (
          <div className={`home-cell ${last ? 'span-6' : 'span-12'}`}>
            <NextGame league={league} />
          </div>
        )}
        {last && (
          <div className={`home-cell ${next ? 'span-6' : 'span-12'}`}>
            <LastGame league={league} />
          </div>
        )}
        <div className="home-cell span-4">
          <DivisionMini league={league} />
        </div>
        <div className="home-cell span-4">
          <YourInjuries league={league} />
        </div>
        <div className="home-cell span-4">
          <WaitingForYou league={league} />
        </div>
        <div className="home-cell span-6">
          <LeagueLeaders league={league} />
        </div>
        <div className="home-cell span-6">
          <TeamStatsWidget league={league} />
        </div>
        <div className={`home-cell ${pow ? 'span-4' : 'span-12'}`}>
          <SeasonSoFar league={league} />
        </div>
        {pow && (
          <div className="home-cell span-8">
            <PlayersOfTheWeek league={league} />
          </div>
        )}
        {gm && (
          <div className="home-cell span-12">
            <GmRecord league={league} />
          </div>
        )}
      </div>
      <StartOver league={league} />
    </>
  );
}
