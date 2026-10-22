import { capSheet, deadMoneyIn, isOffseason, POST_JUNE1_LIMIT, releasePreview } from '../../engine/finance/cap';
import { capHit, guaranteedFrom, lastSeason } from '../../engine/finance/contract';
import { teamPlayers } from '../../engine/roster';
import type { League, Player } from '../../engine/types';
import { POSITIONS } from '../../engine/types';
import { useNav } from '../App';
import { Panel, PlayerLink, SortTh, sortRows, TeamChip, TeamLink, TeamPicker, useSort } from '../components';
import { CapChart, capPct, ContractActions, thruLabel } from '../contracts';
import { money } from '../format';
import { moveIndex, MoveText } from '../moves';

/** The contracts table's columns ("% of cap" sorts as the cap hit: same order). */
type ContractSort = 'name' | 'pos' | 'age' | 'cap' | 'apy' | 'thru' | 'gtd' | 'dead' | 'saves';

function contractSortValue(league: League, p: Player, key: ContractSort): number | string {
  const c = p.contract!;
  switch (key) {
    case 'name':
      return `${p.lastName} ${p.firstName}`.toLowerCase();
    case 'pos':
      return POSITIONS.indexOf(p.position);
    case 'age':
      return p.age;
    case 'cap':
      return capHit(c, league.season);
    case 'apy':
      return c.apy;
    case 'thru':
      return lastSeason(c);
    case 'gtd':
      return guaranteedFrom(c, league.season);
    case 'dead': {
      const cut = releasePreview(league, p);
      return cut.thisYear + cut.nextYear;
    }
    case 'saves':
      return releasePreview(league, p).savings;
  }
}

