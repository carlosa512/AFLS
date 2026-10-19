/**
 * What a message opens with under its text: the cards each kind of mail brings (an opposition report's
 * matchup, a doctor's diagnosis, an award's stat line). Everything is looked up from the league as it is
 * now, from what the message is about (`mailSubject`); nothing extra is stored with the mail. Screens show
 * the user's view only: our scouts' reads, the doctor's estimate, the public consensus.
 */
import type { ReactNode } from 'react';
import { impact, periodLine, playerOfTheGame } from '../engine/awards';
import { demand, ROSTER_MAX } from '../engine/offseason/negotiation';
import { boardValue, reachOrSteal } from '../engine/offseason/draft';
import { draftClassOf, mailSubject, needsYou, unitReads, type MailSubject } from '../engine/inbox';
import { activateFromIr, activateProblem, delegates, estimateText, injuryLabel, IR_MIN_WEEKS, IR_RETURNS, irProblem, irReturnsUsed, placeOnIr, SEVERITY_LABEL, weeksLeft } from '../engine/injuries';
import { lastSeason } from '../engine/finance/contract';
import { activeRoster, starters, teamPlayers } from '../engine/roster';
import { capSheet } from '../engine/finance/cap';
import { userGame } from '../engine/league';
import { allSeeds, PLAYOFF_ROUNDS, ROUND_NAMES } from '../engine/season/playoffs';
import { computeRecords, divisionStandings } from '../engine/season/standings';
import { statLine } from '../engine/stats';
import type { Game, InboxMessage, League, Player, Position, Team } from '../engine/types';
import { useNav } from './App';
import { PlayerAvatar, TeamChip } from './components';
import { gameClock, money, ordinal, playerName, recordText, shortName, teamName, weekLabel } from './format';
import { InjuryTag } from './injuries';
import { seenOvr } from './scouting';
import { honorLine } from './screens/Stats';
import { store } from './store';

/** How many rows a list in a card shows before "See all". */
const SHOW = 3;

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function MailCards({ league, message }: { league: League; message: InboxMessage }) {
  const s = mailSubject(message);
  switch (s?.kind) {
    case 'matchup':
      return <MatchupCards league={league} s={s} live={needsYou(league, message)} />;
    case 'injury':
      return <InjuryCards league={league} s={s} />;
    case 'award':
      return <AwardCards league={league} s={s} />;
    case 'contract':
      return <ContractCards league={league} s={s} live={needsYou(league, message)} />;
    case 'retirement':
      return <RetirementCards league={league} s={s} />;
    case 'combine':
      return <CombineCards league={league} s={s} />;
    case 'draftDay':
      return <DraftDayCards league={league} s={s} />;
    case 'draftClass':
      return <DraftClassCards league={league} s={s} />;
    case 'trade':
      return <TradeCards league={league} s={s} />;
    case 'recap':
      return <RecapCards league={league} s={s} />;
    case 'cleared':
      return <ClearedCards league={league} s={s} at={message.week} />;
    case 'deadline':
      return <DeadlineCards league={league} live={needsYou(league, message)} />;
    case 'race':
      return <RaceCards league={league} s={s} />;
    default:
      return null;
  }
}

function Card({ title, children, className = '' }: { title?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={`mail-card ${className}`}>
      {title && <h4>{title}</h4>}
      {children}
    </div>
  );
}

/** A player's name and picture, opening his card. */
function Who({ league, p, sub, side }: { league: League; p: Player; sub?: ReactNode; side?: ReactNode }) {
  const nav = useNav();
  return (
    <div className="mail-who">
      <PlayerAvatar player={p} team={p.teamId !== null ? league.teams[p.teamId] : null} size={40} />
      <span style={{ minWidth: 0 }}>
        <button className="linklike mail-who-name" onClick={() => nav.openPlayer(p.id)}>
          {playerName(p)}
        </button>
        {sub && <span className="muted small" style={{ display: 'block' }}>{sub}</span>}
      </span>
      {side && <span className="mail-who-side">{side}</span>}
    </div>
  );
}

/** A stat line ("397 yds · 6 TD · 0 INT") as tiles: the number big, what it counts underneath. */
function StatTiles({ line }: { line: string }) {
  const parts = line.split(' · ').filter(Boolean);
  if (!parts.length) return null;
  return (
    <div className="mail-tiles">
      {parts.map((part) => {
        const [value, ...label] = part.split(' ');
        return (
          <span className="mail-tile" key={part}>
            <b>{value}</b>
            <span className="eyebrow">{label.join(' ')}</span>
          </span>
        );
      })}
    </div>
  );
}

/** The user's game a message is about, if the league still keeps it (box scores go after two seasons). */
function gameOf(league: League, season: number, week: number, teamId = league.userTeamId): Game | undefined {
  return league.games.find((g) => g.season === season && g.week === week && (g.homeId === teamId || g.awayId === teamId));
}

