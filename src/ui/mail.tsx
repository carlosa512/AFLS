/**
 * What a message opens with under its text: the cards each kind of mail brings (an opposition report's
 * matchup, a doctor's diagnosis, an award's stat line). Everything is looked up from the league as it is
 * now, from what the message is about (`mailSubject`); nothing extra is stored with the mail. Screens show
 * the user's view only: our scouts' reads, the doctor's estimate, the public consensus.
 */
import { useState, type ReactNode } from 'react';
import { periodLine, playerOfTheGame } from '../engine/awards';
import {
  asPromoted,
  chairHolder,
  chairOf,
  coachAsk,
  coachBudget,
  coachMarket,
  coachMoveProblem,
  coachName,
  coachPayroll,
  coachResignForecast,
  coachTitle,
  coachValue,
  extendCoach,
  hireCoach,
  isCoachExpiring,
  moveOverspend,
  promoteCoach,
  promotionProblem,
  sameChair,
  teamCoaches,
  visionFit,
} from '../engine/coaching';
import { extendMedic, isMedicExpiring, MEDIC_ROLE_LABEL, medicalBudget, medicalPayroll, medicAsk, medicMoveProblem, medicName, medicResignForecast } from '../engine/medical';
import { demand, rookieCost, ROSTER_MAX } from '../engine/offseason/negotiation';
import { coachSchemeLabel } from '../engine/schemes';
import { extendStaff, isExpiring, resignForecast, ROLE_LABEL, staffAsk, staffBudget, staffMoveProblem, staffName, staffPayroll, type ResignOutlook } from '../engine/staff';
import { boardValue, reachOrSteal } from '../engine/offseason/draft';
import { GameStar, KeyStats, LineScore, standouts, Standouts } from './game';
import { LinkedText, moveIndex, MoveText } from './moves';
import { deadlineDayTrades, draftClassOf, freeAgencyMoves, marketRumors, marketTrades, seasonDeals, headCoachChanges, mailSubject, needsYou, promotionCandidates, unitReads, type HeadCoachChange, type MailSubject, type Signing } from '../engine/inbox';
import { activateFromIr, activateProblem, delegates, injuryLabel, IR_MIN_WEEKS, IR_RETURNS, irProblem, irReturnsUsed, outlookText, placeOnIr, SEVERITY_LABEL, weeksLeft } from '../engine/injuries';
import { lastSeason } from '../engine/finance/contract';
import { activeRoster, playingHurt, slotOf, starters, teamPlayers } from '../engine/roster';
import { capSheet } from '../engine/finance/cap';
import { userGame } from '../engine/league';
import { allSeeds, PLAYOFF_ROUNDS, ROUND_NAMES } from '../engine/season/playoffs';
import { computeRecords, divisionStandings } from '../engine/season/standings';
import { statLine } from '../engine/stats';
import type { Coach, DealKind, Game, InboxMessage, League, Medic, Player, Position, Staff, Team } from '../engine/types';
import { stanceOf } from '../engine/trade';
import { activeLearning, conversionRead, familiarity, passMove, startMove } from '../engine/training';
import { useNav, type StaffKind } from './App';
import { PlayerAvatar, TeamChip } from './components';
import { StaffAvatar } from './staffAvatar';
import { band, money, ordinal, playerName, recordText, shortName, teamName, weekLabel } from './format';
import { InjuryTag } from './injuries';
import { seenOvr } from './scouting';
import { honorLine } from './screens/Stats';
import { OfferCard } from './offers';
import { familiarityTone, learnLine, readyText, reasonText, roleText, leftText, verdictText, verdictTone } from './training';
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
    case 'offer': {
      // The offer itself, live: its answers work from the inbox as on the Offers tab.
      const offer = league.market?.offers.find((o) => o.id === s.offerId);
      return offer ? <OfferCard league={league} offer={offer} compact /> : null;
    }
    case 'recap':
      return <RecapCards league={league} s={s} />;
    case 'cleared':
      return <ClearedCards league={league} s={s} at={message.week} />;
    case 'deadline':
      return <DeadlineCards league={league} s={s} live={needsYou(league, message)} />;
    case 'race':
      return <RaceCards league={league} s={s} />;
    case 'owner':
      return <OwnerCards league={league} s={s} />;
    case 'staffDeals':
      return <StaffDealsCards league={league} s={s} live={needsYou(league, message)} />;
    case 'poached':
      return <PoachedCards league={league} s={s} live={needsYou(league, message)} />;
    case 'carousel':
      return <CarouselCards league={league} s={s} />;
    case 'faWrap':
      return <FaWrapCards league={league} s={s} />;
    case 'market':
      return <MarketCards league={league} s={s} />;
    case 'marketRecap':
      return <MarketRecapCards league={league} s={s} />;
    case 'positionOffer':
      return <PositionOfferCards league={league} s={s} live={needsYou(league, message)} />;
    case 'positionMoved':
      return <PositionMovedCards league={league} s={s} />;
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

