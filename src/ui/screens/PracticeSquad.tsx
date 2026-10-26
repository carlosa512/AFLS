import { useState } from 'react';
import { practiceSquad, teamPlayers } from '../../engine/roster';
import { capSheet } from '../../engine/finance/cap';
import { yearOf } from '../../engine/finance/contract';
import type { League, Player } from '../../engine/types';
import { squadCategory, squadRates } from '../../engine/personnel/eligibility';
import { squadPayroll, weeklySquadPay } from '../../engine/personnel/payroll';
import {
  cancelSquadOffer,
  squadOfferProblem,
  squadWindowProblem,
  submitSquadOffer,
} from '../../engine/personnel/squads';
import { formPracticeSquads, squadCandidates } from '../../engine/personnel/squadMarket';
import { Panel, PlayerLink, SortTh, sortRows, TeamLink, TeamPicker, useSort } from '../components';
import { SquadActions } from '../contracts';
import { money, weeklyMoney } from '../format';
import { liveLock } from '../live';
import { Ovr, ScoutedCeiling, seenOvr, viewOf } from '../scouting';
import { FuturesCell, GameDayPanel, PoachAction, ProtectionCell, SquadSignings } from '../personnel';
import { futuresWindowOpen } from '../../engine/personnel/futures';
import { elevationUses } from '../../engine/personnel/elevations';
import { store } from '../store';

type Key = 'name' | 'pos' | 'age' | 'ovr' | 'upside' | 'category' | 'pay' | 'calls';
const categoryLabel = { base: 'Standard', developmental: 'Experience exception', veteran: 'Veteran' };