/** From `teamId`'s side: "W 20–10", and who it was against. */
function resultFor(league: League, g: Game, teamId: number) {
  const home = g.homeId === teamId;
  const us = home ? g.result!.homeScore : g.result!.awayScore;
  const them = home ? g.result!.awayScore : g.result!.homeScore;
  return { res: us > them ? 'W' : us < them ? 'L' : 'T', score: `${us}–${them}`, opp: league.teams[home ? g.awayId : g.homeId], home };
}

function ResultLine({ league, g }: { league: League; g: Game }) {
  const nav = useNav();
  const r = resultFor(league, g, league.userTeamId);
  return (
    <div className="mail-result">
      <span className="eyebrow">Result</span>
      <span className={`mail-res res-${r.res}`}>{r.res}</span>
      <span className="num">{r.score}</span>
      <span className="muted small">
        {r.home ? 'vs' : 'at'} {r.opp.name}
      </span>
      <button className="btn btn-sm" onClick={() => nav.openGame(g.id)}>
        Box score
      </button>
    </div>
  );
}

// ───────── matchups ─────────

function MatchupCards({ league, s, live }: { league: League; s: Extract<MailSubject, { kind: 'matchup' }>; live: boolean }) {
  const game = gameOf(league, s.season, s.week);
  if (!game) return null;
  // Once it's played, the report keeps its result: the scouting it carried is out of date by then.
  if (game.result) return <ResultLine league={league} g={game} />;
  const user = league.userTeamId;
  const opp = league.teams[game.homeId === user ? game.awayId : game.homeId];
  return (
    <>
      {game.playoffRound && <PlayoffPath league={league} game={game} />}
      <OpponentCard league={league} opp={opp} game={game} />
      {live && <UnitsCard league={league} opp={opp} />}
      <div className="mail-split">
        <WatchCard league={league} opp={opp} season={s.season} />
        <TheirInjuries league={league} opp={opp} />
      </div>
    </>
  );
}

function OpponentCard({ league, opp, game }: { league: League; opp: Team; game: Game }) {
  const rec = computeRecords(league, game.season).get(opp.id);
  const seed = game.playoffRound ? seedOf(league, game.season, opp.id) : 0;
  // Their last five before this one, newest first.
  const last = league.games
    .filter((g) => g.season === game.season && g.result && g.week < game.week && (g.homeId === opp.id || g.awayId === opp.id))
    .sort((a, b) => b.week - a.week)
    .slice(0, 5);
  return (
    <Card>
      <div className="mail-who">
        <TeamChip team={opp} large />
        <span>
          <b className="mail-who-name">{teamName(opp)}</b>
          <span className="muted small" style={{ display: 'block' }}>
            {rec ? recordText(rec) : ''}
            {seed ? ` · ${ordinal(seed)} seed` : ''}
          </span>
        </span>
      </div>
      {last.length > 0 && (
        <>
          <div className="eyebrow" style={{ margin: '10px 0 4px' }}>
            Last {last.length}
          </div>
          <div className="mail-form">
            {last.map((g) => {
              const r = resultFor(league, g, opp.id);
              return (
                <span key={g.id} className={`mail-form-game res-${r.res}`}>
                  <b>{r.res}</b>
                  <span className="num">{r.score}</span>
                  <span className="num">
                    {r.home ? '' : '@'}
                    {r.opp.abbrev}
                  </span>
                </span>
              );
            })}
          </div>
        </>
      )}
    </Card>
  );
}

function seedOf(league: League, season: number, teamId: number): number {
  const seeds = allSeeds(league, season)[league.teams[teamId].conference];
  return seeds.indexOf(teamId) + 1;
}

/** The playoff road so far: each round played, the one coming up, and what's next. */
function PlayoffPath({ league, game }: { league: League; game: Game }) {
  const user = league.userTeamId;
  const played = league.games
    .filter((g) => g.season === game.season && g.playoffRound && g.result && g.week < game.week && (g.homeId === user || g.awayId === user))
    .sort((a, b) => a.week - b.week);
  const opp = game.homeId === user ? game.awayId : game.homeId;
  const next = PLAYOFF_ROUNDS[PLAYOFF_ROUNDS.indexOf(game.playoffRound!) + 1];
  return (
    <Card title="The road from here">
      <div className="mail-bracket">
        {played.map((g) => {
          const r = resultFor(league, g, user);
          return (
            <span className="mail-step" key={g.id}>
              <span className="eyebrow">{ROUND_NAMES[g.playoffRound!]}</span>
              <span>
                <b>
                  {r.res} {r.score}
                </b>{' '}
                {r.home ? 'vs' : 'at'} {r.opp.abbrev}
              </span>
            </span>
          );
        })}
        <span className="mail-step is-now">
          <span className="eyebrow">{ROUND_NAMES[game.playoffRound!]} · now</span>
          <span>
            <b>({seedOf(league, game.season, user)})</b> {league.teams[user].abbrev} vs <b>({seedOf(league, game.season, opp)})</b> {league.teams[opp].abbrev}
          </span>
          <span className="muted small">{game.neutral ? 'Neutral site' : game.homeId === user ? 'At home' : 'On the road'}</span>
        </span>
        {next && (
          <span className="mail-step">
            <span className="eyebrow">{ROUND_NAMES[next]}</span>
            <span className="muted">The winner moves on</span>
          </span>
        )}
      </div>
    </Card>
  );
}

