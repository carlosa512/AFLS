import { leaders, LEADER_CATEGORIES } from '../../engine/stats';
import type { League } from '../../engine/types';
import { useNav } from '../App';
import { Panel, PlayerAvatar } from '../components';
import { resultsSeason } from '../format';

export function Leaders({ league }: { league: League }) {
  const nav = useNav();
  const season = resultsSeason(league);
  const anyStats = Object.values(league.players).some((p) => p.stats[season]);
  if (!anyStats) {
    return (
      <Panel title="League leaders">
        <p className="muted" style={{ margin: 0 }}>
          Leaders appear once the first week is played.
        </p>
      </Panel>
    );
  }
  return (
    <>
      <h2>{season} league leaders</h2>
      <div className="grid-3">
        {LEADER_CATEGORIES.map((cat) => {
          const rows = leaders(league, cat, 5, season);
          return (
            <Panel key={cat.key} title={<h3>{cat.label}</h3>}>
              <table>
                <tbody>
                  {rows.map((r, i) => {
                    const team = r.player.teamId !== null ? league.teams[r.player.teamId] : null;
                    return (
                      <tr key={r.player.id} className={r.player.teamId === league.userTeamId ? 'is-user' : ''}>
                        <td className="num muted" style={{ width: '1.5em' }}>
                          {i + 1}
                        </td>
                        <td style={{ whiteSpace: 'normal' }}>
                          <button className="linklike player-link" onClick={() => nav.openPlayer(r.player.id)}>
                            <PlayerAvatar player={r.player} team={team} size={28} />
                            <span>
                              {r.player.firstName[0]}. {r.player.lastName}
                            </span>
                          </button>
                          {team && <small className="muted"> {team.abbrev}</small>}
                        </td>
                        <td className="num" style={{ fontWeight: 700 }}>
                          {cat.format ? cat.format(r.value) : r.value.toLocaleString()}
                        </td>
                      </tr>
                    );
                  })}
                  {rows.length === 0 && (
                    <tr>
                      <td className="muted">No qualifiers yet</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </Panel>
          );
        })}
      </div>
    </>
  );
}