export function PracticeSquad({ league }: { league: League }) {
  const [teamId, setTeamId] = useState(league.userTeamId);
  const [rates, setRates] = useState<Record<number, number>>({});
  const [query, setQuery] = useState('');
  const [message, setMessage] = useState('');
  const [sort, onSort] = useSort<Key>({ key: 'upside', desc: true });
  if (!league.personnel?.enabled)
    return (
      <Panel title="Practice squad">
        <p>Personnel transactions are not active in this career yet.</p>
      </Panel>
    );
  const members = practiceSquad(league, teamId);
  const pay = squadPayroll(league, teamId);
  const sheet = capSheet(league, teamId);
  const weeklyPay = members.reduce((sum, p) => sum + weeklySquadPay(p), 0);
  const weeklyPayroll =
    weeklyPay +
    teamPlayers(league, teamId).reduce((sum, p) => {
      const year = p.contract && yearOf(p.contract, league.season);
      return sum + (year && !year.void ? year.base / Math.max(1, 18 - (year.paidBefore ?? 0)) : 0);
    }, 0);
  const seasonBudget = sheet.cap + sheet.carryover;
  const expanded = members.filter((p) => squadCategory(league, p) !== 'base').length;
  const veterans = members.filter((p) => squadCategory(league, p) === 'veteran').length;
  const mine = teamId === league.userTeamId;
  const offseason = futuresWindowOpen(league, league.userTeamId);
  const lock = liveLock();
  const window = lock ?? squadWindowProblem(league);
  const offers = league.personnel.squads?.offers.filter((o) => o.teamId === league.userTeamId) ?? [];
  const invites = league.personnel.squads?.returns.filter((o) => o.teamId === league.userTeamId) ?? [];
  const value = (p: Player, key: Key): string | number => {
    switch (key) {
      case 'name':
        return `${p.lastName} ${p.firstName}`;
      case 'pos':
        return p.position;
      case 'age':
        return p.age;
      case 'ovr':
        return seenOvr(league, p);
      case 'upside':
        return viewOf(league, p).potMid;
      case 'category':
        return squadCategory(league, p);
      case 'calls':
        return elevationUses(league, p, teamId);
      case 'pay':
        return p.squad ? weeklySquadPay(p) : (rates[p.id] ?? squadRates(league, p).min);
    }
  };
  const table = (players: Player[], market: boolean) => (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            {(
              [
                ['name', 'Player'],
                ['pos', 'Pos'],
                ['age', 'Age'],
                ['ovr', 'Overall'],
                ['upside', 'Scouted ceiling'],
                ['category', 'Eligibility'],
                ['pay', 'Weekly pay'],
                ...(!market ? [['calls', 'Call-ups'] as [Key, string]] : []),
              ] as [Key, string][]
            ).map(([key, label]) => (
              <SortTh key={key} label={label} k={key} sort={sort} onSort={onSort} />
            ))}
            {!market && <th>{mine ? (offseason ? 'Next season' : 'Protection') : 'Sign'}</th>}
            {mine && <th>{market ? 'Offer' : 'Moves'}</th>}
          </tr>
        </thead>
        <tbody>
          {sortRows(players, sort, value).map((p) => {
            const rate = squadRates(league, p);
            const weeklyPay = rates[p.id] ?? rate.min;
            const offer = { teamId: league.userTeamId, playerId: p.id, weeklyPay };
            const problem = lock ?? squadOfferProblem(league, offer);
            const pending = offers.some((o) => o.playerId === p.id);
            return (
              <tr key={p.id}>
                <td className="sticky-col">
                  <PlayerLink league={league} player={p} />
                </td>
                <td>{p.position}</td>
                <td className="num">{p.age}</td>
                <td className="num">
                  <Ovr league={league} player={p} />
                </td>
                <td className="num">
                  <ScoutedCeiling league={league} player={p} />
                </td>
                <td>{categoryLabel[squadCategory(league, p)]}</td>
                <td className="num">
                  {market && rate.min !== rate.max ? (
                    <input
                      aria-label={`Weekly pay for ${p.firstName} ${p.lastName}, in dollars`}
                      type="number"
                      min={Math.round(rate.min * 1000)}
                      max={Math.round(rate.max * 1000)}
                      step="50"
                      value={Math.round(weeklyPay * 1000)}
                      style={{ width: 85 }}
                      onChange={(e) => setRates({ ...rates, [p.id]: Number(e.target.value) / 1000 })}
                    />
                  ) : (
                    weeklyMoney(market ? rate.min : weeklySquadPay(p))
                  )}
                </td>
                {!market && (
                  <td>
                    {league.phase === 'playoffs'
                      ? 'Unlimited'
                      : `${Math.max(0, 3 - elevationUses(league, p, teamId))} left`}
                  </td>
                )}
                {!market && (
                  <td>
                    {!mine ? (
                      <PoachAction league={league} player={p} />
                    ) : offseason ? (
                      <FuturesCell league={league} player={p} />
                    ) : (
                      <ProtectionCell league={league} player={p} />
                    )}
                  </td>
                )}
                {mine && (
                  <td>
                    {market ? (
                      <button
                        className="btn btn-sm"
                        disabled={!!lock || (!pending && !!problem)}
                        title={pending ? 'Withdraw this offer' : (problem ?? 'Add this player to your offers')}
                        onClick={() =>
                          store.mutate((l) =>
                            pending ? cancelSquadOffer(l, l.userTeamId, p.id) : submitSquadOffer(l, offer),
                          )
                        }
                      >
                        {pending ? 'Withdraw' : 'Make offer'}
                      </button>
                    ) : (
                      <SquadActions league={league} player={p} />
                    )}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
  const runRound = (staff = false) => {
    let ours = 0;
    store.mutate((l) => {
      formPracticeSquads(l, staff);
      ours = practiceSquad(l, l.userTeamId).length;
    });
    setMessage(`Your squad now has ${ours} of 16 players.`);
  };
  const candidates = squadCandidates(league).filter(
    (p) => !query || `${p.position} ${p.firstName} ${p.lastName}`.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <div className="stack">
      <Panel
        title="Practice squad"
        action={<TeamPicker league={league} value={teamId} onChange={setTeamId} id="squad-team" />}
      >
        <p>
          <TeamLink team={league.teams[teamId]} full /> · Up to 16 players train with your team outside the main roster.
          Use up to two for one game with a temporary call-up, or sign a player to the 53-man roster.
        </p>
        <p className="small muted">
          Squad deals pay by the week. Releasing a player stops later checks. Moving a player off the main roster
          requires a release first; other clubs may get a chance to claim him.
        </p>
        <div className="facts">
          <span className="fact">
            <span className="eyebrow">Players</span>
            <b>{members.length}/16</b>
          </span>
          <span className="fact">
            <span className="eyebrow">Squad weekly pay</span>
            <b>{weeklyMoney(weeklyPay)}</b>
            <span className="small muted">
              {((weeklyPay / Math.max(1, weeklyPayroll)) * 100).toFixed(1)}% of {money(weeklyPayroll)} team weekly
              payroll
            </span>
            <progress
              className="personnel-spend"
              aria-label="Squad share of weekly payroll"
              max={Math.max(1, weeklyPayroll)}
              value={weeklyPay}
            />
          </span>
          <span className="fact" title="Includes pay already owed and future weeks if you keep this squad.">
            <span className="eyebrow">Squad season cost</span>
            <b>{money(pay.total)}</b>
            <span className="small muted">
              {((pay.total / seasonBudget) * 100).toFixed(1)}% of {money(seasonBudget)} salary cap
            </span>
            <progress
              className="personnel-spend"
              aria-label="Squad share of salary cap"
              max={seasonBudget}
              value={pay.total}
            />
          </span>
          <span className="fact">
            <span className="eyebrow">Team cap space left</span>
            <b className={sheet.space < 0 ? 'tone-bad' : undefined}>{money(sheet.space)}</b>
          </span>
        </div>
        <details className="personnel-help">
          <summary>Player limits</summary>
          <p>You can carry up to 16 players. A full squad is optional.</p>
          <p>
            Most players use a standard spot. More experienced players use special slots: {expanded}/10 used, including{' '}
            {veterans}/6 veteran slots.
          </p>
          <p className="small muted">
            A standard spot covers players with no seasons of service. A season of service means at least six
            regular-season games on the main roster, called up or on injured reserve. Players with one or two seasons
            use the special slots; three or more makes a veteran.
          </p>
        </details>
        {window && <p className="callout">{window}</p>}
        {message && (
          <p role="status" className="callout">
            {message}
          </p>
        )}
      </Panel>
      <GameDayPanel league={league} teamId={teamId} />
      <Panel title={`Squad roster · ${members.length} players`}>
        {members.length ? (
          table(members, false)
        ) : (
          <p className="muted">Your squad is empty. Add players below or let your staff choose for you.</p>
        )}
      </Panel>
      <SquadSignings league={league} />
      {mine && (
        <Panel
          title="Add players"
          action={
            <span className="row">
              <button
                className="btn"
                disabled={!!window || members.length >= 16}
                title={window ?? 'Your staff chooses affordable prospects using its scouting reports'}
                onClick={() => runRound(true)}
              >
                Let staff fill open spots
              </button>
              <button
                className="btn btn-primary"
                disabled={!!window || (!offers.length && !invites.length)}
                title={window ?? undefined}
                onClick={() => runRound()}
              >
                Send offers
              </button>
            </span>
          }
        >
          <p>
            {offers.length} {offers.length === 1 ? 'offer' : 'offers'} ready to send. Players can choose another club.
          </p>
          {!!invites.length && (
            <p className="small">
              Invited back:{' '}
              {invites.map((o) => (
                <span key={o.playerId}>
                  <PlayerLink league={league} player={league.players[o.playerId]} />{' '}
                  <button
                    className="linklike"
                    disabled={!!lock}
                    onClick={() => store.mutate((l) => cancelSquadOffer(l, l.userTeamId, o.playerId))}
                  >
                    Cancel invitation
                  </button>
                  {' · '}
                </span>
              ))}
            </p>
          )}
          <label className="row">
            Find players{' '}
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Name or position"
            />
          </label>
          <p className="small muted">
            Showing {Math.min(60, candidates.length)} of {candidates.length} matching players, ranked by your scouts'
            ceiling. Pay is per week, in dollars.
          </p>
          {table(sortRows(candidates, { key: 'upside', desc: true }, value).slice(0, 60), true)}
        </Panel>
      )}
    </div>
  );
}