/** Every unit, theirs against ours, as our scouts read the starters (league percentiles, like the coach's report). */
function UnitsCard({ league, opp }: { league: League; opp: Team }) {
  const theirs = unitReads(league, opp.id);
  const ours = unitReads(league, league.userTeamId);
  const best = theirs.reduce((a, b) => (b.score > a.score ? b : a));
  const soft = theirs.reduce((a, b) => (b.score < a.score ? b : a));
  const pctOf = (x: number) => Math.round(x * 100);
  return (
    <Card title="How we match up">
      <p className="muted small" style={{ margin: '-4px 0 8px' }}>
        Our scouts' read of each side's starters, as a league percentile: 100 is the best in the league.
      </p>
      <div className="mail-unit mail-unit-head">
        <span className="eyebrow">Unit</span>
        <span className="eyebrow">{opp.name}</span>
        <span className="eyebrow">{league.teams[league.userTeamId].name}</span>
      </div>
      {theirs.map((u, i) => (
        <div className="mail-unit" key={u.title}>
          <span>
            {u.title}
            {u === best && <span className="tag-pill tag-bad">their best</span>}
            {u === soft && <span className="tag-pill tag-good">soft spot</span>}
          </span>
          <UnitBar value={pctOf(u.score)} team={opp} />
          <UnitBar value={pctOf(ours[i].score)} team={league.teams[league.userTeamId]} />
        </div>
      ))}
    </Card>
  );
}

function UnitBar({ value, team }: { value: number; team: Team }) {
  return (
    <span className="mail-bar">
      <span className="bar">
        <i style={{ width: `${Math.max(3, value)}%`, background: team.colors[0] }} />
      </span>
      <span className="num">{value}</span>
    </span>
  );
}

const FIELD_POSITIONS: Position[] = ['QB', 'RB', 'WR', 'TE', 'OL', 'DT', 'EDGE', 'LB', 'CB', 'S'];

/** Their two best starters as our scouts see them, with this season's numbers. */
function WatchCard({ league, opp, season }: { league: League; opp: Team; season: number }) {
  const nav = useNav();
  const best = FIELD_POSITIONS.flatMap((pos) => starters(league, opp, pos))
    .map((p) => ({ p, ovr: seenOvr(league, p) }))
    .sort((a, b) => b.ovr - a.ovr)
    .slice(0, 2);
  if (!best.length) return null;
  return (
    <Card title="Players to watch">
      {best.map(({ p }) => (
        <div className="mail-row" key={p.id}>
          <span className="pos">{p.position}</span>
          <span>
            <button className="linklike" onClick={() => nav.openPlayer(p.id)}>
              {shortName(p)}
            </button>
            <span className="muted small" style={{ display: 'block' }}>
              {honorLine(p, statLine(p, season)) || 'No stats yet this season'}
            </span>
          </span>
        </div>
      ))}
    </Card>
  );
}

/** Their injury report (public, like the NFL's): the longest layoffs first, three at a time. */
function TheirInjuries({ league, opp }: { league: League; opp: Team }) {
  const nav = useNav();
  const hurt = teamPlayers(league, opp.id)
    .filter((p) => p.injury || p.ir)
    .sort((a, b) => (b.injury?.estimate[1] ?? 99) - (a.injury?.estimate[1] ?? 99));
  return (
    <Card title="Their injuries">
      {hurt.length === 0 && <p className="muted small" style={{ margin: 0 }}>Nobody on their report.</p>}
      {hurt.slice(0, SHOW).map((p) => (
        <div className="mail-row" key={p.id}>
          <span className="pos">{p.position}</span>
          <span>
            {shortName(p)}
            {p.injury && <span className="muted small" style={{ display: 'block' }}>{injuryLabel(p.injury.type)}</span>}
          </span>
          <InjuryTag league={league} p={p} />
        </div>
      ))}
      {hurt.length > SHOW && (
        <div className="mail-more">
          <span className="muted">+{hurt.length - SHOW} more</span>
          <button className="linklike" onClick={() => nav.openTeam(opp.id)}>
            See all {hurt.length}
          </button>
        </div>
      )}
    </Card>
  );
}

// ───────── medical ─────────

