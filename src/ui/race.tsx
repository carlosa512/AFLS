/**
 * Free agency's race on a screen (spec `docs/superpowers/specs/2026-11-20-free-agency-race-design.md`, "What you see"):
 * the teams in for a player as chips, where your offer stands, and his race as he sees it (what matters to him, a bar
 * per team, his agent's line). Everything comes through `raceView` and `wantsLine`: bars in tenths and the agent's
 * rounded number, never another team's deal.
 */
import type { CSSProperties } from 'react';
import { STATUS_WORDS, wantsLine, type RaceView } from '../engine/offseason/raceView';
import type { League, Player, Team } from '../engine/types';
import { inkOn } from './color';
import { TeamLink } from './components';
import { money, ordinal } from './format';

/** One team's chip in its colours; yours in the marker yellow. */
function Chip({ team, you }: { team: Team; you: boolean }) {
  const style = you
    ? undefined
    : ({ '--c1': team.colors[0], '--c2': team.colors[1], color: inkOn(team.colors[0]) } as CSSProperties);
  return (
    <span className={`chip race-chip${you ? ' is-you' : ''}`} style={style} title={`${team.city} ${team.name}`}>
      {team.abbrev}
    </span>
  );
}

/** The teams with an offer in for him that he would sign, best first: the first `max` as chips, then "+n". */
export function RaceChips({ league, view, max = 3 }: { league: League; view: RaceView; max?: number }) {
  const shown = view.teams.slice(0, max);
  const rest = view.teams.length - shown.length;
  return (
    <span className="race-chips">
      <span className="visually-hidden">{view.teams.map((t) => league.teams[t.teamId].city).join(', ')}</span>
      {shown.map((t) => (
        <span key={t.teamId} aria-hidden="true">
          <Chip team={league.teams[t.teamId]} you={t.you} />
        </span>
      ))}
      {rest > 0 && (
        <span className="race-more" aria-hidden="true">
          +{rest}
        </span>
      )}
    </span>
  );
}

/** Where your offer stands: Leading, "2nd of 4", or None, after a dot in its colour. */
export function RacePlace({ view }: { view: RaceView }) {
  const [tone, words] =
    view.place === null
      ? ['none', 'None']
      : view.place === 1
        ? ['lead', 'Leading']
        : ['behind', `${ordinal(view.place)} of ${view.of}`];
  return <span className={`race-place is-${tone}`}>{words}</span>;
}

/** What his agent says of a yearly price ($K), already rounded to the half million: "$13M", "$12.5M". */
const about = (apyK: number) => `$${apyK / 1000}M`;

/** His agent's line: who leads and, when it isn't you, at about what a year. */
function AgentLine({ league, view }: { league: League; view: RaceView }) {
  if (view.leader === null || view.leaderApy === null) return <>No team has an offer in that he would sign.</>;
  if (view.leader === league.userTeamId) return <>Your offer leads.</>;
  // By city, as his agent's letters say it.
  const team = <TeamLink team={league.teams[view.leader]} city />;
  return view.yours ? (
    <>
      {team} is ahead of you at about {about(view.leaderApy)} a year.
    </>
  ) : (
    <>
      {team} leads at about {about(view.leaderApy)} a year.
    </>
  );
}

/** The most bars a panel shows; the rest are counted. */
export const RACE_BARS = 5;

/** The teams a panel draws a bar for: the top `RACE_BARS`, yours always among them when it stands further back. */
export function barsShown(view: RaceView): RaceView['teams'] {
  const top = view.teams.slice(0, RACE_BARS);
  const yours = view.teams.find((t) => t.you);
  return !yours || top.includes(yours) ? top : [...top.slice(0, RACE_BARS - 1), yours];
}

/** One player's race as he sees it: what matters to him, how he likes each offer, and his agent's line. */
export function RacePanel({ league, player, view }: { league: League; player: Player; view: RaceView }) {
  const wants = wantsLine(league, league.userTeamId, player);
  const bars = barsShown(view);
  const more = view.teams.length - bars.length;
  return (
    <section className="race-panel" aria-label="Offers for him">
      <div className="race-top">
        {wants && (
          <span className="race-wants">
            <span className="eyebrow">What matters to him</span>
            {wants}
          </span>
        )}
        <span className="race-status">{STATUS_WORDS[view.status]}</span>
      </div>
      {view.teams.length > 0 && (
        <div className="race-bars">
          {bars.map((t) => (
            <div key={t.teamId} className={`race-bar${t.you ? ' is-you' : ''}`}>
              <Chip team={league.teams[t.teamId]} you={t.you} />
              <span className="race-track" aria-hidden="true">
                <i style={{ width: `${t.bar * 100}%` }} />
              </span>
              {t.you && view.yours && (
                <span className="race-yours">
                  Yours{' '}
                  <span className="num">
                    {money(view.yours.apy)} a year · {view.yours.years} yr
                  </span>
                </span>
              )}
            </div>
          ))}
          {more > 0 && <span className="race-more-teams">{more === 1 ? '1 more team' : `${more} more teams`}</span>}
        </div>
      )}
      <p className="race-agent">
        <span className="eyebrow">His agent</span>
        <AgentLine league={league} view={view} />
      </p>
    </section>
  );
}
