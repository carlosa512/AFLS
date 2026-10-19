/**
 * The league's week along the top of Home, like Football Manager's fixtures bar: this week's games
 * (ours first, then the game of the week) or last week's finals, in a strip to scroll. A final opens
 * its box score; a game still to play opens either team.
 */
import { useRef, useState } from 'react';
import { gamesInWeek } from '../engine/league';
import { allSeeds, roundWeek } from '../engine/season/playoffs';
import { computeRecords } from '../engine/season/standings';
import type { Game, League, Team } from '../engine/types';
import { isNight } from '../engine/weather';
import { useNav } from './App';
import { TeamChip } from './components';
import { recordText, weekLabel } from './format';

type Records = ReturnType<typeof computeRecords>;

export interface StripGame {
  game: Game;
  /** "Your game", "Game of the week", "Prime time", "Division", or a final's "Final · OT". */
  tag: string;
  gameOfWeek: boolean;
}

const inSeason = (league: League) => league.phase === 'regular' || league.phase === 'playoffs';

/** The latest week with finals before the one being played (the title game, once the season is over); null before week 1 is in. */
export function resultsWeek(league: League): number | null {
  const current = inSeason(league) ? league.week : Infinity;
  const done = league.games.filter((g) => g.season === league.season && g.result && g.week < current).map((g) => g.week);
  return done.length ? Math.max(...done) : null;
}

/**
 * A week's games in strip order with their tags: ours first, then the game of the week (the best two
 * records meeting, once there are records to go on), then the schedule's order.
 */
export function stripGames(league: League, week: number, records: Records = computeRecords(league)): StripGame[] {
  const user = league.userTeamId;
  const games = gamesInWeek(league, week);
  const ours = (g: Game) => g.homeId === user || g.awayId === user;
  const share = (id: number) => {
    const r = records.get(id);
    const n = r ? r.w + r.l + r.t : 0;
    return r && n ? (r.w + 0.5 * r.t) / n : null;
  };
  const both = (g: Game) => (share(g.homeId) ?? NaN) + (share(g.awayId) ?? NaN);
  const best = games
    .filter((g) => !g.result && !g.playoffRound && !ours(g) && !Number.isNaN(both(g)))
    .sort((a, b) => both(b) - both(a))[0];
  const tagOf = (g: Game) => {
    if (g.result) return `${ours(g) ? 'Your game · ' : ''}Final${g.result.overtime ? ' · OT' : ''}`;
    if (ours(g)) return 'Your game';
    if (g === best) return 'Game of the week';
    if (isNight(league, g)) return 'Prime time';
    return !g.playoffRound && league.teams[g.homeId].division === league.teams[g.awayId].division ? 'Division' : '';
  };
  const rank = (g: Game) => (ours(g) ? 0 : g === best ? 1 : 2);
  return games
    .map((game, i) => ({ game, i }))
    .sort((a, b) => rank(a.game) - rank(b.game) || a.i - b.i)
    .map(({ game }) => ({ game, tag: tagOf(game), gameOfWeek: game === best }));
}

/** Who sits a week out: teams without a game in the regular season, the top seeds in the Wild Card round. */
export function byeTeams(league: League, week: number): Team[] {
  if (week === roundWeek('WC')) return allSeeds(league).map((seeds) => league.teams[seeds[0]]);
  if (week > 18) return [];
  const playing = new Set(gamesInWeek(league, week).flatMap((g) => [g.homeId, g.awayId]));
  return league.teams.filter((t) => !playing.has(t.id));
}