function InjuryCards({ league, s }: { league: League; s: Extract<MailSubject, { kind: 'injury' }> }) {
  const p = league.players[s.playerId];
  if (!p) return null;
  const now = p.injury?.season === s.season && p.injury.week === s.week && p.injury.type === s.type ? p.injury : null;
  const record = p.injuries?.find((r) => r.season === s.season && r.week === s.week && r.type === s.type);
  const count = (p.injuries ?? []).filter((r) => r.season === s.season).length;
  const ours = p.teamId === league.userTeamId;
  const team = p.teamId !== null ? league.teams[p.teamId] : null;
  const instead = now && ours && team ? starters(league, team, p.position).filter((x) => x.id !== p.id) : [];
  // Reserve is for a long layoff: it keeps him off the 53 for at least four weeks.
  const ir = now && ours && now.estimate[0] >= IR_MIN_WEEKS && !irProblem(league, p);
  return (
    <>
      <Card>
        <Who
          league={league}
          p={p}
          sub={`${p.position} · age ${p.age}${!ours ? (team ? ` · now with ${team.name}` : ' · no longer on a roster') : ''}`}
          side={now ? <InjuryTag league={league} p={p} /> : <span className="tag-pill tag-good">Healthy</span>}
        />
        <div className="mail-kv">
          <span>
            <span className="eyebrow">Severity</span>
            <b>{SEVERITY_LABEL[(now ?? record)?.severity ?? 'minor']}</b>
          </span>
          <span>
            <span className="eyebrow">Doctor's estimate</span>
            <b>{now ? capital(estimateText(now, weeksLeft(league))) : record ? `${record.weeks} wk at the time` : '–'}</b>
          </span>
          <span>
            <span className="eyebrow">This season</span>
            <b>{count ? `${ordinal(count)} injury` : '–'}</b>
          </span>
        </div>
      </Card>
      {instead.length > 0 && (
        <Card title={`Starting at ${p.position} this week`}>
          <p className="small" style={{ margin: 0 }}>
            {instead.map(shortName).join(' · ')} <span className="muted">(your depth chart)</span>
          </p>
        </Card>
      )}
      {ir && (
        <div className="row">
          <button className="btn btn-sm" onClick={() => store.mutate((l) => placeOnIr(l, l.players[p.id]))}>
            Place on IR
          </button>
          <span className="muted small">Off the 53 for at least four weeks: the spot is free for a replacement.</span>
        </div>
      )}
    </>
  );
}

// ───────── awards ─────────

function AwardCards({ league, s }: { league: League; s: Extract<MailSubject, { kind: 'award' }> }) {
  const nav = useNav();
  const p = league.players[s.playerId];
  if (!p) return null;
  const line = s.period === 'year' ? statLine(p, s.season) : periodLine(league, s.season, s.weeks, p.id);
  // The week's game, from his team's side at the time.
  const game = s.period === 'week' ? league.games.find((g) => g.season === s.season && g.week === s.weeks[0] && g.result?.playerStats[p.id]) : undefined;
  const r = game ? resultFor(league, game, game.result!.playerTeams[p.id]) : null;
  const when =
    s.period === 'week' ? weekLabel(s.weeks[0]) : s.period === 'month' ? `Weeks ${s.weeks[0]}–${s.weeks[1]} · ${line?.gp ?? 0} games` : `${s.season} season · ${line?.gp ?? 0} games`;
  return (
    <Card>
      <Who
        league={league}
        p={p}
        sub={`${p.position} · ${when}`}
        side={
          r && (
            <button className="linklike small" onClick={() => nav.openGame(game!.id)}>
              {r.res} {r.score} {r.home ? 'vs' : 'at'} {r.opp.abbrev}
            </button>
          )
        }
      />
      <StatTiles line={honorLine(p, line)} />
    </Card>
  );
}

// ───────── contracts and retirement ─────────

function ContractCards({ league, s, live }: { league: League; s: Extract<MailSubject, { kind: 'contract' }>; live: boolean }) {
  const p = league.players[s.playerId];
  if (!p) return null;
  const last = statLine(p, s.season - 1);
  const ask = live ? demand(league, p, league.userTeamId) : null;
  // After the window: where he ended up.
  const now = p.retired
    ? 'Retired'
    : p.teamId === league.userTeamId && p.contract
      ? `Re-signed through ${lastSeason(p.contract)}`
      : p.teamId !== null
        ? `Signed with the ${league.teams[p.teamId].name}`
        : 'Still a free agent';
  return (
    <Card>
      <Who league={league} p={p} sub={`${p.position} · age ${p.age} · ${p.experience} season${p.experience === 1 ? '' : 's'}`} />
      <div className="mail-split" style={{ marginTop: 10 }}>
        <span>
          <span className="eyebrow">{s.season - 1} season</span>
          <span style={{ display: 'block', fontSize: 'var(--step-0)' }}>
            {last ? `${last.gp ?? 0} games${honorLine(p, last) ? ` · ${honorLine(p, last)}` : ''}` : 'No stats on record'}
          </span>
        </span>
        <span>
          <span className="eyebrow">{ask ? 'Opening ask' : 'Now'}</span>
          <span style={{ display: 'block', fontSize: 'var(--step-0)' }}>
            {ask ? (
              <>
                <b>{money(ask.askApy)} a year</b> for {ask.askYears} years, {Math.round(ask.askGtdPct * 100)}% guaranteed
              </>
            ) : (
              now
            )}
          </span>
        </span>
      </div>
    </Card>
  );
}

