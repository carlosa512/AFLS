import { employed, managesTeam } from '../../engine/employment';
import { acceptGmOffer, advanceGmHiringRound } from '../../engine/leadership';
import { gamesInWeek } from '../../engine/league';
import { teamPlayers } from '../../engine/roster';
import type { League } from '../../engine/types';
import { Panel, PlayerLink, TeamLink } from '../components';
import { GmLink } from '../gm';
import { LinkedText } from '../moves';
import { useNav } from '../nav';
import { live } from '../live';
import { store } from '../store';

export function LeadershipReports({ league, teamId }: { league: League; teamId?: number }) {
  const events = league.leadership.events
    .filter((e) => teamId === undefined || e.teamId === teamId)
    .slice(-8)
    .reverse();
  if (!events.length) return null;
  return (
    <Panel title="Leadership news and rumors">
      <ul className="gm-news">
        {events.map((e) => (
          <li key={e.id}>
            <small className="muted">
              {e.date.season}
              {e.date.phase === 'regular' ? ` · Week ${e.date.week}` : ''}
            </small>
            <p>
              <LinkedText league={league} text={e.report} />
            </p>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
export function GmJobs({ league }: { league: League }) {
  const user = league.gms[league.userGmId],
    search = league.leadership.search;
  const active = search && search.season === league.season && search.round < 3 && league.phase === 'resign';
  const review = user.teamId === null ? undefined : league.teams[user.teamId].leadershipReview;
  return (
    <Panel title={employed(league) ? 'Your appointment' : 'Between GM jobs'}>
      <p>
        <GmLink league={league} gm={user} avatar />{' '}
        {user.teamId !== null ? (
          <>
            runs <TeamLink team={league.teams[user.teamId]} full />.
          </>
        ) : (
          <>remains in this league. You can seek a new job, watch games or simulate while unemployed.</>
        )}
      </p>
      {review && managesTeam(league, user.teamId!) && (
        <div className="callout">
          <b>Private owner briefing</b>
          <p>{review.reason}</p>
        </div>
      )}
      {active && (
        <>
          <p>GM hiring round {search.round + 1} of 3. Offers expire before round 3.</p>
          <ul className="gm-job-offers">
            {search.offers.map((o) => (
              <li key={o.teamId}>
                <TeamLink team={league.teams[o.teamId]} full /> ·{' '}
                {o.incumbent ? 'Permanent appointment' : 'GM position'} through {o.through}{' '}
                <button
                  className="btn btn-primary btn-sm"
                  onClick={() => store.mutate((l) => acceptGmOffer(l, o.teamId))}
                >
                  Accept offer
                </button>
              </li>
            ))}
          </ul>
          {!search.offers.length && (
            <p className="muted">
              {user.teamId !== null && !user.appointments.at(-1)?.interim
                ? 'Other clubs are conducting their GM searches. Your appointment continues.'
                : 'No offers at this round. Owners may choose another candidate.'}
            </p>
          )}
          <button className="btn btn-sm" onClick={() => store.mutate((l) => advanceGmHiringRound(l))}>
            Continue hiring round
          </button>
        </>
      )}
      {!active && !employed(league) && (
        <p className="muted">The next offseason brings another hiring cycle. A job offer is not guaranteed.</p>
      )}
    </Panel>
  );
}
export function SpectatorHome({ league }: { league: League }) {
  const nav = useNav();
  const games =
    league.phase === 'regular' || league.phase === 'playoffs' ? gamesInWeek(league).filter((g) => !g.result) : [];
  return (
    <div className="stack">
      <GmJobs league={league} />
      <Panel title="Watch the league">
        <p>
          Your former team is managed by its new GM. Advance the week to simulate, or watch any scheduled game below.
        </p>
        {!games.length && (
          <p className="muted">
            Live games are available during the season. Continue the calendar to follow the league.
          </p>
        )}
        <ul className="gm-job-offers">
          {games.map((g) => (
            <li key={g.id}>
              <TeamLink team={league.teams[g.awayId]} chip /> at <TeamLink team={league.teams[g.homeId]} chip />{' '}
              <button
                className="btn btn-sm"
                onClick={() => {
                  live.start(league, g);
                  nav.go({ view: 'live' });
                }}
              >
                Watch live
              </button>
            </li>
          ))}
        </ul>
      </Panel>
      <LeadershipReports league={league} />
    </div>
  );
}
export function PublicRoster({ league, teamId }: { league: League; teamId: number }) {
  return (
    <Panel title={`${league.teams[teamId].city} ${league.teams[teamId].name}`}>
      <p className="muted">Public roster. Organization reports and roster controls require a GM appointment.</p>
      <ul className="gm-public-roster">
        {teamPlayers(league, teamId).map((p) => (
          <li key={p.id}>
            <PlayerLink league={league} player={p} avatar={28} /> · {p.position} · Age {p.age}
          </li>
        ))}
      </ul>
    </Panel>
  );
}
