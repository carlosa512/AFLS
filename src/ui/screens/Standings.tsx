import { computeRecords, conferenceSeeds, divisionStandings, type TeamRecord } from '../../engine/season/standings';
import type { League } from '../../engine/types';
import { Panel, SortTh, sortRows, TeamLink, useSort } from '../components';
import { pct, recordText, resultsSeason } from '../format';

/** Standings columns: `rank` is the tiebreaker order the engine gives, the rest the row's own numbers. */
export type StandingsSort = 'rank' | 'w' | 'l' | 't' | 'pct' | 'pf' | 'pa' | 'div';

export function standingsSortValue(row: TeamRecord, key: StandingsSort, index: number): number {
  switch (key) {
    case 'rank':
      return index;
    case 'pct':
      return (row.w + row.t / 2) / Math.max(1, row.w + row.l + row.t);
    case 'div':
      return (row.div[0] + row.div[2] / 2) / Math.max(1, row.div[0] + row.div[1] + row.div[2]);
    default:
      return row[key];
  }
}

export function PlayoffPicture({ league, conference }: { league: League; conference: number }) {
  const records = computeRecords(league);
  const seeds = conferenceSeeds(league, conference, records);
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th className="num">Seed</th>
            <th>Team</th>
            <th className="num">Record</th>
          </tr>
        </thead>
        <tbody>
          {seeds.map((id, i) => {
            const t = league.teams[id];
            return (
              <tr key={id} className={id === league.userTeamId ? 'is-user' : ''}>
                <td className="num">{i + 1}</td>
                <td>
                  <TeamLink team={t} chip sub={i < 4 ? 'Division leader' : 'Wild card'} />
                </td>
                <td className="num">{recordText(records.get(id)!)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function Standings({ league }: { league: League }) {
  const season = resultsSeason(league);
  const divisions = divisionStandings(league, computeRecords(league, season));
  // One sort for all eight tables; each division's rows stay in their own table.
  const [sort, onSort, setSort] = useSort<StandingsSort>({ key: 'rank', desc: false });
  return (
    <>
      {season !== league.season && (
        <div className="notice">
          Final {season} standings. The {league.season} season starts after training camp.
        </div>
      )}
      {league.conferences.map((conf, c) => (
        <Panel key={conf.name} title={conf.name}>
          <div className="grid-2">
            {divisions
              .filter((d) => d.division.conference === c)
              .map((d) => (
                <div key={d.division.name} className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <SortTh
                          label={d.division.name}
                          k="rank"
                          sort={sort}
                          onSort={() => setSort({ key: 'rank', desc: false })}
                          desc={false}
                          className="sticky-col"
                        />
                        <SortTh label="W" k="w" sort={sort} onSort={onSort} className="num" />
                        <SortTh label="L" k="l" sort={sort} onSort={onSort} className="num" />
                        <SortTh label="T" k="t" sort={sort} onSort={onSort} className="num" />
                        <SortTh label="Pct" k="pct" sort={sort} onSort={onSort} className="num" />
                        <SortTh label="PF" k="pf" sort={sort} onSort={onSort} className="num" />
                        <SortTh label="PA" k="pa" sort={sort} onSort={onSort} className="num" />
                        <SortTh label="Div" k="div" sort={sort} onSort={onSort} className="num" />
                        <th className="num">Strk</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sortRows(
                        d.teams.map((r, i) => ({ r, i })),
                        sort,
                        ({ r, i }, key) => standingsSortValue(r, key, i),
                      ).map(({ r }) => {
                        const t = league.teams[r.teamId];
                        return (
                          <tr key={t.id} className={t.id === league.userTeamId ? 'is-user' : ''}>
                            <td className="sticky-col">
                              <TeamLink team={t} chip />
                            </td>
                            <td className="num">{r.w}</td>
                            <td className="num">{r.l}</td>
                            <td className="num">{r.t}</td>
                            <td className="num">{pct(r)}</td>
                            <td className="num">{r.pf}</td>
                            <td className="num">{r.pa}</td>
                            <td className="num">{`${r.div[0]}-${r.div[1]}${r.div[2] ? `-${r.div[2]}` : ''}`}</td>
                            <td className="num">{r.streak || '–'}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ))}
          </div>
        </Panel>
      ))}
      <p className="muted" style={{ margin: 0, fontSize: 'var(--step--1)' }}>
        Ties are broken by head-to-head, division record, conference record, point differential and points scored.
      </p>
    </>
  );
}