function RetirementCards({ league, s }: { league: League; s: Extract<MailSubject, { kind: 'retirement' }> }) {
  const p = league.players[s.playerId];
  if (!p) return null;
  const last = statLine(p, s.season - 1);
  return (
    <Card>
      <Who league={league} p={p} sub={`${p.position} · age ${p.age} · ${p.experience} seasons`} side={<span className="tag-pill">Retired</span>} />
      {last && (
        <>
          <div className="eyebrow" style={{ marginTop: 10 }}>
            Last season · {last.gp ?? 0} games
          </div>
          <StatTiles line={honorLine(p, last)} />
        </>
      )}
    </Card>
  );
}

// ───────── scouting and the draft ─────────

function firstPick(league: League, season: number) {
  return league.draftPicks
    .filter((d) => d.season === season && d.ownerId === league.userTeamId && d.playerId === undefined)
    .sort((a, b) => a.round - b.round || (a.overall ?? 999) - (b.overall ?? 999))[0];
}

function CombineCards({ league, s }: { league: League; s: Extract<MailSubject, { kind: 'combine' }> }) {
  const nav = useNav();
  if (s.season !== league.season || !league.draftClass.length) return null;
  // The consensus board, top first (the same order the draft room's Consensus column ranks).
  const board = league.draftClass
    .map((id) => league.players[id])
    .filter((p): p is Player => !!p?.scouting)
    .sort((a, b) => boardValue(b) - boardValue(a))
    .slice(0, 5);
  const pick = firstPick(league, s.season);
  return (
    <>
      <Card title="Top of the consensus board">
        {board.map((p, i) => (
          <div className="mail-row mail-row-rank" key={p.id}>
            <span className="num muted">{i + 1}</span>
            <span className="pos">{p.position}</span>
            <span>
              <button className="linklike" onClick={() => nav.openPlayer(p.id)}>
                {playerName(p)}
              </button>{' '}
              <span className="muted small">· {p.age}</span>
            </span>
            <span className="num small">{p.combine?.forty ? `40 yd ${p.combine.forty.toFixed(2)}` : ''}</span>
          </div>
        ))}
        {pick && (
          <div className="mail-more">
            <span className="muted">
              Our first pick: round {pick.round}
              {pick.overall ? `, No. ${pick.overall}` : ''}
            </span>
          </div>
        )}
      </Card>
      <Card className="mail-fact-card">
        <span>
          <span className="eyebrow">Scouting visits</span>
          <b className="mail-big">{league.scoutPoints} left</b>
        </span>
        <span className="muted small">A visit narrows a prospect's range on your board.</span>
      </Card>
    </>
  );
}

function DraftDayCards({ league, s }: { league: League; s: Extract<MailSubject, { kind: 'draftDay' }> }) {
  const picks = league.draftPicks.filter((d) => d.season === s.season && d.ownerId === league.userTeamId).sort((a, b) => (a.overall ?? 999) - (b.overall ?? 999));
  if (!picks.length) return null;
  return (
    <Card title="Our picks">
      <div className="mail-picks">
        {picks.map((d) => {
          const p = d.playerId !== undefined ? league.players[d.playerId] : undefined;
          return (
            <span className={`mail-pick${p ? ' is-made' : ''}`} key={d.id}>
              <b>R{d.round}</b> {d.overall ? `No. ${d.overall}` : ''}
              {p && <span className="muted"> · {p.position} {p.lastName}</span>}
            </span>
          );
        })}
      </div>
    </Card>
  );
}

