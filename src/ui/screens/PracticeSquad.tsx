import { useState } from 'react';
import { practiceSquad } from '../../engine/roster';
import type { League, Player } from '../../engine/types';
import { squadCategory, squadRates } from '../../engine/personnel/eligibility';
import { squadPayroll } from '../../engine/personnel/payroll';
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
import { Ovr, seenOvr, viewOf } from '../scouting';
import { store } from '../store';

type Key = 'name' | 'pos' | 'age' | 'ovr' | 'upside' | 'category' | 'pay';
const categoryLabel = { base: 'Base', developmental: 'Expanded · ≤2 seasons', veteran: 'Expanded · veteran' };

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
  const expanded = members.filter((p) => squadCategory(league, p) !== 'base').length;
  const veterans = members.filter((p) => squadCategory(league, p) === 'veteran').length;
  const mine = teamId === league.userTeamId;
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
      case 'pay':
        return p.squad?.agreement?.weeklyPay ?? rates[p.id] ?? squadRates(league, p).min;
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
                ['category', 'Slot'],
                ['pay', 'Weekly pay'],
              ] as [Key, string][]
            ).map(([key, label]) => (
              <SortTh key={key} label={label} k={key} sort={sort} onSort={onSort} />
            ))}
            {mine && <th>{market ? 'Offer' : 'Moves'}</th>}
          </tr>
        </thead>
        <tbody>
          {sortRows(players, sort, value).map((p) => {
            const view = viewOf(league, p);
            const rate = squadRates(league, p);
            const weeklyPay = rates[p.id] ?? rate.min;
            const offer = { teamId: league.userTeamId, playerId: p.id, weeklyPay };
            const problem = lock ?? squadOfferProblem(league, offer);
            const pending = offers.some((o) => o.playerId === p.id);
            return (
              <tr key={p.id} className={p.teamId === league.userTeamId ? 'is-user' : undefined}>
                <td className="sticky-col">
                  <PlayerLink league={league} player={p} />
                </td>
                <td>{p.position}</td>
                <td className="num">{p.age}</td>
                <td className="num">
                  <Ovr league={league} player={p} />
                </td>
                <td className="num">
                  {view.potLo.toFixed(1)}–{view.potHi.toFixed(1)}
                </td>
                <td>{categoryLabel[squadCategory(league, p)]}</td>
                <td className="num">
                  {market && rate.min !== rate.max ? (
                    <input
                      aria-label={`Weekly pay for ${p.firstName} ${p.lastName}, in thousands`}
                      type="number"
                      min={rate.min}
                      max={rate.max}
                      step="0.05"
                      value={weeklyPay}
                      style={{ width: 85 }}
                      onChange={(e) => setRates({ ...rates, [p.id]: Number(e.target.value) })}
                    />
                  ) : (
                    weeklyMoney(market ? rate.min : (p.squad?.agreement?.weeklyPay ?? 0))
                  )}
                </td>
                {mine && (
                  <td>
                    {market ? (
                      <button
                        className="btn btn-sm"
                        disabled={!!lock || (!pending && !!problem)}
                        title={
                          pending ? 'Withdraw this offer' : (problem ?? 'The player chooses when the market round runs')
                        }
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
    let signed = 0;
    let ours = 0;
    store.mutate((l) => {
      signed = formPracticeSquads(l, staff);
      ours = practiceSquad(l, l.userTeamId).length;
    });
    setMessage(`Market round complete: your squad has ${ours}/16 players; ${signed} agreements across the league.`);
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
          <TeamLink team={league.teams[teamId]} full /> · A place to develop prospects and keep affordable cover nearby.
        </p>
        <div className="facts">
          <span className="fact">
            <span className="eyebrow">Players</span>
            <b>{members.length}/16</b>
          </span>
          <span className="fact">
            <span className="eyebrow">Expanded slots</span>
            <b>{expanded}/10</b>
          </span>
          <span className="fact">
            <span className="eyebrow">Veterans within expanded</span>
            <b>{veterans}/6</b>
          </span>
          <span className="fact">
            <span className="eyebrow">Earned pay</span>
            <b>{money(pay.earned)}</b>
          </span>
          <span className="fact">
            <span className="eyebrow">Remaining projection</span>
            <b>{money(pay.projected)}</b>
          </span>
        </div>
        <p className="small muted">
          Base slots cover players with no accrued seasons, plus a lone accrued season with fewer than nine known
          game-day activations. Up to ten players can use expanded eligibility, including six unrestricted veterans. A
          full squad is optional.
        </p>
        <p className="small muted">
          Squad players practice with the club. To play, they need a new NFL contract and a spot on the 53. Signing
          commits this week's pay; releasing keeps earned pay on the cap.
        </p>
        {window && <p className="callout">{window}</p>}
        {message && (
          <p role="status" className="callout">
            {message}
          </p>
        )}
      </Panel>
      <Panel title={`Squad roster · ${members.length} players`}>
        {members.length ? (
          table(members, false)
        ) : (
          <p className="muted">No squad agreements yet. Open places never block your next game.</p>
        )}
      </Panel>
      {mine && (
        <Panel
          title="Squad market"
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
                disabled={!!window}
                title={window ?? undefined}
                onClick={() => runRound()}
              >
                Run market round
              </button>
            </span>
          }
        >
          <p>
            Your {offers.length} pending offers compete with the other clubs at the same time. Players weigh pay,
            familiarity, opportunity and winning. A return invitation guarantees neither clearance nor a signature.
          </p>
          {!!invites.length && (
            <p className="small">
              Return invitations:{' '}
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
            Find candidates{' '}
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Name or position"
            />
          </label>
          <p className="small muted">
            Showing the first 60 matching candidates by your scouts' ceiling. Veteran offers use $K per week; younger
            players have a fixed weekly rate. Unaccepted offers expire after the round.
          </p>
          {table(sortRows(candidates, { key: 'upside', desc: true }, value).slice(0, 60), true)}
        </Panel>
      )}
    </div>
  );
}