export function ScoreStrip({ league }: { league: League }) {
  const nav = useNav();
  const strip = useRef<HTMLDivElement>(null);
  const live = inSeason(league) && gamesInWeek(league).length > 0;
  const last = resultsWeek(league);
  const [pick, setPick] = useState<'games' | 'results'>('games');
  const view = (pick === 'games' && live) || last === null ? 'games' : 'results';
  if (view === 'games' && !live) return null;
  const week = view === 'games' ? league.week : last!;
  const records = computeRecords(league);
  const games = stripGames(league, week, records);
  const off = byeTeams(league, week);
  const finals = games.filter((x) => x.game.result).length;
  const note =
    view === 'results' ? `${finals} final${finals === 1 ? '' : 's'} · tap one for the box score` : `${games.length} game${games.length === 1 ? '' : 's'}${off.length ? ` · ${off.length} on a bye` : ''}`;
  const scroll = (dir: number) => strip.current?.scrollBy({ left: dir * strip.current.clientWidth * 0.8, behavior: 'smooth' });
  return (
    <section className="score-strip" aria-label="Around the league">
      <div className="strip-head">
        <div className="strip-pick">
          {live && last !== null ? (
            <div className="seg" role="group" aria-label="Which week">
              <button aria-pressed={view === 'results'} onClick={() => setPick('results')}>
                {weekLabel(last)} results
              </button>
              <button aria-pressed={view === 'games'} onClick={() => setPick('games')}>
                {weekLabel(league.week)} games
              </button>
            </div>
          ) : (
            <h2 className="strip-title">{`${weekLabel(week)} ${view === 'games' ? 'games' : 'results'}`}</h2>
          )}
          <span className="muted small">{note}</span>
        </div>
        <div className="strip-tools">
          <button className="btn btn-sm strip-arrow" aria-label="Scroll games left" onClick={() => scroll(-1)}>
            ‹
          </button>
          <button className="btn btn-sm strip-arrow" aria-label="Scroll games right" onClick={() => scroll(1)}>
            ›
          </button>
          <button className="linklike small" onClick={() => nav.go({ view: 'schedule' })}>
            Full schedule
          </button>
        </div>
      </div>
      <div className="strip" ref={strip}>
        {games.map((x) => (
          <StripCard key={x.game.id} league={league} x={x} records={records} />
        ))}
        {off.length > 0 && (
          <div className="strip-bye">
            <span className="strip-tag">{week > 18 ? 'First-round bye' : 'Bye week'}</span>
            <span className="small" style={{ fontWeight: 700 }}>
              {off.map((t) => t.abbrev).join(' · ')}
            </span>
          </div>
        )}
      </div>
    </section>
  );
}

/** One team's line on a card: chip, nickname (the home side marked @), and its score or record. */
function Line({ team, home, neutral, value }: { team: Team; home: boolean; neutral?: boolean; value: string }) {
  return (
    <>
      <TeamChip team={team} />
      <span className="ab">
        {home && !neutral ? '@ ' : ''}
        {team.name}
      </span>
      <span className="v">{value}</span>
    </>
  );
}

function StripCard({ league, x, records }: { league: League; x: StripGame; records: Records }) {
  const nav = useNav();
  const g = x.game;
  const ours = g.homeId === league.userTeamId || g.awayId === league.userTeamId;
  const away = league.teams[g.awayId];
  const home = league.teams[g.homeId];
  const cls = `strip-card${ours ? ' is-user' : ''}`;
  const r = g.result;
  if (r) {
    const state = (us: number, them: number) => (us > them ? 'won' : us < them ? 'lost' : undefined);
    return (
      <button className={cls} onClick={() => nav.openGame(g.id)} aria-label={`${away.name} ${r.awayScore}, ${home.name} ${r.homeScore}${r.overtime ? ', overtime' : ''}. Open the box score.`}>
        <span className="strip-tag">{x.tag}</span>
        <span className={`strip-line ${state(r.awayScore, r.homeScore) ?? ''}`}>
          <Line team={away} home={false} value={String(r.awayScore)} />
        </span>
        <span className={`strip-line ${state(r.homeScore, r.awayScore) ?? ''}`}>
          <Line team={home} home neutral={g.neutral} value={String(r.homeScore)} />
        </span>
      </button>
    );
  }
  const record = (t: Team) => recordText(records.get(t.id) ?? { w: 0, l: 0, t: 0 });
  return (
    <div className={cls}>
      <span className={`strip-tag${x.gameOfWeek ? ' hot' : ''}`}>{x.tag}</span>
      {[away, home].map((t) => (
        <button key={t.id} className="strip-line" onClick={() => nav.openTeam(t.id)} aria-label={`${t.city} ${t.name}, ${record(t)}. Open their roster.`}>
          <Line team={t} home={t === home} neutral={g.neutral} value={record(t)} />
        </button>
      ))}
    </div>
  );
}
