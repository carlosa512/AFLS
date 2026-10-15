import { playerOvr, POSITION_NAMES, STARTERS } from '../../engine/positions';
import { buildAutoDepthChart, payroll, teamPlayers, teamRatings } from '../../engine/roster';
import { computeRecords } from '../../engine/season/standings';
import type { League, Player, Position, StatLine } from '../../engine/types';
import { POSITIONS } from '../../engine/types';
import { useNav } from '../App';
import { Panel, Rating, TeamChip } from '../components';
import { ATTR_LABELS, band, keyAttributes, money, recordText } from '../format';
import { store } from '../store';

export function statSummary(position: Position, s: StatLine | undefined): string {
  if (!s || !s.gp) return '–';
  const n = (k: keyof StatLine) => s[k] ?? 0;
  switch (position) {
    case 'QB':
      return `${n('passCmp')}/${n('passAtt')}, ${n('passYds').toLocaleString()} yds, ${n('passTd')} TD, ${n('passInt')} INT`;
    case 'RB':
      return `${n('rushAtt')} car, ${n('rushYds')} yds, ${n('rushTd')} TD · ${n('rec')} rec`;
    case 'WR':
    case 'TE':
      return `${n('rec')} rec, ${n('recYds')} yds, ${n('recTd')} TD`;
    case 'K':
      return `FG ${n('fgMade')}/${n('fgAtt')} · XP ${n('xpMade')}/${n('xpAtt')}`;
    case 'P':
      return n('punts') ? `${n('punts')} punts, ${(n('puntYds') / n('punts')).toFixed(1)} avg` : '–';
    case 'OL':
      return `${n('gp')} GP`;
    default:
      return `${n('tackles')} tkl, ${n('sacks')} sk, ${n('defInt')} INT`;
  }
}

function moveInDepth(teamId: number, pos: Position, index: number, dir: -1 | 1) {
  store.mutate((l) => {
    const team = l.teams[teamId];
    team.autoDepth = false;
    const list = team.depthChart[pos];
    const j = index + dir;
    if (j < 0 || j >= list.length) return;
    [list[index], list[j]] = [list[j], list[index]];
  });
}

function setAuto(teamId: number, auto: boolean) {
  store.mutate((l) => {
    const team = l.teams[teamId];
    team.autoDepth = auto;
    if (auto) team.depthChart = buildAutoDepthChart(teamPlayers(l, teamId));
  });
}

