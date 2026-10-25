import { employed, managesTeam } from '../../engine/employment';
import { acceptGmOffer, advanceGmHiringRound, declineGmOffers, gmOfferTerms } from '../../engine/leadership';
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
      <div className="gm-appointment-line">
        <GmLink league={league} gm={user} avatar />
        <span>{user.teamId !== null ? <>This is you, GM of <TeamLink team={league.teams[user.teamId]} full />.</> : <>This is you. Your career continues in this league.</>}</span>
      </div>
      {review && managesTeam(league, user.teamId!) && (
        <div className="callout">
          <b>Private owner briefing</b>
          <p>{review.reason}</p>
        </div>
      )}
      {active && (user.teamId === null || user.appointments.at(-1)?.interim) && (
        <>
          <p>Review the owner's terms before accepting. You can keep an offer while considering other openings during the staffing window.</p>
          <ul className="gm-job-offers">
            {search.offers.map((o) => {
              const terms = gmOfferTerms(league, o);
              return <li key={o.teamId} className="gm-offer">
                <h3><TeamLink team={league.teams[o.teamId]} full /></h3>
                <p>{o.incumbent ? 'Permanent appointment' : 'GM position'} through {o.through}</p>
                <b>Owner expectations</b>
                <p>{terms.expectation}</p>
                <ul>{terms.staffing.map((line) => <li key={line}>{line}</li>)}</ul>
                <button className="btn btn-primary btn-sm" onClick={() => store.mutate((l) => acceptGmOffer(l, o.teamId))}>Accept terms and join</button>
              </li>;
            })}
          </ul>
          <div className="gm-search-actions">
            {search.round < 2 && <button className="btn btn-sm" onClick={() => store.mutate((l) => advanceGmHiringRound(l))}>Consider other openings</button>}
            <button className="btn btn-sm btn-ghost" onClick={() => store.mutate((l) => declineGmOffers(l))}>Decline offers and sit out</button>
          </div>
        </>
      )}
      {!active && !employed(league) && <p className="muted">Watch games or simulate this season. The next staffing window brings another chance to return.</p>}

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