export function Finances({ league, teamId }: { league: League; teamId: number }) {
  const nav = useNav();
  const team = league.teams[teamId];
  const isUser = teamId === league.userTeamId;
  const sheet = capSheet(league, teamId);
  const season = league.season;
  const [sort, onSort] = useSort<ContractSort>({ key: 'cap', desc: true });
  const players = sortRows(
    teamPlayers(league, teamId).filter((p) => p.contract),
    sort,
    (p, key) => contractSortValue(league, p, key),
  );
  const dead = team.deadMoney
    .filter((d) => d.season >= season)
    .sort((a, b) => a.season - b.season || b.amount - a.amount);
  const moves = league.transactions
    .filter((t) => t.teamIds.includes(teamId))
    .slice(-12)
    .reverse();
  const names = moveIndex(league);

  return (
    <>
      <Panel
        title={
          <div className="row">
            <TeamChip team={team} large />
            <div>
              <h2>{season} salary cap</h2>
              <span className="muted">
                <TeamLink team={team} full />
                {!isUser && ` · GM style: ${team.gm.archetype}`}
              </span>
            </div>
          </div>
        }
        action={
          <TeamPicker
            league={league}
            value={teamId}
            onChange={(id) => nav.go({ view: 'cap', teamId: id })}
            id="cap-team"
          />
        }
      >
        <div className="facts">
          <span className="fact">
            <span className="eyebrow">Cap{sheet.carryover > 0 ? ' + carryover' : ''}</span>
            <b className="num">{money(sheet.cap + sheet.carryover)}</b>
          </span>
          <span className="fact">
            <span className="eyebrow">Contracts{sheet.top51 ? ' (top 51)' : ''}</span>
            <b className="num">{money(Math.round(sheet.active))}</b>
          </span>
          <span className="fact">
            <span className="eyebrow">Dead money</span>
            <b className="num">{money(Math.round(sheet.dead))}</b>
          </span>
          <span className="fact">
            <span className="eyebrow">Cap space</span>
            <b className={`num${sheet.space < 0 ? ' tone-bad' : ''}`}>{money(Math.round(sheet.space))}</b>
          </span>
          <span className="fact">
            <span className="eyebrow">Roster</span>
            <b className="num">
              {sheet.rosterSize}/{isOffseason(league.phase) ? 90 : 53}
            </b>
          </span>
          {isUser && (
            <span className="fact">
              <span className="eyebrow">Post-June 1 cuts left</span>
              <b className="num">{POST_JUNE1_LIMIT - team.postJune1Used}</b>
            </span>
          )}
        </div>
        {sheet.space < 0 && (
          <p className="callout callout-bad">
            Over the cap by {money(Math.round(-sheet.space))}. Release, restructure or trade players to get compliant
            before the new league year.
          </p>
        )}
      </Panel>

      <Panel title="Five-year outlook">
        <p className="muted small" style={{ marginTop: 0 }}>
          Money already committed in each league year. Bonus money pushed into void years comes due as dead money when
          those deals void.
        </p>
        <CapChart league={league} teamId={teamId} />
      </Panel>

      <Panel title="Contracts">
        {isUser && (
          <p className="muted small" style={{ marginTop: 0 }}>
            "If released" shows today's dead money and cap room{isOffseason(league.phase) ? ' (pre-June 1)' : ''}. Every
            button previews the full split before anything happens.
          </p>
        )}
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <SortTh label="Player" k="name" sort={sort} onSort={onSort} desc={false} className="sticky-col" />
                <SortTh label="Pos" k="pos" sort={sort} onSort={onSort} desc={false} />
                <SortTh label="Age" k="age" sort={sort} onSort={onSort} desc={false} className="num" />
                <SortTh label="Cap hit" k="cap" sort={sort} onSort={onSort} className="num" />
                <SortTh label="% of cap" k="cap" sort={sort} onSort={onSort} className="num" />
                <SortTh label="APY" k="apy" sort={sort} onSort={onSort} className="num" />
                <SortTh label="Thru" k="thru" sort={sort} onSort={onSort} className="num" />
                <SortTh label="Gtd left" k="gtd" sort={sort} onSort={onSort} className="num" />
                <SortTh label="If released: dead" k="dead" sort={sort} onSort={onSort} className="num" />
                <SortTh label="Saves" k="saves" sort={sort} onSort={onSort} className="num" />
                {isUser && <th>Actions</th>}
              </tr>
            </thead>
            <tbody>
              {players.map((p) => {
                const c = p.contract!;
                const hit = capHit(c, season);
                const cut = releasePreview(league, p);
                return (
                  <tr key={p.id}>
                    <td className="sticky-col">
                      <PlayerLink league={league} player={p} avatar={26} />
                    </td>
                    <td>{p.position}</td>
                    <td className="num">{p.age}</td>
                    <td className="num" style={{ fontWeight: 700 }}>
                      {money(Math.round(hit))}
                    </td>
                    <td className="num muted">{capPct(league, hit)}</td>
                    <td className="num">{money(c.apy)}</td>
                    <td className="num">
                      {thruLabel(league, c)}
                      {c.years.some((y) => y.void) && <span className="tag-pill">void</span>}
                    </td>
                    <td className="num">{money(guaranteedFrom(c, season))}</td>
                    <td className={`num${cut.thisYear + cut.nextYear > 0 ? ' tone-bad' : ''}`}>
                      {money(Math.round(cut.thisYear + cut.nextYear))}
                    </td>
                    <td className={`num${cut.savings < 0 ? ' tone-bad' : ''}`}>{money(Math.round(cut.savings))}</td>
                    {isUser && (
                      <td>
                        <ContractActions league={league} player={p} />
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Panel>

      <div className="grid-2">
        <Panel title="Dead money">
          {dead.length === 0 ? (
            <p className="muted" style={{ margin: 0 }}>
              None. Dead money appears when you release or trade a player with bonus money or guarantees left.
            </p>
          ) : (
            <table>
              <tbody>
                {dead.map((d, i) => {
                  const p = league.players[d.playerId];
                  return (
                    <tr key={i}>
                      <td className="num">{d.season}</td>
                      <td>
                        {p ? <PlayerLink league={league} player={p} /> : 'Former player'}{' '}
                        <span className="muted small">{d.note}</span>
                      </td>
                      <td className="num">{money(d.amount)}</td>
                    </tr>
                  );
                })}
                <tr>
                  <td className="num">{season}</td>
                  <td>
                    <b>Total this year</b>
                  </td>
                  <td className="num">
                    <b>{money(deadMoneyIn(team, season))}</b>
                  </td>
                </tr>
              </tbody>
            </table>
          )}
        </Panel>
        <Panel title="Recent moves">
          {moves.length === 0 ? (
            <p className="muted" style={{ margin: 0 }}>
              No transactions yet.
            </p>
          ) : (
            <ul className="moves">
              {moves.map((m, i) => (
                <li key={i}>
                  <span className="muted small">
                    {m.season} · {m.phase === 'regular' ? `Week ${m.week}` : m.phase}
                  </span>
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