export function Roster({ league, teamId }: { league: League; teamId: number }) {
  const nav = useNav();
  const team = league.teams[teamId];
  const isUser = teamId === league.userTeamId;
  const ratings = teamRatings(league, team);
  const record = computeRecords(league).get(teamId)!;
  const pay = payroll(league, teamId);
  const players = teamPlayers(league, teamId);

  return (
    <>
      <Panel
        title={
          <div className="row">
            <TeamChip team={team} large />
            <div>
              <h2>
                {team.city} {team.name}
              </h2>
              <span className="muted">
                {league.divisions[team.division].name} · {recordText(record)}
              </span>
            </div>
          </div>
        }
        action={
          <select aria-label="Choose team" id="roster-team" value={teamId} onChange={(e) => nav.openTeam(Number(e.target.value))}>
            {[...league.teams]
              .sort((a, b) => a.city.localeCompare(b.city))
              .map((t) => (
                <option key={t.id} value={t.id}>
                  {t.city} {t.name}
                  {t.id === league.userTeamId ? ' (you)' : ''}
                </option>
              ))}
          </select>
        }
      >
        <div className="facts">
          <span className="fact">
            <span className="eyebrow">Overall</span>
            <b className="num">{ratings.overall.toFixed(1)}</b>
          </span>
          <span className="fact">
            <span className="eyebrow">QB</span>
            <b className="num">{ratings.qb.toFixed(1)}</b>
          </span>
          <span className="fact">
            <span className="eyebrow">Offense</span>
            <b className="num">{ratings.offense.toFixed(1)}</b>
          </span>
          <span className="fact">
            <span className="eyebrow">Defense</span>
            <b className="num">{ratings.defense.toFixed(1)}</b>
          </span>
          <span className="fact">
            <span className="eyebrow">Payroll</span>
            <b className="num">{money(pay)}</b>
          </span>
          <span className="fact">
            <span className="eyebrow">Cap space</span>
            <b className="num">{money(league.salaryCap - pay)}</b>
          </span>
        </div>
      </Panel>

      <Panel
        title="Depth chart"
        action={
          isUser ? (
            <label className="row" style={{ gap: 6, cursor: 'pointer' }}>
              <input type="checkbox" id="auto-depth" checked={team.autoDepth} onChange={(e) => setAuto(teamId, e.target.checked)} />
              Auto-sort by rating
            </label>
          ) : undefined
        }
      >
        {isUser && (
          <p className="muted" style={{ marginTop: 0, fontSize: 'var(--step--1)' }}>
            Starters are the top rows of each group (bold). Use the arrows to promote or bench a player; that turns auto-sort off for your team.
          </p>
        )}
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Depth</th>
                <th className="sticky-col">Player</th>
                <th className="num">OVR</th>
                <th className="num">Age</th>
                <th>Key ratings</th>
                <th className="num">Salary</th>
                <th className="num">Yrs</th>
                <th>{league.season} stats</th>
              </tr>
            </thead>
            <tbody>
              {POSITIONS.map((pos) => {
                const ids = team.depthChart[pos];
                return [
                  <tr className="group-row" key={`g-${pos}`}>
                    <td colSpan={8}>
                      <span className="group-label">
                        {POSITION_NAMES[pos]} · {STARTERS[pos]} starter{STARTERS[pos] > 1 ? 's' : ''}
                      </span>
                    </td>
                  </tr>,
                  ...ids.map((id, i) => {
                    const p = league.players[id] ?? players.find((x) => x.id === id);
                    if (!p) return null;
                    return <RosterRow key={id} league={league} player={p} index={i} count={ids.length} editable={isUser} teamId={teamId} />;
                  }),
                ];
              })}
            </tbody>
          </table>
        </div>
      </Panel>
    </>
  );
}

function RosterRow({ league, player: p, index, count, editable, teamId }: { league: League; player: Player; index: number; count: number; editable: boolean; teamId: number }) {
  const nav = useNav();
  const starter = index < STARTERS[p.position];
  return (
    <tr>
      <td>
        <span className="row" style={{ gap: 4, flexWrap: 'nowrap' }}>
          <span className="num" style={{ fontWeight: starter ? 700 : 400, minWidth: '2.4em' }}>
            {p.position}
            {index + 1}
          </span>
          {editable && (
            <>
              <button className="btn btn-icon btn-ghost" aria-label={`Move ${p.lastName} up`} disabled={index === 0} onClick={() => moveInDepth(teamId, p.position, index, -1)}>
                ▲
              </button>
              <button className="btn btn-icon btn-ghost" aria-label={`Move ${p.lastName} down`} disabled={index === count - 1} onClick={() => moveInDepth(teamId, p.position, index, 1)}>
                ▼
              </button>
            </>
          )}
        </span>
      </td>
      <td className="sticky-col">
        <button className="linklike" style={{ fontWeight: starter ? 700 : 400 }} onClick={() => nav.openPlayer(p.id)}>
          <span className="muted num">#{p.jersey}</span> {p.firstName} {p.lastName}
        </button>
      </td>
      <td className="num">
        <Rating value={playerOvr(p)} decimals={1} />
      </td>
      <td className="num">{p.age}</td>
      <td>
        <span className="row" style={{ gap: 10, flexWrap: 'nowrap' }}>
          {keyAttributes(p.position).map((a) => (
            <span key={a} className="num" style={{ fontSize: '0.75rem' }}>
              <span className="muted">{ATTR_LABELS[a][0]}</span> <span className={band(p.ratings[a])}>{p.ratings[a]}</span>
            </span>
          ))}
        </span>
      </td>
      <td className="num">{money(p.contract.salary)}</td>
      <td className="num">{p.contract.years}</td>
      <td className="muted">{statSummary(p.position, p.stats[league.season])}</td>
    </tr>
  );
}