/** Players as links, comma-separated: "QB Kyle James, WR Tom Hughes". */
function PlayerList({ players, label = (p) => `${p.position} ${playerName(p)}` }: { players: Player[]; label?: (p: Player) => string }) {
  const nav = useNav();
  return (
    <>
      {players.map((p, i) => (
        <span key={p.id}>
          {i > 0 && ', '}
          <button className="linklike" onClick={() => nav.openPlayer(p.id)}>
            {label(p)}
          </button>
        </span>
      ))}
    </>
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
            <button className="linklike" onClick={() => nav.openPlayer(p.id)}>
              {shortName(p)}
            </button>
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
  // Who starts where he lines up (his own position, unless you put him somewhere else).
  const at = slotOf(league, p);
  const instead = now && ours && team ? starters(league, team, at).filter((x) => x.id !== p.id) : [];
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
            <b>{now ? capital(outlookText(now, weeksLeft(league))) : record ? `${record.weeks} wk at the time` : '–'}</b>
          </span>
          <span>
            <span className="eyebrow">This season</span>
            <b>{count ? `${ordinal(count)} injury` : '–'}</b>
          </span>
        </div>
      </Card>
      {instead.length > 0 && (
        <Card title={`Starting at ${at} this week`}>
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
                <b>{money(ask.askApy)} a year</b> for {ask.askYears} year{ask.askYears === 1 ? '' : 's'}, {Math.round(ask.askGtdPct * 100)}% guaranteed
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
              {p && (
                <span className="muted">
                  {' '}
                  · <PlayerList players={[p]} label={(x) => `${x.position} ${x.lastName}`} />
                </span>
              )}
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
  const moves = moveIndex(league);
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
              <MoveText move={t} index={moves} />
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
        <p style={{ margin: '6px 0 0' }}>
          <LinkedText league={league} text={sent} />
        </p>
      </Card>
      <Card>
        <span className="eyebrow">You got</span>
        <p style={{ margin: '6px 0 0' }}>
          <LinkedText league={league} text={got} />
        </p>
      </Card>
    </div>
  );
}

// ───────── game week ─────────

function RecapCards({ league, s }: { league: League; s: Extract<MailSubject, { kind: 'recap' }> }) {
  const nav = useNav();
  const g = league.games.find((x) => x.id === s.gameId && x.season === s.season);
  if (!g?.result) return null;
  const r = g.result;
  const user = league.userTeamId;
  const star = playerOfTheGame(league, g);
  // Our next best two, on the same scale as the player of the game.
  const stood = standouts(league, g, user, 2);
  const hurt = (r.injuries ?? []).filter((i) => i.teamId === user && league.players[i.playerId]);
  const rec = computeRecords(league, g.season).get(user);
  const next = g.season === league.season ? userGame(league) : undefined;
  const nextOpp = next && !next.result ? league.teams[next.homeId === user ? next.awayId : next.homeId] : null;
  return (
    <>
      <div className="mail-split">
        <Card>
          <LineScore league={league} game={g} teamId={user} />
        </Card>
        <Card>
          <KeyStats league={league} game={g} teamId={user} />
        </Card>
      </div>
      <div className="mail-split">
        <GameStar league={league} game={g} />
        {stood.length > 0 && (
          <Card title={star !== null && r.playerTeams[star] === user ? 'Also stood out' : 'Our best'}>
            <Standouts rows={stood} />
          </Card>
        )}
      </div>
      <Card className="mail-fact-card">
        <span className="small">
          {rec && <b>{recordText(rec)}</b>} on the season ·{' '}
          {hurt.length
            ? hurt.map((i, n) => (
                <span key={i.playerId}>
                  {n > 0 && ', '}
                  <PlayerList players={[league.players[i.playerId]]} label={shortName} /> hurt ({injuryLabel(i.type).toLowerCase()})
                </span>
              ))
            : 'nobody hurt'}
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
function DeadlineCards({ league, s, live }: { league: League; s: Extract<MailSubject, { kind: 'deadline' }>; live: boolean }) {
  const nav = useNav();
  const day = s.weeksLeft === 'day' && <DeadlineDayTrades league={league} season={s.season} />;
  if (!live) {
    return (
      <>
        <p className="muted small" style={{ margin: 0 }}>
          The trade deadline has passed: rosters are set until the new league year.
        </p>
        {day}
      </>
    );
  }
  const user = league.userTeamId;
  const team = league.teams[user];
  const records = computeRecords(league);
  const rec = records.get(user)!;
  const div = divisionStandings(league, records).find((d) => d.index === team.division)!;
  const place = div.teams.findIndex((r) => r.teamId === user) + 1;
  const players = teamPlayers(league, user);
  const hurt = players.filter((p) => p.injury && !playingHurt(p.injury));
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
            {expiring.length} player{expiring.length === 1 ? '' : 's'}, including <PlayerList players={expiring.slice(0, SHOW)} />. Re-sign them in the spring, or move one now while he still has trade value.
          </p>
          <div className="mail-more">
            <span />
            <button className="linklike" onClick={() => nav.go({ view: 'cap', teamId: user })}>
              Cap and contracts
            </button>
          </div>
        </Card>
      )}
      {day}
    </>
  );
}

// ───────── the trade market ─────────

/** Who's buying and who's selling right now, from each front office's stance (`trade/plans.ts`): words, never numbers. */
function BuyersSellers({ league }: { league: League }) {
  const nav = useNav();
  const others = league.teams.filter((t) => t.id !== league.userTeamId);
  const rows: [string, Team[]][] = [
    ['Buying', others.filter((t) => stanceOf(t) === 'contend')],
    ['Selling', others.filter((t) => stanceOf(t) === 'rebuild')],
  ];
  if (rows.every(([, teams]) => !teams.length)) return null;
  return (
    <Card title="Who's buying, who's selling">
      {rows.map(
        ([label, teams]) =>
          teams.length > 0 && (
            <div className="market-side" key={label}>
              <span className="eyebrow">{label}</span>
              <span className="market-teams">
                {teams.map((t) => (
                  <button key={t.id} className="linklike team-inline" onClick={() => nav.openTeam(t.id)}>
                    <TeamChip team={t} /> {t.name}
                  </button>
                ))}
              </span>
            </div>
          ),
      )}
    </Card>
  );
}

/** The director's digest: the moment's trades with their reasons, what his people are hearing, who's buying and selling. */
function MarketCards({ league, s }: { league: League; s: Extract<MailSubject, { kind: 'market' }> }) {
  const trades = marketTrades(league, s.season, s.phase, s.week);
  const rumors = marketRumors(league, s.season, s.phase, s.week);
  const moves = moveIndex(league);
  // Stances move every market moment: only the latest digest can say who's buying now.
  const now = s.season === league.season && s.phase === league.phase && (s.phase !== 'regular' || s.week === league.week);
  return (
    <>
      {trades.length > 0 && (
        <Card title={s.phase === 'resign' ? 'Trades as the league year opened' : 'Trades this week'}>
          {trades.map((t, i) => (
            <p key={i} className="small" style={{ margin: '4px 0' }}>
              <MoveText move={t} index={moves} />
            </p>
          ))}
        </Card>
      )}
      {rumors.length > 0 && (
        <Card title="What we're hearing">
          {rumors.map((r) => (
            <p key={r.id} className="small" style={{ margin: '4px 0' }}>
              <LinkedText league={league} text={r.text} about={[{ kind: 'player', id: r.playerId }]} />
            </p>
          ))}
        </Card>
      )}
      {now && <BuyersSellers league={league} />}
    </>
  );
}

const DEAL_WORDS: [DealKind, string][] = [
  ['rental', 'Rentals'],
  ['buy', 'Contender adds'],
  ['sale', 'Sell-offs'],
  ['star', 'Star trades'],
  ['swap', 'Swaps'],
  ['dump', 'Cap dumps'],
];

/** The trade season in numbers, the busiest teams, our division's moves and deadline day's deals. */
function MarketRecapCards({ league, s }: { league: League; s: Extract<MailSubject, { kind: 'marketRecap' }> }) {
  const nav = useNav();
  const all = league.transactions.filter((t) => t.kind === 'trade' && t.season === s.season && t.phase === 'regular');
  const deals = seasonDeals(league, s.season);
  const day = deadlineDayTrades(league, s.season);
  const division = league.teams[league.userTeamId].division;
  const rivals = all.filter((t) => t.teamIds.some((id) => id !== league.userTeamId && league.teams[id].division === division));
  const busiest = league.teams
    .map((t) => ({ t, n: all.filter((x) => x.teamIds.includes(t.id)).length }))
    .filter((x) => x.n > 1)
    .sort((a, b) => b.n - a.n)
    .slice(0, 3);
  const moves = moveIndex(league);
  return (
    <>
      <Card title={`${s.season} trade season`}>
        <div className="mail-tiles">
          <span className="mail-tile">
            <b>{all.length}</b>
            <span className="eyebrow">Trades</span>
          </span>
          <span className="mail-tile">
            <b>{day.length}</b>
            <span className="eyebrow">On deadline day</span>
          </span>
          {DEAL_WORDS.map(([kind, label]) => {
            const n = deals.filter((d) => d.kind === kind).length;
            return (
              n > 0 && (
                <span className="mail-tile" key={kind}>
                  <b>{n}</b>
                  <span className="eyebrow">{label}</span>
                </span>
              )
            );
          })}
        </div>
        {busiest.length > 0 && (
          <p className="small" style={{ margin: '10px 0 0' }}>
            Busiest:{' '}
            {busiest.map(({ t, n }, i) => (
              <span key={t.id}>
                {i > 0 && ', '}
                <button className="linklike" onClick={() => nav.openTeam(t.id)}>
                  {t.name}
                </button>{' '}
                ({n})
              </span>
            ))}
          </p>
        )}
      </Card>
      {rivals.length > 0 && (
        <Card title="In our division">
          {rivals.map((t, i) => (
            <p key={i} className="small" style={{ margin: '4px 0' }}>
              <MoveText move={t} index={moves} />
            </p>
          ))}
        </Card>
      )}
      <DeadlineDayTrades league={league} season={s.season} />
    </>
  );
}

/** Deadline day's trades around the league, the newest first: the market's busiest round, with everyone in them a link. */
function DeadlineDayTrades({ league, season }: { league: League; season: number }) {
  const trades = deadlineDayTrades(league, season).reverse();
  const moves = moveIndex(league);
  return (
    <Card title="Deadline day trades">
      {trades.length === 0 ? (
        <p className="muted small" style={{ margin: 0 }}>
          No trades yet.
        </p>
      ) : (
        trades.map((t, i) => (
          <p key={i} className={`small${t.teamIds.includes(league.userTeamId) ? ' is-user-text' : ''}`} style={{ margin: '4px 0' }}>
            <MoveText move={t} index={moves} />
          </p>
        ))
      )}
    </Card>
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

// ───────── the front office ─────────

/** A budget as a tile: what the owner gives, and how much of it is spoken for. */
function BudgetTile({ label, budget, used, note }: { label: string; budget: number; used?: number; note?: string }) {
  return (
    <span className="mail-tile">
      <b>{money(budget)}</b>
      <span className="eyebrow">{label}</span>
      <span className="muted small">{note ?? `${money(used ?? 0)} committed`}</span>
    </span>
  );
}

/** The year's budgets, as they stand now. The letter itself says how far past them the owner will go. */
function OwnerCards({ league, s }: { league: League; s: Extract<MailSubject, { kind: 'owner' }> }) {
  if (s.season !== league.season) return null;
  const user = league.userTeamId;
  return (
    <Card title={`${s.season} budgets`}>
      <div className="mail-tiles">
        <BudgetTile label="Coaching" budget={coachBudget(league, user)} used={coachPayroll(league, user)} />
        <BudgetTile label="Scouting staff" budget={staffBudget(league, user)} used={staffPayroll(league, user)} />
        <BudgetTile label="Medical staff" budget={medicalBudget(league, user)} used={medicalPayroll(league, user)} />
        <BudgetTile label="Salary cap" budget={league.caps[s.season]} note={`${money(Math.round(capSheet(league, user).space))} space`} />
      </div>
    </Card>
  );
}

const OUTLOOK: Record<ResignOutlook, { label: string; tone: string; tip: string }> = {
  stays: { label: 'Re-signs', tone: 'tag-good', tip: 'Re-signs for 2 years at the ask when free agency opens, unless you let them go.' },
  budget: { label: 'Leaves: budget', tone: 'tag-warn', tip: 'Leaves when free agency opens: the budget can’t cover the ask.' },
  chair: { label: 'Leaves: chair taken', tone: 'tag-warn', tip: 'Leaves when free agency opens: someone else now holds the chair.' },
};

interface PersonRow {
  key: string;
  kind: StaffKind;
  id: number;
  /** The record itself, for the picture. */
  person: Coach | Staff | Medic;
  name: string;
  title: string;
  age: number;
  ratings: [string, number][];
  /** This year's pay, then what he asks for two more. */
  salary: number;
  ask: number;
  outlook?: ResignOutlook;
  /** After the window: where he went. */
  outcome?: string;
  extend?: { problem: string | null; go: () => void };
}

/** One of our people: who he is, his public ratings, the money, and what happens to him. */
function Person({ row }: { row: PersonRow }) {
  const nav = useNav();
  const o = row.outlook && OUTLOOK[row.outlook];
  return (
    <div className="mail-person mail-person-line">
      <span className="staff-who">
        <StaffAvatar person={row.person} size={28} />
        <span style={{ minWidth: 0 }}>
          <button className="linklike" style={{ fontWeight: 700 }} onClick={() => nav.openStaff(row.kind, row.id)}>
            {row.name}
          </button>
          <span className="muted small" style={{ display: 'block' }}>
            {row.title} · age {row.age}
          </span>
        </span>
      </span>
      <span className="small mail-ratings">
        {row.ratings.map(([label, v]) => (
          <span key={label}>
            {label} <b className={`num ${band(v)}`}>{v}</b>
          </span>
        ))}
      </span>
      <span className="small mail-money">
        <b className="num">{money(row.ask)}</b>/yr
        <span className="muted" style={{ display: 'block' }}>
          now {money(row.salary)}
        </span>
      </span>
      <span className="mail-person-act">
        {o ? (
          <span className={`tag-pill ${o.tone}`} title={o.tip}>
            {o.label}
          </span>
        ) : (
          row.outcome && <span className="tag-pill">{row.outcome}</span>
        )}
        {row.extend && (
          <button className="btn btn-sm" disabled={!!row.extend.problem} title={row.extend.problem ?? undefined} onClick={row.extend.go}>
            Extend 2 yr
          </button>
        )}
      </span>
    </div>
  );
}

/** Where a staff member stands once his deal is no longer up: kept, gone to another team, or gone. */
function outcomeOf(league: League, who: { teamId: number | null; contract: { through: number } | null } | undefined, season: number): string {
  if (!who) return 'Retired';
  if (who.teamId === league.userTeamId && who.contract && who.contract.through >= season) return `Signed thru ${who.contract.through}`;
  return who.teamId !== null ? `Joined ${league.teams[who.teamId].abbrev}` : 'Left';
}

const COACH_OVER = 'Goes past your coaching budget: ask the owner on the Coaches screen.';

/** Every expiring deal on our staffs, by department, each with his ask and what happens to him if you do nothing. */
function StaffDealsCards({ league, s, live }: { league: League; s: Extract<MailSubject, { kind: 'staffDeals' }>; live: boolean }) {
  const nav = useNav();
  const user = league.userTeamId;
  const now = s.season === league.season;
  const coachOutlook = coachResignForecast(league, user);
  const staffOutlook = resignForecast(league, user);
  const medicOutlook = medicResignForecast(league, user);
  const rows: PersonRow[] = s.people.flatMap((r): PersonRow[] => {
    if (r.kind === 'coach') {
      const c = league.coaches[r.id] ?? league.retiredCoaches[r.id];
      if (!c) return [];
      const up = now && live && c.teamId === user && isCoachExpiring(league, c);
      const problem = up ? (coachMoveProblem(league, user, c, 'extend', 2, false) ?? (moveOverspend(league, user, c, 2, 'extend') > 0 ? COACH_OVER : null)) : null;
      return [
        {
          key: `c${c.id}`,
          kind: 'coach',
          id: c.id,
          person: c,
          name: coachName(c),
          title: coachTitle(c),
          age: c.age,
          ratings: [
            ['Youth', c.youth],
            ['Vets', c.veterans],
          ],
          salary: c.contract?.salary ?? 0,
          ask: coachAsk(league, c, 2),
          outlook: up ? coachOutlook.get(c.id) : undefined,
          outcome: up ? undefined : outcomeOf(league, league.coaches[c.id], s.season),
          extend: up ? { problem, go: () => store.mutate((l) => extendCoach(l, l.userTeamId, c.id, 2)) } : undefined,
        },
      ];
    }
    if (r.kind === 'scout') {
      const x = league.staff[r.id];
      if (!x) return [];
      const up = now && live && x.teamId === user && isExpiring(league, x);
      return [
        {
          key: `s${x.id}`,
          kind: 'scout',
          id: x.id,
          person: x,
          name: staffName(x),
          title: ROLE_LABEL[x.role],
          age: x.age,
          ratings: [
            ['Eval', x.evaluation],
            ['Proj', x.projection],
          ],
          salary: x.contract?.salary ?? 0,
          ask: staffAsk(league, x, 2),
          outlook: up ? staffOutlook.get(x.id) : undefined,
          outcome: up ? undefined : outcomeOf(league, x, s.season),
          extend: up ? { problem: staffMoveProblem(league, user, x, 'extend', 2), go: () => store.mutate((l) => extendStaff(l, l.userTeamId, x.id, 2)) } : undefined,
        },
      ];
    }
    const m = league.medics[r.id];
    if (!m) return [];
    const up = now && live && m.teamId === user && isMedicExpiring(league, m);
    return [
      {
        key: `m${m.id}`,
        kind: 'medic',
        id: m.id,
        person: m,
        name: medicName(m),
        title: MEDIC_ROLE_LABEL[m.role],
        age: m.age,
        ratings: [
          ['Physio', m.physio],
          ['Science', m.science],
        ],
        salary: m.contract?.salary ?? 0,
        ask: medicAsk(league, m, 2),
        outlook: up ? medicOutlook.get(m.id) : undefined,
        outcome: up ? undefined : outcomeOf(league, m, s.season),
        extend: up ? { problem: medicMoveProblem(league, user, m, 'extend', 2), go: () => store.mutate((l) => extendMedic(l, l.userTeamId, m.id, 2)) } : undefined,
      },
    ];
  });
  const groups: [StaffKind, string, 'coaches' | 'staff' | 'medical', string][] = [
    ['coach', 'Coaches', 'coaches', 'Coaches'],
    ['scout', 'Scouts', 'staff', 'Scouting staff'],
    ['medic', 'Medical staff', 'medical', 'Medical'],
  ];
  return (
    <>
      {groups.map(([kind, title, tab, link]) => {
        const mine = rows.filter((r) => r.kind === kind);
        if (!mine.length) return null;
        return (
          <Card key={kind} title={title}>
            {mine.map((r) => (
              <Person key={r.key} row={r} />
            ))}
            <div className="mail-more">
              <span className="muted">{live ? 'Asks are for 2 years.' : 'The re-sign window has closed.'}</span>
              <button className="linklike" onClick={() => nav.go({ view: 'office', tab })}>
                {link}
              </button>
            </div>
          </Card>
        );
      })}
    </>
  );
}

/** "Fits" / "Fair fit" / "Not a fit": how a coordinator matches what our head coach wants. */
function FitPill({ fit }: { fit: number | null }) {
  if (fit === null) return null;
  return fit >= 0.7 ? <span className="tag-pill tag-good">Fits</span> : fit <= 0.35 ? <span className="tag-pill tag-warn">Not a fit</span> : <span className="tag-pill">Fair fit</span>;
}

/** A coach we could put in the open chair: the man as he'd be in it, his ratings, scheme and fit, the ask and the button. */
function Option({ league, c, as, action, problem, go }: { league: League; c: Coach; as: Coach; action: string; problem: string | null; go: () => void }) {
  const nav = useNav();
  const hc = chairHolder(teamCoaches(league, league.userTeamId), { role: 'headCoach' });
  const scheme = coachSchemeLabel(as);
  return (
    <div className="mail-person">
      <span className="staff-who">
        <StaffAvatar person={c} size={28} />
        <span style={{ minWidth: 0 }}>
          <button className="linklike" style={{ fontWeight: 700 }} onClick={() => nav.openStaff('coach', c.id)}>
            {coachName(c)}
          </button>
          <span className="muted small" style={{ display: 'block' }}>
            {c.teamId === league.userTeamId ? `Our ${coachTitle(c).toLowerCase()}` : c.lastJob ?? 'On the market'} · age {c.age}
          </span>
        </span>
      </span>
      <span className="small mail-ratings">
        <span>
          Youth <b className={`num ${band(c.youth)}`}>{c.youth}</b>
        </span>
        <span>
          Vets <b className={`num ${band(c.veterans)}`}>{c.veterans}</b>
        </span>
      </span>
      <span className="small mail-money">
        <b className="num">{money(coachAsk(league, as, 2))}</b>/yr
        <span className="muted" style={{ display: 'block' }}>
          2 years
        </span>
      </span>
      <span className="mail-person-act">
        {scheme && <span className="tag-pill scheme-pill">{scheme}</span>}
        <FitPill fit={visionFit(league, hc, as)} />
        <button className="btn btn-sm" disabled={!!problem} title={problem ?? undefined} onClick={go}>
          {action}
        </button>
      </span>
    </div>
  );
}

/** Ways to fill the chair a coach left: our own men one rung below it, and the best of the market. */
function PoachedCards({ league, s, live }: { league: League; s: Extract<MailSubject, { kind: 'poached' }>; live: boolean }) {
  const nav = useNav();
  const user = league.userTeamId;
  const title = coachTitle(s.chair).toLowerCase();
  if (!live) {
    const holder = s.season === league.season ? chairHolder(teamCoaches(league, user), s.chair) : null;
    return (
      <p className="muted small" style={{ margin: 0 }}>
        {holder ? (
          <>
            Filled:{' '}
            <button className="linklike" onClick={() => nav.openStaff('coach', holder.id)}>
              {coachName(holder)}
            </button>{' '}
            is our {title} now.
          </>
        ) : (
          'Coaching moves are closed until the next re-sign window.'
        )}
      </p>
    );
  }
  const inside = promotionCandidates(league, s.chair);
  // The best the budget covers first; past it, the owner has his say on the Coaches screen.
  const market = coachMarket(league)
    .filter((c) => sameChair(chairOf(c), s.chair))
    .map((c) => ({ c, over: moveOverspend(league, user, c, 2, 'hire') > 0 }))
    .sort((a, b) => Number(a.over) - Number(b.over) || coachValue(b.c) - coachValue(a.c));
  return (
    <>
      {inside.length > 0 && (
        <Card title="Promote from within">
          {inside.map((c) => {
            const problem = promotionProblem(league, user, c, 2, false) ?? (moveOverspend(league, user, c, 2, 'promote') > 0 ? COACH_OVER : null);
            return <Option key={c.id} league={league} c={c} as={asPromoted(league, c, s.chair)} action="Promote" problem={problem} go={() => store.mutate((l) => promoteCoach(l, l.userTeamId, c.id, 2))} />;
          })}
        </Card>
      )}
      {market.length > 0 && (
        <Card title={`On the market: ${title}s`}>
          {market.slice(0, SHOW).map(({ c, over }) => (
            <Option key={c.id} league={league} c={c} as={c} action="Hire" problem={coachMoveProblem(league, user, c, 'hire', 2, false) ?? (over ? COACH_OVER : null)} go={() => store.mutate((l) => hireCoach(l, l.userTeamId, c.id, 2))} />
          ))}
          <div className="mail-more">
            <span className="muted">The best your budget covers come first.</span>
            <button className="linklike" onClick={() => nav.go({ view: 'office', tab: 'coaches' })}>
              See all {market.length} on the Coaches screen
            </button>
          </div>
        </Card>
      )}
    </>
  );
}

/** Every new head coach: where he was last season, and the man he replaced with that team's record. */
function CarouselCards({ league, s }: { league: League; s: Extract<MailSubject, { kind: 'carousel' }> }) {
  const nav = useNav();
  const [all, setAll] = useState(false);
  const changes = headCoachChanges(league, s.season);
  if (!changes.length) return null;
  const division = league.teams[league.userTeamId].division;
  const shown = all ? changes : changes.slice(0, 5);
  const from = (x: HeadCoachChange) => {
    if (!x.from) {
      // Never on a staff at a season's end: a former player's first job, a market man's last one, or someone new.
      const played = x.coach.playerId !== undefined ? league.players[x.coach.playerId] : undefined;
      return played ? `Former ${played.position}, first coaching job` : (x.coach.lastJob ?? 'New to the league');
    }
    const away = x.from.season < s.season - 1 ? ` in ${x.from.season}` : '';
    if (x.from.teamId === x.teamId && !away) return `Promoted from ${x.from.title.toLowerCase()}`;
    return `${x.from.title}, ${league.teams[x.from.teamId].abbrev}${away}${x.from.record ? ` (${recordText(x.from.record)})` : ''}`;
  };
  return (
    <Card>
      <div className="table-scroll">
        <table className="mail-table">
          <thead>
            <tr>
              <th>Team</th>
              <th>New head coach</th>
              <th>Out</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((x) => (
              <tr key={x.teamId} className={x.teamId === league.userTeamId ? 'is-user' : undefined}>
                <td>
                  <span className="team-inline">
                    <TeamChip team={league.teams[x.teamId]} /> {league.teams[x.teamId].name}
                  </span>
                  {league.teams[x.teamId].division === division && x.teamId !== league.userTeamId && (
                    <span className="muted small" style={{ display: 'block' }}>
                      Your division
                    </span>
                  )}
                </td>
                <td>
                  <span className="staff-who">
                    <StaffAvatar person={x.coach} size={28} />
                    <span style={{ minWidth: 0 }}>
                      <button className="linklike" onClick={() => nav.openStaff('coach', x.coach.id)}>
                        {coachName(x.coach)}
                      </button>
                      <span className="muted small" style={{ display: 'block' }}>
                        {from(x)}
                      </span>
                    </span>
                  </span>
                </td>
                <td>
                  {x.replaced ? (
                    <span className="staff-who">
                      <StaffAvatar person={x.replaced} size={28} />
                      <span style={{ minWidth: 0 }}>
                        <button className="linklike" onClick={() => nav.openStaff('coach', x.replaced!.id)}>
                          {coachName(x.replaced)}
                        </button>
                        {x.record && <span className="muted small" style={{ display: 'block' }}>{recordText(x.record)}</span>}
                      </span>
                    </span>
                  ) : (
                    <span className="muted">–</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {changes.length > 5 && (
        <div className="mail-more">
          <span className="muted">{changes.length} new head coaches</span>
          <button className="linklike" onClick={() => setAll(!all)}>
            {all ? 'Show fewer' : `See all ${changes.length}`}
          </button>
        </div>
      )}
    </Card>
  );
}

const dealText = (d: Signing) => `${d.years} yr, ${money(d.total)}`;

/** A list that shows a few rows, with the rest a click away. */
function Expandable<T>({ items, limit, render, label }: { items: T[]; limit: number; render: (x: T) => ReactNode; label: string }) {
  const [all, setAll] = useState(false);
  return (
    <>
      {(all ? items : items.slice(0, limit)).map(render)}
      {items.length > limit && (
        <div className="mail-more">
          <span className="muted">
            {items.length} {label}
          </span>
          <button className="linklike" onClick={() => setAll(!all)}>
            {all ? 'Show fewer' : `See all ${items.length}`}
          </button>
        </div>
      )}
    </>
  );
}

/** Free agency in short: who came, who left and for how much, the league's biggest deals, and the cap the draft fits in. */
function FaWrapCards({ league, s }: { league: League; s: Extract<MailSubject, { kind: 'faWrap' }> }) {
  const nav = useNav();
  const fa = freeAgencyMoves(league, s.season);
  const user = league.userTeamId;
  const name = (p: Player) => (
    <span>
      <span className="pos">{p.position}</span>{' '}
      <button className="linklike" onClick={() => nav.openPlayer(p.id)}>
        {playerName(p)}
      </button>
    </span>
  );
  const space = Math.round(capSheet(league, user).space);
  const rookies = s.season === league.season ? Math.round(rookieCost(league, user)) : 0;
  return (
    <>
      <div className="mail-split">
        <Card title="Signed">
          {fa.signed.length ? (
            <Expandable
              items={fa.signed}
              limit={5}
              label="signings"
              render={(d) => (
                <div className="mail-deal" key={d.player.id}>
                  {name(d.player)}
                  <span className="num small">{dealText(d)}</span>
                </div>
              )}
            />
          ) : (
            <p className="muted small" style={{ margin: 0 }}>
              No free-agent signings.
            </p>
          )}
          {fa.resigned > 0 && (
            <p className="muted small" style={{ margin: '8px 0 0' }}>
              Plus {fa.resigned} of our own re-signed before free agency opened.
            </p>
          )}
        </Card>
        <Card title="Walked">
          {fa.walked.length || fa.unsigned.length ? (
            <>
              <Expandable
                items={fa.walked}
                limit={5}
                label="signed elsewhere"
                render={(d) => (
                  <div className="mail-deal" key={d.player.id}>
                    {name(d.player)}
                    <span className="small">
                      <TeamChip team={league.teams[d.teamId]} /> <span className="num">{dealText(d)}</span>
                    </span>
                  </div>
                )}
              />
              {fa.unsigned.length > 0 && (
                <p className="muted small" style={{ margin: '8px 0 0' }}>
                  Still unsigned: <PlayerList players={fa.unsigned.slice(0, 5)} />
                  {fa.unsigned.length > 5 ? ` and ${fa.unsigned.length - 5} more` : ''}.
                </p>
              )}
            </>
          ) : (
            <p className="muted small" style={{ margin: 0 }}>
              Nobody left.
            </p>
          )}
        </Card>
      </div>
      {fa.biggest.length > 0 && (
        <Card title="Biggest deals in the league">
          {fa.biggest.map((d) => (
            <div className="mail-deal" key={d.player.id}>
              <span className="team-inline">
                <TeamChip team={league.teams[d.teamId]} /> {name(d.player)}
              </span>
              <span className="num small">{dealText(d)}</span>
            </div>
          ))}
        </Card>
      )}
      {s.season === league.season && (
        <Card title="The cap">
          <div className="mail-tiles">
            <span className="mail-tile">
              <b>{money(space)}</b>
              <span className="eyebrow">Cap space</span>
            </span>
            {rookies > 0 && (
              <>
                <span className="mail-tile">
                  <b>{money(rookies)}</b>
                  <span className="eyebrow">Rookies, about</span>
                </span>
                <span className="mail-tile">
                  <b className={space - rookies < 0 ? 'tone-bad' : undefined}>{money(space - rookies)}</b>
                  <span className="eyebrow">After rookies</span>
                </span>
              </>
            )}
          </div>
        </Card>
      )}
    </>
  );
}

// ───────── position moves ─────────

/**
 * The coaches' suggestion: the case for the move in words, and, while it still asks, Start or Not now. Once
 * answered it says what came of it: a plan under way, turned down, or camp over.
 */
function PositionOfferCards({ league, s, live }: { league: League; s: Extract<MailSubject, { kind: 'positionOffer' }>; live: boolean }) {
  const p = league.players[s.playerId];
  if (!p || p.teamId !== league.userTeamId) return null;
  const learning = activeLearning(p);
  if (!live) {
    const passed = league.teams[league.userTeamId].training?.passed?.[p.id] === s.season;
    const f = learning ? familiarity(p) : null;
    const now = p.moves?.some((m) => m.season >= s.season && m.to === s.to)
      ? `Moved to ${s.to}`
      : learning?.to === s.to
        ? learnLine(p.position, s.to, f)
        : passed
          ? 'You turned it down'
          : 'Not started';
    return (
      <Card>
        <Who league={league} p={p} sub={`${p.position} · age ${p.age}`} side={<span className={`tag-pill ${learning?.to === s.to ? familiarityTone(f) : ''}`}>{now}</span>} />
      </Card>
    );
  }
  const read = conversionRead(league, p, s.to);
  const reason = reasonText(read);
  return (
    <Card>
      <Who league={league} p={p} sub={`${p.position} → ${s.to} · age ${p.age}`} side={<span className={`tag-pill ${verdictTone(read.verdict)}`}>{verdictText(read.verdict)}</span>} />
      <div className="mail-split" style={{ marginTop: 10 }}>
        <span>
          <span className="eyebrow">Why</span>
          <span style={{ display: 'block', fontSize: 'var(--step-0)' }}>{reason || 'No reason the coaches act on'}</span>
        </span>
        <span>
          <span className="eyebrow">At {s.to}</span>
          <span style={{ display: 'block', fontSize: 'var(--step-0)' }}>
            {roleText(read)} · {readyText(read.camps, league.phase)}
          </span>
          <span className="muted small" style={{ display: 'block' }}>
            {leftText(read.left, p.position)}
          </span>
        </span>
      </div>
      <div style={{ marginTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button className="btn btn-sm btn-primary" disabled={!!read.problem} title={read.problem ?? undefined} onClick={() => store.mutate((l) => startMove(l, p.id, s.to, read.reason ?? undefined))}>
          Start teaching him {s.to}
        </button>
        <button className="btn btn-sm" onClick={() => store.mutate((l) => passMove(l, p.id))}>
          Not now
        </button>
      </div>
    </Card>
  );
}

/** A finished move: where he plays now and where he stands on that depth chart. */
function PositionMovedCards({ league, s }: { league: League; s: Extract<MailSubject, { kind: 'positionMoved' }> }) {
  const p = league.players[s.playerId];
  const move = p?.moves?.find((m) => m.season === s.season);
  if (!p || !move) return null;
  const spot = p.teamId === null ? -1 : league.teams[p.teamId].depthChart[move.to].indexOf(p.id);
  return (
    <Card>
      <Who
        league={league}
        p={p}
        sub={`${move.from} → ${move.to} · age ${p.age}`}
        side={<span className="tag-pill">{p.position !== move.to ? `Now ${p.position}` : spot >= 0 ? `${ordinal(spot + 1)} on the ${move.to} chart` : move.to}</span>}
      />
    </Card>
  );
}