function DraftClassCards({ league, s }: { league: League; s: Extract<MailSubject, { kind: 'draftClass' }> }) {
  const nav = useNav();
  const ours = draftClassOf(league, s.season);
  // Trades made during the draft (ours first), else the top of the draft.
  const trades = league.transactions
    .filter((t) => t.kind === 'trade' && t.season === s.season && t.phase === 'draft')
    .sort((a, b) => Number(b.teamIds.includes(league.userTeamId)) - Number(a.teamIds.includes(league.userTeamId)));
  const top = Object.values(league.players)
    .filter((p) => p.scouting && p.draft?.season === s.season)
    .sort((a, b) => a.draft!.pick - b.draft!.pick)
    .slice(0, 10);
  return (
    <>
      <Card>
        <div className="table-scroll">
          <table className="mail-table">
            <thead>
              <tr>
                <th>Pick</th>
                <th>Player</th>
                <th className="num">Age</th>
                <th className="num" title="Where the league consensus ranked him in his class when he was taken">
                  Consensus
                </th>
                <th>Value</th>
              </tr>
            </thead>
            <tbody>
              {ours.map((p) => {
                const d = p.draft!;
                const value = reachOrSteal(d);
                return (
                  <tr key={p.id}>
                    <td className="muted small">
                      R{d.round} · {d.pick}
                    </td>
                    <td>
                      <span className="pos">{p.position}</span>{' '}
                      <button className="linklike" onClick={() => nav.openPlayer(p.id)}>
                        {playerName(p)}
                      </button>
                    </td>
                    <td className="num">{p.age}</td>
                    <td className="num">{d.rank !== undefined ? ordinal(d.rank) : '–'}</td>
                    <td>
                      <span className={`tag-pill ${value === 'steal' ? 'tag-good' : value === 'reach' ? 'tag-warn' : ''}`} style={{ marginLeft: 0 }}>
                        {value ?? 'fair'}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="muted small" style={{ margin: '8px 0 0' }}>
          Value compares your pick with where the consensus ranked him: a round of the board later is a steal, a round earlier a reach.
        </p>
      </Card>
      {trades.length > 0 ? (
        <Card title="Trades during the draft">
          {trades.map((t, i) => (
            <p key={i} className={`small${t.teamIds.includes(league.userTeamId) ? ' is-user-text' : ''}`} style={{ margin: '4px 0' }}>
              {t.text}
            </p>
          ))}
        </Card>
      ) : (
        top.length > 0 && (
          <Card title="No trades this draft, so here are the top 10 picks">
            <table className="mail-table mail-top">
              <tbody>
                {top.map((p) => (
                  <tr key={p.id} className={p.draft!.teamId === league.userTeamId ? 'is-user' : undefined}>
                    <td className="num muted">{p.draft!.pick}</td>
                    <td>
                      <TeamChip team={league.teams[p.draft!.teamId]} />
                    </td>
                    <td className="pos">{p.position}</td>
                    <td>
                      <button className="linklike" onClick={() => nav.openPlayer(p.id)}>
                        {playerName(p)}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )
      )}
    </>
  );
}

// ───────── trades ─────────

/** "BUF traded OL Grant Mack to CAR for 2028 R4" (the transaction log's words, `executeTrade`), split by side. */
function TradeCards({ league, s }: { league: League; s: Extract<MailSubject, { kind: 'trade' }> }) {
  const m = /^(\w+) traded (.+) to (\w+) for (.+)$/.exec(s.text);
  if (!m) return null;
  const mine = m[1] === league.teams[league.userTeamId].abbrev;
  const words = (x: string) => x.replace(/(\d{4}) R(\d)/g, '$1 round $2 pick');
  const [sent, got] = (mine ? [m[2], m[4]] : [m[4], m[2]]).map(words);
  return (
    <div className="mail-split">
      <Card>
        <span className="eyebrow">You sent</span>
        <p style={{ margin: '6px 0 0' }}>{sent}</p>
      </Card>
      <Card>
        <span className="eyebrow">You got</span>
        <p style={{ margin: '6px 0 0' }}>{got}</p>
      </Card>
    </div>
  );
}

// ───────── game week ─────────

/** One key stat, ours against theirs, the better side bold. */
function KeyStat({ label, ours, theirs, better }: { label: string; ours: string; theirs: string; better: 'us' | 'them' | null }) {
  return (
    <div className="mail-kstat">
      <span className={better === 'us' ? 'best' : undefined}>{ours}</span>
      <span className="muted">{label}</span>
      <span className={better === 'them' ? 'best' : undefined}>{theirs}</span>
    </div>
  );
}

const side = (a: number, b: number, more = true): 'us' | 'them' | null => (a === b ? null : a > b === more ? 'us' : 'them');

function RecapCards({ league, s }: { league: League; s: Extract<MailSubject, { kind: 'recap' }> }) {
  const nav = useNav();
  const g = league.games.find((x) => x.id === s.gameId && x.season === s.season);
  if (!g?.result) return null;
  const r = g.result;
  const user = league.userTeamId;
  const home = g.homeId === user;
  const [ours, theirs] = home ? [r.home, r.away] : [r.away, r.home];
  const opp = league.teams[home ? g.awayId : g.homeId];
  const star = playerOfTheGame(league, g);
  const potg = star !== null ? league.players[star] : undefined;
  // Our next best two, on the same scale as the player of the game.
  const stood = Object.entries(r.playerStats)
    .filter(([id]) => r.playerTeams[Number(id)] === user && Number(id) !== star && league.players[Number(id)])
    .map(([id, line]) => ({ p: league.players[Number(id)], line, v: impact(league.players[Number(id)], line) }))
    .filter((x) => x.v > 0)
    .sort((a, b) => b.v - a.v)
    .slice(0, 2);
  const hurt = (r.injuries ?? []).filter((i) => i.teamId === user && league.players[i.playerId]);
  const rec = computeRecords(league, g.season).get(user);
  const next = g.season === league.season ? userGame(league) : undefined;
  const nextOpp = next && !next.result ? league.teams[next.homeId === user ? next.awayId : next.homeId] : null;
  const rate = (c: number, a: number) => (a ? c / a : 0);
  return (
    <>
      <div className="mail-split">
        <Card>
          <table className="mail-table mail-line">
            <thead>
              <tr>
                <th>Team</th>
                {r.quarters.home.map((_, i) => (
                  <th key={i} className="num">
                    {i < 4 ? i + 1 : 'OT'}
                  </th>
                ))}
                <th className="num">T</th>
              </tr>
            </thead>
            <tbody>
              {(['away', 'home'] as const).map((k) => (
                <tr key={k} className={(k === 'home') === home ? 'is-user' : undefined}>
                  <td>
                    <TeamChip team={league.teams[k === 'home' ? g.homeId : g.awayId]} />
                  </td>
                  {r.quarters[k].map((q, i) => (
                    <td key={i} className="num">
                      {q}
                    </td>
                  ))}
                  <td className="num" style={{ fontWeight: 700 }}>
                    {k === 'home' ? r.homeScore : r.awayScore}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
        <Card>
          <div className="mail-kstat mail-kstat-head">
            <span className="eyebrow">{league.teams[user].abbrev}</span>
            <span />
            <span className="eyebrow">{opp.abbrev}</span>
          </div>
          <KeyStat label="Total yards" ours={String(ours.totalYds)} theirs={String(theirs.totalYds)} better={side(ours.totalYds, theirs.totalYds)} />
          <KeyStat label="Turnovers" ours={String(ours.turnovers)} theirs={String(theirs.turnovers)} better={side(ours.turnovers, theirs.turnovers, false)} />
          <KeyStat
            label="Third down"
            ours={`${ours.thirdDownConv}/${ours.thirdDownAtt}`}
            theirs={`${theirs.thirdDownConv}/${theirs.thirdDownAtt}`}
            better={side(rate(ours.thirdDownConv, ours.thirdDownAtt), rate(theirs.thirdDownConv, theirs.thirdDownAtt))}
          />
          <KeyStat label="Possession" ours={gameClock(ours.top)} theirs={gameClock(theirs.top)} better={side(ours.top, theirs.top)} />
          <KeyStat label="Penalties" ours={`${ours.penalties}-${ours.penaltyYds}`} theirs={`${theirs.penalties}-${theirs.penaltyYds}`} better={side(ours.penaltyYds, theirs.penaltyYds, false)} />
        </Card>
      </div>
      <div className="mail-split">
        {potg && (
          <div className="mail-potg">
            <PlayerAvatar player={potg} team={league.teams[r.playerTeams[potg.id]] ?? null} size={36} />
            <span>
              <span className="eyebrow">Player of the game</span>
              <span style={{ display: 'block' }}>
                <button className="linklike" style={{ fontWeight: 700 }} onClick={() => nav.openPlayer(potg.id)}>
                  {shortName(potg)}
                </button>{' '}
                <span className="muted small">
                  {potg.position} · {league.teams[r.playerTeams[potg.id]]?.abbrev}
                </span>
              </span>
              <span className="small">{honorLine(potg, r.playerStats[potg.id])}</span>
            </span>
          </div>
        )}
        {stood.length > 0 && (
          <Card title={potg && r.playerTeams[potg.id] === user ? 'Also stood out' : 'Our best'}>
            {stood.map(({ p, line }) => (
              <div className="mail-row" key={p.id}>
                <span className="pos">{p.position}</span>
                <span>
                  <button className="linklike" onClick={() => nav.openPlayer(p.id)}>
                    {shortName(p)}
                  </button>
                  <span className="muted small" style={{ display: 'block' }}>
                    {honorLine(p, line)}
                  </span>
                </span>
              </div>
            ))}
          </Card>
        )}
      </div>
      <Card className="mail-fact-card">
        <span className="small">
          {rec && <b>{recordText(rec)}</b>} on the season ·{' '}
          {hurt.length ? `${hurt.map((i) => `${shortName(league.players[i.playerId])} hurt (${injuryLabel(i.type).toLowerCase()})`).join(', ')}` : 'nobody hurt'}
        </span>
        {nextOpp && next && (
          <span className="small">
            Next: <b>{nextOpp.name}</b>, {next.neutral ? 'neutral site' : next.homeId === user ? 'at home' : 'on the road'}
          </span>
        )}
      </Card>
      {r.plays && r.plays.length > 0 && (
        <div className="row">
          <button className="btn btn-sm" onClick={() => nav.watchGame(g.id)}>
            ▶ Watch replay
          </button>
        </div>
      )}
    </>
  );
}

function ClearedCards({ league, s, at }: { league: League; s: Extract<MailSubject, { kind: 'cleared' }>; at: number }) {
  const p = league.players[s.playerId];
  const record = p?.injuries?.find((r) => r.season === s.season && r.week === s.week && r.type === s.type);
  if (!p || !record) return null;
  const team = p.teamId !== null ? league.teams[p.teamId] : null;
  const ours = p.teamId === league.userTeamId;
  const canActivate = ours && p.ir && team && !delegates(league, team) && !activateProblem(league, p);
  return (
    <>
      <Card>
        <Who
          league={league}
          p={p}
          sub={`${p.position} · age ${p.age}`}
          side={p.injury ? <InjuryTag league={league} p={p} /> : p.ir ? <span className="tag-pill tag-warn">On IR</span> : <span className="tag-pill tag-good">Cleared</span>}
        />
        <div className="mail-kv">
          <span>
            <span className="eyebrow">Coming back from</span>
            <b>{injuryLabel(record.type)}</b>
            <span className="muted small">{SEVERITY_LABEL[record.severity]}</span>
          </span>
          <span>
            <span className="eyebrow">Hurt</span>
            <b>{s.week ? weekLabel(s.week) : 'The offseason'}</b>
          </span>
          <span>
            <span className="eyebrow">Time out</span>
            <b>{Math.max(1, at - s.week)} wk</b>
            <span className="muted small">Expected {record.weeks} at the time</span>
          </span>
        </div>
      </Card>
      {ours && p.ir && team && (
        <Card className="mail-fact-card">
          <span className="small">
            On injured reserve for {p.ir.weeks} wk · {irReturnsUsed(league, team.id)} of {IR_RETURNS} returns used this season
          </span>
          {canActivate && (
            <button className="btn btn-sm btn-primary" onClick={() => store.mutate((l) => activateFromIr(l, l.players[p.id]))}>
              Activate from IR
            </button>
          )}
        </Card>
      )}
    </>
  );
}

/** Where we stand as the deadline nears: the numbers a buyer or a seller looks at first. */
function DeadlineCards({ league, live }: { league: League; live: boolean }) {
  const nav = useNav();
  if (!live) return <p className="muted small" style={{ margin: 0 }}>The trade deadline has passed: rosters are set until the new league year.</p>;
  const user = league.userTeamId;
  const team = league.teams[user];
  const records = computeRecords(league);
  const rec = records.get(user)!;
  const div = divisionStandings(league, records).find((d) => d.index === team.division)!;
  const place = div.teams.findIndex((r) => r.teamId === user) + 1;
  const players = teamPlayers(league, user);
  const hurt = players.filter((p) => p.injury && !p.injury.injected);
  const expiring = players.filter((p) => p.contract && lastSeason(p.contract) === league.season).sort((a, b) => seenOvr(league, b) - seenOvr(league, a));
  return (
    <>
      <Card title="Where you stand">
        <div className="mail-tiles">
          <span className="mail-tile">
            <b>{recordText(rec)}</b>
            <span className="eyebrow">
              {ordinal(place)} in the {div.division.name}
            </span>
          </span>
          <span className="mail-tile">
            <b>{money(Math.round(capSheet(league, user).space))}</b>
            <span className="eyebrow">Cap space</span>
          </span>
          <span className="mail-tile">
            <b>{activeRoster(league, user).length}</b>
            <span className="eyebrow">of {ROSTER_MAX} on the roster</span>
          </span>
          <span className="mail-tile">
            <b>{hurt.length}</b>
            <span className="eyebrow">Out hurt</span>
          </span>
        </div>
      </Card>
      {expiring.length > 0 && (
        <Card title="Deals that run out after this season">
          <p className="small" style={{ margin: 0 }}>
            {expiring.length} player{expiring.length === 1 ? '' : 's'}, including{' '}
            {expiring
              .slice(0, SHOW)
              .map((p) => `${p.position} ${playerName(p)}`)
              .join(', ')}
            . Re-sign them in the spring, or move one now while he still has trade value.
          </p>
          <div className="mail-more">
            <span />
            <button className="linklike" onClick={() => nav.go({ view: 'cap', teamId: user })}>
              Cap and contracts
            </button>
          </div>
        </Card>
      )}
    </>
  );
}

function RaceCards({ league, s }: { league: League; s: Extract<MailSubject, { kind: 'race' }> }) {
  const nav = useNav();
  const user = league.userTeamId;
  const team = league.teams[user];
  const records = computeRecords(league, s.season);
  const div = divisionStandings(league, records).find((d) => d.index === team.division)!;
  const lead = div.teams[0];
  const left = league.games
    .filter((g) => g.season === s.season && !g.playoffRound && !g.result && (g.homeId === user || g.awayId === user))
    .sort((a, b) => a.week - b.week);
  return (
    <>
      <Card title={div.division.name}>
        <table className="mail-table">
          <thead>
            <tr>
              <th>Team</th>
              <th className="num">W-L</th>
              <th className="num">Back</th>
            </tr>
          </thead>
          <tbody>
            {div.teams.map((r) => {
              const back = (lead.w - r.w + (r.l - lead.l)) / 2;
              return (
                <tr key={r.teamId} className={r.teamId === user ? 'is-user' : undefined}>
                  <td>
                    <span className="team-inline">
                      <TeamChip team={league.teams[r.teamId]} /> {league.teams[r.teamId].name}
                    </span>
                  </td>
                  <td className="num">{recordText(r)}</td>
                  <td className="num">{back > 0 ? back : '–'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
      <Card title="Still to play">
        <p className="small" style={{ margin: 0 }}>
          {left.length
            ? left.map((g) => `${weekLabel(g.week)} ${g.homeId === user ? 'vs' : 'at'} ${league.teams[g.homeId === user ? g.awayId : g.homeId].abbrev}`).join(' · ')
            : 'The regular season is over.'}
        </p>
      </Card>
      {s.level === 'out' && (
        <div className="row">
          <button className="btn btn-sm" onClick={() => nav.go({ view: 'office', tab: 'draft' })}>
            Draft order
          </button>
          <button className="btn btn-sm" onClick={() => nav.go({ view: 'cap', teamId: user })}>
            Contracts for next year
          </button>
        </div>
      )}
    </>
  );
}
