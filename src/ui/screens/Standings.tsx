import { computeRecords, conferenceSeeds, divisionStandings } from '../../engine/season/standings';
import type { League } from '../../engine/types';
import { Panel, TeamLink } from '../components';
import { pct, recordText, resultsSeason } from '../format';

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
                        <th className="sticky-col">{d.division.name}</th>
                        <th className="num">W</th>
                        <th className="num">L</th>
                        <th className="num">T</th>
                        <th className="num">Pct</th>
                        <th className="num">PF</th>
                        <th className="num">PA</th>
                        <th className="num">Div</th>
                        <th className="num">Strk</th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.teams.map((r) => {
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
